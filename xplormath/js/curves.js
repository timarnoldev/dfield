// Space curves catalog.
import { compile } from './parser.js';

const { sin, cos, PI, sqrt } = Math;
const TAU = 2 * PI;

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }

export const CURVES = [
  {
    id: 'helix', name: 'Helix', icon: 'helix',
    params: [
      { k: 'a', label: 'radius a', min: 0.2, max: 3, step: 0.01, v: 1.5 },
      { k: 'b', label: 'pitch b', min: -1.5, max: 1.5, step: 0.01, v: 0.35, anim: true },
      { k: 'turns', label: 'turns', min: 1, max: 8, step: 0.5, v: 3 },
    ],
    t: (P) => [-P.turns * PI, P.turns * PI], closed: false,
    f: (P) => (t) => [P.a * cos(t), P.a * sin(t), P.b * t],
    about: `<p>The circular helix r(t) = (a cos t, a sin t, bt) is the only curve (up to rigid motion) with constant
non-zero curvature and torsion:</p>
<p class="formula">κ = a / (a² + b²),   τ = b / (a² + b²)</p>
<p>Its tangent makes a constant angle with the axis, so it is also a <em>general helix</em> (Lancret's theorem: κ/τ constant).
Negative b gives a left-handed helix with negative torsion.</p>`,
  },
  {
    id: 'trefoil', name: 'Trefoil knot', icon: 'knot',
    params: [],
    t: [0, TAU], closed: true,
    f: () => (t) => [sin(t) + 2 * sin(2 * t), cos(t) - 2 * cos(2 * t), -sin(3 * t)],
    about: `<p>The trefoil is the simplest non-trivial knot (crossing number 3). A popular smooth parametrization:</p>
<p class="formula">r(t) = (sin t + 2 sin 2t, cos t − 2 cos 2t, −sin 3t),  0 ≤ t ≤ 2π</p>
<p>It is also the (2,3) torus knot. The trefoil is chiral: it is not equivalent to its mirror image.</p>`,
  },
  {
    id: 'torusknot', name: 'Torus knot (p,q)', icon: 'knot',
    params: [
      { k: 'p', label: 'p (around axis)', min: 1, max: 9, step: 1, v: 2, int: true },
      { k: 'q', label: 'q (through hole)', min: 1, max: 13, step: 1, v: 3, int: true },
      { k: 'R', label: 'R', min: 1, max: 3, step: 0.01, v: 2 },
      { k: 'r', label: 'r', min: 0.1, max: 1.5, step: 0.01, v: 0.8 },
    ],
    t: [0, TAU], closed: true,
    f: (P) => (t) => [(P.R + P.r * cos(P.q * t)) * cos(P.p * t), (P.R + P.r * cos(P.q * t)) * sin(P.p * t), P.r * sin(P.q * t)],
    note: (P) => (gcd(P.p, P.q) === 1 ? (P.p === 1 || P.q === 1 ? 'unknot (p or q = 1)' : `(${P.p},${P.q}) torus knot`) : `torus link with ${gcd(P.p, P.q)} components drawn as one curve`),
    about: `<p>The (p,q) torus knot winds p times around the axis of a torus and q times through its hole:</p>
<p class="formula">r(t) = ((R + r cos qt) cos pt, (R + r cos qt) sin pt, r sin qt)</p>
<p>If p and q are coprime this is a knot; (2,3) is the trefoil, (2,5) the cinquefoil (Solomon's seal), (3,4) and (3,5) are
further classics. If gcd(p,q) = d &gt; 1 one obtains a link of d components. Torus knots (p,q) and (q,p) are equivalent.</p>`,
  },
  {
    id: 'cinquefoil', name: 'Cinquefoil knot', icon: 'knot',
    params: [{ k: 'r', label: 'r', min: 0.2, max: 1.5, step: 0.01, v: 0.9 }],
    t: [0, TAU], closed: true,
    f: (P) => (t) => [(2 + P.r * cos(5 * t)) * cos(2 * t), (2 + P.r * cos(5 * t)) * sin(2 * t), P.r * sin(5 * t)],
    about: `<p>The cinquefoil (pentafoil, Solomon's seal) knot 5₁ is the (2,5) torus knot:</p>
<p class="formula">r(t) = ((2 + r cos 5t) cos 2t, (2 + r cos 5t) sin 2t, r sin 5t)</p>
<p>Seen from above it looks like a five-pointed star drawn without lifting the pen.</p>`,
  },
  {
    id: 'fig8knot', name: 'Figure-eight knot', icon: 'knot',
    params: [],
    t: [0, TAU], closed: true,
    f: () => (t) => [(2 + cos(2 * t)) * cos(3 * t), (2 + cos(2 * t)) * sin(3 * t), sin(4 * t)],
    about: `<p>The figure-eight knot 4₁ is the unique knot with crossing number 4. It is amphichiral (equivalent to its mirror image).</p>
<p class="formula">r(t) = ((2 + cos 2t) cos 3t, (2 + cos 2t) sin 3t, sin 4t)</p>`,
  },
  {
    id: 'viviani', name: "Viviani's curve", icon: 'viviani',
    params: [{ k: 'a', label: 'a', min: 0.3, max: 2, step: 0.01, v: 1 }],
    t: [-TAU, TAU], closed: true,
    f: (P) => (t) => [P.a * (1 + cos(t)), P.a * sin(t), 2 * P.a * sin(t / 2)],
    about: `<p>Viviani's curve (1692) is the intersection of the sphere x² + y² + z² = 4a² with the cylinder (x − a)² + y² = a²
that touches it from inside:</p>
<p class="formula">r(t) = (a(1 + cos t), a sin t, 2a sin(t/2)),  −2π ≤ t ≤ 2π</p>
<p>It is a spherical figure-eight curve with curvature and torsion κ = √(13 + 3cos t)/(a(3 + cos t)<sup>3/2</sup>), τ = 6 cos(t/2)/(a(13 + 3cos t)); the torsion changes sign at the points (0, 0, ±2a).</p>`,
  },
  {
    id: 'spherical', name: 'Spherical spiral', icon: 'viviani',
    params: [{ k: 'c', label: 'winding c', min: 2, max: 30, step: 0.5, v: 10 }],
    t: [-PI / 2 + 0.001, PI / 2 - 0.001], closed: false,
    f: (P) => (t) => [2 * cos(t) * cos(P.c * t), 2 * cos(t) * sin(P.c * t), 2 * sin(t)],
    about: `<p>A spiral on the sphere of radius 2 from the south to the north pole: latitude t, longitude ct.</p>
<p class="formula">r(t) = 2 (cos t cos ct, cos t sin ct, sin t)</p>`,
  },
  {
    id: 'usercurve', name: 'User-defined curve', icon: 'user',
    params: [
      { k: 'ex', label: 'x(t) =', type: 'expr', v: 'cos(t) + a cos(3t)' },
      { k: 'ey', label: 'y(t) =', type: 'expr', v: 'sin(t) - a sin(3t)' },
      { k: 'ez', label: 'z(t) =', type: 'expr', v: 'b sin(2t)' },
      { k: 'tmin', label: 't min', type: 'expr', v: '0' },
      { k: 'tmax', label: 't max', type: 'expr', v: '2pi' },
      { k: 'a', label: 'a', min: -3, max: 3, step: 0.01, v: 0.4, anim: true },
      { k: 'b', label: 'b', min: -3, max: 3, step: 0.01, v: 0.6, anim: true },
    ],
    t: (P) => [compile(P.tmin, [])(), compile(P.tmax, [])()],
    closed: false, detectClosed: true,
    f: (P) => {
      const n = ['t', 'a', 'b'];
      const fx = compile(P.ex, n), fy = compile(P.ey, n), fz = compile(P.ez, n);
      return (t) => [fx(t, P.a, P.b), fy(t, P.a, P.b), fz(t, P.a, P.b)];
    },
    about: `<p>Enter any space curve r(t) = (x(t), y(t), z(t)) using t and the parameters a, b
(same expression syntax as for user-defined surfaces). Curvature and torsion are computed numerically:</p>
<p class="formula">κ = |r′ × r″| / |r′|³,   τ = (r′ × r″) · r‴ / |r′ × r″|²</p>`,
  },
];

export const FRENET_ABOUT = `<p><b>Frenet frame.</b> At each point of a regular space curve, T is the unit tangent, N the principal normal
(pointing towards the centre of curvature) and B = T × N the binormal. They satisfy the Frenet–Serret equations</p>
<p class="formula">T′ = κN,  N′ = −κT + τB,  B′ = −τN   (′ = d/ds)</p>
<p>with curvature κ and torsion τ. Press ▶ to move the frame along the curve; T is red, N green, B blue.
The tube around the curve is built with a rotation-minimizing (parallel transport) frame so it does not twist.</p>`;
