// Canvas plotting helpers: number formatting, ticks, 2D axes layout, marching squares.

export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

function stripZeros(s) { return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s; }

/** Compact number formatting with `sig` significant digits. */
export function fmt(v, sig = 5) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    return `${stripZeros(m)}e${Number(e)}`;
  }
  return stripZeros(v.toPrecision(sig));
}

export function niceTicks(lo, hi, n) {
  n = Math.max(1, n);
  const raw = (hi - lo) / n;
  if (!(raw > 0) || !Number.isFinite(raw)) return { ticks: [lo], step: 1 };
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let m = raw / mag;
  if (m <= 1) m = 1; else if (m <= 2) m = 2; else if (m <= 5) m = 5; else m = 10;
  const step = m * mag;
  const first = step * Math.ceil(lo / step - 1e-9);
  const ticks = [];
  for (let i = 0; i < 200; i++) {
    const v = first + i * step;
    if (v > hi + step * 1e-9) break;
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { ticks, step };
}

export function fmtTick(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) {
    const digits = Math.max(0, Math.min(8, Math.floor(Math.log10(a) + 1e-9) - Math.floor(Math.log10(step) + 1e-9)));
    const [m, e] = v.toExponential(digits).split('e');
    return `${stripZeros(m)}e${Number(e)}`;
  }
  const ls = Math.floor(Math.log10(step) + 1e-9);
  return v.toFixed(Math.max(0, -ls));
}

/**
 * Computes the layout of a 2D plot inside W x H with window win {xlo,xhi,ylo,yhi}.
 */
export function layout2D(ctx, W, H, win, fontSize) {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const D = Math.round(fontSize * 1.35);
  const top = Math.round(D * 0.9);
  const bottom = Math.round(D * 2.9);
  const h = Math.max(20, H - top - bottom);
  const yt = niceTicks(win.ylo, win.yhi, Math.max(2, h / (2.4 * D)));
  const ylabels = yt.ticks.map((t) => fmtTick(t, yt.step));
  const ylw = Math.max(0, ...ylabels.map((s) => ctx.measureText(s).width));
  const left = Math.round(ylw + D * 1.9 + 6);
  const right = Math.round(D * 1.2);
  const w = Math.max(20, W - left - right);
  let xt = niceTicks(win.xlo, win.xhi, Math.max(2, w / (6 * fontSize)));
  let xlabels = xt.ticks.map((t) => fmtTick(t, xt.step));
  const xlw = Math.max(0, ...xlabels.map((s) => ctx.measureText(s).width));
  if (xlw * xt.ticks.length > w * 0.7) {
    xt = niceTicks(win.xlo, win.xhi, Math.max(2, w / (xlw + 2.5 * fontSize)));
    xlabels = xt.ticks.map((t) => fmtTick(t, xt.step));
  }
  return {
    left, top, w, h, D, win,
    sx: w / (win.xhi - win.xlo), sy: h / (win.yhi - win.ylo),
    xt, yt, xlabels, ylabels, fontSize,
  };
}

export function makeMap(L) {
  const { win } = L;
  return {
    X: (v) => L.left + (v - win.xlo) * L.sx,
    Y: (v) => L.top + L.h - (v - win.ylo) * L.sy,
    toX: (px) => win.xlo + (px - L.left) / L.sx,
    toY: (py) => win.ylo + (L.top + L.h - py) / L.sy,
    inside: (px, py) => px >= L.left && px <= L.left + L.w && py >= L.top && py <= L.top + L.h,
  };
}

