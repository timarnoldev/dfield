// Weierstrass zeta and P functions for the square lattice Z + iZ, computed
// with Jacobi theta series (q = e^{-pi}), and Costa's minimal surface.

// complex helpers on [re, im]
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csin = (z) => [Math.sin(z[0]) * Math.cosh(z[1]), Math.cos(z[0]) * Math.sinh(z[1])];
const ccos = (z) => [Math.cos(z[0]) * Math.cosh(z[1]), -Math.sin(z[0]) * Math.sinh(z[1])];

const Q = Math.exp(-Math.PI);
const W1 = 0.5; // half period
const TERMS = 7;
const QN = [];
for (let n = 0; n < TERMS; n++) QN.push(2 * (n % 2 ? -1 : 1) * Math.pow(Q, (n + 0.5) * (n + 0.5)));
let th1p0 = 0, th1ppp0 = 0;
for (let n = 0; n < TERMS; n++) { const m = 2 * n + 1; th1p0 += QN[n] * m; th1ppp0 -= QN[n] * m * m * m; }
const ETA1 = -(Math.PI * Math.PI) * th1ppp0 / (12 * W1 * th1p0);
const S = Math.PI / (2 * W1);

/** theta1 and its first two derivatives at complex v. */
function theta(v) {
  let t0 = [0, 0], t1 = [0, 0], t2 = [0, 0];
  for (let n = 0; n < TERMS; n++) {
    const m = 2 * n + 1;
    const a = [m * v[0], m * v[1]];
    const s = csin(a), c = ccos(a), k = QN[n];
    t0 = [t0[0] + k * s[0], t0[1] + k * s[1]];
    t1 = [t1[0] + k * m * c[0], t1[1] + k * m * c[1]];
    t2 = [t2[0] - k * m * m * s[0], t2[1] - k * m * m * s[1]];
  }
  return [t0, t1, t2];
}

/** Weierstrass zeta(z) and P(z) for the lattice Z + iZ. */
export function zetaP(z) {
  const v = [S * z[0], S * z[1]];
  const [t0, t1, t2] = theta(v);
  const r = cdiv(t1, t0);
  const zeta = [ETA1 * z[0] / W1 + S * r[0], ETA1 * z[1] / W1 + S * r[1]];
  // P = -eta1/w1 - S^2 (t2 t0 - t1^2)/t0^2 = -eta1/w1 - S^2 (t2/t0 - r^2)
  const q = cdiv(t2, t0), r2 = cmul(r, r);
  const P = [-ETA1 / W1 - S * S * (q[0] - r2[0]), -S * S * (q[1] - r2[1])];
  return { zeta, P };
}

export const E1 = zetaP([0.5, 0]).P[0]; // 6.87518581802...

/** Costa's surface (A. Gray's formula), (u,v) in (0,1)^2. */
export function costa(u, v) {
  const z = [u, v];
  const a = zetaP(z);
  const b = zetaP([u - 0.5, v]).zeta;
  const c = zetaP([u, v - 0.5]).zeta;
  const pi = Math.PI;
  const k = pi / (2 * E1);
  const x = 0.5 * (-a.zeta[0] + pi * u + pi * pi / (4 * E1) + k * (b[0] - c[0]));
  // Re(-i w) = Im(w)
  const y = 0.5 * (a.zeta[1] + pi * v + pi * pi / (4 * E1) + k * (b[1] - c[1]));
  const num = [a.P[0] - E1, a.P[1]], den = [a.P[0] + E1, a.P[1]];
  const zc = (Math.sqrt(2 * pi) / 4) * Math.log(Math.hypot(num[0], num[1]) / Math.hypot(den[0], den[1]));
  return [x, y, zc];
}
