// Winplot-style plotter – main application (state, inventory, parameters, dialogs, tools).
import { P, compile, evalConst, derivativeString, ParseError, VARIABLE_LETTERS, FUNCTION_LIST } from './parser.js';
import { TYPES2D, TYPES3D, PALETTE, typeDef, label, checkField, paramsUsed, compile2, compile3, newEquation, implicitSource } from './equations.js';
import { findRoots, findExtrema, integrate, numDeriv, arcLength, brentRoot, niceStep, fmt } from './numeric.js';
import { Plot2D } from './plot2d.js';
import { Plot3D } from './plot3d.js';
import { EXAMPLES } from './examples.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'winplot.v1';
const narrow = matchMedia('(max-width: 1023px)');
const coarse = matchMedia('(pointer: coarse)');

// ---------------------------------------------------------------- state
const DEFAULT_VIEW2 = { xmin: -6.5, xmax: 6.5, ymin: -4.5, ymax: 4.5 };
const DEFAULT_SETTINGS2 = { grid: 'rect', axes: true, ticks: true, labels: true, equal: true, bg: '#ffffff', fontSize: 13, highlight: true };
const DEFAULT_SETTINGS3 = {
  box: { xmin: -3, xmax: 3, ymin: -3, ymax: 3, zmin: -3, zmax: 3 }, zauto: true,
  showBox: true, showAxes: true, showTicks: true, equal: false, autorotate: false, bg: '#ffffff',
};
const DEFAULT_CAMERA = { theta: -0.9, phi: 0.45, dist: 6.2, target: [0, 0, 0] };

function freshState() {
  return {
    dim: 2,
    eq2: [], eq3: [],
    params: {}, params3: {},
    view2: { ...DEFAULT_VIEW2 },
    settings2: structuredClone(DEFAULT_SETTINGS2),
    settings3: structuredClone(DEFAULT_SETTINGS3),
    camera3: structuredClone(DEFAULT_CAMERA),
    marks: [],
    mode2: 'pan', mode3: 'rotate',
    sel2: null, sel3: null,
    nextId: 1,
  };
}
let state = freshState();
const playing = new Set();

function nextId() { return state.nextId++; }

// ---------------------------------------------------------------- persistence
let saveTimer = 0;
function serialize() {
  return {
    app: 'winplot-web', version: 1,
    dim: state.dim, eq2: state.eq2, eq3: state.eq3, params: state.params, params3: state.params3,
    view2: state.view2, settings2: state.settings2, settings3: state.settings3, camera3: state.camera3,
    marks: state.marks, mode2: state.mode2, mode3: state.mode3, sel2: state.sel2, sel3: state.sel3, nextId: state.nextId,
  };
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch { /* quota */ }
  }, 250);
}
function loadWorkspace(obj) {
  const s = freshState();
  if (!obj || typeof obj !== 'object') return s;
  if (Array.isArray(obj.eq2)) s.eq2 = obj.eq2.filter((e) => e && TYPES2D[e.type]);
  if (Array.isArray(obj.eq3)) s.eq3 = obj.eq3.filter((e) => e && TYPES3D[e.type]);
  if (obj.params && typeof obj.params === 'object') s.params = obj.params;
  if (obj.params3 && typeof obj.params3 === 'object') s.params3 = obj.params3;
  if (obj.view2 && ['xmin', 'xmax', 'ymin', 'ymax'].every((k) => Number.isFinite(obj.view2[k]))) s.view2 = obj.view2;
  if (obj.settings2) Object.assign(s.settings2, obj.settings2);
  if (obj.settings3) { Object.assign(s.settings3, obj.settings3); s.settings3.box = { ...DEFAULT_SETTINGS3.box, ...(obj.settings3.box || {}) }; }
  if (obj.camera3) Object.assign(s.camera3, obj.camera3);
  if (Array.isArray(obj.marks)) s.marks = obj.marks;
  if (obj.dim === 3) s.dim = 3;
  if (['pan', 'trace', 'zoom', 'solve'].includes(obj.mode2)) s.mode2 = obj.mode2;
  if (['rotate', 'pan'].includes(obj.mode3)) s.mode3 = obj.mode3;
  let maxId = 0;
  for (const e of [...s.eq2, ...s.eq3]) {
    const def = typeDef(s.eq2.includes(e) ? 2 : 3, e.type);
    for (const [k, v] of Object.entries(def.defaults)) if (e[k] === undefined) e[k] = structuredClone(v);
    if (!Number.isFinite(e.id)) e.id = 0;
    if (e.visible === undefined) e.visible = true;
    if (!e.color) e.color = PALETTE[0];
    if (!e.width) e.width = 2;
    maxId = Math.max(maxId, e.id);
  }
  s.nextId = Math.max(Number(obj.nextId) || 1, maxId + 1);
  for (const e of [...s.eq2, ...s.eq3]) if (!e.id) e.id = s.nextId++;
  s.sel2 = s.eq2.some((e) => e.id === obj.sel2) ? obj.sel2 : null;
  s.sel3 = s.eq3.some((e) => e.id === obj.sel3) ? obj.sel3 : null;
  return s;
}
/** Each window (2-dim / 3-dim) has its own parameter set, like Winplot. */
const PS = () => (state.dim === 2 ? state.params : state.params3);
function applyParamsToP() {
  for (const [k, p] of Object.entries(PS())) if (Number.isFinite(p.value)) P[k] = p.value;
}

// ---------------------------------------------------------------- compiled items
const cache2 = new Map();
const cache3 = new Map();
function defKey(dim, eq) {
  const def = typeDef(dim, eq.type);
  return eq.type + JSON.stringify(def.fields.map((f) => eq[f.key]));
}
function items() {
  return state.eq2.map((eq) => {
    const key = defKey(2, eq);
    let rec = cache2.get(eq.id);
    if (!rec || rec.key !== key) { rec = { key, c: compile2(eq) }; cache2.set(eq.id, rec); }
    return { eq, c: rec.c };
  });
}
function items3() {
  const boxKey = JSON.stringify(state.settings3.box);
  return state.eq3.map((eq) => {
    const key = defKey(3, eq) + (eq.type === 'explicit' ? boxKey : '');
    let rec = cache3.get(eq.id);
    if (!rec || rec.key !== key) { rec = { key, c: compile3(eq, state.settings3.box) }; cache3.set(eq.id, rec); }
    return { eq, c: rec.c };
  });
}
const curEqs = () => (state.dim === 2 ? state.eq2 : state.eq3);
const selId = () => (state.dim === 2 ? state.sel2 : state.sel3);
const findEq = (id) => curEqs().find((e) => e.id === id);
const labelOf = (eq, dim = state.dim) => label(dim, eq);

// ---------------------------------------------------------------- plots
const plot2 = new Plot2D($('wrap2'), $('base2'), $('over2'), {
  state: null,
  items,
  status: (m) => setStatus(m),
  coords: (t) => { $('coords').textContent = t; },
  viewChanged: () => save(),
  addIC: (x, y) => addInitialPoint(x, y),
  select: (id) => select(id),
  selectedId: () => state.sel2,
  traceChanged: (tr) => {
    if (tr) setStatus(`${tr.text}${tr.extra ? '   ·   ' + tr.extra : ''}`);
  },
  labelOf: (eq) => label(2, eq),
  integralInfo: (it) => integralInfo(it),
  tangentInfo: (it) => tangentInfo(it),
});
Object.defineProperty(plot2.app, 'state', { get: () => state });

const plot3 = new Plot3D($('wrap3'), $('gl3'), {
  items3,
  status: (m) => setStatus(m),
  coords: (t) => { $('coords').textContent = t; },
  cameraChanged: () => save(),
});
Object.defineProperty(plot3.app, 'state', { get: () => state });

function redraw() {
  if (state.dim === 2) plot2.requestRender();
  else plot3.requestUpdate();
}

// ---------------------------------------------------------------- status
let statusTimer = 0;
function setStatus(msg, warn = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
  clearTimeout(statusTimer);
}
function modeHint() {
  if (state.dim === 3) {
    return state.mode3 === 'rotate'
      ? 'Drag to rotate · pinch to zoom · two fingers to pan/twist · tap a surface for coordinates.'
      : 'Drag to pan · pinch to zoom · tap a surface for coordinates.';
  }
  switch (state.mode2) {
    case 'trace': return 'Trace: touch a curve and slide along it. Arrow keys step the marker.';
    case 'zoom': return 'Zoom: drag a box to zoom in, tap to zoom in 2× at a point.';
    case 'solve': return 'Solve: tap to add a solution curve of the selected differential equation.';
    default: return 'Drag to pan · pinch or scroll to zoom · tap a curve to select it.';
  }
}

// ---------------------------------------------------------------- parameters
function usedParams(dim = state.dim) {
  const set = new Set();
  const list = dim === 2 ? state.eq2 : state.eq3;
  for (const eq of list) {
    paramsUsed(dim, eq).forEach((p) => set.add(p));
    for (const extra of [eq.tangent?.at, eq.integral?.a, eq.integral?.b]) {
      if (extra === undefined) continue;
      try { compile(String(extra), []).params.forEach((p) => set.add(p)); } catch { /* ignore */ }
    }
  }
  return [...set].sort();
}
function ensureParam(name) {
  const store = PS();
  if (!store[name]) store[name] = { value: 1, min: -5, max: 5, step: 0.1, mode: 'bounce', dur: 4 };
  const p = store[name];
  P[name] = p.value;
  return p;
}
/** Constant expression without parameters (e.g. "2pi", "-sqrt(2)"); NaN otherwise. A typo like "abc"
 *  would otherwise silently evaluate as the product of the parameters a·b·c. */
function evalPure(src) {
  const c = compile(String(src), []);
  return c.params.size ? NaN : c.fn();
}
function decimals(step) {
  const s = String(step);
  return s.includes('.') ? Math.min(6, s.split('.')[1].length) : 0;
}
function fmtParam(p) {
  const d = Math.max(decimals(p.step), Math.abs(p.value) < 1 && p.step < 0.1 ? 3 : 0);
  return Number(p.value.toFixed(Math.min(8, d + 1))).toString();
}

function renderParams() {
  const names = usedParams();
  const box = $('params');
  $('paramSection').hidden = names.length === 0;
  const existing = new Map([...box.children].map((el) => [el.dataset.name, el]));
  for (const [n, el] of existing) if (!names.includes(n)) { el.remove(); playing.delete(n); }
  names.forEach((name, idx) => {
    const p = ensureParam(name);
    let row = existing.get(name);
    if (!row) {
      row = document.createElement('div');
      row.className = 'param';
      row.dataset.name = name;
      row.innerHTML = `
        <div class="param-top">
          <span class="pname">${name}</span>
          <input class="pval" inputmode="decimal" aria-label="Value of ${name}">
          <button class="icon-btn play" title="Animate ${name}" aria-label="Animate ${name}"></button>
          <button class="icon-btn gear" title="Range and animation settings for ${name}" aria-label="Settings for ${name}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>
          </button>
        </div>
        <div class="param-slider">
          <span class="pmin"></span>
          <input type="range" class="prange" aria-label="Slider for ${name}">
          <span class="pmax"></span>
        </div>`;
      const range = row.querySelector('.prange');
      const val = row.querySelector('.pval');
      range.addEventListener('input', () => {
        stopAnim(name);
        setParam(name, Number(range.value), { fromSlider: true });
      });
      val.addEventListener('change', () => {
        let v;
        try { v = evalPure(val.value); } catch { v = NaN; }
        if (Number.isFinite(v)) {
          const q = PS()[name];
          if (v < q.min) q.min = v;
          if (v > q.max) q.max = v;
          setParam(name, v);
          syncParamRow(name);
        } else syncParamRow(name);
      });
      val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); val.blur(); } });
      row.querySelector('.play').onclick = () => toggleAnim(name);
      row.querySelector('.gear').onclick = () => paramSettingsDialog(name);
    }
    if (box.children[idx] !== row) box.insertBefore(row, box.children[idx] || null);
    syncParamRow(name);
  });
}
function syncParamRow(name) {
  const row = $('params').querySelector(`[data-name="${name}"]`);
  if (!row) return;
  const p = PS()[name];
  const range = row.querySelector('.prange');
  range.min = p.min; range.max = p.max; range.step = p.step > 0 ? p.step : 'any';
  range.value = p.value;
  const val = row.querySelector('.pval');
  if (document.activeElement !== val) val.value = fmtParam(p);
  row.querySelector('.pmin').textContent = fmt(p.min, 4);
  row.querySelector('.pmax').textContent = fmt(p.max, 4);
  const on = playing.has(name);
  row.classList.toggle('playing', on);
  row.querySelector('.play').innerHTML = on
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" class="fill"/><rect x="14" y="5" width="4" height="14" rx="1" class="fill"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" class="fill"/></svg>';
}
function setParam(name, v, { fromSlider = false } = {}) {
  const p = ensureParam(name);
  p.value = v;
  P[name] = v;
  if (!fromSlider) syncParamRow(name);
  else {
    const row = $('params').querySelector(`[data-name="${name}"] .pval`);
    if (row && document.activeElement !== row) row.value = fmtParam(p);
  }
  redraw();
  save();
}

