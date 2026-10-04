// Static world data: Houses, quadrants, territory names, and the procedurally-built hex valley.
// Pure TS with no deps so it runs in the browser and in the Deno edge function.
//
// The valley is a ring of seven House slices around the sea beneath Olympus. Each slice is a
// polar grid of three rows (inner "Foot of Olympus", middle, outer) with the Keep in the middle
// of the middle row, so it is always buffered by at least two of its own territories before any
// foreign border. The four quadrants are separate landmasses: every war rolls its own land bridges
// between neighbouring quadrants, and ports whose sea lanes cross to the far shore. Each row of a
// slice is a bonus region. The map grows with the player count (see LAYOUTS).

export type HouseId = 'apollo' | 'diana' | 'minerva' | 'mars' | 'pluto' | 'jupiter' | 'ceres';
export type Biome =
  | 'keep' | 'forest' | 'lake' | 'swamp' | 'crag' | 'mountain'
  | 'plain' | 'fields' | 'highland' | 'snow' | 'deadwood';

export interface House {
  id: HouseId;
  name: string;
  color: string;
  sigil: string;
  epithet: string;
}

export const HOUSES: House[] = [
  { id: 'apollo', name: 'Apollo', color: '#e8b21e', sigil: '☉', epithet: 'the Sun-Fuckers' },
  { id: 'diana', name: 'Diana', color: '#2fa36b', sigil: '☾', epithet: 'the Huntresses' },
  { id: 'minerva', name: 'Minerva', color: '#3f86e0', sigil: '⌘', epithet: 'the Owls' },
  { id: 'mars', name: 'Mars', color: '#d42a2a', sigil: '♂', epithet: 'the Wolves' },
  { id: 'pluto', name: 'Pluto', color: '#8a5cc7', sigil: '♇', epithet: 'the Jackals' },
  { id: 'jupiter', name: 'Jupiter', color: '#e8e4d8', sigil: '♃', epithet: 'the Storm-Born' },
  { id: 'ceres', name: 'Ceres', color: '#e0782a', sigil: '⚳', epithet: 'the Bread-Bakers' },
];
export const HOUSE_INDEX: Record<HouseId, number> = Object.fromEntries(HOUSES.map((h, i) => [h.id, i])) as any;

/**
 * The valley ring is cut into seven slices, counter-clockwise from the east. A slice keeps its land (names,
 * biomes, regions, quadrant) from war to war; which House is dealt onto it changes (GameOpts.houses).
 */
export const SLICE_QUADRANT = [0, 0, 1, 1, 2, 3, 3];
export interface Quadrant { name: string; slices: number[] }
export const QUADRANTS: Quadrant[] = [
  { name: 'The Greatwoods', slices: [0, 1] },
  { name: 'The Highlands', slices: [2, 3] },
  { name: 'The Frostfangs', slices: [4] },
  { name: 'The Argos Lowlands', slices: [5, 6] },
];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;

/**
 * Valley sizes, smallest to largest: territories per row of each House slice, inner → outer.
 * The middle row is odd and ≥ 5 so the Keep sits at least two cells from either side.
 */
export const LAYOUTS: number[][] = [
  [3, 5, 3],
  [3, 5, 4],
  [3, 5, 5],
  [4, 5, 5],
  [4, 5, 6],
  [4, 5, 7],
  [5, 7, 6],
  [5, 7, 8],
];
/** The recommended valley for a player count (it grows with the players), nudged by a size offset. */
export function layoutFor(n: number, size = 0): number {
  const rec = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n)) - 2;
  return Math.max(0, Math.min(LAYOUTS.length - 1, rec + Math.round(size)));
}

