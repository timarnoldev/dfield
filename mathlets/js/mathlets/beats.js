// Beats: sum of two cosines with nearby frequencies, envelope, phasors and sound.
import { C } from '../plot.js';
import { fmt, clamp } from '../math.js';
import { playTones } from '../audio.js';

const CARRIER = 440; // Hz used for the sound

export default {
  id: 'beats',
  title: 'Beats',
  short: 'Two cosines with close frequencies add up to a fast oscillation inside a slowly pulsing envelope. Listen to it!',
  icon: '<path d="M4 24c1-12 2-12 3 0s2 12 3 0 2-10 3 0 2 8 3 0 2-5 3 0 2 3 3 0 2-3 3 0 2 5 3 0 2 8 3 0 2 10 3 0 2 12 3 0" stroke="#1f5fd1" stroke-width="2"/><path d="M4 12c12 0 14 24 20 24s8-24 20-24" stroke="#d1342f" stroke-dasharray="3 3"/>',
  defaults: { a1: 1, a2: 1, w1: 8, w2: 9, T: 25, envelope: true, frame: 'rotating', speed: 1 },
  autoplay: true,
  hint: 'Press “Play sound” to hear the beats; drag the time cursor in the plots.',
  info: `<p>Adding <span class="m">a<sub>1</sub> cos ω<sub>1</sub>t + a<sub>2</sub> cos ω<sub>2</sub>t</span> with
    <span class="m">ω<sub>1</sub> ≈ ω<sub>2</sub></span> gives, for equal amplitudes,
    <span class="m">2 cos(Δω t/2) · cos(ω̄ t)</span> with mean frequency <span class="m">ω̄ = (ω<sub>1</sub>+ω<sub>2</sub>)/2</span>
    and <span class="m">Δω = ω<sub>2</sub> − ω<sub>1</sub></span>: a fast oscillation whose amplitude varies slowly.</p>
    <p>The <strong>envelope</strong> is <span class="m">|a<sub>1</sub> + a<sub>2</sub>e<sup>iΔω t</sup>|</span>, the length of the sum of the two
    rotating phasors. Loudness peaks occur every <span class="m">2π/|Δω|</span> time units: the beat frequency is the
    difference of the two frequencies.</p>
    <p><strong>Sound:</strong> both tones are transposed to about 440 Hz but keep their frequency difference
    <span class="m">Δω/2π</span> Hz, so you hear exactly the beat rhythm of the picture (one time unit = one second).
    Musicians tune instruments by making these beats disappear.</p>`,
  layout: (wide) => (wide
    ? { areas: '"sum phasor" "parts phasor"', cols: '2fr minmax(240px,1fr)', rows: '1.2fr 1fr' }
    : { areas: '"sum sum" "parts phasor"', cols: '1.3fr 1fr', rows: '1fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    let t = 0;
    let voice = null;
    const sum = env.pane('sum', { title: 'Sum x(t)', xlabel: 't', xname: 't', yname: 'x' });
    const parts = env.pane('parts', { title: 'Components (zoom around t)', xlabel: 't', xname: 't', yname: 'x' });
    const phasor = env.pane('phasor', { xmin: -2.2, xmax: 2.2, ymin: -2.2, ymax: 2.2, equal: true, title: 'Phasors', xlabel: 'Re', ylabel: 'Im' });

    const freqs = () => {
      const mean = (p.w1 + p.w2) / 2;
      return [CARRIER + (p.w1 - mean) / (2 * Math.PI), CARRIER + (p.w2 - mean) / (2 * Math.PI)];
    };
    const amps = () => { const s = Math.max(1, p.a1 + p.a2); return [p.a1 / s, p.a2 / s]; };
    const updateSound = () => { if (voice) voice.update(freqs(), amps()); };

    ui.slider('w1', { label: 'Frequency <span class="sym">ω</span>₁', min: 1, max: 30, step: 0.05, onChange: updateSound });
    ui.slider('w2', { label: 'Frequency <span class="sym">ω</span>₂', min: 1, max: 30, step: 0.05, onChange: updateSound });
    ui.slider('a1', { label: 'Amplitude <span class="sym">a</span>₁', min: 0, max: 1, step: 0.01, onChange: updateSound });
    ui.slider('a2', { label: 'Amplitude <span class="sym">a</span>₂', min: 0, max: 1, step: 0.01, onChange: updateSound });
    ui.slider('T', { label: 'Time window', min: 5, max: 100, step: 1 });
    ui.check('envelope', 'Show the envelope');
    ui.seg('frame', { label: 'Phasor picture', options: [['fixed', 'Fixed frame'], ['rotating', 'Rotating with ω̄']] });
    ui.slider('speed', { label: 'Animation speed', min: 0.05, max: 2, log: true });
    const syncSndBtn = () => {
      const b = snd.buttons[0];
      b.textContent = voice ? '■ Stop sound' : '▶ Play sound';
      b.classList.toggle('on', !!voice);
    };
    const snd = ui.buttons([['▶ Play sound', () => {
      if (voice) { voice.stop(); voice = null; } else { voice = playTones(freqs(), amps()); env.status(voice ? 'Sound on. No sound on an iPad/iPhone? Check the volume and the silent (mute) switch.' : 'Sound is not available in this browser.'); }
      syncSndBtn();
    }, { primary: false }]]);
    // silence the tones when the page is hidden (tab switch, iPad home button, screen lock)
    const onVisibility = () => { if (document.hidden && voice) { voice.stop(); voice = null; syncSndBtn(); } };
    document.addEventListener('visibilitychange', onVisibility);
    const ro = ui.readout();

    sum.o.onDown = (tt) => { const s = (x) => { t = clamp(x, 0, p.T); }; s(tt); return { move: s }; };

    function draw() {
      const { a1, a2, w1, w2, T } = p;
      if (t > T) t = 0;
      const x1 = (tt) => a1 * Math.cos(w1 * tt), x2 = (tt) => a2 * Math.cos(w2 * tt);
      const env_ = (tt) => Math.sqrt(Math.max(0, a1 * a1 + a2 * a2 + 2 * a1 * a2 * Math.cos((w2 - w1) * tt)));
      const A = Math.max(0.2, a1 + a2) * 1.15;
      sum.setView(0, T, -A, A);
      sum.o.legend = [['x = x₁ + x₂', C.purple]];
      if (p.envelope) sum.o.legend.push(['envelope', C.red, [5, 4]]);
      sum.begin();
      sum.fn((tt) => x1(tt) + x2(tt), { color: C.purple, width: 1.6, res: 0.7 });
      if (p.envelope) {
        sum.fn(env_, { color: C.red, width: 2, dash: [6, 4] });
        sum.fn((tt) => -env_(tt), { color: C.red, width: 2, dash: [6, 4] });
      }
      sum.vline(t, { color: C.text, width: 1.2, dash: [4, 4] });
      sum.dot(t, x1(t) + x2(t), 5, C.purple);

      const B = Math.max(0.2, a1, a2) * 1.25;
      const W = Math.min(T, 6);
      const z0 = clamp(t - W / 2, 0, T - W);
      parts.setView(z0, z0 + W, -B, B);
      parts.o.legend = [['x₁ = a₁cos ω₁t', C.blue], ['x₂ = a₂cos ω₂t', C.orange]];
      parts.begin();
      parts.fn(x1, { color: C.blue, width: 1.6, res: 0.7 });
      parts.fn(x2, { color: C.orange, width: 1.6, res: 0.7, alpha: 0.85 });
      parts.vline(t, { color: C.text, width: 1.2, dash: [4, 4] });

      // phasors
      const R = Math.max(0.3, a1 + a2) * 1.12;
      phasor.setView(-R, R, -R, R);
      phasor.begin();
      const rot = p.frame === 'rotating' ? -((w1 + w2) / 2) * t : 0;
      const ang1 = w1 * t + rot, ang2 = w2 * t + rot;
      const P1 = [a1 * Math.cos(ang1), a1 * Math.sin(ang1)];
      const P2 = [P1[0] + a2 * Math.cos(ang2), P1[1] + a2 * Math.sin(ang2)];
      const ctx = phasor.ctx;
      ctx.strokeStyle = 'rgba(209,52,47,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(phasor.X(0), phasor.Y(0), phasor.X(env_(t)) - phasor.X(0), 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      if (Math.hypot(...P1) > 1e-3) phasor.arrow(0, 0, P1[0], P1[1], C.blue, 3, 11);
      if (a2 > 1e-3) phasor.arrow(P1[0], P1[1], P2[0], P2[1], C.orange, 3, 11);
      if (Math.hypot(...P2) > 1e-3) phasor.arrow(0, 0, P2[0], P2[1], C.purple, 2, 10);
      if (p.frame === 'fixed') {
        phasor.line(P2[0], P2[1], P2[0], 0, { color: C.gray, width: 1, dash: [3, 3] });
        phasor.dot(P2[0], 0, 5, C.purple);
      }
      phasor.text(p.frame === 'rotating' ? 'frame rotates with ω̄' : 'x(t) = real part', phasor.v.xmin, phasor.v.ymin, { dx: 6, dy: -10, color: C.muted, size: 11.5 });

      const dw = Math.abs(w2 - w1);
      const [f1, f2] = freqs();
      ro.set([
        ['Mean frequency ω̄', fmt((w1 + w2) / 2, 4)],
        ['Difference |Δω|', fmt(dw, 4)],
        ['Beat period 2π/|Δω|', dw > 1e-9 ? fmt((2 * Math.PI) / dw, 4) : '∞'],
        ['Envelope min … max', `${fmt(Math.abs(a1 - a2), 3)} … ${fmt(a1 + a2, 3)}`],
        ['Sound frequencies', `${f1.toFixed(2)} Hz, ${f2.toFixed(2)} Hz`],
        ['Audible beats per second', fmt(dw / (2 * Math.PI), 3)],
      ]);
    }
    return {
      draw,
      tick(dt) { t += dt * p.speed; if (t > p.T) t = 0; },
      destroy() { document.removeEventListener('visibilitychange', onVisibility); if (voice) voice.stop(); voice = null; syncSndBtn(); },
    };
  },
};
