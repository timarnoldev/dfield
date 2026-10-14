// Small WebAudio helper: a bank of sine oscillators with smoothly updated frequencies/amplitudes.
let ctx = null;
const voices = new Set();

function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Start a set of sine tones. Returns { update(freqs, amps), stop() } or null if WebAudio is unavailable. */
export function playTones(freqs, amps, master = 0.18) {
  const ac = audioCtx();
  if (!ac) return null;
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(ac.destination);
  out.gain.setTargetAtTime(master, ac.currentTime, 0.03);
  const oscs = freqs.map((f, i) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = amps[i];
    o.connect(g).connect(out);
    o.start();
    return { o, g };
  });
  const voice = {
    update(fs, as) {
      const t = ac.currentTime;
      fs.forEach((f, i) => {
        if (!oscs[i]) return;
        oscs[i].o.frequency.setTargetAtTime(f, t, 0.02);
        oscs[i].g.gain.setTargetAtTime(as[i], t, 0.02);
      });
    },
    stop() {
      if (!voices.has(voice)) return;
      voices.delete(voice);
      const t = ac.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.03);
      setTimeout(() => { oscs.forEach(({ o }) => { try { o.stop(); } catch { /* ignore */ } }); out.disconnect(); }, 250);
    },
  };
  voices.add(voice);
  return voice;
}

export function stopAllAudio() { [...voices].forEach((v) => v.stop()); }
