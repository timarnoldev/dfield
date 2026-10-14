// Expression parser for terms, conditions and numeric parameters.
// Adapted from the DFIELD expression parser (implicit multiplication, longest
// match of known names, ^ for powers) but evaluates to closures and resolves
// names of construction objects (measurements, segments, circles ...).
// Angles are in degrees: sin(30) = 0.5, asin(0.5) = 30.

const DEG = Math.PI / 180;
const FUNCS = {
  sin: (v) => Math.sin(v * DEG),
  cos: (v) => Math.cos(v * DEG),
  tan: (v) => Math.tan(v * DEG),
  asin: (v) => Math.asin(v) / DEG,
  acos: (v) => Math.acos(v) / DEG,
  atan: (v) => Math.atan(v) / DEG,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  atan2: (y, x) => Math.atan2(y, x) / DEG,
};
// functions whose arguments are point names
const POINT_FUNCS = {
  x: (p) => p.x,
  y: (p) => p.y,
  dist: (p, q) => Math.hypot(p.x - q.x, p.y - q.y),
};
export const FUNCTION_NAMES = Object.keys(FUNCS);
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };
const RESERVED = new Set([...Object.keys(FUNCS), ...Object.keys(POINT_FUNCS), ...Object.keys(CONSTS)]);

export class ExprError extends Error {}

