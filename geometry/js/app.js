// Geometry – touch-first dynamic geometry. Main application (UI, input, persistence).
import {
  Construction, TYPES, catOf, pathProject, pathPoint, valueDistance, pointInPoly, carrierIntersections, P, numericValue,
} from './kernel.js';
import { isValidName } from './expr.js';
import { STR } from './i18n.js';
import { TOOLS, GROUPS, ICONS } from './tools.js';
import { applyMacro, defineMacro, builtinMacros } from './macros.js';
import { EXAMPLES } from './examples.js';
import {
  CanvasBackend, SvgBackend, drawScene, makeTransform, gridStep, fmtNum, measureText, textString,
} from './render.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'geometry.v1';
const MAX_UNDO = 400;
const coarse = matchMedia('(pointer: coarse)');

// ------------------------------------------------------------------ state
const DEFAULT_SETTINGS = { grid: true, axes: false, snap: false, labelSize: 15, decimals: 2, showHidden: false, showAux: false };
const state = {
  c: new Construction(),
  view: null, // { ox, oy, s }
  settings: { ...DEFAULT_SETTINGS },
  tool: 'move',
  groupTool: {},
  picks: [],
  sel: new Set(),
  cand: null,
  pointer: null, // world position for previews
  pointerScreen: null,
  macroMode: null,
  userMacros: [],
  builtin: [],
  traces: new Map(),
  replay: null,
  anim: new Set(),
  undo: [],
  redo: [],
  txn: false,
  current: '',
};
let labelBoxes = [];

// ------------------------------------------------------------------ strings
const fill = (tpl, map) => tpl.replace(/\{(\w+)\}/g, (m, k) => (map[k] !== undefined ? map[k] : m));
function applyStaticStrings() {
  document.querySelectorAll('[data-s]').forEach((el) => {
    const v = el.dataset.s.split('.').reduce((o, k) => (o ? o[k] : undefined), STR);
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('#menuDlg [data-action]').forEach((b) => {
    const v = STR.menu[b.dataset.action];
    if (v) b.textContent = v;
  });
  document.title = STR.appTitle;
  $('btnStatusDone').textContent = STR.ui.done;
  $('btnStatusCancel').textContent = `✕ ${STR.ui.cancel}`;
}

// ------------------------------------------------------------------ persistence & undo
function serialize() { return JSON.stringify(state.c.toJSON()); }
function saveStore() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      construction: state.c.toJSON(), view: state.view, settings: state.settings,
      macros: state.userMacros, groupTool: state.groupTool,
    }));
  } catch { /* quota / private mode */ }
}
let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveStore, 400); }
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!s) return false;
    if (s.settings) Object.assign(state.settings, s.settings);
    if (Array.isArray(s.macros)) state.userMacros = s.macros;
    if (s.groupTool) state.groupTool = s.groupTool;
    if (s.view && Number.isFinite(s.view.s)) state.view = s.view;
    if (s.construction) state.c.load(s.construction);
    return true;
  } catch (e) {
    console.warn('Could not restore construction', e);
    state.c.clear();
    return false;
  }
}

/** Opens an undo step (no-op if a transaction is open). */
function begin() {
  if (state.txn) return;
  state.txn = true;
  state.undo.push(state.current);
  if (state.undo.length > MAX_UNDO) state.undo.shift();
  state.redo = [];
}
/** Closes the transaction; drops it if nothing changed. */
function commit() {
  const now = serialize();
  if (state.txn) {
    state.txn = false;
    if (state.undo[state.undo.length - 1] === now) state.undo.pop();
  }
  state.current = now;
  updateUndoButtons();
  saveSoon();
  renderProtocol();
  requestDraw();
}
function restore(json) {
  const view = state.view;
  state.c.load(JSON.parse(json));
  state.view = view;
  state.current = json;
  state.sel.clear();
  for (const id of [...state.traces.keys()]) if (!state.c.get(id)) state.traces.delete(id);
  for (const id of [...state.anim]) if (!state.c.get(id)) state.anim.delete(id);
}
function undo() {
  cancelInput();
  if (!state.undo.length) return;
  state.redo.push(state.current);
  restore(state.undo.pop());
  commit();
}
function redo() {
  cancelInput();
  if (!state.redo.length) return;
  state.undo.push(state.current);
  restore(state.redo.pop());
  commit();
}
function updateUndoButtons() {
  $('btnUndo').disabled = !state.undo.length;
  $('btnRedo').disabled = !state.redo.length;
}

// ------------------------------------------------------------------ canvas & view
const wrap = $('plotWrap');
const cv = $('cv');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resizeCanvas() {
  const r = wrap.getBoundingClientRect();
  const oldW = W, oldH = H;
  W = Math.max(50, Math.floor(r.width));
  H = Math.max(50, Math.floor(r.height));
  DPR = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  if (!state.view) defaultView();
  else if (oldW && oldH) { state.view.ox += (W - oldW) / 2; state.view.oy += (H - oldH) / 2; }
}
function defaultView() {
  const s = Math.max(20, Math.min(W, H) / 14);
  state.view = { ox: W / 2, oy: H / 2, s };
}
const T = () => makeTransform(state.view);
const toWorld = (p) => ({ x: (p.x - state.view.ox) / state.view.s, y: (state.view.oy - p.y) / state.view.s });
const toScreen = (q) => ({ x: state.view.ox + q.x * state.view.s, y: state.view.oy - q.y * state.view.s });

function zoomAt(sx, sy, f) {
  const v = state.view;
  const ns = Math.min(1e6, Math.max(1e-4, v.s * f));
  f = ns / v.s;
  v.ox = sx - (sx - v.ox) * f;
  v.oy = sy - (sy - v.oy) * f;
  v.s = ns;
  requestDraw();
  saveSoon();
}

function zoomToFit() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const addP = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const o of state.c.objects) {
    const v = o.value;
    if (!v || ((o.hidden || o.condHidden) && !state.settings.showHidden)) continue;
    switch (v.k) {
      case 'pt': addP(v.x, v.y); break;
      case 'line': if (v.kind === 'segment' || v.kind === 'vector') { addP(v.x1, v.y1); addP(v.x2, v.y2); } break;
      case 'circle': case 'arc': if (v.r < 1e4) { addP(v.cx - v.r, v.cy - v.r); addP(v.cx + v.r, v.cy + v.r); } break;
      case 'poly': v.pts.forEach((p) => addP(p.x, p.y)); break;
      case 'locus': v.paths.forEach((pa) => pa.forEach((p) => addP(p.x, p.y))); break;
      case 'text': addP(v.x, v.y); break;
      case 'meas': if (v.pinned) addP(o.params.x, o.params.y); break;
      default: break;
    }
  }
  if (!Number.isFinite(x0)) { defaultView(); requestDraw(); return; }
  let w = x1 - x0, h = y1 - y0;
  if (w < 1e-6 && h < 1e-6) { w = h = 10; x0 -= 5; y0 -= 5; }
  const pad = 0.1;
  const s = Math.min((W * (1 - 2 * pad)) / Math.max(w, 1e-9), (H * (1 - 2 * pad)) / Math.max(h, 1e-9));
  state.view.s = Math.min(Math.max(s, 1e-3), 1e5);
  state.view.ox = W / 2 - ((x0 + x1) / 2) * state.view.s;
  state.view.oy = H / 2 + ((y0 + y1) / 2) * state.view.s;
  requestDraw();
  saveSoon();
}

// ------------------------------------------------------------------ drawing
let drawPending = false;
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => { drawPending = false; draw(); });
}
function sceneState(forExport = false) {
  const tool = activeToolDef();
  const showHidden = state.settings.showHidden || (!forExport && tool && tool.showHidden);
  return {
    c: state.c, view: state.view, W, H,
    settings: { ...state.settings, showHidden },
    sel: forExport ? null : state.sel,
    picked: forExport ? null : new Set([...state.picks, ...(state.macroMode ? [...state.macroMode.inputs, ...state.macroMode.outputs] : [])]),
    cand: forExport ? null : state.cand,
    limit: state.replay ?? Infinity,
    traces: state.traces,
    preview: forExport ? null : computePreview(),
    pointBoost: coarse.matches && !forExport ? 1 : 0,
    showAux: state.settings.showAux,
  };
}
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  labelBoxes = drawScene(new CanvasBackend(ctx), sceneState());
}

