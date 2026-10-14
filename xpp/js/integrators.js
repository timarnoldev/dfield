// ODE integrators: Euler, RK4, Dormand-Prince 5(4) with dense output,
// Rosenbrock 2(3) (Shampine's ode23s, L-stable, for stiff systems) and
// backward Euler with Newton iteration.
import { lu, luSolve, matrix } from './linalg.js';

export const METHODS = [
  { id: 'euler', name: 'Euler', adaptive: false },
  { id: 'rk4', name: 'Runge–Kutta 4', adaptive: false },
  { id: 'dp45', name: 'Dormand–Prince 5(4) adaptive', adaptive: true },
  { id: 'rosen', name: 'Rosenbrock 2(3) stiff, adaptive', adaptive: true },
  { id: 'beuler', name: 'Backward Euler stiff', adaptive: false },
];

/** Maps XPP 'meth=' names to our methods. */
export function methodFromXpp(name) {
  const s = String(name).toLowerCase();
  if (/^(e|euler)$/.test(s)) return 'euler';
  if (/^(r|rk4|runge|rungekutta|modeuler|m|adams|a|discrete|d)/.test(s)) return 'rk4';
  if (/^(q|qualrk|rkqs|dp|dorpri|dp5|dp83|rk45|ode45|5|8)/.test(s)) return 'dp45';
  if (/^(s|stiff|cvode|c|gear|g|rb23|rosen|2|ode23s)/.test(s)) return 'rosen';
  if (/^(b|backeul|beuler|backeuler|volterra|v)/.test(s)) return 'beuler';
  return null;
}

class Output {
  constructor(sys, opt) {
    this.sys = sys;
    this.ncol = sys.n + sys.aux.length;
    this.t = [];
    this.cols = [];
    for (let i = 0; i < this.ncol; i++) this.cols.push([]);
    this.auxBuf = new Float64Array(sys.aux.length);
    this.t0 = opt.t0;
    this.trans = Math.abs(opt.trans || 0);
    this.max = opt.maxPoints || 500000;
    this.full = false;
  }
  push(t, y) {
    if (Math.abs(t - this.t0) < this.trans - 1e-12) return;
    if (this.t.length >= this.max) { this.full = true; return; }
    this.t.push(t);
    const n = this.sys.n;
    for (let i = 0; i < n; i++) this.cols[i].push(y[i]);
    if (this.auxBuf.length) {
      this.auxBuf.fill(NaN);
      try { this.sys.auxf(t, y, this.auxBuf); } catch { /* ignore */ }
      for (let i = 0; i < this.auxBuf.length; i++) this.cols[n + i].push(this.auxBuf[i]);
    }
  }
  lastT() { return this.t.length ? this.t[this.t.length - 1] : NaN; }
  result(status, message, y, t) {
    return {
      t: Float64Array.from(this.t),
      cols: this.cols.map((c) => Float64Array.from(c)),
      status, message, yEnd: Float64Array.from(y), tEnd: t,
    };
  }
}

function checkState(y, bound) {
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) return 'nan';
    if (Math.abs(v) > bound) return 'bounds';
  }
  return null;
}
const MSG = {
  ok: '',
  nan: 'Integration stopped: solution is not finite (NaN/∞).',
  bounds: 'Integration stopped: solution out of bounds.',
  stepsize: 'Integration stopped: step size too small (stiff or singular?). Try the stiff method.',
  maxsteps: 'Integration stopped: too many steps.',
  stop: '',
  time: 'Integration stopped: time limit exceeded.',
  full: 'Storage full: only the first points were kept.',
};

/**
 * Integrates sys from opt.t0 to opt.t1.
 * opt: { y0, t0, t1, method, dt, nOut, trans, rtol, atol, bound, maxPoints, maxSteps, stop(t,y), timeLimit (ms) }
 * Returns { t, cols, status, message, yEnd, tEnd }.
 */
export function integrate(sys, opt) {
  const o = {
    method: 'rk4', dt: 0.05, nOut: 1, trans: 0, rtol: 1e-6, atol: 1e-9, bound: 1e6,
    maxSteps: 5e6, timeLimit: 8000, ...opt,
  };
  o.nOut = Math.max(1, Math.round(o.nOut));
  o.dt = Math.abs(o.dt) || 0.01;
  const out = new Output(sys, o);
  let res;
  if (o.t1 === o.t0) {
    out.push(o.t0, o.y0);
    return out.result('ok', '', o.y0, o.t0);
  }
  if (o.method === 'dp45') res = runDP45(sys, o, out);
  else if (o.method === 'rosen') res = runRosen(sys, o, out);
  else res = runFixed(sys, o, out);
  if (res.status === 'ok' && out.full) res.status = 'full';
  return out.result(res.status, MSG[res.status] || '', res.y, res.t);
}

