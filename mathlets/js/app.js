// Mathlets – application shell: chooser, layout, persistence, animation loop, dialogs.
import { makeUI } from './controls.js';
import { Plot } from './plot.js';
import { SYNTAX_HELP } from './parser.js';
import { stopAllAudio } from './audio.js';

import fourier from './mathlets/fourier.js';
import fourierMatch from './mathlets/fourier-match.js';
import ampPhase2 from './mathlets/amp-phase-2.js';
import ampPhase1 from './mathlets/amp-phase-1.js';
import damped from './mathlets/damped.js';
import beats from './mathlets/beats.js';
import convolution from './mathlets/convolution.js';
import poles from './mathlets/poles.js';
import phasePortraits from './mathlets/phase-portraits.js';
import euler from './mathlets/euler.js';
import taylor from './mathlets/taylor.js';
import riemann from './mathlets/riemann.js';
import complexExp from './mathlets/complex-exp.js';
import aliasing from './mathlets/aliasing.js';
import heat from './mathlets/heat.js';

export const MATHLETS = [fourier, fourierMatch, ampPhase2, ampPhase1, damped, beats, convolution, poles,
  phasePortraits, euler, taylor, riemann, complexExp, aliasing, heat];

const $ = (id) => document.getElementById(id);
const LS_KEY = 'mathlets.v1';
const narrow = matchMedia('(max-width: 1023px)');

// ---------------------------------------------------------------- persistence
const store = { cur: MATHLETS[0].id, params: {}, panelHidden: false };
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s && typeof s === 'object') Object.assign(store, s);
    if (!store.params || typeof store.params !== 'object') store.params = {};
  } catch { /* ignore */ }
}
let saveTimer = 0;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* ignore */ }
  }, 200);
}

const clone = (o) => JSON.parse(JSON.stringify(o));
function paramsFor(m) {
  const saved = store.params[m.id];
  const p = clone(m.defaults);
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(p)) {
      if (k in saved && typeof saved[k] === typeof p[k] && (Array.isArray(p[k]) === Array.isArray(saved[k]))) p[k] = saved[k];
    }
  }
  return p;
}

// ---------------------------------------------------------------- current mathlet
let cur = null; // { m, p, env, inst, plots, raf }
const stage = $('stage');

function setStatus(s) { $('status').textContent = s || ''; }
function setCoords(s) { $('coords').textContent = s || ''; }

let drawPending = false;
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    if (cur && cur.inst) {
      try { cur.inst.draw(); } catch (e) { console.error(e); }
    }
  });
}

function applyLayout() {
  if (!cur) return;
  const r = stage.getBoundingClientRect();
  const wide = r.width > r.height * 1.15;
  const lay = cur.m.layout(wide, r.width, r.height);
  stage.style.gridTemplateAreas = lay.areas;
  stage.style.gridTemplateColumns = lay.cols || '1fr';
  stage.style.gridTemplateRows = lay.rows || '1fr';
  for (const pane of stage.children) pane.hidden = !lay.areas.includes(pane.dataset.area);
}

function mount(m) {
  unmount();
  store.cur = m.id;
  saveStore();
  const p = paramsFor(m);
  store.params[m.id] = p;
  const controls = $('controls');
  controls.innerHTML = '';
  stage.innerHTML = '';
  $('title').textContent = m.title;
  $('mlTitle').textContent = m.title;
  $('mlShort').textContent = m.short;
  $('mlInfo').innerHTML = m.info;
  document.title = `${m.title} – Mathlets`;
  const plots = [];
  const env = {
    p,
    defaults: m.defaults,
    redraw: requestDraw,
    changed() { saveStore(); requestDraw(); },
    coords: setCoords,
    status: setStatus,
    pane(area, opts) {
      const div = document.createElement('div');
      div.className = 'pane';
      div.dataset.area = area;
      div.style.gridArea = area;
      stage.append(div);
      const plot = new Plot(div, env, opts);
      plots.push(plot);
      return plot;
    },
    playing: false,
    setPlaying(on) { setPlaying(on); },
    animated: false,
    get narrow() { return narrow.matches; },
  };
  cur = { m, p, env, plots, inst: null };
  env.ui = makeUI(controls, env);
  applyLayout();
  cur.inst = m.create(env);
  $('btnPlay').hidden = !cur.inst.tick;
  setPlaying(!!cur.inst.tick && (p.playing ?? m.autoplay ?? false));
  setStatus(m.hint || '');
  setCoords('');
  applyLayout();
  plots.forEach((pl) => pl.resize());
  requestDraw();
  renderCards();
  if (location.hash.slice(1) !== m.id) history.replaceState(null, '', `#${m.id}`);
}

