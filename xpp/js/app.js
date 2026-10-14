// XPP lite – main application (UI, rendering, interaction).
import { compileOde } from './ode.js';
import { integrate, METHODS, methodFromXpp } from './integrators.js';
import { newton, equilibriumInfo, oneDimManifolds, fmtEig } from './analysis.js';
import { continueEquilibria, branchSwitchDirection } from './continuation.js';
import { periodicSweep } from './sweep.js';
import { EXAMPLES } from './examples.js';
import { FONT_FAMILY, fmt, layout2D, makeMap, drawAxes, polyline, zeroContour, niceTicks, fmtTick } from './plot.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'xpp.v1';
const LS_MODELS = 'xpp.models';
const PALETTE = ['#1f5fd6', '#9b37d6', '#e07b00', '#00897b', '#c2185b', '#6d4c41', '#3949ab', '#222222', '#0097a7', '#8e6c00'];
const COL_NULL_X = '#e0161b';
const COL_NULL_Y = '#11a04a';
const COL_FIELD = '#7d8794';
const COL_UNSTABLE_MAN = '#d0312d';
const COL_STABLE_MAN = '#2f6fdf';

// ---------------------------------------------------------------- state
const DEFAULT_NUM = { method: 'rk4', total: 20, t0: 0, dt: 0.05, nOut: 1, trans: 0, rtol: 1e-6, atol: 1e-9, bound: 1e6, dir: 'forward', live: true };
const DEFAULT_PLOT = {
  x: 0, y: 1, field: 'arrows', density: 16, nullclines: true, eq: true, manifolds: true,
  timeVars: [0], autoTime: true, x3: 0, y3: 1, z3: 2, lw: 1.6, font: 14,
};

const S = {
  text: '',
  sys: null,
  model: null,
  ic: new Float64Array(0),
  parRange: [],
  num: { ...DEFAULT_NUM },
  plot: { ...DEFAULT_PLOT },
  view: 'phase',
  mode: 'ic',
  tab: 'model',
  win: {
    phase: { xlo: -2, xhi: 2, ylo: -2, yhi: 2 },
    time: { xlo: 0, xhi: 20, ylo: -2, yhi: 2 },
    bif: { xlo: 0, xhi: 1, ylo: -1, yhi: 1 },
  },
  box3d: null,
  rot: { yaw: -0.65, pitch: 0.4, zoom: 1 },
  defaults: null,
  orbits: [],
  colorIdx: 0,
  equilibria: [],
  bif: { par: 0, pmin: 0, pmax: 1, ds: 0.02, dsmax: 0.2, nmax: 400, dir: 'both', y: 'v0' },
  sweepSet: { steps: 40, trans: 200, sample: 100, updown: false },
  branches: [],
  sweep: [],
  specialCount: 0,
  bifSel: null,
  busy: null,
  lastFull: 0,
};

