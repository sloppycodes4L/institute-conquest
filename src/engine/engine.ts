// The rules engine. `act()` validates and applies one action to a GameState in place.
// Deterministic given the injected rng/now, so the server and local mode share it verbatim.

import { HOUSES, MAX_PLAYERS, MIN_PLAYERS, QUADRANTS, isRough, layoutFor, mapGeo, type Geo } from './data.ts';
import { CARD, CHARACTER_IDS, ALL_CARD_IDS, OLYMPUS_POWER, isSiegeCard, type CardDef, type PassiveKind } from './cards.ts';

export const NEUTRAL = -1;
export const STD_PHANTOMS = 3;
/** Tunables, exported so the balance simulator can sweep them. */
export const BALANCE = {
  keepWall: 1, stdGuard: 5, graceRounds: 1, stdDefDice: 3,
  /**
   * Olympus garrison per territory of a House slice, so it grows with the map (143 on the 4-player map,
   * plus its Proctors). Behind its walls each defender costs ~1.9 attackers. In bot trials with armies
   * staged at the Foot: two ~150-army Houses break it about 1 time in 3, three Houses 55–80% of the time,
   * and two very large Houses (240+) almost always.
   */
  olyPerTerr: 11,
  /** Olympus regrows this many defenders at the start of every allied turn during a siege. */
  olyRegen: 2,
  /** Each ally gets this many turns to break Olympus before the siege fails. */
  olyRounds: 3,
  /** Rounds before a failed siege can be tried again. */
  olyCooldown: 2,
  /** Attacking from Mountains: + to the highest attack die. */
  mountainAtk: 1,
  /** Defending a Forest: + to the highest defense die. */
  forestDef: 2,
  /** Each player starts holding the territories of their slice this many steps from their Keep. */
  coreRadius: 1,
  /** Neutral garrisons on the rest of a player's slice: inside, on marches by a neutral House, on fronts facing another player. */
  sliceGarrison: 2,
  marchGarrison: 3,
  frontGarrison: 7,
};
export const TRADE_VALUE = 10;
export const HAND_LIMIT = 5;
export const REACTION_MS = 25_000;
export const MAX_INVITES = 3;

/** What the host picks before the war: sizes are offsets from the recommendation, so they follow the player count. */
export interface WarSettings {
  /** Valley size, -2 (smaller) … +2 (larger) steps from the recommended one. */
  size: number;
  /** Starting troops, -2 (fewer) … +2 (lots), see TROOP_LEVELS. */
  troops: number;
  alliances: boolean;
  siege: boolean;
}
export const DEFAULT_SETTINGS: WarSettings = { size: 0, troops: 0, alliances: true, siege: true };
export const TROOP_LEVELS: Record<string, number> = { '-2': 0.6, '-1': 0.8, '0': 1, '1': 1.3, '2': 1.6 };
/** The settings a war is actually fought with. */
export interface GameOpts { layout: number; troops: number; alliances: boolean; siege: boolean }

/** Recommended starting armies, spread over a player's starting core. */
export const recommendedTroops = (layout: number) => 20 + 2 * layout;

export function resolveSettings(n: number, ws: Partial<WarSettings> = {}): GameOpts {
  const w = { ...DEFAULT_SETTINGS, ...ws };
  const layout = layoutFor(n, w.size);
  const level = TROOP_LEVELS[String(Math.max(-2, Math.min(2, Math.round(w.troops || 0))))] ?? 1;
  return { layout, troops: Math.round(recommendedTroops(layout) * level), alliances: w.alliances !== false, siege: w.alliances !== false && w.siege !== false };
}
export function cleanSettings(x: any): WarSettings {
  const num = (v: any) => (Number.isFinite(+v) ? Math.max(-2, Math.min(2, Math.round(+v))) : 0);
  return { size: num(x?.size), troops: num(x?.troops), alliances: x?.alliances !== false, siege: x?.siege !== false };
}

export type Phase = 'passage' | 'draft' | 'attack' | 'fortify' | 'over';

export interface Player {
  seat: number;
  name: string;
  house: number;
  general: string | null;
  alive: boolean;
  dominatedBy: number | null;
  ai?: boolean;
}
export interface HandCard { id: string; locked: boolean }
export interface StandardState { at: number; captured: boolean; by: number | null; guard: number }
export interface Buffs { atk: number; breakLine: number; longStrike: number; fortifyAll: boolean; fury: boolean; siegeWalls: number; siegeAtk: number }
export interface Battle { key: string; atk: boolean; breakLine: boolean }
export interface TurnState {
  reinforcements: number;
  /** Armies placed this Draft, by territory, so they can be taken back. */
  placed: Record<string, number>;
  conquered: number;
  fortifies: number;
  stdMoved: boolean;
  warCry: boolean;
  buffs: Buffs;
  battle: Battle | null;
  mustMove: { from: number; to: number; min: number; max: number } | null;
}
export interface Reaction { defender: number; deadline: number; from: number; to: number; commit: number }
/**
 * One accepted action, as the public map saw it: which territories changed hands or armies (t, owner, armies triples),
 * which Standards moved (house, at, captured triples), and the log up to `seq`. Clients replay these to show
 * other players' moves one step at a time.
 */
export interface Frame { v: number; seat: number; seq: number; cur: number; ph: Phase; d: number[]; st?: number[] }
export const TRAIL_MAX = 500;
export interface GameEvent { id: number; k: string; /** Private event: only these seats see it. */ vis?: number[]; [x: string]: any }
export interface Private { deck: string[]; discard: string[]; hands: HandCard[][]; passage: (string[] | null)[] }
export interface Alliance { id: number; members: number[]; public: boolean; since: number }
export interface Invite { id: number; from: number; to: number; public: boolean; turn: number }
export interface SiegeVote { alliance: number; by: number; yes: number[]; no: number[] }
export interface Siege {
  alliance: number;
  members: number[];
  garrison: number;
  start: number;
  proctors: string[];
  regen: number;
  smite: number;
  defHigh: number;
  /** Allied turns left before the siege fails. */
  turnsLeft: number;
  /** Seats whose next turn is safe from Olympus's smite. */
  shield: number[];
}

export interface GameState {
  v: 2;
  version: number;
  opts: GameOpts;
  trail: Frame[];
  phase: Phase;
  players: Player[];
  order: number[];
  cur: number;
  turn: number;
  owner: number[];
  armies: number[];
  standards: StandardState[];
  killed: { seat: number; card: string }[];
  ts: TurnState;
  reaction: Reaction | null;
  winner: number | null;
  /** Everyone who shares the win (the whole alliance when Olympus falls). */
  winners: number[];
  log: GameEvent[];
  seq: number;
  uid: number;
  /** Diplomacy opens once one House has attacked another. */
  warBegun: boolean;
  alliances: Alliance[];
  invites: Invite[];
  vote: SiegeVote | null;
  siege: Siege | null;
  siegeCooldown: number;
  handCounts: number[];
  deckCount: number;
  priv: Private | null;
  me?: { seat: number; hand: HandCard[]; passage: string[] | null };
}

export type Action =
  | { type: 'choose'; card: string }
  | { type: 'place'; t: number; n: number }
  | { type: 'unplace'; t: number; n: number }
  | { type: 'undoDraft' }
  | { type: 'trade'; cards: string[] }
  | { type: 'play'; card: string; t?: number; seat?: number }
  | { type: 'discardProctor'; card: string }
  | { type: 'endDraft' }
  | { type: 'attack'; from: number; to: number; dice?: number; blitz?: boolean; commit?: number }
  | { type: 'assault'; from: number; dice?: number; blitz?: boolean }
  | { type: 'react'; card: string | null }
  | { type: 'timeout' }
  | { type: 'move'; n: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; from: number; to: number; n: number }
  | { type: 'moveStd'; to: number }
  | { type: 'endTurn' }
  | { type: 'invite'; to: number; public: boolean }
  | { type: 'answer'; invite: number; accept: boolean }
  | { type: 'reveal' }
  | { type: 'proposeSiege' }
  | { type: 'vote'; yes: boolean }
  | { type: 'concede' };

export interface Ctx { rng: () => number; now: number }
export type Result = { ok: true } | { ok: false; err: string };

class RuleError extends Error {}
function fail(msg: string): never { throw new RuleError(msg); }

let R: () => number = Math.random;
let NOW = 0;

