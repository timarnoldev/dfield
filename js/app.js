// DFIELD web port – main application.
import { compile, isValidName, ParseError } from './parser.js';
import { METHODS, SOLVERS, defaultSolverParams } from './solvers.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'dfield.v1';
const MAX_POINTS_PER_ORBIT = 200000;

// ---------------------------------------------------------------- gallery
const BUILTIN_GALLERY = [
  {
    name: "Polking's 1st order equation",
    description: '',
    dep: 'x', indep: 't', expr: 'x^2 - at + b',
    params: [['a', '1'], ['b', '0'], ['', ''], ['', '']],
    tmin: -2, tmax: 10, xmin: -4, xmax: 4,
  },
  {
    name: 'Projectile motion',
    description: 'One-dimensional projectile motion with air resistance.',
    dep: 'v', indep: 't', expr: '9.8 - (k/m)v',
    params: [['m', '.01'], ['k', '0.0001'], ['', ''], ['', '']],
    tmin: 0, tmax: 1200, xmin: 0, xmax: 1200,
  },
];

// ---------------------------------------------------------------- state
const DEFAULT_SETTINGS = {
  bg: 'white', fontSize: 14, delay: 1, solver: 'dp', direction: 'both', zoom: 'rect',
  showPoints: false, crosshairs: false, showField: true, arrows: true,
  rows: 20, cols: 20, compX: 1, compY: 100,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  gallery: [],
  form: null,
  sys: null,          // compiled system used by the current graph
  view: null,         // { tmin, tmax, xmin, xmax }
  orig: null,         // window of the last "Graph"
  ext: null,          // largest window solutions were computed for
  history: [],
  orbits: [],
  texts: [],
  solverParams: null,
  mode: 'solve',
  pendingText: null,
  nextGroup: 1,
};

const run = { queue: [], active: null, raf: 0, last: 0, budget: 0 };

