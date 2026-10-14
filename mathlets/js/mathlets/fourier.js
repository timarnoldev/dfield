// Fourier coefficients: partial sums of Fourier series, coefficient chart, Gibbs phenomenon.
import { C } from '../plot.js';
import { compile } from '../parser.js';
import { fmt, fix, fourierNumeric, fourierEval, TAU, clamp } from '../math.js';

const NMAX = 60;
const NBINS = 256;
const PI = Math.PI;
const DRAWMAX = 3; // drawn values are limited to |y| ≤ DRAWMAX (the visible range)

/** reduce x to [-π, π) */
const red = (x) => x - TAU * Math.floor((x + PI) / TAU);

/** Analytic coefficients for the built-in targets. */
export function targetDef(kind, w = 1) {
  const a = new Array(NMAX + 1).fill(0), b = new Array(NMAX + 1).fill(0);
  switch (kind) {
    case 'square':
      for (let n = 1; n <= NMAX; n += 2) b[n] = 4 / (PI * n);
      return { f: (x) => { const r = red(x); return r === 0 || r === -PI ? 0 : Math.sign(r); }, a, b, jumps: [[0, -1, 1], [PI, 1, -1], [-PI, 1, -1]], label: 'Square wave' };
    case 'sawtooth':
      for (let n = 1; n <= NMAX; n++) b[n] = (2 * (n % 2 ? 1 : -1)) / n;
      return { f: (x) => { const r = red(x); return r === -PI ? 0 : r; }, a, b, jumps: [[PI, PI, -PI], [-PI, PI, -PI]], label: 'Sawtooth' };
    case 'triangle':
      a[0] = PI;
      for (let n = 1; n <= NMAX; n += 2) a[n] = -4 / (PI * n * n);
      return { f: (x) => Math.abs(red(x)), a, b, jumps: [], label: 'Triangle wave' };
    case 'pulse': {
      a[0] = (2 * w) / PI;
      for (let n = 1; n <= NMAX; n++) a[n] = (2 * Math.sin(n * w)) / (n * PI);
      return {
        f: (x) => { const r = Math.abs(red(x)); return r < w ? 1 : r === w ? 0.5 : 0; },
        a, b, jumps: w < PI ? [[-w, 0, 1], [w, 1, 0]] : [], label: 'Pulse',
      };
    }
    case 'abssin':
      a[0] = 4 / PI;
      for (let n = 2; n <= NMAX; n += 2) a[n] = -4 / (PI * (n * n - 1));
      return { f: (x) => Math.abs(Math.sin(x)), a, b, jumps: [], label: '|sin x|' };
    default: return null;
  }
}

/**
 * Find jump discontinuities of a 2π-periodic function by sampling. Returns [[x, left, right]].
 * One-sided limits are taken a few samples away so that narrow spikes are not mistaken for jumps.
 */
export function detectJumps(f) {
  const M = 1024, h = TAU / M, w = 24, k = 3; // window of w samples ≈ 0.15 rad
  const v = [];
  for (let i = 0; i < M; i++) v.push(f(-PI + (i + 0.5) * h));
  const at = (i) => v[((i % M) + M) % M];
  const fin = v.filter(Number.isFinite);
  if (!fin.length) return [];
  const range = Math.max(...fin) - Math.min(...fin) || 1;
  const D = Array.from({ length: M }, (_, i) => at(i + w) - at(i));
  const mags = D.map(Math.abs).filter(Number.isFinite).sort((p, q) => p - q);
  const typical = mags[Math.floor(mags.length * 0.8)] || 0;
  const thr = Math.max(0.2 * range, 4 * typical);
  const jumps = [];
  for (let i = 0; i < M; i++) {
    const a = Math.abs(D[i]);
    if (!(a > thr) || a < Math.abs(D[(i + M - 1) % M]) || a < Math.abs(D[(i + 1) % M])) continue; // local maximum only
    const L = at(i - k), R = at(i + w + k);
    if (!(Math.abs(R - L) > thr)) continue; // spike, not a jump
    // the jump sits where the samples cross the midpoint of the two one-sided values
    const mid = (L + R) / 2;
    let c = i + w / 2;
    for (let j = i; j < i + w; j++) if ((at(j) - mid) * (at(j + 1) - mid) <= 0) { c = j + 1; break; }
    const x = -PI + ((c % M) + M) % M * h;
    if (jumps.some((q) => Math.abs(q[0] - x) < w * h || Math.abs(Math.abs(q[0] - x) - TAU) < w * h)) continue;
    jumps.push([x, L, R]);
  }
  const out = [];
  for (const [x, L, R] of jumps.slice(0, 12)) { out.push([x, L, R]); if (Math.abs(Math.abs(x) - PI) < w * h) out.push([x > 0 ? x - TAU : x + TAU, L, R]); }
  return out;
}

