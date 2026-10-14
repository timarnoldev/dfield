// Fourier coefficients – sliders: build a signal from a0..a8, b1..b8 and match a target.
import { C } from '../plot.js';
import { fmt, fix, fourierEval, clamp, rng } from '../math.js';
import { targetDef, sub } from './fourier.js';

const K = 8;
const PI = Math.PI;
const keysA = Array.from({ length: K + 1 }, (_, n) => `a${n}`);
const keysB = Array.from({ length: K }, (_, n) => `b${n + 1}`);
const zeroCoeffs = Object.fromEntries([...keysA, ...keysB].map((k) => [k, 0]));

function puzzle(seed, level) {
  const r = rng(seed * 7919 + 13);
  const a = new Array(K + 1).fill(0), b = new Array(K + 1).fill(0);
  const cfg = { easy: { n: 2, maxH: 3, vals: [0.5, 1, 1.5] }, medium: { n: 3, maxH: 5, vals: [0.5, 1, 1.5] }, hard: { n: 5, maxH: 8, vals: [0.25, 0.5, 0.75, 1, 1.25, 1.5] } }[level];
  const used = new Set();
  let guard = 0;
  while (used.size < cfg.n && guard++ < 100) {
    const n = 1 + Math.floor(r() * cfg.maxH);
    const isA = r() < 0.5;
    const key = `${isA ? 'a' : 'b'}${n}`;
    if (used.has(key)) continue;
    used.add(key);
    const v = cfg.vals[Math.floor(r() * cfg.vals.length)] * (r() < 0.5 ? -1 : 1);
    if (isA) a[n] = v; else b[n] = v;
  }
  if (level !== 'easy' && r() < 0.5) a[0] = (r() < 0.5 ? -1 : 1) * (level === 'hard' ? 0.5 : 1);
  return { a, b, exact: true };
}

