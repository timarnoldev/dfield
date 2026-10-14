// Polyhedra: vertex sets of Platonic, Archimedean and Kepler–Poinsot solids,
// a small convex-hull routine, convex clipping (truncation / dual morph) and
// V, E, F counting.
import { PHI, sub, cross, dot, len, norm, scale, add } from './geom.js';

const EPS = 1e-7;
const key = (p, q = 1e5) => `${Math.round(p[0] * q)},${Math.round(p[1] * q)},${Math.round(p[2] * q)}`;

function uniq(points) {
  const m = new Map();
  for (const p of points) m.set(key(p.map((x) => (Math.abs(x) < 1e-12 ? 0 : x))), p);
  return [...m.values()];
}
function signs(v) {
  const out = [];
  for (let s = 0; s < 8; s++) out.push([s & 1 ? -v[0] : v[0], s & 2 ? -v[1] : v[1], s & 4 ? -v[2] : v[2]]);
  return out;
}
const cyc = (v) => [[v[0], v[1], v[2]], [v[1], v[2], v[0]], [v[2], v[0], v[1]]];
const odd = (v) => [[v[1], v[0], v[2]], [v[0], v[2], v[1]], [v[2], v[1], v[0]]];
const allPerms = (v) => [...cyc(v), ...odd(v)];
const cycSigns = (...vs) => uniq(vs.flatMap((v) => cyc(v).flatMap(signs)));
const allSigns = (...vs) => uniq(vs.flatMap((v) => allPerms(v).flatMap(signs)));
const plusCount = (v) => v.filter((x) => x > 0).length;

const S2 = Math.SQRT2;
const P = PHI;
const TRIB = 1.839286755214161; // tribonacci constant

export const SOLIDS = {
  tetrahedron: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  cube: () => allSigns([1, 1, 1]),
  octahedron: () => allSigns([1, 0, 0]),
  dodecahedron: () => uniq([...signs([1, 1, 1]), ...cycSigns([0, 1 / P, P])]),
  icosahedron: () => cycSigns([0, 1, P]),
  truncTetrahedron: () => allSigns([3, 1, 1]).filter((v) => v.filter((x) => x < 0).length % 2 === 0),
  cuboctahedron: () => allSigns([1, 1, 0]),
  truncCube: () => allSigns([S2 - 1, 1, 1]),
  truncOctahedron: () => allSigns([0, 1, 2]),
  rhombicuboctahedron: () => allSigns([1, 1, 1 + S2]),
  truncCuboctahedron: () => allSigns([1, 1 + S2, 1 + 2 * S2]),
  snubCube: () => {
    const v = [1, 1 / TRIB, TRIB];
    const a = cyc(v).flatMap(signs).filter((p) => plusCount(p) % 2 === 0);
    const b = odd(v).flatMap(signs).filter((p) => plusCount(p) % 2 === 1);
    return uniq([...a, ...b]);
  },
  icosidodecahedron: () => uniq([...cycSigns([0, 0, P]), ...cycSigns([0.5, P / 2, P * P / 2])]),
  truncIcosahedron: () => cycSigns([0, 1, 3 * P], [1, 2 + P, 2 * P], [P, 2, P * P * P]),
  truncDodecahedron: () => cycSigns([0, 1 / P, 2 + P], [1 / P, P, 2 * P], [P, 2, P + 1]),
  rhombicosidodecahedron: () => cycSigns([1, 1, P * P * P], [P * P, P, 2 * P], [2 + P, 0, P * P]),
  truncIcosidodecahedron: () => cycSigns([1 / P, 1 / P, 3 + P], [2 / P, P, 1 + 2 * P], [1 / P, P * P, -1 + 3 * P],
    [2 * P - 1, 2, 2 + P], [P, 3, 2 * P]),
};

/** Convex hull faces (index arrays, counter-clockwise seen from outside). Origin must be inside. */
export function hullFaces(pts) {
  const n = pts.length;
  let e = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e = Math.min(e, len(sub(pts[i], pts[j])));
  const R = 3.4 * e;
  const near = pts.map((p, i) => pts.map((q, j) => j).filter((j) => j !== i && len(sub(pts[j], p)) < R));
  const seen = new Set();
  const faces = [];
  const tol = 1e-6 * Math.max(...pts.map(len));
  for (let i = 0; i < n; i++) {
    const nb = near[i];
    for (let a = 0; a < nb.length; a++) {
      for (let b = a + 1; b < nb.length; b++) {
        const j = nb[a], k = nb[b];
        let nn = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
        const l = len(nn);
        if (l < 1e-9 * e * e) continue;
        nn = scale(nn, 1 / l);
        let d = dot(nn, pts[i]);
        if (d < 0) { nn = scale(nn, -1); d = -d; }
        const kk = key(nn, 1e4);
        if (seen.has(kk)) continue;
        let ok = true;
        for (let m = 0; m < n; m++) if (dot(nn, pts[m]) > d + tol) { ok = false; break; }
        if (!ok) continue;
        seen.add(kk);
        const on = [];
        for (let m = 0; m < n; m++) if (Math.abs(dot(nn, pts[m]) - d) <= tol) on.push(m);
        faces.push(orderAround(on, pts, nn));
      }
    }
  }
  return faces;
}