export default {
  id: 'fourier',
  title: 'Fourier Coefficients',
  short: 'Partial sums of Fourier series, coefficients, Gibbs phenomenon — or draw your own function.',
  icon: '<path d="M5 34V14h10v20h10V14h10v20h8" stroke="#a7afb9"/><path d="M4 30c3-14 6-16 9-14s4 4 3 2 3-8 6-4 0 8 3 14 6-16 9-14 4 4 3 2 3-8 6-4" stroke="#1f5fd1"/>',
  defaults: { target: 'square', N: 7, width: 1, expr: 'x^2/3 - 1', drawn: [], chart: 'ab', gibbs: true, showTerm: false, showError: false },
  hint: 'Change N with the slider or by dragging in the coefficient chart.',
  info: `<p>A function <span class="m">f</span> of period 2π has a Fourier series
    <span class="m">f(x) ~ a<sub>0</sub>/2 + Σ (a<sub>n</sub> cos nx + b<sub>n</sub> sin nx)</span> with
    <span class="m">a<sub>n</sub> = (1/π)∫ f(x) cos nx dx</span>, <span class="m">b<sub>n</sub> = (1/π)∫ f(x) sin nx dx</span> over [−π, π].</p>
    <p>The blue curve is the partial sum <span class="m">S<sub>N</sub></span>. Even functions only need cosines, odd functions only sines.
    The smoother <span class="m">f</span> is, the faster the coefficients decay: like 1/n for a jump, 1/n² for a corner.</p>
    <p><strong>Gibbs phenomenon:</strong> near a jump, <span class="m">S<sub>N</sub></span> overshoots by about 9% of the jump size,
    no matter how large <span class="m">N</span> is — the overshoot just gets narrower. The RMS error still tends to 0.</p>
    <p>Choose <em>Draw your own</em> and sketch a function on [−π, π] with your finger or the mouse.</p>`,
  layout: (wide) => (wide
    ? { areas: '"main" "coef"', rows: '1.7fr 1fr' }
    : { areas: '"main" "coef"', rows: '1.5fr 1fr' }),

  create(env) {
    const p = env.p;
    const ui = env.ui;
    let data = null; // { f, a, b, jumps, label }
    let userFn = null;
    let drawing = false;

    const main = env.pane('main', { xmin: -2 * PI, xmax: 2 * PI, ymin: -1.5, ymax: 1.5, xTicks: 'pi', title: 'Function and partial sum', xlabel: 'x' });
    const coef = env.pane('coef', { xmin: -0.7, xmax: 20.7, ymin: -1, ymax: 1, title: 'Coefficients', xlabel: 'n', xname: 'n', yname: 'value' });

    const drawnFn = () => {
      const d = p.drawn;
      if (!d || d.length !== NBINS) return () => 0;
      return (x) => {
        const r = red(x);
        const u = ((r + PI) / TAU) * NBINS - 0.5;
        const i = Math.floor(u), t = u - i;
        const v0 = d[(i + NBINS) % NBINS], v1 = d[(i + 1) % NBINS];
        return v0 + (v1 - v0) * t;
      };
    };

    function recompute() {
      const def = targetDef(p.target, p.width);
      if (def) { data = def; return; }
      let f;
      if (p.target === 'expr') {
        if (!userFn) { try { userFn = compile(p.expr, ['x']); } catch { userFn = () => 0; } }
        const g = userFn;
        f = (x) => g(red(x));
      } else f = drawnFn();
      const { a, b } = fourierNumeric(f, NMAX, 8192);
      data = { f, a, b, jumps: detectJumps(f), label: p.target === 'expr' ? `f(x) = ${p.expr}` : 'Your drawing' };
    }

    // ---------------- controls
    ui.select('target', {
      label: 'Function',
      options: [['square', 'Square wave'], ['sawtooth', 'Sawtooth'], ['triangle', 'Triangle wave'], ['pulse', 'Pulse'],
        ['abssin', '|sin x|'], ['expr', 'Expression f(x) …'], ['draw', 'Draw your own …']],
      onChange: (v) => { if (v === 'draw' && p.drawn.length !== NBINS) p.drawn = new Array(NBINS).fill(0); recompute(); syncVis(); },
    });
    const wCtl = ui.slider('width', { label: 'Pulse half-width <span class="sym">w</span>', min: 0.1, max: 3, step: 0.05, onChange: recompute });
    const exprCtl = ui.expr('expr', { pre: 'f(x) =', vars: ['x'], onValid: (fn) => { userFn = fn; recompute(); } });
    const drawNote = ui.note('Draw on the upper plot (one period, −π ≤ x ≤ π). Drawing again replaces that part of the curve.');
    const drawBtns = ui.buttons([
      ['Clear drawing', () => { p.drawn = new Array(NBINS).fill(0); recompute(); }],
      ['Smooth', () => { const d = p.drawn; p.drawn = d.map((v, i) => (d[(i + NBINS - 1) % NBINS] + 2 * v + d[(i + 1) % NBINS]) / 4); recompute(); }],
    ]);
    ui.slider('N', { label: 'Number of terms <span class="sym">N</span>', min: 0, max: NMAX, step: 1 });
    ui.seg('chart', { label: 'Coefficient chart', options: [['ab', 'aₙ and bₙ'], ['mag', 'Amplitude √(aₙ²+bₙ²)']] });
    ui.check('gibbs', 'Highlight Gibbs overshoot at jumps');
    ui.check('showTerm', 'Show the last added term');
    ui.check('showError', 'Show the error f − S<sub>N</sub>');
    const ro = ui.readout();

    function syncVis() {
      wCtl.el.hidden = p.target !== 'pulse';
      exprCtl.el.hidden = p.target !== 'expr';
      drawNote.hidden = drawBtns.el.hidden = p.target !== 'draw';
      main.o.cursor = p.target === 'draw' ? 'cell' : 'crosshair';
      env.status(p.target === 'draw' ? 'Draw a function on the upper plot with your finger or the mouse.' : 'Change N with the slider or by dragging in the coefficient chart.');
    }

    // ---------------- interactions
    main.o.onDown = (x, y) => {
      if (p.target !== 'draw') return null;
      if (p.drawn.length !== NBINS) p.drawn = new Array(NBINS).fill(0);
      drawing = true;
      const binOf = (xx) => clamp(Math.floor((((xx >= -PI && xx <= PI) ? xx : red(xx)) + PI) / TAU * NBINS), 0, NBINS - 1);
      y = clamp(y, -DRAWMAX, DRAWMAX);
      let last = { b: binOf(x), y };
      p.drawn[last.b] = y;
      return {
        move(x2, y2) {
          y2 = clamp(y2, -DRAWMAX, DRAWMAX);
          const b2 = binOf(x2);
          // interpolate along the shorter way (handles wrap only if drawn across ±π)
          const lo = Math.min(last.b, b2), hi = Math.max(last.b, b2);
          if (hi - lo > NBINS / 2) { p.drawn[b2] = y2; last = { b: b2, y: y2 }; recompute(); return; } // crossed ±π: no interpolation across the wrap
          for (let i = lo; i <= hi; i++) {
            const t = hi === lo ? 1 : (i - last.b) / (b2 - last.b);
            p.drawn[i] = last.y + (y2 - last.y) * t;
          }
          last = { b: b2, y: y2 };
          recompute();
        },
        up() { drawing = false; recompute(); env.changed(); },
      };
    };
    const setNfrom = (x) => { const n = clamp(Math.round(x), 0, NMAX); if (n !== p.N) { p.N = n; ui.sync(); } };
    coef.o.onDown = (x) => { setNfrom(x); return { move: (x2) => setNfrom(x2) }; };
    coef.o.onHover = (x) => {
      const n = Math.round(x);
      if (!data || n < 0 || n > NMAX) return '';
      return n === 0 ? `a₀/2 = ${fmt(data.a[0] / 2)}` : `n = ${n}:  aₙ = ${fmt(data.a[n])}   bₙ = ${fmt(data.b[n])}`;
    };

    // ---------------- drawing
    function gibbsInfo(S) {
      const out = [];
      for (const [xj, L, R] of data.jumps) {
        const J = Math.abs(R - L);
        if (J < 1e-9) continue;
        const win = Math.min(PI / 2, (3 * PI) / (p.N + 1));
        let best = null;
        const hi = Math.max(L, R), lo = Math.min(L, R);
        for (let i = 0; i <= 240; i++) {
          const x = xj - win + (2 * win * i) / 240;
          const s = S(x);
          const over = Math.max(s - hi, lo - s);
          if (!best || over > best.over) best = { x, s, over, side: s - hi > lo - s ? hi : lo };
        }
        if (best) out.push({ xj, J, ...best, rel: best.over / J });
      }
      return out;
    }

    function draw() {
      if (!data) recompute();
      const N = p.N;
      const S = (x) => fourierEval(data.a, data.b, N, x);
      // y range from the target
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i <= 400; i++) {
        const v = data.f(-PI + (TAU * i) / 400);
        if (Number.isFinite(v)) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
      }
      if (p.target === 'draw') { ymin = -DRAWMAX / 1.5; ymax = DRAWMAX / 1.5; } // fixed view: no rescaling while drawing
      if (!Number.isFinite(ymin)) { ymin = -1; ymax = 1; }
      const pad = Math.max(0.25 * (ymax - ymin), 0.3);
      main.setView(-2 * PI, 2 * PI, ymin - pad, ymax + pad);
      main.o.legend = [[p.target === 'draw' ? 'your f' : 'f', C.target], [`S${sub(N)}`, C.blue]];
      if (p.showTerm && N > 0) main.o.legend.push([`term n=${N}`, C.green]);
      if (p.showError) main.o.legend.push(['f − S', C.red, [5, 4]]);
      main.begin();
      // shade the base period
      main.ctx.fillStyle = 'rgba(47,111,223,.05)';
      main.ctx.fillRect(main.X(-PI), main.L.top, main.X(PI) - main.X(-PI), main.L.h);
      main.fn(data.f, { color: C.target, width: 5 });
      if (p.showError) main.fn((x) => data.f(x) - S(x), { color: C.red, width: 1.6, dash: [5, 4] });
      if (p.showTerm && N > 0) main.fn((x) => data.a[N] * Math.cos(N * x) + data.b[N] * Math.sin(N * x), { color: C.green, width: 1.6 });
      main.fn(S, { color: C.blue, width: 2.4, res: 1, jumps: false });
      let gib = [];
      if (p.gibbs && N > 0 && data.jumps.length) {
        gib = gibbsInfo(S);
        for (const g of gib) {
          if (g.x < main.v.xmin || g.x > main.v.xmax) continue;
          const X = main.X(g.x);
          main.line(g.x - 0.5, g.s, g.x + 0.5, g.s, { color: C.orange, width: 1.5, dash: [3, 3] });
          main.line(g.x, g.side, g.x, g.s, { color: C.orange, width: 3 });
          main.dot(g.x, g.s, 4.5, C.orange);
          if (g.xj >= -PI && g.xj < PI && g.over > 1e-6) {
            main.textPx(`${fix(100 * g.rel, 1)}%`, X + 8, main.Y(g.s) + (g.s >= g.side ? -10 : 12), { color: C.orange, bold: true, bg: 'rgba(255,255,255,.85)' });
          }
        }
      }
      if (p.target === 'draw' && !drawing && p.drawn.every((v) => v === 0)) {
        main.textPx('Draw a function here ✎', main.L.left + main.L.w / 2, main.L.top + 26, { align: 'center', color: C.muted, size: 15, bold: true });
      }

      // ---- coefficient chart
      const nShow = Math.min(NMAX, Math.max(20, N + 4));
      let vmax = 0;
      const amp = (n) => (n === 0 ? Math.abs(data.a[0] / 2) : Math.hypot(data.a[n], data.b[n]));
      for (let n = 0; n <= nShow; n++) {
        if (p.chart === 'ab') vmax = Math.max(vmax, Math.abs(n === 0 ? data.a[0] / 2 : data.a[n]), Math.abs(data.b[n]));
        else vmax = Math.max(vmax, amp(n));
      }
      vmax = vmax * 1.15 || 1;
      coef.setView(-0.7, nShow + 0.7, p.chart === 'ab' ? -vmax : 0, vmax);
      coef.o.title = p.chart === 'ab' ? 'Coefficients' : 'Amplitudes';
      coef.o.legend = p.chart === 'ab' ? [['a₀/2, aₙ (cos)', C.blue], ['bₙ (sin)', C.red]] : [['√(aₙ² + bₙ²)', C.purple]];
      coef.begin();
      const ctx = coef.ctx;
      const bw = Math.max(2, Math.min(16, (coef.X(1) - coef.X(0)) * (p.chart === 'ab' ? 0.36 : 0.6)));
      coef.clip();
      // highlight included terms
      ctx.fillStyle = 'rgba(47,111,223,.07)';
      ctx.fillRect(coef.X(-0.5), coef.L.top, coef.X(N + 0.5) - coef.X(-0.5), coef.L.h);
      for (let n = 0; n <= nShow; n++) {
        const on = n <= N;
        const X = coef.X(n);
        const bar = (v, color, off) => {
          if (Math.abs(v) < 1e-12) return;
          const y0 = coef.Y(0), y1 = coef.Y(v);
          ctx.globalAlpha = on ? 1 : 0.28;
          ctx.fillStyle = color;
          ctx.fillRect(X + off - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
          ctx.globalAlpha = 1;
        };
        if (p.chart === 'ab') { bar(n === 0 ? data.a[0] / 2 : data.a[n], C.blue, -bw / 2 - 0.5); bar(data.b[n], C.red, bw / 2 + 0.5); }
        else bar(amp(n), C.purple, 0);
      }
      coef.unclip();
      // N marker
      coef.line(N + 0.5, coef.v.ymin, N + 0.5, coef.v.ymax, { color: C.blue, width: 2, dash: [6, 4] });
      coef.textPx(`N = ${N}`, coef.X(N + 0.5) + 5, coef.L.top + 12, { color: C.blue, bold: true });

      // ---- readouts
      const M = 2048;
      let e2 = 0, emax = 0, f2 = 0;
      for (let i = 0; i < M; i++) {
        const x = -PI + ((i + 0.5) * TAU) / M;
        const fv = data.f(x);
        if (!Number.isFinite(fv)) continue;
        const d = fv - S(x);
        e2 += d * d; f2 += fv * fv; emax = Math.max(emax, Math.abs(d));
      }
      const rms = Math.sqrt(e2 / M);
      let energy = data.a[0] * data.a[0] / 4;
      for (let n = 1; n <= N; n++) energy += (data.a[n] ** 2 + data.b[n] ** 2) / 2;
      const total = f2 / M;
      const g0 = gib.filter((g) => g.xj >= -PI && g.xj < PI).sort((a, b) => b.rel - a.rel)[0];
      ro.set([
        ['Terms', `N = ${N}`],
        ['RMS error ‖f − S<sub>N</sub>‖', fmt(rms, 3)],
        ['Max error', fmt(emax, 3)],
        ['Energy captured', total > 0 ? `${fix(clamp(100 * energy / total, 0, 100), 2)} %` : '—'],
        p.gibbs && g0 ? ['Gibbs overshoot', `${fix(100 * g0.rel, 2)} % of jump`, C.orange] : null,
        N > 0 ? [`a<sub>${N}</sub>, b<sub>${N}</sub>`, `${fmt(data.a[N], 3)}, ${fmt(data.b[N], 3)}`] : null,
      ]);
    }

    recompute();
    syncVis();
    return { draw };
  },
};

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
export const sub = (n) => String(n).split('').map((c) => SUBS[c] ?? c).join('');