// ---------------------------------------------------------------- persistence
let saveTimer = 0;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function saveNow() {
  if (!S.sys) return;
  const sys = S.sys;
  const names = seriesNames();
  const nm = (i) => names[i + 1];
  const data = {
    text: S.text,
    pars: Object.fromEntries(sys.pars.map((p, i) => [p, sys.P[i]])),
    parRange: Object.fromEntries(sys.pars.map((p, i) => [p, S.parRange[i]])),
    ic: Object.fromEntries(sys.vars.map((v, i) => [v, S.ic[i]])),
    num: S.num,
    plot: { ...S.plot, x: nm(S.plot.x), y: nm(S.plot.y), x3: nm(S.plot.x3), y3: nm(S.plot.y3), z3: nm(S.plot.z3), timeVars: S.plot.timeVars.map(nm) },
    view: S.view, mode: S.mode, tab: S.tab, win: S.win, box3d: S.box3d, rot: S.rot,
    bif: { ...S.bif, par: sys.pars[S.bif.par] || '' },
    sweepSet: S.sweepSet,
    textDraft: $('odeText').value,
  };
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* quota */ }
}
function loadStore() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
function loadMyModels() {
  try { const v = JSON.parse(localStorage.getItem(LS_MODELS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveMyModels(list) {
  try { localStorage.setItem(LS_MODELS, JSON.stringify(list)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- helpers
function seriesNames() {
  const s = S.sys;
  return ['t', ...s.vars, ...s.aux];
}
/** Series index: -1 = t, 0..n-1 = variables, n.. = aux. */
function seriesName(i) { return seriesNames()[i + 1] ?? '?'; }
function seriesIndex(name) {
  if (name == null) return null;
  const l = String(name).toLowerCase();
  const i = seriesNames().findIndex((s) => s.toLowerCase() === l);
  return i < 0 ? null : i - 1;
}
function col(orbit, i) { return i < 0 ? orbit.res.t : orbit.res.cols[i]; }
function isVar(i) { return i >= 0 && i < S.sys.n; }
function num(v, def) { const x = Number(v); return Number.isFinite(x) ? x : def; }
function parseNum(txt) {
  // accept decimal commas (German/European iPad keyboards) and unicode minus
  let t = String(txt).trim().replace(/[\u2212\u2013]/g, '-');
  if (/^[+-]?\d*,\d+(e[+-]?\d+)?$/i.test(t)) t = t.replace(',', '.');
  if (!t) return NaN;
  const v = Number(t);
  if (Number.isFinite(v)) return v;
  // allow simple expressions like 8/3, 2*pi
  if (/^[0-9eE+\-*/.() pi]+$/.test(t)) {
    try {
      // eslint-disable-next-line no-new-func
      const r = new Function('pi', `return (${t});`)(Math.PI);
      if (Number.isFinite(r)) return r;
    } catch { /* fallthrough */ }
  }
  return NaN;
}
function nextColor() { const c = PALETTE[S.colorIdx % PALETTE.length]; S.colorIdx++; return c; }
let statusTimer = 0;
function setStatus(msg, warn = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
  el.title = msg;
  clearTimeout(statusTimer);
}

// ---------------------------------------------------------------- model
function optVal(k) { const o = S.sys.opts[k]; return o ? o.value : undefined; }
function optNum(k, def) { const v = optVal(k); if (v === undefined) return def; const x = parseNum(v); return Number.isFinite(x) ? x : def; }

function defaultParRange(v) {
  if (v === 0) return [-1, 1];
  const a = Math.abs(v);
  return v > 0 ? [0, 2 * a] : [-2 * a, 0];
}

function showModelErrors(r) {
  const box = $('odeErrors');
  box.innerHTML = '';
  box.classList.remove('ok');
  const items = [...r.errors.map((e) => ({ ...e, warn: false })), ...(r.warnings || []).map((e) => ({ ...e, warn: true }))];
  if (!items.length) {
    if (r.ok) {
      const s = r.sys;
      const d = document.createElement('div');
      d.className = 'okmsg';
      d.textContent = `✓ ${s.n} variable${s.n === 1 ? '' : 's'}, ${s.pars.length} parameter${s.pars.length === 1 ? '' : 's'}${s.aux.length ? `, ${s.aux.length} auxiliary` : ''}.`;
      box.append(d);
      box.classList.add('ok');
      box.hidden = false;
    } else box.hidden = true;
    return;
  }
  for (const e of items) {
    const b = document.createElement('button');
    b.type = 'button';
    if (e.warn) b.className = 'warn';
    b.textContent = `${e.line ? `Line ${e.line}: ` : ''}${e.warn ? 'warning: ' : ''}${e.msg}`;
    b.onclick = () => gotoLine(e.line);
    box.append(b);
  }
  box.hidden = false;
}
function gotoLine(line) {
  if (!line) return;
  const ta = $('odeText');
  const lines = ta.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  const end = start + (lines[line - 1] || '').length;
  ta.focus();
  ta.setSelectionRange(start, end);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (line - 4) * lh);
}

/**
 * Compiles and installs a model. keep: saved state to restore (parameter values, windows, ...).
 * Returns true on success.
 */
function applyModel(text, keep = null) {
  const r = compileOde(text);
  showModelErrors(r);
  if (!r.ok) {
    setStatus(`Model has ${r.errors.length} error${r.errors.length > 1 ? 's' : ''} – see the Model tab.`, true);
    return false;
  }
  stopBusy();
  const sys = r.sys;
  S.sys = sys;
  S.model = r.model;
  S.text = text;
  const n = sys.n;

  // numerics from @ options
  const num = { ...DEFAULT_NUM };
  num.total = optNum('total', 20);
  num.dt = Math.abs(optNum('dt', 0.05)) || 0.05;
  num.t0 = optNum('t0', 0);
  num.trans = optNum('trans', optNum('transient', 0));
  num.nOut = Math.max(1, Math.round(optNum('nout', optNum('njmp', 1))));
  num.rtol = optNum('tol', optNum('toler', 1e-6));
  num.atol = optNum('atol', Math.min(1e-9, num.rtol * 1e-3));
  num.bound = optNum('bound', optNum('bounds', 1e6));
  if (num.bound <= 100) num.bound = 1e6; // XPP's default (100) is too small for many models
  const m = optVal('meth') ?? optVal('method');
  if (m !== undefined) num.method = methodFromXpp(m) || 'rk4';
  if (optVal('back') !== undefined && /^(y|1|true|on)/i.test(optVal('back'))) num.dir = 'backward';

  // plot axes
  const plot = { ...DEFAULT_PLOT, timeVars: [0] };
  plot.lw = S.plot.lw; plot.font = S.plot.font;
  const xp = optVal('xp') ?? optVal('xplot');
  const yp = optVal('yp') ?? optVal('yplot');
  const zp = optVal('zp') ?? optVal('zplot');
  let view = 'phase';
  let xi = xp !== undefined ? seriesIndex(xp) : 0;
  let yi = yp !== undefined ? seriesIndex(yp) : (n > 1 ? 1 : 0);
  if (xi === null) xi = 0;
  if (yi === null) yi = n > 1 ? 1 : 0;
  const win = {
    phase: { xlo: optNum('xlo', -2), xhi: optNum('xhi', 2), ylo: optNum('ylo', -2), yhi: optNum('yhi', 2) },
    time: { xlo: num.t0, xhi: num.t0 + num.total, ylo: -2, yhi: 2 },
    bif: { xlo: 0, xhi: 1, ylo: -1, yhi: 1 },
  };
  if (xi === -1) {
    // XPP default "xp=t": time series of yp
    view = 'time';
    plot.timeVars = [yi >= 0 ? yi : 0];
    win.time = { xlo: optNum('xlo', num.t0), xhi: optNum('xhi', num.t0 + num.total), ylo: optNum('ylo', -2), yhi: optNum('yhi', 2) };
    plot.autoTime = optVal('ylo') === undefined;
    plot.x = 0; plot.y = n > 1 ? 1 : 0;
    // choose a sensible phase plane window later via fit
    win.phase = null;
  } else {
    plot.x = xi; plot.y = yi;
    plot.timeVars = [xi >= 0 ? xi : 0];
  }
  if (n === 1 && xi !== -1) {
    plot.x = -1; plot.y = 0;
    // x axis is time: the default window must cover the integration interval, not xlo..xhi = -2..2
    if (optVal('xlo') === undefined && optVal('xhi') === undefined) { win.phase.xlo = num.t0; win.phase.xhi = num.t0 + num.total; }
  }
  plot.x3 = 0; plot.y3 = Math.min(1, n - 1); plot.z3 = n >= 3 ? 2 : -1; // 2-D models: (x, y, t)
  if (zp !== undefined && seriesIndex(zp) !== null) {
    plot.x3 = xi >= 0 ? xi : 0;
    plot.y3 = yi >= 0 ? yi : 0;
    plot.z3 = seriesIndex(zp);
  }
  if (Number(optVal('axes')) === 3 && n >= 3) view = '3d';
  if (n >= 3 && view === 'phase' && optVal('axes') === undefined && sys.vars.length >= 3 && zp !== undefined) view = '3d';
  plot.nullclines = true;
  plot.field = n <= 2 || n === 1 ? 'arrows' : 'none';

  // parameters
  S.parRange = sys.pars.map((_, i) => defaultParRange(sys.P[i]));
  S.ic = Float64Array.from(sys.y0);

  // bifurcation defaults
  const bif = { par: 0, pmin: 0, pmax: 1, ds: 0.02, dsmax: 0.2, nmax: 400, dir: 'both', y: plot.timeVars[0] >= 0 ? `v${plot.timeVars[0]}` : 'v0' };
  if (sys.pars.length) {
    const r0 = S.parRange[0];
    bif.pmin = optNum('parmin', r0[0]);
    bif.pmax = optNum('parmax', r0[1]);
    const R = Math.abs(bif.pmax - bif.pmin) || 1;
    bif.ds = Math.abs(optNum('ds', R / 200));
    bif.dsmax = Math.abs(optNum('dsmax', R / 50));
    bif.nmax = Math.max(10, Math.round(optNum('nmax', 400)));
  }
  S.box3d = null;
  S.rot = { yaw: -0.65, pitch: 0.4, zoom: 1 };

  if (keep) {
    // restore saved state for the same model
    for (let i = 0; i < sys.pars.length; i++) {
      const p = sys.pars[i];
      if (keep.pars && Number.isFinite(keep.pars[p])) sys.setPar(i, keep.pars[p]);
      if (keep.parRange && Array.isArray(keep.parRange[p]) && keep.parRange[p].every(Number.isFinite)) S.parRange[i] = keep.parRange[p].slice(0, 2);
    }
    sys.vars.forEach((v, i) => { if (keep.ic && Number.isFinite(keep.ic[v])) S.ic[i] = keep.ic[v]; });
    if (keep.num) Object.assign(num, keep.num);
    if (keep.plot) {
      const kp = keep.plot;
      const idx = (nm, def) => { const k = seriesIndex(nm); return k === null ? def : k; };
      Object.assign(plot, {
        field: kp.field ?? plot.field, density: kp.density ?? plot.density, nullclines: kp.nullclines ?? plot.nullclines,
        eq: kp.eq ?? plot.eq, manifolds: kp.manifolds ?? plot.manifolds, autoTime: kp.autoTime ?? plot.autoTime,
        lw: kp.lw ?? plot.lw, font: kp.font ?? plot.font,
        x: idx(kp.x, plot.x), y: idx(kp.y, plot.y), x3: idx(kp.x3, plot.x3), y3: idx(kp.y3, plot.y3), z3: idx(kp.z3, plot.z3),
      });
      if (Array.isArray(kp.timeVars)) {
        const tv = kp.timeVars.map((nm) => seriesIndex(nm)).filter((k) => k !== null && k >= 0);
        if (tv.length) plot.timeVars = tv;
      }
    }
    if (keep.win) {
      for (const k of ['phase', 'time', 'bif']) {
        const w = keep.win[k];
        if (w && [w.xlo, w.xhi, w.ylo, w.yhi].every(Number.isFinite) && w.xhi > w.xlo && w.yhi > w.ylo) win[k] = w;
      }
    }
    if (keep.box3d) S.box3d = keep.box3d;
    if (keep.rot) S.rot = { ...S.rot, ...keep.rot };
    if (keep.view) view = keep.view;
    if (keep.bif) {
      const pi = sys.pars.indexOf(keep.bif.par);
      Object.assign(bif, { ...keep.bif, par: pi >= 0 ? pi : 0 });
    }
  }
  if (plot.y === plot.x && n > 1) plot.y = plot.x === 0 ? 1 : 0;
  S.num = num;
  S.plot = plot;
  S.win = win;
  S.bif = bif;
  S.defaults = { win: JSON.parse(JSON.stringify(win)), ic: Float64Array.from(sys.y0), pars: Float64Array.from(sys.parDefaults) };
  S.orbits = [];
  S.colorIdx = 0;
  S.equilibria = [];
  S.branches = [];
  S.sweep = [];
  S.specialCount = 0;
  S.bifSel = null;
  nullCache = null;
  $('title').textContent = sys.title || 'XPP lite';
  document.title = `${sys.title ? sys.title.slice(0, 40) + ' – ' : ''}XPP lite`;
  buildModelUI();
  setView(view, false);
  go({ quiet: true });
  if (!S.win.phase) { S.win.phase = { xlo: -2, xhi: 2, ylo: -2, yhi: 2 }; fitView('phase', false); S.defaults.win.phase = { ...S.win.phase }; }
  if (!S.box3d) fitView('3d', false);
  if (!keep || !keep.win || !keep.win.bif) fitBifDefault();
  const warns = r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : '';
  const lo = lastOrbit();
  const bad = lo && lo.res.status !== 'ok' && lo.res.message ? ` ${lo.res.message}` : '';
  setStatus(`Model loaded: ${sys.n} variable${sys.n > 1 ? 's' : ''}, ${sys.pars.length} parameter${sys.pars.length === 1 ? '' : 's'}${warns}.${bad}`, !!bad);
  saveStore();
  render();
  return true;
}

function fitBifDefault() {
  const b = S.bif;
  S.win.bif = { xlo: b.pmin, xhi: b.pmax > b.pmin ? b.pmax : b.pmin + 1, ylo: -1, yhi: 1 };
}

// ---------------------------------------------------------------- integration
function numOpts() {
  const n = S.num;
  return { method: n.method, dt: n.dt, nOut: n.nOut, trans: n.trans, rtol: n.rtol, atol: n.atol, bound: n.bound };
}
function runIntegration(ic, t0, dir, total = S.num.total, extra = {}) {
  const sys = S.sys;
  const base = { ...numOpts(), ...extra, y0: ic, t0 };
  let f = null, b = null;
  if (dir !== 'backward') f = integrate(sys, { ...base, t1: t0 + total });
  if (dir !== 'forward') b = integrate(sys, { ...base, t1: t0 - total });
  if (f && !b) return f;
  if (b && !f) return b;
  // combine: backward reversed + forward
  const nb = b.t.length;
  const nf = f.t.length;
  const skip = nb && nf && b.t[0] === f.t[0] ? 1 : 0;
  const len = nb - skip + nf;
  const t = new Float64Array(len);
  for (let k = 0; k < nb - skip; k++) t[k] = b.t[nb - 1 - k];
  t.set(f.t, nb - skip);
  const cols = f.cols.map((c, i) => {
    const out = new Float64Array(len);
    const bc = b.cols[i];
    for (let k = 0; k < nb - skip; k++) out[k] = bc[nb - 1 - k];
    out.set(c, nb - skip);
    return out;
  });
  const bad = f.status !== 'ok' ? f : b;
  return { t, cols, status: bad.status, message: bad.message, yEnd: f.yEnd, tEnd: f.tEnd };
}

function addOrbit(ic, { t0 = S.num.t0, dir = S.num.dir, color = null, kind = 'orbit', quiet = false } = {}) {
  const t1 = performance.now();
  const res = runIntegration(ic, t0, dir);
  const orbit = { ic: Float64Array.from(ic), t0, dir, res, color: color || nextColor(), kind, frozen: false, total: S.num.total };
  S.orbits.push(orbit);
  const ms = performance.now() - t1;
  if (!quiet || res.status !== 'ok') reportOrbit(orbit, ms);
  return orbit;
}
function reportOrbit(o, ms) {
  const r = o.res;
  const msg = r.message || `Integrated ${o.dir === 'both' ? '±' : o.dir === 'backward' ? '−' : ''}${fmt(o.total)} time units: ${r.t.length} points (${ms.toFixed(0)} ms).`;
  setStatus(msg, r.status !== 'ok' && r.status !== 'stop');
}
function lastOrbit() {
  for (let k = S.orbits.length - 1; k >= 0; k--) if (S.orbits[k].kind !== 'manifold') return S.orbits[k];
  return null;
}

function go({ quiet = false } = {}) {
  if (!S.sys) return;
  addOrbit(S.ic, { quiet });
  afterIntegrate();
}
function afterIntegrate() {
  if (S.plot.autoTime) fitView('time', false);
  render();
  saveStore();
}

function lastIC() {
  const o = lastOrbit();
  if (!o) { setStatus('No orbit yet.', true); return; }
  const r = o.res;
  const k = o.dir === 'backward' ? r.t.length - 1 : r.t.length - 1;
  for (let i = 0; i < S.sys.n; i++) S.ic[i] = r.cols[i][k];
  S.num.t0 = r.t[k];
  if (!Number.isFinite(S.num.t0)) S.num.t0 = 0;
  syncIcInputs();
  syncNumInputs();
  go();
}
function continueOrbit() {
  const o = lastOrbit();
  if (!o) { setStatus('No orbit yet.', true); return; }
  const r = o.res;
  const k = r.t.length - 1;
  const ic = Float64Array.from(r.cols.slice(0, S.sys.n).map((c) => c[k]));
  const res = runIntegration(ic, r.t[k], o.dir === 'backward' ? 'backward' : 'forward');
  // append
  const len = r.t.length + res.t.length - 1;
  const t = new Float64Array(len);
  t.set(r.t);
  t.set(res.t.subarray(1), r.t.length);
  const cols = r.cols.map((c, i) => { const out = new Float64Array(len); out.set(c); out.set(res.cols[i].subarray(1), c.length); return out; });
  o.res = { ...res, t, cols };
  o.total += S.num.total;
  setStatus(res.message || `Continued to t = ${fmt(res.tEnd)} (${len} points).`, res.status !== 'ok');
  if (S.plot.autoTime) fitView('time', false);
  render();
}

function erase() {
  S.orbits = S.orbits.filter((o) => o.frozen || o.kind === 'manifold');
  S.colorIdx = 0;
  render();
  setStatus('Orbits erased.');
}

// live recompute when parameters change
let recomputeRaf = 0;
let recomputeLevel = '';
function scheduleRecompute(level) {
  if (level === 'full' || !recomputeLevel) recomputeLevel = level;
  if (recomputeRaf) return;
  recomputeRaf = requestAnimationFrame(() => {
    recomputeRaf = 0;
    const lvl = recomputeLevel;
    recomputeLevel = '';
    recompute(lvl);
  });
}
function recompute(level) {
  const t0 = performance.now();
  nullCache = null;
  if (S.num.live) {
    const live = S.orbits.filter((o) => !o.frozen && o.kind === 'orbit');
    const subset = level === 'full' || S.lastFull < 70 ? live : live.slice(-1);
    for (const o of subset) {
      o.res = runIntegration(o.ic, o.t0, o.dir, o.total);
      o.stale = false;
    }
    for (const o of live) if (!subset.includes(o)) o.stale = true;
    if (level === 'full') S.lastFull = performance.now() - t0;
  }
  // track equilibria
  const old = S.equilibria;
  S.equilibria = [];
  for (const e of old) {
    const r = newton(S.sys, e.info.x, { t: S.num.t0 });
    if (r.ok && !S.equilibria.some((q) => sameEq(q.info.x, r.x))) {
      S.equilibria.push(makeEq(r.x, level === 'full' || old.length <= 3));
    }
  }
  S.orbits = S.orbits.filter((o) => o.kind !== 'manifold');
  for (const e of S.equilibria) attachManifolds(e);
  renderEqList();
  const lo = lastOrbit();
  if (lo && lo.res.status !== 'ok' && lo.res.message) setStatus(lo.res.message, true);
  else if (level === 'full') setStatus(`Parameters: ${S.sys.pars.map((p, i) => `${p}=${fmt(S.sys.P[i])}`).join(', ')}`);
  render();
  saveStore();
}

// ---------------------------------------------------------------- equilibria
function sameEq(a, b) {
  let d = 0, s = 1;
  for (let i = 0; i < a.length; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(a[i])); }
  return d < 1e-6 * s;
}
function makeEq(x) {
  const info = equilibriumInfo(S.sys, x, S.num.t0);
  return { info };
}
function attachManifolds(eq) {
  eq.man = [];
  if (!S.plot.manifolds) return;
  const sys = S.sys;
  const mans = oneDimManifolds(eq.info);
  if (!mans.length) return;
  const w = S.win.phase;
  const xi = S.plot.x, yi = S.plot.y;
  const W = (w.xhi - w.xlo), H = (w.yhi - w.ylo);
  const stop = (t, y) => {
    if (isVar(xi) && (y[xi] < w.xlo - 2 * W || y[xi] > w.xhi + 2 * W)) return true;
    if (isVar(yi) && (y[yi] < w.ylo - 2 * H || y[yi] > w.yhi + 2 * H)) return true;
    return false;
  };
  const x0 = eq.info.x;
  let sc = 0;
  for (let i = 0; i < x0.length; i++) sc = Math.max(sc, Math.abs(x0[i]));
  const eps = 1e-5 * Math.max(1, sc, Math.min(W, H));
  for (const m of mans) {
    const T = Math.max(S.num.total, 40 / Math.abs(m.lambda));
    for (const sgn of [1, -1]) {
      const ic = Float64Array.from(x0, (v, i) => v + sgn * eps * m.v[i]);
      const res = integrate(sys, {
        method: 'dp45', rtol: 1e-8, atol: 1e-10, dt: Math.min(S.num.dt, T / 400), nOut: 1, bound: S.num.bound,
        y0: ic, t0: S.num.t0, t1: S.num.t0 + (m.kind === 'unstable' ? T : -T), stop, maxPoints: 40000, timeLimit: 1500,
      });
      const o = { ic, t0: S.num.t0, dir: m.kind === 'unstable' ? 'forward' : 'backward', res, color: m.kind === 'unstable' ? COL_UNSTABLE_MAN : COL_STABLE_MAN, kind: 'manifold', mkind: m.kind, frozen: false, total: T };
      eq.man.push(o);
      S.orbits.push(o);
    }
  }
}
/** Newton from x0; if that fails, integrate towards a steady state and retry. */
function findEquilibrium(x0, relax = true) {
  let r = newton(S.sys, x0, { t: S.num.t0 });
  if (r.ok || !relax) return r;
  const res = integrate(S.sys, { method: 'dp45', rtol: 1e-7, atol: 1e-9, dt: 1, y0: x0, t0: S.num.t0, t1: S.num.t0 + Math.max(200, 4 * S.num.total), maxPoints: 2, trans: 1e300, bound: S.num.bound, timeLimit: 2000 });
  if (res.yEnd && res.yEnd.every(Number.isFinite)) {
    r = newton(S.sys, res.yEnd, { t: S.num.t0 });
    if (r.ok) r.relaxed = true;
  }
  return r;
}
function addEquilibrium(x0, { quiet = false, relax = false } = {}) {
  const r = findEquilibrium(x0, relax);
  if (!r.ok) {
    if (!quiet) setStatus('Newton iteration did not converge – no equilibrium found near this point.', true);
    return null;
  }
  const dup = S.equilibria.find((q) => sameEq(q.info.x, r.x));
  if (dup) {
    if (!quiet) setStatus(`Equilibrium already known: ${dup.info.label} at (${eqCoords(dup.info.x)}).`);
    return dup;
  }
  const eq = makeEq(r.x);
  attachManifolds(eq);
  S.equilibria.push(eq);
  if (!quiet) setStatus(`Found ${eq.info.label} at (${eqCoords(eq.info.x)}). Eigenvalues: ${eq.info.eigs.map((e) => fmtEig(e, 3)).join(', ')}`);
  renderEqList();
  render();
  return eq;
}
function eqCoords(x) { return S.sys.vars.map((v, i) => `${v}=${fmt(x[i], 4)}`).join(', '); }

function searchEquilibria() {
  let xi = S.plot.x, yi = S.plot.y;
  const w = S.win.phase;
  if (S.sys.n === 1 && isVar(yi) && !isVar(xi)) {
    // 1-D system plotted against t: search along the vertical axis
    const before = S.equilibria.length;
    for (let b = 0; b < 40; b++) {
      const x = Float64Array.of(w.ylo + (b + 0.5) * (w.yhi - w.ylo) / 40);
      const r = newton(S.sys, x, { t: S.num.t0, maxIt: 30 });
      const my = 0.05 * (w.yhi - w.ylo);
      if (r.ok && r.x[0] >= w.ylo - my && r.x[0] <= w.yhi + my && !S.equilibria.some((q) => sameEq(q.info.x, r.x))) S.equilibria.push(makeEq(r.x));
    }
    renderEqList();
    render();
    const found = S.equilibria.length - before;
    setStatus(found ? `Found ${found} new equilibri${found > 1 ? 'a' : 'um'} (${S.equilibria.length} total).` : `No new equilibria found (${S.equilibria.length} known).`);
    return;
  }
  if (!isVar(xi) || !isVar(yi)) { setStatus('Grid search needs state variables on both phase plane axes.', true); return; }
  const N = 9;
  const before = S.equilibria.length;
  const t0 = performance.now();
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const x = Float64Array.from(S.ic);
      x[xi] = w.xlo + (a + 0.5) * (w.xhi - w.xlo) / N;
      x[yi] = w.ylo + (b + 0.5) * (w.yhi - w.ylo) / N;
      const r = newton(S.sys, x, { t: S.num.t0, maxIt: 30 });
      const mx = 0.05 * (w.xhi - w.xlo), my = 0.05 * (w.yhi - w.ylo);
      const inWin = r.ok && r.x[xi] >= w.xlo - mx && r.x[xi] <= w.xhi + mx && r.x[yi] >= w.ylo - my && r.x[yi] <= w.yhi + my;
      if (inWin && !S.equilibria.some((q) => sameEq(q.info.x, r.x))) {
        const eq = makeEq(r.x);
        attachManifolds(eq);
        S.equilibria.push(eq);
      }
      if (performance.now() - t0 > 4000) break;
    }
  }
  renderEqList();
  render();
  const found = S.equilibria.length - before;
  setStatus(found ? `Found ${found} new equilibri${found > 1 ? 'a' : 'um'} (${S.equilibria.length} total).` : `No new equilibria found (${S.equilibria.length} known).`);
}

function renderEqList() {
  const box = $('eqList');
  box.innerHTML = '';
  if (!S.sys) return;
  if (!S.equilibria.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No equilibria computed yet.';
    box.append(p);
    return;
  }
  S.equilibria.forEach((e, k) => {
    const c = document.createElement('div');
    c.className = 'eqcard';
    const rows = S.sys.vars.map((v, i) => `<tr><td>${esc(v)}</td><td>${fmt(e.info.x[i], 7)}</td></tr>`).join('');
    const cnt = e.info.counts;
    c.innerHTML = `<div class="eqhead"><span class="dot ${e.info.stable ? 'st' : ''}"></span>${k + 1}. ${esc(e.info.label)}${e.info.stable ? ' (stable)' : ''}</div>
      <table>${rows}</table>
      <div class="eigs">Eigenvalues: ${e.info.eigs.map((q) => fmtEig(q, 4)).join(', ')}</div>
      ${S.sys.n > 2 ? `<div class="eigs">r+ ${cnt.rp}, r− ${cnt.rn}, c+ ${cnt.cp}, c− ${cnt.cn}${cnt.im ? `, im ${cnt.im}` : ''}${cnt.zero ? `, zero ${cnt.zero}` : ''}</div>` : ''}
      <div class="acts"><button data-a="ic">Use as initial values</button><button data-a="pert">Integrate from nearby</button><button data-a="bif">Continue in parameter</button><button data-a="del">Remove</button></div>`;
    c.querySelector('[data-a=ic]').onclick = () => { S.ic.set(e.info.x); syncIcInputs(); setStatus('Initial values set to the equilibrium.'); saveStore(); };
    c.querySelector('[data-a=pert]').onclick = () => {
      const x = Float64Array.from(e.info.x, (v, i) => v + 1e-3 * Math.max(1, Math.abs(v)) * (i % 2 ? -1 : 1));
      addOrbit(x); afterIntegrate(); closePanelIfNarrow();
    };
    c.querySelector('[data-a=bif]').onclick = () => { if (!S.sys.pars.length) return; runBif(e.info.x); closePanelIfNarrow(); };
    c.querySelector('[data-a=del]').onclick = () => {
      S.equilibria.splice(k, 1);
      S.orbits = S.orbits.filter((o) => !(e.man || []).includes(o));
      renderEqList(); render();
    };
    box.append(c);
  });
}
/** Shows numerical noise (|v| below 1e-10 of the relevant scale) as 0. */
function tidy(v, scale = 1) { return Math.abs(v) < 1e-10 * Math.max(1e-300, Math.abs(scale) || 1) ? 0 : v; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------------------------------------------------------- bifurcation
function bifY(pd) {
  const y = S.bif.y;
  const n = S.sys.n;
  if (y === 'norm') { let s = 0; for (let i = 0; i < n; i++) s += pd.X[i] * pd.X[i]; return Math.sqrt(s); }
  if (y === 'period') return NaN;
  const i = Number(y.slice(1));
  return pd.X[i];
}
function runBif(start = null) {
  const sys = S.sys;
  if (!sys.pars.length) { setStatus('The model has no parameters to continue in.', true); return; }
  readBifInputs();
  const b = S.bif;
  if (!(b.pmax > b.pmin)) { setStatus('Bifurcation: max must be greater than min.', true); return; }
  const p0 = sys.P[b.par];
  const x0 = start ? Float64Array.from(start) : Float64Array.from(S.ic);
  const r = findEquilibrium(x0, !start);
  if (!r.ok) { setStatus('No equilibrium found near the initial values (Newton failed, and the orbit does not settle to a steady state).', true); return; }
  if (p0 < b.pmin || p0 > b.pmax) { setStatus(`Current value ${sys.pars[b.par]}=${fmt(p0)} is outside [min, max].`, true); return; }
  const dirs = b.dir === 'both' ? [1, -1] : b.dir === 'up' ? [1] : [-1];
  const t0 = performance.now();
  let total = 0;
  const statuses = [];
  for (const d of dirs) {
    const res = continueEquilibria(sys, {
      par: b.par, x0: r.x, p0, pmin: b.pmin, pmax: b.pmax, ds: b.ds, dsmax: b.dsmax, dsmin: b.ds * 1e-4,
      nmax: b.nmax, dir: d, bound: S.num.bound, t: S.num.t0,
    });
    if (res.points.length > 1) addBranch(res, b.par, dirs.length === 2 && d === -1);
    total += res.points.length;
    statuses.push(res.status);
  }
  nullCache = null;
  fitView('bif', false);
  if (S.view !== 'bif') setView('bif');
  renderBifList();
  render();
  const sp = S.branches.flatMap((br) => br.special).filter((q) => q.type !== 'EP');
  setStatus(`Continuation: ${total} points in ${(performance.now() - t0).toFixed(0)} ms; ${sp.length ? sp.map((q) => q.label).join(', ') : 'no bifurcations detected'}. ${[...new Set(statuses)].join(' ')}`);
}
function addBranch(res, par, skipStartLabel = false) {
  const special = [];
  for (const q of res.special) {
    if (q.type === 'EP' && skipStartLabel && q.index === 0) continue;
    S.specialCount++;
    special.push({ ...q, label: `${q.type}${S.specialCount}`, no: S.specialCount });
  }
  const br = { points: res.points, special, par, status: res.status, id: S.branches.length + 1 };
  S.branches.push(br);
  return br;
}
function switchBranch(spec, br) {
  const sys = S.sys;
  const b = S.bif;
  const v = branchSwitchDirection(sys, br.par, spec.pd.X, spec.pd.t, S.num.t0);
  let added = 0;
  for (const sgn of [1, -1]) {
    const tan = v.map((c) => sgn * c);
    const X0 = Float64Array.from(spec.pd.X, (c, i) => c + 2 * b.ds * tan[i]);
    const res = continueEquilibria(sys, {
      par: br.par, X0, tangent: tan, pmin: b.pmin, pmax: b.pmax, ds: b.ds, dsmax: b.dsmax, dsmin: b.ds * 1e-4,
      nmax: b.nmax, bound: S.num.bound, t: S.num.t0,
    });
    if (res.points.length > 1) { addBranch(res, br.par, true); added++; }
  }
  if (added) fitView('bif', false);
  renderBifList();
  render();
  setStatus(added ? `Branch switching at ${spec.label}: ${added} new branch${added > 1 ? 'es' : ''}.` : `Branch switching at ${spec.label} failed.`, !added);
}

let sweepGen = null;
function runSweep() {
  const sys = S.sys;
  if (!sys.pars.length) { setStatus('The model has no parameters.', true); return; }
  readBifInputs();
  readSweepInputs();
  const b = S.bif, sw = S.sweepSet;
  if (!(b.pmax > b.pmin)) { setStatus('Sweep: max must be greater than min.', true); return; }
  stopBusy();
  const run = { results: [], par: b.par };
  S.sweep.push(run);
  sweepGen = periodicSweep(sys, {
    par: b.par, pmin: b.pmin, pmax: b.pmax, steps: sw.steps, y0: S.ic, trans: sw.trans, sample: sw.sample,
    method: S.num.method === 'euler' ? 'rk4' : S.num.method, dt: S.num.dt, rtol: S.num.rtol, atol: S.num.atol, bound: S.num.bound, updown: sw.updown,
  });
  if (S.view !== 'bif') setView('bif');
  setBusy('sweep');
  const step = () => {
    if (!sweepGen) return;
    const t0 = performance.now();
    let r;
    while (performance.now() - t0 < 40) {
      r = sweepGen.next();
      if (r.done) break;
      run.results.push(r.value.rec);
      setStatus(`Sweeping ${sys.pars[b.par]}: ${r.value.i}/${r.value.total} (${sys.pars[b.par]}=${fmt(r.value.rec.p)})`);
    }
    render();
    if (r && r.done) {
      sweepGen = null;
      setBusy(null);
      const per = run.results.filter((q) => q.periodic).length;
      fitView('bif', false);
      render();
      saveStore();
      setStatus(`Sweep finished: ${per} of ${run.results.length} parameter values show oscillations.`);
      return;
    }
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function setBusy(kind) {
  S.busy = kind;
  $('btnStop').hidden = !kind;
  $('btnSweep').disabled = !!kind;
}
function stopBusy() {
  if (sweepGen) {
    try { sweepGen.return(); } catch { /* ignore */ }
    sweepGen = null;
    setStatus('Stopped.');
  }
  setBusy(null);
}

function renderBifList() {
  const box = $('bifList');
  box.innerHTML = '';
  const all = [];
  S.branches.forEach((br) => br.special.forEach((q) => all.push({ q, br })));
  if (!all.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'No continuation computed yet.';
    box.append(d);
    return;
  }
  const n = S.sys.n;
  for (const { q, br } of all) {
    const b = document.createElement('button');
    const extra = q.type === 'HB' ? ` ω=${fmt(q.omega, 4)}, T=${fmt(q.period, 4)}` : '';
    b.innerHTML = `<b>${esc(q.label)}</b><span>${esc(S.sys.pars[br.par])}=${fmt(tidy(q.pd.X[n], S.bif.pmax - S.bif.pmin), 6)}${extra} · ${q.pd.stable ? 'stable' : 'unstable'}</span>`;
    b.onclick = () => { closePanelIfNarrow(); showBifPoint({ pd: q.pd, spec: q, br }); };
    box.append(b);
  }
}

async function showBifPoint(sel) {
  S.bifSel = sel;
  if (S.view === 'bif') renderOverlay();
  const sys = S.sys;
  const n = sys.n;
  const par = sel.br ? sel.br.par : sel.par;
  const body = document.createElement('div');
  let title;
  let html = '';
  if (sel.sw) {
    const r = sel.sw;
    title = r.periodic ? 'Periodic orbit (simulation)' : 'Steady state (simulation)';
    html += `<table class="kv"><tr><td>${esc(sys.pars[par])}</td><td>${fmt(r.p, 8)}</td></tr>`;
    if (r.periodic) html += `<tr><td>period</td><td>${fmt(r.period, 6)}${r.regular ? '' : ' (irregular)'}</td></tr>`;
    for (let i = 0; i < n; i++) html += `<tr><td>${esc(sys.vars[i])}</td><td>${r.periodic ? `min ${fmt(r.min[i], 6)}, max ${fmt(r.max[i], 6)}` : fmt(r.end ? r.end[i] : r.max[i], 7)}</td></tr>`;
    html += '</table>';
  } else {
    const pd = sel.pd;
    const spec = sel.spec;
    const names = { LP: 'Limit point (fold)', HB: 'Hopf bifurcation', BP: 'Branch point', EP: 'End point' };
    title = spec ? `${spec.label}: ${names[spec.type]}` : `Equilibrium (${pd.stable ? 'stable' : 'unstable'})`;
    const xs = Math.max(1e-300, ...Array.from(pd.X.subarray(0, n), Math.abs));
    html += `<table class="kv"><tr><td>${esc(sys.pars[par])}</td><td>${fmt(tidy(pd.X[n], S.bif.pmax - S.bif.pmin), 10)}</td></tr>`;
    for (let i = 0; i < n; i++) html += `<tr><td>${esc(sys.vars[i])}</td><td>${fmt(tidy(pd.X[i], Math.max(1, xs)), 10)}</td></tr>`;
    html += `<tr><td>stability</td><td>${pd.stable ? 'stable' : 'unstable'}</td></tr>`;
    if (spec && spec.type === 'HB') html += `<tr><td>frequency ω</td><td>${fmt(spec.omega, 6)}</td></tr><tr><td>period 2π/ω</td><td>${fmt(spec.period, 6)}</td></tr>`;
    html += '</table>';
    html += `<p style="margin-top:10px"><b>Eigenvalues:</b> ${pd.eigs.map((e) => fmtEig(e, 5)).join(', ')}</p>`;
    if (spec && spec.type === 'HB') html += '<p class="hint">A family of periodic orbits is born here. Use “Sweep parameter by simulation” to see stable oscillations (max/min).</p>';
  }
  body.innerHTML = html;
  const buttons = [{ label: 'Close', value: 'cancel' }];
  if (!sel.sw && sel.spec && sel.spec.type === 'BP') buttons.push({ label: 'Switch branch', value: 'switch' });
  if (!sel.sw) buttons.push({ label: 'Continue from here', value: 'cont' });
  buttons.push({ label: 'Grab (set parameter & initial values)', value: 'grab', primary: true });
  const r = await openDialog({ title, body, buttons });
  if (r === 'grab') {
    const p = sel.sw ? sel.sw.p : tidy(sel.pd.X[n], S.bif.pmax - S.bif.pmin);
    setParValue(par, p);
    if (!sel.sw) for (let i = 0; i < n; i++) S.ic[i] = sel.pd.X[i];
    syncIcInputs();
    buildParList();
    // perturb slightly off the equilibrium so the orbit shows the dynamics
    const ic = Float64Array.from(S.ic);
    if (!sel.sw) for (let i = 0; i < n; i++) ic[i] += 1e-3 * Math.max(1, Math.abs(ic[i])) * (i % 2 ? -1 : 1);
    S.equilibria = [];
    S.orbits = S.orbits.filter((o) => o.frozen);
    addOrbit(ic);
    if (!sel.sw) addEquilibrium(sel.pd.X.subarray(0, n), { quiet: true });
    renderEqList();
    afterIntegrate();
    setStatus(`Grabbed ${sys.pars[par]}=${fmt(p, 6)}; integrated from a point next to it.`);
  } else if (r === 'switch') {
    switchBranch(sel.spec, sel.br);
  } else if (r === 'cont') {
    const b = S.bif;
    const prev = b.par;
    b.par = par;
    const old = sys.P[par];
    sys.setPar(par, sel.pd.X[n]);
    runBif(sel.pd.X.subarray(0, n));
    sys.setPar(par, old);
    b.par = prev;
  }
  S.bifSel = null;
  renderOverlay();
}

// ---------------------------------------------------------------- canvas & rendering
const wrap = $('plotWrap');
const baseCv = $('baseCanvas');
const overCv = $('overlayCanvas');
const bctx = baseCv.getContext('2d');
const octx = overCv.getContext('2d');
let W = 0, H = 0, DPR = 1;
let L = null; // current 2D layout
let M = null; // current 2D map
let nullCache = null;
let preview = null; // live drag orbit
let hover = null;
let zoomRect = null;
let timeCursor = null;

function resizeCanvases() {
  const r = wrap.getBoundingClientRect();
  W = Math.max(50, Math.floor(r.width));
  H = Math.max(50, Math.floor(r.height));
  DPR = Math.min(3, window.devicePixelRatio || 1);
  for (const cv of [baseCv, overCv]) {
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
  }
}

let renderRaf = 0;
function render() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => { renderRaf = 0; renderBase(); renderOverlay(); });
}
function renderNow() { cancelAnimationFrame(renderRaf); renderRaf = 0; renderBase(); renderOverlay(); }

function curWin() { return S.win[S.view === 'time' ? 'time' : S.view === 'bif' ? 'bif' : 'phase']; }

function renderBase() {
  const ctx = bctx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(0, 0, W, H);
  if (!S.sys) return;
  if (S.view === '3d') { L = null; M = null; draw3D(ctx); return; }
  const win = curWin();
  L = layout2D(ctx, W, H, win, S.plot.font);
  M = makeMap(L);
  if (S.view === 'phase') drawPhase(ctx);
  else if (S.view === 'time') drawTime(ctx);
  else drawBif(ctx);
}

function clipPlot(ctx) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.left, L.top, L.w, L.h);
  ctx.clip();
}

// ----- phase plane
function sliceState() { return Float64Array.from(S.ic); }

function computeFieldGrid(nx, ny) {
  const sys = S.sys;
  const xi = S.plot.x, yi = S.plot.y;
  const w = S.win.phase;
  const y = sliceState();
  const dy = new Float64Array(sys.n);
  const fx = new Float64Array((nx + 1) * (ny + 1)), fy = new Float64Array((nx + 1) * (ny + 1));
  const t0 = S.num.t0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const X = w.xlo + (i / nx) * (w.xhi - w.xlo);
      const Y = w.ylo + (j / ny) * (w.yhi - w.ylo);
      let t = t0;
      if (xi === -1) t = X; else y[xi] = X;
      y[yi] = Y;
      sys.rhs(t, y, dy);
      const k = j * (nx + 1) + i;
      fx[k] = xi === -1 ? 1 : dy[xi];
      fy[k] = dy[yi];
    }
  }
  return { fx, fy };
}

