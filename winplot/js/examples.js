// Example workspaces ("library"). Each example is a partial workspace.
const pi = Math.PI;
const P = (value, min, max, step = 0.1, mode = 'bounce', dur = 4) => ({ value, min, max, step, mode, dur });

export const EXAMPLES = [
  {
    title: 'Sine family with sliders', dim: 2,
    note: 'y = a·sin(b·x + c) + d. Drag the sliders or press ▶ to animate a parameter.',
    eq2: [{ type: 'explicit', f: 'a sin(b x + c) + d', color: '#d62728', width: 3 }, { type: 'explicit', f: 'sin(x)', color: '#999999', width: 1 }],
    params: { a: P(2, -4, 4, 0.1), b: P(1, 0.1, 4, 0.1), c: P(0, -pi, pi, 0.05), d: P(0, -3, 3, 0.1) },
    view2: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 },
  },
  {
    title: 'Lissajous curves', dim: 2,
    note: 'x = sin(a t), y = sin(b t + c). Animate c to see the figure rotate.',
    eq2: [{ type: 'parametric', x: 'sin(a t)', y: 'sin(b t + c)', tmin: '0', tmax: '2pi', steps: '1500', color: '#1f5fd6', width: 2 }],
    params: { a: P(3, 1, 9, 1), b: P(2, 1, 9, 1), c: P(0, 0, 2 * pi, 0.01, 'loop', 8) },
    view2: { xmin: -2.2, xmax: 2.2, ymin: -1.3, ymax: 1.3 },
  },
  {
    title: 'Rose curves', dim: 2,
    note: 'r = cos(k t): k petals for odd k, 2k petals for even k. Non-integer k needs a larger t-range.',
    eq2: [{ type: 'polar', r: 'cos(k t)', tmin: '0', tmax: '2pi', steps: '1200', color: '#e377c2', width: 3 },
      { type: 'polar', r: '1', tmin: '0', tmax: '2pi', steps: '200', color: '#bbbbbb', width: 1 }],
    params: { k: P(4, 1, 9, 1, 'bounce', 8) },
    settings2: { grid: 'polar' },
    view2: { xmin: -2, xmax: 2, ymin: -1.3, ymax: 1.3 },
  },
  {
    title: 'Conics (implicit)', dim: 2,
    note: 'Circle, ellipse and hyperbola as implicit equations f(x,y) = g(x,y).',
    eq2: [
      { type: 'implicit', eq: 'x^2 + y^2 = a^2', res: 'normal', color: '#d62728', width: 2 },
      { type: 'implicit', eq: 'x^2/9 + y^2/4 = 1', res: 'normal', color: '#1f5fd6', width: 2 },
      { type: 'implicit', eq: 'x^2 - y^2 = 1', res: 'normal', color: '#2ca02c', width: 2 },
    ],
    params: { a: P(2, 0.5, 4, 0.1) },
    view2: { xmin: -6, xmax: 6, ymin: -4, ymax: 4 },
  },
  {
    title: 'Folium of Descartes', dim: 2,
    note: 'x³ + y³ = 3a·x·y with asymptote x + y + a = 0.',
    eq2: [
      { type: 'implicit', eq: 'x^3 + y^3 = 3a x y', res: 'fine', color: '#9467bd', width: 3 },
      { type: 'explicit', f: '-x - a', color: '#999999', width: 1 },
    ],
    params: { a: P(1, 0.2, 3, 0.1) },
    view2: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
  },
  {
    title: "Slope field  y′ = x − y", dim: 2,
    note: 'Choose Solve mode and tap anywhere to draw more solution curves. Exact solutions: y = x − 1 + C·e^(−x).',
    eq2: [
      { type: 'ode', f: 'x - y', field: true, density: '22', arrows: false, solver: 'dp', ics: '(0,1) (0,-1) (-2,3) (0,-3) (-1,-4) (2,4)', color: '#1f5fd6', width: 2 },
      { type: 'explicit', f: 'x - 1', color: '#d62728', width: 1 },
    ],
    view2: { xmin: -4, xmax: 6, ymin: -5, ymax: 5 },
    mode2: 'solve',
  },
  {
    title: 'Logistic growth  y′ = a·y·(1 − y/b)', dim: 2,
    eq2: [{ type: 'ode', f: 'a y (1 - y/b)', field: true, density: '20', arrows: true, solver: 'dp', ics: '(0,0.2) (0,1) (0,5) (0,8) (0,-0.1)', color: '#2ca02c', width: 2 }],
    params: { a: P(1, 0.1, 3, 0.1), b: P(4, 1, 8, 0.5) },
    view2: { xmin: -1, xmax: 10, ymin: -2, ymax: 9 },
    settings2: { equal: false },
  },
  {
    title: 'Tangent line and integral', dim: 2,
    note: 'The tangent touches at x = a (animate a!). The shaded area is ∫₀² f(x) dx.',
    eq2: [{ type: 'explicit', f: 'x^3/4 - x', color: '#d62728', width: 3, tangent: { at: 'a' }, integral: { a: '0', b: '2' } }],
    params: { a: P(-1.5, -3, 3, 0.05, 'bounce', 6) },
    view2: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
  },
  {
    title: 'Taylor polynomials of sin(x)', dim: 2,
    eq2: [
      { type: 'explicit', f: 'sin(x)', color: '#111111', width: 3 },
      { type: 'explicit', f: 'x', color: '#d62728', width: 2 },
      { type: 'explicit', f: 'x - x^3/6', color: '#ff7f0e', width: 2 },
      { type: 'explicit', f: 'x - x^3/6 + x^5/120', color: '#2ca02c', width: 2 },
      { type: 'explicit', f: 'x - x^3/6 + x^5/120 - x^7/5040', color: '#1f5fd6', width: 2 },
    ],
    view2: { xmin: -7, xmax: 7, ymin: -3, ymax: 3 },
  },
  {
    title: 'Inequalities', dim: 2,
    note: 'The overlap of y < 4 − x² and y > x² − 2 is shaded twice.',
    eq2: [
      { type: 'inequality', rel: '<', f: '4 - x^2', alpha: '0.3', color: '#1f5fd6', width: 2 },
      { type: 'inequality', rel: '>=', f: 'x^2 - 2', alpha: '0.3', color: '#d62728', width: 2 },
    ],
    view2: { xmin: -4, xmax: 4, ymin: -3, ymax: 5 },
  },
  {
    title: 'Polar spiral and cardioid', dim: 2,
    eq2: [
      { type: 'polar', r: 't/2', tmin: '0', tmax: '6pi', steps: '1500', color: '#1f5fd6', width: 2 },
      { type: 'polar', r: 'a(1 + cos(t))', tmin: '0', tmax: '2pi', steps: '600', color: '#d62728', width: 3 },
    ],
    params: { a: P(3, 0.5, 6, 0.1) },
    settings2: { grid: 'polar' },
    view2: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
  },
  {
    title: 'Points, polygon and vectors', dim: 2,
    eq2: [
      { type: 'points', pts: '(0,0) (4,1) (1,3)', style: 'filled', labels: true, color: '#2ca02c', width: 2 },
      { type: 'segment', x1: '0', y1: '0', x2: 'a', y2: 'b', arrow: true, extend: false, color: '#d62728', width: 3 },
      { type: 'segment', x1: '-1', y1: '-2', x2: '3', y2: '0', arrow: false, extend: true, color: '#888888', width: 1 },
    ],
    params: { a: P(2, -4, 4, 0.1), b: P(-1, -4, 4, 0.1) },
    view2: { xmin: -5, xmax: 6, ymin: -4, ymax: 4 },
  },
  {
    title: 'Saddle surface  z = a(x² − y²)', dim: 3,
    eq3: [{ type: 'explicit', f: 'a(x^2 - y^2)', colorMode: 'height', res: '40', surface: true, mesh: true, opacity: '1', color: '#1f5fd6', width: 2 }],
    params: { a: P(0.5, -1, 1, 0.05) },
    box: { xmin: -2, xmax: 2, ymin: -2, ymax: 2, zmin: -2, zmax: 2 }, zauto: true,
  },
  {
    title: 'Ripple (cylindrical)', dim: 3,
    eq3: [{ type: 'cylindrical', f: 'cos(b r - c) exp(-r/4)', rmin: '0', rmax: '6', tmin: '0', tmax: '2pi', colorMode: 'height', res: '60', surface: true, mesh: true, opacity: '1', color: '#1f5fd6', width: 2 }],
    params: { b: P(2, 0.5, 4, 0.1), c: P(0, 0, 2 * pi, 0.05, 'loop', 3) },
    box: { xmin: -6, xmax: 6, ymin: -6, ymax: 6, zmin: -1.5, zmax: 1.5 }, zauto: false,
  },
  {
    title: 'Torus', dim: 3,
    eq3: [{ type: 'parametric', x: '(a + b cos(v))cos(u)', y: '(a + b cos(v))sin(u)', z: 'b sin(v)', umin: '0', umax: '2pi', vmin: '0', vmax: '2pi', colorMode: 'solid', res: '60', surface: true, mesh: true, opacity: '1', color: '#ff7f0e', width: 2 }],
    params: { a: P(2, 1, 3, 0.1), b: P(0.8, 0.1, 1.5, 0.05) },
    box: { xmin: -3.5, xmax: 3.5, ymin: -3.5, ymax: 3.5, zmin: -3.5, zmax: 3.5 }, zauto: false, equal3: true,
  },
  {
    title: 'Helix (space curve)', dim: 3,
    eq3: [
      { type: 'curve', x: '2cos(t)', y: '2sin(t)', z: 't/a', tmin: '-3pi', tmax: '3pi', steps: '800', color: '#d62728', width: 3 },
      { type: 'parametric', x: '2cos(u)', y: '2sin(u)', z: 'v', umin: '0', umax: '2pi', vmin: '-3', vmax: '3', colorMode: 'solid', res: '40', surface: true, mesh: false, opacity: '0.5', color: '#9ec5ff', width: 2 },
    ],
    params: { a: P(3, 1, 6, 0.1) },
    box: { xmin: -3, xmax: 3, ymin: -3, ymax: 3, zmin: -3, zmax: 3 }, zauto: false, equal3: true,
  },
  {
    title: 'Paraboloid cut by a plane', dim: 3,
    eq3: [
      { type: 'explicit', f: 'x^2 + y^2', colorMode: 'height', res: '40', surface: true, mesh: true, opacity: '1', color: '#1f5fd6', width: 2 },
      { type: 'explicit', f: 'a', colorMode: 'solid', res: '20', surface: true, mesh: false, opacity: '0.5', color: '#888888', width: 2 },
      { type: 'curve', x: 'sqrt(a)cos(t)', y: 'sqrt(a)sin(t)', z: 'a', tmin: '0', tmax: '2pi', steps: '200', color: '#d62728', width: 3 },
    ],
    params: { a: P(2, 0.1, 7.5, 0.1) },
    box: { xmin: -2, xmax: 2, ymin: -2, ymax: 2, zmin: 0, zmax: 8 }, zauto: false,
  },
  {
    title: 'Bumpy sphere (spherical)', dim: 3,
    eq3: [{ type: 'spherical', f: '2 + a sin(4u)sin(3v)', umin: '0', umax: '2pi', vmin: '0', vmax: 'pi', colorMode: 'height', res: '60', surface: true, mesh: true, opacity: '1', color: '#1f5fd6', width: 2 }],
    params: { a: P(0.4, 0, 1, 0.05) },
    box: { xmin: -3, xmax: 3, ymin: -3, ymax: 3, zmin: -3, zmax: 3 }, zauto: false, equal3: true,
  },
  {
    title: 'Möbius strip', dim: 3,
    eq3: [{ type: 'parametric', x: '(2 + v cos(u/2))cos(u)', y: '(2 + v cos(u/2))sin(u)', z: 'v sin(u/2)', umin: '0', umax: '2pi', vmin: '-0.7', vmax: '0.7', colorMode: 'solid', res: '60', surface: true, mesh: true, opacity: '1', color: '#2ca02c', width: 2 }],
    box: { xmin: -3, xmax: 3, ymin: -3, ymax: 3, zmin: -3, zmax: 3 }, zauto: false, equal3: true,
  },
];