function orderAround(idx, pts, n) {
  const c = scale(idx.reduce((s, i) => add(s, pts[i]), [0, 0, 0]), 1 / idx.length);
  const a = norm(sub(pts[idx[0]], c));
  const b = cross(n, a);
  return idx
    .map((i) => { const d = sub(pts[i], c); return { i, ang: Math.atan2(dot(d, b), dot(d, a)) }; })
    .sort((x, y) => x.ang - y.ang)
    .map((o) => o.i);
}
function orderPoints(points, n) {
  const idx = points.map((_, i) => i);
  return orderAround(idx, points, n).map((i) => points[i]);
}

/** Polyhedron as list of face polygons (point arrays) from vertices + index faces. */
export const facesToPolys = (pts, faces) => faces.map((f) => f.map((i) => pts[i]));

/** Clip a convex polyhedron (face polygons) by the half-space n·x <= d. */
export function clipConvex(polys, n, d) {
  const out = [];
  const cap = [];
  let cut = false;
  for (const poly of polys) {
    const s = poly.map((p) => dot(n, p) - d);
    if (s.every((v) => v <= EPS)) {
      out.push(poly);
      poly.forEach((p, i) => { if (Math.abs(s[i]) <= EPS) cap.push(p); });
      continue;
    }
    cut = true;
    const res = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const sa = s[i], sb = s[(i + 1) % poly.length];
      const ina = sa <= EPS, inb = sb <= EPS;
      if (ina) { res.push(a); if (Math.abs(sa) <= EPS) cap.push(a); }
      if (ina !== inb && Math.abs(sa) > EPS && Math.abs(sb) > EPS) {
        const t = sa / (sa - sb);
        const p = add(a, scale(sub(b, a), t));
        res.push(p);
        cap.push(p);
      }
    }
    const clean = dedupe(res);
    if (clean.length >= 3) out.push(clean);
  }
  if (!cut) return polys;
  const cp = uniq(cap);
  if (cp.length >= 3) out.push(orderPoints(cp, n));
  return out;
}

function dedupe(poly) {
  const r = [];
  for (const p of poly) if (!r.length || len(sub(p, r[r.length - 1])) > 1e-9) r.push(p);
  while (r.length > 1 && len(sub(r[0], r[r.length - 1])) <= 1e-9) r.pop();
  // drop collinear vertices
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
    if (len(cross(sub(b, a), sub(c, b))) > 1e-10 * (len(sub(b, a)) + len(sub(c, b)) + 1e-12)) out.push(b);
  }
  return out;
}

/** Topological data of a polyhedron given as face polygons. */
export function topology(polys, edgeStep = 1) {
  const vmap = new Map();
  const verts = [];
  const vid = (p) => {
    const k = key(p, 1e6);
    if (!vmap.has(k)) { vmap.set(k, verts.length); verts.push(p); }
    return vmap.get(k);
  };
  const faces = polys.map((poly) => poly.map(vid));
  const emap = new Map();
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + edgeStep) % f.length];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!emap.has(k)) emap.set(k, [a, b]);
    }
  }
  const edges = [...emap.values()];
  return { verts, faces, edges, V: verts.length, E: edges.length, F: faces.length };
}