/** What the ground does in a fight or on the march. */
export type Terrain = 'open' | 'keep' | 'mountain' | 'forest' | 'water' | 'marsh';
export const TERRAIN_OF: Record<Biome, Terrain> = {
  keep: 'keep', forest: 'forest', lake: 'water', swamp: 'marsh', mountain: 'mountain',
  crag: 'open', plain: 'open', fields: 'open', highland: 'open', snow: 'open', deadwood: 'open',
};
export const TERRAIN_INFO: Record<Terrain, { icon: string; name: string; text: string }> = {
  open: { icon: '', name: 'Open ground', text: 'No special effect.' },
  keep: { icon: '♜', name: 'Keep', text: 'Walls: whoever defends a Keep adds +1 to its highest defense die, on top of its garrison, honor guard and Passives. A neutral Keep holds 10.' },
  mountain: { icon: '⛰', name: 'Mountains', text: 'High ground: +1 to your lowest compared attack die when attacking from here (not against neutrals).' },
  forest: { icon: '🌲', name: 'Forest', text: 'Cover: +1 to the lowest defense die when a House defends here (neutrals get no cover).' },
  water: { icon: '🌊', name: 'Water', text: 'No special effect.' },
  marsh: { icon: '🌾', name: 'Marsh', text: 'No special effect.' },
};

// Slot 0 of each House is its Keep. Later slots are handed out nearest-the-Keep first.
const NAMES: [string, Biome][][] = [
  // Apollo
  [['The Sun Citadel', 'keep'], ['Gilded Steppe', 'plain'], ['Lyre Falls', 'lake'], ['Pythian Crags', 'crag'], ['Laurel Groves', 'forest'], ['Brightspire', 'mountain'],
    ['Delphi Rise', 'highland'], ['Helios Fields', 'fields'], ["Oracle's Tarn", 'lake'], ['Goldleaf Wood', 'forest'], ['Solar Scarp', 'crag'], ['Chariot Road', 'plain'],
    ['Amber Hollow', 'forest'], ['Dawnwatch', 'highland'], ["Python's Coil", 'swamp'], ['Sunfall Ridge', 'mountain'],
    ['Heliotrope Vale', 'fields'], ['Aurora Heights', 'highland'], ['Glimmerwood', 'forest'], ['Cinder Flats', 'plain']],
  // Diana
  [['Moonhall', 'keep'], ['The Greatwood', 'forest'], ["Hunter's Tarn", 'lake'], ['Hartsblood Run', 'plain'], ['Silverbirch Hollow', 'forest'], ['Antler Ridge', 'crag'],
    ['Quiverwood', 'forest'], ["Stag's Leap", 'highland'], ['Nightbloom Mire', 'swamp'], ['Wolfsbane Glen', 'forest'], ['Artemis Pool', 'lake'], ['Bowstring Crag', 'crag'],
    ['Doe Meadow', 'plain'], ['Moonshadow Vale', 'forest'], ['Thornbrake', 'forest'], ["Tracker's Height", 'mountain'],
    ['Fawn Brook', 'lake'], ['Elkhorn Moor', 'plain'], ['Duskwood', 'forest'], ['Crescent Tor', 'mountain']],
  // Minerva
  [["Minerva's Aerie", 'keep'], ['Owlwood', 'forest'], ['Stillmirror Lake', 'lake'], ['Scriptorium Hills', 'highland'], ['Greyveil Marsh', 'swamp'], ['The Thinking Stones', 'crag'],
    ['Ink River', 'lake'], ['Parchment Downs', 'plain'], ['Olive Terraces', 'fields'], ['Sagewood', 'forest'], ['Aegis Bluff', 'crag'], ['The Loom', 'highland'],
    ["Wisdom's Fen", 'swamp'], ['Athenaeum Rise', 'mountain'], ['Quillmoor', 'plain'], ['Shieldwall Heights', 'mountain'],
    ['Lamplight Fields', 'fields'], ['Riddle Wood', 'forest'], ['Owlet Tarn', 'lake'], ['Stylus Crag', 'crag']],
  // Mars
  [['Castle Mars', 'keep'], ['The Furor', 'lake'], ['Metas Fens', 'swamp'], ['Wolfpine Wood', 'forest'], ['Deimos Crags', 'mountain'], ['Phobos Watch', 'highland'],
    ["Howler's Den", 'forest'], ["Reaper's Field", 'plain'], ['Slingblade Gap', 'crag'], ['Ares Hollow', 'forest'], ['Bloodwater', 'lake'], ['Ironjaw Ridge', 'mountain'],
    ['The Warrens', 'highland'], ['Red Moor', 'plain'], ["Titus's Pit", 'swamp'], ['Spearpoint', 'crag'],
    ['Iron Plain', 'plain'], ['Wargrave Wood', 'forest'], ['Lupine Fields', 'fields'], ['Cindermount', 'mountain']],
  // Pluto
  [['The Hollow Keep', 'keep'], ['Bonewood', 'deadwood'], ['Black Ice Mere', 'lake'], ['Frostfang Pass', 'snow'], ['Wraith Marsh', 'swamp'], ['Grave Tors', 'mountain'],
    ['Styx Floe', 'lake'], ["Charon's Crossing", 'snow'], ["Deadman's Drift", 'snow'], ['Ashen Wood', 'deadwood'], ['Hades Scarp', 'crag'], ['Rimewatch', 'snow'],
    ['Cerberus Den', 'mountain'], ['Pale Barrow', 'deadwood'], ['Shade Fen', 'swamp'], ['Winterteeth', 'mountain'],
    ['Frostmere', 'lake'], ['Hollowmarch', 'snow'], ['Crypt Hills', 'crag'], ['Lethe Mire', 'swamp']],
  // Jupiter
  [['Thunderhold', 'keep'], ["Eagle's Rest", 'mountain'], ['Rainpools', 'lake'], ['Stormbreak Moor', 'highland'], ['Oakfather Wood', 'forest'], ['Lightning Flats', 'plain'],
    ['Cloudspire', 'mountain'], ['Thunderhead Downs', 'plain'], ['Ganymede Grove', 'forest'], ['Io Marsh', 'swamp'], ['Tempest Rise', 'highland'], ['Bolt Crag', 'crag'],
    ['Skyreach Fields', 'fields'], ["Titan's Seat", 'crag'], ['Callisto Tarn', 'lake'], ['Stormwood', 'forest'],
    ['Thunder Plains', 'plain'], ['Aquila Heights', 'highland'], ['Nimbus Wood', 'forest'], ['Galewatch', 'mountain']],
  // Ceres
  [['The Ovens', 'keep'], ['Breadfields', 'fields'], ['Millrace', 'lake'], ['Orchard Rows', 'forest'], ["Sowers' Mire", 'swamp'], ['Harvest Terraces', 'fields'],
    ['Wheatsea', 'fields'], ['Granary Hill', 'highland'], ['Beehive Glen', 'forest'], ["Plowman's Rest", 'plain'], ['Threshing Floor', 'plain'], ['Cornucopia', 'fields'],
    ['Rye Hollow', 'fields'], ['Scarecrow Crag', 'crag'], ['Honeywater', 'lake'], ["Demeter's Grove", 'forest'],
    ['Sickle Downs', 'plain'], ['Millstone Ridge', 'highland'], ['Clover Vale', 'fields'], ['Fallow Marsh', 'swamp']],
];

