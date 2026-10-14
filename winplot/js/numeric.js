// Numerical core: root finding, minimisation, quadrature, ODE integration,
// marching squares, adaptive curve sampling and axis tick helpers.

const EPS = 1e-12;

/** Brent's method for a root of f in [a,b] with f(a)*f(b) <= 0. */
export function brentRoot(f, a, b, tol = 1e-13, maxIter = 200) {
  let fa = f(a), fb = f(b);
  if (!(fa * fb <= 0)) return NaN;
  if (fa === 0) return a;
  if (fb === 0) return b;
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol1 = 2 * EPS * Math.abs(b) + 0.5 * tol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p, q;
      if (a === c) { p = 2 * m * s; q = 1 - s; } else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol1 * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = d; }
    } else { d = m; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : (m > 0 ? tol1 : -tol1);
    fb = f(b);
    if (Number.isNaN(fb)) return NaN;
  }
  return b;
}

/** Brent's minimiser on [a,b]. Returns x of a local minimum. */
export function brentMin(f, a, b, tol = 1e-10, maxIter = 200) {
  const g = 0.3819660112501051;
  let x = a + g * (b - a), w = x, v = x;
  let fx = f(x), fw = fx, fv = fx;
  let d = 0, e = 0;
  for (let i = 0; i < maxIter; i++) {
    const m = 0.5 * (a + b);
    const tol1 = tol * Math.abs(x) + 1e-12, tol2 = 2 * tol1;
    if (Math.abs(x - m) <= tol2 - 0.5 * (b - a)) break;
    let useGolden = true;
    if (Math.abs(e) > tol1) {
      let r = (x - w) * (fx - fv), q = (x - v) * (fx - fw), p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p; else q = -q;
      if (Math.abs(p) < Math.abs(0.5 * q * e) && p > q * (a - x) && p < q * (b - x)) {
        e = d; d = p / q; useGolden = false;
        const u = x + d;
        if (u - a < tol2 || b - u < tol2) d = m > x ? tol1 : -tol1;
      }
    }
    if (useGolden) { e = (x < m ? b : a) - x; d = g * e; }
    const u = x + (Math.abs(d) >= tol1 ? d : d > 0 ? tol1 : -tol1);
    const fu = f(u);
    if (fu <= fx) {
      if (u < x) b = x; else a = x;
      v = w; fv = fw; w = x; fw = fx; x = u; fx = fu;
    } else {
      if (u < x) a = u; else b = u;
      if (fu <= fw || w === x) { v = w; fv = fw; w = u; fw = fu; } else if (fu <= fv || v === x || v === w) { v = u; fv = fu; }
    }
  }
  return x;
}

/** Numerical derivative (Richardson-extrapolated central difference). */
export function numDeriv(f, x, h) {
  h = h || Math.max(1e-5, Math.abs(x) * 1e-5);
  const d1 = (f(x + h) - f(x - h)) / (2 * h);
  const d2 = (f(x + h / 2) - f(x - h / 2)) / h;
  return (4 * d2 - d1) / 3;
}

/** All roots of f in [a,b]: sign changes on a fine grid, refined with Brent. Also catches touching zeros. */
export function findRoots(f, a, b, n = 2000) {
  const roots = [];
  const h = (b - a) / n;
  let x0 = a, f0 = f(a);
  const push = (r) => {
    if (!Number.isFinite(r)) return;
    if (roots.length && Math.abs(roots[roots.length - 1] - r) < h * 0.01) return;
    roots.push(r);
  };
  if (f0 === 0) push(a);
  let fm1 = NaN;
  for (let i = 1; i <= n; i++) {
    const x1 = a + i * h;
    const f1 = f(x1);
    if (Number.isFinite(f0) && Number.isFinite(f1)) {
      if (f1 === 0) push(x1);
      else if (f0 * f1 < 0) {
        const r = brentRoot(f, x0, x1);
        // reject poles: |f| must actually become small
        const fr = Math.abs(f(r));
        if (fr < 1e-6 * Math.max(1, Math.abs(f0), Math.abs(f1)) || fr < 1e-9) push(r);
      } else if (Number.isFinite(fm1) && Math.abs(f0) < Math.abs(fm1) && Math.abs(f0) < Math.abs(f1) && fm1 * f0 > 0 && f0 * f1 > 0) {
        // local min of |f| – possible double root
        const xm = brentMin((x) => Math.abs(f(x)), x0 - h, x1);
        if (Math.abs(f(xm)) < 1e-9 * Math.max(1, Math.abs(f1))) push(xm);
      }
    }
    fm1 = f0; x0 = x1; f0 = f1;
  }
  return roots;
}

