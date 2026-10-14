// Canvas plot with world coordinates, axes, draggable handles and touch/mouse input.
import { niceTicks, tickLabel, fmt, fmtPi } from './math.js';

export const C = {
  blue: '#1f5fd1',
  red: '#d1342f',
  green: '#1d8a3a',
  orange: '#e07b00',
  purple: '#8a3ccf',
  teal: '#0a8f8f',
  brown: '#8a5a2b',
  gray: '#8a919a',
  target: '#a7afb9',
  axis: '#3b4148',
  grid: '#e7e9ec',
  frame: '#c3c8cf',
  text: '#1b1f24',
  muted: '#5f6772',
  fill: 'rgba(47,111,223,.18)',
};
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
export const font = (px, w = '') => `${w} ${px}px ${FONT}`.trim();
export const MATHFONT = (px) => `italic ${px}px "Times New Roman", Georgia, serif`;

const isTouchLike = (e) => e.pointerType !== 'mouse';

export class Plot {
  /**
   * opts: xmin,xmax,ymin,ymax, xlog, ylog, equal, xTicks ('pi' | null), title, legend [[label,color,dash]],
   * xlabel, ylabel, margin {l,r,t,b}, grid (bool), axes (bool), onTap(x,y), onDown(x,y,e) -> {move(x,y), up()},
   * onHover(x,y) -> string, noYLabels, noXLabels
   */
  constructor(host, env, opts = {}) {
    this.host = host;
    this.env = env;
    this.o = { grid: true, axes: true, margin: {}, legend: null, ...opts };
    this.cv = document.createElement('canvas');
    host.append(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.handles = [];
    this.W = 10; this.H = 10; this.dpr = 1;
    this.v = { xmin: opts.xmin ?? -1, xmax: opts.xmax ?? 1, ymin: opts.ymin ?? -1, ymax: opts.ymax ?? 1 };
    this.L = { left: 0, top: 0, w: 1, h: 1 };
    this.drag = null;
    this.hover = null;
    this.ro = new ResizeObserver(() => { this.resize(); env.redraw(); });
    this.ro.observe(host);
    this.resize();
    this._bind();
  }

  destroy() { this.ro.disconnect(); this.cv.remove(); }

  setView(xmin, xmax, ymin, ymax) {
    Object.assign(this.o, { xmin, xmax, ymin, ymax });
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(20, Math.floor(r.width));
    this.H = Math.max(20, Math.floor(r.height));
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(this.W * this.dpr), h = Math.round(this.H * this.dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
  }

  _layout() {
    const o = this.o, m = o.margin;
    const left = m.l ?? (o.noYLabels ? 12 : 50);
    const right = m.r ?? 14;
    const top = m.t ?? (o.title ? 30 : 12);
    const bottom = m.b ?? (o.noXLabels ? 12 : 28);
    const w = Math.max(10, this.W - left - right), h = Math.max(10, this.H - top - bottom);
    this.L = { left, top, w, h };
    let { xmin, xmax, ymin, ymax } = o;
    if (o.equal) {
      const sx = w / (xmax - xmin), sy = h / (ymax - ymin), s = Math.min(sx, sy);
      const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
      const hx = w / s / 2, hy = h / s / 2;
      xmin = cx - hx; xmax = cx + hx; ymin = cy - hy; ymax = cy + hy;
    }
    this.v = { xmin, xmax, ymin, ymax };
    const tx = (x) => (o.xlog ? Math.log10(x) : x), ty = (y) => (o.ylog ? Math.log10(y) : y);
    this._x0 = tx(xmin); this._sx = w / (tx(xmax) - tx(xmin));
    this._y0 = ty(ymin); this._sy = h / (ty(ymax) - ty(ymin));
  }

  X(x) { return this.L.left + ((this.o.xlog ? Math.log10(x) : x) - this._x0) * this._sx; }
  Y(y) { return this.L.top + this.L.h - ((this.o.ylog ? Math.log10(y) : y) - this._y0) * this._sy; }
  ix(px) { const u = this._x0 + (px - this.L.left) / this._sx; return this.o.xlog ? 10 ** u : u; }
  iy(py) { const u = this._y0 + (this.L.top + this.L.h - py) / this._sy; return this.o.ylog ? 10 ** u : u; }
  inside(px, py, pad = 0) { const L = this.L; return px >= L.left - pad && px <= L.left + L.w + pad && py >= L.top - pad && py <= L.top + L.h + pad; }

  /** Clear and draw frame, grid, axes, tick labels and title. Returns the 2D context. */
  begin() {
    const ctx = this.ctx, o = this.o;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.W, this.H);
    this._layout();
    const { left, top, w, h } = this.L;
    const v = this.v;
    ctx.lineWidth = 1;
    ctx.font = font(12);
    ctx.textBaseline = 'middle';
    // ticks
    const xt = this._ticks('x'), yt = this._ticks('y');
    if (o.grid) {
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      for (const t of xt.minor) { const X = Math.round(this.X(t)) + 0.5; ctx.moveTo(X, top); ctx.lineTo(X, top + h); }
      for (const t of yt.minor) { const Y = Math.round(this.Y(t)) + 0.5; ctx.moveTo(left, Y); ctx.lineTo(left + w, Y); }
      ctx.stroke();
      ctx.strokeStyle = '#d9dce0';
      ctx.beginPath();
      for (const t of xt.major) { const X = Math.round(this.X(t)) + 0.5; ctx.moveTo(X, top); ctx.lineTo(X, top + h); }
      for (const t of yt.major) { const Y = Math.round(this.Y(t)) + 0.5; ctx.moveTo(left, Y); ctx.lineTo(left + w, Y); }
      ctx.stroke();
    }
    ctx.strokeStyle = C.frame;
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
    if (o.axes) {
      ctx.strokeStyle = C.axis;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (!o.ylog && v.ymin < 0 && v.ymax > 0) { const Y = Math.round(this.Y(0)) + 0.5; ctx.moveTo(left, Y); ctx.lineTo(left + w, Y); }
      if (!o.xlog && v.xmin < 0 && v.xmax > 0) { const X = Math.round(this.X(0)) + 0.5; ctx.moveTo(X, top); ctx.lineTo(X, top + h); }
      ctx.stroke();
    }
    // labels
    ctx.fillStyle = C.muted;
    if (!o.noXLabels) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let lastRight = -Infinity;
      for (let i = 0; i < xt.major.length; i++) {
        const X = this.X(xt.major[i]);
        const s = xt.labels[i];
        const tw = ctx.measureText(s).width;
        if (X - tw / 2 < lastRight + 6) continue;
        ctx.fillText(s, Math.min(Math.max(X, tw / 2 + 2), this.W - tw / 2 - 2), top + h + 5);
        lastRight = X + tw / 2;
      }
      if (o.xlabel) {
        ctx.font = MATHFONT(15);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = C.text;
        ctx.fillText(o.xlabel, left + w - 4, top + h - 3);
        ctx.font = font(12);
        ctx.fillStyle = C.muted;
      }
    }
    if (!o.noYLabels) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let lastTop = Infinity;
      for (let i = 0; i < yt.major.length; i++) {
        const Y = this.Y(yt.major[i]);
        if (Y > lastTop - 14) continue;
        ctx.fillText(yt.labels[i], left - 5, Math.max(Math.min(Y, top + h), top + 6));
        lastTop = Y;
      }
      if (o.ylabel) {
        ctx.font = MATHFONT(15);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = C.text;
        ctx.fillText(o.ylabel, left + 5, top + 3);
      }
    }
    // title + legend
    if (o.title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = font(13.5, '600');
      ctx.fillStyle = C.text;
      let x = 10;
      const y = top / 2 + 1;
      ctx.fillText(o.title, x, y);
      x += ctx.measureText(o.title).width + 16;
      if (o.legend) {
        ctx.font = font(12.5);
        for (const [label, color, dash] of o.legend) {
          const tw = ctx.measureText(label).width;
          if (x + 26 + tw > this.W - 8) break;
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.setLineDash(dash || []);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = C.text;
          ctx.fillText(label, x + 23, y);
          x += 23 + tw + 14;
        }
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 1;
    return ctx;
  }

  _ticks(axis) {
    const o = this.o, v = this.v;
    const isX = axis === 'x';
    const lo = isX ? v.xmin : v.ymin, hi = isX ? v.xmax : v.ymax;
    const log = isX ? o.xlog : o.ylog;
    const len = isX ? this.L.w : this.L.h;
    const custom = isX ? o.xTicks : o.yTicks;
    if (log) {
      const major = [], minor = [], labels = [];
      const perDec = len / Math.max(1e-9, Math.log10(hi / lo));
      const stride = Math.max(1, Math.ceil((isX ? 50 : 24) / perDec));
      for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
        const d = 10 ** k;
        if (d >= lo * 0.999 && d <= hi * 1.001) {
          if (k % stride === 0) { major.push(d); labels.push(k >= -2 && k <= 3 ? fmt(d) : `10${toSupLocal(k)}`); } else minor.push(d);
        }
        if (perDec >= 50 && k % stride === 0) for (let m = 2; m < 10; m++) if (d * m > lo && d * m < hi) minor.push(d * m);
      }
      return { major, minor, labels };
    }
    if (custom === 'pi') {
      const span = hi - lo;
      const stepPi = span / Math.PI > 8 ? Math.PI : Math.PI / 2;
      const step = len < 260 && stepPi < Math.PI ? Math.PI : stepPi;
      const major = [];
      for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) major.push(k * step);
      const minor = niceTicks(lo, hi, len / 22).ticks;
      return { major, minor, labels: major.map(fmtPi) };
    }
    const n = Math.max(2, len / (isX ? 70 : 42));
    const t = niceTicks(lo, hi, n);
    const minor = niceTicks(lo, hi, n * 5).ticks;
    return { major: t.ticks, minor, labels: t.ticks.map((x) => tickLabel(x, t.step)) };
  }

  clip() {
    const { left, top, w, h } = this.L;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(left, top, w, h);
    this.ctx.clip();
  }
  unclip() { this.ctx.restore(); }

  _style(st = {}) {
    const ctx = this.ctx;
    ctx.strokeStyle = st.color || C.blue;
    ctx.lineWidth = st.width ?? 2.2;
    ctx.setLineDash(st.dash || []);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = st.alpha ?? 1;
  }
  _unstyle() { this.ctx.setLineDash([]); this.ctx.globalAlpha = 1; }

  /** Plot y = f(x) over the visible x-range (or [x0, x1]); breaks at NaN and at big jumps. */
  fn(f, st = {}) {
    const ctx = this.ctx;
    const x0 = Math.max(st.x0 ?? this.v.xmin, this.v.xmin), x1 = Math.min(st.x1 ?? this.v.xmax, this.v.xmax);
    if (!(x1 > x0)) return;
    const n = Math.max(2, Math.ceil(((this.X(x1) - this.X(x0)) / (st.res ?? 1.5))));
    const limit = this.L.h * 4;
    this.clip();
    this._style(st);
    ctx.beginPath();
    let pen = false, lastY = 0;
    for (let i = 0; i <= n; i++) {
      const x = this.o.xlog ? 10 ** (Math.log10(x0) + (Math.log10(x1) - Math.log10(x0)) * i / n) : x0 + ((x1 - x0) * i) / n;
      const y = f(x);
      if (!Number.isFinite(y)) { pen = false; continue; }
      let Y = this.Y(y);
      Y = Math.max(-limit, Math.min(this.H + limit, Y));
      const X = this.X(x);
      if (pen && st.jumps !== false && Math.abs(Y - lastY) > this.L.h * 0.6) pen = false;
      if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      pen = true; lastY = Y;
    }
    ctx.stroke();
    this._unstyle();
    this.unclip();
  }

  /** Polyline through world points (arrays xs, ys or array of [x,y]). */
  poly(pts, st = {}, close = false) {
    const ctx = this.ctx;
    this.clip();
    this._style(st);
    ctx.beginPath();
    let pen = false;
    const lim = 1e5;
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      const X = Math.max(-lim, Math.min(lim, this.X(x))), Y = Math.max(-lim, Math.min(lim, this.Y(y)));
      if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      pen = true;
    }
    if (close) ctx.closePath();
    if (st.fill) { ctx.fillStyle = st.fill; ctx.fill(); }
    if (st.width !== 0) ctx.stroke();
    this._unstyle();
    this.unclip();
  }

  /** Fill the region between y = f(x) and y = base over [x0, x1]. */
  fillUnder(f, x0, x1, color, base = 0) {
    const ctx = this.ctx;
    const n = Math.max(2, Math.ceil(Math.abs(this.X(x1) - this.X(x0)) / 1.5));
    this.clip();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(this.X(x0), this.Y(base));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = f(x);
      ctx.lineTo(this.X(x), this.Y(Number.isFinite(y) ? Math.max(-1e6, Math.min(1e6, y)) : base));
    }
    ctx.lineTo(this.X(x1), this.Y(base));
    ctx.closePath();
    ctx.fill();
    this.unclip();
  }

  line(x1, y1, x2, y2, st = {}) { this.poly([[x1, y1], [x2, y2]], st); }
  hline(y, st = {}) { this.line(this.v.xmin, y, this.v.xmax, y, st); }
  vline(x, st = {}) { this.line(x, this.v.ymin, x, this.v.ymax, st); }

  dot(x, y, r = 4, color = C.blue, stroke = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(this.X(x), this.Y(y), r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  /** Draggable handle look: white disc with colored ring (or filled). */
  knob(x, y, color = C.blue, { r = 9, filled = false, active = false, shape = 'circle' } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const ctx = this.ctx;
    const X = this.X(x), Y = this.Y(y);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.3)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    const rr = active ? r + 2 : r;
    if (shape === 'x') {
      ctx.lineWidth = 3.5; ctx.strokeStyle = color; ctx.lineCap = 'round';
      ctx.moveTo(X - rr * 0.8, Y - rr * 0.8); ctx.lineTo(X + rr * 0.8, Y + rr * 0.8);
      ctx.moveTo(X + rr * 0.8, Y - rr * 0.8); ctx.lineTo(X - rr * 0.8, Y + rr * 0.8);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (shape === 'diamond') { ctx.moveTo(X, Y - rr * 1.2); ctx.lineTo(X + rr * 1.2, Y); ctx.lineTo(X, Y + rr * 1.2); ctx.lineTo(X - rr * 1.2, Y); ctx.closePath(); }
    else ctx.arc(X, Y, rr, 0, 2 * Math.PI);
    ctx.fillStyle = filled ? color : '#fff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (!filled) {
      ctx.beginPath();
      ctx.arc(X, Y, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }

  /** Text at world coordinates. opts: color, align, base, size, bold, math, dx, dy, bg */
  text(s, x, y, o = {}) {
    this.textPx(s, this.X(x) + (o.dx || 0), this.Y(y) + (o.dy || 0), o);
  }
  textPx(s, X, Y, o = {}) {
    const ctx = this.ctx;
    ctx.font = o.math ? MATHFONT(o.size || 15) : font(o.size || 12.5, o.bold ? '600' : '');
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'middle';
    if (o.bg) {
      const w = ctx.measureText(s).width;
      const h = (o.size || 12.5) + 6;
      let x0 = X - (o.align === 'center' ? w / 2 : o.align === 'right' ? w : 0) - 3;
      let y0 = Y - h / 2;
      if (o.base === 'top') y0 = Y - 3; else if (o.base === 'bottom') y0 = Y - h + 3;
      ctx.fillStyle = o.bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, y0, w + 6, h, 4); else ctx.rect(x0, y0, w + 6, h);
      ctx.fill();
    }
    ctx.fillStyle = o.color || C.text;
    ctx.fillText(s, X, Y);
    ctx.textBaseline = 'alphabetic';
  }

  arrowPx(x1, y1, x2, y2, color, width = 2, head = 9) {
    const ctx = this.ctx;
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
    ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
  }
  arrow(x1, y1, x2, y2, color, width, head) { this.arrowPx(this.X(x1), this.Y(y1), this.X(x2), this.Y(y2), color, width, head); }

  /** Add a small overlay button at the top-right of the pane. */
  tool(label, onClick, title = '') {
    let box = this.host.querySelector('.pane-tools');
    if (!box) { box = document.createElement('div'); box.className = 'pane-tools'; this.host.append(box); }
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); onClick(b); this.env.redraw(); };
    box.append(b);
    return b;
  }

  // ---------------------------------------------------------------- input
  _pos(e) {
    const r = this.cv.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  _findHandle(px, py, touch) {
    const tol = touch ? 30 : 14;
    let best = null, bd = Infinity;
    for (const h of this.handles) {
      if (!h || h.disabled) continue;
      let d;
      if (h.dist) d = h.dist(px, py);
      else {
        const [x, y] = h.pos();
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        d = Math.hypot(this.X(x) - px, this.Y(y) - py);
      }
      const lim = (h.tol ?? tol) * (touch ? 1 : 0.6) + (h.r || 0);
      if (d < lim && d < bd) { bd = d; best = h; }
    }
    return best;
  }
  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => {
      if (this.drag) return;
      if (e.button > 0) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const { px, py } = this._pos(e);
      const touch = isTouchLike(e);
      const h = this._findHandle(px, py, touch);
      const wx = this.ix(px), wy = this.iy(py);
      if (h) {
        // keep the grab offset so the handle does not jump under the finger
        let off = [0, 0];
        if (h.pos && !h.noOffset) { const [x, y] = h.pos(); off = [this.X(x) - px, this.Y(y) - py]; }
        this.drag = { id: e.pointerId, h, off, px0: px, py0: py, moved: false };
        h.start?.(wx, wy);
        this.env.setActive?.(h);
      } else {
        const d = this.o.onDown?.(wx, wy, { px, py, touch });
        this.drag = { id: e.pointerId, custom: d || null, px0: px, py0: py, moved: false };
      }
      this.env.redraw();
    });
    cv.addEventListener('pointermove', (e) => {
      const { px, py } = this._pos(e);
      const d = this.drag;
      if (d && d.id === e.pointerId) {
        if (Math.hypot(px - d.px0, py - d.py0) > 4) d.moved = true;
        if (d.h) {
          const X = px + d.off[0], Y = py + d.off[1];
          d.h.drag(this.ix(X), this.iy(Y), { px: X, py: Y });
          this.env.changed();
        } else if (d.custom && d.custom.move) {
          d.custom.move(this.ix(px), this.iy(py), { px, py });
          this.env.changed();
        }
        this._coords(px, py);
        return;
      }
      if (e.pointerType === 'mouse') {
        const h = this._findHandle(px, py, false);
        cv.style.cursor = h ? (h.cursor || 'grab') : (this.o.cursor || 'crosshair');
        this._coords(px, py);
      }
    });
    const up = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      const { px, py } = this._pos(e);
      if (d.h) { d.h.end?.(); this.env.setActive?.(null); }
      else if (d.custom && d.custom.up) d.custom.up();
      if (!d.moved && e.type !== 'pointercancel' && !d.h && !d.custom) this.o.onTap?.(this.ix(px), this.iy(py));
      else if (!d.moved && d.h && d.h.tap) d.h.tap();
      this.env.changed();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.drag) this.env.coords(''); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  _coords(px, py) {
    if (!this.inside(px, py)) { this.env.coords(''); return; }
    const x = this.ix(px), y = this.iy(py);
    const s = this.o.onHover ? this.o.onHover(x, y) : `${this.o.xname || 'x'} = ${fmt(x, 4)}   ${this.o.yname || 'y'} = ${fmt(y, 4)}`;
    this.env.coords(s);
  }
}

function toSupLocal(k) {
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(k).split('').map((c) => SUP[c]).join('');
}