export interface Territory {
  id: number;
  name: string;
  biome: Biome;
  terrain: Terrain;
  /** The House dealt onto this territory's slice in this war. */
  house: number;
  /** The slice of the valley ring it belongs to (fixed land, whatever House is dealt onto it). */
  slice: number;
  quadrant: number;
  isKeep: boolean;
  row: number;
  col: number;
  /** Inner row: borders the sea beneath Olympus. Sieges on Olympus launch from here. */
  foot: boolean;
  /** The bonus region it belongs to (index into Geo.regions). */
  region: number;
  /** A port's sea lane leads to this territory, or -1. */
  port: number;
}

/** Hold every territory of a region for its bonus at the start of your turn. */
export interface Region {
  id: number;
  name: string;
  house: number;
  terr: number[];
  bonus: number;
  /** Where its label sits (world x, y). */
  at: [number, number];
}

// Region names per House: inner row, middle row (the Keep's), outer row, and the far half of a long outer row.
const REGION_NAMES: string[][] = [
  ['Sunward Strand', 'The Golden Heart', 'The Dawn Marches', 'The Solar Reaches'],
  ['The Moonlit Shore', 'The Greatwood Heart', 'The Hunting Marches', 'The Silverwood Reaches'],
  ['The Owl Coast', 'The Wise Heart', 'The Scroll Marches', 'The Grey Reaches'],
  ['The Furor Shore', 'The Wolf Heart', 'The Red Marches', 'The Iron Reaches'],
  ['The Black Ice Shore', 'The Hollow Heart', 'The Frost Marches', 'The Grave Reaches'],
  ['The Storm Coast', 'The Thunder Heart', 'The Sky Marches', 'The Gale Reaches'],
  ['The Millrace Shore', 'The Bread Heart', 'The Harvest Marches', 'The Orchard Reaches'],
];