// ---------------------------------------------------------------- fixed step
function runFixed(sys, o, out) {
  const n = sys.n, f = sys.rhs;
  const dir = o.t1 > o.t0 ? 1 : -1;
  const y = Float64Array.from(o.y0);
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), tmp = new Float64Array(n);
  const span = Math.abs(o.t1 - o.t0);
  let nFull = Math.floor(span / o.dt + 1e-9);
  const rest = span - nFull * o.dt;
  const nSteps = nFull + (rest > 1e-9 * o.dt ? 1 : 0);
  if (nSteps > o.maxSteps) nFull = o.maxSteps;
  let t = o.t0;
  out.push(t, y);
  const t0 = performance.now();
  let J = null, W = null;
  if (o.method === 'beuler') { J = matrix(n); W = matrix(n); }
  for (let s = 1; s <= nSteps; s++) {
    if (s > o.maxSteps) return { status: 'maxsteps', y, t };
    const h = dir * (s <= nFull ? o.dt : rest);
    if (o.method === 'euler') {
      f(t, y, k1);
      for (let i = 0; i < n; i++) y[i] += h * k1[i];
    } else if (o.method === 'rk4') {
      f(t, y, k1);
      for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
      f(t + 0.5 * h, tmp, k2);
      for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
      f(t + 0.5 * h, tmp, k3);
      for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
      f(t + h, tmp, k4);
      for (let i = 0; i < n; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    } else {
      // backward Euler: z = y + h f(t+h, z), Newton with Jacobian at (t, y)
      fdJacobian(sys, t, y, J, k1, k2, tmp);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) W[i][j] = (i === j ? 1 : 0) - h * J[i][j];
      const D = lu(W.map((r) => Float64Array.from(r)));
      f(t, y, k1);
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) z[i] = y[i] + h * k1[i];
      for (let it = 0; it < 25; it++) {
        f(t + h, z, k2);
        for (let i = 0; i < n; i++) k3[i] = -(z[i] - y[i] - h * k2[i]);
        const d = luSolve(D, k3);
        let nr = 0;
        for (let i = 0; i < n; i++) { z[i] += d[i]; nr = Math.max(nr, Math.abs(d[i]) / (1e-8 + Math.abs(z[i]))); }
        if (!(nr === nr)) break;
        if (nr < 1e-10) break;
      }
      y.set(z);
    }
    t = s <= nFull ? o.t0 + dir * s * o.dt : o.t1;
    const bad = checkState(y, o.bound);
    if (bad) return { status: bad, y, t };
    if (s % o.nOut === 0 || s === nSteps) out.push(t, y);
    if (o.stop && o.stop(t, y)) return { status: 'stop', y, t };
    if ((s & 1023) === 0 && performance.now() - t0 > o.timeLimit) return { status: 'time', y, t };
    if (out.full) return { status: 'full', y, t };
  }
  return { status: 'ok', y, t };
}

/** Forward-difference Jacobian. f0 must be passable as scratch. */
export function fdJacobian(sys, t, y, J, f0, f1, yp) {
  const n = sys.n;
  sys.rhs(t, y, f0);
  yp.set(y);
  for (let j = 0; j < n; j++) {
    const h = 1e-7 * Math.max(1, Math.abs(y[j]));
    yp[j] = y[j] + h;
    sys.rhs(t, yp, f1);
    for (let i = 0; i < n; i++) J[i][j] = (f1[i] - f0[i]) / h;
    yp[j] = y[j];
  }
}

function errNorm(err, y, yn, o) {
  let s = 0;
  const n = err.length;
  for (let i = 0; i < n; i++) {
    const sc = o.atol + o.rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i]));
    const r = err[i] / sc;
    s += r * r;
  }
  return Math.sqrt(s / n);
}

// ---------------------------------------------------------------- Dormand-Prince 5(4)
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;
const D1 = -12715105075 / 11282082432, D3 = 87487479700 / 32700410799, D4 = -10690763975 / 1880347072,
  D5 = 701980252875 / 199316789632, D6 = -1453857185 / 822651844, D7 = 69997945 / 29380423;

