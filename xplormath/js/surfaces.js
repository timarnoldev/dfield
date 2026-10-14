// Catalog of parametric surfaces. Each entry: domain, parametrization X(u,v)
// built from the current parameter values P, optional clipping, About text.
import { costa } from './costa.js';
import { compile } from './parser.js';

const { sin, cos, sinh, cosh, tanh, log, tan, sqrt, PI, atan2, hypot } = Math;
const TAU = 2 * PI;
const sech = (x) => 1 / cosh(x);

function scherk(u, v) {
  // Weierstrass data f = 4/(1-w^4), g = w on the unit disc, w = u e^{iv}
  const a = u * cos(v), b = u * sin(v);
  // (1 + i w)/(1 - i w), i w = (-b, a)
  const n1 = [1 - b, a], d1 = [1 + b, -a];
  const x = atan2(n1[1], n1[0]) - atan2(d1[1], d1[0]);
  const n2 = [1 + a, b], d2 = [1 - a, -b];
  const y = -(atan2(n2[1], n2[0]) - atan2(d2[1], d2[0]));
  const w2 = [a * a - b * b, 2 * a * b];
  const z = log(hypot(1 + w2[0], w2[1]) / hypot(1 - w2[0], w2[1]));
  return [wrapPi(x), wrapPi(y), z];
}
const wrapPi = (t) => (t > PI ? t - TAU : t < -PI ? t + TAU : t);

function userSurface(P) {
  const names = ['u', 'v', 'a', 'b', 'c'];
  const fx = compile(P.ex, names), fy = compile(P.ey, names), fz = compile(P.ez, names);
  return (u, v) => [fx(u, v, P.a, P.b, P.c), fy(u, v, P.a, P.b, P.c), fz(u, v, P.a, P.b, P.c)];
}

const helicat = (P) => {
  const c = cos(P.theta), s = sin(P.theta);
  return (u, v) => [
    c * sinh(v) * sin(u) + s * cosh(v) * cos(u),
    -c * sinh(v) * cos(u) + s * cosh(v) * sin(u),
    c * u + s * v,
  ];
};
const helicatAbout = `
<p>The <b>helicoid</b> and the <b>catenoid</b> are the two oldest minimal surfaces (Meusnier 1776, Euler 1744).
They belong to one <em>associate family</em> of minimal surfaces, all locally isometric to each other:</p>
<p class="formula">X<sub>θ</sub>(u,v) = cos θ (sinh v sin u, −sinh v cos u, u) + sin θ (cosh v cos u, cosh v sin u, v)</p>
<p>θ = 0 gives the helicoid, θ = π/2 the catenoid. During the morph every curve on the surface keeps its length,
the Gaussian curvature K = −1/cosh⁴v is unchanged at corresponding points, and the mean curvature stays H = 0.
Press <b>▶</b> to watch the helicoid bend into the catenoid without stretching.</p>`;

