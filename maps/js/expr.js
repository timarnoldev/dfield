// Expression parser with symbolic differentiation for the iterated maps lab.
// Syntax follows the DFIELD parser (adapted from dfield/js/parser.js):
// implicit multiplication (rx(1-x), 2pi x, 5sin(x)), unary minus binding weaker
// than ^ (-x^2 = -(x^2)), left-associative ^, relational operators returning
// 1/0, constants e and pi. Additional multi-argument functions:
// min(a,b), max(a,b), mod(a,b) (result in [0,b) for b>0), and floor, ceil, frac.
//
// parse() builds an AST, diff() differentiates it symbolically, and the
// compile helpers generate fast JS closures that read parameters from a shared
// Float64Array, so callers can sweep a parameter by writing P[i].

export class ParseError extends Error {}

const F1 = {
  abs: 'Math.abs', acosh: 'Math.acosh', asinh: 'Math.asinh', atanh: 'Math.atanh',
  acos: 'Math.acos', acot: 'R.acot', acsc: 'R.acsc', asec: 'R.asec', asin: 'Math.asin',
  atan: 'Math.atan', cosh: 'Math.cosh', cos: 'Math.cos', cot: 'R.cot', csc: 'R.csc',
  exp: 'Math.exp', log10: 'Math.log10', log: 'Math.log', ln: 'Math.log', sec: 'R.sec',
  sinh: 'Math.sinh', sin: 'Math.sin', sign: 'Math.sign', sqrt: 'Math.sqrt', tanh: 'Math.tanh',
  tan: 'Math.tan', floor: 'Math.floor', ceil: 'Math.ceil', frac: 'R.frac',
};
const F2 = { min: 'Math.min', max: 'Math.max', mod: 'R.mod', atan2: 'Math.atan2' };
const FUNCTION_NAMES = [...Object.keys(F1), ...Object.keys(F2)].sort((a, b) => b.length - a.length);
export const RESERVED = new Set([...FUNCTION_NAMES, 'e', 'pi']);

// DFIELD power semantics: x^2 = x*x, e^x = exp(x), negative bases with
// non-integer exponents give -(|a|^b) (so x^(1/3) is the real cube root).
function pow(a, b) {
  if (b === 2) return a * a;
  if (a === Math.E) return Math.exp(b);
  if (a > 0) return Math.pow(a, b);
  if (b === 0) return 1;
  if (Math.ceil(b) === b) return Math.pow(a, b);
  return -Math.pow(Math.abs(a), b);
}
export const RUNTIME = {
  pow,
  acot: (v) => Math.PI / 2 - Math.atan(v),
  acsc: (v) => Math.asin(1 / v),
  asec: (v) => Math.acos(1 / v),
  cot: (v) => 1 / Math.tan(v),
  csc: (v) => 1 / Math.sin(v),
  sec: (v) => 1 / Math.cos(v),
  frac: (v) => v - Math.floor(v),
  mod: (a, b) => a - b * Math.floor(a / b),
};

const RELOPS = ['<=', '>=', '==', '<>', '!=', '<', '>'];