// animation
let animRaf = 0, animLast = 0;
function toggleAnim(name) {
  if (playing.has(name)) stopAnim(name);
  else {
    const p = ensureParam(name);
    if (p.mode === 'once' && p.value >= p.max) p.value = p.min;
    p.dir = p.dir || 1;
    playing.add(name);
    syncParamRow(name);
    if (!animRaf) { animLast = performance.now(); animRaf = requestAnimationFrame(animFrame); }
  }
}
function stopAnim(name) {
  if (!playing.delete(name)) return;
  syncParamRow(name);
  if (state.dim === 2) { plot2.draft = false; plot2.requestRender(); }
  save();
}
function stopAllAnim() { [...playing].forEach(stopAnim); }
function animFrame(now) {
  animRaf = 0;
  if (!playing.size) return;
  const dt = Math.min(0.1, (now - animLast) / 1000);
  animLast = now;
  for (const name of [...playing]) {
    const p = PS()[name];
    if (!p) { playing.delete(name); continue; }
    const span = p.max - p.min;
    const speed = span / Math.max(0.2, Number(p.dur) || 4);
    let v = p.value + (p.dir || 1) * speed * dt;
    if (p.mode === 'loop') {
      if (v > p.max) v = p.min + (v - p.max);
    } else if (p.mode === 'once') {
      if (v >= p.max) { v = p.max; playing.delete(name); }
    } else {
      if (v > p.max) { v = p.max - (v - p.max); p.dir = -1; }
      if (v < p.min) { v = p.min + (p.min - v); p.dir = 1; }
    }
    p.value = Math.max(p.min, Math.min(p.max, v));
    P[name] = p.value;
    syncParamRow(name);
  }
  if (state.dim === 2) { plot2.draft = playing.size > 0; plot2.render(); }
  else plot3.update();
  if (!playing.size) { plot2.draft = false; redraw(); save(); }
  if (playing.size) animRaf = requestAnimationFrame(animFrame);
}

async function paramSettingsDialog(name) {
  const p = ensureParam(name);
  const body = el(`
    <div class="grid2">
      <label for="psMin">Minimum</label><input id="psMin" inputmode="decimal" value="${p.min}">
      <label for="psMax">Maximum</label><input id="psMax" inputmode="decimal" value="${p.max}">
      <label for="psStep">Slider step</label><input id="psStep" inputmode="decimal" value="${p.step}">
      <label for="psVal">Value</label><input id="psVal" inputmode="decimal" value="${fmtParam(p)}">
      <label for="psMode">Animation</label>
      <select id="psMode"><option value="bounce">Back and forth</option><option value="loop">Loop (restart at min)</option><option value="once">Once (min → max)</option></select>
      <label for="psDur">Seconds per sweep</label><input id="psDur" inputmode="decimal" value="${p.dur}">
    </div>
    <p class="hint">Values may be expressions such as <code>2pi</code> or <code>-sqrt(2)</code>.</p>
    <p class="error" id="psErr" hidden></p>`);
  body.querySelector('#psMode').value = p.mode || 'bounce';
  const r = await openDialog({
    title: `Parameter ${name}`, body,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }],
    validate: (v, b) => {
      const g = (id) => { try { return evalPure(b.querySelector(id).value); } catch { return NaN; } };
      const min = g('#psMin'), max = g('#psMax'), step = g('#psStep'), val = g('#psVal'), dur = g('#psDur');
      const err = b.querySelector('#psErr');
      let msg = '';
      if (![min, max, step, val, dur].every(Number.isFinite)) msg = 'All entries must be numbers (parameters are not allowed here).';
      else if (!(max > min)) msg = 'Maximum must be greater than minimum.';
      else if (!(step >= 0)) msg = 'Step must be ≥ 0 (0 = continuous).';
      else if (!(dur > 0)) msg = 'Duration must be positive.';
      if (msg) { err.textContent = msg; err.hidden = false; return false; }
      Object.assign(p, { min, max, step, dur, mode: b.querySelector('#psMode').value, value: Math.max(min, Math.min(max, val)) });
      return true;
    },
  });
  if (r === 'ok') { P[name] = p.value; syncParamRow(name); redraw(); save(); }
}

// ---------------------------------------------------------------- inventory
const ICONS = {
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  dup: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l6-6M14 4a6 6 0 1 1 0 12"/><path d="M9 9l2 2"/></svg>',
};
function renderInventory() {
  const ul = $('inventory');
  ul.innerHTML = '';
  const list = curEqs();
  const dim = state.dim;
  const compiled = new Map((dim === 2 ? items() : items3()).map((it) => [it.eq.id, it.c]));
  $('invEmpty').hidden = list.length > 0;
  $('invTitle').textContent = 'Inventory';
  for (const eq of list) {
    const c = compiled.get(eq.id);
    const li = document.createElement('li');
    li.className = 'inv-item';
    li.dataset.id = eq.id;
    if (eq.id === selId()) li.classList.add('selected');
    if (!eq.visible) li.classList.add('off');
    if (c && c.error) li.classList.add('err');
    const def = typeDef(dim, eq.type);
    li.innerHTML = `
      <button class="vis" role="switch" aria-checked="${eq.visible}" title="${eq.visible ? 'Hide' : 'Show'}">
        <span class="swatch" style="--c:${eq.color};--w:${Math.min(8, eq.width + 1)}px"></span>
      </button>
      <div class="inv-main">
        <div class="inv-label"></div>
        <div class="inv-sub"></div>
      </div>
      <div class="inv-actions">
        <button class="act" data-act="edit" title="Edit" aria-label="Edit">${ICONS.edit}</button>
        <button class="act" data-act="dup" title="Duplicate" aria-label="Duplicate">${ICONS.dup}</button>
        <button class="act" data-act="del" title="Delete" aria-label="Delete">${ICONS.del}</button>
        <button class="act" data-act="tools" title="Tools for this equation" aria-label="Tools">${ICONS.more}</button>
      </div>`;
    li.querySelector('.inv-label').textContent = labelOf(eq);
    const extras = [];
    if (eq.tangent) extras.push('tangent');
    if (eq.integral) extras.push('integral');
    li.querySelector('.inv-sub').textContent = c && c.error ? `⚠ ${c.error}` : `${def.short}${extras.length ? ' · ' + extras.join(', ') : ''}${eq.visible ? '' : ' · hidden'}`;
    li.querySelector('.vis').onclick = (e) => { e.stopPropagation(); eq.visible = !eq.visible; changed(); };
    li.querySelector('.inv-main').onclick = () => select(eq.id === selId() ? eq.id : eq.id, true);
    li.querySelector('.inv-main').ondblclick = () => editEquation(eq);
    li.querySelectorAll('.act').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        select(eq.id);
        const a = b.dataset.act;
        if (a === 'edit') editEquation(eq);
        else if (a === 'dup') duplicateEq(eq);
        else if (a === 'del') deleteEq(eq);
        else toolsSheet(eq);
      };
    });
    ul.append(li);
  }
  updateTitle();
}
function updateTitle() {
  const eq = findEq(selId());
  $('title').textContent = eq ? labelOf(eq) : '';
  $('title').style.color = eq ? '' : '';
}
function select(id) {
  if (state.dim === 2) state.sel2 = id; else state.sel3 = id;
  $('inventory').querySelectorAll('.inv-item').forEach((li) => li.classList.toggle('selected', Number(li.dataset.id) === id));
  updateTitle();
  if (state.dim === 2) plot2.requestRender();
  save();
}
function changed() {
  renderInventory();
  renderParams();
  redraw();
  save();
}
function duplicateEq(eq) {
  const copy = structuredClone(eq);
  copy.id = nextId();
  copy.color = nextColor();
  const list = curEqs();
  list.splice(list.indexOf(eq) + 1, 0, copy);
  select(copy.id);
  changed();
  setStatus(`Duplicated: ${labelOf(copy)}`);
}
async function deleteEq(eq) {
  const r = await openDialog({
    title: 'Delete equation',
    body: el(`<p>Delete <b></b>?</p>`),
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete', value: 'ok', primary: true, danger: true }],
    init: (b) => { b.querySelector('b').textContent = labelOf(eq); },
  });
  if (r !== 'ok') return;
  const list = curEqs();
  list.splice(list.indexOf(eq), 1);
  if (selId() === eq.id) select(null);
  if (plot2.trace && plot2.trace.id === eq.id) { plot2.trace = null; }
  changed();
}
function nextColor() {
  const used = curEqs().map((e) => e.color);
  return PALETTE.find((c) => !used.includes(c)) || PALETTE[curEqs().length % PALETTE.length];
}

// ---------------------------------------------------------------- equation dialog
const QUICK_KEYS = ['^', '(', ')', '*', '/', 'π', '√', 'sin(', 'cos(', 'tan(', 'ln(', 'exp(', '|'];
function buildEquationForm(dim, eq, isNew) {
  const def = typeDef(dim, eq.type);
  const box = document.createElement('div');
  box.className = 'eq-form';
  if (def.note) { const n = document.createElement('p'); n.className = 'hint'; n.textContent = def.note; box.append(n); }
  const grid = document.createElement('div');
  grid.className = 'eq-grid';
  const inputs = {};
  for (const f of def.fields) {
    const row = document.createElement('div');
    row.className = `eq-row kind-${f.kind}${f.half ? ' half' : ''}`;
    const id = `fld_${f.key}`;
    if (f.kind === 'check') {
      row.innerHTML = `<label class="check"><input type="checkbox" id="${id}"> <span></span></label>`;
      row.querySelector('span').textContent = f.label;
      const inp = row.querySelector('input');
      inp.checked = !!eq[f.key];
      inputs[f.key] = inp;
    } else if (f.kind === 'select') {
      row.innerHTML = `<label for="${id}"></label><select id="${id}"></select>`;
      row.querySelector('label').textContent = f.label;
      const sel = row.querySelector('select');
      for (const [v, t] of f.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
      sel.value = String(eq[f.key]);
      inputs[f.key] = sel;
    } else {
      row.innerHTML = `<label for="${id}"></label><input id="${id}" autocapitalize="off" autocorrect="off" spellcheck="false" class="${f.kind === 'expr' || f.points ? 'mono' : ''}">`;
      row.querySelector('label').textContent = f.label;
      const inp = row.querySelector('input');
      inp.value = eq[f.key] ?? '';
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.kind === 'num') inp.inputMode = 'text';
      inputs[f.key] = inp;
    }
    grid.append(row);
  }
  box.append(grid);
  // quick keys for touch keyboards
  const keys = document.createElement('div');
  keys.className = 'quick-keys';
  // variable keys: only the variables this equation type actually accepts
  const varKeys = [...new Set(def.fields.flatMap((f) => (f.kind === 'expr' ? f.vars : [])))];
  for (const k of [...QUICK_KEYS, ...varKeys]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k === '√' ? '√(' : k;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.onclick = () => insertAtCursor(k === 'π' ? 'pi' : k === '√' ? 'sqrt(' : k);
    keys.append(b);
  }
  box.append(keys);
  // style
  const style = document.createElement('div');
  style.className = 'eq-style';
  style.innerHTML = `
    <div class="swatches" role="radiogroup" aria-label="Color"></div>
    <div class="style-row">
      <label>Color <input type="color" id="fldColor"></label>
      <label>Thickness <select id="fldWidth">${[1, 1.5, 2, 3, 4, 5, 6].map((w) => `<option value="${w}">${w}</option>`).join('')}</select></label>
    </div>
    <div class="eq-row"><label for="fldName">Name (optional)</label><input id="fldName" placeholder="shown in the inventory"></div>`;
  const color = style.querySelector('#fldColor');
  color.value = eq.color;
  const sw = style.querySelector('.swatches');
  const syncSw = () => sw.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === color.value));
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.c = c; b.style.background = c; b.setAttribute('aria-label', c);
    b.onclick = () => { color.value = c; syncSw(); };
    sw.append(b);
  }
  color.addEventListener('input', syncSw);
  syncSw();
  style.querySelector('#fldWidth').value = String(eq.width);
  style.querySelector('#fldName').value = eq.name || '';
  box.append(style);
  const err = document.createElement('p');
  err.className = 'error';
  err.hidden = true;
  box.append(err);
  let lastFocus = null;
  box.addEventListener('focusin', (e) => { if (e.target.matches('input.mono')) lastFocus = e.target; });
  function insertAtCursor(text) {
    const inp = lastFocus || box.querySelector('input.mono');
    if (!inp) return;
    const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
    inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
    const pos = s + text.length;
    inp.focus({ preventScroll: true });
    try { inp.setSelectionRange(pos, pos); } catch { /* ignore */ }
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const validate = () => {
    let first = null;
    const ps = new Set();
    for (const f of def.fields) {
      const inp = inputs[f.key];
      if (f.kind === 'check' || f.kind === 'select') continue;
      const msg = checkField(f, inp.value, ps);
      inp.classList.toggle('bad', !!msg);
      if (msg && !first) first = `${f.label.replace(/[=:]\s*$/, '').trim()}: ${msg}`;
    }
    err.textContent = first || '';
    err.hidden = !first;
    return !first;
  };
  box.addEventListener('input', () => validate());
  const read = () => {
    const out = {};
    for (const f of def.fields) {
      const inp = inputs[f.key];
      out[f.key] = f.kind === 'check' ? inp.checked : inp.value.trim();
    }
    out.color = color.value;
    out.width = Number(style.querySelector('#fldWidth').value);
    const nm = style.querySelector('#fldName').value.trim();
    out.name = nm || undefined;
    return out;
  };
  void isNew;
  return { box, validate, read, inputs };
}

