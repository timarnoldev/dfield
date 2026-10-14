// Amplitude and phase response of a first-order system x' + kx = k cos(ωt) (heat exchange / RC circuit).
import { C } from '../plot.js';
import { fmt, fix, clamp } from '../math.js';

/** Gain and phase lag of x' + k x = k cos(ωt). */
export function response1(k, w) {
  return { g: k / Math.hypot(k, w), phi: Math.atan2(w, k) };
}
const WMAX = 6;

/** blue (−1) – white (0) – red (+1) */
function tempColor(v) {
  v = clamp(v, -1.2, 1.2) / 1.2;
  const a = Math.abs(v);
  const [r, g, b] = v >= 0 ? [214, 48, 39] : [33, 102, 222];
  const mix = (c) => Math.round(255 + (c - 255) * a);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export default {
  id: 'amp-phase-1',
  title: 'Amplitude & Phase: 1st Order',
  short: 'Heat exchange or an RC circuit driven by cos ωt: gain, phase lag and the break frequency.',
  icon: '<rect x="5" y="9" width="38" height="30" rx="3" fill="#f6c3bf" stroke="#d1342f"/><rect x="15" y="17" width="18" height="16" rx="2" fill="#fbe2df" stroke="#1f5fd1"/><path d="M24 12v8" stroke="#3b4148"/>',
  defaults: { k: 1, omega: 1.5, x0: 0, transient: false, logScale: false, speed: 1 },
  autoplay: true,
  hint: 'Drag the marker in the gain or phase plot to change the driving frequency ω.',
  info: `<p>A cup of liquid with temperature <span class="m">x(t)</span> sits in a bath whose temperature oscillates,
    <span class="m">y(t) = cos ωt</span>. Newton's law of cooling gives <span class="m">x' = k (y − x)</span>, i.e.
    <span class="m">x' + kx = k cos ωt</span>. (The same equation describes the capacitor voltage in an RC circuit with <span class="m">k = 1/RC</span>.)</p>
    <p>The periodic solution is <span class="m">x(t) = g cos(ωt − φ)</span> with
    <span class="m">g = 1/√(1 + (ω/k)²)</span> and <span class="m">φ = arctan(ω/k)</span>. Slow inputs pass almost unchanged,
    fast inputs are damped and delayed by up to a quarter period: the system is a <strong>low-pass filter</strong>.</p>
    <p>At the <strong>break frequency</strong> <span class="m">ω = k</span> the gain is <span class="m">1/√2</span> and the lag is π/4.
    With <em>Start from rest</em> you also see the transient <span class="m">c e<sup>−kt</sup></span> die out.</p>`,
  layout: (wide) => (wide
    ? { areas: '"pic time time" "pic gain phase"', cols: 'minmax(150px,0.5fr) 1fr 1fr', rows: '1fr 1fr' }
    : { areas: '"pic time" "gain phase"', cols: 'minmax(170px,0.42fr) 1fr', rows: '1fr 1fr' }), // the bath picture is wide, not tall

  create(env) {
    const p = env.p, ui = env.ui;
    let t = 0;
    const pic = env.pane('pic', { xmin: -1, xmax: 1, ymin: -1.6, ymax: 1.6, equal: true, grid: false, axes: false, noXLabels: true, noYLabels: true, title: 'Bath and cup' });
    const time = env.pane('time', { title: 'Input and output', xlabel: 't', xname: 't', yname: 'x' });
    const gain = env.pane('gain', { title: 'Gain g(ω)', xlabel: 'ω', xname: 'ω', yname: 'g' });
    const phase = env.pane('phase', { title: 'Phase lag φ(ω)', xlabel: 'ω', yTicks: 'pi', xname: 'ω', yname: 'φ' });

    ui.slider('k', { label: 'Coupling constant <span class="sym">k</span>', min: 0.1, max: 5, step: 0.05 });
    ui.slider('omega', { label: 'Input frequency <span class="sym">ω</span>', min: 0.05, max: WMAX, step: 0.01 });
    ui.check('transient', 'Start from x(0) = x₀ (show transient)', { onChange: () => { t = 0; syncVis(); } });
    const x0Ctl = ui.slider('x0', { label: 'Initial temperature <span class="sym">x</span>₀', min: -2, max: 2, step: 0.05, onChange: () => { t = 0; } });
    ui.check('logScale', 'Logarithmic frequency axis (Bode plot)');
    ui.slider('speed', { label: 'Animation speed', min: 0.1, max: 4, log: true });
    const ro = ui.readout();
    function syncVis() { x0Ctl.el.hidden = !p.transient; }
    syncVis();

    const Tw = () => clamp(4 * (2 * Math.PI) / p.omega, 16, 60);
    const xAt = (tt) => {
      const { g, phi } = response1(p.k, p.omega);
      const xp = g * Math.cos(p.omega * tt - phi);
      if (!p.transient) return xp;
      return xp + (p.x0 - g * Math.cos(phi)) * Math.exp(-p.k * tt);
    };
    const setW = (w) => { p.omega = Number(clamp(w, 0.05, WMAX).toFixed(2)); ui.ctl('omega').sync(); };
    gain.handles = [{ pos: () => [p.omega, response1(p.k, p.omega).g], drag: (w) => setW(w), cursor: 'ew-resize' }];
    phase.handles = [{ pos: () => [p.omega, response1(p.k, p.omega).phi], drag: (w) => setW(w), cursor: 'ew-resize' }];
    gain.o.onDown = phase.o.onDown = (w) => { setW(w); return { move: (w2) => setW(w2) }; };
    time.o.onDown = (tt) => { const s = (x) => { t = clamp(x, 0, Tw()); }; s(tt); return { move: s }; };

    function thermometer(x, v, color, label) {
      const ctx = pic.ctx;
      const lo = -1.25, hi = 1.25;
      const X = pic.X(x), w = 9;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3b4148';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X - w, pic.Y(hi), 2 * w, pic.Y(lo) - pic.Y(hi), w); else ctx.rect(X - w, pic.Y(hi), 2 * w, pic.Y(lo) - pic.Y(hi));
      ctx.fill(); ctx.stroke();
      const lvl = clamp(v, -1.15, 1.15);
      ctx.fillStyle = color;
      ctx.fillRect(X - w + 4, pic.Y(lvl), 2 * w - 8, pic.Y(lo + 0.05) - pic.Y(lvl));
      pic.line(x - 0.09, 0, x + 0.09, 0, { color: '#3b4148', width: 1 });
      pic.text(label, x, lo - 0.18, { align: 'center', math: true, color, size: 16 });
    }

    function draw() {
      const { k, omega } = p;
      const { g, phi } = response1(k, omega);
      const T = Tw();
      if (t > T) t = 0;
      const yv = Math.cos(omega * t), xv = xAt(t);

      // picture
      pic.begin();
      const ctx = pic.ctx;
      ctx.fillStyle = tempColor(yv);
      ctx.strokeStyle = '#3b4148'; ctx.lineWidth = 2;
      ctx.fillRect(pic.X(-0.75), pic.Y(0.9), pic.X(0.45) - pic.X(-0.75), pic.Y(-1.3) - pic.Y(0.9));
      ctx.strokeRect(pic.X(-0.75), pic.Y(0.9), pic.X(0.45) - pic.X(-0.75), pic.Y(-1.3) - pic.Y(0.9));
      ctx.fillStyle = tempColor(xv);
      ctx.fillRect(pic.X(-0.45), pic.Y(0.45), pic.X(0.15) - pic.X(-0.45), pic.Y(-0.95) - pic.Y(0.45));
      ctx.lineWidth = 3;
      ctx.strokeRect(pic.X(-0.45), pic.Y(0.45), pic.X(0.15) - pic.X(-0.45), pic.Y(-0.95) - pic.Y(0.45));
      pic.text('bath y', -0.6, 0.72, { math: true, color: C.text, size: 14 });
      pic.text('cup x', -0.15, -0.25, { math: true, color: C.text, size: 14, align: 'center' });
      thermometer(0.62, yv, C.orange, 'y');
      thermometer(0.86, xv, C.blue, 'x');

      // time plot
      let xm = 1;
      if (p.transient) xm = Math.max(1, Math.abs(p.x0));
      const ym = xm * 1.3;
      time.setView(0, T, -ym, ym);
      time.o.legend = [['input y = cos ωt', C.orange], ['output x(t)', C.blue]];
      time.begin();
      time.fn((tt) => Math.cos(omega * tt), { color: C.orange, width: 2 });
      if (p.transient) time.fn((tt) => g * Math.cos(omega * tt - phi), { color: C.blue, width: 1.2, dash: [5, 4], alpha: 0.6 });
      time.fn(xAt, { color: C.blue, width: 2.6 });
      if (!p.transient) {
        const per = (2 * Math.PI) / omega;
        const t0 = per * Math.max(1, Math.floor(T / per / 2));
        const t1 = t0 + phi / omega;
        const yy = 1 + ym * 0.08;
        time.line(t0, 1, t0, yy, { color: C.gray, width: 1, dash: [3, 3] });
        time.line(t1, g, t1, yy, { color: C.gray, width: 1, dash: [3, 3] });
        time.arrow(t0, yy, t1, yy, C.purple, 2, 8);
        time.text(`lag φ/ω = ${fmt(phi / omega, 3)}`, (t0 + t1) / 2, yy, { dy: -11, align: 'center', color: C.purple, bold: true, bg: 'rgba(255,255,255,.8)' });
      }
      time.vline(t, { color: C.text, width: 1.2, dash: [4, 4] });
      time.dot(t, yv, 5, C.orange);
      time.dot(t, xv, 5, C.blue);

      // Bode
      const wlo = p.logScale ? 0.05 : 0;
      gain.o.xlog = phase.o.xlog = p.logScale;
      gain.setView(wlo, p.logScale ? 10 : WMAX, 0, 1.15);
      gain.begin();
      gain.hline(Math.SQRT1_2, { color: C.gray, width: 1, dash: [4, 4] });
      gain.vline(k, { color: C.red, width: 1.2, dash: [5, 4] });
      gain.text(`break ω = k`, k, Math.SQRT1_2, { dx: 6, dy: -12, color: C.red, bg: 'rgba(255,255,255,.8)' });
      gain.fn((w) => response1(k, w).g, { color: C.blue, width: 2.6, x0: Math.max(wlo, 1e-3) });
      gain.vline(omega, { color: C.text, width: 1, dash: [2, 3] });
      gain.knob(omega, g, C.purple);

      phase.setView(wlo, p.logScale ? 10 : WMAX, 0, Math.PI / 2 * 1.08);
      phase.o.yTicks = null;
      phase.begin();
      phase.hline(Math.PI / 4, { color: C.gray, width: 1, dash: [4, 4] });
      phase.hline(Math.PI / 2, { color: C.gray, width: 1, dash: [2, 3] });
      phase.text('π/2', phase.v.xmax, Math.PI / 2, { dx: -6, dy: 10, align: 'right', color: C.muted });
      phase.text('π/4', phase.v.xmax, Math.PI / 4, { dx: -6, dy: 10, align: 'right', color: C.muted });
      phase.vline(k, { color: C.red, width: 1.2, dash: [5, 4] });
      phase.fn((w) => response1(k, w).phi, { color: C.blue, width: 2.6, x0: Math.max(wlo, 1e-3) });
      phase.vline(omega, { color: C.text, width: 1, dash: [2, 3] });
      phase.knob(omega, phi, C.purple);

      ro.set([
        ['Gain g = 1/√(1+(ω/k)²)', fmt(g, 4), C.purple],
        ['Phase lag φ = arctan(ω/k)', `${fmt(phi, 4)} rad = ${fix((phi * 180) / Math.PI, 1)}°`, C.purple],
        ['Time lag φ/ω', fmt(phi / omega, 4)],
        ['Time constant 1/k', fmt(1 / k, 4)],
        ['Break frequency ω = k', fmt(k, 4), C.red],
      ]);
    }

    return {
      draw,
      tick(dt) { t += dt * p.speed; if (t > Tw()) t = p.transient ? 0 : t % ((2 * Math.PI) / p.omega); },
    };
  },
};
