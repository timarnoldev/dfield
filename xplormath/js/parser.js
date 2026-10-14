// Expression parser for user-defined objects (adapted from the DFIELD web port).
// Supports implicit multiplication (2u, 2sin(u), uv when u and v are names),
// ^ (right side may be negative: u^-2), unary minus binding weaker than ^
// (-u^2 = -(u^2)), comparison operators returning 1/0, constants e and pi.

const FUNCTIONS = {
  abs: Math.abs,
  acosh: Math.acosh,
  asinh: Math.asinh,
  atanh: Math.atanh,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  cbrt: Math.cbrt,
  ceil: Math.ceil,
  cosh: Math.cosh,
  cos: Math.cos,
  cot: (v) => 1 / Math.tan(v),
  csc: (v) => 1 / Math.sin(v),
  exp: Math.exp,
  floor: Math.floor,
  log10: Math.log10,
  log: Math.log,
  ln: Math.log,
  round: Math.round,
  sech: (v) => 1 / Math.cosh(v),
  sec: (v) => 1 / Math.cos(v),
  sinh: Math.sinh,
  sin: Math.sin,
  sign: Math.sign,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  tan: Math.tan,
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length);

function pow(a, b) {
  if (b === 2) return a * a;
  if (b === 3) return a * a * a;
  if (a < 0 && Math.round(b) !== b) {
    // real odd roots of negative numbers, e.g. (-8)^(1/3) = -2
    const inv = 1 / b;
    if (Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) return -Math.pow(-a, b);
  }
  return Math.pow(a, b);
}

const RUNTIME = { ...FUNCTIONS, pow };

export class ParseError extends Error {}

const RELOPS = ['<=', '>=', '==', '!=', '<', '>'];

function tokenize(src, names) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  const isDigit = (c) => c >= '0' && c <= '9';
  const sortedNames = names.map((name, idx) => ({ name, idx })).sort((a, b) => b.name.length - a.name.length);

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i;
      while (j < n && (isDigit(src[j]) || src[j] === '.')) j++;
      if ((src[j] === 'e' || src[j] === 'E') && /^[eE][+-]?\d/.test(src.slice(j))) {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && isDigit(src[j])) j++;
      }
      const text = src.slice(i, j);
      const v = Number(text);
      if (Number.isNaN(v)) throw new ParseError(`'${text}' is not a valid number.`);
      tokens.push({ type: 'num', v, pos: i });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) { tokens.push({ type: 'op', op: c, pos: i }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lp', pos: i }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rp', pos: i }); i++; continue; }
    if ('<>=!'.includes(c)) {
      const op = RELOPS.find((r) => src.startsWith(r, i));
      if (!op) throw new ParseError(`Bad operator near '${src.slice(i, i + 2)}'.`);
      tokens.push({ type: 'op', op, pos: i });
      i += op.length;
      continue;
    }
    if (isAlpha(c)) {
      const lower = src.slice(i).toLowerCase();
      const fn = FUNCTION_NAMES.find((f) => lower.startsWith(f) && /^\s*\(/.test(lower.slice(f.length)));
      if (fn) { tokens.push({ type: 'func', name: fn, pos: i }); i += fn.length; continue; }
      const nm = sortedNames.find((v) => src.startsWith(v.name, i));
      if (nm) { tokens.push({ type: 'var', idx: nm.idx, pos: i }); i += nm.name.length; continue; }
      if (src.startsWith('pi', i)) { tokens.push({ type: 'const', code: 'Math.PI', pos: i }); i += 2; continue; }
      if (c === 'e') { tokens.push({ type: 'const', code: 'Math.E', pos: i }); i++; continue; }
      let j = i + 1;
      while (j < n && (isAlpha(src[j]) || isDigit(src[j]))) j++;
      throw new ParseError(`Unknown function or variable '${src.slice(i, j)}'.`);
    }
    throw new ParseError(`Unexpected character '${c}'.`);
  }
  return tokens;
}

/**
 * Compile an expression in the given variable names.
 * Returns a function taking the variables positionally: fn(u, v, a, ...).
 */
export function compile(src, names) {
  src = String(src).trim();
  if (!src) throw new ParseError('Empty expression.');
  const tokens = tokenize(src, names);
  let p = 0;
  const peek = () => tokens[p];
  const fail = (tok) => {
    if (!tok) throw new ParseError('Unexpected end of expression.');
    throw new ParseError(`Syntax error near '${src.slice(tok.pos, tok.pos + 6)}'.`);
  };
  const startsAtom = (t) => t && (t.type === 'num' || t.type === 'var' || t.type === 'const' || t.type === 'func' || t.type === 'lp');

  function parseRel() {
    let left = parseAdd();
    while (peek() && peek().type === 'op' && RELOPS.includes(peek().op)) {
      const op = tokens[p++].op;
      const right = parseAdd();
      left = `((${left})${op === '==' ? '===' : op === '!=' ? '!==' : op}(${right})?1:0)`;
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
        left = `(${left}*${parsePow()})`;
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
    const base = parseAtom();
    if (peek() && peek().type === 'op' && peek().op === '^') {
      p++;
      return `R.pow(${base},${parseUnary()})`; // right associative
    }
    return base;
  }
  function parseAtom() {
    const t = tokens[p++];
    if (!t) fail(null);
    switch (t.type) {
      case 'num': return `(${t.v})`;
      case 'const': return t.code;
      case 'var': return `V${t.idx}`;
      case 'func': {
        const lp = tokens[p++];
        if (!lp || lp.type !== 'lp') fail(lp);
        const arg = parseRel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') throw new ParseError('Missing closing parenthesis.');
        return `R.${t.name}(${arg})`;
      }
      case 'lp': {
        const inner = parseRel();
        const rp = tokens[p++];
        if (!rp || rp.type !== 'rp') throw new ParseError('Missing closing parenthesis.');
        return `(${inner})`;
      }
      default:
        fail(t);
    }
    return '';
  }

  const code = parseRel();
  if (p < tokens.length) {
    if (tokens[p].type === 'rp') throw new ParseError('Unmatched closing parenthesis.');
    fail(tokens[p]);
  }
  const args = names.map((_, i) => `V${i}`);
  // eslint-disable-next-line no-new-func
  const raw = new Function('R', ...args, `return ${code};`);
  return (...a) => raw(RUNTIME, ...a);
}
