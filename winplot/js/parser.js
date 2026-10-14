// Expression parser for the Winplot-style plotter.
// Adapted from the DFIELD web port parser, extended with an AST so that
// expressions can be differentiated symbolically and printed again.
//
// Syntax (case-insensitive, like Winplot):
//   + - * / ^ (right-assoc), implicit multiplication (2x, 3sin(x), xy, (x+1)(x-1)),
//   |x| for abs, relational operators < <= > >= == != returning 1/0,
//   constants pi, e; functions see FUNCTIONS; two-argument min, max, root(n,x), mod, atan2.
//   Variables are single letters supplied by the caller (e.g. x, y, t, u, v).
//   Every other single letter (except e) is a *parameter* (a, b, c, … like Winplot's A–W)
//   and is read live from the shared parameter object P.

export class ParseError extends Error {}

const F1 = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  cot: (v) => 1 / Math.tan(v), sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  acot: (v) => Math.PI / 2 - Math.atan(v),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, sqr: (v) => v * v, cbrt: Math.cbrt,
  abs: Math.abs, sgn: (v) => (v < 0 ? -1 : v > 0 ? 1 : 0), sign: (v) => (v < 0 ? -1 : v > 0 ? 1 : 0),
  floor: Math.floor, ceil: Math.ceil, round: Math.round, int: Math.trunc, frac: (v) => v - Math.trunc(v),
};
const F2 = {
  min: Math.min, max: Math.max, atan2: Math.atan2,
  mod: (a, b) => a - b * Math.floor(a / b),
  root: (n, v) => rootN(v, n),
  logb: (b, v) => Math.log(v) / Math.log(b),
};
const ALIASES = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', sign: 'sgn', log10: 'log' };
const FUNC_NAMES = [...Object.keys(F1), ...Object.keys(F2)].sort((a, b) => b.length - a.length);

function rootN(v, n) {
  if (v >= 0) return Math.pow(v, 1 / n);
  if (Math.abs(n % 2) === 1) return -Math.pow(-v, 1 / n);
  return NaN;
}

/** Real power: negative bases with odd-denominator rational exponents give real roots (x^(1/3)). */
function pow(a, b) {
  if (b === 2) return a * a;
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  for (const q of [3, 5, 7, 9]) {
    const p = Math.round(b * q);
    if (Math.abs(b * q - p) < 1e-9) {
      const r = Math.pow(-a, b);
      return p % 2 === 0 ? r : -r;
    }
  }
  return NaN;
}

export const RUNTIME = { ...F1, ...F2, pow };

/** Letters that are never parameters. */
export const VARIABLE_LETTERS = ['x', 'y', 'z', 't', 'u', 'v', 'r'];