function getNullclines() {
  const xi = S.plot.x, yi = S.plot.y;
  const key = JSON.stringify([S.win.phase, xi, yi, Array.from(S.sys.P), Array.from(S.ic), W, H, S.num.t0]);
  if (nullCache && nullCache.key === key) return nullCache;
  const nx = Math.min(240, Math.max(40, Math.round(L.w / 3)));
  const ny = Math.min(240, Math.max(40, Math.round(L.h / 3)));
  const g = computeFieldGrid(nx, ny);
  const w = S.win.phase;
  const dx = (w.xhi - w.xlo) / nx, dyy = (w.yhi - w.ylo) / ny;
  nullCache = {
    key,
    xs: xi >= 0 ? zeroContour(g.fx, nx, ny, w.xlo, w.ylo, dx, dyy) : [],
    ys: zeroContour(g.fy, nx, ny, w.xlo, w.ylo, dx, dyy),
  };
  return nullCache;
}

function drawSegments(ctx, segs, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let k = 0; k < segs.length; k += 4) {
    ctx.moveTo(M.X(segs[k]), M.Y(segs[k + 1]));
    ctx.lineTo(M.X(segs[k + 2]), M.Y(segs[k + 3]));
  }
  ctx.stroke();
}

function drawField(ctx) {
  const n = S.plot.density;
  const aspect = L.h / L.w;
  const nx = n, ny = Math.max(4, Math.round(n * aspect));
  const w = S.win.phase;
  const sys = S.sys;
  const xi = S.plot.x, yi = S.plot.y;
  const y = sliceState();
  const dy = new Float64Array(sys.n);
  const cw = L.w / nx, ch = L.h / ny;
  const len = 0.8 * Math.min(cw, ch);
  const vecs = [];
  let vmax = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const sx = L.left + (i + 0.5) * cw, sy = L.top + (j + 0.5) * ch;
      const X = M.toX(sx), Y = M.toY(sy);
      let t = S.num.t0;
      if (xi === -1) t = X; else y[xi] = X;
      y[yi] = Y;
      sys.rhs(t, y, dy);
      const vx = (xi === -1 ? 1 : dy[xi]) * L.sx;
      const vy = -dy[yi] * L.sy;
      const m = Math.hypot(vx, vy);
      if (!Number.isFinite(m)) continue;
      vecs.push(sx, sy, vx, vy, m);
      if (m > vmax) vmax = m;
    }
  }
  ctx.strokeStyle = COL_FIELD;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const scaled = S.plot.field === 'scaled';
  for (let k = 0; k < vecs.length; k += 5) {
    const [sx, sy, vx, vy, m] = vecs.slice(k, k + 5);
    if (m === 0) { ctx.moveTo(sx + 1, sy); ctx.arc(sx, sy, 1, 0, 2 * Math.PI); continue; }
    const l = scaled ? len * Math.max(0.15, Math.sqrt(m / vmax)) : len;
    const ux = vx / m, uy = vy / m;
    const x1 = sx - ux * l / 2, y1 = sy - uy * l / 2, x2 = sx + ux * l / 2, y2 = sy + uy * l / 2;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    const hd = Math.min(6, l * 0.35);
    const a = Math.atan2(uy, ux);
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - hd * Math.cos(a - 0.45), y2 - hd * Math.sin(a - 0.45));
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - hd * Math.cos(a + 0.45), y2 - hd * Math.sin(a + 0.45));
  }
  ctx.stroke();
}

