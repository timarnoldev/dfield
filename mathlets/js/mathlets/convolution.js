// Convolution (f*g)(t) = ∫ f(τ) g(t−τ) dτ with a sliding, flipped g.
import { C } from '../plot.js';
import { compile } from '../parser.js';
import { fmt, clamp } from '../math.js';

const TMIN = -3, TMAX = 7;
const QLO = -6, QHI = 12, H = 0.005;

export const LIB = {
  box: { label: 'Box u(t) − u(t−1)', f: (t) => (t >= 0 && t < 1 ? 1 : 0) },
  step: { label: 'Unit step u(t)', f: (t) => (t >= 0 ? 1 : 0) },
  exp: { label: 'Decay e^(−t) u(t)', f: (t) => (t >= 0 ? Math.exp(-t) : 0) },
  tri: { label: 'Triangle on [0, 2]', f: (t) => Math.max(0, 1 - Math.abs(t - 1)) },
  ramp: { label: 'Ramp t on [0, 1]', f: (t) => (t >= 0 && t < 1 ? t : 0) },
  sin: { label: 'sin(t) u(t)', f: (t) => (t >= 0 ? Math.sin(t) : 0) },
  delta: { label: 'Delta-like (width 0.1)', f: (t) => (t >= 0 && t < 0.1 ? 10 : 0) },
  expr: { label: 'Expression …', f: null },
};

/** Numerical convolution on a grid. Returns { ts, vals } over [TMIN, TMAX]. */
export function convolve(f, g, tmin = TMIN, tmax = TMAX, dt = 0.02) {
  const n = Math.round((QHI - QLO) / H);
  const fv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = f(QLO + (i + 0.5) * H); fv[i] = Number.isFinite(v) ? v : 0; }
  const ts = [], vals = [];
  for (let t = tmin; t <= tmax + 1e-9; t += dt) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (fv[i] === 0) continue;
      const v = g(t - (QLO + (i + 0.5) * H));
      if (Number.isFinite(v)) s += fv[i] * v;
    }
    ts.push(t); vals.push(s * H);
  }
  return { ts, vals };
}

