// Damped vibrations x'' + b x' + k x = 0: time plot, phase plane, roots in the complex plane, (b,k) plane.
import { C } from '../plot.js';
import { fmt, clamp } from '../math.js';

const BMAX = 8, KMAX = 16, TMAX = 15;
const EPS = 1e-9;

/** Solution of x'' + b x' + k x = 0 with x(0)=x0, x'(0)=v0. Returns {x(t), v(t), regime, roots}. */
export function dampedSolution(b, k, x0, v0) {
  const disc = b * b - 4 * k;
  const s = -b / 2;
  // tolerance covers the rounding of b and k to a few decimals (sliders, snapping, "make critical")
  if (Math.abs(disc) < 1e-5 * Math.max(1, b * b)) {
    const c = v0 - s * x0;
    return {
      regime: b === 0 ? 'undamped' : 'critical',
      roots: [[s, 0], [s, 0]],
      x: (t) => Math.exp(s * t) * (x0 + c * t),
      v: (t) => Math.exp(s * t) * (s * (x0 + c * t) + c),
    };
  }
  if (disc < 0) {
    const wd = Math.sqrt(-disc) / 2;
    const B = (v0 - s * x0) / wd;
    return {
      regime: b < EPS ? 'undamped' : 'under',
      roots: [[s, wd], [s, -wd]],
      wd,
      amp: Math.hypot(x0, B),
      x: (t) => Math.exp(s * t) * (x0 * Math.cos(wd * t) + B * Math.sin(wd * t)),
      v: (t) => Math.exp(s * t) * ((s * x0 + wd * B) * Math.cos(wd * t) + (s * B - wd * x0) * Math.sin(wd * t)),
    };
  }
  const q = Math.sqrt(disc) / 2;
  const r1 = s + q, r2 = s - q;
  const c1 = (v0 - r2 * x0) / (r1 - r2), c2 = x0 - c1;
  return {
    regime: 'over',
    roots: [[r1, 0], [r2, 0]],
    x: (t) => c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t),
    v: (t) => c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t),
  };
}

const REG = {
  undamped: ['Undamped', C.purple],
  under: ['Underdamped', C.blue],
  critical: ['Critically damped', C.green],
  over: ['Overdamped', C.orange],
};

