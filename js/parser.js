// Expression parser for DFIELD equations.
// Follows the syntax of the original Java DFIELD (Polking / Castellanos):
// implicit multiplication (5x, 5(x), (x)(t), 5sin(x), 5xt), unary minus binding
// weaker than ^ (-x^2 = -(x^2)), left-associative ^, logical operators that
// return 1/0, constants e and pi, and the special power rules of DFIELD.

const FUNCTIONS = {
  abs: Math.abs,
  acosh: (v) => Math.log(v + (v < 0 ? -1 : 1) * Math.sqrt(v * v - 1)),
  asinh: Math.asinh,
  atanh: Math.atanh,
  acos: Math.acos,
  acot: (v) => Math.PI / 2 - Math.atan(v),
  acsc: (v) => Math.asin(1 / v),
  asec: (v) => Math.acos(1 / v),
  asin: Math.asin,
  atan: Math.atan,
  cosh: Math.cosh,
  cos: Math.cos,
  cot: (v) => 1 / Math.tan(v),
  csc: (v) => 1 / Math.sin(v),
  exp: Math.exp,
  log10: Math.log10,
  log: Math.log,
  sec: (v) => 1 / Math.cos(v),
  sinh: Math.sinh,
  sin: Math.sin,
  sign: (v) => (v < 0 ? -1 : v > 0 ? 1 : 0),
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  tan: Math.tan,
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length);

// DFIELD power: x^2 is x*x, e^x is exp(x), negative bases with non-integer
// exponents give -(|t|^x) and 0^0 = 1.
function pow(a, b) {
  if (b === 2) return a * a;
  if (a === Math.E) return Math.exp(b);
  if (a > 0) return Math.pow(a, b);
  if (b === 0) return 1;
  if (Math.ceil(b) === b) return Math.pow(a, b);
  return -Math.pow(Math.abs(a), b);
}

const RUNTIME = { ...FUNCTIONS, pow };

export class ParseError extends Error {}

const RELOPS = ['<=', '>=', '==', '<>', '!=', '<', '>'];

function tokenize(src, names) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  const isDigit = (c) => c >= '0' && c <= '9';
  const sortedNames = names
    .map((name, idx) => ({ name, idx }))
    .filter((v) => v.name)
    .sort((a, b) => b.name.length - a.name.length);

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i;
      while (j < n && (isDigit(src[j]) || src[j] === '.')) j++;
      const text = src.slice(i, j);
      const v = Number(text);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(text) || Number.isNaN(v)) {
        throw new ParseError(`'${text}':  illegal Numeric Constant.`);
      }
      tokens.push({ type: 'num', v, pos: i });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) { tokens.push({ type: 'op', op: c, pos: i }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lp', pos: i }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rp', pos: i }); i++; continue; }
    if ('<>=!'.includes(c)) {
      const op = RELOPS.find((r) => src.startsWith(r, i));
      if (!op) throw new ParseError(`'${src.slice(0, i + 1)}':  Bad Operator Syntax.`);
      tokens.push({ type: 'op', op: op === '<>' ? '!=' : op, pos: i });
      i += op.length;
      continue;
    }
    if (isAlpha(c)) {
      const lower = src.slice(i).toLowerCase();
      const fn = FUNCTION_NAMES.find((f) => lower.startsWith(f) && /^\s*\(/.test(lower.slice(f.length)));
      if (fn) { tokens.push({ type: 'func', name: fn, pos: i }); i += fn.length; continue; }
      const nm = sortedNames.find((v) => src.startsWith(v.name, i));
      if (nm) { tokens.push({ type: 'var', idx: nm.idx, pos: i }); i += nm.name.length; continue; }
      if (c === 'e') { tokens.push({ type: 'const', v: Math.E, code: 'Math.E', pos: i }); i++; continue; }
      if (src.startsWith('pi', i)) { tokens.push({ type: 'const', v: Math.PI, code: 'Math.PI', pos: i }); i += 2; continue; }
      let j = i + 1;
      while (j < n && j < i + 8 && (isAlpha(src[j]) || isDigit(src[j]))) j++;
      throw new ParseError(`'${src.slice(i, j)}':  Unrecognized Function or Variable.`);
    }
    throw new ParseError(`'${c}':  Unrecognized Character.`);
  }
  return tokens;
}

