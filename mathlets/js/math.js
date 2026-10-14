// Numerical helpers shared by the mathlets.

export const TAU = 2 * Math.PI;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

// ------------------------------------------------------------------ formatting
function stripZeros(s) { return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s; }
/** Number with up to `sig` significant digits; uses the minus sign U+2212. */
export function fmt(v, sig = 4) {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const a = Math.abs(v);
  let s;
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    s = `${stripZeros(m)}·10^${Number(e)}`;
    s = s.replace(/\^(-?\d+)$/, (_, d) => toSup(d));
  } else if (a === 0) s = '0';
  else {
    const dec = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    s = stripZeros(v.toFixed(Math.min(12, dec)));
  }
  return s.replace(/^-/, '−');
}
/** Fixed decimals with unicode minus. */
export function fix(v, d = 2) {
  if (!Number.isFinite(v)) return fmt(v);
  const s = v.toFixed(d);
  return (Number(s) === 0 ? (0).toFixed(d) : s).replace(/^-/, '−');
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const toSup = (s) => String(s).split('').map((c) => SUP[c] ?? c).join('');
export function fmtPi(v) {
  const r = v / Math.PI;
  if (Math.abs(r - Math.round(r)) < 1e-9) {
    const k = Math.round(r);
    return k === 0 ? '0' : k === 1 ? 'π' : k === -1 ? '−π' : `${fmt(k)}π`;
  }
  const h = r * 2;
  if (Math.abs(h - Math.round(h)) < 1e-9) {
    const k = Math.round(h);
    return k === 1 ? 'π/2' : k === -1 ? '−π/2' : `${fmt(k)}π/2`;
  }
  return fmt(v, 3);
}

/** Nice tick positions spanning [lo, hi] with roughly n intervals. */
export function niceTicks(lo, hi, n) {
  n = Math.max(1, n);
  const raw = (hi - lo) / n;
  if (!(raw > 0) || !Number.isFinite(raw)) return { ticks: [lo], step: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let m = raw / mag;
  m = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  const step = m * mag;
  const first = step * Math.ceil(lo / step - 1e-9);
  const ticks = [];
  for (let i = 0; i < 500; i++) {
    const v = first + i * step;
    if (v > hi + step * 1e-9) break;
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { ticks, step };
}
export function tickLabel(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-4) return fmt(v, 2);
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(d).replace(/^-/, '−');
}

// ------------------------------------------------------------------ ODEs
/** One classical RK4 step for y' = f(t, y) with y an array. */
export function rk4Step(f, t, y, h) {
  const n = y.length;
  const k1 = f(t, y);
  const y2 = new Array(n); for (let i = 0; i < n; i++) y2[i] = y[i] + (h / 2) * k1[i];
  const k2 = f(t + h / 2, y2);
  const y3 = new Array(n); for (let i = 0; i < n; i++) y3[i] = y[i] + (h / 2) * k2[i];
  const k3 = f(t + h / 2, y3);
  const y4 = new Array(n); for (let i = 0; i < n; i++) y4[i] = y[i] + h * k3[i];
  const k4 = f(t + h, y4);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

// ------------------------------------------------------------------ integration
/** Adaptive Simpson quadrature. */
export function integrate(f, a, b, tol = 1e-10, maxDepth = 40) {
  if (a === b) return 0;
  const simpson = (fa, fm, fb, a0, b0) => ((b0 - a0) / 6) * (fa + 4 * fm + fb);
  function rec(a0, b0, fa, fm, fb, whole, eps, depth) {
    const m = (a0 + b0) / 2;
    const lm = (a0 + m) / 2, rm = (m + b0) / 2;
    const flm = f(lm), frm = f(rm);
    const left = simpson(fa, flm, fm, a0, m), right = simpson(fm, frm, fb, m, b0);
    const delta = left + right - whole;
    if (depth <= 0 || Math.abs(delta) <= 15 * eps || !Number.isFinite(delta)) return left + right + delta / 15;
    return rec(a0, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b0, fm, frm, fb, right, eps / 2, depth - 1);
  }
  // split into pieces to be robust with oscillating / kinked integrands
  const pieces = 16;
  let sum = 0;
  for (let i = 0; i < pieces; i++) {
    const a0 = a + ((b - a) * i) / pieces, b0 = a + ((b - a) * (i + 1)) / pieces;
    const fa = f(a0), fb = f(b0), fm = f((a0 + b0) / 2);
    sum += rec(a0, b0, fa, fm, fb, simpson(fa, fm, fb, a0, b0), tol / pieces, maxDepth);
  }
  return sum;
}

// ------------------------------------------------------------------ polynomials / complex
/** Real polynomial coefficients (highest degree first) from a list of complex roots [re, im]. */
export function polyFromRoots(roots) {
  let re = [1], im = [0];
  for (const [r, i] of roots) {
    const nre = new Array(re.length + 1).fill(0), nim = new Array(re.length + 1).fill(0);
    for (let k = 0; k < re.length; k++) {
      nre[k] += re[k]; nim[k] += im[k];
      // multiply by -(r + i i)
      nre[k + 1] += -(re[k] * r - im[k] * i);
      nim[k + 1] += -(re[k] * i + im[k] * r);
    }
    re = nre; im = nim;
  }
  return re;
}
/** Evaluate polynomial (highest first) at complex z = (x, y). Returns [re, im]. */
export function polyEvalC(c, x, y) {
  let re = 0, im = 0;
  for (const a of c) { const nr = re * x - im * y + a; im = re * y + im * x; re = nr; }
  return [re, im];
}

// ------------------------------------------------------------------ contours
/**
 * Marching squares: returns list of segments [x1,y1,x2,y2] for level set g(x,y)=c
 * on the box with nx*ny cells.
 */
export function contour(g, c, xmin, xmax, ymin, ymax, nx, ny) {
  const vals = new Float64Array((nx + 1) * (ny + 1));
  const xs = (i) => xmin + ((xmax - xmin) * i) / nx;
  const ys = (j) => ymin + ((ymax - ymin) * j) / ny;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = g(xs(i), ys(j)) - c;
  const segs = [];
  const interp = (x1, y1, v1, x2, y2, v2) => { const t = v1 / (v1 - v2); return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]; };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v00 = vals[j * (nx + 1) + i], v10 = vals[j * (nx + 1) + i + 1];
      const v01 = vals[(j + 1) * (nx + 1) + i], v11 = vals[(j + 1) * (nx + 1) + i + 1];
      if (![v00, v10, v01, v11].every(Number.isFinite)) continue;
      const x0 = xs(i), x1 = xs(i + 1), y0 = ys(j), y1 = ys(j + 1);
      const pts = [];
      if ((v00 < 0) !== (v10 < 0)) pts.push(interp(x0, y0, v00, x1, y0, v10));
      if ((v10 < 0) !== (v11 < 0)) pts.push(interp(x1, y0, v10, x1, y1, v11));
      if ((v11 < 0) !== (v01 < 0)) pts.push(interp(x1, y1, v11, x0, y1, v01));
      if ((v01 < 0) !== (v00 < 0)) pts.push(interp(x0, y1, v01, x0, y0, v00));
      // reject spurious crossings at poles (huge jumps)
      const span = Math.max(Math.abs(v00), Math.abs(v10), Math.abs(v01), Math.abs(v11));
      if (span > 1e6) continue;
      if (pts.length === 2) segs.push([...pts[0], ...pts[1]]);
      else if (pts.length === 4) { segs.push([...pts[0], ...pts[1]]); segs.push([...pts[2], ...pts[3]]); }
    }
  }
  return segs;
}