// ------------------------------------------------------------------ hit testing
function hitRadius(ptype) { return ptype === 'touch' ? 22 : ptype === 'pen' ? 13 : 8; }
function visibleForHit(o, i) {
  if (!o.value) return false;
  if (state.replay !== null && i >= state.replay) return false;
  const tool = activeToolDef();
  const hidden = o.hidden || o.condHidden;
  if (hidden && !(state.settings.showHidden || (tool && tool.showHidden))) return false;
  return true;
}
/** Objects near screen point p, ordered by priority. Each: { o, d, via } */
function hitTest(p, ptype) {
  const R = hitRadius(ptype);
  const w = toWorld(p);
  const s = state.view.s;
  const pts = [], curves = [], labels = [], areas = [];
  state.c.objects.forEach((o, i) => {
    if (!visibleForHit(o, i)) return;
    const v = o.value;
    const cat = catOf(state.c, o);
    if (cat === 'point') {
      const d = valueDistance(v, w) * s;
      if (d <= R + 2) pts.push({ o, d, via: 'shape' });
    } else if (['line', 'circle', 'arc', 'poly', 'locus'].includes(cat)) {
      const d = valueDistance(v, w) * s;
      if (d <= R) curves.push({ o, d, via: 'shape' });
      else if (v.k === 'poly' && pointInPoly(v.pts, w)) areas.push({ o, d: R + 1, via: 'area' });
      else if (v.k === 'circle' && o.style.fill > 0 && Math.hypot(w.x - v.cx, w.y - v.cy) < v.r) areas.push({ o, d: R + 1, via: 'area' });
    } else if (o.type === 'angle') {
      const x = toScreen(v.anchor);
      const d = Math.hypot(p.x - x.x, p.y - x.y);
      if (d < 30) {
        const a = Math.atan2(-(p.y - x.y), p.x - x.x);
        const rel = ((a - v.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (rel <= v.s) curves.push({ o, d: Math.abs(d - 26), via: 'shape' });
      }
    }
  });
  const pad = ptype === 'touch' ? 6 : 2;
  for (const b of labelBoxes) {
    if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
      const o = state.c.get(b.id);
      if (o) labels.push({ o, d: 0, via: 'label', box: b });
    }
  }
  pts.sort((a, b) => a.d - b.d);
  curves.sort((a, b) => a.d - b.d);
  areas.sort((a, b) => Math.abs(polyAreaOf(a.o)) - Math.abs(polyAreaOf(b.o)));
  // labels of measurements/texts come first if no point is under the finger
  const measLabels = labels.filter((h) => ['meas', 'text'].includes(catOf(state.c, h.o)));
  const nameLabels = labels.filter((h) => !['meas', 'text'].includes(catOf(state.c, h.o)));
  return [...pts, ...measLabels, ...curves, ...nameLabels, ...areas];
}
function polyAreaOf(o) {
  const v = o.value;
  if (!v) return 0;
  if (v.k === 'poly') { let a = 0; for (let i = 0; i < v.pts.length; i++) { const p = v.pts[i], q = v.pts[(i + 1) % v.pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  if (v.k === 'circle') return Math.PI * v.r * v.r;
  return 0;
}

// ------------------------------------------------------------------ tools
function macroById(mid) {
  if (!mid) return null;
  const [kind, idx] = [mid[0], Number(mid.slice(1))];
  return kind === 'b' ? state.builtin[idx] : state.userMacros[idx];
}
const CAT_KIND = { point: 'point', line: 'line', circle: 'circle', arc: 'curve', poly: 'poly', meas: 'meas', locus: 'trans', text: 'any' };
function activeToolDef() {
  if (state.tool.startsWith('macro:')) {
    const m = macroById(state.tool.slice(6));
    if (!m) return null;
    return {
      macro: m,
      alts: [{ in: m.inputs.map((i) => CAT_KIND[i.cat] || 'any'), make: (ids, api) => api.applyMacro(m, ids) }],
    };
  }
  return TOOLS[state.tool] || null;
}
function toolLabel(id = state.tool) {
  if (id.startsWith('macro:')) { const m = macroById(id.slice(6)); return m ? m.name : ''; }
  return STR.tools[id] || id;
}

function matches(kind, o) {
  if (!o || !o.value) return false;
  const cat = catOf(state.c, o);
  const v = o.value;
  switch (kind) {
    case 'point': return cat === 'point';
    case 'line': return cat === 'line';
    case 'segment': case 'vecline': return cat === 'line' && (v.kind === 'segment' || v.kind === 'vector');
    case 'curve': return cat === 'circle' || cat === 'arc';
    case 'circle': return cat === 'circle';
    case 'cutter': return cat === 'line' || cat === 'circle' || cat === 'arc';
    case 'path': return cat === 'line' || cat === 'circle' || cat === 'arc' || cat === 'poly';
    case 'poly': return cat === 'poly';
    case 'area': return cat === 'poly' || cat === 'circle' || cat === 'arc';
    case 'lengthable': return (cat === 'line' && (v.kind === 'segment' || v.kind === 'vector')) || cat === 'circle' || cat === 'arc' || cat === 'poly';
    case 'trans': return ['point', 'line', 'circle', 'arc', 'poly', 'locus'].includes(cat);
    case 'onpoint': return o.type === 'onobj';
    case 'meas': return cat === 'meas';
    case 'any': return true;
    default: return false;
  }
}

/** Alternatives consistent with the picks so far. */
function openAlts(tool = activeToolDef(), picks = state.picks) {
  if (!tool || !tool.alts) return [];
  if (tool.polygon) return tool.alts;
  return tool.alts.filter((a) => a.in.length > picks.length && picks.every((id, i) => matches(a.in[i], state.c.get(id))));
}
function nextKinds() {
  const tool = activeToolDef();
  if (tool && tool.polygon) return ['point'];
  return [...new Set(openAlts().map((a) => a.in[state.picks.length]))];
}

function promptText() {
  if (state.macroMode) return state.macroMode.stage === 'inputs' ? STR.status.macroInputs : STR.status.macroOutputs;
  if (state.replay !== null) return STR.status.replay(state.replay, state.c.objects.length);
  const tool = activeToolDef();
  if (state.tool === 'move') return STR.tp.move[0];
  if (!tool) return STR.ready;
  const k = state.picks.length;
  if (tool.macro) {
    const kind = nextKinds()[0];
    return STR.status.macroApply(tool.macro.name, STR.kinds[kind] || kind, k + 1, tool.macro.inputs.length);
  }
  const custom = STR.tp[state.tool];
  if (custom) {
    if (state.tool === 'polygon') return `${toolLabel()}: ${custom[Math.min(k, custom.length - 1)]}`;
    if (custom[k]) return `${toolLabel()}: ${custom[k]}`;
  }
  const kinds = nextKinds();
  let phrase = kinds.map((kd) => STR.kinds[kd] || kd).join(` ${STR.or} `);
  if (k > 0 && kinds.length === 1) {
    const prevSame = state.picks.filter((id) => matches(kinds[0], state.c.get(id))).length;
    if (prevSame > 0) phrase = phrase.replace(/^an? /, `the ${STR.ordinals[prevSame] || 'next'} `);
  }
  return `${toolLabel()}: ${STR.select} ${phrase}`;
}
let statusFlash = 0;
function setStatus(msg, warn = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
  clearTimeout(statusFlash);
  if (warn || msg !== promptText()) statusFlash = setTimeout(updateStatus, warn ? 2600 : 3200);
}
function updateStatus() {
  const el = $('status');
  el.textContent = promptText();
  el.classList.remove('warn');
  const tool = activeToolDef();
  $('btnStatusDone').hidden = !((tool && tool.polygon && state.picks.length >= 3) || state.macroMode);
  if (state.macroMode) $('btnStatusDone').textContent = state.macroMode.stage === 'inputs' ? STR.ui.next : STR.ui.done;
  else $('btnStatusDone').textContent = STR.ui.done;
  $('btnStatusCancel').hidden = !(state.picks.length || state.macroMode || state.replay !== null || state.anim.size);
}

function setTool(id) {
  cancelInput();
  stopReplay();
  state.tool = id;
  const g = groupOf(id);
  if (g && g !== 'move') state.groupTool[g] = id;
  state.cand = null;
  renderToolStrip();
  updateStatus();
  saveSoon();
  requestDraw();
  cv.className = id === 'move' ? 'c-move' : '';
}
function groupOf(id) {
  if (id.startsWith('macro:')) return 'macros';
  return TOOLS[id] ? TOOLS[id].group : null;
}

/** Cancels the current tool input. Objects already created stay (part of the undo step). */
function cancelInput() {
  state.picks = [];
  if (state.macroMode) state.macroMode = null;
  if (state.txn) commit();
  updateStatus();
  requestDraw();
}

// ------------------------------------------------------------------ creation API (used by tools)
function makeApi(pos) {
  const created = [];
  const api = {
    STR,
    c: state.c,
    pos,
    created,
    add(def) {
      begin();
      const o = state.c.add(def);
      created.push(o);
      return o;
    },
    pointOn(pathId) {
      const path = state.c.get(pathId);
      const t = pathProject(path.value, pos);
      return api.add({ type: 'onobj', parents: [pathId], params: { t } });
    },
    intersectAll(a, b) {
      const out = [];
      const va = state.c.get(a).value, vb = state.c.get(b).value;
      const { slots, pts } = carrierIntersections(va, vb);
      if (!slots) { setStatus(STR.status.noIsect, true); return []; }
      for (let w = 0; w < slots; w++) {
        if (existingIsect(a, b, w)) continue;
        const tmp = { parents: [a, b], params: { which: w } };
        const v = TYPES.isect.compute([va, vb], tmp, state.c.ctx());
        if (!v) continue;
        if (slots === 2 && pts.length === 2 && Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) < 1e-9 && w === 1) continue;
        out.push(api.add({ type: 'isect', parents: [a, b], params: { which: w } }));
      }
      if (!out.length && !pts.length) setStatus(STR.status.noIsect, true);
      return out;
    },
    tangents(p, k) {
      const out = [];
      for (let w = 0; w < 2; w++) {
        const o = api.add({ type: 'tangent', parents: [p, k], params: { which: w } });
        out.push(o);
        const v = o.value;
        if (w === 0 && v && !v.touch) break; // point on circle: single tangent
      }
      return out;
    },
    transform(type, ids, params = {}) {
      const src = state.c.get(ids[0]);
      const def = { type, parents: ids, params };
      let nm = `${src.name}'`;
      if (catOf(state.c, src) === 'point' || catOf(state.c, src) === 'poly') { if (!state.c.byName(nm) && isValidName(nm)) def.name = nm; }
      def.style = { ...src.style };
      if (catOf(state.c, src) === 'point') def.style.color = '#37474f';
      if (src.showLabel !== undefined) def.showLabel = src.showLabel;
      nm = null;
      return api.add(def);
    },
    applyMacro(m, ids) {
      begin();
      const objs = applyMacro(state.c, m, ids, (d) => state.c.add(d));
      const outs = objs.filter((o) => !o.aux);
      created.push(...outs);
      return outs;
    },
    toggleTrace(id) {
      const o = state.c.get(id);
      begin();
      o.trace = !o.trace;
      if (!o.trace) state.traces.delete(id);
      setStatus(o.trace ? STR.status.traceOn(o.name) : STR.status.traceOff(o.name));
      return [];
    },
    toggleAnimate(id) { toggleAnimation(id); return []; },
    toggleHidden(id) { const o = state.c.get(id); begin(); o.hidden = !o.hidden; return []; },
    toggleLabel(id) { const o = state.c.get(id); begin(); o.showLabel = !o.showLabel; return []; },
    properties(id) { setTimeout(() => propertiesDialog(state.c.get(id)), 0); return []; },
    deleteObj(id) { setTimeout(() => deleteWithConfirm([id]), 0); return []; },
    askInt: (title, label, def, min, max) => askInt(title, label, def, min, max),
    askExpr: (title, label, def) => askExpr(title, label, def),
    askCalc: () => askCalc(),
    askText: () => askText(),
  };
  return Object.assign(api, toolMemory);
}
const toolMemory = {};

function existingIsect(a, b, w) {
  return state.c.objects.find((o) => o.type === 'isect' && (o.params.which || 0) === w && o.parents[0] === a && o.parents[1] === b);
}

function snapWorld(w) {
  if (!state.settings.snap) return w;
  const st = gridStep(state.view.s);
  return { x: Math.round(w.x / st) * st, y: Math.round(w.y / st) * st };
}

/** Finds an intersection of two curves near screen point p. Returns { a, b, which, pt } or null. */
function intersectionNear(p, hits, R) {
  const curves = hits.filter((h) => h.via === 'shape' && matches('cutter', h.o)).slice(0, 4);
  let best = null;
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const a = curves[i].o, b = curves[j].o;
      const { slots } = carrierIntersections(a.value, b.value);
      for (let w = 0; w < slots; w++) {
        const v = TYPES.isect.compute([a.value, b.value], { parents: [a.id, b.id], params: { which: w } }, state.c.ctx());
        if (!v) continue;
        const s = toScreen(v);
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d <= R * 1.3 && (!best || d < best.d)) best = { a: a.id, b: b.id, which: w, d };
      }
    }
  }
  return best;
}

