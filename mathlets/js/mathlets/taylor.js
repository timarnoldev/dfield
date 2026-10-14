// Taylor polynomials with a draggable center, degree slider, error plot and radius of convergence.
import { C } from '../plot.js';
import { compile, taylorCoeffs } from '../parser.js';
import { fmt, clamp, toSup } from '../math.js';

const NMAX = 40;
const FUNCS = {
  sin: { expr: 'sin(x)', label: 'sin x', view: [-8, 8, -3, 3], R: () => Infinity },
  cos: { expr: 'cos(x)', label: 'cos x', view: [-8, 8, -3, 3], R: () => Infinity },
  exp: { expr: 'exp(x)', label: 'eˣ', view: [-5, 3.5, -2, 10], R: () => Infinity },
  log: { expr: 'log(1+x)', label: 'ln(1 + x)', view: [-1.6, 4, -4, 3], R: (a) => Math.abs(a + 1), sing: [-1] },
  geo: { expr: '1/(1-x)', label: '1/(1 − x)', view: [-3, 3, -5, 5], R: (a) => Math.abs(1 - a), sing: [1] },
  atan: { expr: 'atan(x)', label: 'arctan x', view: [-4, 4, -2.5, 2.5], R: (a) => Math.hypot(a, 1) },
  runge: { expr: '1/(1+x^2)', label: '1/(1 + x²)', view: [-4, 4, -1.5, 2], R: (a) => Math.hypot(a, 1) },
  sqrt: { expr: 'sqrt(1+x)', label: '√(1 + x)', view: [-1.6, 5, -1, 3.5], R: (a) => Math.abs(a + 1), sing: [-1] },
  expr: { expr: null, label: 'Expression …', view: [-5, 5, -4, 4], R: null },
};

/**
 * Estimate the radius of convergence from Taylor coefficients c_0..c_N:
 * least-squares fit of log(envelope |c_k|) ≈ A + β log k − k log R on the tail.
 * Super-geometric decay (entire functions) shows up as a fitted R that keeps growing with k.
 */
export function estimateRadius(c) {
  const N = c.length - 1;
  const env = (k) => { let m = 0; for (let j = Math.max(0, k - 3); j <= k; j++) m = Math.max(m, Math.abs(c[j])); return m; };
  const fit = (k0, k1) => {
    const rows = [];
    for (let k = k0; k <= k1; k++) { const e = env(k); if (e > 1e-290 && Number.isFinite(e)) rows.push([1, Math.log(k), -k, Math.log(e)]); }
    if (rows.length < 5) return Infinity;
    // normal equations 3x3
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (const r of rows) for (let i = 0; i < 3; i++) { v[i] += r[i] * r[3]; for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; }
    // solve by Gaussian elimination
    for (let i = 0; i < 3; i++) {
      let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]]; [v[i], v[p]] = [v[p], v[i]];
      for (let r = i + 1; r < 3; r++) { const f = M[r][i] / M[i][i]; for (let j = i; j < 3; j++) M[r][j] -= f * M[i][j]; v[r] -= f * v[i]; }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return Math.exp(x[2]);
  };
  const k0 = Math.max(4, Math.floor(N / 3)), mid = Math.floor((k0 + N) / 2);
  const all = fit(k0, N), lo = fit(k0, mid), hi = fit(mid, N);
  if (!Number.isFinite(all) || all > 200 || (Number.isFinite(lo) && hi / lo > 1.2)) return Infinity;
  return all;
}

const SUP = (k) => (k === 1 ? '' : toSup(k));

