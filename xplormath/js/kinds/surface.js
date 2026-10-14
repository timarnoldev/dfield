// Parametric surface renderer: shaded two-sided mesh, parameter lines,
// colouring by u, v, Gaussian or mean curvature, clean clipping.
import { THREE } from '../view3d.js';
import { surfaceNormal, surfaceGeometry, rainbow, diverging, toLinear, robustScale, fmt, len } from '../geom.js';

const FRONT = 0xe9b44c, BACK = 0x4f8fd8;

export const surfaceKind = {
  name: 'surface',
  view: '3d',
  displayDefaults: { style: 'both', color: 'two', lines: 24 },
  displayControls: [
    { k: 'style', label: 'Style', type: 'select', choices: [['both', 'Shaded + parameter lines'], ['shaded', 'Shaded'], ['lines', 'Parameter lines only']] },
    { k: 'color', label: 'Colour', type: 'select', choices: [['two', 'Two-sided (front/back)'], ['u', 'By u'], ['v', 'By v'], ['gauss', 'Gaussian curvature K'], ['mean', 'Mean curvature H']] },
    { k: 'lines', label: 'Parameter lines', type: 'range', min: 6, max: 60, step: 1 },
  ],

  mount(ctx, obj, P) {
    this.ctx = ctx;
    this.obj = obj;
    this.group = new THREE.Group();
    ctx.v3.add(this.group);
    this.build(P, true);
  },

  update(P, key) {
    this.build(P, key === '__refit');
  },

  displayChanged() { this.build(this.P, false); },

  unmount() { this.ctx.v3.clear(); this.ctx.setLegend(null); },

  build(P, refit) {
    this.P = P;
    const { ctx, obj } = this;
    const D = ctx.opts;
    const X = obj.f(P);
    const ur = typeof obj.u === 'function' ? obj.u(P) : obj.u;
    const vr = typeof obj.v === 'function' ? obj.v(P) : obj.v;
    if (!ur.every(Number.isFinite) || !vr.every(Number.isFinite) || ur[1] === ur[0] || vr[1] === vr[0]) throw new Error('Invalid parameter range.');
    const q = ctx.quality * (obj.quality || 1);
    const nu = Math.max(8, Math.round(64 * obj.res[0] * q));
    const nv = Math.max(8, Math.round(64 * obj.res[1] * q));
    const hu = (ur[1] - ur[0]) * 1e-4, hv = (vr[1] - vr[0]) * 1e-4;
    const clipSpec = obj.clip ? obj.clip(P) : null;
    const needCurv = D.color === 'gauss' || D.color === 'mean';

    const N = (nu + 1) * (nv + 1);
    const pos = new Float64Array(N * 3), nor = new Float32Array(N * 3), val = new Float64Array(N);
    const ok = new Uint8Array(N);
    let Kmin = Infinity, Kmax = -Infinity, Hmin = Infinity, Hmax = -Infinity;
    for (let j = 0; j <= nv; j++) {
      const v = vr[0] + (vr[1] - vr[0]) * j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = ur[0] + (ur[1] - ur[0]) * i / nu;
        const id = j * (nu + 1) + i;
        let p;
        try { p = X(u, v); } catch { p = [NaN, NaN, NaN]; }
        pos[id * 3] = p[0]; pos[id * 3 + 1] = p[1]; pos[id * 3 + 2] = p[2];
        if (!(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))) continue;
        ok[id] = 1;
        let n;
        if (needCurv) {
          const g = surfaceGeometry(X, u, v, hu, hv, p);
          n = g.degenerate ? null : g.n;
          const c = D.color === 'gauss' ? g.K : g.H;
          val[id] = g.degenerate ? NaN : c;
          if (!g.degenerate && Number.isFinite(g.K) && Number.isFinite(g.H)) {
            Kmin = Math.min(Kmin, g.K); Kmax = Math.max(Kmax, g.K);
            Hmin = Math.min(Hmin, g.H); Hmax = Math.max(Hmax, g.H);
          }
        } else {
          n = surfaceNormal(X, u, v, hu, hv);
          val[id] = D.color === 'u' ? i / nu : j / nv;
        }
        if (n && Number.isFinite(n[0])) { nor[id * 3] = n[0]; nor[id * 3 + 1] = n[1]; nor[id * 3 + 2] = n[2]; } else nor[id * 3] = NaN;
      }
    }
    if (!ok.some((x) => x)) throw new Error('The surface is not defined anywhere in the parameter range.');
    // fix degenerate normals (poles, centres of polar grids) from neighbours
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const id = j * (nu + 1) + i;
        if (!ok[id] || !Number.isNaN(nor[id * 3])) continue;
        let sx = 0, sy = 0, sz = 0;
        for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a > nu || b > nv) continue;
          const k = b * (nu + 1) + a;
          if (!ok[k] || Number.isNaN(nor[k * 3])) continue;
          sx += nor[k * 3]; sy += nor[k * 3 + 1]; sz += nor[k * 3 + 2];
        }
        const l = Math.hypot(sx, sy, sz);
        if (l > 0) { nor[id * 3] = sx / l; nor[id * 3 + 1] = sy / l; nor[id * 3 + 2] = sz / l; }
      }
    }
    for (let id = 0; id < N; id++) if (Number.isNaN(nor[id * 3])) { nor[id * 3] = 0; nor[id * 3 + 1] = 0; nor[id * 3 + 2] = 1; }

    // colours
    let col = null, scaleVal = 1;
    if (D.color !== 'two') {
      col = new Float32Array(N * 3);
      if (needCurv) {
        scaleVal = robustScale(val, 0.97);
        const finite = [...val].filter(Number.isFinite);
        const mn = Math.min(...finite), mx = Math.max(...finite);
        if (mx - mn < 1e-6 * Math.max(1, Math.abs(mx))) scaleVal = Math.max(Math.abs(mx), 1e-9);
      }
      for (let id = 0; id < N; id++) {
        const c = needCurv ? diverging(Number.isFinite(val[id]) ? val[id] / scaleVal : 0) : rainbow(0.05 + 0.9 * val[id]);
        col[id * 3] = toLinear(c[0]); col[id * 3 + 1] = toLinear(c[1]); col[id * 3 + 2] = toLinear(c[2]);
      }
    }

    // clip values
    const sval = new Float64Array(N);
    for (let id = 0; id < N; id++) {
      if (!ok[id]) { sval[id] = -1; continue; }
      const x = pos[id * 3], y = pos[id * 3 + 1], z = pos[id * 3 + 2];
      if (clipSpec && clipSpec.radius) sval[id] = clipSpec.radius - Math.hypot(x, y, z);
      else if (clipSpec && clipSpec.z) sval[id] = clipSpec.z - Math.abs(z);
      else sval[id] = 1;
    }

    // triangles with clipping
    const P3 = [], N3 = [], C3 = [], idx = [];
    const remap = new Int32Array(N).fill(-1);
    const vert = (id) => {
      if (remap[id] >= 0) return remap[id];
      remap[id] = P3.length / 3;
      P3.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
      N3.push(nor[id * 3], nor[id * 3 + 1], nor[id * 3 + 2]);
      if (col) C3.push(col[id * 3], col[id * 3 + 1], col[id * 3 + 2]);
      return remap[id];
    };
    const interp = (a, b) => {
      const t = sval[a] / (sval[a] - sval[b]);
      const L = (arr, k) => arr[a * 3 + k] + (arr[b * 3 + k] - arr[a * 3 + k]) * t;
      const k0 = P3.length / 3;
      P3.push(L(pos, 0), L(pos, 1), L(pos, 2));
      let nx = L(nor, 0), ny = L(nor, 1), nz = L(nor, 2);
      const l = Math.hypot(nx, ny, nz) || 1;
      N3.push(nx / l, ny / l, nz / l);
      if (col) C3.push(L(col, 0), L(col, 1), L(col, 2));
      return k0;
    };
    const tri = (a, b, c) => {
      if (!ok[a] || !ok[b] || !ok[c]) return;
      const s = [sval[a], sval[b], sval[c]];
      if (s[0] >= 0 && s[1] >= 0 && s[2] >= 0) { idx.push(vert(a), vert(b), vert(c)); return; }
      if (s[0] < 0 && s[1] < 0 && s[2] < 0) return;
      // Sutherland–Hodgman on the triangle
      const ids = [a, b, c];
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const p = ids[k], qd = ids[(k + 1) % 3];
        if (sval[p] >= 0) poly.push(vert(p));
        if ((sval[p] >= 0) !== (sval[qd] >= 0)) poly.push(interp(p, qd));
      }
      for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
    };
    // skip cells whose diagonal jumps (e.g. Scherk branch cuts)
    const jumpTol = this.jumpTolerance(pos, ok, nu, nv);
    const far = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]) > jumpTol;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (far(a, d) || far(b, c)) continue;
      tri(a, b, d); tri(a, d, c);
    }

    // parameter lines
    const L3 = [];
    const nl = D.lines;
    const ku = Math.max(1, Math.round(nu / nl)), kv = Math.max(1, Math.round(nv / nl * (obj.res[1] / obj.res[0])));
    const seg = (a, b) => {
      if (!ok[a] || !ok[b] || far(a, b)) return;
      const sa = sval[a], sb = sval[b];
      if (sa < 0 && sb < 0) return;
      const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
      if (sa < 0 || sb < 0) {
        const t = sa / (sa - sb);
        const pm = [0, 1, 2].map((k) => pa[k] + (pb[k] - pa[k]) * t);
        if (sa < 0) pa.splice(0, 3, ...pm); else pb.splice(0, 3, ...pm);
      }
      L3.push(...pa, ...pb);
    };
    for (let i = 0; i <= nu; i += ku) for (let j = 0; j < nv; j++) seg(j * (nu + 1) + i, (j + 1) * (nu + 1) + i);
    if (nu % ku) for (let j = 0; j < nv; j++) seg(j * (nu + 1) + nu, (j + 1) * (nu + 1) + nu);
    for (let j = 0; j <= nv; j += kv) for (let i = 0; i < nu; i++) seg(j * (nu + 1) + i, j * (nu + 1) + i + 1);
    if (nv % kv) for (let i = 0; i < nu; i++) seg(nv * (nu + 1) + i, nv * (nu + 1) + i + 1);

    // tiles (translated copies)
    const tiles = obj.tiles ? obj.tiles(P) : [[0, 0, 0]];
    const geo = new THREE.BufferGeometry();
    const nvtx = P3.length / 3;
    const posT = new Float32Array(P3.length * tiles.length), norT = new Float32Array(N3.length * tiles.length);
    const colT = col ? new Float32Array(C3.length * tiles.length) : null;
    const idxT = new Uint32Array(idx.length * tiles.length);
    tiles.forEach((o, t) => {
      for (let k = 0; k < nvtx; k++) {
        posT[(t * nvtx + k) * 3] = P3[k * 3] + o[0];
        posT[(t * nvtx + k) * 3 + 1] = P3[k * 3 + 1] + o[1];
        posT[(t * nvtx + k) * 3 + 2] = P3[k * 3 + 2] + o[2];
      }
      norT.set(N3, t * N3.length);
      if (colT) colT.set(C3, t * C3.length);
      for (let k = 0; k < idx.length; k++) idxT[t * idx.length + k] = idx[k] + t * nvtx;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(posT, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(norT, 3));
    if (colT) geo.setAttribute('color', new THREE.BufferAttribute(colT, 3));
    geo.setIndex(new THREE.BufferAttribute(idxT, 1));
    geo.computeBoundingSphere();

    const linePos = new Float32Array(L3.length * tiles.length);
    tiles.forEach((o, t) => { for (let k = 0; k < L3.length; k++) linePos[t * L3.length + k] = L3[k] + o[k % 3]; });
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));

    // scene objects
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); c.material?.dispose(); }
    const dark = ctx.bg === 'dark';
    if (D.style !== 'lines') {
      const common = { shininess: 45, specular: 0x2a2a2a, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
      if (col) {
        this.group.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ ...common, vertexColors: true, side: THREE.DoubleSide })));
      } else {
        this.group.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ ...common, color: FRONT, side: THREE.FrontSide })));
        this.group.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ ...common, color: BACK, side: THREE.BackSide })));
      }
      if (D.style === 'both') {
        this.group.add(new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: 0x1a1f26, transparent: true, opacity: 0.45 })));
      }
    } else {
      this.group.add(new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: dark ? 0xe9b44c : 0x2d3a4a })));
    }

    if (refit || !this.fitted) {
      const bs = geo.boundingSphere;
      if (bs && Number.isFinite(bs.radius) && bs.radius > 0) {
        ctx.v3.fit([bs.center.x, bs.center.y, bs.center.z], bs.radius, { home: obj.home || [0.5, -0.55] });
        this.fitted = true;
      }
    }
    ctx.v3.dirty = true;

    // info + legend
    const lines = [`<b>${obj.name}</b>`, `<span class="k">grid</span> ${nu}×${nv}${tiles.length > 1 ? ` × ${tiles.length} copies` : ''}`];
    if (needCurv && Number.isFinite(Kmin)) {
      lines.push(`<span class="k">K ∈</span> [${fmt(Kmin)}, ${fmt(Kmax)}]`);
      lines.push(`<span class="k">H ∈</span> [${fmt(Hmin)}, ${fmt(Hmax)}]`);
    }
    if (D.color === 'two') lines.push(`<span class="sw" style="background:#e9b44c"></span>front <span class="sw" style="background:#4f8fd8;margin-left:8px"></span>back`);
    ctx.setInfo(lines.join('<br>'));
    if (needCurv) {
      const nm = D.color === 'gauss' ? 'Gaussian curvature K' : 'Mean curvature H';
      ctx.setLegend(`${nm}<div class="bar" style="background:linear-gradient(90deg,rgb(59,77,191),rgb(240,240,240),rgb(191,26,38))"></div><div class="ends"><span>${fmt(-scaleVal)}</span><span>0</span><span>${fmt(scaleVal)}</span></div>`);
    } else if (D.color === 'u' || D.color === 'v') {
      ctx.setLegend(`${D.color} from ${fmt(D.color === 'u' ? ur[0] : vr[0], 2)} to ${fmt(D.color === 'u' ? ur[1] : vr[1], 2)}<div class="bar" style="background:linear-gradient(90deg,${[0.05, 0.27, 0.5, 0.72, 0.95].map((x) => `rgb(${rainbow(x).map((c) => Math.round(c * 255)).join(',')})`).join(',')})"></div>`);
    } else ctx.setLegend(null);
  },

  /** Distance above which neighbouring grid points are considered disconnected. */
  jumpTolerance(pos, ok, nu, nv) {
    let maxR = 0;
    const N = (nu + 1) * (nv + 1);
    for (let id = 0; id < N; id += 7) if (ok[id]) maxR = Math.max(maxR, len([pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]]));
    return this.obj.seamV ? maxR * 0.5 : Infinity;
  },
};
