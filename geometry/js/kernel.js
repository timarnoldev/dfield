// Geometry kernel: object types, computation, dependency graph, intersection
// branch tracking, loci, serialization. DOM free (unit tested in node).
import { compileExpr, ExprError, replaceNames } from './expr.js';

export const EPS = 1e-9;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ values
export const P = (x, y) => ({ k: 'pt', x, y });
const finite = (...v) => v.every(Number.isFinite);
const hyp = Math.hypot;
export function normAng(a) { a %= TAU; return a < 0 ? a + TAU : a; }

export function mkLine(kind, a, b) { return { k: 'line', kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
export function lineRange(l) {
  if (l.kind === 'ray') return [0, Infinity];
  if (l.kind === 'segment' || l.kind === 'vector') return [0, 1];
  return [-Infinity, Infinity];
}
export function linePoint(l, t) { return P(l.x1 + t * (l.x2 - l.x1), l.y1 + t * (l.y2 - l.y1)); }
export function lineParam(l, p) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-30) return 0;
  return ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / d2;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Membership test for a point known to lie on the underlying line/circle. */
export function inRange(v, p, tol = 1e-9) {
  if (v.k === 'line') {
    const [lo, hi] = lineRange(v);
    const t = lineParam(v, p);
    return t >= lo - tol && t <= hi + tol;
  }
  if (v.k === 'arc') {
    const d = normAng(Math.atan2(p.y - v.cy, p.x - v.cx) - v.a0);
    return d <= v.s + tol || d >= TAU - tol;
  }
  return true;
}

/** Point on a path for parameter t. */
export function pathPoint(v, t) {
  switch (v.k) {
    case 'line': { const [lo, hi] = lineRange(v); return linePoint(v, clamp(t, lo, hi)); }
    case 'circle': return P(v.cx + v.r * Math.cos(t), v.cy + v.r * Math.sin(t));
    case 'arc': { const a = v.a0 + clamp(t, 0, 1) * v.s; return P(v.cx + v.r * Math.cos(a), v.cy + v.r * Math.sin(a)); }
    case 'poly': {
      const n = v.pts.length;
      if (!n) return null;
      let tt = t % n; if (tt < 0) tt += n;
      const i = Math.floor(tt), f = tt - i;
      const a = v.pts[i], b = v.pts[(i + 1) % n];
      return P(a.x + f * (b.x - a.x), a.y + f * (b.y - a.y));
    }
    default: return null;
  }
}

/** Parameter of the point of path v closest to p. */
export function pathProject(v, p) {
  switch (v.k) {
    case 'line': { const [lo, hi] = lineRange(v); return clamp(lineParam(v, p), lo, hi); }
    case 'circle': return normAng(Math.atan2(p.y - v.cy, p.x - v.cx));
    case 'arc': {
      const d = normAng(Math.atan2(p.y - v.cy, p.x - v.cx) - v.a0);
      if (d <= v.s) return d / v.s;
      return (d - v.s) < (TAU - d) ? 1 : 0;
    }
    case 'poly': {
      let best = Infinity, bt = 0;
      const n = v.pts.length;
      for (let i = 0; i < n; i++) {
        const a = v.pts[i], b = v.pts[(i + 1) % n];
        const s = { k: 'line', kind: 'segment', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        const f = clamp(lineParam(s, p), 0, 1);
        const q = linePoint(s, f);
        const d = hyp(q.x - p.x, q.y - p.y);
        if (d < best) { best = d; bt = i + f; }
      }
      return bt;
    }
    default: return 0;
  }
}

function segDist(ax, ay, bx, by, p) {
  const dx = bx - ax, dy = by - ay;
  const d2 = dx * dx + dy * dy;
  const t = d2 < 1e-30 ? 0 : clamp(((p.x - ax) * dx + (p.y - ay) * dy) / d2, 0, 1);
  return hyp(ax + t * dx - p.x, ay + t * dy - p.y);
}
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
export function pointInPoly(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance (world units) of p from a drawable value; interior flag for areas. */
export function valueDistance(v, p) {
  switch (v.k) {
    case 'pt': return hyp(v.x - p.x, v.y - p.y);
    case 'line': {
      const [lo, hi] = lineRange(v);
      const t = clamp(lineParam(v, p), lo, hi);
      const q = linePoint(v, t);
      return hyp(q.x - p.x, q.y - p.y);
    }
    case 'circle': return Math.abs(hyp(p.x - v.cx, p.y - v.cy) - v.r);
    case 'arc': {
      const q = pathPoint(v, pathProject(v, p));
      return hyp(q.x - p.x, q.y - p.y);
    }
    case 'poly': {
      let d = Infinity;
      const n = v.pts.length;
      for (let i = 0; i < n; i++) {
        const a = v.pts[i], b = v.pts[(i + 1) % n];
        d = Math.min(d, segDist(a.x, a.y, b.x, b.y, p));
      }
      return d;
    }
    case 'locus': {
      let d = Infinity;
      for (const path of v.paths) {
        for (let i = 0; i + 1 < path.length; i++) d = Math.min(d, segDist(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y, p));
        if (path.length === 1) d = Math.min(d, hyp(path[0].x - p.x, path[0].y - p.y));
      }
      return d;
    }
    default: return Infinity;
  }
}

// ------------------------------------------------------------------ intersections
/** Intersection of the underlying carriers. Returns { slots: n, pts: [] } with pts in canonical order. */
export function carrierIntersections(a, b) {
  const isL = (v) => v.k === 'line';
  const isC = (v) => v.k === 'circle' || v.k === 'arc';
  if (isL(a) && isL(b)) {
    const d1x = a.x2 - a.x1, d1y = a.y2 - a.y1, d2x = b.x2 - b.x1, d2y = b.y2 - b.y1;
    const cr = d1x * d2y - d1y * d2x;
    const n1 = hyp(d1x, d1y), n2 = hyp(d2x, d2y);
    if (n1 < 1e-15 || n2 < 1e-15 || Math.abs(cr) < 1e-12 * n1 * n2) return { slots: 1, pts: [] };
    const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / cr;
    return { slots: 1, pts: [linePoint(a, t)] };
  }
  if (isL(a) && isC(b)) return { slots: 2, pts: lineCircle(a, b) };
  if (isC(a) && isL(b)) return { slots: 2, pts: lineCircle(b, a) };
  if (isC(a) && isC(b)) return { slots: 2, pts: circleCircle(a, b) };
  return { slots: 0, pts: [] };
}
function lineCircle(l, c) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const a = dx * dx + dy * dy;
  if (a < 1e-30) return [];
  const t0 = ((c.cx - l.x1) * dx + (c.cy - l.y1) * dy) / a;
  const fx = l.x1 + t0 * dx - c.cx, fy = l.y1 + t0 * dy - c.cy;
  const h2 = fx * fx + fy * fy;
  const r2 = c.r * c.r;
  const tol = 1e-10 * Math.max(r2, 1e-12);
  if (h2 > r2 + tol) return [];
  const w = Math.sqrt(Math.max(0, r2 - h2) / a);
  return [linePoint(l, t0 - w), linePoint(l, t0 + w)];
}
function circleCircle(c1, c2) {
  const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
  const d = hyp(dx, dy);
  const scale = Math.max(c1.r, c2.r, 1e-12);
  if (d < 1e-12 * scale) return [];
  const tol = 1e-10 * scale;
  if (d > c1.r + c2.r + tol || d < Math.abs(c1.r - c2.r) - tol) return [];
  const a = (d * d + c1.r * c1.r - c2.r * c2.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const ux = dx / d, uy = dy / d;
  const bx = c1.cx + a * ux, by = c1.cy + a * uy;
  return [P(bx - h * uy, by + h * ux), P(bx + h * uy, by - h * ux)];
}

/**
 * Assigns raw (canonical) candidates to the slots, choosing the permutation
 * nearest to the last known slot positions (continuity of branches).
 */
export function trackSlots(mem, key, pts) {
  if (pts.length !== 2) return pts;
  const last = mem.get(key);
  let out = pts;
  if (last) {
    const d = (p, q) => (q ? hyp(p.x - q.x, p.y - q.y) : 0);
    const id = d(pts[0], last[0]) + d(pts[1], last[1]);
    const sw = d(pts[1], last[0]) + d(pts[0], last[1]);
    if (sw < id - 1e-12) out = [pts[1], pts[0]];
  }
  mem.set(key, [{ x: out[0].x, y: out[0].y }, { x: out[1].x, y: out[1].y }]);
  return out;
}

// ------------------------------------------------------------------ transformations
function mapValue(v, f, reverses) {
  switch (v.k) {
    case 'pt': return f(v);
    case 'line': { const a = f(P(v.x1, v.y1)), b = f(P(v.x2, v.y2)); return { ...v, x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
    case 'circle': {
      const c = f(P(v.cx, v.cy)), q = f(P(v.cx + v.r, v.cy));
      return { k: 'circle', cx: c.x, cy: c.y, r: hyp(q.x - c.x, q.y - c.y) };
    }
    case 'arc': {
      const c = f(P(v.cx, v.cy));
      const s = f(P(v.cx + v.r * Math.cos(v.a0), v.cy + v.r * Math.sin(v.a0)));
      const e = f(P(v.cx + v.r * Math.cos(v.a0 + v.s), v.cy + v.r * Math.sin(v.a0 + v.s)));
      const st = reverses ? e : s;
      return { k: 'arc', cx: c.x, cy: c.y, r: hyp(s.x - c.x, s.y - c.y), a0: normAng(Math.atan2(st.y - c.y, st.x - c.x)), s: v.s };
    }
    case 'poly': return { k: 'poly', pts: v.pts.map(f) };
    case 'locus': return { k: 'locus', paths: v.paths.map((pa) => pa.map(f)) };
    default: return null;
  }
}
function reflectInLine(l) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-30) return null;
  return (p) => {
    const t = ((p.x - l.x1) * dx + (p.y - l.y1) * dy) / d2;
    const fx = l.x1 + t * dx, fy = l.y1 + t * dy;
    return P(2 * fx - p.x, 2 * fy - p.y);
  };
}
function rotation(c, ang) {
  const co = Math.cos(ang), si = Math.sin(ang);
  return (p) => P(c.x + co * (p.x - c.x) - si * (p.y - c.y), c.y + si * (p.x - c.x) + co * (p.y - c.y));
}

// ------------------------------------------------------------------ circle helpers
function circleThrough(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const scale = Math.max(hyp(b.x - a.x, b.y - a.y), hyp(c.x - a.x, c.y - a.y), 1e-12);
  if (Math.abs(d) < 1e-10 * scale * scale) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx: ux, cy: uy, r: hyp(a.x - ux, a.y - uy) };
}
const ang = (c, p) => Math.atan2(p.y - c.y, p.x - c.x);

// ------------------------------------------------------------------ object types
// cat: point | line | circle | arc | poly | meas | locus | text
// compute(vals, obj, ctx) -> value or null. vals are parent values (non-null).
const isPt = (v) => v && v.k === 'pt';
const isLine = (v) => v && v.k === 'line';
const isCirc = (v) => v && v.k === 'circle';
const isCurve = (v) => v && (v.k === 'circle' || v.k === 'arc');
const lineLen = (l) => hyp(l.x2 - l.x1, l.y2 - l.y1);
const meas = (v, unit, anchor, extra = {}) => (Number.isFinite(v) || unit === 'coords' ? { k: 'meas', v, unit, anchor, ...extra } : null);

export const TYPES = {
  free: { cat: 'point', compute: (_, o) => (finite(o.params.x, o.params.y) ? P(o.params.x, o.params.y) : null) },
  onobj: { cat: 'point', compute: ([v], o) => pathPoint(v, o.params.t ?? 0) },
  isect: {
    cat: 'point',
    compute([a, b], o, ctx) {
      const { slots, pts } = carrierIntersections(a, b);
      const w = o.params.which || 0;
      if (!slots) return null;
      let list = pts;
      if (slots === 2 && pts.length === 2) list = trackSlots(ctx.mem, `i|${o.parents[0]}|${o.parents[1]}`, pts);
      const p = list[w];
      if (!p || !finite(p.x, p.y)) return null;
      if (!inRange(a, p, 1e-7) || !inRange(b, p, 1e-7)) return null;
      return P(p.x, p.y);
    },
  },
  midpoint: {
    cat: 'point',
    compute(vals) {
      if (vals.length === 1 && isLine(vals[0])) return P((vals[0].x1 + vals[0].x2) / 2, (vals[0].y1 + vals[0].y2) / 2);
      const [a, b] = vals;
      return P((a.x + b.x) / 2, (a.y + b.y) / 2);
    },
  },
  center: {
    cat: 'point',
    compute([c]) { return P(c.cx, c.cy); },
  },
  polyvertex: { cat: 'point', compute([v], o) { const p = v.pts[o.params.i]; return p ? P(p.x, p.y) : null; } },

  segment: { cat: 'line', compute: ([a, b]) => mkLine('segment', a, b) },
  vector: { cat: 'line', compute: ([a, b]) => mkLine('vector', a, b) },
  ray: { cat: 'line', compute: ([a, b]) => (hyp(b.x - a.x, b.y - a.y) < EPS ? null : mkLine('ray', a, b)) },
  line: { cat: 'line', compute: ([a, b]) => (hyp(b.x - a.x, b.y - a.y) < EPS ? null : mkLine('line', a, b)) },
  perp: {
    cat: 'line',
    compute([p, l]) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1, n = hyp(dx, dy);
      if (n < 1e-15) return null;
      return mkLine('line', p, P(p.x - dy / n, p.y + dx / n));
    },
  },
  parallel: {
    cat: 'line',
    compute([p, l]) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1, n = hyp(dx, dy);
      if (n < 1e-15) return null;
      return mkLine('line', p, P(p.x + dx / n, p.y + dy / n));
    },
  },
  perpbis: {
    cat: 'line',
    compute(vals) {
      let a, b;
      if (vals.length === 1) { a = P(vals[0].x1, vals[0].y1); b = P(vals[0].x2, vals[0].y2); } else [a, b] = vals;
      const dx = b.x - a.x, dy = b.y - a.y, n = hyp(dx, dy);
      if (n < EPS) return null;
      const m = P((a.x + b.x) / 2, (a.y + b.y) / 2);
      return mkLine('line', m, P(m.x - dy / n, m.y + dx / n));
    },
  },
  anglebis: {
    cat: 'line',
    compute([a, b, c]) {
      const n1 = hyp(a.x - b.x, a.y - b.y), n2 = hyp(c.x - b.x, c.y - b.y);
      if (n1 < EPS || n2 < EPS) return null;
      let dx = (a.x - b.x) / n1 + (c.x - b.x) / n2, dy = (a.y - b.y) / n1 + (c.y - b.y) / n2;
      if (hyp(dx, dy) < 1e-9) { dx = -(a.y - b.y) / n1; dy = (a.x - b.x) / n1; }
      return mkLine('line', b, P(b.x + dx, b.y + dy));
    },
  },
  tangent: {
    cat: 'line',
    compute([p, c], o, ctx) {
      const dx = p.x - c.cx, dy = p.y - c.cy, d = hyp(dx, dy);
      const tol = 1e-9 * Math.max(1, c.r);
      if (d < c.r - tol || c.r < 1e-15) return null;
      if (d <= c.r + tol) {
        // point on circle: unique tangent (both slots)
        return mkLine('line', p, P(p.x - dy / d, p.y + dx / d));
      }
      const phi = Math.atan2(dy, dx), th = Math.acos(c.r / d);
      const pts = [phi + th, phi - th].map((a) => P(c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)));
      const list = trackSlots(ctx.mem, `t|${o.parents[0]}|${o.parents[1]}`, pts);
      const t = list[o.params.which || 0];
      return { ...mkLine('line', p, t), touch: { x: t.x, y: t.y } };
    },
  },

  polygon: { cat: 'poly', compute: (vals) => ({ k: 'poly', pts: vals.map((v) => P(v.x, v.y)) }) },
  regpoly: {
    cat: 'poly',
    compute([a, b], o) {
      const n = Math.max(3, Math.round(o.params.n || 3));
      const pts = [P(a.x, a.y), P(b.x, b.y)];
      const ext = TAU / n;
      let dx = b.x - a.x, dy = b.y - a.y;
      if (hyp(dx, dy) < EPS) return null;
      for (let i = 2; i < n; i++) {
        const co = Math.cos(ext), si = Math.sin(ext);
        [dx, dy] = [co * dx - si * dy, si * dx + co * dy];
        const q = pts[i - 1];
        pts.push(P(q.x + dx, q.y + dy));
      }
      return { k: 'poly', pts };
    },
  },

  circle: { cat: 'circle', compute: ([m, p]) => ({ k: 'circle', cx: m.x, cy: m.y, r: hyp(p.x - m.x, p.y - m.y) }) },
  circleR: {
    cat: 'circle',
    exprs: ['r'],
    compute([m], o, ctx) {
      const r = ctx.evalParam(o, 'r');
      return Number.isFinite(r) && r >= 0 ? { k: 'circle', cx: m.x, cy: m.y, r } : null;
    },
  },
  compass: {
    cat: 'circle',
    compute(vals) {
      let r, m;
      if (vals.length === 2) { r = lineLen(vals[0]); m = vals[1]; } else { r = hyp(vals[1].x - vals[0].x, vals[1].y - vals[0].y); m = vals[2]; }
      return { k: 'circle', cx: m.x, cy: m.y, r };
    },
  },
  circle3: {
    cat: 'circle',
    compute([a, b, c]) { const k = circleThrough(a, b, c); return k && { k: 'circle', ...k }; },
  },
  arc: {
    cat: 'arc',
    compute([m, a, b]) {
      const r = hyp(a.x - m.x, a.y - m.y);
      if (r < EPS || hyp(b.x - m.x, b.y - m.y) < EPS) return null;
      const a0 = normAng(ang(m, a));
      let s = normAng(ang(m, b) - a0);
      if (s < 1e-12) s = TAU;
      return { k: 'arc', cx: m.x, cy: m.y, r, a0, s };
    },
  },
  arc3: {
    cat: 'arc',
    compute([a, b, c]) {
      const k = circleThrough(a, b, c);
      if (!k) return null;
      const m = P(k.cx, k.cy);
      const aa = ang(m, a), ab = ang(m, b), ac = ang(m, c);
      const sCC = normAng(ac - aa), sB = normAng(ab - aa);
      if (sB <= sCC) return { k: 'arc', ...k, a0: normAng(aa), s: sCC };
      return { k: 'arc', ...k, a0: normAng(ac), s: TAU - sCC };
    },
  },

  reflectL: { cat: 'same', compute([v, l]) { const f = reflectInLine(l); return f && mapValue(v, f, true); } },
  reflectP: { cat: 'same', compute([v, c]) { return mapValue(v, (p) => P(2 * c.x - p.x, 2 * c.y - p.y), false); } },
  rotate: {
    cat: 'same',
    exprs: ['angle'],
    compute([v, c], o, ctx) {
      const a = ctx.evalParam(o, 'angle');
      return Number.isFinite(a) ? mapValue(v, rotation(c, a * DEG), false) : null;
    },
  },
  translate: {
    cat: 'same',
    compute(vals) {
      const v = vals[0];
      let dx, dy;
      if (vals.length === 3) { dx = vals[2].x - vals[1].x; dy = vals[2].y - vals[1].y; } else { dx = vals[1].x2 - vals[1].x1; dy = vals[1].y2 - vals[1].y1; }
      return mapValue(v, (p) => P(p.x + dx, p.y + dy), false);
    },
  },
  dilate: {
    cat: 'same',
    exprs: ['factor'],
    compute([v, c], o, ctx) {
      const k = ctx.evalParam(o, 'factor');
      return Number.isFinite(k) ? mapValue(v, (p) => P(c.x + k * (p.x - c.x), c.y + k * (p.y - c.y)), false) : null;
    },
  },

  dist: {
    cat: 'meas',
    compute([a, b]) {
      if (isLine(b)) {
        const dx = b.x2 - b.x1, dy = b.y2 - b.y1, n = hyp(dx, dy);
        if (n < 1e-15) return null;
        const t = lineParam(b, a);
        const f = linePoint(b, t);
        return meas(Math.abs((a.x - b.x1) * dy - (a.y - b.y1) * dx) / n, 'len', P((a.x + f.x) / 2, (a.y + f.y) / 2), { foot: f, from: P(a.x, a.y) });
      }
      return meas(hyp(b.x - a.x, b.y - a.y), 'len', P((a.x + b.x) / 2, (a.y + b.y) / 2));
    },
  },
  length: {
    cat: 'meas',
    compute([v]) {
      switch (v.k) {
        case 'line': return meas(lineLen(v), 'len', P((v.x1 + v.x2) / 2, (v.y1 + v.y2) / 2));
        case 'circle': return meas(TAU * v.r, 'len', P(v.cx + v.r * Math.SQRT1_2, v.cy + v.r * Math.SQRT1_2));
        case 'arc': { const m = pathPoint(v, 0.5); return meas(v.r * v.s, 'len', m); }
        case 'poly': {
          let s = 0;
          for (let i = 0; i < v.pts.length; i++) { const a = v.pts[i], b = v.pts[(i + 1) % v.pts.length]; s += hyp(b.x - a.x, b.y - a.y); }
          return meas(s, 'len', centroid(v.pts));
        }
        default: return null;
      }
    },
  },
  angle: {
    cat: 'meas',
    compute([a, b, c], o) {
      if (hyp(a.x - b.x, a.y - b.y) < EPS || hyp(c.x - b.x, c.y - b.y) < EPS) return null;
      const aa = ang(b, a), ac = ang(b, c);
      let a0 = aa, s = normAng(ac - aa);
      if (!o.params.oriented && s > Math.PI + 1e-12) { a0 = ac; s = TAU - s; }
      return meas(s / DEG, 'deg', P(b.x, b.y), { a0: normAng(a0), s });
    },
  },
  area: {
    cat: 'meas',
    compute([v]) {
      if (v.k === 'poly') return meas(Math.abs(polyArea(v.pts)), 'area', centroid(v.pts));
      if (v.k === 'circle') return meas(Math.PI * v.r * v.r, 'area', P(v.cx, v.cy));
      if (v.k === 'arc') return meas(0.5 * v.r * v.r * v.s, 'area', pathPoint(v, 0.5));
      return null;
    },
  },
  coords: { cat: 'meas', compute: ([p]) => ({ k: 'meas', v: NaN, unit: 'coords', anchor: P(p.x, p.y), x: p.x, y: p.y }) },
  slope: {
    cat: 'meas',
    compute([l]) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
      if (Math.abs(dx) < 1e-12 * Math.max(1, Math.abs(dy))) return null;
      return meas(dy / dx, 'num', P((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2));
    },
  },
  calc: {
    cat: 'meas',
    exprs: ['expr'],
    compute(_, o, ctx) {
      const v = ctx.evalParam(o, 'expr');
      return meas(v, 'num', P(o.params.x ?? 0, o.params.y ?? 0), { pinned: true });
    },
  },
  text: {
    cat: 'text',
    compute(_, o, ctx) {
      const parts = ctx.textParts(o);
      return { k: 'text', x: o.params.x ?? 0, y: o.params.y ?? 0, parts };
    },
  },
  locus: {
    cat: 'locus',
    compute(_, o, ctx) { return ctx.locus(o); },
  },
};