export default {
  id: 'taylor',
  title: 'Taylor Polynomials',
  short: 'Approximate a function by Taylor polynomials around a draggable center; watch the radius of convergence.',
  icon: '<path d="M4 24c4-10 8-14 12-14s8 14 12 14 8-12 16-12" stroke="#a7afb9" stroke-width="5"/><path d="M8 34c4-16 8-24 12-24s6 10 8 14" stroke="#d1342f"/><circle cx="16" cy="11" r="3" fill="#3b4148" stroke="none"/>',
  defaults: { fn: 'sin', expr: 'exp(-x^2)', a: 0, n: 5, xp: 1.5, showErr: true },
  hint: 'Drag the black center point along the graph and the probe point on the x-axis.',
  info: `<p>The Taylor polynomial of degree <span class="m">n</span> of <span class="m">f</span> about <span class="m">x = a</span> is
    <span class="m">T<sub>n</sub>(x) = Σ<sub>k=0..n</sub> f<sup>(k)</sup>(a)/k! · (x − a)<sup>k</sup></span>:
    the polynomial that matches <span class="m">f</span> and its first <span class="m">n</span> derivatives at <span class="m">a</span>.</p>
    <p>The <strong>remainder</strong> <span class="m">R<sub>n</sub>(x) = f(x) − T<sub>n</sub>(x)</span> is small near the center. If the Taylor series converges, it does so on an interval
    <span class="m">|x − a| &lt; R</span> (shaded), where <span class="m">R</span> is the <strong>radius of convergence</strong>; outside, the polynomials blow up no matter how large <span class="m">n</span> is.</p>
    <p>Notice 1/(1 + x²): it is perfectly smooth on the whole real line, yet its radius is only <span class="m">√(a² + 1)</span> — the distance from
    <span class="m">a</span> to the complex singularities <span class="m">±i</span>. The coefficients are computed exactly by automatic differentiation.</p>`,
  layout: (wide) => (wide ? { areas: '"main" "err"', rows: '1.8fr 1fr' } : { areas: '"main" "err"', rows: '1.6fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const main = env.pane('main', { title: 'Function and Taylor polynomial', xlabel: 'x', ylabel: 'y' });
    const err = env.pane('err', { ylog: true, title: 'Error |f(x) − Tₙ(x)| (log scale)', xlabel: 'x', yname: '|error|' });
    let f = null, coeffs = null;

    const setF = () => {
      try { f = compile(p.fn === 'expr' ? p.expr : FUNCS[p.fn].expr, ['x']); } catch { f = compile('0', ['x']); }
      coeffs = null;
    };
    const viewOf = () => {
      if (p.fn !== 'expr') return FUNCS[p.fn].view;
      // auto view for user functions
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i <= 200; i++) { const v = f(-5 + i / 20); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      if (!Number.isFinite(lo)) return [-5, 5, -4, 4];
      const pad = Math.max(0.5, (hi - lo) * 0.3);
      return [-5, 5, Math.max(-20, lo - pad), Math.min(20, hi + pad)];
    };

    ui.select('fn', { label: 'Function f(x)', options: Object.entries(FUNCS).map(([k, v]) => [k, v.label]), onChange: () => { setF(); const [x0, x1] = viewOf(); p.a = clamp(p.a, x0, x1); p.xp = clamp(p.xp, x0, x1); syncVis(); ui.sync(); } });
    const exprCtl = ui.expr('expr', { pre: 'f(x) =', vars: ['x'], onValid: setF });
    ui.slider('n', { label: 'Degree <span class="sym">n</span>', min: 0, max: NMAX, step: 1 });
    ui.slider('a', { label: 'Center <span class="sym">a</span>', min: -8, max: 8, step: 0.01, onChange: () => { coeffs = null; } });
    ui.check('showErr', 'Show all lower-degree polynomials faintly');
    const ro = ui.readout();
    const poly = ui.html('', 'note full');
    function syncVis() { exprCtl.el.hidden = p.fn !== 'expr'; }
    syncVis();

    const getCoeffs = () => {
      if (!coeffs) coeffs = taylorCoeffs(f, p.a, NMAX);
      return coeffs;
    };
    const T = (x, n) => { const c = getCoeffs(); let s = 0; for (let k = n; k >= 0; k--) s = s * (x - p.a) + c[k]; return s; };

    const setA = (x) => { const [x0, x1] = viewOf(); p.a = Number(clamp(x, x0, x1).toFixed(2)); coeffs = null; ui.sync(); };
    main.handles = [
      { pos: () => [p.a, f(p.a)], drag: (x) => setA(x), noOffset: true, cursor: 'ew-resize' },
      { pos: () => [p.xp, main.v.ymin + 0.035 * (main.v.ymax - main.v.ymin)], drag: (x) => { const [x0, x1] = viewOf(); p.xp = Number(clamp(x, x0, x1).toFixed(2)); }, cursor: 'ew-resize' },
    ];
    err.o.onDown = (x) => { const s = (xx) => { p.xp = Number(xx.toFixed(2)); }; s(x); return { move: s }; };

    function draw() {
      if (!f) setF();
      const [x0, x1, y0, y1] = viewOf();
      main.setView(x0, x1, y0, y1);
      const aCtl = ui.ctl('a');
      if (aCtl.o.min !== x0 || aCtl.o.max !== x1) { aCtl.o.min = x0; aCtl.o.max = x1; aCtl.sync(); } // slider range follows the view
      const c = getCoeffs();
      const n = p.n;
      const ok = Number.isFinite(c[0]) && c.slice(0, n + 1).every(Number.isFinite);
      const def = FUNCS[p.fn];
      let R = def.R ? def.R(p.a) : estimateRadius(c);
      const estimated = !def.R;
      main.o.legend = [['f', C.target], [`T${n === 0 ? '₀' : toSubN(n)}`, C.red]];
      main.begin();
      if (ok && Number.isFinite(R)) {
        main.ctx.fillStyle = 'rgba(29,138,58,.09)';
        const L = Math.max(main.L.left, main.X(p.a - R)), Rr = Math.min(main.L.left + main.L.w, main.X(p.a + R));
        if (Rr > L) main.ctx.fillRect(L, main.L.top, Rr - L, main.L.h);
        for (const e of [p.a - R, p.a + R]) main.vline(e, { color: C.green, width: 1.2, dash: [5, 4] });
      } else if (ok) {
        main.ctx.fillStyle = 'rgba(29,138,58,.05)';
        main.ctx.fillRect(main.L.left, main.L.top, main.L.w, main.L.h);
      }
      for (const s of def.sing || []) main.vline(s, { color: C.gray, width: 1, dash: [2, 3] });
      main.fn((x) => f(x), { color: C.target, width: 5 });
      if (ok) {
        if (p.showErr) for (let k = 0; k < n; k++) main.fn((x) => T(x, k), { color: C.red, width: 1, alpha: 0.18 });
        main.fn((x) => T(x, n), { color: C.red, width: 2.6, jumps: false });
      }
      const fa = f(p.a);
      main.knob(p.a, fa, C.text);
      main.text(`a = ${fmt(p.a, 3)}`, p.a, fa, { dx: 12, dy: 14, color: C.text, bold: true, bg: 'rgba(255,255,255,.8)' });
      const yb = main.v.ymin + 0.035 * (main.v.ymax - main.v.ymin);
      main.vline(p.xp, { color: C.purple, width: 1, dash: [3, 3] });
      main.dot(p.xp, f(p.xp), 4.5, C.text);
      if (ok) main.dot(p.xp, T(p.xp, n), 4.5, C.red);
      main.knob(p.xp, yb, C.purple, { r: 8, shape: 'diamond' });
      if (!ok) main.textPx('f is not analytic at the center a', main.L.left + main.L.w / 2, main.L.top + 24, { align: 'center', color: C.red, bold: true, bg: '#fff' });

      // error plot
      err.setView(x0, x1, 1e-12, 1e3);
      err.begin();
      if (ok && Number.isFinite(R)) {
        err.ctx.fillStyle = 'rgba(29,138,58,.09)';
        const L = Math.max(err.L.left, err.X(p.a - R)), Rr = Math.min(err.L.left + err.L.w, err.X(p.a + R));
        if (Rr > L) err.ctx.fillRect(L, err.L.top, Rr - L, err.L.h);
      }
      if (ok) err.fn((x) => { const e = Math.abs(f(x) - T(x, n)); return e > 0 ? Math.max(e, 1e-13) : 1e-13; }, { color: C.red, width: 2, jumps: false, res: 1 });
      err.vline(p.xp, { color: C.purple, width: 1, dash: [3, 3] });
      err.vline(p.a, { color: C.text, width: 1, dash: [2, 3] });

      const fx = f(p.xp), tx = ok ? T(p.xp, n) : NaN;
      ro.set([
        ['Radius of convergence R', ok ? `${Number.isFinite(R) ? fmt(R, 4) : '∞'}${estimated ? ' (estimated)' : ''}` : '—', C.green],
        ['Probe x', fmt(p.xp, 4), C.purple],
        ['f(x)', fmt(fx, 6)],
        [`T${toSubN(n)}(x)`, fmt(tx, 6), C.red],
        ['Remainder f(x) − Tₙ(x)', fmt(fx - tx, 3)],
        ['|x − a| vs R', ok ? (Math.abs(p.xp - p.a) < R ? 'inside → converges' : Math.abs(p.xp - p.a) > R ? 'outside → diverges' : 'on the boundary') : '—'],
      ]);
      // polynomial text
      if (ok) {
        const terms = [];
        const xa = p.a === 0 ? 'x' : `(x ${p.a < 0 ? '+' : '−'} ${fmt(Math.abs(p.a), 3)})`;
        for (let k = 0; k <= n && terms.length < 6; k++) {
          if (Math.abs(c[k]) < 1e-12) continue;
          const coef = fmt(Math.abs(c[k]), 4);
          const body = k === 0 ? coef : `${coef === '1' ? '' : coef}${xa}${SUP(k)}`;
          terms.push({ s: c[k] < 0 ? '−' : '+', body });
        }
        const txt = terms.map((t, i) => (i === 0 ? (t.s === '−' ? '−' : '') : ` ${t.s} `) + t.body).join('') || '0';
        const more = c.slice(0, n + 1).filter((v) => Math.abs(v) >= 1e-12).length > terms.length ? ' + …' : '';
        poly.innerHTML = `<span class="m">T<sub>${n}</sub>(x) = ${txt}${more}</span>`;
      } else poly.textContent = '';
    }
    return { draw };
  },
};

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const toSubN = (n) => String(n).split('').map((d) => SUBS[d]).join('');