async function editEquation(eq, isNew = false) {
  const dim = state.dim;
  const def = typeDef(dim, eq.type);
  const form = buildEquationForm(dim, eq, isNew);
  const r = await openDialog({
    title: `${isNew ? 'New' : 'Edit'}: ${def.name}`,
    body: form.box,
    wide: true,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: isNew ? 'Add' : 'OK', value: 'ok', primary: true }],
    validate: () => form.validate(),
    init: () => form.validate(),
  });
  if (r !== 'ok') return false;
  const vals = form.read();
  Object.assign(eq, vals);
  if (!vals.name) delete eq.name;
  if (isNew) {
    eq.id = nextId();
    curEqs().push(eq);
    select(eq.id);
    if (eq.type === 'ode' && state.dim === 2) setMode2('solve');
  }
  changed();
  setStatus(`${isNew ? 'Added' : 'Updated'}: ${labelOf(eq)}`);
  return true;
}

function addEquation(type) {
  const eq = newEquation(state.dim, type, nextColor());
  if (state.dim === 2 && (type === 'explicit' || type === 'inequality') && state.eq2.some((e) => e.f === eq.f)) eq.f = type === 'explicit' ? 'x^2/2 - 1' : eq.f;
  return editEquation(eq, true);
}

function addSheet() {
  const types = state.dim === 2 ? TYPES2D : TYPES3D;
  const body = document.createElement('div');
  body.className = 'type-list';
  return new Promise((resolve) => {
    for (const [k, def] of Object.entries(types)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = def.name;
      b.onclick = () => { $('dlg').close('cancel'); setTimeout(() => resolve(addEquation(k)), 30); };
      body.append(b);
    }
    openDialog({ title: state.dim === 2 ? 'Equa – add 2-dim equation' : 'Equa – add 3-dim equation', body, buttons: [{ label: 'Cancel', value: 'cancel' }] });
  });
}

// ---------------------------------------------------------------- ODE initial points
function addInitialPoint(x, y) {
  let eq = state.eq2.find((e) => e.id === state.sel2 && e.type === 'ode');
  if (!eq) eq = state.eq2.find((e) => e.type === 'ode' && e.visible);
  if (!eq) { setStatus('Add a differential equation (Equa → dy/dx) first, then tap to draw solutions.', true); return; }
  const v = state.view2;
  const digits = Math.max(0, Math.ceil(-Math.log10((v.xmax - v.xmin) / 2000)));
  const r = (n) => Number(n.toFixed(Math.min(10, digits)));
  eq.ics = `${(eq.ics || '').trim()} (${r(x)},${r(y)})`.trim();
  if (!eq.visible) eq.visible = true;
  changed();
  setStatus(`Solution through (${fmt(x, 5)}, ${fmt(y, 5)}) for ${labelOf(eq, 2)}`);
}

// ---------------------------------------------------------------- 2D tools
function itemFor(eq) { return items().find((i) => i.eq.id === eq.id); }
function viewRangeFor(c) {
  const v = state.view2;
  let [lo, hi] = c.dom ? c.dom() : [NaN, NaN];
  lo = Number.isFinite(lo) ? Math.max(lo, v.xmin) : v.xmin;
  hi = Number.isFinite(hi) ? Math.min(hi, v.xmax) : v.xmax;
  return [lo, hi];
}
function addMarks(list, color) {
  for (const m of list) state.marks.push({ ...m, color });
  plot2.requestRender();
  save();
}
function resultList(rows) {
  if (!rows.length) return el('<p>None found in the current window.</p>');
  const t = document.createElement('table');
  t.className = 'table';
  t.innerHTML = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return t;
}
function needOk(eq) {
  const it = itemFor(eq);
  if (!it || it.c.error) { alertDialog('Error', it ? it.c.error : 'Equation not found.'); return null; }
  return it;
}

async function toolZeros(eq) {
  const it = needOk(eq); if (!it) return;
  const { c } = it;
  let rows = [], marks = [];
  const v = state.view2;
  if (eq.type === 'explicit' || eq.type === 'inequality') {
    const [lo, hi] = viewRangeFor(c);
    const xs = findRoots(c.f, lo, hi, 4000);
    rows = xs.map((x, i) => [`${i + 1}.`, `x = ${fmt(x, 10)}`]);
    marks = xs.map((x) => ({ x, y: 0, text: `x = ${fmt(x, 6)}` }));
  } else if (eq.type === 'parametric' || eq.type === 'polar') {
    const [lo, hi] = c.range();
    const ts = findRoots((t) => c.pt(t)[1], Math.min(lo, hi), Math.max(lo, hi), Math.max(2000, c.steps * 4));
    const pts = ts.map((t) => [t, c.pt(t)[0]]).filter(([, x]) => Number.isFinite(x));
    rows = pts.map(([t, x], i) => [`${i + 1}.`, `t = ${fmt(t, 8)}`, `x = ${fmt(x, 10)}`]);
    marks = pts.map(([, x]) => ({ x, y: 0, text: `x = ${fmt(x, 6)}` }));
  } else if (eq.type === 'implicit') {
    const xs = findRoots((x) => c.F(x, 0), v.xmin, v.xmax, 4000);
    rows = xs.map((x, i) => [`${i + 1}.`, `x = ${fmt(x, 10)}`]);
    marks = xs.map((x) => ({ x, y: 0, text: `x = ${fmt(x, 6)}` }));
  } else { alertDialog('Zeros', 'Zeros are available for explicit, parametric, polar and implicit curves.'); return; }
  addMarks(marks, eq.color);
  const body = document.createElement('div');
  body.append(el(`<p>Points where the curve crosses or touches the x-axis${eq.type === 'explicit' ? ' (visible x-range)' : ''}:</p>`), resultList(rows));
  await openDialog({ title: `Zeros of ${labelOf(eq)}`, body });
}

async function toolExtrema(eq) {
  const it = needOk(eq); if (!it) return;
  const { c } = it;
  let rows = [], marks = [];
  if (eq.type === 'explicit' || eq.type === 'inequality') {
    const [lo, hi] = viewRangeFor(c);
    const ex = findExtrema(c.f, lo, hi, 4000);
    rows = ex.map((e) => [e.kind === 'max' ? 'max' : 'min', `x = ${fmt(e.x, 9)}`, `y = ${fmt(e.y, 9)}`]);
    marks = ex.map((e) => ({ x: e.x, y: e.y, text: `${e.kind} (${fmt(e.x, 5)}, ${fmt(e.y, 5)})` }));
  } else if (eq.type === 'parametric' || eq.type === 'polar') {
    const [lo, hi] = c.range();
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    const ex = findExtrema((t) => c.pt(t)[1], a, b, Math.max(2000, c.steps * 4));
    rows = ex.map((e) => { const [x, y] = c.pt(e.x); return [e.kind === 'max' ? 'y max' : 'y min', `t = ${fmt(e.x, 7)}`, `(${fmt(x, 7)}, ${fmt(y, 7)})`]; });
    marks = ex.map((e) => { const [x, y] = c.pt(e.x); return { x, y, text: `y ${e.kind} ${fmt(y, 5)}` }; });
    if (eq.type === 'polar') {
      const er = findExtrema(c.fr, a, b, Math.max(2000, c.steps * 4));
      for (const e of er) { const [x, y] = c.pt(e.x); rows.push([e.kind === 'max' ? 'r max' : 'r min', `t = ${fmt(e.x, 7)}`, `r = ${fmt(e.y, 7)}`]); marks.push({ x, y, text: `r ${e.kind} ${fmt(e.y, 5)}` }); }
    }
  } else { alertDialog('Extrema', 'Extrema are available for explicit, parametric and polar curves.'); return; }
  addMarks(marks, eq.color);
  const body = document.createElement('div');
  body.append(el('<p>Local maxima and minima in the visible range:</p>'), resultList(rows));
  await openDialog({ title: `Extrema of ${labelOf(eq)}`, body });
}

/** Intersections of two curves. */
function intersect(itA, itB) {
  const v = state.view2;
  const isExp = (it) => it.eq.type === 'explicit' || it.eq.type === 'inequality';
  const isPar = (it) => it.eq.type === 'parametric' || it.eq.type === 'polar' || it.eq.type === 'segment';
  const isImp = (it) => it.eq.type === 'implicit';
  const implicitOf = (it) => (isExp(it) ? (x, y) => y - it.c.f(x) : isImp(it) ? it.c.F : null);
  const paramOf = (it) => {
    if (isExp(it)) { const [lo, hi] = viewRangeFor(it.c); return { pt: (s) => [s, it.c.f(s)], lo, hi, n: 4000 }; }
    if (it.eq.type === 'segment') {
      const [[x1, y1], [x2, y2]] = it.c.ends();
      if (it.eq.extend) {
        const L = Math.hypot(x2 - x1, y2 - y1) || 1, span = Math.hypot(v.xmax - v.xmin, v.ymax - v.ymin) * 2 / L;
        return { pt: (s) => [x1 + s * (x2 - x1), y1 + s * (y2 - y1)], lo: -span, hi: span, n: 4000 };
      }
      return { pt: (s) => [x1 + s * (x2 - x1), y1 + s * (y2 - y1)], lo: 0, hi: 1, n: 200 };
    }
    if (isPar(it)) { const [lo, hi] = it.c.range(); return { pt: it.c.pt, lo: Math.min(lo, hi), hi: Math.max(lo, hi), n: Math.max(2000, it.c.steps * 6) }; }
    return null;
  };
  let pts = [];
  if (isExp(itA) && isExp(itB)) {
    const [la, ha] = viewRangeFor(itA.c), [lb, hb] = viewRangeFor(itB.c);
    const xs = findRoots((x) => itA.c.f(x) - itB.c.f(x), Math.max(la, lb), Math.min(ha, hb), 4000);
    pts = xs.map((x) => [x, itA.c.f(x)]);
  } else {
    let par = null, imp = null;
    if (implicitOf(itB) && paramOf(itA) && !isImp(itA)) { par = paramOf(itA); imp = implicitOf(itB); }
    else if (implicitOf(itA) && paramOf(itB) && !isImp(itB)) { par = paramOf(itB); imp = implicitOf(itA); }
    if (par && imp) {
      const g = (s) => { const [x, y] = par.pt(s); return imp(x, y); };
      pts = findRoots(g, par.lo, par.hi, par.n).map((s) => par.pt(s));
    } else if (paramOf(itA) && paramOf(itB)) {
      pts = intersectParametric(paramOf(itA), paramOf(itB));
    } else if (isImp(itA) && isImp(itB)) {
      pts = intersectImplicit(itA, itB);
    } else return null;
  }
  // keep finite points in (slightly enlarged) view, dedupe
  const tol = (v.xmax - v.xmin) * 1e-6;
  const out = [];
  for (const p of pts) {
    if (!p.every(Number.isFinite)) continue;
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol)) continue;
    out.push(p);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