/** Local extrema of f in (a,b). Returns [{x, y, kind:'max'|'min'}]. */
export function findExtrema(f, a, b, n = 2000) {
  const out = [];
  const h = (b - a) / n;
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) ys[i] = f(a + i * h);
  for (let i = 1; i < n; i++) {
    const y0 = ys[i - 1], y1 = ys[i], y2 = ys[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    let kind = null;
    if (y1 > y0 && y1 >= y2) kind = 'max';
    else if (y1 < y0 && y1 <= y2) kind = 'min';
    if (!kind) continue;
    const s = kind === 'max' ? -1 : 1;
    const xl = a + (i - 1) * h, xr = a + (i + 1) * h;
    const x = brentMin((t) => s * f(t), xl, xr);
    const y = f(x);
    // reject poles (tan x, 1/x): there the refined value runs away from the grid values
    // and the minimiser ends up at the edge of the bracket
    if (!Number.isFinite(y)) continue;
    const jump = Math.abs(y1 - y0) + Math.abs(y1 - y2);
    if (Math.abs(y - y1) > 4 * jump + 1e-12 * Math.max(1, Math.abs(y1))) continue;
    if (x - xl < h * 1e-3 || xr - x < h * 1e-3) continue;
    if (out.length && Math.abs(out[out.length - 1].x - x) < h * 0.01) continue;
    out.push({ x, y, kind });
  }
  return out;
}

/** Adaptive Gauss–Kronrod (7-15) quadrature. Returns { value, error }. */
const GK_X = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.586087235467691, 0.405845151377397, 0.207784955007898, 0];
const GK_WK = [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const GK_WG = [0.129484966168870, 0.279705391489277, 0.381830050505119, 0.417959183673469];
function gk15(f, a, b) {
  const c = 0.5 * (a + b), h = 0.5 * (b - a);
  const fc = f(c);
  let k = fc * GK_WK[7], g = fc * GK_WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * GK_X[j];
    const f1 = f(c - dx), f2 = f(c + dx);
    k += GK_WK[j] * (f1 + f2);
    if (j % 2 === 1) g += GK_WG[(j - 1) / 2] * (f1 + f2);
  }
  return { value: k * h, error: Math.abs((k - g) * h) };
}
export function integrate(f, a, b, tol = 1e-10, maxDepth = 40) {
  if (a === b) return { value: 0, error: 0 };
  let evals = 0;
  const g = (x) => { evals++; const v = f(x); return Number.isFinite(v) ? v : NaN; };
  function rec(lo, hi, whole, depth, tolLocal) {
    const m = 0.5 * (lo + hi);
    const L = gk15(g, lo, m), R = gk15(g, m, hi);
    const sum = L.value + R.value;
    const err = L.error + R.error;
    if (depth >= maxDepth || evals > 400000 || err <= tolLocal || Math.abs(hi - lo) < 1e-14 * Math.max(1, Math.abs(lo))) {
      return { value: sum, error: err };
    }
    const l = rec(lo, m, L, depth + 1, tolLocal / 2);
    const r = rec(m, hi, R, depth + 1, tolLocal / 2);
    return { value: l.value + r.value, error: l.error + r.error };
  }
  const first = gk15(g, a, b);
  const res = rec(a, b, first, 0, Math.max(tol, tol * Math.abs(first.value)));
  return res;
}

/** Arc length of a parametric curve (x(t), y(t)) for t in [a,b]. */
export function arcLength(xf, yf, a, b) {
  const sp = (t) => Math.hypot(numDeriv(xf, t), numDeriv(yf, t));
  return integrate(sp, a, b, 1e-8);
}

