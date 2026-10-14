// XplorMath web – main application: gallery, controls, persistence, loop.
import { View3D } from './view3d.js';
import { View2D } from './view2d.js';
import { Gestures } from './gestures.js';
import { CATEGORIES, OBJECTS, byId } from './catalog.js';
import { surfaceKind } from './kinds/surface.js';
import { curveKind } from './kinds/curve.js';
import { planeKind } from './kinds/plane.js';
import { polyKind } from './kinds/poly.js';
import { fractal2dKind } from './kinds/fractal2d.js';
import { escapeKind } from './kinds/escape.js';
import { odeKind } from './kinds/ode.js';
import { ParseError } from './parser.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'xplormath.v1';
const KINDS = { surface: surfaceKind, curve: curveKind, plane: planeKind, poly: polyKind, fractal2d: fractal2dKind, escape: escapeKind, ode: odeKind };

const DEFAULT_SETTINGS = { bg: 'dark', autoRotate: false, axes: false, quality: 1, listOpen: true };

const state = {
  obj: 'helicoid',
  lastByCat: {},
  params: {},
  opts: {},
  settings: { ...DEFAULT_SETTINGS },
  escapeView: {},
};

// ---------------------------------------------------------------- persistence
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.obj && byId.has(s.obj)) state.obj = s.obj;
    if (s.lastByCat) state.lastByCat = s.lastByCat;
    if (s.params) state.params = s.params;
    if (s.opts) state.opts = s.opts;
    if (s.settings) Object.assign(state.settings, s.settings);
    if (s.escapeView) state.escapeView = s.escapeView;
  } catch { /* ignore */ }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, 250);
}

// ---------------------------------------------------------------- views
const stage = $('stage');
const v3 = new View3D($('gl'));
const v2 = new View2D($('c2d'));

const cur = { obj: null, kind: null, P: null, playing: false, anim: new Map(), pendingUpdate: null, error: null };

function kindOpts(kind) {
  let o = state.opts[kind.name];
  if (!o) o = state.opts[kind.name] = {};
  for (const [k, v] of Object.entries(kind.displayDefaults)) if (!(k in o)) o[k] = v;
  return o;
}

const ctx = {
  v3, v2, state,
  get quality() { return Number(state.settings.quality) || 1; },
  get bg() { return state.settings.bg; },
  get opts() { return kindOpts(cur.kind); },
  save,
  setInfo(html) {
    const el = $('info');
    if (!html || state.settings.hideInfo) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = html;
  },
  setLegend(html) {
    const el = $('legend');
    if (!html) { el.hidden = true; return; }
    el.hidden = false; el.innerHTML = html;
  },
  toast,
  setBusy(on) {
    const b = $('busy');
    if (on) { b.textContent = 'Rendering…'; b.hidden = false; } else if (b.textContent === 'Rendering…') b.hidden = true;
  },
  setDisplayValue(k, v) {
    kindOpts(cur.kind)[k] = v;
    const inp = document.querySelector(`#displayBox [data-k="${k}"]`);
    if (inp) inp.value = v;
    const num = document.querySelector(`#displayBox [data-num="${k}"]`);
    if (num) num.value = fmtVal(v, inp ? Number(inp.step) : 0.01);
    save();
  },
  setParam(k, v, quiet) { setParam(k, v, quiet); },
  stopPlay() { setPlaying(false); },
};

// ---------------------------------------------------------------- helpers
function fmtVal(v, step) {
  if (typeof v !== 'number') return String(v);
  const d = step >= 1 ? 0 : Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
  return v.toFixed(d);
}
let toastTimer = 0;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" class="fill"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" class="fill"/><rect x="14" y="5" width="4" height="14" rx="1" class="fill"/></svg>';

