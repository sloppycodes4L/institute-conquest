// @ts-nocheck
// A Skirmish board as a war-room map: the painting in src/engine/skirmish.ts, drawn as a cartographer would draw it.
// No hexes. Coasts and borders are pen lines on vellum; every territory is washed in its holder's colour; the ground
// (mountains, woods, fens) is sketched in; a key-pattern frame runs round it and a register under it gives the board's
// name, what each region is worth, and how to read the wooden pieces.
//
// This file makes the sheet (its outlines, then its three layers: vellum and sea, the holders' washes, the ink).
// board.ts lays it on the table and stands the pieces on it. It came from docs/skirmish-map-mockup.html.

import { skirmishDef, SKIRMISH_MAPS } from '../engine/skirmish.ts';

/** Where the compass rose sits on each sheet: column, row (painting cells) and radius (world units). */
const ROSE = { earth: [6.3, 25.5, 8], mars: [58.4, 25.6, 7.6], westeros: [2.3, 46, 5.2], nations: [5.6, 3.9, 7.4] };
const INK = '#2b190e', BLOOD = '#7a1b14', GOLD = '#b08a2e';
const SQ3 = Math.sqrt(3), CW = 2 * SQ3, CH = 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- noise
const hash = (x, y) => { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const vn = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const fbm = (x, y) => vn(x, y) * .5 + vn(x * 2.1 + 9, y * 2.1 + 4) * .27 + vn(x * 4.3 + 2, y * 4.3 + 7) * .15 + vn(x * 8.9, y * 8.9) * .08;
const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- the painting, as drawn outlines
function chaikin(p, closed, it) {
  for (; it--;) {
    const out = [], n = p.length;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}
function resample(p, step, closed) {
  const q = closed ? [...p, p[0]] : p, seg = [];
  let L = 0;
  for (let i = 0; i < q.length - 1; i++) { const d = Math.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]); seg.push(d); L += d; }
  const n = Math.max(closed ? 8 : 1, Math.round(L / step)), out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < (closed ? n : n + 1); k++) {
    const s = (L * k) / n;
    while (i < seg.length - 1 && acc + seg[i] < s) { acc += seg[i]; i++; }
    const f = seg[i] ? clamp((s - acc) / seg[i], 0, 1) : 0;
    out.push([q[i][0] + (q[i + 1][0] - q[i][0]) * f, q[i][1] + (q[i + 1][1] - q[i][1]) * f]);
  }
  if (!closed) { out[0] = p[0]; out[out.length - 1] = p[p.length - 1]; }
  return out;
}

