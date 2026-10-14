// Plane curves catalog. `roll` describes a rolling-circle construction.
import { compile } from './parser.js';

const { sin, cos, PI, sqrt, exp, abs, sign } = Math;
const TAU = 2 * PI;

function gcd(a, b) { a = Math.round(abs(a) * 1000); b = Math.round(abs(b) * 1000); while (b) [a, b] = [b, a % b]; return a / 1000; }

// Epi/hypo-trochoids: fixed circle radius R, rolling circle radius r, pen distance d.
const epi = (P) => (t) => {
  const k = (P.R + P.r) / P.r;
  return [(P.R + P.r) * cos(t) - P.d * cos(k * t), (P.R + P.r) * sin(t) - P.d * sin(k * t)];
};
const hypo = (P) => (t) => {
  const k = (P.R - P.r) / P.r;
  return [(P.R - P.r) * cos(t) + P.d * cos(k * t), (P.R - P.r) * sin(t) - P.d * sin(k * t)];
};
// parameter range closing an epi/hypocycloid: t in [0, 2π r / gcd(R, r)]
const closeRange = (P) => [0, TAU * P.r / gcd(P.R, P.r)];

const epiRoll = { type: 'epi' };
const hypoRoll = { type: 'hypo' };

export const PLANE = [
  {
    id: 'ellipse', name: 'Ellipse', icon: 'ellipse',
    params: [
      { k: 'a', label: 'a', min: 0.2, max: 4, step: 0.01, v: 3 },
      { k: 'b', label: 'b', min: 0.2, max: 4, step: 0.01, v: 1.8, anim: true },
    ],
    t: [0, TAU], closed: true,
    f: (P) => (t) => [P.a * cos(t), P.b * sin(t)],
    about: `<p>The ellipse x²/a² + y²/b² = 1, r(t) = (a cos t, b sin t). Its curvature is
κ = ab / (a² sin²t + b² cos²t)<sup>3/2</sup>, maximal at the ends of the major axis.</p>
<p>Switch on the <b>evolute</b> (locus of centres of curvature): for the ellipse it is a stretched astroid (a Lamé curve)
(ax)<sup>2/3</sup> + (by)<sup>2/3</sup> = (a² − b²)<sup>2/3</sup>. The osculating circle is the circle of best contact; its centre runs along the evolute.</p>`,
  },
  {
    id: 'cycloid', name: 'Cycloid / trochoid', icon: 'cycloid',
    params: [
      { k: 'r', label: 'wheel radius r', min: 0.3, max: 2, step: 0.01, v: 1 },
      { k: 'd', label: 'pen distance d', min: 0, max: 2.5, step: 0.01, v: 1, anim: true },
      { k: 'n', label: 'arches', min: 1, max: 5, step: 1, v: 2, int: true },
    ],
    t: (P) => [0, P.n * TAU], closed: false, roll: { type: 'line' },
    f: (P) => (t) => [P.r * t - P.d * sin(t), P.r - P.d * cos(t)],
    about: `<p>A <b>cycloid</b> is traced by a point on the rim of a wheel rolling along a straight line:</p>
<p class="formula">r(t) = (r t − d sin t, r − d cos t)</p>
<p>with d = r. For d &lt; r one gets a curtate and for d &gt; r a prolate <b>trochoid</b> (with loops).
The cycloid is the solution of the brachistochrone and of the tautochrone problems (Johann Bernoulli, Huygens);
its evolute is a congruent cycloid, which Huygens used to build an isochronous pendulum clock.</p>`,
  },
  {
    id: 'epicycloid', name: 'Epicycloid / epitrochoid', icon: 'epi',
    params: [
      { k: 'R', label: 'fixed radius R', min: 0.5, max: 4, step: 0.05, v: 3 },
      { k: 'r', label: 'rolling radius r', min: 0.2, max: 3, step: 0.05, v: 1 },
      { k: 'd', label: 'pen distance d', min: 0, max: 3, step: 0.01, v: 1, anim: true },
    ],
    t: closeRange, closed: true, roll: epiRoll,
    f: epi,
    about: `<p>An <b>epicycloid</b> is traced by a point of a circle of radius r rolling on the outside of a fixed circle of radius R
(pen distance d = r; otherwise an <b>epitrochoid</b>):</p>
<p class="formula">r(t) = ((R + r) cos t − d cos((R+r)t/r), (R + r) sin t − d sin((R+r)t/r))</p>
<p>If R/r = k is an integer the curve has k cusps: k = 1 is the <b>cardioid</b>, k = 2 the <b>nephroid</b>.
For rational R/r = p/q the curve closes after q turns. Ptolemy's epicycles are exactly such curves.</p>`,
  },
  {
    id: 'hypocycloid', name: 'Hypocycloid / hypotrochoid', icon: 'hypo',
    params: [
      { k: 'R', label: 'fixed radius R', min: 0.5, max: 4, step: 0.05, v: 3 },
      { k: 'r', label: 'rolling radius r', min: 0.2, max: 3, step: 0.05, v: 0.6 },
      { k: 'd', label: 'pen distance d', min: 0, max: 3, step: 0.01, v: 0.6, anim: true },
    ],
    t: closeRange, closed: true, roll: hypoRoll,
    f: hypo,
    about: `<p>A <b>hypocycloid</b> is traced by a point of a circle of radius r rolling inside a fixed circle of radius R:</p>
<p class="formula">r(t) = ((R − r) cos t + d cos((R−r)t/r), (R − r) sin t − d sin((R−r)t/r))</p>
<p>R = 3r gives the <b>deltoid</b> (Steiner's curve), R = 4r the <b>astroid</b>, and R = 2r a straight line segment
(the Cardano / Tusi couple). With d ≠ r one gets hypotrochoids — the curves drawn with a Spirograph.</p>`,
  },
  {
    id: 'cardioid', name: 'Cardioid', icon: 'cardioid',
    params: [{ k: 'a', label: 'a', min: 0.3, max: 2, step: 0.01, v: 1 }],
    t: [0, TAU], closed: true, roll: epiRoll,
    f: (P) => epi({ R: P.a, r: P.a, d: P.a }),
    rollParams: (P) => ({ R: P.a, r: P.a, d: P.a }),
    about: `<p>The cardioid (“heart curve”) is the epicycloid with one cusp: a circle rolls around a fixed circle of the same radius a.</p>
<p class="formula">r(t) = (2a cos t − a cos 2t, 2a sin t − a sin 2t);  in polar form ρ = 2a(1 − cos θ) about the cusp</p>
<p>It is the boundary of the main cardioid of the Mandelbrot set, appears as a caustic in a coffee cup,
and its evolute is a cardioid one third the size. Length 16a, area 6πa².</p>`,
  },
  {
    id: 'astroid', name: 'Astroid', icon: 'astroid',
    params: [{ k: 'a', label: 'a', min: 0.5, max: 4, step: 0.01, v: 3 }],
    t: [0, TAU], closed: true, roll: hypoRoll,
    f: (P) => hypo({ R: P.a, r: P.a / 4, d: P.a / 4 }),
    rollParams: (P) => ({ R: P.a, r: P.a / 4, d: P.a / 4 }),
    about: `<p>The astroid x<sup>2/3</sup> + y<sup>2/3</sup> = a<sup>2/3</sup> is the hypocycloid with four cusps (R = 4r):</p>
<p class="formula">r(t) = (a cos³t, a sin³t)</p>
<p>It is the envelope of a ladder of length a sliding down a wall, and the evolute of an ellipse is an (affinely stretched) astroid.
Length 6a, area 3πa²/8.</p>`,
  },
  {
    id: 'deltoid', name: 'Deltoid', icon: 'hypo',
    params: [{ k: 'a', label: 'a', min: 0.5, max: 4, step: 0.01, v: 3 }],
    t: [0, TAU], closed: true, roll: hypoRoll,
    f: (P) => hypo({ R: P.a, r: P.a / 3, d: P.a / 3 }),
    rollParams: (P) => ({ R: P.a, r: P.a / 3, d: P.a / 3 }),
    about: `<p>The deltoid (Steiner's hypocycloid, Euler 1745) has three cusps: a circle of radius a/3 rolls inside a circle of radius a.</p>
<p class="formula">r(t) = (2b cos t + b cos 2t, 2b sin t − b sin 2t),  b = a/3</p>
<p>Every tangent line meets the deltoid in a segment of constant length 4b — a needle can be turned around inside it (Kakeya).</p>`,
  },
  {
    id: 'lemniscate', name: 'Lemniscate of Bernoulli', icon: 'lemniscate',
    params: [{ k: 'a', label: 'a', min: 0.5, max: 4, step: 0.01, v: 3 }],
    t: [0, TAU], closed: true,
    f: (P) => (t) => { const s = sin(t), c = cos(t), d = 1 + s * s; return [P.a * c / d, P.a * s * c / d]; },
    about: `<p>Jakob Bernoulli's lemniscate (1694) is the set of points whose distances to the foci (±a/√2, 0) have product a²/2:</p>
<p class="formula">(x² + y²)² = a²(x² − y²),   r(t) = (a cos t, a sin t cos t) / (1 + sin²t)</p>
<p>Its arc length led to the lemniscatic integral ∫dt/√(1 − t⁴), the origin of elliptic functions (Fagnano, Euler, Gauss).
The curvature is proportional to the distance from the centre: κ = 3ρ/a².</p>`,
  },
  {
    id: 'lissajous', name: 'Lissajous figure', icon: 'lissajous',
    params: [
      { k: 'p', label: 'frequency p', min: 1, max: 9, step: 1, v: 3, int: true },
      { k: 'q', label: 'frequency q', min: 1, max: 9, step: 1, v: 2, int: true },
      { k: 'delta', label: 'phase δ', min: 0, max: PI, step: 0.01, v: PI / 2, anim: true },
    ],
    t: [0, TAU], closed: true,
    f: (P) => (t) => [3 * sin(P.p * t + P.delta), 3 * sin(P.q * t)],
    about: `<p>Lissajous figures (Bowditch 1815, Lissajous 1857) are the curves traced by two perpendicular harmonic oscillations:</p>
<p class="formula">r(t) = (A sin(pt + δ), B sin(qt))</p>
<p>For coprime p, q the curve closes after one period. Animate the phase δ to see the figure rotate like on an oscilloscope.</p>`,
  },
  {
    id: 'rose', name: 'Rose curve', icon: 'rose',
    params: [
      { k: 'n', label: 'n', min: 1, max: 9, step: 1, v: 5, int: true },
      { k: 'm', label: 'd', min: 1, max: 9, step: 1, v: 1, int: true },
    ],
    t: (P) => [0, TAU * P.m], closed: true,
    f: (P) => (t) => { const r = 3 * cos(P.n / P.m * t); return [r * cos(t), r * sin(t)]; },
    about: `<p>Grandi's rose (rhodonea) ρ = a cos(kθ), k = n/d. For integer k the rose has k petals if k is odd and 2k petals if k is even.
For rational k = n/d it closes after θ = 2πd (or πd).</p>`,
  },
  {
    id: 'archimedes', name: 'Archimedean spiral', icon: 'spiral',
    params: [
      { k: 'a', label: 'a', min: 0.05, max: 1, step: 0.01, v: 0.25 },
      { k: 'turns', label: 'turns', min: 1, max: 8, step: 0.5, v: 4 },
    ],
    t: (P) => [0, P.turns * TAU], closed: false,
    f: (P) => (t) => [P.a * t * cos(t), P.a * t * sin(t)],
    about: `<p>The Archimedean spiral ρ = aθ: successive turns are equally spaced (distance 2πa), like the groove of a record.
Archimedes used it to trisect angles and to square the circle (using the spiral itself — impossible with ruler and compass alone).</p>`,
  },
  {
    id: 'logspiral', name: 'Logarithmic spiral', icon: 'spiral',
    params: [
      { k: 'b', label: 'growth b', min: 0.02, max: 0.5, step: 0.005, v: 0.15 },
      { k: 'turns', label: 'turns', min: 1, max: 8, step: 0.5, v: 4 },
    ],
    t: (P) => [-P.turns * TAU, 2 * PI], closed: false,
    f: (P) => (t) => { const r = 0.5 * exp(P.b * t); return [r * cos(t), r * sin(t)]; },
    about: `<p>The logarithmic (equiangular) spiral ρ = a e<sup>bθ</sup>, Jakob Bernoulli's <em>spira mirabilis</em>.
The tangent makes a constant angle arctan(1/b) with the radius vector, and every scaling about the centre equals a rotation.
Its evolute and its involute are again logarithmic spirals congruent to it.</p>`,
  },
  {
    id: 'involute', name: 'Involute of a circle', icon: 'spiral',
    params: [
      { k: 'a', label: 'circle radius a', min: 0.2, max: 2, step: 0.01, v: 0.8 },
      { k: 'turns', label: 'turns', min: 0.5, max: 4, step: 0.25, v: 1.5 },
    ],
    t: (P) => [0, P.turns * TAU], closed: false, base: 'circle',
    f: (P) => (t) => [P.a * (cos(t) + t * sin(t)), P.a * (sin(t) - t * cos(t))],
    about: `<p>The involute of a circle is traced by the end of a taut string unwound from a circle of radius a:</p>
<p class="formula">r(t) = a (cos t + t sin t, sin t − t cos t)</p>
<p>Its evolute is the circle itself. Gear teeth are shaped like circle involutes, so that meshing gears transmit a constant speed ratio.
Switch on “involute” for any other curve to unwind a string from it.</p>`,
  },
  {
    id: 'parabola', name: 'Parabola', icon: 'parabola',
    params: [{ k: 'p', label: 'p', min: 0.1, max: 2, step: 0.01, v: 0.5 }],
    t: [-3, 3], closed: false,
    f: (P) => (t) => [t, t * t / (4 * P.p) - 2],
    about: `<p>The parabola y = x²/(4p) with focus at distance p above the vertex. Its evolute is a semicubical parabola
(Neile's parabola) with a cusp at the centre of curvature of the vertex — turn on the evolute to see it.
Light rays parallel to the axis are reflected into the focus.</p>`,
  },
  {
    id: 'catenary', name: 'Catenary', icon: 'parabola',
    params: [{ k: 'a', label: 'a', min: 0.3, max: 3, step: 0.01, v: 1 }],
    t: [-2.5, 2.5], closed: false,
    f: (P) => (t) => [P.a * t, P.a * Math.cosh(t) - P.a - 1],
    about: `<p>The catenary y = a cosh(x/a) is the shape of a hanging chain (Leibniz, Huygens, Johann Bernoulli 1691).
Its involute starting at the vertex is the <b>tractrix</b>, whose surface of revolution is the pseudosphere.
Rotating the catenary gives the catenoid.</p>`,
  },
  {
    id: 'userplane', name: 'User-defined curve', icon: 'user',
    params: [
      { k: 'ex', label: 'x(t) =', type: 'expr', v: 'cos(t) (1 + a cos(5t))' },
      { k: 'ey', label: 'y(t) =', type: 'expr', v: 'sin(t) (1 + a cos(5t))' },
      { k: 'tmin', label: 't min', type: 'expr', v: '0' },
      { k: 'tmax', label: 't max', type: 'expr', v: '2pi' },
      { k: 'a', label: 'a', min: -3, max: 3, step: 0.01, v: 0.3, anim: true },
      { k: 'b', label: 'b', min: -3, max: 3, step: 0.01, v: 1, anim: true },
    ],
    t: (P) => [compile(P.tmin, [])(), compile(P.tmax, [])()], closed: false, detectClosed: true,
    f: (P) => {
      const n = ['t', 'a', 'b'];
      const fx = compile(P.ex, n), fy = compile(P.ey, n);
      return (t) => [fx(t, P.a, P.b), fy(t, P.a, P.b)];
    },
    about: `<p>Enter a parametrized plane curve r(t) = (x(t), y(t)) using t and parameters a, b. The signed curvature is</p>
<p class="formula">κ = (x′y″ − y′x″) / (x′² + y′²)<sup>3/2</sup></p>
<p>and the centre of the osculating circle is r + N/κ, where N is the unit normal.</p>`,
  },
];

export const PLANE_ABOUT = `<p><b>Osculating circle, evolute, involute.</b> The osculating circle at a point has the same tangent and curvature
as the curve; its radius is 1/|κ|. The locus of its centres is the <b>evolute</b>. An <b>involute</b> is traced by the end of a taut string
unwound from the curve: I(t) = r(t) − s(t) T(t), where s is the arc length from the starting point.
The evolute of an involute is the original curve.</p>`;

export { gcd as gcdFloat };