// ---------------------------------------------------------------- persistence
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.settings) Object.assign(state.settings, s.settings);
    if (Array.isArray(s.gallery)) state.gallery = s.gallery;
    if (s.form) state.form = s.form;
  } catch { /* ignore */ }
}
function saveStore() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ settings: state.settings, gallery: state.gallery, form: readForm() }));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- formatting
function stripZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
function expFormat(v, digits) {
  const [m, e] = v.toExponential(digits).split('e');
  return `${stripZeros(m)}E${Number(e)}`;
}
/** Number with `sig` significant digits (like DFIELD's coordinate display). */
function fmtNum(v, sig = 5) {
  const a = Math.abs(v);
  if (a < 1e-25) return '0';
  if (a >= 1e6 || a < 1e-7) return expFormat(v, sig);
  const n = Math.floor(Math.log10(a)) - (sig - 1);
  if (n >= 0) return String(Math.round(v));
  return stripZeros(v.toFixed(Math.min(20, -n)));
}
function fmtTick(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const ls = Math.floor(Math.log10(step) + 1e-9);
  if (a >= 1e6 || a < 1e-5) {
    return expFormat(v, Math.max(0, Math.min(8, Math.floor(Math.log10(a) + 1e-9) - ls)));
  }
  return v.toFixed(Math.max(0, -ls));
}
function niceTicks(lo, hi, n) {
  n = Math.max(1, n);
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let m = Math.ceil(raw / mag - 1e-9);
  if (m > 2 && m <= 5) m = 5;
  else if (m > 5) m = 10;
  const step = m * mag;
  const first = step * Math.ceil(lo / step - 1e-9);
  const ticks = [];
  for (let i = 0; i < 1000; i++) {
    const v = first + i * step;
    if (v > hi + step * 1e-9) break;
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { ticks, step };
}
function superscripts(s) {
  return s.replace(/\^([23])(?!\d)/g, (_, d) => (d === '2' ? '²' : '³'));
}

// ---------------------------------------------------------------- equation form
const F = {
  dep: $('depVar'), indep: $('indepVar'), expr: $('expr'),
  tmin: $('tmin'), tmax: $('tmax'), xmin: $('xmin'), xmax: $('xmax'),
  paramNames: [], paramVals: [],
};

function buildParamRows() {
  const box = $('params');
  for (let i = 0; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'param-row';
    const n = document.createElement('input');
    n.maxLength = 8; n.setAttribute('autocapitalize', 'off'); n.setAttribute('aria-label', `Parameter ${i + 1} name`);
    const eq = document.createElement('span');
    eq.textContent = '=';
    const v = document.createElement('input');
    v.setAttribute('autocapitalize', 'off'); v.setAttribute('aria-label', `Parameter ${i + 1} value`);
    row.append(n, eq, v);
    box.append(row);
    F.paramNames.push(n);
    F.paramVals.push(v);
  }
}

function readForm() {
  return {
    description: $('eqDescription').dataset.custom || '',
    dep: F.dep.value, indep: F.indep.value, expr: F.expr.value,
    params: F.paramNames.map((n, i) => [n.value, F.paramVals[i].value]),
    tmin: F.tmin.value, tmax: F.tmax.value, xmin: F.xmin.value, xmax: F.xmax.value,
  };
}
function writeForm(f) {
  F.dep.value = f.dep ?? '';
  F.indep.value = f.indep ?? '';
  F.expr.value = f.expr ?? '';
  for (let i = 0; i < 4; i++) {
    const p = (f.params && f.params[i]) || ['', ''];
    F.paramNames[i].value = p[0] ?? '';
    F.paramVals[i].value = p[1] ?? '';
  }
  F.tmin.value = f.tmin ?? '';
  F.tmax.value = f.tmax ?? '';
  F.xmin.value = f.xmin ?? '';
  F.xmax.value = f.xmax ?? '';
  setDescription(f.description || '');
}
function setDescription(custom) {
  const el = $('eqDescription');
  el.dataset.custom = custom;
  updateDescription();
}
function updateDescription() {
  const el = $('eqDescription');
  const dep = F.dep.value.trim() || 'x';
  const indep = F.indep.value.trim() || 't';
  el.textContent = el.dataset.custom || `First-order differential equation in the form: ${dep}´ = f(${indep},${dep})`;
}

/** Validates the equation window. Returns { ok, error, bad[], sys, win }. */
function validateForm() {
  const bad = [];
  const fail = (error, ...els) => ({ ok: false, error, bad: [...bad, ...els] });
  const indep = F.indep.value.trim();
  const dep = F.dep.value.trim();
  if (!isValidName(indep)) return fail(`'${indep}': illegal Variable Name.`, F.indep);
  if (!isValidName(dep)) return fail(`'${dep}': illegal Variable Name.`, F.dep);
  if (indep === dep) return fail('The two variable names must be different.', F.indep, F.dep);

  const pnames = [];
  for (let i = 0; i < 4; i++) {
    const name = F.paramNames[i].value.trim();
    F.paramVals[i].disabled = !name;
    if (!name) { pnames.push(''); continue; }
    if (name === indep || name === dep) return fail('Parameter name cannot be the same as one of the variable names.', F.paramNames[i]);
    if (!isValidName(name)) return fail(`'${name}':  illegal Parameter Name.`, F.paramNames[i]);
    if (pnames.includes(name)) return fail(`'${name}':  duplicate Parameter Name.`, F.paramNames[i]);
    pnames.push(name);
  }

  const win = {};
  for (const k of ['tmin', 'tmax', 'xmin', 'xmax']) {
    const txt = F[k].value.trim();
    const v = txt === '' ? NaN : Number(txt);
    if (!Number.isFinite(v)) return fail(`'${F[k].value}':  is not a number.`, F[k]);
    win[k] = v;
  }
  if (win.tmax <= win.tmin) return fail('Maximum must be greater than Minimum', F.tmin, F.tmax);
  if (win.xmax <= win.xmin) return fail('Maximum must be greater than Minimum', F.xmin, F.xmax);

  const paramCode = [];
  const paramShown = [];
  for (let i = 0; i < 4; i++) {
    if (!pnames[i]) { paramCode.push('0'); continue; }
    const src = F.paramVals[i].value.trim();
    try {
      const c = compile(src, [indep, dep]);
      if (!c.usesVars) {
        const v = c.fn(NaN, NaN);
        if (Number.isNaN(v)) return fail(`'${src}':  Bad parameter expression.`, F.paramVals[i]);
        paramCode.push(`(${v})`);
      } else {
        paramCode.push(c.code);
      }
      paramShown.push(`${pnames[i]} = ${src}`);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      return fail(e.message, F.paramVals[i]);
    }
  }

  let f;
  try {
    f = compile(F.expr.value, [indep, dep, ...pnames], paramCode).fn;
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return fail(e.message, F.expr);
  }
  const title = superscripts([`${dep}´ = ${F.expr.value.trim()}`, ...paramShown].join(',    '));
  return { ok: true, sys: { f, dep, indep, title }, win };
}

function refreshValidation() {
  const all = [F.dep, F.indep, F.expr, F.tmin, F.tmax, F.xmin, F.xmax, ...F.paramNames, ...F.paramVals];
  all.forEach((el) => el.classList.remove('bad'));
  const r = validateForm();
  const err = $('eqError');
  const ind = F.indep.value.trim() || '?';
  const dep = F.dep.value.trim() || '?';
  $('lblTmin').textContent = `Minimum ${ind} =`;
  $('lblTmax').textContent = `Maximum ${ind} =`;
  $('lblXmin').textContent = `Minimum ${dep} =`;
  $('lblXmax').textContent = `Maximum ${dep} =`;
  updateDescription();
  if (r.ok) {
    err.hidden = true;
    $('btnGraph').disabled = false;
  } else {
    r.bad.forEach((el) => el.classList.add('bad'));
    err.textContent = r.error;
    err.hidden = false;
    $('btnGraph').disabled = true;
  }
  return r;
}

// ---------------------------------------------------------------- gallery UI
function galleryItems() {
  return [...BUILTIN_GALLERY.map((g, i) => ({ ...g, key: `b${i}` })), ...state.gallery.map((g, i) => ({ ...g, key: `u${i}` }))];
}
function renderGallerySelect() {
  const sel = $('gallerySelect');
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = 'Gallery …';
  sel.append(ph);
  const groups = [['Built-in', BUILTIN_GALLERY, 'b'], ['My systems', state.gallery, 'u']];
  for (const [label, items, prefix] of groups) {
    if (!items.length) continue;
    const og = document.createElement('optgroup');
    og.label = label;
    items.forEach((g, i) => {
      const o = document.createElement('option');
      o.value = `${prefix}${i}`;
      o.textContent = g.name;
      og.append(o);
    });
    sel.append(og);
  }
  sel.value = '';
}
function loadGalleryItem(key) {
  const item = galleryItems().find((g) => g.key === key);
  if (!item) return;
  writeForm({
    description: item.description || item.name,
    dep: item.dep, indep: item.indep, expr: item.expr, params: item.params,
    tmin: String(item.tmin), tmax: String(item.tmax), xmin: String(item.xmin), xmax: String(item.xmax),
  });
  refreshValidation();
  saveStore();
}

// ---------------------------------------------------------------- canvas
const wrap = $('plotWrap');
const baseCv = $('baseCanvas');
const overCv = $('overlayCanvas');
const bctx = baseCv.getContext('2d');
const octx = overCv.getContext('2d');
let W = 0, H = 0, DPR = 1;
let L = null; // plot layout

function colors() {
  const black = state.settings.bg === 'black';
  return {
    outer: '#eeeeee', axis: '#000000', plot: black ? '#000000' : '#ffffff', fg: black ? '#ffffff' : '#000000',
    field: black ? '#00ff00' : 'rgb(0,110,0)', grid: '#808080',
    methods: black
      ? { euler: '#ff0000', rk2: '#ffc800', rk4: '#ffff00', rkf: '#00ffff', dp: '#ff00ff' }
      : { euler: '#ff0000', rk2: 'rgb(220,200,0)', rk4: 'rgb(0,210,0)', rkf: '#0000ff', dp: 'rgb(150,0,255)' },
  };
}
const fonts = () => {
  const s = state.settings.fontSize;
  const fam = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  return { G: `${s}px ${fam}`, H: `bold ${s}px ${fam}`, I: `${Math.max(9, s - 2)}px ${fam}`, size: s };
};

function resizeCanvases() {
  const r = wrap.getBoundingClientRect();
  W = Math.max(50, Math.floor(r.width));
  H = Math.max(50, Math.floor(r.height));
  DPR = Math.min(3, window.devicePixelRatio || 1);
  for (const cv of [baseCv, overCv]) {
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
  }
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

const px = (t) => L.left + (t - state.view.tmin) * L.sx;
const py = (x) => L.top + L.h - (x - state.view.xmin) * L.sy;
const toT = (sx) => state.view.tmin + (sx - L.left) / L.sx;
const toX = (sy) => state.view.xmin + (L.top + L.h - sy) / L.sy;
const inPlot = (sx, sy) => L && sx >= L.left && sx <= L.left + L.w && sy >= L.top && sy <= L.top + L.h;

function computeLayout(ctx) {
  const f = fonts();
  const v = state.view;
  ctx.font = f.G;
  const D = Math.round(f.size * 1.35);
  const E = ctx.measureText('X').width;
  const XX = ctx.measureText('XX').width;
  const top = Math.round(D * 0.8);
  const h = Math.max(20, H - top - Math.round(D * 3.3));
  const yt = niceTicks(v.xmin, v.xmax, Math.max(2, h / (2 * D)));
  const ylabels = yt.ticks.map((t) => fmtTick(t, yt.step));
  const ylw = Math.max(0, ...ylabels.map((s) => ctx.measureText(s).width));
  ctx.font = f.H;
  const depW = ctx.measureText(state.sys.dep).width;
  ctx.font = f.G;
  const left = Math.round(XX * 0.5 + depW + E + ylw + 8);
  let w = Math.max(20, W - left - XX);
  let xt = niceTicks(v.tmin, v.tmax, Math.max(2, w / (5 * E)));
  let xlabels = xt.ticks.map((t) => fmtTick(t, xt.step));
  const xlw = Math.max(0, ...xlabels.map((s) => ctx.measureText(s).width));
  if (xlw + E > 5 * E) {
    xt = niceTicks(v.tmin, v.tmax, Math.max(2, w / (xlw + 2 * E)));
    xlabels = xt.ticks.map((t) => fmtTick(t, xt.step));
  }
  const lastW = ctx.measureText(fmtTick(v.tmax, xt.step)).width;
  w = Math.max(20, Math.round(W - left - Math.max(XX, lastW / 2 + 6)));
  return {
    left, top, w, h, D, E, XX,
    sx: w / (v.tmax - v.tmin), sy: h / (v.xmax - v.xmin),
    yt, ylabels, xt, xlabels,
  };
}

function drawArrow(ctx, x1, y1, x2, y2, head) {
  // line from (x1,y1) to (x2,y2) with an arrow head at (x2,y2)
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  if (head > 0) {
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - Math.PI / 6), y2 - head * Math.sin(a - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a + Math.PI / 6), y2 - head * Math.sin(a + Math.PI / 6));
  }
}