function buildSheet(def, mi) {
  const rows = Math.max(...Object.keys(def.art).map(Number)) + 2, cols = def.cols;
  const letters = Object.keys(def.terr), idOf = new Map(letters.map((l, i) => [l, i])), nt = letters.length;
  const g = Array.from({ length: rows }, () => new Int16Array(cols).fill(-1));
  for (const [row, runs] of Object.entries(def.art)) for (const run of runs.split(/\s+/).filter(Boolean)) {
    const m = /^([A-Za-z])(\d+)(?:-(\d+))?$/.exec(run), a = +m[2], b = m[3] ? +m[3] : a;
    for (let c = a; c <= b; c++) g[+row][c] = idOf.get(m[1]);
  }
  const L = (r, c) => (r < 0 || r >= rows || c < 0 || c >= cols ? -1 : g[r][c]);
  const region = letters.map((l) => def.terr[l][1]), names = letters.map((l) => def.terr[l][0]);

  // The sheet: a frame, the map window, and a register (title, regions, key) under it.
  const MW = cols * CW, MH = rows * CH, OX = 6.8, OY = 6.8, portrait = MW + 13.6 < MH + 30;
  const RH = portrait ? 22 : 13, SW = MW + 13.6, SH = MH + 13.6 + RH;
  const so = mi * 137.3;
  const warp = (x, y) => [
    x + (vn(x * .09 + 3.1 + so, y * .09 + 9.7) - .5) * 2.6 + (vn(x * .3 + 50.3, y * .3 + 1.2 + so) - .5) * .8,
    y + (vn(x * .09 + 70.2, y * .09 - 20.4 + so) - .5) * 2.6 + (vn(x * .3 + 7.7 + so, y * .3 + 40.9) - .5) * .8,
  ];

  // Every side of a cell that parts two different owners (or land from sea) is an edge between two grid corners.
  const VW = cols + 1, edges = [], nb = new Map();
  const addE = (v0, v1, a, b) => { const e = edges.length; edges.push({ v0, v1, a, b }); for (const v of [v0, v1]) { let l = nb.get(v); if (!l) nb.set(v, (l = [])); l.push(e); } };
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) { const a = L(r, c - 1), b = L(r, c); if (a !== b) addE(r * VW + c, (r + 1) * VW + c, a, b); }
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) { const a = L(r - 1, c), b = L(r, c); if (a !== b) addE(r * VW + c, r * VW + c + 1, a, b); }
  const P = (v) => [OX + (v % VW) * CW, OY + Math.floor(v / VW) * CH];
  const isNode = (v) => nb.get(v).length !== 2;
  const used = new Uint8Array(edges.length), chains = [];
  const walk = (start, e) => {
    const vs = [start];
    let v = start;
    for (;;) {
      used[e] = 1;
      v = edges[e].v0 === v ? edges[e].v1 : edges[e].v0;
      vs.push(v);
      if (isNode(v) || v === start) break;
      const [e1, e2] = nb.get(v);
      e = e1 === e ? e2 : e1;
    }
    return vs;
  };
  // A border is drawn once and shared by both sides: corners cut, smoothed, then pushed about like a pen line.
  const draw = (vs, closed, sea) => {
    let p = vs.map(P);
    if (closed) { p = p.slice(0, -1); p = p.map((a, i) => { const b = p[(i + 1) % p.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }); }
    else if (p.length > 2) { const m = [p[0]]; for (let i = 0; i < p.length - 1; i++) m.push([(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]); m.push(p[p.length - 1]); p = m; }
    const step = sea ? .3 : .45;
    p = resample(chaikin(p, closed, 2), step, closed);
    const n = p.length;
    return p.map(([x, y], i) => {
      let [X, Y] = warp(x, y);
      if (sea) {
        const w = closed ? 1 : Math.min(1, (i * step) / 1.4, ((n - 1 - i) * step) / 1.4);
        X += (vn(x * 1.25 + 11 + so, y * 1.25 + 5) - .5) * .62 * w;
        Y += (vn(x * 1.25 + 31, y * 1.25 + 77 + so) - .5) * .62 * w;
      }
      return [X, Y];
    });
  };
  for (const [v, list] of nb) if (isNode(v)) for (const e of list) if (!used[e]) {
    const vs = walk(v, e), { a, b } = edges[e];
    chains.push({ a, b, v0: vs[0], v1: vs[vs.length - 1], closed: false, pts: draw(vs, false, a < 0 || b < 0) });
  }
  edges.forEach((ed, e) => { if (!used[e]) { const vs = walk(ed.v0, e); chains.push({ a: ed.a, b: ed.b, v0: -1, v1: -1, closed: true, pts: draw(vs, true, ed.a < 0 || ed.b < 0) }); } });

  const rings = [], path = [], bbox = [];
  for (let t = 0; t < nt; t++) {
    const cs = chains.filter((c) => c.a === t || c.b === t), done = new Set(), byV = new Map(), out = [];
    for (const c of cs) if (!c.closed) for (const v of [c.v0, c.v1]) { let l = byV.get(v); if (!l) byV.set(v, (l = [])); l.push(c); }
    for (const c of cs) {
      if (done.has(c)) continue;
      done.add(c);
      if (c.closed) { out.push(c.pts); continue; }
      const ring = [...c.pts];
      let end = c.v1;
      while (end !== c.v0) {
        const nx = byV.get(end).find((k) => !done.has(k));
        if (!nx) break;
        done.add(nx);
        if (nx.v0 === end) { ring.push(...nx.pts.slice(1)); end = nx.v1; } else { ring.push(...nx.pts.slice(0, -1).reverse()); end = nx.v0; }
      }
      out.push(ring);
    }
    const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0));
    out.sort((a, b) => area(b) - area(a));
    rings.push(out);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of out) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    bbox.push([x0, y0, x1 - x0, y1 - y0]);
    if (typeof Path2D !== 'undefined') { const pa = new Path2D(); for (const r of out) { r.forEach(([x, y], i) => (i ? pa.lineTo(x, y) : pa.moveTo(x, y))); pa.closePath(); } path.push(pa); }
  }
  const line = (pa, c) => { c.pts.forEach(([x, y], i) => (i ? pa.lineTo(x, y) : pa.moveTo(x, y))); if (c.closed) pa.closePath(); };
  const coast = new Path2D(), inner = new Path2D(), march = new Path2D();
  for (const c of chains) line(c.a < 0 || c.b < 0 ? coast : region[c.a] !== region[c.b] ? march : inner, c);

  // Where the pieces stand: the cell deepest inside each territory.
  const depth = g.map((row) => new Int16Array(row.length).fill(-1)), queue = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c] >= 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => L(r + dr, c + dc) !== g[r][c])) { depth[r][c] = 0; queue.push([r, c]); }
  for (let i = 0; i < queue.length; i++) { const [r, c] = queue[i]; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (L(r + dr, c + dc) >= 0 && depth[r + dr][c + dc] < 0) { depth[r + dr][c + dc] = depth[r][c] + 1; queue.push([r + dr, c + dc]); } }
  const cellsOf = Array.from({ length: nt }, () => []);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c] >= 0) cellsOf[g[r][c]].push([r, c]);
  const heart = cellsOf.map((cs) => {
    const mr = cs.reduce((s, x) => s + x[0], 0) / cs.length, mc = cs.reduce((s, x) => s + x[1], 0) / cs.length;
    const score = ([r, c]) => depth[r][c] * 2.2 - Math.hypot(r - mr, (c - mc) * 1.15);
    const best = Math.max(...cs.map(score)), top = cs.filter((x) => score(x) >= best - .7);
    const r = top.reduce((s, x) => s + x[0], 0) / top.length, c = top.reduce((s, x) => s + x[1], 0) / top.length;
    return warp(OX + (c + .5) * CW, OY + (r + .5) * CH);
  });
  const regions = def.regions.map(([name, bonus], id) => {
    const cs = cellsOf.flatMap((list, t) => (region[t] === id ? list : []));
    const r0 = Math.min(...cs.map((x) => x[0])), r1 = Math.max(...cs.map((x) => x[0])), c0 = Math.min(...cs.map((x) => x[1])), c1 = Math.max(...cs.map((x) => x[1]));
    const at = warp(OX + (cs.reduce((s, x) => s + x[1], 0) / cs.length + .5) * CW, OY + (cs.reduce((s, x) => s + x[0], 0) / cs.length + .5) * CH);
    return { id, name, bonus, at, w: (c1 - c0 + 1) * CW, h: (r1 - r0 + 1) * CH };
  });
  const nth = new Array(def.regions.length).fill(0);
  const ground = letters.map((l) => def.regions[def.terr[l][1]][2][nth[def.terr[l][1]]++] || 'p');
  const lanes = def.lanes.map((s) => { const m = /^([A-Za-z])(~?)([A-Za-z])$/.exec(s); return { a: idOf.get(m[1]), b: idOf.get(m[3]), wrap: !!m[2] }; });

  const geo = { def, mi, rows, cols, nt, names, region, regions, ground, cells: cellsOf.map((c) => c.length), chains, rings, path, bbox, coast, inner, march, heart, lanes, MW, MH, OX, OY, SW, SH, RH, portrait };
  layoutLanes(geo);
  return geo;
}

