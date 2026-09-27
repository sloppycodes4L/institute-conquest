// Static world data: Houses, quadrants, territories, and the procedurally-built hex valley.
// Pure TS with no deps so it runs in the browser and in the Deno edge function.

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

export interface Quadrant { name: string; bonus: number; houses: number[] }
export const QUADRANTS: Quadrant[] = [
  { name: 'The Greatwoods', bonus: 5, houses: [0, 1] },
  { name: 'The Highlands', bonus: 5, houses: [2, 3] },
  { name: 'The Frostfangs', bonus: 2, houses: [4] },
  { name: 'The Argos Lowlands', bonus: 5, houses: [5, 6] },
];

export const TERR_PER_HOUSE = 6;
// Slot 0 of each House is its Keep.
const TERR_DEFS: [string, Biome][][] = [
  // Apollo
  [['The Sun Citadel', 'keep'], ['Gilded Steppe', 'plain'], ['Lyre Falls', 'lake'], ['Pythian Crags', 'crag'], ['Laurel Groves', 'forest'], ['Brightspire', 'mountain']],
  // Diana
  [['Moonhall', 'keep'], ['The Greatwood', 'forest'], ["Hunter's Tarn", 'lake'], ['Hartsblood Run', 'plain'], ['Silverbirch Hollow', 'forest'], ['Antler Ridge', 'crag']],
  // Minerva
  [["Minerva's Aerie", 'keep'], ['Owlwood', 'forest'], ['Stillmirror Lake', 'lake'], ['Scriptorium Hills', 'highland'], ['Greyveil Marsh', 'swamp'], ['The Thinking Stones', 'crag']],
  // Mars
  [['Castle Mars', 'keep'], ['The Furor', 'lake'], ['Metas Fens', 'swamp'], ['Wolfpine Wood', 'forest'], ['Deimos Crags', 'mountain'], ['Phobos Watch', 'highland']],
  // Pluto
  [['The Hollow Keep', 'keep'], ['Bonewood', 'deadwood'], ['Black Ice Mere', 'lake'], ['Frostfang Pass', 'snow'], ['Wraith Marsh', 'swamp'], ['Grave Tors', 'mountain']],
  // Jupiter
  [['Thunderhold', 'keep'], ["Eagle's Rest", 'mountain'], ['Rainpools', 'lake'], ['Stormbreak Moor', 'highland'], ['Oakfather Wood', 'forest'], ['Lightning Flats', 'plain']],
  // Ceres
  [['The Ovens', 'keep'], ['Breadfields', 'fields'], ['Millrace', 'lake'], ['Orchard Rows', 'forest'], ["Sowers' Mire", 'swamp'], ['Harvest Terraces', 'fields']],
];

export interface Territory {
  id: number;
  name: string;
  biome: Biome;
  house: number;
  quadrant: number;
  isKeep: boolean;
}
export const TERRITORIES: Territory[] = TERR_DEFS.flatMap((defs, h) =>
  defs.map(([name, biome], s) => ({
    id: h * TERR_PER_HOUSE + s, name, biome, house: h, quadrant: HOUSES[h].quadrant, isKeep: s === 0,
  })),
);
export const NT = TERRITORIES.length; // 42
export const keepOf = (house: number) => house * TERR_PER_HOUSE;

// ---------------------------------------------------------------------------
// Hex valley generation (deterministic).
// Pointy-top axial hexes of size 1. World coords: x east, y north.

export interface Hex { q: number; r: number; x: number; y: number; t: number; rad: number }
export interface WorldMap {
  hexes: Hex[];
  adj: number[][];
  centroid: [number, number][];
  R_IN: number;
  R_OUT: number;
}

const SQ3 = Math.sqrt(3);
const W = (Math.PI * 2) / 7;
const THETA0 = -W;
export const R_IN = 7.5;
export const R_OUT = 25;
const HEX_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

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

// Where the chasms between quadrants can be crossed, as radius bands.
const PASSES: Record<string, [number, number][]> = {
  '0-1': [[9.2, 11.6], [20, 22.6]],
  '1-2': [[22.2, 24.5]],
  '2-3': [[9.4, 12.2]],
  '0-3': [[9.2, 11.6], [20, 22.6]],
};

// Seed layout per House slot: [radius, fraction of the House's angular width].
const SLOTS: [number, number][] = [
  [16.4, -0.21], [11.4, -0.27], [11.4, 0.27], [16.4, 0.28], [21.4, -0.27], [21.4, 0.27],
];

