// Static world data: Houses, quadrants, territory names, and the procedurally-built hex valley.
// Pure TS with no deps so it runs in the browser and in the Deno edge function.
//
// The valley is a ring of seven House slices around the chasm beneath Olympus. Each slice is a
// polar grid of three rows (inner "Foot of Olympus", middle, outer) with the Keep in the middle
// of the middle row, so it is always buffered by at least two of its own territories before any
// foreign border. The map grows with the player count (see LAYOUTS).

export type HouseId = 'apollo' | 'diana' | 'minerva' | 'mars' | 'pluto' | 'jupiter' | 'ceres';
export type Biome =
  | 'keep' | 'forest' | 'lake' | 'swamp' | 'crag' | 'mountain'
  | 'plain' | 'fields' | 'highland' | 'snow' | 'deadwood';

export interface House {
  id: HouseId;
  name: string;
  color: string;
  quadrant: number;
  sigil: string;
  epithet: string;
}

// House index == its 1/7th slice of the valley ring, counter-clockwise from the east.
export const HOUSES: House[] = [
  { id: 'apollo', name: 'Apollo', color: '#e8b21e', quadrant: 0, sigil: '☉', epithet: 'the Sun-Fuckers' },
  { id: 'diana', name: 'Diana', color: '#2fa36b', quadrant: 0, sigil: '☾', epithet: 'the Huntresses' },
  { id: 'minerva', name: 'Minerva', color: '#3f86e0', quadrant: 1, sigil: '⌘', epithet: 'the Owls' },
  { id: 'mars', name: 'Mars', color: '#d42a2a', quadrant: 1, sigil: '♂', epithet: 'the Wolves' },
  { id: 'pluto', name: 'Pluto', color: '#8a5cc7', quadrant: 2, sigil: '♇', epithet: 'the Jackals' },
  { id: 'jupiter', name: 'Jupiter', color: '#e8e4d8', quadrant: 3, sigil: '♃', epithet: 'the Storm-Born' },
  { id: 'ceres', name: 'Ceres', color: '#e0782a', quadrant: 3, sigil: '⚳', epithet: 'the Bread-Bakers' },
];
export const HOUSE_INDEX: Record<HouseId, number> = Object.fromEntries(HOUSES.map((h, i) => [h.id, i])) as any;

export interface Quadrant { name: string; houses: number[] }
export const QUADRANTS: Quadrant[] = [
  { name: 'The Greatwoods', houses: [0, 1] },
  { name: 'The Highlands', houses: [2, 3] },
  { name: 'The Frostfangs', houses: [4] },
  { name: 'The Argos Lowlands', houses: [5, 6] },
];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;

/** Territories per row of each House slice, inner → outer, by player count. The middle row is odd and ≥ 5 so the Keep sits two cells from either side. */
export const LAYOUTS: Record<number, number[]> = {
  2: [3, 5, 3],
  3: [3, 5, 4],
  4: [3, 5, 5],
  5: [4, 5, 5],
  6: [4, 5, 6],
  7: [4, 5, 7],
};