function newton2(F, x0, y0, iters = 30) {
  let x = x0, y = y0;
  for (let k = 0; k < iters; k++) {
    const [f1, f2] = F(x, y);
    if (!Number.isFinite(f1) || !Number.isFinite(f2)) return null;
    if (Math.abs(f1) + Math.abs(f2) < 1e-14) break;
    const h = 1e-7 * Math.max(1, Math.abs(x)), g = 1e-7 * Math.max(1, Math.abs(y));
    const [a1, a2] = F(x + h, y), [b1, b2] = F(x, y + g);
    const j11 = (a1 - f1) / h, j21 = (a2 - f2) / h, j12 = (b1 - f1) / g, j22 = (b2 - f2) / g;
    const det = j11 * j22 - j12 * j21;
    if (!det) return null;
    x -= (f1 * j22 - f2 * j12) / det;
    y -= (j11 * f2 - j21 * f1) / det;
  }
  return [x, y];
}
function polySample(par) {
  const pts = [];
  for (let i = 0; i <= par.n; i++) { const s = par.lo + ((par.hi - par.lo) * i) / par.n; const p = par.pt(s); pts.push([p[0], p[1], s]); }
  return pts;
}
function segX(p1, p2, q1, q2) {
  const d = (p2[0] - p1[0]) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (q2[0] - q1[0]);
  if (!d) return null;
  const u = ((q1[0] - p1[0]) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (q2[0] - q1[0])) / d;
  const w = ((q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (u < 0 || u > 1 || w < 0 || w > 1) return null;
  return [u, w];
}
function intersectParametric(A, B) {
  const a = polySample({ ...A, n: Math.min(A.n, 3000) }), b = polySample({ ...B, n: Math.min(B.n, 3000) });
  const out = [];
  // grid bucket for B segments
  const v = state.view2;
  const cell = (v.xmax - v.xmin) / 60;
  const buckets = new Map();
  const key = (i, j) => `${i},${j}`;
  for (let k = 0; k + 1 < b.length; k++) {
    const p = b[k], q = b[k + 1];
    if (![p[0], p[1], q[0], q[1]].every(Number.isFinite)) continue;
    const i0 = Math.floor(Math.min(p[0], q[0]) / cell), i1 = Math.floor(Math.max(p[0], q[0]) / cell);
    const j0 = Math.floor(Math.min(p[1], q[1]) / cell), j1 = Math.floor(Math.max(p[1], q[1]) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = key(i, j); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(k); }
  }
  for (let k = 0; k + 1 < a.length; k++) {
    const p = a[k], q = a[k + 1];
    if (![p[0], p[1], q[0], q[1]].every(Number.isFinite)) continue;
    const i0 = Math.floor(Math.min(p[0], q[0]) / cell), i1 = Math.floor(Math.max(p[0], q[0]) / cell);
    const j0 = Math.floor(Math.min(p[1], q[1]) / cell), j1 = Math.floor(Math.max(p[1], q[1]) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
    const cand = new Set();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) (buckets.get(key(i, j)) || []).forEach((m) => cand.add(m));
    for (const m of cand) {
      const r = segX(p, q, b[m], b[m + 1]);
      if (!r) continue;
      const s0 = p[2] + r[0] * (q[2] - p[2]), t0 = b[m][2] + r[1] * (b[m + 1][2] - b[m][2]);
      const sol = newton2((s, t) => { const P1 = A.pt(s), P2 = B.pt(t); return [P1[0] - P2[0], P1[1] - P2[1]]; }, s0, t0);
      if (sol && Math.abs(sol[0] - s0) < (A.hi - A.lo) * 0.01 && sol[0] >= A.lo - 1e-9 && sol[0] <= A.hi + 1e-9 && sol[1] >= B.lo - 1e-9 && sol[1] <= B.hi + 1e-9) out.push(A.pt(sol[0]));
      else out.push([p[0] + r[0] * (q[0] - p[0]), p[1] + r[0] * (q[1] - p[1])]);
    }
  }
  return out;
}
function intersectImplicit(itA, itB) {
  const la = plot2.linesFor(itA), lb = plot2.linesFor(itB);
  const out = [];
  for (const A of la) for (let i = 0; i + 1 < A.length; i++) for (const B of lb) for (let j = 0; j + 1 < B.length; j++) {
    const r = segX(A[i], A[i + 1], B[j], B[j + 1]);
    if (!r) continue;
    const x0 = A[i][0] + r[0] * (A[i + 1][0] - A[i][0]), y0 = A[i][1] + r[0] * (A[i + 1][1] - A[i][1]);
    const sol = newton2((x, y) => [itA.c.F(x, y), itB.c.F(x, y)], x0, y0);
    out.push(sol && Math.hypot(sol[0] - x0, sol[1] - y0) < (state.view2.xmax - state.view2.xmin) * 0.01 ? sol : [x0, y0]);
  }
  return out;
}

async function toolIntersections(eq) {
  const curves = state.eq2.filter((e) => ['explicit', 'parametric', 'polar', 'implicit', 'inequality', 'segment'].includes(e.type));
  if (curves.length < 2) { alertDialog('Intersections', 'You need at least two curves (explicit, parametric, polar, implicit or segments).'); return; }
  const a0 = eq && curves.includes(eq) ? eq : curves[0];
  const b0 = curves.find((e) => e !== a0);
  const opts = curves.map((e) => `<option value="${e.id}"></option>`).join('');
  const body = el(`<div class="grid2"><label for="ixA">Curve 1</label><select id="ixA">${opts}</select><label for="ixB">Curve 2</label><select id="ixB">${opts}</select></div><div id="ixOut"></div>`);
  body.querySelectorAll('option').forEach((o) => { o.textContent = labelOf(findEq(Number(o.value)) || {}, 2); });
  body.querySelector('#ixA').value = a0.id;
  body.querySelector('#ixB').value = b0.id;
  const run = () => {
    const A = itemFor(findEq(Number(body.querySelector('#ixA').value)));
    const B = itemFor(findEq(Number(body.querySelector('#ixB').value)));
    const out = body.querySelector('#ixOut');
    out.innerHTML = '';
    if (A === B) { out.append(el('<p>Choose two different curves.</p>')); return null; }
    if (A.c.error || B.c.error) { out.append(el('<p class="error">One of the equations has an error.</p>')); return null; }
    const pts = intersect(A, B);
    if (!pts) { out.append(el('<p>This combination is not supported.</p>')); return null; }
    out.append(el(`<p>${pts.length} intersection${pts.length === 1 ? '' : 's'} found:</p>`), resultList(pts.map((p, i) => [`${i + 1}.`, `x = ${fmt(p[0], 9)}`, `y = ${fmt(p[1], 9)}`])));
    return pts;
  };
  body.querySelectorAll('select').forEach((s) => s.addEventListener('change', run));
  let pts = null;
  const r = await openDialog({
    title: 'Intersections', body,
    buttons: [{ label: 'Close', value: 'cancel' }, { label: 'Mark on graph', value: 'ok', primary: true }],
    init: () => { pts = run(); },
    validate: () => { pts = run(); return true; },
  });
  if (r === 'ok' && pts) addMarks(pts.map(([x, y]) => ({ x, y, text: `(${fmt(x, 5)}, ${fmt(y, 5)})` })), '#000000');
}

function toolDerivative(eq) {
  if (eq.type !== 'explicit') { alertDialog('Derivative', 'The derivative is available for explicit functions y = f(x).'); return; }
  let d;
  try { d = derivativeString(eq.f, ['x'], 'x'); } catch (e) { alertDialog('Derivative', `Could not differentiate symbolically: ${e.message}`); return; }
  const neq = { ...newEquation(2, 'explicit', nextColor()), f: d, dmin: eq.dmin, dmax: eq.dmax, width: Math.max(1, eq.width - 0.5) };
  neq.id = nextId();
  state.eq2.splice(state.eq2.indexOf(eq) + 1, 0, neq);
  select(neq.id);
  changed();
  setStatus(`Derivative of ${eq.f}:  y = ${d}`);
}

/** "y = m x + b" with zero terms omitted. */
function lineText(m, b) {
  const mt = Math.abs(m) < 1e-12 ? '' : `${fmt(m, 5)}x`;
  if (!mt) return `y = ${fmt(b, 5)}`;
  if (Math.abs(b) < 1e-12) return `y = ${mt}`;
  return `y = ${mt} ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b), 5)}`;
}
const derivCache = new Map();
function tangentInfo(it) {
  const { eq, c } = it;
  if (!eq.tangent) return null;
  let s;
  try { s = evalConst(eq.tangent.at); } catch { return null; }
  if (!Number.isFinite(s)) return null;
  if (eq.type === 'explicit') {
    const y0 = c.f(s);
    let m;
    const key = eq.f;
    if (!derivCache.has(key)) { try { derivCache.set(key, compile(derivativeString(eq.f, ['x'], 'x'), ['x']).fn); } catch { derivCache.set(key, null); } }
    const df = derivCache.get(key);
    m = df ? df(s) : numDeriv(c.f, s);
    if (!Number.isFinite(m)) m = numDeriv(c.f, s);
    if (!Number.isFinite(y0) || !Number.isFinite(m)) return null;
    const b = y0 - m * s;
    return { x0: s, y0, dx: 1, dy: m, m, text: lineText(m, b), s };
  }
  if (eq.type === 'parametric' || eq.type === 'polar') {
    const [x0, y0] = c.pt(s);
    const dx = numDeriv((t) => c.pt(t)[0], s), dy = numDeriv((t) => c.pt(t)[1], s);
    if (![x0, y0, dx, dy].every(Number.isFinite)) return null;
    const m = dy / dx;
    let text;
    if (Math.abs(dx) < 1e-12 * Math.abs(dy)) text = `x = ${fmt(x0, 5)}`;
    else text = lineText(m, y0 - m * x0);
    return { x0, y0, dx, dy, m, text, s };
  }
  return null;
}

async function toolTangent(eq) {
  if (!['explicit', 'parametric', 'polar'].includes(eq.type)) { alertDialog('Tangent line', 'Tangent lines are available for explicit, parametric and polar curves.'); return; }
  const it = needOk(eq); if (!it) return;
  const isX = eq.type === 'explicit';
  let def = eq.tangent?.at;
  if (def === undefined) {
    if (plot2.trace && plot2.trace.id === eq.id && Number.isFinite(plot2.trace.s)) def = String(Number(plot2.trace.s.toPrecision(6)));
    else if (isX) def = String(Number(((state.view2.xmin + state.view2.xmax) / 2 + (state.view2.xmax - state.view2.xmin) / 7).toPrecision(3)));
    else def = '1';
  }
  const body = el(`<div class="grid2"><label for="tgAt">${isX ? 'Point of tangency  x =' : 'Parameter  t ='}</label><input id="tgAt" class="mono" autocapitalize="off"></div>
    <p class="hint">May contain parameters (e.g. <code>a</code>) – animate the parameter to move the tangent along the curve.</p><div id="tgOut"></div>`);
  const inp = body.querySelector('#tgAt');
  inp.value = def;
  const show = () => {
    const out = body.querySelector('#tgOut');
    const tmp = { eq: { ...eq, tangent: { at: inp.value } }, c: it.c };
    let info = null;
    try { info = tangentInfo(tmp); } catch { info = null; }
    inp.classList.toggle('bad', !info);
    out.innerHTML = '';
    if (!info) { out.append(el('<p class="error">Tangent is undefined at this point.</p>')); return false; }
    const normal = Math.abs(info.m) > 1e-14 ? -1 / info.m : Infinity;
    out.append(resultList([
      ['Point', `(${fmt(info.x0, 8)}, ${fmt(info.y0, 8)})`],
      ['Slope', fmt(info.m, 10)],
      ['Tangent', info.text],
      ['Normal slope', Number.isFinite(normal) ? fmt(normal, 8) : 'vertical'],
    ]));
    return true;
  };
  inp.addEventListener('input', show);
  const r = await openDialog({
    title: `Tangent line – ${labelOf(eq)}`, body,
    buttons: eq.tangent ? [{ label: 'Remove tangent', value: 'remove' }, { label: 'Cancel', value: 'cancel' }, { label: 'Show on graph', value: 'ok', primary: true }]
      : [{ label: 'Cancel', value: 'cancel' }, { label: 'Show on graph', value: 'ok', primary: true }],
    init: show,
    validate: (v) => v === 'remove' || show(),
  });
  if (r === 'ok') { eq.tangent = { at: inp.value.trim() }; changed(); }
  if (r === 'remove') { delete eq.tangent; changed(); }
}

function integralInfo(it) {
  const { eq, c } = it;
  if (!eq.integral) return null;
  let a, b;
  try { a = evalConst(eq.integral.a); b = evalConst(eq.integral.b); } catch { return null; }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (eq.type === 'explicit') {
    const r = integrate(c.f, a, b, 1e-9);
    return { a, b, value: r.value, text: `∫ = ${fmt(r.value, 6)}` };
  }
  if (eq.type === 'polar') {
    const r = integrate((t) => { const v = c.fr(t); return 0.5 * v * v; }, a, b, 1e-9);
    return { a, b, value: r.value, text: `area = ${fmt(r.value, 6)}` };
  }
  return null;
}

async function toolIntegral(eq) {
  if (!['explicit', 'parametric', 'polar'].includes(eq.type)) { alertDialog('Integral', 'Integrals are available for explicit, parametric and polar curves.'); return; }
  const it = needOk(eq); if (!it) return;
  const { c } = it;
  const v = state.view2;
  let a0 = eq.integral?.a, b0 = eq.integral?.b;
  if (a0 === undefined) {
    if (eq.type === 'explicit') {
      const step = niceStep(v.xmax - v.xmin, 4);
      a0 = String(Number((Math.ceil(v.xmin / step) * step).toPrecision(6)));
      b0 = String(Number((Math.floor(v.xmax / step) * step).toPrecision(6)));
      const zs = findRoots(c.f, ...viewRangeFor(c), 2000);
      if (zs.length >= 2) { a0 = String(Number(zs[0].toPrecision(10))); b0 = String(Number(zs[zs.length - 1].toPrecision(10))); }
    } else { a0 = eq.tmin; b0 = eq.tmax; }
  }
  const varName = eq.type === 'explicit' ? 'x' : 't';
  const body = el(`<div class="grid2"><label for="inA">Lower limit  ${varName} =</label><input id="inA" class="mono" autocapitalize="off">
    <label for="inB">Upper limit  ${varName} =</label><input id="inB" class="mono" autocapitalize="off"></div><div id="inOut"></div>`);
  body.querySelector('#inA').value = a0;
  body.querySelector('#inB').value = b0;
  const compute = () => {
    const out = body.querySelector('#inOut');
    out.innerHTML = '';
    let a, b;
    try { a = evalConst(body.querySelector('#inA').value); b = evalConst(body.querySelector('#inB').value); } catch { a = NaN; b = NaN; }
    body.querySelector('#inA').classList.toggle('bad', !Number.isFinite(a));
    body.querySelector('#inB').classList.toggle('bad', !Number.isFinite(b));
    if (!Number.isFinite(a) || !Number.isFinite(b)) { out.append(el('<p class="error">Limits must be numbers.</p>')); return false; }
    const rows = [];
    if (eq.type === 'explicit') {
      const I = integrate(c.f, a, b, 1e-10);
      const A = integrate((x) => Math.abs(c.f(x)), a, b, 1e-10);
      const L = arcLength((x) => x, c.f, a, b);
      const V = integrate((x) => Math.PI * c.f(x) ** 2, a, b, 1e-10);
      const S = integrate((x) => 2 * Math.PI * Math.abs(c.f(x)) * Math.hypot(1, numDeriv(c.f, x)), a, b, 1e-8);
      rows.push(['∫ f(x) dx', fmt(I.value, 12)], ['Area ∫|f(x)| dx', fmt(A.value, 12)], ['Average value', b !== a ? fmt(I.value / (b - a), 10) : '–'],
        ['Arc length', fmt(L.value, 10)], ['Volume (revolve about x-axis)', fmt(V.value, 10)], ['Surface area (revolve)', fmt(S.value, 8)]);
      if (!Number.isFinite(I.value) || I.error > 1e-6 * Math.max(1, Math.abs(I.value))) rows.push(['Note', 'integral may be improper/inaccurate']);
    } else if (eq.type === 'polar') {
      const A = integrate((t) => 0.5 * c.fr(t) ** 2, a, b, 1e-10);
      const L = arcLength((t) => c.pt(t)[0], (t) => c.pt(t)[1], a, b);
      rows.push(['Area ½∫ r² dt', fmt(A.value, 12)], ['Arc length', fmt(L.value, 10)]);
    } else {
      const L = arcLength(c.fx, c.fy, a, b);
      const A = integrate((t) => c.fy(t) * numDeriv(c.fx, t), a, b, 1e-9);
      rows.push(['Arc length', fmt(L.value, 10)], ['Signed area ∫ y dx', fmt(A.value, 10)]);
    }
    out.append(resultList(rows));
    return true;
  };
  body.addEventListener('input', compute);
  const canShade = eq.type !== 'parametric';
  const buttons = [{ label: 'Close', value: 'cancel' }];
  if (eq.integral) buttons.unshift({ label: 'Remove shading', value: 'remove' });
  if (canShade) buttons.push({ label: 'Shade on graph', value: 'ok', primary: true });
  const r = await openDialog({ title: `Integral – ${labelOf(eq)}`, body, buttons, init: compute, validate: (val) => val !== 'ok' || compute() });
  if (r === 'ok') { eq.integral = { a: body.querySelector('#inA').value.trim(), b: body.querySelector('#inB').value.trim() }; changed(); }
  if (r === 'remove') { delete eq.integral; changed(); }
}

async function toolTable(eq) {
  const it = needOk(eq); if (!it) return;
  const { c } = it;
  const v = state.view2;
  const isX = eq.type === 'explicit' || eq.type === 'inequality';
  const isT = eq.type === 'parametric' || eq.type === 'polar';
  if (!isX && !isT && eq.type !== 'ode') { alertDialog('Table', 'Tables are available for explicit, parametric, polar curves and ODE solutions.'); return; }
  let start, step;
  if (isX || eq.type === 'ode') { step = niceStep(v.xmax - v.xmin, 20); start = Math.ceil(v.xmin / step) * step; }
  else { const [lo, hi] = c.range(); start = lo; step = (hi - lo) / 20; }
  const body = el(`<div class="grid3">
      <label>From<input id="tbFrom" class="mono" value="${Number(start.toPrecision(6))}"></label>
      <label>Step<input id="tbStep" class="mono" value="${Number(step.toPrecision(6))}"></label>
      <label>Rows<input id="tbRows" inputmode="numeric" value="21"></label></div>
      ${eq.type === 'ode' ? '<p class="hint">Uses the first initial point; values from the numerical solution.</p>' : ''}
      <div id="tbOut" class="table-wrap"></div>`);
  let csv = '';
  const build = () => {
    const out = body.querySelector('#tbOut');
    let a, h, n;
    try { a = evalConst(body.querySelector('#tbFrom').value); h = evalConst(body.querySelector('#tbStep').value); n = Math.round(evalConst(body.querySelector('#tbRows').value)); } catch { a = NaN; }
    if (![a, h, n].every(Number.isFinite) || n < 1) { out.innerHTML = '<p class="error">Enter numbers.</p>'; return; }
    n = Math.min(n, 1000);
    let head, rows = [];
    if (isX) {
      head = ['x', 'y', "y′"];
      for (let i = 0; i < n; i++) { const x = a + i * h; rows.push([x, c.f(x), numDeriv(c.f, x)]); }
    } else if (eq.type === 'parametric') {
      head = ['t', 'x', 'y'];
      for (let i = 0; i < n; i++) { const t = a + i * h; const [x, y] = c.pt(t); rows.push([t, x, y]); }
    } else if (eq.type === 'polar') {
      head = ['t', 'r', 'x', 'y'];
      for (let i = 0; i < n; i++) { const t = a + i * h; const [x, y] = c.pt(t); rows.push([t, c.fr(t), x, y]); }
    } else {
      head = ['x', 'y', "y′"];
      const ic = c.ics()[0];
      if (!ic) { out.innerHTML = '<p>Add an initial point first.</p>'; return; }
      // integrate from the initial point to each x with RK45 via step-wise RK4 refinement
      for (let i = 0; i < n; i++) {
        const x = a + i * h;
        const steps = Math.max(10, Math.ceil(Math.abs(x - ic[0]) / (Math.abs(h) / 20 || 1)));
        let xx = ic[0], yy = ic[1];
        const dh = (x - ic[0]) / steps;
        for (let k = 0; k < steps && Number.isFinite(yy); k++) {
          const k1 = c.f(xx, yy), k2 = c.f(xx + dh / 2, yy + dh / 2 * k1), k3 = c.f(xx + dh / 2, yy + dh / 2 * k2), k4 = c.f(xx + dh, yy + dh * k3);
          yy += dh / 6 * (k1 + 2 * k2 + 2 * k3 + k4); xx += dh;
        }
        rows.push([x, yy, c.f(x, yy)]);
      }
    }
    const t = document.createElement('table');
    t.className = 'table data';
    t.innerHTML = `<thead><tr>${head.map((h2) => `<th>${h2}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${fmt(x, 8)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    out.innerHTML = '';
    out.append(t);
    csv = [head.join(','), ...rows.map((r) => r.map((x) => (Number.isFinite(x) ? String(x) : '')).join(','))].join('\n');
  };
  body.addEventListener('input', build);
  const r = await openDialog({ title: `Table – ${labelOf(eq)}`, body, wide: true, init: build, buttons: [{ label: 'Copy CSV', value: 'copy' }, { label: 'Close', value: 'cancel', primary: true }] });
  if (r === 'copy') {
    try { await navigator.clipboard.writeText(csv); setStatus('Table copied to the clipboard (CSV).'); } catch { download(new Blob([csv], { type: 'text/csv' }), 'table.csv'); }
  }
}

function startTrace(eq) {
  setMode2('trace');
  const it = itemFor(eq);
  if (!it || it.c.error || !plot2.traceable(it)) return;
  const v = state.view2;
  plot2.render();
  plot2.traceAt(it, plot2.W / 2, plot2.sy((v.ymin + v.ymax) / 2));
  if (narrow.matches) closePanel();
}

function clearMarks() {
  state.marks = [];
  plot2.trace = null;
  plot2.requestRender();
  save();
  setStatus('Marks cleared.');
}

function toolsSheet(eq) {
  const dim = state.dim;
  const body = document.createElement('div');
  body.className = 'sheet-list';
  let closesDrawer = false; // graph tools: close the drawer on narrow screens so the result is visible
  const add = (labelText, fn, enabled = true) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = labelText; b.disabled = !enabled;
    const closeIt = closesDrawer;
    b.onclick = () => { $('dlg').close('cancel'); if (closeIt && narrow.matches) closePanel(); setTimeout(fn, 30); };
    body.append(b);
  };
  const h = (t) => { const x = document.createElement('h3'); x.textContent = t; body.append(x); };
  h('Equation');
  add('Edit…', () => editEquation(eq));
  add('Duplicate', () => duplicateEq(eq));
  add(eq.visible ? 'Hide' : 'Show', () => { eq.visible = !eq.visible; changed(); });
  add('Delete…', () => deleteEq(eq));
  add('Move up', () => moveEq(eq, -1), curEqs().indexOf(eq) > 0);
  add('Move down', () => moveEq(eq, 1), curEqs().indexOf(eq) < curEqs().length - 1);
  if (dim === 2) {
    const t = eq.type;
    const curve = ['explicit', 'parametric', 'polar', 'implicit', 'inequality'].includes(t);
    closesDrawer = true;
    h('One (this equation)');
    add('Trace', () => startTrace(eq), curve || t === 'ode');
    add('Table of values…', () => toolTable(eq), ['explicit', 'parametric', 'polar', 'inequality', 'ode'].includes(t));
    add('Zeros…', () => toolZeros(eq), curve);
    add('Extrema…', () => toolExtrema(eq), ['explicit', 'parametric', 'polar', 'inequality'].includes(t));
    add('Derivative (add y = f′(x))', () => toolDerivative(eq), t === 'explicit');
    add('Integral / area…', () => toolIntegral(eq), ['explicit', 'parametric', 'polar'].includes(t));
    add('Tangent line…', () => toolTangent(eq), ['explicit', 'parametric', 'polar'].includes(t));
    h('Two');
    add('Intersections with…', () => toolIntersections(eq), ['explicit', 'parametric', 'polar', 'implicit', 'inequality', 'segment'].includes(t));
    if (t === 'ode') {
      h('Differential equation');
      add('Clear solution curves', () => { eq.ics = ''; changed(); });
      add('Solve mode (tap to add solutions)', () => { select(eq.id); setMode2('solve'); if (narrow.matches) closePanel(); });
    }
  }
  openDialog({ title: labelOf(eq), body, buttons: [{ label: 'Close', value: 'cancel' }] });
}
function moveEq(eq, d) {
  const list = curEqs();
  const i = list.indexOf(eq), j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  changed();
}

// ---------------------------------------------------------------- view
function standardView() {
  if (state.dim === 3) { Object.assign(state.settings3, { box: structuredClone(DEFAULT_SETTINGS3.box), zauto: true }); plot3.update(); plot3.resetCamera(); save(); return; }
  plot2.setView({ ...DEFAULT_VIEW2 });
}
function zoomToFit() {
  if (state.dim === 3) { plot3.resetCamera(); return; }
  const v = state.view2;
  let xs = [], ys = [];
  for (const it of items()) {
    if (!it.eq.visible || it.c.error) continue;
    const { eq, c } = it;
    try {
      if (eq.type === 'parametric' || eq.type === 'polar') {
        const [lo, hi] = c.range();
        for (let i = 0; i <= 600; i++) { const p = c.pt(lo + ((hi - lo) * i) / 600); if (p.every(Number.isFinite)) { xs.push(p[0]); ys.push(p[1]); } }
      } else if (eq.type === 'explicit' || eq.type === 'inequality') {
        let [lo, hi] = c.dom();
        const hasDom = Number.isFinite(lo) && Number.isFinite(hi);
        if (!hasDom) [lo, hi] = [v.xmin, v.xmax];
        for (let i = 0; i <= 600; i++) { const x = lo + ((hi - lo) * i) / 600; const y = c.f(x); if (Number.isFinite(y)) { ys.push(y); if (hasDom) xs.push(x); } }
        if (!hasDom) xs.push(v.xmin, v.xmax);
      } else if (eq.type === 'points') c.pts().forEach(([x, y]) => { xs.push(x); ys.push(y); });
      else if (eq.type === 'segment') c.ends().forEach(([x, y]) => { xs.push(x); ys.push(y); });
      else if (eq.type === 'ode') c.ics().forEach(([x, y]) => { xs.push(x); ys.push(y); });
      else if (eq.type === 'implicit') { xs.push(v.xmin, v.xmax); ys.push(v.ymin, v.ymax); }
    } catch { /* ignore */ }
  }
  xs = xs.filter(Number.isFinite).sort((a, b) => a - b);
  ys = ys.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length || !ys.length) { standardView(); return; }
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
  let x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
  // ignore extreme spikes (asymptotes)
  const py0 = q(ys, 0.02), py1 = q(ys, 0.98);
  if (y1 - y0 > 6 * (py1 - py0) && py1 > py0) { y0 = py0; y1 = py1; }
  if (x1 - x0 < 1e-9) { x0 -= 1; x1 += 1; }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const mx = (x1 - x0) * 0.08, my = (y1 - y0) * 0.1;
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  if (state.settings2.equal) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const hw = Math.max((x1 - x0) / 2, ((y1 - y0) / 2) * plot2.W / plot2.H);
    plot2.setView({ xmin: cx - hw, xmax: cx + hw, ymin: cy - 1, ymax: cy + 1 });
  } else plot2.setView({ xmin: x0, xmax: x1, ymin: y0, ymax: y1 });
  setStatus('Zoomed to fit the visible graphs.');
}

