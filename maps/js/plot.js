// Plot frames, axes, tick marks and number formatting (canvas 2D).

export function stripZeros(s) {
  return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s;
}

/** Number with `sig` significant digits for coordinate read-outs. */
export function fmtNum(v, sig = 5) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a < 1e-300) return '0';
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    return `${stripZeros(m)}e${Number(e)}`;
  }
  const n = Math.floor(Math.log10(a)) - (sig - 1);
  if (n >= 0) return String(Math.round(v));
  return stripZeros(v.toFixed(Math.min(20, -n)));
}

/** Short value for parameter displays, adapted to a slider range. */
export function fmtParam(v, range = 1) {
  if (!Number.isFinite(v)) return String(v);
  const d = Math.max(0, Math.min(12, Math.ceil(-Math.log10(Math.abs(range) / 10000 || 1e-4))));
  const s = stripZeros(v.toFixed(d));
  return s === '-0' ? '0' : s;
}

export function fmtTick(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const ls = Math.floor(Math.log10(step) + 1e-9);
  if (a >= 1e6 || a < 1e-5) {
    const digits = Math.max(0, Math.min(8, Math.floor(Math.log10(a) + 1e-9) - ls));
    const [m, e] = v.toExponential(digits).split('e');
    return `${stripZeros(m)}e${Number(e)}`;
  }
  return v.toFixed(Math.max(0, -ls)).replace(/^-0$/, '0');
}