/** Creates (or finds) a point for a tap at screen p: existing, intersection, on object, or free. */
function smartPoint(p, hits, ptype, api, allowNew = true) {
  const ph = hits.find((h) => h.via === 'shape' && catOf(state.c, h.o) === 'point');
  if (ph) return ph.o;
  if (!allowNew) return null;
  const R = hitRadius(ptype);
  const ix = intersectionNear(p, hits, R);
  if (ix) {
    const ex = existingIsect(ix.a, ix.b, ix.which);
    if (ex) return ex;
    return api.add({ type: 'isect', parents: [ix.a, ix.b], params: { which: ix.which } });
  }
  const path = hits.find((h) => h.via === 'shape' && matches('path', h.o));
  if (path) {
    const w = toWorld(p);
    return api.add({ type: 'onobj', parents: [path.o.id], params: { t: pathProject(path.o.value, w) } });
  }
  const w = snapWorld(toWorld(p));
  return api.add({ type: 'free', params: { x: w.x, y: w.y } });
}

/** Best acceptable hit for the current tool (for highlighting). */
function candidateFor(hits) {
  if (state.macroMode) return hits[0] ? hits[0].o.id : null;
  const tool = activeToolDef();
  if (state.tool === 'move') {
    const d = draggableTarget(hits);
    return d ? d.o.id : hits[0] ? hits[0].o.id : null;
  }
  if (!tool) return null;
  const kinds = nextKinds();
  for (const h of hits) {
    if (state.picks.includes(h.o.id) && !(tool.polygon && h.o.id === state.picks[0] && state.picks.length >= 3)) continue;
    if (h.via === 'label' && catOf(state.c, h.o) !== 'meas' && catOf(state.c, h.o) !== 'text') continue;
    if (kinds.some((k) => matches(k, h.o))) return h.o.id;
  }
  if (kinds.includes('point')) {
    const path = hits.find((h) => h.via === 'shape' && matches('path', h.o));
    if (path && state.tool !== 'locus') return path.o.id;
  }
  return null;
}

let busy = false;
async function toolTap(p, ptype) {
  if (busy) return;
  const tool = activeToolDef();
  if (!tool) return;
  const hits = hitTest(p, ptype);
  const api = makeApi(snapWorld(toWorld(p)));
  // intersection tool: tapping right at a crossing creates that point
  if (state.tool === 'intersect' && !state.picks.length) {
    const ix = intersectionNear(p, hits, hitRadius(ptype));
    if (ix) {
      if (!existingIsect(ix.a, ix.b, ix.which)) api.add({ type: 'isect', parents: [ix.a, ix.b], params: { which: ix.which } });
      finishTool(api.created);
      return;
    }
  }
  const kinds = nextKinds();
  let picked = null;
  const usable = (h) => !(h.via === 'label' && !['meas', 'text'].includes(catOf(state.c, h.o)));
  // polygon closing
  if (tool.polygon && state.picks.length >= 3) {
    const first = hits.find((h) => h.o.id === state.picks[0] && h.via === 'shape');
    if (first) { await completeWith(tool.alts[0], api); return; }
  }
  // 1. existing point if a point is acceptable
  if (kinds.includes('point') || kinds.includes('trans') || kinds.includes('onpoint') || kinds.includes('any')) {
    const ph = hits.find((h) => h.via === 'shape' && catOf(state.c, h.o) === 'point' && kinds.some((k) => matches(k, h.o)));
    if (ph) picked = ph.o;
  }
  // 2. another accepted object
  if (!picked) {
    const oh = hits.find((h) => usable(h) && kinds.some((k) => k !== 'point' && k !== 'place' && matches(k, h.o)) && !state.picks.includes(h.o.id));
    if (oh) picked = oh.o;
  }
  // 3. a new point
  if (!picked && kinds.includes('point')) picked = smartPoint(p, hits, ptype, api, true);
  // 4. a position
  if (!picked && kinds.includes('place')) { await completeWith(openAlts()[0], api); return; }
  if (!picked) {
    setStatus(STR.status.notAccepted(kinds.map((k) => STR.kinds[k] || k).join(` ${STR.or} `)), true);
    if (state.txn && !state.picks.length) commit();
    return;
  }
  if (state.picks.includes(picked.id)) { setStatus(STR.status.samePick, true); return; }
  state.picks.push(picked.id);
  const done = tool.polygon ? null
    : tool.alts.find((a) => a.in.length === state.picks.length && state.picks.every((id, i) => matches(a.in[i], state.c.get(id))));
  if (done) { await completeWith(done, api); return; }
  if (!tool.polygon && !openAlts().length) { cancelInput(); return; }
  updateStatus();
  requestDraw();
}

async function completeWith(alt, api) {
  const ids = [...state.picks];
  busy = true;
  let res;
  try {
    res = await alt.make(ids, api);
    for (const k of ['lastN', 'lastR', 'lastAngle', 'lastFactor']) if (api[k] !== undefined) toolMemory[k] = api[k];
  } catch (e) {
    console.error(e);
    setStatus(String(e.message || e), true);
  } finally {
    busy = false;
  }
  finishTool(res === null ? null : api.created);
}
function finishTool(created) {
  state.picks = [];
  const tool = activeToolDef();
  commit();
  updateStatus();
  if (created && created.length && !(tool && tool.action)) {
    setStatus(STR.status.created(created.map((o) => o.name).join(', ')));
  }
}

function computePreview() {
  const tool = activeToolDef();
  if (!tool || !state.pointer || !state.picks.length) return null;
  const vals = state.picks.map((id) => state.c.get(id) && state.c.get(id).value);
  if (vals.some((v) => !v)) return null;
  // snap preview to an existing point under the pointer
  let pv = P(state.pointer.x, state.pointer.y);
  if (state.cand) {
    const o = state.c.get(state.cand);
    if (o && o.value && o.value.k === 'pt') pv = o.value;
  }
  if (tool.polygon) return [{ k: 'poly', pts: [...vals, pv] }];
  const out = [];
  for (const alt of openAlts()) {
    if (alt.in.length !== state.picks.length + 1 || alt.in[alt.in.length - 1] !== 'point') continue;
    const type = alt.pv || alt.pvRev;
    if (!type) continue;
    const args = alt.pvRev ? [pv, ...vals] : [...vals, pv];
    try {
      const v = TYPES[type].compute(args, { parents: [], params: { n: toolMemory.lastN || 4 } }, state.c.ctx());
      if (v) out.push(v);
    } catch { /* ignore */ }
  }
  return out;
}

// ------------------------------------------------------------------ dragging (move tool)
function freeRoots(o) {
  const anc = state.c.ancestors([o.id]);
  const roots = [];
  for (const id of anc) {
    const x = state.c.get(id);
    if (!state.c.allParents(x).length) {
      if (x.type !== 'free' || x.fixed) return null;
      roots.push(x);
    }
  }
  return roots.length ? roots : null;
}
function draggableTarget(hits) {
  for (const h of hits) {
    const o = h.o;
    const cat = catOf(state.c, o);
    if (h.via === 'label') return { kind: 'label', o, box: h.box };
    if (cat === 'point') {
      if ((o.type === 'free' || o.type === 'onobj') && !o.fixed) return { kind: 'point', o };
      continue;
    }
    if (h.via === 'shape' || h.via === 'area') {
      if (['line', 'circle', 'arc', 'poly', 'locus'].includes(cat)) {
        const roots = freeRoots(o);
        if (roots) return { kind: 'translate', o, roots };
      }
    }
  }
  return null;
}

function startDrag(g) {
  const t = g.target;
  const w = toWorld({ x: g.x0, y: g.y0 });
  g.type = 'drag';
  g.changed = false;
  if (t.kind === 'point') {
    g.recalc = state.c.descendants([t.o.id]);
    if (t.o.type === 'free') g.off = { x: w.x - t.o.params.x, y: w.y - t.o.params.y };
  } else if (t.kind === 'translate') {
    g.recalc = state.c.descendants(t.roots.map((r) => r.id));
    g.start = t.roots.map((r) => ({ o: r, x: r.params.x, y: r.params.y }));
  } else if (t.kind === 'label') {
    const o = t.o;
    g.pinned = o.type === 'calc' || o.type === 'text';
    g.lab0 = o.label ? { ...o.label } : { dx: 0, dy: 0 };
    if (g.pinned) g.pos0 = { x: o.params.x, y: o.params.y };
    if (o.type === 'text' && !o.label) g.lab0 = null;
  }
  cv.className = 'c-grabbing';
}
function dragTo(g, p) {
  const t = g.target;
  if (!g.changed) { begin(); g.changed = true; }
  const w = toWorld(p);
  if (t.kind === 'point') {
    const o = t.o;
    if (o.type === 'free') {
      const q = snapWorld({ x: w.x - g.off.x, y: w.y - g.off.y });
      o.params.x = q.x; o.params.y = q.y;
    } else {
      const path = state.c.get(o.parents[0]);
      if (!path.value) return;
      o.params.t = pathProject(path.value, w);
    }
    state.c.recompute(g.recalc);
    showCoords(o.value);
  } else if (t.kind === 'translate') {
    const w0 = toWorld({ x: g.x0, y: g.y0 });
    let dx = w.x - w0.x, dy = w.y - w0.y;
    if (state.settings.snap) {
      const st = gridStep(state.view.s);
      dx = Math.round(dx / st) * st; dy = Math.round(dy / st) * st;
    }
    for (const s of g.start) { s.o.params.x = s.x + dx; s.o.params.y = s.y + dy; }
    state.c.recompute(g.recalc);
  } else if (t.kind === 'label') {
    const o = t.o;
    if (g.pinned) {
      const w0 = toWorld({ x: g.x0, y: g.y0 });
      o.params.x = g.pos0.x + (w.x - w0.x); o.params.y = g.pos0.y + (w.y - w0.y);
      state.c.recompute(new Set([o.id]));
    } else {
      o.label = { dx: g.lab0.dx + (p.x - g.x0), dy: g.lab0.dy + (p.y - g.y0) };
      if (catOf(state.c, o) === 'point' && !g.lab0.dx && !g.lab0.dy && !g.labInit) {
        g.labInit = true;
        g.lab0 = { dx: 9, dy: -13 };
        o.label = { dx: 9 + (p.x - g.x0), dy: -13 + (p.y - g.y0) };
      }
    }
  }
  recordTraces();
  requestDraw();
}
function endDrag(g) {
  cv.className = state.tool === 'move' ? 'c-move' : '';
  if (g.changed) commit();
}