function renderBase() {
  if (!state.view) return;
  const ctx = bctx;
  const c = colors();
  const f = fonts();
  const v = state.view;
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = c.outer;
  ctx.fillRect(0, 0, W, H);
  L = computeLayout(ctx);
  const { left, top, w, h, D } = L;

  ctx.fillStyle = c.plot;
  ctx.fillRect(left, top, w, h);

  // grid + ticks
  ctx.lineWidth = 1;
  ctx.font = f.G;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  L.yt.ticks.forEach((t, i) => {
    const y = Math.round(py(t)) + 0.5;
    ctx.fillStyle = c.axis;
    ctx.fillText(L.ylabels[i], left - 7, y);
    ctx.strokeStyle = c.axis;
    ctx.beginPath(); ctx.moveTo(left - 4, y); ctx.lineTo(left, y); ctx.stroke();
    ctx.strokeStyle = c.grid;
    ctx.setLineDash([1, 4]);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + w, y); ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  L.xt.ticks.forEach((t, i) => {
    const x = Math.round(px(t)) + 0.5;
    ctx.fillStyle = c.axis;
    ctx.fillText(L.xlabels[i], x, top + h + D + 2);
    ctx.strokeStyle = c.axis;
    ctx.beginPath(); ctx.moveTo(x, top + h); ctx.lineTo(x, top + h + 4); ctx.stroke();
    ctx.strokeStyle = c.grid;
    ctx.setLineDash([1, 4]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke();
    ctx.setLineDash([]);
  });

  // axis titles
  ctx.font = f.H;
  ctx.fillStyle = c.axis;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.sys.dep, L.XX * 0.5, top + h / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const titleY = H - Math.round(D * 0.55);
  ctx.fillText(state.sys.indep, left + w / 2, titleY);

  // legend: arrow of slope +1
  ctx.font = f.G;
  ctx.textAlign = 'right';
  const legend = 'Arrow of slope +1.0';
  const ax = W - D * 1.6;
  ctx.fillText(legend, ax - D * 1.2, titleY);
  if (state.settings.showField) {
    const len = D * 0.9;
    const dx = L.sx, dy = L.sy;
    const n = Math.hypot(dx, dy);
    const ux = (dx / n) * len, uy = (-dy / n) * len;
    const cy = titleY - f.size * 0.35;
    ctx.strokeStyle = c.axis;
    ctx.beginPath();
    drawArrow(ctx, ax - ux, cy - uy, ax + ux, cy + uy, state.settings.arrows ? D * 0.5 : 0);
    ctx.stroke();
  }

  // direction field
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, w, h); ctx.clip();
  if (state.settings.showField) drawField(ctx, c);
  // text annotations
  ctx.font = f.I;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const a of state.texts) {
    const tx = px(a.t), ty = py(a.x);
    const tw = ctx.measureText(a.text).width;
    ctx.fillStyle = c.plot;
    ctx.fillRect(tx, ty - f.size, tw, f.size * 1.25);
    ctx.fillStyle = c.fg;
    ctx.fillText(a.text, tx, ty);
  }
  // orbits
  for (const o of state.orbits) drawOrbit(ctx, o, 0, c);
  ctx.restore();

  ctx.strokeStyle = c.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w, h);
  ctx.restore();
}

function drawField(ctx, c) {
  const v = state.view;
  const s = state.settings;
  const dt = (v.tmax - v.tmin) / s.rows;
  const dxv = (v.xmax - v.xmin) / s.cols;
  const half = (L.sx * dt) / 4;
  const head = s.arrows ? (L.sx * dt) / 8 : 0;
  const f = state.sys.f;
  const bad = [];
  ctx.strokeStyle = c.field;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; ; i++) {
    const t = v.tmin + dt / 2 + i * dt;
    if (t >= v.tmax - dt / 5) break;
    for (let j = 0; ; j++) {
      const x = v.xmin + dxv / 2 + j * dxv;
      if (x >= v.xmax - dxv / 5) break;
      const m = f(t, x);
      const cx = px(t), cy = py(x);
      if (Number.isNaN(m)) { bad.push([cx, cy]); continue; }
      let ux = L.sx, uy = -L.sy * m;
      const n = Math.hypot(ux, uy);
      if (!(n > 0) || !Number.isFinite(n)) { ux = 0; uy = -Math.sign(m) || -1; } else { ux /= n; uy /= n; }
      drawArrow(ctx, cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half, head);
    }
  }
  ctx.stroke();
  if (bad.length) {
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    for (const [x, y] of bad) { ctx.moveTo(x + 4.5, y); ctx.arc(x, y, 4.5, 0, Math.PI * 2); }
    ctx.fill();
  }
}

