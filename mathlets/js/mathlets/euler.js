// Euler's method and isoclines for y' = f(x, y).
import { C } from '../plot.js';
import { compile } from '../parser.js';
import { fmt, clamp, contour } from '../math.js';

const XMIN = -4, XMAX = 4, YMIN = -3, YMAX = 3;

/** Fixed-step solver from (x0,y0) to xEnd with step h (sign chosen automatically). Returns points. */
export function stepSolve(f, x0, y0, xEnd, h, method = 'euler') {
  const n = Math.max(1, Math.round(Math.abs(xEnd - x0) / h));
  const hh = (xEnd - x0) / n;
  const pts = [[x0, y0]];
  let x = x0, y = y0;
  for (let i = 0; i < n; i++) {
    let dy;
    if (method === 'euler') dy = hh * f(x, y);
    else if (method === 'heun') { const k1 = f(x, y), k2 = f(x + hh, y + hh * k1); dy = (hh / 2) * (k1 + k2); }
    else {
      const k1 = f(x, y), k2 = f(x + hh / 2, y + (hh / 2) * k1), k3 = f(x + hh / 2, y + (hh / 2) * k2), k4 = f(x + hh, y + hh * k3);
      dy = (hh / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    y += dy; x = x0 + (i + 1) * hh;
    pts.push([x, y]);
    if (!Number.isFinite(y) || Math.abs(y) > 1e6) break;
  }
  return pts;
}

export default {
  id: 'euler',
  title: "Euler's Method & Isoclines",
  short: "Slope field of y' = f(x, y), isoclines, and Euler steps compared with the exact solution.",
  icon: '<path d="M6 40l10-6 10-10 10-14 8-6" stroke="#d1342f"/><circle cx="6" cy="40" r="2.5" fill="#d1342f" stroke="none"/><circle cx="16" cy="34" r="2.5" fill="#d1342f" stroke="none"/><circle cx="26" cy="24" r="2.5" fill="#d1342f" stroke="none"/><circle cx="36" cy="10" r="2.5" fill="#d1342f" stroke="none"/><path d="M6 40c12-3 22-10 38-34" stroke="#1f5fd1"/>',
  defaults: { expr: 'x - y^2', x0: -1, y0: 0.5, xEnd: 3.5, h: 0.5, method: 'euler', iso: true, c: 0, family: false, field: true, preset: '' },
  hint: 'Drag the start point (black) and the end line, or tap the plane to move the start point.',
  info: `<p>The differential equation <span class="m">y' = f(x, y)</span> prescribes a slope at every point (short segments).
    Solutions are curves that are tangent to these segments everywhere.</p>
    <p><strong>Isoclines</strong> are the curves <span class="m">f(x, y) = c</span> on which all slopes are equal to <span class="m">c</span>.
    The isocline <span class="m">c = 0</span> (the nullcline) is where solutions have horizontal tangents.</p>
    <p><strong>Euler's method</strong> follows the slope for one step of length <span class="m">h</span>:
    <span class="m">y<sub>n+1</sub> = y<sub>n</sub> + h f(x<sub>n</sub>, y<sub>n</sub>)</span>. Its global error is roughly proportional
    to <span class="m">h</span> (first order): halving <span class="m">h</span> halves the error. Improved Euler (Heun) is second order,
    Runge–Kutta 4 is fourth order — compare the “error ratio” in the readout.</p>`,
  layout: () => ({ areas: '"main"' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const main = env.pane('main', { xmin: XMIN, xmax: XMAX, ymin: YMIN, ymax: YMAX, title: "y' = f(x, y)", xlabel: 'x', ylabel: 'y' });
    let f = null;
    const setF = () => { try { f = compile(p.expr, ['x', 'y']); } catch { f = () => NaN; } exact = null; };

    ui.expr('expr', { pre: "y' =", vars: ['x', 'y'], onValid: setF });
    ui.select('preset', {
      label: 'Examples',
      options: [['', 'Choose …'], ['x - y^2', "y' = x − y²"], ['y^2 - x', "y' = y² − x"], ['y', "y' = y"], ['y(1-y)', "y' = y(1 − y)"],
        ['-2xy', "y' = −2xy"], ['x + y', "y' = x + y"], ['sin(x) - y', "y' = sin x − y"], ['y^2 - x^2', "y' = y² − x²"]],
      onChange: (v) => { if (v) { p.expr = v; setF(); } p.preset = ''; ui.sync(); },
    });
    ui.section('Numerical method');
    ui.seg('method', { options: [['euler', 'Euler'], ['heun', 'Improved Euler'], ['rk4', 'RK4']] });
    ui.slider('h', { label: 'Step size <span class="sym">h</span>', min: 0.01, max: 2, log: true });
    ui.slider('x0', { label: 'Start <span class="sym">x</span>₀', min: XMIN, max: XMAX, step: 0.05, onChange: () => { exact = null; } });
    ui.slider('y0', { label: 'Start <span class="sym">y</span>₀', min: YMIN, max: YMAX, step: 0.05, onChange: () => { exact = null; } });
    ui.slider('xEnd', { label: 'End point <span class="sym">X</span>', min: XMIN, max: XMAX, step: 0.05 });
    ui.section('Isoclines');
    ui.check('iso', 'Show the isocline f(x, y) = c');
    ui.slider('c', { label: 'Slope <span class="sym">c</span>', min: -4, max: 4, step: 0.05 });
    ui.check('family', 'Show isoclines c = −2, −1, 0, 1, 2');
    ui.check('field', 'Slope field');
    const ro = ui.readout();


    let exact = null;
    function exactCurve() {
      if (exact) return exact;
      const fw = stepSolve(f, p.x0, p.y0, XMAX + 0.5, 0.002, 'rk4');
      const bw = stepSolve(f, p.x0, p.y0, XMIN - 0.5, 0.002, 'rk4');
      exact = { pts: [...bw.reverse(), ...fw.slice(1)], at: (x) => {
        const arr = x >= p.x0 ? fw : bw.slice().reverse();
        let best = null;
        for (let i = 0; i < arr.length - 1; i++) {
          const [xa, ya] = arr[i], [xb, yb] = arr[i + 1];
          if ((x - xa) * (x - xb) <= 0) { const t = xb === xa ? 0 : (x - xa) / (xb - xa); best = ya + t * (yb - ya); break; }
        }
        return best ?? NaN;
      } };
      return exact;
    }

    const setStart = (x, y) => { p.x0 = Number(clamp(x, XMIN, XMAX).toFixed(2)); p.y0 = Number(clamp(y, YMIN, YMAX).toFixed(2)); exact = null; ui.sync(); };
    main.handles = [
      { pos: () => [p.x0, p.y0], drag: setStart },
      {
        dist: (px, py) => (main.inside(px, py) ? Math.abs(px - main.X(p.xEnd)) + (Math.abs(py - (main.L.top + 14)) < 30 ? 0 : 6) : Infinity),
        pos: () => [p.xEnd, main.iy(main.L.top + 14)],
        drag: (x) => { p.xEnd = Number(clamp(x, XMIN, XMAX).toFixed(2)); ui.sync(); },
        cursor: 'ew-resize', tol: 18,
      },
    ];
    main.o.onTap = (x, y) => setStart(x, y);

    function draw() {
      if (!f) setF();
      const names = { euler: 'Euler', heun: 'Improved Euler', rk4: 'RK4' };
      main.o.legend = [['exact (RK, tiny steps)', C.blue], [names[p.method], C.red]];
      if (p.iso) main.o.legend.push([`isocline c=${fmt(p.c, 3)}`, C.orange]);
      main.begin();
      const v = main.v;
      // slope field
      if (p.field) {
        const ctx = main.ctx;
        const nx = Math.max(12, Math.round(main.L.w / 34)), ny = Math.max(8, Math.round(main.L.h / 34));
        const len = Math.min(main.L.w / nx, main.L.h / ny) * 0.36;
        ctx.strokeStyle = 'rgba(29,110,0,.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          const x = v.xmin + ((i + 0.5) * (v.xmax - v.xmin)) / nx, y = v.ymin + ((j + 0.5) * (v.ymax - v.ymin)) / ny;
          const s = f(x, y);
          if (!Number.isFinite(s)) continue;
          const dx = 1, dy = s * (main._sy / main._sx); // slope in screen units
          const m = Math.hypot(dx, dy);
          const X = main.X(x), Y = main.Y(y);
          ctx.moveTo(X - (dx / m) * len, Y + (dy / m) * len);
          ctx.lineTo(X + (dx / m) * len, Y - (dy / m) * len);
        }
        ctx.stroke();
      }
      // isoclines
      const drawIso = (c, color, width, alpha, label) => {
        const segs = contour(f, c, v.xmin, v.xmax, v.ymin, v.ymax, 160, 120);
        main.clip();
        const ctx = main.ctx;
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(main.X(x1), main.Y(y1)); ctx.lineTo(main.X(x2), main.Y(y2)); }
        ctx.stroke();
        ctx.globalAlpha = 1;
        // little slope marks along the isocline
        if (label) {
          ctx.strokeStyle = color; ctx.lineWidth = 2.6;
          ctx.beginPath();
          const dy = c * (main._sy / main._sx), m = Math.hypot(1, dy), len = 9;
          for (let i = 0; i < segs.length; i += 14) {
            const X = main.X(segs[i][0]), Y = main.Y(segs[i][1]);
            ctx.moveTo(X - len / m, Y + (dy * len) / m); ctx.lineTo(X + len / m, Y - (dy * len) / m);
          }
          ctx.stroke();
        }
        main.unclip();
        if (label && segs.length) {
          const s = segs[Math.floor(segs.length * 0.8)];
          main.text(`c = ${fmt(c, 3)}`, s[0], s[1], { dx: 6, dy: -10, color, bold: true, bg: 'rgba(255,255,255,.8)' });
        }
      };
      if (p.family) [-2, -1, 0, 1, 2].forEach((c) => drawIso(c, C.orange, 1.3, 0.6, false));
      if (p.iso) drawIso(p.c, C.orange, 3, 1, true);

      // exact solution and numerical approximation
      const ex = exactCurve();
      main.poly(ex.pts, { color: C.blue, width: 2.6 });
      const pts = stepSolve(f, p.x0, p.y0, p.xEnd, p.h, p.method);
      main.poly(pts, { color: C.red, width: 2.2 });
      if (pts.length < 400) for (const [x, y] of pts) main.dot(x, y, 3.5, C.red);
      main.vline(p.xEnd, { color: C.purple, width: 1.5, dash: [6, 4] });
      main.knob(p.xEnd, main.iy(main.L.top + 14), C.purple, { r: 8, shape: 'diamond' });
      main.knob(p.x0, p.y0, C.text);

      const yN = pts[pts.length - 1][1];
      const yX = ex.at(p.xEnd);
      const err = yN - yX;
      const pts2 = stepSolve(f, p.x0, p.y0, p.xEnd, p.h / 2, p.method);
      const err2 = pts2[pts2.length - 1][1] - yX;
      const ratio = Math.abs(err2) > 1e-14 ? Math.abs(err / err2) : NaN;
      ro.set([
        ['Steps n', String(pts.length - 1)],
        ['Approximation yₙ at X', fmt(yN, 6), C.red],
        ['Exact y(X)', fmt(yX, 6), C.blue],
        ['Error', fmt(err, 3)],
        ['Error with h/2', fmt(err2, 3)],
        ['Error ratio (≈ 2ᵖ for order p)', Number.isFinite(ratio) ? fmt(ratio, 3) : '—'],
      ]);
    }
    return { draw };
  },
};