// ---------------------------------------------------------------------------
// Hex valley generation (deterministic).
// Pointy-top axial hexes of size 1. World coords: x east, y north.

export interface Hex { q: number; r: number; x: number; y: number; t: number; rad: number }

export interface Geo {
  /** Index into LAYOUTS. */
  layout: number;
  perHouse: number;
  rows: number[];
  territories: Territory[];
  nt: number;
  hexes: Hex[];
  adj: number[][];
  dist: number[][];
  centroid: [number, number][];
  /** Bonus regions: hold one whole for its bonus. */
  regions: Region[];
  /** Sea lanes between ports, as territory pairs. */
  ports: [number, number][];
  /** The war's map seed (undefined: the fixed valley of wars from before ports). */
  seed?: number;
  /** Inner-row territories, where assaults on Olympus launch from. */
  foot: number[];
  R_IN: number;
  R_OUT: number;
  /** The House dealt onto each slice (identity for wars from before the Houses were dealt). */
  sliceHouse: number[];
  /** The Keep of a House (wherever its slice is). */
  keepOf(house: number): number;
  /** The Keep of a slice. */
  keepOfSlice(slice: number): number;
  /** The straits between quadrants: where their centre line runs, and where land bridges cross them. */
  straits: Strait[];
}
export interface Strait {
  /** Angle of the strait's centre line (world, radians). */
  angle: number;
  /** Land bridges across it: the crossing's midpoint (world x, y) and how wide it is. */
  bridges: { x: number; y: number; w: number }[];
}

const SQ3 = Math.sqrt(3);
const W = (Math.PI * 2) / 7;
const THETA0 = -W;
const HEX_AREA = (3 * SQ3) / 2;
const CELL_AREA = 14 * HEX_AREA; // target territory size, in world units²
const CHASM_HALF = 1.45;
const PASS_HALF = 1.3;
const HEX_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

// Where the straits between quadrants can be crossed: land bridges on these rows (a row index plus
// a radial nudge within it), keyed by the House on the counter-clockwise side of the border.
type Pass = { row: number; nudge: number };
const LEGACY_PASSES: Record<number, Pass[]> = {
  1: [{ row: 0, nudge: 0 }, { row: 2, nudge: 0 }], 3: [{ row: 2, nudge: 0 }], 4: [{ row: 0, nudge: 0 }], 6: [{ row: 0, nudge: 0 }, { row: 2, nudge: 0 }],
};
/** Borders between quadrants, keyed by the counter-clockwise House. */
const STRAITS = [1, 3, 4, 6];

/** A small seeded PRNG, so a war's map is the same everywhere it's rebuilt. */
export function seededRng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** This war's land bridges: one or two per strait (only one into the walled-in Frostfangs), on random rows. */
function rollPasses(rows: number, rng: () => number): Record<number, Pass[]> {
  const out: Record<number, Pass[]> = {};
  for (const h of STRAITS) {
    const frost = SLICE_QUADRANT[h] === 2 || SLICE_QUADRANT[(h + 1) % 7] === 2;
    const n = frost ? 1 : rng() < 0.6 ? 2 : 1;
    const pool = Array.from({ length: rows }, (_, i) => i);
    const picked: Pass[] = [];
    for (let i = 0; i < n; i++) {
      const row = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      picked.push({ row, nudge: (rng() - 0.5) * 0.5 });
    }
    out[h] = picked;
  }
  return out;
}

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

