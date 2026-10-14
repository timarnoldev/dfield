// Plane curve renderer (2D canvas): curve, moving point with tangent, normal
// and osculating circle, evolute, involute, rolling-circle constructions.
import { planeFrame, fmt } from '../geom.js';

const COL = { curve: '#e9b44c', osc: '#ff7ad9', evolute: '#4fb8ff', involute: '#7ddc6a', roll: '#c7d2de', pen: '#ff5a5a', tan: '#e5484d', nor: '#3fbf5f' };

export const planeKind = {
  name: 'plane',
  view: '2d',
  displayDefaults: { osc: true, frame: true, evolute: false, involute: false, roll: true, grid: true, speed: 0.5, pos: 0.12 },
  displayControls: [
    { k: 'roll', label: 'Rolling circle construction', type: 'check', when: (o) => !!o.roll },
    { k: 'osc', label: 'Osculating circle', type: 'check' },
    { k: 'frame', label: 'Tangent and normal', type: 'check' },
    { k: 'evolute', label: 'Evolute', type: 'check' },
    { k: 'involute', label: 'Involute (unwinding string)', type: 'check' },
    { k: 'grid', label: 'Grid and axes', type: 'check' },
    { k: 'speed', label: 'Animation speed', type: 'range', min: 0.05, max: 2, step: 0.01 },
    { k: 'pos', label: 'Point position', type: 'range', min: 0, max: 1, step: 0.0005, live: true },
  ],
  playable: true,

  mount(ctx, obj, P) {
    this.ctx = ctx; this.obj = obj;
    ctx.v2.drawFn = (c, v, colors) => this.draw(c, v, colors);
    this.build(P, true);
  },
  update(P, key) { this.build(P, key === '__refit'); },
  displayChanged() { this.ctx.v2.grid = this.ctx.opts.grid; this.ctx.v2.dirty = true; this.updateInfo(); },
  unmount() { this.ctx.v2.drawFn = null; },

  build(P, refit) {
    this.P = P;
    const { obj, ctx } = this;
    const f = obj.f(P);
    const tr = typeof obj.t === 'function' ? obj.t(P) : obj.t;
    if (!tr.every(Number.isFinite) || tr[0] === tr[1]) throw new Error('Invalid parameter range.');
    this.f = f; this.tr = tr;
    const n = Math.round(Math.min(40000, Math.max(1500, 2500 * ctx.quality * Math.max(1, Math.abs(tr[1] - tr[0]) / (2 * Math.PI) / 2))));
    const pts = new Float64Array((n + 1) * 2);
    const ev = new Float64Array((n + 1) * 2);
    const arc = new Float64Array(n + 1);
    const h = (tr[1] - tr[0]) * 2e-5;
    this.h = h;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i <= n; i++) {
      const t = tr[0] + (tr[1] - tr[0]) * i / n;
      const p = f(t);
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error(`The curve is not defined at t = ${fmt(t)}.`);
      pts[i * 2] = p[0]; pts[i * 2 + 1] = p[1];
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      if (i > 0) arc[i] = arc[i - 1] + Math.hypot(p[0] - pts[i * 2 - 2], p[1] - pts[i * 2 - 1]);
    }
    const size = Math.max(x1 - x0, y1 - y0, 1e-6);
    this.size = size;
    for (let i = 0; i <= n; i++) {
      const t = tr[0] + (tr[1] - tr[0]) * i / n;
      const F = planeFrame(f, t, h);
      const r = 1 / F.k;
      if (Number.isFinite(r) && Math.abs(r) < size * 20) { ev[i * 2] = F.p[0] + F.N[0] * r; ev[i * 2 + 1] = F.p[1] + F.N[1] * r; }
      else { ev[i * 2] = NaN; ev[i * 2 + 1] = NaN; }
    }
    this.pts = pts; this.ev = ev; this.arc = arc; this.n = n;
    let b = [x0, x1, y0, y1];
    const roll = this.rollInfo();
    if (roll && ctx.opts.roll) {
      if (roll.type === 'epi') { const e = roll.R + 2 * roll.r + 0.05; b = [Math.min(x0, -e), Math.max(x1, e), Math.min(y0, -e), Math.max(y1, e)]; }
      if (roll.type === 'hypo') { const e = Math.max(roll.R, Math.abs(roll.R - roll.r) + roll.r); b = [Math.min(x0, -e), Math.max(x1, e), Math.min(y0, -e), Math.max(y1, e)]; }
      if (roll.type === 'line') b = [x0, x1, Math.min(0, y0), Math.max(y1, 2 * roll.r)];
    }
    if (obj.base === 'circle') b = [Math.min(b[0], -P.a), Math.max(b[1], P.a), Math.min(b[2], -P.a), Math.max(b[3], P.a)];
    if (refit || !this.fitted) { ctx.v2.fit(b); this.fitted = true; }
    ctx.v2.grid = ctx.opts.grid;
    ctx.v2.dirty = true;
    this.updateInfo();
  },

  rollInfo() {
    const o = this.obj;
    if (!o.roll) return null;
    const p = o.rollParams ? o.rollParams(this.P) : this.P;
    return { type: o.roll.type, R: p.R, r: p.r, d: p.d };
  },

  tick(dt, playing) {
    if (!playing) return false;
    const D = this.ctx.opts;
    const total = this.arc[this.n] || 1;
    const rollMode = this.obj.roll && D.roll;
    // rolling constructions move uniformly in t (the wheel turns uniformly), others by arc length
    let np;
    if (rollMode) np = D.pos + dt * D.speed * 0.12 * (2 * Math.PI) / Math.abs(this.tr[1] - this.tr[0]) * 2;
    else np = D.pos + (D.speed * this.size * 0.5 * dt) / total;
    if (np > 1) np -= 1;
    this.ctx.setDisplayValue('pos', np);
    this.ctx.v2.dirty = true;
    this.updateInfo();
    return true;
  },

  current() {
    const t = this.tr[0] + (this.tr[1] - this.tr[0]) * this.ctx.opts.pos;
    const F = planeFrame(this.f, t, this.h);
    const i = Math.min(this.n, Math.round(this.ctx.opts.pos * this.n));
    return { t, F, s: this.arc[i], i };
  },

  updateInfo() {
    const { t, F, s } = this.current();
    const r = 1 / F.k;
    const roll = this.rollInfo();
    let extra = '';
    if (roll && roll.type !== 'line') extra = `<br><span class="k">R : r</span> = ${fmt(roll.R / roll.r, 3)}`;
    this.ctx.setInfo(`<b>${this.obj.name}</b><br><span class="k">t</span> = ${fmt(t)}  <span class="k">s</span> = ${fmt(s)}<br>`
      + `<span class="k">κ</span> = ${fmt(F.k)}  <span class="k">radius</span> = ${Number.isFinite(r) && Math.abs(r) < 1e6 ? fmt(Math.abs(r)) : '∞'}`
      + `<br><span class="k">total length</span> ≈ ${fmt(this.arc[this.n])}${extra}`);
  },

  draw(ctx, v, colors) {
    const D = this.ctx.opts;
    const { pts, n } = this;
    const S = (x, y) => v.toScreen(x, y);
    const path = (arr, from, to, breakNaN) => {
      ctx.beginPath();
      let pen = false;
      let prev = null;
      for (let i = from; i <= to; i++) {
        const x = arr[i * 2], y = arr[i * 2 + 1];
        if (!Number.isFinite(x)) { pen = false; continue; }
        const [sx, sy] = S(x, y);
        if (breakNaN && prev && Math.hypot(sx - prev[0], sy - prev[1]) > 0.25 * Math.max(v.w, v.h)) pen = false;
        if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        pen = true; prev = [sx, sy];
      }
      ctx.stroke();
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const cur = this.current();
    const roll = this.obj.roll && D.roll ? this.rollInfo() : null;

    // evolute
    if (D.evolute) { ctx.strokeStyle = COL.evolute; ctx.lineWidth = 1.6; path(this.ev, 0, n, true); }

    // curve (traced part brighter when rolling)
    if (roll) {
      ctx.strokeStyle = colors.bg === '#10151b' ? 'rgba(233,180,76,.25)' : 'rgba(180,130,30,.25)';
      ctx.lineWidth = 2; path(pts, 0, n);
      ctx.strokeStyle = COL.curve; ctx.lineWidth = 2.6; path(pts, 0, cur.i);
    } else {
      ctx.strokeStyle = COL.curve; ctx.lineWidth = 2.6; path(pts, 0, n);
    }

    if (this.obj.base === 'circle') {
      const [cx, cy] = S(0, 0);
      ctx.strokeStyle = COL.roll; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, this.P.a * v.scale, 0, Math.PI * 2); ctx.stroke();
    }

    // involute from the start point
    if (D.involute) {
      const inv = new Float64Array((n + 1) * 2);
      for (let i = 0; i <= n; i++) {
        const t = this.tr[0] + (this.tr[1] - this.tr[0]) * i / n;
        const F = planeFrame(this.f, t, this.h);
        inv[i * 2] = F.p[0] - this.arc[i] * F.T[0];
        inv[i * 2 + 1] = F.p[1] - this.arc[i] * F.T[1];
      }
      ctx.strokeStyle = COL.involute; ctx.lineWidth = 1.8;
      path(inv, 0, cur.i);
      ctx.globalAlpha = 0.3; path(inv, cur.i, n); ctx.globalAlpha = 1;
      // the string
      const F = cur.F, ix = inv[cur.i * 2], iy = inv[cur.i * 2 + 1];
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(...S(F.p[0], F.p[1])); ctx.lineTo(...S(ix, iy)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.involute;
      ctx.beginPath(); ctx.arc(...S(ix, iy), 4.5, 0, Math.PI * 2); ctx.fill();
    }

    if (roll) this.drawRoll(ctx, v, roll, cur.t);

    const { F } = cur;
    const [px, py] = S(F.p[0], F.p[1]);
    if (D.osc && Math.abs(F.k) > 1e-9) {
      const r = 1 / F.k;
      const cxw = F.p[0] + F.N[0] * r, cyw = F.p[1] + F.N[1] * r;
      if (Math.abs(r) * v.scale < 1e6) {
        const [cx, cy] = S(cxw, cyw);
        ctx.strokeStyle = COL.osc; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(cx, cy, Math.abs(r) * v.scale, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COL.osc; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (D.frame) {
      const L = 70;
      const arrow = (dx, dy, color) => {
        const ex = px + dx * L, ey = py - dy * L;
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
        const a = Math.atan2(ey - py, ex - px);
        ctx.beginPath(); ctx.moveTo(ex + 3 * Math.cos(a), ey + 3 * Math.sin(a));
        ctx.lineTo(ex - 11 * Math.cos(a - 0.4), ey - 11 * Math.sin(a - 0.4));
        ctx.lineTo(ex - 11 * Math.cos(a + 0.4), ey - 11 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
      };
      arrow(F.T[0], F.T[1], COL.tan);
      arrow(F.N[0], F.N[1], COL.nor);
    }
    ctx.fillStyle = colors.fg;
    ctx.strokeStyle = colors.bg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  },

  drawRoll(ctx, v, R, t) {
    const S = (x, y) => v.toScreen(x, y);
    ctx.strokeStyle = COL.roll; ctx.lineWidth = 1.6;
    let cx, cy, ang;
    if (R.type === 'line') {
      ctx.beginPath(); ctx.moveTo(0, S(0, 0)[1]); ctx.lineTo(v.w, S(0, 0)[1]); ctx.stroke();
      cx = R.r * t; cy = R.r; ang = -t; // wheel turns clockwise
      ang = -t - Math.PI / 2;
    } else {
      const [ox, oy] = S(0, 0);
      ctx.beginPath(); ctx.arc(ox, oy, R.R * v.scale, 0, Math.PI * 2); ctx.stroke();
      const k = R.type === 'epi' ? R.R + R.r : R.R - R.r;
      cx = k * Math.cos(t); cy = k * Math.sin(t);
      ang = R.type === 'epi' ? ((R.R + R.r) / R.r) * t + Math.PI : -((R.R - R.r) / R.r) * t;
    }
    const [scx, scy] = S(cx, cy);
    ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(scx, scy, R.r * v.scale, 0, Math.PI * 2); ctx.stroke();
    // spokes to show rotation
    ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
    for (let s = 0; s < 4; s++) {
      const a = ang + s * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(scx, scy);
      ctx.lineTo(...S(cx + R.r * Math.cos(a), cy + R.r * Math.sin(a))); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const pen = this.f(t);
    const [qx, qy] = S(pen[0], pen[1]);
    ctx.strokeStyle = COL.pen; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(scx, scy); ctx.lineTo(qx, qy); ctx.stroke();
    ctx.fillStyle = '#8fd3ff'; ctx.beginPath(); ctx.arc(scx, scy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.pen; ctx.beginPath(); ctx.arc(qx, qy, 5, 0, Math.PI * 2); ctx.fill();
  },
};
