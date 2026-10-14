// Tool definitions (input sequences + creation) and toolbar icons.
// Input kinds: point (existing or newly created), line, segment, vecline, curve, circle, path,
// cutter, poly, area, lengthable, trans, onpoint, any, place.

const dot = (x, y, r = 2.2) => `<circle cx="${x}" cy="${y}" r="${r}" class="fill"/>`;
const adot = (x, y, r = 3) => `<circle cx="${x}" cy="${y}" r="${r}" class="af"/>`;

export const ICONS = {
  move: '<path d="M6 3l11 9-5 .8 3 6.2-2.4 1.2-3-6.3L6 17z"/>',
  point: `${adot(12, 12, 4)}<path d="M15.5 5.5h4M17.5 3.5v4"/>`,
  pointOn: `<path d="M3 18 21 6"/>${adot(12, 12, 3.4)}`,
  intersect: `<path d="M4 4l16 16M20 4 4 20"/>${adot(12, 12, 3.2)}`,
  midpoint: `<path d="M3 17 21 7"/>${dot(3.5, 16.7)}${dot(20.5, 7.3)}${adot(12, 12, 2.9)}`,
  segment: `<path class="a" d="M5 18 19 6"/>${dot(5, 18, 2.4)}${dot(19, 6, 2.4)}`,
  line: `<path class="a" d="M2 20 22 4"/>${dot(8, 15.2, 2.4)}${dot(16, 8.8, 2.4)}`,
  ray: `<path class="a" d="M5 18 22 4"/>${dot(5, 18, 2.4)}${dot(13, 11.4, 2.4)}`,
  vector: `<path class="a" d="M4 19 19 6M19 6l-6.6.9M19 6l-1.4 6.4"/>${dot(4, 19, 2.3)}`,
  polygon: `<path class="a as" d="M4 18 6.5 6l10.5-1.5 4 9-8.5 6.5z"/>${dot(4, 18)}${dot(6.5, 6)}${dot(17, 4.5)}${dot(21, 13.5)}${dot(12.5, 20)}`,
  regpoly: `<path class="a as" d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>${dot(4.2, 16.5)}${dot(12, 21)}`,
  perp: '<path d="M3 17h18"/><path class="a" d="M11 21V3"/><path d="M11 13h4v4"/>',
  parallel: '<path d="M3 15 16 3"/><path class="a" d="M8 21 21 9"/>',
  perpbis: `<path d="M3 16h18"/>${dot(3.5, 16)}${dot(20.5, 16)}<path class="a" d="M12 3v19"/>`,
  anglebis: '<path d="M4 19h17M4 19 15 4"/><path class="a" d="M4 19 21 9.5"/>',
  tangent: `<circle cx="10" cy="14" r="6.5"/><path class="a" d="M2 7.5h20"/>${dot(10, 14, 1.6)}`,
  circle: `<circle class="a" cx="12" cy="12" r="8.5"/>${dot(12, 12)}${dot(20.5, 12)}`,
  circleR: `<circle class="a" cx="12" cy="12" r="8.5"/><path d="M12 12h8.5"/>${dot(12, 12)}`,
  circle3: `<circle class="a" cx="12" cy="12" r="8.5"/>${dot(3.5, 12)}${dot(17.5, 5.6)}${dot(15, 20)}`,
  compass: '<path d="M12 5 6.5 21M12 5l5.5 16M8.6 15h6.8"/><circle cx="12" cy="3.6" r="1.6" class="fill"/><path class="a" d="M3 13a10 10 0 0 1 18 0"/>',
  arc: `<path class="a" d="M4 15a8.5 8.5 0 0 1 14-7.5"/>${dot(12.5, 15)}<path d="M12.5 15H4M12.5 15l5.5-7.5" stroke-dasharray="1.5 2.5"/>`,
  arc3: `<path class="a" d="M3.5 17a9 9 0 0 1 17 0"/>${dot(3.5, 17)}${dot(12, 8)}${dot(20.5, 17)}`,
  reflectL: '<path d="M12 2v20" stroke-dasharray="2 2.4"/><path d="M3 7l5 10H3z"/><path class="a as" d="M21 7l-5 10h5z"/>',
  reflectP: `<path d="M3 4l7 2.5-4 4.5z"/><path class="a as" d="M21 20l-7-2.5 4-4.5z"/>${dot(12, 12, 1.9)}`,
  rotate: `<path d="M4 14a8 8 0 0 1 14.3-6.3"/><path d="M19 3.5v4.5h-4.5"/><path class="a as" d="M13 13l7 3-5 5z"/>${dot(12, 14, 1.8)}`,
  translate: '<path d="M3 9l3.5-6L10 9z"/><path class="a as" d="M14 21l3.5-6 3.5 6z"/><path d="M7 11l8 7M15 18l-1-3.6M15 18l-3.6-.6"/>',
  dilate: `${dot(3, 21, 1.8)}<path d="M6.5 16l3.5-.5-.5 3.5z"/><path class="a as" d="M10 11l9.5-1.5L18 19z"/><path d="M3 21 19.5 9.5" stroke-dasharray="1.5 2.5"/>`,
  distance: '<path d="M3 16.5 16.5 3l4.5 4.5L7.5 21z"/><path d="M7 12.5l2 2M10 9.5l2 2M13 6.5l2 2"/>',
  angle: '<path d="M4 20h17M4 20 15 5"/><path class="a" d="M12 20a8 8 0 0 0-3.2-6.4"/>',
  area: '<path class="a as" d="M4 18 8 5l11 3-2 10z"/>',
  coords: `<path d="M4 21V3M3 20h18"/><path d="M14 10v10M4 10h10" stroke-dasharray="1.5 2.5"/>${adot(14, 10, 2.8)}`,
  slope: '<path d="M3 20 21 4"/><path class="a" d="M7.5 16H15V9.3"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7.5h8M8.5 12h1.5M14 12h1.5M8.5 16.5h1.5M14 16.5h1.5"/>',
  text: '<path d="M5 5h14M12 5v15M9 20h6"/>',
  locus: `<path class="a" d="M2.5 14c3-9 6.5-9 9.5 0s6.5 9 9.5 0"/>${adot(17, 18.4, 2.6)}`,
  trace: '<circle cx="4.5" cy="18" r="1.4"/><circle cx="8.5" cy="13.5" r="1.4"/><circle cx="13" cy="10.5" r="1.4"/><circle class="af" cx="19" cy="9" r="2.8"/>',
  animate: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2.6"/><path class="af" d="M10 8.2v7.6l6-3.8z"/>',
  hide: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="a" d="M4 20 20 4"/>',
  label: '<path d="M5 20 11 4h2l6 16M7.7 14h8.6"/>',
  props: '<path d="M4 7h10M18 7h2M4 17h3M11 17h9"/><circle cx="16" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  delete: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  macro: '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect class="a as" x="13.5" y="13" width="7.5" height="7.5" rx="1.5"/><path d="M10.5 7.2h3a3 3 0 0 1 3 3V13"/>',
  macroDefine: '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1.5"/><path d="M10.5 7.2h3a3 3 0 0 1 3 3V13"/><path class="a" d="M17 15v6M14 18h6"/>',
  macroManage: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};