export function centroid(pts) {
  const n = pts.length || 1;
  return P(pts.reduce((s, p) => s + p.x, 0) / n, pts.reduce((s, p) => s + p.y, 0) / n);
}

/** Category of an object (transforms take the category of their first parent). */
export function catOf(c, o) {
  const t = TYPES[o.type];
  if (!t) return 'none';
  if (t.cat === 'same') { const p = c.get(o.parents[0]); return p ? catOf(c, p) : 'none'; }
  return t.cat;
}

// ------------------------------------------------------------------ naming
const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω'];
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LOWER = 'abcdfghijklmnopqrstuvwxyz'.split(''); // no 'e' (Euler's number)

// ------------------------------------------------------------------ construction
let uid = 0;
export const DEFAULT_STYLE = {
  point: { color: '#1565c0', width: 2, dash: 'solid', ps: 'dot', size: 4.5, fill: 0 },
  line: { color: '#1b1f24', width: 1.75, dash: 'solid', ps: 'dot', size: 4, fill: 0 },
  circle: { color: '#1b1f24', width: 1.75, dash: 'solid', ps: 'dot', size: 4, fill: 0 },
  arc: { color: '#1b1f24', width: 1.75, dash: 'solid', ps: 'dot', size: 4, fill: 0 },
  poly: { color: '#c0392b', width: 1.5, dash: 'solid', ps: 'dot', size: 4, fill: 0.18 },
  meas: { color: '#00695c', width: 1.5, dash: 'solid', ps: 'dot', size: 4, fill: 0.15 },
  locus: { color: '#8e24aa', width: 2, dash: 'solid', ps: 'dot', size: 4, fill: 0 },
  text: { color: '#1b1f24', width: 1, dash: 'solid', ps: 'dot', size: 4, fill: 0 },
};