const SHEETS = new Map();
/** A board's sheet: its outlines, hearts and sea lanes, in sheet units from its top-left corner (made once, then kept). */
export function sheetFor(id) {
  const def = skirmishDef(id);
  let s = SHEETS.get(def.id);
  if (!s) { s = buildSheet(def, Math.max(0, SKIRMISH_MAPS.indexOf(def))); SHEETS.set(def.id, s); }
  return s;
}

// ---------------------------------------------------------------- measuring and hit-testing
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
let mctx = null, hit = null;
const fontOf = (px, o) => `${o.style || ''} ${o.weight || 700} ${px}px ${o.family || 'Cinzel'}`;
function measure(str, size, o = {}) { mctx ??= mk(4, 4).getContext('2d'); mctx.font = fontOf(100, o); mctx.letterSpacing = `${(o.track || 0) * 100}px`; return (mctx.measureText(str).width / 100) * size; }
/** The territory at a point of the sheet, or -1 for sea, frame and register. */
export function landAt(geo, x, y) {
  hit ??= mk(4, 4).getContext('2d');
  for (let t = 0; t < geo.nt; t++) { const b = geo.bbox[t]; if (x >= b[0] && y >= b[1] && x <= b[0] + b[2] && y <= b[1] + b[3] && hit.isPointInPath(geo.path[t], x, y, 'evenodd')) return t; }
  return -1;
}

/** Each sea lane as a line from shore to shore, bowed to keep off the land (or, round the world, two runs to the edges). */
function layoutLanes(geo) {
  const ringPts = (t) => geo.rings[t].flatMap((r) => r.filter((_, i) => i % 3 === 0));
  geo.ways = geo.lanes.map((l) => {
    const A = ringPts(l.a), B = ringPts(l.b);
    if (l.wrap) {
      const run = (mine) => {
        const left = mine.reduce((s, p) => s + p[0], 0) / mine.length < geo.SW / 2, p = mine.reduce((b, q) => ((left ? q[0] < b[0] : q[0] > b[0]) ? q : b)), ex = left ? 5.9 : geo.SW - 5.9;
        return Array.from({ length: 12 }, (_, i) => [p[0] + ((ex - p[0]) * i) / 11, p[1]]);
      };
      const out = run(A), home = run(B);
      return { a: l.a, b: l.b, wrap: true, pts: out, back: home.slice().reverse() };
    }
    let best = 1e9, pa = A[0], pb = B[0];
    for (const p of A) for (const q of B) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < best) { best = d; pa = p; pb = q; } }
    const len = Math.sqrt(best), nx = -(pb[1] - pa[1]) / (len || 1), ny = (pb[0] - pa[0]) / (len || 1), mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
    const curve = (bq, f) => { const cx = mx + nx * len * bq, cy = my + ny * len * bq; return [(1 - f) ** 2 * pa[0] + 2 * f * (1 - f) * cx + f * f * pb[0], (1 - f) ** 2 * pa[1] + 2 * f * (1 - f) * cy + f * f * pb[1]]; };
    let bulge = 0, low = 1e9;
    for (const bq of len < 4 ? [0] : [.22, -.22, .1, -.1, 0]) {
      let n = 0;
      for (const f of [.2, .35, .5, .65, .8]) if (landAt(geo, ...curve(bq, f)) >= 0) n++;
      if (n < low) { low = n; bulge = bq; }
    }
    const steps = Math.max(2, Math.round(len / .8));
    return { a: l.a, b: l.b, wrap: false, pts: Array.from({ length: steps + 1 }, (_, i) => curve(bulge, i / steps)) };
  });
}

function layoutLabels(geo) {
  geo.label = geo.names.map((name, t) => {
    const cells = geo.cells[t], size = clamp(.98 + cells * .011, 1, 1.4), maxW = clamp(Math.sqrt(cells) * CW * .9, 6.5, 15), lines = [];
    let cur = '';
    for (const w of name.split(' ')) { const next = cur ? cur + ' ' + w : w; if (cur && measure(next, size) > maxW) { lines.push(cur); cur = w; } else cur = next; }
    lines.push(cur);
    const lh = size * 1.06, [hx, hy] = geo.heart[t], y = hy + 3, w = Math.max(...lines.map((l) => measure(l, size)));
    return { lines, size, lh, x: hx, y, rect: [hx - w / 2 - .4, y - size * .7, w + .8, lh * (lines.length - 1) + size * 1.4] };
  });
}

