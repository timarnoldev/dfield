// Linear phase portraits x' = Ax with the trace–determinant plane.
import { C } from '../plot.js';
import { fmt, clamp, rk4Step } from '../math.js';

const BOX = 4;
const EPS = 1e-9;

/** Classify a real 2x2 matrix. Returns { name, color, T, D, disc, eig: [[re, im],[re, im]], vecs } */
export function classify(a, b, c, d) {
  const T = a + d, D = a * d - b * c, disc = T * T - 4 * D;
  const z = (v) => Math.abs(v) < 1e-9;
  let name, color;
  if (z(D)) {
    if (z(T)) name = z(a) && z(b) && z(c) && z(d) ? 'Zero matrix (every point is fixed)' : 'Degenerate: line of fixed points (λ = 0, 0)';
    else name = T < 0 ? 'Degenerate: line of fixed points, attracting' : 'Degenerate: line of fixed points, repelling';
    color = C.gray;
  } else if (D < 0) { name = 'Saddle'; color = C.orange; }
  else if (z(disc)) {
    const star = z(b) && z(c) && z(a - d);
    name = `${star ? 'Star' : 'Degenerate'} node, ${T < 0 ? 'sink' : 'source'}`;
    color = T < 0 ? C.green : C.red;
  } else if (disc > 0) { name = T < 0 ? 'Nodal sink' : 'Nodal source'; color = T < 0 ? C.green : C.red; }
  else if (z(T)) { name = 'Center'; color = C.purple; }
  else { name = T < 0 ? 'Spiral sink' : 'Spiral source'; color = T < 0 ? C.blue : C.brown; }
  let eig, vecs = [];
  if (disc >= -1e-12) {
    const q = Math.sqrt(Math.max(0, disc));
    eig = [[(T + q) / 2, 0], [(T - q) / 2, 0]];
    for (const [l] of eig) {
      const v1 = [b, l - a], v2 = [l - d, c];
      const v = Math.hypot(...v1) >= Math.hypot(...v2) ? v1 : v2;
      const n = Math.hypot(...v);
      vecs.push(n > 1e-9 ? [v[0] / n, v[1] / n] : null);
    }
    if (z(disc) && vecs[0] && vecs[1]) vecs = [vecs[0]];
  } else {
    const q = Math.sqrt(-disc) / 2;
    eig = [[T / 2, q], [T / 2, -q]];
  }
  return { name, color, T, D, disc, eig, vecs };
}

const PRESETS = {
  saddle: [1, 1, 4, -2],
  spiralSink: [-1, 2, -2, -1],
  spiralSource: [0.5, -2, 2, 0.3],
  center: [0, 2, -1, 0],
  nodalSink: [-2, 1, 0.5, -1],
  nodalSource: [2, 0.5, 1, 1.5],
  degenerate: [-1, 1, 0, -1],
  star: [-1, 0, 0, -1],
  line: [-1, 2, -0.5, 1],
};

const ringSeeds = () => Array.from({ length: 10 }, (_, i) => {
  const a = (2 * Math.PI * (i + 0.25)) / 10;
  return [Number((3.4 * Math.cos(a)).toFixed(2)), Number((3.4 * Math.sin(a)).toFixed(2))];
});