export class Construction {
  constructor() {
    this.objects = [];
    this.map = new Map();
    this.mem = new Map(); // intersection / tangent branch memory
    this.nextId = 1;
    this.structVersion = 0;
    this._children = null;
    this._compiled = new Map();
  }

  get(id) { return this.map.get(id); }
  byName(name) { return this.objects.find((o) => o.name === name); }
  index(id) { return this.objects.findIndex((o) => o.id === id); }
  names() {
    if (this._namesVer !== this.structVersion) {
      this._names = new Set(this.objects.map((o) => o.name).filter(Boolean));
      this._namesVer = this.structVersion;
    }
    return this._names;
  }

  /** Next free automatic name for a category. */
  autoName(cat, type) {
    const used = this.names();
    const seq = (base) => {
      for (let k = 0; k < 1000; k++) for (const b of base) { const n = k ? `${b}${k}` : b; if (!used.has(n)) return n; }
      return `obj${++uid}`;
    };
    const num = (pre) => { for (let k = 1; ; k++) if (!used.has(pre + k)) return pre + k; };
    if (type === 'angle') return seq(GREEK);
    switch (cat) {
      case 'point': return seq(UPPER);
      case 'line': return seq(LOWER);
      case 'circle': return num('k');
      case 'arc': return num('b');
      case 'poly': return num('poly');
      case 'meas': return type === 'calc' ? num('t') : num('m');
      case 'locus': return num('loc');
      case 'text': return num('text');
      case 'aux': return num('aux');
      default: return num('obj');
    }
  }