function runDP45(sys, o, out) {
  const n = sys.n, f = sys.rhs;
  const dir = o.t1 > o.t0 ? 1 : -1;
  let y = Float64Array.from(o.y0);
  let yn = new Float64Array(n);
  let k1 = new Float64Array(n);
  const k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), k5 = new Float64Array(n), k6 = new Float64Array(n);
  let k7 = new Float64Array(n);
  const yt = new Float64Array(n), err = new Float64Array(n), yo = new Float64Array(n);
  const r1 = new Float64Array(n), r2 = new Float64Array(n), r3 = new Float64Array(n), r4 = new Float64Array(n), r5 = new Float64Array(n);
  const span = Math.abs(o.t1 - o.t0);
  const dOut = o.dt * o.nOut;
  let t = o.t0;
  out.push(t, y);
  let kOut = 1;
  let tOut = o.t0 + dir * dOut;
  f(t, y, k1);
  let h = dir * Math.min(o.dt, span, o.hmax || Infinity);
  const hmax = o.hmax || span;
  let steps = 0;
  const c0 = performance.now();
  let lastOutT = o.t0;
  while (dir * (o.t1 - t) > 1e-12 * Math.max(1, Math.abs(t))) {
    if (++steps > o.maxSteps) return { status: 'maxsteps', y, t };
    if ((steps & 511) === 0 && performance.now() - c0 > o.timeLimit) return { status: 'time', y, t };
    if (dir * (t + h - o.t1) > 0) h = o.t1 - t;
    if (Math.abs(h) < 1e-13 * Math.max(1, Math.abs(t))) return { status: 'stepsize', y, t };
    for (let i = 0; i < n; i++) yt[i] = y[i] + h * A21 * k1[i];
    f(t + h / 5, yt, k2);
    for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    f(t + 0.3 * h, yt, k3);
    for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    f(t + 0.8 * h, yt, k4);
    for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    f(t + (8 / 9) * h, yt, k5);
    for (let i = 0; i < n; i++) yt[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    f(t + h, yt, k6);
    for (let i = 0; i < n; i++) yn[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
    f(t + h, yn, k7);
    for (let i = 0; i < n; i++) err[i] = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
    let e = errNorm(err, y, yn, o);
    if (!Number.isFinite(e)) e = 1e10;
    if (e <= 1) {
      const tn = t + h;
      // dense output for grid points in (t, tn]
      if (dir * (tOut - tn) <= 1e-12 * Math.max(1, Math.abs(tn))) {
        for (let i = 0; i < n; i++) {
          const yd = yn[i] - y[i];
          const bs = h * k1[i] - yd;
          r1[i] = y[i]; r2[i] = yd; r3[i] = bs; r4[i] = yd - h * k7[i] - bs;
          r5[i] = h * (D1 * k1[i] + D3 * k3[i] + D4 * k4[i] + D5 * k5[i] + D6 * k6[i] + D7 * k7[i]);
        }
        while (dir * (tOut - tn) <= 1e-12 * Math.max(1, Math.abs(tn)) && dir * (tOut - o.t1) <= 1e-12 * Math.max(1, Math.abs(tOut))) {
          const th = (tOut - t) / h;
          const th1 = 1 - th;
          for (let i = 0; i < n; i++) yo[i] = r1[i] + th * (r2[i] + th1 * (r3[i] + th * (r4[i] + th1 * r5[i])));
          out.push(tOut, yo);
          lastOutT = tOut;
          kOut++;
          tOut = o.t0 + dir * kOut * dOut;
        }
      }
      t = tn;
      let sw = y; y = yn; yn = sw;
      sw = k1; k1 = k7; k7 = sw;
      const bad = checkState(y, o.bound);
      if (bad) { out.push(t, y); return { status: bad, y, t }; }
      if (o.stop && o.stop(t, y)) { if (t !== lastOutT) out.push(t, y); return { status: 'stop', y, t }; }
      if (out.full) return { status: 'full', y, t };
      const fac = Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(e, 1e-10), -0.2)));
      h = dir * Math.min(Math.abs(h) * fac, hmax);
    } else {
      h *= Math.max(0.1, 0.9 * Math.pow(e, -0.2));
    }
  }
  if (Math.abs(lastOutT - t) > 1e-9 * Math.max(dOut, 1e-300)) out.push(t, y);
  return { status: 'ok', y, t };
}