function drawOrbit(ctx, o, fromPoint, c) {
  const p = o.pts;
  const n = p.length / 2;
  if (n === 0) return;
  const col = c.methods[o.method];
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.5;
  if (fromPoint === 0) {
    ctx.beginPath();
    if (state.settings.showPoints) {
      ctx.arc(px(o.t0), py(o.x0), 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.arc(px(o.t0), py(o.x0), 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const start = Math.max(0, fromPoint - 1);
  if (n - start < 2) return;
  ctx.beginPath();
  ctx.moveTo(px(p[2 * start]), py(p[2 * start + 1]));
  for (let i = start + 1; i < n; i++) ctx.lineTo(px(p[2 * i]), py(p[2 * i + 1]));
  ctx.stroke();
  if (state.settings.showPoints) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = Math.max(1, start + 1); i < n; i++) {
      const X = px(p[2 * i]), Y = py(p[2 * i + 1]);
      ctx.moveTo(X + 2, Y);
      ctx.arc(X, Y, 2, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
}

function drawOrbitIncrement(o, from) {
  const ctx = bctx;
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.beginPath(); ctx.rect(L.left, L.top, L.w, L.h); ctx.clip();
  drawOrbit(ctx, o, from, colors());
  ctx.restore();
}

// ---------------------------------------------------------------- overlay
let hover = null;      // {sx, sy, touch}
let zoomRect = null;   // {x0,y0,x1,y1}
function renderOverlay() {
  const ctx = octx;
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!L) { ctx.restore(); return; }
  const c = colors();
  if (zoomRect) {
    ctx.strokeStyle = c.fg;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    const x = Math.min(zoomRect.x0, zoomRect.x1), y = Math.min(zoomRect.y0, zoomRect.y1);
    ctx.fillStyle = 'rgba(47,111,223,0.12)';
    ctx.fillRect(x, y, Math.abs(zoomRect.x1 - zoomRect.x0), Math.abs(zoomRect.y1 - zoomRect.y0));
    ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(zoomRect.x1 - zoomRect.x0), Math.abs(zoomRect.y1 - zoomRect.y0));
    ctx.setLineDash([]);
  }
  if (hover && inPlot(hover.sx, hover.sy) && (state.settings.crosshairs || hover.touch)) {
    const { sx, sy } = hover;
    const g = hover.touch ? 10 : 4;
    ctx.strokeStyle = c.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, L.top); ctx.lineTo(sx + 0.5, sy - g);
    ctx.moveTo(sx + 0.5, sy + g); ctx.lineTo(sx + 0.5, L.top + L.h);
    ctx.moveTo(L.left, sy + 0.5); ctx.lineTo(sx - g, sy + 0.5);
    ctx.moveTo(sx + g, sy + 0.5); ctx.lineTo(L.left + L.w, sy + 0.5);
    ctx.stroke();
    if (hover.touch) {
      ctx.beginPath();
      ctx.arc(sx, sy, g, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function showCoords(sx, sy) {
  if (inPlot(sx, sy)) {
    $('coords').textContent = `${state.sys.indep} = ${fmtNum(toT(sx))},  ${state.sys.dep} = ${fmtNum(toX(sy))}`;
  } else {
    $('coords').textContent = '';
  }
}

// ---------------------------------------------------------------- status / log
const log = { entries: [], count: 0, unseen: 0 };
function setStatus(msg, warn = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('warn', warn);
}
function defaultStatus() {
  const m = state.mode;
  if (m === 'zoom') {
    const z = state.settings.zoom;
    setStatus(z === 'rect' ? 'Zoom: drag a rectangle, or tap for 2× magnification.' : z === 'point' ? 'Zoom: tap a point for 2× magnification.' : 'Zoom: tap a point to center a square domain on it.');
  } else if (m === 'delete') setStatus('Tap on an orbit to delete it.', true);
  else if (m === 'text') setStatus('Tap where the lower left corner of the text should appear.', true);
  else setStatus('Tap in the direction field to plot a solution.');
}
function addLog(msg, show = false) {
  if (!msg) return;
  log.count++;
  log.entries.push(`${log.count}) ${msg}`);
  if (log.entries.length > 300) log.entries.splice(0, 50);
  const pre = $('logText');
  pre.textContent = log.entries.join('\n');
  pre.scrollTop = pre.scrollHeight;
  if (show) {
    $('logPanel').hidden = false;
  } else if ($('logPanel').hidden) {
    log.unseen++;
  }
  updateBadge();
}
function updateBadge() {
  const b = $('logBadge');
  b.hidden = log.unseen === 0 || !$('logPanel').hidden;
  b.textContent = String(log.unseen);
}
function clearLog() {
  log.entries = []; log.count = 0; log.unseen = 0;
  $('logText').textContent = '';
  updateBadge();
}

// ---------------------------------------------------------------- solving
function orbitBounds(o) {
  const v = state.view;
  const s = state.settings;
  const rt = v.tmax - v.tmin;
  const rx = v.xmax - v.xmin;
  const ex = ((s.compY - 1) * rx) / 2;
  const et = ((s.compX - 1) * rt) / 2;
  const tLo = o.bounded ? o.tLo : v.tmin - et;
  const tHi = o.bounded ? o.tHi : v.tmax + et;
  return { tLo, tHi, xLo: v.xmin - ex, xHi: v.xmax + ex, tRange: rt };
}

function makeOrbit(t0, x0, dir, group, bounded = null) {
  return {
    group, t0, x0, dir, method: state.settings.solver,
    bounded: !!bounded, tLo: bounded ? bounded[0] : 0, tHi: bounded ? bounded[1] : 0,
    pts: [], evals: 0, error: null,
  };
}

function startOrbit(o) {
  const b = orbitBounds(o);
  o.pts = [o.t0, o.x0];
  o.evals = 0;
  o.error = null;
  o.truncated = false;
  o.ctx = {
    f: state.sys.f, dep: state.sys.dep, params: state.solverParams,
    tEnd: o.dir > 0 ? b.tHi : b.tLo, tLo: b.tLo, tHi: b.tHi, xLo: b.xLo, xHi: b.xHi, tRange: b.tRange,
    evals: 0, error: null,
  };
  o.gen = SOLVERS[o.method](o.ctx, o.t0, o.x0);
}

function stepOrbit(o, maxPoints) {
  let k = 0;
  while (k < maxPoints) {
    const r = o.gen.next();
    if (r.done) return true;
    o.pts.push(r.value[0], r.value[1]);
    k++;
    if (o.pts.length / 2 >= MAX_POINTS_PER_ORBIT) { o.truncated = true; return true; }
  }
  return false;
}

function finishOrbit(o, interrupted = false) {
  o.evals = o.ctx.evals;
  o.error = o.ctx.error;
  const name = METHODS.find((m) => m.id === o.method).name;
  let msg = `${o.dir > 0 ? 'Forward' : 'Backward'} Orbit from (${fmtNum(o.t0, 7)} , ${fmtNum(o.x0, 7)})\n     evaluations of ODE (${name}) = ${o.evals}`;
  if (interrupted) msg += '\n     ******** Solver was interrupted.';
  if (o.truncated) msg += `\n     Stopped after ${MAX_POINTS_PER_ORBIT} points.`;
  addLog(msg, false);
  if (o.error) addLog(o.error, true);
  delete o.gen;
  delete o.ctx;
}

/** Computes orbits synchronously (no animation). */
function computeNow(orbits) {
  for (const o of orbits) {
    startOrbit(o);
    stepOrbit(o, Infinity);
    finishOrbit(o);
  }
}

function recomputeAll() {
  stopSolver(true);
  computeNow(state.orbits);
  renderBase();
}

function enqueueOrbits(orbits) {
  for (const o of orbits) state.orbits.push(o);
  run.queue.push(...orbits);
  if (!run.raf) {
    run.last = performance.now();
    run.budget = 0;
    $('btnStop').disabled = false;
    setStatus('Solving ODE…');
    run.raf = requestAnimationFrame(runFrame);
  }
}

function runFrame(now) {
  const delay = state.settings.delay;
  const elapsed = Math.min(100, now - run.last);
  run.last = now;
  let allowance;
  if (delay > 0) {
    run.budget += elapsed / delay;
    allowance = Math.floor(run.budget);
    run.budget -= allowance;
  } else {
    allowance = Infinity;
  }
  const deadline = performance.now() + 12;
  while ((allowance > 0) && performance.now() < deadline) {
    if (!run.active) {
      run.active = run.queue.shift();
      if (!run.active) break;
      startOrbit(run.active);
      drawOrbitIncrement(run.active, 0);
    }
    const o = run.active;
    const before = o.pts.length / 2;
    const chunk = delay > 0 ? Math.min(allowance, 2000) : 500;
    const done = stepOrbit(o, chunk);
    const after = o.pts.length / 2;
    if (delay > 0) allowance -= after - before;
    if (after > before) drawOrbitIncrement(o, before);
    if (done) {
      finishOrbit(o);
      run.active = null;
    } else if (delay > 0 && after === before) {
      break;
    }
  }
  if (run.active || run.queue.length) {
    run.raf = requestAnimationFrame(runFrame);
  } else {
    run.raf = 0;
    $('btnStop').disabled = true;
    defaultStatus();
    setStatus('Done.');
  }
}

function stopSolver(silent = false) {
  if (!run.raf && !run.active && !run.queue.length) return;
  cancelAnimationFrame(run.raf);
  run.raf = 0;
  if (run.active) finishOrbit(run.active, true);
  run.active = null;
  // queued orbits that never started are dropped
  const pending = new Set(run.queue);
  state.orbits = state.orbits.filter((o) => !pending.has(o));
  run.queue = [];
  $('btnStop').disabled = true;
  if (!silent) setStatus('Interrupted.', true);
}

function solveFrom(t, x) {
  const g = state.nextGroup++;
  const d = state.settings.direction;
  const list = [];
  if (d === 'both' || d === 'forward') list.push(makeOrbit(t, x, 1, g));
  if (d === 'both' || d === 'backward') list.push(makeOrbit(t, x, -1, g));
  enqueueOrbits(list);
}
function solveBounded(t, x, tLo, tHi) {
  const g = state.nextGroup++;
  const list = [];
  if (t < tHi) list.push(makeOrbit(t, x, 1, g, [tLo, tHi]));
  if (t > tLo) list.push(makeOrbit(t, x, -1, g, [tLo, tHi]));
  enqueueOrbits(list);
}

function deleteNearestOrbit(sx, sy) {
  let best = null, bestD = Infinity;
  for (const o of state.orbits) {
    const p = o.pts;
    for (let i = 0; i < p.length; i += 2) {
      const d = (px(p[i]) - sx) ** 2 + (py(p[i + 1]) - sy) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
  }
  if (!best || bestD > 50 * 50) {
    setStatus('No orbit near that point.', true);
    return;
  }
  if (run.active || run.queue.length) stopSolver(true);
  state.orbits = state.orbits.filter((o) => o.group !== best.group);
  renderBase();
  setStatus('Orbit deleted.');
}

// ---------------------------------------------------------------- graph / zoom
function graph() {
  const r = refreshValidation();
  if (!r.ok) {
    openPanel();
    return;
  }
  stopSolver(true);
  state.sys = r.sys;
  state.view = { ...r.win };
  state.orig = { ...r.win };
  state.ext = { ...r.win };
  state.history = [{ ...r.win }];
  state.solverParams = defaultSolverParams(r.win.tmin, r.win.tmax);
  state.texts = [];
  clearLog();
  $('eqTitle').textContent = r.sys.title;
  document.title = `DFIELD – ${r.sys.title}`;
  if (!$('keepIC').checked) state.orbits = [];
  computeNow(state.orbits);
  renderBase();
  renderOverlay();
  defaultStatus();
  saveStore();
}

function sameWin(a, b) {
  return a.tmin === b.tmin && a.tmax === b.tmax && a.xmin === b.xmin && a.xmax === b.xmax;
}
function setView(win, { push = true } = {}) {
  const o = state.orig;
  if ((o.tmax - o.tmin) / (win.tmax - win.tmin) > 10000 || (o.xmax - o.xmin) / (win.xmax - win.xmin) > 10000) {
    alertDialog('Error', 'Cannot zoom in more than 10,000x.');
    return false;
  }
  state.view = { ...win };
  if (push && !state.history.some((h) => sameWin(h, win))) state.history.push({ ...win });
  let extended = false;
  const e = state.ext;
  if (win.tmin < e.tmin) { e.tmin = win.tmin; extended = true; }
  if (win.tmax > e.tmax) { e.tmax = win.tmax; extended = true; }
  if (win.xmin < e.xmin) { e.xmin = win.xmin; extended = true; }
  if (win.xmax > e.xmax) { e.xmax = win.xmax; extended = true; }
  if (extended && state.orbits.length) {
    recomputeAll();
  } else {
    renderBase();
  }
  renderOverlay();
  return true;
}

function zoomAtPoint(t, x, type) {
  const v = state.view;
  if (type === 'square') {
    const d = Math.min(v.tmax - v.tmin, v.xmax - v.xmin) / 4;
    return setView({ tmin: t - d, tmax: t + d, xmin: x - d, xmax: x + d });
  }
  return setView({
    tmin: t - (t - v.tmin) / 2, tmax: t + (v.tmax - t) / 2,
    xmin: x - (x - v.xmin) / 2, xmax: x + (v.xmax - x) / 2,
  });
}
function zoomToRect(sx0, sy0, sx1, sy1) {
  const clampX = (s) => Math.min(L.left + L.w, Math.max(L.left, s));
  const clampY = (s) => Math.min(L.top + L.h, Math.max(L.top, s));
  const t0 = toT(clampX(sx0)), t1 = toT(clampX(sx1));
  const x0 = toX(clampY(sy0)), x1 = toX(clampY(sy1));
  if (t0 === t1 || x0 === x1) return false;
  return setView({ tmin: Math.min(t0, t1), tmax: Math.max(t0, t1), xmin: Math.min(x0, x1), xmax: Math.max(x0, x1) });
}
function zoomOut2x() {
  const v = state.view;
  const dt = (v.tmax - v.tmin) / 2, dx = (v.xmax - v.xmin) / 2;
  setView({ tmin: v.tmin - dt, tmax: v.tmax + dt, xmin: v.xmin - dx, xmax: v.xmax + dx });
}

// ---------------------------------------------------------------- pointer input
const pointers = new Map();
let gesture = null;
let wheel = null;

function localPos(e) {
  const r = overCv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function setPreviewTransform(s, tx, ty) {
  baseCv.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}
function clearPreviewTransform() {
  baseCv.style.transform = '';
}
/** Commits a screen transform  screen' = screen*s + (tx,ty)  as a new view. */
function commitTransform(s, tx, ty) {
  clearPreviewTransform();
  if (Math.abs(s - 1) < 0.01 && Math.abs(tx) < 4 && Math.abs(ty) < 4) {
    renderBase();
    return;
  }
  const inv = (X) => (X - tx) / s;
  const invY = (Y) => (Y - ty) / s;
  const tmin = toT(inv(L.left)), tmax = toT(inv(L.left + L.w));
  const xmax = toX(invY(L.top)), xmin = toX(invY(L.top + L.h));
  if (!setView({ tmin, tmax, xmin, xmax })) renderBase();
}

function onPointerDown(e) {
  if (!state.view) return;
  try { overCv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', a0: { ...a }, b0: { ...b }, s: 1, tx: 0, ty: 0 };
    zoomRect = null;
    hover = null;
    renderOverlay();
    return;
  }
  if (pointers.size > 2) return;
  const zoomKey = e.shiftKey || e.ctrlKey || e.metaKey;
  const mode = zoomKey ? 'zoom' : state.mode;
  gesture = { type: 'single', id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, mode, touch: e.pointerType !== 'mouse' };
  if (mode === 'solve' || mode === 'text') {
    hover = { sx: p.x, sy: p.y, touch: gesture.touch };
    showCoords(p.x, p.y);
    renderOverlay();
  }
}

function onPointerMove(e) {
  if (!state.view) return;
  const p = localPos(e);
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType === 'mouse') {
      hover = { sx: p.x, sy: p.y, touch: false };
      showCoords(p.x, p.y);
      renderOverlay();
    }
    return;
  }
  pointers.set(e.pointerId, p);
  if (!gesture) return;
  if (gesture.type === 'pinch') {
    const [a, b] = [...pointers.values()];
    if (!b) return;
    const { a0, b0 } = gesture;
    const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
    const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const s = d1 / d0;
    const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture.s = s;
    gesture.tx = m1.x - m0.x * s;
    gesture.ty = m1.y - m0.y * s;
    setPreviewTransform(gesture.s, gesture.tx, gesture.ty);
    return;
  }
  if (gesture.type !== 'single' || gesture.id !== e.pointerId) return;
  gesture.x = p.x; gesture.y = p.y;
  if (gesture.mode === 'zoom' && state.settings.zoom === 'rect') {
    if (Math.hypot(p.x - gesture.x0, p.y - gesture.y0) > 8) {
      zoomRect = { x0: gesture.x0, y0: gesture.y0, x1: p.x, y1: p.y };
      renderOverlay();
    }
    showCoords(p.x, p.y);
  } else if (gesture.mode === 'solve' || gesture.mode === 'text') {
    hover = { sx: p.x, sy: p.y, touch: gesture.touch };
    showCoords(p.x, p.y);
    renderOverlay();
  }
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') {
    gesture = pointers.size ? { type: 'done' } : null;
    commitTransform(g.s, g.tx, g.ty);
    return;
  }
  if (g.type !== 'single' || g.id !== e.pointerId) {
    if (!pointers.size) gesture = null;
    return;
  }
  gesture = null;
  const cancelled = e.type === 'pointercancel';
  const p = { x: g.x, y: g.y };
  const rect = zoomRect;
  zoomRect = null;
  if (g.touch) hover = null;
  renderOverlay();
  if (cancelled) return;
  handleTap(g.mode, p, g, rect);
}

function handleTap(mode, p, g, rect) {
  if (mode === 'text') {
    if (!inPlot(p.x, p.y) || !state.pendingText) return;
    state.texts.push({ text: state.pendingText, t: toT(p.x), x: toX(p.y) });
    state.pendingText = null;
    setMode('solve');
    renderBase();
    return;
  }
  if (mode === 'zoom') {
    if (rect) { zoomToRect(rect.x0, rect.y0, rect.x1, rect.y1); return; }
    if (!inPlot(p.x, p.y)) return;
    const type = state.settings.zoom === 'square' ? 'square' : 'point';
    zoomAtPoint(toT(p.x), toX(p.y), type);
    return;
  }
  if (!inPlot(p.x, p.y)) return;
  if (mode === 'delete') { deleteNearestOrbit(p.x, p.y); return; }
  solveFrom(toT(p.x), toX(p.y));
}

function onWheel(e) {
  if (!state.view || !L) return;
  e.preventDefault();
  const p = localPos(e);
  const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  if (!wheel) wheel = { s: 1, tx: 0, ty: 0, timer: 0 };
  // compose: new = old scaled around p
  wheel.s *= factor;
  wheel.tx = p.x - (p.x - wheel.tx) * factor;
  wheel.ty = p.y - (p.y - wheel.ty) * factor;
  setPreviewTransform(wheel.s, wheel.tx, wheel.ty);
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(() => {
    const w = wheel;
    wheel = null;
    commitTransform(w.s, w.tx, w.ty);
  }, 280);
}

// ---------------------------------------------------------------- dialogs
const dlg = $('dlg');
function openDialog({ title, body, buttons = [{ label: 'OK', value: 'ok', primary: true }], validate }) {
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
      if (btn.value === 'cancel') el.formNoValidate = true;
      bb.append(el);
    }
    const form = $('dlgForm');
    form.onsubmit = (e) => {
      const v = e.submitter ? e.submitter.value : 'ok';
      if (validate && v !== 'cancel' && validate(v, b) === false) e.preventDefault();
    };
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dlg.showModal();
    const first = b.querySelector('input:not([type=checkbox]):not([type=radio]), select');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  });
}
function alertDialog(title, text) {
  const pre = document.createElement('pre');
  pre.textContent = text;
  return openDialog({ title, body: pre });
}
async function promptDialog(title, label, value = '') {
  const box = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = label;
  const input = document.createElement('input');
  input.value = value;
  box.append(p, input);
  const r = await openDialog({ title, body: box, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }] });
  return r === 'ok' ? input.value : null;
}
function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

