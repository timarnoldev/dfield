// "AUTO lite": pseudo-arclength continuation of equilibria in one parameter with
// detection of limit points (LP), Hopf bifurcations (HB) and branch points (BP).
import { matrix, lu, luSolve, det, eigenvalues } from './linalg.js';
import { classify } from './analysis.js';

function maxAbs(v, n = v.length) { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(v[i])); return m; }
function nrm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
function dotv(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

export class Continuer {
  constructor(sys, par, t = 0) {
    this.sys = sys;
    this.k = par;
    this.n = sys.n;
    this.t = t;
    this.f = new Float64Array(this.n);
    this.fp = new Float64Array(this.n);
    this.fm = new Float64Array(this.n);
    this.saved = sys.P[par];
  }
  restore() { this.sys.setPar(this.k, this.saved); }
  F(X, out = this.f) {
    this.sys.setPar(this.k, X[this.n]);
    this.sys.rhs(this.t, X, out);
    return out;
  }
  /** n x (n+1) Jacobian [F_x | F_mu] by central differences. */
  A(X) {
    const n = this.n;
    const M = matrix(n, n + 1);
    const Xp = Float64Array.from(X);
    for (let j = 0; j <= n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(X[j]));
      Xp[j] = X[j] + h; this.F(Xp, this.fp);
      Xp[j] = X[j] - h; this.F(Xp, this.fm);
      Xp[j] = X[j];
      for (let i = 0; i < n; i++) M[i][j] = (this.fp[i] - this.fm[i]) / (2 * h);
    }
    return M;
  }
  aug(A, row) {
    const n = this.n;
    const M = matrix(n + 1);
    for (let i = 0; i < n; i++) M[i].set(A[i]);
    M[n].set(row);
    return M;
  }
  /** Tangent at X oriented by reference tr: solves [A; tr] z = e_{n+1}. */
  tangent(X, tr, A = this.A(X)) {
    const n = this.n;
    const e = new Float64Array(n + 1); e[n] = 1;
    const z = luSolve(lu(this.aug(A, tr)), e);
    const s = nrm(z);
    if (!(s > 0) || !Number.isFinite(s)) return null;
    for (let i = 0; i <= n; i++) z[i] /= s;
    return z;
  }
  /** Newton corrector on the hyperplane tr.(X - Xp) = 0. */
  correct(Xp, tr, { maxIt = 12, tol = 1e-10 } = {}) {
    const n = this.n;
    const X = Float64Array.from(Xp);
    const r = new Float64Array(n + 1);
    for (let it = 1; it <= maxIt; it++) {
      const A = this.A(X);
      this.F(X);
      for (let i = 0; i < n; i++) r[i] = -this.f[i];
      let c = 0;
      for (let i = 0; i <= n; i++) c += tr[i] * (X[i] - Xp[i]);
      r[n] = -c;
      const dX = luSolve(lu(this.aug(A, tr)), r);
      if (!dX.every(Number.isFinite)) return null;
      for (let i = 0; i <= n; i++) X[i] += dX[i];
      const sc = 1 + maxAbs(X);
      if (maxAbs(dX) < tol * sc) {
        this.F(X);
        if (maxAbs(this.f) < 1e-7 * sc) return { X, it };
      }
    }
    return null;
  }
  /** Evaluates a branch point's data. */
  pointData(X, tr) {
    const n = this.n;
    const A = this.A(X);
    const t1 = this.tangent(X, tr, A);
    const Jx = matrix(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Jx[i][j] = A[i][j];
    const eigs = eigenvalues(Jx);
    const cls = classify(eigs);
    let bpDet = NaN;
    if (t1) { const D = lu(this.aug(A, t1)); bpDet = det(D); }
    const scale = Math.max(1e-12, ...eigs.map((e) => Math.hypot(e.re, e.im)));
    let rU = 0, cU = 0, hopfRe = NaN, hopfIm = NaN, best = Infinity;
    for (const e of eigs) {
      const cplx = Math.abs(e.im) > 1e-8 * scale;
      // tolerance: neutral eigenvalues (e.g. conservative centres) must not flicker between
      // stable and unstable because of rounding, which would create spurious HB points
      if (e.re > 1e-8 * scale) { if (cplx) cU++; else rU++; }
      if (cplx && Math.abs(e.re) < best) { best = Math.abs(e.re); hopfRe = e.re; hopfIm = Math.abs(e.im); }
    }
    return { X: Float64Array.from(X), t: t1, eigs, stable: cls.stable, rU, cU, bpDet, hopfRe, hopfIm, lp: t1 ? t1[n] : NaN };
  }
}

/** Regula falsi (Illinois) for g(s) = 0 on [0, ds] given point at s=0 (X0, t0). */
function locate(C, X0, t0, ds, g0, g1, testFn) {
  const n = C.n;
  let a = 0, b = ds, ga = g0, gb = g1;
  let best = null;
  for (let it = 0; it < 30; it++) {
    const s = (a * gb - b * ga) / (gb - ga);
    if (!Number.isFinite(s)) break;
    const Xp = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) Xp[i] = X0[i] + s * t0[i];
    const c = C.correct(Xp, t0);
    if (!c) break;
    const pd = C.pointData(c.X, t0);
    const gs = testFn(pd);
    best = pd;
    if (!Number.isFinite(gs) || Math.abs(gs) === 0) break;
    if (Math.sign(gs) === Math.sign(ga)) { a = s; ga = gs; gb /= 2; } else { b = s; gb = gs; ga /= 2; }
    if (Math.abs(b - a) < 1e-11 * Math.max(1, Math.abs(ds))) break;
  }
  return best;
}