function recordTraces() {
  for (const o of state.c.objects) {
    if (!o.trace || !o.value) continue;
    let arr = state.traces.get(o.id);
    if (!arr) { arr = []; state.traces.set(o.id, arr); }
    const v = o.value;
    const last = arr[arr.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(v)) continue;
    arr.push(JSON.parse(JSON.stringify(v)));
    if (arr.length > (v.k === 'pt' ? 6000 : 1500)) arr.shift();
  }
}

// ------------------------------------------------------------------ animation
let animRaf = 0, animLast = 0;
function toggleAnimation(id) {
  const o = state.c.get(id);
  if (!o || o.type !== 'onobj') return;
  if (state.anim.has(id)) { state.anim.delete(id); commit(); } else {
    state.anim.add(id);
    o._dir = o._dir || 1;
    setStatus(STR.status.animating(o.name));
  }
  if (state.anim.size && !animRaf) { animLast = performance.now(); animRaf = requestAnimationFrame(animStep); }
  updateStatus();
}
function stopAnimations() {
  if (!state.anim.size) return;
  state.anim.clear();
  commit();
}
function animStep(now) {
  animRaf = 0;
  if (!state.anim.size) return;
  const dt = Math.min(0.05, (now - animLast) / 1000);
  animLast = now;
  const ids = [];
  for (const id of state.anim) {
    const o = state.c.get(id);
    if (!o) { state.anim.delete(id); continue; }
    const path = state.c.get(o.parents[0]);
    if (!path || !path.value) continue;
    const v = path.value;
    const t = o.params.t ?? 0;
    if (v.k === 'circle') {
      o.params.t = (t + dt * 0.7) % (2 * Math.PI);
    } else if (v.k === 'poly') {
      o.params.t = (t + dt * 0.35) % v.pts.length;
    } else {
      let lo = 0, hi = 1;
      if (v.k === 'line' && v.kind === 'line') { lo = -2; hi = 3; } else if (v.k === 'line' && v.kind === 'ray') { lo = 0; hi = 4; }
      let nt = t + o._dir * dt * 0.25 * (hi - lo) / 2;
      if (nt > hi) { nt = hi; o._dir = -1; }
      if (nt < lo) { nt = lo; o._dir = 1; }
      o.params.t = nt;
    }
    ids.push(id);
  }
  state.c.recompute(state.c.descendants(ids));
  recordTraces();
  requestDraw();
  animRaf = requestAnimationFrame(animStep);
}

// ------------------------------------------------------------------ pointer input
const pointers = new Map();
let gesture = null;
let lastTap = null;
function localPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function slopOf(ptype) { return ptype === 'touch' ? 10 : ptype === 'pen' ? 6 : 4; }
function showCoords(v) {
  if (!v) { $('coords').textContent = ''; return; }
  const d = Math.max(2, state.settings.decimals);
  $('coords').textContent = `x = ${fmtNum(v.x, d)}   y = ${fmtNum(v.y, d)}`;
}

function onPointerDown(e) {
  closeGroupPop();
  if (busy) return;
  try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    if (gesture && gesture.type === 'drag') endDrag(gesture);
    clearTimeout(gesture && gesture.lpTimer);
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', a0: { ...a }, b0: { ...b }, view0: { ...state.view } };
    state.cand = null;
    requestDraw();
    return;
  }
  if (pointers.size > 2) return;
  if (e.button === 2) {
    const hits = hitTest(p, e.pointerType);
    if (hits.length) openContextMenu(hits[0].o, e.clientX, e.clientY);
    gesture = { type: 'done' };
    return;
  }
  const hits = hitTest(p, e.pointerType);
  gesture = { type: 'pending', id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, ptype: e.pointerType, hits };
  if (state.tool === 'move' && !state.macroMode) gesture.target = draggableTarget(hits);
  state.cand = candidateFor(hits);
  state.pointer = toWorld(p);
  state.pointerScreen = p;
  if (hits.length && state.replay === null) {
    const target = hits[0].o;
    const cx = e.clientX, cy = e.clientY;
    gesture.lpTimer = setTimeout(() => {
      if (gesture && gesture.type === 'pending') {
        gesture.type = 'done';
        state.cand = null;
        openContextMenu(target, cx, cy);
      }
    }, 520);
  }
  requestDraw();
}

function onPointerMove(e) {
  const p = localPos(e);
  if (!pointers.has(e.pointerId)) {
    // hover (mouse / pen without contact)
    if (e.pointerType === 'touch' || busy) return;
    const hits = hitTest(p, e.pointerType);
    const cand = candidateFor(hits);
    state.pointer = toWorld(p);
    state.pointerScreen = p;
    if (state.tool === 'move') {
      const t = draggableTarget(hits);
      cv.className = t ? 'c-grab' : (hits.length ? 'c-pointer' : 'c-move');
    }
    state.cand = cand;
    showCoords(snapWorld(state.pointer));
    requestDraw();
    return;
  }
  pointers.set(e.pointerId, p);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') {
    const [a, b] = [...pointers.values()];
    if (!b) return;
    const d0 = Math.hypot(g.b0.x - g.a0.x, g.b0.y - g.a0.y) || 1;
    const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const v0 = g.view0;
    const s = Math.min(1e6, Math.max(1e-4, v0.s * (d1 / d0)));
    const m0 = { x: (g.a0.x + g.b0.x) / 2, y: (g.a0.y + g.b0.y) / 2 };
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const wx = (m0.x - v0.ox) / v0.s, wy = (v0.oy - m0.y) / v0.s;
    state.view = { ox: m1.x - wx * s, oy: m1.y + wy * s, s };
    requestDraw();
    return;
  }
  if (g.id !== e.pointerId) return;
  g.x = p.x; g.y = p.y;
  state.pointer = toWorld(p);
  state.pointerScreen = p;
  if (g.type === 'pending' && Math.hypot(p.x - g.x0, p.y - g.y0) > slopOf(g.ptype)) {
    clearTimeout(g.lpTimer);
    if (state.replay !== null) g.type = 'pan';
    else if (state.tool === 'move' && !state.macroMode && g.target) startDrag(g);
    else if (state.tool !== 'move' && !state.macroMode && state.cand && dragPickable()) {
      g.type = 'dragpick';
      toolTap({ x: g.x0, y: g.y0 }, g.ptype);
    } else g.type = 'pan';
    if (g.type === 'pan') { g.view0 = { ...state.view }; state.cand = null; }
  }
  if (g.type === 'drag') dragTo(g, p);
  else if (g.type === 'pan') {
    state.view.ox = g.view0.ox + (p.x - g.x0);
    state.view.oy = g.view0.oy + (p.y - g.y0);
    requestDraw();
  } else if (g.type === 'dragpick' || g.type === 'pending') {
    if (state.tool !== 'move') state.cand = candidateFor(hitTest(p, g.ptype));
    showCoords(snapWorld(state.pointer));
    requestDraw();
  }
}
/** Drag-to-create: pressing on an acceptable object and dragging picks it and uses the release point as next input. */
function dragPickable() {
  const tool = activeToolDef();
  if (!tool || tool.action || tool.polygon) return false;
  const alts = openAlts();
  return alts.some((a) => a.in.length >= state.picks.length + 2 && a.in[state.picks.length + 1] === 'point');
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  clearTimeout(g.lpTimer);
  if (g.type === 'pinch') {
    gesture = pointers.size ? { type: 'done' } : null;
    saveSoon();
    return;
  }
  if (g.type === 'done') { if (!pointers.size) gesture = null; return; }
  if (g.id !== e.pointerId) return;
  gesture = null;
  const cancelled = e.type === 'pointercancel';
  const p = { x: g.x, y: g.y };
  if (g.type === 'drag') { endDrag(g); if (g.ptype === 'touch') state.cand = null; requestDraw(); return; }
  if (g.type === 'pan') { saveSoon(); requestDraw(); return; }
  if (cancelled) { state.cand = null; requestDraw(); return; }
  if (g.type === 'dragpick') {
    if (g.ptype === 'touch') state.cand = null;
    toolTap(p, g.ptype);
    return;
  }
  // tap
  handleTap(p, g);
  if (g.ptype === 'touch') { state.cand = null; state.pointer = null; }
  requestDraw();
}

function handleTap(p, g) {
  if (state.replay !== null) return;
  const hits = g.hits;
  if (state.macroMode) { macroModeTap(hits); return; }
  if (state.tool === 'move') {
    const h = hits[0];
    const now = performance.now();
    if (h) {
      if (lastTap && lastTap.id === h.o.id && now - lastTap.t < 380) { lastTap = null; propertiesDialog(h.o); return; }
      lastTap = { id: h.o.id, t: now };
      state.sel = new Set([h.o.id]);
      setStatus(STR.status.selected(describe(h.o)));
      if (h.o.value && h.o.value.k === 'pt') showCoords(h.o.value);
    } else {
      lastTap = null;
      if (state.sel.size) { state.sel.clear(); updateStatus(); }
    }
    renderProtocol();
    return;
  }
  toolTap(p, g.ptype);
}

function onWheel(e) {
  e.preventDefault();
  const p = localPos(e);
  const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015));
  zoomAt(p.x, p.y, f);
}

