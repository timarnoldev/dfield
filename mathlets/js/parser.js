// Expression parser for the mathlets.
// Syntax follows the DFIELD web port: implicit multiplication (2x, 3sin(x), xy, (x+1)(x-1)),
// unary minus binding weaker than ^ (-x^2 = -(x^2)), ^ left associative, relational
// operators returning 1/0, constants e and pi.
// The parser builds an AST which can be compiled to a fast JS function or evaluated on
// truncated power series ("jets") to obtain exact Taylor coefficients.

const heaviside = (v) => (v >= 0 ? 1 : 0);
const FUNCTIONS = {
  abs: Math.abs,
  acosh: Math.acosh,
  asinh: Math.asinh,
  atanh: Math.atanh,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  arctan: Math.atan,
  cosh: Math.cosh,
  cos: Math.cos,
  cot: (v) => 1 / Math.tan(v),
  csc: (v) => 1 / Math.sin(v),
  exp: Math.exp,
  log10: Math.log10,
  log: Math.log,
  ln: Math.log,
  sec: (v) => 1 / Math.cos(v),
  sinh: Math.sinh,
  sin: Math.sin,
  sign: Math.sign,
  sgn: Math.sign,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  tan: Math.tan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  heaviside,
  step: heaviside,
  u: heaviside,
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length);

// Power with real-valued odd roots of negative numbers: (-8)^(1/3) = -2.
function pow(a, b) {
  if (b === 2) return a * a;
  if (a === Math.E) return Math.exp(b);
  if (a >= 0) return Math.pow(a, b);
  if (Number.isInteger(b)) return Math.pow(a, b);
  // b = p/q with odd q: real root, sign (−1)^p (so (−8)^(2/3) = 4, (−8)^(1/3) = −2); even q: undefined
  for (let q = 3; q <= 15; q += 2) {
    const pq = b * q, pr = Math.round(pq);
    if (Math.abs(pq - pr) < 1e-9) return (pr % 2 ? -1 : 1) * Math.pow(-a, b);
  }
  return NaN;
}
const RUNTIME = { ...FUNCTIONS, pow };

export class ParseError extends Error {}

const RELOPS = ['<=', '>=', '==', '<>', '!=', '<', '>'];

function tokenize(src, names) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const isAlpha = (c) => /[A-Za-z]/.test(c);
  const isDigit = (c) => c >= '0' && c <= '9';
  const sorted = [...names].sort((a, b) => b.length - a.length);
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i;
      while (j < n && (isDigit(src[j]) || src[j] === '.')) j++;
      // scientific notation 1e-3
      if (j < n && (src[j] === 'E') && /^[+-]?\d/.test(src.slice(j + 1))) {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && isDigit(src[j])) j++;
      }
      const text = src.slice(i, j);
      const v = Number(text);
      if (Number.isNaN(v)) throw new ParseError(`'${text}' is not a number.`);
      tokens.push({ type: 'num', v, pos: i });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) { tokens.push({ type: 'op', op: c, pos: i }); i++; continue; }
    if (c === '(' || c === '[') { tokens.push({ type: 'lp', pos: i }); i++; continue; }
    if (c === ')' || c === ']') { tokens.push({ type: 'rp', pos: i }); i++; continue; }
    if ('<>=!'.includes(c)) {
      const op = RELOPS.find((r) => src.startsWith(r, i));
      if (!op) throw new ParseError(`Bad operator at '${src.slice(0, i + 1)}'.`);
      tokens.push({ type: 'op', op: op === '<>' ? '!=' : op, pos: i });
      i += op.length;
      continue;
    }
    if (c === 'π') { tokens.push({ type: 'const', v: Math.PI, pos: i }); i++; continue; }
    if (isAlpha(c)) {
      const lower = src.slice(i).toLowerCase();
      const fn = FUNCTION_NAMES.find((f) => lower.startsWith(f) && /^\s*[([]/.test(lower.slice(f.length)));
      if (fn) { tokens.push({ type: 'func', name: fn, pos: i }); i += fn.length; continue; }
      const nm = sorted.find((v) => src.startsWith(v, i));
      if (nm) { tokens.push({ type: 'var', name: nm, pos: i }); i += nm.length; continue; }
      if (src.startsWith('pi', i)) { tokens.push({ type: 'const', v: Math.PI, pos: i }); i += 2; continue; }
      if (c === 'e') { tokens.push({ type: 'const', v: Math.E, pos: i }); i++; continue; }
      let j = i + 1;
      while (j < n && j < i + 8 && /[A-Za-z0-9]/.test(src[j])) j++;
      throw new ParseError(`Unknown name '${src.slice(i, j)}'. Variables: ${names.join(', ')}.`);
    }
    throw new ParseError(`Unexpected character '${c}'.`);
  }
  return tokens;
}