// ------------------------------------------------------------------ Fourier
/**
 * Fourier coefficients of a 2π-periodic function given on [-π, π] (numerical, midpoint rule).
 * Returns { a: [a0..aN], b: [0, b1..bN] } with f ~ a0/2 + Σ a_n cos nx + b_n sin nx.
 */
export function fourierNumeric(f, N, M = 8192) {
  const a = new Array(N + 1).fill(0), b = new Array(N + 1).fill(0);
  const h = TAU / M;
  for (let i = 0; i < M; i++) {
    const x = -Math.PI + (i + 0.5) * h;
    const v = f(x);
    if (!Number.isFinite(v)) continue;
    // use recurrence for cos(nx), sin(nx)
    const c1 = Math.cos(x), s1 = Math.sin(x);
    let c = 1, s = 0;
    for (let n = 0; n <= N; n++) {
      a[n] += v * c; b[n] += v * s;
      const nc = c * c1 - s * s1; s = s * c1 + c * s1; c = nc;
    }
  }
  for (let n = 0; n <= N; n++) { a[n] *= h / Math.PI; b[n] *= h / Math.PI; }
  b[0] = 0;
  return { a, b };
}
/** Evaluate a0/2 + Σ_{n=1..N} a_n cos nx + b_n sin nx. */
export function fourierEval(a, b, N, x) {
  const c1 = Math.cos(x), s1 = Math.sin(x);
  let c = c1, s = s1, sum = a[0] / 2;
  for (let n = 1; n <= N; n++) {
    sum += (a[n] || 0) * c + (b[n] || 0) * s;
    const nc = c * c1 - s * s1; s = s * c1 + c * s1; c = nc;
  }
  return sum;
}

/** Mulberry32 pseudo random generator. */
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
