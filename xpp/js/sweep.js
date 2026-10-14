// Brute-force periodic orbit sweep: for each parameter value, integrate past a
// transient, then measure max/min of every variable and the period.
import { integrate } from './integrators.js';

/** Period / amplitude analysis of sampled data (t, cols). */
export function analyzeOscillation(t, cols) {
  const n = cols.length;
  const max = new Float64Array(n), min = new Float64Array(n);
  let best = -1, bestAmp = 0;
  for (let i = 0; i < n; i++) {
    let mx = -Infinity, mn = Infinity;
    const c = cols[i];
    for (let k = 0; k < c.length; k++) { if (c[k] > mx) mx = c[k]; if (c[k] < mn) mn = c[k]; }
    max[i] = mx; min[i] = mn;
    const rel = (mx - mn) / (1e-9 + Math.max(Math.abs(mx), Math.abs(mn), 1e-3));
    if (rel > bestAmp) { bestAmp = rel; best = i; }
  }
  let period = NaN, periodic = false, regular = false;
  if (best >= 0 && bestAmp > 1e-4) {
    const c = cols[best];
    const level = 0.5 * (max[best] + min[best]);
    const cross = [];
    for (let k = 1; k < c.length; k++) {
      if (c[k - 1] < level && c[k] >= level) {
        const s = (level - c[k - 1]) / (c[k] - c[k - 1]);
        cross.push(t[k - 1] + s * (t[k] - t[k - 1]));
      }
    }
    // decaying oscillation (slow approach to a stable focus, e.g. just before a Hopf point)?
    let decaying = false;
    {
      const half = c.length >> 1;
      let m1 = -Infinity, n1 = Infinity, m2 = -Infinity, n2 = Infinity;
      for (let k = 0; k < half; k++) { if (c[k] > m1) m1 = c[k]; if (c[k] < n1) n1 = c[k]; }
      for (let k = half; k < c.length; k++) { if (c[k] > m2) m2 = c[k]; if (c[k] < n2) n2 = c[k]; }
      decaying = (m2 - n2) < 0.8 * (m1 - n1);
    }
    if (cross.length === 2 && !decaying) {
      // sample window holds only about one period: still report it
      periodic = true;
      period = cross[1] - cross[0];
    }
    if (cross.length >= 3 && !decaying) {
      const d = [];
      for (let k = 1; k < cross.length; k++) d.push(cross[k] - cross[k - 1]);
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
      periodic = true;
      regular = sd / mean < 0.02;
      period = mean;
      // multi-loop orbits: period = recurrence of crossing pattern; keep simple mean otherwise
      if (!regular && d.length >= 4) {
        for (let m = 2; m <= Math.min(6, Math.floor(d.length / 2)); m++) {
          const sums = [];
          for (let k = 0; k + m <= d.length; k += m) sums.push(d.slice(k, k + m).reduce((a, b) => a + b, 0));
          const mm = sums.reduce((a, b) => a + b, 0) / sums.length;
          const s2 = Math.sqrt(sums.reduce((a, b) => a + (b - mm) ** 2, 0) / sums.length);
          if (sums.length >= 2 && s2 / mm < 0.02) { period = mm; regular = true; break; }
        }
      }
    }
  }
  return { max, min, period, periodic, regular };
}

/**
 * Generator: yields {i, total, rec} after each parameter value.
 * opt: { par, pmin, pmax, steps, y0, trans, sample, method, dt, rtol, atol, bound, updown }
 */
export function* periodicSweep(sys, opt) {
  const saved = sys.P[opt.par];
  const steps = Math.max(1, Math.round(opt.steps));
  const values = [];
  for (let i = 0; i <= steps; i++) values.push(opt.pmin + (opt.pmax - opt.pmin) * i / steps);
  const passes = opt.updown ? [values, values.slice().reverse()] : [values];
  const total = passes.reduce((a, p) => a + p.length, 0);
  let y = Float64Array.from(opt.y0);
  let i = 0;
  try {
    for (let pass = 0; pass < passes.length; pass++) {
      for (const p of passes[pass]) {
        sys.setPar(opt.par, p);
        const base = { method: opt.method, dt: opt.dt, rtol: opt.rtol, atol: opt.atol, bound: opt.bound, timeLimit: 4000 };
        let r = integrate(sys, { ...base, y0: y, t0: 0, t1: opt.trans, trans: opt.trans, maxPoints: 2 });
        let rec;
        if (r.status !== 'ok' && r.status !== 'full') {
          rec = { p, status: r.status, up: pass === 0 };
          y = Float64Array.from(opt.y0);
        } else {
          y = r.yEnd;
          r = integrate(sys, { ...base, y0: y, t0: 0, t1: opt.sample, maxPoints: 400000 });
          if (r.status !== 'ok' && r.status !== 'full') {
            rec = { p, status: r.status, up: pass === 0 };
            y = Float64Array.from(opt.y0);
          } else {
            const a = analyzeOscillation(r.t, r.cols.slice(0, sys.n));
            rec = { p, status: 'ok', up: pass === 0, ...a, end: Float64Array.from(r.yEnd) };
            y = r.yEnd;
          }
        }
        i++;
        yield { i, total, rec };
      }
    }
  } finally {
    sys.setPar(opt.par, saved);
  }
}
