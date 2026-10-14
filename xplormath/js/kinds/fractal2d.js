// Self-similar fractals drawn on the 2D canvas: Sierpinski triangle and carpet,
// Koch snowflake, Lévy C curve, Heighway dragon, Hilbert curve, Pythagoras tree,
// Barnsley fern (IFS chaos game).
import { rainbow, fmt } from '../geom.js';

const SQ3 = Math.sqrt(3);

function lsystemTurtle(depth, axiom, rules, angleDeg, step = 1) {
  let s = axiom;
  for (let i = 0; i < depth; i++) s = s.replace(/[A-Z]/g, (c) => rules[c] ?? c);
  const pts = [0, 0];
  let x = 0, y = 0, a = 0;
  const da = (angleDeg * Math.PI) / 180;
  for (const c of s) {
    if (c === 'F' || c === 'G') { x += step * Math.cos(a); y += step * Math.sin(a); pts.push(x, y); }
    else if (c === '+') a += da;
    else if (c === '-') a -= da;
  }
  return new Float64Array(pts);
}

function dragonPoints(depth) {
  // paper folding sequence
  const n = 1 << depth;
  const pts = new Float64Array((n + 1) * 2);
  let x = 0, y = 0, dir = 0;
  const dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
  pts[0] = 0; pts[1] = 0;
  for (let i = 1; i <= n; i++) {
    x += dx[dir]; y += dy[dir];
    pts[i * 2] = x; pts[i * 2 + 1] = y;
    if (i === n) break;
    // turn at step i: bit above the lowest set bit
    const k = i & -i;
    const right = (i & (k << 1)) !== 0;
    dir = (dir + (right ? 3 : 1)) & 3;
  }
  return pts;
}

function hilbertPoints(order) {
  const n = 1 << order, N = n * n;
  const pts = new Float64Array(N * 2);
  for (let d = 0; d < N; d++) {
    let rx, ry, t = d, x = 0, y = 0;
    for (let s = 1; s < n; s *= 2) {
      rx = 1 & (t >> 1); ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
      x += s * rx; y += s * ry; t >>= 2;
    }
    pts[d * 2] = (x + 0.5) / n; pts[d * 2 + 1] = (y + 0.5) / n;
  }
  return pts;
}

function fern(N) {
  const pts = new Float32Array(N * 2);
  let x = 0, y = 0;
  for (let i = 0; i < N; i++) {
    const r = Math.random();
    let nx, ny;
    if (r < 0.01) { nx = 0; ny = 0.16 * y; }
    else if (r < 0.86) { nx = 0.85 * x + 0.04 * y; ny = -0.04 * x + 0.85 * y + 1.6; }
    else if (r < 0.93) { nx = 0.2 * x - 0.26 * y; ny = 0.23 * x + 0.22 * y + 1.6; }
    else { nx = -0.15 * x + 0.28 * y; ny = 0.26 * x + 0.24 * y + 0.44; }
    x = nx; y = ny;
    pts[i * 2] = x; pts[i * 2 + 1] = y;
  }
  return pts;
}

