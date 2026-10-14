// Heat and wave equation on [0, π] with Dirichlet boundary conditions via Fourier sine modes.
import { C } from '../plot.js';
import { compile } from '../parser.js';
import { fmt, clamp, TAU } from '../math.js';

const PI = Math.PI;
const NMAX = 50;

const INITIAL = {
  box: { label: 'Block in the middle', f: (x) => (x > PI / 3 && x < (2 * PI) / 3 ? 1 : 0) },
  tri: { label: 'Plucked string (triangle)', f: (x) => (x < PI / 2 ? (2 * x) / PI : 2 - (2 * x) / PI) },
  pluck: { label: 'Plucked off-center', f: (x) => (x < PI / 4 ? (4 * x) / PI : (4 / 3) * (1 - x / PI)) },
  const: { label: 'Constant 1', f: () => 1 },
  mode2: { label: 'sin x + ½ sin 3x', f: (x) => Math.sin(x) + 0.5 * Math.sin(3 * x) },
  expr: { label: 'Expression …', f: null },
};

/** Sine coefficients b_n = (2/π)∫₀^π f(x) sin(nx) dx (midpoint rule). */
export function sineCoeffs(f, N, M = 4096) {
  const b = new Array(N + 1).fill(0);
  const h = PI / M;
  for (let i = 0; i < M; i++) {
    const x = (i + 0.5) * h;
    const v = f(x);
    if (!Number.isFinite(v)) continue;
    for (let n = 1; n <= N; n++) b[n] += v * Math.sin(n * x);
  }
  return b.map((v) => (v * 2 * h) / PI);
}