  /** Adds an object. def: { type, parents, params, name, style, ... } */
  add(def) {
    const type = TYPES[def.type];
    if (!type) throw new Error(`Unknown type ${def.type}`);
    for (const pid of def.parents || []) if (!this.map.has(pid)) throw new Error(`Unknown parent ${pid}`);
    const o = {
      id: def.id ?? this.nextId++,
      type: def.type,
      name: '',
      parents: [...(def.parents || [])],
      params: { ...(def.params || {}) },
      style: null,
      hidden: !!def.hidden,
      showLabel: def.showLabel,
      fixed: !!def.fixed,
      trace: !!def.trace,
      aux: !!def.aux,
      showIf: def.showIf || '',
      label: def.label || null, // label offset {dx,dy} in px
      decimals: def.decimals ?? null,
      caption: def.caption || '',
      deps: [],
      value: null,
    };
    if (o.id >= this.nextId) this.nextId = o.id + 1;
    const cat = catOf(this, o);
    o.style = { ...(DEFAULT_STYLE[cat] || DEFAULT_STYLE.line), ...(def.style || {}) };
    if (o.type !== 'free' && cat === 'point' && !(def.style && def.style.color)) {
      o.style.color = o.type === 'onobj' ? '#3d8fe0' : '#37474f';
    }
    if (o.showLabel === undefined) o.showLabel = cat === 'point' || cat === 'meas' || cat === 'text';
    o.name = def.name && !this.byName(def.name) ? def.name : (o.aux ? this.autoName('aux') : this.autoName(cat, o.type));
    this.objects.push(o);
    this.map.set(o.id, o);
    this.updateDeps(o);
    this.structChanged();
    this.computeObject(o);
    return o;
  }

