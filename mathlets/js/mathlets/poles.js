// Poles and vibrations: transfer function 1/p(s) with draggable poles, impulse response, |H(iω)|.
import { C } from '../plot.js';
import { fmt, clamp, polyFromRoots, polyEvalC, rk4Step, toSup } from '../math.js';

const MAXORDER = 6;
const TEND = 20;

/** Expand pole list [[σ, ω, kind]] into complex roots. */
export function rootsOf(poles) {
  const r = [];
  for (const [s, w, kind] of poles) {
    if (kind === 'real') r.push([s, 0]);
    else { r.push([s, w]); r.push([s, -w]); }
  }
  return r;
}

/** Unit impulse response of p(D) w = δ (rest initial conditions), sampled with step dt. */
export function impulseResponse(coeffs, T = TEND, dt = 0.01) {
  const n = coeffs.length - 1;
  const f = (_, y) => {
    const out = new Array(n);
    for (let i = 0; i < n - 1; i++) out[i] = y[i + 1];
    let s = 0;
    for (let j = 1; j <= n; j++) s += coeffs[j] * y[n - j];
    out[n - 1] = -s;
    return out;
  };
  let y = new Array(n).fill(0);
  y[n - 1] = 1;
  const N = Math.round(T / dt);
  const ws = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    ws[i] = y[0];
    if (!Number.isFinite(y[0]) || Math.abs(y[0]) > 1e12) { for (let j = i; j <= N; j++) ws[j] = NaN; break; }
    y = rk4Step(f, i * dt, y, dt);
  }
  return { ws, dt };
}

function polyString(c) {
  const n = c.length - 1;
  const parts = [];
  c.forEach((a, i) => {
    const d = n - i;
    if (Math.abs(a) < 1e-10) return;
    const mag = Math.abs(a);
    const coef = d > 0 && Math.abs(mag - 1) < 1e-10 ? '' : fmt(mag, 3);
    const v = d === 0 ? '' : d === 1 ? 's' : `s${toSup(d)}`;
    parts.push({ sign: a < 0 ? '−' : '+', txt: `${coef}${coef && v ? ' ' : ''}${v}` || '1' });
  });
  return parts.map((q, i) => (i === 0 ? (q.sign === '−' ? '−' : '') + q.txt : ` ${q.sign} ${q.txt}`)).join('');
}