async function keyboardInput() {
  const s = state.sys;
  const body = el(`
    <p>Enter the initial conditions:</p>
    <div class="grid2">
      <label for="kiT">${s.indep} =</label><input id="kiT" inputmode="decimal">
      <label for="kiX">${s.dep} =</label><input id="kiX" inputmode="decimal">
    </div>
    <label class="check"><input type="checkbox" id="kiBound"> Specify a computation interval</label>
    <div class="grid2">
      <label for="kiMin">min ${s.indep}</label><input id="kiMin" inputmode="decimal" disabled>
      <label for="kiMax">max ${s.indep}</label><input id="kiMax" inputmode="decimal" disabled>
    </div>
    <p id="kiErr" class="error" hidden></p>`);
  const q = (id) => body.querySelector(id);
  q('#kiBound').onchange = () => { q('#kiMin').disabled = q('#kiMax').disabled = !q('#kiBound').checked; };
  const num = (id) => { const t = q(id).value.trim(); return t === '' ? NaN : Number(t); };
  let vals = null;
  const r = await openDialog({
    title: 'Keyboard Input of Initial Value', body,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Solve', value: 'ok', primary: true }],
    validate: () => {
      const err = q('#kiErr');
      const t = num('#kiT'), x = num('#kiX');
      let msg = null;
      if (!Number.isFinite(t) || !Number.isFinite(x)) msg = 'Please enter numbers for both initial values.';
      let lo = 0, hi = 0;
      if (!msg && q('#kiBound').checked) {
        lo = num('#kiMin'); hi = num('#kiMax');
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) msg = 'Please enter the computation interval.';
        else if (lo > hi) msg = `The minimum value of ${s.indep} must be less than the maximum.`;
        else if (t < lo || t > hi) msg = `The initial value of ${s.indep} must be in the computation interval.`;
      }
      if (msg) { err.textContent = msg; err.hidden = false; return false; }
      vals = { t, x, bounded: q('#kiBound').checked, lo, hi };
      return true;
    },
  });
  if (r !== 'ok' || !vals) return;
  if (vals.bounded) solveBounded(vals.t, vals.x, vals.lo, vals.hi);
  else solveFrom(vals.t, vals.x);
}

