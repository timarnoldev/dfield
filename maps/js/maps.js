// Mathematics of the iterated maps lab: gallery definitions, orbits,
// periodic points with stability, Lyapunov exponents, rotation numbers and
// fixed points of planar maps. Pure functions, no DOM (unit-testable in node).

// ---------------------------------------------------------------- gallery (1D)
// params: [name, value, sliderMin, sliderMax]
export const GALLERY_1D = [
  {
    id: 'logistic', name: 'Logistic map', expr: 'r x (1 - x)',
    params: [['r', 3.2, 0, 4]], x0: 0.2, win: [0, 1, 0, 1],
    bif: { param: 'r', min: 2.8, max: 4, xmin: 0, xmax: 1 },
    plane: { type: 'markus', seq: 'AB', p: 'r', q: 'r', xmin: 2, xmax: 4, ymin: 2, ymax: 4 },
    description: 'The classic model of period doubling and chaos. Feigenbaum points are marked in the bifurcation diagram.',
  },
  {
    id: 'tent', name: 'Tent map', expr: 'mu min(x, 1 - x)',
    params: [['mu', 1.5, 0, 2]], x0: 0.2134, win: [0, 1, 0, 1],
    bif: { param: 'mu', min: 0.9, max: 2, xmin: 0, xmax: 1 },
    plane: { type: 'markus', seq: 'AB', p: 'mu', q: 'mu', xmin: 1, xmax: 2, ymin: 1, ymax: 2 },
    description: 'Piecewise linear; Lyapunov exponent ln(mu) on the attractor for mu > 1. Note: with mu = 2 floating-point orbits collapse to 0 (binary arithmetic).',
  },
  {
    id: 'sine', name: 'Sine map', expr: 'r sin(pi x)',
    params: [['r', 0.8, 0, 1]], x0: 0.2, win: [0, 1, 0, 1],
    bif: { param: 'r', min: 0.6, max: 1, xmin: 0, xmax: 1 },
    plane: { type: 'markus', seq: 'AB', p: 'r', q: 'r', xmin: 0.5, xmax: 1, ymin: 0.5, ymax: 1 },
    description: 'A unimodal map with the same universal Feigenbaum scaling as the logistic map.',
  },
  {
    id: 'gauss', name: 'Gauss (mouse) map', expr: 'exp(-a x^2) + b',
    params: [['a', 6.2, 0, 15], ['b', -0.5, -1, 1]], x0: 0, win: [-1, 1.4, -1, 1.4],
    bif: { param: 'b', min: -1, max: 1, xmin: -1, xmax: 1.4 },
    plane: { type: 'lyap2', seq: 'AB', p: 'b', q: 'a', xmin: -1, xmax: 1, ymin: 2, ymax: 12 },
    description: 'The Gaussian map. Its bifurcation diagram over b resembles a mouse; period doubling followed by reverse period halving.',
  },
  {
    id: 'cubic', name: 'Cubic map', expr: 'r x - x^3',
    params: [['r', 2.4, 0, 3]], x0: 0.1, win: [-2, 2, -2, 2],
    bif: { param: 'r', min: 1, max: 3, xmin: -2, xmax: 2 },
    plane: { type: 'markus', seq: 'AB', p: 'r', q: 'r', xmin: 1.5, xmax: 3, ymin: 1.5, ymax: 3 },
    description: 'Odd-symmetric map: symmetric attractors split by a pitchfork, then period doubling and merging crises. Orbits escape for r > 3.',
  },
  {
    id: 'circle', name: 'Circle map', expr: 'mod(x + W - K/(2pi) sin(2pi x), 1)',
    params: [['W', 0.3, 0, 1], ['K', 1, 0, 2]], x0: 0.1, win: [0, 1, 0, 1],
    bif: { param: 'W', min: 0, max: 1, xmin: 0, xmax: 1, strip: 'rot' },
    plane: { type: 'rot', seq: 'AB', p: 'W', q: 'K', xmin: 0, xmax: 1, ymin: 0, ymax: 1.25 },
    description: 'Standard circle map. Mode locking: the rotation number is a devil\'s staircase in W (K = 1); Arnold tongues in the (W, K) plane.',
  },
  {
    id: 'ricker', name: 'Ricker map', expr: 'x exp(r (1 - x))',
    params: [['r', 2.2, 0, 4]], x0: 0.5, win: [0, 6, 0, 6],
    bif: { param: 'r', min: 1.5, max: 4, xmin: 0, xmax: 6 },
    plane: { type: 'markus', seq: 'AB', p: 'r', q: 'r', xmin: 1.5, xmax: 4, ymin: 1.5, ymax: 4 },
    description: 'Ricker population model (fisheries). Period doubling route to chaos starting at r = 2.',
  },
  {
    id: 'quadratic', name: 'Quadratic map x² + c', expr: 'x^2 + c',
    params: [['c', -1.3, -2, 0.25]], x0: 0, win: [-2, 2, -2, 2],
    bif: { param: 'c', min: -2, max: 0.25, xmin: -2, xmax: 2 },
    plane: { type: 'markus', seq: 'AB', p: 'c', q: 'c', xmin: -2, xmax: 0.25, ymin: -2, ymax: 0.25 },
    description: 'Real slice of the Mandelbrot set: the bifurcation diagram is conjugate to the logistic one.',
  },
  {
    id: 'custom', name: 'User-defined', expr: 'r x (1 - x^2)',
    params: [['r', 2.2, 0, 2.6]], x0: 0.3, win: [-1.2, 1.2, -1.2, 1.2],
    bif: { param: 'r', min: 1.5, max: 2.6, xmin: -1.2, xmax: 1.2 },
    plane: { type: 'markus', seq: 'AB', p: 'r', q: 'r', xmin: 1.5, xmax: 2.6, ymin: 1.5, ymax: 2.6 },
    description: 'Enter your own map f(x) with up to four parameters.',
  },
];

