// Chaotic ODEs in 3D (Lorenz, Rössler, ...): RK4 integration of several
// nearby trajectories, animated growing trails, fixed points.
import { THREE } from '../view3d.js';
import { fmt, toLinear } from '../geom.js';

const TRAJ_COLORS = ['#f0b429', '#4fb8ff', '#ff6b8b', '#7ddc6a'];
const RINGS = 30000;   // ring buffer per trajectory (iPad GPU memory); keeps >= 20000 after a wrap
const DROP = 10000;
const SIDES = 6;

function rk4(f, P, y, h) {
  // unrolled for 3 components (called ~20 000 times per restart)
  const h2 = h / 2;
  const k1 = f(y, P);
  const k2 = f([y[0] + h2 * k1[0], y[1] + h2 * k1[1], y[2] + h2 * k1[2]], P);
  const k3 = f([y[0] + h2 * k2[0], y[1] + h2 * k2[1], y[2] + h2 * k2[2]], P);
  const k4 = f([y[0] + h * k3[0], y[1] + h * k3[1], y[2] + h * k3[2]], P);
  const h6 = h / 6;
  return [y[0] + h6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    y[1] + h6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    y[2] + h6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])];
}

export const odeKind = {
  name: 'ode',
  view: '3d',
  displayDefaults: { ntraj: 2, speed: 1, trail: 0, fixed: true, eps: -5 },
  displayControls: [
    { k: 'ntraj', label: 'Trajectories', type: 'range', min: 1, max: 4, step: 1 },
    { k: 'eps', label: 'Initial separation 10^', type: 'range', min: -9, max: -1, step: 1 },
    { k: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.05 },
    { k: 'trail', label: 'Trail length (0 = all)', type: 'range', min: 0, max: 20000, step: 500 },
    { k: 'fixed', label: 'Equilibrium points', type: 'check' },
  ],
  playable: true,
  autoPlay: true,

  mount(ctx, obj, P) {
    this.ctx = ctx; this.obj = obj;
    this.group = new THREE.Group();
    this.tubes = [];      // reused between restarts (big dynamic buffers)
    this.index = null;
    ctx.v3.add(this.group);
    this.restart(P, true);
  },
  resetView() { if (this.center) this.ctx.v3.fit(this.center, this.radius * 1.05, { home: this.obj.home || [0.25, -0.6] }); },
  update(P, key) {
    this.restart(P, key === '__refit');
  },
  displayChanged(k) {
    if (k === 'speed') return;
    if (k === 'trail') { this.applyTrail(); return; }
    this.restart(this.P, false);
  },
  unmount() { this.ctx.v3.clear(); this.tubes = []; this.index = null; this.traj = []; },

  restart(P, refit) {
    this.P = P;
    const { obj, ctx } = this;
    const D = ctx.opts;
    // keep the tube meshes (large buffers) of the trajectories that remain; drop everything else
    while (this.tubes.length > D.ntraj) { const t = this.tubes.pop(); this.group.remove(t.mesh); t.geo.dispose(); t.mesh.material.dispose(); }
    const keep = new Set(this.tubes.map((t) => t.mesh));
    for (const c of [...this.group.children]) { if (keep.has(c)) continue; this.group.remove(c); c.geometry?.dispose(); c.material?.dispose(); }
    // pre-integrate to find the attractor's extent
    let y = obj.y0.slice();
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    let blown = false;
    for (let i = 0; i < 12000; i++) {
      y = rk4(obj.f, P, y, obj.h);
      if (!y.every(Number.isFinite) || Math.abs(y[0]) + Math.abs(y[1]) + Math.abs(y[2]) > 1e5) { blown = true; break; }
      if (i > 2000) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], y[k]); mx[k] = Math.max(mx[k], y[k]); }
    }
    if (!Number.isFinite(mn[0])) { mn = [-1, -1, -1]; mx = [1, 1, 1]; }
    const center = mn.map((v, k) => (v + mx[k]) / 2);
    const radius = Math.max(0.5, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    this.radius = radius;
    this.center = center;
    if (refit || !this.fitted) { ctx.v3.fit(center, radius * 1.05, { home: obj.home || [0.25, -0.6] }); this.fitted = true; }

    this.traj = [];
    const eps = Math.pow(10, D.eps);
    // skip the initial transient so that the animation starts on the attractor
    let ys = obj.y0.slice();
    for (let i = 0; i < (obj.transient || 0); i++) {
      const yn = rk4(obj.f, P, ys, obj.h);
      if (!yn.every(Number.isFinite) || Math.abs(yn[0]) + Math.abs(yn[1]) + Math.abs(yn[2]) > 1e5) break;
      ys = yn;
    }
    for (let j = 0; j < D.ntraj; j++) {
      const y0 = ys.slice();
      y0[0] += j * eps;
      let t = this.tubes[j];
      if (!t) { t = this.makeTube(TRAJ_COLORS[j], radius * 0.0045); this.tubes[j] = t; this.group.add(t.mesh); }
      t.r = radius * 0.0045; t.n = 0; t.dirtyFrom = 0; t.nrm = null;
      t.y = y0; t.step = 0;
      const head = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.022, 16, 12), new THREE.MeshPhongMaterial({ color: TRAJ_COLORS[j], emissive: TRAJ_COLORS[j], emissiveIntensity: 0.35 }));
      t.head = head;
      this.group.add(head);
      this.addRing(t, y0);
      this.traj.push(t);
    }
    if (D.fixed && obj.fixed) {
      const fp = obj.fixed(P);
      for (const p of fp.filter((q) => Math.hypot(q[0] - center[0], q[1] - center[1], q[2] - center[2]) < 1.3 * radius)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.016, 12, 8), new THREE.MeshBasicMaterial({ color: ctx.bg === 'dark' ? 0xffffff : 0x1b1f24 }));
        m.position.set(...p);
        this.group.add(m);
      }
    }
    this.time = 0;
    this.blown = blown;
    this.advance(obj.prerun || 0);
    this.updateInfo();
    ctx.v3.dirty = true;
  },

  makeTube(color, r) {
    const pos = new Float32Array(RINGS * SIDES * 3), nor = new Float32Array(RINGS * SIDES * 3);
    if (!this.index) {
      const idx = new Uint32Array((RINGS - 1) * SIDES * 6);
      let k = 0;
      for (let i = 0; i < RINGS - 1; i++) for (let s = 0; s < SIDES; s++) {
        const a = i * SIDES + s, b = i * SIDES + ((s + 1) % SIDES), c = a + SIDES, d = b + SIDES;
        idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
      this.index = new THREE.BufferAttribute(idx, 1);
    }
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3), na = new THREE.BufferAttribute(nor, 3);
    pa.setUsage(THREE.DynamicDrawUsage); na.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('normal', na);
    geo.setIndex(this.index);
    geo.userData.sharedIndex = true;
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x444444 }));
    mesh.frustumCulled = false;
    return { mesh, geo, pos, nor, r, n: 0, dirtyFrom: 0, nrm: null };
  },

  addRing(t, y) {
    if (t.n >= RINGS) {
      t.pos.copyWithin(0, DROP * SIDES * 3); t.nor.copyWithin(0, DROP * SIDES * 3);
      t.n -= DROP; t.dirtyFrom = 0;
    }
    const v = this.obj.f(y, this.P);
    const vl = Math.hypot(v[0], v[1], v[2]) || 1;
    const T = [v[0] / vl, v[1] / vl, v[2] / vl];
    let N = t.nrm || (Math.abs(T[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N = [N[0] - d * T[0], N[1] - d * T[1], N[2] - d * T[2]];
    let nl = Math.hypot(N[0], N[1], N[2]);
    if (nl < 1e-6) { N = Math.abs(T[0]) < 0.9 ? [0, -T[2], T[1]] : [-T[2], 0, T[0]]; nl = Math.hypot(N[0], N[1], N[2]); }
    N = [N[0] / nl, N[1] / nl, N[2] / nl];
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    t.nrm = N;
    const base = t.n * SIDES * 3;
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const nx = N[0] * c + B[0] * sn, ny = N[1] * c + B[1] * sn, nz = N[2] * c + B[2] * sn;
      t.nor[base + s * 3] = nx; t.nor[base + s * 3 + 1] = ny; t.nor[base + s * 3 + 2] = nz;
      t.pos[base + s * 3] = y[0] + t.r * nx; t.pos[base + s * 3 + 1] = y[1] + t.r * ny; t.pos[base + s * 3 + 2] = y[2] + t.r * nz;
    }
    t.n++;
  },

  advance(steps) {
    const { obj, P } = this;
    const stride = obj.stride || 1;
    for (const t of this.traj) {
      for (let s = 0; s < steps; s++) {
        const y = rk4(obj.f, P, t.y, obj.h);
        if (!y.every(Number.isFinite) || Math.abs(y[0]) + Math.abs(y[1]) + Math.abs(y[2]) > 1e6) break;
        t.y = y;
        if (++t.step % stride === 0) this.addRing(t, y);
      }
      t.head.position.set(...t.y);
      const pa = t.geo.attributes.position, na = t.geo.attributes.normal;
      const from = Math.max(0, t.dirtyFrom - 1) * SIDES * 3, count = (t.n - Math.max(0, t.dirtyFrom - 1)) * SIDES * 3;
      pa.clearUpdateRanges(); na.clearUpdateRanges();
      if (count > 0) { pa.addUpdateRange(from, count); na.addUpdateRange(from, count); pa.needsUpdate = true; na.needsUpdate = true; }
      t.dirtyFrom = t.n;
    }
    this.time += steps * obj.h;
    this.applyTrail();
  },

  applyTrail() {
    const L = Math.round(this.ctx.opts.trail / (this.obj.stride || 1));
    for (const t of this.traj) {
      const start = L > 0 ? Math.max(0, t.n - L) : 0;
      t.geo.setDrawRange(start * SIDES * 6, Math.max(0, t.n - 1 - start) * SIDES * 6);
    }
    this.ctx.v3.dirty = true;
  },

  tick(dt, playing) {
    if (!playing) return false;
    const steps = Math.max(1, Math.round(this.ctx.opts.speed * this.obj.stepsPerSec * Math.min(dt, 0.05)));
    this.advance(steps);
    this.updateInfo();
    return true;
  },

  updateInfo() {
    const t = this.traj[0];
    let sep = '';
    if (this.traj.length > 1) {
      const a = this.traj[0].y, b = this.traj[1].y;
      sep = `<br><span class="k">distance of orbits 1, 2</span> ${fmt(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))}`;
    }
    const note = this.obj.note ? `<br>${this.obj.note(this.P)}` : '';
    this.ctx.setInfo(`<b>${this.obj.name}</b>${note}<br><span class="k">t</span> = ${this.time.toFixed(2)}<br>`
      + `<span class="k">(x, y, z)</span> = (${t.y.map((v) => v.toFixed(2)).join(', ')})${sep}`);
  },
};

// ---------------------------------------------------------------- systems
export const ODES = [
  {
    id: 'lorenz', name: 'Lorenz attractor', icon: 'lorenz',
    params: [
      { k: 'sigma', label: 'σ', min: 0.5, max: 30, step: 0.1, v: 10 },
      { k: 'rho', label: 'ρ', min: 0.5, max: 200, step: 0.1, v: 28, anim: true },
      { k: 'beta', label: 'β', min: 0.1, max: 6, step: 0.01, v: 8 / 3 },
    ],
    f: (y, P) => [P.sigma * (y[1] - y[0]), y[0] * (P.rho - y[2]) - y[1], y[0] * y[1] - P.beta * y[2]],
    y0: [1, 1, 1], h: 0.004, stride: 3, stepsPerSec: 900, transient: 4000, prerun: 400, home: [0.05, -0.35],
    fixed: (P) => {
      const out = [[0, 0, 0]];
      if (P.rho > 1) { const s = Math.sqrt(P.beta * (P.rho - 1)); out.push([s, s, P.rho - 1], [-s, -s, P.rho - 1]); }
      return out;
    },
    note: (P) => {
      const rH = P.sigma * (P.sigma + P.beta + 3) / (P.sigma - P.beta - 1);
      if (P.rho < 1) return 'ρ < 1: the origin attracts everything';
      if (P.sigma > P.beta + 1 && P.rho < rH) return `ρ < ${rH.toFixed(2)}: C± are stable (transient chaos possible)`;
      return 'chaotic regime (sensitive dependence)';
    },
    about: `<p>In 1963 the meteorologist Edward Lorenz reduced a model of atmospheric convection to three equations:</p>
<p class="formula">x′ = σ(y − x),  y′ = x(ρ − z) − y,  z′ = xy − βz</p>
<p>For the classical values σ = 10, ρ = 28, β = 8/3 the solutions settle on the famous butterfly-shaped <b>strange attractor</b>,
circling the two unstable equilibria C± = (±√(β(ρ−1)), ±√(β(ρ−1)), ρ − 1) in an unpredictable sequence.
Two trajectories starting 10⁻⁵ apart separate exponentially fast — the “butterfly effect” (Lyapunov exponent ≈ 0.9).
The attractor has fractal dimension ≈ 2.06. For ρ &lt; 24.74 the points C± become stable; try ρ ≈ 99.65 or 160 for periodic windows.</p>
<p>Integration: classical Runge–Kutta (RK4) with step 0.004.</p>`,
  },
  {
    id: 'rossler', name: 'Rössler attractor', icon: 'rossler',
    params: [
      { k: 'a', label: 'a', min: 0, max: 0.4, step: 0.001, v: 0.2 },
      { k: 'b', label: 'b', min: 0.05, max: 2, step: 0.01, v: 0.2 },
      { k: 'c', label: 'c', min: 1, max: 18, step: 0.01, v: 5.7, anim: true },
    ],
    f: (y, P) => [-y[1] - y[2], y[0] + P.a * y[1], P.b + y[2] * (y[0] - P.c)],
    y0: [1, 1, 0], h: 0.01, stride: 2, stepsPerSec: 500, transient: 3000, prerun: 300, home: [0.55, -0.4],
    fixed: (P) => {
      const D = P.c * P.c - 4 * P.a * P.b;
      if (D < 0) return [];
      return [(P.c + Math.sqrt(D)) / 2, (P.c - Math.sqrt(D)) / 2].map((x) => [x, -x / P.a, x / P.a]).filter((p) => p.every(Number.isFinite));
    },
    note: (P) => (P.c < 3 ? 'period-1 limit cycle' : P.c < 4.2 ? 'period doubling cascade' : 'chaotic band (for most c)'),
    about: `<p>Otto Rössler (1976) designed the simplest possible system with a chaotic attractor — it has only one non-linear term:</p>
<p class="formula">x′ = −y − z,  y′ = x + ay,  z′ = b + z(x − c)</p>
<p>Trajectories spiral outward in the (x,y)-plane, are lifted up and folded back when x exceeds c. This
stretch-and-fold mechanism produces a band that is folded like a Möbius strip. Increasing c from 2 to 6 shows a
period-doubling route to chaos (c = 2.5, 3.5, 4, …, 5.7).</p>`,
  },
  {
    id: 'thomas', name: 'Thomas attractor', icon: 'rossler',
    params: [{ k: 'b', label: 'b', min: 0.05, max: 0.33, step: 0.001, v: 0.208186, anim: true }],
    f: (y, P) => [Math.sin(y[1]) - P.b * y[0], Math.sin(y[2]) - P.b * y[1], Math.sin(y[0]) - P.b * y[2]],
    y0: [0.1, 0.5, -0.3], h: 0.04, stepsPerSec: 300, transient: 1000, prerun: 100,
    about: `<p>René Thomas' cyclically symmetric attractor (1999):</p>
<p class="formula">x′ = sin y − bx,  y′ = sin z − by,  z′ = sin x − bz</p>
<p>The parameter b is a damping. For b ≈ 0.208 the motion is chaotic; as b → 0 the system becomes conservative and the
trajectory performs a chaotic random walk through a 3D lattice of cells.</p>`,
  },
];