// Slot 0 of each House is its Keep. Later slots are handed out nearest-the-Keep first.
const NAMES: [string, Biome][][] = [
  // Apollo
  [['The Sun Citadel', 'keep'], ['Gilded Steppe', 'plain'], ['Lyre Falls', 'lake'], ['Pythian Crags', 'crag'], ['Laurel Groves', 'forest'], ['Brightspire', 'mountain'],
    ['Delphi Rise', 'highland'], ['Helios Fields', 'fields'], ["Oracle's Tarn", 'lake'], ['Goldleaf Wood', 'forest'], ['Solar Scarp', 'crag'], ['Chariot Road', 'plain'],
    ['Amber Hollow', 'forest'], ['Dawnwatch', 'highland'], ["Python's Coil", 'swamp'], ['Sunfall Ridge', 'mountain']],
  // Diana
  [['Moonhall', 'keep'], ['The Greatwood', 'forest'], ["Hunter's Tarn", 'lake'], ['Hartsblood Run', 'plain'], ['Silverbirch Hollow', 'forest'], ['Antler Ridge', 'crag'],
    ['Quiverwood', 'forest'], ["Stag's Leap", 'highland'], ['Nightbloom Mire', 'swamp'], ['Wolfsbane Glen', 'forest'], ['Artemis Pool', 'lake'], ['Bowstring Crag', 'crag'],
    ['Doe Meadow', 'plain'], ['Moonshadow Vale', 'forest'], ['Thornbrake', 'forest'], ["Tracker's Height", 'mountain']],
  // Minerva
  [["Minerva's Aerie", 'keep'], ['Owlwood', 'forest'], ['Stillmirror Lake', 'lake'], ['Scriptorium Hills', 'highland'], ['Greyveil Marsh', 'swamp'], ['The Thinking Stones', 'crag'],
    ['Ink River', 'lake'], ['Parchment Downs', 'plain'], ['Olive Terraces', 'fields'], ['Sagewood', 'forest'], ['Aegis Bluff', 'crag'], ['The Loom', 'highland'],
    ["Wisdom's Fen", 'swamp'], ['Athenaeum Rise', 'mountain'], ['Quillmoor', 'plain'], ['Shieldwall Heights', 'mountain']],
  // Mars
  [['Castle Mars', 'keep'], ['The Furor', 'lake'], ['Metas Fens', 'swamp'], ['Wolfpine Wood', 'forest'], ['Deimos Crags', 'mountain'], ['Phobos Watch', 'highland'],
    ["Howler's Den", 'forest'], ["Reaper's Field", 'plain'], ['Slingblade Gap', 'crag'], ['Ares Hollow', 'forest'], ['Bloodwater', 'lake'], ['Ironjaw Ridge', 'mountain'],
    ['The Warrens', 'highland'], ['Red Moor', 'plain'], ["Titus's Pit", 'swamp'], ['Spearpoint', 'crag']],
  // Pluto
  [['The Hollow Keep', 'keep'], ['Bonewood', 'deadwood'], ['Black Ice Mere', 'lake'], ['Frostfang Pass', 'snow'], ['Wraith Marsh', 'swamp'], ['Grave Tors', 'mountain'],
    ['Styx Floe', 'lake'], ["Charon's Crossing", 'snow'], ["Deadman's Drift", 'snow'], ['Ashen Wood', 'deadwood'], ['Hades Scarp', 'crag'], ['Rimewatch', 'snow'],
    ['Cerberus Den', 'mountain'], ['Pale Barrow', 'deadwood'], ['Shade Fen', 'swamp'], ['Winterteeth', 'mountain']],
  // Jupiter
  [['Thunderhold', 'keep'], ["Eagle's Rest", 'mountain'], ['Rainpools', 'lake'], ['Stormbreak Moor', 'highland'], ['Oakfather Wood', 'forest'], ['Lightning Flats', 'plain'],
    ['Cloudspire', 'mountain'], ['Thunderhead Downs', 'plain'], ['Ganymede Grove', 'forest'], ['Io Marsh', 'swamp'], ['Tempest Rise', 'highland'], ['Bolt Crag', 'crag'],
    ['Skyreach Fields', 'fields'], ["Titan's Seat", 'crag'], ['Callisto Tarn', 'lake'], ['Stormwood', 'forest']],
  // Ceres
  [['The Ovens', 'keep'], ['Breadfields', 'fields'], ['Millrace', 'lake'], ['Orchard Rows', 'forest'], ["Sowers' Mire", 'swamp'], ['Harvest Terraces', 'fields'],
    ['Wheatsea', 'fields'], ['Granary Hill', 'highland'], ['Beehive Glen', 'forest'], ["Plowman's Rest", 'plain'], ['Threshing Floor', 'plain'], ['Cornucopia', 'fields'],
    ['Rye Hollow', 'fields'], ['Scarecrow Crag', 'crag'], ['Honeywater', 'lake'], ["Demeter's Grove", 'forest']],
];

export interface Territory {
  id: number;
  name: string;
  biome: Biome;
  house: number;
  quadrant: number;
  isKeep: boolean;
  row: number;
  col: number;
  /** Inner row: borders the chasm beneath Olympus. Sieges on Olympus launch from here. */
  foot: boolean;
}

// ---------------------------------------------------------------------------
// Hex valley generation (deterministic).
// Pointy-top axial hexes of size 1. World coords: x east, y north.

export interface Hex { q: number; r: number; x: number; y: number; t: number; rad: number }

export interface Geo {
  /** Player count this map was built for. */
  n: number;
  perHouse: number;
  rows: number[];
  territories: Territory[];
  nt: number;
  hexes: Hex[];
  adj: number[][];
  dist: number[][];
  centroid: [number, number][];
  /** Reinforcement bonus for holding every territory of each quadrant. */
  quadBonus: number[];
  /** Inner-row territories, where assaults on Olympus launch from. */
  foot: number[];
  R_IN: number;
  R_OUT: number;
  keepOf(house: number): number;
}

const SQ3 = Math.sqrt(3);
const W = (Math.PI * 2) / 7;
const THETA0 = -W;
const HEX_AREA = (3 * SQ3) / 2;
const CELL_AREA = 14 * HEX_AREA; // target territory size, in world units²
const CHASM_HALF = 1.45;
const PASS_HALF = 1.3;
const HEX_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