const BUILDERS = {
  sierpinski: {
    bounds: () => [0, 1, 0, SQ3 / 2],
    info: (P) => `${Math.pow(3, P.depth).toLocaleString()} triangles<br><span class="k">dimension</span> log 3 / log 2 ≈ 1.585`,
    draw(ctx, v, P, c) {
      ctx.fillStyle = '#e9b44c';
      const rec = (ax, ay, bx, by, cx, cy, d) => {
        if (d === 0) {
          const A = v.toScreen(ax, ay), B = v.toScreen(bx, by), C = v.toScreen(cx, cy);
          if (Math.max(A[0], B[0], C[0]) < 0 || Math.min(A[0], B[0], C[0]) > v.w || Math.max(A[1], B[1], C[1]) < 0 || Math.min(A[1], B[1], C[1]) > v.h) return;
          ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.closePath();
          return;
        }
        // cull invisible sub-triangles
        const A = v.toScreen(ax, ay), B = v.toScreen(bx, by), C = v.toScreen(cx, cy);
        if (Math.max(A[0], B[0], C[0]) < 0 || Math.min(A[0], B[0], C[0]) > v.w || Math.max(A[1], B[1], C[1]) < 0 || Math.min(A[1], B[1], C[1]) > v.h) return;
        if (Math.abs(B[0] - A[0]) < 1.2) { rec(ax, ay, bx, by, cx, cy, 0); return; }
        const abx = (ax + bx) / 2, aby = (ay + by) / 2, bcx = (bx + cx) / 2, bcy = (by + cy) / 2, cax = (cx + ax) / 2, cay = (cy + ay) / 2;
        rec(ax, ay, abx, aby, cax, cay, d - 1);
        rec(abx, aby, bx, by, bcx, bcy, d - 1);
        rec(cax, cay, bcx, bcy, cx, cy, d - 1);
      };
      ctx.beginPath();
      rec(0, 0, 1, 0, 0.5, SQ3 / 2, P.depth);
      ctx.fill();
    },
  },
  carpet: {
    bounds: () => [0, 1, 0, 1],
    info: (P) => `${Math.pow(8, P.depth).toLocaleString()} squares<br><span class="k">dimension</span> log 8 / log 3 ≈ 1.893`,
    draw(ctx, v, P, c) {
      const [x0, y1] = v.toScreen(0, 1), [x1, y0] = v.toScreen(1, 0);
      ctx.fillStyle = '#4fa3e0';
      ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
      ctx.fillStyle = c.bg;
      const rec = (x, y, s, d) => {
        if (d === 0) return;
        const A = v.toScreen(x, y + s), B = v.toScreen(x + s, y);
        if (B[0] < 0 || A[0] > v.w || B[1] < 0 || A[1] > v.h) return;
        if (B[0] - A[0] < 1.5) return;
        const t = s / 3;
        const H = v.toScreen(x + t, y + 2 * t), K = v.toScreen(x + 2 * t, y + t);
        ctx.fillRect(H[0], H[1], K[0] - H[0], K[1] - H[1]);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) rec(x + i * t, y + j * t, t, d - 1);
      };
      rec(0, 0, 1, P.depth);
    },
  },
  koch: {
    bounds: () => [-0.05, 1.05, -0.35, 0.95],
    prepare(P) {
      const pts = lsystemTurtle(P.depth, 'F--F--F', { F: 'F+F--F+F' }, 60, Math.pow(1 / 3, P.depth));
      for (let i = 1; i < pts.length; i += 2) pts[i] = -pts[i]; // put the base triangle above the x-axis
      return pts;
    },
    info: (P) => `${(3 * Math.pow(4, P.depth)).toLocaleString()} segments, length ${fmt(3 * Math.pow(4 / 3, P.depth))}<br><span class="k">dimension</span> log 4 / log 3 ≈ 1.262`,
    draw(ctx, v, P, c, pts) {
      ctx.beginPath(); polyline(ctx, v, pts); ctx.closePath();
      ctx.fillStyle = 'rgba(79,163,224,.35)'; ctx.fill();
      ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 1.5; ctx.stroke();
    },
  },
  levy: {
    prepare(P) {
      const pts = lsystemTurtle(P.depth, 'F', { F: '+F--F+' }, 45, Math.pow(1 / Math.SQRT2, P.depth));
      return pts;
    },
    bounds: () => [-0.55, 1.55, -0.3, 1.1],
    info: (P) => `${Math.pow(2, P.depth).toLocaleString()} segments<br><span class="k">boundary dimension</span> ≈ 1.934`,
    draw(ctx, v, P, c, pts) { gradientPolyline(ctx, v, pts); },
  },
  dragon: {
    prepare(P) {
      const pts = dragonPoints(P.depth);
      const s = Math.pow(1 / Math.SQRT2, P.depth);
      // rotate so that the endpoints are (0,0) and (1,0): end point of unrotated curve
      const n = pts.length / 2 - 1, ex = pts[n * 2], ey = pts[n * 2 + 1];
      const a = -Math.atan2(ey, ex), ca = Math.cos(a) * s, sa = Math.sin(a) * s;
      for (let i = 0; i < pts.length; i += 2) { const x = pts[i], y = pts[i + 1]; pts[i] = ca * x - sa * y; pts[i + 1] = sa * x + ca * y; }
      return pts;
    },
    bounds: () => [-0.4, 1.25, -0.75, 0.45],
    info: (P) => `${Math.pow(2, P.depth).toLocaleString()} segments (folds)<br><span class="k">boundary dimension</span> ≈ 1.524`,
    draw(ctx, v, P, c, pts) { gradientPolyline(ctx, v, pts); },
  },
  hilbert: {
    prepare: (P) => hilbertPoints(P.depth),
    bounds: () => [0, 1, 0, 1],
    info: (P) => `${Math.pow(4, P.depth).toLocaleString()} points<br>the limit curve fills the square (dimension 2)`,
    draw(ctx, v, P, c, pts) { gradientPolyline(ctx, v, pts); },
  },
  pythagoras: {
    bounds: (P) => [-3.2, 4.2, -0.2, 4.4],
    info: (P) => `${(Math.pow(2, P.depth + 1) - 1).toLocaleString()} squares`,
    draw(ctx, v, P) {
      const a = P.angle * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const sq = (px, py, ux, uy, d, depth) => {
        // square with base from p in direction u (length |u|)
        const vx = -uy, vy = ux;
        const A = v.toScreen(px, py), B = v.toScreen(px + ux, py + uy), C = v.toScreen(px + ux + vx, py + uy + vy), D = v.toScreen(px + vx, py + vy);
        const col = rainbow(0.15 + 0.75 * (1 - d / Math.max(1, depth)));
        ctx.fillStyle = `rgb(${col.map((x) => Math.round(x * 255)).join(',')})`;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill();
        if (d === 0 || Math.hypot(B[0] - A[0], B[1] - A[1]) < 1) return;
        // left child: u rotated by the angle a and scaled by cos a
        const lx = (ux * ca - uy * sa) * ca, ly = (ux * sa + uy * ca) * ca;
        const qx = px + vx, qy = py + vy;
        sq(qx, qy, lx, ly, d - 1, depth);
        // right child: from the apex of the right triangle to the top-right corner
        const apx = qx + lx, apy = qy + ly;
        const r2x = px + ux + vx - apx, r2y = py + uy + vy - apy;
        sq(apx, apy, r2x, r2y, d - 1, depth);
      };
      sq(0, 0, 1, 0, P.depth, P.depth);
    },
  },
  fern: {
    prepare: (P) => fern(Math.round(Math.pow(10, P.logn))),
    bounds: () => [-2.9, 2.9, -0.2, 10.2],
    info: (P) => `${Math.round(Math.pow(10, P.logn)).toLocaleString()} points of the chaos game<br>4 affine maps, probabilities 1%, 85%, 7%, 7%`,
    draw(ctx, v, P, c, pts) {
      const W = Math.round(v.w * v.dpr), H = Math.round(v.h * v.dpr);
      // reuse the (large) pixel buffers while panning / zooming
      if (!this.img || this.img.width !== W || this.img.height !== H) { this.img = new ImageData(W, H); this.cnt = new Uint16Array(W * H); }
      const img = this.img, cnt = this.cnt;
      img.data.fill(0); cnt.fill(0);
      let max = 1;
      for (let i = 0; i < pts.length; i += 2) {
        const [sx, sy] = v.toScreen(pts[i], pts[i + 1]);
        const x = Math.floor(sx * v.dpr), y = Math.floor(sy * v.dpr);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = y * W + x;
        if (cnt[k] < 65535) cnt[k]++;
        if (cnt[k] > max) max = cnt[k];
      }
      const lm = Math.log(1 + Math.min(max, 60));
      const d = img.data;
      const light = c.bg !== '#10151b';
      for (let k = 0; k < cnt.length; k++) {
        if (!cnt[k]) continue;
        const t = Math.min(1, Math.log(1 + cnt[k]) / lm);
        const r = light ? 30 + 30 * (1 - t) : 40 + 60 * t, g = light ? 120 + 40 * (1 - t) : 150 + 105 * t, b = light ? 40 : 60 + 40 * t;
        d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
      }
      if (!this.off) this.off = document.createElement('canvas');
      if (this.off.width !== W || this.off.height !== H) { this.off.width = W; this.off.height = H; }
      this.off.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(this.off, 0, 0, v.w, v.h);
    },
  },
};

