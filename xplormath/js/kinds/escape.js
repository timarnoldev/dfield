// Mandelbrot and Julia sets on the GPU. Deep zoom uses perturbation theory:
// one reference orbit is computed in double precision on the CPU, the shader
// iterates only the (small) difference to it in single precision, with
// rebasing (Zhuoran) to avoid glitches. Zoom depth ~ 1e13.
import { THREE } from '../view3d.js';
import { fmt } from '../geom.js';

const MAXI = 20000;
const TEXW = 1024;

const VERT = `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
precision highp int;
uniform highp sampler2D uRef;
uniform int uRefLen;
uniform int uMaxIter;
uniform vec2 uRes;
uniform float uPix;
uniform vec2 uOff;
uniform int uJulia;
uniform int uPal;
uniform float uDensity;
uniform float uPhase;
uniform int uCross;
uniform vec3 uInside;
out vec4 outColor;

vec2 refAt(int i) { return texelFetch(uRef, ivec2(i % ${TEXW}, i / ${TEXW}), 0).xy; }

vec3 grad(float t) {
  // gradient: deep blue - light blue - white - orange - black (cyclic)
  t = fract(t);
  vec3 c0 = vec3(0.0, 0.027, 0.39), c1 = vec3(0.125, 0.42, 0.80), c2 = vec3(0.93, 1.0, 1.0), c3 = vec3(1.0, 0.67, 0.0), c4 = vec3(0.0, 0.008, 0.0);
  if (t < 0.16) return mix(c0, c1, t / 0.16);
  if (t < 0.42) return mix(c1, c2, (t - 0.16) / 0.26);
  if (t < 0.6425) return mix(c2, c3, (t - 0.42) / 0.2225);
  if (t < 0.8575) return mix(c3, c4, (t - 0.6425) / 0.215);
  return mix(c4, c0, (t - 0.8575) / 0.1425);
}
vec3 palette(float t) {
  if (uPal == 0) return grad(t);
  if (uPal == 1) { float s = fract(t); return vec3(smoothstep(0.0, 0.45, s), smoothstep(0.2, 0.75, s), smoothstep(0.55, 1.0, s)) * (1.0 - 0.85 * smoothstep(0.8, 1.0, s)); }
  if (uPal == 2) return 0.5 + 0.5 * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
  if (uPal == 3) return 0.5 + 0.5 * cos(6.28318 * (vec3(0.8, 0.8, 0.5) * t + vec3(0.55, 0.6, 0.65)));
  float g = 0.5 + 0.5 * cos(6.28318 * t); return vec3(g);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 d = (frag - 0.5 * uRes) * uPix + uOff;
  vec2 dz = uJulia == 1 ? d : vec2(0.0);
  vec2 dc = uJulia == 1 ? vec2(0.0) : d;
  int m = 0;
  vec2 z = refAt(0) + dz;
  float r2 = dot(z, z);
  int it = 0;
  bool esc = r2 > 1.0e6;
  for (int k = 0; k < ${MAXI}; k++) {
    if (esc || k >= uMaxIter) break;
    vec2 Z = refAt(m);
    dz = vec2(2.0 * (Z.x * dz.x - Z.y * dz.y) + (dz.x * dz.x - dz.y * dz.y),
              2.0 * (Z.x * dz.y + Z.y * dz.x) + 2.0 * dz.x * dz.y) + dc;
    m++;
    z = refAt(m) + dz;
    r2 = dot(z, z);
    it = k + 1;
    if (r2 > 1.0e6) { esc = true; break; }
    if (r2 < dot(dz, dz) || m >= uRefLen - 1) { dz = z - refAt(0); m = 0; }
  }
  vec3 col;
  if (!esc) col = uInside;
  else {
    float mu = float(it) + 1.0 - log2(log(r2) * 0.5 / log(2.0));
    col = palette(uPhase + uDensity * 0.06 * pow(max(mu, 0.0), 0.75));
  }
  if (uCross == 1) {
    vec2 c = abs(frag - 0.5 * uRes);
    float s = uRes.y / 100.0;
    if ((c.x < 0.75 * s / 4.0 + 0.5 && c.y < s * 1.6 && c.y > s * 0.4) || (c.y < 0.75 * s / 4.0 + 0.5 && c.x < s * 1.6 && c.x > s * 0.4)) col = vec3(1.0) - col * 0.2;
  }
  outColor = vec4(col, 1.0);
}`;