function checkParens(src) {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '(' || src[i] === '[') depth++;
    else if (src[i] === ')' || src[i] === ']') {
      depth--;
      if (depth < 0) throw new ParseError('Mismatched parentheses.');
    }
  }
  if (depth) throw new ParseError('Mismatched parentheses.');
}

/** Parse to AST. names: list of variable names. */
export function parse(src, names) {
  src = String(src).trim();
  if (!src) throw new ParseError('Empty expression.');
  checkParens(src);
  const tokens = tokenize(src, names);
  let p = 0;
  const peek = () => tokens[p];
  const fail = (tok) => {
    if (!tok) throw new ParseError('Incomplete expression.');
    throw new ParseError(`Syntax error at '${src.slice(0, tok.pos + 1)}'.`);
  };
  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'var' || t.type === 'const' || t.type === 'func' || t.type === 'lp');
  const isOp = (t, ...ops) => t && t.type === 'op' && ops.includes(t.op);

  function rel() {
    let a = add();
    while (peek() && peek().type === 'op' && RELOPS.includes(peek().op)) {
      const op = tokens[p++].op;
      a = { t: 'rel', op, a, b: add() };
    }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp(peek(), '+', '-')) {
      const op = tokens[p++].op;
      a = { t: 'bin', op, a, b: mul() };
    }
    return a;
  }
  function mul() {
    let a = unary();
    for (;;) {
      const t = peek();
      if (isOp(t, '*', '/')) { p++; a = { t: 'bin', op: t.op, a, b: unary() }; }
      else if (startsAtom(t)) a = { t: 'bin', op: '*', a, b: unary() };
      else break;
    }
    return a;
  }
  function unary() {
    const t = peek();
    if (isOp(t, '-')) { p++; return { t: 'neg', a: unary() }; }
    if (isOp(t, '+')) { p++; return unary(); }
    return power();
  }
  function power() {
    let a = atom();
    while (isOp(peek(), '^')) { p++; a = { t: 'bin', op: '^', a, b: exponent() }; }
    return a;
  }
  function exponent() {
    const t = peek();
    if (isOp(t, '-')) { p++; return { t: 'neg', a: exponent() }; }
    if (isOp(t, '+')) { p++; return exponent(); }
    return atom();
  }
  function atom() {
    const t = tokens[p++];
    if (!t) fail(null);
    switch (t.type) {
      case 'num': return { t: 'num', v: t.v };
      case 'const': return { t: 'num', v: t.v };
      case 'var': return { t: 'var', name: t.name };
      case 'func': {
        const lp = tokens[p++];
        if (!lp || lp.type !== 'lp') fail(lp);
        const a = rel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp);
        return { t: 'fn', f: t.name, a };
      }
      case 'lp': {
        const a = rel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp);
        return a;
      }
      default: fail(t);
    }
    return null;
  }
  const ast = rel();
  if (p < tokens.length) fail(tokens[p]);
  return ast;
}

function gen(n, names) {
  switch (n.t) {
    case 'num': return `(${n.v})`;
    case 'var': return `v${names.indexOf(n.name)}`;
    case 'neg': return `(-${gen(n.a, names)})`;
    case 'fn': return `R.${n.f}(${gen(n.a, names)})`;
    case 'rel': return `((${gen(n.a, names)})${n.op === '==' ? '===' : n.op === '!=' ? '!==' : n.op}(${gen(n.b, names)})?1:0)`;
    case 'bin':
      if (n.op === '^') return `R.pow(${gen(n.a, names)},${gen(n.b, names)})`;
      return `(${gen(n.a, names)}${n.op}${gen(n.b, names)})`;
    default: throw new ParseError('Internal error.');
  }
}

function usesVar(n, name) {
  if (!n) return false;
  if (n.t === 'var') return n.name === name;
  return usesVar(n.a, name) || usesVar(n.b, name);
}

/**
 * Compile an expression in the given variables, e.g. compile('x^2-y', ['x','y']).
 * Returns a function taking the variables positionally; non-finite results become NaN.
 * Throws ParseError on syntax errors.
 */