const ID_START = /[\p{L}]/u;
const ID_CHAR = /[\p{L}\p{N}_']/u;

/** Names usable for objects (and therefore inside terms). */
export function isValidName(s) {
  return typeof s === 'string' && /^[\p{L}][\p{L}\p{N}_']{0,15}$/u.test(s) && !CONSTS[s] && !FUNCS[s];
}
export function isReserved(s) { return RESERVED.has(s); }

function tokenize(src, names) {
  const tokens = [];
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      if (j < n && /[eE]/.test(src[j]) && /[0-9]/.test(src[j + 1] || '') ) { j++; while (j < n && /[0-9]/.test(src[j])) j++; }
      const text = src.slice(i, j);
      const v = Number(text);
      if (Number.isNaN(v)) throw new ExprError(`Illegal number '${text}'`);
      tokens.push({ t: 'num', v, pos: i });
      i = j;
      continue;
    }
    if (c === '²' || c === '³') { tokens.push({ t: 'sup', v: c === '²' ? 2 : 3, pos: i }); i++; continue; }
    if (c === '°') { i++; continue; }
    if (c === '·' || c === '×') { tokens.push({ t: 'op', op: '*', pos: i }); i++; continue; }
    if (c === '÷') { tokens.push({ t: 'op', op: '/', pos: i }); i++; continue; }
    if (c === '−') { tokens.push({ t: 'op', op: '-', pos: i }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '<>', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', op: two === '<>' ? '!=' : two, pos: i }); i += 2; continue;
    }
    if (c === '≤' || c === '≥' || c === '≠') { tokens.push({ t: 'op', op: { '≤': '<=', '≥': '>=', '≠': '!=' }[c], pos: i }); i++; continue; }
    if ('+-*/^<>!='.includes(c)) { tokens.push({ t: 'op', op: c === '=' ? '==' : c, pos: i }); i++; continue; }
    if (c === '(') { tokens.push({ t: 'lp', pos: i }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rp', pos: i }); i++; continue; }
    if (c === '|') { tokens.push({ t: 'bar', pos: i }); i++; continue; }
    if (c === ',' || c === ';') { tokens.push({ t: 'comma', pos: i }); i++; continue; }
    if (ID_START.test(c)) {
      let j = i;
      while (j < n && ID_CHAR.test(src[j])) j++;
      const run = src.slice(i, j);
      const after = src.slice(j).trimStart();
      // function call?
      const fn = [...Object.keys(FUNCS), ...Object.keys(POINT_FUNCS)].sort((a, b) => b.length - a.length)
        .find((f) => run === f && after[0] === '(');
      if (fn) { tokens.push({ t: 'func', name: fn, pos: i }); i = j; continue; }
      if (names.has(run)) { tokens.push({ t: 'var', name: run, pos: i }); i = j; continue; }
      // longest known prefix (implicit multiplication like 2ab or ab)
      const nm = sorted.find((v) => src.startsWith(v, i));
      if (nm) { tokens.push({ t: 'var', name: nm, pos: i }); i += nm.length; continue; }
      const cn = ['pi', 'π', 'e'].find((k) => src.startsWith(k, i));
      if (cn) { tokens.push({ t: 'num', v: CONSTS[cn], pos: i }); i += cn.length; continue; }
      throw new ExprError(`Unknown name '${run}'`);
    }
    throw new ExprError(`Unexpected character '${c}'`);
  }
  return tokens;
}

/**
 * Compiles src. names: Set (or array) of known object names.
 * Returns { refs: Set<string>, evaluate(env) } where env = { num(name), point(name) }.
 */
export function compileExpr(src, names) {
  names = names instanceof Set ? names : new Set(names || []);
  src = String(src ?? '').trim();
  if (!src) throw new ExprError('Empty expression');
  const tokens = tokenize(src, names);
  const refs = new Set();
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (tok, ...ops) => tok && tok.t === 'op' && ops.includes(tok.op);
  const fail = (msg) => { throw new ExprError(msg || (peek() ? `Syntax error near position ${peek().pos + 1}` : 'Incomplete expression')); };
  const startsAtom = (tk) => tk && (tk.t === 'num' || tk.t === 'var' || tk.t === 'func' || tk.t === 'lp');

  function parseOr() {
    let l = parseAnd();
    while (isOp(peek(), '||')) { p++; const a = l, b = parseAnd(); l = (e) => (a(e) || b(e) ? 1 : 0); }
    return l;
  }
  function parseAnd() {
    let l = parseRel();
    while (isOp(peek(), '&&')) { p++; const a = l, b = parseRel(); l = (e) => (a(e) && b(e) ? 1 : 0); }
    return l;
  }
  function parseRel() {
    let l = parseAdd();
    while (isOp(peek(), '<', '>', '<=', '>=', '==', '!=')) {
      const op = tokens[p++].op;
      const a = l, b = parseAdd();
      const tol = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
      l = {
        '<': (e) => (a(e) < b(e) ? 1 : 0), '>': (e) => (a(e) > b(e) ? 1 : 0),
        '<=': (e) => (a(e) <= b(e) ? 1 : 0), '>=': (e) => (a(e) >= b(e) ? 1 : 0),
        '==': (e) => (tol(a(e), b(e)) ? 1 : 0), '!=': (e) => (tol(a(e), b(e)) ? 0 : 1),
      }[op];
    }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (isOp(peek(), '+', '-')) {
      const op = tokens[p++].op;
      const a = l, b = parseMul();
      l = op === '+' ? (e) => a(e) + b(e) : (e) => a(e) - b(e);
    }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    for (;;) {
      const tk = peek();
      if (isOp(tk, '*', '/')) {
        p++;
        const a = l, b = parseUnary();
        l = tk.op === '*' ? (e) => a(e) * b(e) : (e) => a(e) / b(e);
      } else if (startsAtom(tk)) {
        const a = l, b = parsePow();
        l = (e) => a(e) * b(e);
      } else break;
    }
    return l;
  }
  function parseUnary() {
    if (isOp(peek(), '-')) { p++; const a = parseUnary(); return (e) => -a(e); }
    if (isOp(peek(), '+')) { p++; return parseUnary(); }
    if (isOp(peek(), '!')) { p++; const a = parseUnary(); return (e) => (a(e) ? 0 : 1); }
    return parsePow();
  }
  function parsePow() {
    let base = parseAtom();
    for (;;) {
      if (peek() && peek().t === 'sup') { const k = tokens[p++].v; const a = base; base = (e) => a(e) ** k; continue; }
      if (isOp(peek(), '^')) {
        p++;
        const a = base, b = parseUnary(); // right associative via unary -> pow
        base = (e) => a(e) ** b(e);
        continue;
      }
      break;
    }
    return base;
  }
  function parseArgs() {
    const lp = tokens[p++];
    if (!lp || lp.t !== 'lp') fail();
    const args = [];
    if (peek() && peek().t === 'rp') { p++; return args; }
    for (;;) {
      args.push(parseOr());
      const tk = tokens[p++];
      if (tk && tk.t === 'rp') return args;
      if (!tk || tk.t !== 'comma') fail();
    }
  }
  function parseAtom() {
    const tk = tokens[p++];
    if (!tk) fail('Incomplete expression');
    switch (tk.t) {
      case 'num': { const v = tk.v; return () => v; }
      case 'var': { refs.add(tk.name); const nm = tk.name; return (e) => e.num(nm); }
      case 'func': {
        if (POINT_FUNCS[tk.name]) {
          const lp = tokens[p++];
          if (!lp || lp.t !== 'lp') fail();
          const pts = [];
          for (;;) {
            const v = tokens[p++];
            if (!v || v.t !== 'var') fail(`${tk.name}( ) needs point names`);
            refs.add(v.name);
            pts.push(v.name);
            const sep = tokens[p++];
            if (sep && sep.t === 'rp') break;
            if (!sep || sep.t !== 'comma') fail();
          }
          const f = POINT_FUNCS[tk.name];
          if (f.length !== pts.length) fail(`${tk.name}( ) expects ${f.length} point(s)`);
          return (e) => {
            const ps = pts.map((n) => e.point(n));
            return ps.some((q) => !q) ? NaN : f(...ps);
          };
        }
        const args = parseArgs();
        const f = FUNCS[tk.name];
        if (tk.name !== 'min' && tk.name !== 'max' && args.length !== f.length) fail(`${tk.name}( ) expects ${f.length} argument(s)`);
        if (!args.length) fail(`${tk.name}( ) expects arguments`);
        return (e) => f(...args.map((a) => a(e)));
      }
      case 'lp': {
        const inner = parseOr();
        const rp = tokens[p++];
        if (!rp || rp.t !== 'rp') fail('Missing )');
        return inner;
      }
      case 'bar': {
        const inner = parseOr();
        const rp = tokens[p++];
        if (!rp || rp.t !== 'bar') fail('Missing |');
        return (e) => Math.abs(inner(e));
      }
      default:
        p--;
        fail();
    }
    return null;
  }
  const root = parseOr();
  if (p < tokens.length) fail();
  return {
    refs,
    evaluate(env) {
      const v = root(env);
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    },
  };
}

/**
 * Replaces references to object names in src using the tokenizer (so implicit
 * multiplication like 2α is handled). map: Map(oldName -> newText).
 * Returns src unchanged if it cannot be tokenized.
 */
export function replaceNames(src, names, map) {
  names = names instanceof Set ? names : new Set(names || []);
  let tokens;
  try { tokens = tokenize(String(src), names); } catch { return src; }
  let out = '';
  let last = 0;
  for (const tk of tokens) {
    if (tk.t === 'var' && map.has(tk.name)) {
      out += src.slice(last, tk.pos) + map.get(tk.name);
      last = tk.pos + tk.name.length;
    }
  }
  return out + src.slice(last);
}
