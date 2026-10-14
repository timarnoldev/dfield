// Parser and compiler for a practical subset of XPP's .ode file format.
import { parseExpr, genCode, collectNames, evalConst, ExprError, RUNTIME, RESERVED } from './expr.js';

const KEYWORDS = {
  par: 'par', param: 'par', parameter: 'par', parameters: 'par', p: 'par',
  init: 'init', i: 'init',
  number: 'num', num: 'num', n: 'num',
  aux: 'aux',
  option: 'opt', options: 'opt', o: 'opt',
  global: 'unsupported', wiener: 'unsupported', w: 'unsupported', table: 'unsupported', markov: 'unsupported',
  special: 'unsupported', volterra: 'unsupported', g: 'unsupported',
  set: 'ignore', bdry: 'ignore', b: 'ignore', export: 'ignore',
};

const KNOWN_OPTS = new Set([
  'total', 'dt', 't0', 'trans', 'transient', 'xp', 'yp', 'zp', 'xlo', 'xhi', 'ylo', 'yhi', 'zlo', 'zhi',
  'meth', 'method', 'tol', 'atol', 'toler', 'bound', 'bounds', 'nout', 'njmp', 'maxstor', 'axes', 'view',
  'ntst', 'nmax', 'npr', 'ds', 'dsmin', 'dsmax', 'parmin', 'parmax', 'autoxmin', 'autoxmax', 'autoymin', 'autoymax',
  'bell', 'back', 'lt', 'xplot', 'yplot', 'zplot', 'nplot', 'output', 'logfile', 'maxstor', 'nmesh', 'dtmin', 'dtmax',
  'bandup', 'bandlo', 'phis', 'thetas', 'xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax', 'smc', 'colormap', 'seed',
  'newt_tol', 'newt_iter', 'jac_eps', 'epsl', 'epsu', 'epss', 'iad', 'nbound', 'fold', 'delay', 'mxplot', 'poimap',
  'poivar', 'poipln', 'poisgn', 'poistop', 'bif', 'autovar', 'parrange',
]);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Splits "a=1, b = 2 c=3" into [{name, value}] (values without spaces). */
function parseAssignList(rest) {
  const out = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\s,]+)\s*,?/y;
  let pos = 0;
  while (pos < rest.length) {
    if (/^[\s,]*$/.test(rest.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(rest);
    if (!m) return { error: `cannot parse '${rest.slice(pos).trim()}' (expected name=value)` };
    out.push({ name: m[1], value: m[2] });
    pos = re.lastIndex;
  }
  return { items: out };
}

/**
 * Parses .ode text. Returns a model description:
 * { vars, pars, nums, consts, fixed, aux, funcs, opts, title, errors:[{line,msg}], warnings:[{line,msg}] }
 */
export function parseOde(text) {
  const errors = [];
  const warnings = [];
  const m = { vars: [], pars: [], nums: [], consts: [], fixed: [], aux: [], funcs: [], inits: [], opts: {}, title: '', comments: [], errors, warnings };
  const decl = new Map(); // lname -> {kind, item, line}
  const err = (line, msg) => errors.push({ line, msg });
  const declare = (name, kind, item, line) => {
    if (!NAME_RE.test(name)) { err(line, `'${name}' is not a valid name`); return false; }
    const l = name.toLowerCase();
    if (RESERVED.has(l)) { err(line, `'${name}' is a reserved name`); return false; }
    if (decl.has(l)) { err(line, `'${name}' is already defined (line ${decl.get(l).line})`); return false; }
    decl.set(l, { kind, item, line });
    return true;
  };

  // iPad/macOS "smart punctuation" and pasted text: curly quotes, primes, unicode minus, NBSP.
  // All replacements keep the string length, so error positions stay valid.
  text = String(text)
    .replace(/[\u2018\u2019\u2032\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/[\u00D7\u22C5]/g, '*')
    .replace(/[\u00A0\u2009\u202F]/g, ' ');
  const raw = text.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    let s = raw[i];
    const ln = i + 1;
    while (/\\\s*$/.test(s) && i + 1 < raw.length) s = s.replace(/\\\s*$/, ' ') + raw[++i];
    lines.push({ s, ln });
  }

  let done = false;
  for (const { s, ln } of lines) {
    if (done) break;
    let L = s;
    if (/^\s*"/.test(L)) { m.comments.push(L.replace(/^\s*"\s?/, '')); continue; }
    const hash = L.indexOf('#');
    if (hash >= 0) {
      const c = L.slice(hash + 1).trim();
      if (c && !L.slice(0, hash).trim()) m.comments.push(c);
      L = L.slice(0, hash);
    }
    L = L.trim();
    if (!L) continue;
    const lower = L.toLowerCase();
    if (lower === 'done' || lower === 'd') { done = true; continue; }

    // derived constant
    let mm = /^!\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(L);
    if (mm) {
      const item = { name: mm[1], src: mm[2].trim(), line: ln };
      if (declare(item.name, 'const', item, ln)) m.consts.push(item);
      continue;
    }
    // options
    if (L[0] === '@') {
      const r = parseAssignList(L.slice(1));
      if (r.error) { err(ln, r.error); continue; }
      for (const { name, value } of r.items) {
        const k = name.toLowerCase();
        if (!KNOWN_OPTS.has(k)) warnings.push({ line: ln, msg: `unknown option '${name}' ignored` });
        m.opts[k] = { value, line: ln };
      }
      continue;
    }
    // unsupported XPP statements with non name=value syntax (global 1 x {x=0}, table f ..., wiener w)
    {
      const w0 = /^([A-Za-z]+)\s/.exec(L);
      if (w0 && KEYWORDS[w0[1].toLowerCase()] === 'unsupported' && !/^[A-Za-z]+\s*'?\s*=/.test(L)) {
        err(ln, `'${w0[1]}' statements are not supported in this web version`);
        continue;
      }
    }
    // keyword statements
    mm = /^([A-Za-z]+)\s+([A-Za-z_][A-Za-z0-9_]*\s*=.*)$/.exec(L);
    if (mm && !/^d[A-Za-z_]\w*\s*\//.test(L)) {
      const kw = KEYWORDS[mm[1].toLowerCase()];
      if (!kw) { err(ln, `unknown statement '${mm[1]}'`); continue; }
      if (kw === 'unsupported') { err(ln, `'${mm[1]}' statements are not supported in this web version`); continue; }
      if (kw === 'ignore') { warnings.push({ line: ln, msg: `'${mm[1]}' statement ignored` }); continue; }
      if (kw === 'aux') {
        const a = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(mm[2]);
        const item = { name: a[1], src: a[2].trim(), line: ln };
        if (declare(item.name, 'aux', item, ln)) m.aux.push(item);
        continue;
      }
      const r = parseAssignList(mm[2]);
      if (r.error) { err(ln, r.error); continue; }
      for (const { name, value } of r.items) {
        if (kw === 'opt') {
          const k = name.toLowerCase();
          if (!KNOWN_OPTS.has(k)) warnings.push({ line: ln, msg: `unknown option '${name}' ignored` });
          m.opts[k] = { value, line: ln };
        } else if (kw === 'init') {
          m.inits.push({ name, src: value, line: ln });
        } else {
          const item = { name, src: value, line: ln };
          if (declare(name, kw, item, ln)) (kw === 'par' ? m.pars : m.nums).push(item);
        }
      }
      continue;
    }
    // ODE
    mm = /^([A-Za-z_][A-Za-z0-9_]*)\s*'\s*=(.*)$/.exec(L) || /^d([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*dt\s*=(.*)$/i.exec(L);
    if (mm) {
      const item = { name: mm[1], src: mm[2].trim(), line: ln, init: 0 };
      if (declare(item.name, 'var', item, ln)) m.vars.push(item);
      continue;
    }
    // x(0)=value
    mm = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*0\s*\)\s*=(.*)$/.exec(L);
    if (mm) { m.inits.push({ name: mm[1], src: mm[2].trim(), line: ln }); continue; }
    // user function
    mm = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*=(.*)$/.exec(L);
    if (mm) {
      const args = mm[2].split(',').map((a) => a.trim()).filter(Boolean);
      const bad = args.find((a) => !NAME_RE.test(a));
      if (bad) { err(ln, `bad argument name '${bad}'`); continue; }
      if (args.length > 9) { err(ln, 'functions can have at most 9 arguments'); continue; }
      if (new Set(args.map((a) => a.toLowerCase())).size !== args.length) { err(ln, 'duplicate argument name'); continue; }
      const item = { name: mm[1], args, src: mm[3].trim(), line: ln };
      if (declare(item.name, 'func', item, ln)) m.funcs.push(item);
      continue;
    }
    // fixed (temporary) quantity
    mm = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(L);
    if (mm) {
      const item = { name: mm[1], src: mm[2].trim(), line: ln };
      if (declare(item.name, 'fixed', item, ln)) m.fixed.push(item);
      continue;
    }
    err(ln, `cannot understand this line: '${L.length > 40 ? L.slice(0, 40) + '…' : L}'`);
  }

  if (!m.vars.length && !errors.length) errors.push({ line: 0, msg: "no differential equations found (write e.g. x'=...)" });
  m.title = m.comments[0] || '';
  m.decl = decl;
  return m;
}