async function windowDialog() {
  if (state.dim === 3) return boxDialog();
  const v = state.view2;
  const r4 = (x) => String(Number(x.toPrecision(6)));
  const body = el(`<div class="grid2">
    <label for="wXmin">x min</label><input id="wXmin" class="mono" value="${r4(v.xmin)}">
    <label for="wXmax">x max</label><input id="wXmax" class="mono" value="${r4(v.xmax)}">
    <label for="wYmin">y min</label><input id="wYmin" class="mono" value="${r4(v.ymin)}">
    <label for="wYmax">y max</label><input id="wYmax" class="mono" value="${r4(v.ymax)}">
    </div>
    <label class="check"><input type="checkbox" id="wEqual" ${state.settings2.equal ? 'checked' : ''}> Equal scaling (square units; y-range follows the window shape)</label>
    <p class="error" id="wErr" hidden></p>`);
  let nv = null;
  const r = await openDialog({
    title: 'View – set window', body,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }],
    validate: (_, b) => {
      const g = (id) => { try { return evalPure(b.querySelector(id).value); } catch { return NaN; } };
      nv = { xmin: g('#wXmin'), xmax: g('#wXmax'), ymin: g('#wYmin'), ymax: g('#wYmax') };
      const ok = Object.values(nv).every(Number.isFinite) && nv.xmax > nv.xmin && nv.ymax > nv.ymin;
      b.querySelector('#wErr').textContent = 'Enter numbers with min < max.';
      b.querySelector('#wErr').hidden = ok;
      return ok;
    },
  });
  if (r !== 'ok') return;
  state.settings2.equal = body.querySelector('#wEqual').checked;
  if (state.settings2.equal) {
    const cx = (nv.xmin + nv.xmax) / 2, cy = (nv.ymin + nv.ymax) / 2;
    const hw = Math.max((nv.xmax - nv.xmin) / 2, ((nv.ymax - nv.ymin) / 2) * plot2.W / plot2.H);
    plot2.setView({ xmin: cx - hw, xmax: cx + hw, ymin: cy - 1, ymax: cy + 1 });
  } else plot2.setView(nv);
  save();
}