export default {
  id: 'fourier-match',
  title: 'Fourier Coefficients – Match',
  short: 'Build a signal from cosines and sines with coefficient sliders and match the mystery target.',
  icon: '<path d="M4 24c5-14 9-14 14 0s9 14 14 0 7-10 12-4" stroke="#a7afb9" stroke-width="5"/><path d="M4 24c5-14 9-14 14 0s9 14 14 0 7-10 12-4" stroke="#1f5fd1"/><path d="M10 44v-8M18 44v-12M26 44v-5M34 44v-9" stroke="#d1342f" stroke-width="3.5"/>',
  defaults: { target: 'puzzle', level: 'easy', seed: 1, solved: 0, showAnswer: false, showParts: false, ...zeroCoeffs },
  hint: 'Drag the bar tops in the lower chart or use the sliders to change the coefficients.',
  info: `<p>Your signal is <span class="m">a<sub>0</sub>/2 + Σ<sub>n=1..8</sub> (a<sub>n</sub> cos nx + b<sub>n</sub> sin nx)</span>.
    Adjust the coefficients until the blue curve covers the gray target.</p>
    <p><strong>Strategy:</strong> the constant <span class="m">a<sub>0</sub>/2</span> is the average height. Count how many times the target
    repeats on [−π, π] to find the frequencies <span class="m">n</span> involved. Cosines are even (symmetric about x = 0),
    sines are odd. A cosine term has a maximum at x = 0, a sine term crosses 0 there going up.</p>
    <p>For the square, triangle and sawtooth targets no finite sum matches exactly; the best you can do is to use the true
    Fourier coefficients — the readout shows how close you are to that optimum (orthogonality at work!).</p>`,
  layout: (wide) => (wide ? { areas: '"main" "bars"', rows: '1.4fr 1fr' } : { areas: '"main" "bars"', rows: '1.3fr 1fr' }),

  create(env) {
    const p = env.p;
    const ui = env.ui;
    const main = env.pane('main', { xmin: -PI, xmax: PI, ymin: -3, ymax: 3, xTicks: 'pi', title: 'Target and your signal', xlabel: 'x' });
    const bars = env.pane('bars', { xmin: -0.6, xmax: K + 0.6, ymin: -2.2, ymax: 2.2, title: 'Coefficients', xlabel: 'n', xname: 'n', yname: 'value' });

    let target = null;
    function makeTarget() {
      if (p.target === 'puzzle') target = puzzle(p.seed, p.level);
      else {
        const d = targetDef(p.target);
        target = { a: d.a, b: d.b, f: d.f, exact: false };
        // the triangle wave |x| has mean π/2, i.e. a₀ = π: outside the slider range ±2 → match its zero-mean version
        if (p.target === 'triangle') { const a0 = d.a[0]; target.a = d.a.slice(); target.a[0] = 0; target.f = (x) => d.f(x) - a0 / 2; }
      }
    }
    const A = () => keysA.map((k) => p[k]);
    const B = () => [0, ...keysB.map((k) => p[k])];

    ui.select('target', {
      label: 'Target',
      options: [['puzzle', 'Mystery signal (puzzle)'], ['square', 'Square wave'], ['triangle', 'Triangle wave |x| − π/2'], ['sawtooth', 'Sawtooth']],
      onChange: () => { p.showAnswer = false; makeTarget(); syncVis(); ui.sync(); },
    });
    const levelCtl = ui.seg('level', { options: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], onChange: () => newPuzzle() });
    const btns = ui.buttons([
      ['New puzzle', () => newPuzzle(), { primary: true }],
      ['Zero all', () => { Object.assign(p, zeroCoeffs); ui.sync(); }],
      ['Show answer', (b) => { p.showAnswer = !p.showAnswer; b.textContent = p.showAnswer ? 'Hide answer' : 'Show answer'; }],
    ]);
    const answerBtn = btns.buttons[2];
    ui.check('showParts', 'Show the individual terms');
    const ro = ui.readout();
    ui.section('Cosine coefficients');
    keysA.forEach((k, n) => ui.slider(k, { label: n === 0 ? '<span class="sym">a</span>₀' : `<span class="sym">a</span>${sub(n)}`, aria: k, min: -2, max: 2, step: 0.05, compact: true }));
    ui.section('Sine coefficients');
    keysB.forEach((k, i) => ui.slider(k, { label: `<span class="sym">b</span>${sub(i + 1)}`, aria: k, min: -2, max: 2, step: 0.05, compact: true }));

    function newPuzzle() {
      p.target = 'puzzle';
      p.seed = 1 + Math.floor(Math.random() * 1e6);
      p.showAnswer = false;
      answerBtn.textContent = 'Show answer';
      Object.assign(p, zeroCoeffs);
      makeTarget();
      syncVis();
      ui.sync();
    }
    function syncVis() {
      levelCtl.el.hidden = btns.buttons[0].hidden = p.target !== 'puzzle';
      answerBtn.textContent = p.showAnswer ? 'Hide answer' : 'Show answer';
    }

    // draggable bar tops
    const mkHandle = (key, x, color) => ({
      color,
      pos: () => [x, p[key]],
      drag: (_, y) => { p[key] = clamp(Math.round(y / 0.05) * 0.05, -2, 2); p[key] = Number(p[key].toFixed(2)); ui.ctl(key).sync(); },
      noOffset: false,
    });
    bars.handles = [
      ...keysA.map((k, n) => mkHandle(k, n - 0.18, C.blue)),
      ...keysB.map((k, i) => mkHandle(k, i + 1 + 0.18, C.red)),
    ];
    bars.o.onHover = (x) => {
      const n = Math.round(x);
      if (n < 0 || n > K) return '';
      return n === 0 ? `a₀ = ${fmt(p.a0)}` : `n = ${n}: a${sub(n)} = ${fmt(p[`a${n}`])}, b${sub(n)} = ${fmt(p[`b${n}`])}`;
    };

    function distance() {
      const a = A(), b = B();
      if (target.exact) {
        let s = ((a[0] - target.a[0]) / 2) ** 2;
        for (let n = 1; n <= K; n++) s += ((a[n] - target.a[n]) ** 2 + (b[n] - target.b[n]) ** 2) / 2;
        return { d: Math.sqrt(s), best: 0 };
      }
      const M = 2048;
      let s = 0, sb = 0;
      for (let i = 0; i < M; i++) {
        const x = -PI + ((i + 0.5) * 2 * PI) / M;
        const f = target.f(x);
        s += (f - fourierEval(a, b, K, x)) ** 2;
        sb += (f - fourierEval(target.a, target.b, K, x)) ** 2;
      }
      return { d: Math.sqrt(s / M), best: Math.sqrt(sb / M) };
    }

    function draw() {
      if (!target) makeTarget();
      const a = A(), b = B();
      const tf = target.exact ? (x) => fourierEval(target.a, target.b, K, x) : target.f;
      let ym = 2.5;
      for (let i = 0; i <= 200; i++) {
        const x = -PI + (2 * PI * i) / 200;
        ym = Math.max(ym, Math.abs(tf(x)) * 1.15, Math.min(12, Math.abs(fourierEval(a, b, K, x)) * 1.1)); // keep your signal in view
      }
      main.setView(-PI, PI, -ym, ym);
      main.o.legend = [['target', C.target], ['your signal', C.blue]];
      main.begin();
      main.fn(tf, { color: C.target, width: 6 });
      if (p.showParts) {
        const cols = [C.green, C.orange, C.purple, C.teal, C.brown, C.red, '#c2185b', '#5d4037'];
        if (a[0]) main.hline(a[0] / 2, { color: C.gray, width: 1.4, dash: [4, 4] });
        for (let n = 1; n <= K; n++) {
          if (a[n] || b[n]) main.fn((x) => a[n] * Math.cos(n * x) + b[n] * Math.sin(n * x), { color: cols[n - 1], width: 1.3, alpha: 0.8 });
        }
      }
      if (p.showAnswer && !target.exact) main.fn((x) => fourierEval(target.a, target.b, K, x), { color: C.green, width: 1.6, dash: [6, 4] });
      main.fn((x) => fourierEval(a, b, K, x), { color: C.blue, width: 2.6, jumps: false });

      // bars
      bars.o.legend = [['aₙ (cos)', C.blue], ['bₙ (sin)', C.red]];
      if (p.showAnswer) bars.o.legend.push(['answer', C.green, [4, 3]]);
      bars.begin();
      const ctx = bars.ctx;
      const bw = Math.max(6, Math.min(22, (bars.X(1) - bars.X(0)) * 0.28));
      const bar = (x, v, color) => {
        const y0 = bars.Y(0), y1 = bars.Y(v);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(bars.X(x) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
        ctx.globalAlpha = 1;
      };
      const ghost = (x, v) => {
        if (Math.abs(v) < 1e-9) return;
        const y0 = bars.Y(0), y1 = bars.Y(clamp(v, -2.2, 2.2));
        ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.strokeRect(bars.X(x) - bw / 2 - 2, Math.min(y0, y1), bw + 4, Math.abs(y1 - y0));
        ctx.setLineDash([]);
      };
      for (let n = 0; n <= K; n++) {
        bar(n - 0.18, a[n], C.blue);
        if (n > 0) bar(n + 0.18, b[n], C.red);
        if (p.showAnswer) { ghost(n - 0.18, target.a[n]); if (n > 0) ghost(n + 0.18, target.b[n]); }
      }
      for (const hd of bars.handles) {
        const [x, y] = hd.pos();
        bars.knob(x, y, hd.color, { r: 7 });
      }

      const { d, best } = distance();
      const rows = [['RMS distance to target', fmt(d, 3)]];
      if (target.exact) {
        const solved = d < 0.03;
        rows.push({ wide: solved ? `<span class="badge-big" style="background:${C.green}">✓ Matched! Try a new puzzle.</span>` : d < 0.3 ? 'Getting close …' : 'Keep going …' });
      } else {
        rows.push(['Best possible with n ≤ 8', fmt(best, 3)]);
        rows.push({ wide: d * d - best * best < 0.003 ? `<span class="badge-big" style="background:${C.green}">✓ Optimal! These are the Fourier coefficients.</span>` : `${fix(Math.min(100, (100 * best) / d), 0)} % of optimal` });
      }
      ro.set(rows);
    }

    makeTarget();
    syncVis();
    return { draw };
  },
};