function tokenize(src, names) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  const isDigit = (c) => c >= '0' && c <= '9';
  const sorted = names.filter(Boolean).slice().sort((a, b) => b.length - a.length);
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i;
      while (j < n && (isDigit(src[j]) || src[j] === '.')) j++;
      // scientific notation 1e-6 / 2.5E3
      if (j < n && (src[j] === 'e' || src[j] === 'E') && /^[eE][+-]?\d/.test(src.slice(j, j + 3))) {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && isDigit(src[j])) j++;
      }
      const text = src.slice(i, j);
      const v = Number(text);
      if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) || Number.isNaN(v)) {
        throw new ParseError(`'${text}': illegal number.`);
      }
      tokens.push({ type: 'num', v, pos: i });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) { tokens.push({ type: 'op', op: c, pos: i }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lp', pos: i }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rp', pos: i }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma', pos: i }); i++; continue; }
    if ('<>=!'.includes(c)) {
      const op = RELOPS.find((r) => src.startsWith(r, i));
      if (!op) throw new ParseError(`'${src.slice(0, i + 1)}': bad operator.`);
      tokens.push({ type: 'op', op: op === '<>' ? '!=' : op, pos: i });
      i += op.length;
      continue;
    }
    if (isAlpha(c)) {
      const rest = src.slice(i);
      const fn = FUNCTION_NAMES.find((f) => rest.toLowerCase().startsWith(f) && /^\s*\(/.test(rest.slice(f.length)));
      if (fn) { tokens.push({ type: 'func', name: fn, pos: i }); i += fn.length; continue; }
      const nm = sorted.find((v) => src.startsWith(v, i));
      if (nm) { tokens.push({ type: 'var', name: nm, pos: i }); i += nm.length; continue; }
      if (src.startsWith('pi', i)) { tokens.push({ type: 'num', v: Math.PI, pos: i }); i += 2; continue; }
      if (c === 'e') { tokens.push({ type: 'num', v: Math.E, pos: i }); i++; continue; }
      // report the whole word (e.g. 'eps', not 'ps' after the constant e)
      let a = i;
      while (a > 0 && isAlpha(src[a - 1])) a--;
      let j = i + 1;
      while (j < n && (isAlpha(src[j]) || isDigit(src[j]))) j++;
      const word = src.slice(a, j);
      throw new ParseError(`'${word}': unknown function or variable${/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(word) ? ` – add '${word}' as a parameter?` : '.'}`);
    }
    throw new ParseError(`'${c}': unrecognized character.`);
  }
  return tokens;
}

// ---------------------------------------------------------------- AST
const num = (v) => ({ t: 'num', v });
const isNum = (a, v) => a.t === 'num' && (v === undefined || a.v === v);
function bin(op, a, b) {
  // light simplification
  if (a.t === 'num' && b.t === 'num' && op !== '^') {
    switch (op) {
      case '+': return num(a.v + b.v);
      case '-': return num(a.v - b.v);
      case '*': return num(a.v * b.v);
      case '/': if (b.v !== 0) return num(a.v / b.v); break;
      default: break;
    }
  }
  if (op === '+') { if (isNum(a, 0)) return b; if (isNum(b, 0)) return a; }
  if (op === '-') { if (isNum(b, 0)) return a; if (isNum(a, 0)) return neg(b); }
  if (op === '*') {
    if (isNum(a, 0) || isNum(b, 0)) return num(0);
    if (isNum(a, 1)) return b;
    if (isNum(b, 1)) return a;
    if (isNum(a, -1)) return neg(b);
    if (isNum(b, -1)) return neg(a);
  }
  if (op === '/') { if (isNum(a, 0)) return num(0); if (isNum(b, 1)) return a; }
  if (op === '^') { if (isNum(b, 1)) return a; if (isNum(b, 0)) return num(1); }
  return { t: 'bin', op, a, b };
}
function neg(a) {
  if (a.t === 'num') return num(-a.v);
  if (a.t === 'neg') return a.a;
  return { t: 'neg', a };
}
const call = (f, ...args) => ({ t: 'call', f, args });
const cond = (c, a, b) => ({ t: 'if', c, a, b });

