// Equation types for the 2-dim and 3-dim windows: field definitions for the
// edit dialogs, defaults, display labels and compilation to JS functions.
import { compile, parse, evalConst, ParseError } from './parser.js';

export const PALETTE = ['#d62728', '#1f5fd6', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2', '#111111', '#7f7f00'];

// field kinds: expr (math expression), num (constant expression), text, select, check
export const TYPES2D = {
  explicit: {
    name: 'Explicit  y = f(x)', short: 'explicit',
    fields: [
      { key: 'f', label: 'y =', kind: 'expr', vars: ['x'], placeholder: 'e.g. a sin(x)' },
      { key: 'dmin', label: 'x from', kind: 'num', placeholder: '−∞', optional: true, half: true },
      { key: 'dmax', label: 'to', kind: 'num', placeholder: '+∞', optional: true, half: true },
    ],
    defaults: { f: 'sin(x)', dmin: '', dmax: '' },
  },
  parametric: {
    name: 'Parametric  x(t), y(t)', short: 'parametric',
    fields: [
      { key: 'x', label: 'x(t) =', kind: 'expr', vars: ['t'] },
      { key: 'y', label: 'y(t) =', kind: 'expr', vars: ['t'] },
      { key: 'tmin', label: 't from', kind: 'num', half: true },
      { key: 'tmax', label: 'to', kind: 'num', half: true },
      { key: 'steps', label: 'Intervals', kind: 'num', half: true },
    ],
    defaults: { x: 'cos(3t)', y: 'sin(2t)', tmin: '0', tmax: '2pi', steps: '400' },
  },
  polar: {
    name: 'Polar  r = f(t)', short: 'polar',
    fields: [
      { key: 'r', label: 'r =', kind: 'expr', vars: ['t'], placeholder: 'function of t (angle)' },
      { key: 'tmin', label: 't from', kind: 'num', half: true },
      { key: 'tmax', label: 'to', kind: 'num', half: true },
      { key: 'steps', label: 'Intervals', kind: 'num', half: true },
    ],
    defaults: { r: '2cos(3t)', tmin: '0', tmax: '2pi', steps: '400' },
  },
  implicit: {
    name: 'Implicit  f(x,y) = g(x,y)', short: 'implicit',
    fields: [
      { key: 'eq', label: 'Equation', kind: 'expr', vars: ['x', 'y'], implicit: true, placeholder: 'e.g. x^2 + y^2 = 4' },
      { key: 'res', label: 'Resolution', kind: 'select', options: [['coarse', 'Coarse (fast)'], ['normal', 'Normal'], ['fine', 'Fine']] },
    ],
    defaults: { eq: 'x^2 + y^2 = 4', res: 'normal' },
  },
  inequality: {
    name: 'Inequality  y < f(x)', short: 'inequality',
    fields: [
      { key: 'rel', label: 'Shade', kind: 'select', options: [['<', 'y < f(x)'], ['<=', 'y ≤ f(x)'], ['>', 'y > f(x)'], ['>=', 'y ≥ f(x)']] },
      { key: 'f', label: 'f(x) =', kind: 'expr', vars: ['x'] },
      { key: 'dmin', label: 'x from', kind: 'num', placeholder: '−∞', optional: true, half: true },
      { key: 'dmax', label: 'to', kind: 'num', placeholder: '+∞', optional: true, half: true },
      { key: 'alpha', label: 'Opacity', kind: 'select', options: [['0.15', 'Light'], ['0.3', 'Medium'], ['0.5', 'Strong']] },
    ],
    defaults: { rel: '<', f: 'x^2 - 2', dmin: '', dmax: '', alpha: '0.3' },
  },
  points: {
    name: 'Points / polyline', short: 'points',
    fields: [
      { key: 'pts', label: 'Points', kind: 'text', placeholder: '(1,2) (3,-1) (a,b) …', points: true },
      { key: 'style', label: 'Style', kind: 'select', options: [['dots', 'Dots only'], ['line', 'Connected'], ['polygon', 'Closed polygon'], ['filled', 'Filled polygon']] },
      { key: 'labels', label: 'Show coordinates', kind: 'check' },
    ],
    defaults: { pts: '(0,0) (1,2) (3,1)', style: 'dots', labels: false },
  },
  segment: {
    name: 'Segment / vector', short: 'segment',
    fields: [
      { key: 'x1', label: 'x₁', kind: 'num', half: true }, { key: 'y1', label: 'y₁', kind: 'num', half: true },
      { key: 'x2', label: 'x₂', kind: 'num', half: true }, { key: 'y2', label: 'y₂', kind: 'num', half: true },
      { key: 'arrow', label: 'Arrow head (vector)', kind: 'check' },
      { key: 'extend', label: 'Extend to full line', kind: 'check' },
    ],
    defaults: { x1: '0', y1: '0', x2: '2', y2: '1', arrow: false, extend: false },
  },
  ode: {
    name: "Differential eq.  dy/dx = f(x,y)", short: 'ODE',
    fields: [
      { key: 'f', label: "dy/dx =", kind: 'expr', vars: ['x', 'y'] },
      { key: 'field', label: 'Slope field', kind: 'check' },
      { key: 'density', label: 'Field density', kind: 'select', options: [['12', 'Sparse'], ['20', 'Normal'], ['30', 'Dense'], ['42', 'Very dense']] },
      { key: 'arrows', label: 'Arrow heads', kind: 'check' },
      { key: 'solver', label: 'Solver', kind: 'select', options: [['dp', 'Dormand–Prince (adaptive)'], ['rk4', 'Runge–Kutta 4 (fixed step)']] },
      { key: 'ics', label: 'Initial points', kind: 'text', placeholder: '(x₀,y₀) … – or tap in Solve mode', points: true, optional: true },
    ],
    defaults: { f: 'x - y', field: true, density: '20', arrows: false, solver: 'dp', ics: '' },
  },
};

export const TYPES3D = {
  explicit: {
    name: 'Explicit  z = f(x,y)', short: 'explicit',
    fields: [
      { key: 'f', label: 'z =', kind: 'expr', vars: ['x', 'y'] },
      { key: 'xmin', label: 'x from', kind: 'num', half: true, placeholder: 'box' , optional: true },
      { key: 'xmax', label: 'to', kind: 'num', half: true, placeholder: 'box', optional: true },
      { key: 'ymin', label: 'y from', kind: 'num', half: true, placeholder: 'box', optional: true },
      { key: 'ymax', label: 'to', kind: 'num', half: true, placeholder: 'box', optional: true },
    ],
    defaults: { f: 'x^2 - y^2', xmin: '', xmax: '', ymin: '', ymax: '' },
  },
  parametric: {
    name: 'Parametric surface', short: 'surface',
    fields: [
      { key: 'x', label: 'x(u,v) =', kind: 'expr', vars: ['u', 'v'] },
      { key: 'y', label: 'y(u,v) =', kind: 'expr', vars: ['u', 'v'] },
      { key: 'z', label: 'z(u,v) =', kind: 'expr', vars: ['u', 'v'] },
      { key: 'umin', label: 'u from', kind: 'num', half: true }, { key: 'umax', label: 'to', kind: 'num', half: true },
      { key: 'vmin', label: 'v from', kind: 'num', half: true }, { key: 'vmax', label: 'to', kind: 'num', half: true },
    ],
    defaults: { x: '(2 + cos(v))cos(u)', y: '(2 + cos(v))sin(u)', z: 'sin(v)', umin: '0', umax: '2pi', vmin: '0', vmax: '2pi' },
  },
  cylindrical: {
    name: 'Cylindrical  z = f(r,t)', short: 'cylindrical',
    fields: [
      { key: 'f', label: 'z =', kind: 'expr', vars: ['r', 't'] },
      { key: 'rmin', label: 'r from', kind: 'num', half: true }, { key: 'rmax', label: 'to', kind: 'num', half: true },
      { key: 'tmin', label: 't from', kind: 'num', half: true }, { key: 'tmax', label: 'to', kind: 'num', half: true },
    ],
    defaults: { f: 'sin(2r)/r', rmin: '0.01', rmax: '6', tmin: '0', tmax: '2pi' },
  },
  spherical: {
    name: 'Spherical  ρ = f(u,v)', short: 'spherical',
    note: 'u = azimuth θ (around the z-axis), v = polar angle φ measured from the +z-axis.',
    fields: [
      { key: 'f', label: 'ρ =', kind: 'expr', vars: ['u', 'v'] },
      { key: 'umin', label: 'u from', kind: 'num', half: true }, { key: 'umax', label: 'to', kind: 'num', half: true },
      { key: 'vmin', label: 'v from', kind: 'num', half: true }, { key: 'vmax', label: 'to', kind: 'num', half: true },
    ],
    defaults: { f: '2 + 0.4sin(4u)sin(3v)', umin: '0', umax: '2pi', vmin: '0', vmax: 'pi' },
  },
  curve: {
    name: 'Space curve  (x(t), y(t), z(t))', short: 'curve',
    fields: [
      { key: 'x', label: 'x(t) =', kind: 'expr', vars: ['t'] },
      { key: 'y', label: 'y(t) =', kind: 'expr', vars: ['t'] },
      { key: 'z', label: 'z(t) =', kind: 'expr', vars: ['t'] },
      { key: 'tmin', label: 't from', kind: 'num', half: true }, { key: 'tmax', label: 'to', kind: 'num', half: true },
      { key: 'steps', label: 'Intervals', kind: 'num', half: true },
    ],
    defaults: { x: '2cos(t)', y: '2sin(t)', z: 't/4', tmin: '-4pi', tmax: '4pi', steps: '600' },
  },
  point3: {
    name: 'Points (3D)', short: 'points',
    fields: [
      { key: 'pts', label: 'Points', kind: 'text', placeholder: '(1,2,3) (0,0,a) …', points: true, dim: 3 },
      { key: 'line', label: 'Connect with lines', kind: 'check' },
    ],
    defaults: { pts: '(0,0,0) (1,1,1)', line: false },
  },
};

const SURFACE_OPTS = [
  { key: 'colorMode', label: 'Coloring', kind: 'select', options: [['height', 'Height (rainbow)'], ['solid', 'Solid color']] },
  { key: 'res', label: 'Mesh resolution', kind: 'select', options: [['20', '20 × 20'], ['40', '40 × 40'], ['60', '60 × 60'], ['100', '100 × 100']] },
  { key: 'surface', label: 'Shaded surface', kind: 'check' },
  { key: 'mesh', label: 'Mesh lines', kind: 'check' },
  { key: 'opacity', label: 'Opacity', kind: 'select', options: [['1', 'Opaque'], ['0.75', '75 %'], ['0.5', '50 %']] },
];
for (const k of ['explicit', 'parametric', 'cylindrical', 'spherical']) {
  TYPES3D[k].fields.push(...SURFACE_OPTS);
  Object.assign(TYPES3D[k].defaults, { colorMode: 'height', res: '40', surface: true, mesh: true, opacity: '1' });
}

export function typeDef(dim, type) {
  return (dim === 3 ? TYPES3D : TYPES2D)[type];
}

/** Parses "(1,2) (3,4)" or "1,2; 3,4" into array of arrays of expression strings. */
export function splitPoints(src, dim = 2) {
  src = String(src || '').trim();
  if (!src) return [];
  const out = [];
  if (src.includes('(')) {
    let depth = 0, start = -1;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '(') { if (depth === 0) start = i + 1; depth++; }
      else if (c === ')') {
        depth--;
        if (depth === 0) out.push(splitTop(src.slice(start, i)));
        if (depth < 0) throw new ParseError("Unbalanced ')' in point list.");
      }
    }
    if (depth !== 0) throw new ParseError("Missing ')' in point list.");
  } else {
    for (const part of src.split(/[;\n]+/)) if (part.trim()) out.push(splitTop(part));
  }
  for (const p of out) if (p.length !== dim) throw new ParseError(`Each point needs ${dim} coordinates: (${p.join(',')})`);
  return out;
}
function splitTop(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

/** Splits "lhs = rhs" (single '=') into lhs - (rhs). */
export function implicitSource(src) {
  const s = String(src || '');
  const m = s.match(/^([^=<>!]*[^=<>!])==?([^=].*)$/);
  if (m) return `(${m[1]}) - (${m[2]})`;
  return s;
}

const num = (src, fallback) => {
  const v = evalConst(src, fallback);
  if (Number.isNaN(v)) throw new ParseError(`'${src}' is not a number.`);
  return v;
};

// ---------------------------------------------------------------- labels
const sup = (s) => String(s).replace(/\^2(?![\d.])/g, '²').replace(/\^3(?![\d.])/g, '³');
export function label(dim, eq) {
  if (eq.name) return eq.name;
  if (dim === 2) {
    switch (eq.type) {
      case 'explicit': return `y = ${sup(eq.f)}`;
      case 'parametric': return `x = ${sup(eq.x)},  y = ${sup(eq.y)}`;
      case 'polar': return `r = ${sup(eq.r)}`;
      case 'implicit': return sup(eq.eq.includes('=') ? eq.eq : `${eq.eq} = 0`);
      case 'inequality': return `y ${{ '<': '<', '<=': '≤', '>': '>', '>=': '≥' }[eq.rel]} ${sup(eq.f)}`;
      case 'points': return `points ${eq.pts}`;
      case 'segment': return `${eq.extend ? 'line' : eq.arrow ? 'vector' : 'segment'} (${eq.x1}, ${eq.y1}) → (${eq.x2}, ${eq.y2})`;
      case 'ode': return `dy/dx = ${sup(eq.f)}`;
      default: return eq.type;
    }
  }
  switch (eq.type) {
    case 'explicit': return `z = ${sup(eq.f)}`;
    case 'parametric': return `(${sup(eq.x)}, ${sup(eq.y)}, ${sup(eq.z)})`;
    case 'cylindrical': return `z = ${sup(eq.f)}  (cyl.)`;
    case 'spherical': return `ρ = ${sup(eq.f)}`;
    case 'curve': return `(${sup(eq.x)}, ${sup(eq.y)}, ${sup(eq.z)}), t`;
    case 'point3': return `points ${eq.pts}`;
    default: return eq.type;
  }
}

// ---------------------------------------------------------------- validation
/** Validates a single field value; returns error message or null, and collects params. */
export function checkField(field, value, params) {
  try {
    if (field.kind === 'expr') {
      const src = field.implicit ? implicitSource(value) : value;
      const c = compile(src, field.vars);
      c.params.forEach((p) => params.add(p));
    } else if (field.kind === 'num') {
      if (String(value ?? '').trim() === '') {
        if (field.optional) return null;
        throw new ParseError('Value required.');
      }
      const c = compile(String(value), []);
      c.params.forEach((p) => params.add(p));
    } else if (field.points) {
      if (!String(value || '').trim()) {
        if (field.optional) return null;
        throw new ParseError('Enter at least one point.');
      }
      for (const pt of splitPoints(value, field.dim || 2)) {
        for (const comp of pt) compile(comp, []).params.forEach((p) => params.add(p));
      }
    }
  } catch (e) {
    if (e instanceof ParseError) return e.message;
    throw e;
  }
  return null;
}

/** Collect parameters used by an equation (empty set on errors). */
export function paramsUsed(dim, eq) {
  const def = typeDef(dim, eq.type);
  const ps = new Set();
  if (!def) return ps;
  for (const f of def.fields) checkField(f, eq[f.key], ps);
  return ps;
}

// ---------------------------------------------------------------- compile 2D
/**
 * Compiles a 2D equation. Result:
 *  { error, params, kind, ... } where depending on type:
 *   explicit/inequality: f(x), dom() -> [lo,hi]
 *   parametric/polar:   pt(t) -> [x,y], range() -> [lo,hi]
 *   implicit:           F(x,y)
 *   points:             pts() -> [[x,y],..]
 *   segment:            ends() -> [[x1,y1],[x2,y2]]
 *   ode:                f(x,y), ics() -> [[x,y],..]
 */
export function compile2(eq) {
  const params = new Set();
  const take = (c) => { c.params.forEach((p) => params.add(p)); return c.fn; };
  const cnum = (src, optional) => {
    if (optional && String(src ?? '').trim() === '') return () => NaN;
    const c = compile(String(src ?? ''), []);
    return take(c);
  };
  try {
    switch (eq.type) {
      case 'explicit': case 'inequality': {
        const f = take(compile(eq.f, ['x']));
        const lo = cnum(eq.dmin, true), hi = cnum(eq.dmax, true);
        return { params, f, dom: () => [lo(), hi()] };
      }
      case 'parametric': {
        const fx = take(compile(eq.x, ['t'])), fy = take(compile(eq.y, ['t']));
        const lo = cnum(eq.tmin), hi = cnum(eq.tmax);
        const steps = Math.max(10, Math.min(20000, Math.round(evalConst(eq.steps, 400)) || 400));
        return { params, pt: (t) => [fx(t), fy(t)], fx, fy, range: () => [lo(), hi()], steps };
      }
      case 'polar': {
        const fr = take(compile(eq.r, ['t']));
        const lo = cnum(eq.tmin), hi = cnum(eq.tmax);
        const steps = Math.max(10, Math.min(20000, Math.round(evalConst(eq.steps, 400)) || 400));
        const pt = (t) => { const r = fr(t); return [r * Math.cos(t), r * Math.sin(t)]; };
        return { params, pt, fr, fx: (t) => pt(t)[0], fy: (t) => pt(t)[1], range: () => [lo(), hi()], steps };
      }
      case 'implicit': {
        const F = take(compile(implicitSource(eq.eq), ['x', 'y']));
        return { params, F };
      }
      case 'points': {
        const pts = splitPoints(eq.pts, 2).map(([a, b]) => [cnum(a), cnum(b)]);
        return { params, pts: () => pts.map(([a, b]) => [a(), b()]) };
      }
      case 'segment': {
        const [a, b, c, d] = [cnum(eq.x1), cnum(eq.y1), cnum(eq.x2), cnum(eq.y2)];
        return { params, ends: () => [[a(), b()], [c(), d()]] };
      }
      case 'ode': {
        const f = take(compile(eq.f, ['x', 'y']));
        const ics = splitPoints(eq.ics, 2).map(([a, b]) => [cnum(a), cnum(b)]);
        return { params, f, ics: () => ics.map(([a, b]) => [a(), b()]) };
      }
      default: return { error: `Unknown type ${eq.type}`, params };
    }
  } catch (e) {
    if (e instanceof ParseError) return { error: e.message, params };
    throw e;
  }
}

// ---------------------------------------------------------------- compile 3D
/** Compiles a 3D equation into { error, params, kind:'surface'|'curve'|'points', ... }. */
export function compile3(eq, box) {
  const params = new Set();
  const take = (c) => { c.params.forEach((p) => params.add(p)); return c.fn; };
  const cnum = (src, fallback) => {
    if (String(src ?? '').trim() === '') return () => fallback;
    return take(compile(String(src), []));
  };
  try {
    switch (eq.type) {
      case 'explicit': {
        const f = take(compile(eq.f, ['x', 'y']));
        const r = [cnum(eq.xmin, box.xmin), cnum(eq.xmax, box.xmax), cnum(eq.ymin, box.ymin), cnum(eq.ymax, box.ymax)];
        return { params, kind: 'surface', explicit: true, map: (x, y) => [x, y, f(x, y)], range: () => r.map((g) => g()) };
      }
      case 'parametric': {
        const fx = take(compile(eq.x, ['u', 'v'])), fy = take(compile(eq.y, ['u', 'v'])), fz = take(compile(eq.z, ['u', 'v']));
        const r = [cnum(eq.umin, 0), cnum(eq.umax, 1), cnum(eq.vmin, 0), cnum(eq.vmax, 1)];
        return { params, kind: 'surface', map: (u, v) => [fx(u, v), fy(u, v), fz(u, v)], range: () => r.map((g) => g()) };
      }
      case 'cylindrical': {
        const f = take(compile(eq.f, ['r', 't']));
        const r = [cnum(eq.rmin, 0), cnum(eq.rmax, 1), cnum(eq.tmin, 0), cnum(eq.tmax, 2 * Math.PI)];
        return { params, kind: 'surface', map: (rr, t) => [rr * Math.cos(t), rr * Math.sin(t), f(rr, t)], range: () => r.map((g) => g()) };
      }
      case 'spherical': {
        const f = take(compile(eq.f, ['u', 'v']));
        const r = [cnum(eq.umin, 0), cnum(eq.umax, 2 * Math.PI), cnum(eq.vmin, 0), cnum(eq.vmax, Math.PI)];
        const map = (u, v) => { const rho = f(u, v); return [rho * Math.sin(v) * Math.cos(u), rho * Math.sin(v) * Math.sin(u), rho * Math.cos(v)]; };
        return { params, kind: 'surface', map, range: () => r.map((g) => g()) };
      }
      case 'curve': {
        const fx = take(compile(eq.x, ['t'])), fy = take(compile(eq.y, ['t'])), fz = take(compile(eq.z, ['t']));
        const r = [cnum(eq.tmin, 0), cnum(eq.tmax, 1)];
        const steps = Math.max(10, Math.min(20000, Math.round(evalConst(eq.steps, 600)) || 600));
        return { params, kind: 'curve', pt: (t) => [fx(t), fy(t), fz(t)], range: () => r.map((g) => g()), steps };
      }
      case 'point3': {
        const pts = splitPoints(eq.pts, 3).map((p) => p.map((s) => cnum(s, 0)));
        return { params, kind: 'points', pts: () => pts.map((p) => p.map((g) => g())) };
      }
      default: return { error: `Unknown type ${eq.type}`, params };
    }
  } catch (e) {
    if (e instanceof ParseError) return { error: e.message, params };
    throw e;
  }
}

export function newEquation(dim, type, color) {
  const def = typeDef(dim, type);
  return { type, color, width: 2, visible: true, ...structuredClone(def.defaults) };
}

export { parse };
