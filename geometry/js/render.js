// Scene rendering through a small backend interface (Canvas 2D and SVG export).
import { catOf, lineRange, centroid } from './kernel.js';

const TAU = Math.PI * 2;
export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const HL_SEL = 'rgba(47,111,223,0.45)';
const HL_CAND = 'rgba(255,152,0,0.55)';
const HL_PICK = 'rgba(47,111,223,0.6)';

// ------------------------------------------------------------------ backends
export class CanvasBackend {
  constructor(ctx) { this.ctx = ctx; }
  path(cmds, st) {
    const g = this.ctx;
    g.beginPath();
    for (const c of cmds) {
      switch (c[0]) {
        case 'M': g.moveTo(c[1], c[2]); break;
        case 'L': g.lineTo(c[1], c[2]); break;
        case 'A': g.arc(c[1], c[2], c[3], c[4], c[5], c[6]); break;
        case 'C': g.moveTo(c[1] + c[3], c[2]); g.arc(c[1], c[2], c[3], 0, TAU); break;
        case 'Z': g.closePath(); break;
        default: break;
      }
    }
    if (st.fill) {
      g.globalAlpha = st.fillAlpha ?? 1;
      g.fillStyle = st.fill;
      g.fill();
      g.globalAlpha = 1;
    }
    if (st.stroke) {
      g.globalAlpha = st.alpha ?? 1;
      g.strokeStyle = st.stroke;
      g.lineWidth = st.width || 1;
      g.setLineDash(st.dash || []);
      g.lineCap = st.cap || 'round';
      g.lineJoin = 'round';
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }
  text(x, y, str, st) {
    const g = this.ctx;
    g.font = st.font;
    g.textAlign = st.align || 'left';
    g.textBaseline = 'middle';
    g.globalAlpha = st.alpha ?? 1;
    if (st.halo) {
      g.lineWidth = 4;
      g.strokeStyle = st.halo;
      g.lineJoin = 'round';
      g.strokeText(str, x, y);
    }
    g.fillStyle = st.color;
    g.fillText(str, x, y);
    g.globalAlpha = 1;
  }
  measure(str, font) { this.ctx.font = font; return this.ctx.measureText(str).width; }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (v) => Math.round(v * 100) / 100;

export class SvgBackend {
  constructor(W, H, measureCtx) { this.W = W; this.H = H; this.out = []; this.mctx = measureCtx; }
  path(cmds, st) {
    let d = '';
    let cur = null;
    for (const c of cmds) {
      switch (c[0]) {
        case 'M': d += `M${r2(c[1])} ${r2(c[2])}`; cur = [c[1], c[2]]; break;
        case 'L': d += `L${r2(c[1])} ${r2(c[2])}`; cur = [c[1], c[2]]; break;
        case 'C': {
          const [, x, y, r] = c;
          d += `M${r2(x + r)} ${r2(y)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(x - r)} ${r2(y)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(x + r)} ${r2(y)}`;
          cur = [x + r, y];
          break;
        }
        case 'A': {
          const [, x, y, r, a0, a1, ccw] = c;
          let delta = ccw ? a0 - a1 : a1 - a0;
          if (delta < 0) delta = delta % TAU + TAU;
          if (delta > TAU) delta = TAU;
          const sx = x + r * Math.cos(a0), sy = y + r * Math.sin(a0);
          d += cur ? `L${r2(sx)} ${r2(sy)}` : `M${r2(sx)} ${r2(sy)}`;
          if (delta >= TAU - 1e-9) {
            const mx = x + r * Math.cos(a0 + Math.PI), my = y + r * Math.sin(a0 + Math.PI);
            const f = ccw ? 0 : 1;
            d += `A${r2(r)} ${r2(r)} 0 1 ${f} ${r2(mx)} ${r2(my)}A${r2(r)} ${r2(r)} 0 1 ${f} ${r2(sx)} ${r2(sy)}`;
            cur = [sx, sy];
          } else {
            const ea = ccw ? a0 - delta : a0 + delta;
            const ex = x + r * Math.cos(ea), ey = y + r * Math.sin(ea);
            d += `A${r2(r)} ${r2(r)} 0 ${delta > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${r2(ex)} ${r2(ey)}`;
            cur = [ex, ey];
          }
          break;
        }
        case 'Z': d += 'Z'; break;
        default: break;
      }
    }
    const a = [`d="${d}"`];
    a.push(st.fill ? `fill="${st.fill}"${st.fillAlpha !== undefined ? ` fill-opacity="${st.fillAlpha}"` : ''}` : 'fill="none"');
    if (st.stroke) {
      a.push(`stroke="${st.stroke}" stroke-width="${st.width || 1}" stroke-linecap="${st.cap || 'round'}" stroke-linejoin="round"`);
      if (st.alpha !== undefined && st.alpha !== 1) a.push(`stroke-opacity="${st.alpha}"`);
      if (st.dash && st.dash.length) a.push(`stroke-dasharray="${st.dash.join(' ')}"`);
    }
    this.out.push(`<path ${a.join(' ')}/>`);
  }
  text(x, y, str, st) {
    const anchor = st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start';
    const m = /(\d+(?:\.\d+)?)px/.exec(st.font);
    const size = m ? m[1] : 14;
    const weight = /bold|600|700/.test(st.font) ? ' font-weight="600"' : '';
    const halo = st.halo ? ` stroke="${st.halo}" stroke-width="4" paint-order="stroke" stroke-linejoin="round"` : '';
    this.out.push(`<text x="${r2(x)}" y="${r2(y)}" dominant-baseline="central" text-anchor="${anchor}" font-family="${esc(FONT_FAMILY)}" font-size="${size}"${weight} fill="${st.color}"${halo}>${esc(str)}</text>`);
  }
  measure(str, font) { this.mctx.font = font; return this.mctx.measureText(str).width; }
  toString() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n${this.out.join('\n')}\n</svg>\n`;
  }
}

// ------------------------------------------------------------------ helpers
export function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / mag;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * mag;
}
export function fmtNum(v, dec) {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e9) return v.toExponential(3);
  let s = v.toFixed(dec);
  if (/^-0\.?0*$/.test(s)) s = s.slice(1);
  return s;
}
const dashOf = (d, w) => (d === 'dash' ? [w * 4 + 3, w * 3 + 2] : d === 'dot' ? [0.1, w * 2.5 + 1.5] : []);

/** Visible part of a line value in screen coordinates (Liang–Barsky). */
export function clipLine(l, T, W, H, m = 20) {
  const [lo, hi] = lineRange(l);
  const x1 = T.sx(l.x1), y1 = T.sy(l.y1), x2 = T.sx(l.x2), y2 = T.sy(l.y2);
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return lo === hi || l.kind === 'segment' ? [x1, y1, x1, y1] : null;
  let t0 = lo, t1 = hi;
  const clipT = (p, q) => {
    if (Math.abs(p) < 1e-15) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clipT(-dx, x1 + m) || !clipT(dx, W + m - x1) || !clipT(-dy, y1 + m) || !clipT(dy, H + m - y1)) return null;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 > t1) return null;
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

export function makeTransform(view) {
  return {
    sx: (x) => view.ox + x * view.s,
    sy: (y) => view.oy - y * view.s,
    wx: (X) => (X - view.ox) / view.s,
    wy: (Y) => (view.oy - Y) / view.s,
    s: view.s,
  };
}

/** Shape commands of a value in screen coordinates (no styling). */
function shapeCmds(v, T, W, H) {
  switch (v.k) {
    case 'line': {
      const seg = clipLine(v, T, W, H);
      if (!seg) return null;
      const cmds = [['M', seg[0], seg[1]], ['L', seg[2], seg[3]]];
      return cmds;
    }
    case 'circle': {
      const r = v.r * T.s;
      const cx = T.sx(v.cx), cy = T.sy(v.cy);
      if (cx + r < -50 || cx - r > W + 50 || cy + r < -50 || cy - r > H + 50) return null;
      if (r < 0.5) return [['C', cx, cy, 0.5]];
      if (r > 2e5) return bigArcPolyline(v.cx, v.cy, v.r, 0, TAU, T, W, H);
      return [['C', cx, cy, r]];
    }
    case 'arc': {
      const r = v.r * T.s;
      if (r > 2e5) return bigArcPolyline(v.cx, v.cy, v.r, v.a0, v.s, T, W, H);
      // screen y is flipped: world ccw from a0 by s == canvas anticlockwise from -a0 to -(a0+s)
      return [['A', T.sx(v.cx), T.sy(v.cy), r, -v.a0, -(v.a0 + v.s), true]];
    }
    case 'poly': {
      if (!v.pts.length) return null;
      const cmds = v.pts.map((p, i) => [i ? 'L' : 'M', T.sx(p.x), T.sy(p.y)]);
      cmds.push(['Z']);
      return cmds;
    }
    case 'locus': {
      const cmds = [];
      for (const pa of v.paths) pa.forEach((p, i) => cmds.push([i ? 'L' : 'M', T.sx(p.x), T.sy(p.y)]));
      return cmds;
    }
    default: return null;
  }
}
function bigArcPolyline(cx, cy, r, a0, s, T, W, H) {
  // huge circles: sample the part near the screen
  const cmds = [];
  const n = 400;
  const mx = T.wx(W / 2), my = T.wy(H / 2);
  const mid = Math.atan2(my - cy, mx - cx);
  const span = Math.min(s, (Math.hypot(W, H) / T.s / r) * 2);
  let start = a0, len = s;
  if (s >= TAU - 1e-9) { start = mid - span / 2; len = span; }
  for (let i = 0; i <= n; i++) {
    const a = start + (len * i) / n;
    cmds.push([i ? 'L' : 'M', T.sx(cx + r * Math.cos(a)), T.sy(cy + r * Math.sin(a))]);
  }
  return cmds;
}

function pointCmds(x, y, ps, size) {
  switch (ps) {
    case 'cross': return { cmds: [['M', x - size, y - size], ['L', x + size, y + size], ['M', x + size, y - size], ['L', x - size, y + size]], filled: false };
    case 'square': return { cmds: [['M', x - size, y - size], ['L', x + size, y - size], ['L', x + size, y + size], ['L', x - size, y + size], ['Z']], filled: true };
    case 'circle': return { cmds: [['C', x, y, size]], filled: false };
    default: return { cmds: [['C', x, y, size]], filled: true };
  }
}

// ------------------------------------------------------------------ label texts
export function measureText(c, o, dec) {
  const v = o.value;
  const nm = (id) => (c.get(id) ? c.get(id).name : '?');
  const d = o.decimals ?? dec;
  let left;
  switch (o.type) {
    case 'dist': {
      const b = c.get(o.parents[1]);
      left = b && b.value && b.value.k === 'line' ? `d(${nm(o.parents[0])}, ${nm(o.parents[1])})` : `|${nm(o.parents[0])}${nm(o.parents[1])}|`;
      break;
    }
    case 'length': {
      const s = c.get(o.parents[0]);
      if (s && (s.type === 'segment' || s.type === 'vector')) left = `|${nm(s.parents[0])}${nm(s.parents[1])}|`;
      else if (s && s.value && s.value.k === 'poly') left = `perimeter(${s.name})`;
      else left = `length(${s ? s.name : '?'})`;
      break;
    }
    case 'angle': left = o.name; break;
    case 'area': left = `area(${nm(o.parents[0])})`; break;
    case 'slope': left = `slope(${nm(o.parents[0])})`; break;
    case 'calc': left = o.params.expr; break;
    case 'coords': {
      if (!v) return `${nm(o.parents[0])} = ?`;
      return `${o.caption || nm(o.parents[0])} = (${fmtNum(v.x, d)}, ${fmtNum(v.y, d)})`;
    }
    default: left = o.name;
  }
  if (o.caption) left = o.caption;
  if (!v) return `${left} = ?`;
  const unit = v.unit === 'deg' ? '°' : '';
  return `${left} = ${fmtNum(v.v, d)}${unit}`;
}

export function textString(o, dec) {
  const v = o.value;
  if (!v) return '';
  const d = o.decimals ?? dec;
  return v.parts.map((p) => (p.s !== undefined ? p.s : fmtNum(p.v, d))).join('');
}

// ------------------------------------------------------------------ scene
/**
 * S = { c, view, W, H, settings, sel:Set, picked:Set, cand:id, limit (replay index or Infinity),
 *       traces: Map(id -> values), preview: [values], pointBoost, forExport }
 * Returns label boxes for hit testing: [{ id, x, y, w, h, kind }]
 */
export function drawScene(B, S) {
  const { c, W, H, settings } = S;
  const T = makeTransform(S.view);
  const fs = settings.labelSize || 15;
  const font = `${fs}px ${FONT_FAMILY}`;
  const boldFont = `600 ${fs}px ${FONT_FAMILY}`;
  const dec = settings.decimals ?? 2;
  const boxes = [];

  // background
  B.path([['M', 0, 0], ['L', W, 0], ['L', W, H], ['L', 0, H], ['Z']], { fill: '#ffffff' });
  drawGrid(B, S, T, font);

  const visibleObjs = [];
  c.objects.forEach((o, i) => {
    if (i >= S.limit) return;
    if (!o.value) return;
    const hidden = o.hidden || o.condHidden;
    if (hidden && !settings.showHidden) return;
    visibleObjs.push({ o, faded: hidden, cat: catOf(c, o) });
  });

  const styleOf = (o, faded, extraW = 0) => {
    const st = o.style;
    return {
      stroke: faded ? '#9aa3ad' : st.color,
      width: (st.width || 1.5) + extraW,
      dash: faded ? [4, 4] : dashOf(st.dash, st.width || 1.5),
      alpha: faded ? 0.7 : 1,
    };
  };
  const halo = (o, cmds, cat) => {
    let color = null;
    if (S.cand === o.id) color = HL_CAND;
    else if (S.picked && S.picked.has(o.id)) color = HL_PICK;
    else if (S.sel && S.sel.has(o.id)) color = HL_SEL;
    if (!color || !cmds) return;
    B.path(cmds, { stroke: color, width: (o.style.width || 1.5) + (cat === 'point' ? 6 : 8), cap: 'round' });
  };

  // traces
  if (S.traces) {
    for (const [id, vals] of S.traces) {
      const o = c.get(id);
      if (!o) continue;
      const col = o.style.color;
      for (const v of vals) {
        if (v.k === 'pt') {
          B.path([['C', T.sx(v.x), T.sy(v.y), 1.6]], { fill: col, fillAlpha: 0.65 });
        } else {
          const cmds = shapeCmds(v, T, W, H);
          if (cmds) B.path(cmds, { stroke: col, width: 1, alpha: 0.35 });
        }
      }
    }
  }

  // areas first
  for (const { o, faded, cat } of visibleObjs) {
    if (cat !== 'poly' && !(cat === 'circle' && o.style.fill > 0) && !(cat === 'arc' && o.style.fill > 0)) continue;
    const v = o.value;
    if (v.k === 'arc' && o.style.fill > 0) {
      const cmds = [['M', T.sx(v.cx), T.sy(v.cy)], ...shapeCmds(v, T, W, H), ['Z']];
      B.path(cmds, { fill: o.style.color, fillAlpha: faded ? 0.05 : o.style.fill });
      continue;
    }
    const cmds = shapeCmds(v, T, W, H);
    if (!cmds) continue;
    if (o.style.fill > 0) B.path(cmds, { fill: faded ? '#9aa3ad' : o.style.color, fillAlpha: faded ? 0.08 : o.style.fill });
  }
  // curves
  for (const { o, faded, cat } of visibleObjs) {
    if (!['line', 'circle', 'arc', 'poly', 'locus'].includes(cat)) continue;
    const v = o.value;
    const cmds = shapeCmds(v, T, W, H);
    if (!cmds) continue;
    halo(o, cmds, cat);
    B.path(cmds, styleOf(o, faded));
    if (v.k === 'line' && v.kind === 'vector') {
      const x2 = T.sx(v.x2), y2 = T.sy(v.y2), x1 = T.sx(v.x1), y1 = T.sy(v.y1);
      const a = Math.atan2(y2 - y1, x2 - x1);
      const L = 9 + (o.style.width || 1.5) * 2;
      const st = styleOf(o, faded);
      B.path([['M', x2, y2], ['L', x2 - L * Math.cos(a - 0.38), y2 - L * Math.sin(a - 0.38)], ['L', x2 - L * Math.cos(a + 0.38), y2 - L * Math.sin(a + 0.38)], ['Z']], { fill: st.stroke, stroke: st.stroke, width: 1, alpha: st.alpha });
    }
  }
  // measurement decorations (angle arcs, perpendicular distance)
  for (const { o, faded } of visibleObjs) {
    const v = o.value;
    if (o.type === 'angle') {
      const x = T.sx(v.anchor.x), y = T.sy(v.anchor.y);
      const r = o.style.size > 4 ? 18 + o.style.size * 2 : 26;
      const right = Math.abs(v.v - 90) < 0.5 * Math.pow(10, -(o.decimals ?? dec));
      let cmds;
      if (right) {
        const q = r * 0.62;
        const ux = Math.cos(-v.a0), uy = Math.sin(-v.a0), wx = Math.cos(-(v.a0 + v.s)), wy = Math.sin(-(v.a0 + v.s));
        cmds = [['M', x + ux * q, y + uy * q], ['L', x + (ux + wx) * q, y + (uy + wy) * q], ['L', x + wx * q, y + wy * q]];
        B.path([['M', x, y], ...cmds, ['Z']], { fill: o.style.color, fillAlpha: faded ? 0.05 : o.style.fill });
        B.path([['C', x + (ux + wx) * q * 0.45, y + (uy + wy) * q * 0.45, 1.6]], { fill: o.style.color });
      } else {
        cmds = [['A', x, y, r, -v.a0, -(v.a0 + v.s), true]];
        B.path([['M', x, y], ...cmds, ['Z']], { fill: o.style.color, fillAlpha: faded ? 0.05 : o.style.fill });
      }
      halo(o, cmds, 'meas');
      B.path(cmds, { stroke: faded ? '#9aa3ad' : o.style.color, width: o.style.width || 1.5 });
    } else if (o.type === 'dist' && v.foot) {
      B.path([['M', T.sx(v.from.x), T.sy(v.from.y)], ['L', T.sx(v.foot.x), T.sy(v.foot.y)]], { stroke: o.style.color, width: 1, dash: [3, 4], alpha: 0.8 });
    }
  }
  // preview (rubber band)
  if (S.preview) {
    for (const v of S.preview) {
      if (!v) continue;
      if (v.k === 'pt') { B.path([['C', T.sx(v.x), T.sy(v.y), 4]], { fill: '#2f6fdf', fillAlpha: 0.6 }); continue; }
      if (v.k === 'meas') continue;
      const cmds = shapeCmds(v, T, W, H);
      if (!cmds) continue;
      if (v.k === 'poly') B.path(cmds, { fill: '#2f6fdf', fillAlpha: 0.08 });
      B.path(cmds, { stroke: '#2f6fdf', width: 1.75, dash: [6, 5], alpha: 0.9 });
    }
  }
  // points
  const boost = S.pointBoost || 0;
  for (const { o, faded, cat } of visibleObjs) {
    if (cat !== 'point') continue;
    const v = o.value;
    const x = T.sx(v.x), y = T.sy(v.y);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const size = (o.style.size || 4) + boost;
    const { cmds, filled } = pointCmds(x, y, o.style.ps, size);
    halo(o, [['C', x, y, size + 1]], 'point');
    const col = faded ? '#9aa3ad' : o.style.color;
    if (filled) B.path(cmds, { fill: col, stroke: faded ? '#9aa3ad' : '#1b1f24', width: 1, alpha: faded ? 0.6 : 0.9 });
    else B.path(cmds, { stroke: col, width: 2, fill: o.style.ps === 'circle' ? '#ffffff' : undefined });
  }
  // labels
  const labelColor = (o, faded) => (faded ? '#9aa3ad' : o.style.color);
  // measurement / text boxes first, object names on top (a box must not hide a point name)
  const labelOrder = [...visibleObjs.filter((x) => x.cat === 'meas' || x.cat === 'text'), ...visibleObjs.filter((x) => x.cat !== 'meas' && x.cat !== 'text')];
  for (const { o, faded, cat } of labelOrder) {
    const v = o.value;
    const off = o.label || null;
    if (cat === 'meas') {
      if (!o.showLabel && o.type !== 'calc') continue;
      const str = measureText(c, o, dec);
      const w = B.measure(str, font) + 12, h = fs + 10;
      let ax, ay;
      if (v.pinned) { ax = T.sx(o.params.x ?? 0); ay = T.sy(o.params.y ?? 0); } else {
        ax = T.sx(v.anchor.x); ay = T.sy(v.anchor.y);
        if (o.type === 'angle') {
          // along the bisector, far enough that the box does not cover the vertex (and its name)
          const mid = -(v.a0 + v.s / 2);
          const cx = Math.cos(mid), cy = Math.sin(mid);
          const d = Math.max(46, Math.abs(cx) * w / 2 + Math.abs(cy) * h / 2 + 22);
          ax += cx * d; ay += cy * d;
        } else if (o.type === 'coords') { ax += 14; ay += 18; } else if (o.type !== 'area') ay -= 16;
      }
      if (off) { ax += off.dx; ay += off.dy; }
      const bx = v.pinned ? ax : ax - w / 2;
      let by = ay - h / 2;
      if (!off && !v.pinned) {
        // automatic placement: avoid overlapping earlier measurement labels
        for (let k = 0; k < 6; k++) {
          const hit = boxes.some((b) => b.kind === 'meas' && bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y);
          if (!hit) break;
          by += h + 3;
        }
        ay = by + h / 2;
      }
      const hl = S.cand === o.id ? HL_CAND : S.picked && S.picked.has(o.id) ? HL_PICK : S.sel && S.sel.has(o.id) ? HL_SEL : null;
      roundRect(B, bx, by, w, h, 6, { fill: '#ffffff', fillAlpha: 0.88, stroke: hl || (faded ? '#c9ccd1' : 'rgba(0,0,0,0.12)'), width: hl ? 3 : 1 });
      B.text(bx + 6, ay + 0.5, str, { font, color: labelColor(o, faded), align: 'left' });
      boxes.push({ id: o.id, x: bx, y: by, w, h, kind: 'meas' });
      continue;
    }
    if (cat === 'text') {
      const str = textString(o, dec);
      if (!str) continue;
      const lines = str.split('\n');
      const x = T.sx(v.x) + (off ? off.dx : 0), y = T.sy(v.y) + (off ? off.dy : 0);
      const w = Math.max(...lines.map((l) => B.measure(l, font))) + 4;
      const lh = fs * 1.35;
      lines.forEach((l, i) => B.text(x + 2, y + lh * (i + 0.5), l, { font, color: labelColor(o, faded), align: 'left', halo: '#ffffff' }));
      const hl = S.cand === o.id ? HL_CAND : S.sel && S.sel.has(o.id) ? HL_SEL : null;
      if (hl) roundRect(B, x - 2, y - 2, w + 4, lh * lines.length + 4, 4, { stroke: hl, width: 2 });
      boxes.push({ id: o.id, x, y, w, h: lh * lines.length, kind: 'text' });
      continue;
    }
    if (!o.showLabel) continue;
    const name = o.caption || o.name;
    if (!name) continue;
    let x, y, align = 'left';
    const dx = off ? off.dx : null, dy = off ? off.dy : null;
    if (cat === 'point') {
      x = T.sx(v.x) + (dx ?? 9); y = T.sy(v.y) + (dy ?? -13);
    } else if (v.k === 'line') {
      const seg = clipLine(v, T, W, H, -30);
      if (!seg) continue;
      const mx = (seg[0] + seg[2]) / 2, my = (seg[1] + seg[3]) / 2;
      const len = Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) || 1;
      let nx = -(seg[3] - seg[1]) / len, ny = (seg[2] - seg[0]) / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      x = mx + nx * 14 + (dx ?? 0); y = my + ny * 14 + (dy ?? 0); align = 'center';
    } else if (v.k === 'circle') {
      x = T.sx(v.cx + v.r * Math.SQRT1_2) + 6 + (dx ?? 0); y = T.sy(v.cy + v.r * Math.SQRT1_2) - 8 + (dy ?? 0);
    } else if (v.k === 'arc') {
      const a = v.a0 + v.s / 2;
      x = T.sx(v.cx + v.r * Math.cos(a)) + 6 + (dx ?? 0); y = T.sy(v.cy + v.r * Math.sin(a)) - 8 + (dy ?? 0);
    } else if (v.k === 'poly') {
      const ce = centroid(v.pts);
      x = T.sx(ce.x) + (dx ?? 0); y = T.sy(ce.y) + (dy ?? 0); align = 'center';
    } else if (v.k === 'locus') {
      const p = v.paths[0][Math.floor(v.paths[0].length / 2)];
      x = T.sx(p.x) + 8 + (dx ?? 0); y = T.sy(p.y) - 10 + (dy ?? 0);
    } else continue;
    const w = B.measure(name, cat === 'point' ? boldFont : font);
    B.text(x, y, name, { font: cat === 'point' ? boldFont : font, color: faded ? '#9aa3ad' : (cat === 'point' ? '#1b1f24' : o.style.color), align, halo: 'rgba(255,255,255,0.9)' });
    const bx = align === 'center' ? x - w / 2 : x;
    boxes.push({ id: o.id, x: bx - 3, y: y - fs / 2 - 3, w: w + 6, h: fs + 6, kind: 'label' });
  }
  return boxes;
}

function roundRect(B, x, y, w, h, r, st) {
  B.path([
    ['M', x + r, y], ['L', x + w - r, y], ['A', x + w - r, y + r, r, -Math.PI / 2, 0, false],
    ['L', x + w, y + h - r], ['A', x + w - r, y + h - r, r, 0, Math.PI / 2, false],
    ['L', x + r, y + h], ['A', x + r, y + h - r, r, Math.PI / 2, Math.PI, false],
    ['L', x, y + r], ['A', x + r, y + r, r, Math.PI, Math.PI * 1.5, false], ['Z'],
  ], st);
}

function drawGrid(B, S, T, font) {
  const { W, H, settings } = S;
  if (!settings.grid && !settings.axes) return;
  const step = gridStep(S.view.s);
  const x0 = T.wx(0), x1 = T.wx(W), y0 = T.wy(H), y1 = T.wy(0);
  if (settings.grid) {
    const minor = [];
    for (let i = Math.ceil(x0 / step); i * step <= x1; i++) { const X = Math.round(T.sx(i * step)) + 0.5; minor.push(['M', X, 0], ['L', X, H]); }
    for (let j = Math.ceil(y0 / step); j * step <= y1; j++) { const Y = Math.round(T.sy(j * step)) + 0.5; minor.push(['M', 0, Y], ['L', W, Y]); }
    B.path(minor, { stroke: '#e3e7ec', width: 1, cap: 'butt' });
  }
  if (settings.axes) {
    const ax = T.sx(0), ay = T.sy(0);
    const cmds = [];
    if (ay >= 0 && ay <= H) cmds.push(['M', 0, ay], ['L', W, ay], ['M', W - 9, ay - 5], ['L', W - 1, ay], ['L', W - 9, ay + 5]);
    if (ax >= 0 && ax <= W) cmds.push(['M', ax, H], ['L', ax, 0], ['M', ax - 5, 9], ['L', ax, 1], ['L', ax + 5, 9]);
    B.path(cmds, { stroke: '#5f6772', width: 1.2 });
    const lab = Math.max(1, Math.ceil(70 / (step * S.view.s)));
    const lstep = step * lab;
    const decs = Math.max(0, -Math.floor(Math.log10(lstep) + 1e-9));
    const sfont = font.replace(/\d+px/, '12px');
    const tick = [];
    const yl = clamp(ay, 0, H - 14);
    for (let i = Math.ceil(x0 / lstep); i * lstep <= x1; i++) {
      if (i === 0) continue;
      const X = T.sx(i * lstep);
      tick.push(['M', X, yl - 4], ['L', X, yl + 4]);
      B.text(X, yl + 13, (i * lstep).toFixed(decs), { font: sfont, color: '#5f6772', align: 'center', halo: '#ffffff' });
    }
    const xl = clamp(ax, 30, W);
    for (let j = Math.ceil(y0 / lstep); j * lstep <= y1; j++) {
      if (j === 0) continue;
      const Y = T.sy(j * lstep);
      tick.push(['M', xl - 4, Y], ['L', xl + 4, Y]);
      B.text(xl - 7, Y, (j * lstep).toFixed(decs), { font: sfont, color: '#5f6772', align: 'right', halo: '#ffffff' });
    }
    B.path(tick, { stroke: '#5f6772', width: 1 });
  }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function gridStep(scale) {
  return niceStep(28 / scale);
}