export function compile(src, names = ['x']) {
  const ast = parse(src, names);
  const args = names.map((_, i) => `v${i}`);
  // eslint-disable-next-line no-new-func
  const raw = new Function('R', ...args, `return ${gen(ast, names)};`);
  const fn = (...v) => {
    const r = raw(RUNTIME, ...v);
    return Number.isFinite(r) ? r : NaN;
  };
  fn.ast = ast;
  fn.src = String(src).trim();
  fn.uses = (name) => usesVar(ast, name);
  return fn;
}

/** Like compile but returns null instead of throwing. */
export function tryCompile(src, names = ['x']) {
  try { return compile(src, names); } catch { return null; }
}

// ------------------------------------------------------------------ Taylor jets
// A jet of order N is an array c[0..N] of Taylor coefficients (c_k = f^(k)(a)/k!).

const jconst = (v, N) => { const r = new Array(N + 1).fill(0); r[0] = v; return r; };
const isConst = (a) => a.every((v, i) => i === 0 || v === 0);
function jmul(a, b) {
  const N = a.length - 1;
  const r = new Array(N + 1).fill(0);
  for (let k = 0; k <= N; k++) { let s = 0; for (let j = 0; j <= k; j++) s += a[j] * b[k - j]; r[k] = s; }
  return r;
}
function jdiv(a, b) {
  const N = a.length - 1;
  const r = new Array(N + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    let s = a[k];
    for (let j = 1; j <= k; j++) s -= b[j] * r[k - j];
    r[k] = s / b[0];
  }
  return r;
}
function jexp(a) {
  const N = a.length - 1;
  const r = new Array(N + 1).fill(0);
  r[0] = Math.exp(a[0]);
  for (let k = 1; k <= N; k++) { let s = 0; for (let j = 1; j <= k; j++) s += j * a[j] * r[k - j]; r[k] = s / k; }
  return r;
}
function jlog(a) {
  const N = a.length - 1;
  const r = new Array(N + 1).fill(0);
  r[0] = Math.log(a[0]);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j < k; j++) s += j * r[j] * a[k - j];
    r[k] = (a[k] - s / k) / a[0];
  }
  return r;
}
function jsincos(a) {
  const N = a.length - 1;
  const s = new Array(N + 1).fill(0), c = new Array(N + 1).fill(0);
  s[0] = Math.sin(a[0]); c[0] = Math.cos(a[0]);
  for (let k = 1; k <= N; k++) {
    let ss = 0, cc = 0;
    for (let j = 1; j <= k; j++) { ss += j * a[j] * c[k - j]; cc += j * a[j] * s[k - j]; }
    s[k] = ss / k; c[k] = -cc / k;
  }
  return [s, c];
}
function jpowc(a, r) { // a^r, r constant
  const N = a.length - 1;
  if (Number.isInteger(r) && r >= 0 && r <= 64) {
    let res = jconst(1, N), base = a.slice(), e = r;
    while (e > 0) { if (e & 1) res = jmul(res, base); base = jmul(base, base); e >>= 1; }
    return res;
  }
  if (Number.isInteger(r) && r < 0 && r >= -64) return jdiv(jconst(1, N), jpowc(a, -r));
  const out = new Array(N + 1).fill(0);
  out[0] = pow(a[0], r);
  for (let k = 1; k <= N; k++) {
    let s = 0;
    for (let j = 1; j <= k; j++) s += ((r + 1) * j - k) * a[j] * out[k - j];
    out[k] = s / (k * a[0]);
  }
  return out;
}
function jderiv(a) { const N = a.length - 1; const r = new Array(N + 1).fill(0); for (let k = 0; k < N; k++) r[k] = (k + 1) * a[k + 1]; return r; }
function jinteg(d, c0) { const N = d.length - 1; const r = new Array(N + 1).fill(0); r[0] = c0; for (let k = 1; k <= N; k++) r[k] = d[k - 1] / k; return r; }
const jadd = (a, b) => a.map((v, i) => v + b[i]);
const jsub = (a, b) => a.map((v, i) => v - b[i]);
const jscale = (a, s) => a.map((v) => v * s);