  structChanged() { this.structVersion++; this._children = null; }

  allParents(o) { return o.deps.length ? [...o.parents, ...o.deps] : o.parents; }

  children() {
    if (!this._children) {
      const ch = new Map();
      for (const o of this.objects) for (const p of this.allParents(o)) {
        if (!ch.has(p)) ch.set(p, []);
        ch.get(p).push(o.id);
      }
      this._children = ch;
    }
    return this._children;
  }

  /** All objects depending (transitively) on ids, including ids. */
  descendants(ids) {
    const ch = this.children();
    const out = new Set(ids);
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop();
      for (const c of ch.get(id) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
    }
    return out;
  }
  ancestors(ids) {
    const out = new Set(ids);
    const stack = [...ids];
    while (stack.length) {
      const o = this.get(stack.pop());
      if (!o) continue;
      for (const p of this.allParents(o)) if (!out.has(p)) { out.add(p); stack.push(p); }
    }
    return out;
  }

  // ---------------------------------------------------- expressions
  exprSources(o) {
    const src = [];
    for (const k of TYPES[o.type].exprs || []) if (o.params[k] !== undefined) src.push(String(o.params[k]));
    if (o.type === 'text') for (const m of String(o.params.text || '').matchAll(/\{([^}]*)\}/g)) src.push(m[1]);
    if (o.showIf) src.push(o.showIf);
    return src;
  }
  compile(src) {
    const key = src;
    let e = this._compiled.get(key);
    if (e && e.ver === this.nameVersion) return e.res;
    let res;
    try { res = compileExpr(src, this.names()); } catch (err) { res = { error: err.message, refs: new Set() }; }
    this._compiled.set(key, { ver: this.nameVersion, res });
    return res;
  }
  get nameVersion() { return this.structVersion; }

  /** Recomputes expression dependencies of o. Returns error string or ''. */
  updateDeps(o) {
    const deps = new Set();
    let error = '';
    for (const s of this.exprSources(o)) {
      const r = this.compile(s);
      if (r.error) error = r.error;
      for (const n of r.refs) { const t = this.byName(n); if (t && t.id !== o.id) deps.add(t.id); }
    }
    o.deps = [...deps];
    return error;
  }

  /** Validates expression src for object o (no cycles, names known). */
  checkExpr(o, src) {
    let r;
    try { r = compileExpr(src, this.names()); } catch (err) { return err.message; }
    const desc = o ? this.descendants([o.id]) : new Set();
    for (const n of r.refs) {
      const t = this.byName(n);
      if (!t) return `Unknown name '${n}'`;
      if (desc.has(t.id)) return `'${n}' depends on this object (circular reference)`;
      const isNum = numericValue(t) !== undefined || ['pt'].includes(t.value && t.value.k);
      if (!isNum && t.value) return `'${n}' has no numeric value`;
    }
    return '';
  }

  env() {
    return {
      num: (n) => { const t = this.byName(n); const v = t && numericValue(t); return v === undefined ? NaN : v; },
      point: (n) => { const t = this.byName(n); return t && t.value && t.value.k === 'pt' ? t.value : null; },
    };
  }
  evalSrc(src) {
    const r = this.compile(src);
    if (r.error) return NaN;
    return r.evaluate(this.env());
  }

  /** Stable topological re-sort (after expression edits). Returns false on cycles. */
  sort() {
    const placed = new Set();
    const out = [];
    const rest = [...this.objects];
    while (rest.length) {
      const i = rest.findIndex((o) => this.allParents(o).every((p) => placed.has(p)));
      if (i < 0) return false;
      placed.add(rest[i].id);
      out.push(rest[i]);
      rest.splice(i, 1);
    }
    this.objects = out;
    this.structChanged();
    return true;
  }

  // ---------------------------------------------------- computation
  ctx() {
    if (!this._ctx) {
      this._ctx = {
        mem: this.mem,
        evalParam: (o, k) => {
          const v = o.params[k];
          if (typeof v === 'number') return v;
          return this.evalSrc(String(v));
        },
        textParts: (o) => String(o.params.text || '').split(/(\{[^}]*\})/).filter((s) => s !== '').map((s) => {
          if (s[0] === '{' && s.endsWith('}')) {
            const v = this.evalSrc(s.slice(1, -1));
            return { expr: s.slice(1, -1), v };
          }
          return { s };
        }),
        locus: (o) => this.computeLocus(o),
      };
    }
    this._ctx.mem = this.mem;
    return this._ctx;
  }

  computeObject(o) {
    const vals = [];
    let ok = true;
    for (const pid of o.parents) {
      const p = this.map.get(pid);
      if (!p || !p.value) { ok = false; break; }
      vals.push(p.value);
    }
    let v = null;
    if (ok) {
      try { v = TYPES[o.type].compute(vals, o, this.ctx()); } catch (e) { v = null; }
      if (v && !validValue(v)) v = null;
    }
    o.value = v;
    return v;
  }

  /** Recomputes everything, or only the given set of ids (in construction order). */
  recompute(only) {
    for (const o of this.objects) if (!only || only.has(o.id)) this.computeObject(o);
    for (const o of this.objects) {
      if (!only || only.has(o.id)) o.condHidden = o.showIf ? !(this.evalSrc(o.showIf) > 0) : false;
    }
  }

  // ---------------------------------------------------- locus
  locusChain(o) {
    if (o._chainVer === this.structVersion) return o._chain;
    const [pid, qid] = o.parents;
    const down = this.descendants([pid]);
    const up = this.ancestors([qid]);
    o._chain = this.objects.filter((x) => x.id !== pid && down.has(x.id) && up.has(x.id) && x.id !== o.id);
    o._chainVer = this.structVersion;
    return o._chain;
  }

  computeLocus(o) {
    const drv = this.get(o.parents[0]);
    const q = this.get(o.parents[1]);
    if (!drv || !q || drv.type !== 'onobj') return null;
    const path = this.get(drv.parents[0]);
    if (!path || !path.value) return null;
    const pv = path.value;
    const chain = this.locusChain(o);
    if (!chain.includes(q) && q.id !== drv.id) return null;
    const saveT = drv.params.t;
    const saveDrv = drv.value;
    const saved = chain.map((x) => x.value);
    const savedMem = new Map(this.mem);
    const n = Math.max(40, Math.min(3000, o.params.samples || 400));
    let lo, hi, map = (u) => u;
    switch (pv.k) {
      case 'circle': lo = 0; hi = TAU; break;
      case 'arc': lo = 0; hi = 1; break;
      case 'poly': lo = 0; hi = pv.pts.length; break;
      case 'line': {
        const [a, b] = lineRange(pv);
        if (Number.isFinite(a) && Number.isFinite(b)) { lo = a; hi = b; } else if (Number.isFinite(a)) {
          lo = 0; hi = 0.995; map = (u) => u / (1 - u) * 4;
        } else { lo = -1.5; hi = 1.5; map = (u) => Math.tan(u) * 4; }
        break;
      }
      default: return null;
    }
    const sample = (u) => {
      drv.params.t = map(u);
      drv.value = pathPoint(pv, drv.params.t);
      for (const x of chain) this.computeObject(x);
      const v = q.id === drv.id ? drv.value : q.value;
      return v && v.k === 'pt' ? { x: v.x, y: v.y } : null;
    };
    const raw = [];
    for (let i = 0; i <= n; i++) {
      const u = lo + ((hi - lo) * i) / n;
      raw.push(sample(u));
    }
    // jump detection: break where a step is far larger than its neighbours
    const steps = [];
    for (let i = 1; i < raw.length; i++) if (raw[i] && raw[i - 1]) steps.push(hyp(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
    const sorted = [...steps].sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const lim = Math.max(med * 25, 1e-9);
    const paths = [];
    let cur = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (!p) { if (cur.length) paths.push(cur); cur = []; continue; }
      const prev = cur[cur.length - 1];
      if (prev && hyp(p.x - prev.x, p.y - prev.y) > lim) { paths.push(cur); cur = []; }
      cur.push(p);
    }
    if (cur.length) paths.push(cur);
    // restore
    drv.params.t = saveT;
    drv.value = saveDrv;
    chain.forEach((x, i) => { x.value = saved[i]; });
    this.mem.clear();
    for (const [k, v] of savedMem) this.mem.set(k, v);
    const good = paths.filter((pa) => pa.length);
    return good.length ? { k: 'locus', paths: good } : null;
  }

  // ---------------------------------------------------- editing
  remove(ids) {
    const del = this.descendants(ids);
    this.objects = this.objects.filter((o) => !del.has(o.id));
    for (const id of del) this.map.delete(id);
    for (const k of [...this.mem.keys()]) {
      const [, a, b] = k.split('|');
      if (del.has(Number(a)) || del.has(Number(b))) this.mem.delete(k);
    }
    this.structChanged();
    return del;
  }

  rename(o, name) {
    const names = new Set(this.names());
    const map = new Map([[o.name, name]]);
    const rw = (src) => replaceNames(src, names, map);
    for (const x of this.objects) {
      if (!x.deps.includes(o.id)) continue;
      for (const k of TYPES[x.type].exprs || []) if (typeof x.params[k] === 'string') x.params[k] = rw(x.params[k]);
      if (x.type === 'text') x.params.text = String(x.params.text).replace(/\{([^}]*)\}/g, (m, inner) => `{${rw(inner)}}`);
      if (x.showIf) x.showIf = rw(x.showIf);
    }
    o.name = name;
    this.structChanged();
    this._compiled.clear();
    for (const x of this.objects) this.updateDeps(x);
    this.structChanged();
  }

  clear() {
    this.objects = [];
    this.map.clear();
    this.mem.clear();
    this.nextId = 1;
    this.structChanged();
  }

  // ---------------------------------------------------- serialization
  toJSON() {
    return {
      objects: this.objects.map((o) => {
        const r = { id: o.id, type: o.type, name: o.name, parents: o.parents, params: o.params, style: o.style };
        if (o.hidden) r.hidden = true;
        if (o.showLabel !== undefined) r.showLabel = o.showLabel;
        if (o.fixed) r.fixed = true;
        if (o.trace) r.trace = true;
        if (o.aux) r.aux = true;
        if (o.showIf) r.showIf = o.showIf;
        if (o.label) r.label = o.label;
        if (o.decimals !== null && o.decimals !== undefined) r.decimals = o.decimals;
        if (o.caption) r.caption = o.caption;
        return r;
      }),
      mem: [...this.mem.entries()],
    };
  }
  load(data) {
    this.clear();
    const defs = data.objects || [];
    // first pass: create in order; expression deps may reference later objects, so add without compute errors
    for (const d of defs) {
      const o = {
        id: d.id, type: d.type, name: d.name, parents: d.parents || [], params: { ...(d.params || {}) },
        style: null, hidden: !!d.hidden, showLabel: d.showLabel, fixed: !!d.fixed, trace: !!d.trace, aux: !!d.aux,
        showIf: d.showIf || '', label: d.label || null, decimals: d.decimals ?? null, caption: d.caption || '', deps: [], value: null,
      };
      if (!TYPES[o.type]) throw new Error(`Unknown object type '${o.type}'`);
      const cat = catOfDef(defs, d);
      o.style = { ...(DEFAULT_STYLE[cat] || DEFAULT_STYLE.line), ...(d.style || {}) };
      if (o.showLabel === undefined) o.showLabel = cat === 'point' || cat === 'meas' || cat === 'text';
      this.objects.push(o);
      this.map.set(o.id, o);
      this.nextId = Math.max(this.nextId, o.id + 1);
    }
    for (const o of this.objects) for (const p of o.parents) if (!this.map.has(p)) throw new Error(`Object ${o.name}: missing parent ${p}`);
    for (const o of this.objects) this.updateDeps(o);
    if (!this.sort()) throw new Error('Circular dependency');
    if (Array.isArray(data.mem)) for (const [k, v] of data.mem) this.mem.set(k, v);
    this.structChanged();
    this.recompute();
  }
}

