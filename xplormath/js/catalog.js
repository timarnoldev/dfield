// The museum: all objects, grouped by category, with About texts.
import { SURFACES } from './surfaces.js';
import { CURVES, FRENET_ABOUT } from './curves.js';
import { PLANE, PLANE_ABOUT } from './plane.js';
import { ODES } from './kinds/ode.js';

export const CATEGORIES = [
  { id: 'surface', name: 'Surfaces', kind: 'surface' },
  { id: 'curve', name: 'Space curves', kind: 'curve' },
  { id: 'plane', name: 'Plane curves', kind: 'plane' },
  { id: 'poly', name: 'Polyhedra', kind: 'poly' },
  { id: 'fractal', name: 'Fractals', kind: null },
  { id: 'ode', name: 'Dynamics', kind: 'ode' },
];

const MORPH = { k: 's', label: 'truncate → rectify → dual', min: 0, max: 2, step: 0.005, v: 0, anim: true };
const EULER = `<p>For every convex polyhedron Euler's formula V − E + F = 2 holds. The slider truncates the vertices by planes
perpendicular to the vertex directions. At 1 the cuts meet at the edge midpoints (<em>rectification</em>); continuing, the original faces
shrink to points and the <b>dual polyhedron</b> appears at 2 — its vertices correspond to the faces of the original and vice versa.
“Show dual” displays the dual compound: dual edges cross the original edges at right angles on the midsphere.</p>`;

const platonic = (id, solid, name, about) => ({ id, name, solid, params: [MORPH], morph: 's', about: about + EULER });
const arch = (id, solid, name, about) => ({ id, name, solid, params: [MORPH], morph: 's', about: about + EULER });

