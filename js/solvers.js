// ODE solvers, ported from DFIELD. Each solver is a generator that yields
// computed points [t, x] until it leaves the computation window or reaches
// the end of the time interval. Errors are reported via ctx.error.

export const METHODS = [
  { id: 'euler', name: "Euler's Tangent Line" },
  { id: 'rk2', name: 'Runge-Kutta 2 (Improved Euler)' },
  { id: 'rk4', name: 'Runge-Kutta fourth-order' },
  { id: 'rkf', name: 'Runge-Kutta-Fehlberg Adaptive Step' },
  { id: 'dp', name: 'Dormand-Prince Adaptive Step' },
];

/** Default solver parameters for a display window (as DFIELD computes them). */
export function defaultSolverParams(tmin, tmax) {
  const range = tmax - tmin;
  const mag = Math.max(Math.abs(tmin), Math.abs(tmax));
  const minStep = mag > 0 ? Math.pow(10, -15 + Math.ceil(Math.log10(mag))) : 1e-15;
  return {
    euler: { h: range / 1000 },
    rk2: { h: range / 500 },
    rk4: { h: range / 250 },
    rkf: { tol: 1e-6, hmax: range / 20, hmin: minStep },
    dp: { tol: 1e-6, hmax: range / 10, hmin: minStep, refine: 4 },
  };
}

const sgn = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
const fmt = (v) => String(Number(Math.fround(v).toPrecision(7)));

function undefinedAt(ctx, t, x) {
  ctx.error = `Undefined value:\n     At ${ctx.dep}(${fmt(t)}) = ${fmt(x)}`;
}
function toleranceError(ctx, t, x) {
  ctx.error = `ODE solver can not stay within specified error tolerance.\n     Last Point: (${fmt(t)} , ${fmt(x)})`;
}

// ctx: { f, tEnd, tLo, tHi, xLo, xHi, params, evals, error, dep }
function outside(ctx, dir, t, x) {
  return sgn(ctx.tEnd - t) !== dir || x > ctx.xHi || x < ctx.xLo || t > ctx.tHi || t < ctx.tLo;
}

function* fixedStep(ctx, t, x, h0, step) {
  const dir = t < ctx.tEnd ? 1 : -1;
  const h = Math.abs(h0) * dir;
  for (;;) {
    const xn = step(t, x, h);
    if (Number.isNaN(xn)) { undefinedAt(ctx, t, x); return; }
    const tn = t + h;
    yield [tn, xn];
    if (outside(ctx, dir, tn, xn)) return;
    t = tn; x = xn;
  }
}

export function* euler(ctx, t0, x0) {
  const f = ctx.f;
  yield* fixedStep(ctx, t0, x0, ctx.params.euler.h, (t, x, h) => {
    ctx.evals++;
    return x + f(t, x) * h;
  });
}

export function* rk2(ctx, t0, x0) {
  const f = ctx.f;
  yield* fixedStep(ctx, t0, x0, ctx.params.rk2.h, (t, x, h) => {
    const k1 = f(t, x);
    const k2 = f(t + h, x + h * k1);
    ctx.evals += 2;
    return x + (h / 2) * (k1 + k2);
  });
}

export function* rk4(ctx, t0, x0) {
  const f = ctx.f;
  yield* fixedStep(ctx, t0, x0, ctx.params.rk4.h, (t, x, h) => {
    const h2 = h / 2;
    const k1 = f(t, x);
    const k2 = f(t + h2, x + h2 * k1);
    const k3 = f(t + h2, x + h2 * k2);
    const k4 = f(t + h, x + h * k3);
    ctx.evals += 4;
    return x + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  });
}

export function* rkf(ctx, t0, x0) {
  const f = ctx.f;
  const { tol, hmax, hmin } = ctx.params.rkf;
  const dir = t0 < ctx.tEnd ? 1 : -1;
  let t = t0, x = x0;
  let h = hmax * dir;
  for (;;) {
    let tn = 0, xn = 0;
    let rejected = true;
    while (rejected) {
      const k1 = f(t, x);
      const k2 = f(t + h * 0.25, x + h * 0.25 * k1);
      const k3 = f(t + h * 0.375, x + h * (k1 * 0.09375 + k2 * 0.28125));
      const k4 = f(t + h * 0.9230769230769231, x + h * (k1 * 0.8793809740555303 + k2 * -3.277196176604461 + k3 * 3.3208921256258535));
      const k5 = f(t + h, x + h * (k1 * 2.0324074074074074 + k2 * -8.0 + k3 * 7.173489278752436 + k4 * -0.20589668615984405));
      const k6 = f(t + h * 0.5, x + h * (k1 * -0.2962962962962963 + k2 * 2.0 + k3 * -1.3816764132553607 + k4 * 0.4529727095516569 + k5 * -0.275));
      ctx.evals += 6;
      xn = x + h * (k1 * 0.11851851851851852 + k3 * 0.5189863547758284 + k4 * 0.5061314903420167 + k5 * -0.18 + k6 * 0.03636363636363636);
      tn = t + h;
      const err = Math.abs(h * (k1 * 0.002777777777777778 + k3 * -0.02994152046783626 + k4 * -0.029199893673577886 + k5 * 0.02 + k6 * 0.03636363636363636));
      const allowed = Math.abs(h * tol);
      let hn;
      if (Number.isNaN(xn) || Number.isNaN(err)) {
        hn = h / 2;
      } else {
        hn = h * 0.9 * Math.pow(allowed / err, 0.25);
        if (err <= allowed) rejected = false;
      }
      if (rejected && Math.abs(h) <= hmin) { toleranceError(ctx, t, x); return; }
      if (!(Math.abs(hn) <= Math.abs(h * 4))) hn = h * 4;
      else if (Math.abs(hn) < Math.abs(h * 0.1)) hn = h * 0.1;
      if (Math.abs(hn) > hmax) hn = hmax * dir;
      else if (Math.abs(hn) < hmin) hn = hmin * dir;
      h = hn;
    }
    yield [tn, xn];
    t = tn; x = xn;
    if (outside(ctx, dir, t, x)) return;
  }
}