/** Parse src into an AST. names: allowed identifiers (variables + parameters). */
export function parse(src, names) {
  src = String(src).trim();
  if (!src) throw new ParseError('Empty expression.');
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth < 0) throw new ParseError(`'${src.slice(0, i + 1)}': mismatched parentheses.`);
  }
  if (depth) throw new ParseError('Mismatched parentheses: missing ")".');
  const tokens = tokenize(src, names);
  let p = 0;
  const peek = () => tokens[p];
  const fail = (tok) => {
    const pos = tok ? tok.pos : src.length - 1;
    throw new ParseError(`'${src.slice(0, pos + 1)}': ${tok ? 'syntax error.' : 'incomplete expression.'}`);
  };
  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'var' || t.type === 'func' || t.type === 'lp');

  function parseRel() {
    let left = parseAdd();
    while (peek() && peek().type === 'op' && RELOPS.includes(peek().op)) {
      const op = tokens[p++].op;
      left = { t: 'rel', op, a: left, b: parseAdd() };
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (peek() && peek().type === 'op' && (peek().op === '+' || peek().op === '-')) {
      const op = tokens[p++].op;
      left = { t: 'bin', op, a: left, b: parseMul() };
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.op === '*' || t.op === '/')) {
        p++;
        left = { t: 'bin', op: t.op, a: left, b: parseUnary() };
      } else if (startsAtom(t)) {
        left = { t: 'bin', op: '*', a: left, b: parseUnary() };
      } else break;
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t && t.type === 'op' && t.op === '-') { p++; return { t: 'neg', a: parseUnary() }; }
    if (t && t.type === 'op' && t.op === '+') { p++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    let base = parseAtom();
    while (peek() && peek().type === 'op' && peek().op === '^') {
      p++;
      base = { t: 'bin', op: '^', a: base, b: parseExponent() };
    }
    return base;
  }
  function parseExponent() {
    const t = peek();
    if (t && t.type === 'op' && t.op === '-') { p++; return { t: 'neg', a: parseExponent() }; }
    if (t && t.type === 'op' && t.op === '+') { p++; return parseExponent(); }
    return parseAtom();
  }
  function parseAtom() {
    const t = tokens[p++];
    if (!t) fail(null);
    switch (t.type) {
      case 'num': return num(t.v);
      case 'var': return { t: 'var', name: t.name };
      case 'func': {
        const lp = tokens[p++];
        if (!lp || lp.type !== 'lp') fail(lp);
        const args = [parseRel()];
        while (peek() && peek().type === 'comma') { p++; args.push(parseRel()); }
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp);
        const want = F2[t.name] ? 2 : 1;
        if (args.length !== want) throw new ParseError(`${t.name}() takes ${want} argument${want > 1 ? 's' : ''}.`);
        return { t: 'call', f: t.name, args };
      }
      case 'lp': {
        const inner = parseRel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp);
        return inner;
      }
      default:
        return fail(t);
    }
  }
  const ast = parseRel();
  if (p < tokens.length) fail(tokens[p]);
  return ast;
}

/** True if the AST references variable v. */
export function uses(ast, v) {
  switch (ast.t) {
    case 'num': return false;
    case 'var': return ast.name === v;
    case 'neg': return uses(ast.a, v);
    case 'bin': case 'rel': return uses(ast.a, v) || uses(ast.b, v);
    case 'call': return ast.args.some((a) => uses(a, v));
    case 'if': return uses(ast.c, v) || uses(ast.a, v) || uses(ast.b, v);
    default: return false;
  }
}

