// Sampling and aliasing of cos(2π f t).
import { C } from '../plot.js';
import { fmt, clamp } from '../math.js';

const TW = 2; // seconds shown

/** Apparent (aliased) frequency in [0, fs/2] of a cosine with frequency f sampled at rate fs. */
export function aliasFreq(f, fs) {
  const r = f - fs * Math.round(f / fs);
  return Math.abs(r);
}

export default {
  id: 'aliasing',
  title: 'Sampling & Aliasing',
  bonus: true,
  short: 'Sample a cosine too slowly and it masquerades as a lower frequency. Nyquist: sample faster than 2f.',
  icon: '<path d="M4 24c2-14 4-14 6 0s4 14 6 0 4-14 6 0 4 14 6 0 4-14 6 0 4 14 6 0" stroke="#a7afb9"/><path d="M4 24c10-18 26-18 40 0" stroke="#d1342f" stroke-dasharray="3 3"/><path d="M10 24v-8M22 24v-10M34 24v-8" stroke="#1f5fd1" stroke-width="3"/>',
  defaults: { f: 4.5, fs: 5, phase: 0, showAlias: true },
  hint: 'Drag the signal frequency f or the sampling rate in the frequency plot.',
  info: `<p>A signal <span class="m">x(t) = cos(2πft + φ)</span> is measured only at the sampling instants <span class="m">t<sub>k</sub> = k/f<sub>s</sub></span>.
    Cosines whose frequencies differ by a multiple of <span class="m">f<sub>s</sub></span> (or are mirror images about such a multiple)
    produce <em>exactly the same samples</em>.</p>
    <p>The samples are therefore also explained by the lowest such frequency, the <strong>alias</strong>
    <span class="m">f<sub>a</sub> = |f − f<sub>s</sub>·round(f/f<sub>s</sub>)|</span>, which always lies in <span class="m">[0, f<sub>s</sub>/2]</span>.
    The original signal is recovered only if <span class="m">f &lt; f<sub>s</sub>/2</span> — the <strong>Nyquist–Shannon</strong> condition.
    That is why audio CDs sample at 44.1 kHz, a bit more than twice the highest audible frequency; and why wagon wheels in films seem to turn backwards.</p>`,
  layout: (wide) => (wide ? { areas: '"time" "freq"', rows: '1.5fr 1fr' } : { areas: '"time" "freq"', rows: '1.4fr 1fr' }),

  create(env) {
    const p = env.p, ui = env.ui;
    const time = env.pane('time', { xmin: 0, xmax: TW, ymin: -1.35, ymax: 1.35, title: 'Signal and samples', xlabel: 't (s)', xname: 't' });
    const freq = env.pane('freq', { xmin: 0, xmax: 20, ymin: 0, ymax: 1.4, title: 'Frequency axis', xlabel: 'f (Hz)', xname: 'f', noYLabels: true, grid: true });

    ui.slider('f', { label: 'Signal frequency <span class="sym">f</span> (Hz)', min: 0, max: 20, step: 0.05 });
    ui.slider('fs', { label: 'Sampling rate <span class="sym">f</span><sub>s</sub> (samples/s)', min: 1, max: 40, step: 0.1 });
    ui.slider('phase', { label: 'Phase <span class="sym">φ</span>', min: -3.14, max: 3.14, step: 0.01 });
    ui.check('showAlias', 'Show the alias that fits the samples');
    const ro = ui.readout();

    freq.handles = [
      { pos: () => [p.f, 1], drag: (x) => { p.f = Number(clamp(x, 0, 20).toFixed(2)); ui.sync(); }, cursor: 'ew-resize' },
      { pos: () => [Math.min(p.fs, 20), 0.35], drag: (x) => { p.fs = Number(clamp(x, 1, 40).toFixed(1)); ui.sync(); }, cursor: 'ew-resize' },
    ];

    function draw() {
      const { f, fs, phase } = p;
      const fa = aliasFreq(f, fs);
      // sign of the alias phase: mirrored frequencies flip the phase
      const k = Math.round(f / fs);
      const sgn = f - fs * k >= 0 ? 1 : -1;
      const sig = (t) => Math.cos(2 * Math.PI * f * t + phase);
      const ali = (t) => Math.cos(2 * Math.PI * fa * t + sgn * phase);
      const ok = f < fs / 2;
      time.o.legend = [['signal', C.blue]];
      if (p.showAlias) time.o.legend.push([`alias ${fmt(fa, 3)} Hz`, C.red, [6, 4]]);
      time.o.legend.push(['samples', C.text]);
      time.begin();
      time.fn(sig, { color: C.blue, width: 2, res: 0.6 });
      if (p.showAlias) time.fn(ali, { color: C.red, width: 2.4, dash: [7, 5] });
      const n = Math.floor(TW * fs);
      for (let i = 0; i <= n; i++) {
        const t = i / fs, v = sig(t);
        time.line(t, 0, t, v, { color: C.text, width: 1.5 });
        time.dot(t, v, 4.5, C.text, '#fff');
      }

      freq.begin();
      const ctx = freq.ctx;
      // Nyquist band
      ctx.fillStyle = 'rgba(29,138,58,.10)';
      ctx.fillRect(freq.X(0), freq.L.top, freq.X(Math.min(fs / 2, 20)) - freq.X(0), freq.L.h);
      freq.vline(fs / 2, { color: C.green, width: 1.5, dash: [5, 4] });
      freq.text(`fₛ/2 = ${fmt(fs / 2, 3)}`, Math.min(fs / 2, 19.5), 1.3, { dx: 4, color: C.green, bold: true, size: 12 });
      // images of f: ±f + m fs
      for (let m = -3; m <= 6; m++) for (const s of [1, -1]) {
        const x = s * f + m * fs;
        if (x < 0 || x > 20 || (m === 0 && s === 1)) continue;
        freq.line(x, 0, x, 0.6, { color: C.gray, width: 2, alpha: 0.6 });
      }
      freq.line(fa, 0, fa, 0.8, { color: C.red, width: 4 });
      freq.text('alias', fa, 0.8, { dy: -10, align: 'center', color: C.red, bold: true, size: 12 });
      freq.line(p.f, 0, p.f, 1, { color: C.blue, width: 4 });
      freq.knob(p.f, 1, C.blue);
      freq.line(Math.min(fs, 20), 0, Math.min(fs, 20), 0.35, { color: C.text, width: 2 });
      freq.knob(Math.min(fs, 20), 0.35, C.text, { shape: 'diamond', r: 8 });
      freq.text('fₛ', Math.min(fs, 20), 0.35, { dx: 12, color: C.text, bold: true });
      freq.text('gray: other frequencies with the same samples', 20, 1.3, { dx: -6, align: 'right', color: C.muted, size: 11, bg: 'rgba(255,255,255,.85)' });

      ro.set([
        ['Nyquist frequency fₛ/2', `${fmt(fs / 2, 4)} Hz`, C.green],
        ['Apparent (alias) frequency', `${fmt(fa, 4)} Hz`, C.red],
        ['Samples per period', f > 0 ? fmt(fs / f, 3) : '∞'],
        { wide: ok ? `<span class="badge-big" style="background:${C.green}">f &lt; fₛ/2: no aliasing</span>` : `<span class="badge-big" style="background:${C.red}">Aliasing! Sample faster than ${fmt(2 * f, 3)} Hz</span>` },
      ]);
    }
    return { draw };
  },
};