function jfn(f, a) {
  const N = a.length - 1;
  const one = jconst(1, N);
  switch (f) {
    case 'exp': return jexp(a);
    case 'log': case 'ln': return jlog(a);
    case 'log10': return jscale(jlog(a), 1 / Math.LN10);
    case 'sin': return jsincos(a)[0];
    case 'cos': return jsincos(a)[1];
    case 'tan': { const [s, c] = jsincos(a); return jdiv(s, c); }
    case 'cot': { const [s, c] = jsincos(a); return jdiv(c, s); }
    case 'sec': return jdiv(one, jsincos(a)[1]);
    case 'csc': return jdiv(one, jsincos(a)[0]);
    case 'sinh': { const e = jexp(a), m = jexp(jscale(a, -1)); return jscale(jsub(e, m), 0.5); }
    case 'cosh': { const e = jexp(a), m = jexp(jscale(a, -1)); return jscale(jadd(e, m), 0.5); }
    case 'tanh': { const e = jexp(a), m = jexp(jscale(a, -1)); return jdiv(jsub(e, m), jadd(e, m)); }
    case 'sqrt': return jpowc(a, 0.5);
    case 'abs': return a[0] < 0 ? jscale(a, -1) : a.slice();
    case 'atan': case 'arctan': return jinteg(jdiv(jderiv(a), jadd(one, jmul(a, a))), Math.atan(a[0]));
    case 'asin': return jinteg(jdiv(jderiv(a), jpowc(jsub(one, jmul(a, a)), 0.5)), Math.asin(a[0]));
    case 'acos': return jinteg(jscale(jdiv(jderiv(a), jpowc(jsub(one, jmul(a, a)), 0.5)), -1), Math.acos(a[0]));
    case 'asinh': return jinteg(jdiv(jderiv(a), jpowc(jadd(one, jmul(a, a)), 0.5)), Math.asinh(a[0]));
    case 'acosh': return jinteg(jdiv(jderiv(a), jpowc(jsub(jmul(a, a), one), 0.5)), Math.acosh(a[0]));
    case 'atanh': return jinteg(jdiv(jderiv(a), jsub(one, jmul(a, a))), Math.atanh(a[0]));
    default: return jconst(FUNCTIONS[f](a[0]), N); // piecewise constant functions
  }
}

function jeval(n, name, a, N) {
  switch (n.t) {
    case 'num': return jconst(n.v, N);
    case 'var': { if (n.name !== name) return jconst(NaN, N); const r = jconst(a, N); if (N >= 1) r[1] = 1; return r; }
    case 'neg': return jscale(jeval(n.a, name, a, N), -1);
    case 'fn': return jfn(n.f, jeval(n.a, name, a, N));
    case 'rel': {
      const x = jeval(n.a, name, a, N)[0], y = jeval(n.b, name, a, N)[0];
      const ops = { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y, '==': x === y, '!=': x !== y };
      return jconst(ops[n.op] ? 1 : 0, N);
    }
    case 'bin': {
      const A = jeval(n.a, name, a, N), B = jeval(n.b, name, a, N);
      switch (n.op) {
        case '+': return jadd(A, B);
        case '-': return jsub(A, B);
        case '*': return jmul(A, B);
        case '/': return jdiv(A, B);
        case '^':
          if (isConst(B)) {
            if (A[0] === Math.E && isConst(A)) return jexp(B);
            return jpowc(A, B[0]);
          }
          return jexp(jmul(B, jlog(A)));
        default: break;
      }
    }
    // falls through
    default: throw new ParseError('Internal error.');
  }
}

/** Taylor coefficients c_0..c_N of a compiled function (single variable `name`) about x = a. */
export function taylorCoeffs(fn, a, N, name = 'x') {
  return jeval(fn.ast, name, a, N).map((v) => (Number.isFinite(v) ? v : NaN));
}

export const SYNTAX_HELP = `Operators: + - * / ^ ( ), implicit multiplication (2x, 3sin(x), (x+1)(x-1)).
Constants: pi, e.  Comparisons < <= > >= == != give 1 or 0, e.g. (x>0)*x.
Functions: sin cos tan cot sec csc, asin acos atan, sinh cosh tanh, asinh acosh atanh,
exp log (= ln) log10 sqrt abs sign floor ceil round, u(t) = step(t) = heaviside(t).
Powers of negative numbers: x^(1/3) is the real cube root, x^(2/3) ≥ 0, x^0.5 is undefined for x < 0.
Examples: x^2 - 1,  exp(-x)sin(3x),  abs(x),  (abs(x) < 1),  u(t) - u(t-1).`;
