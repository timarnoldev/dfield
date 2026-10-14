// three.js viewer: renderer, camera, lights, free trackball-style rotation of
// the object (one finger), pinch zoom, two-finger pan, inertia, auto-rotate.
import * as THREE from '../vendor/three.module.min.js';

export { THREE };

const BG = { dark: 0x10151b, light: 0xf7f8fa };

export class View3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    this.root = new THREE.Group();     // user rotation + pan
    this.zup = new THREE.Group();      // math z-up -> three y-up
    this.zup.rotation.x = -Math.PI / 2;
    this.center = new THREE.Group();   // centres the object
    this.content = new THREE.Group();
    this.scene.add(this.root);
    this.root.add(this.zup);
    this.zup.add(this.center);
    this.center.add(this.content);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(-3, 5, 6);
    const fill = new THREE.DirectionalLight(0xffffff, 0.75);
    fill.position.set(5, -2, 3);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0, 3, -6);
    this.scene.add(key, fill, rim);

    this.axes = this.makeAxes();
    this.axes.visible = false;
    this.zup.add(this.axes);

    this.dist = 8;
    this.fitDist = 8;
    this.radius = 2;
    this.autoRotate = false;
    this.spin = null;  // inertia { axis, speed }
    this.dirty = true;
    this.homeQ = new THREE.Quaternion();
    this.setHome(0.5, -0.55);
    this.root.quaternion.copy(this.homeQ);
    this.setBackground('dark');
  }

  makeAxes() {
    const g = new THREE.Group();
    const cols = [0xe0524a, 0x4cb45a, 0x4a7fe0];
    for (let i = 0; i < 3; i++) {
      const dir = [0, 0, 0]; dir[i] = 1;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(...dir)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: cols[i] }));
      g.add(line);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 12), new THREE.MeshBasicMaterial({ color: cols[i] }));
      cone.position.set(...dir);
      if (i === 0) cone.rotation.z = -Math.PI / 2;
      if (i === 2) cone.rotation.x = Math.PI / 2;
      g.add(cone);
    }
    return g;
  }

  setHome(tilt, azimuth) {
    const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azimuth);
    const qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
    this.homeQ.copy(qt).multiply(qa);
  }

  setBackground(mode) {
    this.bgMode = mode;
    this.scene.background = new THREE.Color(BG[mode] ?? BG.dark);
    this.dirty = true;
  }

  setAxesVisible(v) { this.axes.visible = v; this.dirty = true; }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.updateCamera();
    this.dirty = true;
  }

  clear() {
    for (const c of [...this.content.children]) {
      this.content.remove(c);
      disposeTree(c);
    }
    this.dirty = true;
  }

  add(obj) { this.content.add(obj); this.dirty = true; }

  /** Fit a bounding sphere (math coordinates). */
  fit(center, radius, { resetRotation = true, home } = {}) {
    this.center.position.set(-center[0], -center[1], -center[2]);
    this.radius = Math.max(1e-3, radius);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect || 1;
    const half = Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspect));
    this.fitDist = (this.radius / Math.sin(half)) * 1.12;
    this.dist = this.fitDist;
    this.root.position.set(0, 0, 0);
    this.axes.scale.setScalar(this.radius * 1.15);
    this.axes.position.set(0, 0, 0);
    if (home) this.setHome(home[0], home[1]);
    if (resetRotation) { this.root.quaternion.copy(this.homeQ); this.spin = null; }
    this.updateCamera();
    this.dirty = true;
  }

  updateCamera() {
    this.camera.position.set(0, 0, this.dist);
    this.camera.near = Math.max(this.dist / 500, this.dist - this.radius * 6) * 0.2;
    this.camera.far = this.dist + this.radius * 20;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  rotateBy(dx, dy) {
    const s = Math.min(this.w, this.h) || 600;
    const angle = Math.hypot(dx, dy) / s * Math.PI * 1.2;
    if (angle === 0) return;
    const axis = new THREE.Vector3(dy, dx, 0).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    this.root.quaternion.premultiply(q);
    this.dirty = true;
  }

  // ---- gesture handlers
  onStart() { this.spin = null; }
  onDrag(dx, dy) { this.rotateBy(dx, dy); }
  onEnd(vx, vy) {
    const v = Math.hypot(vx, vy);
    if (v > 0.15) this.spin = { vx, vy }; // px per ms
  }
  onPan(dx, dy) {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const perPx = (2 * this.dist * Math.tan(fov / 2)) / (this.h || 1);
    this.root.position.x += dx * perPx;
    this.root.position.y -= dy * perPx;
    this.dirty = true;
  }
  onPinch(scale, cx, cy) { this.zoomAt(scale, cx, cy); }
  onWheel(f, x, y) { this.zoomAt(f, x, y); }
  zoomAt(f, x, y) {
    const old = this.dist;
    this.dist = Math.min(this.fitDist * 8, Math.max(this.fitDist * 0.08, this.dist / f));
    // keep the point under the fingers fixed (approximately, in the focal plane)
    const k = 1 - this.dist / old;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const perPx = (2 * old * Math.tan(fov / 2)) / (this.h || 1);
    const px = (x - this.w / 2) * perPx, py = -(y - this.h / 2) * perPx;
    this.root.position.x += (px - this.root.position.x) * k;
    this.root.position.y += (py - this.root.position.y) * k;
    this.updateCamera();
    this.dirty = true;
  }

  /** Advance auto-rotation / inertia. Returns true if something moves. */
  tick(dt) {
    let moving = false;
    if (this.spin) {
      this.rotateBy(this.spin.vx * dt * 1000, this.spin.vy * dt * 1000);
      const decay = Math.exp(-dt * 2.2);
      this.spin.vx *= decay; this.spin.vy *= decay;
      if (Math.hypot(this.spin.vx, this.spin.vy) < 0.01) this.spin = null;
      moving = true;
    }
    if (this.autoRotate) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.45);
      this.root.quaternion.premultiply(q);
      this.dirty = true;
      moving = true;
    }
    return moving;
  }

  render(force = false) {
    if (!this.dirty && !force) return;
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }
}

export function disposeTree(o) {
  o.traverse((c) => {
    if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose();
    if (c.material) {
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of ms) if (!m.userData.shared) m.dispose();
    }
  });
}

/** Arrow pointing along +Y with unit length; scale.y sets length. */
export function makeArrow(color, radius = 0.025) {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 60 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.8, 12), mat);
  shaft.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, 0.2, 16), mat);
  head.position.y = 0.9;
  g.add(shaft, head);
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
/** Place an arrow from p along unit dir d with length L. */
export function placeArrow(arrow, p, d, L) {
  arrow.position.set(p[0], p[1], p[2]);
  arrow.quaternion.setFromUnitVectors(_up, new THREE.Vector3(d[0], d[1], d[2]).normalize());
  arrow.scale.set(L, L, L);
}