// ---------------------------------------------------------------- tokenizer
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const isAlpha = (c) => c >= 'a' && c <= 'z';
  const isDigit = (c) => c >= '0' && c <= '9';
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = i;
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === '.') { j++; while (j < n && isDigit(src[j])) j++; }
      if ((src[j] === 'e' || src[j] === 'E') && /^[eE][+-]?\d/.test(src.slice(j, j + 3))) {
        j++; if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && isDigit(src[j])) j++;
      }
      tokens.push({ type: 'num', v: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }
    if ('+-*/^,|'.includes(c)) { tokens.push({ type: c === ',' ? 'comma' : c === '|' ? 'bar' : 'op', op: c, pos: i }); i++; continue; }
    if (c === '(' || c === '[' || c === '{') { tokens.push({ type: 'lp', pos: i }); i++; continue; }
    if (c === ')' || c === ']' || c === '}') { tokens.push({ type: 'rp', pos: i }); i++; continue; }
    if ('<>=!'.includes(c)) {
      const two = src.slice(i, i + 2);
      let op;
      if (['<=', '>=', '==', '!=', '<>'].includes(two)) op = two === '<>' ? '!=' : two;
      else if (c === '<' || c === '>') op = c;
      else if (c === '=') op = '==';
      else throw new ParseError(`Unexpected '${c}' at position ${i + 1}.`);
      tokens.push({ type: 'op', op, pos: i });
      i += op === '==' && two !== '==' ? 1 : two === '<>' ? 2 : op.length;
      continue;
    }
    if (c === 'π') { tokens.push({ type: 'const', name: 'pi', pos: i }); i++; continue; }
    if (isAlpha(c)) {
      const rest = src.slice(i);
      const fn = FUNC_NAMES.find((f) => rest.startsWith(f) && /^\s*[([{]/.test(rest.slice(f.length)));
      if (fn) { tokens.push({ type: 'func', name: ALIASES[fn] || fn, pos: i }); i += fn.length; continue; }
      if (rest.startsWith('pi')) { tokens.push({ type: 'const', name: 'pi', pos: i }); i += 2; continue; }
      const word = rest.match(/^[a-z]+/)[0];
      const bare = FUNC_NAMES.find((f) => word.startsWith(f) && (f.length >= 3 || f === 'ln'));
      if (bare) throw new ParseError(`'${bare}' needs parentheses, e.g. ${bare}(x).`);
      if (c === 'e') { tokens.push({ type: 'const', name: 'e', pos: i }); i++; continue; }
      tokens.push({ type: 'name', name: c, pos: i });
      i++;
      continue;
    }
    throw new ParseError(`Unrecognized character '${c}'.`);
  }
  return tokens;
}

/** Maps typographic characters (from iPad keyboards, copy & paste or our own labels) to plain syntax. */
export function normalizeSource(src) {
  return String(src ?? '').toLowerCase()
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/[×·∙⋅]/g, '*').replace(/÷/g, '/')
    .replace(/[−–]/g, '-').replace(/√/g, 'sqrt')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=')
    .trim();
}

// ---------------------------------------------------------------- AST
// nodes: {k:'num',v} {k:'var',n} {k:'par',n} {k:'const',n} {k:'neg',a} {k:'bin',op,a,b} {k:'fn',n,args}

export function parse(src, vars) {
  src = normalizeSource(src);
  if (!src) throw new ParseError('Empty expression.');
  const tokens = tokenize(src);
  let p = 0;
  let absDepth = 0;
  const peek = () => tokens[p];
  const fail = (t, msg) => {
    if (!t) throw new ParseError(msg || 'Expression is incomplete.');
    throw new ParseError(msg || `Syntax error near '${src.slice(Math.max(0, t.pos - 6), t.pos + 1)}'.`);
  };
  const isOp = (t, ...ops) => t && t.type === 'op' && ops.includes(t.op);
  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'name' || t.type === 'const' || t.type === 'func' || t.type === 'lp' || (t.type === 'bar' && absDepth === 0));

  function parseRel() {
    let left = parseAdd();
    while (isOp(peek(), '<', '<=', '>', '>=', '==', '!=')) {
      const op = tokens[p++].op;
      left = { k: 'bin', op, a: left, b: parseAdd() };
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (isOp(peek(), '+', '-')) {
      const op = tokens[p++].op;
      left = { k: 'bin', op, a: left, b: parseMul() };
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (isOp(t, '*', '/')) { p++; left = { k: 'bin', op: t.op, a: left, b: parseUnary() }; }
      else if (startsAtom(t)) left = { k: 'bin', op: '*', a: left, b: parsePow() };
      else break;
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (isOp(t, '-')) { p++; return { k: 'neg', a: parseUnary() }; }
    if (isOp(t, '+')) { p++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    const base = parseAtom();
    if (isOp(peek(), '^')) {
      p++;
      const t = peek();
      let ex;
      if (isOp(t, '-')) { p++; ex = { k: 'neg', a: parsePowNoUnary() }; }
      else if (isOp(t, '+')) { p++; ex = parsePowNoUnary(); }
      else ex = parsePowNoUnary();
      return { k: 'bin', op: '^', a: base, b: ex };
    }
    return base;
  }
  function parsePowNoUnary() { return parsePow(); }
  function parseAtom() {
    const t = tokens[p++];
    if (!t) fail(null);
    switch (t.type) {
      case 'num': return { k: 'num', v: t.v };
      case 'const': return { k: 'const', n: t.name };
      case 'name':
        if (vars.includes(t.name)) return { k: 'var', n: t.name };
        if (VARIABLE_LETTERS.includes(t.name)) {
          throw new ParseError(`Variable '${t.name}' cannot be used here (allowed: ${vars.join(', ') || 'none'}).`);
        }
        return { k: 'par', n: t.name };
      case 'func': {
        p++; // '(' guaranteed by tokenizer
        const args = [parseRel()];
        while (peek() && peek().type === 'comma') { p++; args.push(parseRel()); }
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp, `Missing ')' after ${t.name}(…`);
        const want = t.name in F2 ? 2 : 1;
        if (args.length !== want) throw new ParseError(`${t.name}() takes ${want} argument${want > 1 ? 's' : ''}.`);
        return { k: 'fn', n: t.name, args };
      }
      case 'lp': {
        const saved = absDepth;
        absDepth = 0;
        const inner = parseRel();
        absDepth = saved;
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp, "Missing ')'.");
        return inner;
      }
      case 'bar': {
        absDepth++;
        const inner = parseRel();
        absDepth--;
        const rb = tokens[p++];
        if (!rb || rb.type !== 'bar') fail(rb, "Missing closing '|'.");
        return { k: 'fn', n: 'abs', args: [inner] };
      }
      case 'rp': fail(t, "Unexpected ')'.");
      // falls through
      default: fail(t);
    }
    return null;
  }
  const ast = parseRel();
  if (p < tokens.length) fail(tokens[p]);
  return ast;
}

// ---------------------------------------------------------------- code generation
function gen(n) {
  switch (n.k) {
    case 'num': return `(${n.v})`;
    case 'const': return n.n === 'pi' ? 'Math.PI' : 'Math.E';
    case 'var': return n.n;
    case 'par': return `P.${n.n}`;
    case 'neg': return `(-${gen(n.a)})`;
    case 'fn': return `R.${n.n}(${n.args.map(gen).join(',')})`;
    case 'bin':
      if (n.op === '^') return `R.pow(${gen(n.a)},${gen(n.b)})`;
      if (['<', '<=', '>', '>=', '==', '!='].includes(n.op)) return `((${gen(n.a)})${n.op === '==' ? '===' : n.op === '!=' ? '!==' : n.op}(${gen(n.b)})?1:0)`;
      return `(${gen(n.a)}${n.op}${gen(n.b)})`;
    default: throw new Error('bad node');
  }
}

function collect(n, set, kind) {
  if (!n) return set;
  if (n.k === kind) set.add(n.n);
  if (n.a) collect(n.a, set, kind);
  if (n.b) collect(n.b, set, kind);
  if (n.args) n.args.forEach((a) => collect(a, set, kind));
  return set;
}
export const paramsOf = (ast) => collect(ast, new Set(), 'par');
export const varsOf = (ast) => collect(ast, new Set(), 'var');

/** Shared, live parameter values (a, b, c, …). */
export const P = Object.create(null);
for (const c of 'abcdfghijklmnopqsw') P[c] = 1;

/**
 * Compile an AST or source to a fast JS function of the given variables.
 * Returns { fn, ast, params:Set, src }.
 */
export function compileAst(ast, vars) {
  const code = gen(ast);
  // eslint-disable-next-line no-new-func
  const raw = new Function('R', 'P', ...vars, `return ${code};`);
  const fn = raw.bind(null, RUNTIME, P);
  return { fn, ast, params: paramsOf(ast) };
}
export function compile(src, vars) {
  const ast = parse(src, vars);
  return { ...compileAst(ast, vars), src };
}

/** Evaluates a constant expression (parameters allowed) – used for domains, points, etc. */
export function evalConst(src, fallback = NaN) {
  if (src === undefined || src === null || String(src).trim() === '') return fallback;
  const c = compile(String(src), []);
  return c.fn();
}

// ---------------------------------------------------------------- printing
const PREC = { '==': 0, '!=': 0, '<': 0, '<=': 0, '>': 0, '>=': 0, '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };
function fmtNumber(v) {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(12)));
}
export function toStr(n, parent = -1, right = null) {
  let s, prec;
  switch (n.k) {
    case 'num':
      s = fmtNumber(Math.abs(n.v)); prec = 9;
      if (n.v < 0) { s = `-${s}`; prec = PREC.neg; }
      break;
    case 'const': s = n.n; prec = 9; break;
    case 'var': case 'par': s = n.n; prec = 9; break;
    case 'fn': s = `${n.n}(${n.args.map((a) => toStr(a)).join(', ')})`; prec = 9; break;
    case 'neg': s = `-${toStr(n.a, n.a.k === 'bin' && (n.a.op === '*' || n.a.op === '/') ? PREC['*'] : PREC.neg)}`; prec = PREC.neg; break;
    case 'bin': {
      prec = PREC[n.op];
      if (n.op === '^') s = `${toStr(n.a, prec + 0.5)}^${toStr(n.b, prec, '^')}`;
      else {
        const sep = n.op === '*' ? '*' : ` ${n.op} `;
        s = `${toStr(n.a, prec)}${sep}${toStr(n.b, prec, n.op)}`;
        if (n.op === '*' && implicitOk(n)) s = `${toStr(n.a, prec)}${toStr(n.b, prec, n.op)}`;
      }
      break;
    }
    default: s = '?'; prec = 9;
  }
  const needParen = prec < parent || (right && prec === parent && n.k === 'bin' && n.op !== '^' && (right === '-' || right === '/'));
  return needParen ? `(${s})` : s;
}
function implicitOk(n) {
  // "2x", "3sin(x)", "ab" – number or letter followed by letter/function/power-of-letter
  const a = n.a, b = n.b;
  const leftOk = a.k === 'num' && a.v >= 0;
  const rightLetter = b.k === 'var' || b.k === 'par' || b.k === 'fn' || b.k === 'const' || (b.k === 'bin' && b.op === '^' && (b.a.k === 'var' || b.a.k === 'par'));
  return leftOk && rightLetter;
}