function drawOrbits2D(ctx, xi, yi) {
  const lw = S.plot.lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const last = lastOrbit();
  for (const o of S.orbits) {
    if (o.kind === 'manifold') continue;
    ctx.globalAlpha = o.frozen ? 0.55 : o.stale ? 0.35 : 1;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o === last ? lw * 1.3 : lw;
    polyline(ctx, col(o, xi), col(o, yi), M);
  }
  ctx.globalAlpha = 1;
}
function drawManifolds2D(ctx, xi, yi) {
  for (const o of S.orbits) {
    if (o.kind !== 'manifold') continue;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(1.2, S.plot.lw * 0.9);
    polyline(ctx, col(o, xi), col(o, yi), M);
  }
}
function drawEqMarker(ctx, x, y, stable, r = 6) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = stable ? '#111' : '#fff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#111';
  ctx.stroke();
}

function drawPhase(ctx) {
  const xi = S.plot.x, yi = S.plot.y;
  const names = seriesNames();
  drawAxes(ctx, L, names[xi + 1], names[yi + 1]);
  clipPlot(ctx);
  const fieldOk = isVar(yi) && (isVar(xi) || xi === -1);
  if (fieldOk && S.plot.field !== 'none') drawField(ctx);
  let nc = null;
  if (fieldOk && S.plot.nullclines) {
    nc = getNullclines();
    drawSegments(ctx, nc.xs, COL_NULL_X, 2);
    drawSegments(ctx, nc.ys, COL_NULL_Y, 2);
  }
  if (S.plot.manifolds) drawManifolds2D(ctx, xi, yi);
  drawOrbits2D(ctx, xi, yi);
  if (S.plot.eq && xi >= 0) {
    for (const e of S.equilibria) {
      const X = eqSeries(e.info.x, xi), Y = eqSeries(e.info.x, yi);
      if (Number.isFinite(X) && Number.isFinite(Y)) drawEqMarker(ctx, M.X(X), M.Y(Y), e.info.stable);
    }
  }
  ctx.restore();
  // legend
  if (nc && (nc.xs.length || nc.ys.length)) {
    const items = [];
    if (xi >= 0) items.push([`${names[xi + 1]}′=0`, COL_NULL_X]);
    items.push([`${names[yi + 1]}′=0`, COL_NULL_Y]);
    drawLegend(ctx, items);
  }
}
function eqSeries(x, i) {
  if (i < 0) return NaN;
  if (i < S.sys.n) return x[i];
  const out = new Float64Array(S.sys.aux.length);
  S.sys.auxf(S.num.t0, x, out);
  return out[i - S.sys.n];
}
function drawLegend(ctx, items) {
  ctx.font = `${S.plot.font - 1}px ${FONT_FAMILY}`;
  const pad = 6;
  const lh = S.plot.font + 5;
  const wmax = Math.max(...items.map(([s]) => ctx.measureText(s).width));
  const bw = wmax + 34 + pad * 2, bh = items.length * lh + pad * 2 - 4;
  const x0 = L.left + L.w - bw - 8, y0 = L.top + 8;
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  ctx.strokeStyle = '#c9ccd1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x0 + 0.5, y0 + 0.5, bw, bh);
  ctx.fill(); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  items.forEach(([s, c], k) => {
    const y = y0 + pad + k * lh + lh / 2 - 2;
    ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0 + pad, y); ctx.lineTo(x0 + pad + 22, y); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.fillText(s, x0 + pad + 30, y);
  });
}

// ----- time series
function timeColor(o, k) { return S.plot.timeVars.length > 1 ? PALETTE[k % PALETTE.length] : o.color; }
function drawTime(ctx) {
  const names = seriesNames();
  const tv = S.plot.timeVars;
  drawAxes(ctx, L, 't', tv.length === 1 ? names[tv[0] + 1] : '');
  clipPlot(ctx);
  const last = lastOrbit();
  ctx.lineJoin = 'round';
  for (const o of S.orbits) {
    if (o.kind === 'manifold') continue;
    tv.forEach((v, k) => {
      ctx.globalAlpha = o.frozen ? 0.55 : o.stale ? 0.35 : 1;
      ctx.strokeStyle = timeColor(o, k);
      ctx.lineWidth = o === last ? S.plot.lw * 1.3 : S.plot.lw;
      polyline(ctx, o.res.t, col(o, v), M);
    });
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (tv.length > 1) drawLegend(ctx, tv.map((v, k) => [names[v + 1], PALETTE[k % PALETTE.length]]));
}

// ----- 3D
function box3dRanges() {
  const b = S.box3d || { xlo: -1, xhi: 1, ylo: -1, yhi: 1, zlo: -1, zhi: 1 };
  return b;
}
function project3D() {
  const b = box3dRanges();
  const { yaw, pitch, zoom } = S.rot;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const s = Math.min(W, H) * 0.27 * zoom;
  const cx0 = W / 2, cy0 = H / 2 + 14;
  const nx = (v) => (2 * (v - b.xlo)) / (b.xhi - b.xlo) - 1;
  const ny = (v) => (2 * (v - b.ylo)) / (b.yhi - b.ylo) - 1;
  const nz = (v) => (2 * (v - b.zlo)) / (b.zhi - b.zlo) - 1;
  const P = (x, y, z) => {
    const xr = x * cy - y * sy;
    const yr = x * sy + y * cy;
    const sx = xr;
    const syy = z * cp - yr * sp;
    return [cx0 + s * sx, cy0 - s * syy];
  };
  return { P, nx, ny, nz, b };
}
function draw3D(ctx) {
  const { P, nx, ny, nz, b } = project3D();
  const names = seriesNames();
  const { x3, y3, z3 } = S.plot;
  const f = S.plot.font;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // box
  const corners = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
  ctx.strokeStyle = '#b9bec5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      const a = corners[i], c = corners[j];
      const diff = Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]);
      if (diff !== 2) continue;
      const p = P(...a), q = P(...c);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
    }
  }
  ctx.stroke();
  // axes from (-1,-1,-1)
  ctx.lineWidth = 2;
  const o = P(-1, -1, -1);
  const axes = [[[1, -1, -1], names[x3 + 1], b.xlo, b.xhi, '#d0312d'], [[-1, 1, -1], names[y3 + 1], b.ylo, b.yhi, '#1a9a3a'], [[-1, -1, 1], names[z3 + 1], b.zlo, b.zhi, '#1f5fd6']];
  ctx.font = `${f}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const [end, label, lo, hi, c] of axes) {
    const e = P(...end);
    ctx.strokeStyle = c;
    ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    const dx = e[0] - o[0], dy = e[1] - o[1];
    const d = Math.hypot(dx, dy) || 1;
    ctx.fillStyle = c;
    ctx.font = `bold ${f}px ${FONT_FAMILY}`;
    ctx.fillText(label, e[0] + (dx / d) * 18, e[1] + (dy / d) * 18);
    ctx.font = `${f - 2}px ${FONT_FAMILY}`;
    ctx.fillStyle = '#555';
    ctx.fillText(`${fmt(lo, 3)} … ${fmt(hi, 3)}`, e[0] + (dx / d) * 18, e[1] + (dy / d) * 18 + f);
  }
  // orbits
  const last = lastOrbit();
  ctx.lineJoin = 'round';
  for (const orb of S.orbits) {
    const X = col(orb, x3), Y = col(orb, y3), Z = col(orb, z3);
    ctx.globalAlpha = orb.frozen ? 0.55 : 1;
    ctx.strokeStyle = orb.color;
    ctx.lineWidth = orb.kind === 'manifold' ? 1.2 : orb === last ? S.plot.lw * 1.2 : S.plot.lw * 0.9;
    ctx.beginPath();
    let pen = false;
    let lx = 0, ly = 0;
    for (let k = 0; k < X.length; k++) {
      const [sx, sy] = P(nx(X[k]), ny(Y[k]), nz(Z[k]));
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) > 1e6 || Math.abs(sy) > 1e6) { pen = false; continue; }
      if (!pen) { ctx.moveTo(sx, sy); pen = true; lx = sx; ly = sy; continue; }
      if (Math.abs(sx - lx) + Math.abs(sy - ly) < 0.6 && k < X.length - 1) continue;
      ctx.lineTo(sx, sy); lx = sx; ly = sy;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (S.plot.eq) {
    for (const e of S.equilibria) {
      const [sx, sy] = P(nx(eqSeries(e.info.x, x3)), ny(eqSeries(e.info.x, y3)), nz(eqSeries(e.info.x, z3)));
      if (Number.isFinite(sx) && Number.isFinite(sy)) drawEqMarker(ctx, sx, sy, e.info.stable, 5);
    }
  }
  ctx.fillStyle = '#5f6772';
  ctx.font = `${f - 2}px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Drag to rotate · pinch / wheel to zoom', 10, 8);
}