// ---------------------------------------------------------------- the ground, drawn in the old way
const GLYPH = {
  m(c, x, y, s) {
    c.beginPath(); c.moveTo(x - .8 * s, y + .4 * s); c.lineTo(x - .05 * s, y - .6 * s); c.lineTo(x + .85 * s, y + .4 * s);
    for (let i = 1; i <= 3; i++) { const k = i / 4.2, ax = x - .05 * s + .9 * s * k, ay = y - .6 * s + s * k; c.moveTo(ax, ay); c.lineTo(ax - .34 * s * (1 - k), ay + .46 * s * (1 - k)); }
    c.stroke();
  },
  h(c, x, y, s) { c.beginPath(); c.moveTo(x - .75 * s, y + .3 * s); c.quadraticCurveTo(x - .1 * s, y - .75 * s, x + .75 * s, y + .3 * s); c.moveTo(x + .2 * s, y - .06 * s); c.lineTo(x + .06 * s, y + .24 * s); c.moveTo(x + .44 * s, y + .06 * s); c.lineTo(x + .32 * s, y + .28 * s); c.stroke(); },
  c(c, x, y, s) { c.beginPath(); c.moveTo(x - .6 * s, y + .3 * s); c.lineTo(x - .3 * s, y - .3 * s); c.lineTo(x - .05 * s, y + .05 * s); c.lineTo(x + .25 * s, y - .45 * s); c.lineTo(x + .6 * s, y + .3 * s); c.moveTo(x + .25 * s, y - .45 * s); c.lineTo(x + .18 * s, y + .12 * s); c.stroke(); },
  F(c, x, y, s) { c.beginPath(); c.arc(x, y - .28 * s, .34 * s, 0, 6.3); c.moveTo(x, y + .06 * s); c.lineTo(x, y + .44 * s); c.moveTo(x + .16 * s, y - .28 * s); c.arc(x, y - .28 * s, .16 * s, 0, 1.7); c.stroke(); },
  d(c, x, y, s) { c.beginPath(); c.moveTo(x, y + .45 * s); c.lineTo(x, y - .35 * s); c.moveTo(x, y - .05 * s); c.lineTo(x - .3 * s, y - .4 * s); c.moveTo(x, y + .1 * s); c.lineTo(x + .32 * s, y - .25 * s); c.moveTo(x, y - .2 * s); c.lineTo(x + .18 * s, y - .52 * s); c.stroke(); },
  w(c, x, y, s) { c.beginPath(); c.moveTo(x - .5 * s, y + .25 * s); c.lineTo(x + .5 * s, y + .25 * s); c.moveTo(x - .28 * s, y + .45 * s); c.lineTo(x + .28 * s, y + .45 * s); for (const k of [-.26, 0, .26]) { c.moveTo(x + k * s, y + .25 * s); c.lineTo(x + k * 1.5 * s, y - .28 * s); } c.stroke(); },
  f(c, x, y, s) { c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(x - .6 * s + i * .3 * s, y + .32 * s); c.lineTo(x - .3 * s + i * .3 * s, y - .32 * s); } c.stroke(); },
  p(c, x, y, s) { c.beginPath(); c.moveTo(x - .32 * s, y - .05 * s); c.lineTo(x - .2 * s, y + .18 * s); c.lineTo(x - .08 * s, y - .05 * s); c.moveTo(x + .16 * s, y + .12 * s); c.lineTo(x + .28 * s, y + .34 * s); c.lineTo(x + .4 * s, y + .12 * s); c.stroke(); },
  s(c, x, y, s) { c.beginPath(); for (const [dx, dy] of [[-.3, .1], [.05, -.22], [.34, .2]]) { c.moveTo(x + dx * s + .07 * s, y + dy * s); c.arc(x + dx * s, y + dy * s, .07 * s, 0, 6.3); } c.fill(); },
};
const GLYPH_SIZE = { m: 1.55, h: 1.3, c: 1.2, F: 1, d: 1, w: 1, f: 1, p: .9, s: 1 }, GLYPH_PER_CELL = { m: .5, h: .45, c: .5, F: .85, d: .55, w: .55, f: .5, p: .35, s: .45 };