// ---------------------------------------------------------------- simplification
const num = (v) => ({ k: 'num', v });
const isNum = (n, v) => n.k === 'num' && (v === undefined || n.v === v);
const bin = (op, a, b) => simplifyNode({ k: 'bin', op, a, b });
const neg = (a) => simplifyNode({ k: 'neg', a });
const fn = (name, ...args) => ({ k: 'fn', n: name, args });

function same(a, b) {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'num': return a.v === b.v;
    case 'const': case 'var': case 'par': return a.n === b.n;
    case 'neg': return same(a.a, b.a);
    case 'bin': return a.op === b.op && same(a.a, b.a) && same(a.b, b.b);
    case 'fn': return a.n === b.n && a.args.length === b.args.length && a.args.every((x, i) => same(x, b.args[i]));
    default: return false;
  }
}

function simplifyNode(n) {
  if (n.k === 'neg') {
    if (isNum(n.a)) return num(-n.a.v);
    if (n.a.k === 'neg') return n.a.a;
    return n;
  }
  if (n.k !== 'bin') return n;
  const { op, a, b } = n;
  if (isNum(a) && isNum(b) && ['+', '-', '*', '/', '^'].includes(op)) {
    const v = op === '+' ? a.v + b.v : op === '-' ? a.v - b.v : op === '*' ? a.v * b.v : op === '/' ? a.v / b.v : pow(a.v, b.v);
    if (Number.isFinite(v) && (Number.isInteger(v) || op !== '/')) return num(v);
  }
  switch (op) {
    case '+':
      if (isNum(a, 0)) return b;
      if (isNum(b, 0)) return a;
      if (b.k === 'neg') return bin('-', a, b.a);
      if (isNum(b) && b.v < 0) return bin('-', a, num(-b.v));
      break;
    case '-':
      if (isNum(b, 0)) return a;
      if (isNum(a, 0)) return neg(b);
      if (b.k === 'neg') return bin('+', a, b.a);
      break;
    case '*':
      if (isNum(a, 0) || isNum(b, 0)) return num(0);
      if (same(a, b)) return bin('^', a, num(2));
      if (b.k === 'bin' && b.op === '/' && isNum(b.a, 1)) return bin('/', a, b.b);
      if (a.k === 'bin' && a.op === '/' && isNum(a.a, 1)) return bin('/', b, a.b);
      if (!isNum(a) && b.k === 'bin' && b.op === '*' && isNum(b.a)) return bin('*', b.a, bin('*', a, b.b));
      if (a.k === 'fn' && b.k !== 'fn' && !isNum(b)) return bin('*', b, a);
      if (isNum(a, 1)) return b;
      if (isNum(b, 1)) return a;
      if (isNum(a, -1)) return neg(b);
      if (isNum(b, -1)) return neg(a);
      if (isNum(b) && !isNum(a)) return bin('*', b, a);
      if (a.k === 'neg') return neg(bin('*', a.a, b));
      if (b.k === 'neg') return neg(bin('*', a, b.a));
      if (isNum(a) && b.k === 'bin' && b.op === '*' && isNum(b.a)) return bin('*', num(a.v * b.a.v), b.b);
      break;
    case '/':
      if (isNum(a, 0)) return num(0);
      if (same(a, b)) return num(1);
      if (a.k === 'bin' && a.op === '*' && isNum(a.a) && b.k === 'bin' && b.op === '*' && isNum(b.a) && a.a.v === b.a.v) return bin('/', a.b, b.b);
      if (a.k === 'bin' && a.op === '*' && isNum(a.a) && isNum(b) && Number.isInteger(a.a.v / b.v)) return bin('*', num(a.a.v / b.v), a.b);
      if (a.k === 'bin' && a.op === '*' && isNum(a.a) && isNum(b) && Number.isInteger(a.a.v) && Number.isInteger(b.v) && b.v !== 0) {
        // reduce 3x^2 / 6 -> x^2 / 2
        const gcd = (p, q) => (q ? gcd(q, p % q) : Math.abs(p));
        const g = gcd(a.a.v, b.v) * Math.sign(b.v);
        if (g !== 1) return bin('/', bin('*', num(a.a.v / g), a.b), num(b.v / g));
      }
      if (isNum(b, 1)) return a;
      if (a.k === 'neg') return neg(bin('/', a.a, b));
      break;
    case '^':
      if (isNum(b, 0)) return num(1);
      if (isNum(b, 1)) return a;
      if (isNum(b) && a.k === 'bin' && a.op === '^' && isNum(a.b)) return bin('^', a.a, num(a.b.v * b.v));
      break;
    default:
  }
  return n;
}