// ----- bifurcation diagram
function drawBif(ctx) {
  const sys = S.sys;
  const n = sys.n;
  const parIdx = S.bif.par;
  const ylab = S.bif.y === 'norm' ? '‖x‖' : S.bif.y === 'period' ? 'period' : sys.vars[Number(S.bif.y.slice(1))];
  drawAxes(ctx, L, sys.pars[parIdx] || 'parameter', ylab);
  clipPlot(ctx);
  // current parameter value
  const pc = sys.P[parIdx];
  if (pc >= L.win.xlo && pc <= L.win.xhi) {
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(M.X(pc), L.top); ctx.lineTo(M.X(pc), L.top + L.h); ctx.stroke();
    ctx.setLineDash([]);
  }
  const period = S.bif.y === 'period';
  // branches
  for (const br of S.branches) {
    if (br.par !== parIdx || period) continue;
    const pts = br.points;
    ctx.lineCap = 'round';
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const st = a.stable && b.stable;
      ctx.strokeStyle = st ? '#c62828' : '#333';
      ctx.lineWidth = st ? 3.5 : 1.3;
      ctx.beginPath();
      ctx.moveTo(M.X(a.X[n]), M.Y(bifY(a)));
      ctx.lineTo(M.X(b.X[n]), M.Y(bifY(b)));
      ctx.stroke();
    }
  }
  // sweep results
  for (const run of S.sweep) {
    if (run.par !== parIdx) continue;
    for (const r of run.results) {
      if (r.status !== 'ok') continue;
      const x = M.X(r.p);
      if (period) {
        if (r.periodic) dot(ctx, x, M.Y(r.period), 3.5, r.regular ? '#11a04a' : '#7cb342');
        continue;
      }
      if (S.bif.y === 'norm') continue;
      const i = Number(S.bif.y.slice(1));
      if (r.periodic) {
        dot(ctx, x, M.Y(r.max[i]), 3.5, r.regular ? '#11a04a' : '#7cb342');
        dot(ctx, x, M.Y(r.min[i]), 3.5, r.regular ? '#11a04a' : '#7cb342');
      } else dot(ctx, x, M.Y(r.end && i < r.end.length ? r.end[i] : r.max[i]), 2.2, '#8a8f96');
    }
  }
  // special points
  ctx.font = `bold ${S.plot.font - 1}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  for (const br of S.branches) {
    if (br.par !== parIdx) continue;
    for (const q of br.special) {
      const x = M.X(q.pd.X[n]);
      const y = period ? (q.type === 'HB' ? M.Y(q.period) : NaN) : M.Y(bifY(q.pd));
      if (!Number.isFinite(y)) continue;
      const c = q.type === 'HB' ? '#d0312d' : q.type === 'LP' ? '#1f5fd6' : q.type === 'BP' ? '#9b37d6' : '#555';
      ctx.fillStyle = c;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (q.type === 'EP') ctx.rect(x - 3, y - 3, 6, 6);
      else if (q.type === 'LP') ctx.rect(x - 5, y - 5, 10, 10);
      else if (q.type === 'BP') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); }
      else ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      if (q.type !== 'EP') {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.strokeText(q.label, x + 7, y - 5);
        ctx.fillStyle = c;
        ctx.fillText(q.label, x + 7, y - 5);
      }
    }
  }
  ctx.restore();
  if (!S.branches.length && !S.sweep.length) {
    ctx.fillStyle = '#5f6772';
    ctx.font = `${S.plot.font}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Open the panel → Bif and press “Continue from equilibrium”.', L.left + L.w / 2, L.top + L.h / 2);
  } else {
    drawLegend(ctx, [['stable', '#c62828'], ['unstable', '#333'], ...(S.sweep.length ? [['periodic (max/min)', '#11a04a']] : [])]);
  }
}
function dot(ctx, x, y, r, c) {
  if (!Number.isFinite(y)) return;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

// ----- overlay
function renderOverlay() {
  const ctx = octx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!S.sys) return;
  if (S.view === '3d' || !L) return;
  if (preview && S.view === 'phase') {
    ctx.save();
    ctx.beginPath(); ctx.rect(L.left, L.top, L.w, L.h); ctx.clip();
    ctx.strokeStyle = preview.color;
    ctx.lineWidth = S.plot.lw * 1.3;
    ctx.lineJoin = 'round';
    polyline(ctx, col(preview, S.plot.x), col(preview, S.plot.y), M);
    ctx.restore();
  }
  if (hover && M.inside(hover.x, hover.y) && S.view !== 'time') {
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(L.left, Math.round(hover.y) + 0.5); ctx.lineTo(L.left + L.w, Math.round(hover.y) + 0.5);
    ctx.moveTo(Math.round(hover.x) + 0.5, L.top); ctx.lineTo(Math.round(hover.x) + 0.5, L.top + L.h);
    ctx.stroke();
    ctx.setLineDash([]);
    if (hover.touch) {
      ctx.strokeStyle = '#2f6fdf';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 18, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  if (timeCursor && S.view === 'time') drawTimeCursor(ctx);
  if (zoomRect) {
    ctx.strokeStyle = '#2f6fdf';
    ctx.fillStyle = 'rgba(47,111,223,.12)';
    ctx.lineWidth = 1.5;
    const x = Math.min(zoomRect.x0, zoomRect.x1), y = Math.min(zoomRect.y0, zoomRect.y1);
    const w = Math.abs(zoomRect.x1 - zoomRect.x0), h = Math.abs(zoomRect.y1 - zoomRect.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  if (S.bifSel && S.view === 'bif') {
    const sel = S.bifSel;
    let x, y;
    if (sel.sw) { x = M.X(sel.sw.p); y = M.Y(sel.yv); } else { x = M.X(sel.pd.X[S.sys.n]); y = M.Y(S.bif.y === 'period' ? sel.spec?.period : bifY(sel.pd)); }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      ctx.strokeStyle = '#2f6fdf';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, 2 * Math.PI); ctx.stroke();
    }
  }
}
function drawTimeCursor(ctx) {
  const o = lastOrbit();
  if (!o || !M.inside(timeCursor.x, (L.top + L.h / 2))) return;
  const t = M.toX(timeCursor.x);
  const ts = o.res.t;
  if (!ts.length) return;
  // nearest index (t is monotone)
  let lo = 0, hi = ts.length - 1;
  const inc = ts[hi] >= ts[0];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((ts[mid] < t) === inc) lo = mid; else hi = mid; }
  const k = Math.abs(ts[lo] - t) < Math.abs(ts[hi] - t) ? lo : hi;
  const x = Math.round(M.X(ts[k])) + 0.5;
  ctx.strokeStyle = 'rgba(0,0,0,.45)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, L.top); ctx.lineTo(x, L.top + L.h); ctx.stroke();
  const names = seriesNames();
  const parts = [`t=${fmt(ts[k], 6)}`];
  S.plot.timeVars.forEach((v, j) => {
    const val = col(o, v)[k];
    parts.push(`${names[v + 1]}=${fmt(val, 6)}`);
    const y = M.Y(val);
    if (Number.isFinite(y)) dot(ctx, x, y, 4.5, timeColor(o, j));
  });
  $('coords').textContent = parts.join('  ');
}

// ---------------------------------------------------------------- view / window
function setView(v, doRender = true) {
  S.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  wrap.classList.toggle('v3d', v === '3d');
  $('coords').textContent = '';
  timeCursor = null;
  hover = null;
  if (doRender) { renderNow(); saveStore(); }
  const hints = {
    phase: 'Phase plane: tap to integrate from a point, drag to preview, pinch to zoom.',
    time: 'Time series: tap/drag to read values, pinch to zoom.',
    '3d': '3D view: drag to rotate, pinch or wheel to zoom.',
    bif: 'Bifurcation diagram: tap a point for details.',
  };
  if (doRender) setStatus(hints[v]);
}
function setMode(m) {
  S.mode = m;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  saveStore();
}

function setWin(key, w) {
  if (![w.xlo, w.xhi, w.ylo, w.yhi].every(Number.isFinite) || !(w.xhi > w.xlo) || !(w.yhi > w.ylo)) return false;
  const span = Math.max(Math.abs(w.xlo), Math.abs(w.xhi), Math.abs(w.ylo), Math.abs(w.yhi), 1e-300);
  if ((w.xhi - w.xlo) < 1e-12 * span || (w.yhi - w.ylo) < 1e-12 * span) return false;
  S.win[key] = { ...w };
  if (key === 'phase') nullCache = null;
  syncWinInputs();
  saveStore();
  return true;
}

function padRange(lo, hi, frac = 0.06) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-1, 1];
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(lo), Math.abs(hi))) { const c = (lo + hi) / 2; const d = Math.max(1e-6, Math.abs(c) * 0.1, 0.5); return [c - d, c + d]; }
  const d = (hi - lo) * frac;
  return [lo - d, hi + d];
}
function dataRange(arrays) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) for (let k = 0; k < a.length; k++) { const v = a[k]; if (Number.isFinite(v) && Math.abs(v) < 1e12) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  return [lo, hi];
}
function fitView(which = S.view, doRender = true) {
  const orbs = S.orbits.filter((o) => o.kind !== 'manifold');
  if (which === 'phase') {
    const xi = S.plot.x, yi = S.plot.y;
    const xs = orbs.map((o) => col(o, xi)), ys = orbs.map((o) => col(o, yi));
    for (const e of S.equilibria) { xs.push([eqSeries(e.info.x, xi)]); ys.push([eqSeries(e.info.x, yi)]); }
    if (!xs.length) return;
    const [xl, xh] = padRange(...dataRange(xs));
    const [yl, yh] = padRange(...dataRange(ys));
    setWin('phase', { xlo: xl, xhi: xh, ylo: yl, yhi: yh });
  } else if (which === 'time') {
    if (!orbs.length) return;
    const [tl, th] = dataRange(orbs.map((o) => o.res.t));
    const [yl, yh] = padRange(...dataRange(orbs.flatMap((o) => S.plot.timeVars.map((v) => col(o, v)))));
    if (Number.isFinite(tl) && th > tl) setWin('time', { xlo: tl, xhi: th, ylo: yl, yhi: yh });
  } else if (which === '3d') {
    const all = S.orbits;
    if (!all.length) return;
    const { x3, y3, z3 } = S.plot;
    const [xl, xh] = padRange(...dataRange(all.map((o) => col(o, x3))), 0.02);
    const [yl, yh] = padRange(...dataRange(all.map((o) => col(o, y3))), 0.02);
    const [zl, zh] = padRange(...dataRange(all.map((o) => col(o, z3))), 0.02);
    S.box3d = { xlo: xl, xhi: xh, ylo: yl, yhi: yh, zlo: zl, zhi: zh };
    S.rot.zoom = 1;
  } else if (which === 'bif') {
    const n = S.sys.n;
    const par = S.bif.par;
    const xs = [], ys = [];
    const period = S.bif.y === 'period';
    for (const br of S.branches) {
      if (br.par !== par) continue;
      if (!period) { xs.push(br.points.map((p) => p.X[n])); ys.push(br.points.map(bifY)); } else { const hb = br.special.filter((q) => q.type === 'HB'); xs.push(hb.map((q) => q.pd.X[n])); ys.push(hb.map((q) => q.period)); }
    }
    for (const run of S.sweep) {
      if (run.par !== par) continue;
      const ok = run.results.filter((r) => r.status === 'ok');
      xs.push(ok.map((r) => r.p));
      if (period) ys.push(ok.filter((r) => r.periodic).map((r) => r.period));
      else if (S.bif.y !== 'norm') { const i = Number(S.bif.y.slice(1)); ys.push(ok.map((r) => (r.periodic || !r.end ? r.max[i] : r.end[i])), ok.map((r) => (r.periodic || !r.end ? r.min[i] : r.end[i]))); }
    }
    const [xl0, xh0] = dataRange(xs);
    const [yl0, yh0] = dataRange(ys);
    if (!Number.isFinite(xl0)) return;
    const [xl, xh] = padRange(Math.min(xl0, S.bif.pmin), Math.max(xh0, S.bif.pmax), 0.03);
    const [yl, yh] = padRange(yl0, yh0, 0.08);
    setWin('bif', { xlo: xl, xhi: xh, ylo: yl, yhi: yh });
  }
  if (doRender) { render(); saveStore(); }
}
function zoomBy(f, cx = null, cy = null) {
  if (S.view === '3d') { S.rot.zoom = Math.min(20, Math.max(0.2, S.rot.zoom * f)); render(); saveStore(); return; }
  const key = S.view === 'time' ? 'time' : S.view === 'bif' ? 'bif' : 'phase';
  const w = S.win[key];
  const mx = cx ?? (w.xlo + w.xhi) / 2, my = cy ?? (w.ylo + w.yhi) / 2;
  setWin(key, { xlo: mx - (mx - w.xlo) / f, xhi: mx + (w.xhi - mx) / f, ylo: my - (my - w.ylo) / f, yhi: my + (w.yhi - my) / f });
  render();
}
function defaultWindow() {
  const d = S.defaults.win;
  if (S.view === '3d') { fitView('3d'); S.rot = { yaw: -0.65, pitch: 0.4, zoom: 1 }; render(); return; }
  if (S.view === 'bif') { fitBifDefault(); syncWinInputs(); render(); return; }
  const key = S.view === 'time' ? 'time' : 'phase';
  if (d[key]) setWin(key, d[key]);
  render();
}

// ---------------------------------------------------------------- pointer input
const pointers = new Map();
let gesture = null;
let wheel = null;
let previewRaf = 0;

function localPos(e) {
  const r = overCv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function setPreviewTransform(s, tx, ty) { baseCv.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; }
function clearPreviewTransform() { baseCv.style.transform = ''; }
function commitTransform(s, tx, ty) {
  clearPreviewTransform();
  if (!L || (Math.abs(s - 1) < 0.005 && Math.abs(tx) < 3 && Math.abs(ty) < 3)) { renderNow(); return; }
  const key = S.view === 'time' ? 'time' : S.view === 'bif' ? 'bif' : 'phase';
  const inv = (X) => (X - tx) / s;
  const xlo = M.toX(inv(L.left)), xhi = M.toX(inv(L.left + L.w));
  const yhi = M.toY((L.top - ty) / s), ylo = M.toY((L.top + L.h - ty) / s);
  setWin(key, { xlo, xhi, ylo, yhi });
  renderNow();
}
function showCoords(p) {
  if (!M || !M.inside(p.x, p.y)) { if (S.view !== 'time') $('coords').textContent = ''; return; }
  const names = seriesNames();
  if (S.view === 'phase') $('coords').textContent = `${names[S.plot.x + 1]}=${fmt(M.toX(p.x))}  ${names[S.plot.y + 1]}=${fmt(M.toY(p.y))}`;
  else if (S.view === 'bif') $('coords').textContent = `${S.sys.pars[S.bif.par]}=${fmt(M.toX(p.x))}  y=${fmt(M.toY(p.y))}`;
}

function gestureMode(e) {
  if (S.view === '3d') return 'rotate';
  if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) return 'pan';
  if (e.shiftKey || e.ctrlKey || e.metaKey || S.mode === 'zoom') return 'zoom';
  if (S.view === 'phase') return S.mode;
  if (S.view === 'time') return 'cursor';
  return 'select';
}

function onPointerDown(e) {
  if (!S.sys) return;
  try { overCv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', a0: { ...a }, b0: { ...b }, s: 1, tx: 0, ty: 0, zoom0: S.rot.zoom };
    zoomRect = null; preview = null; hover = null;
    renderOverlay();
    return;
  }
  if (pointers.size > 2) return;
  const mode = gestureMode(e);
  gesture = { type: 'single', id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, mode, touch: e.pointerType !== 'mouse', moved: false, rot0: { ...S.rot } };
  if (mode === 'ic' && L && M.inside(p.x, p.y)) {
    hover = { ...p, touch: gesture.touch };
    showCoords(p);
    schedulePreview(p);
  } else if (mode === 'eq') {
    hover = { ...p, touch: gesture.touch };
    showCoords(p);
    renderOverlay();
  } else if (mode === 'cursor') {
    timeCursor = p;
    renderOverlay();
  }
}

function schedulePreview(p) {
  gesture.pp = p;
  if (previewRaf) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    if (!gesture || gesture.mode !== 'ic' || !gesture.pp) return;
    const q = gesture.pp;
    if (!M.inside(q.x, q.y)) { preview = null; renderOverlay(); return; }
    const ic = icFromScreen(q);
    const t0 = S.plot.x === -1 ? M.toX(q.x) : S.num.t0;
    const res = runIntegration(ic.y, t0, S.num.dir, S.num.total, { timeLimit: 250 });
    preview = { res, color: PALETTE[S.colorIdx % PALETTE.length] };
    renderOverlay();
  });
}
function icFromScreen(p) {
  const y = Float64Array.from(S.ic);
  if (S.plot.x >= 0 && S.plot.x < S.sys.n) y[S.plot.x] = M.toX(p.x);
  if (S.plot.y >= 0 && S.plot.y < S.sys.n) y[S.plot.y] = M.toY(p.y);
  return { y };
}