/** Symbolic derivative d(ast)/dv. */
export function diff(ast, v) {
  if (!uses(ast, v)) return num(0);
  const d = (a) => diff(a, v);
  switch (ast.t) {
    case 'var': return num(1);
    case 'neg': return neg(d(ast.a));
    case 'rel': return num(0);
    case 'if': return cond(ast.c, d(ast.a), d(ast.b));
    case 'bin': {
      const { a, b, op } = ast;
      if (op === '+' || op === '-') return bin(op, d(a), d(b));
      if (op === '*') return bin('+', bin('*', d(a), b), bin('*', a, d(b)));
      if (op === '/') {
        if (!uses(b, v)) return bin('/', d(a), b);
        return bin('/', bin('-', bin('*', d(a), b), bin('*', a, d(b))), bin('^', b, num(2)));
      }
      // power
      if (!uses(b, v)) {
        if (b.t === 'num') return bin('*', bin('*', num(b.v), bin('^', a, num(b.v - 1))), d(a));
        return bin('*', bin('*', b, bin('^', a, bin('-', b, num(1)))), d(a));
      }
      if (!uses(a, v)) {
        const lnA = isNum(a, Math.E) ? num(1) : call('log', a);
        return bin('*', bin('*', ast, lnA), d(b));
      }
      // u^w = exp(w ln u): (u^w) (w' ln u + w u'/u)
      return bin('*', ast, bin('+', bin('*', d(b), call('log', a)), bin('/', bin('*', b, d(a)), a)));
    }
    case 'call': {
      const [u, w] = ast.args;
      const du = d(u);
      const sq = (x) => bin('^', x, num(2));
      const chain = (g) => bin('*', g, du);
      switch (ast.f) {
        case 'sin': return chain(call('cos', u));
        case 'cos': return chain(neg(call('sin', u)));
        case 'tan': return chain(bin('+', num(1), sq(call('tan', u))));
        case 'cot': return chain(neg(bin('+', num(1), sq(call('cot', u)))));
        case 'sec': return chain(bin('*', call('sec', u), call('tan', u)));
        case 'csc': return chain(neg(bin('*', call('csc', u), call('cot', u))));
        case 'exp': return chain(call('exp', u));
        case 'log': case 'ln': return bin('/', du, u);
        case 'log10': return bin('/', du, bin('*', u, num(Math.LN10)));
        case 'sqrt': return bin('/', du, bin('*', num(2), call('sqrt', u)));
        case 'abs': return chain(call('sign', u));
        case 'sign': case 'floor': case 'ceil': return num(0);
        case 'frac': return du;
        case 'sinh': return chain(call('cosh', u));
        case 'cosh': return chain(call('sinh', u));
        case 'tanh': return chain(bin('-', num(1), sq(call('tanh', u))));
        case 'asin': return bin('/', du, call('sqrt', bin('-', num(1), sq(u))));
        case 'acos': return neg(bin('/', du, call('sqrt', bin('-', num(1), sq(u)))));
        case 'atan': return bin('/', du, bin('+', num(1), sq(u)));
        case 'acot': return neg(bin('/', du, bin('+', num(1), sq(u))));
        case 'asinh': return bin('/', du, call('sqrt', bin('+', sq(u), num(1))));
        case 'acosh': return bin('/', du, call('sqrt', bin('-', sq(u), num(1))));
        case 'atanh': return bin('/', du, bin('-', num(1), sq(u)));
        case 'asec': return bin('/', du, bin('*', call('abs', u), call('sqrt', bin('-', sq(u), num(1)))));
        case 'acsc': return neg(bin('/', du, bin('*', call('abs', u), call('sqrt', bin('-', sq(u), num(1))))));
        case 'min': return cond({ t: 'rel', op: '<=', a: u, b: w }, du, d(w));
        case 'max': return cond({ t: 'rel', op: '>=', a: u, b: w }, du, d(w));
        case 'mod': return bin('-', du, bin('*', d(w), call('floor', bin('/', u, w))));
        case 'atan2': // atan2(u, w): (w u' - u w') / (u^2 + w^2)
          return bin('/', bin('-', bin('*', w, du), bin('*', u, d(w))), bin('+', sq(u), sq(w)));
        default: throw new ParseError(`Cannot differentiate ${ast.f}().`);
      }
    }
    default: return num(0);
  }
}

/** JS source for an AST. vars maps identifier -> JS expression. */
export function toJS(ast, vars) {
  const g = (a) => toJS(a, vars);
  switch (ast.t) {
    case 'num': return ast.v < 0 ? `(${ast.v})` : String(ast.v);
    case 'var': return vars[ast.name] ?? '0';
    case 'neg': return `(-${g(ast.a)})`;
    case 'rel': return `((${g(ast.a)})${ast.op === '==' ? '===' : ast.op === '!=' ? '!==' : ast.op}(${g(ast.b)})?1:0)`;
    case 'if': return `((${g(ast.c)})?(${g(ast.a)}):(${g(ast.b)}))`;
    case 'bin':
      if (ast.op === '^') {
        if (ast.b.t === 'num' && ast.b.v === 2) { const s = g(ast.a); return /^[\w.]+$/.test(s) ? `(${s}*${s})` : `R.pow(${s},2)`; }
        return `R.pow(${g(ast.a)},${g(ast.b)})`;
      }
      return `(${g(ast.a)}${ast.op}${g(ast.b)})`;
    case 'call': {
      const fn = F1[ast.f] || F2[ast.f];
      return `${fn}(${ast.args.map(g).join(',')})`;
    }
    default: return 'NaN';
  }
}

/** Pretty-printer (used for titles). */
export function toText(ast) {
  const prec = (a) => (a.t === 'bin' ? { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 }[a.op] : a.t === 'neg' ? 3 : a.t === 'rel' ? 0 : 5);
  const wrap = (a, p) => (prec(a) < p ? `(${toText(a)})` : toText(a));
  switch (ast.t) {
    case 'num': return Math.abs(ast.v - Math.PI) < 1e-15 ? 'pi' : String(+ast.v.toPrecision(12));
    case 'var': return ast.name;
    case 'neg': return `-${wrap(ast.a, 3)}`;
    case 'rel': return `${toText(ast.a)} ${ast.op} ${toText(ast.b)}`;
    case 'if': return `(${toText(ast.c)} ? ${toText(ast.a)} : ${toText(ast.b)})`;
    case 'bin': {
      const p = prec(ast);
      if (ast.op === '^') return `${wrap(ast.a, 5)}^${wrap(ast.b, 5)}`;
      return `${wrap(ast.a, p)} ${ast.op} ${wrap(ast.b, ast.op === '-' || ast.op === '/' ? p + 1 : p)}`;
    }
    case 'call': return `${ast.f}(${ast.args.map(toText).join(', ')})`;
    default: return '?';
  }
}