function buildGeo(layout: number, seed?: number): Geo {
  const rows = LAYOUTS[layout];
  const rng = seededRng(seed ?? 0);
  const passes = seed == null ? LEGACY_PASSES : rollPasses(rows.length, rng);
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
      territories.push({ id: h * K + s, name, biome, terrain: TERRAIN_OF[biome], house: h, slice: h, quadrant: SLICE_QUADRANT[h], isKeep: s === 0, row, col, foot: row === 0, region: -1, port: -1 });
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

      // Straits between quadrants, except on the land bridges.
      const toCw = frac * W * rad, toCcw = (1 - frac) * W * rad;
      const nbr = toCw < toCcw ? (house + 6) % 7 : (house + 1) % 7;
      if (SLICE_QUADRANT[nbr] !== SLICE_QUADRANT[house] && Math.min(toCw, toCcw) < CHASM_HALF) {
        const lowSide = toCw < toCcw ? nbr : house; // passes are keyed by the ccw-most House
        const onBridge = (passes[lowSide] ?? []).some((p) => {
          const mid = (edges[p.row] + edges[p.row + 1]) / 2 + p.nudge * (edges[p.row + 1] - edges[p.row]);
          return Math.abs(rad - mid) < PASS_HALF;
        });
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
  const bfs = (adjOf: Set<number>[]) => adjOf.map((_, from) => {
    const d = new Array(nt).fill(Infinity);
    d[from] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      for (const x of adjOf[c]) if (d[x] === Infinity) { d[x] = d[c] + 1; q.push(x); }
    }
    return d;
  });

  // Ports: sea lanes across the water beneath Olympus, one to each far shore plus one more at random.
  // A port is never next to its own Keep, so every Keep stays walled in by its own land.
  const ports: [number, number][] = [];
  if (seed != null) {
    const land = bfs(adjSet);
    const angle = (t: number) => Math.atan2(centroid[t][1], centroid[t][0]);
    const docks = (q: number) => territories.filter((t) => t.quadrant === q && t.foot && !t.isKeep && land[t.id][t.house * K] >= 2 && t.port < 0).map((t) => t.id);
    const link = (qa: number, qb: number) => {
      const A = docks(qa), B = docks(qb);
      const pairs = A.flatMap((a) => B.map((b) => {
        let da = Math.abs(angle(a) - angle(b)) % (Math.PI * 2);
        if (da > Math.PI) da = Math.PI * 2 - da;
        return { a, b, face: da };
      })).sort((x, y) => y.face - x.face);
      // Among the pairs that look across the water at each other, pick one at random.
      const top = pairs.slice(0, Math.max(1, Math.ceil(pairs.length / 3)));
      const p = top[Math.floor(rng() * top.length)];
      if (!p) return;
      territories[p.a].port = p.b; territories[p.b].port = p.a;
      adjSet[p.a].add(p.b); adjSet[p.b].add(p.a);
      ports.push([p.a, p.b]);
    };
    link(0, 2);
    link(1, 3);
    const extra = [[0, 1], [1, 2], [2, 3], [3, 0]][Math.floor(rng() * 4)];
    link(extra[0], extra[1]);
  }

  const adj = adjSet.map((s) => [...s].sort((a, b) => a - b));
  const dist = bfs(adjSet);

  // Regions: each row of a House slice, with a long outer row split in two. They pay about one army
  // per two territories, so there's always a bonus a few conquests away.
  const regions: Region[] = [];
  for (let h = 0; h < 7; h++) {
    rows.forEach((c, row) => {
      const cells = territories.filter((t) => t.house === h && t.row === row).sort((a, b) => a.col - b.col);
      const parts = c > 7 ? [cells.slice(0, Math.ceil(c / 2)), cells.slice(Math.ceil(c / 2))] : [cells];
      parts.forEach((part, i) => {
        const id = regions.length;
        for (const t of part) t.region = id;
        const hs = byT.filter((_, t) => territories[t].house === h && territories[t].row === row && part.some((x) => x.id === t)).flat();
        const mx = hs.reduce((a, x) => a + x.x, 0) / hs.length, my = hs.reduce((a, x) => a + x.y, 0) / hs.length;
        const at = hs.reduce((b, x) => (Math.hypot(x.x - mx, x.y - my) < Math.hypot(b.x - mx, b.y - my) ? x : b), hs[0]);
        regions.push({ id, name: REGION_NAMES[h][Math.min(3, row + i)], house: h, terr: part.map((t) => t.id), bonus: Math.max(1, Math.round(part.length * 0.55)), at: [at.x, at.y] });
      });
    });
  }
  // Straits: where quadrants meet. Land bridges are the spots where land from both sides touches across one.
  const straits: Strait[] = STRAITS.map((h) => {
    const angle = THETA0 + (h + 1) * W;
    const touch: { x: number; y: number; rad: number }[] = [];
    for (const c of cells.values()) {
      if (c.house !== h) continue;
      for (const [dq, dr] of HEX_DIRS) {
        const nb = cells.get(key(c.q + dq, c.r + dr));
        if (nb && nb.house === (h + 1) % 7 && !(territories[c.t].port === nb.t)) touch.push({ x: (c.x + nb.x) / 2, y: (c.y + nb.y) / 2, rad: Math.hypot(c.x + nb.x, c.y + nb.y) / 2 });
      }
    }
    touch.sort((a, b) => a.rad - b.rad);
    const groups: (typeof touch)[] = [];
    for (const p of touch) {
      const last = groups[groups.length - 1];
      if (last && p.rad - last[last.length - 1].rad < 2.5) last.push(p); else groups.push([p]);
    }
    const bridges = groups.map((gr) => ({
      x: gr.reduce((a, p) => a + p.x, 0) / gr.length,
      y: gr.reduce((a, p) => a + p.y, 0) / gr.length,
      w: Math.max(1.8, gr[gr.length - 1].rad - gr[0].rad + 1.8),
    }));
    return { angle, bridges };
  });

  return {
    layout, perHouse: K, rows, territories, nt, hexes, adj, dist, centroid, regions, ports, seed,
    foot: territories.filter((t) => t.foot).map((t) => t.id),
    R_IN, R_OUT, sliceHouse: [0, 1, 2, 3, 4, 5, 6], keepOf: (h: number) => h * K, keepOfSlice: (sl: number) => sl * K, straits,
  };
}