export default {
  id: 'damped',
  title: 'Damped Vibrations',
  short: "x'' + bx' + kx = 0: under-, critically and overdamped motion; drag the characteristic roots.",
  icon: '<path d="M4 10c4 0 5 26 9 26s4-18 8-18 4 10 8 10 4-5 7-5 4 2 8 2" stroke="#1f5fd1"/><path d="M4 10c6 6 14 10 40 12" stroke="#a7afb9" stroke-dasharray="3 3"/>',
  defaults: { b: 1, k: 4, x0: 1, v0: 0, envelope: true },
  hint: 'Drag the roots (×), the point in the (b, k) plane or the initial condition.',
  info: `<p>The unforced spring–mass–dashpot <span class="m">x'' + b x' + k x = 0</span> (mass 1) has characteristic polynomial
    <span class="m">p(s) = s² + bs + k</span> with roots <span class="m">r = −b/2 ± √(b²/4 − k)</span>.</p>
    <ul style="padding-left:18px;margin:0 0 8px">
    <li><strong>Underdamped</strong> <span class="m">b² &lt; 4k</span>: complex roots <span class="m">−b/2 ± iω<sub>d</sub></span>; decaying oscillation
      <span class="m">x = A e<sup>−bt/2</sup> cos(ω<sub>d</sub>t − φ)</span>. The roots lie on the circle of radius √k.</li>
    <li><strong>Critically damped</strong> <span class="m">b² = 4k</span>: double root; <span class="m">x = (c<sub>1</sub> + c<sub>2</sub>t) e<sup>−bt/2</sup></span>, the fastest return without oscillation.</li>
    <li><strong>Overdamped</strong> <span class="m">b² &gt; 4k</span>: two negative real roots; <span class="m">x = c<sub>1</sub>e<sup>r<sub>1</sub>t</sup> + c<sub>2</sub>e<sup>r<sub>2</sub>t</sup></span>, crosses zero at most once.</li></ul>
    <p>The parabola <span class="m">k = b²/4</span> in the (b, k) plane separates the regimes. Drag a root off the real axis to make the motion oscillate.</p>`,
  layout: (wide) => (wide
    ? { areas: '"time phase" "roots bk"', cols: '1.35fr 1fr', rows: '1fr 1fr' }
    : { areas: '"time time" "roots bk" "phase phase"', cols: '1fr 1fr', rows: '1fr 1fr 0.9fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    let t = 0;
    const time = env.pane('time', { xmin: 0, xmax: TMAX, ymin: -1.5, ymax: 1.5, title: 'Solution x(t)', xlabel: 't', xname: 't', yname: 'x' });
    const phase = env.pane('phase', { title: "Phase plane (x, x')", xlabel: 'x', ylabel: "x'", yname: "x'" });
    const roots = env.pane('roots', { xmin: -6.2, xmax: 1, ymin: -4.2, ymax: 4.2, equal: true, title: 'Roots in the complex plane', xlabel: 'Re', ylabel: 'Im', xname: 'Re', yname: 'Im' });
    const bk = env.pane('bk', { xmin: 0, xmax: BMAX, ymin: 0, ymax: KMAX, title: '(b, k) plane', xlabel: 'b', ylabel: 'k', xname: 'b', yname: 'k' });

    ui.slider('b', { label: 'Damping <span class="sym">b</span>', min: 0, max: BMAX, step: 0.05 });
    ui.slider('k', { label: 'Spring constant <span class="sym">k</span>', min: 0, max: KMAX, step: 0.05 });
    ui.slider('x0', { label: 'Initial position <span class="sym">x</span>(0)', min: -2, max: 2, step: 0.05 });
    ui.slider('v0', { label: "Initial velocity <span class=\"sym\">x'</span>(0)", min: -6, max: 6, step: 0.05 });
    ui.check('envelope', 'Show the exponential envelope');
    ui.buttons([
      ['Make critical (k = b²/4)', () => { p.k = Number(clamp((p.b * p.b) / 4, 0, KMAX).toFixed(6)); ui.sync(); }],
    ]);
    const ro = ui.readout();

    const setBK = (b, k, critical = false) => {
      p.b = Number(clamp(b, 0, BMAX).toFixed(3));
      p.k = Number(clamp(critical ? (p.b * p.b) / 4 : k, 0, KMAX).toFixed(critical ? 6 : 3));
      ui.sync();
    };
    // root handles
    const rootHandle = (idx) => ({
      pos: () => dampedSolution(p.b, p.k, 0, 0).roots[idx],
      noOffset: true,
      drag(x, y, info) {
        const sol = dampedSolution(p.b, p.k, 0, 0);
        const offAxis = Math.abs(info.py - roots.Y(0)) > 12;
        const sx = Math.min(0, x);
        if (offAxis) {
          setBK(-2 * sx, sx * sx + y * y);
        } else if (sol.regime === 'under' || sol.regime === 'undamped') {
          setBK(-2 * sx, sx * sx, true); // collapse onto the real axis: double root
        } else {
          const other = sol.roots[1 - idx][0];
          setBK(-(sx + other), sx * other);
        }
      },
    });
    roots.handles = [rootHandle(0), rootHandle(1)];
    bk.handles = [{
      pos: () => [p.b, p.k],
      drag(b, k, info) {
        b = clamp(b, 0, BMAX);
        const kc = (b * b) / 4;
        setBK(b, k, Math.abs(bk.Y(kc) - info.py) < 9); // snap to the parabola
      },
    }];
    time.handles = [{ pos: () => [0, p.x0], drag: (_, x) => { p.x0 = Number(clamp(x, -2, 2).toFixed(2)); ui.sync(); }, cursor: 'ns-resize' }];
    phase.handles = [{ pos: () => [p.x0, p.v0], drag: (x, v) => { p.x0 = Number(clamp(x, -2, 2).toFixed(2)); p.v0 = Number(clamp(v, -6, 6).toFixed(2)); ui.sync(); } }];
    time.o.onDown = (tt) => { const s = (x) => { t = clamp(x, 0, TMAX); }; s(tt); return { move: s }; };

    function draw() {
      const { b, k, x0, v0 } = p;
      const sol = dampedSolution(b, k, x0, v0);
      const [rname, rcol] = REG[sol.regime];

      // time plot
      let xm = Math.max(0.5, Math.abs(x0));
      let vm = Math.max(0.5, Math.abs(v0));
      for (let i = 0; i <= 600; i++) { const tt = (TMAX * i) / 600; xm = Math.max(xm, Math.abs(sol.x(tt))); vm = Math.max(vm, Math.abs(sol.v(tt))); }
      xm = Math.min(xm, 50); vm = Math.min(vm, 200);
      time.setView(0, TMAX, -xm * 1.15, xm * 1.15);
      time.o.legend = [['x(t)', rcol]];
      time.begin();
      if (p.envelope && (sol.regime === 'under' || sol.regime === 'undamped')) {
        const A = sol.amp;
        time.fn((tt) => A * Math.exp((-b / 2) * tt), { color: C.gray, width: 1.4, dash: [5, 4] });
        time.fn((tt) => -A * Math.exp((-b / 2) * tt), { color: C.gray, width: 1.4, dash: [5, 4] });
      }
      time.fn(sol.x, { color: rcol, width: 2.6 });
      time.vline(t, { color: C.text, width: 1, dash: [4, 4] });
      time.dot(t, sol.x(t), 5, rcol);
      time.knob(0, x0, C.text, { r: 8 });

      // phase plane
      phase.setView(-xm * 1.2, xm * 1.2, -vm * 1.2, vm * 1.2);
      phase.begin();
      const pts = [];
      for (let i = 0; i <= 800; i++) { const tt = (TMAX * 2 * i) / 800; pts.push([sol.x(tt), sol.v(tt)]); }
      phase.poly(pts, { color: rcol, width: 2.4 });
      const tm = 0.8;
      const [ax, ay] = [sol.x(tm), sol.v(tm)], [bx, by] = [sol.x(tm + 0.05), sol.v(tm + 0.05)];
      if (Math.hypot(phase.X(bx) - phase.X(ax), phase.Y(by) - phase.Y(ay)) > 1) phase.arrow(ax, ay, bx, by, rcol, 2, 11);
      phase.dot(sol.x(t), sol.v(t), 5, rcol);
      phase.knob(x0, v0, C.text, { r: 8 });

      // roots
      roots.begin();
      if (k > 0) {
        const ctx = roots.ctx;
        ctx.strokeStyle = C.gray; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath();
        const R = roots.X(Math.sqrt(k)) - roots.X(0);
        ctx.arc(roots.X(0), roots.Y(0), R, 0, 2 * Math.PI);
        ctx.stroke(); ctx.setLineDash([]);
      }
      roots.vline(-b / 2, { color: C.gray, width: 1, dash: [2, 4] });
      for (const [re, im] of sol.roots) { roots.knob(re, im, rcol, { r: 13 }); roots.knob(re, im, rcol, { shape: 'x', r: 8 }); }
      if (sol.regime === 'critical') roots.text('double root', sol.roots[0][0], 0, { dy: 22, align: 'center', color: rcol, bold: true });

      // (b,k) plane
      bk.begin();
      bk.fillUnder((x) => KMAX, 0, BMAX, 'rgba(31,95,209,.08)', 0);
      bk.fillUnder((x) => Math.min(KMAX, (x * x) / 4), 0, BMAX, 'rgba(224,123,0,.13)', 0);
      bk.fn((x) => (x * x) / 4, { color: C.green, width: 2.4 });
      bk.text('underdamped', 0.6, KMAX * 0.82, { color: C.blue, bold: true });
      bk.text('overdamped', BMAX * 0.68, KMAX * 0.18, { color: C.orange, bold: true, align: 'center' });
      bk.text('critical k = b²/4', 5.6, 7.84, { color: C.green, bold: true, align: 'right', dx: -8, dy: -8 });
      bk.knob(b, k, rcol);

      const fr = ([re, im]) => (Math.abs(im) < 1e-12 ? fmt(re, 4) : `${fmt(re, 4)} ${im < 0 ? '−' : '+'} ${fmt(Math.abs(im), 4)} i`);
      ro.set([
        { wide: `<span class="badge-big" style="background:${rcol}">${rname}</span>` },
        ...(sol.regime === 'critical' ? [['Double root r', fmt(sol.roots[0][0], 4)]] : [['Root r₁', fr(sol.roots[0])], ['Root r₂', fr(sol.roots[1])]]),
        ['b² − 4k', fmt(b * b - 4 * k, 4)],
        sol.wd ? ['Damped frequency ω<sub>d</sub>', fmt(sol.wd, 4)] : null,
        sol.wd ? ['Pseudo-period 2π/ω<sub>d</sub>', fmt((2 * Math.PI) / sol.wd, 4)] : null,
        ['Decay rate (slowest)', fmt(-Math.max(sol.roots[0][0], sol.roots[1][0]), 4)],
      ]);
    }
    return { draw, tick(dt) { t += dt; if (t > TMAX) t = 0; } };
  },
};