// ------------------------------------------------------------------ descriptions
function nameOf(id) { const o = state.c.get(id); return o ? o.name : '?'; }
function describe(o) {
  const tpl = STR.desc[o.type] || '{name}';
  const map = { name: o.name, all: o.parents.map(nameOf).join(o.type === 'polygon' ? '' : ', '), first: o.parents.slice(0, -1).map(nameOf).join(''), last: nameOf(o.parents[o.parents.length - 1]), rest: o.parents.slice(1).map(nameOf).join(''), n: o.params.n, r: o.params.r, angle: o.params.angle, factor: o.params.factor, expr: o.params.expr, text: (o.params.text || '').replace(/\n/g, ' ').slice(0, 40) };
  o.parents.forEach((id, i) => { map[i] = nameOf(id); });
  if (o.type === 'midpoint' || o.type === 'perpbis') map.all = o.parents.length === 2 ? o.parents.map(nameOf).join('') : nameOf(o.parents[0]);
  return fill(tpl, map);
}
function valueText(o) {
  const v = o.value;
  if (!v) return STR.ui.undefined;
  const d = state.settings.decimals;
  switch (v.k) {
    case 'pt': return `(${fmtNum(v.x, d)}, ${fmtNum(v.y, d)})`;
    case 'meas': return measureText(state.c, o, d).replace(/^.*? = /, '');
    case 'text': return '';
    default: {
      const n = numericValue(o);
      if (n === undefined || Number.isNaN(n)) return '';
      if (v.k === 'line') return `${STR.desc.length.split(' ')[0].toLowerCase()} ${fmtNum(n, d)}`;
      if (v.k === 'circle') return `r = ${fmtNum(n, d)}`;
      if (v.k === 'poly') return `A = ${fmtNum(n, d)}`;
      return fmtNum(n, d);
    }
  }
}

// ------------------------------------------------------------------ protocol panel
function renderProtocol() {
  const ol = $('protocol');
  const objs = state.c.objects;
  const slider = $('replaySlider');
  slider.max = String(objs.length);
  slider.value = String(state.replay ?? objs.length);
  $('replayInfo').textContent = state.replay !== null ? STR.status.replay(state.replay, objs.length) : '';
  ol.innerHTML = '';
  if (!objs.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = STR.ui.noObjects;
    ol.append(li);
    return;
  }
  const frag = document.createDocumentFragment();
  objs.forEach((o, i) => {
    if (o.aux && !state.settings.showAux) return;
    const li = document.createElement('li');
    li.dataset.id = o.id;
    if (state.sel.has(o.id)) li.classList.add('sel');
    if (state.replay !== null && i >= state.replay) li.classList.add('future');
    if (state.replay !== null && i === state.replay - 1) li.classList.add('current');
    if (!o.value) li.classList.add('undef');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = o.style.color;
    const txt = document.createElement('span');
    txt.className = 'txt';
    const b = document.createElement('b');
    b.textContent = o.name;
    const val = document.createElement('span');
    val.className = 'val';
    const vt = valueText(o);
    val.textContent = vt ? `  ${vt}` : '';
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = describe(o);
    txt.append(b, val, desc);
    const eye = document.createElement('button');
    eye.className = `eye${o.hidden ? ' off' : ''}`;
    eye.title = o.hidden ? STR.ui.show : STR.ui.hide;
    eye.setAttribute('aria-label', eye.title);
    eye.dataset.eye = o.id;
    eye.innerHTML = o.hidden
      ? '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><path d="M4 20 20 4"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    li.append(num, sw, txt, eye);
    frag.append(li);
  });
  ol.append(frag);
  const selLi = ol.querySelector('li.sel, li.current');
  if (selLi && selLi.scrollIntoViewIfNeeded) selLi.scrollIntoViewIfNeeded(false);
}
function onProtocolClick(e) {
  const eye = e.target.closest('[data-eye]');
  if (eye) {
    const o = state.c.get(Number(eye.dataset.eye));
    if (!o) return;
    begin();
    o.hidden = !o.hidden;
    commit();
    return;
  }
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const o = state.c.get(Number(li.dataset.id));
  if (!o) return;
  if (state.replay !== null) {
    state.replay = state.c.index(o.id) + 1;
    renderProtocol();
    updateStatus();
    requestDraw();
    return;
  }
  if (state.sel.has(o.id) && state.sel.size === 1) { propertiesDialog(o); return; }
  state.sel = new Set([o.id]);
  setStatus(STR.status.selected(describe(o)));
  renderProtocol();
  requestDraw();
}

// ------------------------------------------------------------------ replay
let replayTimer = 0;
function setReplay(k) {
  const n = state.c.objects.length;
  cancelInput();
  if (k === null || k >= n) { stopReplay(); return; }
  state.replay = Math.max(0, Math.min(n, k));
  renderProtocol();
  updateStatus();
  requestDraw();
}
function stopReplay() {
  clearInterval(replayTimer);
  replayTimer = 0;
  if (state.replay === null) return;
  state.replay = null;
  renderProtocol();
  updateStatus();
  requestDraw();
}
function playReplay() {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = 0; return; }
  const n = state.c.objects.length;
  if (!n) return;
  let k = state.replay === null || state.replay >= n ? 0 : state.replay;
  setReplay(k);
  replayTimer = setInterval(() => {
    k++;
    if (k >= n) { stopReplay(); return; }
    setReplay(k);
  }, 650);
}

// ------------------------------------------------------------------ dialogs
const dlg = $('dlg');
let dialogOpenedAt = 0;
function openDialog({ title, body, buttons = [{ label: STR.ui.ok, value: 'ok', primary: true }], validate, onOpen }) {
  return new Promise((resolve) => {
    $('dlgTitle').textContent = title;
    const b = $('dlgBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    const bb = $('dlgButtons');
    bb.innerHTML = '';
    for (const btn of buttons) {
      const el = document.createElement('button');
      el.textContent = btn.label;
      el.value = btn.value;
      if (btn.primary) el.className = 'primary';
      if (btn.danger) el.className = 'danger';
      if (btn.value === 'cancel') el.formNoValidate = true;
      bb.append(el);
    }
    const form = $('dlgForm');
    form.onsubmit = (e) => {
      const v = e.submitter ? e.submitter.value : 'ok';
      if (validate && v !== 'cancel' && v !== 'delete' && validate(v, b) === false) e.preventDefault();
    };
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dialogOpenedAt = performance.now();
    dlg.showModal();
    const first = b.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), textarea');
    if (first && !coarse.matches) { first.focus(); if (first.select) first.select(); } else if (coarse.matches && document.activeElement && document.activeElement !== document.body) {
      // showModal() focuses the close button (focus ring, no keyboard on touch) – drop it
      document.activeElement.blur();
    }
    if (onOpen) onOpen(b);
  });
}
function alertDialog(title, text) {
  const pre = document.createElement('pre');
  pre.textContent = text;
  return openDialog({ title, body: pre });
}
async function confirmDialog(title, text, okLabel = STR.ui.ok, danger = false) {
  const pre = document.createElement('pre');
  pre.textContent = text;
  const r = await openDialog({ title, body: pre, buttons: [{ label: STR.ui.cancel, value: 'cancel' }, { label: okLabel, value: 'ok', primary: !danger, danger }] });
  return r === 'ok';
}
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el[k] = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k);
  return el;
}

/** Chips inserting variable names (and functions) into an input. */
function insertChips(input, { braces = false, funcs = true } = {}) {
  const box = h('div');
  const vars = state.c.objects.filter((o) => {
    if (!o.value || o.aux) return false;
    const n = numericValue(o);
    return n !== undefined && !Number.isNaN(n);
  });
  const chips = h('div', { class: 'chips' });
  const ins = (s) => {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, a) + s + input.value.slice(b);
    const pos = a + s.length - (s.endsWith('()') ? 1 : 0) - (braces && s.endsWith('}') ? 1 : 0);
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event('input'));
    if (!coarse.matches) input.focus();
  };
  if (!vars.length) box.append(h('p', { class: 'hint', text: STR.dlg.noVars }));
  for (const o of vars) {
    const btn = h('button', { type: 'button', class: 'var', title: describe(o) }, o.name);
    if (o.caption) btn.append(h('span', { class: 'chip-sub', text: o.caption }));
    btn.onclick = () => ins(braces ? `{${o.name}}` : o.name);
    chips.append(btn);
  }
  if (funcs) {
    for (const f of ['+', '−', '·', '/', '^', '²', '(', ')', 'sqrt()', 'sin()', 'cos()', 'tan()', 'π']) {
      const btn = h('button', { type: 'button' }, f);
      btn.onclick = () => ins({ '−': '-', '·': '*' }[f] || f);
      chips.append(btn);
    }
  }
  box.prepend(h('p', { class: 'hint', text: STR.dlg.insert }));
  box.append(chips);
  return box;
}

async function askExpr(title, label, def) {
  const input = h('input', { class: 'mono', value: def, autocapitalize: 'off', spellcheck: false, inputmode: 'text' });
  const err = h('p', { class: 'error', hidden: true });
  const res = h('div', { class: 'result' });
  const upd = () => {
    const e = state.c.checkExpr(null, input.value);
    input.classList.toggle('bad', !!e);
    if (!e) { const v = state.c.evalSrc(input.value); res.textContent = `= ${fmtNum(v, Math.max(3, state.settings.decimals))}`; err.hidden = true; } else res.textContent = '';
  };
  input.oninput = upd;
  upd();
  const body = h('div', {}, h('p', { text: label }), input, res, insertChips(input), err);
  const r = await openDialog({
    title, body, buttons: [{ label: STR.ui.cancel, value: 'cancel' }, { label: STR.ui.ok, value: 'ok', primary: true }],
    validate: () => { const e = state.c.checkExpr(null, input.value); if (e) { err.textContent = e; err.hidden = false; return false; } return true; },
  });
  if (r !== 'ok') return null;
  const s = input.value.trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? s : s;
}
async function askInt(title, label, def, min, max) {
  const input = h('input', { type: 'number', value: String(def), min: String(min), max: String(max), inputmode: 'numeric' });
  const err = h('p', { class: 'error', hidden: true });
  const r = await openDialog({
    title, body: h('div', {}, h('p', { text: label }), input, err), buttons: [{ label: STR.ui.cancel, value: 'cancel' }, { label: STR.ui.ok, value: 'ok', primary: true }],
    validate: () => { const v = Number(input.value); if (!Number.isInteger(v) || v < min || v > max) { err.textContent = `${min} … ${max}`; err.hidden = false; return false; } return true; },
  });
  return r === 'ok' ? Number(input.value) : null;
}
async function askCalc() {
  const input = h('input', { class: 'mono', autocapitalize: 'off', spellcheck: false });
  const res = h('div', { class: 'result' });
  const err = h('p', { class: 'error', hidden: true });
  input.oninput = () => {
    const e = input.value.trim() ? state.c.checkExpr(null, input.value) : '';
    input.classList.toggle('bad', !!e);
    res.textContent = !e && input.value.trim() ? `= ${fmtNum(state.c.evalSrc(input.value), Math.max(3, state.settings.decimals))}` : '';
  };
  const r = await openDialog({
    title: STR.dlg.calcTitle,
    body: h('div', {}, h('p', { text: STR.dlg.calcLabel }), input, res, insertChips(input), err),
    buttons: [{ label: STR.ui.cancel, value: 'cancel' }, { label: STR.ui.ok, value: 'ok', primary: true }],
    validate: () => { const e = state.c.checkExpr(null, input.value); if (e) { err.textContent = e; err.hidden = false; return false; } return true; },
  });
  return r === 'ok' ? input.value.trim() : null;
}
async function askText(def = '') {
  const input = h('textarea', { value: def, rows: 3 });
  input.value = def;
  const err = h('p', { class: 'error', hidden: true });
  const r = await openDialog({
    title: STR.dlg.textTitle,
    body: h('div', {}, h('p', { text: STR.dlg.textLabel }), input, insertChips(input, { braces: true, funcs: false }), err),
    buttons: [{ label: STR.ui.cancel, value: 'cancel' }, { label: STR.ui.ok, value: 'ok', primary: true }],
    validate: () => {
      if (!input.value.trim()) return false;
      for (const m of input.value.matchAll(/\{([^}]*)\}/g)) { const e = state.c.checkExpr(null, m[1]); if (e) { err.textContent = e; err.hidden = false; return false; } }
      return true;
    },
  });
  return r === 'ok' ? input.value : null;
}