const PALETTES = [['0', 'Classic'], ['1', 'Fire'], ['2', 'Rainbow'], ['3', 'Ocean'], ['4', 'Grey']];

export const escapeKind = {
  name: 'escape',
  view: 'gl',
  displayDefaults: { pal: '0', density: 1, cross: false, autoIter: true },
  displayControls: [
    { k: 'pal', label: 'Colours', type: 'select', choices: PALETTES },
    { k: 'density', label: 'Colour density', type: 'range', min: 0.2, max: 4, step: 0.01 },
    { k: 'autoIter', label: 'More iterations when zooming in', type: 'check' },
    { k: 'cross', label: 'Cross-hair at centre', type: 'check' },
  ],
  playable: true,

  mount(ctx, obj, P) {
    this.ctx = ctx; this.obj = obj;
    this.julia = obj.id === 'julia';
    if (!this.scene) {
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.refData = new Float32Array(TEXW * Math.ceil((MAXI + 2) / TEXW) * 4);
      this.tex = new THREE.DataTexture(this.refData, TEXW, Math.ceil((MAXI + 2) / TEXW), THREE.RGBAFormat, THREE.FloatType);
      this.tex.minFilter = THREE.NearestFilter; this.tex.magFilter = THREE.NearestFilter;
      this.mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
        uniforms: {
          uRef: { value: this.tex }, uRefLen: { value: 1 }, uMaxIter: { value: 200 }, uRes: { value: new THREE.Vector2(1, 1) },
          uPix: { value: 0.01 }, uOff: { value: new THREE.Vector2() }, uJulia: { value: 0 }, uPal: { value: 0 },
          uDensity: { value: 1 }, uPhase: { value: 0 }, uCross: { value: 0 }, uInside: { value: new THREE.Vector3(0.02, 0.02, 0.05) },
        },
      });
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
      this.quad.frustumCulled = false;
      this.scene.add(this.quad);
      this.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.copyMat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
        vertexShader: `in vec3 position; out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `precision highp float; uniform sampler2D uTex; in vec2 vUv; out vec4 o; void main() { o = texture(uTex, vUv); }`,
        uniforms: { uTex: { value: this.rt.texture } },
      });
      this.copyScene = new THREE.Scene();
      const cq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
      cq.frustumCulled = false;
      this.copyScene.add(cq);
    }
    this.progress = 0; this.strips = 1; this.drawKey = '';
    const home = this.homeView();
    const saved = ctx.state.escapeView?.[obj.id];
    this.vw = saved ? { ...saved } : home;
    this.lowUntil = 0;
    this.dirty = true;
    this.P = P;
    this.updateInfo();
  },

  homeView() { return this.julia ? { cx: 0, cy: 0, r: 1.6 } : { cx: -0.6, cy: 0, r: 1.25 }; },
  resetView() { this.vw = this.homeView(); this.dirty = true; this.saveView(); this.updateInfo(); },
  saveView() {
    const st = this.ctx.state;
    st.escapeView = st.escapeView || {};
    st.escapeView[this.obj.id] = { ...this.vw };
    this.ctx.save();
  },

  update(P) { this.P = P; this.dirty = true; this.updateInfo(); },
  displayChanged() { this.dirty = true; },
  unmount() {
    // flush a pending view save now: the timer must not touch the next object's info panel
    if (this.saveT) { clearTimeout(this.saveT); this.saveT = 0; this.saveView(); }
    this.lowUntil = 0;
    this.ctx.setBusy?.(false);
    this.ctx.v3.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.ctx.v3.resize(this.ctx.v3.w, this.ctx.v3.h);
    this.ctx.setInfo(null);
  },

  zoom() { return (this.julia ? 1.6 : 1.25) / this.vw.r; },
  iterations() {
    const z = Math.max(1, this.zoom());
    return Math.min(MAXI, Math.round(this.P.iter + (this.ctx.opts.autoIter ? 55 * Math.log2(z) : 0)));
  },

  // ---- gestures (CSS pixel coordinates)
  interact() { this.lowUntil = performance.now() + 220; this.dirty = true; clearTimeout(this.saveT); this.saveT = setTimeout(() => { this.saveView(); this.updateInfo(); }, 300); },
  pixelSize() { return (2 * this.vw.r) / Math.max(1, this.ctx.v3.h); },
  onDrag(dx, dy) { this.onPan(dx, dy); },
  onPan(dx, dy) {
    const s = this.pixelSize();
    this.vw.cx -= dx * s; this.vw.cy += dy * s;
    this.interact();
  },
  onPinch(f, x, y) { this.zoomAt(f, x, y); },
  onWheel(f, x, y) { this.zoomAt(f, x, y); },
  onDoubleTap(p) { this.zoomAt(2.5, p.x, p.y); },
  zoomAt(f, x, y) {
    const v3 = this.ctx.v3;
    const s = this.pixelSize();
    const wx = this.vw.cx + (x - v3.w / 2) * s, wy = this.vw.cy - (y - v3.h / 2) * s;
    const minR = 5e-13 * Math.max(1, Math.hypot(this.vw.cx, this.vw.cy));
    let r = this.vw.r / f;
    if (r < minR) { r = minR; this.ctx.toast('Double-precision limit reached (zoom ≈ 10¹²).'); }
    r = Math.min(r, 4);
    this.vw.r = r;
    const s2 = this.pixelSize();
    this.vw.cx = wx - (x - v3.w / 2) * s2;
    this.vw.cy = wy + (y - v3.h / 2) * s2;
    this.interact();
  },

  tick(dt, playing) {
    if (playing) {
      if (this.julia) {
        this.theta = ((this.theta ?? Math.atan2(this.P.cy, this.P.cx)) + dt * 0.25 * (this.ctx.opts.speed || 1)) % (Math.PI * 2);
        const rr = 0.7885;
        this.ctx.setParam('cx', +(rr * Math.cos(this.theta)).toFixed(4), true);
        this.ctx.setParam('cy', +(rr * Math.sin(this.theta)).toFixed(4), true);
      } else {
        const minR = 5e-13 * Math.max(1, Math.hypot(this.vw.cx, this.vw.cy));
        if (this.vw.r <= minR * 1.01) { this.ctx.stopPlay(); this.ctx.toast('Double-precision limit reached.'); }
        else { this.vw.r = Math.max(minR, this.vw.r * Math.exp(-dt * 0.7)); this.dirty = true; this.updateInfo(); }
      }
    } else this.theta = undefined;
    if (this.lowUntil && performance.now() > this.lowUntil) { this.lowUntil = 0; this.dirty = true; }
    return this.dirty;
  },

  /** Reference orbit: the point with the highest iteration count among a grid of samples in view. */
  computeReference(maxIter, pix) {
    const { cx, cy } = this.vw;
    const w = this.ctx.v3.w, h = this.ctx.v3.h;
    const julia = this.julia, jc = [this.P.cx, this.P.cy];
    const count = (x0, y0) => {
      let zx = julia ? x0 : 0, zy = julia ? y0 : 0;
      const ax = julia ? jc[0] : x0, ay = julia ? jc[1] : y0;
      for (let i = 0; i < maxIter; i++) {
        const t = zx * zx - zy * zy + ax;
        zy = 2 * zx * zy + ay; zx = t;
        if (zx * zx + zy * zy > 1e6) return i;
      }
      return maxIter;
    };
    let best = [cx, cy], bestN = count(cx, cy);
    if (bestN < maxIter) {
      const G = 9;
      const sx = (w * pix) / 2, sy = (h * pix) / 2;
      for (let i = 0; i < G && bestN < maxIter; i++) for (let j = 0; j < G; j++) {
        const x = cx + sx * (2 * (i + 0.5) / G - 1) * 0.95, y = cy + sy * (2 * (j + 0.5) / G - 1) * 0.95;
        const n = count(x, y);
        if (n > bestN) { bestN = n; best = [x, y]; if (n >= maxIter) break; }
      }
    }
    // orbit
    const d = this.refData;
    let zx = julia ? best[0] : 0, zy = julia ? best[1] : 0;
    const ax = julia ? jc[0] : best[0], ay = julia ? jc[1] : best[1];
    let len = 0;
    for (let i = 0; i <= maxIter + 1; i++) {
      d[i * 4] = zx; d[i * 4 + 1] = zy;
      len = i + 1;
      if (zx * zx + zy * zy > 1e12) break;
      const t = zx * zx - zy * zy + ax;
      zy = 2 * zx * zy + ay; zx = t;
    }
    this.tex.needsUpdate = true;
    return { ref: best, len };
  },

  render() {
    const v3 = this.ctx.v3;
    const r = v3.renderer;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (r.getPixelRatio() !== dpr) { r.setPixelRatio(dpr); r.setSize(v3.w, v3.h, false); }
    const interacting = this.lowUntil && performance.now() < this.lowUntil;
    const fullIter = this.iterations();
    // interactive preview: coarse resolution, capped iterations, single pass
    const scale = interacting ? Math.min(1, 0.45 / dpr * 1.6) : 1;
    const W = Math.max(1, Math.round(v3.w * dpr * scale)), H = Math.max(1, Math.round(v3.h * dpr * scale));
    const maxIter = interacting ? Math.min(fullIter, 1200) : fullIter;
    const pix = (2 * this.vw.r) / H;
    const light = this.ctx.bg === 'light';
    const key = `${this.vw.cx},${this.vw.cy},${this.vw.r},${maxIter},${this.P.cx},${this.P.cy},${W},${H},${this.ctx.opts.pal},${this.ctx.opts.density},${this.ctx.opts.cross},${light}`;
    if (key !== this.drawKey) {
      this.drawKey = key;
      const refKey = `${this.vw.cx},${this.vw.cy},${this.vw.r},${maxIter},${this.P.cx},${this.P.cy},${W},${H}`;
      if (refKey !== this.refKey) {
        const { ref, len } = this.computeReference(maxIter, pix);
        this.refKey = refKey; this.ref = ref; this.refLen = len;
      }
      if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
      const u = this.mat.uniforms;
      u.uRefLen.value = this.refLen;
      u.uMaxIter.value = maxIter;
      u.uRes.value.set(W, H);
      u.uPix.value = pix;
      u.uOff.value.set(this.vw.cx - this.ref[0], this.vw.cy - this.ref[1]);
      u.uJulia.value = this.julia ? 1 : 0;
      u.uPal.value = Number(this.ctx.opts.pal);
      u.uDensity.value = this.ctx.opts.density;
      u.uCross.value = this.ctx.opts.cross ? 1 : 0;
      u.uInside.value.set(light ? 0.08 : 0.0, light ? 0.1 : 0.0, light ? 0.16 : 0.02);
      // split expensive frames into horizontal strips (keeps each GPU submission short)
      const cost = W * H * maxIter * 0.3;
      this.strips = interacting ? 1 : Math.max(1, Math.min(64, Math.ceil(cost / 1.2e8)));
      this.progress = 0;
    }
    if (this.progress < this.strips) {
      const y0 = Math.floor((this.progress * H) / this.strips), y1 = Math.floor(((this.progress + 1) * H) / this.strips);
      this.rt.scissor.set(0, y0, W, y1 - y0);
      this.rt.scissorTest = this.strips > 1;
      r.setRenderTarget(this.rt);
      r.render(this.scene, this.camera);
      r.setRenderTarget(null);
      this.progress++;
    }
    r.render(this.copyScene, this.camera);
    this.dirty = this.progress < this.strips || !!interacting;
    this.ctx.setBusy?.(this.progress < this.strips && this.strips > 2);
  },

  snapshot() {
    this.lowUntil = 0;
    do { this.render(); } while (this.progress < this.strips);
    this.ctx.v3.renderer.render(this.copyScene, this.camera);
    return this.ctx.v3.canvas.toDataURL('image/png');
  },

  updateInfo() {
    if (!this.P) return;
    const z = this.zoom();
    const digits = Math.max(4, Math.ceil(Math.log10(Math.max(1, z))) + 4);
    const c = this.julia ? `<br><span class="k">c</span> = ${fmt(this.P.cx, 4)} ${this.P.cy < 0 ? '−' : '+'} ${fmt(Math.abs(this.P.cy), 4)}i` : '';
    this.ctx.setInfo(`<b>${this.obj.name}</b>${c}<br><span class="k">centre</span> ${this.vw.cx.toFixed(Math.min(16, digits))}<br>`
      + `<span style="padding-left:52px"></span>${this.vw.cy >= 0 ? '+' : '−'}${Math.abs(this.vw.cy).toFixed(Math.min(16, digits))}i<br>`
      + `<span class="k">zoom</span> ${z < 1e5 ? z.toFixed(z < 10 ? 2 : 0) : z.toExponential(2)}×  <span class="k">iterations</span> ${this.iterations()}`);
  },
};