export default {
  id: 'heat',
  title: 'Heat & Wave Equation',
  bonus: true,
  short: 'Solve u_t = u_xx or u_tt = u_xx on [0, π] mode by mode with Fourier sine series.',
  icon: '<path d="M4 34C10 34 12 10 24 10s14 24 20 24" stroke="#d1342f"/><path d="M4 34c8 0 10-12 20-12s12 12 20 12" stroke="#e07b00"/><path d="M4 34c8 0 10-5 20-5s12 5 20 5" stroke="#1f5fd1"/>',
  defaults: { eq: 'heat', init: 'box', expr: 'x(pi - x)', N: 20, speed: 1, showModes: false },
  autoplay: true,
  hint: 'Press Play to run time; tap or drag in the mode chart to choose how many modes N are used.',
  info: `<p>A rod (heat equation <span class="m">u<sub>t</sub> = u<sub>xx</sub></span>) or a string (wave equation
    <span class="m">u<sub>tt</sub> = u<sub>xx</sub></span>) on <span class="m">0 ≤ x ≤ π</span> with ends held at 0.
    Separation of variables gives the normal modes <span class="m">sin nx</span>.</p>
    <p>Expanding the initial shape in a <strong>Fourier sine series</strong> <span class="m">u(x,0) = Σ b<sub>n</sub> sin nx</span>, the solution is</p>
    <p>heat: <span class="m">u(x,t) = Σ b<sub>n</sub> e<sup>−n²t</sup> sin nx</span> — high frequencies die out extremely fast, so the profile smooths out immediately and then decays like <span class="m">e<sup>−t</sup> sin x</span>;</p>
    <p>wave: <span class="m">u(x,t) = Σ b<sub>n</sub> cos(nt) sin nx</span> — every mode oscillates forever with its own frequency <span class="m">n</span>; the motion is periodic with period 2π.</p>`,
  layout: (wide) => (wide ? { areas: '"u modes"', cols: '1.6fr 1fr' } : { areas: '"u" "modes"', rows: '1.5fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    let t = 0;
    const up = env.pane('u', { xmin: 0, xmax: PI, xTicks: 'pi', title: 'u(x, t)', xlabel: 'x' });
    const mp = env.pane('modes', { xmin: 0.3, xmax: 20.7, title: 'Mode amplitudes', xlabel: 'n', xname: 'n', yname: 'amplitude' });
    mp.o.onDown = (x) => { const s = (v) => { p.N = clamp(Math.round(v), 1, NMAX); ui.sync(); }; s(x); return { move: s }; };
    let b = null, f0 = null;
    function recompute() {
      if (p.init === 'expr') {
        let g;
        try { g = compile(p.expr, ['x']); } catch { g = () => 0; }
        f0 = (x) => g(x);
      } else f0 = INITIAL[p.init].f;
      b = sineCoeffs(f0, NMAX).map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
      t = 0;
    }

    ui.seg('eq', { label: 'Equation', options: [['heat', 'Heat u_t = u_xx'], ['wave', 'Wave u_tt = u_xx']], onChange: () => { t = 0; } });
    ui.select('init', { label: 'Initial shape u(x, 0)', options: Object.entries(INITIAL).map(([k, v]) => [k, v.label]), onChange: () => { syncVis(); recompute(); } });
    const exprCtl = ui.expr('expr', { pre: 'u(x,0) =', vars: ['x'], onValid: recompute });
    ui.slider('N', { label: 'Number of modes <span class="sym">N</span>', min: 1, max: NMAX, step: 1 });
    ui.slider('speed', { label: 'Animation speed', min: 0.02, max: 2, log: true });
    ui.check('showModes', 'Show the individual modes');
    ui.buttons([['Restart at t = 0', () => { t = 0; }]]);
    const ro = ui.readout();
    function syncVis() { exprCtl.el.hidden = p.init !== 'expr'; }
    syncVis();

    const amp = (n) => (p.eq === 'heat' ? b[n] * Math.exp(-n * n * t) : b[n] * Math.cos(n * t));
    const u = (x) => { let s = 0; for (let n = 1; n <= p.N; n++) s += amp(n) * Math.sin(n * x); return s; };

    function draw() {
      if (!b) recompute();
      let lo = 0, hi = 0;
      for (let i = 0; i <= 200; i++) { const v = f0((PI * i) / 200); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      const M = Math.max(Math.abs(lo), Math.abs(hi), 0.5) * 1.25;
      up.setView(0, PI, p.eq === 'wave' || lo < 0 ? -M : -0.15 * M, M);
      up.o.legend = [['u(x, 0)', C.target], [`u(x, t), ${p.N} modes`, p.eq === 'heat' ? C.red : C.blue]];
      up.begin();
      up.fn(f0, { color: C.target, width: 4 });
      if (p.showModes) {
        const cols = [C.green, C.orange, C.purple, C.teal, C.brown];
        for (let n = 1; n <= Math.min(p.N, 5); n++) up.fn((x) => amp(n) * Math.sin(n * x), { color: cols[n - 1], width: 1.2, alpha: 0.8 });
      }
      up.fn(u, { color: p.eq === 'heat' ? C.red : C.blue, width: 2.8, res: 1 });
      up.text(`t = ${fmt(t, 3)}`, PI, up.v.ymax, { dx: -8, dy: 12, align: 'right', bold: true, color: C.text });

      const nShow = Math.min(NMAX, Math.max(12, p.N));
      let bm = 0;
      for (let n = 1; n <= nShow; n++) bm = Math.max(bm, Math.abs(b[n]));
      bm = bm * 1.15 || 1;
      mp.setView(0.3, nShow + 0.7, -bm, bm);
      mp.o.legend = [['bₙ (t = 0)', C.target], [p.eq === 'heat' ? 'bₙ e^(−n²t)' : 'bₙ cos(nt)', p.eq === 'heat' ? C.red : C.blue]];
      mp.begin();
      const ctx = mp.ctx;
      const bw = Math.max(3, Math.min(18, (mp.X(1) - mp.X(0)) * 0.5));
      for (let n = 1; n <= nShow; n++) {
        const X = mp.X(n);
        const Y0 = mp.Y(0);
        ctx.fillStyle = C.target; ctx.globalAlpha = n <= p.N ? 0.5 : 0.18;
        ctx.fillRect(X - bw / 2, Math.min(Y0, mp.Y(b[n])), bw, Math.abs(mp.Y(b[n]) - Y0));
        ctx.globalAlpha = n <= p.N ? 1 : 0.2;
        ctx.fillStyle = p.eq === 'heat' ? C.red : C.blue;
        const a = amp(n);
        ctx.fillRect(X - bw / 4, Math.min(Y0, mp.Y(a)), bw / 2, Math.max(1, Math.abs(mp.Y(a) - Y0)));
        ctx.globalAlpha = 1;
      }
      let energy = 0;
      for (let n = 1; n <= p.N; n++) energy += amp(n) ** 2;
      ro.set([
        ['Time t', fmt(t, 4)],
        ['b₁, b₂, b₃', `${fmt(b[1], 3)}, ${fmt(b[2], 3)}, ${fmt(b[3], 3)}`],
        ['Max |u(x, t)|', fmt(Math.max(...Array.from({ length: 101 }, (_, i) => Math.abs(u((PI * i) / 100)))), 4)],
        p.eq === 'heat' ? ['Decay of mode n', 'e^(−n²t)'] : ['Period of the motion', `2π ≈ ${fmt(TAU, 4)}`],
        ['Σ amplitude²', fmt(energy, 4)],
      ]);
    }
    return {
      draw,
      tick(dt) {
        t += dt * p.speed * (p.eq === 'heat' ? 0.25 : 2);
        if (p.eq === 'heat' && t > 4) t = 0;
        if (p.eq === 'wave' && t > 4 * PI) t -= 4 * PI;
      },
    };
  },
};
