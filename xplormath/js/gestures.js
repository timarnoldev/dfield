// Unified pointer gestures: one-finger / left-mouse drag, two-finger pinch +
// pan, right/middle/shift-drag pan, wheel, tap and double tap.
// Handlers receive coordinates in CSS pixels relative to the element.

export class Gestures {
  constructor(el, target) {
    this.el = el;
    this.target = target; // object with optional onDrag, onPan, onPinch, onWheel, onTap, onDoubleTap, onStart, onEnd
    this.pointers = new Map();
    this.mode = null;
    this.lastTap = 0;
    this.samples = [];
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  call(name, ...args) {
    const t = this.target;
    if (t && typeof t[name] === 'function') t[name](...args);
  }

  pos(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    this.el.setPointerCapture?.(e.pointerId);
    const p = this.pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.mode = (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) || e.shiftKey ? 'pan' : 'drag';
      this.start = { ...p, t: performance.now() };
      this.moved = false;
      this.samples = [];
      this.call('onStart', p, e);
      this.el.classList.add('grabbing');
    } else if (this.pointers.size === 2) {
      this.mode = 'pinch';
      this.moved = true;
      this.pinchBase = this.pinchState();
    }
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') this.call('onHover', this.pos(e));
      return;
    }
    const p = this.pos(e);
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, p);
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const s = this.pinchState();
      const b = this.pinchBase;
      this.call('onPinch', s.d / b.d, s.cx, s.cy);
      this.call('onPan', s.cx - b.cx, s.cy - b.cy, true);
      this.pinchBase = s;
      return;
    }
    if (this.pointers.size !== 1) return;
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (!this.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) < 6) return;
    this.moved = true;
    const now = performance.now();
    this.samples.push({ dx, dy, t: now });
    while (this.samples.length && now - this.samples[0].t > 90) this.samples.shift();
    if (this.mode === 'pan') this.call('onPan', dx, dy, false);
    else this.call('onDrag', dx, dy, p);
  }

  up(e, cancel = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1 && this.mode === 'pinch') {
      // continue with one finger without a jump
      this.mode = 'drag';
      this.samples = [];
      return;
    }
    if (this.pointers.size > 0) return;
    this.el.classList.remove('grabbing');
    const p = this.pos(e);
    const now = performance.now();
    if (!cancel && !this.moved && now - this.start.t < 400) {
      if (now - this.lastTap < 320 && Math.hypot(p.x - this.lastTapPos.x, p.y - this.lastTapPos.y) < 30) {
        this.lastTap = 0;
        this.call('onDoubleTap', p, e);
      } else {
        this.lastTap = now;
        this.lastTapPos = p;
        this.call('onTap', p, e);
      }
    }
    let vx = 0, vy = 0;
    const recent = this.samples.filter((s) => now - s.t < 90);
    if (this.mode === 'drag' && recent.length > 1) {
      const dt = Math.max(16, now - recent[0].t);
      for (const s of recent) { vx += s.dx; vy += s.dy; }
      vx /= dt; vy /= dt; // px per ms
    }
    this.mode = null;
    this.call('onEnd', vx, vy);
  }

  wheel(e) {
    e.preventDefault();
    const p = this.pos(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 30;
    // trackpad pinch arrives as ctrl+wheel
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    this.call('onWheel', factor, p.x, p.y);
  }
}