function onPointerMove(e) {
  if (!S.sys) return;
  const p = localPos(e);
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType === 'mouse' && S.view !== '3d') {
      if (S.view === 'time') { timeCursor = p; renderOverlay(); return; }
      hover = { ...p, touch: false };
      showCoords(p);
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
    if (S.view === '3d') {
      S.rot.zoom = Math.min(20, Math.max(0.2, gesture.zoom0 * s));
      render();
      return;
    }
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
  if (Math.hypot(p.x - gesture.x0, p.y - gesture.y0) > 8) gesture.moved = true;
  switch (gesture.mode) {
    case 'rotate': {
      const r0 = gesture.rot0;
      S.rot.yaw = r0.yaw + (p.x - gesture.x0) * 0.008;
      S.rot.pitch = Math.max(-1.5, Math.min(1.5, r0.pitch + (p.y - gesture.y0) * 0.008));
      render();
      break;
    }
    case 'pan':
      setPreviewTransform(1, p.x - gesture.x0, p.y - gesture.y0);
      break;
    case 'zoom':
      if (gesture.moved) { zoomRect = { x0: gesture.x0, y0: gesture.y0, x1: p.x, y1: p.y }; renderOverlay(); }
      showCoords(p);
      break;
    case 'ic':
      hover = { ...p, touch: gesture.touch };
      showCoords(p);
      schedulePreview(p);
      break;
    case 'eq':
      hover = { ...p, touch: gesture.touch };
      showCoords(p);
      renderOverlay();
      break;
    case 'cursor':
      timeCursor = p;
      renderOverlay();
      break;
    default:
      showCoords(p);
  }
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') {
    gesture = pointers.size ? { type: 'done' } : null;
    if (S.view === '3d') { saveStore(); return; }
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
  const pv = preview;
  preview = null;
  if (g.touch) hover = null;
  if (cancelled) { clearPreviewTransform(); renderOverlay(); return; }
  switch (g.mode) {
    case 'rotate': saveStore(); break;
    case 'pan': commitTransform(1, p.x - g.x0, p.y - g.y0); break;
    case 'zoom':
      if (rect && Math.abs(rect.x1 - rect.x0) > 8 && Math.abs(rect.y1 - rect.y0) > 8) {
        const key = S.view === 'time' ? 'time' : S.view === 'bif' ? 'bif' : 'phase';
        const xa = M.toX(Math.min(rect.x0, rect.x1)), xb = M.toX(Math.max(rect.x0, rect.x1));
        const ya = M.toY(Math.max(rect.y0, rect.y1)), yb = M.toY(Math.min(rect.y0, rect.y1));
        setWin(key, { xlo: xa, xhi: xb, ylo: ya, yhi: yb });
        render();
      } else if (M && M.inside(p.x, p.y)) zoomBy(2, M.toX(p.x), M.toY(p.y));
      break;
    case 'ic':
      if (M && M.inside(p.x, p.y)) commitIC(p, pv);
      break;
    case 'eq':
      if (M && M.inside(p.x, p.y)) {
        if (!isVar(S.plot.x) || !isVar(S.plot.y)) setStatus('Put state variables on both axes to search equilibria by tapping.', true);
        else addEquilibrium(icFromScreen(p).y);
      }
      break;
    case 'select':
      if (!g.moved) selectBif(p);
      break;
    default: break;
  }
  renderOverlay();
}

function commitIC(p, pv) {
  const ic = icFromScreen(p).y;
  const t0 = S.plot.x === -1 ? M.toX(p.x) : S.num.t0;
  S.ic.set(ic);
  syncIcInputs();
  const orbit = addOrbit(ic, { t0 });
  if (pv && pv.res && orbit.res.t.length === 0) orbit.res = pv.res;
  afterIntegrate();
}

function selectBif(p) {
  if (!M || !M.inside(p.x, p.y)) return;
  const n = S.sys.n;
  const par = S.bif.par;
  let best = null, bd = 30;
  const period = S.bif.y === 'period';
  for (const br of S.branches) {
    if (br.par !== par) continue;
    for (const q of br.special) {
      const y = period ? q.period : bifY(q.pd);
      const d = Math.hypot(M.X(q.pd.X[n]) - p.x, M.Y(y) - p.y) - 8; // prefer special points
      if (d < bd) { bd = d; best = { pd: q.pd, spec: q, br }; }
    }
    if (period) continue;
    for (const pd of br.points) {
      const d = Math.hypot(M.X(pd.X[n]) - p.x, M.Y(bifY(pd)) - p.y);
      if (d < bd) { bd = d; best = { pd, br }; }
    }
  }
  for (const run of S.sweep) {
    if (run.par !== par) continue;
    for (const r of run.results) {
      if (r.status !== 'ok') continue;
      const vi = Number(S.bif.y.slice(1));
      const ys = period ? [r.period] : S.bif.y === 'norm' ? [] : r.periodic || !r.end ? [r.max[vi], r.min[vi]] : [r.end[vi]];
      for (const yv of ys) {
        const d = Math.hypot(M.X(r.p) - p.x, M.Y(yv) - p.y);
        if (d < bd) { bd = d; best = { sw: r, yv, par: run.par }; }
      }
    }
  }
  if (best) showBifPoint(best);
}

function onWheel(e) {
  if (!S.sys) return;
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  if (S.view === '3d') { S.rot.zoom = Math.min(20, Math.max(0.2, S.rot.zoom * factor)); render(); saveStore(); return; }
  if (!L) return;
  const p = localPos(e);
  if (!wheel) wheel = { s: 1, tx: 0, ty: 0, timer: 0 };
  wheel.s *= factor;
  wheel.tx = p.x - (p.x - wheel.tx) * factor;
  wheel.ty = p.y - (p.y - wheel.ty) * factor;
  setPreviewTransform(wheel.s, wheel.tx, wheel.ty);
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(() => { const w = wheel; wheel = null; commitTransform(w.s, w.tx, w.ty); }, 250);
}

// ---------------------------------------------------------------- dialogs
const dlg = $('dlg');
function openDialog({ title, body, buttons = [{ label: 'OK', value: 'ok', primary: true }], validate }) {
  return new Promise((resolve) => {
    if (dlg.open) dlg.close('cancel');
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
    // Enter in a text field must trigger the primary button; the browser's implicit
    // submission would use the first submit button in the form (the ✕ / Cancel).
    b.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT' || ['checkbox', 'radio'].includes(e.target.type)) return;
      e.preventDefault();
      const def = bb.querySelector('button.primary') || bb.querySelector('button:not([value=cancel])');
      if (def) def.click();
    };
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dlg.showModal();
    const first = b.querySelector('input:not([type=checkbox]):not([type=radio]), select');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  });
}
function alertDialog(title, html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return openDialog({ title, body: d });
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

async function rangeDialog() {
  const sys = S.sys;
  const box = document.createElement('div');
  const opts = [...sys.vars.map((v, i) => `<option value="v${i}">${esc(v)} (initial value)</option>`), ...sys.pars.map((p, i) => `<option value="p${i}">${esc(p)} (parameter)</option>`)].join('');
  box.innerHTML = `<p>Integrate repeatedly while stepping an initial value or a parameter (XPP: Initialconds → Range).</p>
    <div class="grid2">
      <label>Range over</label><select id="rgWhat">${opts}</select>
      <label>Start</label><input id="rgFrom" inputmode="decimal">
      <label>End</label><input id="rgTo" inputmode="decimal">
      <label>Steps</label><input id="rgSteps" inputmode="numeric" value="10">
    </div>
    <label class="check"><input type="checkbox" id="rgErase" checked> Erase previous orbits first</label>`;
  const what = box.querySelector('#rgWhat');
  const fill = () => {
    const v = what.value;
    const k = Number(v.slice(1));
    const cur = v[0] === 'v' ? S.ic[k] : sys.P[k];
    const [lo, hi] = v[0] === 'p' ? S.parRange[k] : [cur - 1, cur + 1];
    box.querySelector('#rgFrom').value = fmt(lo, 6);
    box.querySelector('#rgTo').value = fmt(hi, 6);
  };
  what.onchange = fill;
  if (S.lastRange) {
    what.value = S.lastRange.what;
  }
  fill();
  if (S.lastRange && S.lastRange.what === what.value) {
    box.querySelector('#rgFrom').value = S.lastRange.from;
    box.querySelector('#rgTo').value = S.lastRange.to;
    box.querySelector('#rgSteps').value = S.lastRange.steps;
  }
  const r = await openDialog({
    title: 'Range', body: box,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Run', value: 'ok', primary: true }],
    validate: () => {
      let ok = true;
      for (const id of ['rgFrom', 'rgTo', 'rgSteps']) {
        const el = box.querySelector(`#${id}`);
        const bad = !Number.isFinite(parseNum(el.value)) || (id === 'rgSteps' && !(parseNum(el.value) >= 1 && parseNum(el.value) <= 500));
        el.classList.toggle('bad', bad);
        if (bad) ok = false;
      }
      return ok;
    },
  });
  if (r !== 'ok') return;
  const v = what.value;
  const k = Number(v.slice(1));
  const from = parseNum(box.querySelector('#rgFrom').value);
  const to = parseNum(box.querySelector('#rgTo').value);
  const steps = Math.round(parseNum(box.querySelector('#rgSteps').value));
  S.lastRange = { what: v, from: box.querySelector('#rgFrom').value, to: box.querySelector('#rgTo').value, steps: String(steps) };
  if (box.querySelector('#rgErase').checked) S.orbits = S.orbits.filter((o) => o.frozen || o.kind === 'manifold');
  const t0 = performance.now();
  const saved = sys.P[k];
  let pts = 0;
  for (let i = 0; i <= steps; i++) {
    const val = from + (to - from) * i / steps;
    const color = `hsl(${Math.round(230 - 230 * i / Math.max(1, steps))}, 75%, 45%)`;
    if (v[0] === 'v') {
      const ic = Float64Array.from(S.ic);
      ic[k] = val;
      pts += addOrbit(ic, { color, quiet: true }).res.t.length;
    } else {
      sys.setPar(k, val);
      const o = addOrbit(S.ic, { color, kind: 'range', quiet: true });
      o.label = `${sys.pars[k]}=${fmt(val)}`;
      o.frozen = false;
      pts += o.res.t.length;
    }
    if (performance.now() - t0 > 15000) { setStatus('Range stopped after 15 s.', true); break; }
  }
  if (v[0] === 'p') sys.setPar(k, saved);
  afterIntegrate();
  setStatus(`Range over ${v[0] === 'v' ? sys.vars[k] : sys.pars[k]}: ${steps + 1} orbits, ${pts} points (${(performance.now() - t0).toFixed(0)} ms).`);
}

async function keyboardIC() {
  const sys = S.sys;
  const box = document.createElement('div');
  box.innerHTML = `<div class="grid2">${sys.vars.map((v, i) => `<label>${esc(v)}</label><input data-i="${i}" inputmode="decimal" value="${fmt(S.ic[i], 10)}">`).join('')}</div>`;
  const r = await openDialog({
    title: 'Initial values', body: box,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Go', value: 'ok', primary: true }],
    validate: () => {
      let ok = true;
      box.querySelectorAll('input').forEach((el) => { const bad = !Number.isFinite(parseNum(el.value)); el.classList.toggle('bad', bad); if (bad) ok = false; });
      return ok;
    },
  });
  if (r !== 'ok') return;
  box.querySelectorAll('input').forEach((el) => { S.ic[Number(el.dataset.i)] = parseNum(el.value); });
  syncIcInputs();
  go();
}

// ----- data viewer
const dataDlg = $('dataDlg');
const ROW_H = 28;
let dataOrbit = null;
function openDataViewer() {
  const sel = $('dataOrbit');
  sel.innerHTML = '';
  const list = S.orbits.map((o, k) => ({ o, k })).filter(({ o }) => o.kind !== 'manifold');
  if (!list.length) { setStatus('No orbit to show. Integrate first.', true); return; }
  list.forEach(({ o, k }, j) => {
    const opt = document.createElement('option');
    opt.value = String(k);
    const icTxt = S.sys.vars.slice(0, 3).map((v, i) => `${v}=${fmt(o.ic[i], 3)}`).join(', ');
    opt.textContent = `Orbit ${j + 1}${o.label ? ` (${o.label})` : ''}: ${icTxt}${o.frozen ? ' [frozen]' : ''}`;
    sel.append(opt);
  });
  sel.value = String(list[list.length - 1].k);
  sel.onchange = () => showDataOrbit(S.orbits[Number(sel.value)]);
  dataDlg.showModal();
  showDataOrbit(S.orbits[Number(sel.value)]);
}
function showDataOrbit(o) {
  dataOrbit = o;
  const names = seriesNames();
  const ncol = names.length;
  const tmpl = `repeat(${ncol}, minmax(96px, 1fr))`;
  const head = $('dataHead');
  head.style.gridTemplateColumns = tmpl;
  head.innerHTML = names.map((n) => `<span>${esc(n)}</span>`).join('');
  $('dataRows').style.setProperty('--cols', tmpl);
  $('dataSpacer').style.height = `${o.res.t.length * ROW_H}px`;
  const minW = ncol * 96 + 16;
  $('dataSpacer').style.minWidth = `${minW}px`;
  head.style.minWidth = `${minW}px`;
  $('dataInfo').textContent = `${o.res.t.length} rows · ${o.res.message || 'ok'}`;
  $('dataScroll').scrollTop = 0;
  renderDataRows();
}
function renderDataRows() {
  const o = dataOrbit;
  if (!o) return;
  const sc = $('dataScroll');
  const n = o.res.t.length;
  const first = Math.max(0, Math.floor(sc.scrollTop / ROW_H) - 5);
  const last = Math.min(n, first + Math.ceil(sc.clientHeight / ROW_H) + 12);
  const rows = $('dataRows');
  rows.style.top = `${first * ROW_H}px`;
  const tmpl = `repeat(${o.res.cols.length + 1}, minmax(96px, 1fr))`;
  let html = '';
  for (let k = first; k < last; k++) {
    html += `<div class="data-row" style="grid-template-columns:${tmpl}"><span>${fmt(o.res.t[k], 7)}</span>${o.res.cols.map((c) => `<span>${fmt(c[k], 7)}</span>`).join('')}</div>`;
  }
  rows.innerHTML = html;
  $('dataHead').scrollLeft = sc.scrollLeft;
}
function orbitCsv(o) {
  const names = seriesNames();
  const lines = [names.join(',')];
  const n = o.res.t.length;
  for (let k = 0; k < n; k++) {
    const row = [o.res.t[k], ...o.res.cols.map((c) => c[k])];
    lines.push(row.map((v) => (Number.isFinite(v) ? Number(v.toPrecision(12)) : 'NaN')).join(','));
  }
  return lines.join('\n') + '\n';
}
function exportCsv(o = lastOrbit()) {
  if (!o) { setStatus('No orbit to export.', true); return; }
  download(new Blob([orbitCsv(o)], { type: 'text/csv' }), `${fileBase()}.csv`);
}
function fileBase() {
  const t = (S.sys && S.sys.title) || 'xpp';
  return t.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30).toLowerCase() || 'xpp';
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
  renderNow();
  const blob = await new Promise((res) => baseCv.toBlob(res, 'image/png'));
  if (!blob) return;
  const name = `${fileBase()}-${S.view}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: 'XPP lite' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}
function saveOde() {
  const text = $('odeText').value;
  download(new Blob([text], { type: 'text/plain' }), `${fileBase()}.ode`);
}

// ----- help
const SYNTAX_HELP = `
<p>Models are written in (a subset of) the <b>XPP .ode</b> file format. One statement per line; <code>#</code> starts a comment; a trailing <code>\\</code> continues a line; names are case-insensitive.</p>
<pre>
# comment (the first comment is used as title)
x' = a*x - y          differential equation
dy/dt = x + y^2       same, other notation
x(0) = 1              initial value
init x=1, y=0         initial values
par a=0.5, b=2        parameters (get sliders)
number g=9.81         numeric constant
!c = a*b              derived constant (from parameters)
f(u,v) = u*v/(1+u)    user function
w = x*y               fixed (temporary) quantity
aux energy = x^2+y^2  auxiliary output (table, plots)
@ total=100, dt=0.05  options
done                  end of file (rest ignored)
</pre>
<p><b>Operators:</b> <code>+ - * / ^ **</code>, comparisons <code>&lt; &gt; &lt;= &gt;= == !=</code> (give 1 or 0), <code>&amp;</code> (and), <code>|</code> (or), <code>if(c)then(a)else(b)</code>. Multiplication must be explicit: <code>2*x</code>.</p>
<p><b>Functions:</b> sin cos tan asin acos atan atan2(y,x) sinh cosh tanh exp ln log log10 sqrt abs sign heav(x) mod(a,b) min(a,b) max(a,b) flr ceil erf erfc ran(x) normal(m,s) not(x); constant <code>pi</code>; time <code>t</code>.</p>
<p><b>Options (@):</b> total, dt, t0, trans, nout, meth (euler, rk4/runge, qualrk/rk45/dorpri, stiff/cvode/rosen, backeul), tol, atol, bound, xp, yp, zp (axis variables; <code>xp=t</code> starts with a time series), xlo, xhi, ylo, yhi, axes=3 (start in 3D view), parmin, parmax, ds, dsmax, nmax (bifurcation settings).</p>
<p class="hint">Not supported: arrays <code>x[1..n]</code>, tables, Markov / Wiener processes, delay equations, Volterra integrals, global flags and boundary value problems.</p>`;

const HOWTO_HELP = `
<p><b>Views</b> (toolbar): <b>Phase</b> plane with direction field, nullclines (red: x′=0, green: y′=0), equilibria (filled = stable, open = unstable) and saddle separatrices (red = unstable, blue = stable manifold); <b>Time</b> series; <b>3D</b> (drag to rotate); <b>Bif</b>urcation diagram.</p>
<p><b>Tap modes:</b> <b>Init</b> – tap in the phase plane to integrate from that point (drag to preview the orbit live); <b>Equil</b> – tap near an equilibrium to locate it with Newton's method; <b>Zoom</b> – drag a rectangle or tap to zoom in. Pinch with two fingers to zoom and pan in every mode.</p>
<p><b>Panel tabs:</b> Model (editor, examples, open/save), Par (sliders – orbits update live), Init (initial values, Last, Continue, Range), Num (integrator), Plot (axes, windows, field), Equil (equilibria with eigenvalues), Bif (continuation and periodic sweep).</p>
<p>For higher-dimensional systems the phase plane is a 2D slice: direction field and nullclines are computed with the other variables fixed at their initial values.</p>
<p><b>Bifurcation diagrams:</b> integrate to a steady state, press <i>Last</i>, then on the Bif tab press <i>Continue from equilibrium</i>. Limit points (LP), Hopf bifurcations (HB) and branch points (BP) are detected and labelled. Tap a point to see eigenvalues, to grab its parameter value or to switch branches at a BP. <i>Sweep by simulation</i> adds max/min of stable oscillations.</p>
<p><b>Keyboard:</b> G go, E erase, F fit, 1–4 views, Esc stop, Ctrl/⌘+Enter apply model.</p>
<p class="hint">Tip: in Safari use Share → “Add to Home Screen” to run full screen like an app.</p>`;

function aboutDialog() {
  return alertDialog('About XPP lite', `
    <p style="color:#2a7d46;font-weight:600">XPP lite is a touch-friendly tool for exploring systems of ordinary differential equations: phase planes, nullclines, equilibria and their stability, time series, 3D orbits and one-parameter bifurcation diagrams.</p>
    <p>It is an <b>independent web re-implementation</b> inspired by <b>XPP/XPPAUT</b> by <b>G. Bard Ermentrout</b> (University of Pittsburgh) and the continuation software <b>AUTO</b> by <b>Eusebius J. Doedel</b> (Concordia University). It reads a subset of XPP's .ode file format. It is not affiliated with or endorsed by the original authors and does not use their code.</p>
    <p>Numerics: Euler, RK4, Dormand–Prince 5(4) with dense output, Rosenbrock 2(3) (ode23s, Shampine &amp; Reichelt) and backward Euler; Newton's method; eigenvalues by Hessenberg QR; pseudo-arclength continuation with detection of folds, Hopf and branch points.</p>
    <p class="hint">Reference: B. Ermentrout, <i>Simulating, Analyzing, and Animating Dynamical Systems: A Guide to XPPAUT for Researchers and Students</i>, SIAM 2002.</p>`);
}

// ---------------------------------------------------------------- panel UI
function buildModelUI() {
  buildParList();
  buildIcList();
  buildPlotSelects();
  syncNumInputs();
  syncWinInputs();
  syncPlotInputs();
  buildBifInputs();
  renderEqList();
  renderBifList();
}

function setParValue(i, v) {
  S.sys.setPar(i, v);
  const r = S.parRange[i];
  if (v < r[0]) r[0] = v;
  if (v > r[1]) r[1] = v;
}

function buildParList() {
  const sys = S.sys;
  const box = $('parList');
  box.innerHTML = '';
  $('parEmpty').hidden = sys.pars.length > 0;
  sys.pars.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'par';
    const r = S.parRange[i];
    row.innerHTML = `<div class="par-top"><label for="pv${i}">${esc(name)}</label><input id="pv${i}" inputmode="decimal" autocomplete="off"></div>
      <div class="par-range"><input class="lo" inputmode="decimal" aria-label="${esc(name)} minimum"><input type="range" min="0" max="1000" step="1" aria-label="${esc(name)} slider"><input class="hi" inputmode="decimal" aria-label="${esc(name)} maximum"></div>`;
    const val = row.querySelector(`#pv${i}`);
    const lo = row.querySelector('.lo'), hi = row.querySelector('.hi');
    const sl = row.querySelector('input[type=range]');
    const sync = () => {
      val.value = fmt(sys.P[i], 8);
      lo.value = fmt(r[0], 5);
      hi.value = fmt(r[1], 5);
      sl.value = String(Math.round(1000 * (sys.P[i] - r[0]) / ((r[1] - r[0]) || 1)));
    };
    sync();
    sl.addEventListener('input', () => {
      const v = r[0] + (r[1] - r[0]) * Number(sl.value) / 1000;
      sys.setPar(i, Number(v.toPrecision(10)));
      val.value = fmt(sys.P[i], 8);
      scheduleRecompute('drag');
    });
    sl.addEventListener('change', () => scheduleRecompute('full'));
    val.addEventListener('change', () => {
      const v = parseNum(val.value);
      if (!Number.isFinite(v)) { val.classList.add('bad'); return; }
      val.classList.remove('bad');
      setParValue(i, v);
      sync();
      scheduleRecompute('full');
    });
    const rangeChange = () => {
      const a = parseNum(lo.value), b = parseNum(hi.value);
      const bad = !(Number.isFinite(a) && Number.isFinite(b) && b > a);
      lo.classList.toggle('bad', bad); hi.classList.toggle('bad', bad);
      if (bad) return;
      r[0] = a; r[1] = b;
      sync();
      saveStore();
    };
    lo.addEventListener('change', rangeChange);
    hi.addEventListener('change', rangeChange);
    for (const el of [val, lo, hi]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    box.append(row);
  });
}

