// Complex exponential e^{(a+ib)t}: rotating phasor, spiral, real and imaginary parts.
import { C } from '../plot.js';
import { fmt, clamp } from '../math.js';

const TMAX = 12;

export default {
  id: 'complex-exp',
  title: 'Complex Exponential',
  bonus: true,
  short: 'e^((a+ib)t) traces a spiral in the complex plane; its real part is a damped (or growing) oscillation.',
  icon: '<path d="M24 4v40M4 24h40" stroke="#a7afb9"/><path d="M40 24c0 10-8 15-16 15s-13-7-13-15 6-11 13-11 9 5 9 11-3 6-7 6" stroke="#1f5fd1"/><path d="M24 24L40 24" stroke="#d1342f"/>',
  defaults: { a: -0.15, b: 1.5, speed: 1, showIm: true },
  autoplay: true,
  hint: 'Drag the point s = a + ib in the s-plane, or drag the time in the plots.',
  info: `<p>Euler's formula <span class="m">e<sup>iθ</sup> = cos θ + i sin θ</span> gives
    <span class="m">e<sup>(a+ib)t</sup> = e<sup>at</sup>(cos bt + i sin bt)</span>.</p>
    <p>In the complex plane the point <span class="m">z(t)</span> rotates with angular speed <span class="m">b</span> while its distance from 0,
    <span class="m">e<sup>at</sup></span>, shrinks (a &lt; 0), stays 1 (a = 0) or grows (a &gt; 0). Its projections are the real part
    <span class="m">e<sup>at</sup> cos bt</span> and imaginary part <span class="m">e<sup>at</sup> sin bt</span> — exactly the solutions of
    a damped oscillator with characteristic root <span class="m">s = a + ib</span>.</p>
    <p>The dashed curves <span class="m">±e<sup>at</sup></span> are the envelope.</p>`,
  layout: (wide) => (wide
    ? { areas: '"z re" "s im"', cols: '1fr 1.5fr', rows: '1.4fr 1fr' }
    : { areas: '"z s" "re re" "im im"', cols: '1.4fr 1fr', rows: '1.3fr 1fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    let t = 2;
    const zp = env.pane('z', { xmin: -1.6, xmax: 1.6, ymin: -1.6, ymax: 1.6, equal: true, title: 'z(t) in the complex plane', xlabel: 'Re', ylabel: 'Im' });
    const sp = env.pane('s', { xmin: -0.8, xmax: 0.5, ymin: -4, ymax: 4, title: 's = a + ib', xlabel: 'a', ylabel: 'b', xname: 'a', yname: 'b' });
    const re = env.pane('re', { xmin: 0, xmax: TMAX, title: 'Real part e^(at) cos bt', xlabel: 't', xname: 't' });
    const im = env.pane('im', { xmin: 0, xmax: TMAX, title: 'Imaginary part e^(at) sin bt', xlabel: 't', xname: 't' });

    ui.slider('a', { label: 'Growth rate <span class="sym">a</span>', min: -0.8, max: 0.5, step: 0.01 });
    ui.slider('b', { label: 'Angular frequency <span class="sym">b</span>', min: -4, max: 4, step: 0.05 });
    ui.slider('speed', { label: 'Animation speed', min: 0.1, max: 3, log: true });
    const ro = ui.readout();

    sp.handles = [{ pos: () => [p.a, p.b], drag: (a, b) => { p.a = Number(clamp(a, -0.8, 0.5).toFixed(3)); p.b = Number(clamp(b, -4, 4).toFixed(2)); ui.sync(); } }];
    const tdrag = (x) => { const s = (v) => { t = clamp(v, 0, TMAX); }; s(x); return { move: s }; };
    re.o.onDown = tdrag; im.o.onDown = tdrag;

    function draw() {
      const { a, b } = p;
      const z = (tt) => [Math.exp(a * tt) * Math.cos(b * tt), Math.exp(a * tt) * Math.sin(b * tt)];
      const R = Math.max(1.2, Math.exp(a * TMAX)) * 1.1;
      zp.setView(-Math.min(R, 6), Math.min(R, 6), -Math.min(R, 6), Math.min(R, 6));
      zp.begin();
      const ctx = zp.ctx;
      ctx.strokeStyle = C.gray; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(zp.X(0), zp.Y(0), zp.X(1) - zp.X(0), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      const pts = [];
      for (let i = 0; i <= 1200; i++) pts.push(z((TMAX * i) / 1200));
      zp.poly(pts, { color: C.blue, width: 1.6, alpha: 0.45 });
      zp.poly(pts.slice(0, Math.round((t / TMAX) * 1200) + 1), { color: C.blue, width: 2.6 });
      const [x, y] = z(t);
      zp.arrow(0, 0, x, y, C.purple, 3, 11);
      zp.line(x, y, x, 0, { color: C.red, width: 1.2, dash: [3, 3] });
      zp.line(x, y, 0, y, { color: C.green, width: 1.2, dash: [3, 3] });
      zp.dot(x, 0, 5, C.red);
      zp.dot(0, y, 5, C.green);
      zp.dot(1, 0, 4, C.text);

      sp.begin();
      sp.ctx.fillStyle = 'rgba(209,52,47,.06)';
      sp.ctx.fillRect(sp.X(0), sp.L.top, sp.X(sp.v.xmax) - sp.X(0), sp.L.h);
      sp.knob(a, b, C.purple);
      sp.knob(a, -b, C.gray, { r: 6 });
      sp.text('s', a, b, { dx: 12, dy: -10, math: true, color: C.purple, size: 16 });
      sp.text('s̄', a, -b, { dx: 10, dy: 10, math: true, color: C.gray, size: 15 });

      const envl = (tt) => Math.exp(a * tt);
      const ym = Math.min(Math.max(1.15, Math.exp(a * TMAX) * 1.1), 60);
      for (const [pl, f, col] of [[re, (tt) => z(tt)[0], C.red], [im, (tt) => z(tt)[1], C.green]]) {
        pl.setView(0, TMAX, -ym, ym);
        pl.begin();
        pl.fn(envl, { color: C.gray, width: 1.2, dash: [5, 4] });
        pl.fn((tt) => -envl(tt), { color: C.gray, width: 1.2, dash: [5, 4] });
        pl.fn(f, { color: col, width: 2.4 });
        pl.vline(t, { color: C.text, width: 1, dash: [4, 4] });
        pl.dot(t, f(t), 5, col);
      }
      ro.set([
        ['t', fmt(t, 3)],
        ['|z(t)| = e^(at)', fmt(Math.exp(a * t), 4)],
        ['arg z(t) = bt', `${fmt(b * t, 4)} rad`],
        ['Period 2π/|b|', Math.abs(b) > 1e-9 ? fmt((2 * Math.PI) / Math.abs(b), 4) : '∞'],
        a !== 0 ? [a < 0 ? 'Half-life ln2/|a|' : 'Doubling time ln2/a', fmt(Math.LN2 / Math.abs(a), 4)] : ['Modulus', 'constant 1'],
      ]);
    }
    return { draw, tick(dt) { t += dt * p.speed; if (t > TMAX) t = 0; } };
  },
};