function catOfDef(defs, d) {
  const t = TYPES[d.type];
  if (t.cat !== 'same') return t.cat;
  const p = defs.find((x) => x.id === d.parents[0]);
  return p ? catOfDef(defs, p) : 'line';
}

function validValue(v) {
  switch (v.k) {
    case 'pt': return finite(v.x, v.y);
    case 'line': return finite(v.x1, v.y1, v.x2, v.y2);
    case 'circle': return finite(v.cx, v.cy, v.r);
    case 'arc': return finite(v.cx, v.cy, v.r, v.a0, v.s);
    case 'poly': return v.pts.every((p) => finite(p.x, p.y));
    case 'meas': return v.unit === 'coords' ? finite(v.x, v.y) : Number.isFinite(v.v);
    default: return true;
  }
}

/** Numeric value of an object for terms, or undefined. */
export function numericValue(o) {
  const v = o.value;
  if (!v) return (TYPES[o.type].cat === 'meas' && o.type !== 'coords') || isNumericType(o) ? NaN : undefined;
  switch (v.k) {
    case 'meas': return v.unit === 'coords' ? undefined : v.v;
    case 'line': return v.kind === 'segment' || v.kind === 'vector' ? lineLen(v) : undefined;
    case 'circle': return v.r;
    case 'arc': return v.r * v.s;
    case 'poly': return Math.abs(polyArea(v.pts));
    default: return undefined;
  }
}
function isNumericType(o) {
  return ['segment', 'vector', 'circle', 'circleR', 'compass', 'circle3', 'arc', 'arc3', 'polygon', 'regpoly'].includes(o.type);
}

export { ExprError };