// ------------------------------------------------------------------ properties
const SWATCHES = ['#1b1f24', '#607d8b', '#1565c0', '#3d8fe0', '#00838f', '#2e7d32', '#9e9d24', '#ef6c00', '#c62828', '#ad1457', '#8e24aa', '#5d4037'];
async function propertiesDialog(o) {
  if (!o) return;
  const c = state.c;
  const cat = catOf(c, o);
  const body = h('div');
  const err = h('p', { class: 'error', hidden: true });
  const field = (label, el) => h('div', { class: 'field' }, h('label', { text: label }), el);

  const name = h('input', { value: o.name, autocapitalize: 'off', spellcheck: false });
  const caption = h('input', { value: o.caption || '' });
  body.append(h('div', { class: 'grid2' }, field(STR.props.name, name), field(STR.props.caption, caption)));
  body.append(h('div', { class: 'def', text: `${describe(o)}${o.value ? '' : ` – ${STR.ui.undefined}`}` }));

  // type-specific parameters
  const exprInputs = {};
  const addExpr = (key, label) => {
    const inp = h('input', { class: 'mono', value: String(o.params[key] ?? ''), autocapitalize: 'off', spellcheck: false });
    exprInputs[key] = inp;
    body.append(field(label, inp));
  };
  if (o.type === 'circleR') addExpr('r', STR.props.radius);
  if (o.type === 'rotate') addExpr('angle', STR.props.angle);
  if (o.type === 'dilate') addExpr('factor', STR.props.factor);
  if (o.type === 'calc') addExpr('expr', STR.props.expr);
  let textArea = null;
  if (o.type === 'text') {
    textArea = h('textarea', { rows: 3 });
    textArea.value = o.params.text || '';
    body.append(field(STR.props.text, textArea));
  }
  let oriented = null;
  if (o.type === 'angle') {
    oriented = h('input', { type: 'checkbox', checked: !!o.params.oriented });
    body.append(h('label', { class: 'check' }, oriented, STR.props.oriented));
  }
  let samples = null;
  if (o.type === 'locus') {
    samples = h('select');
    for (const n of [100, 200, 400, 800, 1600]) samples.append(h('option', { value: String(n), text: String(n), selected: (o.params.samples || 400) === n }));
    body.append(field(STR.props.samples, samples));
  }

  // color
  let color = o.style.color;
  const sw = h('div', { class: 'swatches' });
  const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000' });
  const markSw = () => sw.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === color));
  for (const col of SWATCHES) {
    const b = h('button', { type: 'button', 'aria-label': col });
    b.dataset.c = col;
    b.style.background = col;
    b.onclick = () => { color = col; picker.value = col; markSw(); };
    sw.append(b);
  }
  picker.oninput = () => { color = picker.value; markSw(); };
  sw.append(picker);
  markSw();
  body.append(field(STR.props.color, sw));

  const sel = (opts, val) => { const s = h('select'); for (const [v, t] of opts) s.append(h('option', { value: String(v), text: t, selected: String(v) === String(val) })); return s; };
  let width = null, dash = null, ps = null, psize = null, fillSel = null;
  const row = h('div', { class: 'grid2' });
  if (cat === 'point') {
    ps = sel([['dot', STR.props.dot], ['circle', STR.props.circle], ['cross', STR.props.cross], ['square', STR.props.square]], o.style.ps);
    psize = sel([[3, '3'], [3.5, '3.5'], [4.5, '4.5'], [5.5, '5.5'], [7, '7']], o.style.size);
    if (![...psize.options].some((op) => op.selected)) psize.append(h('option', { value: String(o.style.size), text: String(o.style.size), selected: true }));
    row.append(field(STR.props.pstyle, ps), field(STR.props.psize, psize));
  } else if (cat !== 'text') {
    width = sel([[0.75, '0.75'], [1.25, '1.25'], [1.75, '1.75'], [2.5, '2.5'], [3.5, '3.5'], [5, '5']], o.style.width);
    if (![...width.options].some((op) => op.selected)) width.append(h('option', { value: String(o.style.width), text: String(o.style.width), selected: true }));
    dash = sel([['solid', STR.props.solid], ['dash', STR.props.dashed], ['dot', STR.props.dotted]], o.style.dash);
    row.append(field(STR.props.width, width), field(STR.props.dash, dash));
  }
  body.append(row);
  if (['poly', 'circle', 'arc'].includes(cat) || o.type === 'angle') {
    fillSel = sel([[0, '0 %'], [0.08, '8 %'], [0.15, '15 %'], [0.18, '18 %'], [0.3, '30 %'], [0.5, '50 %']], o.style.fill || 0);
    if (![...fillSel.options].some((op) => op.selected)) fillSel.append(h('option', { value: String(o.style.fill), text: `${Math.round(o.style.fill * 100)} %`, selected: true }));
    body.append(field(STR.props.fill, fillSel));
  }
  let decimals = null;
  if (cat === 'meas' || cat === 'text') {
    decimals = h('input', { type: 'number', min: '0', max: '10', value: o.decimals ?? '', inputmode: 'numeric' });
    body.append(field(STR.props.decimals, decimals));
  }
  const chk = (label, val) => { const i = h('input', { type: 'checkbox', checked: !!val }); body.append(h('label', { class: 'check' }, i, label)); return i; };
  const hidden = chk(STR.props.hidden, o.hidden);
  const showLabel = chk(STR.props.showLabel, o.showLabel);
  const fixed = o.type === 'free' ? chk(STR.props.fixed, o.fixed) : null;
  const trace = ['point', 'line', 'circle', 'arc', 'poly'].includes(cat) ? chk(STR.props.trace, o.trace) : null;
  const showIf = h('input', { class: 'mono', value: o.showIf || '', autocapitalize: 'off', spellcheck: false });
  body.append(field(STR.props.showIf, showIf));
  body.append(err);

  const validate = () => {
    const nm = name.value.trim();
    const fail = (m, el) => { err.textContent = m; err.hidden = false; if (el) el.classList.add('bad'); return false; };
    body.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
    if (!isValidName(nm)) return fail(STR.props.badName, name);
    const other = c.byName(nm);
    if (other && other !== o) return fail(STR.props.nameTaken, name);
    for (const [k, inp] of Object.entries(exprInputs)) {
      const e = c.checkExpr(o, inp.value);
      if (e) return fail(e, inp);
      void k;
    }
    if (textArea) for (const m of textArea.value.matchAll(/\{([^}]*)\}/g)) { const e = c.checkExpr(o, m[1]); if (e) return fail(e, textArea); }
    if (showIf.value.trim()) { const e = c.checkExpr(o, showIf.value); if (e) return fail(e, showIf); }
    return true;
  };
  const r = await openDialog({
    title: `${STR.props.title}: ${o.name}`,
    body,
    buttons: [{ label: STR.ui.delete, value: 'delete', danger: true }, { label: STR.ui.cancel, value: 'cancel' }, { label: STR.ui.ok, value: 'ok', primary: true }],
    validate,
  });
  if (r === 'delete') { deleteWithConfirm([o.id]); return; }
  if (r !== 'ok') return;
  begin();
  const backup = serialize();
  try {
    if (name.value.trim() !== o.name) c.rename(o, name.value.trim());
    o.caption = caption.value.trim();
    for (const [k, inp] of Object.entries(exprInputs)) o.params[k] = inp.value.trim();
    if (textArea) o.params.text = textArea.value;
    if (oriented) o.params.oriented = oriented.checked;
    if (samples) o.params.samples = Number(samples.value);
    o.style = { ...o.style, color };
    if (width) o.style.width = Number(width.value);
    if (dash) o.style.dash = dash.value;
    if (ps) o.style.ps = ps.value;
    if (psize) o.style.size = Number(psize.value);
    if (fillSel) o.style.fill = Number(fillSel.value);
    if (decimals) o.decimals = decimals.value === '' ? null : Math.max(0, Math.min(10, Number(decimals.value)));
    o.hidden = hidden.checked;
    o.showLabel = showLabel.checked;
    if (fixed) o.fixed = fixed.checked;
    if (trace) { o.trace = trace.checked; if (!o.trace) state.traces.delete(o.id); }
    o.showIf = showIf.value.trim();
    c.updateDeps(o);
    if (!c.sort()) throw new Error('circular');
    c.recompute();
  } catch (e) {
    console.error(e);
    restore(backup);
    alertDialog(STR.dlg.error, String(e.message || e));
  }
  commit();
}

// ------------------------------------------------------------------ delete
async function deleteWithConfirm(ids) {
  const c = state.c;
  const del = c.descendants(ids);
  if (!del.size) return;
  if (del.size > ids.length) {
    const list = c.objects.filter((o) => del.has(o.id) && !o.aux).map((o) => o.name).join(', ');
    if (!await confirmDialog(STR.ui.delete, STR.ui.deleteConfirm(del.size, list), STR.ui.delete, true)) return;
  }
  cancelInput();
  begin();
  c.remove(ids);
  for (const id of del) { state.sel.delete(id); state.traces.delete(id); state.anim.delete(id); }
  c.recompute();
  commit();
  setStatus(STR.status.deleted(del.size));
}

