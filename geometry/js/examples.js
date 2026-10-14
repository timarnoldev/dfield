// Example constructions (built with the builder API).
import { builder } from './macros.js';

const H = { hidden: true };
const thin = (color = '#90a4ae', dash = 'dash') => ({ style: { color, width: 1.25, dash } });
const red = '#c62828', green = '#2e7d32', blue = '#1565c0', purple = '#8e24aa', orange = '#ef6c00';

function triangle(B, a = [-4, -2.5], b = [4.5, -2.5], c = [0.8, 3.6]) {
  const A = B.pt(a[0], a[1], 'A'), Bp = B.pt(b[0], b[1], 'B'), C = B.pt(c[0], c[1], 'C');
  const sa = B.seg(Bp, C, 'a'), sb = B.seg(C, A, 'b'), sc = B.seg(A, Bp, 'c');
  return { A, B: Bp, C, sa, sb, sc };
}

export const EXAMPLES = [
  {
    id: 'euler',
    build(c) {
      const B = builder(c);
      const t = triangle(B);
      const { A, C } = t;
      const Bp = t.B;
      B.poly([A, Bp, C], 'tri', { style: { color: blue, fill: 0.06, width: 0.01 }, showLabel: false });
      const Ma = B.mid(Bp, C, 'Ma', { style: { size: 3.5 } });
      const Mb = B.mid(C, A, 'Mb', { style: { size: 3.5 } });
      const Mc = B.mid(A, Bp, 'Mc', { style: { size: 3.5 } });
      const pa = B.bis(Bp, C, { ...H, ...thin() }), pb = B.bis(C, A, { ...H, ...thin() });
      const U = B.isect(pa, pb, 0, 'U', { style: { color: blue } });
      const ma = B.seg(A, Ma, undefined, thin('#9e9d24', 'dot')), mb = B.seg(Bp, Mb, undefined, thin('#9e9d24', 'dot'));
      B.seg(C, Mc, undefined, thin('#9e9d24', 'dot'));
      const S = B.isect(ma, mb, 0, 'S', { style: { color: '#9e9d24' } });
      const ha = B.perp(A, t.sa, { ...thin(orange, 'dash') }), hb = B.perp(Bp, t.sb, { ...thin(orange, 'dash') });
      B.perp(C, t.sc, { ...thin(orange, 'dash') });
      const Hh = B.isect(ha, hb, 0, 'H', { style: { color: orange } });
      B.circle3(A, Bp, C, 'k', { style: { color: '#78909c', width: 1.25 } });
      B.line(U, Hh, 'e', { style: { color: red, width: 2.5 }, showLabel: false });
      B.circle3(Ma, Mb, Mc, 'n', { style: { color: green, width: 2 } });
      B.mid(U, Hh, 'N', { style: { color: green, size: 3.5 } });
      B.text('Euler line (red) through U, S, H;  nine-point circle (green) with center N.\nDrag A, B or C.', -6.5, 6.5);
      return { fit: true };
    },
  },
  {
    id: 'thales',
    build(c) {
      const B = builder(c);
      const A = B.pt(-4, 0, 'A'), Bp = B.pt(4, 0, 'B');
      const M = B.mid(A, Bp, 'M', { style: { size: 3.5 } });
      const k = B.circle(M, A, 'k', { style: { color: '#78909c' } });
      const C = B.on(k, 2.1, 'C');
      B.seg(A, Bp, 'c');
      B.seg(Bp, C, 'a');
      B.seg(C, A, 'b');
      B.angle(A, C, Bp, 'γ', { style: { color: red } });
      B.angle(Bp, A, C, 'α');
      B.angle(C, Bp, A, 'β');
      B.calc('α + β', 3.2, -3.4, { caption: 'α + β' });
      B.text('Thales: every angle at C on the semicircle is a right angle.\nDrag C along the circle, or move A and B.', -6, 6.2);
      return { fit: true };
    },
  },
  {
    id: 'pythagoras',
    build(c) {
      const B = builder(c);
      const A = B.pt(-2.5, 0, 'A'), Bp = B.pt(2.5, 0, 'B');
      const M = B.mid(A, Bp, 'M', H);
      const k = B.circle(M, A, 'k', { ...H });
      const C = B.on(k, 2.0, 'C');
      B.seg(Bp, C, 'a'); B.seg(C, A, 'b'); B.seg(A, Bp, 'c');
      const qc = B.regpoly(Bp, A, 4, 'Qc', { style: { color: red, fill: 0.2 } });
      const qa = B.regpoly(C, Bp, 4, 'Qa', { style: { color: blue, fill: 0.2 } });
      const qb = B.regpoly(A, C, 4, 'Qb', { style: { color: green, fill: 0.2 } });
      B.angle(A, C, Bp, 'γ');
      B.area(qa, { name: 'Fa', caption: 'a²' });
      B.area(qb, { name: 'Fb', caption: 'b²' });
      B.area(qc, { name: 'Fc', caption: 'c²' });
      B.calc('Fa + Fb', 6, 4, { caption: 'a² + b²' });
      B.text('Pythagoras: a² + b² = c² for the right triangle ABC.  Drag C on its (hidden) Thales circle.', -6, 7.5);
      return { fit: true };
    },
  },
  {
    id: 'semicircle',
    build(c) {
      const B = builder(c);
      const M = B.pt(0, 0, 'M');
      const R = B.pt(4, 0, 'R', H);
      const k = B.circle(M, R, 'k', { style: { color: '#78909c' } });
      const A = B.on(k, 3.6, 'A'), Bp = B.on(k, 5.9, 'B');
      const C = B.on(k, 1.0, 'C'), D = B.on(k, 2.0, 'D');
      B.seg(A, C, undefined, thin(red, 'solid')); B.seg(C, Bp, undefined, thin(red, 'solid'));
      B.seg(A, D, undefined, thin(orange, 'solid')); B.seg(D, Bp, undefined, thin(orange, 'solid'));
      B.seg(A, M, undefined, thin(blue, 'solid')); B.seg(M, Bp, undefined, thin(blue, 'solid'));
      B.seg(A, Bp, 's', { style: { color: '#37474f' }, showLabel: false });
      B.angle(A, M, Bp, 'φ', { style: { color: blue } });
      B.angle(A, C, Bp, 'α', { style: { color: red } });
      B.angle(A, D, Bp, 'β', { style: { color: orange } });
      B.text('Inscribed angles over the same chord are equal: α = β = φ/2 = {φ/2}°.\nMove B opposite to A (φ = 180°): the angle in a semicircle is 90°.', -6, 6.5);
      return { fit: true };
    },
  },
  {
    id: 'simson',
    build(c) {
      const B = builder(c);
      const t = triangle(B, [-3.5, -2], [3.8, -2.2], [0.6, 3.2]);
      const k = B.circle3(t.A, t.B, t.C, 'k', { style: { color: '#78909c' } });
      const P = B.on(k, 2.0, 'P', { style: { color: red } });
      const la = B.line(t.B, t.C, undefined, { ...H }), lb = B.line(t.C, t.A, undefined, { ...H }), lc = B.line(t.A, t.B, undefined, { ...H });
      const D = B.isect(B.perp(P, la, { ...H }), la, 0, 'D', { style: { size: 3.5 } });
      const E = B.isect(B.perp(P, lb, { ...H }), lb, 0, 'E', { style: { size: 3.5 } });
      const F = B.isect(B.perp(P, lc, { ...H }), lc, 0, 'F', { style: { size: 3.5 } });
      B.seg(P, D, undefined, thin()); B.seg(P, E, undefined, thin()); B.seg(P, F, undefined, thin());
      B.line(D, E, 's', { style: { color: red, width: 2.25 } });
      const Hh = B.isect(B.perp(t.A, t.sa, { ...H }), B.perp(t.B, t.sb, { ...H }), 0, 'H', { style: { color: orange } });
      const N = B.mid(P, Hh, 'N', { style: { color: purple } });
      B.seg(P, Hh, undefined, thin(orange, 'dot'));
      B.locus(P, N, { name: 'loc1', style: { color: purple, width: 2 } });
      B.text('The feet D, E, F of the perpendiculars from P lie on the Simson line s.\ns bisects PH; the locus of the midpoint N is the nine-point circle.\nTry: switch "Trace" on for s and drag P.', -7, 6.8);
      return { fit: true };
    },
  },
  {
    id: 'ellipse',
    build(c) {
      const B = builder(c);
      const F1 = B.pt(-3, 0, 'F1'), F2 = B.pt(3, 0, 'F2');
      const S1 = B.pt(-4, -5.5, 'S'), S2 = B.pt(4, -5.5, 'T');
      const str = B.seg(S1, S2, 'l', { style: { color: orange, width: 2.5 } });
      const k = B.add('compass', [str, F1], {}, { name: 'k', style: { color: '#b0bec5', dash: 'dash', width: 1.25 } });
      const P = B.on(k, 0.9, 'P', { style: { color: red } });
      const g = B.seg(F1, P, undefined, { ...H });
      const pb = B.bis(P, F2, { ...H });
      const X = B.isect(pb, g, 0, 'X', { style: { color: red } });
      B.seg(F1, X, undefined, { style: { color: orange, width: 2.5 } });
      B.seg(X, F2, undefined, { style: { color: orange, width: 2.5 } });
      B.seg(X, P, undefined, thin());
      B.locus(P, X, { name: 'ell', style: { color: purple, width: 2.25 } });
      B.text("Gardener's construction: |F1X| + |XF2| = l (the string).\nX moves on an ellipse with foci F1, F2. Drag P, F1, F2 or the string end points.", -9, -6.6);
      return { fit: true };
    },
  },
  {
    id: 'napoleon',
    build(c) {
      const B = builder(c);
      const A = B.pt(-3.5, -2, 'A'), Bp = B.pt(3, -2.2, 'B'), C = B.pt(0.3, 2.8, 'C');
      B.poly([A, Bp, C], 'tri', { style: { color: '#37474f', fill: 0.06 }, showLabel: false });
      const centers = [];
      const tri = [[Bp, A, red, 'C'], [C, Bp, green, 'A'], [A, C, blue, 'B']];
      for (const [X, Y, col, opp] of tri) {
        const e = B.regpoly(X, Y, 3, `E${opp}`, { style: { color: col, fill: 0.12 }, showLabel: false });
        const V = B.vertex(e, 2, `${opp}'`, { style: { size: 3 } });
        const kk = B.circle3(X, Y, V, `k${opp}`, { ...H });
        centers.push(B.add('center', [kk], {}, { name: `N${opp.toLowerCase()}`, style: { color: purple } }));
      }
      B.poly(centers, 'nap', { style: { color: purple, width: 2.5, fill: 0.15 }, showLabel: false });
      B.dist(centers[0], centers[1]); B.dist(centers[1], centers[2]); B.dist(centers[2], centers[0]);
      B.text("Napoleon: the centers of the equilateral triangles erected on the sides\nform an equilateral triangle. Drag A, B or C.", -6.5, 7.2);
      return { fit: true };
    },
  },
  {
    id: 'centers',
    build(c) {
      const B = builder(c);
      const t = triangle(B);
      const { A, C } = t; const Bp = t.B;
      const wa = B.abis(Bp, A, C, { ...thin(green, 'dash') }), wb = B.abis(A, Bp, C, { ...thin(green, 'dash') });
      B.abis(A, C, Bp, { ...thin(green, 'dash') });
      const I = B.isect(wa, wb, 0, 'I', { style: { color: green } });
      const foot = B.isect(B.perp(I, t.sc, { ...H }), t.sc, 0, 'Fi', { ...H });
      B.circle(I, foot, 'i', { style: { color: green, width: 2 } });
      const U = B.isect(B.bis(Bp, C, { ...thin(blue) }), B.bis(C, A, { ...thin(blue) }), 0, 'U', { style: { color: blue } });
      B.circle(U, A, 'u', { style: { color: blue, width: 2 } });
      B.text('Incircle (green, angle bisectors) and circumcircle (blue, perpendicular bisectors).', -6, 6.5);
      return { fit: true };
    },
  },
  {
    id: 'tangents',
    build(c) {
      const B = builder(c);
      const M = B.pt(0, 0, 'M'), R = B.pt(2.5, 0, 'R');
      const k = B.circle(M, R, 'k', { style: { width: 2 } });
      const P = B.pt(6, 2, 'P', { style: { color: red } });
      const T = B.mid(M, P, 'Mt', H);
      const th = B.circle(T, P, 'th', thin('#90a4ae', 'dash'));
      const T1 = B.isect(k, th, 0, 'T1'), T2 = B.isect(k, th, 1, 'T2');
      B.line(P, T1, 't1', { style: { color: red } });
      B.line(P, T2, 't2', { style: { color: red } });
      B.seg(M, T1, undefined, thin('#607d8b', 'solid')); B.seg(M, T2, undefined, thin('#607d8b', 'solid'));
      B.angle(M, T1, P, 'α');
      B.dist(P, T1); B.dist(P, T2);
      B.text('Tangents from P via the Thales circle over MP. Move P inside the circle:\nthe tangents become undefined and reappear when P is outside again.', -4, 6);
      return { fit: true };
    },
  },
  {
    id: 'reflection',
    build(c) {
      const B = builder(c);
      const A = B.pt(-5, 1, 'A'), Bp = B.pt(-2, 0.5, 'B'), C = B.pt(-3, 3, 'C');
      const tri = B.poly([A, Bp, C], 'F', { style: { color: blue, fill: 0.2 } });
      const G1 = B.pt(0, -3, 'G'), G2 = B.pt(0.6, 4, 'K');
      const g = B.line(G1, G2, 'g', { style: { color: '#37474f', dash: 'dash' } });
      B.add('reflectL', [tri.id, g.id], {}, { name: "F'", style: { color: red, fill: 0.2 } });
      B.add('reflectL', [A.id, g.id], {}, { name: "A'" });
      const Z = B.pt(-3, -3, 'Z', { style: { color: green } });
      B.add('rotate', [tri.id, Z.id], { angle: '90' }, { name: "F''", style: { color: green, fill: 0.2 } });
      B.text('Reflection of F in g (red) and rotation of F by 90° about Z (green).', -7, 6);
      return { fit: true };
    },
  },
];