/** Prepared convex solid with dual for the truncation / dual morph. */
export function prepareSolid(name) {
  const pts = SOLIDS[name]();
  // normalize circumradius to 1.6
  const R0 = Math.max(...pts.map(len));
  const v = pts.map((p) => scale(p, 1.6 / R0));
  const faces = hullFaces(v);
  const polys = facesToPolys(v, faces);
  const top = topology(polys);
  const [a, b] = top.edges[0];
  const rho = len(scale(add(top.verts[a], top.verts[b]), 0.5)); // midradius
  // face planes of P
  const fplanes = polys.map((poly) => {
    const n = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
    return { n, d: dot(n, poly[0]) };
  });
  // dual: vertex w_f = rho^2/d_f n_f ; dual face for each vertex of P
  const dualV = fplanes.map((f) => scale(f.n, (rho * rho) / f.d));
  const vertFaces = top.verts.map(() => []);
  top.faces.forEach((f, fi) => f.forEach((vi) => vertFaces[vi].push(fi)));
  const dualPolys = top.verts.map((p, vi) => orderPoints(vertFaces[vi].map((fi) => dualV[fi]), norm(p)));
  const vplanes = top.verts.map((p) => ({ n: norm(p), r: len(p) }));
  return { name, polys, dualPolys, fplanes, vplanes, rho, top };
}

/** s in [0,2]: 0 solid, 1 rectified, 2 dual. */
export function morphSolid(S, s) {
  if (Math.abs(s - 1) < 0.004) s = 1;
  if (s <= 0.001) return S.polys;
  if (s >= 1.999) return S.dualPolys;
  const rho2 = S.rho * S.rho;
  if (s <= 1) {
    let polys = S.polys;
    for (const vp of S.vplanes) polys = clipConvex(polys, vp.n, vp.r + s * (rho2 / vp.r - vp.r));
    return polys;
  }
  let polys = S.dualPolys;
  const t = s - 1;
  for (const fp of S.fplanes) polys = clipConvex(polys, fp.n, fp.d + t * (rho2 / fp.d - fp.d));
  return polys;
}

// ---------------------------------------------------------------- star polyhedra
/** Faces given by planes perpendicular to `dirs` through the given vertex ring; star step k. */
function starFromRings(verts, dirs, pick, step) {
  const polys = [];
  for (const u of dirs) {
    const h = verts.map((p) => dot(p, u));
    const levels = [...new Set(h.map((x) => Math.round(x * 1e4) / 1e4))].sort((a, b) => b - a);
    const lv = levels[pick];
    const ring = verts.filter((p, i) => Math.abs(h[i] - lv) < 1e-3);
    const ordered = orderPoints(ring, u);
    if (step === 1) { polys.push(ordered); continue; }
    const star = [];
    for (let i = 0, j = 0; i < ordered.length; i++, j = (j + step) % ordered.length) star.push(ordered[j]);
    polys.push(star);
  }
  return polys;
}

export function starSolid(name) {
  const ico = SOLIDS.icosahedron().map((p) => scale(p, 1.6 / Math.hypot(1, P)));
  const dirs = SOLIDS.icosahedron().map(norm);
  if (name === 'stellaOctangula') {
    const t1 = SOLIDS.tetrahedron(), t2 = t1.map((p) => scale(p, -1));
    const tet = (pts) => facesToPolys(pts, hullFaces(pts));
    return { polys: [...tet(t1), ...tet(t2)], step: 1, compound: 2 };
  }
  if (name === 'smallStellatedDodecahedron') return { polys: starFromRings(ico, dirs, 1, 2), step: 1, star: true };
  if (name === 'greatDodecahedron') return { polys: starFromRings(ico, dirs, 1, 1), step: 1, star: false };
  if (name === 'greatStellatedDodecahedron') {
    const dod = SOLIDS.dodecahedron().map((p) => scale(p, 1.6 / Math.sqrt(3)));
    const fdirs = hullFaces(dod).map((f) => norm(f.reduce((acc, i) => add(acc, dod[i]), [0, 0, 0])));
    return { polys: starFromRings(dod, fdirs, 1, 2), step: 1, star: true };
  }
  throw new Error(name);
}

export const DUAL_NAMES = {
  tetrahedron: 'Tetrahedron', cube: 'Octahedron', octahedron: 'Cube', dodecahedron: 'Icosahedron', icosahedron: 'Dodecahedron',
  truncTetrahedron: 'Triakis tetrahedron', cuboctahedron: 'Rhombic dodecahedron', truncCube: 'Triakis octahedron',
  truncOctahedron: 'Tetrakis hexahedron', rhombicuboctahedron: 'Deltoidal icositetrahedron', truncCuboctahedron: 'Disdyakis dodecahedron',
  snubCube: 'Pentagonal icositetrahedron', icosidodecahedron: 'Rhombic triacontahedron', truncIcosahedron: 'Pentakis dodecahedron',
  truncDodecahedron: 'Triakis icosahedron', rhombicosidodecahedron: 'Deltoidal hexecontahedron', truncIcosidodecahedron: 'Disdyakis triacontahedron',
};