/** The fonts the sheet is lettered in. Wait for this before painting, or the names are set in a fallback face. */
export function sheetFonts() {
  const faces = ['900 40px Cinzel', '700 40px Cinzel', 'italic 400 40px "Crimson Pro"'];
  return Promise.race([Promise.all(faces.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
}

/**
 * Paint a sheet's two fixed layers: the vellum with its sea, and the ink. `side` is the longer side in pixels.
 * `out` is the canvas the finished sheet is composed on (see composeSheet).
 */
export function paintSheet(geo, side) {
  const S = side / Math.max(geo.SW, geo.SH), W = Math.round(geo.SW * S), H = Math.round(geo.SH * S);
  const { SW, SH, OX, OY, MH, def } = geo;
  const base = mk(W, H), ink = mk(W, H), out = mk(W, H);
  const seaRect = [5.2, 5.2, SW - 10.4, OY + MH + 1.6 - 5.2];
  const unit = (c) => c.setTransform(S, 0, 0, S, 0, 0), px = (c) => c.setTransform(1, 0, 0, 1, 0, 0);
  if (!geo.label) layoutLabels(geo);

  // --- the vellum
  const c = base.getContext('2d');
  unit(c);
  const sheet = new Path2D();
  { const pts = []; const side = (x0, y0, x1, y1) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.3); for (let i = 0; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; pts.push([x + (vn(x * .7, y * .7 + 3) - .5) * .5, y + (vn(x * .7 + 9, y * .7) - .5) * .5]); } };
    side(.5, .5, SW - .5, .5); side(SW - .5, .5, SW - .5, SH - .5); side(SW - .5, SH - .5, .5, SH - .5); side(.5, SH - .5, .5, .5);
    pts.forEach(([x, y], i) => (i ? sheet.lineTo(x, y) : sheet.moveTo(x, y))); sheet.closePath(); }
  c.clip(sheet);
  c.fillStyle = '#dfcba1'; c.fillRect(0, 0, SW, SH);
  let mottle;
  { const mw = 512, mh = Math.round((512 * H) / W), m = mk(mw, mh), mc = m.getContext('2d'), im = mc.createImageData(mw, mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const v = 1 - fbm(x * .018 + geo.mi * 31, y * .018) * .9 - fbm(x * .09, y * .09 + 50) * .22, k = clamp(v + .35, 0, 1), i = (y * mw + x) * 4;
      im.data[i] = 255 - (1 - k) * 70; im.data[i + 1] = 255 - (1 - k) * 86; im.data[i + 2] = 255 - (1 - k) * 112; im.data[i + 3] = 255;
    }
    mc.putImageData(im, 0, 0);
    c.globalCompositeOperation = 'multiply'; c.imageSmoothingQuality = 'high'; c.drawImage(m, 0, 0, SW, SH); mottle = m; }
  { const gr = mk(256, 256), gc = gr.getContext('2d'), im = gc.createImageData(256, 256), r = rng(5);
    for (let i = 0; i < 256 * 256 * 4; i += 4) { const d = r() < .5; im.data[i] = d ? 70 : 255; im.data[i + 1] = d ? 45 : 245; im.data[i + 2] = d ? 20 : 220; im.data[i + 3] = r() * 26; }
    gc.putImageData(im, 0, 0);
    c.globalCompositeOperation = 'source-over'; px(c); c.fillStyle = c.createPattern(gr, 'repeat'); c.fillRect(0, 0, W, H); unit(c); }
  { const r = rng(40 + geo.mi);
    for (let i = 0; i < 7; i++) { const x = r() * SW, y = r() * SH, rad = 7 + r() * 20, gd = c.createRadialGradient(x, y, rad * .2, x, y, rad); gd.addColorStop(0, 'rgba(120,78,36,.09)'); gd.addColorStop(.8, 'rgba(120,78,36,.05)'); gd.addColorStop(1, 'rgba(120,78,36,0)'); c.fillStyle = gd; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    for (const [x0, y0, x1, y1] of [[0, 0, 9, 0], [SW, 0, SW - 9, 0], [0, 0, 0, 9], [0, SH, 0, SH - 9]]) { const gd = c.createLinearGradient(x0, y0, x1, y1); gd.addColorStop(0, 'rgba(78,46,18,.4)'); gd.addColorStop(.35, 'rgba(78,46,18,.12)'); gd.addColorStop(1, 'rgba(78,46,18,0)'); c.fillStyle = gd; c.fillRect(0, 0, SW, SH); }
    // Folds: the sheet was carried folded before it was hung.
    const fold = (x0, y0, x1, y1) => { c.lineWidth = 1.6; c.strokeStyle = 'rgba(70,42,18,.05)'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.lineWidth = .16; c.strokeStyle = 'rgba(255,246,222,.3)'; c.stroke(); c.strokeStyle = 'rgba(70,42,18,.16)'; c.beginPath(); c.moveTo(x0 + .2, y0 + .2); c.lineTo(x1 + .2, y1 + .2); c.stroke(); };
    if (geo.portrait) { fold(0, SH / 3, SW, SH / 3 + .6); fold(0, (SH * 2) / 3, SW, (SH * 2) / 3 - .4); fold(SW / 2, 0, SW / 2 + .5, SH); }
    else { fold(SW / 3, 0, SW / 3 + .6, SH); fold((SW * 2) / 3, 0, (SW * 2) / 3 - .4, SH); fold(0, SH / 2, SW, SH / 2 + .5); } }

  // --- the sea: a thin wash, paler in the shallows, then the water-lining along every coast
  const s = out.getContext('2d');
  const land = () => { s.globalCompositeOperation = 'destination-out'; s.fillStyle = s.strokeStyle = '#000'; s.setLineDash([]); s.lineWidth = .1; for (const p of geo.path) { s.fill(p, 'evenodd'); s.stroke(p); } s.globalCompositeOperation = 'source-over'; };
  unit(s); s.lineJoin = s.lineCap = 'round';
  s.fillStyle = 'rgb(150,176,170)'; s.fillRect(...seaRect);
  if ('filter' in s) { s.globalCompositeOperation = 'destination-out'; s.filter = `blur(${(1.4 * S).toFixed(1)}px)`; s.strokeStyle = 'rgba(0,0,0,.4)'; s.lineWidth = 3.6; s.stroke(geo.coast); s.filter = 'none'; }
  land();
  px(c); c.globalCompositeOperation = 'multiply'; c.globalAlpha = .74; c.drawImage(out, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  px(s); s.clearRect(0, 0, W, H); unit(s);
  s.save(); s.beginPath(); s.rect(...seaRect); s.clip();
  const rose = ROSE[def.id] ? [OX + ROSE[def.id][0] * CW, OY + ROSE[def.id][1] * CH, ROSE[def.id][2]] : null;
  { const d = [.5, 1.15, 1.95, 2.95], al = [.5, .34, .22, .13];
    for (let k = 3; k >= 0; k--) {
      s.globalCompositeOperation = 'source-over'; s.strokeStyle = `rgba(58,40,24,${al[k]})`; s.lineWidth = 2 * d[k] + .1; s.setLineDash(k >= 2 ? [1.7, .45, .5, .45] : []); s.stroke(geo.coast);
      s.globalCompositeOperation = 'destination-out'; s.setLineDash([]); s.strokeStyle = '#000'; s.lineWidth = 2 * d[k]; s.stroke(geo.coast);
    }
    s.globalCompositeOperation = 'source-over';
    if (rose) {
      s.strokeStyle = 'rgba(58,40,24,.15)'; s.lineWidth = .07; s.beginPath();
      for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; s.moveTo(rose[0] + Math.cos(a) * rose[2] * 1.1, rose[1] + Math.sin(a) * rose[2] * 1.1); s.lineTo(rose[0] + Math.cos(a) * 600, rose[1] + Math.sin(a) * 600); }
      s.stroke();
    } }
  s.restore();
  land();
  px(c); c.drawImage(out, 0, 0);
  px(s); s.clearRect(0, 0, W, H);

  // --- the ink
  const k = ink.getContext('2d');
  unit(k); k.lineJoin = k.lineCap = 'round';
  const txt = (str, x, y, size, o = {}) => {
    k.save(); px(k);
    k.font = fontOf(size * S, o); k.letterSpacing = `${(o.track || 0) * size * S}px`; k.textAlign = o.align || 'center'; k.textBaseline = 'middle';
    const X = (x + (o.track && !o.align ? (o.track * size) / 2 : 0)) * S;
    if (o.halo) { k.strokeStyle = o.halo; k.lineWidth = (o.haloW || .3) * S; k.lineJoin = 'round'; k.strokeText(str, X, y * S); }
    k.fillStyle = o.fill || INK; k.fillText(str, X, y * S);
    k.restore();
  };
  // Region names, written large and faint under everything else.
  for (const r of geo.regions) {
    // A region of scattered islands has no middle to write across: the register and the plate name it instead.
    const on = landAt(geo, r.at[0], r.at[1]);
    if (on >= 0 ? geo.region[on] !== r.id : !geo.heart.some((h, t) => geo.region[t] === r.id && Math.hypot(h[0] - r.at[0], h[1] - r.at[1]) < 14)) continue;
    const o = { weight: 900, track: .24 }, words = r.name.replace(/^The /, '').split(' '), join = (a, b) => words.slice(a, b).join(' ');
    const fit = (ls) => Math.min((r.w * .84) / Math.max(...ls.map((l) => measure(l, 1, o))), (r.h * .6) / (ls.length * 1.25));
    let lines = [join(0)];
    for (let i = 1; i < words.length; i++) {
      if (fit([join(0, i), join(i)]) > fit(lines) * 1.15) lines = [join(0, i), join(i)];
      for (let j = i + 1; j < words.length; j++) if (fit([join(0, i), join(i, j), join(j)]) > fit(lines) * 1.15) lines = [join(0, i), join(i, j), join(j)];
    }
    const size = clamp(fit(lines), 1.5, 4.8);
    lines.forEach((l, i) => txt(l.toUpperCase(), r.at[0], r.at[1] + (i - (lines.length - 1) / 2) * size * 1.25, size, { ...o, fill: 'rgba(74,16,10,.36)' }));
  }
  // Ground: mountains, woods, fens.
  hit ??= mk(4, 4).getContext('2d');
  k.strokeStyle = k.fillStyle = 'rgba(52,32,18,.5)';
  for (let t = 0; t < geo.nt; t++) {
    const gch = geo.ground[t], draw = GLYPH[gch] || GLYPH.p, r = rng(900 + t * 31 + geo.mi * 7), [bx, by, bw, bh] = geo.bbox[t], [hx, hy] = geo.heart[t], lr = geo.label[t].rect;
    const want = clamp(Math.round(geo.cells[t] * (GLYPH_PER_CELL[gch] || .4)), 2, 22), put = [];
    for (let tries = want * 14; tries-- && put.length < want;) {
      const x = bx + r() * bw, y = by + r() * bh, sz = (GLYPH_SIZE[gch] || 1) * (.82 + r() * .32), m = sz * .75;
      if (Math.hypot(x - hx, (y - hy) * 1.3) < 4.3) continue;
      if (x > lr[0] - m && x < lr[0] + lr[2] + m && y > lr[1] - m && y < lr[1] + lr[3] + m) continue;
      if (put.some((q) => Math.hypot(q[0] - x, q[1] - y) < (sz + q[2]) * .8)) continue;
      if (![[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dy]) => hit.isPointInPath(geo.path[t], x + dx, y + dy, 'evenodd'))) continue;
      put.push([x, y, sz]);
    }
    put.sort((a, b) => a[1] - b[1]);
    for (const [x, y, sz] of put) { k.lineWidth = .085 * Math.sqrt(sz); draw(k, x, y, sz); }
  }
  // Borders: thin between territories, heavy with a gold thread where two regions meet, and the coast.
  k.strokeStyle = 'rgba(43,25,14,.9)'; k.lineWidth = .17; k.stroke(geo.inner);
  k.strokeStyle = INK; k.lineWidth = .52; k.stroke(geo.march);
  k.strokeStyle = GOLD; k.lineWidth = .13; k.stroke(geo.march);
  k.strokeStyle = INK; k.lineWidth = .24; k.stroke(geo.coast);

  // Sea lanes.
  k.fillStyle = k.strokeStyle = BLOOD;
  const dashed = (pts) => { k.lineWidth = .22; k.setLineDash([.9, .6]); k.beginPath(); pts.forEach(([x, y], i) => (i ? k.lineTo(x, y) : k.moveTo(x, y))); k.stroke(); k.setLineDash([]); };
  const port = (p) => { k.beginPath(); k.arc(p[0], p[1], .34, 0, 6.3); k.fill(); };
  for (const w of geo.ways) {
    if (!w.wrap) { dashed(w.pts); port(w.pts[0]); port(w.pts[w.pts.length - 1]); continue; }
    for (const [run, other] of [[w.pts, w.b], [w.back.slice().reverse(), w.a]]) {
      const p = run[0], e = run[run.length - 1], d = e[0] < p[0] ? 1 : -1;
      dashed([p, [e[0] + d * .9, e[1]]]); port(p);
      k.beginPath(); k.moveTo(e[0], e[1]); k.lineTo(e[0] + d * 1.1, e[1] - .55); k.lineTo(e[0] + d * 1.1, e[1] + .55); k.closePath(); k.fill();
      txt('to ' + geo.names[other], (p[0] + e[0]) / 2 + d * .4, p[1] - 1.05, 1.2, { family: '"Crimson Pro"', style: 'italic', weight: 400, fill: BLOOD });
    }
  }
  // Territory names.
  geo.label.forEach((lb) => lb.lines.forEach((l, i) => txt(l, lb.x, lb.y + i * lb.lh, lb.size, { halo: 'rgba(240,226,196,.42)', haloW: .34 })));

  // Compass rose, with the Society's pyramid for north.
  if (rose) {
    const [x, y, R] = rose;
    k.strokeStyle = INK; k.lineWidth = .1; k.beginPath(); k.arc(x, y, R, 0, 6.3); k.stroke(); k.beginPath(); k.arc(x, y, R * .86, 0, 6.3); k.stroke();
    k.beginPath(); for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, r0 = i % 4 ? R * .93 : R * .86; k.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); k.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); } k.stroke();
    const point = (a, len, wd) => {
      const tip = [x + Math.cos(a) * len, y + Math.sin(a) * len], l = [x + Math.cos(a - wd) * R * .2, y + Math.sin(a - wd) * R * .2], r = [x + Math.cos(a + wd) * R * .2, y + Math.sin(a + wd) * R * .2];
      k.fillStyle = '#e9d9b4'; k.beginPath(); k.moveTo(...tip); k.lineTo(...r); k.lineTo(x, y); k.closePath(); k.fill(); k.stroke();
      k.fillStyle = INK; k.beginPath(); k.moveTo(...tip); k.lineTo(...l); k.lineTo(x, y); k.closePath(); k.fill(); k.stroke();
    };
    k.lineWidth = .07;
    for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, R * .6, Math.PI / 4);
    for (let i = 0; i < 4; i++) point((i * Math.PI) / 2, R * (i === 3 ? 1.02 : .92), Math.PI / 4);
    k.fillStyle = GOLD; k.strokeStyle = INK; k.lineWidth = .08;
    k.beginPath(); k.arc(x, y, R * .09, 0, 6.3); k.fill(); k.stroke();
    k.beginPath(); k.moveTo(x, y - R * 1.36); k.lineTo(x + R * .17, y - R * 1.08); k.lineTo(x - R * .17, y - R * 1.08); k.closePath(); k.fill(); k.stroke();
  }

  // The frame: a key-pattern band between two rules.
  { const h = 1.5, a = 3.3;
    const meander = (x, y, len, rot) => { k.save(); k.translate(x, y); k.rotate(rot); const n = Math.max(1, Math.round(len / (h * 1.3))), w = len / n; k.beginPath(); k.moveTo(0, h); k.lineTo(len, h); for (let i = 0; i < n; i++) { const u = i * w; k.moveTo(u + .12 * w, h); k.lineTo(u + .12 * w, .06 * h); k.lineTo(u + .88 * w, .06 * h); k.lineTo(u + .88 * w, .72 * h); k.lineTo(u + .4 * w, .72 * h); k.lineTo(u + .4 * w, .38 * h); k.lineTo(u + .64 * w, .38 * h); } k.stroke(); k.restore(); };
    k.strokeStyle = INK; k.lineWidth = .3; k.strokeRect(3, 3, SW - 6, SH - 6);
    k.lineWidth = .13;
    meander(a + h, a, SW - 2 * (a + h), 0); meander(SW - a, a + h, SH - 2 * (a + h), Math.PI / 2); meander(SW - a - h, SH - a, SW - 2 * (a + h), Math.PI); meander(a, SH - a - h, SH - 2 * (a + h), -Math.PI / 2);
    for (const [x, y] of [[a, a], [SW - a - h, a], [a, SH - a - h], [SW - a - h, SH - a - h]]) { k.strokeRect(x + .1, y + .1, h - .2, h - .2); k.fillStyle = GOLD; k.beginPath(); k.moveTo(x + h / 2, y + .32); k.lineTo(x + h - .32, y + h - .36); k.lineTo(x + .32, y + h - .36); k.closePath(); k.fill(); k.stroke(); }
    k.lineWidth = .2; k.strokeRect(5.2, 5.2, SW - 10.4, SH - 10.4);
    k.strokeStyle = GOLD; k.lineWidth = .12; k.strokeRect(5.6, 5.6, SW - 11.2, SH - 11.2); }

  // The register: title, what each region is worth, and how to read the pieces.
  { const y0 = OY + MH + 1.6, x0 = 7.4, x1 = SW - 7.4, w = x1 - x0, regs = def.regions, prose = { family: '"Crimson Pro"', style: 'italic', weight: 400 };
    k.strokeStyle = INK; k.lineWidth = .24; k.beginPath(); k.moveTo(5.2, y0); k.lineTo(SW - 5.2, y0); k.stroke();
    k.lineWidth = .08; k.beginPath(); k.moveTo(5.6, y0 + .5); k.lineTo(SW - 5.6, y0 + .5); k.stroke();
    const sub = `${geo.nt} territories in ${regs.length} regions. The last House standing wins.`, lead = 'Hold a whole region and it sends you more armies each turn';
    const entry = (r, ax, ay, cw) => {
      txt(r[0], ax, ay, 1.16, { align: 'left' }); txt(String(r[1]), ax + cw, ay, 1.4, { align: 'right', weight: 900, fill: BLOOD });
      const from = ax + measure(r[0], 1.16) + .6, to = ax + cw - measure(String(r[1]), 1.4, { weight: 900 }) - .6;
      k.fillStyle = 'rgba(43,25,14,.55)'; for (let x = from; x < to; x += .62) { k.beginPath(); k.arc(x, ay + .35, .07, 0, 6.3); k.fill(); }
    };
    const key = (i, ax, ay) => {
      k.strokeStyle = INK; k.fillStyle = 'rgba(43,25,14,.78)'; k.lineWidth = .1;
      if (i === 0) { k.fillRect(ax + .65, ay - .42, .84, .84); }
      if (i === 1) { k.fillRect(ax, ay - .4, 2.1, .8); }
      if (i === 2) { k.beginPath(); k.moveTo(ax + 1.05, ay - .72); k.lineTo(ax + 1.85, ay + .5); k.lineTo(ax + .25, ay + .5); k.closePath(); k.fill(); }
      if (i === 3) { k.strokeStyle = k.fillStyle = BLOOD; k.lineWidth = .22; k.setLineDash([.9, .6]); k.beginPath(); k.moveTo(ax, ay); k.lineTo(ax + 2.1, ay); k.stroke(); k.setLineDash([]); }
      txt(['one army', 'five armies', 'ten armies', 'a sea lane'][i], ax + 2.9, ay, 1.3, { ...prose, align: 'left' });
    };
    if (!geo.portrait) {
      txt(def.name.toUpperCase(), SW / 2, y0 + 5.3, 4.5, { weight: 900, track: .14, fill: BLOOD });
      txt(sub, SW / 2, y0 + 9.2, 1.5, prose);
      const lw = Math.min(w * .33, 62), nc = Math.ceil(regs.length / 4), cw = (lw - (nc - 1) * 2) / nc;
      txt(lead, x0 + .4, y0 + 2.7, 1.3, { ...prose, align: 'left' });
      regs.forEach((r, i) => entry(r, x0 + .4 + Math.floor(i / 4) * (cw + 2), y0 + 5 + (i % 4) * 1.8, cw));
      for (let i = 0; i < 4; i++) key(i, x1 - 13, y0 + 3.6 + i * 2);
    } else {
      txt(def.name.toUpperCase(), SW / 2, y0 + 4.5, 4, { weight: 900, track: .14, fill: BLOOD });
      txt(sub, SW / 2, y0 + 7.7, 1.45, prose);
      txt(lead, SW / 2, y0 + 10.3, 1.25, prose);
      const cw = (w - 5) / 3;
      regs.forEach((r, i) => entry(r, x0 + .4 + Math.floor(i / 4) * (cw + 2.1), y0 + 12.3 + (i % 4) * 1.7, cw));
      for (let i = 0; i < 4; i++) key(i, x0 + 2 + i * (w / 4), y0 + 20);
    } }
  return { S, W, H, base, ink, out, mottle };
}

