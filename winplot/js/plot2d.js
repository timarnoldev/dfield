// 2-dim window: canvas renderer + pointer interaction (pan, pinch, zoom box, trace, ODE solutions).
import { sampleCurve, marchingSquares, joinSegments, solveODE, solveODErk4, niceStep, ticks, fmtTick, fmt, numDeriv, integrate, brentMin } from './numeric.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
function luminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#ffffff');
  if (!m) return 1;
  return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
}

export class Plot2D {
  /**
   * app: { state, items() -> [{eq, c}], status(msg), coords(text), viewChanged(), addIC(x,y),
   *        select(id), traceChanged(info), selectedId() }
   */
  constructor(wrap, base, over, app) {
    this.wrap = wrap; this.base = base; this.over = over; this.app = app;
    this.bctx = base.getContext('2d');
    this.octx = over.getContext('2d');
    this.W = 100; this.H = 100; this.DPR = 1;
    this.cache = new Map(); // eq id -> { lines: [[ [x,y,s], ... ], ...] }
    this.pointers = new Map();
    this.gesture = null;
    this.draft = false;
    this.zoomRect = null;
    this.hover = null;
    this.trace = null; // { id, x, y, s, info }
    this.pending = 0;
    this.bind();
  }

  get view() { return this.app.state.view2; }
  set view(v) { this.app.state.view2 = v; }
  get S() { return this.app.state.settings2; }