async function solverSettingsDialog() {
  const body = el(`
    <div class="row"><label for="ssMethod">Solver</label><select id="ssMethod">${METHODS.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
    <div class="grid2">
      <label for="ss0">Step size:</label><input id="ss0" inputmode="decimal">
      <label for="ss1">Error tolerance:</label><input id="ss1" inputmode="decimal">
      <label for="ss2">Maximum step size:</label><input id="ss2" inputmode="decimal">
      <label for="ss3">Minimum step size:</label><input id="ss3" inputmode="decimal">
      <label for="ss4">Plot steps per computation step:</label><input id="ss4" inputmode="numeric">
    </div>
    <button type="button" class="secondary" id="ssDefault">Default values</button>`);
  const q = (id) => body.querySelector(id);
  const sel = q('#ssMethod');
  sel.value = state.settings.solver;
  const fields = [0, 1, 2, 3, 4].map((i) => q(`#ss${i}`));
  const fill = (params) => {
    const m = sel.value;
    const p = params[m];
    fields.forEach((f) => { f.value = ''; f.disabled = true; });
    if (m === 'euler' || m === 'rk2' || m === 'rk4') {
      fields[0].value = String(p.h); fields[0].disabled = false;
    } else {
      fields[1].value = String(p.tol); fields[2].value = String(p.hmax); fields[3].value = String(p.hmin);
      fields[1].disabled = fields[2].disabled = fields[3].disabled = false;
      if (m === 'dp') { fields[4].value = String(p.refine); fields[4].disabled = false; }
    }
  };
  sel.onchange = () => { setSolver(sel.value); fill(state.solverParams); };
  q('#ssDefault').onclick = () => fill(defaultSolverParams(state.view.tmin, state.view.tmax));
  fill(state.solverParams);
  const r = await openDialog({ title: 'Solver Settings', body, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Apply', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  const m = sel.value;
  setSolver(m);
  const def = defaultSolverParams(state.view.tmin, state.view.tmax)[m];
  const pos = (f, d) => { const v = Number(f.value); return Number.isFinite(v) && v > 0 ? v : d; };
  const p = state.solverParams[m];
  if ('h' in p) p.h = pos(fields[0], def.h);
  else {
    p.tol = pos(fields[1], def.tol);
    p.hmax = pos(fields[2], def.hmax);
    p.hmin = pos(fields[3], def.hmin);
    if (p.hmax < p.hmin) { p.hmax = def.hmax; p.hmin = def.hmin; }
    if (m === 'dp') p.refine = Math.max(1, Math.round(pos(fields[4], 4)));
  }
}

async function fieldSettingsDialog() {
  const s = state.settings;
  const sys = state.sys;
  const body = el(`
    <p><strong>Direction field:</strong></p>
    <div class="radio-list">
      <label><input type="radio" name="dfType" value="arrows"> Arrows</label>
      <label><input type="radio" name="dfType" value="lines"> Lines</label>
      <label><input type="radio" name="dfType" value="none"> None</label>
    </div>
    <div class="grid2">
      <label for="dfRows">Field points per row:</label><input id="dfRows" inputmode="numeric" value="${s.rows}">
      <label for="dfCols">Field points per column:</label><input id="dfCols" inputmode="numeric" value="${s.cols}">
    </div>
    <p><strong>Computation window is:</strong></p>
    <div class="grid2">
      <input id="dfCompY" inputmode="decimal" value="${s.compY}"><label for="dfCompY">times view range of ${sys.dep}</label>
      <input id="dfCompX" inputmode="decimal" value="${s.compX}"><label for="dfCompX">times view range of ${sys.indep}</label>
    </div>`);
  const type = !s.showField ? 'none' : s.arrows ? 'arrows' : 'lines';
  body.querySelector(`input[value=${type}]`).checked = true;
  const r = await openDialog({ title: 'Direction Field Settings', body, buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Apply', value: 'ok', primary: true }] });
  if (r !== 'ok') return;
  const t = body.querySelector('input[name=dfType]:checked').value;
  s.showField = t !== 'none';
  s.arrows = t === 'arrows';
  const int5 = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(5, Math.min(200, n)) : 5; };
  const ge1 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(1, n) : 100; };
  s.rows = int5(body.querySelector('#dfRows').value);
  s.cols = int5(body.querySelector('#dfCols').value);
  s.compY = ge1(body.querySelector('#dfCompY').value);
  s.compX = ge1(body.querySelector('#dfCompX').value);
  saveStore();
  renderBase();
}

async function zoomOutDialog() {
  const box = document.createElement('div');
  box.className = 'zoom-list';
  const sys = state.sys;
  const entries = [{ label: '2× out beyond current view', act: zoomOut2x }, { label: 'Original', act: () => setView(state.orig, { push: false }) }];
  state.history.slice(1).forEach((w) => {
    const dx = (w.xmax - w.xmin) / 10, dt = (w.tmax - w.tmin) / 10;
    entries.push({
      label: `${fmtTick(w.xmin, dx)} ≤ ${sys.dep} ≤ ${fmtTick(w.xmax, dx)}     ${fmtTick(w.tmin, dt)} ≤ ${sys.indep} ≤ ${fmtTick(w.tmax, dt)}`,
      act: () => setView(w, { push: false }),
    });
  });
  entries.forEach((en, i) => {
    const b = document.createElement('button');
    b.value = String(i);
    b.textContent = en.label;
    box.append(b);
  });
  const r = await openDialog({ title: 'Zoom Out', body: box, buttons: [{ label: 'Close', value: 'cancel' }] });
  const i = Number(r);
  if (r !== 'cancel' && Number.isInteger(i) && entries[i]) entries[i].act();
}

const SYNTAX_HELP = `Expression Syntax:

Constants:
   e    base of the Natural Logarithm
   pi   ratio of circumference to diameter of a circle

Arithmetic Operators:
   +    Addition, 5+x
   -    Unary Negation: -x, e^-x
   -    Subtraction: 5-x
   *    Multiplication: 5*x
           also 5x, 5(x), (5)(x),  5sin(x),  5xt,  5(x+1)
   /    Division: 5/x
   ^    Exponentiation: t^x
           if t is not an integer, and t<0, then
           t^x = -(|t|^x)
           also, 0^0 = 1

Logical Operators:
   <    x<t     1 if true, 0 if false
   <=   x<=t    1 if true, 0 if false
   >    x>t     1 if true, 0 if false
   >=   x>=t    1 if true, 0 if false
   ==   x==t    1 if true, 0 if false
   <>   x<>t    1 if true, 0 if false

Trigonometric Functions (in radians):
   sin(t),  cos(x),  tan(x)
   cot(x),  sec(x),  csc(x)
   asin(x), acos(x), atan(x)
   acot(x), asec(x), acsc(x)

Logarithm Functions:
   log(x)    natural logarithm of x
   log10(x)  logarithm of x to base 10
   exp(x)    base of the natural logarithm raised
                 to the power of x

Hyperbolic Functions:
   sinh(x),  cosh(x),  tanh(x)
   asinh(x), acosh(x), atanh(x)

Elementary Functions:
   abs(x)    absolute value of x
   sqrt(x)   square root of x (undefined for x<0)
   sign(x)   0 if x=0, -1 if x<0, and +1 if x>0

Variable, Parameter and Constant names must:
   1) be 8 or less characters in length.
   2) begin with a alphabetic character.
   3) contain only alphabetic and/or numeric characters.

Parameters may be numbers, constant expressions or
expressions of the two variables.`;

const HOWTO_HELP = `Touch controls

Solve:   Tap (or touch and slide, then release) anywhere in the
         direction field. The solution through that point is
         plotted. Cross-hairs show the exact point while your
         finger is down. You can tap several points in a row.

Zoom:    Drag a rectangle to zoom into it, or tap for a 2×
         magnification about the point (see Menu → Zoom-in).

Pinch:   Two fingers zoom and pan at any time.

Delete:  Tap on (or near) an orbit to delete it.

Text:    Enter a text, then tap where its lower left corner
         should be.

Zoom out: lists the original window, earlier windows,
         and "2× out beyond current view".

Stop:    Stops the running ODE solver.

Mouse & keyboard: click to solve, Shift/Ctrl-click or drag to
zoom, mouse wheel zooms around the cursor.

Tip: In Safari use Share → "Add to Home Screen" to run DFIELD
full screen like an app.`;

function aboutDialog() {
  const body = el(`
    <p style="color:#008000;font-weight:600">DFIELD is an interactive tool for studying single first order differential equations. DFIELD graphs a direction field for a given differential equation. When you tap (or click) in the direction field, that point is used as an initial condition, and the resulting solution is plotted. Options include selecting between a variety of numerical solvers and parameters of those solvers.</p>
    <p>This software is designed as a companion for <em>Ordinary Differential Equations using MATLAB</em> by David Arnold &amp; John C. Polking.</p>
    <p><strong>DFIELD 2014.08b</strong><br>Copyright 1994 – 2014, John C. Polking, Joel Castellanos<br>
    John Polking – Professor, Dept. of Mathematics, Rice University.<br>
    Joel Castellanos – Lecturer, Dept. of Computer Science, Univ. of New Mexico.</p>
    <p>Web &amp; touch port of the Java application (HTML5 canvas, runs fully in the browser).</p>`);
  return openDialog({ title: 'About DFIELD', body });
}

async function clearDialog() {
  const r = await openDialog({
    title: 'Clear',
    body: el('<p>What should be cleared in the equation window?</p>'),
    buttons: [
      { label: 'Equation', value: 'eq' }, { label: 'Parameters', value: 'par' },
      { label: 'Display window', value: 'win' }, { label: 'All', value: 'all', primary: true },
    ],
  });
  if (r === 'cancel') return;
  if (r === 'eq' || r === 'all') { F.dep.value = ''; F.indep.value = ''; F.expr.value = ''; }
  if (r === 'par' || r === 'all') { F.paramNames.forEach((n) => { n.value = ''; }); F.paramVals.forEach((n) => { n.value = ''; }); }
  if (r === 'win' || r === 'all') { F.tmin.value = ''; F.tmax.value = ''; F.xmin.value = ''; F.xmax.value = ''; }
  setDescription('');
  refreshValidation();
  saveStore();
}

async function addToGallery() {
  const name = await promptDialog('Add to Gallery', 'Provide a name for this system:');
  if (!name) return;
  const f = readForm();
  state.gallery.push({
    name, description: name, dep: f.dep, indep: f.indep, expr: f.expr, params: f.params,
    tmin: Number(f.tmin), tmax: Number(f.tmax), xmin: Number(f.xmin), xmax: Number(f.xmax),
  });
  renderGallerySelect();
  saveStore();
}
async function removeFromGallery() {
  if (!state.gallery.length) {
    alertDialog('Remove from Gallery', 'There are no user systems in the gallery.\nBuilt-in systems cannot be removed.');
    return;
  }
  const box = document.createElement('div');
  box.className = 'zoom-list';
  state.gallery.forEach((g, i) => {
    const b = document.createElement('button');
    b.value = String(i);
    b.textContent = `Delete ${g.name}`;
    box.append(b);
  });
  const r = await openDialog({ title: 'Remove from Gallery', body: box, buttons: [{ label: 'Close', value: 'cancel' }] });
  const i = Number(r);
  if (r === 'cancel' || !Number.isInteger(i)) return;
  state.gallery.splice(i, 1);
  renderGallerySelect();
  saveStore();
}

// ---------------------------------------------------------------- dfield.ini
function exportIni() {
  const s = state.settings;
  const lines = [
    'DFIELD 2014.08b',
    `Background=${s.bg}`,
    `Fontsize=${s.fontSize}`,
    `plotDelay=${s.delay}`,
    `showDF=${s.showField}`,
    `showArrows=${s.arrows}`,
    `showCrossHairs=${s.crosshairs}`,
    `fieldPointsRow=${s.rows}`,
    `fieldPointsColumn=${s.cols}`,
    `computationWindowX=${s.compX}`,
    `computationWindowY=${s.compY}`,
    `UserSystemCount=${state.gallery.length}`,
  ];
  const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  for (const g of state.gallery) {
    lines.push(g.name, g.dep, g.indep, g.expr);
    for (let i = 0; i < 4; i++) {
      const [n, v] = g.params[i] || ['', ''];
      lines.push(n ? `${n}=${v}` : '=');
    }
    lines.push(`${num(g.tmin)} ${num(g.tmax)} ${num(g.xmin)} ${num(g.xmax)}`);
  }
  download(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), 'dfield.ini');
}

function importIni(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const next = () => {
    if (i >= lines.length) throw new Error('Unexpected end of file');
    return lines[i++];
  };
  const val = (l) => l.slice(l.indexOf('=') + 1).trim();
  if (!next().startsWith('DFIELD')) throw new Error('Not a dfield.ini file.');
  const s = { ...state.settings };
  s.bg = next().trim() === 'Background=black' ? 'black' : 'white';
  const fs = parseInt(val(next()), 10);
  s.fontSize = [10, 12, 14, 16, 18].includes(fs) ? fs : 14;
  const delay = parseInt(val(next()), 10);
  s.delay = Number.isFinite(delay) ? delay : 1;
  s.showField = val(next()) === 'true';
  s.arrows = val(next()) === 'true';
  s.crosshairs = val(next()) === 'true';
  s.rows = Math.max(5, parseInt(val(next()), 10) || 20);
  s.cols = Math.max(5, parseInt(val(next()), 10) || 20);
  s.compX = Math.max(1, parseFloat(val(next())) || 1);
  s.compY = Math.max(1, parseFloat(val(next())) || 100);
  const count = parseInt(val(next()), 10) || 0;
  const gallery = [];
  for (let k = 0; k < count; k++) {
    const name = next(), dep = next(), indep = next(), expr = next();
    const params = [];
    for (let j = 0; j < 4; j++) {
      const l = next();
      const p = l.indexOf('=');
      params.push(p <= 0 ? ['', ''] : [l.slice(0, p), l.slice(p + 1)]);
    }
    const nums = next().trim().split(/\s+/).map(Number);
    gallery.push({ name, description: name, dep, indep, expr, params, tmin: nums[0], tmax: nums[1], xmin: nums[2], xmax: nums[3] });
  }
  state.settings = s;
  state.gallery = gallery;
}

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

async function savePng() {
  const blob = await new Promise((res) => baseCv.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'dfield.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: 'DFIELD' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, 'dfield.png');
}

function printPlot() {
  let img = document.querySelector('img.print-only');
  if (!img) {
    img = document.createElement('img');
    img.className = 'print-only';
    img.alt = '';
    document.body.append(img);
  }
  img.src = baseCv.toDataURL('image/png');
  img.onload = () => window.print();
}

// ---------------------------------------------------------------- menu & options
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode !== 'text') state.pendingText = null;
  defaultStatus();
}
function setSolver(id) {
  state.settings.solver = id;
  document.querySelectorAll('#optSolver input').forEach((i) => { i.checked = i.value === id; });
  saveStore();
}
async function startTextAnnotation() {
  const text = await promptDialog('Text Annotation', 'Enter text. Then tap in the direction field where the lower left corner of the text should appear.');
  if (!text) { if (state.mode === 'text') setMode('solve'); return; }
  setMode('text');
  state.pendingText = text;
}

