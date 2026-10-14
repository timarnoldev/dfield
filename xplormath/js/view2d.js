// 2D canvas view with pan / pinch zoom, optional grid and axes.

export class View2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cx = 0; this.cy = 0; this.scale = 50; // px per unit
    this.w = 1; this.h = 1; this.dpr = 1;
    this.dirty = true;
    this.grid = true;
    this.bg = 'dark';
    this.drawFn = null;
    this.onViewChange = null;
    this.home = null;
  }

  resize(w, h) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this.home) this.fit(this.home, false);
    this.dirty = true;
  }

  colors() {
    return this.bg === 'light'
      ? { bg: '#f7f8fa', grid: '#e3e6ea', axis: '#9aa3ad', text: '#5f6772', fg: '#1b1f24' }
      : { bg: '#10151b', grid: '#1d2631', axis: '#4d5b6b', text: '#8b9aab', fg: '#e8edf2' };
  }

  /** Fit world rectangle [xmin, xmax, ymin, ymax] with margin. */
  fit(b, remember = true) {
    if (remember) this.home = b;
    const [x0, x1, y0, y1] = b;
    const bw = Math.max(1e-9, x1 - x0), bh = Math.max(1e-9, y1 - y0);
    this.scale = Math.min(this.w / bw, this.h / bh) * 0.86;
    this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
    this.dirty = true;
    this.onViewChange?.();
  }

  toScreen(x, y) { return [(x - this.cx) * this.scale + this.w / 2, (this.cy - y) * this.scale + this.h / 2]; }
  toWorld(sx, sy) { return [(sx - this.w / 2) / this.scale + this.cx, this.cy - (sy - this.h / 2) / this.scale]; }
  bounds() { const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(this.w, this.h); return [x0, x1, y0, y1]; }

  // gestures
  onDrag(dx, dy) { this.onPan(dx, dy); }
  onPan(dx, dy) {
    this.cx -= dx / this.scale; this.cy += dy / this.scale;
    this.dirty = true; this.onViewChange?.();
  }
  onPinch(f, x, y) { this.zoomAt(f, x, y); }
  onWheel(f, x, y) { this.zoomAt(f, x, y); }
  onDoubleTap(p) { this.zoomAt(2, p.x, p.y); }
  zoomAt(f, x, y) {
    const [wx, wy] = this.toWorld(x, y);
    this.scale = Math.min(1e7, Math.max(1e-3, this.scale * f));
    this.cx = wx - (x - this.w / 2) / this.scale;
    this.cy = wy + (y - this.h / 2) / this.scale;
    this.dirty = true; this.onViewChange?.();
  }

  render(force = false) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    const ctx = this.ctx, c = this.colors();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.grid) this.drawGrid(ctx, c);
    if (this.drawFn) this.drawFn(ctx, this, c);
  }

  drawGrid(ctx, c) {
    const [x0, x1, y0, y1] = this.bounds();
    const raw = 80 / this.scale;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const [sx] = this.toScreen(x, 0); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, this.h); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const [, sy] = this.toScreen(0, y); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(this.w, Math.round(sy) + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = c.axis;
    ctx.beginPath();
    const [ox, oy] = this.toScreen(0, 0);
    ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(this.w, Math.round(oy) + 0.5);
    ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, this.h);
    ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.font = '12px -apple-system, system-ui, sans-serif';
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const lx = Math.min(Math.max(ox + 4, 4), this.w - 40), ly = Math.min(Math.max(oy - 4, 14), this.h - 4);
    ctx.textAlign = 'center';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      if (Math.abs(x) < step / 2) continue;
      const [sx] = this.toScreen(x, 0);
      ctx.fillText(x.toFixed(digits), sx, ly + (oy > this.h - 18 ? 0 : 16));
    }
    ctx.textAlign = 'left';
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      if (Math.abs(y) < step / 2) continue;
      const [, sy] = this.toScreen(0, y);
      ctx.fillText(y.toFixed(digits), lx, sy - 3);
    }
  }
}