// ---------------------------------------------------------------- ODE
/** Classic RK4 for y' = f(x, y). */
export function rk4Step(f, x, y, h) {
  const k1 = f(x, y);
  const k2 = f(x + h / 2, y + (h / 2) * k1);
  const k3 = f(x + h / 2, y + (h / 2) * k2);
  const k4 = f(x + h, y + h * k3);
  return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

/**
 * Dormand–Prince 5(4) adaptive integration of y' = f(x,y) from (x0,y0) in direction dir (+1/-1)
 * until x leaves [xlo, xhi] or y leaves [ylo, yhi]. Returns array of [x, y].
 * Outputs dense points at most every `maxDx` in x.
 */
export function solveODE(f, x0, y0, dir, box, opts = {}) {
  const { xlo, xhi, ylo, yhi } = box;
  const span = xhi - xlo;
  const tol = opts.tol ?? 1e-7;
  const hmax = opts.hmax ?? span / 100;
  const maxSteps = opts.maxSteps ?? 20000;
  const pts = [[x0, y0]];
  let x = x0, y = y0, h = dir * hmax / 4;
  let k1 = f(x, y);
  if (!Number.isFinite(k1)) return pts;
  for (let step = 0; step < maxSteps; step++) {
    if (dir > 0 && x >= xhi) break;
    if (dir < 0 && x <= xlo) break;
    let accepted = false;
    let yn, k7, err;
    for (let tries = 0; tries < 60 && !accepted; tries++) {
      const k2 = f(x + h * 0.2, y + h * 0.2 * k1);
      const k3 = f(x + h * 0.3, y + h * (0.075 * k1 + 0.225 * k2));
      const k4 = f(x + h * 0.8, y + h * (44 / 45 * k1 - 56 / 15 * k2 + 32 / 9 * k3));
      const k5 = f(x + h * 8 / 9, y + h * (19372 / 6561 * k1 - 25360 / 2187 * k2 + 64448 / 6561 * k3 - 212 / 729 * k4));
      const k6 = f(x + h, y + h * (9017 / 3168 * k1 - 355 / 33 * k2 + 46732 / 5247 * k3 + 49 / 176 * k4 - 5103 / 18656 * k5));
      yn = y + h * (35 / 384 * k1 + 500 / 1113 * k3 + 125 / 192 * k4 - 2187 / 6784 * k5 + 11 / 84 * k6);
      k7 = f(x + h, yn);
      err = Math.abs(h * (71 / 57600 * k1 - 71 / 16695 * k3 + 71 / 1920 * k4 - 17253 / 339200 * k5 + 22 / 525 * k6 - 1 / 40 * k7));
      const sc = tol * (1 + Math.max(Math.abs(y), Math.abs(yn)));
      if (Number.isFinite(err) && Number.isFinite(yn) && err <= sc) {
        accepted = true;
      } else {
        const fac = Number.isFinite(err) && err > 0 ? Math.max(0.1, 0.9 * Math.pow(sc / err, 0.2)) : 0.25;
        h *= fac;
        if (Math.abs(h) < 1e-12 * Math.max(1, span)) return pts;
      }
    }
    if (!accepted) return pts;
    x += h; y = yn; k1 = k7;
    pts.push([x, y]);
    if (y > yhi || y < ylo || !Number.isFinite(k1)) break;
    const fac = err > 0 ? Math.min(5, 0.9 * Math.pow(tol * (1 + Math.abs(y)) / err, 0.2)) : 5;
    h = dir * Math.min(hmax, Math.abs(h) * fac);
  }
  return pts;
}

/** Fixed-step RK4 solution (used by the "RK4" option). */
export function solveODErk4(f, x0, y0, dir, box, h) {
  const { xlo, xhi, ylo, yhi } = box;
  const pts = [[x0, y0]];
  let x = x0, y = y0;
  const hh = dir * Math.abs(h);
  for (let i = 0; i < 100000; i++) {
    if ((dir > 0 && x >= xhi) || (dir < 0 && x <= xlo)) break;
    y = rk4Step(f, x, y, hh);
    x += hh;
    if (!Number.isFinite(y)) break;
    pts.push([x, y]);
    if (y > yhi || y < ylo) break;
  }
  return pts;
}

// ---------------------------------------------------------------- marching squares
/**
 * Zero set of F(x,y) on a grid of nx×ny cells covering [x0,x1]×[y0,y1].
 * Returns a Float64Array-like flat array of segments [xa,ya,xb,yb,...] in world coords.
 * Segments across sign changes caused by poles (|F| huge relative to neighbours) are skipped.
 */
export function marchingSquares(F, x0, x1, y0, y1, nx, ny) {
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const vals = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * dy;
    for (let i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = F(x0 + i * dx, y);
  }
  const segs = [];
  const interp = (xa, ya, va, xb, yb, vb) => {
    const t = va / (va - vb);
    return [xa + t * (xb - xa), ya + t * (yb - ya)];
  };
  for (let j = 0; j < ny; j++) {
    const ya = y0 + j * dy, yb = y0 + (j + 1) * dy;
    for (let i = 0; i < nx; i++) {
      const xa = x0 + i * dx, xb = x0 + (i + 1) * dx;
      const v00 = vals[j * (nx + 1) + i], v10 = vals[j * (nx + 1) + i + 1];
      const v01 = vals[(j + 1) * (nx + 1) + i], v11 = vals[(j + 1) * (nx + 1) + i + 1];
      if (!(Number.isFinite(v00) && Number.isFinite(v10) && Number.isFinite(v01) && Number.isFinite(v11))) continue;
      const idx = (v00 > 0 ? 1 : 0) | (v10 > 0 ? 2 : 0) | (v11 > 0 ? 4 : 0) | (v01 > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      // pole rejection: check centre value isn't wildly larger than corners
      const vc = F(xa + dx / 2, ya + dy / 2);
      const vmax = Math.max(Math.abs(v00), Math.abs(v10), Math.abs(v01), Math.abs(v11));
      if (!Number.isFinite(vc) || Math.abs(vc) > 4 * vmax + 1e-300) continue;
      const e = [];
      const bottom = () => interp(xa, ya, v00, xb, ya, v10);
      const right = () => interp(xb, ya, v10, xb, yb, v11);
      const top = () => interp(xa, yb, v01, xb, yb, v11);
      const left = () => interp(xa, ya, v00, xa, yb, v01);
      switch (idx) {
        case 1: case 14: e.push(left(), bottom()); break;
        case 2: case 13: e.push(bottom(), right()); break;
        case 3: case 12: e.push(left(), right()); break;
        case 4: case 11: e.push(right(), top()); break;
        case 6: case 9: e.push(bottom(), top()); break;
        case 7: case 8: e.push(left(), top()); break;
        case 5: case 10: {
          const centrePos = vc > 0;
          const a = idx === 5 ? centrePos : !centrePos;
          if (a) e.push(left(), top(), bottom(), right());
          else e.push(left(), bottom(), right(), top());
          break;
        }
        default:
      }
      for (let k = 0; k < e.length; k += 2) segs.push(e[k][0], e[k][1], e[k + 1][0], e[k + 1][1]);
    }
  }
  return segs;
}

/** Joins unordered segments [x0,y0,x1,y1,...] into polylines (arrays of [x,y]). */
export function joinSegments(segs, eps) {
  const n = segs.length / 4;
  if (!n) return [];
  const key = (x, y) => `${Math.round(x / eps)},${Math.round(y / eps)}`;
  const map = new Map();
  const used = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (const end of [0, 1]) {
      const k = key(segs[i * 4 + end * 2], segs[i * 4 + end * 2 + 1]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i * 2 + end);
    }
  }
  const lines = [];
  const other = (code) => {
    const i = code >> 1, end = code & 1;
    return [segs[i * 4 + (1 - end) * 2], segs[i * 4 + (1 - end) * 2 + 1]];
  };
  const extend = (line, atEnd) => {
    for (;;) {
      const [x, y] = atEnd ? line[line.length - 1] : line[0];
      const cands = map.get(key(x, y)) || [];
      const c = cands.find((code) => !used[code >> 1]);
      if (c === undefined) return;
      used[c >> 1] = 1;
      const p = other(c);
      if (atEnd) line.push(p); else line.unshift(p);
    }
  };
  for (let i = 0; i < n; i++) {
    if (Math.abs(segs[i * 4] - segs[i * 4 + 2]) < eps && Math.abs(segs[i * 4 + 1] - segs[i * 4 + 3]) < eps) used[i] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [[segs[i * 4], segs[i * 4 + 1]], [segs[i * 4 + 2], segs[i * 4 + 3]]];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------- adaptive parametric sampling
/**
 * Samples a parametric curve s -> [x,y] (world) on [a,b] and returns polylines in world coords,
 * broken at undefined points and at discontinuities. toScreen maps world->screen for error checks.
 */
export function sampleCurve(fn, a, b, n, toScreen, opts = {}) {
  const maxDepth = opts.maxDepth ?? 8;
  const tolPx = opts.tolPx ?? 0.5;
  const lines = [];
  let cur = null;
  const ok = (p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const flush = () => { if (cur && cur.length > 0) lines.push(cur); cur = null; };
  const add = (p) => { if (!cur) cur = []; cur.push(p); };
  const scr = (p) => toScreen(p[0], p[1]);
  // bisect towards the boundary between defined and undefined parameter values
  function edge(sDef, sUndef) {
    let lo = sDef, hi = sUndef, plo = fn(sDef);
    for (let i = 0; i < 40; i++) {
      const m = 0.5 * (lo + hi);
      const pm = fn(m);
      if (ok(pm)) { lo = m; plo = pm; } else hi = m;
    }
    return [lo, plo];
  }
  // adds points strictly after pa up to and including pb (both defined)
  function refine(sa, pa, sb, pb, depth) {
    const sm = 0.5 * (sa + sb);
    const pm = fn(sm);
    if (!ok(pm)) {
      const [s1, p1] = edge(sa, sm);
      refine(sa, pa, s1, p1, Math.max(depth + 1, maxDepth - 2));
      flush();
      const [s2, p2] = edge(sb, sm);
      add(p2);
      refine(s2, p2, sb, pb, Math.max(depth + 1, maxDepth - 2));
      return;
    }
    const A = scr(pa), B = scr(pb), M = scr(pm);
    const segLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const dev = segLen > 1e-9
      ? Math.abs((B[0] - A[0]) * (A[1] - M[1]) - (A[0] - M[0]) * (B[1] - A[1])) / segLen
      : Math.hypot(M[0] - A[0], M[1] - A[1]);
    if (depth >= maxDepth || (dev < tolPx && segLen < 30)) {
      if (depth >= maxDepth && segLen > 30) {
        const d1 = Math.hypot(M[0] - A[0], M[1] - A[1]), d2 = Math.hypot(B[0] - M[0], B[1] - M[1]);
        if (Math.max(d1, d2) > 0.85 * segLen || !Number.isFinite(segLen)) { flush(); add(pb); return; }
      }
      add(pm); add(pb);
      return;
    }
    refine(sa, pa, sm, pm, depth + 1);
    refine(sm, pm, sb, pb, depth + 1);
  }
  const h = (b - a) / n;
  let s0 = a, p0 = fn(a);
  if (ok(p0)) add(p0);
  for (let i = 1; i <= n; i++) {
    const s1 = i === n ? b : a + i * h;
    const p1 = fn(s1);
    const ok0 = ok(p0), ok1 = ok(p1);
    if (ok0 && ok1) refine(s0, p0, s1, p1, 0);
    else if (ok0 && !ok1) {
      const [se, pe] = edge(s0, s1);
      if (se > s0) refine(s0, p0, se, pe, maxDepth - 2);
      flush();
    } else if (!ok0 && ok1) {
      flush();
      const [se, pe] = edge(s1, s0);
      add(pe);
      if (se < s1) refine(se, pe, s1, p1, maxDepth - 2);
    }
    s0 = s1; p0 = p1;
  }
  flush();
  return lines;
}

// ---------------------------------------------------------------- ticks / formatting
export function niceStep(range, n) {
  const raw = range / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / mag;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * mag;
}
export function ticks(lo, hi, step) {
  const out = [];
  const first = Math.ceil(lo / step - 1e-9);
  for (let i = first; i * step <= hi + step * 1e-9 && out.length < 2000; i++) out.push(Math.abs(i * step) < step * 1e-9 ? 0 : i * step);
  return out;
}
function stripZeros(s) { return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s; }
export function fmtTick(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return stripZeros(v.toExponential(Math.max(0, Math.min(6, Math.floor(Math.log10(a)) - Math.floor(Math.log10(step)))))).replace('e+', 'e');
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(dec);
}
/** Number with up to `sig` significant digits, trailing zeros stripped. */
export function fmt(v, sig = 6) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '-∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-12) return '0';
  if (a >= Math.pow(10, sig) || a < 1e-5) return stripZeros(v.toExponential(sig - 1).replace(/\.?0+e/, 'e')).replace('e+', 'e');
  return stripZeros(v.toPrecision(sig));
}