const WASH = new Map();
/** How a colour is laid on vellum: a thin wash the skin shows through, deepest along the territory's own borders. */
function washOf(color) {
  let w = WASH.get(color);
  if (!w) {
    const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)), light = (c[0] * .3 + c[1] * .59 + c[2] * .11) / 255;
    // A near-white House (Jupiter) cannot be a wash: vellum is darker than it is. It is painted on in chalk instead.
    w = light > .8
      ? { chalk: `rgba(${c.map((v) => Math.round(v + (255 - v) * .45))},.66)`, edge: 'rgba(96,104,122,.11)' }
      : { fill: `rgb(${c.map((v) => Math.round(v + (255 - v) * .5))})`, body: `rgba(${c},.15)`, edge: `rgba(${c.map((v) => Math.round(v * .82))},.13)` };
    WASH.set(color, w);
  }
  return w;
}
/**
 * Compose the finished sheet on `art.out`: vellum, then each territory's wash, then the ink.
 * `tint[t]` is the holder's colour ('#rrggbb'), or null for bare vellum. With `dirty` (territory ids), only the part
 * of the sheet around those territories is done again.
 */
export function composeSheet(art, geo, tint, dirty = undefined as number[] | undefined) {
  const o = art.out.getContext('2d'), S = art.S;
  let box = null;
  if (dirty?.length) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const t of dirty) { const b = geo.bbox[t]; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]); }
    box = [Math.floor((x0 - 1) * S), Math.floor((y0 - 1) * S), Math.ceil((x1 - x0 + 2) * S), Math.ceil((y1 - y0 + 2) * S)];
  }
  o.save();
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
  if (box) { o.beginPath(); o.rect(...box); o.clip(); }
  o.clearRect(0, 0, art.W, art.H); o.drawImage(art.base, 0, 0);
  o.setTransform(S, 0, 0, S, 0, 0); o.lineJoin = 'round';
  for (let t = 0; t < geo.nt; t++) {
    const [bx, by, bw, bh] = geo.bbox[t];
    if (!tint[t]) continue;
    if (box && ((bx + bw + 1) * S < box[0] || (by + bh + 1) * S < box[1] || (bx - 1) * S > box[0] + box[2] || (by - 1) * S > box[1] + box[3])) continue;
    const h = washOf(tint[t]);
    o.save(); o.clip(geo.path[t], 'evenodd');
    if (h.chalk) { o.globalCompositeOperation = 'source-over'; o.fillStyle = h.chalk; o.fillRect(bx - 1, by - 1, bw + 2, bh + 2); }
    else {
      o.globalCompositeOperation = 'multiply'; o.fillStyle = h.fill; o.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      o.globalCompositeOperation = 'source-over'; o.fillStyle = h.body; o.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    }
    o.globalCompositeOperation = 'multiply'; o.strokeStyle = h.edge;
    for (let w = 5.4; w > .5; w -= .7) { o.lineWidth = w; o.stroke(geo.path[t]); }
    o.globalAlpha = .55; o.drawImage(art.mottle, 0, 0, geo.SW, geo.SH); o.globalAlpha = 1;
    o.restore();
  }
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.drawImage(art.ink, 0, 0);
  o.restore();
}