function polyline(ctx, v, pts) {
  for (let i = 0; i < pts.length; i += 2) {
    const [x, y] = v.toScreen(pts[i], pts[i + 1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}
function gradientPolyline(ctx, v, pts) {
  const n = pts.length / 2;
  const chunks = Math.min(48, Math.max(1, n - 1));
  ctx.lineWidth = n > 5000 ? 1.2 : 2;
  ctx.lineJoin = 'round';
  for (let c = 0; c < chunks; c++) {
    const a = Math.floor(c * (n - 1) / chunks), b = Math.floor((c + 1) * (n - 1) / chunks);
    const col = rainbow(0.05 + 0.9 * c / chunks);
    ctx.strokeStyle = `rgb(${col.map((x) => Math.round(x * 255)).join(',')})`;
    ctx.beginPath();
    polyline(ctx, v, pts.subarray(a * 2, b * 2 + 2));
    ctx.stroke();
  }
}

export const fractal2dKind = {
  name: 'fractal2d',
  view: '2d',
  displayDefaults: { grid: false },
  displayControls: [{ k: 'grid', label: 'Grid and axes', type: 'check' }],
  playable: true,

  mount(ctx, obj, P) {
    this.ctx = ctx; this.obj = obj;
    this.B = BUILDERS[obj.builder];
    ctx.v2.drawFn = (c, v, colors) => this.B.draw(c, v, this.P, colors, this.data);
    this.build(P, true);
  },
  update(P, key) { this.build(P, key === '__refit'); },
  displayChanged() { this.ctx.v2.grid = this.ctx.opts.grid; this.ctx.v2.dirty = true; },
  unmount() {
    this.ctx.v2.drawFn = null;
    // free the fern's full-screen pixel buffers (iOS limits total canvas memory)
    const F = BUILDERS.fern;
    F.img = null; F.cnt = null;
    if (F.off) { F.off.width = 0; F.off.height = 0; F.off = null; }
  },
  build(P, refit) {
    this.P = P;
    this.data = this.B.prepare ? this.B.prepare(P) : null;
    this.ctx.v2.grid = this.ctx.opts.grid;
    if (refit || !this.fitted) {
      let b = this.B.bounds(P);
      const d = this.B.prepare && this.obj.builder !== 'fern' ? this.B.prepare({ ...P, depth: Math.min(10, this.obj.params[0].max) }) : null;
      if (d && d.length > 2) {
        b = [Infinity, -Infinity, Infinity, -Infinity];
        for (let i = 0; i < d.length; i += 2) { b[0] = Math.min(b[0], d[i]); b[1] = Math.max(b[1], d[i]); b[2] = Math.min(b[2], d[i + 1]); b[3] = Math.max(b[3], d[i + 1]); }
        const m = 0.04 * Math.max(b[1] - b[0], b[3] - b[2]);
        b = [b[0] - m, b[1] + m, b[2] - m, b[3] + m];
      }
      this.ctx.v2.fit(b);
      this.fitted = true;
    }
    this.ctx.v2.dirty = true;
    this.ctx.setInfo(`<b>${this.obj.name}</b><br>${this.B.info(P)}`);
  },
  // play: step the depth up and down
  tick(dt, playing) {
    if (!playing) return false;
    const p = this.obj.params.find((q) => q.k === this.obj.morph);
    this.acc = (this.acc || 0) + dt;
    const period = p.int ? 0.9 : 0.04;
    if (this.acc < period) return false;
    this.acc = 0;
    let val = this.P[p.k] + (this.dir || 1) * p.step * (p.int ? 1 : 2);
    if (val > p.max) { this.dir = -1; val = p.max - p.step; }
    if (val < p.min) { this.dir = 1; val = p.min + p.step; }
    this.ctx.setParam(p.k, val);
    return true;
  },
};
