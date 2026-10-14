// Equilibria: Newton's method, Jacobian, eigenvalues and stability classification.
import { matrix, lu, luSolve, eigenvalues, eigenvector } from './linalg.js';

/** Central-difference Jacobian of sys.rhs at (t, x). */
export function jacobian(sys, x, t = 0) {
  const n = sys.n;
  const J = matrix(n);
  const xp = Float64Array.from(x);
  const fp = new Float64Array(n), fm = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    xp[j] = x[j] + h;
    sys.rhs(t, xp, fp);
    xp[j] = x[j] - h;
    sys.rhs(t, xp, fm);
    xp[j] = x[j];
    for (let i = 0; i < n; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
  }
  return J;
}

function maxAbs(v) { let m = 0; for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i])); return m; }

/** Damped Newton iteration for sys.rhs(t, x) = 0. */
export function newton(sys, x0, { t = 0, maxIt = 60, tol = 1e-13 } = {}) {
  const n = sys.n;
  let x = Float64Array.from(x0);
  const f = new Float64Array(n), ft = new Float64Array(n);
  sys.rhs(t, x, f);
  let fn = maxAbs(f);
  if (!Number.isFinite(fn)) return { ok: false, x, resid: fn, it: 0 };
  for (let it = 0; it < maxIt; it++) {
    const J = jacobian(sys, x, t);
    const D = lu(J);
    const neg = f.map((v) => -v);
    const dx = luSolve(D, neg);
    if (!dx.every(Number.isFinite)) return { ok: false, x, resid: fn, it };
    // damping (backtracking on residual)
    let lam = 1;
    let xt = new Float64Array(n);
    let accepted = false;
    for (let k = 0; k < 12; k++) {
      for (let i = 0; i < n; i++) xt[i] = x[i] + lam * dx[i];
      sys.rhs(t, xt, ft);
      const fnt = maxAbs(ft);
      if (Number.isFinite(fnt) && (fnt < fn || fnt < tol)) { accepted = true; break; }
      lam /= 2;
    }
    if (!accepted) {
      // take the full step anyway if residual is not finite-improving (may escape local minimum)
      for (let i = 0; i < n; i++) xt[i] = x[i] + dx[i];
      sys.rhs(t, xt, ft);
      if (!ft.every(Number.isFinite)) return { ok: false, x, resid: fn, it };
    }
    const step = maxAbs(dx) * lam;
    x = xt; xt = null;
    f.set(ft);
    fn = maxAbs(f);
    const sc = Math.max(1, maxAbs(x));
    if (fn < tol * sc || (step < 1e-12 * sc && fn < 1e-6 * sc)) return { ok: true, x, resid: fn, it: it + 1 };
  }
  return { ok: fn < 1e-7 * Math.max(1, maxAbs(x)), x, resid: fn, it: maxIt };
}

/** Classifies an equilibrium from its eigenvalues. */
export function classify(eigs) {
  const scale = Math.max(1e-12, ...eigs.map((e) => Math.hypot(e.re, e.im)));
  const z = 1e-7 * scale;
  let rp = 0, rn = 0, cp = 0, cn = 0, im = 0, zero = 0;
  for (const e of eigs) {
    if (!Number.isFinite(e.re)) return { stable: false, label: 'undetermined', short: '?', counts: {} };
    const cplx = Math.abs(e.im) > z;
    if (Math.abs(e.re) <= z) { if (cplx) im++; else zero++; }
    else if (e.re > 0) { if (cplx) cp++; else rp++; }
    else if (cplx) cn++; else rn++;
  }
  const n = eigs.length;
  const unstable = rp + cp;
  const stable = unstable === 0 && zero === 0 && im === 0;
  let label;
  if (n === 1) {
    label = zero ? 'non-hyperbolic' : stable ? 'stable' : 'unstable';
  } else if (n === 2) {
    if (zero || im) label = im === 2 ? 'center (linear)' : 'non-hyperbolic';
    else if (rp === 1 && rn === 1) label = 'saddle';
    else if (rn === 2) label = 'stable node';
    else if (rp === 2) label = 'unstable node';
    else if (cn === 2) label = 'stable focus';
    else if (cp === 2) label = 'unstable focus';
    else label = 'unknown';
  } else if (zero || im) label = 'non-hyperbolic';
  else if (stable) label = cn ? 'stable focus' : 'stable node';
  else if (unstable === n) label = cp ? 'unstable focus' : 'unstable node';
  else label = cp || cn ? 'saddle-focus' : 'saddle';
  return { stable, label, counts: { rp, rn, cp, cn, im, zero }, dimU: unstable };
}

/** Full information for an equilibrium x. */
export function equilibriumInfo(sys, x, t = 0) {
  const J = jacobian(sys, x, t);
  const eigs = eigenvalues(J);
  const cls = classify(eigs);
  return { x: Float64Array.from(x), J, eigs, ...cls };
}

/**
 * One-dimensional invariant manifolds of an equilibrium: returns list of
 * { kind: 'unstable'|'stable', v (unit eigenvector), lambda }.
 * Unstable manifolds exist for a single positive real eigenvalue,
 * stable manifolds for a single negative real eigenvalue (others unstable).
 */
export function oneDimManifolds(info) {
  const { eigs, J } = info;
  const n = eigs.length;
  const scale = Math.max(1e-12, ...eigs.map((e) => Math.hypot(e.re, e.im)));
  const real = (e) => Math.abs(e.im) <= 1e-7 * scale && Math.abs(e.re) > 1e-7 * scale;
  const pos = eigs.filter((e) => e.re > 1e-7 * scale);
  const neg = eigs.filter((e) => e.re < -1e-7 * scale);
  const res = [];
  if (n < 2 || pos.length + neg.length !== n) return res;
  if (pos.length === 1 && real(pos[0])) res.push({ kind: 'unstable', lambda: pos[0].re, v: eigenvector(J, pos[0].re) });
  if (neg.length === 1 && real(neg[0])) res.push({ kind: 'stable', lambda: neg[0].re, v: eigenvector(J, neg[0].re) });
  return res;
}

export function fmtEig(e, digits = 4) {
  const f = (v) => {
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-4 || a >= 1e5)) return v.toExponential(digits - 1);
    return Number(v.toPrecision(digits)).toString();
  };
  if (!Number.isFinite(e.re)) return 'NaN';
  if (Math.abs(e.im) < 1e-12 * Math.max(1, Math.abs(e.re))) return f(e.re);
  return `${f(e.re)} ${e.im < 0 ? '−' : '+'} ${f(Math.abs(e.im))}i`;
}