// ---------------------------------------------------------------- gallery (2D)
export const GALLERY_2D = [
  {
    id: 'henon', name: 'Hénon map', ex: '1 - a x^2 + y', ey: 'b x',
    params: [['a', 1.4, 0, 1.5], ['b', 0.3, -0.5, 0.5]], win: [-1.5, 1.5, -0.45, 0.45],
    seeds: [[0.1, 0.1]], n: 100000, transient: 100, tap: 'replace',
    description: 'Hénon (1976): strange attractor with fractal (Cantor-like) cross section. Zoom in to see the layers.',
  },
  {
    id: 'lozi', name: 'Lozi map', ex: '1 - a abs(x) + y', ey: 'b x',
    params: [['a', 1.7, 0, 2], ['b', 0.5, -0.6, 0.6]], win: [-1.5, 1.5, -0.8, 0.8],
    seeds: [[0.1, 0.1]], n: 100000, transient: 100, tap: 'replace',
    description: 'Piecewise linear version of the Hénon map (Lozi 1978).',
  },
  {
    id: 'standard', name: 'Standard map', ex: 'mod(x + y + K sin(x), 2pi)', ey: 'mod(y + K sin(x) + pi, 2pi) - pi',
    params: [['K', 0.97, 0, 3]], win: [0, 2 * Math.PI, -Math.PI, Math.PI],
    seeds: [], n: 1500, transient: 0, tap: 'add', randomSeeds: 40,
    description: 'Chirikov standard map p\' = p + K sin θ, θ\' = θ + p\' (x = θ, y = p, both taken mod 2π). Area preserving: tap to add orbits, KAM curves break near K ≈ 0.9716.',
  },
  {
    id: 'ikeda', name: 'Ikeda map',
    ex: '1 + u (x cos(0.4 - 6/(1 + x^2 + y^2)) - y sin(0.4 - 6/(1 + x^2 + y^2)))',
    ey: 'u (x sin(0.4 - 6/(1 + x^2 + y^2)) + y cos(0.4 - 6/(1 + x^2 + y^2)))',
    params: [['u', 0.9, 0, 1]], win: [-0.6, 1.9, -2.5, 1.1],
    seeds: [[0.1, 0.1]], n: 100000, transient: 100, tap: 'replace',
    description: 'Ikeda map of light in a nonlinear optical ring cavity, phase t = 0.4 − 6/(1 + x² + y²). Chaotic attractor for u = 0.9; for larger u orbits may go to a distant stable fixed point.',
  },
  {
    id: 'tinkerbell', name: 'Tinkerbell map', ex: 'x^2 - y^2 + a x + b y', ey: '2 x y + c x + d y',
    params: [['a', 0.9, -1, 1], ['b', -0.6013, -1, 1], ['c', 2, 0, 3], ['d', 0.5, 0, 1]], win: [-1.4, 0.6, -1.7, 0.6],
    seeds: [[-0.72, -0.64]], n: 100000, transient: 100, tap: 'replace',
    description: 'The Tinkerbell map. Orbits from many initial points escape to infinity.',
  },
  {
    id: 'gingerbread', name: 'Gingerbreadman map', ex: '1 - y + abs(x)', ey: 'x',
    params: [], win: [-4, 8, -4, 8],
    seeds: [[-0.1, 0]], n: 30000, transient: 0, tap: 'add',
    description: 'Piecewise linear, area preserving (Devaney). Chaotic regions surround stable hexagonal islands; tap to add orbits.',
  },
  {
    id: 'custom2', name: 'User-defined', ex: 'y', ey: 'a y (1 - x)',
    params: [['a', 2.1, 1.5, 2.3]], win: [0, 1.2, 0, 1.2],
    seeds: [[0.3, 0.4]], n: 50000, transient: 500, tap: 'replace',
    description: 'Enter your own map. Default: delayed logistic map (Neimark–Sacker bifurcation at a = 2).',
  },
];

