// Small numeric geometry toolkit: vectors, differential geometry of
// parametric surfaces and curves (by finite differences), colour maps.

export const TAU = Math.PI * 2;
export const PHI = (1 + Math.sqrt(5)) / 2;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const finite3 = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

/**
 * First and second fundamental forms of X(u,v) at (u,v) by central differences.
 * Returns { p, Xu, Xv, n, K, H, k1, k2 } (n unit normal, K Gaussian, H mean curvature).
 */
export function surfaceGeometry(X, u, v, hu, hv, p0) {
  const p = p0 || X(u, v);
  const pu1 = X(u + hu, v), pu0 = X(u - hu, v);
  const pv1 = X(u, v + hv), pv0 = X(u, v - hv);
  const puv11 = X(u + hu, v + hv), puv10 = X(u + hu, v - hv);
  const puv01 = X(u - hu, v + hv), puv00 = X(u - hu, v - hv);
  const Xu = [], Xv = [], Xuu = [], Xvv = [], Xuv = [];
  for (let i = 0; i < 3; i++) {
    Xu[i] = (pu1[i] - pu0[i]) / (2 * hu);
    Xv[i] = (pv1[i] - pv0[i]) / (2 * hv);
    Xuu[i] = (pu1[i] - 2 * p[i] + pu0[i]) / (hu * hu);
    Xvv[i] = (pv1[i] - 2 * p[i] + pv0[i]) / (hv * hv);
    Xuv[i] = (puv11[i] - puv10[i] - puv01[i] + puv00[i]) / (4 * hu * hv);
  }
  const c = cross(Xu, Xv);
  const cl = len(c);
  const n = cl > 0 ? scale(c, 1 / cl) : [0, 0, 0];
  const E = dot(Xu, Xu), F = dot(Xu, Xv), G = dot(Xv, Xv);
  const L = dot(Xuu, n), M = dot(Xuv, n), N = dot(Xvv, n);
  const W = E * G - F * F;
  const K = (L * N - M * M) / W;
  const H = (E * N - 2 * F * M + G * L) / (2 * W);
  const disc = Math.sqrt(Math.max(0, H * H - K));
  return { p, Xu, Xv, n, K, H, k1: H + disc, k2: H - disc, degenerate: !(cl > 1e-12 * (E + G)) };
}

/** Normal only (cheaper: 4 extra evaluations). */
export function surfaceNormal(X, u, v, hu, hv) {
  const pu1 = X(u + hu, v), pu0 = X(u - hu, v);
  const pv1 = X(u, v + hv), pv0 = X(u, v - hv);
  const Xu = sub(pu1, pu0), Xv = sub(pv1, pv0);
  const c = cross(Xu, Xv);
  const l = len(c);
  return l > 1e-14 * (dot(Xu, Xu) + dot(Xv, Xv)) ? scale(c, 1 / l) : null;
}

/** Derivatives r', r'', r''' of a space curve by 5/7-point stencils. */
export function curveDerivs(r, t, h) {
  const p = [-3, -2, -1, 0, 1, 2, 3].map((k) => r(t + k * h));
  const d1 = [], d2 = [], d3 = [];
  for (let i = 0; i < 3; i++) {
    const f = (k) => p[k + 3][i];
    d1[i] = (f(-2) - 8 * f(-1) + 8 * f(1) - f(2)) / (12 * h);
    d2[i] = (-f(-2) + 16 * f(-1) - 30 * f(0) + 16 * f(1) - f(2)) / (12 * h * h);
    d3[i] = (-f(3) + 8 * f(2) - 13 * f(1) + 13 * f(-1) - 8 * f(-2) + f(-3)) / (8 * h * h * h);
  }
  return { p: p[3], d1, d2, d3 };
}

/** Frenet frame, curvature and torsion of a space curve r(t). */
export function frenet(r, t, h = 1e-3) {
  const { p, d1, d2, d3 } = curveDerivs(r, t, h);
  const c = cross(d1, d2);
  const s = len(d1);
  const cl = len(c);
  const kappa = cl / (s * s * s);
  const tau = cl > 1e-12 ? dot(c, d3) / (cl * cl) : 0;
  const T = norm(d1);
  let B = cl > 1e-12 * s * s * s ? scale(c, 1 / cl) : null;
  let N;
  if (B) N = cross(B, T);
  else { // straight point: pick any normal
    const a = Math.abs(T[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    N = norm(cross(T, a)); B = cross(T, N);
  }
  return { p, T, N, B, kappa, tau, speed: s };
}

/** Plane curve: point, unit tangent, unit normal (left), signed curvature. */
export function planeFrame(r, t, h = 1e-4) {
  const f = (k) => r(t + k * h);
  const a = f(-2), b = f(-1), c = f(0), d = f(1), e = f(2);
  const x1 = (a[0] - 8 * b[0] + 8 * d[0] - e[0]) / (12 * h);
  const y1 = (a[1] - 8 * b[1] + 8 * d[1] - e[1]) / (12 * h);
  const x2 = (-a[0] + 16 * b[0] - 30 * c[0] + 16 * d[0] - e[0]) / (12 * h * h);
  const y2 = (-a[1] + 16 * b[1] - 30 * c[1] + 16 * d[1] - e[1]) / (12 * h * h);
  const s = Math.hypot(x1, y1);
  const k = (x1 * y2 - y1 * x2) / (s * s * s);
  const T = [x1 / s, y1 / s];
  return { p: c, T, N: [-T[1], T[0]], k, speed: s };
}

// ---------------------------------------------------------------- colours
/** sRGB [0,1] -> linear (three.js vertex colours are linear). */
export const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Diverging blue - white - red map, x in [-1,1]. */
export function diverging(x) {
  x = clamp(x, -1, 1);
  const neg = [0.23, 0.30, 0.75], mid = [0.94, 0.94, 0.94], pos = [0.75, 0.10, 0.15];
  const t = Math.abs(x);
  const o = x < 0 ? neg : pos;
  const e = Math.pow(t, 0.8);
  return [lerp(mid[0], o[0], e), lerp(mid[1], o[1], e), lerp(mid[2], o[2], e)];
}

/** Perceptual-ish rainbow ("turbo"-like) for x in [0,1]. */
export function rainbow(x) {
  x = clamp(x, 0, 1);
  const r = 0.1357 + x * (4.5974 - x * (42.3277 - x * (130.5887 - x * (150.5666 - x * 58.1375))));
  const g = 0.0914 + x * (2.1856 + x * (4.8052 - x * (14.0195 - x * (4.2109 + x * 2.7747))));
  const b = 0.1067 + x * (12.5925 - x * (60.1097 - x * (109.0745 - x * (88.5066 - x * 26.8183))));
  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}

/** Robust symmetric scale: q-quantile of |values| (ignoring non-finite). */
export function robustScale(values, q = 0.95) {
  const a = [];
  for (const v of values) if (Number.isFinite(v)) a.push(Math.abs(v));
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))] || a[a.length - 1] || 1;
}

export function fmt(v, d = 3) {
  if (!Number.isFinite(v)) return '∞';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
}