/**
 * Compiles a parsed model into a numerical system.
 * Returns { ok, errors, sys } where sys has
 *   n, vars[], pars[], aux[], P(Float64Array), C, y0, rhs(t,y,dy), auxf(t,y,out), updateConsts(), opts, title
 */
export function compileOde(text) {
  const m = parseOde(text);
  const errors = m.errors;
  const warnings = m.warnings;
  const err = (line, msg) => errors.push({ line, msg });
  const decl = m.decl;

  // numeric values of pars / nums
  const constEnv = {};
  const numVal = (item, what) => {
    try {
      const v = evalConst(item.src, constEnv);
      if (!Number.isFinite(v)) throw new ExprError('not a finite number');
      return v;
    } catch (e) {
      err(item.line, `${what} ${item.name}: ${e.message}`);
      return 0;
    }
  };
  for (const p of m.nums) { p.value = numVal(p, 'number'); constEnv[p.name.toLowerCase()] = p.value; }
  for (const p of m.pars) p.value = numVal(p, 'parameter');
  for (const it of m.inits) {
    const d = decl.get(it.name.toLowerCase());
    if (!d || d.kind !== 'var') { err(it.line, `initial value for '${it.name}', which is not a differential variable`); continue; }
    try {
      const v = evalConst(it.src, constEnv);
      if (!Number.isFinite(v)) throw new ExprError('not a finite number');
      d.item.init = v;
    } catch (e) { err(it.line, `init ${it.name}: ${e.message}`); }
  }

  const varIdx = new Map(m.vars.map((v, i) => [v.name.toLowerCase(), i]));
  const parIdx = new Map(m.pars.map((v, i) => [v.name.toLowerCase(), i]));
  // C holds numbers first, then derived constants
  const cIdx = new Map();
  m.nums.forEach((v, i) => cIdx.set(v.name.toLowerCase(), i));
  m.consts.forEach((v, i) => cIdx.set(v.name.toLowerCase(), m.nums.length + i));
  const fnIdx = new Map(m.funcs.map((f, i) => [f.name.toLowerCase(), i]));
  const fixIdx = new Map(m.fixed.map((f, i) => [f.name.toLowerCase(), i]));

  const parse = (item) => {
    try { return parseExpr(item.src); } catch (e) {
      err(item.line, `${item.name}: ${e.message}${e.pos >= 0 ? ` (at '${item.src.slice(e.pos, e.pos + 12)}')` : ''}`);
      return null;
    }
  };
  const callRes = (lname, nargs, node) => {
    if (!fnIdx.has(lname)) return null;
    const f = m.funcs[fnIdx.get(lname)];
    if (f.args.length !== nargs) throw new ExprError(`${f.name}() takes ${f.args.length} argument(s)`, node.pos);
    return `F${fnIdx.get(lname)}`;
  };
  const unknown = (node) => {
    const d = decl.get(node.lname);
    if (d && d.kind === 'aux') return new ExprError(`auxiliary quantity '${node.name}' cannot be used in formulas`, node.pos);
    if (d && d.kind === 'func') return new ExprError(`'${node.name}' is a function; call it with arguments`, node.pos);
    return new ExprError(`unknown name '${node.name}'`, node.pos);
  };
  const gen = (item, ast, resolve) => {
    try { return genCode(ast, resolve, callRes); } catch (e) {
      err(item.line, `${item.name}: ${e.message}`);
      return '0';
    }
  };

  // derived constants (may use pars, numbers and earlier constants)
  const constCode = [];
  m.consts.forEach((c, k) => {
    const ast = parse(c);
    if (!ast) return;
    const code = gen(c, ast, (l, node) => {
      if (parIdx.has(l)) return `P[${parIdx.get(l)}]`;
      if (cIdx.has(l)) {
        const j = cIdx.get(l);
        if (j >= m.nums.length + k) throw new ExprError(`constant '${node.name}' used before it is defined`, node.pos);
        return `C[${j}]`;
      }
      throw unknown(node);
    });
    constCode.push(`C[${m.nums.length + k}]=${code};`);
  });

  // user functions
  const fnCode = [];
  const fnCalls = [];
  m.funcs.forEach((f, k) => {
    const ast = parse(f);
    if (!ast) { fnCalls.push(new Set()); return; }
    const argIdx = new Map(f.args.map((a, i) => [a.toLowerCase(), i]));
    const code = gen(f, ast, (l, node) => {
      if (argIdx.has(l)) return `a${argIdx.get(l)}`;
      if (parIdx.has(l)) return `P[${parIdx.get(l)}]`;
      if (cIdx.has(l)) return `C[${cIdx.get(l)}]`;
      if (l === 't') throw new ExprError("functions cannot use 't' directly; pass it as an argument", node.pos);
      if (varIdx.has(l)) throw new ExprError(`functions cannot use variable '${node.name}' directly; pass it as an argument`, node.pos);
      throw unknown(node);
    });
    fnCalls.push(collectNames(ast).calls);
    fnCode.push(`function F${k}(${f.args.map((_, i) => `a${i}`).join(',')}){return ${code};}`);
  });
  // recursion check
  {
    const state = new Array(m.funcs.length).fill(0);
    const visit = (k) => {
      if (state[k] === 2) return false;
      if (state[k] === 1) return true;
      state[k] = 1;
      for (const c of fnCalls[k] || []) if (fnIdx.has(c) && visit(fnIdx.get(c))) return true;
      state[k] = 2;
      return false;
    };
    m.funcs.forEach((f, k) => { if (state[k] === 0 && visit(k)) err(f.line, `function '${f.name}' is recursive`); });
  }

  // fixed quantities, ODEs, aux: may use t, vars, pars, consts, funcs, fixed
  const fixedAst = m.fixed.map(parse);
  const odeRes = (l, node) => {
    if (l === 't') return 't';
    if (varIdx.has(l)) return `y[${varIdx.get(l)}]`;
    if (parIdx.has(l)) return `P[${parIdx.get(l)}]`;
    if (cIdx.has(l)) return `C[${cIdx.get(l)}]`;
    if (fixIdx.has(l)) return `w${fixIdx.get(l)}`;
    throw unknown(node);
  };
  // topological order of fixed quantities
  const fixOrder = [];
  {
    const st = new Array(m.fixed.length).fill(0);
    const visit = (k) => {
      if (st[k] === 2) return true;
      if (st[k] === 1) { err(m.fixed[k].line, `circular definition involving '${m.fixed[k].name}'`); return false; }
      st[k] = 1;
      if (fixedAst[k]) {
        for (const nm of collectNames(fixedAst[k]).names) if (fixIdx.has(nm) && !visit(fixIdx.get(nm))) return false;
      }
      st[k] = 2;
      fixOrder.push(k);
      return true;
    };
    for (let k = 0; k < m.fixed.length; k++) if (st[k] === 0 && !visit(k)) break;
  }
  const fixedCode = fixOrder.map((k) => (fixedAst[k] ? `const w${k}=${gen(m.fixed[k], fixedAst[k], odeRes)};` : '')).join('');
  const odeCode = m.vars.map((v, i) => {
    const ast = parse(v);
    return ast ? `dy[${i}]=${gen(v, ast, odeRes)};` : '';
  }).join('');
  const auxCode = m.aux.map((a, i) => {
    const ast = parse(a);
    return ast ? `out[${i}]=${gen(a, ast, odeRes)};` : '';
  }).join('');

  // options sanity
  const opts = {};
  for (const [k, { value, line }] of Object.entries(m.opts)) opts[k] = { value, line };

  if (errors.length) {
    errors.sort((a, b) => a.line - b.line);
    return { ok: false, errors, warnings, model: m };
  }

  const P = new Float64Array(m.pars.map((p) => p.value));
  const C = new Float64Array(m.nums.length + m.consts.length);
  m.nums.forEach((v, i) => { C[i] = v.value; });
  const body = `"use strict";
${fnCode.join('\n')}
function updateConsts(){${constCode.join('')}}
function rhs(t,y,dy){${fixedCode}${odeCode}}
function auxf(t,y,out){${m.aux.length ? fixedCode + auxCode : ''}}
return {rhs, auxf, updateConsts};`;
  let fns;
  try {
    // eslint-disable-next-line no-new-func
    fns = new Function('R', 'P', 'C', body)(RUNTIME, P, C);
  } catch (e) {
    return { ok: false, errors: [{ line: 0, msg: `internal compile error: ${e.message}` }], warnings, model: m };
  }
  fns.updateConsts();
  const sys = {
    n: m.vars.length,
    vars: m.vars.map((v) => v.name),
    pars: m.pars.map((p) => p.name),
    parDefaults: m.pars.map((p) => p.value),
    aux: m.aux.map((a) => a.name),
    y0: new Float64Array(m.vars.map((v) => v.init)),
    P, C,
    rhs: fns.rhs,
    auxf: fns.auxf,
    updateConsts: fns.updateConsts,
    setPar(i, v) { P[i] = v; fns.updateConsts(); },
    opts,
    title: m.title,
    nonAutonomous: /\bt\b/.test(fixedCode + odeCode),
    code: body,
  };
  // sanity check: evaluate once
  const dy = new Float64Array(sys.n);
  try { sys.rhs(0, sys.y0, dy); } catch (e) {
    return { ok: false, errors: [{ line: 0, msg: `evaluation error: ${e.message}` }], warnings, model: m };
  }
  return { ok: true, errors: [], warnings, model: m, sys };
}