async function boxDialog() {
  const s = state.settings3;
  const b0 = s.box;
  const body = el(`<div class="grid2">
    <label>x min</label><input id="bXmin" class="mono" value="${b0.xmin}"><label>x max</label><input id="bXmax" class="mono" value="${b0.xmax}">
    <label>y min</label><input id="bYmin" class="mono" value="${b0.ymin}"><label>y max</label><input id="bYmax" class="mono" value="${b0.ymax}">
    <label>z min</label><input id="bZmin" class="mono" value="${b0.zmin}"><label>z max</label><input id="bZmax" class="mono" value="${b0.zmax}">
    </div>
    <label class="check"><input type="checkbox" id="bAuto" ${s.zauto ? 'checked' : ''}> Automatic z-range (fit the graphs)</label>
    <label class="check"><input type="checkbox" id="bEqual" ${s.equal ? 'checked' : ''}> Equal scaling on all axes</label>
    <p class="hint">The x/y range is also the default domain of explicit surfaces z = f(x,y). Everything is clipped to the box.</p>
    <p class="error" id="bErr" hidden></p>`);
  let nb = null;
  const r = await openDialog({
    title: '3-dim view box', body,
    buttons: [{ label: 'Fit to graphs', value: 'fit' }, { label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }],
    validate: (val, b) => {
      if (val === 'fit') return true;
      const g = (id) => { try { return evalPure(b.querySelector(id).value); } catch { return NaN; } };
      nb = { xmin: g('#bXmin'), xmax: g('#bXmax'), ymin: g('#bYmin'), ymax: g('#bYmax'), zmin: g('#bZmin'), zmax: g('#bZmax') };
      const ok = Object.values(nb).every(Number.isFinite) && nb.xmax > nb.xmin && nb.ymax > nb.ymin && nb.zmax > nb.zmin;
      b.querySelector('#bErr').textContent = 'Enter numbers with min < max.';
      b.querySelector('#bErr').hidden = ok;
      return ok;
    },
  });
  if (r === 'fit') { fitBox(); return; }
  if (r !== 'ok') return;
  s.box = nb;
  s.zauto = body.querySelector('#bAuto').checked;
  s.equal = body.querySelector('#bEqual').checked;
  plot3.update();
  plot3.layout();
  save();
}

function fitBox() {
  const pts = [];
  for (const it of items3()) {
    if (!it.eq.visible || it.c.error) continue;
    const rec = plot3.sample(it);
    if (rec.kind === 'surface') { if (it.eq.type === 'explicit') continue; for (let k = 0; k < rec.ok.length; k++) if (rec.ok[k]) pts.push([rec.pos[k * 3], rec.pos[k * 3 + 1], rec.pos[k * 3 + 2]]); }
    else if (rec.kind === 'curve') rec.pieces.forEach((pc) => pts.push(...pc));
    else pts.push(...rec.pts);
  }
  const b = state.settings3.box;
  if (pts.length) {
    const r = (i, f) => f(...pts.map((p) => p[i]));
    let [x0, x1, y0, y1, z0, z1] = [r(0, Math.min), r(0, Math.max), r(1, Math.min), r(1, Math.max), r(2, Math.min), r(2, Math.max)];
    const pad = (a, c) => { const m = Math.max(1e-6, (c - a) * 0.05); return [a - m, c + m]; };
    [x0, x1] = pad(x0, x1); [y0, y1] = pad(y0, y1); [z0, z1] = pad(z0, z1);
    const rr = (v) => Number(v.toPrecision(3));
    Object.assign(b, { xmin: rr(x0), xmax: rr(x1), ymin: rr(y0), ymax: rr(y1), zmin: rr(z0), zmax: rr(z1) });
    state.settings3.zauto = false;
  }
  plot3.update();
  plot3.layout();
  save();
  setStatus('Box fitted to the graphs.');
}