// ---------------------------------------------------------------- symbolic derivative
export class DiffError extends Error {}

/** d(ast)/d(v). Throws DiffError for non-differentiable constructs. */
export function diff(n, v) {
  const d = (m) => diff(m, v);
  switch (n.k) {
    case 'num': case 'const': case 'par': return num(0);
    case 'var': return num(n.n === v ? 1 : 0);
    case 'neg': return neg(d(n.a));
    case 'bin': {
      const { op, a, b } = n;
      if (op === '+' || op === '-') return bin(op, d(a), d(b));
      if (op === '*') return bin('+', bin('*', d(a), b), bin('*', a, d(b)));
      if (op === '/') {
        const db = d(b);
        if (isNum(db, 0)) return bin('/', d(a), b); // constant denominator
        return bin('/', bin('-', bin('*', d(a), b), bin('*', a, db)), bin('^', b, num(2)));
      }
      if (op === '^') {
        const b = simplifyNode(n.b); // e.g. x^-2: neg(2) -> -2
        const db = d(b);
        if (isNum(db, 0)) {
          // a^c with constant exponent: c a^(c-1) a'
          if (isNum(b)) return bin('*', bin('*', b, bin('^', a, num(b.v - 1))), d(a));
          return bin('*', bin('*', b, bin('^', a, bin('-', b, num(1)))), d(a));
        }
        if (a.k === 'const' && a.n === 'e') return bin('*', n, db);
        // general: a^b (b' ln a + b a'/a)
        return bin('*', n, bin('+', bin('*', db, fn('ln', a)), bin('/', bin('*', b, d(a)), a)));
      }
      // relational -> piecewise constant
      return num(0);
    }
    case 'fn': {
      const [u, w] = n.args;
      if (n.args.length === 2) {
        if (n.n === 'root') {
          if (!isNum(d(u), 0)) throw new DiffError('root(n,x) with variable n');
          return d({ k: 'bin', op: '^', a: w, b: bin('/', num(1), u) });
        }
        if (n.n === 'logb') return d(bin('/', fn('ln', w), fn('ln', u)));
        if (n.n === 'atan2') {
          // atan2(y,x)' = (x y' - y x')/(x^2+y^2)
          return bin('/', bin('-', bin('*', w, d(u)), bin('*', u, d(w))), bin('+', bin('^', u, num(2)), bin('^', w, num(2))));
        }
        throw new DiffError(`${n.n}() is not differentiable symbolically`);
      }
      const du = d(u);
      if (isNum(du, 0)) return num(0);
      const chain = (g) => bin('*', g, du);
      const sq = (x) => bin('^', x, num(2));
      switch (n.n) {
        case 'sin': return chain(fn('cos', u));
        case 'cos': return neg(chain(fn('sin', u)));
        case 'tan': return chain(sq(fn('sec', u)));
        case 'cot': return neg(chain(sq(fn('csc', u))));
        case 'sec': return chain(bin('*', fn('sec', u), fn('tan', u)));
        case 'csc': return neg(chain(bin('*', fn('csc', u), fn('cot', u))));
        case 'asin': return bin('/', du, fn('sqrt', bin('-', num(1), sq(u))));
        case 'acos': return neg(bin('/', du, fn('sqrt', bin('-', num(1), sq(u)))));
        case 'atan': return bin('/', du, bin('+', num(1), sq(u)));
        case 'acot': return neg(bin('/', du, bin('+', num(1), sq(u))));
        case 'sinh': return chain(fn('cosh', u));
        case 'cosh': return chain(fn('sinh', u));
        case 'tanh': return bin('/', du, sq(fn('cosh', u)));
        case 'asinh': return bin('/', du, fn('sqrt', bin('+', sq(u), num(1))));
        case 'acosh': return bin('/', du, fn('sqrt', bin('-', sq(u), num(1))));
        case 'atanh': return bin('/', du, bin('-', num(1), sq(u)));
        case 'exp': return chain(fn('exp', u));
        case 'ln': return bin('/', du, u);
        case 'log': return bin('/', du, bin('*', fn('ln', num(10)), u));
        case 'log2': return bin('/', du, bin('*', fn('ln', num(2)), u));
        case 'sqrt': return bin('/', du, bin('*', num(2), fn('sqrt', u)));
        case 'cbrt': return bin('/', du, bin('*', num(3), sq(fn('cbrt', u))));
        case 'sqr': return chain(bin('*', num(2), u));
        case 'abs': return chain(fn('sgn', u));
        case 'sgn': case 'floor': case 'ceil': case 'round': case 'int': return num(0);
        case 'frac': return du;
        default: throw new DiffError(`${n.n}() is not differentiable symbolically`);
      }
    }
    default: throw new DiffError('unknown node');
  }
}

/** Derivative of source expression `src` in variables `vars` with respect to `v`, as a string. */
export function derivativeString(src, vars, v) {
  return toStr(diff(parse(src, vars), v));
}

export const FUNCTION_LIST = Object.keys({ ...F1, ...F2 }).filter((f) => !(f in ALIASES));