const add = (api, type, parents, params = {}, extra = {}) => api.add({ type, parents, params, ...extra });

export const TOOLS = {
  move: { group: 'move' },
  point: { group: 'points', alts: [{ in: ['point'], make: () => [] }] },
  pointOn: {
    group: 'points',
    alts: [{ in: ['path'], make: ([id], api) => [api.pointOn(id)] }],
  },
  intersect: { group: 'points', alts: [{ in: ['cutter', 'cutter'], make: (ids, api) => api.intersectAll(ids[0], ids[1]) }] },
  midpoint: {
    group: 'points',
    alts: [
      { in: ['point', 'point'], pv: 'midpoint', make: (ids, api) => [add(api, 'midpoint', ids)] },
      { in: ['segment'], make: (ids, api) => [add(api, 'midpoint', ids)] },
    ],
  },

  segment: { group: 'lines', alts: [{ in: ['point', 'point'], pv: 'segment', make: (ids, api) => [add(api, 'segment', ids)] }] },
  line: { group: 'lines', alts: [{ in: ['point', 'point'], pv: 'line', make: (ids, api) => [add(api, 'line', ids)] }] },
  ray: { group: 'lines', alts: [{ in: ['point', 'point'], pv: 'ray', make: (ids, api) => [add(api, 'ray', ids)] }] },
  vector: { group: 'lines', alts: [{ in: ['point', 'point'], pv: 'vector', make: (ids, api) => [add(api, 'vector', ids)] }] },
  polygon: { group: 'lines', polygon: true, alts: [{ in: ['point'], make: (ids, api) => [add(api, 'polygon', ids)] }] },
  regpoly: {
    group: 'lines',
    alts: [{
      in: ['point', 'point'],
      pv: 'regpoly',
      async make(ids, api) {
        const n = await api.askInt(api.STR.dlg.nTitle, api.STR.dlg.nLabel, api.lastN || 4, 3, 40);
        if (!n) return null;
        api.lastN = n;
        const poly = add(api, 'regpoly', ids, { n });
        const out = [poly];
        for (let i = 2; i < n; i++) out.push(add(api, 'polyvertex', [poly.id], { i }));
        return out;
      },
    }],
  },

  perp: {
    group: 'cons',
    alts: [
      { in: ['point', 'line'], make: (ids, api) => [add(api, 'perp', ids)] },
      { in: ['line', 'point'], pvRev: 'perp', make: (ids, api) => [add(api, 'perp', [ids[1], ids[0]])] },
    ],
  },
  parallel: {
    group: 'cons',
    alts: [
      { in: ['point', 'line'], make: (ids, api) => [add(api, 'parallel', ids)] },
      { in: ['line', 'point'], pvRev: 'parallel', make: (ids, api) => [add(api, 'parallel', [ids[1], ids[0]])] },
    ],
  },
  perpbis: {
    group: 'cons',
    alts: [
      { in: ['point', 'point'], pv: 'perpbis', make: (ids, api) => [add(api, 'perpbis', ids)] },
      { in: ['segment'], make: (ids, api) => [add(api, 'perpbis', ids)] },
    ],
  },
  anglebis: { group: 'cons', alts: [{ in: ['point', 'point', 'point'], pv: 'anglebis', make: (ids, api) => [add(api, 'anglebis', ids)] }] },
  tangent: {
    group: 'cons',
    alts: [
      { in: ['point', 'curve'], make: (ids, api) => api.tangents(ids[0], ids[1]) },
      { in: ['curve', 'point'], make: (ids, api) => api.tangents(ids[1], ids[0]) },
    ],
  },

  circle: { group: 'circles', alts: [{ in: ['point', 'point'], pv: 'circle', make: (ids, api) => [add(api, 'circle', ids)] }] },
  circleR: {
    group: 'circles',
    alts: [{
      in: ['point'],
      async make(ids, api) {
        const r = await api.askExpr(api.STR.dlg.radiusTitle, api.STR.dlg.radiusLabel, api.lastR || '2');
        if (r === null) return null;
        api.lastR = r;
        return [add(api, 'circleR', ids, { r })];
      },
    }],
  },
  circle3: { group: 'circles', alts: [{ in: ['point', 'point', 'point'], pv: 'circle3', make: (ids, api) => [add(api, 'circle3', ids)] }] },
  compass: {
    group: 'circles',
    alts: [
      { in: ['segment', 'point'], make: (ids, api) => [add(api, 'compass', ids)] },
      { in: ['point', 'point', 'point'], pv: 'compass', make: (ids, api) => [add(api, 'compass', ids)] },
    ],
  },
  arc: { group: 'circles', alts: [{ in: ['point', 'point', 'point'], pv: 'arc', make: (ids, api) => [add(api, 'arc', ids)] }] },
  arc3: { group: 'circles', alts: [{ in: ['point', 'point', 'point'], pv: 'arc3', make: (ids, api) => [add(api, 'arc3', ids)] }] },

  reflectL: { group: 'trans', alts: [{ in: ['trans', 'line'], make: (ids, api) => [api.transform('reflectL', ids)] }] },
  reflectP: { group: 'trans', alts: [{ in: ['trans', 'point'], make: (ids, api) => [api.transform('reflectP', ids)] }] },
  rotate: {
    group: 'trans',
    alts: [{
      in: ['trans', 'point'],
      async make(ids, api) {
        const a = await api.askExpr(api.STR.dlg.angleTitle, api.STR.dlg.angleLabel, api.lastAngle || '60');
        if (a === null) return null;
        api.lastAngle = a;
        return [api.transform('rotate', ids, { angle: a })];
      },
    }],
  },
  translate: {
    group: 'trans',
    alts: [
      { in: ['trans', 'vecline'], make: (ids, api) => [api.transform('translate', ids)] },
      { in: ['trans', 'point', 'point'], make: (ids, api) => [api.transform('translate', ids)] },
    ],
  },
  dilate: {
    group: 'trans',
    alts: [{
      in: ['trans', 'point'],
      async make(ids, api) {
        const k = await api.askExpr(api.STR.dlg.factorTitle, api.STR.dlg.factorLabel, api.lastFactor || '2');
        if (k === null) return null;
        api.lastFactor = k;
        return [api.transform('dilate', ids, { factor: k })];
      },
    }],
  },

  distance: {
    group: 'measure',
    alts: [
      { in: ['lengthable'], make: (ids, api) => [add(api, 'length', ids)] },
      { in: ['point', 'point'], make: (ids, api) => [add(api, 'dist', ids)] },
      { in: ['point', 'line'], make: (ids, api) => [add(api, 'dist', ids)] },
    ],
  },
  angle: { group: 'measure', alts: [{ in: ['point', 'point', 'point'], make: (ids, api) => [add(api, 'angle', ids)] }] },
  area: { group: 'measure', alts: [{ in: ['area'], make: (ids, api) => [add(api, 'area', ids)] }] },
  coords: { group: 'measure', alts: [{ in: ['point'], make: (ids, api) => [add(api, 'coords', ids)] }] },
  slope: { group: 'measure', alts: [{ in: ['line'], make: (ids, api) => [add(api, 'slope', ids)] }] },
  calc: {
    group: 'measure',
    alts: [{
      in: ['place'],
      async make(ids, api) {
        const e = await api.askCalc();
        if (e === null) return null;
        return [add(api, 'calc', [], { expr: e, x: api.pos.x, y: api.pos.y })];
      },
    }],
  },
  text: {
    group: 'measure',
    alts: [{
      in: ['place'],
      async make(ids, api) {
        const t = await api.askText();
        if (t === null) return null;
        return [add(api, 'text', [], { text: t, x: api.pos.x, y: api.pos.y })];
      },
    }],
  },

  locus: { group: 'misc', alts: [{ in: ['onpoint', 'point'], make: (ids, api) => [add(api, 'locus', ids)] }] },
  trace: { group: 'misc', action: true, alts: [{ in: ['trans'], make: ([id], api) => api.toggleTrace(id) }] },
  animate: { group: 'misc', action: true, alts: [{ in: ['onpoint'], make: ([id], api) => api.toggleAnimate(id) }] },
  hide: { group: 'misc', action: true, showHidden: true, alts: [{ in: ['any'], make: ([id], api) => api.toggleHidden(id) }] },
  label: { group: 'misc', action: true, alts: [{ in: ['any'], make: ([id], api) => api.toggleLabel(id) }] },
  props: { group: 'misc', action: true, alts: [{ in: ['any'], make: ([id], api) => api.properties(id) }] },
  delete: { group: 'misc', action: true, showHidden: true, alts: [{ in: ['any'], make: ([id], api) => api.deleteObj(id) }] },
};

export const GROUPS = [
  { id: 'move', tools: ['move'] },
  { id: 'points', tools: ['point', 'pointOn', 'intersect', 'midpoint'] },
  { id: 'lines', tools: ['segment', 'line', 'ray', 'vector', 'polygon', 'regpoly'] },
  { id: 'cons', tools: ['perp', 'parallel', 'perpbis', 'anglebis', 'tangent'] },
  { id: 'circles', tools: ['circle', 'circleR', 'circle3', 'compass', 'arc', 'arc3'] },
  { id: 'trans', tools: ['reflectL', 'reflectP', 'rotate', 'translate', 'dilate'] },
  { id: 'measure', tools: ['distance', 'angle', 'area', 'coords', 'slope', 'calc', 'text'] },
  { id: 'misc', tools: ['locus', 'trace', 'animate', 'hide', 'label', 'props', 'delete'] },
  { id: 'macros', tools: [] },
];