export const SURFACES = [
  {
    id: 'sphere', name: 'Sphere', icon: 'sphere',
    params: [{ k: 'r', label: 'radius r', min: 0.2, max: 3, step: 0.01, v: 1.5 }],
    u: [0, TAU], v: [-PI / 2, PI / 2], res: [1.4, 0.8],
    f: (P) => (u, v) => [P.r * cos(v) * cos(u), P.r * cos(v) * sin(u), P.r * sin(v)],
    about: `<p>The round sphere of radius r, parametrized by longitude u and latitude v:</p>
<p class="formula">X(u,v) = (r cos v cos u, r cos v sin u, r sin v)</p>
<p>Its Gaussian curvature is constant, K = 1/r², and its mean curvature is H = 1/r (with the inner normal) — try the curvature
colourings: the surface is uniformly coloured. The parameter lines are the meridians and parallels; the poles are
singular points of the parametrization, not of the surface.</p>`,
  },
  {
    id: 'torus', name: 'Torus', icon: 'torus',
    params: [
      { k: 'R', label: 'R (center circle)', min: 0.5, max: 3, step: 0.01, v: 2 },
      { k: 'r', label: 'r (tube)', min: 0.1, max: 2.5, step: 0.01, v: 0.8, anim: true },
    ],
    u: [0, TAU], v: [0, TAU], res: [1.4, 0.8],
    f: (P) => (u, v) => [(P.R + P.r * cos(v)) * cos(u), (P.R + P.r * cos(v)) * sin(u), P.r * sin(v)],
    about: `<p>A torus of revolution: a circle of radius r whose center moves on a circle of radius R.</p>
<p class="formula">X(u,v) = ((R + r cos v) cos u, (R + r cos v) sin u, r sin v)</p>
<p>The Gaussian curvature K = cos v / (r (R + r cos v)) is positive on the outside, negative on the inside and zero on the top and bottom circles.
Its total curvature ∫K dA is 0 = 2π χ, in accordance with the Gauss–Bonnet theorem (χ(torus) = 0).
For r &gt; R the torus intersects itself (spindle torus).</p>`,
  },
  {
    id: 'helicoid', name: 'Helicoid', icon: 'helicoid',
    params: [
      { k: 'theta', label: 'associate angle θ', min: 0, max: PI / 2, step: 0.005, v: 0, anim: true },
      { k: 'h', label: 'height (u range)', min: 1, max: 4, step: 0.01, v: 2 },
    ],
    u: (P) => [-P.h * PI / 2, P.h * PI / 2], v: [-1.6, 1.6], res: [1.6, 0.8], morph: 'theta',
    f: helicat, about: helicatAbout,
  },
  {
    id: 'catenoid', name: 'Catenoid', icon: 'catenoid',
    params: [
      { k: 'theta', label: 'associate angle θ', min: 0, max: PI / 2, step: 0.005, v: PI / 2, anim: true },
      { k: 'h', label: 'height (u range)', min: 1, max: 4, step: 0.01, v: 2 },
    ],
    u: [-PI, PI], v: [-1.6, 1.6], res: [1.4, 0.8], morph: 'theta',
    f: helicat, about: helicatAbout,
  },
  {
    id: 'enneper', name: 'Enneper surface', icon: 'saddle',
    params: [{ k: 'R', label: 'radius of disc', min: 0.3, max: 2.5, step: 0.01, v: 1.4 }],
    u: (P) => [0, P.R], v: [0, TAU], res: [0.7, 1.4],
    f: () => (r, t) => {
      const u = r * cos(t), v = r * sin(t);
      return [u - u * u * u / 3 + u * v * v, -(v - v * v * v / 3 + v * u * u), u * u - v * v];
    },
    about: `<p>Enneper's minimal surface (1864), shown over a disc in polar coordinates u + iv = ρe<sup>it</sup>:</p>
<p class="formula">X(u,v) = (u − u³/3 + uv², −v + v³/3 − vu², u² − v²)</p>
<p>Its Weierstrass data are f = 1, g = w. Enneper's surface is a complete minimal surface (H = 0) of total curvature −4π. The disc of radius ρ is embedded for ρ &lt; √3 — increase the radius to see the surface run into itself. The images of the coordinate axes are planar curves of curvature.</p>`,
  },
  {
    id: 'scherk', name: 'Scherk surface', icon: 'saddle',
    params: [
      { k: 'tiles', label: 'periods shown', min: 0, max: 2, step: 1, v: 1, int: true },
      { k: 'H', label: 'height cut-off', min: 1, max: 6, step: 0.1, v: 3 },
    ],
    u: [0, 1], v: [0.0001, TAU + 0.0001], res: [0.8, 1.6],
    f: () => scherk,
    clip: (P) => ({ z: P.H }),
    tiles: (P) => {
      const out = [];
      const n = P.tiles;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if ((i + j) % 2 === 0 && Math.abs(i) + Math.abs(j) <= 2 * n) out.push([i * PI, j * PI, 0]);
      return out;
    },
    about: `<p>Scherk's doubly periodic minimal surface (1834) is the graph</p>
<p class="formula">z = log( cos y / cos x )</p>
<p>over the black squares of a chess board. One fundamental piece comes from the Weierstrass data f = 4/(1 − w⁴), g = w on the unit disc:</p>
<p class="formula">x = arg((1+iw)/(1−iw)), y = −arg((1+w)/(1−w)), z = log|(1+w²)/(1−w²)|</p>
<p>The boundary circle |w| = 1 is mapped onto vertical straight lines over the corners of the squares;
by the Schwarz reflection principle the pieces fit together to a complete embedded minimal surface.
Use “periods shown” to add more translated copies.</p>`,
  },
  {
    id: 'costa', name: 'Costa surface', icon: 'saddle',
    params: [{ k: 'R', label: 'clip radius', min: 1.5, max: 6, step: 0.1, v: 3.2 }],
    u: [0, 1], v: [0, 1], res: [1.25, 1.25], quality: 1.3,
    f: () => costa,
    clip: (P) => ({ radius: P.R }),
    about: `<p>Costa's minimal surface (C. Costa 1982; embeddedness proved by Hoffman and Meeks 1985) was the first
new complete embedded minimal surface of finite topology since the plane, catenoid and helicoid.
It is a torus with three punctures: one planar end and two catenoidal ends.</p>
<p>The parametrization (after A. Gray) uses the Weierstrass ζ- and ℘-functions of the square lattice ℤ + iℤ,
with e₁ = ℘(½) ≈ 6.87519:</p>
<p class="formula">x = ½ Re{−ζ(w) + πu + π²/(4e₁) + π/(2e₁)[ζ(w−½) − ζ(w−i/2)]}<br>
y = ½ Re{−iζ(w) + πv + π²/(4e₁) − π/(2e₁)[iζ(w−½) − iζ(w−i/2)]}<br>
z = ¼√(2π) log|(℘(w) − e₁)/(℘(w) + e₁)|,  w = u + iv</p>
<p>ζ and ℘ are evaluated here with rapidly converging Jacobi theta series. The ends are cut off at a sphere of the given radius.</p>`,
  },
  {
    id: 'mobius', name: 'Möbius strip', icon: 'mobius',
    params: [
      { k: 'w', label: 'width', min: 0.1, max: 1.5, step: 0.01, v: 0.6 },
      { k: 'n', label: 'half twists', min: 0, max: 5, step: 1, v: 1, int: true },
    ],
    u: [0, TAU], v: (P) => [-P.w, P.w], res: [2, 0.5],
    f: (P) => (u, v) => {
      const a = P.n * u / 2;
      return [(1.5 + v * cos(a)) * cos(u), (1.5 + v * cos(a)) * sin(u), v * sin(a)];
    },
    about: `<p>The Möbius strip (Möbius, Listing 1858) is the simplest non-orientable surface: it has only one side and
one boundary curve. A segment of length 2w rotates by n·180° while its midpoint goes once around a circle:</p>
<p class="formula">X(u,v) = ((1.5 + v cos(nu/2)) cos u, (1.5 + v cos(nu/2)) sin u, v sin(nu/2))</p>
<p>With the default two-sided colouring you can see that “front” and “back” meet along the seam when n is odd.
For even n the band is orientable (an ordinary twisted annulus).</p>`,
  },
  {
    id: 'klein8', name: 'Klein bottle (figure 8)', icon: 'klein',
    params: [{ k: 'a', label: 'radius a', min: 1.5, max: 4, step: 0.01, v: 2.5 }],
    u: [0, TAU], v: [0, TAU], res: [1.5, 0.9],
    f: (P) => (u, v) => {
      const c = cos(u / 2), s = sin(u / 2), sv = sin(v), s2v = sin(2 * v);
      const r = P.a + c * sv - s * s2v;
      return [r * cos(u), r * sin(u), s * sv + c * s2v];
    },
    about: `<p>The “figure-8” immersion of the Klein bottle: a figure-eight curve is rotated around an axis while
it turns by half a revolution, so that after one trip it closes up with reversed orientation.</p>
<p class="formula">r = a + cos(u/2) sin v − sin(u/2) sin 2v<br>X(u,v) = (r cos u, r sin u, sin(u/2) sin v + cos(u/2) sin 2v)</p>
<p>The Klein bottle is a closed non-orientable surface with Euler characteristic 0. It cannot be embedded in ℝ³;
this immersion has a self-intersection circle.</p>`,
  },
  {
    id: 'kleinbottle', name: 'Klein bottle (bottle)', icon: 'klein',
    params: [],
    u: [0, PI], v: [0, TAU], res: [1.6, 0.9],
    f: () => (u, v) => {
      const cu = cos(u), su = sin(u), cv = cos(v), sv = sin(v);
      const c2 = cu * cu, c3 = c2 * cu, c4 = c2 * c2, c5 = c4 * cu, c6 = c4 * c2, c7 = c6 * cu;
      const x = -2 / 15 * cu * (3 * cv - 30 * su + 90 * c4 * su - 60 * c6 * su + 5 * cu * cv * su);
      const y = -1 / 15 * su * (3 * cv - 3 * c2 * cv - 48 * c4 * cv + 48 * c6 * cv - 60 * su + 5 * cu * cv * su
        - 5 * c3 * cv * su - 80 * c5 * cv * su + 80 * c7 * cv * su);
      const z = 2 / 15 * (3 + 5 * cu * su) * sv;
      return [x, z, -y - 1];
    },
    about: `<p>The classical “bottle” shaped Klein bottle: the neck of a bottle passes through its side and joins the
bottom from the inside. This polynomial-trigonometric parametrization is due to R. Bracewell / A. Gray:</p>
<p class="formula">x = −2/15 cos u (3 cos v − 30 sin u + 90 cos⁴u sin u − 60 cos⁶u sin u + 5 cos u cos v sin u)<br>
y = −1/15 sin u (3 cos v − 3 cos²u cos v − 48 cos⁴u cos v + 48 cos⁶u cos v − 60 sin u + …)<br>
z = 2/15 (3 + 5 cos u sin u) sin v</p>
<p>The two colours show the two “sides” locally; they are exchanged where the tube passes through itself.</p>`,
  },
  {
    id: 'boy', name: "Boy's surface", icon: 'boy',
    params: [{ k: 'alpha', label: 'Roman ⟶ Boy  α', min: 0, max: 1, step: 0.005, v: 1, anim: true }],
    u: [-PI / 2, PI / 2], v: [0, PI], res: [1.2, 1.2], morph: 'alpha',
    f: (P) => (u, v) => {
      const s2 = Math.SQRT2;
      const cv2 = cos(v) * cos(v);
      const d = 2 - P.alpha * s2 * sin(3 * u) * sin(2 * v);
      return [(s2 * cv2 * cos(2 * u) + cos(u) * sin(2 * v)) / d,
        (s2 * cv2 * sin(2 * u) - sin(u) * sin(2 * v)) / d,
        3 * cv2 / d - 1];
    },
    about: `<p>Boy's surface (Werner Boy 1901, a student of Hilbert) is an immersion of the real projective plane ℝP² in
ℝ³ without singular points; it has a triple point and three-fold symmetry. Shown is F. Apéry's parametrization</p>
<p class="formula">D = 2 − α√2 sin 3u sin 2v<br>
X = ( (√2 cos²v cos 2u + cos u sin 2v)/D, (√2 cos²v sin 2u − sin u sin 2v)/D, 3cos²v / D )</p>
<p>For α = 0 the same formula gives Steiner's <b>Roman surface</b> (which has six pinch points);
the slider α deforms the Roman surface into Boy's surface. Press ▶ to animate.</p>`,
  },
  {
    id: 'crosscap', name: 'Cross-cap', icon: 'boy',
    params: [],
    u: [0, TAU], v: [0, PI / 2], res: [1.4, 0.9], home: [-0.55, -0.5],
    f: () => (u, v) => [-cos(u) * sin(2 * v), sin(u) * sin(2 * v), cos(v) * cos(v) - cos(u) * cos(u) * sin(v) * sin(v)],
    about: `<p>The cross-cap is a classical model of the real projective plane ℝP² in ℝ³. It is not an immersion: it has a segment of self-intersection that ends in two <em>Whitney umbrella</em> pinch points.</p>
<p class="formula">X(u,v) = (−cos u sin 2v, sin u sin 2v, cos²v − cos²u sin²v)</p>
<p>The disc v ≤ π/2 is mapped so that antipodal points of its boundary circle are identified,
which is exactly how ℝP² arises from a disc.</p>`,
  },
  {
    id: 'dini', name: "Dini's surface", icon: 'dini',
    params: [
      { k: 'a', label: 'a', min: 0.3, max: 2, step: 0.01, v: 1 },
      { k: 'b', label: 'b (screw)', min: 0, max: 0.6, step: 0.005, v: 0.2, anim: true },
    ],
    u: [0, 4 * PI], v: [0.05, 2], res: [2, 0.7],
    f: (P) => (u, v) => [P.a * cos(u) * sin(v), P.a * sin(u) * sin(v), P.a * (cos(v) + log(tan(v / 2))) + P.b * u],
    about: `<p>Dini's surface (Ulisse Dini 1865) is obtained by twisting a pseudosphere: the tractrix is moved along a helix.</p>
<p class="formula">X(u,v) = (a cos u sin v, a sin u sin v, a(cos v + log tan(v/2)) + b u)</p>
<p>It has constant negative Gaussian curvature K = −1/(a² + b²). Check this with the Gaussian curvature colouring!</p>`,
  },
  {
    id: 'pseudosphere', name: 'Pseudosphere', icon: 'pseudo',
    params: [{ k: 'a', label: 'a', min: 0.3, max: 2, step: 0.01, v: 1 }],
    u: [-3.5, 3.5], v: [0, TAU], res: [1.4, 1.2], clip: () => null,
    f: (P) => (u, v) => [P.a * sech(u) * cos(v), P.a * sech(u) * sin(v), P.a * (u - tanh(u))],
    about: `<p>The pseudosphere is the surface of revolution of a tractrix (the curve traced by a weight dragged on a
leash of length a). Beltrami (1868) used it as a model of a piece of the hyperbolic plane.</p>
<p class="formula">X(u,v) = (a sech u cos v, a sech u sin v, a(u − tanh u))</p>
<p>The Gaussian curvature is constant K = −1/a²; the edge u = 0 is a cuspidal circle where the surface is singular.
Its total area is finite: 4πa², the same as the sphere of radius a.</p>`,
  },
  {
    id: 'kuen', name: 'Kuen surface', icon: 'pseudo',
    params: [{ k: 'U', label: 'u range', min: 1, max: 6, step: 0.05, v: 4.5 }],
    u: (P) => [-P.U, P.U], v: [0.03, PI - 0.03], res: [1.3, 1.3],
    f: () => (u, v) => {
      const sv = sin(v), d = 1 + u * u * sv * sv;
      return [2 * (cos(u) + u * sin(u)) * sv / d, 2 * (sin(u) - u * cos(u)) * sv / d, log(tan(v / 2)) + 2 * cos(v) / d];
    },
    clip: () => ({ radius: 6 }),
    about: `<p>Kuen's surface (Th. Kuen 1884) is another surface of constant negative curvature K = −1. It is obtained from
the pseudosphere by a Bäcklund transformation and corresponds to a 2-soliton solution of the sine-Gordon equation.</p>
<p class="formula">X(u,v) = ( 2(cos u + u sin u) sin v / D, 2(sin u − u cos u) sin v / D, log tan(v/2) + 2cos v / D ),<br>D = 1 + u² sin²v</p>`,
  },
  {
    id: 'monkey', name: 'Monkey saddle', icon: 'saddle',
    params: [{ k: 'R', label: 'radius', min: 0.3, max: 1.6, step: 0.01, v: 1 }],
    u: (P) => [0, P.R], v: [0, TAU], res: [0.7, 1.4],
    f: () => (r, t) => { const x = r * cos(t), y = r * sin(t); return [x, y, x * x * x - 3 * x * y * y]; },
    about: `<p>The monkey saddle z = x³ − 3xy² = Re (x+iy)³ has room for two legs and a tail.
Its origin is a degenerate critical point (umbilic, K = 0) where three valleys and three ridges meet.</p>
<p>Shown over a disc in polar coordinates.</p>`,
  },
  {
    id: 'hypar', name: 'Hyperbolic paraboloid', icon: 'saddle',
    params: [
      { k: 'a', label: 'a', min: 0.3, max: 3, step: 0.01, v: 1 },
      { k: 'b', label: 'b', min: 0.3, max: 3, step: 0.01, v: 1 },
    ],
    u: [-1.5, 1.5], v: [-1.5, 1.5], res: [1, 1], home: [0.45, 0.45],
    f: (P) => (u, v) => {
      // ruled parametrization: lines u = const and v = const are straight
      const x = (u + v) / Math.SQRT2, y = (u - v) / Math.SQRT2;
      return [P.a * x, P.b * y, u * v];
    },
    about: `<p>The hyperbolic paraboloid z = x²/a² − y²/b² is a doubly ruled quadric: through every point pass two
straight lines lying on the surface. The parametrization here uses rotated coordinates so that the parameter lines
are exactly those rulings:</p>
<p class="formula">X(u,v) = (a(u+v)/√2, b(u−v)/√2, uv)</p>
<p>The Gaussian curvature is negative everywhere (a saddle at every point).</p>`,
  },
  {
    id: 'usersurf', name: 'User-defined surface', icon: 'user',
    params: [
      { k: 'ex', label: 'x(u,v) =', type: 'expr', v: '(2 + cos(v)) cos(u)' },
      { k: 'ey', label: 'y(u,v) =', type: 'expr', v: '(2 + cos(v)) sin(u)' },
      { k: 'ez', label: 'z(u,v) =', type: 'expr', v: 'sin(v) + a sin(3u)/2' },
      { k: 'umin', label: 'u min', type: 'expr', v: '0' },
      { k: 'umax', label: 'u max', type: 'expr', v: '2pi' },
      { k: 'vmin', label: 'v min', type: 'expr', v: '0' },
      { k: 'vmax', label: 'v max', type: 'expr', v: '2pi' },
      { k: 'a', label: 'a', min: -3, max: 3, step: 0.01, v: 0.5, anim: true },
      { k: 'b', label: 'b', min: -3, max: 3, step: 0.01, v: 1, anim: true },
      { k: 'c', label: 'c', min: -3, max: 3, step: 0.01, v: 1, anim: true },
    ],
    u: (P) => [compile(P.umin, [])(), compile(P.umax, [])()],
    v: (P) => [compile(P.vmin, [])(), compile(P.vmax, [])()],
    res: [1.2, 1.2],
    f: userSurface,
    clip: () => ({ radius: 50 }),
    about: `<p>Enter any parametrization X(u,v) = (x, y, z). Expressions may use u, v, the slider parameters a, b, c,
the constants pi and e, + − * / ^, implicit multiplication (2u, a sin(u)) and the functions
sin cos tan sec csc cot asin acos atan sinh cosh tanh sech asinh acosh atanh exp log ln log10 sqrt cbrt abs sign floor ceil round.</p>
<p>Examples: the ellipsoid (a cos u cos v, b sin u cos v, c sin v) with u ∈ [0,2π], v ∈ [−π/2, π/2];
the “seashell” (e^(u/6)(cos u)(1+cos v), e^(u/6)(sin u)(1+cos v), e^(u/6) sin v − e^(u/3)) with u ∈ [0, 6π], v ∈ [0, 2π].</p>`,
  },
];
