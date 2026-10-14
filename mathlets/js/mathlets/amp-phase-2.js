// Amplitude and phase response of a driven mass–spring–dashpot system.
import { C } from '../plot.js';
import { fmt, fix, rk4Step, clamp } from '../math.js';

/** Gain and phase lag of m x'' + b x' + k x = k cos(ωt). */
export function response2(m, b, k, w) {
  const re = k - m * w * w, im = b * w;
  return { g: k / Math.hypot(re, im), phi: Math.atan2(im, re) };
}
/** Practical resonance frequency (max gain) or null if none (ζ ≥ 1/√2). */
export function resonance2(m, b, k) {
  const s = k / m - (b * b) / (2 * m * m);
  return s > 0 ? Math.sqrt(s) : null;
}

const WMAX = 6;

export default {
  id: 'amp-phase-2',
  title: 'Amplitude & Phase: 2nd Order',
  short: 'Driven mass–spring–dashpot: gain, phase lag and resonance as the driving frequency changes.',
  icon: '<path d="M10 4h12M16 4v5l-5 2 10 3-10 3 10 3-5 2v3" stroke="#3b4148"/><rect x="9" y="27" width="14" height="9" rx="2" fill="#1f5fd1" stroke="none"/><path d="M27 40c3 0 4-26 7-26s4 12 11 12" stroke="#d1342f"/>',
  defaults: { m: 1, b: 0.5, k: 4, omega: 1.5, transient: false, logScale: false, speed: 1 },
  autoplay: true,
  hint: 'Drag the marker in the gain or phase plot to change the driving frequency ω.',
  info: `<p>The top of the spring is moved by the input signal <span class="m">y(t) = cos ωt</span>, so the mass obeys
    <span class="m">m x'' + b x' + k x = k y</span>. After the transient dies out, the output is
    <span class="m">x(t) = g cos(ωt − φ)</span>.</p>
    <p><strong>Gain</strong> <span class="m">g(ω) = k / |p(iω)| = k / √((k − mω²)² + b²ω²)</span>;
    <strong>phase lag</strong> <span class="m">φ(ω) = arg p(iω)</span> where <span class="m">p(s) = ms² + bs + k</span>. The output lags
    the input by the time <span class="m">φ/ω</span>.</p>
    <p>With natural frequency <span class="m">ω<sub>0</sub> = √(k/m)</span> and damping ratio <span class="m">ζ = b/(2√(mk))</span>,
    the gain peaks at the <strong>resonant frequency</strong> <span class="m">ω<sub>r</sub> = ω<sub>0</sub>√(1 − 2ζ²)</span>
    (only if <span class="m">ζ &lt; 1/√2</span>). At <span class="m">ω = ω<sub>0</sub></span> the phase lag is exactly π/2.</p>
    <p>Turn on <em>Start from rest</em> to see the transient: the solution with <span class="m">x(0) = x'(0) = 0</span> approaches the periodic response.</p>`,
  layout: (wide) => (wide
    ? { areas: '"pic time time" "pic gain phase"', cols: 'minmax(150px,0.42fr) 1fr 1fr', rows: '1fr 1fr' }
    : { areas: '"time time" "pic gain" "pic phase"', cols: 'minmax(140px,0.5fr) 1fr', rows: '1.1fr 1fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    let t = 0;
    const pic = env.pane('pic', { xmin: -1, xmax: 1, ymin: -4.2, ymax: 4.2, equal: true, grid: false, axes: false, noXLabels: true, noYLabels: true, title: 'System' });
    const time = env.pane('time', { title: 'Input and output', xlabel: 't', xname: 't', yname: 'x' });
    const gain = env.pane('gain', { title: 'Gain g(ω)', xlabel: 'ω', xname: 'ω', yname: 'g' });
    const phase = env.pane('phase', { title: 'Phase lag φ(ω)', xlabel: 'ω', yTicks: 'pi', xname: 'ω', yname: 'φ' });

    ui.slider('m', { label: 'Mass <span class="sym">m</span>', min: 0.25, max: 4, step: 0.05, onChange: invalidate });
    ui.slider('b', { label: 'Damping <span class="sym">b</span>', min: 0, max: 4, step: 0.05, onChange: invalidate });
    ui.slider('k', { label: 'Spring constant <span class="sym">k</span>', min: 0.25, max: 10, step: 0.05, onChange: invalidate });
    ui.slider('omega', { label: 'Input frequency <span class="sym">ω</span>', min: 0.05, max: WMAX, step: 0.01, onChange: invalidate });
    ui.check('transient', 'Start from rest (show transient)', { onChange: () => { t = 0; invalidate(); } });
    ui.check('logScale', 'Logarithmic frequency axis (Bode plot)');
    ui.slider('speed', { label: 'Animation speed', min: 0.1, max: 4, log: true });
    const ro = ui.readout();

    // ---------- trajectory (with transient) cache
    let cache = null;
    function invalidate() { cache = null; }
    const Tw = () => clamp(4 * (2 * Math.PI) / p.omega, 16, 60);
    function solution() {
      if (cache) return cache;
      const T = Tw(), dt = 0.01, n = Math.ceil(T / dt);
      const xs = new Float64Array(n + 1);
      if (p.transient) {
        const f = (tt, y) => [y[1], (p.k * Math.cos(p.omega * tt) - p.b * y[1] - p.k * y[0]) / p.m];
        let y = [0, 0];
        for (let i = 0; i <= n; i++) { xs[i] = y[0]; y = rk4Step(f, i * dt, y, dt); }
      } else {
        const { g, phi } = response2(p.m, p.b, p.k, p.omega);
        for (let i = 0; i <= n; i++) xs[i] = g * Math.cos(p.omega * i * dt - phi);
      }
      cache = { T, dt, xs };
      return cache;
    }
    const xAt = (tt) => {
      const s = solution();
      const u = tt / s.dt, i = Math.floor(u);
      if (i >= s.xs.length - 1) return s.xs[s.xs.length - 1];
      return s.xs[i] + (s.xs[i + 1] - s.xs[i]) * (u - i);
    };

    // ---------- frequency handles
    const setW = (w) => { p.omega = Number(clamp(w, 0.05, WMAX).toFixed(2)); ui.ctl('omega').sync(); invalidate(); };
    gain.handles = [{ pos: () => [p.omega, response2(p.m, p.b, p.k, p.omega).g], drag: (w) => setW(w), cursor: 'ew-resize' }];
    phase.handles = [{ pos: () => [p.omega, response2(p.m, p.b, p.k, p.omega).phi], drag: (w) => setW(w), cursor: 'ew-resize' }];
    gain.o.onDown = phase.o.onDown = (w) => { setW(w); return { move: (w2) => setW(w2) }; };
    time.o.onDown = (tt) => { const s = (x) => { t = clamp(x, 0, Tw()); }; s(tt); return { move: s }; };

    function drawSpring(x1, y1, y2, coils, width, color) {
      const ctx = pic.ctx;
      const X = pic.X(x1), Y1 = pic.Y(y1), Y2 = pic.Y(y2);
      const lead = 8;
      ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(X, Y1); ctx.lineTo(X, Y1 + Math.sign(Y2 - Y1) * lead);
      const len = Y2 - Y1 - 2 * Math.sign(Y2 - Y1) * lead;
      for (let i = 0; i < coils * 2; i++) {
        ctx.lineTo(X + (i % 2 ? -width : width), Y1 + Math.sign(Y2 - Y1) * lead + (len * (i + 0.5)) / (coils * 2));
      }
      ctx.lineTo(X, Y2 - Math.sign(Y2 - Y1) * lead); ctx.lineTo(X, Y2);
      ctx.stroke();
    }

    function drawPicture(yv, xv, scale) {
      pic.begin();
      const ctx = pic.ctx;
      const top = 3.1 + yv * scale, mass = xv * scale, floor = -3.6;
      const bw = pic.X(0.42) - pic.X(0);
      // ceiling guide + plunger
      ctx.fillStyle = '#d5d9de';
      ctx.fillRect(pic.X(-0.55), pic.Y(4.15), pic.X(0.55) - pic.X(-0.55), pic.Y(3.95) - pic.Y(4.15));
      ctx.fillStyle = C.orange;
      ctx.fillRect(pic.X(-0.3), pic.Y(top + 0.12), pic.X(0.3) - pic.X(-0.3), pic.Y(top - 0.12) - pic.Y(top + 0.12));
      ctx.strokeStyle = C.orange; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(pic.X(0), pic.Y(4)); ctx.lineTo(pic.X(0), pic.Y(top)); ctx.stroke();
      // spring
      drawSpring(0, top - 0.12, mass + 0.45, 7, bw * 0.55, '#3b4148');
      // dashpot: cylinder on the floor, piston from the mass
      const cylTop = -0.9;
      ctx.strokeStyle = '#3b4148'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(pic.X(-0.18), pic.Y(cylTop)); ctx.lineTo(pic.X(-0.18), pic.Y(floor)); ctx.lineTo(pic.X(0.18), pic.Y(floor)); ctx.lineTo(pic.X(0.18), pic.Y(cylTop));
      ctx.stroke();
      ctx.fillStyle = 'rgba(138,90,43,.25)';
      ctx.fillRect(pic.X(-0.18), pic.Y(cylTop - 0.1), pic.X(0.18) - pic.X(-0.18), pic.Y(floor) - pic.Y(cylTop - 0.1));
      const pist = mass - 1.75;
      ctx.beginPath(); ctx.moveTo(pic.X(0), pic.Y(mass - 0.45)); ctx.lineTo(pic.X(0), pic.Y(pist)); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(pic.X(-0.15), pic.Y(pist)); ctx.lineTo(pic.X(0.15), pic.Y(pist)); ctx.stroke();
      ctx.fillStyle = '#9aa1a9';
      ctx.fillRect(pic.X(-0.5), pic.Y(floor), pic.X(0.5) - pic.X(-0.5), 6);
      // mass
      ctx.fillStyle = C.blue;
      const mw = 0.32 + 0.1 * Math.sqrt(p.m);
      ctx.fillRect(pic.X(-mw), pic.Y(mass + 0.45), pic.X(mw) - pic.X(-mw), pic.Y(mass - 0.45) - pic.Y(mass + 0.45));
      pic.text('m', 0, mass, { color: '#fff', align: 'center', math: true, size: 17 });
      // reference ticks for equilibrium positions
      pic.line(0.62, 3.1, 0.85, 3.1, { color: C.orange, width: 1.5 });
      pic.line(0.62, 0, 0.85, 0, { color: C.blue, width: 1.5 });
      pic.line(0.72, 3.1, 0.72, top, { color: C.orange, width: 3 });
      pic.line(0.72, 0, 0.72, mass, { color: C.blue, width: 3 });
      pic.text('y', 0.9, 3.1 + 0.3, { color: C.orange, math: true });
      pic.text('x', 0.9, 0.3, { color: C.blue, math: true });
    }

    function draw() {
      const { m, b, k, omega } = p;
      const { g, phi } = response2(m, b, k, omega);
      const w0 = Math.sqrt(k / m), zeta = b / (2 * Math.sqrt(m * k));
      const wr = resonance2(m, b, k);
      const gpk = wr ? response2(m, b, k, wr).g : 1;
      const s = solution();
      let xmaxAbs = 1;
      for (let i = 0; i < s.xs.length; i += 4) xmaxAbs = Math.max(xmaxAbs, Math.abs(s.xs[i]));
      const T = s.T;
      if (t > T) t = 0;
      const yv = Math.cos(omega * t), xv = xAt(t);

      drawPicture(yv, xv, 0.85 / Math.max(1, xmaxAbs));

      // time plot
      const ym = Math.max(1.2, xmaxAbs) * 1.3;
      time.setView(0, T, -ym, ym);
      time.o.legend = [['input y = cos ωt', C.orange], ['output x(t)', C.blue]];
      time.begin();
      time.fn((tt) => Math.cos(omega * tt), { color: C.orange, width: 2 });
      time.fn(xAt, { color: C.blue, width: 2.6 });
      if (!p.transient && omega > 0.05) {
        // show the time lag between an input peak and the following output peak
        const per = (2 * Math.PI) / omega;
        const t0 = per * Math.max(1, Math.floor(T / per / 2));
        const t1 = t0 + phi / omega;
        if (t1 < T) {
          const yy = Math.max(1, g) + ym * 0.06;
          time.line(t0, 1, t0, yy, { color: C.gray, width: 1, dash: [3, 3] });
          time.line(t1, g, t1, yy, { color: C.gray, width: 1, dash: [3, 3] });
          time.arrow(t0, yy, t1, yy, C.purple, 2, 8);
          time.text(`lag φ/ω = ${fmt(phi / omega, 3)}`, (t0 + t1) / 2, yy, { dy: -11, align: 'center', color: C.purple, bold: true, bg: 'rgba(255,255,255,.8)' });
        }
      }
      time.vline(t, { color: C.text, width: 1.2, dash: [4, 4] });
      time.dot(t, yv, 5, C.orange);
      time.dot(t, xv, 5, C.blue);

      // gain plot
      const gmax = Math.max(1.3, Math.min(60, gpk * 1.15), g * 1.1);
      const wlo = p.logScale ? 0.05 : 0;
      gain.o.xlog = phase.o.xlog = p.logScale;
      gain.setView(wlo, p.logScale ? 10 : WMAX, 0, gmax);
      gain.begin();
      gain.hline(1, { color: C.gray, width: 1, dash: [4, 4] });
      gain.fn((w) => response2(m, b, k, w).g, { color: C.blue, width: 2.6, x0: Math.max(wlo, 1e-3) });
      if (wr) {
        gain.vline(wr, { color: C.red, width: 1.2, dash: [5, 4] });
        gain.dot(wr, gpk, 4, C.red);
        gain.text(`ωᵣ = ${fmt(wr, 3)}`, wr, gpk, { dx: 8, dy: -2, color: C.red, base: 'bottom', bg: 'rgba(255,255,255,.8)' });
      }
      gain.vline(omega, { color: C.text, width: 1, dash: [2, 3] });
      gain.knob(omega, g, C.purple);

      phase.setView(wlo, p.logScale ? 10 : WMAX, 0, Math.PI * 1.04);
      phase.begin();
      phase.hline(Math.PI / 2, { color: C.gray, width: 1, dash: [4, 4] });
      phase.vline(w0, { color: C.green, width: 1.2, dash: [5, 4] });
      phase.text(`ω₀ = ${fmt(w0, 3)}`, w0, Math.PI / 2, { dx: 6, dy: 12, color: C.green, bg: 'rgba(255,255,255,.8)' });
      phase.fn((w) => response2(m, b, k, w).phi, { color: C.blue, width: 2.6, x0: Math.max(wlo, 1e-3) });
      phase.vline(omega, { color: C.text, width: 1, dash: [2, 3] });
      phase.knob(omega, phi, C.purple);

      ro.set([
        ['Natural frequency ω₀ = √(k/m)', fmt(w0, 4)],
        ['Damping ratio ζ = b/(2√(mk))', fmt(zeta, 4)],
        ['Gain g(ω)', fmt(g, 4), C.purple],
        ['Phase lag φ(ω)', `${fmt(phi, 4)} rad = ${fix((phi * 180) / Math.PI, 1)}°`, C.purple],
        ['Time lag φ/ω', fmt(phi / omega, 4)],
        ['Resonant frequency ωᵣ', wr ? fmt(wr, 4) : 'none (ζ ≥ 1/√2)', C.red],
        wr ? ['Peak gain 1/(2ζ√(1−ζ²))', fmt(gpk, 4), C.red] : null,
      ]);
    }

    return {
      draw,
      tick(dt) { t += dt * p.speed; if (t > Tw()) t = p.transient ? 0 : t % ((2 * Math.PI) / p.omega); },
    };
  },
};