function unmount() {
  if (!cur) return;
  setPlaying(false);
  stopAllAudio();
  try { cur.inst?.destroy?.(); } catch (e) { console.error(e); }
  cur.env.ui.destroy();
  cur.plots.forEach((pl) => pl.destroy());
  cur = null;
}

function resetCurrent() {
  if (!cur) return;
  const m = cur.m;
  delete store.params[m.id];
  mount(m);
}

// ---------------------------------------------------------------- animation
let raf = 0, lastT = 0;
function setPlaying(on) {
  if (cur) cur.env.playing = on;
  const b = $('btnPlay');
  b.classList.toggle('playing', on);
  b.querySelector('.lbl').textContent = on ? 'Pause' : 'Play';
  b.title = on ? 'Pause animation (Space)' : 'Play animation (Space)';
  cancelAnimationFrame(raf);
  raf = 0;
  if (on && cur && cur.inst && cur.inst.tick) {
    lastT = performance.now();
    const loop = (now) => {
      if (!cur || !cur.env.playing) return;
      const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
      lastT = now;
      try { cur.inst.tick(dt); cur.inst.draw(); } catch (e) { console.error(e); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  if (cur && cur.inst) cur.inst.onPlay?.(on);
}

// ---------------------------------------------------------------- chooser
function renderCards() {
  const list = $('cardList');
  list.innerHTML = '';
  for (const m of MATHLETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `card${cur && cur.m === m ? ' on' : ''}`;
    b.innerHTML = `<span class="ico"><svg viewBox="0 0 48 48" aria-hidden="true">${m.icon}</svg></span>
      <span><span class="tt">${m.title}${m.bonus ? '<span class="bonus">bonus</span>' : ''}</span><span class="ds">${m.short}</span></span>`;
    b.onclick = () => { showTab('controls'); go(m.id); };
    list.append(b);
  }
}
function showTab(which) {
  const list = which === 'list';
  $('listView').hidden = !list;
  $('controlsView').hidden = list;
  $('tabList').classList.toggle('on', list);
  $('tabControls').classList.toggle('on', !list);
  $('panel').scrollTop = 0;
}
function go(id) {
  const m = MATHLETS.find((x) => x.id === id) || MATHLETS[0];
  if (cur && cur.m === m) return;
  mount(m);
}

// ---------------------------------------------------------------- panel
function setPanelHidden(hidden) {
  store.panelHidden = hidden;
  $('panel').classList.toggle('hidden-wide', hidden);
  $('btnPanel').classList.toggle('on', !hidden);
  saveStore();
}

// ---------------------------------------------------------------- dialogs
const dlg = $('dlg');
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); }); // tap on the backdrop closes
function openDialog({ title, body, buttons = [{ label: 'OK', value: 'ok', primary: true }] }) {
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
      bb.append(el);
    }
    dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
    dlg.returnValue = '';
    dlg.showModal();
  });
}

function aboutDialog() {
  openDialog({
    title: 'About Mathlets',
    body: `<p><strong>Mathlets</strong> is a collection of small interactive demonstrations for calculus,
      differential equations and signals &amp; systems courses: Fourier series, resonance and phase lag,
      damped vibrations, convolution, poles and transfer functions, linear phase portraits, Euler's method,
      Taylor polynomials, Riemann sums and more.</p>
      <p>The collection is <em>inspired by</em> the <strong>MIT Mathlets</strong> created by Haynes Miller and
      collaborators at the Massachusetts Institute of Technology (mathlets.org), and by classic Java
      applets used in mathematics teaching. It is an independent re-implementation written from scratch
      in plain HTML5/JavaScript: no MIT code, graphics or other assets are used. All mistakes are ours.</p>
      <p>Designed for touch screens (iPad) as well as mouse and keyboard. All computations run locally in
      your browser; settings are stored on this device only.</p>`,
  });
}
function helpDialog() {
  openDialog({
    title: 'Using the mathlets',
    body: `<ul>
      <li><strong>Choose</strong> a mathlet with the <em>Mathlets</em> button or the <em>All mathlets</em> tab. Every
        mathlet has its own link (e.g. <code>#fourier</code>) that you can bookmark or share.</li>
      <li><strong>Handles:</strong> round knobs in the pictures can be dragged with a finger or the mouse
        (poles, centers, start points, the current time or frequency, …).</li>
      <li><strong>Sliders:</strong> tap anywhere on a track or drag the knob. Tap the number to type an exact value.
        With a keyboard, focus a slider and use the arrow keys (Shift = bigger steps).</li>
      <li><strong>Play / Pause</strong> (or the Space key) runs the animation where available.</li>
      <li><strong>Reset</strong> restores the default settings of the current mathlet. Everything else is remembered on this device.</li>
      <li>On narrow screens (iPad portrait) the controls sit below the pictures; the <em>Controls</em> button hides them to enlarge the plots.</li>
      <li>Tip: in Safari use Share → “Add to Home Screen” to run the mathlets full screen.</li></ul>`,
  });
}
function syntaxDialog() {
  const pre = document.createElement('pre');
  pre.textContent = SYNTAX_HELP;
  openDialog({ title: 'Expression syntax', body: pre });
}

