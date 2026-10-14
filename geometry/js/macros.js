// Builder helper (for examples / built-in macros) and macro recording / application.
import { Construction, TYPES, catOf } from './kernel.js';
import { replaceNames } from './expr.js';

const idOf = (x) => (typeof x === 'object' ? x.id : x);

/** Convenience API for constructing programmatically. */
export function builder(c) {
  const add = (type, parents, params = {}, extra = {}) => c.add({ type, parents: parents.map(idOf), params, ...extra });
  return {
    c,
    add,
    pt: (x, y, name, extra = {}) => add('free', [], { x, y }, { name, ...extra }),
    on: (path, t, name, extra = {}) => add('onobj', [path], { t }, { name, ...extra }),
    isect: (a, b, which = 0, name, extra = {}) => add('isect', [a, b], { which }, { name, ...extra }),
    mid: (a, b, name, extra = {}) => add('midpoint', b ? [a, b] : [a], {}, { name, ...extra }),
    seg: (a, b, name, extra = {}) => add('segment', [a, b], {}, { name, ...extra }),
    line: (a, b, name, extra = {}) => add('line', [a, b], {}, { name, ...extra }),
    ray: (a, b, name, extra = {}) => add('ray', [a, b], {}, { name, ...extra }),
    vec: (a, b, name, extra = {}) => add('vector', [a, b], {}, { name, ...extra }),
    perp: (p, l, extra = {}) => add('perp', [p, l], {}, extra),
    par: (p, l, extra = {}) => add('parallel', [p, l], {}, extra),
    bis: (a, b, extra = {}) => add('perpbis', b ? [a, b] : [a], {}, extra),
    abis: (a, b, cc, extra = {}) => add('anglebis', [a, b, cc], {}, extra),
    circle: (m, p, name, extra = {}) => add('circle', [m, p], {}, { name, ...extra }),
    circleR: (m, r, name, extra = {}) => add('circleR', [m], { r: String(r) }, { name, ...extra }),
    circle3: (a, b, cc, name, extra = {}) => add('circle3', [a, b, cc], {}, { name, ...extra }),
    arc3: (a, b, cc, name, extra = {}) => add('arc3', [a, b, cc], {}, { name, ...extra }),
    arc: (m, a, b, name, extra = {}) => add('arc', [m, a, b], {}, { name, ...extra }),
    poly: (pts, name, extra = {}) => add('polygon', pts, {}, { name, ...extra }),
    regpoly: (a, b, n, name, extra = {}) => add('regpoly', [a, b], { n }, { name, ...extra }),
    vertex: (poly, i, name, extra = {}) => add('polyvertex', [poly], { i }, { name, ...extra }),
    angle: (a, b, cc, name, extra = {}) => add('angle', [a, b, cc], {}, { name, ...extra }),
    dist: (a, b, extra = {}) => add('dist', [a, b], {}, extra),
    len: (s, extra = {}) => add('length', [s], {}, extra),
    area: (p, extra = {}) => add('area', [p], {}, extra),
    calc: (expr, x, y, extra = {}) => add('calc', [], { expr, x, y }, extra),
    text: (text, x, y, extra = {}) => add('text', [], { text, x, y }, extra),
    locus: (p, q, extra = {}) => add('locus', [p, q], {}, extra),
  };
}

// ------------------------------------------------------------------ macros
const REF = (k) => `⟦${k}⟧`; // ⟦k⟧ placeholder for names inside expressions

/**
 * Records a macro. Returns { macro } or { error }.
 * Given objects -> final objects; intermediate objects are stored as steps.
 */
export function defineMacro(c, inputIds, outputIds, name, desc = '') {
  if (!inputIds.length) return { error: 'noInputs' };
  if (!outputIds.length) return { error: 'noOutputs' };
  const inputs = new Set(inputIds);
  const need = new Set();
  const stack = [...outputIds];
  let freeDep = null;
  while (stack.length) {
    const id = stack.pop();
    if (inputs.has(id) || need.has(id)) continue;
    const o = c.get(id);
    need.add(id);
    const ps = c.allParents(o);
    if (!ps.length && o.type === 'free') freeDep = freeDep || o;
    stack.push(...ps);
  }
  if (freeDep) return { error: 'freeDep', obj: freeDep };
  for (const id of outputIds) if (inputs.has(id)) return { error: 'outputIsInput' };
  const steps = c.objects.filter((o) => need.has(o.id));
  const refOf = new Map();
  inputIds.forEach((id, i) => refOf.set(id, `i${i}`));
  steps.forEach((o, i) => refOf.set(o.id, `s${i}`));
  const outSet = new Set(outputIds);
  const mSteps = steps.map((o) => {
    const params = JSON.parse(JSON.stringify(o.params));
    const map = new Map();
    for (const d of o.deps) { const t = c.get(d); if (t && refOf.has(d)) map.set(t.name, REF(refOf.get(d))); }
    const sub = (src) => replaceNames(String(src), c.names(), map);
    for (const k of TYPES[o.type].exprs || []) if (params[k] !== undefined && typeof params[k] === 'string') params[k] = sub(params[k]);
    if (o.type === 'text') params.text = String(params.text).replace(/\{([^}]*)\}/g, (m, inner) => `{${sub(inner)}}`);
    for (const d of o.deps) if (!refOf.has(d)) return null;
    const st = { type: o.type, parents: o.parents.map((p) => refOf.get(p)), params, style: { ...o.style } };
    if (outSet.has(o.id)) { st.out = true; st.showLabel = o.showLabel; }
    if (o.showIf) st.showIf = sub(o.showIf);
    return st;
  });
  if (mSteps.includes(null)) return { error: 'badDeps' };
  return {
    macro: {
      name,
      desc,
      inputs: inputIds.map((id) => { const o = c.get(id); return { cat: catOf(c, o), name: o.name }; }),
      steps: mSteps,
    },
  };
}

