// Riemann sums, trapezoid and Simpson rules, with error and convergence plot.
import { C } from '../plot.js';
import { compile } from '../parser.js';
import { fmt, clamp, integrate } from '../math.js';

const METHODS = {
  left: { label: 'Left', order: 1 },
  right: { label: 'Right', order: 1 },
  mid: { label: 'Midpoint', order: 2 },
  trap: { label: 'Trapezoid', order: 2 },
  simpson: { label: 'Simpson', order: 4 },
  upper: { label: 'Upper', order: 1 },
  lower: { label: 'Lower', order: 1 },
};
const CONV = ['left', 'right', 'mid', 'trap', 'simpson'];
const CCOL = { left: C.blue, right: C.teal, mid: C.green, trap: C.orange, simpson: C.purple };

function supInf(f, x0, x1, which) {
  let best = which === 'upper' ? -Infinity : Infinity;
  for (let i = 0; i <= 24; i++) {
    const v = f(x0 + ((x1 - x0) * i) / 24);
    if (!Number.isFinite(v)) continue;
    best = which === 'upper' ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** Numerical integral of f over [a,b] with n subintervals. */
export function approx(f, a, b, n, method) {
  if (method === 'simpson' && n % 2) n += 1;
  const h = (b - a) / n;
  let s = 0;
  switch (method) {
    case 'left': for (let i = 0; i < n; i++) s += f(a + i * h); return s * h;
    case 'right': for (let i = 1; i <= n; i++) s += f(a + i * h); return s * h;
    case 'mid': for (let i = 0; i < n; i++) s += f(a + (i + 0.5) * h); return s * h;
    case 'trap': s = (f(a) + f(b)) / 2; for (let i = 1; i < n; i++) s += f(a + i * h); return s * h;
    case 'simpson': s = f(a) + f(b); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h); return (s * h) / 3;
    default: for (let i = 0; i < n; i++) s += supInf(f, a + i * h, a + (i + 1) * h, method); return s * h;
  }
}

export default {
  id: 'riemann',
  title: 'Riemann Sums & Integrals',
  short: 'Left, right, midpoint, trapezoid and Simpson approximations of ∫f(x)dx, with errors and convergence rates.',
  icon: '<path d="M6 40V30h8V20h8v-6h8v8h8v18z" fill="#cfe0fb" stroke="#1f5fd1" stroke-width="2"/><path d="M4 34C14 14 24 8 44 24" stroke="#d1342f"/>',
  defaults: { expr: 'x sin(x) + 2', a: 0.5, b: 6, n: 8, method: 'left', xmin: -0.5, xmax: 7, preset: '' },
  hint: 'Drag the endpoints a and b along the x-axis.',
  info: `<p>The integral <span class="m">∫<sub>a</sub><sup>b</sup> f(x) dx</span> is the signed area between the graph and the x-axis.
    Divide <span class="m">[a, b]</span> into <span class="m">n</span> pieces of width <span class="m">h = (b − a)/n</span>:</p>
    <ul style="padding-left:18px;margin:0 0 8px">
    <li><strong>Left / right / midpoint</strong> sums use rectangles with the height of <span class="m">f</span> at one point of each piece.</li>
    <li><strong>Upper / lower</strong> sums use the maximum / minimum on each piece; the integral is squeezed in between.</li>
    <li><strong>Trapezoid</strong> rule: straight lines between the points. <strong>Simpson's</strong> rule: parabolas through three consecutive points (n even).</li></ul>
    <p>The lower plot shows the error against <span class="m">n</span> on log–log axes. A method of order <span class="m">p</span> has error ≈ <span class="m">C/n<sup>p</sup></span>,
    which is a straight line of slope <span class="m">−p</span>: 1 for left/right, 2 for midpoint/trapezoid, 4 for Simpson.</p>`,
  layout: (wide) => (wide ? { areas: '"main conv"', cols: '1.6fr 1fr' } : { areas: '"main" "conv"', rows: '1.5fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const main = env.pane('main', { title: 'Approximating the integral', xlabel: 'x', ylabel: 'y' });
    const conv = env.pane('conv', { xlog: true, ylog: true, xmin: 1, xmax: 256, title: 'Error vs n', xlabel: 'n', xname: 'n', yname: '|error|' });
    let f = null, exact = null, convData = null;
    const setF = () => { try { f = compile(p.expr, ['x']); } catch { f = () => NaN; } invalidate(); };
    function invalidate() { exact = null; convData = null; }

    ui.expr('expr', { pre: 'f(x) =', vars: ['x'], onValid: setF });
    ui.select('preset', {
      label: 'Examples',
      options: [['', 'Choose …'], ['x sin(x) + 2', 'x sin x + 2'], ['x^2', 'x²'], ['sqrt(x)', '√x'], ['exp(-x^2)', 'e^(−x²)'], ['1/x', '1/x'],
        ['sin(x)', 'sin x'], ['x^3 - 6x^2 + 9x', 'x³ − 6x² + 9x'], ['abs(x - 3)', '|x − 3|']],
      onChange: (v) => { if (v) { p.expr = v; setF(); } p.preset = ''; ui.sync(); },
    });
    ui.seg('method', { label: 'Method', multi: true, options: [['left', 'Left'], ['right', 'Right'], ['mid', 'Mid'], ['trap', 'Trap.'], ['simpson', 'Simpson']] });
    ui.seg('method', { multi: true, options: [['upper', 'Upper sum'], ['lower', 'Lower sum']] });
    ui.slider('n', { label: 'Subintervals <span class="sym">n</span>', min: 1, max: 200, step: 1 });
    ui.slider('a', { label: 'Lower limit <span class="sym">a</span>', min: -10, max: 10, step: 0.05, onChange: () => { fitIfNeeded(); invalidate(); } });
    ui.slider('b', { label: 'Upper limit <span class="sym">b</span>', min: -10, max: 10, step: 0.05, onChange: () => { fitIfNeeded(); invalidate(); } });
    ui.buttons([['Fit view to [a, b]', () => fit()]]);
    const ro = ui.readout();

    function fit() {
      const lo = Math.min(p.a, p.b), hi = Math.max(p.a, p.b), w = Math.max(hi - lo, 0.5);
      p.xmin = Number((lo - 0.12 * w).toFixed(2)); p.xmax = Number((hi + 0.12 * w).toFixed(2));
    }
    function fitIfNeeded() { if (Math.min(p.a, p.b) < p.xmin || Math.max(p.a, p.b) > p.xmax) fit(); }

    const setEnd = (key) => (x) => { p[key] = Number(clamp(x, p.xmin, p.xmax).toFixed(2)); invalidate(); ui.sync(); };
    main.handles = [
      { pos: () => [p.a, 0], drag: setEnd('a'), cursor: 'ew-resize', noOffset: true },
      { pos: () => [p.b, 0], drag: setEnd('b'), cursor: 'ew-resize', noOffset: true },
    ];
    conv.o.onDown = (x) => { const s = (nn) => { p.n = clamp(Math.round(nn), 1, 200); ui.sync(); }; s(x); return { move: s }; };

    function getExact() {
      if (exact === null) exact = integrate((x) => { const v = f(x); return Number.isFinite(v) ? v : 0; }, p.a, p.b, 1e-11);
      return exact;
    }
    function getConv() {
      if (convData) return convData;
      const ex = getExact();
      const ns = [];
      for (let n = 1; n <= 256; n = n < 16 ? n + 1 : Math.ceil(n * 1.12)) ns.push(n);
      convData = {};
      for (const m of CONV) convData[m] = ns.filter((n) => m !== 'simpson' || n % 2 === 0).map((n) => [n, Math.abs(approx(f, p.a, p.b, n, m) - ex)]);
      return convData;
    }

    function draw() {
      if (!f) setF();
      const { a, b, method } = p;
      let n = p.n;
      const simpOdd = method === 'simpson' && n % 2 === 1;
      if (simpOdd) n += 1;
      // y range
      let lo = 0, hi = 0;
      for (let i = 0; i <= 300; i++) { const v = f(p.xmin + ((p.xmax - p.xmin) * i) / 300); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      lo = Math.max(lo, -50); hi = Math.min(hi, 50);
      const pad = 0.12 * (hi - lo || 1);
      main.setView(p.xmin, p.xmax, lo - pad, hi + pad);
      main.o.legend = [['f(x)', C.red], [`${METHODS[method].label}${method === 'upper' || method === 'lower' ? ' sum' : ''}, n = ${n}`, C.blue]];
      main.begin();
      const ctx = main.ctx;
      const h = (b - a) / n;
      const pos = 'rgba(47,111,223,.28)', neg = 'rgba(224,123,0,.32)';
      main.clip();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(31,95,209,.85)';
      const quad = (pts) => {
        // fill a polygon between the curve-like top (pts) and y=0, colored by sign
        ctx.beginPath();
        ctx.moveTo(main.X(pts[0][0]), main.Y(0));
        for (const [x, y] of pts) ctx.lineTo(main.X(x), main.Y(clamp(y, -1e4, 1e4)));
        ctx.lineTo(main.X(pts[pts.length - 1][0]), main.Y(0));
        ctx.closePath();
        const avg = pts.reduce((s, q) => s + q[1], 0) / pts.length;
        ctx.fillStyle = avg >= 0 ? pos : neg;
        ctx.fill();
        ctx.stroke();
      };
      if (n <= 400) {
        for (let i = 0; i < n; i++) {
          const x0 = a + i * h, x1 = x0 + h;
          if (method === 'trap') quad([[x0, f(x0)], [x1, f(x1)]]);
          else if (method === 'simpson') {
            if (i % 2) continue;
            const x2 = x1 + h, y0 = f(x0), y1 = f(x1), y2 = f(x2);
            const pts = [];
            for (let k = 0; k <= 24; k++) {
              const t = k / 12; // 0..2 in units of h
              const y = y0 * ((t - 1) * (t - 2)) / 2 - y1 * t * (t - 2) + y2 * (t * (t - 1)) / 2;
              pts.push([x0 + t * h, y]);
            }
            quad(pts);
          } else {
            let y;
            if (method === 'left') y = f(x0); else if (method === 'right') y = f(x1); else if (method === 'mid') y = f(x0 + h / 2);
            else y = supInf(f, x0, x1, method);
            quad([[x0, y], [x1, y]]);
            const xs = method === 'left' ? x0 : method === 'right' ? x1 : method === 'mid' ? x0 + h / 2 : null;
            if (xs !== null && n <= 60) main.dot(xs, y, 3, C.blue);
          }
        }
      }
      main.unclip();
      main.fn(f, { color: C.red, width: 2.6 });
      main.knob(a, 0, C.text, { r: 8 });
      main.knob(b, 0, C.text, { r: 8 });
      main.text('a', a, 0, { dy: 18, align: 'center', math: true, size: 16 });
      main.text('b', b, 0, { dy: 18, align: 'center', math: true, size: 16 });

      // convergence plot
      const cd = getConv();
      let emin = Infinity, emax = 0;
      for (const m of CONV) for (const [, e] of cd[m]) if (e > 0) { emin = Math.min(emin, e); emax = Math.max(emax, e); }
      if (!Number.isFinite(emin)) { emin = 1e-12; emax = 1; }
      emin = Math.max(emin, 1e-15);
      conv.setView(1, 256, 10 ** Math.floor(Math.log10(emin)), 10 ** Math.ceil(Math.log10(emax * 1.01)));
      conv.o.legend = null;
      conv.begin();
      for (const m of CONV) conv.poly(cd[m].map(([nn, e]) => [nn, Math.max(e, 1e-16)]), { color: CCOL[m], width: m === method ? 3 : 1.6, alpha: m === method ? 1 : 0.65 });
      // legend inside
      let ly = conv.L.top + 14;
      for (const m of CONV) { conv.textPx(METHODS[m].label, conv.L.left + conv.L.w - 8, ly, { align: 'right', color: CCOL[m], bold: m === method, size: 12 }); ly += 15; }
      conv.vline(n, { color: C.text, width: 1, dash: [3, 3] });
      const approxV = approx(f, a, b, n, method);
      const ex = getExact();
      const e = Math.abs(approxV - ex);
      if (CONV.includes(method) && e > 0) conv.dot(n, e, 5.5, CCOL[method], '#fff');

      const ord = METHODS[method].order;
      ro.set([
        [`${METHODS[method].label}${method === 'upper' || method === 'lower' ? ' sum' : ''} (n = ${n})`, fmt(approxV, 8), C.blue],
        ['Exact integral', fmt(ex, 8), C.red],
        ['Error', fmt(approxV - ex, 3)],
        ['Error × n' + (ord > 1 ? (ord === 2 ? '²' : '⁴') : ''), fmt((approxV - ex) * n ** ord, 4)],
        ['Width h', fmt(h, 4)],
        simpOdd ? { wide: '<span style="color:#e07b00">Simpson needs even n — using n + 1</span>' } : null,
      ]);
    }
    return { draw };
  },
};
