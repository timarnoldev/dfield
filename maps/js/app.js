// Iterated Maps Lab – main application.
import { compileMap1D, compileMap2D, evalConst, isValidName, ParseError } from './expr.js';
import * as M from './maps.js';
import {
  Frame, drawAxes, drawFrame, plotFunction, leftMargin, fmtNum, fmtParam, fmtTick, fontSpec, mathFont,
} from './plot.js';

const $ = (id) => document.getElementById(id);
const LS_KEY = 'mapslab.v1';
const ORBIT_COLORS = ['#1f5fd6', '#d62728', '#2a9d3a', '#9b3dd1', '#ef7d00', '#0fa3b8', '#8c564b', '#e04ca0', '#5a6270', '#a3a300'];
const K_COLORS = ['#111111', '#8e3fd0', '#119977', '#d4580a', '#c21f6a', '#3d7dd8', '#7a5c00', '#555555'];
const PERIOD_COLORS = ['#000000', '#d62728', '#1d9a3a', '#7b3fd0', '#e07000', '#0f9fb5', '#8c564b', '#d63c96'];
const VIEWS = ['cobweb', 'series', 'bif', 'hist', 'plane', 'map2d'];
const MAX_PARAMS = 4;

// ---------------------------------------------------------------- state
const g1 = (id) => M.GALLERY_1D.find((g) => g.id === id) || M.GALLERY_1D[0];
const g2 = (id) => M.GALLERY_2D.find((g) => g.id === id) || M.GALLERY_2D[0];
const toParams = (list) => list.map(([name, value, min, max]) => ({ name, value, min, max }));

function map1dDefaults(id) {
  const g = g1(id);
  return {
    map1d: { id: g.id, expr: g.expr, params: toParams(g.params) },
    cob: { win: [...g.win], orbits: [{ x0: g.x0, c: 0 }], active: 0 },
    seriesWin: null,
    bif: { param: g.bif.param, win: [g.bif.min, g.bif.max, g.bif.xmin, g.bif.xmax], strip: g.bif.strip || 'lyap' },
    histWin: [g.win[0], g.win[1]],
    plane: { type: g.plane.type, seq: g.plane.seq, p: g.plane.p, q: g.plane.q, win: [g.plane.xmin, g.plane.xmax, g.plane.ymin, g.plane.ymax] },
  };
}
function map2dDefaults(id) {
  const g = g2(id);
  return {
    id: g.id, ex: g.ex, ey: g.ey, params: toParams(g.params), win: [...g.win],
    seeds: g.randomSeeds ? randomSeeds(g.randomSeeds, g.win, 7) : g.seeds.map((s) => [...s]),
    n: g.n, transient: g.transient, tap: g.tap,
  };
}
function randomSeeds(n, win, seed = Date.now()) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out = [];
  for (let i = 0; i < n; i++) out.push([win[0] + (win[1] - win[0]) * rnd(), win[2] + (win[3] - win[2]) * rnd()]);
  return out;
}

function defaultState() {
  const d = map1dDefaults('logistic');
  return {
    view: 'cobweb',
    map1d: d.map1d,
    cob: { ...d.cob, n: 60, transient: 0, ks: [1], cobK: 1, perMax: 2, series: true, delay: 150 },
    series: { twin: true, delta: 1e-6 },
    seriesWin: null,
    bif: { ...d.bif, transient: 500, samples: 300, starts: 1, feig: true, follow: false },
    hist: { n: 200000, transient: 1000, bins: 200, win: d.histWin, exact: true, log: false },
    plane: { ...d.plane, transient: 150, n: 300, res: 1 },
    map2d: { ...map2dDefaults('henon'), ps: 1, fp: true, mono: false },
    ui: { cross: false, grid: false, font: 14, panelHidden: false },
  };
}

let S = defaultState();
const history = Object.fromEntries(VIEWS.map((v) => [v, []]));

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!s || typeof s !== 'object') return;
    const d = defaultState();
    for (const k of Object.keys(d)) {
      if (s[k] === undefined) continue;
      if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) S[k] = { ...d[k], ...s[k] };
      else S[k] = s[k];
    }
    if (!VIEWS.includes(S.view)) S.view = 'cobweb';
    if (!Array.isArray(S.cob.orbits) || !S.cob.orbits.length) S.cob.orbits = [{ x0: 0.2, c: 0 }];
  } catch { S = defaultState(); }
}
let saveTimer = 0;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* quota / private mode */ }
  }, 250);
}

// ---------------------------------------------------------------- compiled maps
let cm1 = null;  // { f, df, lift, P } for the 1D map (valid or last valid)
let cm2 = null;  // { F, J, P } for the 2D map
let ver1 = 0;    // increments whenever the 1D map (expression or any parameter) changes
let ver2 = 0;

function paramIndex1(name) { return S.map1d.params.findIndex((p) => p.name === name); }
function paramValues1() { return Object.fromEntries(S.map1d.params.map((p) => [p.name, p.value])); }

function compile1() {
  const names = S.map1d.params.map((p) => p.name.trim());
  try {
    cm1 = compileMap1D(S.map1d.expr, names, S.map1d.params.map((p) => p.value));
    cm1.src = { expr: S.map1d.expr, names };
    showError('err1d', '');
    ver1++;
    return true;
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    showError('err1d', e.message);
    return false;
  }
}
function compile2() {
  const names = S.map2d.params.map((p) => p.name.trim());
  try {
    cm2 = compileMap2D(S.map2d.ex, S.map2d.ey, names, S.map2d.params.map((p) => p.value));
    cm2.src = { ex: S.map2d.ex, ey: S.map2d.ey, names };
    showError('err2d', '');
    ver2++;
    return true;
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    showError('err2d', (e.which ? `${e.which}′: ` : '') + e.message);
    return false;
  }
}
// While the edited map has an error, cm1/cm2 keep the last valid map; parameters are
// matched by name (the parameter list may have changed since it was compiled).
function syncP(cm, params) {
  if (!cm) return;
  cm.src.names.forEach((n, i) => {
    const p = params.find((q) => q.name === n);
    if (p) cm.P[i] = p.value;
  });
}
function syncP1() { syncP(cm1, S.map1d.params); ver1++; }
function syncP2() { syncP(cm2, S.map2d.params); ver2++; }
/** Last valid 1D map with the current parameter values (input of background jobs). */
function src1() {
  if (!cm1) return null;
  const { expr, names } = cm1.src;
  return { expr, names, values: names.map((n, i) => cm1.P[i]) };
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
}

/** f composed k times. */
const fk = (k) => (x) => { for (let i = 0; i < k; i++) x = cm1.f(x); return x; };
function isPristine(id) {
  const g = g1(id);
  return S.map1d.id === id && S.map1d.expr.replace(/\s+/g, '') === g.expr.replace(/\s+/g, '');
}

// ---------------------------------------------------------------- parameter editors
/**
 * Build parameter rows (name, value, slider with min/max) into `box`.
 * kind: '1d' | '2d'
 */
function buildParamEditor(kind) {
  const box = $(kind === '1d' ? 'params1d' : 'params2d');
  const list = kind === '1d' ? S.map1d.params : S.map2d.params;
  box.innerHTML = '';
  list.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'param';
    row.innerHTML = `
      <div class="param-top">
        <input class="pname" maxlength="8" autocapitalize="off" aria-label="Parameter name">
        <span>=</span>
        <input class="pval" inputmode="decimal" autocapitalize="off" aria-label="Parameter value">
        <button type="button" class="icon-btn pdel" aria-label="Remove parameter">✕</button>
      </div>
      <div class="param-slider">
        <input class="prange pmin" inputmode="decimal" aria-label="Slider minimum">
        <input type="range" step="any" aria-label="Parameter slider">
        <input class="prange pmax" inputmode="decimal" aria-label="Slider maximum">
      </div>`;
    const [name, val] = row.querySelectorAll('.param-top input');
    const del = row.querySelector('.pdel');
    const slider = row.querySelector('input[type=range]');
    const mn = row.querySelector('.pmin');
    const mx = row.querySelector('.pmax');
    name.value = p.name;
    val.value = fmtParam(p.value, p.max - p.min);
    mn.value = String(p.min);
    mx.value = String(p.max);
    const syncSlider = () => {
      slider.min = String(p.min);
      slider.max = String(p.max);
      slider.value = String(p.value);
    };
    syncSlider();
    p._sync = () => { val.value = fmtParam(p.value, p.max - p.min); syncSlider(); val.classList.remove('bad'); };
    slider.addEventListener('input', () => {
      p.value = Number(fmtParam(Number(slider.value), p.max - p.min));
      val.value = fmtParam(p.value, p.max - p.min);
      val.classList.remove('bad');
      onParamValue(kind, i, true);
    });
    slider.addEventListener('change', () => onParamValue(kind, i, false));
    const applyVal = (final) => {
      const txt = val.value.trim();
      let v;
      try { v = evalConst(txt); } catch { val.classList.add('bad'); return; }
      val.classList.remove('bad');
      p.value = v;
      if (final) {
        if (v < p.min) { p.min = v; mn.value = String(v); }
        if (v > p.max) { p.max = v; mx.value = String(v); }
      }
      syncSlider();
      onParamValue(kind, i, !final);
    };
    val.addEventListener('input', () => applyVal(false));
    val.addEventListener('change', () => applyVal(true));
    val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyVal(true); val.blur(); } });
    const applyRange = () => {
      let a, b;
      try { a = evalConst(mn.value); b = evalConst(mx.value); } catch { mn.classList.add('bad'); mx.classList.add('bad'); return; }
      if (!(b > a)) { mn.classList.add('bad'); mx.classList.add('bad'); return; }
      mn.classList.remove('bad'); mx.classList.remove('bad');
      p.min = a; p.max = b;
      syncSlider();
      saveStore();
    };
    mn.addEventListener('change', applyRange);
    mx.addEventListener('change', applyRange);
    name.addEventListener('input', () => {
      const old = p.name;
      p.name = name.value.trim();
      const ok = isValidName(p.name) && list.filter((q) => q.name === p.name).length === 1;
      name.classList.toggle('bad', !ok);
      onParamRename(kind, old, p.name);
    });
    del.addEventListener('click', () => {
      list.splice(i, 1);
      buildParamEditor(kind);
      onMapStructure(kind);
    });
    box.append(row);
  });
  $(kind === '1d' ? 'btnAddParam1d' : 'btnAddParam2d').disabled = list.length >= MAX_PARAMS;
}

function addParam(kind) {
  const list = kind === '1d' ? S.map1d.params : S.map2d.params;
  if (list.length >= MAX_PARAMS) return;
  const used = new Set(list.map((p) => p.name));
  const name = ['a', 'b', 'c', 'd', 'k', 'm', 'r', 's'].find((n) => !used.has(n)) || `p${list.length + 1}`;
  list.push({ name, value: 1, min: 0, max: 2 });
  buildParamEditor(kind);
  onMapStructure(kind);
}

function onParamValue(kind, i, live) {
  if (kind === '1d') {
    syncP1();
    if (!live) saveStore();
    mapChanged1(i);
  } else {
    syncP2();
    if (!live) saveStore();
    invalidate2D();
  }
  updateTitle();
  scheduleRender();
}

function onParamRename(kind, oldName, newName) {
  if (kind === '1d') {
    if (S.bif.param === oldName) S.bif.param = newName;
    if (S.plane.p === oldName) S.plane.p = newName;
    if (S.plane.q === oldName) S.plane.q = newName;
  }
  onMapStructure(kind);
}

/** Expression or parameter names changed. */
function onMapStructure(kind) {
  if (kind === '1d') {
    if (compile1()) {
      fillParamSelects();
      mapChanged1(-1);
    }
  } else if (compile2()) {
    invalidate2D();
  }
  saveStore();
  updateTitle();
  scheduleRender();  defaultStatusSoon();
}

function fillParamSelects() {
  const names = S.map1d.params.map((p) => p.name);
  for (const [id, key, obj] of [['bifParam', 'param', S.bif], ['plP', 'p', S.plane], ['plQ', 'q', S.plane]]) {
    const sel = $(id);
    sel.innerHTML = '';
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.append(o);
    }
    if (!names.includes(obj[key])) obj[key] = names[id === 'plQ' && names.length > 1 ? 1 : 0] || '';
    sel.value = obj[key];
  }
  updateBifLabels();
}
function updateBifLabels() {
  $('lblRmin').textContent = `${S.bif.param || 'r'} min`;
  $('lblRmax').textContent = `${S.bif.param || 'r'} max`;
  const markus = S.plane.type === 'markus';
  const A = markus ? 'A' : (S.plane.p || 'p');
  const B = markus ? 'B' : (S.plane.q || 'q');
  $('lblPlXmin').textContent = `${A} min`;
  $('lblPlXmax').textContent = `${A} max`;
  $('lblPlYmin').textContent = `${B} min`;
  $('lblPlYmax').textContent = `${B} max`;
  $('lblPlP').textContent = markus ? 'Parameter' : 'Horizontal';
  document.querySelectorAll('.pl-markus').forEach((e) => { e.hidden = !markus; });
  document.querySelectorAll('.pl-two').forEach((e) => { e.hidden = markus; });
  const hints = {
    markus: 'Markus–Lyapunov fractal: the parameter alternates between A (horizontal) and B (vertical) following the sequence. Gold: λ < 0 (stable), blue/black: λ > 0 (chaos).',
    lyap2: 'Lyapunov exponent over two parameters. Gold: λ < 0, blue: λ > 0. Tap to set both parameters.',
    rot: 'Mode-locked regions (Arnold tongues) colored by p/q; white: quasiperiodic or chaotic. Requires a map of the form mod(…, 1). Tap to set both parameters.',
  };
  $('plHint').textContent = hints[S.plane.type] || '';
}

