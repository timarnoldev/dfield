// 3-dim window: WebGL rendering with three.js, touch/mouse orbit camera.
import * as THREE from '../vendor/three.module.min.js';
import { P } from './parser.js';
import { niceStep, ticks, fmtTick, fmt } from './numeric.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function heightColor(t, out) {
  // blue -> cyan -> green -> yellow -> red
  t = Math.max(0, Math.min(1, t));
  const c = new THREE.Color().setHSL((1 - t) * 0.68, 0.85, 0.5);
  out[0] = c.r; out[1] = c.g; out[2] = c.b;
}

function makeTextSprite(text, color, size = 28) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `${size}px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  cv.width = w; cv.height = size + 10;
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.userData.aspect = cv.width / cv.height;
  sp.renderOrder = 10;
  return sp;
}

function disposeObject(o) {
  o.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) {
      const ms = Array.isArray(n.material) ? n.material : [n.material];
      ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

export class Plot3D {
  constructor(wrap, canvas, app) {
    this.wrap = wrap; this.canvas = canvas; this.app = app;
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      console.warn('WebGL unavailable', e);
      return;
    }
    this.ok = true;
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.headlight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);
    const top = new THREE.DirectionalLight(0xffffff, 0.5);
    top.position.set(0.3, -0.5, 1);
    this.scene.add(top);
    this.data = new THREE.Group(); // data coordinates -> normalized cube
    this.scene.add(this.data);
    this.world = new THREE.Group(); // objects in normalized coords (curves, points, axes)
    this.scene.add(this.world);
    this.decor = new THREE.Group();
    this.scene.add(this.decor);
    this.items = new Map(); // id -> { key, obj, zvals, kind }
    this.planes = [];
    this.half = [1, 1, 1];
    this.pointers = new Map();
    this.gesture = null;
    this.needs = true;
    this.marker = null;
    this.raf = 0;
    this.bind();
    this.loop = this.loop.bind(this);
  }

  get S() { return this.app.state.settings3; }
  get cam() { return this.app.state.camera3; }

  resize() {
    if (!this.ok) return;
    const r = this.wrap.getBoundingClientRect();
    this.W = Math.max(50, Math.floor(r.width));
    this.H = Math.max(50, Math.floor(r.height));
    this.renderer.setPixelRatio(Math.min(3, window.devicePixelRatio || 1));
    this.renderer.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  request() {
    this.needs = true;
    if (!this.raf && this.active) this.raf = requestAnimationFrame(this.loop);
  }
  setActive(on) {
    this.active = on;
    if (on) this.request();
  }
  loop() {
    this.raf = 0;
    if (!this.active) return;
    if (this.S.autorotate && !this.gesture) {
      this.cam.theta += 0.004;
      this.needs = true;
    }
    if (this.needs) {
      this.needs = false;
      this.draw();
    }
    if (this.S.autorotate) this.raf = requestAnimationFrame(this.loop);
  }

  updateCamera() {
    const c = this.cam;
    const t = new THREE.Vector3(...c.target);
    const cp = Math.cos(c.phi);
    const dist = this.effDist();
    const pos = new THREE.Vector3(cp * Math.cos(c.theta), cp * Math.sin(c.theta), Math.sin(c.phi)).multiplyScalar(dist).add(t);
    this.camera.position.copy(pos);
    this.camera.lookAt(t);
    this.headlight.position.copy(pos).add(new THREE.Vector3(0, 0, dist * 0.4));
    this.headlight.target.position.copy(t);
  }

  /** Camera distance, enlarged on tall (portrait) canvases so the box stays in view. */
  effDist() {
    const a = this.camera.aspect || 1;
    return this.cam.dist * Math.max(1, 1.15 / a);
  }

  draw() {
    this.updateCamera();
    this.scene.background = new THREE.Color(this.S.bg || '#ffffff');
    // keep labels a constant screen size
    const k = this.effDist() * 0.017;
    this.decor.traverse((o) => { if (o.isSprite) o.scale.set(k * o.userData.aspect * (o.userData.s || 1), k * (o.userData.s || 1), 1); });
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ scene building
  /** Coalesces rebuild requests to one per animation frame. */
  requestUpdate() {
    if (this.updRaf) return;
    this.updRaf = requestAnimationFrame(() => { this.updRaf = 0; this.update(); });
  }

  /** Rebuilds geometry. Only items whose definition or parameter values changed are recomputed. */
  update() {
    if (!this.ok) return;
    const all = this.app.items3();
    const seen = new Set();
    const box = this.S.box;
    const boxKey = JSON.stringify(box);
    for (const it of all) {
      const id = it.eq.id;
      seen.add(id);
      if (!it.eq.visible || it.c.error) { this.removeItem(id); continue; }
      const pv = [...it.c.params].sort().map((p) => `${p}=${P[p]}`).join(',');
      const key = JSON.stringify(it.eq) + pv + (it.eq.type === 'explicit' ? boxKey : '');
      const cur = this.items.get(id);
      if (cur && cur.key === key) continue;
      this.removeItem(id);
      try {
        this.items.set(id, { key, ...this.sample(it) });
      } catch (e) { console.warn('3D build failed', e); }
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id);
    this.layout();
  }

  removeItem(id) {
    const cur = this.items.get(id);
    if (!cur) return;
    if (cur.obj) { cur.obj.parent?.remove(cur.obj); disposeObject(cur.obj); }
    this.items.delete(id);
  }

  /** Evaluate the surface/curve in data coordinates. */
  sample(it) {
    const { eq, c } = it;
    if (c.kind === 'surface') {
      const n = Math.max(4, Math.min(200, Number(eq.res) || 40));
      const [u0, u1, v0, v1] = c.range();
      const N = n + 1;
      const pos = new Float32Array(N * N * 3);
      const ok = new Uint8Array(N * N);
      const zvals = [];
      for (let j = 0; j < N; j++) {
        const v = v0 + ((v1 - v0) * j) / n;
        for (let i = 0; i < N; i++) {
          const u = u0 + ((u1 - u0) * i) / n;
          const p = c.map(u, v);
          const k = j * N + i;
          if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) {
            pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
            ok[k] = 1;
            zvals.push(p[2]);
          }
        }
      }
      return { kind: 'surface', n, pos, ok, zvals, eq };
    }
    if (c.kind === 'curve') {
      const [t0, t1] = c.range();
      const n = c.steps;
      const pieces = [];
      let cur = [];
      const zvals = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        const p = c.pt(t);
        if (p.every(Number.isFinite)) { cur.push(p); zvals.push(p[2]); } else if (cur.length) { pieces.push(cur); cur = []; }
      }
      if (cur.length) pieces.push(cur);
      return { kind: 'curve', pieces, zvals, eq };
    }
    const pts = c.pts().filter((p) => p.every(Number.isFinite));
    return { kind: 'points', pts, zvals: pts.map((p) => p[2]), eq };
  }

  zRange() {
    const box = this.S.box;
    if (!this.S.zauto) return [box.zmin, box.zmax];
    let all = [];
    for (const rec of this.items.values()) {
      if (rec.kind === 'surface' && rec.eq.type === 'explicit') {
        // only z-values inside the x/y box count
        for (let k = 0; k < rec.ok.length; k++) {
          if (!rec.ok[k]) continue;
          const x = rec.pos[k * 3], y = rec.pos[k * 3 + 1];
          if (x >= box.xmin - 1e-9 && x <= box.xmax + 1e-9 && y >= box.ymin - 1e-9 && y <= box.ymax + 1e-9) all.push(rec.pos[k * 3 + 2]);
        }
      } else all = all.concat(rec.zvals);
    }
    if (!all.length) return [box.zmin, box.zmax];
    all.sort((a, b) => a - b);
    let lo = all[0], hi = all[all.length - 1];
    const q = (p) => all[Math.min(all.length - 1, Math.max(0, Math.round(p * (all.length - 1))))];
    const plo = q(0.01), phi = q(0.99);
    if (hi - lo > 8 * (phi - plo) && phi > plo) { lo = plo - (phi - plo) * 0.25; hi = phi + (phi - plo) * 0.25; }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.04;
    return [lo - pad, hi + pad];
  }

  /** Positions the data group, rebuilds meshes, axes, box and labels. */
  layout() {
    const box = this.S.box;
    const [zmin, zmax] = this.zRange();
    this.zr = [zmin, zmax];
    const rx = box.xmax - box.xmin, ry = box.ymax - box.ymin, rz = zmax - zmin;
    let hx = 1, hy = 1, hz = 1;
    if (this.S.equal) {
      const m = Math.max(rx, ry, rz);
      hx = rx / m; hy = ry / m; hz = rz / m;
    } else {
      // x-y square, z slightly flatter (like Winplot's default box)
      hz = 0.85;
    }
    this.half = [hx, hy, hz];
    const sx = (2 * hx) / rx, sy = (2 * hy) / ry, sz = (2 * hz) / rz;
    this.data.scale.set(sx, sy, sz);
    this.data.position.set(-(box.xmin + box.xmax) / 2 * sx, -(box.ymin + box.ymax) / 2 * sy, -(zmin + zmax) / 2 * sz);
    this.data.updateMatrixWorld(true);
    this.toWorld = (p) => new THREE.Vector3(p[0] * sx + this.data.position.x, p[1] * sy + this.data.position.y, p[2] * sz + this.data.position.z);
    const e = 1.0005;
    this.planes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), hx * e), new THREE.Plane(new THREE.Vector3(1, 0, 0), hx * e),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), hy * e), new THREE.Plane(new THREE.Vector3(0, 1, 0), hy * e),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), hz * e), new THREE.Plane(new THREE.Vector3(0, 0, 1), hz * e),
    ];
    for (const rec of this.items.values()) {
      if (rec.obj) { rec.obj.parent?.remove(rec.obj); disposeObject(rec.obj); rec.obj = null; }
      try {
        if (rec.kind === 'surface') rec.obj = this.buildSurface(rec);
        else if (rec.kind === 'curve') rec.obj = this.buildCurve(rec);
        else rec.obj = this.buildPoints(rec);
      } catch (err) { console.warn(err); }
      if (rec.obj) (rec.kind === 'surface' ? this.data : this.world).add(rec.obj);
    }
    this.buildDecor();
    if (this.marker) { this.world.remove(this.marker); disposeObject(this.marker); this.marker = null; }
    this.request();
  }

  buildSurface(rec) {
    const { n, pos, ok, eq } = rec;
    const N = n + 1;
    const g = new THREE.Group();
    const [zmin, zmax] = this.zr;
    if (eq.surface !== false) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const idx = [];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
          if (ok[a] && ok[b] && ok[d]) idx.push(a, b, d);
          if (ok[a] && ok[d] && ok[c]) idx.push(a, d, c);
        }
      }
      geom.setIndex(idx);
      geom.computeVertexNormals();
      const opacity = Number(eq.opacity) || 1;
      const matOpts = {
        side: THREE.DoubleSide, shininess: 35, specular: 0x222222, clippingPlanes: this.planes,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      };
      if (eq.colorMode === 'solid') {
        matOpts.color = new THREE.Color(eq.color);
      } else {
        const col = new Float32Array(N * N * 3);
        const tmp = [0, 0, 0];
        for (let k = 0; k < N * N; k++) {
          heightColor((pos[k * 3 + 2] - zmin) / (zmax - zmin), tmp);
          col[k * 3] = tmp[0]; col[k * 3 + 1] = tmp[1]; col[k * 3 + 2] = tmp[2];
        }
        geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
        matOpts.vertexColors = true;
      }
      const mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial(matOpts));
      mesh.userData.eqId = eq.id;
      mesh.renderOrder = opacity < 1 ? 2 : 0;
      g.add(mesh);
    }
    if (eq.mesh !== false || eq.surface === false) {
      const every = Math.max(1, Math.round(n / 20));
      const lp = [];
      const seg = (a, b) => { if (ok[a] && ok[b]) lp.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]); };
      for (let j = 0; j <= n; j += j + every > n && j !== n ? n - j : every) for (let i = 0; i < n; i++) seg(j * N + i, j * N + i + 1);
      for (let i = 0; i <= n; i += i + every > n && i !== n ? n - i : every) for (let j = 0; j < n; j++) seg(j * N + i, (j + 1) * N + i);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      const wireOnly = eq.surface === false;
      const lcol = wireOnly ? eq.color : (eq.colorMode === 'solid' ? '#000000' : '#1a1a1a');
      const lm = new THREE.LineBasicMaterial({ color: lcol, transparent: !wireOnly, opacity: wireOnly ? 1 : 0.35, clippingPlanes: this.planes });
      g.add(new THREE.LineSegments(lg, lm));
    }
    return g;
  }

  buildCurve(rec) {
    const { pieces, eq } = rec;
    const g = new THREE.Group();
    const radius = 0.006 + 0.004 * (eq.width || 2);
    const mat = new THREE.MeshPhongMaterial({ color: eq.color, shininess: 50, clippingPlanes: this.planes });
    for (const piece of pieces) {
      const pts = piece.map((p) => this.toWorld(p));
      if (pts.length < 2) continue;
      const path = new THREE.CurvePath();
      for (let i = 0; i + 1 < pts.length; i++) if (pts[i].distanceToSquared(pts[i + 1]) > 0) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      if (!path.curves.length) continue;
      const segs = Math.min(4000, path.curves.length * 2);
      const geom = new THREE.TubeGeometry(path, segs, radius, 8, false);
      g.add(new THREE.Mesh(geom, mat));
    }
    return g;
  }

  buildPoints(rec) {
    const { pts, eq } = rec;
    const g = new THREE.Group();
    const r = 0.018 + 0.006 * (eq.width || 2);
    const sg = new THREE.SphereGeometry(r, 16, 12);
    const mat = new THREE.MeshPhongMaterial({ color: eq.color, clippingPlanes: this.planes });
    const wp = pts.map((p) => this.toWorld(p));
    for (const p of wp) { const m = new THREE.Mesh(sg, mat); m.position.copy(p); g.add(m); }
    if (eq.line && wp.length > 1) {
      const lg = new THREE.BufferGeometry().setFromPoints(wp);
      g.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: eq.color, clippingPlanes: this.planes })));
    }
    return g;
  }

  buildDecor() {
    // the box, axes and tick labels (canvas textures) only change with the box/settings – skip the
    // rebuild during parameter animations, which call layout() every frame
    const S = this.S;
    const key = JSON.stringify([this.half, S.box, this.zr, S.showBox, S.showAxes, S.showTicks, S.bg]);
    if (key === this.decorKey && this.decor.parent) return;
    this.decorKey = key;
    this.scene.remove(this.decor);
    disposeObject(this.decor);
    this.decor = new THREE.Group();
    this.scene.add(this.decor);
    const [hx, hy, hz] = this.half;
    const box = this.S.box;
    const [zmin, zmax] = this.zr;
    const dark = new THREE.Color(this.S.bg || '#fff').getHSL({}).l < 0.45;
    const fg = dark ? '#e6e6e6' : '#222222';
    const muted = dark ? '#9aa4b0' : '#555555';
    if (this.S.showBox) {
      const geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz));
      this.decor.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: dark ? 0x8899aa : 0x777777, transparent: true, opacity: 0.6 })));
    }
    const W = (x, y, z) => this.toWorld([x, y, z]);
    if (this.S.showAxes) {
      // axes through the origin, clamped into the box
      const cx = Math.min(box.xmax, Math.max(box.xmin, 0));
      const cy = Math.min(box.ymax, Math.max(box.ymin, 0));
      const cz = Math.min(zmax, Math.max(zmin, 0));
      const axes = [
        [W(box.xmin, cy, cz), W(box.xmax, cy, cz), 'x', 0xd62728],
        [W(cx, box.ymin, cz), W(cx, box.ymax, cz), 'y', 0x2ca02c],
        [W(cx, cy, zmin), W(cx, cy, zmax), 'z', 0x1f5fd6],
      ];
      for (const [a, b, name, color] of axes) {
        const lg = new THREE.BufferGeometry().setFromPoints([a, b]);
        this.decor.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color })));
        const dir = b.clone().sub(a).normalize();
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 14), new THREE.MeshBasicMaterial({ color }));
        cone.position.copy(b);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.decor.add(cone);
        const lab = makeTextSprite(name, '#' + new THREE.Color(color).getHexString(), 40);
        lab.position.copy(b.clone().add(dir.clone().multiplyScalar(0.13)));
        lab.userData.s = 1.3;
        this.decor.add(lab);
      }
    }
    if (this.S.showTicks) {
      const addTicks = (lo, hi, at, n) => {
        const step = niceStep(hi - lo, n);
        for (const v of ticks(lo, hi, step)) {
          const sp = makeTextSprite(fmtTick(v, step), muted, 26);
          sp.position.copy(at(v));
          this.decor.add(sp);
        }
      };
      const off = 0.12;
      addTicks(box.xmin, box.xmax, (v) => W(v, box.ymin, zmin).add(new THREE.Vector3(0, -off, -off * 0.3)), 5);
      addTicks(box.ymin, box.ymax, (v) => W(box.xmax, v, zmin).add(new THREE.Vector3(off, 0, -off * 0.3)), 5);
      addTicks(zmin, zmax, (v) => W(box.xmin, box.ymin, v).add(new THREE.Vector3(-off * 0.7, -off * 0.7, 0)), 5);
    }
    void fg;
  }

  resetCamera() {
    Object.assign(this.cam, { theta: -0.9, phi: 0.45, dist: 6.2, target: [0, 0, 0] });
    this.request();
    this.app.cameraChanged();
  }

  // ------------------------------------------------------------ input
  bind() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  zoom(f) {
    this.cam.dist = Math.max(1.2, Math.min(40, this.cam.dist * f));
    this.request();
    this.app.cameraChanged();
  }
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  onDown(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { type: 'two', a0: { ...a }, b0: { ...b }, cam0: structuredClone(this.cam) };
      return;
    }
    if (this.pointers.size > 2) return;
    const pan = e.button === 2 || e.button === 1 || e.shiftKey || this.app.state.mode3 === 'pan';
    this.gesture = { type: pan ? 'pan' : 'rotate', id: e.pointerId, x0: p.x, y0: p.y, last: p, moved: false, cam0: structuredClone(this.cam) };
  }
  panBy(dxPx, dyPx, cam0) {
    const c = this.cam;
    const scale = (2 * cam0.dist * (this.effDist() / this.cam.dist) * Math.tan((this.camera.fov * Math.PI) / 360)) / this.H;
    this.updateCamera();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const t = new THREE.Vector3(...cam0.target).addScaledVector(right, -dxPx * scale).addScaledVector(up, dyPx * scale);
    const lim = 3;
    c.target = [t.x, t.y, t.z].map((v) => Math.max(-lim, Math.min(lim, v)));
  }
  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'two') {
      const [a, b] = [...this.pointers.values()];
      if (!b) return;
      const d0 = Math.hypot(g.b0.x - g.a0.x, g.b0.y - g.a0.y) || 1;
      const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ang0 = Math.atan2(g.b0.y - g.a0.y, g.b0.x - g.a0.x), ang1 = Math.atan2(b.y - a.y, b.x - a.x);
      const m0 = { x: (g.a0.x + g.b0.x) / 2, y: (g.a0.y + g.b0.y) / 2 }, m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.cam.dist = Math.max(1.2, Math.min(40, (g.cam0.dist * d0) / d1));
      let dAng = ang1 - ang0;
      if (dAng > Math.PI) dAng -= 2 * Math.PI;
      if (dAng < -Math.PI) dAng += 2 * Math.PI;
      this.cam.theta = g.cam0.theta - dAng; // two-finger twist spins around the z-axis
      this.panBy(m1.x - m0.x, m1.y - m0.y, g.cam0);
      this.request();
      return;
    }
    if (g.id !== e.pointerId) return;
    if (Math.hypot(p.x - g.x0, p.y - g.y0) > 6) g.moved = true;
    if (g.type === 'rotate') {
      const dx = p.x - g.last.x, dy = p.y - g.last.y;
      this.cam.theta -= dx * 0.008;
      this.cam.phi = Math.max(-1.55, Math.min(1.55, this.cam.phi + dy * 0.008));
    } else {
      this.panBy(p.x - g.x0, p.y - g.y0, g.cam0);
    }
    g.last = p;
    this.request();
  }
  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'two') { this.gesture = this.pointers.size ? { type: 'done' } : null; this.app.cameraChanged(); return; }
    if (g.id !== e.pointerId) { if (!this.pointers.size) this.gesture = null; return; }
    this.gesture = null;
    this.app.cameraChanged();
    if (!g.moved && e.type !== 'pointercancel') this.pickAt(g.x0, g.y0);
    if (this.S.autorotate) this.request();
  }

  /** Tap: show coordinates of the surface point under the finger. */
  pickAt(X, Y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((X / this.W) * 2 - 1, -(Y / this.H) * 2 + 1), this.camera);
    const meshes = [];
    this.data.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const hits = ray.intersectObjects(meshes, false).filter((h) => this.planes.every((pl) => pl.distanceToPoint(h.point) >= -1e-6));
    if (this.marker) { this.world.remove(this.marker); disposeObject(this.marker); this.marker = null; }
    if (!hits.length) { this.app.coords(''); this.request(); return; }
    const h = hits[0];
    const local = this.data.worldToLocal(h.point.clone());
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.marker.position.copy(h.point);
    this.world.add(this.marker);
    const text = `(x, y, z) = (${fmt(local.x, 5)}, ${fmt(local.y, 5)}, ${fmt(local.z, 5)})`;
    this.app.coords(text);
    this.app.status(text);
    this.request();
  }

  toBlob(cb) {
    this.draw();
    this.canvas.toBlob(cb, 'image/png');
  }
}