export const POLYHEDRA = [
  platonic('tetrahedron', 'tetrahedron', 'Tetrahedron', `<p>The regular tetrahedron {3,3}: 4 triangles, 3 at each vertex. It is self-dual. Its symmetry group has order 24 (12 rotations).</p>`),
  platonic('cube', 'cube', 'Cube', `<p>The cube (hexahedron) {4,3}: 6 squares, 3 at each vertex. Its dual is the octahedron. Truncating gives the truncated cube, rectifying the cuboctahedron.</p>`),
  platonic('octahedron', 'octahedron', 'Octahedron', `<p>The regular octahedron {3,4}: 8 triangles, 4 at each vertex — the dual of the cube, with the same symmetry group of order 48.</p>`),
  platonic('dodecahedron', 'dodecahedron', 'Dodecahedron', `<p>The regular dodecahedron {5,3}: 12 regular pentagons, 3 at each vertex. Its coordinates involve the golden ratio φ = (1+√5)/2. Its dual is the icosahedron; their common rectification is the icosidodecahedron.</p>`),
  platonic('icosahedron', 'icosahedron', 'Icosahedron', `<p>The regular icosahedron {3,5}: 20 triangles, 5 at each vertex. Its 12 vertices are the corners of three mutually perpendicular golden rectangles (0, ±1, ±φ).</p>`),
  arch('truncTetrahedron', 'truncTetrahedron', 'Truncated tetrahedron', `<p>Archimedean solid 3.6.6: 4 triangles and 4 hexagons.</p>`),
  arch('cuboctahedron', 'cuboctahedron', 'Cuboctahedron', `<p>Archimedean solid 3.4.3.4: 8 triangles, 6 squares; the rectified cube and octahedron. Its 12 vertices are the centres of the spheres of the densest packing around one sphere; it is the vector equilibrium of Buckminster Fuller.</p>`),
  arch('truncCube', 'truncCube', 'Truncated cube', `<p>Archimedean solid 3.8.8: 8 triangles, 6 octagons.</p>`),
  arch('truncOctahedron', 'truncOctahedron', 'Truncated octahedron', `<p>Archimedean solid 4.6.6: 6 squares, 8 hexagons. It tiles space (the bitruncated cubic honeycomb) and is the Voronoi cell of the body-centred cubic lattice.</p>`),
  arch('rhombicuboctahedron', 'rhombicuboctahedron', 'Rhombicuboctahedron', `<p>Archimedean solid 3.4.4.4: 8 triangles, 18 squares.</p>`),
  arch('truncCuboctahedron', 'truncCuboctahedron', 'Truncated cuboctahedron', `<p>Archimedean solid 4.6.8 (great rhombicuboctahedron): 12 squares, 8 hexagons, 6 octagons — 48 vertices, one for each symmetry of the cube.</p>`),
  arch('snubCube', 'snubCube', 'Snub cube', `<p>Archimedean solid 3.3.3.3.4: 32 triangles and 6 squares. It is chiral; its coordinates involve the tribonacci constant t ≈ 1.83929, the real root of t³ = t² + t + 1.</p>`),
  arch('icosidodecahedron', 'icosidodecahedron', 'Icosidodecahedron', `<p>Archimedean solid 3.5.3.5: 20 triangles and 12 pentagons — the rectified dodecahedron and icosahedron. Its 30 vertices lie at the edge midpoints of both.</p>`),
  arch('truncIcosahedron', 'truncIcosahedron', 'Truncated icosahedron', `<p>Archimedean solid 5.6.6: 12 pentagons, 20 hexagons — the classic football and the shape of the buckminsterfullerene molecule C₆₀.</p>`),
  arch('truncDodecahedron', 'truncDodecahedron', 'Truncated dodecahedron', `<p>Archimedean solid 3.10.10: 20 triangles and 12 decagons.</p>`),
  arch('rhombicosidodecahedron', 'rhombicosidodecahedron', 'Rhombicosidodecahedron', `<p>Archimedean solid 3.4.5.4: 20 triangles, 30 squares, 12 pentagons.</p>`),
  arch('truncIcosidodecahedron', 'truncIcosidodecahedron', 'Truncated icosidodecahedron', `<p>Archimedean solid 4.6.10: 30 squares, 20 hexagons, 12 decagons — 120 vertices, the most of any Archimedean solid.</p>`),
  {
    id: 'stellaOctangula', name: 'Stellated octahedron', solid: 'stellaOctangula', star: true, params: [], faceDesc: 'triangles (2 tetrahedra)', chiNote: '2 spheres',
    about: `<p>Kepler's <em>stella octangula</em> (1609) is the only stellation of the octahedron: extend the faces of an octahedron until they meet again.
The result is the compound of two dual regular tetrahedra, whose 8 vertices are those of a cube.
Counting the compound as two separate tetrahedra gives V − E + F = 8 − 12 + 8 = 4, the Euler characteristic of two spheres.</p>`,
  },
  {
    id: 'ssd', name: 'Small stellated dodecahedron', solid: 'smallStellatedDodecahedron', star: true, params: [], faceDesc: 'pentagrams', chiNote: 'genus 4 surface',
    about: `<p>The small stellated dodecahedron {5/2, 5} (Kepler 1619) is a regular star polyhedron: its 12 faces are pentagrams, five at each vertex.
It arises by extending the faces of the dodecahedron until they meet; its 12 vertices are those of an icosahedron.</p>
<p>As a polyhedral surface V − E + F = 12 − 30 + 12 = −6: Euler's formula “fails” because the pentagram faces intersect each other —
topologically the surface is a closed surface of genus 4. (Cayley noticed this in 1859.)</p>`,
  },
  {
    id: 'gd', name: 'Great dodecahedron', solid: 'greatDodecahedron', star: true, params: [], faceDesc: 'pentagons (intersecting)', chiNote: 'genus 4 surface',
    about: `<p>The great dodecahedron {5, 5/2} (Poinsot 1809) has 12 pentagonal faces passing through each other, five at each vertex, arranged in a pentagram around it.
It has the same vertices and edges as the icosahedron's vertex arrangement and is dual to the small stellated dodecahedron. V − E + F = 12 − 30 + 12 = −6.</p>`,
  },
  {
    id: 'gsd', name: 'Great stellated dodecahedron', solid: 'greatStellatedDodecahedron', star: true, params: [], faceDesc: 'pentagrams', chiNote: 'sphere',
    about: `<p>The great stellated dodecahedron {5/2, 3} (Kepler) is the final stellation of the dodecahedron: 12 pentagram faces, three at each of its 20 vertices,
which coincide with the vertices of a dodecahedron. Its visible surface is an icosahedron with a triangular pyramid on each face.
Here V − E + F = 20 − 30 + 12 = 2.</p>`,
  },
];