// ---------------------------------------------------------------- canvas
const wrap = $('plotWrap');
const baseCv = $('baseCanvas');
const overCv = $('overlayCanvas');
const bctx = baseCv.getContext('2d');
const octx = overCv.getContext('2d');
let W = 0, H = 0, DPR = 1;
let frames = [];
const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const sup = (k) => String(k).split('').map((d) => SUP[d]).join('');
const fsz = () => S.ui.font;
const clampPx = (v) => Math.max(-1e5, Math.min(1e5, v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

const frameById = (id) => frames.find((f) => f.id === id);

// ---------------------------------------------------------------- layouts
function margins() {
  const f = fsz();
  return { top: Math.round(f * 0.9), right: 18, bottom: Math.round(f * 2.7 + 8) };
}

function layout() {
  const f = fsz();
  const m = margins();
  const ctx = bctx;
  const v = S.view;
  const out = [];
  if (v === 'cobweb') {
    const win = S.cob.win;
    const lm = leftMargin(ctx, win[2], win[3], H, f);
    if (!S.cob.series) {
      const w = W - lm - m.right, h = H - m.top - m.bottom;
      out.push(new Frame('cob', lm, m.top, Math.max(40, w), Math.max(40, h), win, { zoom: 'xy' }));
    } else if (W > H * 1.2) {
      const side = Math.max(60, Math.min(H - m.top - m.bottom, (W - lm - m.right) * 0.56));
      out.push(new Frame('cob', lm, m.top, side, side, win, { zoom: 'xy' }));
      const sw = seriesWin();
      const lm2 = leftMargin(ctx, sw[2], sw[3], side, f);
      const x2 = lm + side + lm2 + 4;
      out.push(new Frame('ser', x2, m.top, Math.max(40, W - x2 - m.right), side, sw, { zoom: 'xy' }));
    } else {
      const avail = H - m.top - 2 * m.bottom;
      const side = Math.max(60, Math.min(W - lm - m.right, avail * 0.66));
      const sw = seriesWin();
      const lm2 = Math.max(lm, leftMargin(ctx, sw[2], sw[3], avail - side, f));
      out.push(new Frame('cob', lm2 + (W - lm2 - m.right - side) / 2, m.top, side, side, win, { zoom: 'xy' }));
      const y2 = m.top + side + m.bottom;
      out.push(new Frame('ser', lm2, y2, Math.max(40, W - lm2 - m.right), Math.max(40, H - y2 - m.bottom), sw, { zoom: 'xy' }));
    }
  } else if (v === 'series') {
    const sw = seriesWin();
    const twin = S.series.twin;
    const hTot = H - m.top - m.bottom * (twin ? 2 : 1);
    const h1 = twin ? Math.round(hTot * 0.6) : hTot;
    const dw = diffWin(sw);
    const lm = Math.max(leftMargin(ctx, sw[2], sw[3], h1, f), twin ? leftMargin(ctx, dw[2], dw[3], hTot - h1, f) : 0);
    out.push(new Frame('ser', lm, m.top, W - lm - m.right, Math.max(40, h1), sw, { zoom: 'xy' }));
    if (twin) {
      const y2 = m.top + h1 + m.bottom;
      out.push(new Frame('diff', lm, y2, W - lm - m.right, Math.max(30, H - y2 - m.bottom), dw, { zoom: 'x' }));
    }
  } else if (v === 'bif') {
    const strip = S.bif.strip !== 'none' && !(S.bif.strip === 'rot' && !(cm1 && cm1.lift));
    const hTot = H - m.top - m.bottom;
    const h2 = strip ? Math.round(hTot * 0.27) : 0;
    const h1 = hTot - h2 - (strip ? 6 : 0);
    const bw = S.bif.win;
    const sw = stripWin();
    // fixed strip margin: must not depend on data (column count would change while computing)
    ctx.font = fontSpec(f);
    const lmStrip = Math.ceil(ctx.measureText('-0.25').width + f * 1.6 + 10);
    const lm = Math.max(leftMargin(ctx, bw[2], bw[3], h1, f), strip ? lmStrip : 0);
    out.push(new Frame('bif', lm, m.top, W - lm - m.right, Math.max(40, h1), bw, { zoom: 'xy' }));
    if (strip) out.push(new Frame('strip', lm, m.top + h1 + 6, W - lm - m.right, Math.max(30, h2), sw, { zoom: 'x' }));
  } else if (v === 'hist') {
    const hw = histWin();
    const lm = leftMargin(ctx, hw[2], hw[3], H, f, histYfmt);
    out.push(new Frame('hist', lm, m.top, W - lm - m.right, H - m.top - m.bottom, hw, { zoom: 'x' }));
  } else if (v === 'plane') {
    const pw = S.plane.win;
    const lm = leftMargin(ctx, pw[2], pw[3], H, f);
    out.push(new Frame('plane', lm, m.top, W - lm - m.right, H - m.top - m.bottom, pw, { zoom: 'xy' }));
  } else if (v === 'map2d') {
    const mw = S.map2d.win;
    const lm = leftMargin(ctx, mw[2], mw[3], H, f);
    out.push(new Frame('map2d', lm, m.top, W - lm - m.right, H - m.top - m.bottom, mw, { zoom: 'xy' }));
  }
  // y-axis label position: left edge of the margin area of each frame
  for (const fr of out) {
    const left = out.filter((o) => o !== fr && o.x + o.w <= fr.x && o.y < fr.y + fr.h && o.y + o.h > fr.y);
    fr.lx = (left.length ? Math.max(...left.map((o) => o.x + o.w)) + 6 : 0) + 4;
  }
  frames = out;
}

// ---------------------------------------------------------------- orbit helpers
function activeOrbit() {
  const o = S.cob.orbits;
  if (!o.length) return null;
  S.cob.active = clamp(S.cob.active, 0, o.length - 1);
  return o[S.cob.active];
}
function cobMap() { return S.cob.cobK === 1 ? cm1.f : fk(S.cob.cobK); }
const orbitColor = (o) => ORBIT_COLORS[o.c % ORBIT_COLORS.length];
function seriesWin() {
  if (S.seriesWin) return S.seriesWin;
  const T = S.cob.transient;
  return [T, T + S.cob.n, S.cob.win[2], S.cob.win[3]];
}
function diffWin(sw) {
  const span = Math.max(1e-300, S.cob.win[3] - S.cob.win[2]);
  return [sw[0], sw[1], -16.5, Math.ceil(Math.log10(span)) + 0.5];
}
function twinX0(o) { return o.x0 + S.series.delta; }

// cached Lyapunov estimate of the active orbit (for status & series slope)
let lyapCache = { key: '', v: NaN };
function activeLyapunov() {
  const o = activeOrbit();
  if (!o || !cm1) return NaN;
  const key = `${ver1}|${o.x0}`;
  if (lyapCache.key !== key) lyapCache = { key, v: M.lyapunov1D(cm1.f, cm1.df, o.x0, 1000, 20000) };
  return lyapCache.v;
}

// ---------------------------------------------------------------- periodic points
let perCache = { key: '', pts: [] };
function periodicPts() {
  if (!cm1 || !S.cob.perMax) return [];
  const w = S.cob.win;
  const key = `${ver1}|${w[0]}|${w[1]}|${S.cob.perMax}`;
  if (perCache.key !== key) {
    const pts = [];
    for (let k = 1; k <= S.cob.perMax; k++) {
      try { pts.push(...M.periodicPoints(cm1.f, cm1.df, k, w[0], w[1])); } catch { /* ignore */ }
    }
    perCache = { key, pts };
    renderPerList(pts);
  }
  return perCache.pts;
}
function renderPerList(pts) {
  const box = $('perList');
  if (!S.cob.perMax) { box.innerHTML = ''; return; }
  const cycles = new Map();
  for (const p of pts) {
    const key = `${p.period}:${p.cycle}`;
    if (!cycles.has(key)) cycles.set(key, p);
  }
  const rows = [...cycles.values()].slice(0, 60).map((p) => {
    const xs = p.orbit.slice().sort((a, b) => a - b).map((v) => fmtNum(v, 5)).join(', ');
    const col = PERIOD_COLORS[(p.period - 1) % PERIOD_COLORS.length];
    return `<tr><td style="color:${col}"><span class="dot${p.stable ? ' fill' : ''}"></span> ${p.period}</td><td>${xs}</td><td>${fmtNum(p.mult, 4)}</td><td>${p.stability}</td></tr>`;
  });
  box.innerHTML = rows.length
    ? `<table><tr><th>per.</th><th>points</th><th>(fᵏ)′</th><th></th></tr>${rows.join('')}</table>${cycles.size > 60 ? `<p class="hint">… ${cycles.size - 60} more cycles</p>` : ''}`
    : '<p class="hint">No periodic points of these periods in the x window.</p>';
}

// ---------------------------------------------------------------- animation
const anim = { step: null, timer: 0, playing: false };
function stepLimit(n) { return anim.step === null ? n : Math.min(anim.step, n); }

// ---------------------------------------------------------------- drawing: cobweb
function axOpts(extra) { return { fs: fsz(), grid: S.ui.grid, ...extra }; }

let cobLayer = { key: '', cv: null };
function cobCurves(fr, ks) {
  const pw = Math.max(1, Math.round(fr.w * DPR)), ph = Math.max(1, Math.round(fr.h * DPR));
  const key = JSON.stringify([ver1, ks, fr.win, pw, ph]);
  if (cobLayer.key === key) return cobLayer.cv;
  let cv = cobLayer.cv;
  if (!cv || cv.width !== pw || cv.height !== ph) cv = makeCanvas(pw, ph);
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, pw, ph);
  c.setTransform(pw / fr.w, 0, 0, ph / fr.h, -fr.x * pw / fr.w, -fr.y * ph / fr.h);
  for (const k of ks) {
    c.strokeStyle = K_COLORS[(k - 1) % K_COLORS.length];
    c.lineWidth = k === 1 ? 2.2 : 1.5;
    plotFunction(c, fr, k === 1 ? cm1.f : fk(k), k > 3 ? 3 : k > 1 ? 2 : 1);
  }
  cobLayer = { key, cv };
  return cv;
}

function drawCobweb(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  if (!cm1) { drawFrame(ctx, fr, axOpts({ xlabel: 'xₙ', ylabel: 'xₙ₊₁' })); return; }
  const [x0, x1, y0, y1] = fr.win;
  ctx.save();
  fr.clip(ctx);
  // diagonal
  ctx.strokeStyle = '#9aa0a8';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  const a = Math.min(x0, y0) - 1, b = Math.max(x1, y1) + 1;
  ctx.moveTo(fr.px(a), fr.py(a));
  ctx.lineTo(fr.px(b), fr.py(b));
  ctx.stroke();
  ctx.setLineDash([]);
  // graphs of f^k (cached layer: dragging x0 or animating does not change them)
  const ks = [...S.cob.ks].sort((p, q) => q - p);
  ctx.drawImage(cobCurves(fr, ks), fr.x, fr.y, fr.w, fr.h);
  // orbits
  const F = cobMap();
  const T = S.cob.transient;
  const n = S.cob.n;
  S.cob.orbits.forEach((o, idx) => {
    const xs = M.orbit1D(F, o.x0, n, T);
    const steps = stepLimit(n);
    const col = orbitColor(o);
    const act = idx === S.cob.active;
    ctx.strokeStyle = col;
    ctx.globalAlpha = n > 300 && anim.step === null ? 0.55 : 0.95;
    ctx.lineWidth = act ? 1.8 : 1.3;
    if (T === 0 && Number.isFinite(xs[0])) {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(fr.px(xs[0]), fr.py(y0) + 2);
      ctx.lineTo(fr.px(xs[0]), clampPx(fr.py(xs[0])));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(clampPx(fr.px(xs[0])), clampPx(fr.py(xs[0])));
    for (let i = 0; i < steps; i++) {
      if (!Number.isFinite(xs[i + 1])) break;
      ctx.lineTo(clampPx(fr.px(xs[i])), clampPx(fr.py(xs[i + 1])));
      ctx.lineTo(clampPx(fr.px(xs[i + 1])), clampPx(fr.py(xs[i + 1])));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (anim.step !== null && Number.isFinite(xs[steps])) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(fr.px(xs[steps]), fr.py(xs[steps]), 4.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
  // periodic points on the diagonal
  // batched by period & stability (hundreds of points for high periods)
  const groups = new Map();
  for (const p of periodicPts()) {
    const X = fr.px(p.x), Y = fr.py(p.x);
    if (X < fr.x - 6 || X > fr.x + fr.w + 6 || Y < fr.y - 6 || Y > fr.y + fr.h + 6) continue;
    const gk = `${p.period}|${p.stable ? 1 : 0}`;
    if (!groups.has(gk)) groups.set(gk, { p, path: new Path2D() });
    const path = groups.get(gk).path;
    path.moveTo(X + 5, Y);
    path.arc(X, Y, 5, 0, 2 * Math.PI);
  }
  ctx.lineWidth = 2;
  for (const { p, path } of [...groups.values()].sort((a, b) => b.p.period - a.p.period)) {
    const col = PERIOD_COLORS[(p.period - 1) % PERIOD_COLORS.length];
    ctx.fillStyle = p.stable ? col : '#fff';
    ctx.strokeStyle = col;
    ctx.fill(path);
    ctx.stroke(path);
  }
  // x0 handles
  S.cob.orbits.forEach((o, idx) => {
    if (!Number.isFinite(o.x0)) return;
    const X = fr.px(o.x0);
    const Y = fr.y + fr.h;
    const s = idx === S.cob.active ? 9 : 6;
    ctx.fillStyle = orbitColor(o);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(X, Y - s * 1.6);
    ctx.lineTo(X - s, Y);
    ctx.lineTo(X + s, Y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
  drawFrame(ctx, fr, axOpts({ xlabel: 'xₙ', ylabel: 'xₙ₊₁' }));
  // legend
  const items = ks.slice().reverse().map((k) => ({ col: K_COLORS[(k - 1) % K_COLORS.length], txt: k === 1 ? 'f(x)' : `f${sup(k)}(x)` }));
  if (S.cob.cobK > 1) items.push({ col: '#555', txt: `cobweb of f${sup(S.cob.cobK)}` });
  drawLegend(ctx, fr, items);
}

function drawLegend(ctx, fr, items, corner = 'tl') {
  if (!items.length) return;
  const f = fsz() - 1;
  ctx.save();
  ctx.font = mathFont(f);
  const w = Math.max(...items.map((i) => ctx.measureText(i.txt).width)) + 34;
  const h = items.length * (f + 6) + 6;
  const x = corner === 'tl' ? fr.x + 8 : fr.x + fr.w - w - 8;
  const y = fr.y + 8;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.strokeStyle = 'rgba(0,0,0,.15)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  items.forEach((it, i) => {
    const yy = y + 6 + i * (f + 6) + f / 2;
    ctx.strokeStyle = it.col;
    ctx.fillStyle = it.col;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(it.dash || []);
    ctx.beginPath();
    ctx.moveTo(x + 6, yy);
    ctx.lineTo(x + 24, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.txt, x + 30, yy);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- drawing: time series
function drawSeries(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  if (!cm1) { drawFrame(ctx, fr, axOpts({ xlabel: 'n', ylabel: 'xₙ' })); return; }
  const T = S.cob.transient;
  const n = S.cob.n;
  const steps = stepLimit(n);
  ctx.save();
  fr.clip(ctx);
  const dense = (fr.win[1] - fr.win[0]) > fr.w / 5;
  const plotOne = (xs, col, dash, act) => {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = act ? 1.6 : 1.2;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= steps; i++) {
      if (!Number.isFinite(xs[i])) { pen = false; continue; }
      const X = fr.px(T + i), Y = clampPx(fr.py(xs[i]));
      if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (!dense) {
      for (let i = 0; i <= steps; i++) {
        if (!Number.isFinite(xs[i])) continue;
        ctx.beginPath();
        ctx.arc(fr.px(T + i), fr.py(xs[i]), dash ? 2 : 2.8, 0, 2 * Math.PI);
        if (dash) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); } else ctx.fill();
      }
    }
  };
  S.cob.orbits.forEach((o, idx) => {
    if (idx !== S.cob.active) plotOne(M.orbit1D(cm1.f, o.x0, n, T), orbitColor(o), null, false);
  });
  const ao = activeOrbit();
  if (ao) {
    if (S.series.twin && fr.id === 'ser' && S.view === 'series') plotOne(M.orbit1D(cm1.f, twinX0(ao), n, T), '#ef7d00', [5, 4], false);
    plotOne(M.orbit1D(cm1.f, ao.x0, n, T), orbitColor(ao), null, true);
  }
  ctx.restore();
  drawFrame(ctx, fr, axOpts({ xlabel: 'n', ylabel: 'xₙ', xlabels: true }));
  if (S.view === 'series' && S.series.twin && ao) {
    drawLegend(ctx, fr, [
      { col: orbitColor(ao), txt: `x₀ = ${fmtNum(ao.x0, 8)}` },
      { col: '#ef7d00', txt: `x₀ + δ, δ = ${fmtNum(S.series.delta, 3)}`, dash: [5, 4] },
    ], 'tr');
  }
}

function drawDiff(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  const ao = activeOrbit();
  const T = S.cob.transient;
  const n = S.cob.n;
  let info = '';
  if (cm1 && ao) {
    const a = M.orbit1D(cm1.f, ao.x0, n, T);
    const b = M.orbit1D(cm1.f, twinX0(ao), n, T);
    const steps = stepLimit(n);
    ctx.save();
    fr.clip(ctx);
    // reference slope lambda / ln 10
    const lam = activeLyapunov();
    if (Number.isFinite(lam) && T === 0) {
      ctx.strokeStyle = '#888';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const l0 = Math.log10(S.series.delta);
      ctx.moveTo(fr.px(0), fr.py(l0));
      ctx.lineTo(fr.px(fr.win[1]), fr.py(l0 + lam * fr.win[1] / Math.LN10));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = orbitColor(ao);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let pen = false;
    let sep = -1;
    for (let i = 0; i <= steps; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (!Number.isFinite(d)) { pen = false; continue; }
      const L = d > 0 ? Math.log10(d) : -17;
      if (sep < 0 && d > 0.1 * (S.cob.win[3] - S.cob.win[2])) sep = i;
      const X = fr.px(T + i), Y = clampPx(fr.py(L));
      if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      pen = true;
    }
    ctx.stroke();
    ctx.restore();
    info = `λ ≈ ${fmtNum(lam, 4)} (dashed: slope λ/ln 10)` + (sep >= 0 ? `, orbits separated after n ≈ ${T + sep}` : '');
    $('twinInfo').textContent = `Lyapunov exponent λ ≈ ${fmtNum(lam, 4)}. ${sep >= 0 ? `The two orbits differ by more than 10% of the window after ${T + sep} iterations.` : 'The two orbits stay close.'}`;
  }
  drawFrame(ctx, fr, axOpts({ xlabel: 'n', ylabel: 'log₁₀|Δxₙ|' }));
  if (info) {
    ctx.save();
    ctx.font = fontSpec(fsz() - 2);
    ctx.fillStyle = '#333';
    ctx.textBaseline = 'top';
    ctx.fillText(info, fr.x + 8, fr.y + 6);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- progressive jobs
const jobs = { bif: null, plane: null, map2d: null };
let jobRaf = 0;
function ensureJobLoop() { if (!jobRaf) jobRaf = requestAnimationFrame(jobLoop); }
function currentJob() {
  return S.view === 'bif' ? jobs.bif : S.view === 'plane' ? jobs.plane : S.view === 'map2d' ? jobs.map2d : null;
}
let lastFlush = 0;
function jobLoop() {
  jobRaf = 0;
  const j = currentJob();
  if (!j) { showProgress(null); return; }
  const now = performance.now();
  if (!j.done) {
    try { j.step(now + 10); } catch (e) { j.done = true; j.error = `Computation failed: ${e.message}`; }
  }
  // uploading the (large) image and redrawing every frame is expensive on tablets:
  // throttle intermediate updates, but always show the final picture
  if (j.done || now - lastFlush > 90) {
    if (j.flush()) renderBase();
    lastFlush = performance.now();
  }
  if (j.done) {
    showProgress(null);
    if (j.error) setStatus(j.error, true); else defaultStatus();
    return;
  }
  showProgress(j.progress());
  ensureJobLoop();
}
function showProgress(p) {
  const el = $('progress');
  if (p === null) { el.hidden = true; return; }
  el.hidden = false;
  el.firstElementChild.style.width = `${Math.round(p * 100)}%`;
}
function stopJobs() {
  for (const k of Object.keys(jobs)) if (jobs[k]) jobs[k].done = true;
  showProgress(null);
}

function rgbaPut(data, idx, r, g, b, a) { data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a; }
function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

/** Progressive bifurcation diagram (density shaded) + Lyapunov / rotation strip. */
function makeBifJob(fr) {
  const b = S.bif;
  const src = src1();
  if (!src) return null;
  const k = src.names.indexOf(b.param);
  if (k < 0) return null;
  const cols = clamp(Math.round(fr.w * DPR), 50, 2400);
  const rows = clamp(Math.round(fr.h * DPR), 30, 2400);
  const ao = activeOrbit();
  const x0 = ao ? ao.x0 : 0.5;
  const key = JSON.stringify([src.expr, src.names.map((n, i) => (i === k ? n : [n, src.values[i]])), b.win, b.transient, b.samples, b.starts, b.follow, cols, rows, x0]);
  if (jobs.bif && jobs.bif.key === key) return jobs.bif;
  let cm;
  try { cm = compileMap1D(src.expr, src.names, src.values); } catch { return null; }
  const [r0, r1, xmin, xmax] = b.win;
  const T = b.transient, NS = b.samples, M0 = b.starts;
  const img = new ImageData(cols, rows);
  const data = img.data;
  const cv = makeCanvas(cols, rows);
  const cctx = cv.getContext('2d');
  const lyap = new Float64Array(cols).fill(NaN);
  const rot = new Float64Array(cols).fill(NaN);
  const done = new Uint8Array(cols);
  const cnt = new Uint32Array(rows);
  const order = [];
  if (b.follow) {
    for (let c = 0; c < cols; c++) order.push(c, 1);
  } else {
    for (const s of [32, 16, 8, 4, 2, 1]) {
      for (let c = 0; c < cols; c += s) if (s === 32 || c % (2 * s) !== 0) order.push(c, s);
    }
  }
  const total = order.length / 2;
  const g = rows / (NS * M0 * 2.5);
  const P = cm.P;
  const f = cm.f, df = cm.df, lift = cm.lift;
  let pos = 0;
  let xFollow = x0;
  let dirty = false;
  const job = {
    key, cols, rows, cv, lyap, rot, done: false, k, x0,
    progress: () => pos / total,
    step(deadline) {
      while (pos < total) {
        const c = order[2 * pos], span = order[2 * pos + 1];
        const r = r0 + (c + 0.5) * (r1 - r0) / cols;
        P[k] = r;
        cnt.fill(0);
        const sy = rows / (xmax - xmin);
        for (let m = 0; m < M0; m++) {
          let x = m === 0 ? (b.follow ? xFollow : x0) : xmin + (xmax - xmin) * (m + 0.5) / M0;
          let ok = true;
          for (let i = 0; i < T; i++) {
            x = f(x);
            if (!(x > -1e100 && x < 1e100)) { ok = false; break; }
          }
          if (!ok) continue;
          let ls = 0;
          let prod = 1;
          for (let i = 0; i < NS; i++) {
            if (m === 0) {
              const d = Math.abs(df(x));
              if (d > 1e-300) prod *= d; else ls -= 690;
              if (prod > 1e100 || prod < 1e-100) { ls += Math.log(prod); prod = 1; }
            }
            x = f(x);
            if (!(x > -1e100 && x < 1e100)) { ok = false; break; }
            const row = Math.floor((xmax - x) * sy);
            if (row >= 0 && row < rows) cnt[row]++;
          }
          if (m === 0 && ok) {
            lyap[c] = (ls + Math.log(prod)) / NS;
            if (b.follow) xFollow = x;
          }
        }
        if (lift) rot[c] = M.rotationNumber(lift, x0, T, Math.max(NS, 200));
        // paint column c (and placeholder columns up to the next computed one)
        const cEnd = Math.min(cols, c + span);
        for (let row = 0; row < rows; row++) {
          const v = cnt[row];
          const a = v ? Math.max(0.22, 1 - Math.exp(-v * g)) * 255 : 0;
          for (let cc = c; cc < cEnd; cc++) {
            if (cc !== c && done[cc]) break;
            rgbaPut(data, (row * cols + cc) * 4, 18, 28, 70, a);
          }
        }
        for (let cc = c + 1; cc < cEnd && !done[cc]; cc++) { lyap[cc] = lyap[c]; rot[cc] = rot[c]; }
        done[c] = 1;
        pos++;
        dirty = true;
        if (performance.now() > deadline) break;
      }
      if (pos >= total) job.done = true;
    },
    flush() {
      if (!dirty) return false;
      cctx.putImageData(img, 0, 0);
      dirty = false;
      return true;
    },
  };
  jobs.bif = job;
  ensureJobLoop();
  return job;
}

function stripMode() { return S.bif.strip === 'rot' && cm1 && cm1.lift ? 'rot' : 'lyap'; }
function stripWin() {
  const r = S.bif.win;
  const j = jobs.bif;
  if (stripMode() === 'rot') {
    let lo = Infinity, hi = -Infinity;
    if (j) for (const v of j.rot) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!(hi > lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 0.05;
    return [r[0], r[1], lo - pad, hi + pad];
  }
  let lo = -1, hi = 0.8;
  if (j) {
    const vals = Array.from(j.lyap).filter(Number.isFinite).sort((a, b) => a - b);
    if (vals.length) {
      lo = Math.min(-0.5, Math.max(-4, vals[Math.floor(vals.length * 0.02)]));
      hi = Math.max(0.5, vals[vals.length - 1]);
    }
  }
  const pad = (hi - lo) * 0.06;
  return [r[0], r[1], lo - pad, hi + pad];
}

function feigLines() {
  if (!S.bif.feig || !isPristine('logistic') || S.bif.param !== 'r') return [];
  return M.LOGISTIC_FEIGENBAUM;
}

function drawBif(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  const job = makeBifJob(fr);
  const pname = S.bif.param;
  if (job) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(job.cv, fr.x, fr.y, fr.w, fr.h);
    ctx.restore();
  }
  ctx.save();
  fr.clip(ctx);
  drawFeig(ctx, fr, true);
  drawParamMarker(ctx, fr);
  ctx.restore();
  drawFrame(ctx, fr, axOpts({ xlabel: pname, ylabel: 'x', xlabels: !frameById('strip') }));
}

function drawFeig(ctx, fr, labels) {
  const lines = feigLines();
  if (!lines.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(214,39,40,.55)';
  ctx.fillStyle = '#b01e1e';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.font = fontSpec(fsz() - 3);
  ctx.textBaseline = 'top';
  const rowRight = [-Infinity, -Infinity, -Infinity];
  const lh = fsz() - 1;
  for (const l of lines) {
    const X = fr.px(l.r);
    if (X < fr.x || X > fr.x + fr.w) continue;
    ctx.beginPath();
    ctx.moveTo(X + 0.5, fr.y);
    ctx.lineTo(X + 0.5, fr.y + fr.h);
    ctx.stroke();
    if (!labels) continue;
    const w = ctx.measureText(l.label).width;
    const tx = Math.min(X + 3, fr.x + fr.w - w - 3);
    const row = rowRight.findIndex((r) => tx > r + 4);
    if (row < 0) continue;
    rowRight[row] = tx + w;
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillRect(tx - 1, fr.y + 3 + row * lh, w + 2, lh);
    ctx.fillStyle = '#b01e1e';
    ctx.fillText(l.label, tx, fr.y + 4 + row * lh);
  }
  ctx.restore();
}

function drawParamMarker(ctx, fr) {
  const k = paramIndex1(S.bif.param);
  if (k < 0) return;
  const v = S.map1d.params[k].value;
  const X = fr.px(v);
  if (X < fr.x - 1 || X > fr.x + fr.w + 1) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(31,95,214,.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(X, fr.y);
  ctx.lineTo(X, fr.y + fr.h);
  ctx.stroke();
  if (fr.id === 'bif') {
    const txt = `${S.bif.param} = ${fmtParam(v, fr.win[1] - fr.win[0])}`;
    ctx.font = mathFont(fsz());
    const w = ctx.measureText(txt).width + 10;
    const x = X + w + 6 > fr.x + fr.w ? X - w - 4 : X + 4;
    ctx.fillStyle = 'rgba(31,95,214,.92)';
    ctx.fillRect(x, fr.y + fr.h - fsz() - 12, w, fsz() + 8);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + 5, fr.y + fr.h - fsz() / 2 - 8);
  }
  ctx.restore();
}

function drawStrip(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  const job = jobs.bif;
  const mode = stripMode();
  ctx.save();
  fr.clip(ctx);
  if (mode === 'lyap') {
    const Y0 = fr.py(0);
    ctx.fillStyle = 'rgba(214,39,40,.13)';
    ctx.fillRect(fr.x, fr.y, fr.w, Math.max(0, Y0 - fr.y));
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fr.x, Math.round(Y0) + 0.5);
    ctx.lineTo(fr.x + fr.w, Math.round(Y0) + 0.5);
    ctx.stroke();
  }
  if (job) {
    const arr = mode === 'rot' ? job.rot : job.lyap;
    ctx.strokeStyle = mode === 'rot' ? '#7b3fd0' : '#1f5fd6';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let pen = false;
    for (let c = 0; c < job.cols; c++) {
      const v = arr[c];
      if (!Number.isFinite(v)) { pen = false; continue; }
      const X = fr.x + (c + 0.5) * fr.w / job.cols;
      const Y = clampPx(fr.py(Math.max(fr.win[2] - 1, v)));
      if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      pen = true;
    }
    ctx.stroke();
  }
  drawFeig(ctx, fr, false);
  drawParamMarker(ctx, fr);
  ctx.restore();
  drawFrame(ctx, fr, axOpts({ xlabel: S.bif.param, ylabel: mode === 'rot' ? 'ρ' : 'λ' }));
}

// ---------------------------------------------------------------- drawing: histogram
let histCache = { key: '', res: null };
function histData() {
  const ao = activeOrbit();
  if (!cm1 || !ao) return null;
  const h = S.hist;
  const key = `${ver1}|${ao.x0}|${h.n}|${h.transient}|${h.bins}|${h.win}`;
  if (histCache.key !== key) {
    const r = M.histogram(cm1.f, ao.x0, h.transient, h.n, h.win[0], h.win[1], h.bins);
    histCache = { key, res: r };
  }
  return histCache.res;
}
function histExact() {
  if (!S.hist.exact) return null;
  const id = S.map1d.id;
  if (!isPristine(id)) return null;
  return M.exactDensity(id, S.map1d.expr, paramValues1());
}
function histWin() {
  const r = histData();
  const [a, b] = S.hist.win;
  if (!r) return [a, b, 0, 1];
  const sorted = Array.from(r.h).filter((v) => v > 0).sort((p, q) => p - q);
  if (!sorted.length) return [a, b, 0, 1];
  if (S.hist.log) {
    const lo = Math.log10(sorted[0]);
    const hi = Math.log10(sorted[sorted.length - 1]);
    return [a, b, Math.floor(lo - 0.2), Math.ceil(hi + 0.2)];
  }
  const max = sorted[sorted.length - 1];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return [a, b, 0, Math.min(max, 3 * p90) * 1.08];
}
function histYfmt(t, step) {
  if (!S.hist.log) return fmtTick(t, step);
  return t === 0 ? '1' : `10${t < 0 ? '⁻' : ''}${sup(Math.abs(Math.round(t)))}`;
}

function drawHist(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  const r = histData();
  const log = S.hist.log;
  const yv = (v) => (log ? (v > 0 ? Math.log10(v) : -1e9) : v);
  if (r) {
    const [a, b] = S.hist.win;
    const bins = r.h.length;
    ctx.save();
    fr.clip(ctx);
    ctx.fillStyle = 'rgba(31,95,214,.35)';
    ctx.strokeStyle = 'rgba(31,95,214,.9)';
    ctx.lineWidth = 1;
    const base = fr.py(fr.win[2]);
    ctx.beginPath();
    for (let j = 0; j < bins; j++) {
      const v = r.h[j];
      if (!(v > 0)) continue;
      const X0 = fr.px(a + (b - a) * j / bins), X1 = fr.px(a + (b - a) * (j + 1) / bins);
      const Y = clampPx(fr.py(yv(v)));
      ctx.rect(X0, Y, Math.max(0.5, X1 - X0), base - Y);
    }
    ctx.fill();
    if (bins < fr.w / 3) ctx.stroke();
    const ex = histExact();
    if (ex) {
      ctx.strokeStyle = '#d62728';
      ctx.lineWidth = 2;
      plotFunction(ctx, fr, (x) => yv(ex.fn(x)), 1);
    }
    ctx.restore();
    const ao = activeOrbit();
    const items = [{ col: 'rgba(31,95,214,.9)', txt: `orbit histogram, x₀ = ${fmtNum(ao.x0, 6)}` }];
    if (ex) items.push({ col: '#d62728', txt: `exact: ${ex.label}` });
    drawLegend(ctx, fr, items, 'tr');
  }
  drawFrame(ctx, fr, axOpts({ xlabel: 'x', ylabel: log ? 'density (log)' : 'density', yfmt: histYfmt }));
}

// ---------------------------------------------------------------- parameter plane
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}
function lyapColor(l) {
  if (!Number.isFinite(l)) return l === -Infinity ? [255, 225, 70] : [205, 205, 210];
  if (l < 0) {
    const t = 1 - Math.exp(l * 1.1);
    return [Math.round(255 * t), Math.round(212 * t), Math.round(40 * t * t)];
  }
  const t = 1 - Math.exp(-l * 2.2);
  return [Math.round(30 * t), Math.round(80 * t), Math.round(40 + 215 * t)];
}
function rotColor(p, q) {
  if (!q) return [250, 250, 250];
  const frac = ((p / q) % 1 + 1) % 1;
  const [r, g, b] = hsl(frac * 330, 0.72, Math.min(0.78, 0.32 + (q - 1) * 0.045));
  return [r, g, b];
}

function planeIdx() {
  const pl = S.plane;
  const a = paramIndex1(pl.p);
  const b = pl.type === 'markus' ? a : paramIndex1(pl.q);
  return [a, b];
}

// worker pool for parameter-plane pictures
const pool = { workers: [], failed: false };
function spawnWorker(slot) {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  slot.w = w;
  slot.busy = false;
  slot.jobId = 0;
  w.onmessage = (e) => { if (slot.w !== w) return; slot.busy = false; onWorkerResult(e.data); };
  w.onerror = (e) => {
    // e.g. module workers unsupported: fall back to the main thread
    e.preventDefault();
    if (pool.failed) return;
    pool.failed = true;
    pool.workers.forEach((s2) => s2.w.terminate());
    pool.workers = [];
    if (jobs.plane) jobs.plane.requeueAll();
    ensureJobLoop();
  };
}
function getPool() {
  if (pool.failed) return null;
  if (!pool.workers.length) {
    const n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 8);
    try {
      for (let i = 0; i < n; i++) {
        const slot = {};
        spawnWorker(slot);
        pool.workers.push(slot);
      }
    } catch {
      pool.workers.forEach((s2) => s2.w && s2.w.terminate());
      pool.workers = [];
      pool.failed = true;
      return null;
    }
  }
  return pool.workers;
}
/** Workers still busy with rows of an outdated picture would delay the new one: restart them. */
function recyclePool(jobId) {
  if (pool.failed) return;
  for (const slot of pool.workers) {
    if (!slot.busy || slot.jobId === jobId) continue;
    slot.w.terminate();
    try { spawnWorker(slot); } catch { /* keep the terminated slot idle */ slot.busy = false; }
  }
}
function onWorkerResult(d) {
  const j = jobs.plane;
  if (j && d.jobId === j.id) j.receive(d);
  dispatchPlane();
}
function dispatchPlane() {
  const j = jobs.plane;
  const ws = getPool();
  if (!j || !ws || j.done || S.view !== 'plane') return;
  for (const slot of ws) {
    if (slot.busy) continue;
    const t = j.nextTask();
    if (!t) break;
    slot.busy = true;
    slot.jobId = t.jobId;
    slot.w.postMessage(t);
  }
}

let planeJobId = 0;
function makePlaneJob(fr) {
  const pl = S.plane;
  const src = src1();
  if (!src) return null;
  const ka = src.names.indexOf(pl.p);
  const kb = pl.type === 'markus' ? ka : src.names.indexOf(pl.q);
  if (ka < 0 || kb < 0) return null;
  if (pl.type !== 'markus' && ka === kb) return null;
  if (pl.type === 'rot' && !cm1.lift) return null;
  const gw = clamp(Math.round(fr.w * pl.res), 10, 3000);
  const gh = clamp(Math.round(fr.h * pl.res), 10, 3000);
  const ao = activeOrbit();
  const x0 = ao ? ao.x0 : 0.5;
  const seq = (pl.seq || 'AB').toUpperCase().replace(/[^AB]/g, '') || 'AB';
  const { names, values } = src;
  const key = JSON.stringify([src.expr, names.map((n, i) => (i === ka || i === kb ? n : [n, values[i]])), pl.type, pl.type === 'markus' ? seq : '', pl.win, pl.transient, pl.n, gw, gh, x0]);
  if (jobs.plane && jobs.plane.key === key) return jobs.plane;
  let cm;
  try { cm = compileMap1D(src.expr, names, values); } catch { return null; }
  const isA = Array.from(seq, (ch) => ch === 'A');
  const img = new ImageData(gw, gh);
  const data = img.data;
  const cv = makeCanvas(gw, gh);
  const cctx = cv.getContext('2d');
  const vals = new Float32Array(gw * gh).fill(NaN);
  const qs = new Uint8Array(gw * gh);
  const ps = new Int16Array(gw * gh);
  const lvl = new Uint8Array(gw * gh).fill(255);
  const TOP = 8;
  // task list: one row of one refinement level
  const tasks = [];
  for (const s of [8, 4, 2, 1]) for (let j = 0; j < gh; j += s) tasks.push({ j, s });
  const total = tasks.length;
  const id = ++planeJobId;
  const base = {
    jobId: id, mapKey: `${id}`, expr: src.expr, names, values, gw, gh, top: TOP, type: pl.type, ka, kb, isA, x0,
    T: pl.transient, N: pl.n, win: [...pl.win], qmax: Math.min(60, pl.n),
  };
  let next = 0;
  let received = 0;
  const pending = new Set();
  let dirty = false;

  function paint(j, s, is, v, pp, qq) {
    for (let n = 0; n < is.length; n++) {
      const i = is[n];
      const idx = j * gw + i;
      vals[idx] = v[n];
      if (qq) { qs[idx] = qq[n]; ps[idx] = pp[n]; }
      const [cr, cg, cb] = pl.type === 'rot' ? rotColor(pp[n], qq[n]) : lyapColor(v[n]);
      const jEnd = Math.min(gh, j + s), iEnd = Math.min(gw, i + s);
      for (let jj = j; jj < jEnd; jj++) {
        for (let ii = i; ii < iEnd; ii++) {
          const q = jj * gw + ii;
          if (lvl[q] < s) continue;
          lvl[q] = s;
          rgbaPut(data, q * 4, cr, cg, cb, 255);
        }
      }
    }
    dirty = true;
  }

  const job = {
    id, key, cv, gw, gh, vals, qs, ps, done: false,
    progress: () => received / total,
    nextTask() {
      if (next >= tasks.length) return null;
      const t = tasks[next++];
      pending.add(next - 1);
      return { ...base, taskId: next - 1, j: t.j, s: t.s };
    },
    receive(d) {
      if (!pending.has(d.taskId)) return;
      pending.delete(d.taskId);
      received++;
      if (!d.error) paint(d.j, d.s, d.is, d.vals, d.ps, d.qs);
      if (received >= total) job.done = true;
      ensureJobLoop();
    },
    requeueAll() {
      // worker failure: recompute the outstanding tasks on the main thread
      for (const t of pending) tasks.push(tasks[t]);
      pending.clear();
    },
    step(deadline) {
      if (getPool()) { dispatchPlane(); return; }
      // main-thread fallback
      while (next < tasks.length) {
        const { j, s } = tasks[next++];
        const is = M.levelRow(j, s, gw, TOP);
        const b = pl.win[3] - (j + 0.5) * (pl.win[3] - pl.win[2]) / gh;
        const v = new Float32Array(is.length), pp = new Int16Array(is.length), qq = new Uint8Array(is.length);
        for (let n = 0; n < is.length; n++) {
          const a = pl.win[0] + (is[n] + 0.5) * (pl.win[1] - pl.win[0]) / gw;
          const r = M.planePixel(cm, pl.type, ka, kb, isA, x0, base.T, base.N, a, b, base.qmax);
          v[n] = r.v; pp[n] = r.p; qq[n] = r.q;
        }
        paint(j, s, is, v, pp, qq);
        received++;
        if (performance.now() > deadline) break;
      }
      if (received >= total) job.done = true;
    },
    flush() {
      if (!dirty) return false;
      cctx.putImageData(img, 0, 0);
      dirty = false;
      return true;
    },
  };
  jobs.plane = job;
  recyclePool(id);
  ensureJobLoop();
  dispatchPlane();
  return job;
}

function planeValueAt(fr, sx, sy) {
  const j = jobs.plane;
  if (!j) return null;
  const i = Math.floor((sx - fr.x) / fr.w * j.gw);
  const jj = Math.floor((sy - fr.y) / fr.h * j.gh);
  if (i < 0 || jj < 0 || i >= j.gw || jj >= j.gh) return null;
  const idx = jj * j.gw + i;
  if (S.plane.type === 'rot') {
    const q = j.qs[idx];
    if (q) return `ρ = ${j.ps[idx]}/${q} (locked)`;
    return Number.isFinite(j.vals[idx]) ? `ρ ≈ ${fmtNum(j.vals[idx], 5)}` : '';
  }
  const v = j.vals[idx];
  return Number.isNaN(v) ? 'not computed / orbit escapes' : `λ ≈ ${fmtNum(v, 4)}`;
}

function drawPlane(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  const job = makePlaneJob(fr);
  const pl = S.plane;
  if (job) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(job.cv, fr.x, fr.y, fr.w, fr.h);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = '#b01e1e';
    ctx.font = fontSpec(fsz());
    ctx.textAlign = 'center';
    const msg = pl.type === 'rot' && cm1 && !cm1.lift ? 'Arnold tongues need a circle map of the form mod(…, 1).'
      : pl.type !== 'markus' && S.map1d.params.length < 2 ? 'This plot needs a map with two parameters.'
        : pl.type !== 'markus' && pl.p === pl.q ? 'Choose two different parameters.' : 'Map is not valid.';
    ctx.fillText(msg, fr.x + fr.w / 2, fr.y + fr.h / 2);
    ctx.restore();
  }
  // marker of current parameter values
  if (job && pl.type !== 'markus') {
    const [ka, kb] = planeIdx();
    const X = fr.px(S.map1d.params[ka].value), Y = fr.py(S.map1d.params[kb].value);
    ctx.save();
    fr.clip(ctx);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(X, Y, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = '#d62728';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(X, Y, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  const markus = pl.type === 'markus';
  drawFrame(ctx, fr, axOpts({ xlabel: markus ? `A (${pl.p})` : pl.p, ylabel: markus ? `B (${pl.p})` : pl.q }));
  if (markus) {
    ctx.save();
    ctx.font = fontSpec(fsz() - 1, true);
    const txt = `sequence ${(pl.seq || 'AB').toUpperCase()}`;
    const w = ctx.measureText(txt).width + 12;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(fr.x + 8, fr.y + 8, w, fsz() + 8);
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, fr.x + 14, fr.y + 12 + fsz() / 2);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 2D maps
function seedColor(i) {
  if (S.map2d.mono) return [24, 34, 80];
  if (i < ORBIT_COLORS.length) {
    const h = ORBIT_COLORS[i];
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  return hsl((i * 137.508) % 360, 0.75, 0.42);
}

function make2DJob(fr) {
  if (!cm2) return null;
  const m = S.map2d;
  const pw = clamp(Math.round(fr.w * DPR), 10, 4000);
  const ph = clamp(Math.round(fr.h * DPR), 10, 4000);
  const { ex, ey, names } = cm2.src;
  const values = names.map((n, i) => cm2.P[i]);
  const key = JSON.stringify([ex, ey, names, values, m.win, m.n, m.transient, pw, ph, m.ps, m.mono]);
  const j0 = jobs.map2d;
  if (j0 && j0.key === key) {
    // same picture: continue with additional seeds if the old ones are a prefix
    const prefixOk = j0.seeds.every((s, i) => m.seeds[i] && m.seeds[i][0] === s[0] && m.seeds[i][1] === s[1]);
    if (prefixOk) {
      if (m.seeds.length > j0.seeds.length) {
        j0.seeds = m.seeds.map((s) => [...s]);
        j0.done = false;
        ensureJobLoop();
      }
      return j0;
    }
  }
  let cm;
  try { cm = compileMap2D(ex, ey, names, values); } catch { return null; }
  const { F } = cm;
  const [x0, x1, y0, y1] = m.win;
  const sx = pw / (x1 - x0), sy = ph / (y1 - y0);
  const img = new ImageData(pw, ph);
  const data = img.data;
  const cv = makeCanvas(pw, ph);
  const cctx = cv.getContext('2d');
  const counts = m.mono ? new Uint32Array(pw * ph) : null;
  let maxCount = 0;
  const size = Math.max(1, Math.round(m.ps * DPR));
  const half = Math.floor((size - 1) / 2);
  const o = new Float64Array(2);
  let si = 0, it = 0, x = 0, y = 0, col = [0, 0, 0];
  let dirty = false;
  let escaped = 0;
  const job = {
    key, cv, done: false, seeds: m.seeds.map((s) => [...s]), escaped: 0, plotted: 0,
    progress: () => (job.seeds.length ? (si + it / (m.transient + m.n)) / job.seeds.length : 1),
    step(deadline) {
      const tot = m.transient + m.n;
      while (si < job.seeds.length) {
        if (it === 0) { [x, y] = job.seeds[si]; col = seedColor(si); }
        const end = Math.min(tot, it + 4000);
        for (; it < end; it++) {
          F(x, y, o);
          x = o[0]; y = o[1];
          if (!(x > -1e100 && x < 1e100 && y > -1e100 && y < 1e100)) { escaped++; it = tot; break; }
          if (it < m.transient) continue;
          const X = Math.floor((x - x0) * sx), Y = Math.floor((y1 - y) * sy);
          if (X < 0 || Y < 0 || X >= pw || Y >= ph) continue;
          job.plotted++;
          if (counts) {
            const c = ++counts[Y * pw + X];
            if (c > maxCount) maxCount = c;
          } else if (size === 1) {
            rgbaPut(data, (Y * pw + X) * 4, col[0], col[1], col[2], 255);
          } else {
            for (let yy = Math.max(0, Y - half); yy < Math.min(ph, Y - half + size); yy++) {
              for (let xx = Math.max(0, X - half); xx < Math.min(pw, X - half + size); xx++) rgbaPut(data, (yy * pw + xx) * 4, col[0], col[1], col[2], 255);
            }
          }
        }
        dirty = true;
        if (it >= tot) { si++; it = 0; }
        if (performance.now() > deadline) break;
      }
      job.escaped = escaped;
      if (si >= job.seeds.length) job.done = true;
    },
    flush() {
      if (!dirty) return false;
      if (counts) {
        const lm = Math.log(1 + Math.max(1, maxCount * 0.35));
        for (let p = 0; p < counts.length; p++) {
          const c = counts[p];
          if (!c) { data[p * 4 + 3] = 0; continue; }
          const a = Math.min(1, 0.25 + Math.log(1 + c) / lm);
          const q = p * 4;
          data[q] = 18; data[q + 1] = 28; data[q + 2] = 70; data[q + 3] = Math.round(255 * a);
        }
        if (size > 1) { /* density look uses single pixels */ }
      }
      cctx.putImageData(img, 0, 0);
      dirty = false;
      return true;
    },
  };
  jobs.map2d = job;
  ensureJobLoop();
  return job;
}

let fp2Cache = { key: '', pts: [] };
function fixedPts2() {
  if (!cm2 || !S.map2d.fp) return [];
  const key = `${ver2}|${S.map2d.win}`;
  if (fp2Cache.key !== key) {
    let pts = [];
    try { pts = M.fixedPoints2D(cm2.F, cm2.J, S.map2d.win); } catch { /* ignore */ }
    fp2Cache = { key, pts };
    const fmtE = (e) => (typeof e === 'number' ? fmtNum(e, 4) : `${fmtNum(e.re, 4)}${e.im >= 0 ? '+' : '−'}${fmtNum(Math.abs(e.im), 4)}i`);
    $('info2d').innerHTML = pts.length
      ? `<strong>Fixed points</strong><br>${pts.slice(0, 12).map((p) => `(${fmtNum(p.x, 5)}, ${fmtNum(p.y, 5)}): ${p.type}; eigenvalues ${p.eig.map(fmtE).join(', ')}`).join('<br>')}`
      : 'No fixed points found in the window.';
  }
  return fp2Cache.pts;
}

function drawMap2D(ctx, fr) {
  drawAxes(ctx, fr, axOpts());
  const job = make2DJob(fr);
  if (job) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(job.cv, fr.x, fr.y, fr.w, fr.h);
    ctx.restore();
  }
  ctx.save();
  fr.clip(ctx);
  for (const p of fixedPts2()) {
    const X = fr.px(p.x), Y = fr.py(p.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#d62728';
    ctx.fillStyle = '#d62728';
    ctx.beginPath();
    if (p.type === 'saddle') {
      ctx.moveTo(X - 6, Y - 6); ctx.lineTo(X + 6, Y + 6); ctx.moveTo(X + 6, Y - 6); ctx.lineTo(X - 6, Y + 6);
      ctx.stroke();
    } else if (p.type === 'elliptic') {
      ctx.moveTo(X, Y - 7); ctx.lineTo(X + 7, Y); ctx.lineTo(X, Y + 7); ctx.lineTo(X - 7, Y); ctx.closePath();
      ctx.stroke();
    } else {
      ctx.arc(X, Y, 5.5, 0, 2 * Math.PI);
      if (p.type.startsWith('attracting')) ctx.fill(); else { ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    }
  }
  ctx.restore();
  drawFrame(ctx, fr, axOpts({ xlabel: S.map2d.id === 'standard' ? 'x (θ)' : 'x', ylabel: S.map2d.id === 'standard' ? 'y (p)' : 'y' }));
}

// ---------------------------------------------------------------- render dispatch
let renderRaf = 0;
function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => { renderRaf = 0; renderBase(); renderOverlay(); });
}

function renderBase() {
  const ctx = bctx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(0, 0, W, H);
  layout();
  for (const fr of frames) {
    switch (fr.id) {
      case 'cob': drawCobweb(ctx, fr); break;
      case 'ser': drawSeries(ctx, fr); break;
      case 'diff': drawDiff(ctx, fr); break;
      case 'bif': drawBif(ctx, fr); break;
      case 'strip': drawStrip(ctx, fr); break;
      case 'hist': drawHist(ctx, fr); break;
      case 'plane': drawPlane(ctx, fr); break;
      case 'map2d': drawMap2D(ctx, fr); break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------- overlay & status
let hover = null;   // { x, y } in CSS px (mouse) for cross-hair
let zoomRect = null;
function renderOverlay() {
  const ctx = octx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (zoomRect) {
    ctx.save();
    ctx.fillStyle = 'rgba(47,111,223,.12)';
    ctx.strokeStyle = '#2f6fdf';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    const { x0, y0, x1, y1 } = zoomRect;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }
  if (hover && S.ui.cross) {
    const fr = frameAt(hover.x, hover.y, 0);
    if (fr) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fr.x, Math.round(hover.y) + 0.5); ctx.lineTo(fr.x + fr.w, Math.round(hover.y) + 0.5);
      ctx.moveTo(Math.round(hover.x) + 0.5, fr.y); ctx.lineTo(Math.round(hover.x) + 0.5, fr.y + fr.h);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function frameAt(sx, sy, pad = 10) {
  return frames.find((f) => f.contains(sx, sy, 0)) || frames.find((f) => f.contains(sx, sy, pad)) || null;
}

function setStatus(msg, warn = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
}
function defaultStatus() {
  const err = S.view === 'map2d' ? 'err2d' : 'err1d';
  if (!$(err).hidden && (S.view === 'map2d' ? cm2 : cm1)) {
    setStatus('The map has an error (see the panel) – showing the last valid map.', true);
    return;
  }
  if (S.view === 'map2d') {
    const j = jobs.map2d;
    const info = j ? ` ${j.seeds.length} orbit${j.seeds.length === 1 ? '' : 's'}${j.escaped ? `, ${j.escaped} escaped to infinity` : ''}.` : '';
    setStatus(`Tap to ${S.map2d.tap === 'add' ? 'add an orbit' : 'restart the orbit'} at a point; drag a rectangle or pinch to zoom.${info}`);
    return;
  }
  if (!cm1) { setStatus('The map expression has an error – see the panel.', true); return; }
  const ao = activeOrbit();
  switch (S.view) {
    case 'cobweb':
    case 'series': {
      if (anim.step !== null && ao) {
        const xs = M.orbit1D(S.view === 'cobweb' ? cobMap() : cm1.f, ao.x0, S.cob.n, S.cob.transient);
        const s = stepLimit(S.cob.n);
        setStatus(`Step ${s} of ${S.cob.n}:  x${sub(S.cob.transient + s)} = ${fmtNum(xs[s], 8)}`);
      } else {
        const lam = activeLyapunov();
        setStatus(S.view === 'cobweb'
          ? `Drag in the plot to move x₀. λ ≈ ${fmtNum(lam, 4)} for the selected orbit.`
          : `Lyapunov exponent of the selected orbit λ ≈ ${fmtNum(lam, 4)}. Drag a rectangle to zoom.`);
      }
      break;
    }
    case 'bif': {
      const j = jobs.bif;
      setStatus(j && !j.done ? 'Computing bifurcation diagram…' : `Tap to set ${S.bif.param}; drag a rectangle or pinch to zoom (recomputes).`);
      break;
    }
    case 'hist': {
      const r = histData();
      const out = r && r.total ? 1 - r.inside / r.total : 0;
      setStatus(out > 0.001 ? `${(100 * out).toFixed(1)}% of the iterates lie outside the x range or escaped.` : `Invariant density estimate from ${S.hist.n.toLocaleString('en')} iterates. λ ≈ ${fmtNum(activeLyapunov(), 4)}`);
      break;
    }
    case 'plane': {
      const j = jobs.plane;
      setStatus(j && !j.done ? 'Computing…' : S.plane.type === 'markus' ? 'Hover/tap for λ; drag a rectangle or pinch to zoom.' : 'Tap to set both parameters; drag a rectangle or pinch to zoom.');
      break;
    }
    default: setStatus('Ready.');
  }
}
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
const sub = (k) => String(k).split('').map((d) => SUB[d] || d).join('');

function showCoords(sx, sy) {
  const fr = frameAt(sx, sy, 0);
  const el = $('coords');
  if (!fr) { el.textContent = ''; return; }
  const x = fr.wx(sx), y = fr.wy(sy);
  const r = (v, i) => fmtNum(v, 5);
  switch (fr.id) {
    case 'cob': el.textContent = `x = ${r(x)}, y = ${r(y)}`; break;
    case 'ser': el.textContent = `n = ${Math.round(x)}, x = ${r(y)}`; break;
    case 'diff': el.textContent = `n = ${Math.round(x)}, log₁₀|Δx| = ${r(y)}`; break;
    case 'bif': el.textContent = `${S.bif.param} = ${r(x)}, x = ${r(y)}`; break;
    case 'strip': {
      const j = jobs.bif;
      let v = '';
      if (j) {
        const c = Math.floor((sx - fr.x) / fr.w * j.cols);
        const arr = stripMode() === 'rot' ? j.rot : j.lyap;
        if (c >= 0 && c < j.cols && Number.isFinite(arr[c])) v = `, ${stripMode() === 'rot' ? 'ρ' : 'λ'} = ${fmtNum(arr[c], 4)}`;
      }
      el.textContent = `${S.bif.param} = ${r(x)}${v}`;
      break;
    }
    case 'hist': {
      const d = histData();
      let v = '';
      if (d) {
        const [a, b] = S.hist.win;
        const j = Math.floor((x - a) / (b - a) * d.h.length);
        if (j >= 0 && j < d.h.length) v = `, density = ${fmtNum(d.h[j], 4)}`;
      }
      el.textContent = `x = ${r(x)}${v}`;
      break;
    }
    case 'plane': {
      const v = planeValueAt(fr, sx, sy);
      const markus = S.plane.type === 'markus';
      el.textContent = `${markus ? 'A' : S.plane.p} = ${r(x)}, ${markus ? 'B' : S.plane.q} = ${r(y)}${v ? `: ${v}` : ''}`;
      break;
    }
    case 'map2d': el.textContent = `x = ${r(x)}, y = ${r(y)}`; break;
    default: el.textContent = '';
  }
}

// ---------------------------------------------------------------- windows, zoom & history
function viewWinSnapshot(view = S.view) {
  switch (view) {
    case 'cobweb': return { cob: [...S.cob.win], ser: S.seriesWin && [...S.seriesWin] };
    case 'series': return { ser: S.seriesWin && [...S.seriesWin] };
    case 'bif': return { bif: [...S.bif.win] };
    case 'hist': return { hist: [...S.hist.win] };
    case 'plane': return { plane: [...S.plane.win] };
    case 'map2d': return { map2d: [...S.map2d.win] };
    default: return {};
  }
}
function applySnapshot(s) {
  if (s.cob) S.cob.win = s.cob;
  if ('ser' in s) S.seriesWin = s.ser;
  if (s.bif) S.bif.win = s.bif;
  if (s.hist) S.hist.win = s.hist;
  if (s.plane) S.plane.win = s.plane;
  if (s.map2d) S.map2d.win = s.map2d;
  syncWindowInputs();
  saveStore();
  scheduleRender();
}
function pushHistory() {
  const h = history[S.view];
  h.push(viewWinSnapshot());
  if (h.length > 60) h.shift();
}
function zoomBack() {
  const h = history[S.view];
  if (!h.length) { setStatus('No previous zoom.'); return; }
  applySnapshot(h.pop());
}
function validWin(w) {
  return w.every(Number.isFinite) && w[1] > w[0] && w[3] > w[2] &&
    (w[1] - w[0]) > 1e-13 * Math.max(1, Math.abs(w[0]), Math.abs(w[1])) &&
    (w[3] - w[2]) > 1e-13 * Math.max(1, Math.abs(w[2]), Math.abs(w[3]));
}
/** Round window limits to ~5 significant digits of the span (clean numbers in inputs). */
function roundWin(w) {
  const out = [...w];
  for (const i of [0, 2]) {
    const span = w[i + 1] - w[i];
    const q = Math.pow(10, Math.floor(Math.log10(span)) - 4);
    const a = Math.round(w[i] / q) * q, b = Math.round(w[i + 1] / q) * q;
    if (b > a) { out[i] = Number(a.toPrecision(15)); out[i + 1] = Number(b.toPrecision(15)); }
  }
  return out;
}
/** Set a frame's window (after zoom/pan). */
function setFrameWin(fr, w) {
  if (!validWin(w)) { setStatus('Cannot zoom further.', true); return false; }
  w = roundWin(w);
  pushHistory();
  switch (fr.id) {
    case 'cob': S.cob.win = w; break;
    case 'ser': S.seriesWin = w; break;
    case 'diff': S.seriesWin = [w[0], w[1], ...seriesWin().slice(2)]; break;
    case 'bif': S.bif.win = w; break;
    case 'strip': S.bif.win = [w[0], w[1], S.bif.win[2], S.bif.win[3]]; break;
    case 'hist': S.hist.win = [w[0], w[1]]; break;
    case 'plane': S.plane.win = w; break;
    case 'map2d': S.map2d.win = w; break;
    default: return false;
  }
  syncWindowInputs();
  saveStore();
  scheduleRender();
  return true;
}
function resetZoom() {
  pushHistory();
  const d = map1dDefaults(S.map1d.id);
  switch (S.view) {
    case 'cobweb': S.cob.win = d.cob.win; S.seriesWin = null; break;
    case 'series': S.seriesWin = null; break;
    case 'bif': S.bif.win = d.bif.win; break;
    case 'hist': S.hist.win = d.histWin; break;
    case 'plane': S.plane.win = d.plane.win; break;
    case 'map2d': S.map2d.win = [...g2(S.map2d.id).win]; break;
    default: break;
  }
  syncWindowInputs();
  saveStore();
  scheduleRender();
}
function zoomOut2() {
  const fr = frames[0];
  if (!fr) return;
  const [a, b, c, d] = fr.win;
  const cx = (a + b) / 2, cy = (c + d) / 2;
  const w = [cx - (b - a), cx + (b - a), cy - (d - c), cy + (d - c)];
  setFrameWin(fr, w);
}

// ---------------------------------------------------------------- pointer input
const pointers = new Map();
let gesture = null;
let wheel = null;

function localPos(e) {
  const r = overCv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function setPreviewTransform(s, tx, ty, xOnly = false) {
  baseCv.style.transform = xOnly ? `translate(${tx}px, 0) scale(${s}, 1)` : `translate(${tx}px, ${ty}px) scale(${s})`;
}
function clearPreviewTransform() { baseCv.style.transform = ''; }

function commitTransform(fr, s, tx, ty) {
  clearPreviewTransform();
  if (!fr || (Math.abs(s - 1) < 0.01 && Math.abs(tx) < 4 && Math.abs(ty) < 4)) { renderBase(); return; }
  const inv = (X) => (X - tx) / s;
  const invY = (Y) => (Y - ty) / s;
  const w = [fr.wx(inv(fr.x)), fr.wx(inv(fr.x + fr.w)), fr.wy(invY(fr.y + fr.h)), fr.wy(invY(fr.y))];
  if (fr.zoom === 'x') { w[2] = fr.win[2]; w[3] = fr.win[3]; }
  if (!setFrameWin(fr, w)) renderBase();
}

function onPointerDown(e) {
  try { overCv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  const p = localPos(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    if (gesture && gesture.type === 'dragx0' && gesture.orig) {
      // the first finger of a pinch must not move x0: undo
      const o = S.cob.orbits[gesture.orig.idx];
      if (o) o.x0 = gesture.orig.x0;
      S.cob.active = gesture.orig.active;
      renderOrbitList();
      lyapCache.key = '';
      scheduleRender();
    }
    const [a, b] = [...pointers.values()];
    const fr = frameAt((a.x + b.x) / 2, (a.y + b.y) / 2, 40) || frames[0];
    gesture = { type: 'pinch', fr, a0: { ...a }, b0: { ...b }, s: 1, tx: 0, ty: 0 };
    zoomRect = null;
    renderOverlay();
    return;
  }
  if (pointers.size > 2) return;
  const fr = frameAt(p.x, p.y, 14);
  const zoomKey = e.shiftKey || e.ctrlKey || e.metaKey;
  gesture = { type: 'single', id: e.pointerId, fr, x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, touch: e.pointerType !== 'mouse' };
  if (fr && fr.id === 'cob' && !zoomKey && e.button !== 2) {
    gesture.type = 'dragx0';
    const ao = activeOrbit();
    gesture.orig = { active: S.cob.active, idx: S.cob.active, x0: ao ? ao.x0 : NaN };
    // grab the orbit whose x0 handle is nearest (within 28 px), else the selected one
    let best = -1, bd = 28;
    S.cob.orbits.forEach((o, i) => {
      const d = Math.abs(fr.px(o.x0) - p.x);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && best !== S.cob.active) { S.cob.active = best; gesture.orig.idx = best; gesture.orig.x0 = S.cob.orbits[best].x0; renderOrbitList(); }
    if (best < 0) moveX0(fr, p.x);
    scheduleRender();
  }
}

function moveX0(fr, sx) {
  const o = activeOrbit();
  if (!o) return;
  const x = fr.wx(clamp(sx, fr.x, fr.x + fr.w));
  o.x0 = Number(fmtParam(x, (fr.win[1] - fr.win[0])));
  updateOrbitInputs();
  showCoords(sx, gesture ? gesture.y : 0);
  scheduleRender();
}

function onPointerMove(e) {
  const p = localPos(e);
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType === 'mouse') {
      hover = { x: p.x, y: p.y };
      showCoords(p.x, p.y);
      if (S.ui.cross) renderOverlay();
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
    setPreviewTransform(gesture.s, gesture.tx, gesture.ty, gesture.fr && gesture.fr.zoom === 'x');
    return;
  }
  if (gesture.id !== e.pointerId) return;
  gesture.x = p.x; gesture.y = p.y;
  if (Math.hypot(p.x - gesture.x0, p.y - gesture.y0) > 9) gesture.moved = true;
  showCoords(p.x, p.y);
  if (gesture.type === 'dragx0') {
    moveX0(gesture.fr, p.x);
    return;
  }
  if (gesture.type === 'single' && gesture.moved && gesture.fr) {
    const fr = gesture.fr;
    const cx = (v) => clamp(v, fr.x, fr.x + fr.w);
    const cy = (v) => clamp(v, fr.y, fr.y + fr.h);
    zoomRect = fr.zoom === 'x'
      ? { x0: cx(gesture.x0), y0: fr.y, x1: cx(p.x), y1: fr.y + fr.h }
      : { x0: cx(gesture.x0), y0: cy(gesture.y0), x1: cx(p.x), y1: cy(p.y) };
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
    if (e.type === 'pointercancel') { clearPreviewTransform(); renderBase(); return; }
    commitTransform(g.fr, g.s, g.tx, g.ty);
    return;
  }
  if (g.id !== e.pointerId) { if (!pointers.size) gesture = null; return; }
  gesture = null;
  const cancelled = e.type === 'pointercancel';
  if (g.type === 'dragx0') {
    saveStore();
    lyapCache.key = '';
    defaultStatus();
    scheduleRender();
    return;
  }
  const rect = zoomRect;
  zoomRect = null;
  renderOverlay();
  if (cancelled || !g.fr) return;
  if (rect && g.moved) {
    const fr = g.fr;
    if (Math.abs(rect.x1 - rect.x0) < 6 || (fr.zoom !== 'x' && Math.abs(rect.y1 - rect.y0) < 6)) return;
    const w = [fr.wx(Math.min(rect.x0, rect.x1)), fr.wx(Math.max(rect.x0, rect.x1)), fr.wy(Math.max(rect.y0, rect.y1)), fr.wy(Math.min(rect.y0, rect.y1))];
    if (fr.zoom === 'x') { w[2] = fr.win[2]; w[3] = fr.win[3]; }
    setFrameWin(fr, w);
    return;
  }
  if (!g.moved) handleTap(g.fr, g.x0, g.y0);
}

function setParam1(idx, v) {
  const p = S.map1d.params[idx];
  if (!p) return;
  p.value = v;
  if (v < p.min) p.min = v;
  if (v > p.max) p.max = v;
  if (p._sync) p._sync();
  syncP1();
  mapChanged1(idx);
  updateTitle();
  saveStore();
  scheduleRender();
}

function handleTap(fr, sx, sy) {
  if (!fr.contains(sx, sy, 0)) return;
  const x = fr.wx(sx), y = fr.wy(sy);
  const span = fr.win[1] - fr.win[0];
  switch (fr.id) {
    case 'bif':
    case 'strip': {
      const k = paramIndex1(S.bif.param);
      if (k < 0) return;
      setParam1(k, Number(fmtParam(x, span)));
      setStatus(`${S.bif.param} = ${fmtParam(x, span)} – the cobweb and time series now use this value.`);
      break;
    }
    case 'plane': {
      const v = planeValueAt(fr, sx, sy);
      if (S.plane.type !== 'markus') {
        const [ka, kb] = planeIdx();
        if (ka >= 0 && kb >= 0 && ka !== kb) {
          S.map1d.params[kb].value = Number(fmtParam(y, fr.win[3] - fr.win[2]));
          if (S.map1d.params[kb]._sync) S.map1d.params[kb]._sync();
          setParam1(ka, Number(fmtParam(x, span)));
        }
      }
      setStatus(`${S.plane.type === 'markus' ? `A = ${fmtNum(x)}, B = ${fmtNum(y)}` : `${S.plane.p} = ${fmtNum(x)}, ${S.plane.q} = ${fmtNum(y)}`}${v ? `: ${v}` : ''}`);
      break;
    }
    case 'map2d': {
      const m = S.map2d;
      if (m.tap === 'replace') m.seeds = [[x, y]];
      else m.seeds.push([x, y]);
      if (m.seeds.length > 2000) m.seeds.shift();
      saveStore();
      scheduleRender();
      setStatus(`Orbit from (${fmtNum(x)}, ${fmtNum(y)})`);
      break;
    }
    case 'ser': {
      setStatus(`n = ${Math.round(x)}, x = ${fmtNum(y)}`);
      break;
    }
    default: break;
  }
}

function onWheel(e) {
  e.preventDefault();
  const p = localPos(e);
  if (!wheel) {
    const fr = frameAt(p.x, p.y, 10);
    if (!fr) return;
    wheel = { fr, s: 1, tx: 0, ty: 0, timer: 0 };
  }
  const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  wheel.s *= factor;
  wheel.tx = p.x - (p.x - wheel.tx) * factor;
  wheel.ty = p.y - (p.y - wheel.ty) * factor;
  setPreviewTransform(wheel.s, wheel.tx, wheel.ty, wheel.fr.zoom === 'x');
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(() => {
    const w = wheel;
    wheel = null;
    commitTransform(w.fr, w.s, w.tx, w.ty);
  }, 280);
}

// ---------------------------------------------------------------- change notifications
function mapChanged1() {
  lyapCache.key = '';
  defaultStatusSoon();
}
function invalidate2D() { /* jobs are keyed by their inputs; a render restarts them */ }
let statusTimer = 0;
function defaultStatusSoon() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(defaultStatus, 120);
}

function updateTitle() {
  const el = $('title');
  if (S.view === 'map2d') {
    const g = g2(S.map2d.id);
    const ps = S.map2d.params.map((p) => `${p.name} = ${fmtParam(p.value, p.max - p.min)}`).join(', ');
    el.textContent = `${g.name}${ps ? `:  ${ps}` : ''}`;
  } else {
    const ps = S.map1d.params.map((p) => `${p.name} = ${fmtParam(p.value, p.max - p.min)}`).join(', ');
    el.textContent = `x ↦ ${S.map1d.expr.trim()}${ps ? `,   ${ps}` : ''}`;
  }
}

// ---------------------------------------------------------------- orbit list
function renderOrbitList() {
  const box = $('orbitList');
  box.innerHTML = '';
  S.cob.orbits.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = `orbit-row${i === S.cob.active ? ' active' : ''}`;
    row.innerHTML = `<button type="button" class="swatch" aria-label="Select orbit ${i + 1}" style="background:${orbitColor(o)}"></button>
      <span class="x0lbl">x₀ =</span><input inputmode="decimal" aria-label="Initial value"><button type="button" class="icon-btn" aria-label="Delete orbit">✕</button>`;
    const [sw, del] = row.querySelectorAll('button');
    const inp = row.querySelector('input');
    inp.value = String(o.x0);
    const select = () => { if (S.cob.active !== i) { S.cob.active = i; renderOrbitList(); lyapCache.key = ''; scheduleRender(); defaultStatusSoon(); } };
    sw.onclick = select;
    inp.addEventListener('focus', select);
    inp.addEventListener('change', () => {
      try { o.x0 = evalConst(inp.value); inp.classList.remove('bad'); } catch { inp.classList.add('bad'); return; }
      lyapCache.key = '';
      saveStore();
      scheduleRender();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); inp.dispatchEvent(new Event('change')); } });
    del.onclick = () => {
      S.cob.orbits.splice(i, 1);
      if (S.cob.active >= S.cob.orbits.length) S.cob.active = Math.max(0, S.cob.orbits.length - 1);
      if (!S.cob.orbits.length) S.cob.orbits.push({ x0: g1(S.map1d.id).x0, c: 0 });
      renderOrbitList(); saveStore(); scheduleRender();
    };
    box.append(row);
  });
}
function updateOrbitInputs() {
  const inputs = $('orbitList').querySelectorAll('input');
  S.cob.orbits.forEach((o, i) => { if (inputs[i] && document.activeElement !== inputs[i]) inputs[i].value = String(o.x0); });
}
function nextColor() {
  const used = new Set(S.cob.orbits.map((o) => o.c));
  for (let c = 0; c < ORBIT_COLORS.length; c++) if (!used.has(c)) return c;
  return S.cob.orbits.length % ORBIT_COLORS.length;
}
function addOrbit(x0) {
  if (S.cob.orbits.length >= 10) { setStatus('At most 10 orbits.', true); return; }
  const w = S.cob.win;
  if (x0 === undefined) {
    const ao = activeOrbit();
    const base = ao ? ao.x0 : (w[0] + w[1]) / 2;
    x0 = w[0] + ((base - w[0] + 0.2718 * (w[1] - w[0])) % (w[1] - w[0]));
    x0 = Number(fmtParam(x0, w[1] - w[0]));
  }
  S.cob.orbits.push({ x0, c: nextColor() });
  S.cob.active = S.cob.orbits.length - 1;
  renderOrbitList();
  saveStore();
  scheduleRender();
}

// ---------------------------------------------------------------- numeric inputs
/** Bind a text input to a numeric getter/setter (accepts expressions like 2pi). */
function bindNum(id, get, set, after) {
  const el = $(id);
  const kind = el.dataset.num;
  const min = el.dataset.min !== undefined ? Number(el.dataset.min) : -Infinity;
  const max = el.dataset.max !== undefined ? Number(el.dataset.max) : Infinity;
  const show = () => { const v = get(); return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12))); };
  el.value = show();
  el._sync = () => { el.value = show(); el.classList.remove('bad'); };
  const apply = () => {
    let v;
    try { v = evalConst(el.value); } catch { el.classList.add('bad'); return; }
    if (kind === 'int') v = Math.round(v);
    if (v < min || v > max) { el.classList.add('bad'); return; }
    el.classList.remove('bad');
    if (set(v) === false) { el.classList.add('bad'); return; }
    saveStore();
    if (after) after();
    scheduleRender();
  };
  el.addEventListener('change', apply);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
}
const winSetter = (getArr, i, otherIdx, isMax) => (v) => {
  const a = getArr();
  const other = a[otherIdx];
  if (isMax ? v <= other : v >= other) return false;
  pushHistory();
  a[i] = v;
  return true;
};
function syncWindowInputs() {
  document.querySelectorAll('#panel input[data-num]').forEach((el) => el._sync && el._sync());
}

// ---------------------------------------------------------------- views & panel
function setView(v) {
  if (!VIEWS.includes(v)) return;
  if (S.view !== v) { stopAnim(); $('coords').textContent = ''; }
  S.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.psec').forEach((s) => { s.hidden = !s.dataset.for.split(' ').includes(v); });
  const anims = v === 'cobweb' || v === 'series';
  $('btnStep').classList.toggle('hidden-tool', !anims);
  $('btnPlay').classList.toggle('hidden-tool', !anims);
  $('btnRecompute').hidden = !['bif', 'plane', 'map2d'].includes(v);
  updateTitle();
  saveStore();
  scheduleRender();
  defaultStatus();
  ensureJobLoop();
}

const narrow = matchMedia('(max-width: 1023px)');
function openPanel() {
  const p = $('panel');
  if (narrow.matches) { p.classList.add('open'); $('scrim').hidden = false; }
  else { p.classList.remove('hidden-wide'); S.ui.panelHidden = false; saveStore(); }
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
    S.ui.panelHidden = p.classList.contains('hidden-wide');
    saveStore();
  }
}

// ---------------------------------------------------------------- animation
function updatePlayButton() {
  $('btnPlay').classList.toggle('playing', anim.playing);
  $('btnPlay').querySelector('.lbl').textContent = anim.playing ? 'Pause' : 'Animate';
}
function stopAnim() {
  clearInterval(anim.timer);
  anim.timer = 0;
  anim.playing = false;
  updatePlayButton();
}
function stepOnce(dir = 1) {
  if (S.view !== 'cobweb' && S.view !== 'series') return;
  stopAnim();
  const n = S.cob.n;
  if (anim.step === null) anim.step = dir > 0 ? 1 : n - 1;
  else anim.step = dir > 0 ? (anim.step >= n ? 1 : anim.step + 1) : Math.max(0, anim.step - 1);
  scheduleRender();
  defaultStatus();
}
function togglePlay() {
  if (S.view !== 'cobweb' && S.view !== 'series') return;
  if (anim.playing) { stopAnim(); defaultStatus(); return; }
  const n = S.cob.n;
  if (anim.step === null || anim.step >= n) anim.step = 0;
  anim.playing = true;
  updatePlayButton();
  anim.timer = setInterval(() => {
    anim.step++;
    if (anim.step >= S.cob.n) { anim.step = S.cob.n; stopAnim(); }
    scheduleRender();
    defaultStatus();
  }, S.cob.delay);
  scheduleRender();
}
function showAll() {
  stopAnim();
  anim.step = null;
  scheduleRender();
  defaultStatus();
}

// ---------------------------------------------------------------- gallery selects
function fillGallerySelects() {
  const s1 = $('map1dSel');
  s1.innerHTML = '';
  for (const g of M.GALLERY_1D) {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    s1.append(o);
  }
  const s2 = $('map2dSel');
  s2.innerHTML = '';
  for (const g of M.GALLERY_2D) {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = g.name;
    s2.append(o);
  }
}
function loadMap1D(id, keepExpr = false) {
  const d = map1dDefaults(id);
  stopAnim();
  anim.step = null;
  if (keepExpr && id === 'custom' && S.map1d.id !== 'custom') {
    // "User-defined" starts as an editable copy of the current map
    const cur = JSON.parse(JSON.stringify({ m: S.map1d, cob: S.cob, bif: S.bif, plane: S.plane, hist: S.hist }));
    d.map1d.expr = cur.m.expr;
    d.map1d.params = cur.m.params;
    d.cob.win = cur.cob.win;
    d.cob.orbits = cur.cob.orbits;
    d.bif = { param: cur.bif.param, win: cur.bif.win, strip: cur.bif.strip };
    d.histWin = cur.hist.win;
    d.plane = { type: cur.plane.type, seq: cur.plane.seq, p: cur.plane.p, q: cur.plane.q, win: cur.plane.win };
  }
  S.map1d = d.map1d;
  S.cob.win = d.cob.win;
  S.cob.orbits = d.cob.orbits;
  S.cob.active = 0;
  S.seriesWin = null;
  Object.assign(S.bif, d.bif);
  S.hist.win = d.histWin;
  Object.assign(S.plane, d.plane);
  for (const v of VIEWS) if (v !== 'map2d') history[v] = [];
  syncMapUI1();
  compile1();
  fillParamSelects();
  saveStore();
  updateTitle();
  scheduleRender();
  defaultStatus();
}
function syncMapUI1() {
  $('map1dSel').value = S.map1d.id;
  $('expr1d').value = S.map1d.expr;
  $('map1dDesc').textContent = g1(S.map1d.id).description;
  buildParamEditor('1d');
  renderOrbitList();
  syncWindowInputs();
  syncSelects();
}
function loadMap2D(id) {
  const keep = { ps: S.map2d.ps, fp: S.map2d.fp, mono: S.map2d.mono };
  S.map2d = { ...map2dDefaults(id), ...keep };
  history.map2d = [];
  syncMapUI2();
  compile2();
  saveStore();
  updateTitle();
  scheduleRender();
  defaultStatus();
}
function syncMapUI2() {
  $('map2dSel').value = S.map2d.id;
  $('expr2dx').value = S.map2d.ex;
  $('expr2dy').value = S.map2d.ey;
  $('map2dDesc').textContent = g2(S.map2d.id).description;
  buildParamEditor('2d');
  syncWindowInputs();
  $('tap2d').value = S.map2d.tap;
  $('ps2d').value = String(S.map2d.ps);
  $('fp2d').checked = S.map2d.fp;
  $('mono2d').checked = S.map2d.mono;
  fp2Cache.key = '';
}

function syncSelects() {
  // k chips
  const chips = $('kChips');
  chips.innerHTML = '';
  for (let k = 1; k <= 8; k++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k === 1 ? 'f' : `f${sup(k)}`;
    b.classList.toggle('on', S.cob.ks.includes(k));
    b.style.borderColor = S.cob.ks.includes(k) ? '' : K_COLORS[k - 1];
    b.onclick = () => {
      const i = S.cob.ks.indexOf(k);
      if (i >= 0) S.cob.ks.splice(i, 1); else S.cob.ks.push(k);
      syncSelects(); saveStore(); scheduleRender();
    };
    chips.append(b);
  }
  $('cobK').value = String(S.cob.cobK);
  $('perMax').value = String(S.cob.perMax);
  $('cobSeries').checked = S.cob.series;
  $('optDelay').value = String(S.cob.delay);
  $('twin').checked = S.series.twin;
  $('bifParam').value = S.bif.param;
  $('bifStarts').value = String(S.bif.starts);
  $('bifStrip').value = S.bif.strip;
  $('bifFeig').checked = S.bif.feig;
  $('bifFollow').checked = S.bif.follow;
  $('histExact').checked = S.hist.exact;
  $('histLog').checked = S.hist.log;
  $('plType').value = S.plane.type;
  $('plSeq').value = S.plane.seq;
  $('plP').value = S.plane.p;
  $('plQ').value = S.plane.q;
  $('plRes').value = String(S.plane.res);
  $('optCross').checked = S.ui.cross;
  $('optGrid').checked = S.ui.grid;
  $('optFont').value = String(S.ui.font);
  updateBifLabels();
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
    $('dlgForm').onsubmit = (e) => {
      const v = e.submitter ? e.submitter.value : 'ok';
      if (validate && v !== 'cancel' && validate(v, b) === false) e.preventDefault();
    };
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dlg.showModal();
    b.scrollTop = 0;
  });
}

const HOWTO = `
<h4>Views</h4>
<ul>
<li><b>Cobweb</b> – graph of f (and f², f³ … via the chips), diagonal and cobweb orbits. <b>Drag</b> in the plot to move x₀ of the selected orbit live; drag near a triangle on the bottom edge to grab that orbit. Periodic points are marked on the diagonal: filled = stable (|(fᵏ)′| &lt; 1), hollow = unstable.</li>
<li><b>Series</b> – xₙ versus n. With “twin orbit” a second orbit starts at x₀ + δ; the lower plot shows log₁₀|Δxₙ| and the slope λ/ln 10 predicted by the Lyapunov exponent.</li>
<li><b>Bifurcation</b> – long-term behaviour against a parameter (density shaded) with the Lyapunov exponent (or rotation number for circle maps) underneath. <b>Tap</b> to set the parameter – the other views follow. Feigenbaum period-doubling points are marked for the logistic map.</li>
<li><b>Density</b> – histogram of a long orbit (invariant density), with exact densities overlaid where known (logistic r = 4, tent μ = 2, x² − 2).</li>
<li><b>Plane</b> – Markus–Lyapunov fractals (parameter switched by a sequence such as AB), two-parameter Lyapunov maps and Arnold tongues of the circle map.</li>
<li><b>2D maps</b> – Hénon, Lozi, standard map, Ikeda, Tinkerbell, Gingerbreadman or your own. <b>Tap</b> to start an orbit (phase portraits: add many).</li>
</ul>
<h4>Zoom</h4>
<ul>
<li>Drag a rectangle (in the cobweb view: Shift/Ctrl + drag), pinch with two fingers, or use the mouse wheel. Bifurcation diagrams and fractals are recomputed at the new resolution.</li>
<li>The magnifier button goes back to the previous zoom; the menu has “Reset zoom”.</li>
</ul>
<h4>Keyboard</h4>
<table>
<tr><td><kbd>1</kbd> … <kbd>6</kbd></td><td>switch view</td></tr>
<tr><td><kbd>→</kbd> / <kbd>←</kbd></td><td>step forward / back</td></tr>
<tr><td><kbd>Space</kbd></td><td>animate / pause</td></tr>
<tr><td><kbd>Esc</kbd></td><td>show the whole orbit, stop computations</td></tr>
<tr><td><kbd>Backspace</kbd></td><td>previous zoom</td></tr>
</table>
<p>Tip: in Safari use Share → “Add to Home Screen” to run the lab full screen like an app.</p>`;

const SYNTAX = `
<p>Maps are entered as ordinary formulas in <i>x</i> (and <i>y</i> for 2D maps) and up to four parameters. Parameters get sliders; their names may have up to 8 letters/digits.</p>
<table>
<tr><td><code>+ - * / ^</code></td><td>arithmetic, <code>^</code> is power (<code>x^(1/3)</code> is the real cube root)</td></tr>
<tr><td><code>2x</code>, <code>r x (1-x)</code></td><td>implicit multiplication</td></tr>
<tr><td><code>pi</code>, <code>e</code></td><td>constants; numbers like <code>1e-6</code> are allowed</td></tr>
<tr><td><code>sin cos tan sec csc cot</code></td><td>trigonometric functions and their inverses <code>asin</code> …</td></tr>
<tr><td><code>sinh cosh tanh asinh</code> …</td><td>hyperbolic functions</td></tr>
<tr><td><code>exp log ln log10 sqrt abs sign</code></td><td></td></tr>
<tr><td><code>floor ceil frac</code></td><td>integer and fractional part</td></tr>
<tr><td><code>min(a,b) max(a,b)</code></td><td>e.g. tent map <code>mu min(x, 1-x)</code></td></tr>
<tr><td><code>mod(a,b)</code></td><td>a modulo b in [0, b). A map <code>mod(…, 1)</code> is treated as a circle map (rotation numbers use the lift).</td></tr>
<tr><td><code>&lt; &gt; &lt;= &gt;= == !=</code></td><td>comparisons give 1 or 0, e.g. <code>(x&lt;0.5) 2x + (x&gt;=0.5) (2-2x)</code></td></tr>
</table>
<p>Derivatives f′ (stability, Lyapunov exponents, Jacobians) are computed symbolically from the formula. Parameter values and window fields also accept expressions such as <code>1+sqrt(6)</code>.</p>`;

function aboutDialog() {
  return openDialog({
    title: 'About Iterated Maps Lab',
    body: `<p><b>Iterated Maps Lab</b> – an interactive laboratory for discrete dynamical systems: cobweb diagrams, time series and sensitive dependence, bifurcation diagrams, Lyapunov exponents, invariant densities, Lyapunov fractals, Arnold tongues and planar maps.</p>
    <p>This is a new HTML5 re-implementation <i>inspired by</i> the classic Java applets for the logistic map, Feigenbaum diagrams and chaos that were popular in teaching dynamical systems. It is not a port of any specific applet; all computations run locally in your browser.</p>
    <p>Mathematical notes: periodic points are roots of fᵏ(x) − x found by sampling and bisection; their stability is the multiplier (fᵏ)′ = ∏ f′(xᵢ). Lyapunov exponents are orbit averages of ln|f′(xₙ)| with the symbolic derivative. Rotation numbers use the lift of mod(…, 1) maps.</p>
    <p>Part of the touch-friendly math tools collection at <a href="../">dfield.tim-arnold.de</a>.</p>`,
  });
}

async function setWindowDialog() {
  const fr = frames[0];
  if (!fr) return;
  const labels = {
    cob: ['x min', 'x max', 'y min', 'y max'], ser: ['n min', 'n max', 'x min', 'x max'],
    bif: [`${S.bif.param} min`, `${S.bif.param} max`, 'x min', 'x max'], hist: ['x min', 'x max'],
    plane: ['horizontal min', 'horizontal max', 'vertical min', 'vertical max'], map2d: ['x min', 'x max', 'y min', 'y max'],
  }[fr.id];
  const box = document.createElement('div');
  box.className = 'grid2';
  const inputs = labels.map((l, i) => {
    const lab = document.createElement('label');
    lab.textContent = l;
    const inp = document.createElement('input');
    inp.inputMode = 'decimal';
    inp.value = fmtNum(fr.win[i], 10);
    box.append(lab, inp);
    return inp;
  });
  const r = await openDialog({
    title: 'Set window', body: box,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Apply', value: 'ok', primary: true }],
    validate: () => {
      let ok = true;
      inputs.forEach((i) => { try { evalConst(i.value); i.classList.remove('bad'); } catch { i.classList.add('bad'); ok = false; } });
      return ok;
    },
  });
  if (r !== 'ok') return;
  const v = inputs.map((i) => evalConst(i.value));
  const w = v.length === 2 ? [v[0], v[1], fr.win[2], fr.win[3]] : v;
  setFrameWin(fr, w);
}

// ---------------------------------------------------------------- export
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
async function shareOrDownload(blob, name, type) {
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}
function fileBase() {
  return S.view === 'map2d' ? `${S.map2d.id}-map` : `${S.map1d.id}-${S.view}`;
}
async function savePng() {
  const blob = await new Promise((res) => baseCv.toBlob(res, 'image/png'));
  if (blob) shareOrDownload(blob, `${fileBase()}.png`, 'image/png');
}
const csvNum = (v) => (Number.isFinite(v) ? String(v) : '');
function buildCsv() {
  const lines = [];
  const head = (s) => lines.push(`# ${s}`);
  if (S.view === 'map2d') {
    if (!cm2) return null;
    const m = S.map2d;
    head(`${g2(m.id).name}: x' = ${cm2.src.ex}; y' = ${cm2.src.ey}; ${cm2.src.names.map((n, i) => `${n}=${cm2.P[i]}`).join(', ')}`);
    lines.push('orbit,n,x,y');
    const o = new Float64Array(2);
    const maxPer = Math.max(1, Math.floor(2e6 / Math.max(1, m.seeds.length)));
    m.seeds.forEach(([x0, y0], si) => {
      let x = x0, y = y0;
      const tot = m.transient + Math.min(m.n, maxPer);
      for (let i = 0; i <= tot; i++) {
        if (i >= m.transient) lines.push(`${si + 1},${i},${csvNum(x)},${csvNum(y)}`);
        cm2.F(x, y, o);
        x = o[0]; y = o[1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      }
    });
    return lines.join('\n');
  }
  if (!cm1) return null;
  { const src = src1(); head(`map x -> ${src.expr}; ${src.names.map((n, i) => `${n}=${src.values[i]}`).join(', ')}`); }
  if (S.view === 'cobweb' || S.view === 'series') {
    const T = S.cob.transient;
    const n = S.cob.n;
    const F = S.view === 'cobweb' ? cobMap() : cm1.f;
    if (S.view === 'cobweb' && S.cob.cobK > 1) head(`iterating f^${S.cob.cobK}`);
    const cols = S.cob.orbits.map((o) => M.orbit1D(F, o.x0, n, T));
    const names = S.cob.orbits.map((o, i) => `x_orbit${i + 1}(x0=${o.x0})`);
    const ao = activeOrbit();
    if (S.view === 'series' && S.series.twin && ao) {
      cols.push(M.orbit1D(F, twinX0(ao), n, T));
      names.push(`x_twin(x0=${twinX0(ao)})`);
    }
    lines.push(['n', ...names].join(','));
    for (let i = 0; i <= n; i++) lines.push([T + i, ...cols.map((c) => csvNum(c[i]))].join(','));
  } else if (S.view === 'bif') {
    const j = jobs.bif;
    const src = src1();
    const k = src ? src.names.indexOf(S.bif.param) : -1;
    if (!j || k < 0) return null;
    const cm = compileMap1D(src.expr, src.names, src.values);
    const m = Math.min(64, S.bif.samples);
    const cols = Math.min(j.cols, 1000);
    head(`transient ${S.bif.transient}; columns list the last ${m} iterates`);
    lines.push([S.bif.param, 'lyapunov', cm.lift ? 'rotation_number' : null, ...Array.from({ length: m }, (_, i) => `x${i + 1}`)].filter((v) => v !== null).join(','));
    const [r0, r1] = S.bif.win;
    for (let c = 0; c < cols; c++) {
      const r = r0 + (c + 0.5) * (r1 - r0) / cols;
      cm.P[k] = r;
      const xs = M.orbit1D(cm.f, j.x0, S.bif.samples, S.bif.transient);
      const lam = M.lyapunov1D(cm.f, cm.df, j.x0, S.bif.transient, S.bif.samples);
      const row = [r, csvNum(lam)];
      if (cm.lift) row.push(csvNum(M.rotationNumber(cm.lift, j.x0, S.bif.transient, S.bif.samples)));
      for (let i = xs.length - m; i < xs.length; i++) row.push(csvNum(xs[i]));
      lines.push(row.join(','));
    }
  } else if (S.view === 'hist') {
    const r = histData();
    if (!r) return null;
    const [a, b] = S.hist.win;
    const nb = r.h.length;
    head(`orbit from x0=${activeOrbit().x0}, transient ${S.hist.transient}, ${S.hist.n} iterates`);
    lines.push('bin_left,bin_right,density');
    for (let i = 0; i < nb; i++) lines.push(`${a + (b - a) * i / nb},${a + (b - a) * (i + 1) / nb},${r.h[i]}`);
  } else if (S.view === 'plane') {
    const j = jobs.plane;
    if (!j) return null;
    const [ax0, ax1, by0, by1] = S.plane.win;
    const rot = S.plane.type === 'rot';
    // keep the file manageable (a full-resolution grid can have millions of rows)
    const stride = Math.max(1, Math.ceil(Math.sqrt(j.gw * j.gh / 250000)));
    head(`${S.plane.type}${S.plane.type === 'markus' ? ` sequence ${S.plane.seq}` : ''}; grid ${j.gw} x ${j.gh}${stride > 1 ? `, every ${stride}. pixel` : ''}; NaN = not computed or escaped`);
    lines.push([S.plane.type === 'markus' ? 'A' : S.plane.p, S.plane.type === 'markus' ? 'B' : S.plane.q, rot ? 'rotation_number,p,q' : 'lyapunov'].join(','));
    for (let jj = 0; jj < j.gh; jj += stride) {
      const b = by1 - (jj + 0.5) * (by1 - by0) / j.gh;
      for (let i = 0; i < j.gw; i += stride) {
        const a = ax0 + (i + 0.5) * (ax1 - ax0) / j.gw;
        const idx = jj * j.gw + i;
        lines.push(rot ? `${a},${b},${csvNum(j.vals[idx])},${j.qs[idx] ? j.ps[idx] : ''},${j.qs[idx] || ''}` : `${a},${b},${csvNum(j.vals[idx])}`);
      }
    }
  }
  return lines.join('\n');
}
function exportCsv() {
  let text;
  try { text = buildCsv(); } catch (e) { setStatus(`CSV export failed: ${e.message}`, true); return; }
  if (!text) { setStatus('Nothing to export yet.', true); return; }
  shareOrDownload(new Blob([text + '\n'], { type: 'text/csv' }), `${fileBase()}.csv`, 'text/csv');
}

// ---------------------------------------------------------------- menu
function buildMenu() {
  const menu = $('menuDlg');
  menu.addEventListener('click', (e) => {
    if (e.target === menu || e.target.closest('[data-close]')) { menu.close(); return; }
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    menu.close();
    const actions = {
      back: zoomBack,
      zoomOut: zoomOut2,
      reset: resetZoom,
      setWindow: setWindowDialog,
      png: savePng,
      csv: exportCsv,
      howto: () => openDialog({ title: 'How to use', body: HOWTO }),
      syntax: () => openDialog({ title: 'Expression syntax', body: SYNTAX }),
      about: aboutDialog,
      factory: async () => {
        const r = await openDialog({ title: 'Restore defaults', body: '<p>Reset all maps, orbits, windows and settings to their defaults?</p>', buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Reset', value: 'ok', primary: true }] });
        if (r !== 'ok') return;
        try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
        S = defaultState();
        stopJobs();
        jobs.bif = jobs.plane = jobs.map2d = null;
        for (const v of VIEWS) history[v] = [];
        initFromState();
      },
    };
    actions[b.dataset.action]?.();
  });
  $('optCross').onchange = (e) => { S.ui.cross = e.target.checked; saveStore(); renderOverlay(); };
  $('optGrid').onchange = (e) => { S.ui.grid = e.target.checked; saveStore(); scheduleRender(); };
  $('optFont').onchange = (e) => { S.ui.font = Number(e.target.value); saveStore(); scheduleRender(); };
}

// ---------------------------------------------------------------- init
function bindPanel() {
  for (let k = 1; k <= 8; k++) {
    $('cobK').append(new Option(k === 1 ? 'f (normal cobweb)' : `f${sup(k)}`, String(k)));
    $('perMax').append(new Option(k === 1 ? 'fixed points' : `periods 1 – ${k}`, String(k)));
  }
  // 1D map
  $('map1dSel').onchange = (e) => loadMap1D(e.target.value, true);
  $('expr1d').addEventListener('input', (e) => { S.map1d.expr = e.target.value; onMapStructure('1d'); });
  $('btnAddParam1d').onclick = () => addParam('1d');
  $('btnResetMap1d').onclick = () => loadMap1D(S.map1d.id);
  // 2D map
  $('map2dSel').onchange = (e) => loadMap2D(e.target.value);
  $('expr2dx').addEventListener('input', (e) => { S.map2d.ex = e.target.value; onMapStructure('2d'); });
  $('expr2dy').addEventListener('input', (e) => { S.map2d.ey = e.target.value; onMapStructure('2d'); });
  $('btnAddParam2d').onclick = () => addParam('2d');
  $('btnResetMap2d').onclick = () => loadMap2D(S.map2d.id);
  bindNum('n2d', () => S.map2d.n, (v) => { S.map2d.n = v; });
  bindNum('tr2d', () => S.map2d.transient, (v) => { S.map2d.transient = v; });
  $('tap2d').onchange = (e) => { S.map2d.tap = e.target.value; saveStore(); defaultStatus(); };
  $('ps2d').onchange = (e) => { S.map2d.ps = Number(e.target.value); saveStore(); scheduleRender(); };
  $('fp2d').onchange = (e) => { S.map2d.fp = e.target.checked; if (!S.map2d.fp) $('info2d').textContent = ''; fp2Cache.key = ''; saveStore(); scheduleRender(); };
  $('mono2d').onchange = (e) => { S.map2d.mono = e.target.checked; saveStore(); scheduleRender(); };
  $('btnSeeds2d').onclick = () => {
    S.map2d.seeds.push(...randomSeeds(30, S.map2d.win));
    S.map2d.tap = 'add';
    $('tap2d').value = 'add';
    saveStore(); scheduleRender();
  };
  $('btnClear2d').onclick = () => { S.map2d.seeds = []; saveStore(); scheduleRender(); defaultStatus(); };
  $('btnMore2d').onclick = () => {
    S.map2d.n = Math.min(5000000, S.map2d.n * 2);
    $('n2d')._sync();
    saveStore(); scheduleRender();
  };
  // orbits
  $('btnAddOrbit').onclick = () => addOrbit();
  $('btnTwinOrbit').onclick = () => { const o = activeOrbit(); if (o) addOrbit(o.x0 + S.series.delta); };
  $('btnClearOrbits').onclick = () => {
    const o = activeOrbit();
    S.cob.orbits = [o ? { ...o } : { x0: g1(S.map1d.id).x0, c: 0 }];
    S.cob.active = 0;
    renderOrbitList(); saveStore(); scheduleRender();
  };
  bindNum('nIter', () => S.cob.n, (v) => { S.cob.n = v; anim.step = null; stopAnim(); });
  bindNum('nTrans', () => S.cob.transient, (v) => { S.cob.transient = v; });
  $('optDelay').onchange = (e) => {
    S.cob.delay = Number(e.target.value);
    saveStore();
    if (anim.playing) { stopAnim(); togglePlay(); }
  };
  $('cobK').onchange = (e) => { S.cob.cobK = Number(e.target.value); if (!S.cob.ks.includes(S.cob.cobK)) S.cob.ks.push(S.cob.cobK); syncSelects(); saveStore(); scheduleRender(); };
  $('perMax').onchange = (e) => { S.cob.perMax = Number(e.target.value); saveStore(); perCache.key = ''; if (!S.cob.perMax) renderPerList([]); scheduleRender(); };
  $('cobSeries').onchange = (e) => { S.cob.series = e.target.checked; saveStore(); scheduleRender(); };
  const cobX = (i) => (v) => {
    const w = S.cob.win;
    if (i === 0 ? v >= w[1] : v <= w[0]) return false;
    pushHistory();
    w[i] = v; w[i + 2] = v;
    return true;
  };
  bindNum('cobXmin', () => S.cob.win[0], cobX(0));
  bindNum('cobXmax', () => S.cob.win[1], cobX(1));
  // series
  $('twin').onchange = (e) => { S.series.twin = e.target.checked; saveStore(); scheduleRender(); };
  bindNum('twinDelta', () => S.series.delta, (v) => { S.series.delta = v; });
  // bifurcation
  $('bifParam').onchange = (e) => {
    S.bif.param = e.target.value;
    const p = S.map1d.params[paramIndex1(S.bif.param)];
    if (p) { pushHistory(); S.bif.win[0] = p.min; S.bif.win[1] = p.max; }
    updateBifLabels(); syncWindowInputs(); saveStore(); scheduleRender();
  };
  bindNum('bifRmin', () => S.bif.win[0], winSetter(() => S.bif.win, 0, 1, false));
  bindNum('bifRmax', () => S.bif.win[1], winSetter(() => S.bif.win, 1, 0, true));
  bindNum('bifXmin', () => S.bif.win[2], winSetter(() => S.bif.win, 2, 3, false));
  bindNum('bifXmax', () => S.bif.win[3], winSetter(() => S.bif.win, 3, 2, true));
  bindNum('bifTrans', () => S.bif.transient, (v) => { S.bif.transient = v; });
  bindNum('bifSamples', () => S.bif.samples, (v) => { S.bif.samples = v; });
  $('bifStarts').onchange = (e) => { S.bif.starts = Number(e.target.value); saveStore(); scheduleRender(); };
  $('bifStrip').onchange = (e) => { S.bif.strip = e.target.value; saveStore(); scheduleRender(); };
  $('bifFeig').onchange = (e) => { S.bif.feig = e.target.checked; saveStore(); scheduleRender(); };
  $('bifFollow').onchange = (e) => { S.bif.follow = e.target.checked; saveStore(); scheduleRender(); };
  // histogram
  bindNum('histN', () => S.hist.n, (v) => { S.hist.n = v; });
  bindNum('histTrans', () => S.hist.transient, (v) => { S.hist.transient = v; });
  bindNum('histBins', () => S.hist.bins, (v) => { S.hist.bins = v; });
  bindNum('histXmin', () => S.hist.win[0], winSetter(() => S.hist.win, 0, 1, false));
  bindNum('histXmax', () => S.hist.win[1], winSetter(() => S.hist.win, 1, 0, true));
  $('histExact').onchange = (e) => { S.hist.exact = e.target.checked; saveStore(); scheduleRender(); };
  $('histLog').onchange = (e) => { S.hist.log = e.target.checked; saveStore(); scheduleRender(); };
  // parameter plane
  $('plType').onchange = (e) => {
    S.plane.type = e.target.value;
    const names = S.map1d.params.map((p) => p.name);
    if (S.plane.type !== 'markus' && S.plane.p === S.plane.q && names.length > 1) {
      S.plane.q = names.find((n) => n !== S.plane.p);
    }
    const pa = S.map1d.params[paramIndex1(S.plane.p)];
    const pb = S.map1d.params[paramIndex1(S.plane.type === 'markus' ? S.plane.p : S.plane.q)];
    if (pa && pb) { pushHistory(); S.plane.win = [pa.min, pa.max, pb.min, pb.max]; }
    syncSelects(); syncWindowInputs(); saveStore(); scheduleRender();
  };
  $('plSeq').addEventListener('change', (e) => {
    const v = e.target.value.toUpperCase().replace(/[^AB]/g, '');
    e.target.value = v || 'AB';
    S.plane.seq = v || 'AB';
    saveStore(); scheduleRender();
  });
  $('plP').onchange = (e) => { S.plane.p = e.target.value; updateBifLabels(); saveStore(); scheduleRender(); };
  $('plQ').onchange = (e) => { S.plane.q = e.target.value; updateBifLabels(); saveStore(); scheduleRender(); };
  bindNum('plXmin', () => S.plane.win[0], winSetter(() => S.plane.win, 0, 1, false));
  bindNum('plXmax', () => S.plane.win[1], winSetter(() => S.plane.win, 1, 0, true));
  bindNum('plYmin', () => S.plane.win[2], winSetter(() => S.plane.win, 2, 3, false));
  bindNum('plYmax', () => S.plane.win[3], winSetter(() => S.plane.win, 3, 2, true));
  bindNum('plTrans', () => S.plane.transient, (v) => { S.plane.transient = v; });
  bindNum('plN', () => S.plane.n, (v) => { S.plane.n = v; });
  $('plRes').onchange = (e) => { S.plane.res = Number(e.target.value); saveStore(); scheduleRender(); };
  // bottom actions
  $('btnResetView').onclick = resetZoom;
  $('btnRecompute').onclick = () => {
    if (S.view === 'bif') jobs.bif = null;
    if (S.view === 'plane') jobs.plane = null;
    if (S.view === 'map2d') jobs.map2d = null;
    scheduleRender();
  };
  document.querySelectorAll('.close-panel').forEach((b) => { b.onclick = closePanel; });
}

function initFromState() {
  compile1();
  compile2();
  syncMapUI1();
  syncMapUI2();
  fillParamSelects();
  syncSelects();
  if (!narrow.matches) $('panel').classList.toggle('hidden-wide', !!S.ui.panelHidden);
  setView(S.view);
}

function onResize() {
  resizeCanvases();
  renderBase();
  renderOverlay();
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') && a.type !== 'checkbox' && a.type !== 'range';
}

function init() {
  loadStore();
  fillGallerySelects();
  bindPanel();
  buildMenu();

  $('btnPanel').onclick = togglePanel;
  $('scrim').onclick = closePanel;
  narrow.addEventListener('change', () => { closePanel(); if (!narrow.matches) $('panel').classList.toggle('hidden-wide', !!S.ui.panelHidden); });
  document.querySelectorAll('#viewSeg button').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
  $('btnStep').onclick = () => stepOnce(1);
  $('btnPlay').onclick = togglePlay;
  $('btnBack').onclick = zoomBack;
  $('btnMenu').onclick = () => $('menuDlg').showModal();

  overCv.addEventListener('pointerdown', onPointerDown);
  overCv.addEventListener('pointermove', onPointerMove);
  overCv.addEventListener('pointerup', onPointerUp);
  overCv.addEventListener('pointercancel', onPointerUp);
  overCv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) { hover = null; $('coords').textContent = ''; renderOverlay(); }
  });
  overCv.addEventListener('wheel', onWheel, { passive: false });
  overCv.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { showAll(); stopJobs(); closePanel(); return; }
    if (isTyping()) return;
    const k = e.key;
    if (k >= '1' && k <= '6') { setView(VIEWS[Number(k) - 1]); e.preventDefault(); }
    else if (k === 'ArrowRight') { stepOnce(1); e.preventDefault(); }
    else if (k === 'ArrowLeft') { stepOnce(-1); e.preventDefault(); }
    else if (k === ' ') { togglePlay(); e.preventDefault(); }
    else if (k === 'Backspace') { zoomBack(); e.preventDefault(); }
  });

  new ResizeObserver(() => onResize()).observe(wrap);
  resizeCanvases();
  if (narrow.matches) closePanel();
  initFromState();
}

init();
window.__maps = { S: () => S, jobs, frames: () => frames, pool, render: renderBase };