/** A valid slice → House deal (a permutation of the seven Houses), or null. */
export function cleanSliceHouse(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length !== 7) return null;
  const a = x.map((v) => +v);
  return a.every((v) => Number.isInteger(v) && v >= 0 && v < 7) && new Set(a).size === 7 ? a : null;
}

/** The same valley with Houses dealt onto its slices: every territory, region and Keep answers to its House. */
function dealHouses(base: Geo, sliceHouse: number[]): Geo {
  const K = base.perHouse;
  const sliceOfHouse: number[] = [];
  sliceHouse.forEach((h, sl) => { sliceOfHouse[h] = sl; });
  const territories = base.territories.map((t) => ({ ...t, house: sliceHouse[t.slice] }));
  const regions = base.regions.map((r) => ({ ...r, house: sliceHouse[r.house] }));
  return { ...base, territories, regions, sliceHouse: [...sliceHouse], keepOf: (h: number) => sliceOfHouse[h] * K };
}

const CACHE = new Map<string, Geo>();
function cached(k: string, make: () => Geo) {
  let g = CACHE.get(k);
  if (!g) {
    g = make();
    // The server sees many wars; keep only the latest few maps.
    if (CACHE.size > 48) CACHE.delete(CACHE.keys().next().value!);
    CACHE.set(k, g);
  }
  return g;
}
/** The valley for one of the LAYOUTS, a war's map seed, and its deal of Houses onto slices (built once, then cached). */
export function mapGeo(layout: number, seed?: number, sliceHouse?: number[] | null): Geo {
  const L = Math.max(0, Math.min(LAYOUTS.length - 1, layout | 0));
  const k = `${L}:${seed ?? '-'}`;
  const base = cached(k, () => buildGeo(L, seed));
  const deal = cleanSliceHouse(sliceHouse);
  if (!deal || deal.every((h, i) => h === i)) return base;
  return cached(`${k}:${deal.join('')}`, () => dealHouses(base, deal));
}
/** The valley for `n` players at a size offset from the recommended one. */
export const geoFor = (n: number, size = 0, seed?: number): Geo => mapGeo(layoutFor(n, size), seed);