function buildIcList() {
  const sys = S.sys;
  const box = $('icList');
  box.innerHTML = '';
  sys.vars.forEach((v, i) => {
    const lab = document.createElement('label');
    lab.textContent = v;
    lab.htmlFor = `ic${i}`;
    const inp = document.createElement('input');
    inp.id = `ic${i}`;
    inp.setAttribute('inputmode', 'decimal');
    inp.autocomplete = 'off';
    inp.addEventListener('change', () => {
      const x = parseNum(inp.value);
      if (!Number.isFinite(x)) { inp.classList.add('bad'); return; }
      inp.classList.remove('bad');
      S.ic[i] = x;
      nullCache = null;
      if (sys.n > 2) render();
      saveStore();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.dispatchEvent(new Event('change')); go(); } });
    box.append(lab, inp);
  });
  syncIcInputs();
}
function syncIcInputs() {
  S.sys.vars.forEach((v, i) => { const el = $(`ic${i}`); if (el) { el.value = fmt(S.ic[i], 10); el.classList.remove('bad'); } });
}

function fillSelect(sel, items, value) {
  sel.innerHTML = '';
  for (const [v, label] of items) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label;
    sel.append(o);
  }
  sel.value = String(value);
}
function buildPlotSelects() {
  const sys = S.sys;
  const vars = sys.vars.map((v, i) => [i, v]);
  const aux = sys.aux.map((a, i) => [sys.n + i, `${a} (aux)`]);
  fillSelect($('plX'), [[-1, 't'], ...vars, ...aux], S.plot.x);
  fillSelect($('plY'), [...vars, ...aux], S.plot.y);
  fillSelect($('pl3x'), [[-1, 't'], ...vars, ...aux], S.plot.x3);
  fillSelect($('pl3y'), [[-1, 't'], ...vars, ...aux], S.plot.y3);
  fillSelect($('pl3z'), [[-1, 't'], ...vars, ...aux], S.plot.z3);
  const chips = $('plTimeVars');
  chips.innerHTML = '';
  [...vars, ...sys.aux.map((a, i) => [sys.n + i, a])].forEach(([i, name]) => {
    const lab = document.createElement('label');
    const k = S.plot.timeVars.indexOf(i);
    lab.innerHTML = `<input type="checkbox" ${k >= 0 ? 'checked' : ''}> ${esc(name)} ${k >= 0 && S.plot.timeVars.length > 1 ? `<i style="background:${PALETTE[k % PALETTE.length]}"></i>` : ''}`;
    lab.querySelector('input').onchange = (e) => {
      let tv = S.plot.timeVars.filter((q) => q !== i);
      if (e.target.checked) tv.push(i);
      if (!tv.length) tv = [i];
      S.plot.timeVars = tv;
      buildPlotSelects();
      if (S.plot.autoTime) fitView('time', false);
      render(); saveStore();
    };
    chips.append(lab);
  });
}
function syncPlotInputs() {
  const p = S.plot;
  $('plField').value = p.field;
  $('plDensity').value = String(p.density);
  $('plNull').checked = p.nullclines;
  $('plEq').checked = p.eq;
  $('plMan').checked = p.manifolds;
  $('plAutoTime').checked = p.autoTime;
  $('plLw').value = String(p.lw);
  $('plFont').value = String(p.font);
  const note = $('sliceNote');
  const others = S.sys.vars.map((v, i) => i).filter((i) => i !== p.x && i !== p.y);
  if (S.sys.n > 2 && others.length) {
    note.hidden = false;
    note.textContent = `Field and nullclines are a 2D slice with ${others.map((i) => S.sys.vars[i]).join(', ')} fixed at the initial values (Init tab).`;
  } else note.hidden = true;
}
const WIN_INPUTS = [['plXlo', 'phase', 'xlo'], ['plXhi', 'phase', 'xhi'], ['plYlo', 'phase', 'ylo'], ['plYhi', 'phase', 'yhi'],
  ['plTlo', 'time', 'xlo'], ['plThi', 'time', 'xhi'], ['plTylo', 'time', 'ylo'], ['plTyhi', 'time', 'yhi']];
function syncWinInputs() {
  for (const [id, k, f] of WIN_INPUTS) { const w = S.win[k]; if (w) { $(id).value = fmt(w[f], 6); $(id).classList.remove('bad'); } }
}
function syncNumInputs() {
  const n = S.num;
  $('numMethod').value = n.method;
  $('numTotal').value = fmt(n.total, 8);
  $('numT0').value = fmt(n.t0, 8);
  $('numDt').value = fmt(n.dt, 8);
  $('numNout').value = String(n.nOut);
  $('numTrans').value = fmt(n.trans, 8);
  $('numRtol').value = fmt(n.rtol, 4);
  $('numAtol').value = fmt(n.atol, 4);
  $('numBound').value = fmt(n.bound, 4);
  $('numLive').checked = n.live;
  document.querySelectorAll('#numDir button').forEach((b) => b.classList.toggle('on', b.dataset.v === n.dir));
  const ad = METHODS.find((m) => m.id === n.method)?.adaptive;
  $('numRtol').disabled = !ad;
  $('numAtol').disabled = !ad;
}
function buildBifInputs() {
  const sys = S.sys;
  fillSelect($('bfPar'), sys.pars.map((p, i) => [i, p]), S.bif.par);
  fillSelect($('bfY'), [...sys.vars.map((v, i) => [`v${i}`, v]), ['norm', '‖x‖ (norm)'], ['period', 'period (sweep / HB)']], S.bif.y);
  if (!$('bfY').value) { S.bif.y = 'v0'; $('bfY').value = 'v0'; }
  const b = S.bif;
  $('bfMin').value = fmt(b.pmin, 8);
  $('bfMax').value = fmt(b.pmax, 8);
  $('bfDs').value = fmt(b.ds, 6);
  $('bfDsmax').value = fmt(b.dsmax, 6);
  $('bfNmax').value = String(b.nmax);
  $('bfDir').value = b.dir;
  const sw = S.sweepSet;
  $('swSteps').value = String(sw.steps);
  $('swTrans').value = fmt(sw.trans, 6);
  $('swSample').value = fmt(sw.sample, 6);
  $('swUpDown').checked = sw.updown;
  const dis = !sys.pars.length;
  $('btnBifRun').disabled = dis;
  $('btnSweep').disabled = dis || !!S.busy;
}
function readBifInputs() {
  const b = S.bif;
  const g = (id, def, pos = false) => {
    const v = parseNum($(id).value);
    const bad = !Number.isFinite(v) || (pos && !(v > 0));
    $(id).classList.toggle('bad', bad);
    return bad ? def : v;
  };
  b.par = Number($('bfPar').value) || 0;
  b.pmin = g('bfMin', b.pmin);
  b.pmax = g('bfMax', b.pmax);
  b.ds = g('bfDs', b.ds, true);
  b.dsmax = Math.max(b.ds, g('bfDsmax', b.dsmax, true));
  b.nmax = Math.max(10, Math.min(20000, Math.round(g('bfNmax', b.nmax, true))));
  b.dir = $('bfDir').value;
  saveStore();
}
function readSweepInputs() {
  const sw = S.sweepSet;
  const g = (id, def) => { const v = parseNum($(id).value); const bad = !(v > 0); $(id).classList.toggle('bad', bad); return bad ? def : v; };
  sw.steps = Math.min(2000, Math.max(1, Math.round(g('swSteps', sw.steps))));
  sw.trans = g('swTrans', sw.trans);
  sw.sample = g('swSample', sw.sample);
  sw.updown = $('swUpDown').checked;
}