// Feigenbaum period-doubling points of the logistic map r x (1 - x)
export const LOGISTIC_FEIGENBAUM = [
  { r: 3, label: 'r₁ = 3' },
  { r: 1 + Math.sqrt(6), label: 'r₂ = 1+√6' },
  { r: 3.5440903595519, label: 'r₃' },
  { r: 3.5644072660954, label: 'r₄' },
  { r: 3.5687594195, label: 'r₅' },
  { r: 3.5696916098, label: 'r₆' },
  { r: 3.5699456718, label: 'r∞' },
  { r: 1 + Math.sqrt(8), label: '1+√8 (period 3)' },
];
export const FEIGENBAUM_DELTA = 4.669201609102990;

// ---------------------------------------------------------------- 1D basics
/** Orbit x_0 .. x_n. Stops (NaN-filled) if the orbit diverges. */
export function orbit1D(f, x0, n, transient = 0) {
  let x = x0;
  for (let i = 0; i < transient && Number.isFinite(x); i++) x = f(x);
  const out = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    out[i] = x;
    x = Number.isFinite(x) && Math.abs(x) < 1e150 ? f(x) : NaN;
  }
  return out;
}

export function iterateK(f, x, k) {
  for (let i = 0; i < k; i++) x = f(x);
  return x;
}

/** Derivative of f^k at x via the chain rule. */
export function multiplier(f, df, x, k) {
  let m = 1;
  for (let i = 0; i < k; i++) { m *= df(x); x = f(x); }
  return m;
}

/** Lyapunov exponent: mean of ln|f'(x_n)| along the orbit. */
export function lyapunov1D(f, df, x0, transient, n) {
  let x = x0;
  for (let i = 0; i < transient; i++) x = f(x);
  // accumulate the product of |f'| and take logs only when it gets large/small (fast)
  let s = 0;
  let prod = 1;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(df(x));
    if (d > 1e-300) prod *= d; else s -= 690;
    if (prod > 1e100 || prod < 1e-100) { s += Math.log(prod); prod = 1; }
    x = f(x);
    if (!Number.isFinite(x)) return NaN;
  }
  return (s + Math.log(prod)) / n;
}

/** Rotation number of a circle-map lift: lim (X_n - X_0)/n. */
export function rotationNumber(lift, x0, transient, n) {
  let x = x0;
  for (let i = 0; i < transient; i++) {
    x = lift(x);
    const fl = Math.floor(x); // keep the lift bounded, rotation number unaffected
    x -= fl;
  }
  const start = x;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const nx = lift(x);
    const fl = Math.floor(nx);
    total += fl;
    x = nx - fl;
  }
  return (total + x - start) / n;
}

/**
 * Detect mode locking: after the transient, find the smallest q <= qmax with
 * X_{q} - X_0 within eps of an integer p. Returns {p, q} or null.
 */
export function lockedRatio(lift, x0, transient, qmax, eps = 1e-6) {
  let x = x0;
  for (let i = 0; i < transient; i++) { x = lift(x); x -= Math.floor(x); }
  const start = x;
  let total = 0;
  for (let q = 1; q <= qmax; q++) {
    const nx = lift(x);
    const fl = Math.floor(nx);
    total += fl;
    x = nx - fl;
    let d = x - start;
    let p = total;
    if (d > 0.5) { d -= 1; p += 1; } else if (d < -0.5) { d += 1; p -= 1; }
    if (Math.abs(d) < eps) return { p, q };
  }
  return null;
}

/**
 * Rotation number with mode-locking detection in one pass: after the transient,
 * if X_q - X_0 is within eps of an integer p for some q <= qmax the orbit is
 * periodic (locked, rho = p/q); otherwise rho = (X_N - X_0)/N.
 */
