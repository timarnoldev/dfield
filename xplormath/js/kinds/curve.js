// Space curve renderer: tube with rotation-minimizing frame, moving Frenet
// frame, osculating circle, curvature / torsion readout and colouring.
import { THREE, makeArrow, placeArrow } from '../view3d.js';
import { curveDerivs, frenet, cross, dot, norm, sub, scale, add, len, rainbow, diverging, toLinear, robustScale, fmt } from '../geom.js';

export const curveKind = {
  name: 'curve',
  view: '3d',
  displayDefaults: { thick: 0.03, color: 'curv', frenet: true, osc: false, speed: 0.6, pos: 0.1 },
  displayControls: [
    { k: 'thick', label: 'Tube radius', type: 'range', min: 0.004, max: 0.09, step: 0.001 },
    { k: 'color', label: 'Colour', type: 'select', choices: [['solid', 'Solid'], ['curv', 'Curvature κ'], ['tors', 'Torsion τ'], ['param', 'Parameter t']] },
    { k: 'frenet', label: 'Frenet frame T, N, B', type: 'check' },
    { k: 'osc', label: 'Osculating circle', type: 'check' },
    { k: 'speed', label: 'Animation speed', type: 'range', min: 0.05, max: 2, step: 0.01 },
    { k: 'pos', label: 'Frame position', type: 'range', min: 0, max: 1, step: 0.001, live: true },
  ],
  playable: true,

  mount(ctx, obj, P) {
    this.ctx = ctx; this.obj = obj;
    this.group = new THREE.Group();
    this.frame = new THREE.Group();
    this.arrows = [makeArrow(0xe5484d), makeArrow(0x3fbf5f), makeArrow(0x3b82f6)];
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 }));
    this.frame.add(...this.arrows, this.dot);
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(97 * 3), 3));
    this.oscLine = new THREE.Line(og, new THREE.LineBasicMaterial({ color: 0xff7ad9 }));
    this.oscCenter = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff7ad9 }));
    this.frame.add(this.oscLine, this.oscCenter);
    ctx.v3.add(this.group);
    ctx.v3.add(this.frame);
    this.build(P, true);
  },

  update(P, key) { this.build(P, key === '__refit'); },
  displayChanged(k) {
    if (k === 'pos' || k === 'frenet' || k === 'osc') { this.placeFrame(); return; }
    if (k === 'speed') return;
    this.build(this.P, false);
  },
  unmount() { this.ctx.v3.clear(); this.ctx.setLegend(null); },

  build(P, refit) {
    this.P = P;
    const { ctx, obj } = this;
    const D = ctx.opts;
    const f = obj.f(P);
    const tr = typeof obj.t === 'function' ? obj.t(P) : obj.t;
    if (!tr.every(Number.isFinite) || tr[0] === tr[1]) throw new Error('Invalid parameter range.');
    let closed = obj.closed;
    if (obj.detectClosed) closed = len(sub(f(tr[0]), f(tr[1]))) < 1e-6 * (1 + len(f(tr[0])));
    this.f = f; this.tr = tr; this.closed = closed;
    const n = Math.round(Math.max(200, 520 * ctx.quality * (obj.samples || 1) * (P.p ? Math.max(1, (P.p + P.q) / 5) : 1)));
    const h = (tr[1] - tr[0]) * 3e-4;
    this.h = h;
    const count = closed ? n : n + 1;
    const pts = [], tan = [], kap = [], tau = [];
    for (let i = 0; i < count; i++) {
      const t = tr[0] + (tr[1] - tr[0]) * i / n;
      const d = curveDerivs(f, t, h);
      if (![...d.p, ...d.d1].every(Number.isFinite)) throw new Error(`The curve is not defined at t = ${fmt(t)}.`);
      pts.push(d.p);
      tan.push(norm(d.d1));
      const c = cross(d.d1, d.d2), cl = len(c), s = len(d.d1);
      kap.push(cl / (s * s * s));
      tau.push(cl > 1e-9 ? dot(c, d.d3) / (cl * cl) : 0);
    }
    // bounding sphere
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    const center = scale(add(mn, mx), 0.5);
    const size = Math.max(1e-6, len(sub(mx, mn)) / 2);
    this.size = size;

    // rotation minimizing frames (double reflection)
    const t0 = tan[0];
    let r = norm(cross(t0, Math.abs(t0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const R = [r];
    const loop = closed ? count + 1 : count;
    for (let i = 0; i < loop - 1; i++) {
      const xi = pts[i], xj = pts[(i + 1) % count], ti = tan[i], tj = tan[(i + 1) % count];
      const v1 = sub(xj, xi), c1 = dot(v1, v1);
      if (c1 < 1e-30) { R.push(R[i]); continue; }
      const rL = sub(R[i], scale(v1, (2 / c1) * dot(v1, R[i])));
      const tL = sub(ti, scale(v1, (2 / c1) * dot(v1, ti)));
      const v2 = sub(tj, tL), c2 = dot(v2, v2);
      R.push(c2 < 1e-30 ? rL : sub(rL, scale(v2, (2 / c2) * dot(v2, rL))));
    }
    if (closed) {
      // distribute the holonomy angle so the tube closes seamlessly
      const rEnd = R[count], s0 = cross(tan[0], R[0]);
      const ang = Math.atan2(dot(rEnd, s0), dot(rEnd, R[0]));
      for (let i = 0; i < count; i++) {
        const a = -ang * i / count, ti = tan[i], ri = R[i], si = cross(ti, ri);
        R[i] = add(scale(ri, Math.cos(a)), scale(si, Math.sin(a)));
      }
    }

    // colours per sample
    let vals = null, colorFn = null, sc = 1;
    if (D.color === 'curv') {
      vals = kap; sc = robustScale(kap, 0.98);
      const kmin = Math.min(...kap), kmax = Math.max(...kap);
      const constant = kmax - kmin < 1e-4 * kmax;
      colorFn = constant ? () => rainbow(0.5) : (v) => rainbow(0.08 + 0.84 * Math.min(1, v / sc));
    }
    else if (D.color === 'tors') { vals = tau; sc = robustScale(tau, 0.95); colorFn = (v) => diverging(v / sc); }
    else if (D.color === 'param') { vals = pts.map((_, i) => i / count); colorFn = (v) => rainbow(0.05 + 0.9 * v); }

    // tube mesh
    const M = Math.max(8, Math.round(14 * Math.sqrt(ctx.quality)));
    const rad = D.thick * size;
    const pos = [], nor = [], col = [], idx = [];
    for (let i = 0; i < count; i++) {
      const ri = R[i], si = cross(tan[i], ri);
      const c = colorFn ? colorFn(vals[i]).map(toLinear) : null;
      for (let k = 0; k < M; k++) {
        const ph = (k / M) * Math.PI * 2;
        const nrm = add(scale(ri, Math.cos(ph)), scale(si, Math.sin(ph)));
        pos.push(...add(pts[i], scale(nrm, rad)));
        nor.push(...nrm);
        if (c) col.push(...c);
      }
    }
    const rings = closed ? count : count - 1;
    for (let i = 0; i < rings; i++) {
      const a = i * M, b = ((i + 1) % count) * M;
      for (let k = 0; k < M; k++) {
        const k1 = (k + 1) % M;
        idx.push(a + k, b + k, b + k1, a + k, b + k1, a + k1);
      }
    }
    if (!closed) {
      for (const [i, sgn] of [[0, -1], [count - 1, 1]]) {
        const c0 = pos.length / 3;
        pos.push(...pts[i]); nor.push(...scale(tan[i], sgn));
        if (colorFn) col.push(...colorFn(vals[i]).map(toLinear));
        const base = pos.length / 3;
        for (let k = 0; k < M; k++) {
          pos.push(pos[(i * M + k) * 3], pos[(i * M + k) * 3 + 1], pos[(i * M + k) * 3 + 2]);
          nor.push(...scale(tan[i], sgn));
          if (colorFn) col.push(col[(i * M + k) * 3], col[(i * M + k) * 3 + 1], col[(i * M + k) * 3 + 2]);
        }
        for (let k = 0; k < M; k++) {
          const k1 = (k + 1) % M;
          if (sgn > 0) idx.push(c0, base + k, base + k1); else idx.push(c0, base + k1, base + k);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (colorFn) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); c.material.dispose(); }
    this.group.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: colorFn ? 0xffffff : 0xe9b44c, vertexColors: !!colorFn, shininess: 70, specular: 0x333333 })));

    if (refit || !this.fitted) { ctx.v3.fit(center, size * 1.08, { home: obj.home || [0.6, -0.4] }); this.fitted = true; }

    if (colorFn && D.color !== 'param') {
      const nm = D.color === 'curv' ? 'Curvature κ' : 'Torsion τ';
      const grad = D.color === 'curv'
        ? [0.08, 0.3, 0.5, 0.7, 0.92].map((x) => `rgb(${rainbow(x).map((c) => Math.round(c * 255)).join(',')})`).join(',')
        : 'rgb(59,77,191),rgb(240,240,240),rgb(191,26,38)';
      ctx.setLegend(`${nm}<div class="bar" style="background:linear-gradient(90deg,${grad})"></div><div class="ends"><span>${D.color === 'curv' ? '0' : fmt(-sc)}</span><span>${fmt(sc)}${D.color === 'curv' ? '+' : ''}</span></div>`);
    } else ctx.setLegend(null);
    this.placeFrame();
  },

  tick(dt, playing) {
    if (!playing) return false;
    const D = this.ctx.opts;
    const span = this.tr[1] - this.tr[0];
    const t = this.tr[0] + span * D.pos;
    const sp = len(curveDerivs(this.f, t, this.h).d1) || 1;
    let np = D.pos + (D.speed * this.size * dt) / sp / span;
    if (np >= 1) np = this.closed ? np - 1 : 0;
    this.ctx.setDisplayValue('pos', np);
    this.placeFrame();
    return true;
  },

  placeFrame() {
    const D = this.ctx.opts;
    const t = this.tr[0] + (this.tr[1] - this.tr[0]) * D.pos;
    const F = frenet(this.f, t, this.h * 6);
    const L = this.size * 0.32;
    this.frame.visible = D.frenet || D.osc;
    this.arrows.forEach((a) => { a.visible = D.frenet; });
    this.dot.visible = D.frenet;
    if (D.frenet) {
      placeArrow(this.arrows[0], F.p, F.T, L);
      placeArrow(this.arrows[1], F.p, F.N, L);
      placeArrow(this.arrows[2], F.p, F.B, L);
      this.arrows.forEach((a) => a.scale.set(this.size * 0.9, L, this.size * 0.9));
      this.dot.position.set(...F.p);
      this.dot.scale.setScalar(this.size * Math.max(0.035, D.thick * 1.6));
    }
    const rho = F.kappa > 1e-9 ? 1 / F.kappa : Infinity;
    const showOsc = D.osc && rho < this.size * 30;
    this.oscLine.visible = showOsc; this.oscCenter.visible = showOsc;
    if (showOsc) {
      const c = add(F.p, scale(F.N, rho));
      const a = this.oscLine.geometry.attributes.position;
      for (let k = 0; k <= 96; k++) {
        const ph = (k / 96) * Math.PI * 2;
        const q = add(c, add(scale(F.N, -rho * Math.cos(ph)), scale(F.T, rho * Math.sin(ph))));
        a.setXYZ(k, q[0], q[1], q[2]);
      }
      a.needsUpdate = true;
      this.oscLine.geometry.computeBoundingSphere();
      this.oscCenter.position.set(...c);
      this.oscCenter.scale.setScalar(this.size * 0.02);
    }
    this.ctx.v3.dirty = true;
    const note = this.obj.note ? `<br>${this.obj.note(this.P)}` : '';
    this.ctx.setInfo(`<b>${this.obj.name}</b>${note}<br><span class="k">t</span> = ${fmt(t)}<br>`
      + `<span class="k">κ</span> = ${fmt(F.kappa)}  <span class="k">τ</span> = ${fmt(F.tau)}<br>`
      + `<span class="k">radius of curvature</span> ${Number.isFinite(rho) ? fmt(rho) : '∞'}`
      + (D.frenet ? `<br><span class="sw" style="background:#e5484d"></span>T <span class="sw" style="background:#3fbf5f;margin-left:6px"></span>N <span class="sw" style="background:#3b82f6;margin-left:6px"></span>B` : ''));
  },
};