function savePng() {
  if (!cur) return;
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = Math.round(r.width * dpr);
  out.height = Math.round(r.height * dpr);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#dfe1e4';
  ctx.fillRect(0, 0, out.width, out.height);
  for (const pl of cur.plots) {
    if (pl.host.hidden) continue;
    const pr = pl.cv.getBoundingClientRect();
    ctx.drawImage(pl.cv, (pr.left - r.left) * dpr, (pr.top - r.top) * dpr, pr.width * dpr, pr.height * dpr);
  }
  out.toBlob(async (blob) => {
    const name = `mathlet-${cur.m.id}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file] }); return; } catch { /* fall back */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
}

async function resetAll() {
  const r = await openDialog({
    title: 'Reset all mathlets',
    body: '<p>Restore the default settings of every mathlet?</p>',
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Reset all', value: 'ok', primary: true }],
  });
  if (r !== 'ok') return;
  store.params = {};
  const m = cur ? cur.m : MATHLETS[0];
  cur && unmount();
  mount(m);
}

function buildMenu() {
  const menu = $('menuDlg');
  menu.querySelector('[data-close]').onclick = () => menu.close();
  menu.addEventListener('click', (e) => { if (e.target === menu) menu.close(); });
  const actions = {
    reset: resetCurrent,
    savePng,
    copyLink: async () => {
      const url = location.href;
      try { await navigator.clipboard.writeText(url); setStatus('Link copied: ' + url); } catch { openDialog({ title: 'Link', body: `<p>${url}</p>` }); }
    },
    chooser: () => { setPanelHidden(false); showTab('list'); },
    resetAll,
    help: helpDialog,
    syntax: syntaxDialog,
    about: aboutDialog,
  };
  menu.querySelectorAll('[data-action]').forEach((b) => {
    b.onclick = () => { menu.close(); actions[b.dataset.action](); };
  });
}

// ---------------------------------------------------------------- init
function init() {
  loadStore();
  buildMenu();
  setPanelHidden(!!store.panelHidden);
  $('btnPanel').onclick = () => setPanelHidden(!$('panel').classList.contains('hidden-wide'));
  $('btnChooser').onclick = () => {
    const listShown = !$('listView').hidden;
    if (listShown && !store.panelHidden) showTab('controls');
    else { setPanelHidden(false); showTab('list'); }
  };
  $('title').onclick = () => { setPanelHidden(false); showTab('list'); };
  $('tabControls').onclick = () => showTab('controls');
  $('tabList').onclick = () => showTab('list');
  $('btnReset').onclick = resetCurrent;
  $('btnPlay').onclick = () => setPlaying(!(cur && cur.env.playing));
  $('btnMenu').onclick = () => $('menuDlg').showModal();
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === ' ' && cur && cur.inst.tick && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); setPlaying(!cur.env.playing); }
  });
  // iOS: block page-level pinch zoom / double-tap zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  new ResizeObserver(() => { applyLayout(); requestDraw(); }).observe(stage);
  narrow.addEventListener('change', () => { applyLayout(); requestDraw(); });
  const hash = location.hash.slice(1);
  const first = MATHLETS.find((x) => x.id === hash) || MATHLETS.find((x) => x.id === store.cur) || MATHLETS[0];
  mount(first);
  if (!hash && !localStorage.getItem(LS_KEY + '.seen')) {
    showTab('list');
    try { localStorage.setItem(LS_KEY + '.seen', '1'); } catch { /* ignore */ }
  }
  window.__mathlets = { MATHLETS, go, get cur() { return cur; } };
}

init();