function wirePanel() {
  // tabs
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  // model
  const ta = $('odeText');
  let lintTimer = 0;
  ta.addEventListener('input', () => {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(() => { showModelErrors(compileOde(ta.value)); saveStore(); }, 400);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFromEditor(); }
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
  });
  $('btnApply').onclick = applyFromEditor;
  $('gallerySelect').onchange = (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    let text = null;
    if (v[0] === 'b') text = EXAMPLES[Number(v.slice(1))].text;
    else { const m = loadMyModels()[Number(v.slice(1))]; if (m) text = m.text; }
    if (text == null) return;
    ta.value = text;
    if (applyModel(text)) closePanelIfNarrow();
  };
  $('btnOpenOde').onclick = () => $('odeFile').click();
  $('odeFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    ta.value = text;
    setTab('model');
    if (!isPanelOpen()) openPanel();
    if (applyModel(text)) setStatus(`Loaded ${f.name}.`);
  };
  $('btnSaveOde').onclick = saveOde;
  $('btnSaveMine').onclick = async () => {
    const name = await promptDialog('Save to My models', 'Name for this model (stored in this browser):', (S.sys && S.sys.title) || '');
    if (!name) return;
    const list = loadMyModels();
    const k = list.findIndex((m) => m.name === name);
    const item = { name, text: ta.value };
    if (k >= 0) list[k] = item; else list.push(item);
    saveMyModels(list);
    renderGallery();
    setStatus(`Saved “${name}” to My models.`);
  };
  $('btnDelMine').onclick = async () => {
    const list = loadMyModels();
    if (!list.length) { alertDialog('My models', '<p>There are no saved models. Built-in examples cannot be removed.</p>'); return; }
    const box = document.createElement('div');
    box.className = 'list-btns';
    list.forEach((m, i) => { const b = document.createElement('button'); b.value = String(i); b.textContent = `Delete “${m.name}”`; box.append(b); });
    const r = await openDialog({ title: 'Remove from My models', body: box, buttons: [{ label: 'Close', value: 'cancel' }] });
    const i = Number(r);
    if (r === 'cancel' || !Number.isInteger(i)) return;
    list.splice(i, 1);
    saveMyModels(list);
    renderGallery();
  };
  $('btnNewModel').onclick = () => {
    ta.value = "# My model\nx'=y\ny'=-a*x-b*y\npar a=1, b=0.2\ninit x=1, y=0\n@ total=30, dt=0.05, xp=x, yp=y\n@ xlo=-2, xhi=2, ylo=-2, yhi=2\ndone\n";
    showModelErrors(compileOde(ta.value));
    ta.focus();
  };
  // parameters
  $('btnParReset').onclick = () => {
    S.sys.parDefaults.forEach((v, i) => S.sys.setPar(i, v));
    S.parRange = S.sys.pars.map((_, i) => defaultParRange(S.sys.P[i]));
    buildParList();
    scheduleRecompute('full');
  };
  // initial values
  $('btnGo2').onclick = () => { go(); closePanelIfNarrow(); };
  $('btnLast').onclick = () => { lastIC(); };
  $('btnContinue').onclick = () => { continueOrbit(); };
  $('btnRange').onclick = () => rangeDialog();
  $('btnIcReset').onclick = () => { S.ic = Float64Array.from(S.defaults.ic); S.num.t0 = optNum('t0', 0); syncIcInputs(); syncNumInputs(); nullCache = null; render(); saveStore(); };
  // numerics
  fillSelect($('numMethod'), METHODS.map((m) => [m.id, m.name]), S.num.method);
  $('numMethod').onchange = (e) => { S.num.method = e.target.value; syncNumInputs(); saveStore(); };
  const numFields = [['numTotal', 'total', (v) => v > 0], ['numT0', 't0', () => true], ['numDt', 'dt', (v) => v > 0], ['numNout', 'nOut', (v) => v >= 1 && Number.isInteger(v)],
    ['numTrans', 'trans', (v) => v >= 0], ['numRtol', 'rtol', (v) => v > 0 && v < 1], ['numAtol', 'atol', (v) => v > 0], ['numBound', 'bound', (v) => v > 0]];
  for (const [id, key, ok] of numFields) {
    $(id).addEventListener('change', () => {
      const v = parseNum($(id).value);
      const bad = !Number.isFinite(v) || !ok(v);
      $(id).classList.toggle('bad', bad);
      if (bad) { setStatus(`Invalid value for ${$(id).labels?.[0]?.textContent || key}: kept ${fmt(S.num[key], 6)}.`, true); return; }
      S.num[key] = v;
      if (key === 'total' || key === 't0') { S.defaults.win.time = { ...S.win.time }; }
      saveStore();
    });
  }
  $('numDir').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.num.dir = b.dataset.v;
    syncNumInputs();
    saveStore();
  });
  $('numLive').onchange = (e) => { S.num.live = e.target.checked; saveStore(); };
  // plot
  const axisChange = () => {
    S.plot.x = Number($('plX').value);
    S.plot.y = Number($('plY').value);
    nullCache = null;
    S.orbits = S.orbits.filter((o) => o.kind !== 'manifold');
    for (const e of S.equilibria) attachManifolds(e);
    syncPlotInputs();
    fitView('phase', false);
    render(); saveStore();
  };
  $('plX').onchange = axisChange;
  $('plY').onchange = axisChange;
  const ax3 = () => { S.plot.x3 = Number($('pl3x').value); S.plot.y3 = Number($('pl3y').value); S.plot.z3 = Number($('pl3z').value); fitView('3d', false); render(); saveStore(); };
  $('pl3x').onchange = ax3; $('pl3y').onchange = ax3; $('pl3z').onchange = ax3;
  $('btn3dReset').onclick = () => { S.rot = { yaw: -0.65, pitch: 0.4, zoom: 1 }; fitView('3d', false); if (S.view !== '3d') setView('3d'); render(); saveStore(); };
  for (const [id, k, f] of WIN_INPUTS) {
    $(id).addEventListener('change', () => {
      const v = parseNum($(id).value);
      const w = { ...S.win[k], [f]: v };
      const ok = Number.isFinite(v) && setWin(k, w);
      $(id).classList.toggle('bad', !ok);
      if (ok) { if (k === 'time') S.plot.autoTime = false; syncPlotInputs(); render(); }
    });
  }
  $('plField').onchange = (e) => { S.plot.field = e.target.value; render(); saveStore(); };
  $('plDensity').onchange = (e) => { S.plot.density = Number(e.target.value); render(); saveStore(); };
  $('plNull').onchange = (e) => { S.plot.nullclines = e.target.checked; render(); saveStore(); };
  $('plEq').onchange = (e) => { S.plot.eq = e.target.checked; render(); saveStore(); };
  $('plMan').onchange = (e) => {
    S.plot.manifolds = e.target.checked;
    S.orbits = S.orbits.filter((o) => o.kind !== 'manifold');
    for (const q of S.equilibria) attachManifolds(q);
    render(); saveStore();
  };
  $('plAutoTime').onchange = (e) => { S.plot.autoTime = e.target.checked; if (S.plot.autoTime) fitView('time', false); render(); saveStore(); };
  $('plLw').onchange = (e) => { S.plot.lw = Number(e.target.value); render(); saveStore(); };
  $('plFont').onchange = (e) => { S.plot.font = Number(e.target.value); render(); saveStore(); };
  // equilibria
  $('btnEqFind').onclick = () => { const eq = addEquilibrium(S.ic, { relax: true }); if (eq) closePanelIfNarrow(); };
  $('btnEqSearch').onclick = () => { searchEquilibria(); };
  $('btnEqClear').onclick = () => { S.equilibria = []; S.orbits = S.orbits.filter((o) => o.kind !== 'manifold'); renderEqList(); render(); };
  // bifurcation
  $('btnBifRun').onclick = () => { runBif(); closePanelIfNarrow(); };
  $('btnSweep').onclick = () => { runSweep(); closePanelIfNarrow(); };
  $('btnBifClear').onclick = () => { stopBusy(); S.branches = []; S.sweep = []; S.specialCount = 0; renderBifList(); render(); };
  $('bfPar').onchange = () => {
    S.bif.par = Number($('bfPar').value);
    const r = S.parRange[S.bif.par];
    S.bif.pmin = r[0]; S.bif.pmax = r[1];
    const R = Math.abs(r[1] - r[0]) || 1;
    S.bif.ds = Number((R / 200).toPrecision(2)); S.bif.dsmax = Number((R / 50).toPrecision(2));
    buildBifInputs();
    fitBifDefault();
    fitView('bif', false);
    render(); saveStore();
  };
  $('bfY').onchange = () => { S.bif.y = $('bfY').value; fitView('bif', false); render(); saveStore(); };
  for (const id of ['bfMin', 'bfMax', 'bfDs', 'bfDsmax', 'bfNmax', 'bfDir']) $(id).addEventListener('change', readBifInputs);
  for (const id of ['swSteps', 'swTrans', 'swSample', 'swUpDown']) $(id).addEventListener('change', () => { readSweepInputs(); saveStore(); });
  // enter blurs inputs (closes keyboard)
  document.querySelectorAll('.panel input[inputmode]').forEach((el) => {
    if (el.closest('#parList') || el.closest('#icList')) return;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.dispatchEvent(new Event('change')); el.blur(); } });
  });
}
function applyFromEditor() {
  const text = $('odeText').value;
  if (applyModel(text)) {
    closePanelIfNarrow();
    if (document.activeElement && matchMedia('(pointer: coarse)').matches) document.activeElement.blur();
  }
}
function renderGallery() {
  const sel = $('gallerySelect');
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Load example / saved model …';
  sel.append(ph);
  const og = document.createElement('optgroup');
  og.label = 'Examples';
  EXAMPLES.forEach((ex, i) => { const o = document.createElement('option'); o.value = `b${i}`; o.textContent = ex.name; og.append(o); });
  sel.append(og);
  const mine = loadMyModels();
  if (mine.length) {
    const og2 = document.createElement('optgroup');
    og2.label = 'My models';
    mine.forEach((m, i) => { const o = document.createElement('option'); o.value = `u${i}`; o.textContent = m.name; og2.append(o); });
    sel.append(og2);
  }
  sel.value = '';
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.dataset.tab === t));
  $('panelBody').scrollTop = 0;
  saveStore();
}

// ---------------------------------------------------------------- panel drawer
const narrow = matchMedia('(max-width: 1023px)');
function isPanelOpen() { const p = $('panel'); return narrow.matches ? p.classList.contains('open') : !p.classList.contains('hidden-wide'); }
function openPanel() {
  const p = $('panel');
  if (narrow.matches) { p.classList.add('open'); $('scrim').hidden = false; } else { p.classList.remove('hidden-wide'); requestAnimationFrame(onResize); }
}
function closePanel() { $('panel').classList.remove('open'); $('scrim').hidden = true; }
function closePanelIfNarrow() { if (narrow.matches) closePanel(); }
function togglePanel() {
  const p = $('panel');
  if (narrow.matches) { if (p.classList.contains('open')) closePanel(); else openPanel(); } else { p.classList.toggle('hidden-wide'); requestAnimationFrame(onResize); }
}

// ---------------------------------------------------------------- menu
function wireMenu() {
  const menu = $('menuDlg');
  menu.addEventListener('click', (e) => {
    if (e.target === menu || e.target.closest('[data-close]')) { menu.close(); return; }
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    menu.close();
    const actions = {
      go: () => go(),
      last: lastIC,
      continue: continueOrbit,
      range: rangeDialog,
      keyboard: keyboardIC,
      erase,
      freeze: () => {
        let k = 0;
        for (const o of S.orbits) if (!o.frozen && o.kind !== 'manifold') { o.frozen = true; k++; }
        setStatus(`${k} orbit${k === 1 ? '' : 's'} frozen (kept when erasing and when parameters change).`);
        render();
      },
      unfreeze: () => { S.orbits = S.orbits.filter((o) => !o.frozen); render(); setStatus('Frozen orbits deleted.'); },
      data: openDataViewer,
      fit: () => fitView(),
      zoomOut: () => zoomBy(0.5),
      defaultWin: defaultWindow,
      savePng,
      csv: () => exportCsv(),
      saveOde,
      openOde: () => $('odeFile').click(),
      syntax: () => alertDialog('ODE file syntax', SYNTAX_HELP),
      howto: () => alertDialog('Using XPP lite', HOWTO_HELP),
      about: aboutDialog,
    };
    actions[b.dataset.action]?.();
  });
  dataDlg.addEventListener('click', (e) => { if (e.target === dataDlg || e.target.closest('[data-close]')) dataDlg.close(); });
  $('dataScroll').addEventListener('scroll', () => requestAnimationFrame(renderDataRows), { passive: true });
  $('dataCsv').onclick = () => exportCsv(dataOrbit);
}

// ---------------------------------------------------------------- init
function onResize() {
  resizeCanvases();
  nullCache = null;
  renderNow();
}

function init() {
  renderGallery();
  wirePanel();
  wireMenu();
  document.querySelectorAll('#viewSeg button').forEach((b) => { b.onclick = () => { setView(b.dataset.view); if (b.dataset.view === '3d' && !S.box3d) fitView('3d'); }; });
  document.querySelectorAll('#modeSeg button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('btnGo').onclick = () => go();
  $('btnFit').onclick = () => fitView();
  $('btnErase').onclick = erase;
  $('btnStop').onclick = stopBusy;
  $('btnMenu').onclick = () => $('menuDlg').showModal();
  $('btnPanel').onclick = togglePanel;
  $('btnPanelClose').onclick = closePanel;
  $('scrim').onclick = closePanel;
  narrow.addEventListener('change', () => { closePanel(); onResize(); });

  overCv.addEventListener('pointerdown', onPointerDown);
  overCv.addEventListener('pointermove', onPointerMove);
  overCv.addEventListener('pointerup', onPointerUp);
  overCv.addEventListener('pointercancel', onPointerUp);
  overCv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) { hover = null; timeCursor = null; $('coords').textContent = ''; renderOverlay(); }
  });
  overCv.addEventListener('wheel', onWheel, { passive: false });
  overCv.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => { if (e.target.closest('canvas')) e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.busy) { stopBusy(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'g') go();
    else if (k === 'e') erase();
    else if (k === 'f') fitView();
    else if (k === 'l') lastIC();
    else if (['1', '2', '3', '4'].includes(k)) setView(['phase', 'time', '3d', 'bif'][Number(k) - 1]);
  });

  new ResizeObserver(() => onResize()).observe(wrap);
  resizeCanvases();
  if (narrow.matches) closePanel();

  const saved = loadStore();
  let ok = false;
  if (saved && typeof saved.text === 'string') {
    $('odeText').value = saved.text;
    ok = applyModel(saved.text, saved);
    if (ok) {
      if (saved.mode) setMode(saved.mode);
      if (typeof saved.textDraft === 'string' && saved.textDraft !== saved.text) {
        $('odeText').value = saved.textDraft;
        showModelErrors(compileOde(saved.textDraft));
      }
      if (saved.sweepSet) { Object.assign(S.sweepSet, saved.sweepSet); buildBifInputs(); }
    }
  }
  if (!ok) {
    $('odeText').value = EXAMPLES[0].text;
    applyModel(EXAMPLES[0].text);
    setMode('ic');
  }
  setTab(saved && saved.tab ? saved.tab : 'model');
  if (!narrow.matches && saved && saved.panelHidden) $('panel').classList.add('hidden-wide');
  renderNow();
}

init();