/** A small picture of a board for the setup screen: its lands in their regions' colours, inked, on vellum. */
export function sheetThumb(id, width) {
  const geo = sheetFor(id), pad = 3, w = geo.MW + pad * 2, h = geo.MH + pad * 2, S = width / w, cv = mk(width, Math.round(h * S)), c = cv.getContext('2d');
  const hues = ['#c8894f', '#c9b25e', '#7f8fb8', '#b7743f', '#8fae76', '#9a7aa8', '#6fa3a4', '#bf6f62', '#a8a064', '#6d9a78', '#c98f5c'];
  c.fillStyle = '#cdbb93'; c.fillRect(0, 0, cv.width, cv.height);
  c.setTransform(S, 0, 0, S, (pad - geo.OX) * S, (pad - geo.OY) * S);
  c.lineJoin = 'round';
  for (let t = 0; t < geo.nt; t++) { c.fillStyle = hues[geo.region[t] % hues.length]; c.fill(geo.path[t], 'evenodd'); }
  c.strokeStyle = 'rgba(43,25,14,.55)'; c.lineWidth = .9 / S; c.stroke(geo.inner);
  c.strokeStyle = INK; c.lineWidth = 1.5 / S; c.stroke(geo.march); c.lineWidth = 1.3 / S; c.stroke(geo.coast);
  return cv;
}