export default {
  id: 'convolution',
  title: 'Convolution',
  short: 'Flip g, slide it along, multiply with f and take the area: (f∗g)(t) = ∫ f(τ) g(t−τ) dτ.',
  icon: '<path d="M4 34h8v-16h10v16h22" stroke="#1f5fd1"/><path d="M18 34l8-16 8 16" stroke="#d1342f"/><path d="M18 34h8v-16" fill="rgba(138,60,207,.35)" stroke="none"/>',
  defaults: { f: 'box', g: 'box', fexpr: 'exp(-t)*cos(3t)*u(t)', gexpr: 'u(t)*t*exp(-t)', t: 0.6, speed: 1 },
  hint: 'Drag the time t (the knob or anywhere in the lower plots) or press Play.',
  info: `<p>The convolution of <span class="m">f</span> and <span class="m">g</span> is
    <span class="m">(f ∗ g)(t) = ∫ f(τ) g(t − τ) dτ</span>.</p>
    <p>For each fixed <span class="m">t</span>, the graph of <span class="m">g(t − τ)</span> as a function of <span class="m">τ</span>
    is <span class="m">g</span> flipped around and shifted so that its origin sits at <span class="m">τ = t</span> (red).
    Multiply by <span class="m">f(τ)</span> (blue); the signed area under the product (shaded) is the value of the convolution at <span class="m">t</span>.</p>
    <p>Examples: box ∗ box is a triangle; anything ∗ (delta-like spike) is (almost) the function itself; u ∗ g is the
    running integral of g. If <span class="m">g</span> is the unit impulse response of a system, <span class="m">f ∗ g</span> is the response to the input <span class="m">f</span> (with rest initial conditions).</p>`,
  layout: (wide) => (wide
    ? { areas: '"fg" "prod" "conv"', rows: '0.75fr 1.1fr 1fr' }
    : { areas: '"fg" "prod" "conv"', rows: '0.75fr 1.1fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const fg = env.pane('fg', { xmin: TMIN, xmax: TMAX, title: 'f(t) and g(t)', xlabel: 't', xname: 't' });
    const prod = env.pane('prod', { xmin: TMIN, xmax: TMAX, title: 'Integrand at time t', xlabel: 'τ', xname: 'τ' });
    const conv = env.pane('conv', { xmin: TMIN, xmax: TMAX, title: 'Convolution (f ∗ g)(t)', xlabel: 't', xname: 't' });
    let fnF = null, fnG = null, result = null;

    const getFn = (which) => {
      const kind = p[which];
      if (kind !== 'expr') return LIB[kind].f;
      try { const c = compile(p[`${which}expr`], ['t']); return (t) => c(t); } catch { return () => 0; }
    };
    function recompute() { fnF = getFn('f'); fnG = getFn('g'); result = convolve(fnF, fnG); }

    const opts = Object.entries(LIB).map(([k, v]) => [k, v.label]);
    ui.select('f', { label: '<span class="swatch" style="background:#1f5fd1"></span>f(t)', options: opts, onChange: () => { syncVis(); recompute(); } });
    const fe = ui.expr('fexpr', { pre: 'f(t) =', vars: ['t'], onValid: recompute });
    ui.select('g', { label: '<span class="swatch" style="background:#d1342f"></span>g(t)', options: opts, onChange: () => { syncVis(); recompute(); } });
    const ge = ui.expr('gexpr', { pre: 'g(t) =', vars: ['t'], onValid: recompute });
    ui.slider('t', { label: 'Time <span class="sym">t</span>', min: TMIN, max: TMAX, step: 0.01 });
    ui.slider('speed', { label: 'Animation speed', min: 0.1, max: 3, log: true });
    ui.buttons([['Swap f and g', () => {
      [p.f, p.g] = [p.g, p.f]; [p.fexpr, p.gexpr] = [p.gexpr, p.fexpr]; ui.sync(); syncVis(); recompute();
    }]]);
    ui.note('Expressions use the variable t; u(t) is the unit step. Functions are integrated over −6 ≤ τ ≤ 12.');
    const ro = ui.readout();
    function syncVis() { fe.el.hidden = p.f !== 'expr'; ge.el.hidden = p.g !== 'expr'; }
    syncVis();

    const setT = (t) => { p.t = Number(clamp(t, TMIN, TMAX).toFixed(3)); ui.ctl('t').sync(); };
    prod.handles = [{ pos: () => [p.t, 0], drag: (t) => setT(t), cursor: 'ew-resize', noOffset: true }];
    prod.o.onDown = (t) => { setT(t); return { move: setT }; };
    conv.o.onDown = (t) => { setT(t); return { move: setT }; };

    const valueAt = (t) => {
      const { ts, vals } = result;
      const u = (t - ts[0]) / (ts[1] - ts[0]);
      const i = clamp(Math.floor(u), 0, ts.length - 2);
      return vals[i] + (vals[i + 1] - vals[i]) * clamp(u - i, 0, 1);
    };

    function range(fns) {
      let lo = 0, hi = 0;
      for (const f of fns) for (let i = 0; i <= 500; i++) {
        const v = f(TMIN + ((TMAX - TMIN) * i) / 500);
        if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
      const pad = 0.15 * (hi - lo || 1);
      return [lo - pad, hi + pad];
    }

    function draw() {
      if (!result) recompute();
      const t = p.t;
      const flipped = (tau) => fnG(t - tau);
      const product = (tau) => fnF(tau) * fnG(t - tau);

      const [lo1, hi1] = range([fnF, fnG]);
      fg.setView(TMIN, TMAX, Math.max(lo1, -12), Math.min(hi1, 12));
      fg.o.legend = [['f(t)', C.blue], ['g(t)', C.red]];
      fg.begin();
      fg.fn(fnF, { color: C.blue, width: 2.4, res: 1 });
      fg.fn(fnG, { color: C.red, width: 2.4, res: 1, dash: [7, 4] });

      prod.setView(TMIN, TMAX, Math.max(lo1, -12), Math.min(hi1, 12));
      prod.o.legend = [['f(τ)', C.blue], ['g(t − τ)', C.red], ['f(τ) g(t − τ)', C.purple]];
      prod.begin();
      prod.fillUnder((tau) => Math.max(0, product(tau)), TMIN, TMAX, 'rgba(138,60,207,.35)');
      prod.fillUnder((tau) => Math.min(0, product(tau)), TMIN, TMAX, 'rgba(224,123,0,.35)');
      prod.fn(fnF, { color: C.blue, width: 2.4, res: 1 });
      prod.fn(flipped, { color: C.red, width: 2.4, res: 1 });
      prod.fn(product, { color: C.purple, width: 1.4, res: 1 });
      prod.vline(t, { color: C.text, width: 1, dash: [4, 4] });
      prod.knob(t, 0, C.text);
      prod.text(`τ = t = ${fmt(t, 3)}`, t, prod.v.ymax, { dx: 6, dy: 10, color: C.text, bold: true });

      const [lo2, hi2] = range([valueAt]);
      conv.setView(TMIN, TMAX, Math.max(lo2, -50), Math.min(hi2, 50));
      conv.begin();
      conv.fn(valueAt, { color: C.target, width: 1.5, dash: [4, 4] });
      conv.fn(valueAt, { color: C.purple, width: 2.8, x1: t });
      conv.vline(t, { color: C.text, width: 1, dash: [4, 4] });
      conv.dot(t, valueAt(t), 6, C.purple, '#fff');

      ro.set([
        ['Time t', fmt(t, 4)],
        ['(f ∗ g)(t) = shaded area', fmt(valueAt(t), 4), C.purple],
      ]);
    }
    return {
      draw,
      tick(dt) { let t = p.t + dt * p.speed; if (t > 6) t = -1; p.t = Number(t.toFixed(4)); ui.ctl('t').sync(); },
    };
  },
};