  // ------------------------------------------------------------ geometry
  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.W = Math.max(50, Math.floor(r.width));
    this.H = Math.max(50, Math.floor(r.height));
    this.DPR = Math.min(3, window.devicePixelRatio || 1);
    for (const cv of [this.base, this.over]) {
      cv.width = Math.round(this.W * this.DPR);
      cv.height = Math.round(this.H * this.DPR);
    }
    if (this.S.equal) this.view = this.enforceAspect(this.view);
  }
  enforceAspect(v) {
    const cy = (v.ymin + v.ymax) / 2;
    const hy = ((v.xmax - v.xmin) * this.H) / this.W / 2;
    return { xmin: v.xmin, xmax: v.xmax, ymin: cy - hy, ymax: cy + hy };
  }
  sx(x) { const v = this.view; return ((x - v.xmin) / (v.xmax - v.xmin)) * this.W; }
  sy(y) { const v = this.view; return this.H - ((y - v.ymin) / (v.ymax - v.ymin)) * this.H; }
  wx(sx) { const v = this.view; return v.xmin + (sx / this.W) * (v.xmax - v.xmin); }
  wy(sy) { const v = this.view; return v.ymin + ((this.H - sy) / this.H) * (v.ymax - v.ymin); }
  toScreen = (x, y) => [this.sx(x), this.sy(y)];
  pxSize() { return (this.view.xmax - this.view.xmin) / this.W; }

  colors() {
    const bg = this.S.bg || '#ffffff';
    const dark = luminance(bg) < 0.45;
    return {
      bg, dark,
      axis: dark ? '#e8e8e8' : '#222',
      label: dark ? '#ddd' : '#333',
      grid: dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.11)',
      gridMinor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)',
      text: dark ? '#fff' : '#111',
      boxBg: dark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.9)',
    };
  }

  // ------------------------------------------------------------ rendering
  requestRender() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); });
  }

  render() {
    const ctx = this.bctx;
    const { W, H } = this;
    const C = this.colors();
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    this.cache.clear();
    const items = this.app.items().filter((it) => it.eq.visible && !it.c.error);
    if (this.S.grid === 'rect') this.drawRectGrid(ctx, C);
    else if (this.S.grid === 'polar') this.drawPolarGrid(ctx, C);
    // shaded regions first
    for (const it of items) {
      if (it.eq.type === 'inequality') this.safe(it, () => this.drawInequality(ctx, it));
      if (it.eq.integral) this.safe(it, () => this.drawIntegral(ctx, it, C));
    }
    if (this.S.axes) this.drawAxes(ctx, C);
    for (const it of items) this.safe(it, () => this.drawItem(ctx, it, C));
    for (const it of items) if (it.eq.tangent) this.safe(it, () => this.drawTangent(ctx, it, C));
    this.drawMarks(ctx, C);
    if (this.trace) this.refreshTrace();
    this.renderOverlay();
  }

  safe(it, fn) {
    try { fn(); } catch (e) { console.warn('draw error', it.eq, e); }
  }

  drawRectGrid(ctx, C) {
    const v = this.view;
    const stepX = niceStep(v.xmax - v.xmin, this.W / 90);
    const stepY = this.S.equal ? stepX : niceStep(v.ymax - v.ymin, this.H / 90);
    ctx.lineWidth = 1;
    // minor
    ctx.strokeStyle = C.gridMinor;
    ctx.beginPath();
    for (const x of ticks(v.xmin, v.xmax, stepX / 5)) { const X = Math.round(this.sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, this.H); }
    for (const y of ticks(v.ymin, v.ymax, stepY / 5)) { const Y = Math.round(this.sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(this.W, Y); }
    ctx.stroke();
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    for (const x of ticks(v.xmin, v.xmax, stepX)) { const X = Math.round(this.sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, this.H); }
    for (const y of ticks(v.ymin, v.ymax, stepY)) { const Y = Math.round(this.sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(this.W, Y); }
    ctx.stroke();
  }

  drawPolarGrid(ctx, C) {
    const v = this.view;
    const corners = [[v.xmin, v.ymin], [v.xmin, v.ymax], [v.xmax, v.ymin], [v.xmax, v.ymax]];
    const rmax = Math.max(...corners.map(([x, y]) => Math.hypot(x, y)));
    const rmin = Math.hypot(Math.max(v.xmin, 0, -v.xmax), Math.max(v.ymin, 0, -v.ymax));
    const step = niceStep(v.xmax - v.xmin, this.W / 90);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    const ox = this.sx(0), oy = this.sy(0);
    const sxs = this.W / (v.xmax - v.xmin), sys = this.H / (v.ymax - v.ymin);
    let count = 0;
    for (let r = Math.max(step, Math.floor(rmin / step) * step); r <= rmax && count < 400; r += step, count++) {
      ctx.moveTo(ox + r * sxs, oy);
      ctx.ellipse(ox, oy, r * sxs, r * sys, 0, 0, Math.PI * 2);
    }
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI) / 12;
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a) * rmax * sxs * 1.5, oy - Math.sin(a) * rmax * sys * 1.5);
    }
    ctx.stroke();
  }

  drawAxes(ctx, C) {
    const v = this.view;
    const { W, H } = this;
    const fs = this.S.fontSize || 13;
    ctx.font = `${fs}px ${FONT}`;
    const stepX = niceStep(v.xmax - v.xmin, W / 90);
    const stepY = this.S.equal ? stepX : niceStep(v.ymax - v.ymin, H / 90);
    // axis positions (pinned to the edges when the origin is off-screen)
    const ax = Math.min(H - 1, Math.max(0, this.sy(0)));
    const ay = Math.min(W - 1, Math.max(0, this.sx(0)));
    const xPinned = this.sy(0) < 0 || this.sy(0) > H;
    const yPinned = this.sx(0) < 0 || this.sx(0) > W;
    ctx.strokeStyle = C.axis;
    ctx.fillStyle = C.axis;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (!xPinned) { ctx.moveTo(0, ax); ctx.lineTo(W, ax); }
    if (!yPinned) { ctx.moveTo(ay, 0); ctx.lineTo(ay, H); }
    ctx.stroke();
    // arrow heads at positive ends
    ctx.beginPath();
    if (!xPinned) { ctx.moveTo(W, ax); ctx.lineTo(W - 9, ax - 4); ctx.lineTo(W - 9, ax + 4); }
    if (!yPinned) { ctx.moveTo(ay, 0); ctx.lineTo(ay - 4, 9); ctx.lineTo(ay + 4, 9); }
    ctx.fill();
    ctx.font = `italic ${fs + 2}px ${FONT}`;
    if (!xPinned) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('x', W - 6, ax - 6); }
    if (!yPinned) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('y', ay + 8, 4); }
    if (!this.S.ticks) return;
    ctx.font = `${fs}px ${FONT}`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const labelsX = [], labelsY = [];
    for (const x of ticks(v.xmin, v.xmax, stepX)) {
      if (x === 0 && !yPinned) continue;
      const X = this.sx(x);
      if (!xPinned) { ctx.moveTo(X, ax - 4); ctx.lineTo(X, ax + 4); }
      labelsX.push([X, fmtTick(x, stepX)]);
    }
    for (const y of ticks(v.ymin, v.ymax, stepY)) {
      if (y === 0 && !xPinned) continue;
      const Y = this.sy(y);
      if (!yPinned) { ctx.moveTo(ay - 4, Y); ctx.lineTo(ay + 4, Y); }
      labelsY.push([Y, fmtTick(y, stepY)]);
    }
    ctx.stroke();
    if (!this.S.labels) return;
    const halo = (text, x, y) => {
      ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
    };
    ctx.fillStyle = C.label;
    ctx.lineJoin = 'round';
    // x labels below the axis (or above when near bottom edge)
    const below = ax + fs + 8 < H;
    ctx.textAlign = 'center';
    ctx.textBaseline = below ? 'top' : 'bottom';
    for (const [X, s] of labelsX) if (X > 12 && X < W - 12) halo(s, X, below ? ax + 6 : ax - 6);
    const left = ay > 60;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    for (const [Y, s] of labelsY) if (Y > 10 && Y < H - 10) halo(s, left ? ay - 7 : ay + 7, Y);
    if (!xPinned && !yPinned) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; halo('0', ay - 5, ax + 5); }
  }

  // ---------------------------------------------------- curves
  /** Polylines (world coords, 3rd entry = parameter) for curve-like items; cached per render. */
  linesFor(it) {
    const id = it.eq.id;
    if (this.cache.has(id)) return this.cache.get(id).lines;
    const lines = this.computeLines(it);
    this.cache.set(id, { lines });
    return lines;
  }

  computeLines(it) {
    const { eq, c } = it;
    const v = this.view;
    const draft = this.draft;
    switch (eq.type) {
      case 'explicit': case 'inequality': {
        const [lo, hi] = this.explicitRange(c);
        if (!(hi > lo)) return [];
        const n = Math.max(20, Math.ceil(((hi - lo) / (v.xmax - v.xmin)) * this.W / (draft ? 8 : 3)));
        return sampleCurve((x) => [x, c.f(x), x], lo, hi, Math.min(n, 4000), this.toScreen, { maxDepth: draft ? 4 : 8 });
      }
      case 'parametric': case 'polar': {
        const [lo, hi] = c.range();
        if (!(Number.isFinite(lo) && Number.isFinite(hi)) || lo === hi) return [];
        return sampleCurve((t) => { const p = c.pt(t); p.push(t); return p; }, lo, hi, c.steps, this.toScreen, { maxDepth: draft ? 3 : 6 });
      }
      case 'implicit': {
        const cell = ({ coarse: 8, normal: 4, fine: 2 }[eq.res] || 4) * (draft ? 2 : 1);
        const nx = Math.max(10, Math.ceil(this.W / cell)), ny = Math.max(10, Math.ceil(this.H / cell));
        // slight offset avoids sampling exactly on symmetric lines
        const ex = (v.xmax - v.xmin) * 1e-7;
        const segs = marchingSquares(c.F, v.xmin - ex * 3.1, v.xmax + ex, v.ymin - ex * 2.3, v.ymax + ex, nx, ny);
        return joinSegments(segs, ((v.xmax - v.xmin) / nx) * 1e-4);
      }
      case 'ode': return this.odeLines(it);
      default: return [];
    }
  }

  explicitRange(c) {
    const v = this.view;
    const m = (v.xmax - v.xmin) * 0.02;
    let [lo, hi] = c.dom();
    lo = Number.isFinite(lo) ? Math.max(lo, v.xmin - m) : v.xmin - m;
    hi = Number.isFinite(hi) ? Math.min(hi, v.xmax + m) : v.xmax + m;
    return [lo, hi];
  }

  odeLines(it) {
    const { eq, c } = it;
    const v = this.view;
    const wx = v.xmax - v.xmin, wy = v.ymax - v.ymin;
    const box = { xlo: v.xmin - wx * 0.1, xhi: v.xmax + wx * 0.1, ylo: v.ymin - wy, yhi: v.ymax + wy };
    const lines = [];
    for (const [x0, y0] of c.ics()) {
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
      const solve = eq.solver === 'rk4'
        ? (dir) => solveODErk4(c.f, x0, y0, dir, box, wx / (this.draft ? 150 : 500))
        : (dir) => solveODE(c.f, x0, y0, dir, box, { hmax: wx / (this.draft ? 60 : 150), tol: this.draft ? 1e-5 : 1e-8 });
      const back = solve(-1).reverse();
      const fwd = solve(1);
      lines.push([...back, ...fwd.slice(1)].map(([x, y]) => [x, y, x]));
    }
    return lines;
  }

  strokeLines(ctx, lines, lim = 1e5) {
    ctx.beginPath();
    const cl = (v) => (v > lim ? lim : v < -lim ? -lim : v);
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const X = cl(this.sx(line[i][0])), Y = cl(this.sy(line[i][1]));
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      if (line.length === 1) { const X = cl(this.sx(line[0][0])), Y = cl(this.sy(line[0][1])); ctx.moveTo(X - 0.5, Y); ctx.lineTo(X + 0.5, Y); }
    }
    ctx.stroke();
  }

  drawItem(ctx, it, C) {
    const { eq, c } = it;
    const sel = this.app.selectedId() === eq.id && this.S.highlight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = eq.color;
    ctx.fillStyle = eq.color;
    ctx.lineWidth = eq.width;
    ctx.setLineDash([]);
    switch (eq.type) {
      case 'explicit': case 'parametric': case 'polar': case 'implicit': {
        const lines = this.linesFor(it);
        if (sel) { ctx.save(); ctx.strokeStyle = hexToRgba(eq.color, 0.22); ctx.lineWidth = eq.width + 7; this.strokeLines(ctx, lines); ctx.restore(); }
        this.strokeLines(ctx, lines);
        break;
      }
      case 'inequality': {
        const lines = this.linesFor(it);
        if (eq.rel === '<' || eq.rel === '>') ctx.setLineDash([8, 6]);
        this.strokeLines(ctx, lines);
        ctx.setLineDash([]);
        break;
      }
      case 'ode': {
        if (eq.field) this.drawSlopeField(ctx, it, C);
        const lines = this.linesFor(it);
        ctx.lineWidth = eq.width;
        this.strokeLines(ctx, lines);
        for (const [x0, y0] of c.ics()) {
          ctx.beginPath(); ctx.arc(this.sx(x0), this.sy(y0), eq.width + 2, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'points': this.drawPoints(ctx, it, C); break;
      case 'segment': this.drawSegment(ctx, it); break;
      default:
    }
  }

  drawSlopeField(ctx, it) {
    const { eq, c } = it;
    const n = Number(eq.density) || 20;
    const sp = this.W / n;
    const rows = Math.ceil(this.H / sp);
    const len = sp * 0.36;
    ctx.save();
    ctx.strokeStyle = hexToRgba(eq.color, 0.5);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const kx = this.W / (this.view.xmax - this.view.xmin), ky = this.H / (this.view.ymax - this.view.ymin);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < rows; j++) {
        const X = (i + 0.5) * sp, Y = this.H - (j + 0.5) * sp;
        const m = c.f(this.wx(X), this.wy(Y));
        let dx, dy;
        if (Number.isFinite(m)) { dx = kx; dy = -m * ky; } else if (Math.abs(m) === Infinity) { dx = 0; dy = 1; } else continue;
        const L = Math.hypot(dx, dy);
        dx = (dx / L) * len; dy = (dy / L) * len;
        if (eq.arrows) {
          ctx.moveTo(X - dx, Y - dy); ctx.lineTo(X + dx, Y + dy);
          const a = Math.atan2(dy, dx), h = len * 0.5;
          ctx.moveTo(X + dx, Y + dy); ctx.lineTo(X + dx - h * Math.cos(a - 0.45), Y + dy - h * Math.sin(a - 0.45));
          ctx.moveTo(X + dx, Y + dy); ctx.lineTo(X + dx - h * Math.cos(a + 0.45), Y + dy - h * Math.sin(a + 0.45));
        } else { ctx.moveTo(X - dx, Y - dy); ctx.lineTo(X + dx, Y + dy); }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPoints(ctx, it, C) {
    const { eq, c } = it;
    const pts = c.pts().filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (!pts.length) return;
    if (eq.style !== 'dots') {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(this.sx(x), this.sy(y)) : ctx.moveTo(this.sx(x), this.sy(y))));
      if (eq.style === 'polygon' || eq.style === 'filled') ctx.closePath();
      if (eq.style === 'filled') { ctx.save(); ctx.fillStyle = hexToRgba(eq.color, 0.3); ctx.fill(); ctx.restore(); }
      ctx.stroke();
    }
    const r = eq.style === 'dots' ? eq.width + 2.5 : eq.width + 1.5;
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(this.sx(x), this.sy(y), r, 0, Math.PI * 2); ctx.fill(); }
    if (eq.labels) {
      ctx.font = `${this.S.fontSize || 13}px ${FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      for (const [x, y] of pts) this.labelBox(ctx, C, `(${fmt(x, 4)}, ${fmt(y, 4)})`, this.sx(x) + r + 3, this.sy(y) - r - 2, eq.color);
    }
  }

  drawSegment(ctx, it) {
    const { eq, c } = it;
    let [[x1, y1], [x2, y2]] = c.ends();
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    let X1 = this.sx(x1), Y1 = this.sy(y1), X2 = this.sx(x2), Y2 = this.sy(y2);
    if (eq.extend) {
      const dx = X2 - X1, dy = Y2 - Y1, L = Math.hypot(dx, dy);
      if (L < 1e-9) return;
      const k = (this.W + this.H) * 2 / L;
      ctx.beginPath(); ctx.moveTo(X1 - dx * k, Y1 - dy * k); ctx.lineTo(X2 + dx * k, Y2 + dy * k); ctx.stroke();
      return;
    }
    ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); ctx.stroke();
    if (eq.arrow) {
      const a = Math.atan2(Y2 - Y1, X2 - X1), h = 8 + eq.width * 2.5;
      ctx.beginPath();
      ctx.moveTo(X2, Y2);
      ctx.lineTo(X2 - h * Math.cos(a - 0.4), Y2 - h * Math.sin(a - 0.4));
      ctx.lineTo(X2 - h * Math.cos(a + 0.4), Y2 - h * Math.sin(a + 0.4));
      ctx.closePath(); ctx.fill();
    } else {
      for (const [X, Y] of [[X1, Y1], [X2, Y2]]) { ctx.beginPath(); ctx.arc(X, Y, eq.width + 1.5, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  drawInequality(ctx, it) {
    const { eq, c } = it;
    const [lo, hi] = this.explicitRange(c);
    const below = eq.rel === '<' || eq.rel === '<=';
    const edge = below ? this.H + 5 : -5;
    ctx.save();
    ctx.fillStyle = hexToRgba(eq.color, Number(eq.alpha) || 0.3);
    ctx.beginPath();
    const X0 = Math.max(-2, this.sx(lo)), X1 = Math.min(this.W + 2, this.sx(hi));
    let open = false, lastX = 0;
    const lim = (Y) => Math.max(-10, Math.min(this.H + 10, Y));
    for (let X = X0; X <= X1 + 0.999; X += 1) {
      const Xc = Math.min(X, X1);
      const y = c.f(this.wx(Xc));
      if (Number.isNaN(y)) { if (open) { ctx.lineTo(lastX, edge); ctx.closePath(); open = false; } continue; }
      const Y = lim(this.sy(y));
      if (!open) { ctx.moveTo(Xc, edge); open = true; }
      ctx.lineTo(Xc, Y);
      lastX = Xc;
    }
    if (open) { ctx.lineTo(lastX, edge); ctx.closePath(); }
    ctx.fill();
    ctx.restore();
  }

  drawIntegral(ctx, it, C) {
    const { eq, c } = it;
    const info = this.app.integralInfo(it);
    if (!info) return;
    const { a, b } = info;
    ctx.save();
    ctx.fillStyle = hexToRgba(eq.color, 0.28);
    if (eq.type === 'explicit') {
      const X0 = this.sx(Math.min(a, b)), X1 = this.sx(Math.max(a, b));
      const Y0 = this.sy(0);
      const lim = (Y) => Math.max(-10, Math.min(this.H + 10, Y));
      ctx.beginPath();
      const n = Math.max(2, Math.ceil(X1 - X0));
      ctx.moveTo(X0, Y0);
      for (let i = 0; i <= n; i++) {
        const X = X0 + ((X1 - X0) * i) / n;
        const y = c.f(this.wx(X));
        ctx.lineTo(X, Number.isFinite(y) ? lim(this.sy(y)) : Y0);
      }
      ctx.lineTo(X1, Y0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexToRgba(eq.color, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X0, lim(this.sy(c.f(Math.min(a, b))) || Y0));
      ctx.moveTo(X1, Y0); ctx.lineTo(X1, lim(this.sy(c.f(Math.max(a, b))) || Y0)); ctx.stroke();
    } else if (eq.type === 'polar') {
      ctx.beginPath();
      ctx.moveTo(this.sx(0), this.sy(0));
      const n = 400;
      for (let i = 0; i <= n; i++) {
        const t = a + ((b - a) * i) / n;
        const [x, y] = c.pt(t);
        if (Number.isFinite(x) && Number.isFinite(y)) ctx.lineTo(this.sx(x), this.sy(y));
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if (info.text) {
      ctx.font = `${this.S.fontSize || 13}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      let X, Y;
      if (eq.type === 'explicit') {
        const m = (a + b) / 2, y = c.f(m);
        X = this.sx(m); Y = Number.isFinite(y) ? this.sy(y) - 8 : this.sy(0) - 8;
        if (Number.isFinite(y) && y < 0) Y = this.sy(0) - 8;
      } else { X = this.sx(0); Y = this.sy(0) - 10; }
      Y = Math.max(24, Math.min(this.H - 8, Y));
      this.labelBox(ctx, C, info.text, X, Y, eq.color, 'center');
    }
  }

  drawTangent(ctx, it, C) {
    const t = this.app.tangentInfo(it);
    if (!t) return;
    const { eq } = it;
    const { x0, y0, dx, dy } = t;
    const X = this.sx(x0), Y = this.sy(y0);
    let DX = dx * this.W / (this.view.xmax - this.view.xmin), DY = -dy * this.H / (this.view.ymax - this.view.ymin);
    const L = Math.hypot(DX, DY);
    if (!(L > 0)) return;
    DX /= L; DY /= L;
    const k = (this.W + this.H) * 2;
    ctx.save();
    ctx.strokeStyle = eq.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1, eq.width - 0.5);
    ctx.setLineDash([10, 5]);
    ctx.beginPath(); ctx.moveTo(X - DX * k, Y - DY * k); ctx.lineTo(X + DX * k, Y + DY * k); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = eq.color;
    ctx.beginPath(); ctx.arc(X, Y, eq.width + 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${this.S.fontSize || 13}px ${FONT}`;
    this.labelBox(ctx, C, t.text, X + 10, Y + 22, eq.color);
    ctx.restore();
  }

  drawMarks(ctx, C) {
    const marks = this.app.state.marks || [];
    ctx.font = `${this.S.fontSize || 13}px ${FONT}`;
    for (const m of marks) {
      const X = this.sx(m.x), Y = this.sy(m.y);
      if (X < -20 || X > this.W + 20 || Y < -20 || Y > this.H + 20) continue;
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.text;
      ctx.fillStyle = m.color || '#000';
      ctx.beginPath(); ctx.arc(X, Y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (m.text) this.labelBox(ctx, C, m.text, X + 8, Y - 8, m.color);
    }
  }

  labelBox(ctx, C, text, X, Y, color, align = 'left') {
    ctx.save();
    const fs = this.S.fontSize || 13;
    const w = ctx.measureText(text).width + 10;
    const h = fs + 8;
    let x = align === 'center' ? X - w / 2 : X;
    let y = Y - h;
    x = Math.max(2, Math.min(this.W - w - 2, x));
    y = Math.max(2, Math.min(this.H - h - 2, y));
    ctx.fillStyle = C.boxBg;
    ctx.strokeStyle = color || C.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 5); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 5, y + h / 2 + 0.5);
    ctx.restore();
  }

  // ------------------------------------------------------------ overlay (trace, zoom box)
  renderOverlay() {
    const ctx = this.octx;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const C = this.colors();
    if (this.zoomRect) {
      const { x0, y0, x1, y1 } = this.zoomRect;
      ctx.fillStyle = 'rgba(47,111,223,0.12)';
      ctx.strokeStyle = '#2f6fdf';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
    }
    if (this.hover) {
      const { X, Y } = this.hover;
      ctx.strokeStyle = C.dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X, 0); ctx.lineTo(X, this.H); ctx.moveTo(0, Y); ctx.lineTo(this.W, Y);
      ctx.stroke();
    }
    if (this.trace && Number.isFinite(this.trace.x) && Number.isFinite(this.trace.y)) {
      const tr = this.trace;
      const X = this.sx(tr.x), Y = this.sy(tr.y);
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(X, this.sy(0)); ctx.lineTo(X, Y); ctx.moveTo(this.sx(0), Y); ctx.lineTo(X, Y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.bg;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(X, Y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${(this.S.fontSize || 13) + 1}px ${FONT}`;
      const text = tr.text;
      const onRight = X < this.W - 200;
      ctx.textAlign = 'left';
      const w = ctx.measureText(text).width;
      this.labelBox(ctx, C, text, onRight ? X + 14 : X - w - 24, Y - 12, tr.color);
    }
  }

  // ------------------------------------------------------------ hit testing & trace
  nearestOnLines(lines, X, Y) {
    let best = null;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (let i = 0; i < line.length; i++) {
        const px = this.sx(line[i][0]), py = this.sy(line[i][1]);
        let d = Math.hypot(px - X, py - Y);
        let s = line[i][2], x = line[i][0], y = line[i][1];
        if (i + 1 < line.length) {
          // project onto the segment
          const qx = this.sx(line[i + 1][0]), qy = this.sy(line[i + 1][1]);
          const vx = qx - px, vy = qy - py, L2 = vx * vx + vy * vy;
          if (L2 > 0) {
            const u = Math.max(0, Math.min(1, ((X - px) * vx + (Y - py) * vy) / L2));
            const d2 = Math.hypot(px + u * vx - X, py + u * vy - Y);
            if (d2 < d) {
              d = d2;
              x = line[i][0] + u * (line[i + 1][0] - line[i][0]);
              y = line[i][1] + u * (line[i + 1][1] - line[i][1]);
              s = line[i][2] !== undefined ? line[i][2] + u * (line[i + 1][2] - line[i][2]) : undefined;
            }
          }
        }
        if (!best || d < best.d) best = { d, x, y, s };
      }
    }
    return best;
  }

  traceable(it) { return ['explicit', 'parametric', 'polar', 'implicit', 'ode', 'inequality'].includes(it.eq.type); }

  /** Nearest curve to screen point within tol px. */
  pick(X, Y, tol = 24) {
    let best = null;
    for (const it of this.app.items()) {
      if (!it.eq.visible || it.c.error) continue;
      let hit = null;
      if (this.traceable(it)) hit = this.nearestOnLines(this.linesFor(it), X, Y);
      else if (it.eq.type === 'points') {
        for (const [x, y] of it.c.pts()) { const d = Math.hypot(this.sx(x) - X, this.sy(y) - Y); if (!hit || d < hit.d) hit = { d, x, y }; }
      } else if (it.eq.type === 'segment') {
        const [[x1, y1], [x2, y2]] = it.c.ends();
        hit = this.nearestOnLines([[[x1, y1, 0], [x2, y2, 1]]], X, Y);
      }
      if (hit && hit.d <= tol && (!best || hit.d < best.hit.d)) best = { it, hit };
    }
    return best;
  }

  /** Puts the trace marker on item `it` nearest to the screen position (X,Y). */
  traceAt(it, X, Y) {
    const { eq, c } = it;
    let x, y, s;
    if (eq.type === 'explicit' || eq.type === 'inequality') {
      const [lo, hi] = c.dom();
      x = this.wx(X);
      if (Number.isFinite(lo)) x = Math.max(lo, x);
      if (Number.isFinite(hi)) x = Math.min(hi, x);
      y = c.f(x); s = x;
      if (!Number.isFinite(y)) {
        const h = this.nearestOnLines(this.linesFor(it), X, Y);
        if (!h) return;
        x = h.x; y = c.f(x); s = x;
      }
    } else {
      const h = this.nearestOnLines(this.linesFor(it), X, Y);
      if (!h) return;
      ({ x, y, s } = h);
      if (eq.type === 'parametric' || eq.type === 'polar') {
        // refine parameter by minimising screen distance
        const [lo, hi] = c.range();
        const ds = Math.abs(hi - lo) / c.steps;
        const dist = (t) => { const p = c.pt(t); return (this.sx(p[0]) - X) ** 2 + (this.sy(p[1]) - Y) ** 2; };
        s = brentMin(dist, Math.max(Math.min(lo, hi), s - ds), Math.min(Math.max(lo, hi), s + ds), 1e-10);
        [x, y] = c.pt(s);
      } else if (eq.type === 'implicit') {
        [x, y] = this.projectImplicit(c.F, x, y);
      }
    }
    this.setTrace(it, x, y, s);
  }

  projectImplicit(F, x, y) {
    for (let k = 0; k < 8; k++) {
      const f = F(x, y);
      const gx = numDeriv((u) => F(u, y), x), gy = numDeriv((u) => F(x, u), y);
      const g2 = gx * gx + gy * gy;
      if (!Number.isFinite(f) || !(g2 > 0)) break;
      const nx = x - (f * gx) / g2, ny = y - (f * gy) / g2;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) break;
      if (Math.hypot(nx - x, ny - y) > (this.view.xmax - this.view.xmin) * 0.02) break;
      x = nx; y = ny;
      if (Math.abs(f) < 1e-13) break;
    }
    return [x, y];
  }

  setTrace(it, x, y, s) {
    const { eq, c } = it;
    let text = `x = ${fmt(x, 6)},  y = ${fmt(y, 6)}`;
    let extra = '';
    if (eq.type === 'explicit' || eq.type === 'inequality') {
      const m = numDeriv(c.f, x);
      extra = `slope ${fmt(m, 5)}`;
    } else if (eq.type === 'parametric') {
      text = `t = ${fmt(s, 5)}:  (${fmt(x, 5)}, ${fmt(y, 5)})`;
    } else if (eq.type === 'polar') {
      text = `t = ${fmt(s, 5)}, r = ${fmt(c.fr(s), 5)}:  (${fmt(x, 5)}, ${fmt(y, 5)})`;
    } else if (eq.type === 'ode') {
      extra = `y′ = ${fmt(c.f(x, y), 5)}`;
    }
    this.trace = { id: eq.id, x, y, s, color: eq.color, text, extra };
    this.app.traceChanged(this.trace);
    this.renderOverlay();
  }

  /** Re-evaluates the trace after parameter/equation changes. */
  refreshTrace() {
    const it = this.app.items().find((i) => i.eq.id === this.trace.id);
    if (!it || it.c.error || !it.eq.visible) { this.trace = null; this.app.traceChanged(null); return; }
    const { eq, c } = it;
    const { s } = this.trace;
    try {
      if (eq.type === 'explicit' || eq.type === 'inequality') this.setTrace(it, s, c.f(s), s);
      else if (eq.type === 'parametric' || eq.type === 'polar') { const [x, y] = c.pt(s); this.setTrace(it, x, y, s); }
      else if (eq.type === 'implicit') { const [x, y] = this.projectImplicit(c.F, this.trace.x, this.trace.y); this.setTrace(it, x, y, s); }
    } catch { /* ignore */ }
  }

  /** Moves the trace marker by k steps (keyboard). */
  stepTrace(k) {
    if (!this.trace) return;
    const it = this.app.items().find((i) => i.eq.id === this.trace.id);
    if (!it) return;
    const { eq, c } = it;
    if (eq.type === 'explicit' || eq.type === 'inequality') {
      const step = niceStep(this.view.xmax - this.view.xmin, this.W / 4) / 10;
      const x = Math.round(this.trace.s / step) * step + k * step;
      this.setTrace(it, x, c.f(x), x);
    } else if (eq.type === 'parametric' || eq.type === 'polar') {
      const [lo, hi] = c.range();
      const step = (hi - lo) / Math.max(50, c.steps / 2);
      let t = this.trace.s + k * step;
      t = Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), t));
      const [x, y] = c.pt(t);
      this.setTrace(it, x, y, t);
    } else {
      this.traceAt(it, this.sx(this.trace.x) + k * 4, this.sy(this.trace.y));
    }
  }

  // ------------------------------------------------------------ view changes
  setView(v, { notify = true } = {}) {
    if (![v.xmin, v.xmax, v.ymin, v.ymax].every(Number.isFinite) || v.xmax - v.xmin < 1e-12 || v.ymax - v.ymin < 1e-12 || v.xmax - v.xmin > 1e12) return false;
    this.view = this.S.equal ? this.enforceAspect(v) : v;
    this.requestRender();
    if (notify) this.app.viewChanged();
    return true;
  }
  zoomAt(X, Y, f) {
    const v = this.view;
    const x = this.wx(X), y = this.wy(Y);
    this.setView({ xmin: x - (x - v.xmin) / f, xmax: x + (v.xmax - x) / f, ymin: y - (y - v.ymin) / f, ymax: y + (v.ymax - y) / f });
  }
  zoomBy(f) { this.zoomAt(this.W / 2, this.H / 2, f); }

  // ------------------------------------------------------------ pointer input
  bind() {
    const el = this.over;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.size) { this.hover = null; this.app.coords(''); this.renderOverlay(); }
    });
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  pos(e) {
    const r = this.over.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  showCoords(X, Y) {
    this.app.coords(`(${fmt(this.wx(X), 5)}, ${fmt(this.wy(Y), 5)})`);
  }

  onDown(e) {
    try { this.over.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { type: 'pinch', a0: { ...a }, b0: { ...b }, view0: { ...this.view } };
      this.zoomRect = null;
      this.draft = true;
      return;
    }
    if (this.pointers.size > 2) return;
    let mode = this.app.state.mode2;
    if (e.shiftKey) mode = 'zoom';
    if (e.button === 1 || e.button === 2) mode = 'pan';
    this.gesture = { type: 'single', id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, mode, view0: { ...this.view }, moved: false, touch: e.pointerType !== 'mouse' };
    if (mode === 'trace') this.doTrace(p.x, p.y, true);
    if (mode === 'solve') { this.hover = { X: p.x, Y: p.y }; this.showCoords(p.x, p.y); this.renderOverlay(); }
  }

  onMove(e) {
    const p = this.pos(e);
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        this.showCoords(p.x, p.y);
        if (this.app.state.mode2 === 'solve') { this.hover = { X: p.x, Y: p.y }; this.renderOverlay(); }
      }
      return;
    }
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!b) return;
      const d0 = Math.hypot(g.b0.x - g.a0.x, g.b0.y - g.a0.y) || 1;
      const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const s = d1 / d0;
      const m0 = { x: (g.a0.x + g.b0.x) / 2, y: (g.a0.y + g.b0.y) / 2 };
      const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // world point under m0 (in view0) must end up under m1 with scale s
      const v0 = g.view0;
      const wx0 = v0.xmin + (m0.x / this.W) * (v0.xmax - v0.xmin);
      const wy0 = v0.ymin + ((this.H - m0.y) / this.H) * (v0.ymax - v0.ymin);
      const nwx = (v0.xmax - v0.xmin) / s, nwy = (v0.ymax - v0.ymin) / s;
      const xmin = wx0 - (m1.x / this.W) * nwx;
      const ymin = wy0 - ((this.H - m1.y) / this.H) * nwy;
      this.setView({ xmin, xmax: xmin + nwx, ymin, ymax: ymin + nwy }, { notify: false });
      return;
    }
    if (g.type !== 'single' || g.id !== e.pointerId) return;
    g.x = p.x; g.y = p.y;
    if (Math.hypot(p.x - g.x0, p.y - g.y0) > (g.touch ? 8 : 3)) g.moved = true;
    this.showCoords(p.x, p.y);
    if (g.mode === 'pan' && g.moved) {
      const v0 = g.view0;
      const dx = ((p.x - g.x0) / this.W) * (v0.xmax - v0.xmin);
      const dy = ((p.y - g.y0) / this.H) * (v0.ymax - v0.ymin);
      this.draft = true;
      this.setView({ xmin: v0.xmin - dx, xmax: v0.xmax - dx, ymin: v0.ymin + dy, ymax: v0.ymax + dy }, { notify: false });
    } else if (g.mode === 'zoom' && g.moved) {
      this.zoomRect = { x0: g.x0, y0: g.y0, x1: p.x, y1: p.y };
      this.renderOverlay();
    } else if (g.mode === 'trace') {
      this.doTrace(p.x, p.y, false);
    } else if (g.mode === 'solve') {
      this.hover = { X: p.x, Y: p.y };
      this.renderOverlay();
    }
  }

  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    const cancelled = e.type === 'pointercancel';
    if (g.type === 'pinch') {
      this.gesture = this.pointers.size ? { type: 'done' } : null;
      this.endDraft();
      return;
    }
    if (g.type !== 'single' || g.id !== e.pointerId) { if (!this.pointers.size) this.gesture = null; return; }
    this.gesture = null;
    if (g.mode === 'pan') {
      if (g.moved) this.endDraft();
      else if (!cancelled) this.tapSelect(g.x, g.y);
    } else if (g.mode === 'zoom') {
      const r = this.zoomRect;
      this.zoomRect = null;
      this.renderOverlay();
      if (cancelled) return;
      if (r && Math.abs(r.x1 - r.x0) > 6 && Math.abs(r.y1 - r.y0) > 6) {
        const x0 = this.wx(Math.min(r.x0, r.x1)), x1 = this.wx(Math.max(r.x0, r.x1));
        const y0 = this.wy(Math.max(r.y0, r.y1)), y1 = this.wy(Math.min(r.y0, r.y1));
        if (this.S.equal) {
          // keep the whole box visible with equal scaling
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          const hw = Math.max((x1 - x0) / 2, ((y1 - y0) / 2) * this.W / this.H);
          this.setView({ xmin: cx - hw, xmax: cx + hw, ymin: cy - 1, ymax: cy + 1 });
        } else this.setView({ xmin: x0, xmax: x1, ymin: y0, ymax: y1 });
      } else this.zoomAt(g.x, g.y, 2);
    } else if (g.mode === 'solve') {
      this.hover = null;
      this.renderOverlay();
      if (!cancelled) this.app.addIC(this.wx(g.x), this.wy(g.y));
    }
  }

  endDraft() {
    this.draft = false;
    this.render();
    this.app.viewChanged();
  }

  tapSelect(X, Y) {
    const hit = this.pick(X, Y);
    if (hit) {
      this.app.select(hit.it.eq.id);
      this.app.status(`Selected: ${this.app.labelOf(hit.it.eq)}`);
    }
  }

  doTrace(X, Y, first) {
    let it = null;
    if (!first && this.trace) it = this.app.items().find((i) => i.eq.id === this.trace.id);
    if (first) {
      const hit = this.pick(X, Y, 44);
      const selId = this.app.selectedId();
      if (hit && this.traceable(hit.it)) it = hit.it;
      else it = this.app.items().find((i) => i.eq.id === selId && i.eq.visible && !i.c.error && this.traceable(i));
      if (!it && this.trace) it = this.app.items().find((i) => i.eq.id === this.trace.id);
      if (!it) it = this.app.items().find((i) => i.eq.visible && !i.c.error && this.traceable(i));
      if (it && it.eq.id !== selId) this.app.select(it.eq.id);
    }
    if (!it) { this.app.status('Nothing to trace – add a curve first.'); return; }
    this.traceAt(it, X, Y);
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.pos(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015));
      this.draft = true;
      this.zoomAt(p.x, p.y, f);
    } else {
      const v = this.view, dx = (e.deltaX / this.W) * (v.xmax - v.xmin);
      this.draft = true;
      this.setView({ xmin: v.xmin + dx, xmax: v.xmax + dx, ymin: v.ymin, ymax: v.ymax }, { notify: false });
    }
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.endDraft(), 200);
  }

  /** Renders a PNG of the current graph at the given scale. */
  toBlob(cb) {
    this.base.toBlob(cb, 'image/png');
  }
}

export { integrate };