/** Valid parameter name: letter followed by letters/digits, max 8 chars, not reserved. */
export function isValidName(s) {
  return /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(s) && !RESERVED.has(s.toLowerCase()) && s !== 'x' && s !== 'y' && s !== 'n';
}

function checkNames(paramNames) {
  const seen = new Set();
  paramNames.forEach((nm) => {
    if (!isValidName(nm)) throw new ParseError(`'${nm}': illegal parameter name.`);
    if (seen.has(nm)) throw new ParseError(`'${nm}': duplicate parameter name.`);
    seen.add(nm);
  });
}

function varMap(paramNames, extra) {
  const m = { ...extra };
  paramNames.forEach((nm, i) => { m[nm] = `P[${i}]`; });
  return m;
}

const make = (args, body, P) => new Function('R', 'P', `"use strict";return function(${args}){${body}};`)(RUNTIME, P); // eslint-disable-line no-new-func

/**
 * Compile a 1D map x -> f(x; params).
 * Returns { f, df, lift, P, ast } where P is a Float64Array of parameter values
 * shared by all closures. If the expression is mod(u, 1) at top level, `lift`
 * is the lift u (used for rotation numbers), otherwise null.
 */
export function compileMap1D(src, paramNames, values = []) {
  checkNames(paramNames);
  const ast = parse(src, ['x', ...paramNames]);
  const P = new Float64Array(Math.max(1, paramNames.length));
  values.forEach((v, i) => { P[i] = v; });
  const vm = varMap(paramNames, { x: 'x' });
  const dast = diff(ast, 'x');
  const f = make('x', `return ${toJS(ast, vm)};`, P);
  const df = make('x', `return ${toJS(dast, vm)};`, P);
  let lift = null;
  if (ast.t === 'call' && ast.f === 'mod' && ast.args[1].t === 'num' && ast.args[1].v === 1) {
    lift = make('x', `return ${toJS(ast.args[0], vm)};`, P);
  }
  // derivative with respect to each parameter (used e.g. for continuation)
  return { f, df, lift, P, ast, dast, usesX: uses(ast, 'x') };
}

/**
 * Compile a 2D map (x, y) -> (fx, fy). F(x, y, out) writes the image into
 * out[0], out[1]; J(x, y, out) writes the Jacobian [fx_x, fx_y, fy_x, fy_y].
 */
export function compileMap2D(srcX, srcY, paramNames, values = []) {
  checkNames(paramNames);
  const names = ['x', 'y', ...paramNames];
  let ax, ay;
  try { ax = parse(srcX, names); } catch (e) { e.which = 'x'; throw e; }
  try { ay = parse(srcY, names); } catch (e) { e.which = 'y'; throw e; }
  const P = new Float64Array(Math.max(1, paramNames.length));
  values.forEach((v, i) => { P[i] = v; });
  const vm = varMap(paramNames, { x: 'x', y: 'y' });
  const F = make('x,y,o', `o[0]=${toJS(ax, vm)};o[1]=${toJS(ay, vm)};`, P);
  const J = make('x,y,o', `o[0]=${toJS(diff(ax, 'x'), vm)};o[1]=${toJS(diff(ax, 'y'), vm)};o[2]=${toJS(diff(ay, 'x'), vm)};o[3]=${toJS(diff(ay, 'y'), vm)};`, P);
  return { F, J, P };
}

/** Evaluate a constant expression (no variables), e.g. a parameter value "1+sqrt(6)". */
export function evalConst(src) {
  const ast = parse(src, []);
  const v = make('', `return ${toJS(ast, {})};`, null)();
  if (!Number.isFinite(v)) throw new ParseError(`'${src}': not a finite number.`);
  return v;
}