// Dormand-Prince dense output coefficients (b_i(theta) = sum_k C[i][k] theta^(k+1)).
const DP_DENSE = [
  [1.0, -2.859375, 3.0833333333333335, -1.1328125],
  [0, 0, 0, 0],
  [0, 4.0431266846361185, -6.289308176100629, 2.6954177897574123],
  [0, -3.90625, 10.416666666666666, -5.859375],
  [0, 2.7939268867924527, -6.877358490566038, 3.761055424528302],
  [0, -1.5714285714285714, 3.6666666666666665, -1.9642857142857142],
  [0, 1.5, -4.0, 2.5],
];

export function* dp(ctx, t0, x0) {
  const f = ctx.f;
  const { tol, hmax, hmin } = ctx.params.dp;
  const refine = Math.max(1, Math.floor(ctx.params.dp.refine));
  const thetas = [];
  const weights = [];
  for (let i = 1; i < refine; i++) {
    const th = i / refine;
    thetas.push(th);
    weights.push(DP_DENSE.map((c) => c[0] * th + c[1] * th * th + c[2] * th ** 3 + c[3] * th ** 4));
  }
  const range = ctx.tRange;
  const dir = t0 < ctx.tEnd ? 1 : -1;
  let t = t0, x = x0;
  let hNext = hmax * dir;
  let k1 = f(t0, x0);
  ctx.evals++;
  for (;;) {
    let h = 0, tn = 0, xn = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0, k6 = 0, k7 = 0;
    let rejected = true;
    while (rejected) {
      h = hNext;
      k2 = f(t + h * 0.2, x + h * 0.2 * k1);
      k3 = f(t + h * 0.3, x + h * (k1 * 0.075 + k2 * 0.225));
      k4 = f(t + h * 0.8, x + h * (k1 * 0.9777777777777777 + k2 * -3.7333333333333334 + k3 * 3.5555555555555554));
      k5 = f(t + h * 0.8888888888888888, x + h * (k1 * 2.9525986892242035 + k2 * -11.595793324188385 + k3 * 9.822892851699436 + k4 * -0.2908093278463649));
      k6 = f(t + h, x + h * (k1 * 2.8462752525252526 + k2 * -10.757575757575758 + k3 * 8.906422717743473 + k4 * 0.2784090909090909 + k5 * -0.2735313036020583));
      xn = x + h * (k1 * 0.09114583333333333 + k3 * 0.44923629829290207 + k4 * 0.6510416666666666 + k5 * -0.322376179245283 + k6 * 0.13095238095238096);
      tn = t + h;
      k7 = f(tn, xn);
      ctx.evals += 6;
      const err = Math.abs(h * (k1 * 0.0012326388888888888 + k3 * -0.0042527702905061394 + k4 * 0.03697916666666667 + k5 * -0.05086379716981132 + k6 * 0.0419047619047619 + k7 * -0.025));
      const scale = (Math.abs(x) + Math.abs(xn) + range * 0.001) * tol;
      const q = Math.pow((err * 2) / scale, 0.2);
      if (Number.isNaN(xn) || Number.isNaN(q)) {
        hNext = h / 2;
      } else {
        hNext = (h * 0.8) / q;
        if (q < 1) rejected = false;
      }
      if (rejected && Math.abs(h) <= hmin) { toleranceError(ctx, t, x); return; }
      if (!(Math.abs(hNext) <= Math.abs(h * 10))) hNext = h * 10;
      else if (Math.abs(hNext) < Math.abs(h * 0.1)) hNext = h * 0.1;
      if (Math.abs(hNext) > hmax) hNext = hmax * dir;
      else if (Math.abs(hNext) < hmin) hNext = hmin * dir;
    }
    const ks = [k1, k2, k3, k4, k5, k6, k7];
    for (let i = 0; i < thetas.length; i++) {
      const w = weights[i];
      let s = 0;
      for (let j = 0; j < 7; j++) s += ks[j] * w[j];
      yield [t + h * thetas[i], x + h * s];
    }
    yield [tn, xn];
    t = tn; x = xn; k1 = k7;
    if (outside(ctx, dir, t, x)) return;
  }
}

export const SOLVERS = { euler, rk2, rk4, rkf, dp };