export const FRACTALS = [
  {
    id: 'mandelbrot', name: 'Mandelbrot set', kind: 'escape',
    params: [{ k: 'iter', label: 'max iterations', min: 50, max: 5000, step: 10, v: 250, int: true }],
    about: `<p>The Mandelbrot set M (1980) is the set of complex numbers c for which the orbit of 0 under</p>
<p class="formula">z ↦ z² + c</p>
<p>stays bounded. Points outside are coloured by how fast the orbit escapes (smooth iteration count).
M is connected (Douady–Hubbard); its boundary has Hausdorff dimension 2 (Shishikura). The main cardioid is the set of c for which z² + c has an attracting fixed point.</p>
<p><b>Navigation:</b> drag to move, pinch / scroll wheel to zoom, double-tap to zoom in. Press ▶ for an automatic zoom into the centre — first move
an interesting point (e.g. Seahorse Valley near −0.745 + 0.11i) to the centre.</p>
<p><b>Deep zoom:</b> a reference orbit is computed in double precision; the GPU iterates only the small deviation from it in single precision
(perturbation theory with rebasing), which allows magnifications up to about 10¹².</p>`,
  },
  {
    id: 'julia', name: 'Julia set', kind: 'escape',
    params: [
      { k: 'cx', label: 'Re c', min: -2, max: 1, step: 0.0005, v: -0.7269 },
      { k: 'cy', label: 'Im c', min: -1.5, max: 1.5, step: 0.0005, v: 0.1889 },
      { k: 'iter', label: 'max iterations', min: 50, max: 5000, step: 10, v: 300, int: true },
    ],
    presets: [['Douady rabbit', -0.1226, 0.7449], ['San Marco', -0.75, 0], ['Siegel disc', -0.390541, -0.586788], ['Dendrite', 0, 1], ['Dragon', -0.8, 0.156], ['Spiral', -0.7269, 0.1889], ['Dust', 0.285, 0.535]],
    about: `<p>For a fixed complex c the (filled) Julia set K<sub>c</sub> is the set of starting points z whose orbit under z ↦ z² + c stays bounded;
the Julia set J<sub>c</sub> is its boundary, where the dynamics is chaotic (Julia and Fatou, 1918).</p>
<p>J<sub>c</sub> is connected exactly when c belongs to the Mandelbrot set, otherwise it is a Cantor dust. Use the presets, or open the
Julia set for the centre of the Mandelbrot view. Press ▶ to move c around the circle |c| = 0.7885 and watch the Julia set morph.</p>`,
  },
  {
    id: 'sierpinski', name: 'Sierpinski triangle', kind: 'fractal2d', builder: 'sierpinski', morph: 'depth',
    params: [{ k: 'depth', label: 'depth', min: 0, max: 11, step: 1, v: 6, int: true, anim: true }],
    about: `<p>Wacław Sierpiński (1915): remove the middle quarter of a triangle and repeat with the three remaining triangles.
The limit is the attractor of three contractions by ½; it has area 0 and Hausdorff dimension log 3 / log 2 ≈ 1.585.
It also appears as Pascal's triangle modulo 2 and in the chaos game.</p>`,
  },
  {
    id: 'carpet', name: 'Sierpinski carpet', kind: 'fractal2d', builder: 'carpet', morph: 'depth',
    params: [{ k: 'depth', label: 'depth', min: 0, max: 7, step: 1, v: 4, int: true, anim: true }],
    about: `<p>Divide a square into 9 and remove the middle one; repeat forever. The carpet is a universal plane curve: every compact
one-dimensional planar set embeds into it. Dimension log 8 / log 3 ≈ 1.893.</p>`,
  },
  {
    id: 'koch', name: 'Koch snowflake', kind: 'fractal2d', builder: 'koch', morph: 'depth',
    params: [{ k: 'depth', label: 'depth', min: 0, max: 7, step: 1, v: 4, int: true, anim: true }],
    about: `<p>Helge von Koch (1904): replace the middle third of every segment by two sides of an equilateral triangle.
Each step multiplies the length by 4/3, so the limit curve has infinite length but bounds the finite area 8/5 of the original triangle.
It is continuous but nowhere differentiable; dimension log 4 / log 3 ≈ 1.262.</p>`,
  },
  {
    id: 'dragon', name: 'Dragon curve', kind: 'fractal2d', builder: 'dragon', morph: 'depth',
    params: [{ k: 'depth', label: 'depth (folds)', min: 0, max: 18, step: 1, v: 12, int: true, anim: true }],
    about: `<p>The Heighway dragon (Heighway, Banks, Harter 1966; popularised in “Jurassic Park”): fold a strip of paper in half n times,
unfold it so that every crease makes a right angle. The turn at step k is determined by the bit left of the lowest 1-bit of k (regular paper-folding sequence).
The curve never crosses itself, tiles the plane with copies of itself and its boundary has dimension ≈ 1.524.</p>`,
  },
  {
    id: 'levy', name: 'Lévy C curve', kind: 'fractal2d', builder: 'levy', morph: 'depth',
    params: [{ k: 'depth', label: 'depth', min: 0, max: 18, step: 1, v: 12, int: true, anim: true }],
    about: `<p>Paul Lévy (1938): replace each segment by the two legs of an isosceles right triangle over it, always on the same side.
The limit curve has dimension 2 (it contains open sets); its boundary has dimension ≈ 1.934.</p>`,
  },
  {
    id: 'hilbert', name: 'Hilbert curve', kind: 'fractal2d', builder: 'hilbert', morph: 'depth',
    params: [{ k: 'depth', label: 'order', min: 1, max: 9, step: 1, v: 5, int: true, anim: true }],
    about: `<p>David Hilbert's space-filling curve (1891): the limit of these polygons is a continuous surjection of [0,1] onto the square.
Points that are close on the line stay close in the square, which is why Hilbert curves are used for spatial indexing. Colour shows the parameter.</p>`,
  },
  {
    id: 'pythagoras', name: 'Pythagoras tree', kind: 'fractal2d', builder: 'pythagoras', morph: 'angle',
    params: [
      { k: 'depth', label: 'depth', min: 0, max: 14, step: 1, v: 10, int: true },
      { k: 'angle', label: 'angle (°)', min: 10, max: 80, step: 0.5, v: 45, anim: true },
    ],
    about: `<p>Albert Bosman (1942): on top of a square erect a right triangle and on its two legs two smaller squares, recursively.
At every step the areas obey Pythagoras' theorem, so each generation has the same total area as the trunk. Animate the angle to let the tree sway.</p>`,
  },
  {
    id: 'fern', name: 'Barnsley fern', kind: 'fractal2d', builder: 'fern', morph: 'logn',
    params: [{ k: 'logn', label: 'points (10^x)', min: 3, max: 6.3, step: 0.05, v: 5.3, anim: true }],
    about: `<p>Michael Barnsley's fern (1988) is the attractor of an <b>iterated function system</b> of four affine maps, drawn with the chaos game:
starting anywhere, repeatedly apply one of the maps chosen at random (with probabilities 1%, 85%, 7%, 7%):</p>
<p class="formula">f₁(x,y) = (0, 0.16y)<br>f₂(x,y) = (0.85x + 0.04y, −0.04x + 0.85y + 1.6)<br>f₃(x,y) = (0.2x − 0.26y, 0.23x + 0.22y + 1.6)<br>f₄(x,y) = (−0.15x + 0.28y, 0.26x + 0.24y + 0.44)</p>
<p>Each map sends the whole fern onto a part of itself: the stem, the upper fern, and the two lowest leaves.</p>`,
  },
];

for (const o of SURFACES) { o.cat = 'surface'; o.kind = 'surface'; }
for (const o of CURVES) { o.cat = 'curve'; o.kind = 'curve'; o.morph = o.morph || 'pos'; o.about += FRENET_ABOUT; }
for (const o of PLANE) { o.cat = 'plane'; o.kind = 'plane'; o.about += PLANE_ABOUT; }
for (const o of POLYHEDRA) { o.cat = 'poly'; o.kind = 'poly'; }
for (const o of FRACTALS) { o.cat = 'fractal'; }
for (const o of ODES) { o.cat = 'ode'; o.kind = 'ode'; }

export const OBJECTS = [...SURFACES, ...CURVES, ...PLANE, ...POLYHEDRA, ...FRACTALS, ...ODES];
export const byId = new Map(OBJECTS.map((o) => [o.id, o]));
