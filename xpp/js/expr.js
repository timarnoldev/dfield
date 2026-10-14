// Expression parser / compiler for XPP-style formulas.
// Grammar (lowest to highest precedence):
//   or:   and ( '|' and )*
//   and:  cmp ( '&' cmp )*
//   cmp:  add ( ('<'|'>'|'<='|'>='|'=='|'!=') add )*
//   add:  mul ( ('+'|'-') mul )*
//   mul:  unary ( ('*'|'/') unary )*
//   unary: ('-'|'+') unary | pow
//   pow:  atom ( ('^'|'**') unary )?        (right associative, -x^2 = -(x^2))
//   atom: number | name | name '(' args ')' | '(' expr ')' | if(c)then(a)else(b)
// Names are case-insensitive (as in XPP). No implicit multiplication.

export class ExprError extends Error {
  constructor(msg, pos = -1) { super(msg); this.pos = pos; }
}

function erf(x) {
  // Abramowitz-Stegun 7.1.26 refined by a few Newton-free terms (|err| < 1.2e-7)
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.5 * a);
  const y = 1 - t * Math.exp(-a * a - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return s * y;
}
function normal(m, s) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const RUNTIME = {
  sign: (v) => (v > 0 ? 1 : v < 0 ? -1 : 0),
  heav: (v) => (v >= 0 ? 1 : 0),
  mod: (a, b) => { const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; },
  erf,
  erfc: (x) => 1 - erf(x),
  ran: (x) => x * Math.random(),
  normal,
  not: (x) => (x === 0 ? 1 : 0),
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
};

// name -> [arity, js]
export const BUILTINS = {
  sin: [1, 'Math.sin'], cos: [1, 'Math.cos'], tan: [1, 'Math.tan'],
  asin: [1, 'Math.asin'], acos: [1, 'Math.acos'], atan: [1, 'Math.atan'], atan2: [2, 'Math.atan2'],
  sinh: [1, 'Math.sinh'], cosh: [1, 'Math.cosh'], tanh: [1, 'Math.tanh'],
  asinh: [1, 'Math.asinh'], acosh: [1, 'Math.acosh'], atanh: [1, 'Math.atanh'],
  exp: [1, 'Math.exp'], ln: [1, 'Math.log'], log: [1, 'Math.log'], log10: [1, 'Math.log10'],
  sqrt: [1, 'Math.sqrt'], abs: [1, 'Math.abs'], sign: [1, 'R.sign'], heav: [1, 'R.heav'],
  mod: [2, 'R.mod'], min: [2, 'Math.min'], max: [2, 'Math.max'],
  flr: [1, 'Math.floor'], floor: [1, 'Math.floor'], ceil: [1, 'Math.ceil'], round: [1, 'Math.round'],
  erf: [1, 'R.erf'], erfc: [1, 'R.erfc'], ran: [1, 'R.ran'], normal: [2, 'R.normal'], not: [1, 'R.not'],
  pow: [2, 'Math.pow'],
};
export const RESERVED = new Set(['t', 'pi', 'if', 'then', 'else', ...Object.keys(BUILTINS)]);

const OPS2 = ['**', '<=', '>=', '==', '!=', '<>'];

export function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`bad number`, i);
      toks.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      if (/[A-Za-z_]/.test(src[i] || '')) throw new ExprError(`missing operator after number '${m[0]}' (use '*' for multiplication)`, i);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      toks.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { toks.push({ t: 'op', v: two === '<>' ? '!=' : two === '**' ? '^' : two, pos: i }); i += 2; continue; }
    if ('+-*/^()<>,&|'.includes(c)) { toks.push({ t: 'op', v: c, pos: i }); i++; continue; }
    if (c === '=') throw new ExprError(`unexpected '=' (use '==' for comparison)`, i);
    throw new ExprError(`unexpected character '${c}'`, i);
  }
  return toks;
}