// ---------------------------------------------------------------------------
// helpers

export const geo = (s: GameState): Geo => mapGeo(s.opts?.layout ?? layoutFor(s.players.length));

/** Wars saved before settings and replays existed get the old defaults. */
export function norm(s: GameState): GameState {
  if (!s.opts) s.opts = { layout: layoutFor(s.players.length), troops: 0, alliances: true, siege: true };
  if (!s.trail) s.trail = [];
  return s;
}

export function shuffle<T>(a: T[], rng: () => number = R): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const d6 = () => 1 + Math.floor(R() * 6);

function log(s: GameState, ev: Omit<GameEvent, 'id'>) {
  s.log.push({ id: ++s.seq, ...ev } as GameEvent);
  if (s.log.length > 360) s.log.splice(0, s.log.length - 360);
}

export const houseOf = (s: GameState, seat: number) => s.players[seat].house;

export function housesOwned(s: GameState, seat: number): number[] {
  if (seat < 0) return [];
  const out: number[] = [];
  s.standards.forEach((st, h) => {
    if (h === s.players[seat].house && !st.captured) out.push(h);
    else if (st.captured && st.by === seat) out.push(h);
  });
  return out;
}
export const ownsHouse = (s: GameState, seat: number, h: number) => housesOwned(s, seat).includes(h);

// --- alliances --------------------------------------------------------------

export function allianceOf(s: GameState, seat: number): Alliance | null {
  return seat < 0 ? null : s.alliances.find((a) => a.members.includes(seat)) ?? null;
}
export function allies(s: GameState, seat: number): number[] {
  return allianceOf(s, seat)?.members.filter((m) => m !== seat) ?? [];
}
export const allied = (s: GameState, a: number, b: number) => a >= 0 && b >= 0 && a !== b && allies(s, a).includes(b);

/** A single General's passive value for its owner (canon House match gives +1). */
export function generalPassive(s: GameState, seat: number, kind: PassiveKind): number {
  const p = s.players[seat];
  if (!p?.general) return 0;
  const c = CARD[p.general];
  if (!c?.passive || c.passive.kind !== kind) return 0;
  return c.passive.n + (c.house === p.house ? 1 : 0);
}
/** Passive value for a seat: its own General plus every ally's General (alliances share Passives). */
export function passive(s: GameState, seat: number, kind: PassiveKind): number {
  if (seat < 0) return 0;
  return [seat, ...allies(s, seat)].reduce((a, x) => a + generalPassive(s, x, kind), 0);
}
export function passiveValue(card: CardDef, playerHouse: number) {
  return card.passive ? card.passive.n + (card.house === playerHouse ? 1 : 0) : 0;
}
export function activeValue(s: GameState, seat: number, card: CardDef) {
  return card.active.n + (card.kind !== 'proctor' && ownsHouse(s, seat, card.house) ? card.active.bonus : 0);
}

export const territoriesOf = (s: GameState, seat: number) => s.owner.flatMap((o, t) => (o === seat ? [t] : []));

export function standardAt(s: GameState, t: number): number {
  return s.standards.findIndex((st) => !st.captured && st.at === t);
}
function guardAt(s: GameState, t: number) {
  const h = standardAt(s, t);
  return h >= 0 ? s.standards[h].guard : 0;
}

/** Territories reachable from `from` moving only through territories owned by `seat`. */
export function connectedOwned(s: GameState, seat: number, from: number): Set<number> {
  const adj = geo(s).adj;
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = q.pop()!;
    for (const n of adj[c]) if (s.owner[n] === seat && !seen.has(n)) { seen.add(n); q.push(n); }
  }
  return seen;
}

/** Every territory `seat` may attack from `from` right now (touching, plus long strikes). */
export function attackTargets(s: GameState, seat: number, from: number): number[] {
  const g = geo(s);
  const out = g.adj[from].filter((t) => s.owner[t] !== seat);
  if (s.ts.buffs.longStrike > 0) for (let t = 0; t < g.nt; t++) if (g.dist[from][t] === 2 && s.owner[t] !== seat) out.push(t);
  if (s.ts.battle) {
    const [a, b] = s.ts.battle.key.split('>').map(Number);
    if (a === from && Number.isInteger(b) && !out.includes(b) && s.owner[b] !== seat) out.push(b);
  }
  return out;
}

/** Why `seat` can't attack `to` from `from` right now, or null if it can. */
export function attackBlocker(s: GameState, seat: number, from: number, to: number): string | null {
  const g = geo(s), T = g.territories;
  if (s.phase !== 'attack') return 'Not the attack phase.';
  if (s.ts.mustMove) return 'Move your armies into the conquered territory first.';
  if (!(from >= 0 && from < g.nt && to >= 0 && to < g.nt)) return 'No such territory.';
  if (s.owner[from] !== seat) return `You do not hold ${T[from].name}.`;
  if (s.owner[to] === seat) return 'You cannot attack yourself, gorydamn idiot.';
  if (!attackTargets(s, seat, from).includes(to)) {
    if (T[from].quadrant !== T[to].quadrant) return `${T[to].name} is across the chasm from ${T[from].name}. The chasms can only be crossed on the land bridges.`;
    return `${T[to].name} doesn't border ${T[from].name}. Only territories that touch it can be attacked.`;
  }
  if (s.armies[from] < 2) return `${T[from].name} has only 1 army. You need 2+ to attack, because one always stays behind.`;
  const h = standardAt(s, to);
  if (h >= 0 && s.owner[to] >= 0 && s.turn <= BALANCE.graceRounds * s.players.length) {
    return `${T[to].name} holds House ${HOUSES[h].name}'s Standard. The Proctors forbid strikes on a Standard during the first round.`;
  }
  return null;
}

/**
 * The march from `from` to `to` through `seat`'s land. Mountains, water and marsh can end a march but never be crossed:
 * if every route crosses one, the column halts on the first such territory (`stop`) and has to go on next turn.
 */
export function fortifyRoute(s: GameState, seat: number, from: number, to: number): { path: number[]; stop: number } | null {
  const g = geo(s), T = g.territories;
  if (!(from >= 0 && from < g.nt && to >= 0 && to < g.nt) || from === to || s.owner[from] !== seat || s.owner[to] !== seat) return null;
  const search = (blockRough: boolean) => {
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (c === to) break;
      if (blockRough && c !== from && isRough(T[c].terrain)) continue;
      for (const n of g.adj[c]) if (s.owner[n] === seat && !prev.has(n)) { prev.set(n, c); q.push(n); }
    }
    if (!prev.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0])!);
    return path;
  };
  const clear = search(true);
  if (clear) return { path: clear, stop: to };
  const path = search(false);
  if (!path) return null;
  const halt = path.findIndex((t, i) => i > 0 && t !== to && isRough(T[t].terrain));
  return { path, stop: path[halt] };
}

/** Terrain bonuses for a fight: +high ground for the attacker, +cover for the defender. */
export function terrainMods(s: GameState, from: number, to: number) {
  const T = geo(s).territories;
  return {
    atk: from >= 0 && T[from].terrain === 'mountain' ? BALANCE.mountainAtk : 0,
    def: to >= 0 && T[to].terrain === 'forest' ? BALANCE.forestDef : 0,
  };
}

export function reinforcementBreakdown(s: GameState, seat: number) {
  const g = geo(s);
  const owned = territoriesOf(s, seat);
  const base = Math.max(3, Math.floor(owned.length / 3));
  const quads = QUADRANTS.map((q, i) => ({ i, name: q.name, bonus: g.quadBonus[i] }))
    .filter((q) => g.territories.every((t) => t.quadrant !== q.i || s.owner[t.id] === seat));
  const keeps = owned.filter((t) => g.territories[t].isKeep).length;
  const keepBonus = (keeps * (keeps + 3)) / 2;
  const general = passive(s, seat, 'draft') + passive(s, seat, 'perHouse') * housesOwned(s, seat).length;
  const total = base + quads.reduce((a, q) => a + q.bonus, 0) + keepBonus + general;
  return { territories: owned.length, base, quads, keeps, keepBonus, general, total };
}

const hand = (s: GameState, seat: number) => s.priv!.hands[seat];