export function rotationInfo(lift, x0, T, N, qmax, eps = 1e-6) {
  let x = x0;
  for (let i = 0; i < T; i++) { x = lift(x); x -= Math.floor(x); }
  const start = x;
  let total = 0;
  for (let q = 1; q <= N; q++) {
    const nx = lift(x);
    const fl = Math.floor(nx);
    total += fl;
    x = nx - fl;
    if (q <= qmax) {
      let d = x - start;
      let p = total;
      if (d > 0.5) { d -= 1; p += 1; } else if (d < -0.5) { d += 1; p -= 1; }
      if (Math.abs(d) < eps) return { v: p / q, p, q };
    }
    if (!Number.isFinite(x)) return { v: NaN, p: 0, q: 0 };
  }
  return { v: (total + x - start) / N, p: 0, q: 0 };
}

/** Best rational approximation p/q (q <= qmax) of v within tol, else null. */
export function rationalApprox(v, qmax, tol) {
  for (let q = 1; q <= qmax; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v - p / q) <= tol) return { p, q };
  }
  return null;
}

/**
 * Periodic points of minimal period k inside [a, b]: roots of f^k(x) - x.
 * Returns [{x, period, mult, stable, orbit}] sorted by x. Each point is listed;
 * points belonging to the same cycle share `cycle` (index).
 */
export function periodicPoints(f, df, k, a, b, samples) {
  const N = samples || Math.min(40000, Math.max(2000, 120 * 2 ** k));
  const g = (x) => iterateK(f, x, k) - x;
  const roots = [];
  const tolAccept = (x) => 1e-7 * (1 + Math.abs(x));
  const addRoot = (r) => {
    if (!(r >= a - 1e-12 && r <= b + 1e-12)) return;
    if (roots.some((q) => Math.abs(q - r) < 1e-9 * (1 + Math.abs(r)))) return;
    roots.push(r);
  };
  const xs = new Float64Array(N + 1);
  const gs = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { xs[i] = a + (b - a) * i / N; gs[i] = g(xs[i]); }
  const bis = (lo, hi) => {
    let glo = g(lo);
    for (let it = 0; it < 200 && hi - lo > 1e-15 * (1 + Math.abs(lo)); it++) {
      const m = 0.5 * (lo + hi);
      const gm = g(m);
      if (!Number.isFinite(gm)) break;
      if (gm === 0) return m;
      if ((gm < 0) === (glo < 0)) { lo = m; glo = gm; } else hi = m;
    }
    return 0.5 * (lo + hi);
  };
  for (let i = 0; i <= N; i++) {
    const g0 = gs[i];
    if (!Number.isFinite(g0)) continue;
    if (g0 === 0) { addRoot(xs[i]); continue; }
    if (i < N && Number.isFinite(gs[i + 1]) && g0 * gs[i + 1] < 0) {
      const r = bis(xs[i], xs[i + 1]);
      // reject sign changes caused by discontinuities (e.g. mod)
      if (Math.abs(g(r)) < tolAccept(r)) addRoot(r);
    }
    // a pair of nearby roots (or a tangency) hidden between samples:
    // |g| has a local minimum without a sign change
    if (i > 0 && i < N && Number.isFinite(gs[i - 1]) && Number.isFinite(gs[i + 1]) &&
        g0 * gs[i - 1] > 0 && g0 * gs[i + 1] > 0 && Math.abs(g0) <= Math.abs(gs[i - 1]) && Math.abs(g0) <= Math.abs(gs[i + 1])) {
      const sg = g0 > 0 ? 1 : -1;
      let lo = xs[i - 1], hi = xs[i + 1];
      const gr = 0.6180339887498949;
      let c = hi - gr * (hi - lo), d = lo + gr * (hi - lo);
      let fc = sg * g(c), fd = sg * g(d);
      let crossed = null;
      for (let it = 0; it < 80 && hi - lo > 1e-15 * (1 + Math.abs(lo)); it++) {
        if (fc < 0) { crossed = c; break; }
        if (fd < 0) { crossed = d; break; }
        if (fc < fd) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = sg * g(c); }
        else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = sg * g(d); }
      }
      if (crossed !== null) {
        const r1 = bis(xs[i - 1], crossed);
        const r2 = bis(crossed, xs[i + 1]);
        if (Math.abs(g(r1)) < tolAccept(r1)) addRoot(r1);
        if (Math.abs(g(r2)) < tolAccept(r2)) addRoot(r2);
      } else {
        const m = 0.5 * (lo + hi);
        if (Math.abs(g(m)) < 1e-10 * (1 + Math.abs(m))) addRoot(m); // tangency
      }
    }
  }
  roots.sort((p, q) => p - q);
  const out = [];
  for (const r of roots) {
    // minimal period
    let minimal = k;
    for (let d = 1; d < k; d++) {
      if (k % d) continue;
      if (Math.abs(iterateK(f, r, d) - r) < 1e-7 * (1 + Math.abs(r))) { minimal = d; break; }
    }
    if (minimal !== k) continue;
    const orbit = [];
    let y = r;
    for (let i = 0; i < k; i++) { orbit.push(y); y = f(y); }
    const mult = multiplier(f, df, r, k);
    const am = Math.abs(mult);
    out.push({
      x: r, period: k, mult, orbit,
      stability: Math.abs(am - 1) < 1e-6 ? 'neutral' : am < 1 ? 'stable' : 'unstable',
      stable: am < 1 - 1e-6,
    });
  }
  // group cycles
  let cyc = 0;
  for (const p of out) {
    if (p.cycle !== undefined) continue;
    for (const q of out) {
      if (q.cycle === undefined && p.orbit.some((z) => Math.abs(z - q.x) < 1e-6 * (1 + Math.abs(z)))) q.cycle = cyc;
    }
    if (p.cycle === undefined) p.cycle = cyc;
    cyc++;
  }
  return out;
}