export function niceTicks(lo, hi, n) {
  n = Math.max(1, n);
  const raw = (hi - lo) / n;
  if (!(raw > 0) || !Number.isFinite(raw)) return { ticks: [], step: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let m = Math.ceil(raw / mag - 1e-9);
  if (m > 2 && m <= 5) m = 5;
  else if (m > 5) m = 10;
  const step = m * mag;
  const first = step * Math.ceil(lo / step - 1e-9);
  const ticks = [];
  for (let i = 0; i < 1000; i++) {
    const v = first + i * step;
    if (v > hi + step * 1e-9) break;
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { ticks, step };
}

/** A rectangular plot region with a data window [x0, x1] x [y0, y1]. */
export class Frame {
  constructor(id, x, y, w, h, win, opts = {}) {
    Object.assign(this, { id, x, y, w, h, win, ...opts });
  }
  get sx() { return this.w / (this.win[1] - this.win[0]); }
  get sy() { return this.h / (this.win[3] - this.win[2]); }
  px(v) { return this.x + (v - this.win[0]) * this.sx; }
  py(v) { return this.y + this.h - (v - this.win[2]) * this.sy; }
  wx(sx) { return this.win[0] + (sx - this.x) / this.sx; }
  wy(sy) { return this.win[2] + (this.y + this.h - sy) / this.sy; }
  contains(sx, sy, pad = 0) {
    return sx >= this.x - pad && sx <= this.x + this.w + pad && sy >= this.y - pad && sy <= this.y + this.h + pad;
  }
  clip(ctx) {
    ctx.beginPath();
    ctx.rect(this.x, this.y, this.w, this.h);
    ctx.clip();
  }
}

export function fontSpec(size, bold = false, italic = false) {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
}
export function mathFont(size) {
  return `italic ${size}px ui-serif, Georgia, "Times New Roman", serif`;
}

/** Width needed left of a frame for y tick labels + axis label. */
export function leftMargin(ctx, y0, y1, h, fs, yfmt) {
  ctx.font = fontSpec(fs);
  const yt = niceTicks(y0, y1, Math.max(2, h / (2.4 * fs)));
  const labels = yt.ticks.map((t) => (yfmt ? yfmt(t, yt.step) : fmtTick(t, yt.step)));
  const w = Math.max(ctx.measureText('0.0').width, ...labels.map((s) => ctx.measureText(s).width));
  return Math.ceil(w + fs * 1.6 + 10);
}

/**
 * Draw background, optional grid, frame and ticks/labels for a frame.
 * opts: { xlabel, ylabel, fs, grid, xticks (default true), yfmt, bg }
 */
export function drawAxes(ctx, fr, opts = {}) {
  const fs = opts.fs || 14;
  const [x0, x1, y0, y1] = fr.win;
  ctx.save();
  ctx.fillStyle = opts.bg || '#ffffff';
  ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
  ctx.font = fontSpec(fs);
  const xt = niceTicks(x0, x1, Math.max(2, fr.w / (6 * fs)));
  const yt = niceTicks(y0, y1, Math.max(2, fr.h / (2.4 * fs)));
  if (opts.grid) {
    ctx.strokeStyle = 'rgba(0,0,0,.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of xt.ticks) { const X = Math.round(fr.px(t)) + 0.5; ctx.moveTo(X, fr.y); ctx.lineTo(X, fr.y + fr.h); }
    for (const t of yt.ticks) { const Y = Math.round(fr.py(t)) + 0.5; ctx.moveTo(fr.x, Y); ctx.lineTo(fr.x + fr.w, Y); }
    ctx.stroke();
  }
  ctx.restore();
  return { xt, yt };
}

/** Frame border, ticks and labels (drawn after the content so it stays on top). */
export function drawFrame(ctx, fr, opts = {}) {
  const fs = opts.fs || 14;
  const [x0, x1, y0, y1] = fr.win;
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(fr.x) + 0.5, Math.round(fr.y) + 0.5, Math.round(fr.w), Math.round(fr.h));
  ctx.fillStyle = '#000';
  ctx.font = fontSpec(fs);
  const tl = Math.max(4, fs * 0.35);
  ctx.beginPath();
  if (opts.xticks !== false) {
    const xt = niceTicks(x0, x1, Math.max(2, fr.w / (6 * fs)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastRight = -Infinity;
    for (const t of xt.ticks) {
      const X = Math.round(fr.px(t)) + 0.5;
      ctx.moveTo(X, fr.y + fr.h); ctx.lineTo(X, fr.y + fr.h - tl);
      ctx.moveTo(X, fr.y); ctx.lineTo(X, fr.y + tl);
      if (opts.xlabels === false) continue;
      const s = opts.xfmt ? opts.xfmt(t, xt.step) : fmtTick(t, xt.step);
      const w = ctx.measureText(s).width;
      if (X - w / 2 > lastRight + 6) { ctx.fillText(s, X, fr.y + fr.h + 3); lastRight = X + w / 2; }
    }
  }
  const yt = niceTicks(y0, y1, Math.max(2, fr.h / (2.4 * fs)));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yt.ticks) {
    const Y = Math.round(fr.py(t)) + 0.5;
    ctx.moveTo(fr.x, Y); ctx.lineTo(fr.x + tl, Y);
    ctx.moveTo(fr.x + fr.w, Y); ctx.lineTo(fr.x + fr.w - tl, Y);
    ctx.fillText(opts.yfmt ? opts.yfmt(t, yt.step) : fmtTick(t, yt.step), fr.x - 4, Y);
  }
  ctx.stroke();
  ctx.font = mathFont(fs + 2);
  if (opts.xlabel && opts.xticks !== false && opts.xlabels !== false) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.xlabel, fr.x + fr.w, fr.y + fr.h + fs + 6);
  }
  if (opts.ylabel) {
    ctx.save();
    ctx.translate(fr.lx ?? fr.x - fs * 3, fr.y + fr.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.ylabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Polyline of y = g(x) over the frame, broken at NaN and at jumps. */
export function plotFunction(ctx, fr, g, samplesPerPx = 1) {
  const n = Math.max(2, Math.round(fr.w * samplesPerPx));
  const [x0, x1, y0, y1] = fr.win;
  const span = y1 - y0;
  ctx.beginPath();
  let pen = false;
  let prevY = NaN;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    const y = g(x);
    if (!Number.isFinite(y) || y < y0 - 50 * span || y > y1 + 50 * span) { pen = false; prevY = NaN; continue; }
    const X = fr.px(x), Y = fr.py(y);
    // break at discontinuities (e.g. mod): large jump between neighbours
    if (pen && Math.abs(y - prevY) > 0.3 * span) {
      // bisect: a jump that does not shrink is a discontinuity
      let xa = x0 + (x1 - x0) * (i - 1) / n, ya = prevY, xb = x, yb = y;
      const jump0 = Math.abs(yb - ya);
      for (let it = 0; it < 14; it++) {
        const xm = 0.5 * (xa + xb), ym = g(xm);
        if (!Number.isFinite(ym)) break;
        if (Math.abs(ym - ya) > Math.abs(yb - ym)) { xb = xm; yb = ym; } else { xa = xm; ya = ym; }
      }
      if (Math.abs(yb - ya) > 0.5 * jump0) pen = false;
    }
    if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    pen = true;
    prevY = y;
  }
  ctx.stroke();
}