/** Applies a macro to the given input ids. Returns created objects. */
export function applyMacro(c, macro, inputIds, addFn = (d) => c.add(d)) {
  const ids = new Map();
  inputIds.forEach((id, i) => ids.set(`i${i}`, id));
  const created = [];
  macro.steps.forEach((st, i) => {
    const sub = (src) => String(src).replace(/⟦([is]\d+)⟧/g, (m, k) => { const o = c.get(ids.get(k)); return o ? o.name : m; });
    const params = JSON.parse(JSON.stringify(st.params));
    for (const k of TYPES[st.type].exprs || []) if (typeof params[k] === 'string') params[k] = sub(params[k]);
    if (st.type === 'text') params.text = sub(params.text);
    const def = {
      type: st.type,
      parents: st.parents.map((r) => ids.get(r)),
      params,
      style: st.style,
      aux: !st.out,
      hidden: !st.out,
      showIf: st.showIf ? sub(st.showIf) : '',
    };
    if (st.out && st.showLabel !== undefined) def.showLabel = st.showLabel;
    const o = addFn(def);
    ids.set(`s${i}`, o.id);
    created.push(o);
  });
  return created;
}

// ------------------------------------------------------------------ built-in macros
function record(name, desc, nIn, build) {
  const c = new Construction();
  const B = builder(c);
  const ins = [];
  for (let i = 0; i < nIn; i++) ins.push(B.pt(Math.cos(i * 2.1) * 3 + i * 0.3, Math.sin(i * 2.1) * 3 - i * 0.2));
  const outs = build(B, ...ins);
  const r = defineMacro(c, ins.map((o) => o.id), outs.map((o) => o.id), name, desc);
  if (r.error) throw new Error(`Built-in macro ${name}: ${r.error}`);
  r.macro.builtin = true;
  return r.macro;
}

export function builtinMacros(STR) {
  const M = STR.macros;
  const circumcenter = (B, a, b, c) => B.isect(B.bis(a, b), B.bis(b, c));
  const centroid = (B, a, b, c) => B.isect(B.seg(a, B.mid(b, c)), B.seg(b, B.mid(a, c)));
  const orthocenter = (B, a, b, c) => B.isect(B.perp(a, B.line(b, c)), B.perp(b, B.line(a, c)));
  return [
    record(M.circumcenter, M.circumcenterD, 3, (B, a, b, c) => [circumcenter(B, a, b, c)]),
    record(M.circumcircle, M.circumcircleD, 3, (B, a, b, c) => [B.circle3(a, b, c)]),
    record(M.incenter, M.incenterD, 3, (B, a, b, c) => [B.isect(B.abis(b, a, c), B.abis(a, b, c))]),
    record(M.incircle, M.incircleD, 3, (B, a, b, c) => {
      const i = B.isect(B.abis(b, a, c), B.abis(a, b, c));
      const f = B.isect(B.perp(i, B.line(a, b)), B.line(a, b));
      return [B.circle(i, f)];
    }),
    record(M.centroid, M.centroidD, 3, (B, a, b, c) => [centroid(B, a, b, c)]),
    record(M.orthocenter, M.orthocenterD, 3, (B, a, b, c) => [orthocenter(B, a, b, c)]),
    record(M.euler, M.eulerD, 3, (B, a, b, c) => [B.line(circumcenter(B, a, b, c), centroid(B, a, b, c), undefined, { style: { color: '#c62828' } })]),
    record(M.ninePoint, M.ninePointD, 3, (B, a, b, c) => [B.circle3(B.mid(a, b), B.mid(b, c), B.mid(c, a), undefined, { style: { color: '#2e7d32' } })]),
    record(M.thales, M.thalesD, 2, (B, a, b) => [B.circle(B.mid(a, b), a)]),
    record(M.square, M.squareD, 2, (B, a, b) => [B.regpoly(a, b, 4)]),
  ];
}