/** At HAND_LIMIT+ cards you must trade before leaving the Draft, if you can (locked cards can't be traded). */
export function mustTrade(s: GameState, seat: number): boolean {
  const h = s.priv ? s.priv.hands[seat] : s.me?.seat === seat ? s.me.hand : [];
  return h.length >= HAND_LIMIT && h.filter((c) => !c.locked).length >= 3;
}

function drawCard(s: GameState, seat: number, locked: boolean): string | null {
  const p = s.priv!;
  if (!p.deck.length) {
    p.deck = shuffle(p.discard.splice(0));
    if (!p.deck.length) return null;
  }
  const id = p.deck.pop()!;
  p.hands[seat].push({ id, locked });
  return id;
}
function takeFromHand(s: GameState, seat: number, id: string, allowLocked = false): CardDef {
  const h = hand(s, seat);
  const i = h.findIndex((c) => c.id === id && (allowLocked || !c.locked));
  if (i < 0) fail('That card is not in your hand (or is locked until next turn).');
  h.splice(i, 1);
  s.priv!.discard.push(id);
  return CARD[id];
}

// ---------------------------------------------------------------------------
// setup

/**
 * Which Houses get players: a random pick among the sets with the fewest next-door neighbours (players whose
 * slices touch), so the first rounds are spent taking neutral land rather than fighting each other.
 */
export function spreadHouses(g: Geo, n: number, rng: () => number = R): number[] {
  const keeps = HOUSES.map((_, h) => g.keepOf(h));
  const near = Math.min(...keeps.flatMap((a, i) => keeps.filter((_, j) => j !== i).map((b) => g.dist[a][b])));
  const sets: { hs: number[]; close: number }[] = [];
  const walk = (from: number, hs: number[]) => {
    if (hs.length === n) {
      let close = 0;
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) if (g.dist[keeps[hs[i]]][keeps[hs[j]]] <= near) close++;
      sets.push({ hs: [...hs], close });
      return;
    }
    for (let h = from; h < HOUSES.length; h++) walk(h + 1, [...hs, h]);
  };
  walk(0, []);
  const best = Math.min(...sets.map((x) => x.close));
  let pool = sets.filter((x) => x.close === best);
  // Too few choices means the same Houses every game: allow one more pair of neighbours.
  if (pool.length < 4) pool = sets.filter((x) => x.close <= best + 1);
  return pool[Math.floor(rng() * pool.length)].hs;
}

export function createGame(names: string[], rng: () => number, opts: { ai?: boolean[]; settings?: Partial<WarSettings> } = {}): GameState {
  R = rng;
  const n = names.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  const o = resolveSettings(n, opts.settings);
  const g = mapGeo(o.layout);
  const houses = shuffle(spreadHouses(g, n));
  const players: Player[] = names.map((name, seat) => ({
    seat, name: name.slice(0, 24) || `Gold ${seat + 1}`, house: houses[seat], general: null, alive: true, dominatedBy: null, ai: opts.ai?.[seat] || undefined,
  }));

  const chars = shuffle([...CHARACTER_IDS]);
  const passage = players.map(() => [chars.pop()!, chars.pop()!]);
  const deck = shuffle([...chars, ...ALL_CARD_IDS.filter((id) => CARD[id].kind !== 'character')]);

  const owner = new Array(g.nt).fill(NEUTRAL);
  const armies: number[] = g.territories.map((t) => (t.isKeep ? 8 : 3));
  const playerHouses = new Set(houses);

  // Each player holds the heart of their slice around the Keep. The rest of the slice is wild land held by
  // neutral garrisons, thickest on the fronts facing another player, so there's room to grow before the killing.
  for (const p of players) {
    const keep = g.keepOf(p.house);
    const slice = g.territories.filter((t) => t.house === p.house).map((t) => t.id);
    const mine = slice.filter((t) => g.dist[keep][t] <= BALANCE.coreRadius);
    for (const t of slice) {
      const other = g.adj[t].map((x) => g.territories[x].house).filter((h) => h !== p.house);
      armies[t] = other.some((h) => playerHouses.has(h)) ? BALANCE.frontGarrison : other.length ? BALANCE.marchGarrison : BALANCE.sliceGarrison;
    }
    for (const t of mine) { owner[t] = p.seat; armies[t] = 1; }
    let rest = Math.max(0, o.troops - mine.length);
    const toKeep = Math.round(rest * 0.25);
    armies[keep] += toKeep;
    rest -= toKeep;
    // Lean the rest toward the frontier, since the Keep is well inside the lines.
    const w = mine.map((t) => (g.adj[t].some((x) => owner[x] !== p.seat) ? 2.5 : 1));
    const W = w.reduce((a, b) => a + b, 0);
    while (rest-- > 0) {
      let x = R() * W;
      let pick = mine[mine.length - 1];
      for (let i = 0; i < mine.length; i++) { x -= w[i]; if (x <= 0) { pick = mine[i]; break; } }
      armies[pick]++;
    }
  }

  const s: GameState = {
    v: 2, version: 0, opts: o, trail: [], phase: 'passage', players, order: shuffle(players.map((p) => p.seat)), cur: -1, turn: 0,
    owner, armies,
    standards: HOUSES.map((_, h) => ({ at: g.keepOf(h), captured: false, by: null, guard: playerHouses.has(h) ? BALANCE.stdGuard : 0 })),
    killed: [], ts: freshTurn(), reaction: null, winner: null, winners: [], log: [], seq: 0, uid: 0,
    warBegun: false, alliances: [], invites: [], vote: null, siege: null, siegeCooldown: 0,
    handCounts: [], deckCount: 0,
    priv: { deck, discard: [], hands: players.map(() => []), passage },
  };
  s.cur = s.order[0];
  for (const p of players) log(s, { k: 'sorted', seat: p.seat, house: p.house });
  sync(s);
  return s;
}

function freshTurn(): TurnState {
  return {
    reinforcements: 0, placed: {}, conquered: 0, fortifies: 0, stdMoved: false, warCry: false,
    buffs: { atk: 0, breakLine: 0, longStrike: 0, fortifyAll: false, fury: false, siegeWalls: 0, siegeAtk: 0 }, battle: null, mustMove: null,
  };
}

function sync(s: GameState) {
  if (!s.priv) return;
  s.handCounts = s.priv.hands.map((h) => h.length);
  s.deckCount = s.priv.deck.length;
}

function startTurn(s: GameState, seat: number) {
  const g = geo(s);
  s.cur = seat;
  s.turn++;
  s.phase = 'draft';
  s.ts = freshTurn();
  const p = s.players[seat];
  for (const c of hand(s, seat)) c.locked = false;
  // Your quiet invitations expire when your next turn comes around.
  for (const inv of s.invites.filter((i) => i.from === seat)) log(s, { k: 'inviteExpired', from: inv.from, to: inv.to, vis: [inv.from, inv.to] });
  s.invites = s.invites.filter((i) => i.from !== seat);
  if (s.siege?.members.includes(seat)) olympusTurn(s, seat);
  const st = s.standards[p.house];
  if (!st.captured) st.guard = BALANCE.stdGuard + passive(s, seat, 'stdGuard');
  const rb = reinforcementBreakdown(s, seat);
  s.ts.reinforcements = rb.total;
  const extras: string[] = [];
  const kp = passive(s, seat, 'keep');
  if (kp && s.owner[g.keepOf(p.house)] === seat) { s.armies[g.keepOf(p.house)] += kp; extras.push(`+${kp} on Keep`); }
  const bp = passive(s, seat, 'border');
  if (bp) {
    const borders = territoriesOf(s, seat).filter((t) => g.adj[t].some((n) => s.owner[n] !== seat));
    if (borders.length) { const t = borders[Math.floor(R() * borders.length)]; s.armies[t] += bp; extras.push(`+${bp} on ${g.territories[t].name}`); }
  }
  log(s, { k: 'turn', seat, turn: s.turn, reinf: rb.total, extras });
}

function advance(s: GameState) {
  if (s.phase === 'over') return;
  const i = s.order.indexOf(s.cur);
  for (let k = 1; k <= s.order.length; k++) {
    const seat = s.order[(i + k) % s.order.length];
    if (s.players[seat].alive) { startTurn(s, seat); return; }
  }
}

// ---------------------------------------------------------------------------
// combat