// ------------------------------------------------------------------ context menu
const ctxDlg = $('ctxDlg');
function openContextMenu(o, cx, cy) {
  state.sel = new Set([o.id]);
  renderProtocol();
  requestDraw();
  $('ctxTitle').textContent = describe(o);
  const body = $('ctxBody');
  body.innerHTML = '';
  const cat = catOf(state.c, o);
  const item = (label, icon, fn, cls) => {
    const b = h('button', { type: 'button', class: cls });
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon] || ''}</svg>`;
    b.append(label);
    b.onclick = () => { ctxDlg.close(); fn(); };
    body.append(b);
  };
  const mut = (fn) => () => { begin(); fn(); state.c.recompute(); commit(); };
  item(STR.ui.properties, 'props', () => propertiesDialog(o));
  item(o.hidden ? STR.ui.show : STR.ui.hide, 'hide', mut(() => { o.hidden = !o.hidden; }));
  item(o.showLabel ? STR.ui.labelOff : STR.ui.labelOn, 'label', mut(() => { o.showLabel = !o.showLabel; }));
  if (['point', 'line', 'circle', 'arc', 'poly'].includes(cat)) item(o.trace ? STR.ui.traceOff : STR.ui.traceOn, 'trace', mut(() => { o.trace = !o.trace; if (!o.trace) state.traces.delete(o.id); }));
  if (o.type === 'free') item(o.fixed ? STR.ui.unfix : STR.ui.fix, 'point', mut(() => { o.fixed = !o.fixed; }));
  if (o.type === 'onobj') item(state.anim.has(o.id) ? STR.ui.stopAnimate : STR.ui.animate, 'animate', () => toggleAnimation(o.id));
  item(STR.ui.delete, 'delete', () => deleteWithConfirm([o.id]), 'danger');
  ctxDlg.style.left = '0px';
  ctxDlg.style.top = '0px';
  dialogOpenedAt = performance.now();
  ctxDlg.showModal();
  const r = ctxDlg.getBoundingClientRect();
  const x = Math.max(8, Math.min(window.innerWidth - r.width - 8, cx + 12));
  const y = Math.max(8, Math.min(window.innerHeight - r.height - 8, cy - 20));
  ctxDlg.style.left = `${x}px`;
  ctxDlg.style.top = `${y}px`;
}

// ------------------------------------------------------------------ macros
function startMacroDefinition() {
  setTool('move');
  state.macroMode = { stage: 'inputs', inputs: [], outputs: [] };
  updateStatus();
  requestDraw();
}
function macroModeTap(hits) {
  const mm = state.macroMode;
  const h0 = hits.find((h) => h.via !== 'label' || ['meas', 'text'].includes(catOf(state.c, h.o)));
  if (!h0) return;
  const list = mm.stage === 'inputs' ? mm.inputs : mm.outputs;
  const id = h0.o.id;
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
  setStatus(`${mm.stage === 'inputs' ? STR.status.macroInputs : STR.status.macroOutputs}  [${list.map(nameOf).join(', ')}]`);
  requestDraw();
}
async function macroModeNext() {
  const mm = state.macroMode;
  if (!mm) return;
  if (mm.stage === 'inputs') {
    if (!mm.inputs.length) { setStatus(STR.dlg.macroErrors.noInputs, true); return; }
    mm.stage = 'outputs';
    updateStatus();
    return;
  }
  const res = defineMacro(state.c, mm.inputs, mm.outputs, 'tmp');
  if (res.error) {
    const e = STR.dlg.macroErrors[res.error];
    alertDialog(STR.dlg.error, typeof e === 'function' ? e(res.obj ? res.obj.name : '?') : e);
    return;
  }
  const nameIn = h('input', { value: `Macro ${state.userMacros.length + 1}` });
  const descIn = h('input', { value: '' });
  const r = await openDialog({
    title: STR.tools.macroDefine.replace('…', ''),
    body: h('div', {}, h('div', { class: 'field' }, h('label', { text: STR.dlg.macroName }), nameIn), h('div', { class: 'field' }, h('label', { text: STR.dlg.macroDesc }), descIn),
      h('p', { class: 'hint', text: `${mm.inputs.map(nameOf).join(', ')} → ${mm.outputs.map(nameOf).join(', ')}` })),
    buttons: [{ label: STR.ui.cancel, value: 'cancel' }, { label: STR.ui.ok, value: 'ok', primary: true }],
    validate: () => !!nameIn.value.trim(),
  });
  if (r !== 'ok') return;
  res.macro.name = nameIn.value.trim();
  res.macro.desc = descIn.value.trim();
  state.userMacros.push(res.macro);
  state.macroMode = null;
  saveStore();
  setTool(`macro:u${state.userMacros.length - 1}`);
  setStatus(STR.dlg.macroSaved(res.macro.name));
}
async function manageMacros() {
  const body = h('div');
  const render = () => {
    body.innerHTML = '';
    if (!state.userMacros.length) body.append(h('p', { class: 'hint', text: STR.dlg.macroNone }));
    state.userMacros.forEach((m, i) => {
      const del = h('button', { type: 'button', text: STR.dlg.macroDelete });
      del.onclick = () => {
        state.userMacros.splice(i, 1);
        if (state.tool.startsWith('macro:u')) setTool('move');
        saveStore();
        renderToolStrip();
        render();
      };
      body.append(h('div', { class: 'macro-row' }, h('span', { class: 'txt' }, m.name, h('span', { class: 'sub', text: `${m.inputs.map((x) => x.cat).join(', ')}${m.desc ? ` – ${m.desc}` : ''}` })), del));
    });
    for (const m of state.builtin) body.append(h('div', { class: 'macro-row' }, h('span', { class: 'txt' }, m.name, h('span', { class: 'sub', text: `${STR.dlg.macroBuiltin} – ${m.desc}` }))));
    const exp = h('button', { type: 'button', text: STR.dlg.macroExport });
    exp.onclick = () => download(new Blob([JSON.stringify({ app: 'geometry', macros: state.userMacros }, null, 1)], { type: 'application/json' }), 'macros.json');
    const imp = h('button', { type: 'button', text: STR.dlg.macroImport });
    imp.onclick = () => $('fileMacros').click();
    body.append(h('div', { class: 'small-actions' }, exp, imp));
  };
  render();
  await openDialog({ title: STR.dlg.macroManageTitle, body, buttons: [{ label: STR.ui.close, value: 'ok', primary: true }] });
}

// ------------------------------------------------------------------ tool strip
const groupPop = $('groupPop');
function toolIcon(id) {
  if (id.startsWith('macro:')) return ICONS.macro;
  return ICONS[id] || ICONS.macro;
}
function groupTools(g) {
  if (g.id !== 'macros') return g.tools;
  return [...state.builtin.map((_, i) => `macro:b${i}`), ...state.userMacros.map((_, i) => `macro:u${i}`)];
}
function renderToolStrip() {
  const strip = $('toolStrip');
  strip.innerHTML = '';
  for (const g of GROUPS) {
    const tools = groupTools(g);
    let cur = state.groupTool[g.id];
    if (!cur || (!tools.includes(cur) && g.id !== 'macros')) cur = tools[0];
    if (g.id === 'macros' && !tools.includes(cur)) cur = null;
    const active = groupOf(state.tool) === g.id;
    const b = h('button', { type: 'button', class: `grp-btn${active ? ' on' : ''}${g.id === 'move' ? '' : ' more'}`, title: `${STR.groups[g.id]}${cur ? `: ${toolLabel(cur)}` : ''}`, 'aria-label': STR.groups[g.id] });
    b.dataset.group = g.id;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${active ? toolIcon(state.tool) : toolIcon(cur || 'macro')}</svg>`;
    b.onclick = (e) => {
      e.stopPropagation();
      if (g.id === 'move') { setTool('move'); closeGroupPop(); return; }
      const wasOpen = !groupPop.hidden && groupPop.dataset.group === g.id;
      if (cur && !active) setTool(cur);
      if (wasOpen) closeGroupPop(); else openGroupPop(g, document.querySelector(`.grp-btn[data-group="${g.id}"]`) || b);
    };
    strip.append(b);
    if (g.id === 'move') strip.append(h('span', { class: 'sep' }));
  }
}
function openGroupPop(g, btn) {
  groupPop.innerHTML = '';
  groupPop.dataset.group = g.id;
  groupPop.append(h('h4', { text: STR.groups[g.id] }));
  const tools = groupTools(g);
  const addBtn = (id, label, sub, onclick, iconKey) => {
    const b = h('button', { type: 'button', class: state.tool === id ? 'on' : '' });
    b.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[iconKey] || toolIcon(id)}</svg></span>`;
    const t = h('span', {}, label);
    if (sub) t.append(h('span', { class: 'sub', text: sub }));
    b.append(t);
    b.onclick = (e) => { e.stopPropagation(); closeGroupPop(); onclick(); };
    groupPop.append(b);
  };
  for (const id of tools) {
    const m = id.startsWith('macro:') ? macroById(id.slice(6)) : null;
    addBtn(id, toolLabel(id), m ? m.desc : '', () => setTool(id));
    if (g.id === 'macros' && id === `macro:b${state.builtin.length - 1}` && state.userMacros.length) groupPop.append(h('hr'));
  }
  if (g.id === 'macros') {
    groupPop.append(h('hr'));
    addBtn('macroDefine', STR.tools.macroDefine, '', startMacroDefinition, 'macroDefine');
    addBtn('macroManage', STR.tools.macroManage, '', manageMacros, 'macroManage');
  }
  groupPop.hidden = false;
  const r = btn.getBoundingClientRect();
  const pr = groupPop.getBoundingClientRect();
  groupPop.style.left = `${Math.max(6, Math.min(window.innerWidth - pr.width - 6, r.left))}px`;
  groupPop.style.top = `${r.bottom + 6}px`;
}
function closeGroupPop() { groupPop.hidden = true; }

// ------------------------------------------------------------------ files
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && coarse.matches && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: STR.appName }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}
function fileData() {
  return { app: 'geometry', version: 1, construction: state.c.toJSON(), view: state.view, settings: { grid: state.settings.grid, axes: state.settings.axes }, macros: state.userMacros };
}
function saveJson() {
  shareOrDownload(new Blob([JSON.stringify(fileData(), null, 1)], { type: 'application/json' }), 'construction.geometry.json');
}
async function openJson(text) {
  const data = JSON.parse(text);
  if (!data || !data.construction) throw new Error('Not a construction file');
  const test = new Construction();
  test.load(data.construction);
  if (state.c.objects.length && !await confirmDialog(STR.menu.open, STR.ui.loadConfirm)) return;
  cancelInput();
  stopReplay();
  begin();
  state.c.load(data.construction);
  state.traces.clear();
  state.anim.clear();
  if (data.settings) Object.assign(state.settings, data.settings);
  if (Array.isArray(data.macros)) {
    for (const m of data.macros) if (!state.userMacros.some((x) => x.name === m.name && JSON.stringify(x.steps) === JSON.stringify(m.steps))) state.userMacros.push(m);
    renderToolStrip();
  }
  syncOptionsUI();
  commit();
  zoomToFit();
}
async function exportPng() {
  const scale = 2;
  const off = document.createElement('canvas');
  off.width = W * scale; off.height = H * scale;
  const g = off.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  drawScene(new CanvasBackend(g), sceneState(true));
  const blob = await new Promise((res) => off.toBlob(res, 'image/png'));
  if (blob) shareOrDownload(blob, 'construction.png');
}
function exportSvg() {
  const m = document.createElement('canvas').getContext('2d');
  const B = new SvgBackend(W, H, m);
  drawScene(B, sceneState(true));
  shareOrDownload(new Blob([B.toString()], { type: 'image/svg+xml' }), 'construction.svg');
}

async function newConstruction() {
  if (state.c.objects.length && !await confirmDialog(STR.menu.newC, STR.ui.newConfirm)) return;
  cancelInput();
  stopReplay();
  begin();
  state.c.clear();
  state.traces.clear();
  state.anim.clear();
  state.sel.clear();
  commit();
  defaultView();
  requestDraw();
}
async function examplesDialog() {
  const body = h('div', { class: 'list-btns' });
  let chosen = null;
  for (const ex of EXAMPLES) {
    const b = h('button', { type: 'button' }, h('span', {}, STR.examples[ex.id]));
    b.onclick = () => { chosen = ex; dlg.close('ok'); };
    body.append(b);
  }
  const r = await openDialog({ title: STR.dlg.examplesTitle, body, buttons: [{ label: STR.ui.cancel, value: 'cancel' }] });
  if (r !== 'ok' || !chosen) return;
  loadExample(chosen);
}
function loadExample(ex) {
  cancelInput();
  stopReplay();
  begin();
  state.c.clear();
  state.traces.clear();
  state.anim.clear();
  state.sel.clear();
  ex.build(state.c);
  state.c.recompute();
  state.settings.grid = false;
  state.settings.axes = false;
  syncOptionsUI();
  setTool('move');
  commit();
  zoomToFit();
  setStatus(STR.examples[ex.id]);
}

// ------------------------------------------------------------------ menu & options
function syncOptionsUI() {
  const s = state.settings;
  $('optGrid').checked = s.grid;
  $('optAxes').checked = s.axes;
  $('optSnap').checked = s.snap;
  $('optHidden').checked = s.showHidden;
  $('optLabel').value = String(s.labelSize);
  $('optDec').value = String(s.decimals);
  $('chkShowAux').checked = s.showAux;
}
function buildMenu() {
  const menu = $('menuDlg');
  const opt = (id, key, conv = (x) => x) => {
    $(id).addEventListener('change', (e) => {
      state.settings[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      saveSoon();
      renderProtocol();
      requestDraw();
    });
  };
  opt('optGrid', 'grid'); opt('optAxes', 'axes'); opt('optSnap', 'snap'); opt('optHidden', 'showHidden');
  opt('optLabel', 'labelSize', Number); opt('optDec', 'decimals', Number); opt('chkShowAux', 'showAux');
  menu.addEventListener('click', (e) => {
    if (e.target === menu || e.target.closest('[data-close]')) { menu.close(); return; }
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    menu.close();
    const actions = {
      newC: newConstruction,
      examples: examplesDialog,
      open: () => $('fileOpen').click(),
      save: saveJson,
      png: exportPng,
      svg: exportSvg,
      undo, redo,
      delSel: () => { if (state.sel.size) deleteWithConfirm([...state.sel]); },
      showAll: () => { begin(); state.c.objects.forEach((o) => { if (!o.aux) o.hidden = false; }); commit(); },
      clearTraces: () => { state.traces.clear(); requestDraw(); },
      fit: zoomToFit,
      resetView: () => { defaultView(); requestDraw(); saveSoon(); },
      defineMacro: startMacroDefinition,
      manageMacros,
      howto: () => alertDialog(STR.menu.howto, STR.help.howto),
      terms: () => alertDialog(STR.menu.terms, STR.help.terms),
      about: () => alertDialog(STR.menu.about, STR.help.about),
    };
    actions[b.dataset.action]?.();
  });
  $('fileOpen').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { await openJson(await file.text()); } catch (err) { alertDialog(STR.dlg.error, STR.dlg.openError(err.message)); }
  };
  $('fileMacros').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.macros;
      if (!Array.isArray(list)) throw new Error('No macros found');
      for (const m of list) if (m && m.name && Array.isArray(m.steps) && Array.isArray(m.inputs)) state.userMacros.push(m);
      saveStore();
      renderToolStrip();
      if (dlg.open) dlg.close('ok');
      manageMacros();
    } catch (err) { alertDialog(STR.dlg.error, STR.dlg.openError(err.message)); }
  };
}

// ------------------------------------------------------------------ panel (drawer)
const narrow = matchMedia('(max-width: 1023px)');
function openPanel() {
  const p = $('panel');
  if (narrow.matches) { p.classList.add('open'); $('scrim').hidden = false; } else { p.classList.remove('hidden-wide'); }
  state.settings.panel = true;
  saveSoon();
}
function closePanel() {
  $('panel').classList.remove('open');
  $('scrim').hidden = true;
}
function togglePanel() {
  const p = $('panel');
  if (narrow.matches) {
    if (p.classList.contains('open')) closePanel(); else openPanel();
  } else {
    p.classList.toggle('hidden-wide');
    state.settings.panel = !p.classList.contains('hidden-wide');
    saveSoon();
  }
}

// ------------------------------------------------------------------ keyboard
function onKey(e) {
  if (dlg.open || $('menuDlg').open || ctxDlg.open) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    closeGroupPop();
    if (state.anim.size) { stopAnimations(); updateStatus(); return; }
    if (state.replay !== null) { stopReplay(); return; }
    if (state.picks.length || state.macroMode) { cancelInput(); return; }
    if (state.sel.size) { state.sel.clear(); renderProtocol(); requestDraw(); }
    if (state.tool !== 'move') setTool('move');
    return;
  }
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveJson(); return; }
  if (mod) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel.size) { e.preventDefault(); deleteWithConfirm([...state.sel]); return; }
  if (e.key === 'f' || e.key === 'F') { zoomToFit(); return; }
  if (e.key === 'm' || e.key === 'M') { setTool('move'); return; }
  if (e.key === 'Enter' && activeToolDef() && activeToolDef().polygon && state.picks.length >= 3) { statusDone(); }
}
function statusDone() {
  if (state.macroMode) { macroModeNext(); return; }
  const tool = activeToolDef();
  if (tool && tool.polygon && state.picks.length >= 3) completeWith(tool.alts[0], makeApi(state.pointer || { x: 0, y: 0 }));
}

// ------------------------------------------------------------------ init
function onResize() {
  resizeCanvas();
  draw();
}
function init() {
  applyStaticStrings();
  state.builtin = builtinMacros(STR);
  const had = loadStore();
  state.c.recompute();
  state.current = serialize();
  buildMenu();
  syncOptionsUI();
  renderToolStrip();
  updateUndoButtons();

  $('btnPanel').onclick = togglePanel;
  $('btnPanelClose').onclick = () => { if (narrow.matches) closePanel(); else togglePanel(); };
  $('scrim').onclick = closePanel;
  narrow.addEventListener('change', () => { closePanel(); });
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('btnFit').onclick = zoomToFit;
  $('btnMenu').onclick = () => { closeGroupPop(); $('menuDlg').showModal(); };
  $('btnStatusDone').onclick = statusDone;
  $('btnStatusCancel').onclick = () => {
    if (state.anim.size) stopAnimations();
    if (state.replay !== null) stopReplay();
    cancelInput();
  };
  $('protocol').addEventListener('click', onProtocolClick);
  $('replaySlider').addEventListener('input', (e) => {
    const k = Number(e.target.value);
    if (k >= state.c.objects.length) stopReplay(); else setReplay(k);
  });
  $('btnReplayFirst').onclick = () => setReplay(0);
  $('btnReplayPrev').onclick = () => setReplay((state.replay ?? state.c.objects.length) - 1);
  $('btnReplayNext').onclick = () => { if (state.replay !== null) setReplay(state.replay + 1); };
  $('btnReplayPlay').onclick = playReplay;
  ctxDlg.addEventListener('click', (e) => { if (e.target === ctxDlg && performance.now() - dialogOpenedAt > 450) ctxDlg.close(); });
  ctxDlg.addEventListener('close', () => { requestDraw(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && performance.now() - dialogOpenedAt > 450) dlg.close('cancel'); });
  document.addEventListener('pointerdown', (e) => { if (!groupPop.hidden && !groupPop.contains(e.target) && !e.target.closest('.grp-btn')) closeGroupPop(); });

  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointercancel', onPointerUp);
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) { state.cand = null; state.pointer = null; $('coords').textContent = ''; requestDraw(); }
  });
  cv.addEventListener('wheel', onWheel, { passive: false });
  // suppress compatibility mouse events / clicks after touches (they would hit dialogs opened by the tap)
  cv.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('dblclick', (e) => {
    if (state.tool !== 'move' || dlg.open || state.macroMode) return; // handleTap already opened it
    const hits = hitTest(localPos(e), 'mouse');
    if (hits.length) propertiesDialog(hits[0].o);
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', saveStore);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveStore(); });

  new ResizeObserver(() => onResize()).observe(wrap);
  resizeCanvas();
  if (narrow.matches || state.settings.panel === false) { closePanel(); if (!narrow.matches) $('panel').classList.add('hidden-wide'); }
  if (!had) loadExample(EXAMPLES[0]);
  state.undo = [];
  state.redo = [];
  updateUndoButtons();
  setTool(state.tool);
  renderProtocol();
  draw();
  // test hook
  window.__geometry = { state, STR, setTool, hitTest, toScreen, toWorld, zoomToFit, loadExample: (id) => loadExample(EXAMPLES.find((x) => x.id === id)), describe, undo, redo };
}

init();