function paramsFor(obj) {
  const saved = state.params[obj.id] || {};
  const P = {};
  for (const p of obj.params) {
    let v = saved[p.k];
    if (p.type === 'expr') P[p.k] = typeof v === 'string' ? v : p.v;
    else P[p.k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.v;
  }
  return P;
}

// ---------------------------------------------------------------- object selection
let mountToken = 0;
function selectObject(id, { fromList = false } = {}) {
  const obj = byId.get(id);
  if (!obj) return;
  const token = ++mountToken;
  setPlaying(false);
  cur.anim.clear();
  if (cur.kind && cur.mounted) { try { cur.kind.unmount(); } catch (e) { console.error(e); } }
  cur.mounted = false;
  cur.pendingUpdate = null;
  ctx.setLegend(null);
  ctx.setInfo(null);
  v3.clear();
  state.obj = id;
  state.lastByCat[obj.cat] = id;
  save();
  const kind = KINDS[obj.kind];
  cur.obj = obj; cur.kind = kind;
  cur.P = paramsFor(obj);
  kind.fitted = false;
  $('gl').hidden = kind.view === '2d';
  $('c2d').hidden = kind.view !== '2d';
  $('btnRotate').disabled = kind.view !== '3d';
  v2.bg = state.settings.bg;
  renderToolbar();
  renderList();
  renderControls();
  $('objTitle').textContent = obj.name;
  const heavy = obj.id === 'costa' || obj.solid === 'truncIcosidodecahedron';
  const doMount = () => {
    if (token !== mountToken) return; // another object was selected meanwhile
    try {
      cur.mounted = true;
      kind.mount(ctx, obj, cur.P);
      showError(null);
    } catch (e) {
      showError(e);
      if (!(e instanceof ParseError)) console.error(e);
    }
    $('busy').hidden = true;
    v3.setAxesVisible(state.settings.axes && kind.view === '3d');
    v3.dirty = true; v2.dirty = true;
    if (kind.autoPlay) setPlaying(true);
    if (fromList && narrow.matches) closePanel();
  };
  if (heavy) { $('busy').textContent = 'Computing…'; $('busy').hidden = false; requestAnimationFrame(() => setTimeout(doMount, 0)); } else doMount();
}

function showError(e) {
  const box = $('paramError');
  if (!e) { box.hidden = true; cur.error = null; return; }
  cur.error = e;
  box.hidden = false;
  box.textContent = e instanceof ParseError ? `Expression error: ${e.message}` : (e.message || String(e));
}

function scheduleUpdate(key) {
  cur.pendingUpdate = cur.pendingUpdate === null || cur.pendingUpdate === key ? key : '__multi';
}
function flushUpdate() {
  if (cur.pendingUpdate === null || !cur.mounted) return;
  const key = cur.pendingUpdate;
  cur.pendingUpdate = null;
  try {
    cur.kind.update(cur.P, key);
    showError(null);
  } catch (e) {
    showError(e);
    if (!(e instanceof ParseError)) console.warn(e);
  }
}

function setParam(k, v, quiet = false) {
  const p = cur.obj.params.find((q) => q.k === k);
  if (!p) return;
  cur.P[k] = v;
  state.params[cur.obj.id] = { ...cur.P };
  save();
  const r = document.querySelector(`#paramBox [data-k="${k}"]`);
  if (r) r.value = v;
  const n = document.querySelector(`#paramBox [data-num="${k}"]`);
  if (n && document.activeElement !== n) n.value = fmtVal(v, p.step);
  scheduleUpdate(k);
  if (!quiet) { /* noop */ }
}

// ---------------------------------------------------------------- toolbar / list
function renderToolbar() {
  document.querySelectorAll('#catSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cat === cur.obj.cat));
  const playable = !!(cur.kind.playable || morphParam());
  $('btnPlay').disabled = !playable;
  $('btnRotate').classList.toggle('on', state.settings.autoRotate && cur.kind.view === '3d');
}

function morphParam() {
  const o = cur.obj;
  if (!o) return null;
  if (cur.kind.playable) return null;
  const k = o.morph || (o.params.find((p) => p.anim) || {}).k;
  return k ? o.params.find((p) => p.k === k) : null;
}

function renderList() {
  const box = $('objList');
  box.innerHTML = '';
  const q = $('search').value.trim().toLowerCase();
  const cat = CATEGORIES.find((c) => c.id === cur.obj.cat);
  if (q) {
    $('listTitle').textContent = 'Search results';
    let any = false;
    for (const c of CATEGORIES) {
      const items = OBJECTS.filter((o) => o.cat === c.id && (o.name.toLowerCase().includes(q) || (o.about || '').toLowerCase().includes(q)));
      if (!items.length) continue;
      any = true;
      box.append(el('div', { class: 'cat-label' }, c.name));
      for (const o of items) box.append(listButton(o));
    }
    if (!any) box.append(el('div', { class: 'empty' }, 'No objects found.'));
  } else {
    $('listTitle').textContent = cat.name;
    for (const o of OBJECTS.filter((x) => x.cat === cat.id)) box.append(listButton(o));
  }
  const open = q ? true : state.settings.listOpen;
  box.classList.toggle('collapsed', !open);
  $('listToggle').setAttribute('aria-expanded', String(open));
}
function listButton(o) {
  return el('button', { type: 'button', class: o.id === cur.obj.id ? 'on' : '', onclick: () => { selectObject(o.id, { fromList: true }); } }, o.name);
}

// ---------------------------------------------------------------- controls
function renderControls() {
  const obj = cur.obj;
  $('objName').textContent = obj.name;
  const note = { surface: 'Drag to rotate, pinch to zoom, two fingers to move.', curve: 'Press ▶ to move the Frenet frame along the curve.',
    plane: 'Press ▶ to move the point; drag to pan, pinch to zoom.', poly: 'Drag to rotate. Use the slider to truncate and morph into the dual.',
    escape: 'Drag to pan, pinch or scroll to zoom, double-tap to zoom in.', fractal2d: 'Drag to pan, pinch or scroll to zoom.',
    ode: 'Trajectories are integrated live. Pause with ▶.' };
  $('objNote').textContent = note[obj.kind] || '';
  const box = $('paramBox');
  box.innerHTML = '';
  $('paramSet').hidden = !obj.params.length && !obj.presets;
  for (const p of obj.params) box.append(p.type === 'expr' ? exprControl(p) : rangeControl(p, cur.P[p.k], (v) => setParam(p.k, v), true));
  if (obj.presets) {
    const sel = el('select', { 'aria-label': 'Presets' }, el('option', { value: '' }, 'Choose…'), ...obj.presets.map((pr, i) => el('option', { value: i }, pr[0])));
    sel.onchange = () => {
      const pr = obj.presets[sel.value];
      if (pr) { setParam('cx', pr[1]); setParam('cy', pr[2]); }
      sel.value = '';
    };
    box.append(el('div', { class: 'row' }, el('label', {}, 'Presets'), sel));
  }
  const btns = el('div', { class: 'ctl-buttons' });
  if (obj.kind === 'escape') {
    btns.append(el('button', { type: 'button', onclick: () => { escapeKind.resetView(); } }, 'Reset view'));
    if (obj.id === 'mandelbrot') {
      btns.append(el('button', { type: 'button', class: 'primary', onclick: () => {
        const v = escapeKind.vw;
        state.params.julia = { ...(state.params.julia || {}), cx: +v.cx.toFixed(6), cy: +v.cy.toFixed(6) };
        state.escapeView.julia = { cx: 0, cy: 0, r: 1.6 };
        selectObject('julia');
      } }, 'Julia set for the centre'));
    }
  }
  if (obj.kind === 'ode') btns.append(el('button', { type: 'button', onclick: () => { scheduleUpdate('__restart'); } }, 'Restart'));
  if (obj.params.some((p) => p.type === 'expr')) {
    btns.append(el('button', { type: 'button', class: 'primary', onclick: () => applyExprs() }, 'Apply'));
  }
  if (obj.params.some((p) => p.type !== 'expr')) {
    btns.append(el('button', { type: 'button', onclick: () => {
      for (const p of obj.params) cur.P[p.k] = p.v;
      state.params[obj.id] = { ...cur.P };
      save();
      renderControls();
      scheduleUpdate('__refit');
    } }, 'Defaults'));
  }
  if (btns.children.length) box.append(btns);

  const dbox = $('displayBox');
  dbox.innerHTML = '';
  const D = kindOpts(cur.kind);
  const ctls = cur.kind.displayControls.filter((c) => !c.when || c.when(obj));
  $('displaySet').hidden = !ctls.length;
  for (const c of ctls) {
    const onChange = (v) => {
      D[c.k] = v;
      save();
      try { cur.kind.displayChanged(c.k); showError(null); } catch (e) { showError(e); }
      v2.dirty = true; v3.dirty = true;
    };
    if (c.type === 'check') {
      const inp = el('input', { type: 'checkbox', 'data-k': c.k });
      inp.checked = !!D[c.k];
      inp.onchange = () => onChange(inp.checked);
      dbox.append(el('label', { class: 'check' }, inp, ` ${c.label}`));
    } else if (c.type === 'select') {
      const sel = el('select', { 'data-k': c.k }, ...c.choices.map(([v, l]) => el('option', { value: v }, l)));
      sel.value = D[c.k];
      sel.onchange = () => onChange(sel.value);
      dbox.append(el('div', { class: 'row' }, el('label', {}, c.label), sel));
    } else if (c.type === 'range') {
      dbox.append(rangeControl({ ...c, display: true }, D[c.k], onChange, false));
    }
  }
}

function rangeControl(p, value, onChange, isParam) {
  const range = el('input', { type: 'range', min: p.min, max: p.max, step: p.step, 'data-k': p.k, 'aria-label': p.label });
  range.value = value;
  const num = el('input', { class: 'num', inputmode: 'decimal', 'data-num': p.k, 'aria-label': `${p.label} value` });
  num.value = fmtVal(value, p.step);
  range.oninput = () => {
    const v = p.int ? Math.round(Number(range.value)) : Number(range.value);
    num.value = fmtVal(v, p.step);
    onChange(v);
  };
  const commit = () => {
    let v = Number(num.value.replace(',', '.'));
    if (!Number.isFinite(v)) { num.value = fmtVal(Number(range.value), p.step); return; }
    if (p.int) v = Math.round(v);
    v = Math.min(p.max, Math.max(p.min, v));
    range.value = v;
    num.value = fmtVal(v, p.step);
    onChange(v);
  };
  num.onchange = commit;
  num.onkeydown = (e) => { if (e.key === 'Enter') { commit(); num.blur(); } };
  const top = el('div', { class: 'ctl-top' }, el('label', {}, p.label), num);
  if (isParam && p.anim) {
    const b = el('button', { type: 'button', class: 'anim-btn', title: `Animate ${p.label}`, 'aria-label': `Animate ${p.label}` });
    b.innerHTML = cur.anim.has(p.k) ? PAUSE_SVG : PLAY_SVG;
    b.classList.toggle('on', cur.anim.has(p.k));
    b.dataset.anim = p.k;
    b.onclick = () => toggleParamAnim(p.k);
    top.append(b);
  }
  return el('div', { class: 'ctl' }, top, range);
}

function exprControl(p) {
  const inp = el('input', { 'data-k': p.k, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': p.label });
  inp.value = cur.P[p.k];
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applyExprs(); inp.blur(); } };
  inp.onchange = () => applyExprs();
  return el('div', { class: 'ctl-expr' }, el('label', {}, p.label), inp);
}

function applyExprs() {
  const old = { ...cur.P };
  for (const inp of document.querySelectorAll('#paramBox .ctl-expr input')) cur.P[inp.dataset.k] = inp.value;
  try {
    cur.kind.update(cur.P, '__refit');
    showError(null);
    document.querySelectorAll('#paramBox .ctl-expr input').forEach((i) => i.classList.remove('bad'));
    state.params[cur.obj.id] = { ...cur.P };
    save();
  } catch (e) {
    showError(e);
    Object.assign(cur.P, old);
    document.querySelectorAll('#paramBox .ctl-expr input').forEach((i) => i.classList.add('bad'));
    try { cur.kind.update(cur.P, ''); } catch { /* keep previous */ }
  }
}

// ---------------------------------------------------------------- animation of parameters
function toggleParamAnim(k) {
  if (cur.anim.has(k)) cur.anim.delete(k); else cur.anim.set(k, { dir: 1, acc: 0 });
  syncAnimButtons();
}
function syncAnimButtons() {
  document.querySelectorAll('#paramBox [data-anim]').forEach((b) => {
    const on = cur.anim.has(b.dataset.anim);
    b.classList.toggle('on', on);
    b.innerHTML = on ? PAUSE_SVG : PLAY_SVG;
  });
  const mp = morphParam();
  $('btnPlay').classList.toggle('on', cur.playing || (mp && cur.anim.has(mp.k)));
}
function setPlaying(on) {
  const mp = morphParam();
  if (mp) {
    if (on) cur.anim.set(mp.k, cur.anim.get(mp.k) || { dir: 1, acc: 0 }); else cur.anim.delete(mp.k);
    cur.playing = false;
  } else {
    cur.playing = on && !!(cur.kind && cur.kind.playable);
  }
  syncAnimButtons();
}
function togglePlay() {
  const mp = morphParam();
  setPlaying(!(cur.playing || (mp && cur.anim.has(mp.k))));
}
function stepParamAnims(dt) {
  for (const [k, a] of cur.anim) {
    const p = cur.obj.params.find((q) => q.k === k);
    if (!p) continue;
    let v = cur.P[k];
    if (p.int) {
      a.acc += dt;
      if (a.acc < 0.8) continue;
      a.acc = 0;
      v += a.dir * p.step;
    } else {
      v += a.dir * (p.max - p.min) * dt / 7;
    }
    if (v >= p.max) { v = p.max; a.dir = -1; }
    if (v <= p.min) { v = p.min; a.dir = 1; }
    setParam(k, p.int ? Math.round(v) : v, true);
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (cur.kind && cur.mounted) {
    stepParamAnims(dt);
    if (cur.kind.tick) {
      try { cur.kind.tick(dt, cur.playing); } catch (e) { console.warn(e); setPlaying(false); }
    }
    flushUpdate();
    if (cur.kind.view === '3d') {
      v3.tick(dt);
      v3.render();
    } else if (cur.kind.view === '2d') {
      v2.render();
    } else if (cur.kind.view === 'gl') {
      if (cur.kind.dirty) cur.kind.render();
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- gestures
const router = {};
for (const name of ['onStart', 'onDrag', 'onPan', 'onPinch', 'onWheel', 'onTap', 'onDoubleTap', 'onEnd']) {
  router[name] = (...args) => {
    if (!cur.kind) return;
    const t = cur.kind.view === '3d' ? v3 : cur.kind.view === '2d' ? v2 : cur.kind;
    if (typeof t[name] === 'function') t[name](...args);
  };
}

// ---------------------------------------------------------------- dialogs
const dlg = $('dlg');
function openDialog({ title, body, buttons = [{ label: 'OK', value: 'ok', primary: true }] }) {
  return new Promise((resolve) => {
    $('dlgTitle').textContent = title;
    const b = $('dlgBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    b.scrollTop = 0;
    const bb = $('dlgButtons');
    bb.innerHTML = '';
    for (const btn of buttons) {
      const e = el('button', { value: btn.value, class: btn.primary ? 'primary' : '' }, btn.label);
      bb.append(e);
    }
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dlg.showModal();
  });
}

function aboutObject() {
  const o = cur.obj;
  openDialog({ title: o.name, body: o.about || '' });
}

function aboutApp() {
  openDialog({
    title: 'About XplorMath',
    body: `<p><b>XplorMath</b> is a touch-friendly museum of mathematical objects that you can rotate, deform and animate:
surfaces, space and plane curves, polyhedra, fractals and chaotic dynamical systems — ${OBJECTS.length} exhibits, each with a short explanation.</p>
<p>It is an <b>independent web re-implementation inspired by 3D-XplorMath</b>, the “mathematical museum” program created by
<b>Richard S. Palais</b> and the <b>3D-XplorMath Consortium</b> (with contributions by Hermann Karcher, David Eck and many others).
It does not use any code of the original program; all objects were implemented from their mathematical definitions.</p>
<p>Built with plain JavaScript and <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT licence). Runs entirely in your browser;
settings are stored locally on this device.</p>
<p>Tip: in Safari use Share → “Add to Home Screen” to run it full screen like an app.</p>`,
  });
}

function helpDialog() {
  openDialog({
    title: 'Controls',
    body: `<h4>Touch (iPad)</h4>
<table><tr><td>One finger</td><td>rotate 3D objects (flick to spin), pan 2D views</td></tr>
<tr><td>Pinch</td><td>zoom</td></tr><tr><td>Two fingers</td><td>move</td></tr>
<tr><td>Double tap</td><td>zoom in (2D views and fractals)</td></tr></table>
<h4>Mouse</h4>
<table><tr><td>Left drag</td><td>rotate / pan</td></tr><tr><td>Right drag or Shift+drag</td><td>move</td></tr>
<tr><td>Wheel</td><td>zoom at the cursor</td></tr></table>
<h4>Keyboard</h4>
<table><tr><td>Space</td><td>animate / pause</td></tr><tr><td>R</td><td>reset view</td></tr>
<tr><td>Arrow keys</td><td>rotate (3D) or pan</td></tr><tr><td>+ / −</td><td>zoom</td></tr>
<tr><td>A</td><td>auto-rotate on/off</td></tr><tr><td>P</td><td>show/hide panel</td></tr><tr><td>/</td><td>search</td></tr></table>
<h4>Parameters</h4><p>Drag a slider or type a value. The ▶ button next to a slider animates that parameter back and forth; the ▶ button in the toolbar
starts the main animation of the object (morph, moving frame, rolling circle, …).</p>`,
  });
}

// ---------------------------------------------------------------- screenshot
async function savePng() {
  let url;
  if (cur.kind.view === '3d') url = v3.snapshot();
  else if (cur.kind.view === '2d') { v2.render(true); url = v2.canvas.toDataURL('image/png'); }
  else url = cur.kind.snapshot();
  const name = `xplormath-${cur.obj.id}.png`;
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], name, { type: 'image/png' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: cur.obj.name }); return; } catch { /* fall back */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Image saved.');
}

// ---------------------------------------------------------------- settings
function applySettings() {
  const s = state.settings;
  document.body.classList.toggle('dark', s.bg === 'dark');
  document.body.classList.toggle('light', s.bg === 'light');
  v3.setBackground(s.bg);
  v2.bg = s.bg; v2.dirty = true;
  v3.autoRotate = s.autoRotate;
  v3.setAxesVisible(s.axes && cur.kind && cur.kind.view === '3d');
  document.querySelectorAll('#optBg button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.bg));
  $('optAutoRotate').checked = s.autoRotate;
  $('optAxes').checked = s.axes;
  $('optQuality').value = String(s.quality);
  if (cur.kind) {
    $('btnRotate').classList.toggle('on', s.autoRotate && cur.kind.view === '3d');
    if (cur.kind.view === 'gl') cur.kind.dirty = true;
  }
}

function resetView() {
  if (!cur.kind) return;
  if (cur.kind.resetView) { cur.kind.resetView(); return; }
  scheduleUpdate('__refit');
  if (cur.kind.view === '3d') v3.spin = null;
}

// ---------------------------------------------------------------- panel
const narrow = matchMedia('(max-width: 1023px)');
function openPanel() {
  const p = $('panel');
  if (narrow.matches) { p.classList.add('open'); $('scrim').hidden = false; }
  else p.classList.remove('hidden-wide');
}
function closePanel() { $('panel').classList.remove('open'); $('scrim').hidden = true; }
function togglePanel() {
  const p = $('panel');
  if (narrow.matches) { if (p.classList.contains('open')) closePanel(); else openPanel(); }
  else { p.classList.toggle('hidden-wide'); state.settings.panelHidden = p.classList.contains('hidden-wide'); save(); }
}

// ---------------------------------------------------------------- init
function onResize() {
  const r = stage.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w === v3.w && h === v3.h) return;
  v3.resize(w, h);
  v2.resize(w, h);
  if (cur.kind && cur.kind.view === 'gl') cur.kind.dirty = true;
  if (cur.kind && cur.kind.view === '3d' && cur.kind.fitted) {
    // keep the object fitted after orientation changes
    const fov = (v3.camera.fov * Math.PI) / 360;
    const half = Math.min(fov, Math.atan(Math.tan(fov) * v3.camera.aspect));
    const nd = (v3.radius / Math.sin(half)) * 1.12;
    v3.dist *= nd / v3.fitDist; v3.fitDist = nd; v3.updateCamera();
  }
}

function init() {
  load();
  if (state.settings.panelHidden && !narrow.matches) $('panel').classList.add('hidden-wide');
  new Gestures(stage, router);
  stage.style.touchAction = 'none';
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  document.querySelectorAll('#catSeg button').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.cat;
      $('search').value = '';
      const id = state.lastByCat[c] || OBJECTS.find((o) => o.cat === c).id;
      selectObject(id);
    };
  });
  $('btnPanel').onclick = togglePanel;
  $('btnPanelClose').onclick = closePanel;
  $('scrim').onclick = closePanel;
  narrow.addEventListener('change', () => { closePanel(); if (!narrow.matches && state.settings.panelHidden) $('panel').classList.add('hidden-wide'); });
  $('btnPlay').onclick = togglePlay;
  $('btnRotate').onclick = () => { state.settings.autoRotate = !state.settings.autoRotate; save(); applySettings(); };
  $('btnReset').onclick = resetView;
  $('btnMenu').onclick = () => $('menuDlg').showModal();
  $('btnAbout').onclick = aboutObject;
  $('search').oninput = () => renderList();
  $('search').onkeydown = (e) => {
    if (e.key === 'Enter') { const b = $('objList').querySelector('button'); if (b) b.click(); }
    if (e.key === 'Escape') { $('search').value = ''; renderList(); $('search').blur(); }
  };
  $('listToggle').onclick = () => { state.settings.listOpen = !state.settings.listOpen; save(); renderList(); };

  // menu
  const menu = $('menuDlg');
  menu.addEventListener('click', (e) => {
    if (e.target === menu) { menu.close(); return; }
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) { menu.close(); return; }
    if (t.parentElement.id === 'optBg') { state.settings.bg = t.dataset.v; save(); applySettings(); if (cur.kind) { try { cur.kind.displayChanged?.('bg'); } catch { /* */ } } return; }
    const a = t.dataset.action;
    if (!a) return;
    menu.close();
    if (a === 'reset') resetView();
    if (a === 'png') savePng();
    if (a === 'aboutObj') aboutObject();
    if (a === 'about') aboutApp();
    if (a === 'help') helpDialog();
    if (a === 'fullscreen') toggleFullscreen();
    if (a === 'resetAll') resetAll();
  });
  $('optAutoRotate').onchange = (e) => { state.settings.autoRotate = e.target.checked; save(); applySettings(); };
  $('optAxes').onchange = (e) => { state.settings.axes = e.target.checked; save(); applySettings(); };
  $('optQuality').onchange = (e) => { state.settings.quality = Number(e.target.value); save(); scheduleUpdate('__quality'); };
  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) $('btnFullscreen').hidden = true;

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || dlg.open || menu.open) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const view = cur.kind && cur.kind.view;
    if (k === ' ') { e.preventDefault(); if (!$('btnPlay').disabled) togglePlay(); }
    else if (k === 'r' || k === 'R') resetView();
    else if (k === 'a' || k === 'A') { state.settings.autoRotate = !state.settings.autoRotate; save(); applySettings(); }
    else if (k === 'p' || k === 'P') togglePanel();
    else if (k === '/') { e.preventDefault(); openPanel(); $('search').focus(); }
    else if (k === '+' || k === '=') router.onWheel(1.25, v3.w / 2, v3.h / 2);
    else if (k === '-' || k === '_') router.onWheel(0.8, v3.w / 2, v3.h / 2);
    else if (k.startsWith('Arrow')) {
      e.preventDefault();
      const d = 24;
      const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      if (view === '3d') v3.rotateBy(dx, dy); else router.onPan(-dx, -dy);
    } else if (k === 'Escape') closePanel();
  });

  // iOS may drop the WebGL context under memory pressure or in the background;
  // three.js restores it, we only have to redraw everything.
  $('gl').addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
  $('gl').addEventListener('webglcontextrestored', () => {
    escapeKind.drawKey = ''; escapeKind.refKey = ''; escapeKind.dirty = true;
    if (escapeKind.tex) escapeKind.tex.needsUpdate = true;
    v3.dirty = true;
  });

  new ResizeObserver(() => onResize()).observe(stage);
  onResize();
  applySettings();
  selectObject(state.obj);
  requestAnimationFrame(frame);
  window.__xm = { v3, v2, state, cur, selectObject }; // for debugging and tests
}

function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const r = d.documentElement; (r.requestFullscreen || r.webkitRequestFullscreen).call(r); }
}

async function resetAll() {
  const r = await openDialog({
    title: 'Restore defaults',
    body: '<p>Reset all parameters, display options and view settings to their default values?</p>',
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Reset', value: 'ok', primary: true }],
  });
  if (r !== 'ok') return;
  const id = state.obj;
  state.params = {}; state.opts = {}; state.escapeView = {};
  state.settings = { ...DEFAULT_SETTINGS };
  save();
  applySettings();
  selectObject(id);
}

init();