interface Mods { atkHigh: number; atkAll: number; defHigh: number; defAll: number }
function roll(aDice: number, dDice: number, m: Mods) {
  const a = Array.from({ length: aDice }, d6).sort((x, y) => y - x);
  const d = Array.from({ length: dDice }, d6).sort((x, y) => y - x);
  const raw = { a: [...a], d: [...d] };
  a[0] += m.atkHigh; d[0] += m.defHigh;
  for (let i = 0; i < a.length; i++) a[i] += m.atkAll;
  for (let i = 0; i < d.length; i++) d[i] += m.defAll;
  let aLoss = 0, dLoss = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++) (a[i] > d[i] ? dLoss++ : aLoss++);
  return { a, d, raw, aLoss, dLoss };
}

function startBattle(s: GameState, key: string, longStrike: boolean): Battle {
  if (s.ts.battle?.key === key) return s.ts.battle;
  const b = s.ts.buffs;
  const battle: Battle = { key, atk: b.atk > 0, breakLine: b.breakLine > 0 };
  if (battle.atk) b.atk--;
  if (battle.breakLine) b.breakLine--;
  if (longStrike) b.longStrike--;
  s.ts.battle = battle;
  return battle;
}

/** Keeps are fortresses: walls add to every defense die, and the General's defKeep adds to the highest. */
function defenseMods(s: GameState, to: number, extraAll = 0): { defHigh: number; defAll: number } {
  const def = s.owner[to];
  const keep = geo(s).territories[to].isKeep;
  return {
    defHigh: (keep && def >= 0 ? passive(s, def, 'defKeep') : 0) + terrainMods(s, -1, to).def,
    defAll: (keep ? BALANCE.keepWall : 0) + extraAll,
  };
}

/** The first attack by one House on another opens diplomacy; attacking an ally shatters the alliance. */
function onHostility(s: GameState, seat: number, def: number) {
  if (def < 0 || def === seat) return;
  if (!s.warBegun) { s.warBegun = true; log(s, { k: 'warBegun', seat, def }); }
  const a = allianceOf(s, seat);
  if (a && a.members.includes(def)) {
    s.alliances = s.alliances.filter((x) => x !== a);
    s.invites = s.invites.filter((i) => !a.members.includes(i.from) && !a.members.includes(i.to));
    log(s, { k: 'betrayal', seat, victim: def, members: a.members, wasPublic: a.public, quip: Math.floor(R() * 1000) });
    if (s.vote?.alliance === a.id) s.vote = null;
    if (s.siege?.alliance === a.id) { s.siege = null; log(s, { k: 'siegeCollapsed', seat }); }
  }
}

function captureStandard(s: GameState, h: number, captor: number) {
  const st = s.standards[h];
  if (st.captured) return;
  st.captured = true;
  st.by = captor;
  st.guard = 0;
  const victim = s.players.find((p) => p.alive && p.house === h);
  log(s, { k: 'stdCaptured', house: h, captor, victim: victim ? victim.seat : null });
  if (victim) dominate(s, victim.seat, captor);
  else if (captor >= 0) {
    const flipped: number[] = [];
    for (const t of geo(s).territories) if (t.house === h && s.owner[t.id] === NEUTRAL) { s.owner[t.id] = captor; flipped.push(t.id); }
    log(s, { k: 'neutralFall', house: h, captor, flipped });
  }
}

function leaveAlliance(s: GameState, seat: number) {
  s.invites = s.invites.filter((i) => i.from !== seat && i.to !== seat);
  const a = allianceOf(s, seat);
  if (!a) return;
  a.members = a.members.filter((m) => m !== seat);
  if (a.members.length < 2) {
    s.alliances = s.alliances.filter((x) => x !== a);
    log(s, { k: 'allianceEnds', members: [...a.members, seat], vis: a.public ? undefined : [...a.members, seat] });
  }
  if (s.vote && !s.alliances.some((x) => x.id === s.vote!.alliance)) s.vote = null;
  if (s.siege) {
    s.siege.members = s.siege.members.filter((m) => m !== seat);
    if (!s.alliances.some((x) => x.id === s.siege!.alliance)) { s.siege = null; log(s, { k: 'siegeCollapsed', seat }); }
  }
}

function dominate(s: GameState, victim: number, captor: number) {
  const vp = s.players[victim];
  vp.alive = false;
  vp.dominatedBy = captor;
  let terr = 0;
  for (let t = 0; t < s.owner.length; t++) if (s.owner[t] === victim) { s.owner[t] = captor; terr++; }
  const cards = s.priv!.hands[victim].splice(0);
  if (captor >= 0) s.priv!.hands[captor].push(...cards.map((c) => ({ id: c.id, locked: false })));
  else s.priv!.discard.push(...cards.map((c) => c.id));
  s.standards.forEach((st) => { if (st.captured && st.by === victim) st.by = captor; });
  log(s, { k: 'dominated', victim, captor, terr, cards: cards.length });
  leaveAlliance(s, victim);
  const alive = s.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    s.phase = 'over';
    s.winner = alive[0]?.seat ?? null;
    s.winners = s.winner != null ? [s.winner] : [];
    s.reaction = null;
    s.ts.mustMove = null;
    s.vote = null;
    s.siege = null;
    log(s, { k: 'win', seat: s.winner });
  }
}

function conquer(s: GameState, seat: number, from: number, to: number, minMove: number) {
  const prev = s.owner[to];
  s.owner[to] = seat;
  s.armies[to] = 0;
  s.ts.conquered++;
  const bonus = s.ts.conquered === 1 ? passive(s, seat, 'conquest') : 0;
  s.armies[to] += bonus;
  log(s, { k: 'conquer', seat, from, to, prev, bonus });
  const h = standardAt(s, to);
  const max = s.armies[from] - 1;
  const min = Math.min(minMove, max);
  if (max <= min) { s.armies[from] -= max; s.armies[to] += max; }
  else s.ts.mustMove = { from, to, min, max };
  if (h >= 0) captureStandard(s, h, seat);
  if (s.phase === 'over' && s.ts.mustMove) {
    const mm = s.ts.mustMove; s.armies[mm.from] -= mm.max; s.armies[mm.to] += mm.max; s.ts.mustMove = null;
  }
}

function checkAttack(s: GameState, seat: number, from: number, to: number) {
  const err = attackBlocker(s, seat, from, to);
  if (err) fail(err);
}