/**
 * Continues a branch of equilibria.
 * opt: { par, x0, p0 | X0, tangent, dir, ds, dsmin, dsmax, nmax, pmin, pmax, bound, t }
 * Returns { points:[pd...], special:[{type, pd, index}], status }
 */
export function continueEquilibria(sys, opt) {
  const o = { ds: 0.02, dsmin: 1e-5, dsmax: 0.5, nmax: 400, bound: 1e5, dir: 1, t: 0, ...opt };
  const C = new Continuer(sys, o.par, o.t);
  const n = C.n;
  try {
    let X, t0;
    if (o.X0) {
      X = Float64Array.from(o.X0);
    } else {
      X = new Float64Array(n + 1);
      X.set(o.x0);
      X[n] = o.p0;
    }
    // correct the starting point at fixed parameter
    {
      let e = new Float64Array(n + 1); e[n] = 1;
      if (o.tangent) e = Float64Array.from(o.tangent);
      const c = C.correct(X, e);
      if (!c) return { points: [], special: [], status: 'Starting point is not close to an equilibrium (Newton failed).' };
      X = c.X;
    }
    if (o.tangent) {
      t0 = Float64Array.from(o.tangent);
    } else {
      const e = new Float64Array(n + 1); e[n] = 1;
      t0 = C.tangent(X, e);
      if (!t0 || !t0.every(Number.isFinite) || maxAbs(t0) < 1e-12) {
        const r = new Float64Array(n + 1).map((_, i) => 1 / Math.sqrt(n + 1) + 0.01 * i);
        t0 = C.tangent(X, r);
      }
      if (!t0) return { points: [], special: [], status: 'Could not compute the initial tangent.' };
      if (t0[n] * o.dir < 0) for (let i = 0; i <= n; i++) t0[i] = -t0[i];
    }
    let pd0 = C.pointData(X, t0);
    pd0.t = t0;
    const points = [pd0];
    const special = [{ type: 'EP', pd: pd0, index: 0 }];
    let ds = o.ds;
    let status = 'Maximum number of points reached.';
    const start = Float64Array.from(X);
    const range = Math.abs(o.pmax - o.pmin) || 1;
    for (let step = 0; step < o.nmax; step++) {
      const X0 = pd0.X, tv = pd0.t;
      let c = null;
      while (!c) {
        const Xp = new Float64Array(n + 1);
        for (let i = 0; i <= n; i++) Xp[i] = X0[i] + ds * tv[i];
        c = C.correct(Xp, tv);
        if (!c) {
          ds /= 2;
          if (ds < o.dsmin) break;
        }
      }
      if (!c) { status = 'Step size too small: continuation failed to converge.'; break; }
      const pd1 = C.pointData(c.X, tv);
      if (!pd1.t) { status = 'Singular Jacobian: stopped.'; break; }
      // test functions
      const found = [];
      if (Math.sign(pd1.lp) !== Math.sign(pd0.lp) && pd0.lp !== 0) {
        const p = locate(C, X0, tv, ds, pd0.lp, pd1.lp, (q) => q.lp);
        if (p) found.push({ type: 'LP', pd: p });
      }
      if (Number.isFinite(pd0.bpDet) && Number.isFinite(pd1.bpDet) && Math.sign(pd1.bpDet) !== Math.sign(pd0.bpDet) && pd0.bpDet !== 0) {
        const p = locate(C, X0, tv, ds, pd0.bpDet, pd1.bpDet, (q) => q.bpDet);
        if (p) found.push({ type: 'BP', pd: p });
      }
      if (Math.abs(pd1.cU - pd0.cU) === 2 && Math.abs((pd1.cU + pd1.rU) - (pd0.cU + pd0.rU)) === 2
        && Number.isFinite(pd0.hopfRe) && Number.isFinite(pd1.hopfRe) && Math.sign(pd0.hopfRe) !== Math.sign(pd1.hopfRe)) {
        const p = locate(C, X0, tv, ds, pd0.hopfRe, pd1.hopfRe, (q) => q.hopfRe);
        if (p && p.hopfIm > 0) found.push({ type: 'HB', pd: p, omega: p.hopfIm, period: 2 * Math.PI / p.hopfIm });
      }
      // parameter range
      const p1 = pd1.X[n];
      let out = null;
      if (p1 > o.pmax || p1 < o.pmin) {
        const lim = p1 > o.pmax ? o.pmax : o.pmin;
        let p = locate(C, X0, tv, ds, X0[n] - lim, p1 - lim, (q) => q.X[n] - lim);
        if (p) {
          // snap exactly onto the boundary: Newton at fixed parameter value lim
          const Xs = Float64Array.from(p.X); Xs[n] = lim;
          const e = new Float64Array(n + 1); e[n] = 1;
          const c2 = C.correct(Xs, e);
          if (c2) p = C.pointData(c2.X, tv);
        }
        out = p;
      }
      if (out) {
        found.sort((a, b) => Math.abs(a.pd.X[n] - X0[n]) - Math.abs(b.pd.X[n] - X0[n]));
        for (const f of found) {
          if ((f.pd.X[n] - o.pmin) >= -1e-12 * range && (o.pmax - f.pd.X[n]) >= -1e-12 * range) { points.push(f.pd); special.push({ ...f, index: points.length - 1 }); }
        }
        points.push(out);
        special.push({ type: 'EP', pd: out, index: points.length - 1 });
        status = 'Parameter range boundary reached.';
        break;
      }
      for (const f of found) { points.push(f.pd); special.push({ ...f, index: points.length - 1 }); }
      points.push(pd1);
      if (maxAbs(pd1.X, n) > o.bound) { special.push({ type: 'EP', pd: pd1, index: points.length - 1 }); status = 'Solution out of bounds.'; break; }
      // closed loop?
      if (step > 5) {
        let d = 0;
        for (let i = 0; i <= n; i++) d = Math.max(d, Math.abs(pd1.X[i] - start[i]));
        if (d < 0.5 * ds && dotv(pd1.t, points[0].t) > 0) { status = 'Closed branch: returned to the starting point.'; break; }
      }
      pd0 = pd1;
      if (c.it <= 3) ds = Math.min(ds * 1.4, o.dsmax);
      else if (c.it > 6) ds = Math.max(ds / 1.5, o.dsmin);
      if (step === o.nmax - 1) special.push({ type: 'EP', pd: pd1, index: points.length - 1 });
    }
    // reorder special list by index
    special.sort((a, b) => a.index - b.index);
    return { points, special, status };
  } finally {
    C.restore();
  }
}

/** Direction of the second branch at a branch point (unit vector orthogonal to tangent t). */
export function branchSwitchDirection(sys, par, X, t, tm = 0) {
  const C = new Continuer(sys, par, tm);
  try {
    const n = C.n;
    const A = C.A(X);
    const N = n + 1;
    const M = matrix(N);
    let tr = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += A[k][i] * A[k][j];
        M[i][j] = s + t[i] * t[j];
      }
      tr += M[i][i];
    }
    for (let i = 0; i < N; i++) M[i][i] += 1e-10 * tr;
    const D = lu(M);
    let v = new Float64Array(N).map((_, i) => Math.cos(1.3 * i + 0.4));
    for (let it = 0; it < 6; it++) {
      const d = dotv(v, t);
      for (let i = 0; i < N; i++) v[i] -= d * t[i];
      const w = luSolve(D, v);
      const s = nrm(w);
      if (!(s > 0)) break;
      v = w.map((c) => c / s);
    }
    const d = dotv(v, t);
    for (let i = 0; i < N; i++) v[i] -= d * t[i];
    const s = nrm(v);
    return v.map((c) => c / s);
  } finally {
    C.restore();
  }
}