/** Find r in [lo, hi] where g(r) = target by bisection (g continuous, sign change). */
export function bisect(g, lo, hi, it = 100) {
  let glo = g(lo);
  for (let i = 0; i < it; i++) {
    const m = 0.5 * (lo + hi);
    const gm = g(m);
    if ((gm < 0) === (glo < 0)) { lo = m; glo = gm; } else hi = m;
  }
  return 0.5 * (lo + hi);
}

/** Invariant density histogram of an orbit. */
export function histogram(f, x0, transient, n, a, b, bins) {
  const h = new Float64Array(bins);
  let x = x0;
  for (let i = 0; i < transient; i++) x = f(x);
  let inside = 0;
  const s = bins / (b - a);
  for (let i = 0; i < n; i++) {
    x = f(x);
    if (!Number.isFinite(x)) break;
    const j = Math.floor((x - a) * s);
    if (j >= 0 && j < bins) { h[j]++; inside++; }
  }
  // normalize to a probability density over all iterates
  const norm = n > 0 ? 1 / (n / s) : 0;
  for (let j = 0; j < bins; j++) h[j] *= norm;
  return { h, inside, total: n };
}

// ---------------------------------------------------------------- 2D
/** Fixed points of a planar map via Newton from a grid of seeds. */
export function fixedPoints2D(F, J, win, grid = 14) {
  const [x0, x1, y0, y1] = win;
  const o = new Float64Array(2);
  const j = new Float64Array(4);
  const found = [];
  const scale = Math.max(x1 - x0, y1 - y0);
  for (let gi = 0; gi < grid; gi++) {
    for (let gj = 0; gj < grid; gj++) {
      let x = x0 + (x1 - x0) * (gi + 0.5) / grid;
      let y = y0 + (y1 - y0) * (gj + 0.5) / grid;
      let ok = false;
      for (let it = 0; it < 40; it++) {
        F(x, y, o);
        const gx = o[0] - x, gy = o[1] - y;
        if (!Number.isFinite(gx) || !Number.isFinite(gy)) break;
        if (Math.hypot(gx, gy) < 1e-12 * (1 + Math.hypot(x, y))) { ok = true; break; }
        J(x, y, j);
        const a = j[0] - 1, b = j[1], c = j[2], d = j[3] - 1;
        const det = a * d - b * c;
        if (!det || !Number.isFinite(det)) break;
        let dx = (d * gx - b * gy) / det;
        let dy = (-c * gx + a * gy) / det;
        const st = Math.hypot(dx, dy);
        if (st > scale) { dx *= scale / st; dy *= scale / st; }
        x -= dx; y -= dy;
      }
      if (!ok) {
        F(x, y, o);
        ok = Number.isFinite(x) && Math.hypot(o[0] - x, o[1] - y) < 1e-9 * (1 + Math.hypot(x, y));
      }
      if (!ok) continue;
      const mx = x0 - 0.05 * (x1 - x0), Mx = x1 + 0.05 * (x1 - x0);
      const my = y0 - 0.05 * (y1 - y0), My = y1 + 0.05 * (y1 - y0);
      if (x < mx || x > Mx || y < my || y > My) continue;
      if (found.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-6 * scale)) continue;
      if (Math.abs(x) < 1e-12 * scale) x = 0;
      if (Math.abs(y) < 1e-12 * scale) y = 0;
      J(x, y, j);
      found.push({ x, y, ...classify2D(j[0], j[1], j[2], j[3]) });
    }
  }
  return found;
}