function attack(s: GameState, seat: number, a: Extract<Action, { type: 'attack' }>) {
  const { from, to } = a;
  checkAttack(s, seat, from, to);
  if (a.commit != null) return standardAttack(s, seat, from, to, a.commit);
  onHostility(s, seat, s.owner[to]);
  const battle = startBattle(s, `${from}>${to}`, !geo(s).adj[from].includes(to));
  const def = s.owner[to];
  const tm = terrainMods(s, from, to);
  const rolls: any[] = [];
  let aLost = 0, dLost = 0;
  do {
    const dice = Math.max(1, Math.min(3, a.dice ?? 3, s.armies[from] - 1));
    const dUnits = s.armies[to] + guardAt(s, to);
    const dDice = battle.breakLine ? 1 : Math.min(standardAt(s, to) >= 0 ? BALANCE.stdDefDice : 2, dUnits);
    const m: Mods = {
      atkHigh: (battle.atk ? 1 : 0) + (def === NEUTRAL ? passive(s, seat, 'atkNeutral') : 0) + tm.atk,
      atkAll: s.ts.buffs.fury ? 1 : 0,
      ...defenseMods(s, to),
    };
    const r = roll(dice, dDice, m);
    s.armies[from] -= r.aLoss;
    let dl = r.dLoss;
    const realLoss = Math.min(dl, s.armies[to]);
    s.armies[to] -= realLoss; dl -= realLoss;
    const h = standardAt(s, to);
    if (dl > 0 && h >= 0) s.standards[h].guard = Math.max(0, s.standards[h].guard - dl);
    aLost += r.aLoss; dLost += r.dLoss;
    rolls.push({ a: r.a, d: r.d, raw: r.raw, aLoss: r.aLoss, dLoss: r.dLoss });
    if (s.armies[to] === 0 && guardAt(s, to) === 0) {
      log(s, { k: 'battle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, aLost, dLost, won: true, blitz: !!a.blitz, tA: tm.atk, tD: tm.def });
      conquer(s, seat, from, to, dice);
      return;
    }
  } while (a.blitz && s.armies[from] >= 2);
  log(s, { k: 'battle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, aLost, dLost, won: false, blitz: !!a.blitz, tA: tm.atk, tD: tm.def });
}

function counterCards(s: GameState, seat: number) {
  return hand(s, seat).filter((c) => !c.locked && CARD[c.id].active.kind === 'counter');
}

function standardAttack(s: GameState, seat: number, from: number, to: number, commit: number) {
  const h = s.players[seat].house;
  if (standardAt(s, from) !== h) fail('Your Standard is not in that territory.');
  if (!Number.isInteger(commit) || commit < 1 || commit > s.armies[from] - 1) fail('Commit between 1 and all-but-one of your armies.');
  const def = s.owner[to];
  onHostility(s, seat, def);
  if (def >= 0 && counterCards(s, def).length) {
    s.reaction = { defender: def, deadline: NOW + REACTION_MS, from, to, commit };
    log(s, { k: 'stdRaised', seat, from, to, commit, def, pending: true });
    return;
  }
  log(s, { k: 'stdRaised', seat, from, to, commit, def, pending: false });
  resolveStandard(s, seat, from, to, commit, null);
}

function resolveStandard(s: GameState, seat: number, from: number, to: number, commit: number, counter: string | null) {
  s.reaction = null;
  const me = s.players[seat];
  const battle = startBattle(s, `${from}>${to}`, !geo(s).adj[from].includes(to));
  const def = s.owner[to];
  s.armies[from] -= commit;
  let aReal = commit, aPh = STD_PHANTOMS;
  let dReal = s.armies[to], dPh = guardAt(s, to);
  let defAll = 0;
  if (counter && def >= 0) {
    const c = takeFromHand(s, def, counter);
    const n = activeValue(s, def, c);
    dPh += n; defAll = 1;
    log(s, { k: 'counter', seat: def, card: c.id, n });
  }
  let wcAtk = false, wcBreak = false, wcFury = false;
  if (!s.ts.warCry && me.general) {
    s.ts.warCry = true;
    const g = CARD[me.general];
    const n = activeValue(s, seat, g);
    let effect = '';
    switch (g.active.kind) {
      case 'armies': case 'harvest': aReal += Math.max(n, 2); effect = `+${Math.max(n, 2)} armies join the charge`; break;
      case 'atkBuff': wcAtk = true; effect = '+1 to the highest attack die'; break;
      case 'breakLine': wcBreak = true; effect = 'the defender rolls a single die'; break;
      case 'sabotage': case 'raid': { const k = Math.min(n, Math.max(0, dReal - 1)); dReal -= k; effect = `${k} defenders cut down before the clash`; break; }
      case 'counter': aPh += n; effect = `+${n} phantom attackers`; break;
      case 'fury': wcFury = true; effect = 'all attack dice +1'; break;
      case 'steal': {
        if (def >= 0) { let k = 0; for (let i = 0; i < n && hand(s, def).length; i++) { const j = Math.floor(R() * hand(s, def).length); hand(s, seat).push({ id: hand(s, def).splice(j, 1)[0].id, locked: false }); k++; } effect = `${k} card(s) stolen from the defender`; }
        else { aReal += 2; effect = '+2 armies join the charge'; }
        break;
      }
      default: aReal += 2; effect = '+2 armies join the charge';
    }
    log(s, { k: 'warCry', seat, general: g.id, effect });
  }
  const dStart = dReal;
  const m: Mods = {
    atkHigh: passive(s, seat, 'atkStd') + (battle.atk || wcAtk ? 1 : 0) + (def === NEUTRAL ? passive(s, seat, 'atkNeutral') : 0) + terrainMods(s, from, to).atk,
    atkAll: s.ts.buffs.fury || wcFury ? 1 : 0,
    ...defenseMods(s, to, defAll),
  };
  const rolls: any[] = [];
  const stdH = standardAt(s, to);
  let guard = 0;
  while (aReal + aPh > 0 && dReal + dPh > 0 && guard++ < 500) {
    const aDice = Math.min(3, aReal + aPh);
    const dDice = battle.breakLine || wcBreak ? 1 : Math.min(stdH >= 0 ? BALANCE.stdDefDice : 2, dReal + dPh);
    const r = roll(aDice, dDice, m);
    let al = r.aLoss, dl = r.dLoss;
    const ar = Math.min(al, aReal); aReal -= ar; aPh -= al - ar;
    const dr = Math.min(dl, dReal); dReal -= dr; dPh -= dl - dr;
    rolls.push({ a: r.a, d: r.d, raw: r.raw, aLoss: r.aLoss, dLoss: r.dLoss });
  }
  if (stdH >= 0) s.standards[stdH].guard = 0;
  if (dReal + dPh <= 0) {
    const enslaved = dStart + passive(s, seat, 'slaver');
    s.owner[to] = seat;
    s.armies[to] = Math.max(1, aReal + enslaved);
    s.standards[me.house].at = to;
    s.ts.conquered++;
    if (s.ts.conquered === 1) s.armies[to] += passive(s, seat, 'conquest');
    log(s, { k: 'stdBattle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, won: true, enslaved, survivors: aReal, aLost: commit - aReal, dLost: dStart });
    if (stdH >= 0 && stdH !== me.house) captureStandard(s, stdH, seat);
  } else {
    s.armies[to] = Math.max(1, dReal);
    log(s, { k: 'stdBattle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, won: false, aLost: commit, dLost: dStart - dReal });
    captureStandard(s, me.house, def);
    if (s.phase !== 'over') advance(s);
  }
}

// ---------------------------------------------------------------------------
// diplomacy

/** Why `seat` can't invite `to` right now, or null if it can. */
export function inviteBlocker(s: GameState, seat: number, to: number): string | null {
  if (s.phase === 'passage' || s.phase === 'over') return 'Not now.';
  if (!s.opts.alliances) return 'Alliances are off in this war.';
  if (!s.warBegun) return 'Diplomacy opens once one House has attacked another.';
  if (!s.players[seat]?.alive || !s.players[to]?.alive || seat === to) return 'Pick a living rival.';
  if (allied(s, seat, to)) return 'You are already allies.';
  // Only a *public* rival alliance blocks the offer, so the error never gives away a secret pact.
  // (If the target turns out to be secretly sworn elsewhere, they simply can't accept.)
  if (allianceOf(s, seat) && allianceOf(s, to)?.public) return 'They are sworn to another alliance.';
  if (s.invites.some((i) => (i.from === seat && i.to === to) || (i.from === to && i.to === seat))) return 'A message is already on its way between you.';
  if (s.invites.filter((i) => i.from === seat).length >= MAX_INVITES) return `You can have at most ${MAX_INVITES} invitations out at once.`;
  if (s.siege) return 'The valley is at war with Olympus.';
  return null;
}

function joinAlliance(s: GameState, inv: Invite) {
  const A = allianceOf(s, inv.from), B = allianceOf(s, inv.to);
  let al: Alliance, joined: number;
  if (A) { A.members.push(inv.to); al = A; joined = inv.to; }
  else if (B) { B.members.push(inv.from); al = B; joined = inv.from; }
  else { al = { id: ++s.uid, members: [inv.from, inv.to], public: inv.public, since: s.turn }; s.alliances.push(al); joined = inv.to; }
  // Pending invites that can no longer be honoured are withdrawn.
  s.invites = s.invites.filter((i) => !allied(s, i.from, i.to) && !(allianceOf(s, i.from) && allianceOf(s, i.to)));
  log(s, { k: 'allianceFormed', members: [...al.members], joined, by: inv.from, pub: al.public, quip: Math.floor(R() * 1000), vis: al.public ? undefined : [...al.members] });
}

/** Why `seat` can't call a Siege on Olympus right now, or null if it can. */
export function siegeBlocker(s: GameState, seat: number): string | null {
  if (s.phase === 'passage' || s.phase === 'over') return 'Not now.';
  if (!s.opts.siege) return 'The Siege on Olympus is off in this war.';
  const a = allianceOf(s, seat);
  if (!a) return 'Only an alliance can besiege Olympus.';
  if (s.siege) return 'The siege is already underway.';
  if (s.vote) return 'The alliance is already voting.';
  const rivals = s.players.filter((p) => p.alive && !a.members.includes(p.seat));
  if (rivals.length) return `Every enemy House must fall first (${rivals.map((p) => p.name).join(', ')} still stand${rivals.length === 1 ? 's' : ''}).`;
  const standing = HOUSES.map((_, h) => h).filter((h) => !s.players.some((p) => p.house === h) && !s.standards[h].captured);
  if (standing.length) return `The neutral garrison${standing.length > 1 ? 's' : ''} of ${standing.map((h) => `House ${HOUSES[h].name}`).join(', ')} still hold${standing.length > 1 ? '' : 's'} a Standard.`;
  if (s.turn < s.siegeCooldown) return 'The Proctors are still laughing at your last siege. Wait a round.';
  return null;
}

function tallyVote(s: GameState) {
  const v = s.vote!;
  const a = s.alliances.find((x) => x.id === v.alliance);
  if (!a) { s.vote = null; return; }
  const m = a.members.length;
  if (v.yes.length * 2 > m) { s.vote = null; beginSiege(s, a); return; }
  if (v.no.length * 2 >= m) {
    s.vote = null;
    s.siegeCooldown = s.turn + 1;
    log(s, { k: 'siegeRejected', yes: v.yes, no: v.no });
  }
}

export function olympusPreview(s: GameState, members: number[]) {
  const K = geo(s).perHouse;
  const proctors = members.map((m) => `p-${HOUSES[s.players[m].house].id}`);
  let garrison = BALANCE.olyPerTerr * K, regen = BALANCE.olyRegen, smite = 0, defHigh = 0;
  for (const p of proctors) {
    const pw = OLYMPUS_POWER[p];
    garrison += pw.start; regen += pw.regen; smite += pw.smite; defHigh += pw.defHigh;
  }
  return { garrison, regen, smite, defHigh, proctors, turns: members.length * BALANCE.olyRounds };
}

function beginSiege(s: GameState, a: Alliance) {
  const o = olympusPreview(s, a.members);
  a.public = true;
  s.siege = {
    alliance: a.id, members: [...a.members], garrison: o.garrison, start: o.garrison, proctors: o.proctors,
    regen: o.regen, smite: o.smite, defHigh: o.defHigh, turnsLeft: o.turns, shield: [],
  };
  log(s, { k: 'siegeBegins', members: [...a.members], garrison: o.garrison, proctors: o.proctors, turns: o.turns });
}

/** At the start of each allied turn in a siege: Olympus regrows and smites the Foot. */
function olympusTurn(s: GameState, seat: number) {
  const sg = s.siege!;
  if (sg.turnsLeft <= 0) {
    const a = s.alliances.find((x) => x.id === sg.alliance);
    s.siege = null;
    if (a) s.alliances = s.alliances.filter((x) => x !== a);
    s.siegeCooldown = s.turn + BALANCE.olyCooldown * s.players.length;
    log(s, { k: 'siegeFailed', members: sg.members, garrison: sg.garrison });
    return;
  }
  sg.turnsLeft--;
  sg.garrison += sg.regen;
  let killed = 0;
  if (sg.smite && !sg.shield.includes(seat)) {
    const g = geo(s);
    for (let i = 0; i < sg.smite; i++) {
      const pool = g.foot.filter((t) => s.owner[t] === seat && s.armies[t] > 1);
      if (!pool.length) break;
      s.armies[pool[Math.floor(R() * pool.length)]]--;
      killed++;
    }
  }
  sg.shield = sg.shield.filter((x) => x !== seat);
  log(s, { k: 'olympusTurn', seat, regen: sg.regen, killed, garrison: sg.garrison, turnsLeft: sg.turnsLeft });
}

function assault(s: GameState, seat: number, a: Extract<Action, { type: 'assault' }>) {
  const sg = s.siege;
  const g = geo(s);
  if (s.phase !== 'attack') fail('Not the attack phase.');
  if (s.ts.mustMove) fail('Move your armies into the conquered territory first.');
  if (!sg || !sg.members.includes(seat)) fail('There is no siege on Olympus for you to join.');
  const from = a.from;
  if (!(from >= 0 && from < g.nt) || !g.territories[from].foot || s.owner[from] !== seat) fail('Assault from the Foot of Olympus: an inner-ring territory you hold.');
  if (s.armies[from] < 2) fail('Need at least 2 armies to assault.');
  const battle = startBattle(s, `${from}>O`, false);
  const walls = s.ts.buffs.siegeWalls > 0 ? 0 : BALANCE.keepWall;
  if (s.ts.buffs.siegeWalls > 0) s.ts.buffs.siegeWalls--;
  const rolls: any[] = [];
  let aLost = 0, dLost = 0;
  do {
    const dice = Math.max(1, Math.min(3, a.dice ?? 3, s.armies[from] - 1));
    const dDice = battle.breakLine ? 1 : Math.min(2, sg.garrison);
    const m: Mods = {
      atkHigh: (battle.atk ? 1 : 0) + s.ts.buffs.siegeAtk + terrainMods(s, from, -1).atk,
      atkAll: s.ts.buffs.fury ? 1 : 0,
      defHigh: sg.defHigh,
      defAll: walls,
    };
    const r = roll(dice, dDice, m);
    s.armies[from] -= r.aLoss;
    sg.garrison -= r.dLoss;
    aLost += r.aLoss; dLost += r.dLoss;
    rolls.push({ a: r.a, d: r.d, raw: r.raw, aLoss: r.aLoss, dLoss: r.dLoss });
  } while (a.blitz && s.armies[from] >= 2 && sg.garrison > 0);
  const won = sg.garrison <= 0;
  log(s, { k: 'assault', seat, from, rolls: rolls.slice(-4), n: rolls.length, aLost, dLost, garrison: Math.max(0, sg.garrison), won, blitz: !!a.blitz, walls: walls > 0 });
  if (won) {
    sg.garrison = 0;
    s.phase = 'over';
    s.winner = seat;
    s.winners = [...sg.members];
    s.ts.mustMove = null;
    log(s, { k: 'olympusFalls', seat, members: sg.members });
  }
}

// ---------------------------------------------------------------------------
// cards

function playCard(s: GameState, seat: number, a: Extract<Action, { type: 'play' }>) {
  const g = geo(s);
  if (s.phase !== 'draft') fail('Cards can only be played during the Draft.');
  const def = CARD[a.card];
  if (!def) fail('Unknown card.');
  if (!hand(s, seat).some((c) => c.id === a.card && !c.locked)) fail('That card is not playable (missing or locked).');
  if (def.active.kind === 'counter') fail('Counter cards can only be played when a Standard attacks you. You can still trade them.');
  if (def.kind === 'proctor' && !ownsHouse(s, seat, def.house)) fail(`You don't own House ${HOUSES[def.house].name}. Discard this Proctor for 2 cards instead.`);
  if (isSiegeCard(def) && !s.siege?.members.includes(seat)) fail('Relics only work during a Siege on Olympus. You can still trade them.');
  const n = activeValue(s, seat, def);
  const me = s.players[seat];
  const adjToMine = (t: number) => g.adj[t].some((x) => s.owner[x] === seat);
  const valid = (t: number) => Number.isInteger(t) && t >= 0 && t < g.nt;
  let detail: any = {};
  switch (def.active.kind) {
    case 'armies': s.ts.reinforcements += n; break;
    case 'atkBuff': s.ts.buffs.atk += n; break;
    case 'breakLine': s.ts.buffs.breakLine += n; break;
    case 'longStrike': s.ts.buffs.longStrike += n; break;
    case 'fortifyAll': s.ts.buffs.fortifyAll = true; s.ts.reinforcements += n; break;
    case 'fury': s.ts.buffs.fury = true; break;
    case 'harvest': {
      const k = g.territories.filter((t) => t.quadrant === 3 && s.owner[t.id] === seat).length;
      s.ts.reinforcements += k + n; detail = { gained: k + n }; break;
    }
    case 'sabotage': {
      const t = a.t ?? -1;
      if (!valid(t) || s.owner[t] === seat || !adjToMine(t)) fail('Pick an enemy territory next to yours.');
      const k = Math.min(n, s.armies[t] - 1);
      s.armies[t] -= k; detail = { t, killed: k }; break;
    }
    case 'raid': {
      const targets = [...new Set(territoriesOf(s, seat).flatMap((t) => g.adj[t]))]
        .filter((t) => s.owner[t] !== seat && s.armies[t] >= 2)
        .sort((x, y) => s.armies[y] - s.armies[x]).slice(0, n);
      for (const t of targets) s.armies[t]--;
      detail = { targets }; break;
    }
    case 'parley': {
      const t = a.t ?? -1;
      if (!valid(t) || s.owner[t] !== NEUTRAL || !adjToMine(t)) fail('Pick a neutral territory next to yours.');
      if (s.armies[t] > n) fail(`That garrison is too big to talk down (max ${n}).`);
      s.owner[t] = seat; s.ts.conquered++; detail = { t };
      const h = standardAt(s, t);
      takeFromHand(s, seat, a.card);
      log(s, { k: 'play', seat, card: def.id, n, ...detail });
      if (h >= 0) captureStandard(s, h, seat);
      return;
    }
    case 'steal': {
      const v = a.seat ?? -1;
      if (v < 0 || v >= s.players.length || v === seat || !s.players[v].alive) fail('Pick a living rival to rob.');
      let k = 0;
      for (let i = 0; i < n && hand(s, v).length; i++) {
        const j = Math.floor(R() * hand(s, v).length);
        hand(s, seat).push({ id: hand(s, v).splice(j, 1)[0].id, locked: true }); k++;
      }
      detail = { victim: v, stolen: k }; break;
    }
    case 'moveStd': {
      const t = a.t ?? -1;
      if (!valid(t) || s.owner[t] !== seat) fail('Pick a territory you hold.');
      if (s.standards[me.house].captured) fail('Your Standard is gone.');
      s.standards[me.house].at = t; s.armies[t] += n; detail = { t }; break;
    }
    case 'draw': { let k = 0; for (let i = 0; i < n; i++) if (drawCard(s, seat, true)) k++; detail = { drew: k }; break; }
    case 'siegeWalls': s.ts.buffs.siegeWalls += n; break;
    case 'siegeCut': { const sg = s.siege!; const k = Math.min(n, sg.garrison - 1); sg.garrison -= k; detail = { killed: k }; break; }
    case 'siegeLevy': s.ts.reinforcements += n; break;
    case 'siegeMoon': s.siege!.shield.push(seat); s.ts.buffs.siegeAtk = 1; break;
  }
  takeFromHand(s, seat, a.card);
  log(s, { k: 'play', seat, card: def.id, n, ...detail });
}

// ---------------------------------------------------------------------------
// dispatcher

export function act(s: GameState, seat: number, a: Action, ctx: Ctx): Result {
  R = ctx.rng;
  NOW = ctx.now;
  norm(s);
  const owner0 = s.owner.slice(), armies0 = s.armies.slice(), std0 = s.standards.map((x) => x.at + (x.captured ? 'c' : ''));
  try {
    apply(s, seat, a);
    s.version++;
    sync(s);
    const d: number[] = [];
    for (let t = 0; t < s.owner.length; t++) if (s.owner[t] !== owner0[t] || s.armies[t] !== armies0[t]) d.push(t, s.owner[t], s.armies[t]);
    const st: number[] = [];
    s.standards.forEach((x, h) => { if (x.at + (x.captured ? 'c' : '') !== std0[h]) st.push(h, x.at, x.captured ? 1 : 0); });
    s.trail.push({ v: s.version, seat, seq: s.seq, cur: s.cur, ph: s.phase, d, ...(st.length ? { st } : {}) });
    if (s.trail.length > TRAIL_MAX) s.trail.splice(0, s.trail.length - TRAIL_MAX);
    return { ok: true };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, err: e.message };
    throw e;
  }
}

function apply(s: GameState, seat: number, a: Action) {
  if (!s.players[seat]) fail('No such seat.');
  if (s.phase === 'over') fail('The game is over.');

  if (a.type === 'choose') {
    if (s.phase !== 'passage') fail('The Passage is over.');
    const opts = s.priv!.passage[seat];
    if (!opts) fail('You already walked out of the Passage.');
    if (!opts.includes(a.card)) fail('That card was not dealt to you.');
    const other = opts.find((c) => c !== a.card)!;
    s.players[seat].general = a.card;
    s.killed.push({ seat, card: other });
    s.priv!.discard.push(other);
    s.priv!.passage[seat] = null;
    log(s, { k: 'chosen', seat });
    if (s.priv!.passage.every((p) => p === null)) {
      for (const p of s.players) log(s, { k: 'passage', seat: p.seat, general: p.general, killed: s.killed.find((k) => k.seat === p.seat)!.card });
      for (const p of s.players) s.standards[p.house].guard = BALANCE.stdGuard + passive(s, p.seat, 'stdGuard');
      startTurn(s, s.order[0]);
    }
    return;
  }

  if (a.type === 'concede') {
    if (!s.players[seat].alive) fail('You are already out.');
    if (s.reaction && (s.reaction.defender === seat || s.cur === seat)) s.reaction = null;
    const wasCur = s.cur === seat && s.phase !== 'passage';
    log(s, { k: 'concede', seat });
    s.standards[s.players[seat].house].captured = true;
    s.standards[s.players[seat].house].by = NEUTRAL;
    dominate(s, seat, NEUTRAL);
    if (s.phase === 'passage') {
      s.priv!.passage[seat] = null;
      if (s.priv!.passage.every((p) => p === null)) startTurn(s, s.order.find((x) => s.players[x].alive)!);
    } else if (wasCur) advance(s);
    return;
  }

  if (s.phase === 'passage') fail('Everyone must first survive the Passage.');

  // Diplomacy happens out of turn, whispered across the valley.
  switch (a.type) {
    case 'invite': {
      if (!s.players[seat].alive) fail('The dead make poor allies.');
      const err = inviteBlocker(s, seat, a.to);
      if (err) fail(err);
      const inv: Invite = { id: ++s.uid, from: seat, to: a.to, public: !!a.public, turn: s.turn };
      s.invites.push(inv);
      log(s, { k: 'invite', from: seat, to: a.to, pub: inv.public, joining: !!allianceOf(s, seat) || !!allianceOf(s, a.to), vis: [seat, a.to] });
      return;
    }
    case 'answer': {
      const inv = s.invites.find((i) => i.id === a.invite);
      if (!inv || inv.to !== seat) fail('That invitation is gone.');
      if (a.accept && !s.opts.alliances) fail('Alliances are off in this war.');
      if (a.accept && (!s.players[inv.from].alive || !s.players[seat].alive)) fail('Too late. Someone died.');
      s.invites = s.invites.filter((i) => i !== inv);
      if (!a.accept) { log(s, { k: 'inviteDeclined', from: inv.from, to: inv.to, vis: [inv.from, inv.to] }); return; }
      if (allianceOf(s, inv.from) && allianceOf(s, inv.to)) { log(s, { k: 'inviteVoid', from: inv.from, to: inv.to, vis: [inv.from, inv.to] }); return; }
      joinAlliance(s, inv);
      return;
    }
    case 'reveal': {
      const al = allianceOf(s, seat);
      if (!al) fail('You have no alliance to reveal.');
      if (al.public) fail('Everyone already knows.');
      al.public = true;
      log(s, { k: 'allianceRevealed', seat, members: [...al.members], quip: Math.floor(R() * 1000) });
      return;
    }
    case 'proposeSiege': {
      const err = siegeBlocker(s, seat);
      if (err) fail(err);
      s.vote = { alliance: allianceOf(s, seat)!.id, by: seat, yes: [seat], no: [] };
      log(s, { k: 'siegeProposed', seat });
      tallyVote(s);
      return;
    }
    case 'vote': {
      const v = s.vote;
      if (!v) fail('Nobody has called for a siege.');
      if (allianceOf(s, seat)?.id !== v.alliance) fail('Not your alliance\'s vote.');
      if (v.yes.includes(seat) || v.no.includes(seat)) fail('You already voted.');
      (a.yes ? v.yes : v.no).push(seat);
      log(s, { k: 'siegeVote', seat, yes: a.yes });
      tallyVote(s);
      return;
    }
  }

  if (s.reaction) {
    const r = s.reaction;
    if (a.type === 'react') {
      if (seat !== r.defender) fail('Not your ambush to spring.');
      if (a.card && !counterCards(s, seat).some((c) => c.id === a.card)) fail('That is not a counter card in your hand.');
      resolveStandard(s, s.cur, r.from, r.to, r.commit, a.card);
      return;
    }
    if (a.type === 'timeout') {
      if (NOW < r.deadline) fail('The defender still has time.');
      resolveStandard(s, s.cur, r.from, r.to, r.commit, null);
      return;
    }
    fail('Waiting on the defender to react.');
  }

  if (seat !== s.cur) fail('It is not your turn.');
  const ts = s.ts;
  const me = s.players[seat];
  const g = geo(s);

  switch (a.type) {
    case 'place': {
      if (s.phase !== 'draft') fail('Not the Draft.');
      const n = Math.floor(a.n);
      if (!(n >= 1 && n <= ts.reinforcements)) fail('Bad army count.');
      if (!(a.t >= 0 && a.t < g.nt) || s.owner[a.t] !== seat) fail('You can only reinforce your own territory.');
      s.armies[a.t] += n; ts.reinforcements -= n;
      ts.placed[a.t] = (ts.placed[a.t] ?? 0) + n;
      log(s, { k: 'place', seat, t: a.t, n });
      return;
    }
    case 'unplace': {
      if (s.phase !== 'draft') fail('Not the Draft.');
      const n = Math.floor(a.n);
      const had = ts.placed[a.t] ?? 0;
      if (!(n >= 1 && n <= had)) fail(`You only placed ${had} there this Draft.`);
      s.armies[a.t] -= n; ts.reinforcements += n;
      if (had === n) delete ts.placed[a.t]; else ts.placed[a.t] = had - n;
      log(s, { k: 'unplace', seat, t: a.t, n });
      return;
    }
    case 'undoDraft': {
      if (s.phase !== 'draft') fail('Not the Draft.');
      let total = 0;
      for (const [t, n] of Object.entries(ts.placed)) { s.armies[+t] -= n; total += n; }
      if (!total) fail('Nothing placed yet.');
      ts.reinforcements += total;
      ts.placed = {};
      log(s, { k: 'undoDraft', seat, n: total });
      return;
    }
    case 'trade': {
      if (s.phase !== 'draft') fail('Trade during the Draft.');
      if (a.cards.length !== 3 || new Set(a.cards).size !== 3) fail('Trade exactly 3 cards.');
      const h = hand(s, seat);
      if (!a.cards.every((id) => h.some((c) => c.id === id && !c.locked))) fail('You can only trade unlocked cards in your hand.');
      for (const id of a.cards) takeFromHand(s, seat, id);
      ts.reinforcements += TRADE_VALUE;
      log(s, { k: 'trade', seat, cards: a.cards, n: TRADE_VALUE });
      return;
    }
    case 'play': return playCard(s, seat, a);
    case 'discardProctor': {
      if (s.phase !== 'draft') fail('Only during the Draft.');
      const c = CARD[a.card];
      if (!c || c.kind !== 'proctor') fail('Not a Proctor card.');
      if (ownsHouse(s, seat, c.house)) fail('You own that House. Use the Proctor instead of wasting it.');
      takeFromHand(s, seat, a.card);
      let k = 0;
      for (let i = 0; i < 2; i++) if (drawCard(s, seat, true)) k++;
      log(s, { k: 'discardProctor', seat, card: a.card, drew: k });
      return;
    }
    case 'endDraft': {
      if (s.phase !== 'draft') fail('Not the Draft.');
      if (ts.reinforcements > 0) fail(`Place your remaining ${ts.reinforcements} armies first.`);
      if (mustTrade(s, seat)) fail(`You hold ${hand(s, seat).length} cards. Trade or play down below ${HAND_LIMIT}.`);
      s.phase = 'attack';
      ts.placed = {};
      log(s, { k: 'phase', seat, phase: 'attack' });
      return;
    }
    case 'attack': return attack(s, seat, a);
    case 'assault': return assault(s, seat, a);
    case 'move': {
      const mm = ts.mustMove;
      if (!mm) fail('Nothing to move.');
      const n = Math.floor(a.n);
      if (n < mm.min || n > mm.max) fail(`Move between ${mm.min} and ${mm.max}.`);
      s.armies[mm.from] -= n; s.armies[mm.to] += n; ts.mustMove = null;
      return;
    }
    case 'endAttack': {
      if (s.phase !== 'attack') fail('Not the attack phase.');
      if (ts.mustMove) fail('Move into your conquest first.');
      s.phase = 'fortify';
      log(s, { k: 'phase', seat, phase: 'fortify' });
      return;
    }
    case 'fortify': {
      if (s.phase !== 'fortify') fail('Not the fortify phase.');
      const limit = 1 + passive(s, seat, 'fortify');
      if (!ts.buffs.fortifyAll && ts.fortifies >= limit) fail('No fortify moves left this turn.');
      if (s.owner[a.from] !== seat || s.owner[a.to] !== seat || a.from === a.to) fail('Fortify between two of your territories.');
      const route = fortifyRoute(s, seat, a.from, a.to);
      if (!route) fail('Those territories are not connected by your land.');
      const n = Math.floor(a.n);
      if (n < 1 || n > s.armies[a.from] - 1) fail('Bad army count (leave at least 1 behind).');
      const { path, stop } = route!;
      s.armies[a.from] -= n; s.armies[stop] += n; ts.fortifies++;
      log(s, { k: 'fortify', seat, from: a.from, to: stop, n, path: path.slice(0, path.indexOf(stop) + 1), ...(stop !== a.to ? { aim: a.to } : {}) });
      return;
    }
    case 'moveStd': {
      if (s.phase !== 'fortify') fail('Move the Standard during Fortify.');
      if (ts.stdMoved) fail('Your Standard already moved this turn.');
      const st = s.standards[me.house];
      if (st.captured) fail('Your Standard is gone.');
      if (s.owner[a.to] !== seat || !connectedOwned(s, seat, st.at).has(a.to)) fail('The Standard can only march through your own land.');
      const from = st.at;
      st.at = a.to; ts.stdMoved = true;
      log(s, { k: 'moveStd', seat, from, to: a.to });
      return;
    }
    case 'endTurn': {
      if (s.phase === 'draft') fail('Finish the Draft first.');
      if (ts.mustMove) fail('Move into your conquest first.');
      if (ts.conquered > 0) { const c = drawCard(s, seat, false); if (c) log(s, { k: 'earned', seat }); }
      log(s, { k: 'endTurn', seat });
      advance(s);
      return;
    }
    case 'react': case 'timeout': fail('No Standard attack is pending.');
  }
  fail('Unknown action.');
}

// ---------------------------------------------------------------------------
// views

/** Strip hidden information for one seat (or a spectator when seat is null). */
export function viewFor(s: GameState, seat: number | null): GameState {
  norm(s);
  const { priv, ...pub } = s;
  const v: GameState = JSON.parse(JSON.stringify(pub));
  v.priv = null;
  if (priv) { v.handCounts = priv.hands.map((h) => h.length); v.deckCount = priv.deck.length; }
  if (s.phase === 'passage') v.players.forEach((p) => { if (p.seat !== seat && p.general) p.general = '?'; });
  const sees = (vis?: number[]) => !vis || (seat != null && vis.includes(seat));
  v.log = v.log.filter((e) => sees(e.vis));
  v.alliances = v.alliances.filter((a) => a.public || (seat != null && a.members.includes(seat)));
  v.invites = v.invites.filter((i) => seat != null && (i.from === seat || i.to === seat));
  if (v.vote && !v.alliances.some((a) => a.id === v.vote!.alliance)) v.vote = null;
  if (seat != null && priv) v.me = { seat, hand: JSON.parse(JSON.stringify(priv.hands[seat])), passage: priv.passage[seat] };
  return v;
}

export const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Which seat should be acting right now (for local hot-seat and prompts). */
export function actingSeat(s: GameState): number {
  if (s.phase === 'passage') return s.priv ? s.priv.passage.findIndex((p) => p !== null) : -1;
  if (s.reaction) return s.reaction.defender;
  return s.cur;
}

/** An AI seat that owes an out-of-turn answer (an invitation or a siege vote), or -1. */
export function aiDuty(s: GameState): number {
  if (s.phase === 'passage' || s.phase === 'over') return -1;
  for (const inv of s.invites) if (s.players[inv.to].ai && s.players[inv.to].alive) return inv.to;
  if (s.vote) {
    const a = s.alliances.find((x) => x.id === s.vote!.alliance);
    const m = a?.members.find((x) => s.players[x].ai && !s.vote!.yes.includes(x) && !s.vote!.no.includes(x));
    if (m != null) return m;
  }
  return -1;
}