function syncOptionsUI() {
  const s = state.settings;
  setSolver(s.solver);
  document.querySelectorAll('#optDirection button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.direction));
  document.querySelectorAll('#optZoom input').forEach((i) => { i.checked = i.value === s.zoom; });
  $('optShowPoints').checked = s.showPoints;
  $('optCrosshairs').checked = s.crosshairs;
  $('optBg').value = s.bg;
  $('optFont').value = String(s.fontSize);
  $('optDelay').value = String(s.delay);
  if ($('optDelay').value !== String(s.delay)) { s.delay = 1; $('optDelay').value = '1'; }
}

function buildMenu() {
  const box = $('optSolver');
  for (const m of METHODS) {
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="radio" name="solver" value="${m.id}"> ${m.name}`;
    box.append(lab);
  }
  box.addEventListener('change', (e) => setSolver(e.target.value));
  $('optDirection').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.settings.direction = b.dataset.v;
    syncOptionsUI();
    saveStore();
  });
  $('optZoom').addEventListener('change', (e) => { state.settings.zoom = e.target.value; saveStore(); if (state.mode === 'zoom') defaultStatus(); });
  $('optShowPoints').onchange = (e) => { state.settings.showPoints = e.target.checked; saveStore(); renderBase(); };
  $('optCrosshairs').onchange = (e) => { state.settings.crosshairs = e.target.checked; saveStore(); renderOverlay(); };
  $('optBg').onchange = (e) => { state.settings.bg = e.target.value; saveStore(); renderBase(); };
  $('optFont').onchange = (e) => { state.settings.fontSize = Number(e.target.value); saveStore(); renderBase(); };
  $('optDelay').onchange = (e) => { state.settings.delay = Number(e.target.value); saveStore(); };

  const menu = $('menuDlg');
  menu.addEventListener('click', (e) => {
    if (e.target === menu || e.target.closest('[data-close]')) { menu.close(); return; }
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    menu.close();
    const actions = {
      keyboard: keyboardInput,
      recalc: () => { state.orbits.forEach((o) => { o.method = state.settings.solver; }); recomputeAll(); },
      deleteAll: () => { stopSolver(true); state.orbits = []; renderBase(); },
      textAnno: startTextAnnotation,
      eraseLastText: () => { state.texts.pop(); renderBase(); },
      eraseAllText: () => { state.texts = []; renderBase(); },
      solverSettings: solverSettingsDialog,
      fieldSettings: fieldSettingsDialog,
      savePng,
      print: printPlot,
      exportIni,
      importIni: () => $('iniFile').click(),
      syntax: () => alertDialog('Syntax and Symbols', SYNTAX_HELP),
      howto: () => alertDialog('Using DFIELD', HOWTO_HELP),
      about: aboutDialog,
    };
    actions[b.dataset.action]?.();
  });
  $('iniFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      importIni(await file.text());
      syncOptionsUI();
      renderGallerySelect();
      saveStore();
      renderBase();
      alertDialog('Preferences', `Loaded ${file.name}: ${state.gallery.length} user system(s) in the gallery.`);
    } catch (err) {
      alertDialog('Error', `Could not read ${file.name}:\n${err.message}`);
    }
  };
}

// ---------------------------------------------------------------- panel (drawer)
const narrow = matchMedia('(max-width: 1023px)');
function openPanel() {
  const p = $('panel');
  if (narrow.matches) {
    p.classList.add('open');
    $('scrim').hidden = false;
  } else {
    p.classList.remove('hidden-wide');
    requestAnimationFrame(onResize);
  }
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
    requestAnimationFrame(onResize);
  }
}

// ---------------------------------------------------------------- init
function onResize() {
  resizeCanvases();
  renderBase();
  renderOverlay();
}

function init() {
  loadStore();
  buildParamRows();
  buildMenu();
  renderGallerySelect();
  syncOptionsUI();

  const initial = state.form && state.form.expr !== undefined ? state.form : {
    description: '', dep: 'x', indep: 't', expr: 'x^2 - at + b', params: [['a', '1'], ['b', '0'], ['', ''], ['', '']],
    tmin: '-2', tmax: '10', xmin: '-4', xmax: '4',
  };
  writeForm(initial);

  const formInputs = [F.dep, F.indep, F.expr, F.tmin, F.tmax, F.xmin, F.xmax, ...F.paramNames, ...F.paramVals];
  formInputs.forEach((inp) => {
    inp.addEventListener('input', () => {
      if (inp === F.expr || F.paramVals.includes(inp)) setDescription('');
      refreshValidation();
      saveStore();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); graphAndClose(); } });
  });
  $('gallerySelect').onchange = (e) => { if (e.target.value) loadGalleryItem(e.target.value); e.target.value = ''; };
  const graphAndClose = () => {
    graph();
    if (narrow.matches && state.view && refreshValidation().ok) closePanel();
    if (document.activeElement && document.activeElement.blur && matchMedia('(pointer: coarse)').matches) document.activeElement.blur();
  };
  $('btnGraph').onclick = graphAndClose;
  $('btnAddGallery').onclick = addToGallery;
  $('btnRemoveGallery').onclick = removeFromGallery;
  $('btnClearMenu').onclick = clearDialog;
  $('btnPanel').onclick = togglePanel;
  $('btnPanelClose').onclick = closePanel;
  $('scrim').onclick = closePanel;
  narrow.addEventListener('change', () => { closePanel(); onResize(); });

  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.mode === 'text') { startTextAnnotation(); return; }
      setMode(b.dataset.mode);
    };
  });
  $('btnZoomOut').onclick = () => { if (state.view) zoomOutDialog(); };
  $('btnStop').onclick = () => stopSolver();
  $('btnMenu').onclick = () => $('menuDlg').showModal();
  $('btnLog').onclick = () => {
    const p = $('logPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) log.unseen = 0;
    updateBadge();
  };
  $('btnLogHide').onclick = () => { $('logPanel').hidden = true; updateBadge(); };
  $('btnLogClear').onclick = clearLog;

  overCv.addEventListener('pointerdown', onPointerDown);
  overCv.addEventListener('pointermove', onPointerMove);
  overCv.addEventListener('pointerup', onPointerUp);
  overCv.addEventListener('pointercancel', onPointerUp);
  overCv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) { hover = null; $('coords').textContent = ''; renderOverlay(); }
  });
  overCv.addEventListener('wheel', onWheel, { passive: false });
  overCv.addEventListener('contextmenu', (e) => e.preventDefault());
  // iOS: block page-level pinch zoom / double tap zoom gestures
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (run.raf || run.active)) stopSolver();
  });

  new ResizeObserver(() => onResize()).observe(wrap);
  resizeCanvases();
  if (narrow.matches) closePanel();
  graph();
  if (!refreshValidation().ok) openPanel();
}

init();