// ---------------------------------------------------------------- Rosenbrock 2(3) (ode23s)
function runRosen(sys, o, out) {
  const n = sys.n, f = sys.rhs;
  const dir = o.t1 > o.t0 ? 1 : -1;
  const d = 1 / (2 + Math.SQRT2);
  const e32 = 6 + Math.SQRT2;
  let y = Float64Array.from(o.y0);
  let yn = new Float64Array(n);
  const F0 = new Float64Array(n), F1 = new Float64Array(n), F2 = new Float64Array(n);
  const T = new Float64Array(n), tmp = new Float64Array(n), rhs = new Float64Array(n), err = new Float64Array(n), yo = new Float64Array(n);
  const s1 = new Float64Array(n), s2 = new Float64Array(n), s3 = new Float64Array(n);
  const J = matrix(n), W = matrix(n);
  const span = Math.abs(o.t1 - o.t0);
  const dOut = o.dt * o.nOut;
  const hmax = o.hmax || span;
  let t = o.t0;
  out.push(t, y);
  let kOut = 1;
  let tOut = o.t0 + dir * dOut;
  let lastOutT = o.t0;
  let h = dir * Math.min(o.dt, span);
  let steps = 0;
  const c0 = performance.now();
  let needJ = true;
  while (dir * (o.t1 - t) > 1e-12 * Math.max(1, Math.abs(t))) {
    if (++steps > o.maxSteps) return { status: 'maxsteps', y, t };
    if ((steps & 255) === 0 && performance.now() - c0 > o.timeLimit) return { status: 'time', y, t };
    if (needJ) {
      fdJacobian(sys, t, y, J, F0, F1, tmp);
      f(t, y, F0);
      const dt = 1e-7 * Math.max(1, Math.abs(t));
      f(t + dt, y, F1);
      for (let i = 0; i < n; i++) T[i] = (F1[i] - F0[i]) / dt;
      needJ = false;
    }
    if (dir * (t + h - o.t1) > 0) h = o.t1 - t;
    if (Math.abs(h) < 1e-13 * Math.max(1, Math.abs(t))) return { status: 'stepsize', y, t };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) W[i][j] = (i === j ? 1 : 0) - h * d * J[i][j];
    const D = lu(W.map((r) => Float64Array.from(r)));
    for (let i = 0; i < n; i++) rhs[i] = F0[i] + h * d * T[i];
    const k1 = luSolve(D, rhs);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
    f(t + 0.5 * h, tmp, F1);
    for (let i = 0; i < n; i++) rhs[i] = F1[i] - k1[i];
    const k2 = luSolve(D, rhs);
    for (let i = 0; i < n; i++) { k2[i] += k1[i]; yn[i] = y[i] + h * k2[i]; }
    f(t + h, yn, F2);
    for (let i = 0; i < n; i++) rhs[i] = F2[i] - e32 * (k2[i] - F1[i]) - 2 * (k1[i] - F0[i]) + h * d * T[i];
    const k3 = luSolve(D, rhs);
    for (let i = 0; i < n; i++) err[i] = (h / 6) * (k1[i] - 2 * k2[i] + k3[i]);
    let e = errNorm(err, y, yn, o);
    if (!Number.isFinite(e)) e = 1e10;
    if (e <= 1) {
      const tn = t + h;
      if (dir * (tOut - tn) <= 1e-12 * Math.max(1, Math.abs(tn))) {
        const c = 1 / (1 - 2 * d);
        for (let i = 0; i < n; i++) { s1[i] = k1[i]; s2[i] = k2[i]; s3[i] = y[i]; }
        while (dir * (tOut - tn) <= 1e-12 * Math.max(1, Math.abs(tn)) && dir * (tOut - o.t1) <= 1e-12 * Math.max(1, Math.abs(tOut))) {
          const s = (tOut - t) / h;
          const a1 = s * (1 - s) * c, a2 = s * (s - 2 * d) * c;
          for (let i = 0; i < n; i++) yo[i] = s3[i] + h * (a1 * s1[i] + a2 * s2[i]);
          out.push(tOut, yo);
          lastOutT = tOut;
          kOut++;
          tOut = o.t0 + dir * kOut * dOut;
        }
      }
      t = tn;
      const sw = y; y = yn; yn = sw;
      F0.set(F2);
      needJ = true;
      const bad = checkState(y, o.bound);
      if (bad) { out.push(t, y); return { status: bad, y, t }; }
      if (o.stop && o.stop(t, y)) { if (t !== lastOutT) out.push(t, y); return { status: 'stop', y, t }; }
      if (out.full) return { status: 'full', y, t };
      const fac = Math.min(4, Math.max(0.2, 0.9 * Math.pow(Math.max(e, 1e-10), -1 / 3)));
      h = dir * Math.min(Math.abs(h) * fac, hmax);
    } else {
      h *= Math.max(0.1, 0.9 * Math.pow(e, -1 / 3));
    }
  }
  if (Math.abs(lastOutT - t) > 1e-9 * Math.max(dOut, 1e-300)) out.push(t, y);
  return { status: 'ok', y, t };
}