// Where the chasms between quadrants can be crossed: land bridges on these rows,
// keyed by the House on the counter-clockwise side of the border.
const PASSES: Record<number, number[]> = { 1: [0, 2], 3: [2], 4: [0], 6: [0, 2] };

function hash(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Radial bands so every cell has about CELL_AREA, with R_IN picked to keep cells roughly square. */
function bands(rows: number[]) {
  const build = (rin: number) => {
    const edges = [rin];
    let cost = 0;
    for (const c of rows) {
      const r = edges[edges.length - 1];
      const T = -r + Math.sqrt(r * r + (2 * CELL_AREA * c) / W);
      const width = ((r + T / 2) * W) / c;
      cost += Math.log(width / T) ** 2;
      edges.push(r + T);
    }
    return { edges, cost };
  };
  let best = build(14);
  for (let rin = 14; rin <= 34; rin += 0.25) {
    const b = build(rin);
    if (b.cost < best.cost) best = b;
  }
  return best.edges;
}

function buildGeo(n: number): Geo {
  const rows = LAYOUTS[n];
  const K = rows.reduce((a, b) => a + b, 0);
  const keepRow = 1, keepCol = (rows[1] - 1) / 2;

  // (row, col) → slot, nearest-the-Keep first.
  const cellsOfHouse: { row: number; col: number; d: number }[] = [];
  rows.forEach((c, row) => {
    for (let col = 0; col < c; col++) {
      const f = (col + 0.5) / c;
      cellsOfHouse.push({ row, col, d: Math.hypot(row - keepRow, (f - 0.5) * 4) + row * 0.01 });
    }
  });
  cellsOfHouse.sort((a, b) => a.d - b.d);
  const slotOf = new Map(cellsOfHouse.map((c, s) => [`${c.row},${c.col}`, s]));
  if (slotOf.get(`${keepRow},${keepCol}`) !== 0) throw new Error('keep must be slot 0');

  const territories: Territory[] = [];
  for (let h = 0; h < 7; h++) {
    for (let s = 0; s < K; s++) {
      const { row, col } = cellsOfHouse[s];
      const [name, biome] = NAMES[h][s];
      territories.push({ id: h * K + s, name, biome, house: h, quadrant: HOUSES[h].quadrant, isKeep: s === 0, row, col, foot: row === 0 });
    }
  }
  const nt = territories.length;
  const edges = bands(rows);
  const R_IN = edges[0], R_OUT = edges[edges.length - 1];
  // Column boundaries (as fractions of the House's angular width). The Keep's column is kept
  // narrow so it can't brush the corner of an edge cell in the rows above and below.
  const colCuts = rows.map((c, row) => {
    if (row !== keepRow) return Array.from({ length: c + 1 }, (_, i) => i / c);
    const kw = 0.075, side = keepCol;
    const left = Array.from({ length: side + 1 }, (_, i) => (i / side) * (0.5 - kw));
    const right = Array.from({ length: side + 1 }, (_, i) => 0.5 + kw + (i / side) * (0.5 - kw));
    return [...left, ...right];
  });

  const cells = new Map<string, Hex & { house: number }>();
  const key = (q: number, r: number) => q + ',' + r;
  const span = Math.ceil(R_OUT / 1.4) + 3;
  for (let q = -span; q <= span; q++) {
    for (let r = -span; r <= span; r++) {
      const x = SQ3 * (q + r / 2), y = 1.5 * r;
      const rad = Math.hypot(x, y);
      const outer = (vnoise(x * 0.18 + 40, y * 0.18) - 0.5) * 2.4;
      const inner = (vnoise(x * 0.3, y * 0.3 + 90) - 0.5) * 1.6;
      if (rad > R_OUT + outer || rad < R_IN + inner) continue;
      // Wobble the grid lines so borders look organic.
      const nA = (vnoise(x * 0.2 + 7, y * 0.2 - 3) - 0.5) * 1.7;
      const nR = (vnoise(x * 0.24 - 11, y * 0.24 + 5) - 0.5) * 1.8;
      const ang = Math.atan2(y, x) + nA / rad;
      let rel = ang - THETA0;
      rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const house = Math.floor(rel / W) % 7;
      const frac = rel / W - Math.floor(rel / W);

      // Chasms between quadrants, except on the land bridges.
      const toCw = frac * W * rad, toCcw = (1 - frac) * W * rad;
      const nbr = toCw < toCcw ? (house + 6) % 7 : (house + 1) % 7;
      if (HOUSES[nbr].quadrant !== HOUSES[house].quadrant && Math.min(toCw, toCcw) < CHASM_HALF) {
        const lowSide = toCw < toCcw ? nbr : house; // PASSES is keyed by the ccw-most House
        const onBridge = (PASSES[lowSide] ?? []).some((row) => Math.abs(rad - (edges[row] + edges[row + 1]) / 2) < PASS_HALF);
        if (!onBridge) continue;
      }

      const rr = rad + nR;
      let row = 0;
      while (row < rows.length - 1 && rr > edges[row + 1]) row++;
      const cuts = colCuts[row];
      let col = 0;
      while (col < rows[row] - 1 && frac > cuts[col + 1]) col++;
      const t = house * K + slotOf.get(`${row},${col}`)!;
      cells.set(key(q, r), { q, r, x, y, t, rad, house });
    }
  }

  // Keep only the largest connected blob of each territory; hand orphans to neighbours.
  for (let pass = 0; pass < 3; pass++) {
    const byT: (Hex & { house: number })[][] = Array.from({ length: nt }, () => []);
    for (const c of cells.values()) byT[c.t].push(c);
    for (let t = 0; t < nt; t++) {
      const mine = byT[t];
      const seen = new Set<string>();
      const comps: (typeof mine)[] = [];
      for (const c of mine) {
        const k0 = key(c.q, c.r);
        if (seen.has(k0)) continue;
        const comp: typeof mine = [];
        const stack = [c];
        seen.add(k0);
        while (stack.length) {
          const cur = stack.pop()!;
          comp.push(cur);
          for (const [dq, dr] of HEX_DIRS) {
            const nk = key(cur.q + dq, cur.r + dr);
            const nb = cells.get(nk);
            if (nb && nb.t === t && !seen.has(nk)) { seen.add(nk); stack.push(nb); }
          }
        }
        comps.push(comp);
      }
      comps.sort((a, b) => b.length - a.length);
      for (const comp of comps.slice(1)) {
        for (const c of comp) {
          const counts = new Map<number, number>();
          for (const [dq, dr] of HEX_DIRS) {
            const nb = cells.get(key(c.q + dq, c.r + dr));
            if (nb && nb.t !== t && nb.house === c.house) counts.set(nb.t, (counts.get(nb.t) || 0) + 1);
          }
          if (counts.size === 0) { cells.delete(key(c.q, c.r)); continue; }
          c.t = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }
      }
    }
  }

  const hexes: Hex[] = [...cells.values()].map(({ q, r, x, y, t, rad }) => ({ q, r, x, y, t, rad }));
  const adjSet: Set<number>[] = Array.from({ length: nt }, () => new Set());
  for (const c of cells.values()) {
    for (const [dq, dr] of HEX_DIRS) {
      const nb = cells.get(key(c.q + dq, c.r + dr));
      if (nb && nb.t !== c.t) { adjSet[c.t].add(nb.t); adjSet[nb.t].add(c.t); }
    }
  }
  const byT: Hex[][] = Array.from({ length: nt }, () => []);
  for (const h of hexes) byT[h.t].push(h);
  const centroid: [number, number][] = byT.map((hs) => {
    const cx = hs.reduce((a, h) => a + h.x, 0) / hs.length;
    const cy = hs.reduce((a, h) => a + h.y, 0) / hs.length;
    // snap to the territory's hex nearest its centroid, so tokens never sit over a gap
    const best = hs.reduce((b, h) => (Math.hypot(h.x - cx, h.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? h : b), hs[0]);
    return [best.x, best.y];
  });
  const adj = adjSet.map((s) => [...s].sort((a, b) => a - b));
  const dist = adj.map((_, from) => {
    const d = new Array(nt).fill(Infinity);
    d[from] = 0;
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      for (const x of adj[c]) if (d[x] === Infinity) { d[x] = d[c] + 1; q.push(x); }
    }
    return d;
  });
  // Two-House quadrants pay about one army per two territories; the walled-in Frostfangs less.
  const quadBonus = QUADRANTS.map((q) => (q.houses.length > 1 ? Math.round(K * 0.55) : Math.round(K * 0.3)));
  return {
    n, perHouse: K, rows, territories, nt, hexes, adj, dist, centroid, quadBonus,
    foot: territories.filter((t) => t.foot).map((t) => t.id),
    R_IN, R_OUT, keepOf: (h: number) => h * K,
  };
}

const CACHE = new Map<number, Geo>();
/** The valley for a game of `n` players (built once, then cached). */
export function geoFor(n: number): Geo {
  const k = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
  let g = CACHE.get(k);
  if (!g) { g = buildGeo(k); CACHE.set(k, g); }
  return g;
}
