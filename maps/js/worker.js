// Web worker for parameter-plane pictures (Lyapunov fractals, Arnold tongues).
import { compileMap1D } from './expr.js';
import { planePixel, levelRow } from './maps.js';

let cm = null;
let cmKey = '';

self.onmessage = (e) => {
  const d = e.data;
  try {
    if (d.mapKey !== cmKey) {
      cm = compileMap1D(d.expr, d.names, d.values);
      cmKey = d.mapKey;
    }
    const { j, s, gw, gh, top, type, ka, kb, isA, x0, T, N, win, qmax } = d;
    const is = levelRow(j, s, gw, top);
    const vals = new Float32Array(is.length);
    const ps = new Int16Array(is.length);
    const qs = new Uint8Array(is.length);
    const b = win[3] - (j + 0.5) * (win[3] - win[2]) / gh;
    for (let n = 0; n < is.length; n++) {
      const a = win[0] + (is[n] + 0.5) * (win[1] - win[0]) / gw;
      const r = planePixel(cm, type, ka, kb, isA, x0, T, N, a, b, qmax);
      vals[n] = r.v; ps[n] = r.p; qs[n] = r.q;
    }
    self.postMessage({ jobId: d.jobId, taskId: d.taskId, j, s, is: Int32Array.from(is), vals, ps, qs }, []);
  } catch (err) {
    self.postMessage({ jobId: d.jobId, taskId: d.taskId, error: String(err && err.message || err) });
  }
};