export default {
  id: 'poles',
  title: 'Poles & Vibrations',
  short: 'Drag the poles of H(s) = 1/p(s) and watch the impulse response and the frequency response change.',
  icon: '<path d="M30 4v40M4 24h40" stroke="#a7afb9"/><path d="M16 11l6 6M22 11l-6 6M16 31l6 6M22 31l-6 6" stroke="#d1342f" stroke-width="3"/><path d="M30 6c4 0 4 8 10 8s-6 2-6 10 0 10 6 10-6 8-10 8" stroke="#1f5fd1"/>',
  defaults: { poles: [[-0.4, 2, 'pair'], [-1.5, 0, 'real']], probe: 1.5, showDist: true, preset: '' },
  hint: 'Drag the poles (×) in the s-plane. Drag the green point on the imaginary axis to probe |H(iω)|.',
  info: `<p>An LTI system <span class="m">p(D) x = f(t)</span> has transfer function <span class="m">H(s) = 1/p(s)</span>. Its <strong>poles</strong>
    are the roots of <span class="m">p</span>; complex poles come in conjugate pairs because <span class="m">p</span> has real coefficients.</p>
    <p>The <strong>unit impulse response</strong> <span class="m">w(t)</span> (lower plot) is a combination of the modes
    <span class="m">e<sup>rt</sup></span>. A pole <span class="m">σ ± iω</span> contributes <span class="m">e<sup>σt</sup> cos(ωt − φ)</span>:
    the real part sets the decay rate, the imaginary part the frequency. The system is stable exactly when all poles lie in the left half-plane.</p>
    <p>The <strong>gain</strong> <span class="m">|H(iω)| = 1/|p(iω)|</span> is drawn sideways, with <span class="m">ω</span> on the same vertical axis as the s-plane.
    Since <span class="m">|p(iω)|</span> is the product of the distances from <span class="m">iω</span> to the poles, the gain peaks where
    <span class="m">iω</span> passes close to a pole: poles near the imaginary axis mean sharp resonance.</p>`,
  layout: (wide) => (wide
    ? { areas: '"s gain" "imp imp"', cols: '1.25fr 1fr', rows: '1.45fr 1fr' }
    : { areas: '"s gain" "imp imp"', cols: '1.2fr 1fr', rows: '1.3fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const splane = env.pane('s', { xmin: -4.5, xmax: 1.5, ymin: -4.5, ymax: 4.5, equal: true, title: 's-plane', xlabel: 'Re s', ylabel: 'Im s', xname: 'σ', yname: 'ω' });
    const gain = env.pane('gain', { title: 'Gain |H(iω)|', ylabel: 'ω', xname: '|H|', yname: 'ω' });
    const imp = env.pane('imp', { xmin: 0, xmax: TEND, title: 'Unit impulse response w(t)', xlabel: 't', xname: 't', yname: 'w' });

    const order = () => rootsOf(p.poles).length;
    const addBtns = ui.buttons([
      ['+ Pole pair', () => { if (order() + 2 <= MAXORDER) p.poles.push([-1, 1 + 0.5 * p.poles.length, 'pair']); }],
      ['+ Real pole', () => { if (order() + 1 <= MAXORDER) p.poles.push([-0.5 - 0.5 * p.poles.length, 0, 'real']); }],
      ['Remove last', () => { if (p.poles.length > 1) p.poles.pop(); }],
    ]);
    ui.select('preset', {
      label: 'Examples',
      options: [['', 'Choose …'], ['osc', 'Lightly damped oscillator'], ['over', 'Two real poles'], ['two', 'Two resonances'],
        ['unstable', 'Unstable pair'], ['third', 'Third order (pair + real)'], ['butter', 'Butterworth (3rd order)']],
      onChange: (v) => {
        const presets = {
          osc: [[-0.15, 2, 'pair']],
          over: [[-0.5, 0, 'real'], [-2, 0, 'real']],
          two: [[-0.12, 1, 'pair'], [-0.2, 3, 'pair']],
          unstable: [[0.15, 1.5, 'pair']],
          third: [[-0.4, 2, 'pair'], [-1.5, 0, 'real']],
          butter: [[-1, 0, 'real'], [-0.5, Math.sqrt(3) / 2, 'pair']],
        };
        if (presets[v]) p.poles = JSON.parse(JSON.stringify(presets[v]));
        p.preset = '';
        ui.sync();
      },
    });

    ui.check('showDist', 'Show distances from iω to the poles');
    const ro = ui.readout();

    // ----- handles
    function poleHandle(i, sign) {
      return {
        pos: () => { const q = p.poles[i]; return q ? [q[0], sign * q[1]] : [NaN, NaN]; },
        noOffset: true,
        drag(x, y, info) {
          const q = p.poles[i];
          if (!q) return;
          const sx = clamp(x, -6, 3);
          const nearAxis = Math.abs(info.py - splane.Y(0)) < 12;
          if (q[2] === 'real') {
            if (nearAxis || order() + 1 > MAXORDER) { q[0] = r3(sx); q[1] = 0; }
            else { q[2] = 'pair'; q[0] = r3(sx); q[1] = r3(Math.abs(y)); }
          } else {
            q[0] = r3(sx);
            q[1] = nearAxis ? 0 : r3(clamp(Math.abs(y), 0, 8));
          }
        },
      };
    }
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const probeHandle = { pos: () => [0, p.probe], drag: (_, y) => { p.probe = r3(clamp(y, -8, 8)); }, cursor: 'ns-resize', noOffset: true };
    function refreshHandles() {
      const hs = [];
      p.poles.forEach((q, i) => { hs.push(poleHandle(i, 1)); if (q[2] === 'pair') hs.push(poleHandle(i, -1)); });
      splane.handles = [...hs, probeHandle];
    }
    const setProbe = (y) => { p.probe = r3(clamp(y, -8, 8)); };
    gain.handles = [{ pos: () => [Math.min(gainAt(p.probe), gain.v.xmax), p.probe], drag: (_, y) => setProbe(y), cursor: 'ns-resize' }];
    gain.o.onDown = (_, y) => { setProbe(y); return { move: (_x, y2) => setProbe(y2) }; };

    let coeffs = [1];
    const gainAt = (w) => { const [re, im] = polyEvalC(coeffs, 0, w); return 1 / Math.hypot(re, im); };

    function draw() {
      refreshHandles();
      addBtns.buttons[0].disabled = order() + 2 > MAXORDER;
      addBtns.buttons[1].disabled = order() + 1 > MAXORDER;
      addBtns.buttons[2].disabled = p.poles.length <= 1;
      const roots = rootsOf(p.poles);
      coeffs = polyFromRoots(roots);
      const stable = roots.every(([re]) => re < -1e-9);
      const marginal = !stable && roots.every(([re]) => re <= 1e-9);
      const col = stable ? C.blue : marginal ? C.orange : C.red;

      // s-plane
      splane.begin();
      const v = splane.v;
      splane.ctx.fillStyle = 'rgba(209,52,47,.06)';
      splane.ctx.fillRect(splane.X(0), splane.L.top, splane.X(v.xmax) - splane.X(0), splane.L.h);
      splane.text('unstable', v.xmax, v.ymin, { align: 'right', dx: -6, dy: -30, color: C.red, size: 12 });
      splane.text('stable', v.xmin, v.ymin, { dx: 6, dy: -12, color: C.blue, size: 12 });
      if (p.showDist) for (const [re, im] of roots) splane.line(re, im, 0, p.probe, { color: C.green, width: 1.2, dash: [4, 3], alpha: 0.8 });
      splane.hline(p.probe, { color: C.green, width: 1, alpha: 0.4 });
      for (const [re, im] of roots) { splane.knob(re, im, col, { r: 12 }); splane.knob(re, im, col, { shape: 'x', r: 8 }); }
      splane.knob(0, p.probe, C.green, { r: 8, filled: true });
      splane.text(`iω = ${fmt(p.probe, 3)}i`, 0, p.probe, { dx: 12, dy: -12, color: C.green, bold: true, bg: 'rgba(255,255,255,.8)' });

      // gain plot sideways, sharing the s-plane's ω range
      let gmax = 0;
      const ys = [];
      for (let i = 0; i <= 600; i++) { const w = v.ymin + ((v.ymax - v.ymin) * i) / 600; const g = gainAt(w); ys.push([g, w]); if (Number.isFinite(g)) gmax = Math.max(gmax, g); }
      const gtop = Math.min(gmax * 1.1 || 1, 1e4);
      gain.setView(0, gtop, v.ymin, v.ymax);
      gain.begin();
      gain.poly(ys.map(([g, w]) => [Math.min(g, gtop * 3), w]), { color: C.purple, width: 2.6 });
      gain.hline(p.probe, { color: C.green, width: 1.2, dash: [4, 4] });
      const gp = gainAt(p.probe);
      gain.knob(Math.min(gp, gtop), p.probe, C.green, { r: 8, filled: true });
      let peak = [0, 0];
      for (const [g, w] of ys) if (w >= 0 && g > peak[0]) peak = [g, w];

      // impulse response
      const { ws, dt } = impulseResponse(coeffs);
      let wm = 0;
      for (let i = 0; i < ws.length; i++) if (Number.isFinite(ws[i])) wm = Math.max(wm, Math.abs(ws[i]));
      wm = Math.min(Math.max(wm, 1e-3) * 1.15, 1e6);
      imp.setView(0, TEND, -wm, wm);
      imp.o.legend = [[stable ? 'stable' : marginal ? 'marginally stable' : 'unstable', col]];
      imp.begin();
      imp.fn((t) => { const u = t / dt; const i = Math.floor(u); return i + 1 < ws.length ? ws[i] + (ws[i + 1] - ws[i]) * (u - i) : ws[ws.length - 1]; }, { color: col, width: 2.4 });

      const dists = roots.map(([re, im]) => Math.hypot(re, im - p.probe));
      const dom = roots.reduce((a, b) => (b[0] > a[0] ? b : a), roots[0]);
      ro.set([
        ['p(s)', polyString(coeffs)],
        { wide: `<span class="badge-big" style="background:${col}">${stable ? 'Stable' : marginal ? 'Marginally stable' : 'Unstable'}</span>` },
        ['Order', String(roots.length)],
        ['Slowest decay rate', fmt(-dom[0], 3)],
        ['|H(iω)| at probe ω', fmt(gp, 4), C.green],
        p.showDist ? ['= 1 / (product of distances)', `1 / (${dists.map((d) => fmt(d, 3)).join(' · ')})`] : null,
        ['Peak gain at ω', `${fmt(peak[1], 3)} (|H| = ${fmt(peak[0], 3)})`, C.purple],
      ]);
    }
    return { draw };
  },
};
