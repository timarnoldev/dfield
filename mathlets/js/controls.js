// Panel controls bound to a mathlet's parameter object.
import { compile, ParseError } from './parser.js';
import { clamp } from './math.js';

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function parseNum(s) {
  const t = String(s).trim().replace(/−/g, '-').replace(/,/g, '.');
  if (!t) return NaN;
  if (/^[-+]?pi$/i.test(t)) return (t.startsWith('-') ? -1 : 1) * Math.PI;
  return Number(t);
}

function decimalsOf(step) {
  if (!step || step >= 1) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

export function makeUI(container, env) {
  const ctls = [];
  const cleanups = []; // run when the mathlet is unmounted
  const p = env.p;
  const changed = () => env.changed();
  let uid = 0;
  const id = () => `ctl${++uid}_${Math.random().toString(36).slice(2, 6)}`;

  const ui = {
    root: container,
    section(title) {
      const e = h('div', 'ctl-section', title);
      container.append(e);
      return e;
    },
    note(html) {
      const e = h('p', 'note', html);
      container.append(e);
      return e;
    },
    html(html, cls = '') {
      const e = h('div', cls, html);
      container.append(e);
      return e;
    },

    /**
     * Slider bound to p[key]. o: label, min, max, step, digits, log, onChange(v), format(v)
     */
    slider(key, o) {
      const wrap = h('div', o.compact ? 'ctl compact' : 'ctl');
      const head = h('div', 'slider-head');
      const lid = id();
      const label = h('label', '', o.label ?? key);
      label.htmlFor = lid;
      const val = h('input', 'val');
      val.id = lid;
      val.setAttribute('inputmode', 'decimal');
      val.setAttribute('autocomplete', 'off');
      val.setAttribute('aria-label', (o.aria || key) + ' value');
      head.append(label, val);
      const sl = h('div', 'slider');
      sl.tabIndex = 0;
      sl.setAttribute('role', 'slider');
      sl.setAttribute('aria-label', o.aria || key);
      const track = h('div', 'track'), fill = h('div', 'fillbar'), thumb = h('div', 'thumb');
      sl.append(track, fill);
      let zero = null;
      if (!o.log && o.min < 0 && o.max > 0) { zero = h('div', 'zero'); sl.append(zero); }
      sl.append(thumb);
      wrap.append(head, sl);
      container.append(wrap);
      const digits = o.digits ?? decimalsOf(o.step);
      // repair stored values that are out of range (old / corrupted local storage)
      if (!Number.isFinite(p[key])) p[key] = env.defaults?.[key] ?? o.min;
      p[key] = clamp(p[key], o.min, o.max);
      const toT = (v) => (o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min));
      const fromT = (t) => {
        t = clamp(t, 0, 1);
        let v = o.log ? o.min * (o.max / o.min) ** t : o.min + t * (o.max - o.min);
        if (o.step && !o.log) v = Math.round((v - o.min) / o.step) * o.step + o.min;
        if (o.log) { const m = 10 ** (Math.floor(Math.log10(v)) - 2); v = Math.round(v / m) * m; }
        return Number(clamp(v, o.min, o.max).toFixed(Math.max(digits, o.log ? 6 : 0)));
      };
      const show = (v) => {
        const t = clamp(toT(v), 0, 1);
        const W = sl.clientWidth - 28;
        thumb.style.left = `${14 + t * W}px`;
        const t0 = zero ? toT(0) : 0;
        fill.style.left = `${14 + Math.min(t, t0) * W}px`;
        fill.style.width = `${Math.abs(t - t0) * W}px`;
        if (zero) zero.style.left = `${14 + t0 * W}px`;
        if (document.activeElement !== val) val.value = (o.format ? o.format(v) : o.log && o.digits === undefined ? String(Number(Number(v).toPrecision(3))) : Number(v).toFixed(digits)).replace(/^-/, '−');
        sl.setAttribute('aria-valuenow', String(v));
      };
      const set = (v, fire = true) => {
        if (!Number.isFinite(v)) return;
        p[key] = v;
        show(v);
        if (fire) { o.onChange?.(v); changed(); }
      };
      let dragging = null;
      const tFromEvent = (e) => {
        const r = sl.getBoundingClientRect();
        return (e.clientX - r.left - 14) / (r.width - 28);
      };
      sl.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        dragging = { id: e.pointerId, x0: e.clientX, y0: e.clientY, started: e.pointerType === 'mouse' };
        try { sl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        if (dragging.started) { sl.classList.add('dragging'); set(fromT(tFromEvent(e))); }
      });
      sl.addEventListener('pointermove', (e) => {
        if (!dragging || dragging.id !== e.pointerId) return;
        if (!dragging.started) {
          if (Math.abs(e.clientY - dragging.y0) > 10) dragging.scroll = true; // vertical swipe: not a tap
          if (dragging.scroll || Math.abs(e.clientX - dragging.x0) < 4) return;
          dragging.started = true;
          sl.classList.add('dragging');
        }
        set(fromT(tFromEvent(e)));
      });
      const end = (e) => {
        if (!dragging || dragging.id !== e.pointerId) return;
        if (!dragging.started && !dragging.scroll && e.type === 'pointerup') set(fromT(tFromEvent(e))); // tap on track
        dragging = null;
        sl.classList.remove('dragging');
        o.onEnd?.();
      };
      sl.addEventListener('pointerup', end);
      sl.addEventListener('pointercancel', (e) => { if (dragging && dragging.id === e.pointerId) { dragging = null; sl.classList.remove('dragging'); } });
      sl.addEventListener('keydown', (e) => {
        const step = o.log ? null : (o.step || (o.max - o.min) / 100);
        const cur = p[key];
        let v = null;
        const big = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = o.log ? fromT(toT(cur) + 0.01 * big) : cur + step * big;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = o.log ? fromT(toT(cur) - 0.01 * big) : cur - step * big;
        else if (e.key === 'Home') v = o.min;
        else if (e.key === 'End') v = o.max;
        if (v !== null) {
          e.preventDefault();
          set(Number(clamp(v, o.min, o.max).toFixed(Math.max(digits, o.log ? 6 : 0))));
        }
      });
      const commit = () => {
        const v = parseNum(val.value);
        if (Number.isFinite(v)) set(clamp(v, o.min, o.max));
        val.classList.remove('bad');
        show(p[key]);
      };
      val.addEventListener('change', commit);
      val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); val.blur(); } });
      val.addEventListener('input', () => val.classList.toggle('bad', !Number.isFinite(parseNum(val.value))));
      val.addEventListener('blur', () => show(p[key]));
      const ro = new ResizeObserver(() => show(p[key]));
      ro.observe(sl);
      cleanups.push(() => ro.disconnect());
      const ctl = { key, el: wrap, sync: () => show(p[key]), set: (v) => set(v, false), setFire: (v) => set(v), o };
      show(p[key]);
      ctls.push(ctl);
      return ctl;
    },

    select(key, o) {
      const wrap = h('div', 'ctl');
      const row = h('div', 'ctl-row');
      const lid = id();
      const label = h('label', '', o.label);
      label.htmlFor = lid;
      const sel = h('select');
      sel.id = lid;
      for (const [v, t] of o.options) { const op = h('option', '', t); op.value = v; sel.append(op); }
      if (!o.options.some(([v]) => v === String(p[key]))) p[key] = env.defaults?.[key] ?? o.options[0][0];
      row.append(label, sel);
      wrap.append(row);
      container.append(wrap);
      sel.onchange = () => { p[key] = sel.value; o.onChange?.(sel.value); changed(); };
      const ctl = { key, el: wrap, sel, sync: () => { sel.value = p[key]; } };
      ctl.sync();
      ctls.push(ctl);
      return ctl;
    },

    seg(key, o) {
      const wrap = h('div', 'ctl');
      if (o.label) wrap.append(h('div', 'ctl-label', o.label));
      const seg = h('div', 'seg seg-wide');
      if (!o.multi && !o.options.some(([v]) => v === String(p[key]))) p[key] = env.defaults?.[key] ?? p[key];
      seg.setAttribute('role', 'radiogroup');
      const btns = o.options.map(([v, t]) => {
        const b = h('button', '', t);
        b.type = 'button';
        b.dataset.v = v;
        b.setAttribute('role', 'radio');
        b.onclick = () => {
          const val = typeof p[key] === 'number' ? Number(v) : v;
          p[key] = val;
          ctls.forEach((c) => { if (c.key === key) c.sync(); });
          o.onChange?.(val);
          changed();
        };
        seg.append(b);
        return b;
      });
      wrap.append(seg);
      container.append(wrap);
      const ctl = {
        key, el: wrap,
        sync: () => btns.forEach((b) => { const on = String(p[key]) === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }),
      };
      ctl.sync();
      ctls.push(ctl);
      return ctl;
    },

    check(key, label, o = {}) {
      const wrap = h('label', 'check ctl');
      const cb = h('input');
      cb.type = 'checkbox';
      wrap.append(cb, h('span', '', label));
      container.append(wrap);
      cb.onchange = () => { p[key] = cb.checked; o.onChange?.(cb.checked); changed(); };
      const ctl = { key, el: wrap, sync: () => { cb.checked = !!p[key]; } };
      ctl.sync();
      ctls.push(ctl);
      return ctl;
    },

    /** Expression input bound to p[key]; o: pre (text before), vars, onValid(fn) */
    expr(key, o) {
      const wrap = h('div', 'ctl');
      if (o.label) wrap.append(h('div', 'ctl-label', o.label));
      const line = h('div', 'expr-line');
      if (o.pre) line.append(h('span', 'pre', o.pre));
      const inp = h('input', 'expr');
      inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('autocorrect', 'off');
      inp.spellcheck = false;
      inp.setAttribute('aria-label', o.aria || key);
      line.append(inp);
      const err = h('div', 'err');
      wrap.append(line, err);
      container.append(wrap);
      const validate = (fire) => {
        try {
          const fn = compile(inp.value, o.vars || ['x']);
          if (o.check) o.check(fn);
          inp.classList.remove('bad');
          err.textContent = '';
          p[key] = inp.value.trim();
          if (fire) { o.onValid?.(fn); changed(); }
          return fn;
        } catch (e) {
          inp.classList.add('bad');
          err.textContent = e instanceof ParseError || e.message ? e.message : String(e);
          return null;
        }
      };
      let timer = 0;
      cleanups.push(() => clearTimeout(timer));
      inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => validate(true), 250); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); validate(true); inp.blur(); } });
      const ctl = {
        key, el: wrap, input: inp,
        sync: () => { if (document.activeElement !== inp) { inp.value = p[key]; inp.classList.remove('bad'); err.textContent = ''; } },
        validate,
      };
      ctl.sync();
      ctls.push(ctl);
      return ctl;
    },

    buttons(list) {
      const row = h('div', 'btn-row');
      const out = list.map(([label, fn, opt = {}]) => {
        const b = h('button', opt.primary ? 'primary' : '', label);
        b.type = 'button';
        if (opt.title) b.title = opt.title;
        b.onclick = () => { fn(b); env.changed(); };
        row.append(b);
        return b;
      });
      container.append(row);
      return { el: row, buttons: out };
    },

    readout() {
      const box = h('div', 'readout');
      container.append(box);
      let last = '';
      return {
        el: box,
        set(rows) {
          const html = rows.map((r) => {
            if (!r) return '';
            if (r.wide !== undefined) return `<div class="wide">${r.wide}</div>`;
            const [k, v, color] = r;
            return `<div class="k">${k}</div><div class="v"${color ? ` style="color:${color}"` : ''}>${v}</div>`;
          }).join('');
          if (html !== last) { box.innerHTML = html; last = html; }
        },
      };
    },

    sync() { ctls.forEach((c) => c.sync()); },
    destroy() { cleanups.forEach((f) => f()); cleanups.length = 0; },
    ctl(key) { return ctls.find((c) => c.key === key); },
  };
  return ui;
}