export default {
  id: 'phase-portraits',
  title: 'Linear Phase Portraits',
  short: "x' = Ax for a 2×2 matrix: drag in the trace–determinant plane, see eigenvectors and the type of the equilibrium.",
  icon: '<path d="M24 4v40M4 24h40" stroke="#a7afb9"/><path d="M24 24c0-6 8-8 11-3s-1 13-11 13-15-9-13-18 13-14 22-10" stroke="#1f5fd1"/><path d="M4 40L44 8" stroke="#d1342f" stroke-dasharray="3 3"/>',
  defaults: { a: -0.5, b: 2, c: -1.5, d: -0.5, traj: ringSeeds(), field: true, eig: true, speed: 1, preset: '' },
  hint: 'Tap the phase plane to add trajectories. Drag the point in the trace–determinant plane.',
  info: `<p>For <span class="m">x' = Ax</span> the behaviour near the origin is determined by the eigenvalues
    <span class="m">λ</span> of <span class="m">A</span>, i.e. the roots of <span class="m">λ² − Tλ + D = 0</span> with
    trace <span class="m">T = a + d</span> and determinant <span class="m">D = ad − bc</span>.</p>
    <ul style="padding-left:18px;margin:0 0 8px">
    <li><span class="m">D &lt; 0</span>: real eigenvalues of opposite sign — <strong>saddle</strong>.</li>
    <li><span class="m">D &gt; 0</span>, <span class="m">T² &gt; 4D</span>: real eigenvalues of equal sign — <strong>node</strong> (sink if <span class="m">T &lt; 0</span>, source if <span class="m">T &gt; 0</span>).</li>
    <li><span class="m">D &gt; 0</span>, <span class="m">T² &lt; 4D</span>: complex eigenvalues — <strong>spiral</strong>, or a <strong>center</strong> if <span class="m">T = 0</span>.</li>
    <li>On the parabola <span class="m">T² = 4D</span>: repeated eigenvalue (degenerate or star node); on <span class="m">D = 0</span>: a line of fixed points.</li></ul>
    <p>Real eigenvalues come with straight-line solutions along the eigenvectors (dashed lines). When you drag in the (T, D) plane,
    the matrix is changed in a way that keeps <span class="m">a − d</span> and <span class="m">b</span> (or <span class="m">c</span>) fixed.</p>`,
  layout: (wide) => (wide
    ? { areas: '"phase td"', cols: '1.35fr 1fr', rows: '1fr' }
    : { areas: '"phase" "td"', rows: '1.45fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const phase = env.pane('phase', { xmin: -BOX, xmax: BOX, ymin: -BOX, ymax: BOX, equal: true, title: 'Phase plane', xlabel: 'x', ylabel: 'y' });
    const td = env.pane('td', { xmin: -4, xmax: 4, ymin: -3, ymax: 5, title: 'Trace–determinant plane', xlabel: 'T', ylabel: 'D', xname: 'T', yname: 'D' });

    ui.html('Matrix <span class="m">A</span> = [[a, b], [c, d]]', 'ctl-label full');
    ['a', 'b', 'c', 'd'].forEach((k) => ui.slider(k, { label: `<span class="sym">${k}</span>`, aria: k, min: -5, max: 5, step: 0.05, compact: true, onChange: invalidate }));
    ui.select('preset', {
      label: 'Examples',
      options: [['', 'Choose …'], ['saddle', 'Saddle'], ['spiralSink', 'Spiral sink'], ['spiralSource', 'Spiral source'], ['center', 'Center'],
        ['nodalSink', 'Nodal sink'], ['nodalSource', 'Nodal source'], ['degenerate', 'Degenerate node'], ['star', 'Star node'], ['line', 'Line of fixed points']],
      onChange: (v) => { if (PRESETS[v]) [p.a, p.b, p.c, p.d] = PRESETS[v]; p.preset = ''; ui.sync(); invalidate(); },
    });
    ui.check('field', 'Direction field');
    ui.check('eig', 'Eigenvectors (straight-line solutions)');
    ui.buttons([
      ['Clear trajectories', () => { p.traj = []; invalidate(); }],
      ['Ring of trajectories', () => { p.traj = ringSeeds(); invalidate(); }],
    ]);
    ui.slider('speed', { label: 'Flow animation speed', min: 0.1, max: 3, log: true });
    const ro = ui.readout();
    ro.el.classList.add('full');

    // ---------- trajectories (cached)
    let cache = null;
    function invalidate() { cache = null; particles = null; }
    const F = (_, y) => [p.a * y[0] + p.b * y[1], p.c * y[0] + p.d * y[1]];
    function integrate(seed, dir) {
      const pts = [seed];
      let y = seed.slice();
      const h = 0.02 * dir;
      for (let i = 0; i < 1500; i++) {
        y = rk4Step(F, 0, y, h);
        if (!Number.isFinite(y[0]) || Math.abs(y[0]) > BOX * 4 || Math.abs(y[1]) > BOX * 4) { pts.push(y); break; }
        pts.push(y);
        if (Math.hypot(y[0], y[1]) < 1e-3) break;
      }
      return pts;
    }
    function trajectories() {
      if (cache) return cache;
      cache = p.traj.map((s) => ({ seed: s, fwd: integrate(s, 1), bwd: integrate(s, -1) }));
      return cache;
    }
    let particles = null;

    phase.o.onTap = (x, y) => {
      if (p.traj.length >= 40) p.traj.shift();
      p.traj.push([Number(x.toFixed(3)), Number(y.toFixed(3))]);
      invalidate();
    };

    // ---------- trace–determinant dragging
    let dragBase = null;
    td.handles = [{
      pos: () => [p.a + p.d, p.a * p.d - p.b * p.c],
      start() {
        let pp = (p.a - p.d) / 2, q = p.b, r = p.c;
        if (Math.abs(q) < 0.2 && Math.abs(r) < 0.2) { q = 1; r = 0; }
        dragBase = { pp, q, r, useQ: Math.abs(q) >= Math.abs(r) };
      },
      drag(T, D, info) {
        const { pp, q, r, useQ } = dragBase;
        if (Math.abs(td.Y(T * T / 4) - info.py) < 8) D = (T * T) / 4; // snap to parabola
        if (Math.abs(td.Y(0) - info.py) < 8) D = 0;
        if (Math.abs(td.X(0) - info.px) < 8) T = 0;
        const delta = (T * T) / 4 - D; // = pp² + q r
        let nq = q, nr = r;
        if (useQ) nr = (delta - pp * pp) / q; else nq = (delta - pp * pp) / r;
        const r3 = (v) => Math.round(v * 1000) / 1000;
        p.a = r3(T / 2 + pp); p.d = r3(T / 2 - pp); p.b = r3(nq); p.c = r3(nr);
        ui.sync();
        invalidate();
      },
      end() { dragBase = null; },
    }];

    function draw() {
      const { a, b, c, d } = p;
      const cl = classify(a, b, c, d);

      phase.begin();
      const v = phase.v;
      if (p.field) {
        const n = 19;
        const step = (v.xmax - v.xmin) / n;
        const ctx = phase.ctx;
        ctx.strokeStyle = 'rgba(70,80,95,.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = v.xmin + step / 2; x < v.xmax; x += step) {
          for (let y = v.ymin + step / 2; y < v.ymax; y += step) {
            const [u, w] = F(0, [x, y]);
            const m = Math.hypot(u, w);
            if (m < 1e-12) continue;
            const L = (step * 0.36) / m;
            const X1 = phase.X(x - u * L), Y1 = phase.Y(y - w * L), X2 = phase.X(x + u * L), Y2 = phase.Y(y + w * L);
            ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2);
            const ang = Math.atan2(Y2 - Y1, X2 - X1);
            ctx.moveTo(X2, Y2); ctx.lineTo(X2 - 4 * Math.cos(ang - 0.5), Y2 - 4 * Math.sin(ang - 0.5));
            ctx.moveTo(X2, Y2); ctx.lineTo(X2 - 4 * Math.cos(ang + 0.5), Y2 - 4 * Math.sin(ang + 0.5));
          }
        }
        ctx.stroke();
      }
      if (p.eig && cl.vecs.length) {
        const cols = [C.red, C.green];
        cl.vecs.forEach((vec, i) => {
          if (!vec) return;
          const L = 3 * BOX;
          phase.line(-vec[0] * L, -vec[1] * L, vec[0] * L, vec[1] * L, { color: cols[i], width: 2.2, dash: [8, 5] });
          const lam = cl.eig[i][0];
          const R = BOX * 0.78;
          phase.text(`λ = ${fmt(lam, 3)}`, vec[0] * R, vec[1] * R, { dx: 8, dy: -10, color: cols[i], bold: true, bg: 'rgba(255,255,255,.85)' });
        });
      }
      for (const tr of trajectories()) {
        phase.poly([...tr.bwd.slice().reverse(), ...tr.fwd.slice(1)], { color: cl.color, width: 2 });
        // arrow along the forward direction
        const k = Math.min(tr.fwd.length - 1, 25);
        if (k > 2) {
          const [x1, y1] = tr.fwd[k - 2], [x2, y2] = tr.fwd[k];
          if (Math.abs(x2) < BOX * 1.2 && Math.abs(y2) < BOX * 1.2 && Math.hypot(phase.X(x2) - phase.X(x1), phase.Y(y2) - phase.Y(y1)) > 0.5) phase.arrow(x1, y1, x2, y2, cl.color, 2, 10);
        }
        phase.dot(tr.seed[0], tr.seed[1], 3.5, cl.color);
      }
      if (particles) for (const q of particles) phase.dot(q.y[0], q.y[1], 5, '#111', '#fff');
      phase.dot(0, 0, 4, C.text);

      // trace-determinant plane
      td.setView(-4, 4, Math.min(-3, cl.D - 1), Math.max(5, cl.D + 1));
      td.begin();
      const tv = td.v;
      td.fillUnder((T) => tv.ymax, tv.xmin, tv.xmax, 'rgba(31,95,209,.06)', 0);
      td.fillUnder((T) => (T * T) / 4, tv.xmin, tv.xmax, 'rgba(29,138,58,.07)', 0);
      td.ctx.fillStyle = 'rgba(224,123,0,.10)';
      td.ctx.fillRect(td.L.left, td.Y(0), td.L.w, td.L.top + td.L.h - td.Y(0));
      td.fn((T) => (T * T) / 4, { color: C.text, width: 2 });
      td.line(0, 0, 0, tv.ymax, { color: C.purple, width: 3 });
      const lab = (s, x, y, col) => td.text(s, x, y, { align: 'center', color: col, bold: true, size: 12 });
      lab('spiral sink', -1.3, 3.6, C.blue);
      lab('spiral source', 1.3, 3.6, C.brown);
      // anchored at the pane edges so they are not clipped in narrow (portrait) layouts
      td.text('nodal sink', tv.xmin, 1.2, { dx: 4, color: C.green, bold: true, size: 12 });
      td.text('nodal source', tv.xmax, 1.2, { dx: -4, align: 'right', color: C.red, bold: true, size: 12 });
      lab('saddle', 0, -1.8, C.orange);
      td.text('center', 0, tv.ymax, { dx: 6, dy: 12, color: C.purple, bold: true, size: 12 });
      td.text('T² = 4D', 3.6, 3.24, { align: 'right', dx: -14, color: C.text, size: 12 });
      td.knob(cl.T, cl.D, cl.color);

      const fe = ([re, im]) => (Math.abs(im) < 1e-12 ? fmt(re, 4) : `${fmt(re, 4)} ${im < 0 ? '−' : '+'} ${fmt(Math.abs(im), 4)} i`);
      ro.set([
        { wide: `<span class="badge-big" style="background:${cl.color}">${cl.name}</span>` },
        ['Trace T', fmt(cl.T, 4)],
        ['Determinant D', fmt(cl.D, 4)],
        ['Discriminant T² − 4D', fmt(cl.disc, 4)],
        ['Eigenvalues', `${fe(cl.eig[0])}, ${fe(cl.eig[1])}`],
      ]);
    }

    return {
      draw,
      tick(dt) {
        if (!particles) particles = p.traj.map((s) => ({ seed: s, y: s.slice(), age: 0 }));
        for (const q of particles) {
          const n = 3, h = (dt * p.speed) / n;
          for (let i = 0; i < n; i++) q.y = rk4Step(F, 0, q.y, h);
          q.age += dt * p.speed;
          if (q.age > 6 || !Number.isFinite(q.y[0]) || Math.abs(q.y[0]) > BOX * 1.6 || Math.abs(q.y[1]) > BOX * 1.6) { q.y = q.seed.slice(); q.age = 0; }
        }
      },
      onPlay(on) { if (!on) { particles = null; env.redraw(); } },
    };
  },
};