/** Draws plot background, grid, ticks and labels. */
export function drawAxes(ctx, L, xlab, ylab, { grid = true, bg = '#ffffff' } = {}) {
  const { left, top, w, h, fontSize } = L;
  const M = makeMap(L);
  ctx.fillStyle = bg;
  ctx.fillRect(left, top, w, h);
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  if (grid) {
    ctx.strokeStyle = '#e6e8eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of L.xt.ticks) { const x = Math.round(M.X(t)) + 0.5; ctx.moveTo(x, top); ctx.lineTo(x, top + h); }
    for (const t of L.yt.ticks) { const y = Math.round(M.Y(t)) + 0.5; ctx.moveTo(left, y); ctx.lineTo(left + w, y); }
    ctx.stroke();
    // zero axes
    ctx.strokeStyle = '#c4c8ce';
    ctx.beginPath();
    if (L.win.xlo < 0 && L.win.xhi > 0) { const x = Math.round(M.X(0)) + 0.5; ctx.moveTo(x, top); ctx.lineTo(x, top + h); }
    if (L.win.ylo < 0 && L.win.yhi > 0) { const y = Math.round(M.Y(0)) + 0.5; ctx.moveTo(left, y); ctx.lineTo(left + w, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  L.xt.ticks.forEach((t, i) => {
    const x = Math.round(M.X(t)) + 0.5;
    ctx.moveTo(x, top + h); ctx.lineTo(x, top + h + 5);
    ctx.fillText(L.xlabels[i], x, top + h + 7);
  });
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  L.yt.ticks.forEach((t, i) => {
    const y = Math.round(M.Y(t)) + 0.5;
    ctx.moveTo(left - 5, y); ctx.lineTo(left, y);
    ctx.fillText(L.ylabels[i], left - 7, y);
  });
  ctx.stroke();
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(xlab, left + w / 2, top + h + L.D * 2.55);
  ctx.save();
  ctx.translate(Math.round(L.D * 0.95), top + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(ylab, 0, 0);
  ctx.restore();
}

/** Draws a polyline of data (xs, ys arrays), breaking at non-finite values. */
export function polyline(ctx, xs, ys, M, from = 0, to = xs.length) {
  ctx.beginPath();
  let pen = false;
  let lx = NaN, ly = NaN;
  for (let k = from; k < to; k++) {
    const x = M.X(xs[k]), y = M.Y(ys[k]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) { pen = false; continue; }
    if (!pen) { ctx.moveTo(x, y); pen = true; lx = x; ly = y; continue; }
    // skip sub-pixel segments (big speedup for dense data)
    if (Math.abs(x - lx) + Math.abs(y - ly) < 0.6 && k < to - 1) continue;
    ctx.lineTo(x, y);
    lx = x; ly = y;
  }
  ctx.stroke();
}

/**
 * Marching squares zero contour of grid values v[(j*(nx+1))+i] at grid points
 * (x0 + i*dx, y0 + j*dy). Returns flat array of segment endpoints [x1,y1,x2,y2,...] in data coords.
 */
export function zeroContour(v, nx, ny, x0, y0, dx, dy) {
  const segs = [];
  let typical = 0, cnt = 0;
  for (let k = 0; k < v.length; k++) if (Number.isFinite(v[k])) { typical += Math.abs(v[k]); cnt++; }
  typical = cnt ? typical / cnt : 1;
  const big = 40 * typical + 1e-300;
  const idx = (i, j) => j * (nx + 1) + i;
  const pts = [];
  const edge = (va, vb, xa, ya, xb, yb) => {
    if (!(Number.isFinite(va) && Number.isFinite(vb))) return;
    if ((va > 0) === (vb > 0)) return;
    if (Math.abs(va) > big && Math.abs(vb) > big) return; // pole, not a zero
    const s = va / (va - vb);
    pts.push(xa + s * (xb - xa), ya + s * (yb - ya));
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = v[idx(i, j)], b = v[idx(i + 1, j)], c = v[idx(i + 1, j + 1)], d = v[idx(i, j + 1)];
      const xa = x0 + i * dx, xb = xa + dx, ya = y0 + j * dy, yb = ya + dy;
      pts.length = 0;
      edge(a, b, xa, ya, xb, ya);
      edge(b, c, xb, ya, xb, yb);
      edge(c, d, xb, yb, xa, yb);
      edge(d, a, xa, yb, xa, ya);
      if (pts.length === 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
      else if (pts.length === 8) {
        const center = (a + b + c + d) / 4;
        // points: 0 bottom, 1 right, 2 top, 3 left
        if ((center > 0) === (a > 0)) segs.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
        else segs.push(pts[0], pts[1], pts[6], pts[7], pts[2], pts[3], pts[4], pts[5]);
      }
    }
  }
  return segs;
}