/** Parses an expression string into an AST. */
export function parseExpr(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const expect = (v) => {
    if (!isOp(v)) {
      const tk = toks[p];
      throw new ExprError(tk ? `expected '${v}' but found '${tk.v}'` : `expected '${v}' at end of expression`, tk ? tk.pos : src.length);
    }
    p++;
  };
  function or() {
    let a = and();
    while (isOp('|')) { p++; a = { k: 'bin', op: '|', a, b: and() }; }
    return a;
  }
  function and() {
    let a = cmp();
    while (isOp('&')) { p++; a = { k: 'bin', op: '&', a, b: cmp() }; }
    return a;
  }
  function cmp() {
    let a = add();
    while (peek() && peek().t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
      const op = toks[p++].v;
      a = { k: 'bin', op, a, b: add() };
    }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: mul() }; }
    return a;
  }
  function mul() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: unary() }; continue; }
      const tk = peek();
      if (tk && (tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && tk.v === '('))) {
        throw new ExprError(`missing operator before '${tk.v}' (use '*' for multiplication)`, tk.pos);
      }
      break;
    }
    return a;
  }
  function unary() {
    if (isOp('-')) { p++; return { k: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return pow();
  }
  function pow() {
    const a = atom();
    if (isOp('^')) { p++; return { k: 'bin', op: '^', a, b: unary() }; }
    return a;
  }
  function atom() {
    const tk = toks[p++];
    if (!tk) throw new ExprError('unexpected end of expression', src.length);
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'op' && tk.v === '(') { const e = or(); expect(')'); return e; }
    if (tk.t === 'id') {
      const lname = tk.v.toLowerCase();
      if (lname === 'if') {
        expect('('); const c = or(); expect(')');
        const th = toks[p++];
        if (!th || th.t !== 'id' || th.v.toLowerCase() !== 'then') throw new ExprError("expected 'then' in if(...)then(...)else(...)", th ? th.pos : src.length);
        expect('('); const a = or(); expect(')');
        const el = toks[p++];
        if (!el || el.t !== 'id' || el.v.toLowerCase() !== 'else') throw new ExprError("expected 'else' in if(...)then(...)else(...)", el ? el.pos : src.length);
        expect('('); const b = or(); expect(')');
        return { k: 'if', c, a, b };
      }
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(or());
            if (isOp(',')) { p++; continue; }
            break;
          }
        }
        expect(')');
        return { k: 'call', name: tk.v, lname, args, pos: tk.pos };
      }
      return { k: 'name', name: tk.v, lname, pos: tk.pos };
    }
    throw new ExprError(`unexpected '${tk.v}'`, tk.pos);
  }
  if (!toks.length) throw new ExprError('empty expression', 0);
  const e = or();
  if (p < toks.length) {
    const tk = toks[p];
    throw new ExprError(tk.v === ')' ? "unmatched ')'" : `unexpected '${tk.v}'`, tk.pos);
  }
  return e;
}

/** Collects the lower-case identifiers (and called functions) used by an AST. */
export function collectNames(ast, names = new Set(), calls = new Set()) {
  (function walk(e) {
    switch (e.k) {
      case 'name': names.add(e.lname); break;
      case 'call': calls.add(e.lname); e.args.forEach(walk); break;
      case 'neg': walk(e.a); break;
      case 'bin': walk(e.a); walk(e.b); break;
      case 'if': walk(e.c); walk(e.a); walk(e.b); break;
      default: break;
    }
  })(ast);
  return { names, calls };
}

/**
 * Generates JavaScript code for an AST.
 * resolve(lname, node) -> js code for a variable reference (or throws ExprError)
 * resolveCall(lname, nargs, node) -> js function expression (or null for unknown)
 */
export function genCode(ast, resolve, resolveCall) {
  function g(e) {
    switch (e.k) {
      case 'num': return String(e.v);
      case 'name': {
        if (e.lname === 'pi') return 'Math.PI';
        return resolve(e.lname, e);
      }
      case 'neg': return `(-${g(e.a)})`;
      case 'if': return `((${g(e.c)})!==0?(${g(e.a)}):(${g(e.b)}))`;
      case 'call': {
        const b = BUILTINS[e.lname];
        let fn;
        if (b) {
          if (b[0] !== e.args.length) throw new ExprError(`${e.name}() takes ${b[0]} argument${b[0] > 1 ? 's' : ''}`, e.pos);
          fn = b[1];
        } else {
          fn = resolveCall ? resolveCall(e.lname, e.args.length, e) : null;
          if (!fn) throw new ExprError(`unknown function '${e.name}'`, e.pos);
        }
        return `${fn}(${e.args.map(g).join(',')})`;
      }
      case 'bin': {
        const a = g(e.a), b = g(e.b);
        switch (e.op) {
          case '+': case '-': case '*': case '/': return `(${a}${e.op}${b})`;
          case '^':
            if (e.b.k === 'num' && e.b.v === 2) return `R.sq(${a})`;
            return `Math.pow(${a},${b})`;
          case '<': case '>': case '<=': case '>=': return `((${a})${e.op}(${b})?1:0)`;
          case '==': return `((${a})===(${b})?1:0)`;
          case '!=': return `((${a})!==(${b})?1:0)`;
          case '&': return `((${a})!==0&&(${b})!==0?1:0)`;
          case '|': return `((${a})!==0||(${b})!==0?1:0)`;
          default: throw new ExprError(`bad operator ${e.op}`);
        }
      }
      default: throw new ExprError('bad expression');
    }
  }
  return g(ast);
}
RUNTIME.sq = (v) => v * v;

/** Evaluates a constant expression (numbers, pi, builtin functions, given constants). */
export function evalConst(src, consts = {}) {
  const ast = parseExpr(src);
  const code = genCode(ast, (lname, node) => {
    if (lname in consts) return `(${consts[lname]})`;
    throw new ExprError(`unknown name '${node.name}'`, node.pos);
  });
  // eslint-disable-next-line no-new-func
  return new Function('R', `return ${code};`)(RUNTIME);
}