function buildMap(): WorldMap {
  const seeds: { x: number; y: number; t: number; q: number }[] = [];
  for (let h = 0; h < 7; h++) {
    const mirror = h % 2 ? -1 : 1;
    const phi = THETA0 + (h + 0.5) * W;
    SLOTS.forEach(([r, f], s) => {
      const ff = s === 0 || s === 3 ? f * mirror : f;
      const a = phi + ff * W;
      seeds.push({ x: r * Math.cos(a), y: r * Math.sin(a), t: h * 6 + s, q: HOUSES[h].quadrant });
    });
  }

  const cells = new Map<string, Hex & { quad: number }>();
  const key = (q: number, r: number) => q + ',' + r;
  for (let q = -20; q <= 20; q++) {
    for (let r = -20; r <= 20; r++) {
      const x = SQ3 * (q + r / 2), y = 1.5 * r;
      const rad = Math.hypot(x, y);
      const edge = (vnoise(x * 0.18 + 40, y * 0.18) - 0.5) * 2.4;
      const inner = (vnoise(x * 0.3, y * 0.3 + 90) - 0.5) * 1.6;
      if (rad > R_OUT + edge || rad < R_IN + inner) continue;
      let ang = Math.atan2(y, x) + (vnoise(x * 0.12 + 7, y * 0.12 - 3) - 0.5) * 0.3;
      let rel = ang - THETA0;
      rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const house = Math.floor(rel / W) % 7;
      const quad = HOUSES[house].quadrant;
      cells.set(key(q, r), { q, r, x, y, t: -1, rad, quad });
    }
  }

  // Carve chasms between quadrants, except inside the passes.
  const carve: string[] = [];
  for (const [k, c] of cells) {
    for (const [dq, dr] of HEX_DIRS) {
      const n = cells.get(key(c.q + dq, c.r + dr));
      if (!n || n.quad === c.quad) continue;
      const a = Math.min(c.quad, n.quad), b = Math.max(c.quad, n.quad);
      if (c.quad !== a) continue; // carve only the lower-index side
      const passes = PASSES[a + '-' + b] || [];
      if (!passes.some(([lo, hi]) => c.rad >= lo && c.rad <= hi)) { carve.push(k); break; }
    }
  }
  for (const k of carve) cells.delete(k);

  // Weighted Voronoi: nudge seed weights so territories in a quadrant end up similar in size.
  const weight = new Array(NT).fill(0);
  const quadCells = [0, 1, 2, 3].map((q) => [...cells.values()].filter((c) => c.quad === q).length);
  for (let iter = 0; iter < 40; iter++) {
    const size = new Array(NT).fill(0);
    for (const c of cells.values()) {
      let best = -1, bd = Infinity;
      for (const s of seeds) {
        if (s.q !== c.quad) continue;
        const d = Math.hypot(s.x - c.x, s.y - c.y) + vnoise(c.x * 0.35 + s.t * 3.1, c.y * 0.35 - s.t) * 2.2 - weight[s.t];
        if (d < bd) { bd = d; best = s.t; }
      }
      c.t = best;
      size[best]++;
    }
    for (let t = 0; t < NT; t++) {
      const q = HOUSES[Math.floor(t / 6)].quadrant;
      const target = quadCells[q] / (QUADRANTS[q].houses.length * 6);
      weight[t] += 0.12 * (target - size[t]) / Math.sqrt(target);
    }
  }

  // Keep only the largest connected blob of each territory; hand orphans to neighbours.
  for (let pass = 0; pass < 3; pass++) {
    for (let t = 0; t < NT; t++) {
      const mine = [...cells.values()].filter((c) => c.t === t);
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
            const n = cells.get(nk);
            if (n && n.t === t && !seen.has(nk)) { seen.add(nk); stack.push(n); }
          }
        }
        comps.push(comp);
      }
      comps.sort((a, b) => b.length - a.length);
      for (const comp of comps.slice(1)) {
        for (const c of comp) {
          const counts = new Map<number, number>();
          for (const [dq, dr] of HEX_DIRS) {
            const n = cells.get(key(c.q + dq, c.r + dr));
            if (n && n.t !== t) counts.set(n.t, (counts.get(n.t) || 0) + 1);
          }
          if (counts.size === 0) { cells.delete(key(c.q, c.r)); continue; }
          c.t = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }
      }
    }
  }

  const hexes: Hex[] = [...cells.values()].map(({ q, r, x, y, t, rad }) => ({ q, r, x, y, t, rad }));
  const adjSet: Set<number>[] = Array.from({ length: NT }, () => new Set());
  for (const c of cells.values()) {
    for (const [dq, dr] of HEX_DIRS) {
      const n = cells.get(key(c.q + dq, c.r + dr));
      if (n && n.t !== c.t) { adjSet[c.t].add(n.t); adjSet[n.t].add(c.t); }
    }
  }
  const centroid: [number, number][] = Array.from({ length: NT }, (_, t) => {
    const hs = hexes.filter((h) => h.t === t);
    const cx = hs.reduce((a, h) => a + h.x, 0) / hs.length;
    const cy = hs.reduce((a, h) => a + h.y, 0) / hs.length;
    // snap to the territory's hex nearest its centroid, so tokens never sit over a gap
    const best = hs.reduce((b, h) => (Math.hypot(h.x - cx, h.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? h : b), hs[0]);
    return [best.x, best.y];
  });
  return { hexes, adj: adjSet.map((s) => [...s].sort((a, b) => a - b)), centroid, R_IN, R_OUT };
}

export const MAP: WorldMap = buildMap();
export const ADJ = MAP.adj;

/** BFS distances from `from` across the whole map (ignores ownership). */
export function distances(from: number): number[] {
  const d = new Array(NT).fill(Infinity);
  d[from] = 0;
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    for (const n of ADJ[c]) if (d[n] === Infinity) { d[n] = d[c] + 1; q.push(n); }
  }
  return d;
}
export const DIST: number[][] = Array.from({ length: NT }, (_, i) => distances(i));