/** Eigenvalues & type of a 2x2 Jacobian at a fixed point. */
export function classify2D(a, b, c, d) {
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  let eig, type;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    const l1 = (tr + s) / 2, l2 = (tr - s) / 2;
    eig = [l1, l2];
    const m1 = Math.abs(l1), m2 = Math.abs(l2);
    if (m1 < 1 && m2 < 1) type = 'attracting';
    else if (m1 > 1 && m2 > 1) type = 'repelling';
    else if ((m1 - 1) * (m2 - 1) < 0) type = 'saddle';
    else type = 'non-hyperbolic';
  } else {
    const mod = Math.sqrt(det);
    eig = [{ re: tr / 2, im: Math.sqrt(-disc) / 2 }, { re: tr / 2, im: -Math.sqrt(-disc) / 2 }];
    if (Math.abs(mod - 1) < 1e-9) type = 'elliptic';
    else type = mod < 1 ? 'attracting (spiral)' : 'repelling (spiral)';
  }
  return { eig, det, tr, type };
}

/** Exact invariant densities for special cases (used as overlay). */
export function exactDensity(mapId, expr, params) {
  if (mapId === 'logistic' && Math.abs(params.r - 4) < 1e-12) {
    return { label: '1 / (π √(x(1−x)))', fn: (x) => (x > 0 && x < 1 ? 1 / (Math.PI * Math.sqrt(x * (1 - x))) : 0) };
  }
  if (mapId === 'tent' && Math.abs(params.mu - 2) < 1e-12) {
    return { label: 'uniform density 1', fn: (x) => (x >= 0 && x <= 1 ? 1 : 0) };
  }
  if (mapId === 'quadratic' && Math.abs(params.c + 2) < 1e-12) {
    return { label: '1 / (π √(4−x²))', fn: (x) => (Math.abs(x) < 2 ? 1 / (Math.PI * Math.sqrt(4 - x * x)) : 0) };
  }
  return null;
}

/**
 * One pixel of a parameter-plane picture for a compiled 1D map cm = {f, df, lift, P}.
 * type 'markus': parameter ka alternates between a (A) and b (B) following isA[];
 * 'lyap2': P[ka] = a, P[kb] = b, Lyapunov exponent; 'rot': rotation number of the lift
 * with mode-locking detection. Returns { v, p, q } (q = 0: not locked).
 */
export function planePixel(cm, type, ka, kb, isA, x0, T, N, a, b, qmax) {
  const { f, df, lift, P } = cm;
  if (type === 'rot') {
    P[ka] = a; P[kb] = b;
    return rotationInfo(lift, x0, T, N, qmax);
  }
  const L = isA.length;
  let x = x0;
  if (type === 'lyap2') { P[ka] = a; P[kb] = b; }
  const markus = type === 'markus';
  for (let t = 0; t < T; t++) {
    if (markus) P[ka] = isA[t % L] ? a : b;
    x = f(x);
    if (!(x > -1e100 && x < 1e100)) return { v: NaN, p: 0, q: 0 };
  }
  let sum = 0;
  let prod = 1;
  for (let t = 0; t < N; t++) {
    if (markus) P[ka] = isA[(T + t) % L] ? a : b;
    const d = Math.abs(df(x));
    if (d > 1e-300) prod *= d; else sum -= 690;
    if (prod > 1e100 || prod < 1e-100) { sum += Math.log(prod); prod = 1; }
    x = f(x);
    if (!(x > -1e100 && x < 1e100)) return { v: NaN, p: 0, q: 0 };
  }
  return { v: (sum + Math.log(prod)) / N, p: 0, q: 0 };
}

/** Pixels (i indices) of row j at refinement level s (coarse-to-fine, skipping finished ones). */
export function levelRow(j, s, gw, top) {
  const out = [];
  for (let i = 0; i < gw; i += s) {
    if (s < top && i % (2 * s) === 0 && j % (2 * s) === 0) continue;
    out.push(i);
  }
  return out;
}