// ---------------------------------------------------------------- mode switching
function setDim(dim) {
  if (state.dim === dim) return;
  stopAllAnim();
  state.dim = dim;
  applyParamsToP();
  syncDimUI();
  renderInventory();
  renderParams();
  onResize();
  save();
}
function syncDimUI() {
  const d3 = state.dim === 3;
  document.querySelectorAll('#dimSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.dim) === state.dim));
  $('wrap2').hidden = d3;
  $('wrap3').hidden = !d3;
  $('modeSeg2').hidden = d3;
  $('modeSeg3').hidden = !d3;
  $('noGL').hidden = !(d3 && !plot3.ok);
  plot3.setActive(d3);
  $('btnFit').title = d3 ? 'Reset the 3D camera' : 'Zoom to fit the visible graphs';
  $('btnFit').querySelector('.lbl').textContent = d3 ? 'Reset' : 'Fit';
  $('panelHint').textContent = d3
    ? 'Tip: one finger rotates, pinch zooms, two fingers pan and twist. With a mouse: drag rotates, right-drag or shift-drag pans, scroll zooms.'
    : 'Tip: tap an equation to select it; the tools button (last icon) offers trace, zeros, extrema, intersections, derivative, integral, tangent and tables.';
  setStatus(modeHint());
}
function setMode2(mode) {
  state.mode2 = mode;
  document.querySelectorAll('#modeSeg2 button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode !== 'trace' && plot2.trace) { plot2.trace = null; plot2.renderOverlay(); }
  plot2.hover = null;
  $('over2').style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
  setStatus(modeHint());
  save();
}
function setMode3(mode) {
  state.mode3 = mode;
  document.querySelectorAll('#modeSeg3 button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('gl3').style.cursor = mode === 'pan' ? 'move' : 'grab';
  setStatus(modeHint());
  save();
}

// ---------------------------------------------------------------- menu
function buildMenu() {
  const body = $('menuBody');
  body.innerHTML = '';
  const d3 = state.dim === 3;
  $('menuTitle').textContent = d3 ? 'Winplot – 3-dim' : 'Winplot – 2-dim';
  const section = (title) => { const s = document.createElement('section'); const h = document.createElement('h3'); h.textContent = title; s.append(h); body.append(s); return s; };
  const btn = (sec, text, fn, enabled = true) => {
    const b = document.createElement('button');
    b.textContent = text; b.disabled = !enabled;
    b.onclick = () => { $('menuDlg').close(); setTimeout(fn, 30); };
    sec.append(b);
  };
  const check = (sec, text, obj, key, after) => {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = '<input type="checkbox"> <span></span>';
    l.querySelector('span').textContent = text;
    const inp = l.querySelector('input');
    inp.checked = !!obj[key];
    inp.onchange = () => { obj[key] = inp.checked; after(); save(); };
    sec.append(l);
  };
  const file = section('File');
  btn(file, 'New (clear this window)…', newWorkspace);
  btn(file, 'Examples library…', examplesDialog);
  btn(file, 'Open workspace (JSON)…', () => $('fileOpen').click());
  btn(file, 'Save workspace (JSON)', saveWorkspaceFile);
  btn(file, 'Export image (PNG)', exportPng);

  const equa = section('Equa');
  for (const [k, def] of Object.entries(d3 ? TYPES3D : TYPES2D)) btn(equa, `${def.name}…`, () => addEquation(k));

  if (!d3) {
    const eq = findEq(state.sel2);
    const one = section(`One${eq ? ' – ' + labelOf(eq) : ' (select an equation first)'}`);
    const t = eq?.type;
    const curve = ['explicit', 'parametric', 'polar', 'implicit', 'inequality'].includes(t);
    btn(one, 'Trace', () => startTrace(eq), !!eq && (curve || t === 'ode'));
    btn(one, 'Table of values…', () => toolTable(eq), !!eq && ['explicit', 'parametric', 'polar', 'inequality', 'ode'].includes(t));
    btn(one, 'Zeros…', () => toolZeros(eq), !!eq && curve);
    btn(one, 'Extrema…', () => toolExtrema(eq), !!eq && ['explicit', 'parametric', 'polar', 'inequality'].includes(t));
    btn(one, 'Derivative', () => toolDerivative(eq), t === 'explicit');
    btn(one, 'Integral / area…', () => toolIntegral(eq), ['explicit', 'parametric', 'polar'].includes(t));
    btn(one, 'Tangent line…', () => toolTangent(eq), ['explicit', 'parametric', 'polar'].includes(t));
    const two = section('Two');
    btn(two, 'Intersections…', () => toolIntersections(eq), state.eq2.length >= 2);
    btn(two, 'Clear marks', clearMarks, state.marks.length > 0);
  }

  const view = section('View');
  btn(view, d3 ? 'Set view box…' : 'Set window…', windowDialog);
  btn(view, d3 ? 'Standard box and camera' : 'Standard view', standardView);
  if (!d3) {
    btn(view, 'Zoom to fit', zoomToFit);
    const seg = document.createElement('div');
    seg.className = 'row';
    seg.innerHTML = '<span>Grid</span><div class="seg seg-wide"><button data-v="none">None</button><button data-v="rect">Rectangular</button><button data-v="polar">Polar</button></div>';
    seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', state.settings2.grid === b.dataset.v);
      b.onclick = () => { state.settings2.grid = b.dataset.v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); plot2.requestRender(); save(); };
    });
    view.append(seg);
    const re = () => plot2.requestRender();
    check(view, 'Axes', state.settings2, 'axes', re);
    check(view, 'Tick marks', state.settings2, 'ticks', re);
    check(view, 'Numbers on axes', state.settings2, 'labels', re);
    check(view, 'Equal scaling (square)', state.settings2, 'equal', () => { if (state.settings2.equal) plot2.setView(state.view2); else plot2.requestRender(); });
    check(view, 'Highlight selected curve', state.settings2, 'highlight', re);
  } else {
    const re = () => { plot3.layout(); };
    check(view, 'Box', state.settings3, 'showBox', re);
    check(view, 'Axes', state.settings3, 'showAxes', re);
    check(view, 'Tick labels', state.settings3, 'showTicks', re);
    check(view, 'Automatic z-range', state.settings3, 'zauto', re);
    check(view, 'Equal scaling on all axes', state.settings3, 'equal', re);
    check(view, 'Auto-rotate', state.settings3, 'autorotate', () => plot3.request());
  }
  const bgRow = document.createElement('div');
  bgRow.className = 'row';
  bgRow.innerHTML = '<span>Background</span><div class="bg-swatches"></div><input type="color" aria-label="Custom background color">';
  const settings = d3 ? state.settings3 : state.settings2;
  const bgInput = bgRow.querySelector('input');
  bgInput.value = settings.bg;
  const applyBg = (c) => { settings.bg = c; bgInput.value = c; if (d3) plot3.layout(); else plot2.requestRender(); save(); };
  for (const c of ['#ffffff', '#fffbe6', '#eef3fa', '#1e1e1e', '#000000']) {
    const b = document.createElement('button');
    b.style.background = c; b.setAttribute('aria-label', `Background ${c}`);
    b.onclick = () => applyBg(c);
    bgRow.querySelector('.bg-swatches').append(b);
  }
  bgInput.oninput = () => applyBg(bgInput.value);
  view.append(bgRow);
  if (!d3) {
    const fsRow = document.createElement('div');
    fsRow.className = 'row';
    fsRow.innerHTML = '<label for="mFont">Font size</label><select id="mFont"><option>11</option><option>13</option><option>15</option><option>18</option></select>';
    const sel = fsRow.querySelector('select');
    sel.value = String(state.settings2.fontSize);
    sel.onchange = () => { state.settings2.fontSize = Number(sel.value); plot2.requestRender(); save(); };
    view.append(fsRow);
  }

  const help = section('Help');
  btn(help, 'Syntax and functions', syntaxHelp);
  btn(help, 'Using the plotter (touch, mouse, keyboard)', usageHelp);
  btn(help, 'About', aboutDialog);
}

// ---------------------------------------------------------------- file operations
async function newWorkspace() {
  const r = await openDialog({
    title: 'New',
    body: el(`<p>Remove all ${state.dim === 3 ? '3-dim' : '2-dim'} equations${state.dim === 2 ? ' and marks' : ''}?</p><p class="hint">Tip: save the workspace first if you want to keep it.</p>`),
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Clear everything', value: 'all' }, { label: `Clear ${state.dim === 3 ? '3-dim' : '2-dim'}`, value: 'ok', primary: true }],
  });
  if (r === 'cancel') return;
  stopAllAnim();
  if (r === 'all') {
    const dim = state.dim;
    state = freshState();
    state.dim = dim;
    applyParamsToP();
    syncDimUI(); setMode2('pan'); setMode3('rotate');
    plot2.trace = null;
    onResize();
  } else if (state.dim === 2) { state.eq2 = []; state.marks = []; state.sel2 = null; plot2.trace = null; } else { state.eq3 = []; state.sel3 = null; }
  changed();
  setStatus('Cleared.');
}

function workspaceFromExample(ex) {
  const dim = ex.dim;
  const ws = serialize();
  const list = (dim === 2 ? ex.eq2 : ex.eq3).map((e) => {
    const base = newEquation(dim, e.type, e.color);
    return { ...base, ...structuredClone(e), id: 0 };
  });
  if (dim === 2) {
    ws.eq2 = list; ws.marks = [];
    if (ex.view2) ws.view2 = { ...ex.view2 };
    ws.settings2 = { ...state.settings2, grid: 'rect', equal: true, ...(ex.settings2 || {}) };
    ws.mode2 = ex.mode2 || 'pan';
    ws.sel2 = null;
  } else {
    ws.eq3 = list;
    ws.settings3 = { ...state.settings3, box: { ...(ex.box || DEFAULT_SETTINGS3.box) }, zauto: ex.zauto ?? true, equal: !!ex.equal3 };
    ws.camera3 = structuredClone(DEFAULT_CAMERA);
    ws.sel3 = null;
  }
  ws.dim = dim;
  if (dim === 2) ws.params = { ...state.params, ...structuredClone(ex.params || {}) };
  else ws.params3 = { ...state.params3, ...structuredClone(ex.params || {}) };
  ws.nextId = state.nextId;
  return ws;
}

async function examplesDialog() {
  const body = document.createElement('div');
  body.className = 'examples';
  let chosen = null;
  for (const dim of [2, 3]) {
    const h = document.createElement('h3');
    h.textContent = dim === 2 ? '2-dim' : '3-dim';
    body.append(h);
    for (const ex of EXAMPLES.filter((e) => e.dim === dim)) {
      const b = document.createElement('button');
      b.type = 'submit'; b.value = 'ok';
      b.innerHTML = '<strong></strong><span></span>';
      b.querySelector('strong').textContent = ex.title;
      b.querySelector('span').textContent = ex.note || '';
      b.onclick = () => { chosen = ex; };
      body.append(b);
    }
  }
  const r = await openDialog({ title: 'Examples library', body, buttons: [{ label: 'Cancel', value: 'cancel' }] });
  if (r !== 'ok' || !chosen) return;
  loadExample(chosen);
}
/** Shows the rectangle v completely (equal scaling enlarges one direction). */
function fitView(v) {
  if (state.settings2.equal) {
    const cx = (v.xmin + v.xmax) / 2, cy = (v.ymin + v.ymax) / 2;
    const hw = Math.max((v.xmax - v.xmin) / 2, ((v.ymax - v.ymin) / 2) * plot2.W / plot2.H);
    plot2.setView({ xmin: cx - hw, xmax: cx + hw, ymin: cy - 1, ymax: cy + 1 });
  } else plot2.setView({ ...v });
}
function loadExample(ex) {
  stopAllAnim();
  const ws = workspaceFromExample(ex);
  state = loadWorkspace(ws);
  applyParamsToP();
  plot2.trace = null;
  if (ex.dim === 2 && state.settings2.equal) state.view2 = { ...ex.view2 };
  syncAll();
  if (ex.dim === 2 && ex.view2) fitView(ex.view2);
  setStatus(`Example: ${ex.title}${ex.note ? ' – ' + ex.note : ''}`);
  if (narrow.matches) openPanel();
  save();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (coarse.matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  download(blob, name);
}
function saveWorkspaceFile() {
  const blob = new Blob([JSON.stringify(serialize(), null, 1)], { type: 'application/json' });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  shareOrDownload(blob, `winplot-${stamp}.json`);
  setStatus('Workspace saved.');
}
async function openWorkspaceFile(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || (!Array.isArray(obj.eq2) && !Array.isArray(obj.eq3))) throw new Error('not a workspace file');
    stopAllAnim();
    state = loadWorkspace(obj);
    applyParamsToP();
    plot2.trace = null;
    syncAll();
    setStatus(`Opened ${file.name}.`);
    save();
  } catch (e) {
    alertDialog('Open workspace', `Could not read this file: ${e.message}`);
  }
}
function exportPng() {
  if (state.dim === 3) {
    if (!plot3.ok) return;
    plot3.toBlob((b) => b && shareOrDownload(b, 'winplot-3d.png'));
    return;
  }
  plot2.render();
  const cv = document.createElement('canvas');
  cv.width = $('base2').width; cv.height = $('base2').height;
  const ctx = cv.getContext('2d');
  ctx.drawImage($('base2'), 0, 0);
  ctx.drawImage($('over2'), 0, 0);
  cv.toBlob((b) => b && shareOrDownload(b, 'winplot-2d.png'), 'image/png');
}

