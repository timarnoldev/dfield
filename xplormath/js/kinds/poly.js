// Polyhedron renderer: flat-shaded faces coloured by type, cylinder edges,
// sphere vertices, truncation / dual morph, dual compound, V E F and χ.
import { THREE } from '../view3d.js';
import { prepareSolid, morphSolid, starSolid, topology, DUAL_NAMES } from '../polyhedra.js';
import { sub, cross, norm, add, scale, len, dot, toLinear, fmt } from '../geom.js';

const SIDE_COLORS = { 3: '#f0b429', 4: '#3d8bd9', 5: '#e0533d', 6: '#3fae66', 8: '#8e5ad6', 10: '#f07f2e' };
const STAR_COLORS = ['#f0b429', '#3d8bd9', '#e0533d', '#3fae66', '#8e5ad6', '#22b8c4'];
const SIDE_NAMES = { 3: 'triangles', 4: 'quadrilaterals', 5: 'pentagons', 6: 'hexagons', 8: 'octagons', 10: 'decagons' };
const hex = (h) => [1, 3, 5].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));

const cache = new Map();
const solid = (name) => { if (!cache.has(name)) cache.set(name, prepareSolid(name)); return cache.get(name); };

export const polyKind = {
  name: 'poly',
  view: '3d',
  displayDefaults: { faces: true, edges: true, verts: true, opacity: 1, dual: false, byType: true },
  displayControls: [
    { k: 'faces', label: 'Faces', type: 'check' },
    { k: 'opacity', label: 'Face opacity', type: 'range', min: 0.15, max: 1, step: 0.01 },
    { k: 'byType', label: 'Colour faces by type', type: 'check' },
    { k: 'edges', label: 'Edges', type: 'check' },
    { k: 'verts', label: 'Vertices', type: 'check' },
    { k: 'dual', label: 'Show dual (compound)', type: 'check', when: (o) => !o.star },
  ],

  mount(ctx, obj, P) {
    this.ctx = ctx; this.obj = obj;
    this.group = new THREE.Group();
    ctx.v3.add(this.group);
    this.build(P, true);
  },
  update(P, key) { this.build(P, key === '__refit'); },
  displayChanged() { this.build(this.P, false); },
  unmount() { this.ctx.v3.clear(); this.ctx.setLegend(null); },

  build(P, refit) {
    this.P = P;
    const { ctx, obj } = this;
    const D = ctx.opts;
    let polys, step = 1, isStar = !!obj.star;
    let S = null;
    if (isStar) {
      const st = starSolid(obj.solid);
      polys = st.polys;
    } else {
      S = solid(obj.solid);
      polys = morphSolid(S, P.s ?? 0);
    }
    const top = topology(polys, step);
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); c.material?.dispose?.(); }

    const R = Math.max(...top.verts.map(len));
    // faces
    if (D.faces) {
      const pos = [], nor = [], col = [];
      polys.forEach((poly, fi) => {
        const c = poly.reduce((a, p) => add(a, p), [0, 0, 0]).map((x) => x / poly.length);
        let n = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
        if (isStar) n = norm(c);
        if (dot(n, c) < 0) n = scale(n, -1);
        const color = hex(!D.byType ? '#d9a441' : isStar ? STAR_COLORS[fi % STAR_COLORS.length] : (SIDE_COLORS[poly.length] || '#aaaaaa'));
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          pos.push(...c, ...a, ...b);
          for (let k = 0; k < 3; k++) { nor.push(...n); col.push(...color); }
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const transparent = D.opacity < 0.999;
      const mat = new THREE.MeshPhongMaterial({
        vertexColors: true, shininess: 60, specular: 0x333333, side: THREE.DoubleSide,
        transparent, opacity: D.opacity, depthWrite: !transparent, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      this.group.add(new THREE.Mesh(geo, mat));
    }
    const er = R * 0.012;
    if (D.edges) this.group.add(this.edgeMesh(top.verts, top.edges, er, ctx.bg === 'dark' ? 0xdfe6ee : 0x2d3a4a));
    if (D.verts) this.group.add(this.vertMesh(top.verts, er * 2.1, ctx.bg === 'dark' ? 0xffffff : 0x1b1f24));

    // dual compound (dual scaled so that its edges cross the edges of the solid at the midsphere)
    if (D.dual && S) {
      const dual = (P.s ?? 0) <= 1 ? S.dualPolys : S.polys;
      const dt = topology(dual);
      this.group.add(this.edgeMesh(dt.verts, dt.edges, er * 0.8, 0xff7ad9));
      this.group.add(this.vertMesh(dt.verts, er * 1.7, 0xff7ad9));
      const geo = new THREE.BufferGeometry();
      const pos = [];
      for (const poly of dual) { const c = poly.reduce((a, p) => add(a, p), [0, 0, 0]).map((x) => x / poly.length); for (let i = 0; i < poly.length; i++) pos.push(...c, ...poly[i], ...poly[(i + 1) % poly.length]); }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      this.group.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xff7ad9, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })));
    }

    if (refit || !this.fitted) { ctx.v3.fit([0, 0, 0], 1.75, { home: obj.home || [0.6, 0.6] }); this.fitted = true; }
    ctx.v3.dirty = true;

    // info
    const counts = {};
    for (const f of top.faces) counts[f.length] = (counts[f.length] || 0) + 1;
    let title = obj.name;
    const s = P.s ?? 0;
    if (S) {
      if (s >= 1.999) title = `${DUAL_NAMES[obj.solid]} (dual)`;
      else if (Math.abs(s - 1) < 0.004) title = `Rectified ${obj.name.toLowerCase()}`;
      else if (s > 0.001) title = s < 1 ? `Truncated ${obj.name.toLowerCase()}` : `Truncated ${DUAL_NAMES[obj.solid].toLowerCase()}`;
    }
    const faceDesc = isStar
      ? `${top.F} ${obj.faceDesc || 'faces'}`
      : Object.keys(counts).sort((a, b) => a - b).map((k) => `<span class="sw" style="background:${SIDE_COLORS[k] || '#aaa'}"></span>${counts[k]} ${SIDE_NAMES[k] || `${k}-gons`}`).join('<br>');
    const chi = top.V - top.E + top.F;
    ctx.setInfo(`<b>${title}</b><br><span class="k">V</span> = ${top.V}  <span class="k">E</span> = ${top.E}  <span class="k">F</span> = ${top.F}<br>`
      + `<span class="k">χ = V − E + F</span> = ${chi}${obj.chiNote ? ` <span class="k">(${obj.chiNote})</span>` : ''}<br>${faceDesc}`
      + (D.dual && S ? `<br><span class="sw" style="background:#ff7ad9"></span>dual ${s > 1 ? obj.name.toLowerCase() : DUAL_NAMES[obj.solid].toLowerCase()}` : ''));
  },

  edgeMesh(verts, edges, r, color) {
    const geo = new THREE.CylinderGeometry(r, r, 1, 8, 1, true);
    const mat = new THREE.MeshPhongMaterial({ color, shininess: 40 });
    const m = new THREE.InstancedMesh(geo, mat, edges.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    edges.forEach(([a, b], i) => {
      const pa = verts[a], pb = verts[b];
      const d = sub(pb, pa), L = len(d);
      q.setFromUnitVectors(up, new THREE.Vector3(...d).normalize());
      M.compose(new THREE.Vector3(...scale(add(pa, pb), 0.5)), q, new THREE.Vector3(1, L, 1));
      m.setMatrixAt(i, M);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  },

  vertMesh(verts, r, color) {
    const geo = new THREE.SphereGeometry(r, 14, 10);
    const m = new THREE.InstancedMesh(geo, new THREE.MeshPhongMaterial({ color, shininess: 80 }), verts.length);
    const M = new THREE.Matrix4();
    verts.forEach((p, i) => { M.makeTranslation(p[0], p[1], p[2]); m.setMatrixAt(i, M); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  },
};