function checkParens(src) {
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '(') stack.push(i);
    else if (src[i] === ')') {
      if (!stack.length) throw new ParseError(`'${src.slice(0, i + 1)}':  Mismatched Parentheses.`);
      stack.pop();
    }
  }
  if (stack.length) throw new ParseError(`'${src.slice(0, stack[stack.length - 1] + 1)}':  Mismatched Parentheses.`);
}

/**
 * Compile an expression.
 * names: array of identifiers; index 0 -> first argument (independent var),
 * index 1 -> second argument (dependent var), further entries are parameters
 * whose JS code is given in paramCode[idx - 2].
 * Returns { fn(t, x), usesVars, code }.
 */
export function compile(src, names, paramCode = []) {
  src = src.trim();
  if (!src) throw new ParseError('Empty expression.');
  checkParens(src);
  const tokens = tokenize(src, names);
  let p = 0;
  let usesVars = false;
  const peek = () => tokens[p];
  const fail = (tok) => {
    const pos = tok ? tok.pos : src.length - 1;
    throw new ParseError(`'${src.slice(0, pos + 1)}':  ${tok ? 'Bad Operator Syntax.' : 'Syntax Error.'}`);
  };
  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'var' || t.type === 'const' || t.type === 'func' || t.type === 'lp');

  function parseRel() {
    let left = parseAdd();
    while (peek() && peek().type === 'op' && RELOPS.includes(peek().op)) {
      const op = tokens[p++].op;
      const right = parseAdd();
      left = `((${left})${op}(${right})?1:0)`;
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (peek() && peek().type === 'op' && (peek().op === '+' || peek().op === '-')) {
      const op = tokens[p++].op;
      left = `(${left}${op}${parseMul()})`;
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.op === '*' || t.op === '/')) {
        p++;
        left = `(${left}${t.op}${parseUnary()})`;
      } else if (startsAtom(t)) {
        left = `(${left}*${parseUnary()})`;
      } else break;
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t && t.type === 'op' && t.op === '-') { p++; return `(-${parseUnary()})`; }
    if (t && t.type === 'op' && t.op === '+') { p++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    let base = parseAtom();
    while (peek() && peek().type === 'op' && peek().op === '^') {
      p++;
      base = `R.pow(${base},${parseExponent()})`;
    }
    return base;
  }
  function parseExponent() {
    const t = peek();
    if (t && t.type === 'op' && t.op === '-') { p++; return `(-${parseExponent()})`; }
    if (t && t.type === 'op' && t.op === '+') { p++; return parseExponent(); }
    return parseAtom();
  }
  function parseAtom() {
    const t = tokens[p++];
    if (!t) fail(null);
    switch (t.type) {
      case 'num': return `(${t.v})`;
      case 'const': return t.code;
      case 'var':
        if (t.idx === 0) { usesVars = true; return 't'; }
        if (t.idx === 1) { usesVars = true; return 'x'; }
        return `(${paramCode[t.idx - 2]})`;
      case 'func': {
        const lp = tokens[p++];
        if (!lp || lp.type !== 'lp') fail(lp);
        const arg = parseRel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp);
        return `R.${t.name}(${arg})`;
      }
      case 'lp': {
        const inner = parseRel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') fail(rp);
        return `(${inner})`;
      }
      default:
        fail(t);
    }
  }

  const code = parseRel();
  if (p < tokens.length) fail(tokens[p]);
  // eslint-disable-next-line no-new-func
  const raw = new Function('R', 't', 'x', `return ${code};`);
  const fn = (t, x) => {
    const v = raw(RUNTIME, t, x);
    return Number.isFinite(v) ? v : NaN;
  };
  return { fn, usesVars, code };
}

/** Variable / parameter names: 1-8 chars, start with a letter, alphanumeric. */
export function isValidName(s) {
  return /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(s);
}

export { pow as dfieldPow };