// ---------------------------------------------------------------- dialogs
const dlg = $('dlg');
function openDialog({ title, body, buttons = [{ label: 'OK', value: 'ok', primary: true }], validate, init, wide = false }) {
  return new Promise((resolve) => {
    $('dlgTitle').textContent = title;
    const b = $('dlgBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    const bb = $('dlgButtons');
    bb.innerHTML = '';
    for (const btn of buttons) {
      const e = document.createElement('button');
      e.textContent = btn.label;
      e.value = btn.value;
      if (btn.primary) e.className = 'primary';
      if (btn.danger) e.classList.add('danger');
      if (btn.value === 'cancel') e.formNoValidate = true;
      bb.append(e);
    }
    dlg.classList.toggle('wide', wide);
    const form = $('dlgForm');
    form.onsubmit = (e) => {
      const v = e.submitter ? e.submitter.value : 'ok';
      if (validate && v !== 'cancel' && validate(v, b) === false) e.preventDefault();
    };
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dlg.showModal();
    if (init) init(b);
    b.scrollTop = 0;
    const first = b.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=color]), select');
    if (first && !coarse.matches) first.focus();
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
}
function alertDialog(title, text) {
  const p = document.createElement('p');
  p.textContent = text;
  return openDialog({ title, body: p });
}
function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

function syntaxHelp() {
  const fns = FUNCTION_LIST.join(', ');
  const body = el(`
    <p>Type formulas the way you write them: <code>2x^2 - 3x + 1</code>, <code>3sin(2x)</code>, <code>(x+1)(x-1)</code>, <code>|x|</code>, <code>e^(-x^2)</code>, <code>x^(1/3)</code>.</p>
    <table class="table">
      <tr><td><code>+ - * / ^</code></td><td>arithmetic; <code>^</code> is right-associative, <code>-x^2 = -(x²)</code></td></tr>
      <tr><td><code>2x, xy, 3(x+1)</code></td><td>implicit multiplication</td></tr>
      <tr><td><code>pi, e</code></td><td>constants (also π)</td></tr>
      <tr><td><code>x y t u v r</code></td><td>variables – which ones are allowed depends on the equation type</td></tr>
      <tr><td><code>a b c d k …</code></td><td>any other single letter is a <b>parameter</b> and gets a slider (like Winplot's A–W)</td></tr>
      <tr><td><code>ln, log</code></td><td>natural logarithm, base-10 logarithm (also <code>log2</code>, <code>logb(b,x)</code>)</td></tr>
      <tr><td><code>&lt; &lt;= &gt; &gt;= == !=</code></td><td>comparisons give 1 or 0: <code>(x&lt;0)*x^2</code> makes piecewise functions</td></tr>
      <tr><td><code>x^2 + y^2 = 4</code></td><td>implicit equations use a single <code>=</code></td></tr>
    </table>
    <p><b>Functions:</b> ${fns}.</p>
    <p class="hint">Upper and lower case are treated the same. Domains, limits and point coordinates may be expressions too, e.g. <code>2pi</code> or <code>a+1</code>.</p>`);
  openDialog({ title: 'Syntax and functions', body, wide: true });
}
function usageHelp() {
  const body = el(`
    <h4>2-dim window</h4>
    <ul>
      <li><b>Pan</b> mode: drag to move; tap a curve to select it.</li>
      <li><b>Pinch</b> (two fingers) zooms and pans in every mode; mouse wheel / trackpad zooms at the pointer.</li>
      <li><b>Trace</b>: touch a curve and slide along it – coordinates (and slope) are shown. Arrow keys step the marker.</li>
      <li><b>Zoom</b>: drag a rectangle, or tap to zoom in 2×. Shift-drag zooms in any mode with a mouse.</li>
      <li><b>Solve</b>: tap to add a solution curve of the selected differential equation.</li>
      <li><b>Fit</b> zooms to show all visible graphs. Menu → View has the window, grid, axes, equal scaling and background options.</li>
    </ul>
    <h4>3-dim window</h4>
    <ul>
      <li>One finger rotates (or pans in Pan mode), pinch zooms, two fingers pan, twisting two fingers spins around the z-axis.</li>
      <li>Mouse: drag rotates, right-drag or shift-drag pans, scroll zooms. Tap/click a surface to read its coordinates.</li>
      <li>Menu → View → Set view box changes the x/y/z ranges; "Fit to graphs" adapts the box to parametric surfaces and curves.</li>
    </ul>
    <h4>Inventory and parameters</h4>
    <ul>
      <li>Tap the coloured line to show/hide an equation; use the icons to edit, duplicate, delete or open its tools.</li>
      <li>Every unknown letter (a, b, c, …) becomes a parameter with a slider. ▶ animates it; ⚙ sets range, step, mode and speed.</li>
    </ul>
    <h4>Keyboard</h4>
    <ul>
      <li><kbd>+</kbd>/<kbd>-</kbd> zoom, arrow keys pan (or step the trace), <kbd>P</kbd> pan, <kbd>T</kbd> trace, <kbd>Z</kbd> zoom, <kbd>S</kbd> solve, <kbd>F</kbd> fit, <kbd>2</kbd>/<kbd>3</kbd> switch windows, <kbd>A</kbd> add equation, <kbd>Esc</kbd> stop animations.</li>
    </ul>
    <p class="hint">Your work is saved automatically in this browser. Use Menu → Save workspace to keep a file. In Safari use Share → "Add to Home Screen" to run it full screen like an app.</p>`);
  openDialog({ title: 'Using the plotter', body, wide: true });
}
function aboutDialog() {
  const body = el(`
    <p><b>Winplot-style plotter for the web</b> – a touch-friendly 2D and 3D graphing tool for school and university mathematics.</p>
    <p>This is an <b>independent web re-implementation inspired by Winplot</b>, the classic Windows freeware plotter written by <b>Richard (Rick) Parris</b> of <b>Phillips Exeter Academy</b> and distributed as Peanut Software. It is not affiliated with or derived from the original program's code; all features were rebuilt from scratch in HTML5/JavaScript.</p>
    <p>3D rendering uses <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT licence). The expression parser and ODE solver ideas come from the DFIELD web port in this collection.</p>
    <p class="hint">Runs entirely in your browser; nothing is uploaded.</p>`);
  openDialog({ title: 'About', body });
}

// ---------------------------------------------------------------- panel (drawer)
function openPanel() {
  const p = $('panel');
  if (narrow.matches) { p.classList.add('open'); $('scrim').hidden = false; }
  else { p.classList.remove('hidden-wide'); requestAnimationFrame(onResize); }
}
function closePanel() {
  $('panel').classList.remove('open');
  $('scrim').hidden = true;
}
function togglePanel() {
  const p = $('panel');
  if (narrow.matches) { if (p.classList.contains('open')) closePanel(); else openPanel(); }
  else { p.classList.toggle('hidden-wide'); requestAnimationFrame(onResize); }
}

// ---------------------------------------------------------------- init
function onResize() {
  if (state.dim === 2) { plot2.resize(); plot2.render(); }
  else { plot3.resize(); plot3.update(); }
}
function syncAll() {
  syncDimUI();
  setMode2(state.mode2);
  setMode3(state.mode3);
  renderInventory();
  renderParams();
  onResize();
}

function onKey(e) {
  if (e.target.closest('input, select, textarea') || document.querySelector('dialog[open]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const d2 = state.dim === 2;
  if (k === 'Escape') { stopAllAnim(); return; }
  if (k === '2') { setDim(2); return; }
  if (k === '3') { setDim(3); return; }
  if (k === 'a' || k === 'A') { e.preventDefault(); addSheet(); return; }
  if (k === 'f' || k === 'F') { zoomToFit(); return; }
  if (k === '+' || k === '=') { if (d2) plot2.zoomBy(1.25); else plot3.zoom(0.8); return; }
  if (k === '-' || k === '_') { if (d2) plot2.zoomBy(0.8); else plot3.zoom(1.25); return; }
  if (d2) {
    const m = { p: 'pan', t: 'trace', z: 'zoom', s: 'solve' }[k.toLowerCase()];
    if (m) { setMode2(m); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (arrows[k]) {
      e.preventDefault();
      if (state.mode2 === 'trace' && plot2.trace && (k === 'ArrowLeft' || k === 'ArrowRight')) { plot2.stepTrace(arrows[k][0] * (e.shiftKey ? 10 : 1)); return; }
      const v = state.view2, dx = (v.xmax - v.xmin) * 0.1 * arrows[k][0], dy = (v.ymax - v.ymin) * 0.1 * arrows[k][1];
      plot2.setView({ xmin: v.xmin + dx, xmax: v.xmax + dx, ymin: v.ymin + dy, ymax: v.ymax + dy });
    }
  } else {
    const arrows = { ArrowLeft: [0.1, 0], ArrowRight: [-0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] };
    if (arrows[k]) {
      e.preventDefault();
      state.camera3.theta += arrows[k][0];
      state.camera3.phi = Math.max(-1.55, Math.min(1.55, state.camera3.phi + arrows[k][1]));
      plot3.request(); save();
    }
  }
}

function init() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { stored = null; }
  if (stored) state = loadWorkspace(stored);
  else {
    // first start: sine family example in 2D and the saddle in 3D
    state = loadWorkspace(workspaceFromExample(EXAMPLES[0]));
    const ws3 = workspaceFromExample(EXAMPLES.find((e) => e.dim === 3));
    state.eq3 = ws3.eq3.map((e) => ({ ...e, id: state.nextId++ }));
    state.params3 = ws3.params3;
    state.settings3 = ws3.settings3;
    state.dim = 2;
  }
  applyParamsToP();

  document.querySelectorAll('#dimSeg button').forEach((b) => { b.onclick = () => setDim(Number(b.dataset.dim)); });
  document.querySelectorAll('#modeSeg2 button').forEach((b) => { b.onclick = () => setMode2(b.dataset.mode); });
  document.querySelectorAll('#modeSeg3 button').forEach((b) => { b.onclick = () => setMode3(b.dataset.mode); });
  $('btnPanel').onclick = togglePanel;
  $('btnPanelClose').onclick = closePanel;
  $('scrim').onclick = closePanel;
  $('btnAdd').onclick = () => addSheet();
  $('btnExamples').onclick = () => examplesDialog();
  $('btnFit').onclick = () => zoomToFit();
  $('btnMenu').onclick = () => { buildMenu(); $('menuDlg').showModal(); $('menuBody').scrollTop = 0; };
  $('menuDlg').querySelector('[data-close]').onclick = () => $('menuDlg').close();
  $('menuDlg').addEventListener('click', (e) => { if (e.target === $('menuDlg')) $('menuDlg').close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
  $('fileOpen').onchange = (e) => { const f = e.target.files[0]; if (f) openWorkspaceFile(f); e.target.value = ''; };
  narrow.addEventListener('change', () => { closePanel(); onResize(); });
  document.addEventListener('keydown', onKey);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => { if (!e.target.closest('input, .inv-main')) e.preventDefault(); });
  window.addEventListener('pagehide', () => { try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch { /* ignore */ } });

  // iPad: keep dialogs inside the part of the screen not covered by the on-screen keyboard
  const vv = window.visualViewport;
  if (vv) {
    const setVvh = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    vv.addEventListener('resize', setVvh);
    setVvh();
  }
  new ResizeObserver(() => { if (state.dim === 2) { plot2.resize(); plot2.render(); } }).observe($('wrap2'));
  new ResizeObserver(() => { if (state.dim === 3) { plot3.resize(); plot3.update(); } }).observe($('wrap3'));
  if (narrow.matches) closePanel();
  syncAll();
  if (!stored) fitView(EXAMPLES[0].view2);
}

init();

// exposed for automated tests
window.__winplot = {
  get state() { return state; }, plot2, plot3, items, items3, intersect, loadExample, EXAMPLES, setDim, setMode2, P,
  derivativeString, implicitSource, brentRoot, ParseError, VARIABLE_LETTERS,
};
