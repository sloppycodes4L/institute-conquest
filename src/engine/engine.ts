// The rules engine. `act()` validates and applies one action to a GameState in place.
// Deterministic given the injected rng/now, so the server and local mode share it verbatim.

import { HOUSES, MAX_PLAYERS, MIN_PLAYERS, QUADRANTS, layoutFor, mapGeo, type Geo } from './data.ts';
import { CARD, CHARACTER_IDS, ALL_CARD_IDS, EMOTES, OLYMPUS_POWER, isSiegeCard, type CardDef, type PassiveKind } from './cards.ts';

export const NEUTRAL = -1;
export const STD_PHANTOMS = 3;
/** Tunables, exported so the balance simulator can sweep them. */
export const BALANCE = {
  stdGuard: 5, graceRounds: 1,
  /** Olympus's walls: + to every defense die of its garrison. */
  olyWall: 1,
  /** A neutral House's Keep: exactly this garrison at setup, behind its Walls, and it never yields to Overwhelm. */
  neutralKeep: 10,
  /** A Keep's Walls: + to the highest defense die of whoever defends it (a House or a neutral garrison). */
  keepWall: 1,
  /** Other neutral garrisons yield without a fight to this many times their number (and otherwise roll 1 die). */
  overwhelm: 2,
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
  /** Attacking from Mountains: + to the lowest attack die that gets compared. Never against neutrals. */
  mountainAtk: 1,
  /** A House defending a Forest: + to the lowest defense die. Neutrals get no cover. */
  forestDef: 1,
  /** Each player starts holding the territories of their slice this many steps from their Keep. */
  coreRadius: 1,
  /**
   * Neutral garrisons on the rest of a player's slice: inside, on marches by a neutral House, on fronts facing another
   * player. Fronts and marches are thick because lone neutrals roll one die and yield to twice their number: this keeps
   * the first player-vs-player battle where it was before that rule (pace-sim: median round 3–4).
   */
  sliceGarrison: 2,
  marchGarrison: 6,
  frontGarrison: 14,
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
  /** Seconds each player gets per turn (0: no timer). See TURN_TIMERS. */
  timer: number;
  /** House Ultimates (comeback powers). They need 3 or more Houses: with 2 the war is fought without them. */
  ultimates: boolean;
}
export const TURN_TIMERS = [0, 60, 90, 120];
export const DEFAULT_SETTINGS: WarSettings = { size: 0, troops: 0, alliances: true, siege: true, timer: 0, ultimates: true };
/** House Ultimates need this many Houses in the war. */
export const ULT_MIN_PLAYERS = 3;
export const TROOP_LEVELS: Record<string, number> = { '-2': 0.6, '-1': 0.8, '0': 1, '1': 1.3, '2': 1.6 };
/** The settings a war is actually fought with. */
export interface GameOpts {
  layout: number; troops: number; alliances: boolean; siege: boolean;
  /** Rolls this war's land bridges and ports (missing on wars from before ports). */
  seed?: number;
  /** Seconds per turn, 0 for none. */
  timer?: number;
  /** Which House is dealt onto each slice of the valley (missing: slice i is House i). */
  houses?: number[];
  /**
   * A war from .008 on: every player chooses their Primus from the Characters of their own House, nobody dies, and a
   * Passive works at its printed value. Missing on older wars, which finish the Passage the old way (two cards, one
   * dies) and keep the +1 for a General of the player's own House.
   */
  pick?: boolean;
  /** House Ultimates are on in this war (the setting is on and 3 or more Houses play). Missing on wars from before .008. */
  ultimates?: boolean;
}

/** Recommended starting armies, spread over a player's starting core. */
export const recommendedTroops = (layout: number) => 20 + 2 * layout;

export function resolveSettings(n: number, ws: Partial<WarSettings> = {}): GameOpts {
  const w = { ...DEFAULT_SETTINGS, ...ws };
  const layout = layoutFor(n, w.size);
  const level = TROOP_LEVELS[String(Math.max(-2, Math.min(2, Math.round(w.troops || 0))))] ?? 1;
  const timer = TURN_TIMERS.includes(+w.timer) ? +w.timer : 0;
  return {
    layout, troops: Math.round(recommendedTroops(layout) * level), alliances: w.alliances !== false, siege: w.alliances !== false && w.siege !== false, timer,
    ultimates: w.ultimates !== false && n >= ULT_MIN_PLAYERS,
  };
}
export function cleanSettings(x: any): WarSettings {
  const num = (v: any) => (Number.isFinite(+v) ? Math.max(-2, Math.min(2, Math.round(+v))) : 0);
  return { size: num(x?.size), troops: num(x?.troops), alliances: x?.alliances !== false, siege: x?.siege !== false, timer: TURN_TIMERS.includes(+x?.timer) ? +x.timer : 0, ultimates: x?.ultimates !== false };
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
export interface Battle {
  key: string; atk: boolean; breakLine: boolean;
  /** Phantom defenders a REACTION card raised for this battle (they die last). */
  ph?: number;
  /** A REACTION card was sprung in this battle: +1 to every defense die. */
  amb?: boolean;
}
export interface TurnState {
  reinforcements: number;
  /** Armies placed this Draft, by territory, so they can be taken back. */
  placed: Record<string, number>;
  conquered: number;
  fortifies: number;
  stdMoved: boolean;
  /** The Standard can be raised once per turn. */
  stdRaised?: boolean;
  warCry: boolean;
  buffs: Buffs;
  battle: Battle | null;
  mustMove: { from: number; to: number; min: number; max: number } | null;
  /** Keeps conquered this turn (a Primus can be sworn in on the spot). */
  keepsTaken?: number[];
  /** Silenced this turn (Blackout on an alliance): no cards, no attacks, no Fortify. */
  ultMuted?: boolean;
  /** Pinned this turn (the Wild Hunt): no Fortify, and the Standard can't move. */
  ultPinned?: boolean;
}
/** A Character sworn in as Primus of a conquered Keep: its Passive works for the seat that holds the Keep. */
export interface PrimusSlot { card: string; seat: number }
/** A public call to arms by the strongest House: the first comers join its (public) alliance. */
export interface Rally { by: number; slots: number; turn: number }
/**
 * An attack paused while the defender decides whether to spring a REACTION card. `commit` is set for a Standard charge;
 * otherwise it's a normal attack with its dice and blitz. `at`: when the pause began (the attacker's clock waits).
 */
export interface Reaction { defender: number; deadline: number; from: number; to: number; commit?: number | null; dice?: number; blitz?: boolean; at?: number }
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
  /** By seat: Olympus's defenders each House killed (assaults and Relics), its own soldiers lost, and its assaults. */
  dmg?: number[];
  lost?: number[];
  hits?: number[];
}

/** The valley at the start of one turn, for the Proctors' Book: territories, armies and battles won by seat. */
export interface Snap { turn: number; seat: number; t: number[]; a: number[]; w: number[]; al: { m: number[]; pub: boolean }[] }
/** Battles won by seat (against other Houses only), and a snapshot per turn. */
export interface Stats { won: number[]; hist: Snap[] }
export const HIST_MAX = 400;

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
  /** Primus of each House's Keep, by House (missing on older wars). */
  primus?: (PrimusSlot | null)[];
  rally?: Rally | null;
  /** A seat that walked out of an alliance can't join one until this turn number. */
  allyBan?: number[];
  /** When each seat last emoted (ms). */
  lastEmote?: number[];
  /** When the current turn's timer runs out (ms since epoch), or null with no timer. */
  deadline?: number | null;
  /** Seats that skip their REACTION prompts until their own next turn (each seat only sees itself here). */
  reactHold?: number[];
  stats?: Stats;
  /** House Ultimates: the round counter, standings, cooldowns and every lasting effect. Only in wars that have them on. */
  ult?: UltState;
  handCounts: number[];
  deckCount: number;
  priv: Private | null;
  /**
   * What only this seat sees: its hand, its Primus options, and (`seen`, by seat) the hand of a House it has Revealed
   * with Blackout. That is the only way a hand leaves the server for anyone but its owner.
   */
  me?: { seat: number; hand: HandCard[]; passage: string[] | null; seen?: Record<number, HandCard[]> };
}

// ---------------------------------------------------------------------------
// House Ultimates: a comeback move for the Houses that are behind. From round 4, a House in the bottom half of the
// standings may spend 3 cards in its Draft (one from its birth House) to strike a rival or a whole public alliance.

/** Ultimates open in this round (a real round counter: +1 every time the turn order wraps). */
export const ULT_ROUND = 4;
/** After a cast, the caster's next this-many own turns have no Ultimate. */
export const ULT_COOLDOWN = 3;
/** An Ultimate costs this many cards, at least one of them from the caster's birth House. */
export const ULT_COST = 3;
/** With Ultimates on, leaving an alliance bars a House from every alliance for this many of its own turns. */
export const ULT_LOCKOUT = 2;
/** The numbers of the seven Ultimates. */
export const ULT = {
  /** Where's Sevro?: territories seized (half the armies die, rounded down; the rest join Mars). */
  marsPicks: 3,
  /** Stormfall: stacks in the quadrant are cut to this, and the target's next Draft is capped at it. */
  stormCut: 5,
  /** Rot: only stacks of this many or more decay. */
  rotMin: 5,
  /** Rot: share lost on cast, then at the target's next turns. Against an alliance, the first two only. Drafts are cut by the same shares. */
  rot: [0.3, 0.2, 0.1],
  /** Blackout on an alliance: each member's next Draft is cut by this share. */
  silenceCut: 0.6,
  /** The Tithe: share of the target's next two Drafts, vs one player and vs an alliance. */
  tithe: [0.5, 0.25],
  titheAlly: [0.3, 0.15],
  /** The Tithe: the most the caster gains in total. */
  titheCap: 100,
};

/**
 * A lasting effect of an Ultimate. Effects on a `target` tick at the start of that seat's turn; effects with a
 * `caster` and no `target` (and the Revealed hand) end at the start of the caster's next turn.
 * - skip: Blacked Out (the next turn is skipped). mute: Silenced. reveal: the caster reads the target's hand.
 * - tithe: Tithed (`waves` left to cut). titheGain: Harvest (the caster collects what wave `i` took).
 * - rot: stacks in `terrs` decay by `waves`. drain: the Drafts rot by `waves`. cap: Storm-bound (the next Draft is capped).
 * - flare: `targets` are Glared against the caster's party (and the caster is Radiant on the casting `turn`).
 * - hunt: `targets` are Hunted, and the caster's party has Long Strike. pin: Pinned on the next turn.
 * - seized, storm: map markers (`terrs` taken by Where's Sevro?; the quadrant `q` Stormfall struck).
 */
export interface UltEffect {
  kind: 'skip' | 'mute' | 'reveal' | 'tithe' | 'titheGain' | 'rot' | 'drain' | 'cap' | 'flare' | 'hunt' | 'pin' | 'seized' | 'storm';
  /** The cast that caused it (UltCastRec.id). */
  cast: number;
  target?: number;
  caster?: number;
  targets?: number[];
  waves?: number[];
  i?: number;
  terrs?: number[];
  turn?: number;
  q?: number;
}
/** One cast, with what it has cost its targets so far. */
export interface UltCastRec {
  id: number; caster: number; house: number; target: number; targets: number[]; alliance: boolean; turn: number; round: number;
  /** Armies destroyed (on cast and by Rot's ticks). */
  removed: number;
  /** Reinforcements denied (a skipped or cut Draft). */
  denied: number;
  /** Armies the caster gained (the Tithe's Harvest, the half of a seized stack that joined Mars). */
  gained: number;
  /** Turns skipped. */
  skipped: number;
  /** The Tithe: what each of its two waves took. */
  gain: number[];
  /** Mars: the territories seized. Jupiter: [the quadrant]. */
  picks?: number[];
}
export interface UltState {
  /** The round: 1 at the first turn, +1 every time the turn order wraps. */
  round: number;
  /** By seat: own turns still without an Ultimate after a cast (the current one included). */
  cd: number[];
  /** By seat: in the bottom half of the standings and off cooldown, as checked at the start of its last turn. */
  eligible: boolean[];
  /** By seat: battles won against other Houses, for the Win %. */
  pvp: number[];
  /** [territory, defender] pairs the current seat attacked this turn (a defender that still holds at the turn's end has won). */
  atk: number[];
  effects: UltEffect[];
  casts: UltCastRec[];
}
function newUlt(n: number): UltState {
  return { round: 1, cd: new Array(n).fill(0), eligible: new Array(n).fill(false), pvp: new Array(n).fill(0), atk: [], effects: [], casts: [] };
}

export type Action =
  | { type: 'choose'; card: string }
  | { type: 'place'; t: number; n: number }
  | { type: 'unplace'; t: number; n: number }
  | { type: 'undoDraft' }
  | { type: 'trade'; cards: string[] }
  /**
   * Cast your House's Ultimate on `target` (`alliance`: on every member of its public alliance), paying `cards`.
   * `picks`: Mars's territories to seize, or Jupiter's quadrant as picks[0].
   */
  | { type: 'ultimate'; target: number; alliance: boolean; cards: string[]; picks?: number[] }
  | { type: 'play'; card: string; t?: number; seat?: number }
  | { type: 'discardProctor'; card: string }
  | { type: 'endDraft' }
  | { type: 'attack'; from: number; to: number; dice?: number; blitz?: boolean; commit?: number }
  | { type: 'assault'; from: number; dice?: number; blitz?: boolean }
  /** Spring a REACTION card, or let the attack through (`hold`: and skip every prompt until your next turn). */
  | { type: 'react'; card: string | null; hold?: boolean }
  /** Skip REACTION prompts until your next turn (on), or take that back (off). Any time. */
  | { type: 'holdReactions'; on: boolean }
  | { type: 'timeout' }
  /** Anyone may call time on a turn whose timer has run out. */
  | { type: 'turnTimeout' }
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
  | { type: 'concede' }
  /** Swear a Character from your hand in as Primus of a Keep you conquered. */
  | { type: 'primus'; keep: number; card: string }
  | { type: 'leaveAlliance' }
  | { type: 'cancelInvite'; invite: number }
  | { type: 'openRally' }
  | { type: 'joinRally' }
  | { type: 'cancelRally' }
  | { type: 'emote'; line: number };

export interface Ctx { rng: () => number; now: number }
export type Result = { ok: true } | { ok: false; err: string };

class RuleError extends Error {}
function fail(msg: string): never { throw new RuleError(msg); }

let R: () => number = Math.random;
let NOW = 0;

// ---------------------------------------------------------------------------
// helpers

export const geo = (s: GameState): Geo => mapGeo(s.opts?.layout ?? layoutFor(s.players.length), s.opts?.seed, s.opts?.houses);

/** Wars saved before settings and replays existed get the old defaults. */
export function norm(s: GameState): GameState {
  if (!s.opts) s.opts = { layout: layoutFor(s.players.length), troops: 0, alliances: true, siege: true };
  if (!s.trail) s.trail = [];
  if (!s.primus) s.primus = HOUSES.map(() => null);
  if (s.rally === undefined) s.rally = null;
  if (!s.allyBan) s.allyBan = s.players.map(() => 0);
  if (!s.lastEmote) s.lastEmote = s.players.map(() => -1e15);
  if (!s.reactHold) s.reactHold = [];
  if (!s.stats) s.stats = { won: s.players.map(() => 0), hist: [] };
  return s;
}

/** Record the valley as it stands, for the Proctors' Book (at every turn start, and when the war ends). */
function snap(s: GameState, seat: number) {
  const st = (s.stats ??= { won: s.players.map(() => 0), hist: [] });
  const t = s.players.map(() => 0), a = s.players.map(() => 0);
  s.owner.forEach((o, i) => { if (o >= 0) { t[o]++; a[o] += s.armies[i]; } });
  st.hist.push({ turn: s.turn, seat, t, a, w: [...st.won], al: s.alliances.map((x) => ({ m: [...x.members], pub: x.public })) });
  if (st.hist.length > HIST_MAX) st.hist.splice(0, st.hist.length - HIST_MAX);
}
/** A battle between two Houses was won by `seat`. */
function wonBattle(s: GameState, seat: number) {
  const st = (s.stats ??= { won: s.players.map(() => 0), hist: [] });
  st.won[seat] = (st.won[seat] ?? 0) + 1;
}

export function shuffle<T>(a: T[], rng: () => number = R): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const d6 = () => 1 + Math.floor(R() * 6);

/** Every event logged since the last drainLog(), whole (the game state keeps only the last few dice of a battle). */
let FRESH: GameEvent[] = [];
/** The full events logged since the last call, for the server's permanent War Log. */
export function drainLog(): GameEvent[] {
  const out = FRESH;
  FRESH = [];
  return out;
}

function log(s: GameState, ev: Omit<GameEvent, 'id'>) {
  const full = { id: ++s.seq, ...ev } as GameEvent;
  FRESH.push(full);
  if (FRESH.length > 20000) FRESH.splice(0, FRESH.length - 20000);
  s.log.push(Array.isArray(full.rolls) && full.rolls.length > 4 ? { ...full, rolls: full.rolls.slice(-4) } : full);
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

/**
 * A single General's passive value for its owner: the printed value. In wars from before .008 (no `opts.pick`) a
 * General of the player's own House gets +1.
 */
export function generalPassive(s: GameState, seat: number, kind: PassiveKind): number {
  const p = s.players[seat];
  if (!p?.general) return 0;
  const c = CARD[p.general];
  if (!c?.passive || c.passive.kind !== kind) return 0;
  return c.passive.n + (!s.opts?.pick && c.house === p.house ? 1 : 0);
}
/** The Primuses of the Keeps `seat` holds: [House of the Keep, card]. */
export function primiOf(s: GameState, seat: number): { house: number; card: string }[] {
  return (s.primus ?? []).flatMap((p, h) => (p && p.seat === seat ? [{ house: h, card: p.card }] : []));
}
/** A seat's Primuses' Passive (no House-match bonus, never shared with allies). */
export function primusPassive(s: GameState, seat: number, kind: PassiveKind): number {
  return primiOf(s, seat).reduce((a, p) => { const c = CARD[p.card]; return a + (c?.passive?.kind === kind ? c.passive.n : 0); }, 0);
}
/** Passive value for a seat: its own General plus every ally's General (alliances share Passives), plus its own Primuses. */
export function passive(s: GameState, seat: number, kind: PassiveKind): number {
  if (seat < 0) return 0;
  return [seat, ...allies(s, seat)].reduce((a, x) => a + generalPassive(s, x, kind), 0) + primusPassive(s, seat, kind);
}
/** A General's Passive for a player of `playerHouse`. `printed`: a .008 war (`opts.pick`), with no House-match +1. */
export function passiveValue(card: CardDef, playerHouse: number, printed = false) {
  return card.passive ? card.passive.n + (!printed && card.house === playerHouse ? 1 : 0) : 0;
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
  if (huntsWith(s, seat)) for (let t = 0; t < g.nt; t++) if (!out.includes(t) && huntReach(s, seat, from, t)) out.push(t);
  if (s.ts.battle) {
    const [a, b] = s.ts.battle.key.split('>').map(Number);
    if (a === from && Number.isInteger(b) && !out.includes(b) && s.owner[b] !== seat) out.push(b);
  }
  return out;
}

/** Is `seat` in a Wild Hunt's party (the caster or one of its allies)? The whole party has Long Strike while the Hunt lasts. */
export const huntsWith = (s: GameState, seat: number) =>
  !!s.ult && s.ult.effects.some((e) => e.kind === 'hunt' && s.players[e.caster!].alive && (seat === e.caster || allied(s, seat, e.caster!)));
/** A Wild Hunt strike: 2 spaces away, on any target, as often as the party likes. It uses up no Long Strike card. */
const huntReach = (s: GameState, seat: number, from: number, to: number) =>
  geo(s).dist[from][to] === 2 && s.owner[to] !== seat && huntsWith(s, seat);
/** An attack from out of reach that spends a Long Strike: not touching, and not a Wild Hunt strike. */
const spendsLongStrike = (s: GameState, seat: number, from: number, to: number) => !geo(s).adj[from].includes(to) && !huntReach(s, seat, from, to);

/** Why `seat` can't attack `to` from `from` right now, or null if it can. */
export function attackBlocker(s: GameState, seat: number, from: number, to: number): string | null {
  const g = geo(s), T = g.territories;
  if (s.phase !== 'attack') return 'Not the attack phase.';
  if (s.ts.ultMuted && s.cur === seat) return 'Silenced by Blackout: no attacks this turn.';
  if (s.ts.mustMove) return 'Move your armies into the conquered territory first.';
  if (!(from >= 0 && from < g.nt && to >= 0 && to < g.nt)) return 'No such territory.';
  if (s.owner[from] !== seat) return `You do not hold ${T[from].name}.`;
  if (s.owner[to] === seat) return 'You cannot attack yourself, gorydamn idiot.';
  if (!attackTargets(s, seat, from).includes(to)) {
    if (T[from].quadrant !== T[to].quadrant) return `${T[to].name} is across the water from ${T[from].name}. Cross on a land bridge, or sail from a ⚓ port.`;
    return `${T[to].name} doesn't border ${T[from].name}. Only territories that touch it can be attacked.`;
  }
  if (s.armies[from] < 2) return `${T[from].name} has only 1 army. You need 2+ to attack, because one always stays behind.`;
  const h = standardAt(s, to);
  if (h >= 0 && s.owner[to] >= 0 && s.turn <= BALANCE.graceRounds * s.players.length) {
    return `${T[to].name} holds House ${HOUSES[h].name}'s Standard. The Proctors forbid strikes on a Standard during the first round.`;
  }
  return null;
}

/** The march from `from` to `to` through `seat`'s land (the shortest one). The column always arrives. */
export function fortifyRoute(s: GameState, seat: number, from: number, to: number): { path: number[]; stop: number } | null {
  const g = geo(s);
  if (!(from >= 0 && from < g.nt && to >= 0 && to < g.nt) || from === to || s.owner[from] !== seat || s.owner[to] !== seat) return null;
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === to) break;
    for (const n of g.adj[c]) if (s.owner[n] === seat && !prev.has(n)) { prev.set(n, c); q.push(n); }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return { path, stop: to };
}

/**
 * Terrain bonuses for a fight: the high ground (+1 to the attacker's lowest compared die) and forest cover (+1 to the
 * defender's lowest die). The wilds know their own ground: terrain never counts when the defender is neutral.
 * `to` of -1 is Olympus.
 */
export function terrainMods(s: GameState, from: number, to: number) {
  const T = geo(s).territories;
  if (to >= 0 && s.owner[to] === NEUTRAL) return { atk: 0, def: 0 };
  return {
    atk: from >= 0 && T[from].terrain === 'mountain' ? BALANCE.mountainAtk : 0,
    def: to >= 0 && T[to].terrain === 'forest' ? BALANCE.forestDef : 0,
  };
}

/** A neutral House's Keep: 10 behind its Walls (+1 on the highest die), 2 dice, and it never yields. */
export const isNeutralKeep = (s: GameState, t: number) => t >= 0 && s.owner[t] === NEUTRAL && geo(s).territories[t].isKeep;
/** Any other neutral garrison rolls a single die, and yields to twice its number. */
export const isWildGarrison = (s: GameState, t: number) => t >= 0 && s.owner[t] === NEUTRAL && !geo(s).territories[t].isKeep;
/** Would attacking `to` from `from` right now make the garrison yield without a fight? */
export function overwhelms(s: GameState, from: number, to: number) {
  return isWildGarrison(s, to) && s.armies[from] - 1 >= BALANCE.overwhelm * s.armies[to];
}
/** How many dice a defender may roll (before Break the Line). */
export const defenderDiceCap = (s: GameState, to: number) => (isWildGarrison(s, to) ? 1 : 2);

export function reinforcementBreakdown(s: GameState, seat: number) {
  const g = geo(s);
  const owned = territoriesOf(s, seat);
  const base = Math.max(3, Math.floor(owned.length / 3));
  const regions = g.regions.filter((r) => r.terr.every((t) => s.owner[t] === seat)).map((r) => ({ i: r.id, name: r.name, bonus: r.bonus }));
  const keeps = owned.filter((t) => g.territories[t].isKeep).length;
  const keepBonus = (keeps * (keeps + 3)) / 2;
  const general = passive(s, seat, 'draft') + passive(s, seat, 'perHouse') * housesOwned(s, seat).length;
  const total = base + regions.reduce((a, q) => a + q.bonus, 0) + keepBonus + general;
  return { territories: owned.length, base, regions, keeps, keepBonus, general, total };
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
 * Which slices of the valley get players: the sets whose Keeps are furthest apart (the largest smallest Keep-to-Keep
 * distance), then with the fewest pairs of slices that touch, picked at random among the ties. The first rounds are
 * spent taking neutral land rather than fighting each other.
 */
export function spreadSlices(g: Geo, n: number, rng: () => number = R): number[] {
  const keeps = HOUSES.map((_, sl) => g.keepOfSlice(sl));
  const touch = HOUSES.map(() => HOUSES.map(() => false));
  for (const t of g.territories) for (const x of g.adj[t.id]) {
    const u = g.territories[x];
    if (u.slice !== t.slice && t.port !== x) touch[t.slice][u.slice] = true;
  }
  const sets: { sl: number[]; far: number; close: number }[] = [];
  const walk = (from: number, sl: number[]) => {
    if (sl.length === n) {
      let far = Infinity, close = 0;
      for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) {
        far = Math.min(far, g.dist[keeps[sl[i]]][keeps[sl[j]]]);
        if (touch[sl[i]][sl[j]]) close++;
      }
      sets.push({ sl: [...sl], far, close });
      return;
    }
    for (let h = from; h < HOUSES.length; h++) walk(h + 1, [...sl, h]);
  };
  walk(0, []);
  const far = Math.max(...sets.map((x) => x.far));
  const close = Math.min(...sets.filter((x) => x.far === far).map((x) => x.close));
  const pool = sets.filter((x) => x.far === far && x.close === close);
  return pool[Math.floor(rng() * pool.length)].sl;
}

/**
 * Deal the Houses: the players' slices are spread out, each player gets the House they picked (`picks`, by seat;
 * null is Random) or a random one from those nobody picked, and the Houses nobody plays fill the other slices as
 * neutrals. A pick chooses the House, not the position: slices are still dealt at random. A pick that is not a House,
 * or that an earlier seat already holds, counts as Random. Returns the slice → House deal, each player's House, and
 * which seats got a House they picked.
 */
export function dealHouses(g: Geo, n: number, rng: () => number = R, picks: (number | null | undefined)[] = []): { sliceHouse: number[]; playerHouses: number[]; picked: boolean[] } {
  const slices = shuffle(spreadSlices(g, n, rng), rng);
  const playerHouses: number[] = new Array(n).fill(-1);
  const taken = new Set<number>();
  for (let i = 0; i < n; i++) {
    const h = picks[i];
    if (typeof h === 'number' && Number.isInteger(h) && h >= 0 && h < HOUSES.length && !taken.has(h)) { playerHouses[i] = h; taken.add(h); }
  }
  const picked = playerHouses.map((h) => h >= 0);
  const rest = shuffle(HOUSES.map((_, h) => h).filter((h) => !taken.has(h)), rng);
  for (let i = 0; i < n; i++) if (playerHouses[i] < 0) playerHouses[i] = rest.shift()!;
  const sliceHouse = new Array(HOUSES.length).fill(-1);
  slices.forEach((sl, i) => { sliceHouse[sl] = playerHouses[i]; });
  for (let sl = 0; sl < sliceHouse.length; sl++) if (sliceHouse[sl] < 0) sliceHouse[sl] = rest.shift()!;
  return { sliceHouse, playerHouses, picked };
}

/** A seat before the war, as far as the House pick goes: `house` null (or missing) is Random; `houseBy: 'host'` is a House the host set, locked for that player. */
export interface HouseSeat { house?: number | null; houseBy?: 'host' }
/**
 * The House pick rules, shared by the server's `setHouse` op and the local setup screen. Seat `seat` takes `house`
 * (null: back to Random). `byHost`: the host is setting another seat's House, which locks it for that player until the
 * host sets it back to Random. First come, first served: a House another seat holds is refused. Returns the new lobby
 * (the one passed in is not changed), or why not.
 */
export function pickHouse<T extends HouseSeat>(lobby: T[], seat: number, house: number | null, byHost: boolean): { ok: true; lobby: T[] } | { ok: false; err: string } {
  if (!Number.isInteger(seat) || seat < 0 || seat >= lobby.length) return { ok: false, err: 'No such seat.' };
  if (house !== null && !(Number.isInteger(house) && house >= 0 && house < HOUSES.length)) return { ok: false, err: 'No such House.' };
  const cur = lobby[seat];
  if (!byHost && cur.houseBy === 'host') return { ok: false, err: 'The host set your House. Ask them to set it back to Random.' };
  if (house !== null && lobby.some((l, i) => i !== seat && l.house === house)) return { ok: false, err: `House ${HOUSES[house].name} is taken.` };
  const next = { ...cur };
  delete next.houseBy;
  if (house === null) delete next.house;
  else { next.house = house; if (byHost) next.houseBy = 'host'; }
  return { ok: true, lobby: lobby.map((l, i) => (i === seat ? next : l)) };
}

export function createGame(names: string[], rng: () => number, opts: { ai?: boolean[]; settings?: Partial<WarSettings>; /** Each seat's House pick (null: Random). */ houses?: (number | null)[] } = {}): GameState {
  R = rng;
  const n = names.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  const o: GameOpts = { ...resolveSettings(n, opts.settings), seed: 1 + Math.floor(rng() * 2 ** 30), pick: true };
  const deal = dealHouses(mapGeo(o.layout, o.seed), n, rng, opts.houses);
  o.houses = deal.sliceHouse;
  const g = mapGeo(o.layout, o.seed, o.houses);
  const houses = deal.playerHouses;
  const players: Player[] = names.map((name, seat) => ({
    seat, name: name.slice(0, 24) || `Gold ${seat + 1}`, house: houses[seat], general: null, alive: true, dominatedBy: null, ai: opts.ai?.[seat] || undefined,
  }));

  // Choose your Primus: every player is offered the Characters of their own House. The deck starts with everything
  // else; the Characters nobody chose join it when the last player has chosen.
  const passage = players.map((p) => CHARACTER_IDS.filter((id) => CARD[id].house === p.house));
  const offered = new Set(passage.flat());
  const deck = shuffle(ALL_CARD_IDS.filter((id) => !offered.has(id)));

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
  // Every House nobody drew holds its Keep with exactly this many.
  for (let h = 0; h < HOUSES.length; h++) if (!playerHouses.has(h)) armies[g.keepOf(h)] = BALANCE.neutralKeep;

  const s: GameState = {
    v: 2, version: 0, opts: o, trail: [], phase: 'passage', players, order: shuffle(players.map((p) => p.seat)), cur: -1, turn: 0,
    owner, armies,
    standards: HOUSES.map((_, h) => ({ at: g.keepOf(h), captured: false, by: null, guard: playerHouses.has(h) ? BALANCE.stdGuard : 0 })),
    killed: [], ts: freshTurn(), reaction: null, winner: null, winners: [], log: [], seq: 0, uid: 0,
    warBegun: false, alliances: [], invites: [], vote: null, siege: null, siegeCooldown: 0,
    primus: HOUSES.map(() => null), rally: null, allyBan: players.map(() => 0), lastEmote: players.map(() => -1e15),
    reactHold: [], stats: { won: players.map(() => 0), hist: [] },
    handCounts: [], deckCount: 0,
    priv: { deck, discard: [], hands: players.map(() => []), passage },
  };
  s.cur = s.order[0];
  if (o.ultimates) s.ult = newUlt(n);
  for (const p of players) log(s, { k: 'sorted', seat: p.seat, house: p.house, picked: deal.picked[p.seat] });
  sync(s);
  return s;
}

/** Choose your Primus is over (.008 wars): the Characters nobody chose are shuffled into the deck. */
function returnUnchosen(s: GameState) {
  if (!s.opts.pick) return;
  const unchosen = s.players.flatMap((p) => CHARACTER_IDS.filter((id) => CARD[id].house === p.house && id !== p.general));
  s.priv!.deck = shuffle([...s.priv!.deck, ...unchosen]);
}

function freshTurn(): TurnState {
  return {
    reinforcements: 0, placed: {}, conquered: 0, fortifies: 0, stdMoved: false, stdRaised: false, warCry: false,
    buffs: { atk: 0, breakLine: 0, longStrike: 0, fortifyAll: false, fury: false, siegeWalls: 0, siegeAtk: 0 }, battle: null, mustMove: null,
    keepsTaken: [],
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
  // "Skip until my turn" runs out now.
  s.reactHold = (s.reactHold ?? []).filter((x) => x !== seat);
  // Your quiet invitations expire when your next turn comes around.
  for (const inv of s.invites.filter((i) => i.from === seat)) log(s, { k: 'inviteExpired', from: inv.from, to: inv.to, vis: [inv.from, inv.to] });
  s.invites = s.invites.filter((i) => i.from !== seat);
  // So does your Rally.
  if (s.rally?.by === seat) { log(s, { k: 'rallyClosed', by: seat, why: 'expired' }); s.rally = null; }
  if (s.siege?.members.includes(seat)) olympusTurn(s, seat);
  const st = s.standards[p.house];
  if (!st.captured) st.guard = BALANCE.stdGuard + passive(s, seat, 'stdGuard');
  const rb = reinforcementBreakdown(s, seat);
  s.ts.reinforcements = rb.total;
  // Ultimates in force on this seat tick now: Drafts are cut or fed, stacks rot, and a Blacked Out House loses the whole turn.
  const ult = s.ult ? ultStartTurn(s, seat) : null;
  if (ult?.skip) {
    s.ts.reinforcements = 0;
    s.deadline = null;
    snap(s, seat);
    log(s, { k: 'turn', seat, turn: s.turn, reinf: 0, extras: [], skipped: true });
    for (const ev of ult.ticks) log(s, ev);
    advance(s);
    return;
  }
  const extras: string[] = [];
  const kp = passive(s, seat, 'keep');
  if (kp && s.owner[g.keepOf(p.house)] === seat) { s.armies[g.keepOf(p.house)] += kp; extras.push(`+${kp} on Keep`); }
  const bp = passive(s, seat, 'border');
  if (bp) {
    const borders = territoriesOf(s, seat).filter((t) => g.adj[t].some((n) => s.owner[n] !== seat));
    if (borders.length) { const t = borders[Math.floor(R() * borders.length)]; s.armies[t] += bp; extras.push(`+${bp} on ${g.territories[t].name}`); }
  }
  s.deadline = s.opts.timer ? NOW + s.opts.timer * 1000 : null;
  snap(s, seat);
  log(s, { k: 'turn', seat, turn: s.turn, reinf: s.ts.reinforcements, extras });
  if (ult) for (const ev of ult.ticks) log(s, ev);
}

function advance(s: GameState) {
  if (s.phase === 'over') return;
  if (s.ult) ultEndTurn(s);
  const i = s.order.indexOf(s.cur);
  for (let k = 1; k <= s.order.length; k++) {
    const seat = s.order[(i + k) % s.order.length];
    if (s.players[seat].alive) {
      // The turn order wrapped: a new round.
      if (s.ult && i + k >= s.order.length) s.ult.round++;
      startTurn(s, seat);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// House Ultimates

/** Win % per seat (0 to 100; 0 for the fallen): 40% territory share, 40% army share and 20% PvP-win share among the living. */
export function winScores(s: GameState): number[] {
  const n = s.players.length;
  const t = new Array(n).fill(0), a = new Array(n).fill(0);
  s.owner.forEach((o, i) => { if (o >= 0) { t[o]++; a[o] += s.armies[i]; } });
  const live = s.players.filter((p) => p.alive).map((p) => p.seat);
  const T = live.reduce((x, p) => x + t[p], 0) || 1, A = live.reduce((x, p) => x + a[p], 0) || 1;
  const pv = s.ult?.pvp ?? new Array(n).fill(0);
  const W = live.reduce((x, p) => x + pv[p], 0);
  return s.players.map((p) => (!p.alive ? 0 : 100 * (0.4 * t[p.seat] / T + 0.4 * a[p.seat] / A + 0.2 * (W > 0 ? pv[p.seat] / W : 1 / live.length))));
}
/** The parties of the war: every alliance (its living members) and every living House outside one. On a seat's view, only the alliances that seat can see. */
export function partiesOf(s: GameState): number[][] {
  const out: number[][] = [];
  const seen = new Set<number>();
  for (const a of s.alliances) {
    const m = a.members.filter((x) => s.players[x].alive);
    if (!m.length) continue;
    m.forEach((x) => seen.add(x));
    out.push(m);
  }
  for (const p of s.players) if (p.alive && !seen.has(p.seat)) out.push([p.seat]);
  return out;
}
/**
 * The standings: every party with its Win % (its members' scores added), strongest first. The last
 * floor(parties / 2) are the bottom half: the parties that may cast.
 */
export function ultStandings(s: GameState): { members: number[]; score: number; bottom: boolean }[] {
  const w = winScores(s);
  const ps = partiesOf(s).map((m) => ({ members: m, score: m.reduce((x, y) => x + w[y], 0) }))
    .sort((a, b) => a.score - b.score || Math.min(...a.members) - Math.min(...b.members));
  const k = Math.floor(ps.length / 2);
  return ps.map((p, i) => ({ ...p, bottom: i < k })).reverse();
}
/** Seats in the bottom floor(parties / 2) parties by Win %. */
export function bottomHalfSeats(s: GameState): Set<number> {
  return new Set(ultStandings(s).filter((p) => p.bottom).flatMap((p) => p.members));
}

const ultCast = (s: GameState, id: number) => s.ult!.casts.find((c) => c.id === id)!;
/** An Ultimate's damage to a territory: never below 1 army, and never where a Standard stands. Returns the armies lost. */
function ultDamage(s: GameState, t: number, k: number): number {
  if (standardAt(s, t) >= 0) return 0;
  const d = Math.max(0, Math.min(k, s.armies[t] - 1));
  s.armies[t] -= d;
  return d;
}
/** Is a Solar Flare or a Wild Hunt on `def` in force against `att` (its caster, or one of the caster's allies)? */
const ultEffectOn = (s: GameState, kind: 'flare' | 'hunt', att: number, def: number) =>
  !!s.ult && def >= 0 && s.ult.effects.some((e) => e.kind === kind && e.targets!.includes(def) && s.players[e.caster!].alive && (att === e.caster || allied(s, att, e.caster!)));
/**
 * What the Ultimates in force change in a fight between `att` and whoever holds `to`: Glared (the defender's highest
 * die −1 against the Solar Flare's party), Radiant (+1 on the caster's highest attack die, on the casting turn only) and
 * Hunted (no honor guard, and no REACTION cards, against the Wild Hunt's party).
 */
export function ultFight(s: GameState, att: number, to: number): { glared: boolean; radiant: boolean; hunted: boolean } {
  const def = to >= 0 ? s.owner[to] : NEUTRAL;
  if (!s.ult || def < 0) return { glared: false, radiant: false, hunted: false };
  return {
    glared: ultEffectOn(s, 'flare', att, def),
    radiant: s.ult.effects.some((e) => e.kind === 'flare' && e.targets!.includes(def) && e.caster === att && e.turn === s.turn),
    hunted: ultEffectOn(s, 'hunt', att, def),
  };
}
/** The honor guard `att` has to cut through at `to`: none while its holder is Hunted by `att`'s party. */
export const guardAgainst = (s: GameState, att: number, to: number) => (ultFight(s, att, to).hunted ? 0 : guardAt(s, to));
/**
 * The dice of a normal attack by `seat` from `from` on `to`, with everything in force: card buffs, Passives, terrain,
 * the Walls and the Ultimates. `ambush`: a REACTION card was sprung on it.
 */
export function battleMods(s: GameState, seat: number, from: number, to: number, atkBuff: boolean, ambush = false): Mods {
  const am = attackMods(s, seat, from, to, atkBuff), dm = defenseMods(s, to, ambush ? 1 : 0), u = ultFight(s, seat, to);
  return { ...am, ...dm, atkHigh: am.atkHigh + (u.radiant ? 1 : 0), defHigh: dm.defHigh - (u.glared ? 1 : 0) };
}

/** The turn passes: a House that was attacked and still holds the ground has won a battle, and a turn of cooldown is served. */
function ultEndTurn(s: GameState) {
  const u = s.ult!;
  for (let i = 0; i < u.atk.length; i += 2) {
    const t = u.atk[i], def = u.atk[i + 1];
    if (s.players[def]?.alive && s.owner[t] === def) u.pvp[def]++;
  }
  u.atk = [];
  // The turn of the cast is not one of the cooldown's turns.
  const seat = s.cur;
  if (u.cd[seat] > 0 && !u.casts.some((c) => c.caster === seat && c.turn === s.turn)) u.cd[seat]--;
}
/** `def` was attacked at `to` this turn (counted once per territory). */
function noteAttacked(s: GameState, to: number, def: number) {
  if (!s.ult || def < 0) return;
  for (let i = 0; i < s.ult.atk.length; i += 2) if (s.ult.atk[i] === to) return;
  s.ult.atk.push(to, def);
}

/**
 * The start of `seat`'s turn. Every effect on it ticks (stacks rot; the Draft is cut, capped or fed), the Solar Flare,
 * Wild Hunt, Revealed hand and map markers it cast end, and its right to cast is checked. Returns whether the turn is
 * skipped (Blacked Out), and a log event for everything that ticked.
 */
function ultStartTurn(s: GameState, seat: number): { skip: boolean; ticks: Omit<GameEvent, 'id'>[] } {
  const u = s.ult!;
  const ticks: Omit<GameEvent, 'id'>[] = [];
  u.atk = [];
  u.effects = u.effects.filter((e) => !(e.caster === seat && ['flare', 'hunt', 'reveal', 'seized', 'storm'].includes(e.kind)));
  let skip: UltCastRec | null = null;
  const keep: UltEffect[] = [];
  const cutDraft = (n: number) => { const cut = Math.max(0, Math.min(n, s.ts.reinforcements)); s.ts.reinforcements -= cut; return cut; };
  for (const e of u.effects) {
    const c = ultCast(s, e.cast);
    const by = { cast: c.id, by: c.caster, house: c.house };
    if (e.kind === 'titheGain') {
      if (e.caster !== seat) { keep.push(e); continue; }
      // Harvest: what the Tithe took in this wave, up to the cap over both.
      const n = Math.max(0, Math.min(c.gain[e.i!] ?? 0, ULT.titheCap - c.gained));
      s.ts.reinforcements += n; c.gained += n;
      ticks.push({ k: 'ultTick', kind: 'harvest', seat, n, ...by });
      if (++e.i! < 2) keep.push(e);
      continue;
    }
    if (e.target !== seat) { keep.push(e); continue; }
    switch (e.kind) {
      case 'skip': skip = c; break;
      case 'mute': {
        const n = cutDraft(Math.floor(s.ts.reinforcements * ULT.silenceCut));
        c.denied += n; s.ts.ultMuted = true;
        ticks.push({ k: 'ultTick', kind: 'silenced', seat, n, ...by });
        break;
      }
      case 'tithe': {
        const n = cutDraft(Math.floor(s.ts.reinforcements * e.waves![e.i!]));
        c.denied += n; c.gain[e.i!] = (c.gain[e.i!] ?? 0) + n;
        ticks.push({ k: 'ultTick', kind: 'tithe', seat, n, ...by });
        if (++e.i! < e.waves!.length) keep.push(e);
        break;
      }
      case 'rot': {
        let n = 0, stacks = 0;
        for (const t of e.terrs!) if (s.owner[t] === seat && s.armies[t] >= ULT.rotMin) {
          const d = ultDamage(s, t, Math.floor(s.armies[t] * e.waves![e.i!]));
          if (d) { n += d; stacks++; }
        }
        c.removed += n;
        ticks.push({ k: 'ultTick', kind: 'rot', seat, n, stacks, ...by });
        if (++e.i! < e.waves!.length) keep.push(e);
        break;
      }
      case 'drain': {
        const n = cutDraft(Math.floor(s.ts.reinforcements * e.waves![e.i!]));
        c.denied += n;
        ticks.push({ k: 'ultTick', kind: 'rotDraft', seat, n, ...by });
        if (++e.i! < e.waves!.length) keep.push(e);
        break;
      }
      case 'cap': {
        const n = cutDraft(s.ts.reinforcements - ULT.stormCut);
        c.denied += n;
        ticks.push({ k: 'ultTick', kind: 'storm', seat, n, ...by });
        break;
      }
      case 'pin': s.ts.ultPinned = true; ticks.push({ k: 'ultTick', kind: 'pinned', seat, n: 0, ...by }); break;
      default: keep.push(e);
    }
  }
  u.effects = keep;
  if (skip) {
    // Blacked Out: whatever was left of the Draft is lost with the turn.
    skip.skipped++; skip.denied += s.ts.reinforcements;
    ticks.unshift({ k: 'ultTick', kind: 'blackout', seat, n: s.ts.reinforcements, cast: skip.id, by: skip.caster, house: skip.house });
  }
  u.eligible[seat] = u.round >= ULT_ROUND && u.cd[seat] === 0 && bottomHalfSeats(s).has(seat);
  return { skip: !!skip, ticks };
}

/** A House has fallen: what was on it is gone, and so is everything it cast that only lasts while it stands. */
function ultForget(s: GameState, seat: number) {
  const u = s.ult;
  if (!u) return;
  u.eligible[seat] = false;
  u.effects = u.effects.filter((e) => e.target !== seat && e.caster !== seat);
  for (const e of u.effects) if (e.targets && (e.kind === 'flare' || e.kind === 'hunt')) e.targets = e.targets.filter((x) => x !== seat);
  u.effects = u.effects.filter((e) => !((e.kind === 'flare' || e.kind === 'hunt') && !e.targets!.length));
}

/**
 * `seat` left an alliance (it walked out, answered a Rally, or attacked an ally). With Ultimates on, no alliance will
 * have it for 2 of its own turns. `vis`: who may know (the members of a secret alliance).
 */
function lockOut(s: GameState, seat: number, vis?: number[]) {
  if (!s.ult) return;
  s.allyBan![seat] = Math.max(s.allyBan![seat] ?? 0, s.turn + ULT_LOCKOUT * s.players.filter((p) => p.alive).length);
  log(s, { k: 'lockout', seat, turns: ULT_LOCKOUT, ...(vis ? { vis } : {}) });
}
/** How many of `seat`'s own turns its alliance lockout still covers (the current one included), or 0 when it is free. */
export function lockoutLeft(s: GameState, seat: number): number {
  const left = (s.allyBan?.[seat] ?? 0) - s.turn;
  return left <= 0 ? 0 : Math.ceil(left / Math.max(1, s.players.filter((p) => p.alive).length));
}

const handOf = (s: GameState, seat: number): HandCard[] => (s.priv ? s.priv.hands[seat] : s.me?.seat === seat ? s.me.hand : []);
/** Can `seat` pay for its Ultimate with these cards: 3 different unlocked cards from its hand, at least one from its birth House? */
export function ultCardsOk(s: GameState, seat: number, cards: string[]): boolean {
  const h = handOf(s, seat);
  if (!Array.isArray(cards) || cards.length !== ULT_COST || new Set(cards).size !== ULT_COST) return false;
  if (!cards.every((id) => h.some((c) => c.id === id && !c.locked))) return false;
  return cards.some((id) => CARD[id]?.house === s.players[seat].house);
}
/**
 * The cards `seat` would best pay with: one card of its birth House, and the two others it will miss least (a Proctor
 * it can't use, a Relic outside a siege, then any card, with REACTION cards and further birth-House cards last).
 * Null when it can't pay.
 */
export function ultCards(s: GameState, seat: number): string[] | null {
  const house = s.players[seat].house;
  const sieging = !!s.siege?.members.includes(seat);
  const cost = (id: string) => {
    const c = CARD[id];
    if (c.kind === 'proctor' && !ownsHouse(s, seat, c.house)) return 0;
    if (isSiegeCard(c) && !sieging) return 1;
    return c.active.kind === 'counter' ? 3 : 2;
  };
  const h = handOf(s, seat).filter((c) => !c.locked).map((c) => c.id);
  const birth = h.filter((id) => CARD[id].house === house).sort((a, b) => cost(a) - cost(b))[0];
  if (birth == null || h.length < ULT_COST) return null;
  const rest = h.filter((id) => id !== birth).sort((a, b) => cost(a) + (CARD[a].house === house ? 2 : 0) - cost(b) - (CARD[b].house === house ? 2 : 0));
  return [birth, ...rest.slice(0, ULT_COST - 1)];
}

/** Why a House can't cast: `code` for the UI's button, `msg` for the player, `n` where a number belongs (the round, the turns left). */
export interface UltBlock { code: 'off' | 'dead' | 'round' | 'cooldown' | 'turn' | 'silenced' | 'top' | 'phase' | 'cards'; msg: string; n?: number }
/**
 * Why `seat` can't cast its Ultimate right now, or null if it can. In order: the round, the cooldown, whose turn it is,
 * Blackout, the standing (bottom half only), the phase (the Draft), and the cards.
 */
export function ultBlocker(s: GameState, seat: number): UltBlock | null {
  const u = s.ult, p = s.players[seat];
  if (!u) return { code: 'off', msg: 'House Ultimates are off in this war.' };
  if (!p?.alive) return { code: 'dead', msg: 'The fallen cast nothing.' };
  if (u.round < ULT_ROUND) return { code: 'round', msg: `House Ultimates open in round ${ULT_ROUND}.`, n: ULT_ROUND };
  if (u.cd[seat] > 0) return { code: 'cooldown', msg: `Your Ultimate is recharging: ${u.cd[seat]} more of your turns.`, n: u.cd[seat] };
  if (s.cur !== seat || s.phase === 'passage' || s.phase === 'over') return { code: 'turn', msg: 'An Ultimate is cast in your own Draft.' };
  if (s.ts.ultMuted) return { code: 'silenced', msg: 'Silenced by Blackout: no cards this turn.' };
  if (!u.eligible[seat]) return { code: 'top', msg: 'Only Houses in the bottom half of the standings may cast an Ultimate.' };
  if (s.phase !== 'draft') return { code: 'phase', msg: 'An Ultimate is cast during your Draft.' };
  if (!ultCards(s, seat)) return { code: 'cards', msg: `An Ultimate costs ${ULT_COST} unlocked cards, at least 1 from House ${HOUSES[p.house].name}.` };
  return null;
}

/**
 * The Houses an Ultimate on `target` strikes: the target alone, or with `alliance` every living member of its public
 * alliance (null if it has none: a secret ally is a separate House).
 */
export function ultTargets(s: GameState, target: number, alliance: boolean): number[] | null {
  if (!alliance) return [target];
  const al = allianceOf(s, target);
  return al?.public ? al.members.filter((m) => s.players[m].alive) : null;
}
/** Why Where's Sevro? can't seize `t` for `seat` against `targets`, or null if it can. */
export function marsPickBlocker(s: GameState, seat: number, targets: number[], t: number): string | null {
  const g = geo(s), T = g.territories;
  if (!(Number.isInteger(t) && t >= 0 && t < g.nt)) return 'No such territory.';
  const o = s.owner[t], std = standardAt(s, t) >= 0;
  if (o === seat) return 'You already hold it.';
  if (o !== NEUTRAL && !targets.includes(o)) return `${T[t].name} belongs to another House. Seize land of your target, or of the neutrals.`;
  if (T[t].isKeep) return std ? 'A Keep, and it holds a Standard.' : 'A Keep is never seized.';
  if (std) return 'It holds a Standard.';
  if (!s.owner.some((x, i) => x === seat && T[i].quadrant === T[t].quadrant)) return `Across the water: Mars holds no land in ${QUADRANTS[T[t].quadrant]?.name ?? 'that quadrant'}.`;
  return null;
}
/**
 * The territories Where's Sevro? may seize for `seat` against `targets`: land of a target or of the neutrals, in a
 * quadrant where Mars holds land, never a Keep and never under a Standard.
 */
export function marsTargets(s: GameState, seat: number, targets: number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < s.owner.length; t++) if (!marsPickBlocker(s, seat, targets, t)) out.push(t);
  return out;
}
/** Who Stormfall on `target` strikes: the target, and with it every living member of its public alliance. */
export function stormSide(s: GameState, target: number): number[] {
  return ultTargets(s, target, true) ?? [target];
}
/** What Stormfall on `target` would cut in quadrant `q`: the territories above the limit (never one under a Standard), and the armies lost. */
export function stormCut(s: GameState, target: number, q: number): { terrs: number[]; cut: number } {
  const T = geo(s).territories, side = stormSide(s, target);
  const terrs = T.filter((t) => t.quadrant === q && side.includes(s.owner[t.id]) && standardAt(s, t.id) < 0 && s.armies[t.id] > ULT.stormCut).map((t) => t.id);
  return { terrs, cut: terrs.reduce((a, t) => a + s.armies[t] - ULT.stormCut, 0) };
}

function castUlt(s: GameState, seat: number, a: Extract<Action, { type: 'ultimate' }>) {
  const blocked = ultBlocker(s, seat);
  if (blocked && blocked.code !== 'cards') fail(blocked.msg);
  const u = s.ult!;
  const house = s.players[seat].house, hid = HOUSES[house].id;
  if (!ultCardsOk(s, seat, a.cards)) fail(`An Ultimate costs ${ULT_COST} unlocked cards, at least 1 from House ${HOUSES[house].name}.`);
  if (!Number.isInteger(a.target) || !s.players[a.target]?.alive || a.target === seat || allied(s, seat, a.target)) fail('Pick a living rival. An Ultimate never strikes an ally.');
  let targets = ultTargets(s, a.target, !!a.alliance)!;
  if (!targets) fail('They are not in a public alliance. Strike them alone.');
  let ally = !!a.alliance;
  // Mars picks its territories and Jupiter its quadrant: checked before any card is spent.
  let picks: number[] | undefined;
  if (hid === 'mars') {
    const valid = marsTargets(s, seat, targets);
    const want = Math.min(ULT.marsPicks, valid.length);
    if (!want) fail('Nothing to seize: none of their land (or the neutrals\') lies in a quadrant where Mars holds land, outside Keeps and Standards.');
    // Left to itself: the largest stacks, the target's before the neutrals'.
    picks = a.picks ? [...a.picks] : [...valid].sort((x, y) => (s.owner[x] < 0 ? 1 : 0) - (s.owner[y] < 0 ? 1 : 0) || s.armies[y] - s.armies[x] || x - y).slice(0, want);
    if (new Set(picks).size !== picks.length) fail('Pick different territories.');
    for (const t of picks) { const why = marsPickBlocker(s, seat, targets, t); if (why) fail(why); }
    if (picks.length !== want) fail(`Pick ${want} territor${want === 1 ? 'y' : 'ies'} to seize.`);
  } else if (hid === 'jupiter') {
    const qs = QUADRANTS.map((_, q) => q);
    const q = a.picks ? a.picks[0] : qs.reduce((b, x) => (stormCut(s, a.target, x).cut > stormCut(s, a.target, b).cut ? x : b), 0);
    if (!qs.includes(q)) fail('Pick one of the four quadrants.');
    picks = [q];
    // The storm spreads to the target's public allies by itself; only the targeted House's Draft is capped.
    targets = stormSide(s, a.target);
    ally = targets.length > 1;
  }
  for (const id of a.cards) takeFromHand(s, seat, id);
  u.cd[seat] = ULT_COOLDOWN;
  u.eligible[seat] = false;
  const c: UltCastRec = { id: u.casts.length + 1, caster: seat, house, target: a.target, targets, alliance: ally, turn: s.turn, round: u.round, removed: 0, denied: 0, gained: 0, skipped: 0, gain: [0, 0] };
  if (picks) c.picks = picks;
  u.casts.push(c);
  const after: Omit<GameEvent, 'id'>[] = [];
  let hits = 0;
  /** Stormfall and Rot: what each territory lost on the cast, as [territory, armies] pairs, for the announcement. */
  const cut: number[] = [];
  switch (hid) {
    case 'mars':
      // Where's Sevro?: half of each stack dies (rounded down), and the rest join Mars with the land.
      for (const t of picks!) {
        const k = s.armies[t], dead = Math.floor(k / 2), from = s.owner[t];
        s.owner[t] = seat; s.armies[t] = Math.max(1, k - dead);
        c.removed += dead; c.gained += k - dead; hits++;
        after.push({ k: 'seized', seat, t, from, dead, joined: k - dead, cast: c.id });
      }
      u.effects.push({ kind: 'seized', cast: c.id, caster: seat, terrs: [...picks!] });
      break;
    case 'jupiter': {
      // Stormfall: every stack of theirs in the quadrant is cut to 5, and the target's next Draft is capped at 5.
      const hit = stormCut(s, a.target, picks![0]);
      for (const t of hit.terrs) { cut.push(t, s.armies[t] - ULT.stormCut); s.armies[t] = ULT.stormCut; }
      c.removed += hit.cut; hits = hit.terrs.length;
      u.effects.push({ kind: 'cap', cast: c.id, target: a.target });
      u.effects.push({ kind: 'storm', cast: c.id, caster: seat, q: picks![0], targets: [...targets], terrs: hit.terrs });
      break;
    }
    case 'pluto':
      // Rot: stacks of 5+ lose 30% now, then 20% and 10% at the target's next turns, and its Drafts rot by the same shares.
      // Against an alliance: the first two ticks only.
      for (const m of targets) {
        const terrs = territoriesOf(s, m).filter((t) => s.armies[t] >= ULT.rotMin && standardAt(s, t) < 0);
        for (const t of terrs) { const d = ultDamage(s, t, Math.floor(s.armies[t] * ULT.rot[0])); c.removed += d; if (d) cut.push(t, d); }
        hits += terrs.length;
        if (terrs.length) u.effects.push({ kind: 'rot', cast: c.id, target: m, terrs, waves: ally ? ULT.rot.slice(1, 2) : ULT.rot.slice(1), i: 0 });
        u.effects.push({ kind: 'drain', cast: c.id, target: m, waves: ally ? ULT.rot.slice(0, 2) : [...ULT.rot], i: 0 });
      }
      break;
    case 'minerva':
      // Blackout: one player loses the next turn and shows its hand; an alliance is Silenced.
      for (const m of targets) u.effects.push({ kind: ally ? 'mute' : 'skip', cast: c.id, target: m });
      if (!ally) u.effects.push({ kind: 'reveal', cast: c.id, caster: seat, target: a.target });
      break;
    case 'ceres':
      // The Tithe: their next two Drafts are cut, and the caster's next two collect what was taken.
      for (const m of targets) u.effects.push({ kind: 'tithe', cast: c.id, target: m, waves: ally ? [...ULT.titheAlly] : [...ULT.tithe], i: 0 });
      u.effects.push({ kind: 'titheGain', cast: c.id, caster: seat, i: 0 });
      break;
    case 'apollo':
      // Solar Flare: Glared against the caster's party until the caster's next turn; the caster is Radiant this turn.
      u.effects.push({ kind: 'flare', cast: c.id, caster: seat, targets: [...targets], turn: s.turn });
      break;
    case 'diana':
      // The Wild Hunt: Hunted until the caster's next turn (the party has Long Strike), and Pinned on their next turn.
      u.effects.push({ kind: 'hunt', cast: c.id, caster: seat, targets: [...targets], turn: s.turn });
      for (const m of targets) u.effects.push({ kind: 'pin', cast: c.id, target: m });
      break;
  }
  log(s, { k: 'ultimate', seat, house, cast: c.id, target: a.target, targets: [...targets], alliance: ally, cards: [...a.cards], round: u.round, removed: c.removed, gained: c.gained, hits, ...(picks ? { picks: [...picks] } : {}), ...(cut.length ? { cut } : {}) });
  for (const ev of after) log(s, ev);
}

// ---------------------------------------------------------------------------
// combat

/**
 * Dice modifiers. High: the highest die. atkLow: the lowest attack die that gets compared (index min(aDice, dDice) − 1).
 * defLow: the lowest defense die. All: every die. Dice are sorted high to low first, modified, then compared in
 * that order (no re-sort).
 */
export interface Mods { atkHigh: number; atkLow: number; atkAll: number; defHigh: number; defLow: number; defAll: number }
export function modifyDice(a: number[], d: number[], m: Mods) {
  a[0] += m.atkHigh; d[0] += m.defHigh;
  a[Math.min(a.length, d.length) - 1] += m.atkLow;
  d[d.length - 1] += m.defLow;
  for (let i = 0; i < a.length; i++) a[i] += m.atkAll;
  for (let i = 0; i < d.length; i++) d[i] += m.defAll;
}
function roll(aDice: number, dDice: number, m: Mods) {
  const a = Array.from({ length: aDice }, d6).sort((x, y) => y - x);
  const d = Array.from({ length: dDice }, d6).sort((x, y) => y - x);
  const raw = { a: [...a], d: [...d] };
  modifyDice(a, d, m);
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

/**
 * The defender's side of the dice. Every Keep has Walls (+1 on the highest die, for a House or a neutral garrison), and
 * a House's Keep adds its Passives on top (defKeep, on the same die). Forests give their cover on the lowest die, never
 * to neutrals.
 */
export function defenseMods(s: GameState, to: number, extraAll = 0): { defHigh: number; defLow: number; defAll: number } {
  const def = s.owner[to];
  const keep = geo(s).territories[to].isKeep;
  return {
    defHigh: keep ? BALANCE.keepWall + (def >= 0 ? passive(s, def, 'defKeep') : 0) : 0,
    defLow: terrainMods(s, -1, to).def,
    defAll: extraAll,
  };
}

/** The attacker's side of the dice in a normal attack (the battle's card buffs, Passives vs neutrals, the high ground). */
export function attackMods(s: GameState, seat: number, from: number, to: number, atkBuff: boolean): { atkHigh: number; atkLow: number; atkAll: number } {
  return {
    atkHigh: (atkBuff ? 1 : 0) + (s.owner[to] === NEUTRAL ? passive(s, seat, 'atkNeutral') : 0),
    atkLow: terrainMods(s, from, to).atk,
    atkAll: s.ts.buffs.fury ? 1 : 0,
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
    lockOut(s, seat);
    if (s.vote?.alliance === a.id) s.vote = null;
    if (s.siege?.alliance === a.id) { const t = siegeTally(s.siege); s.siege = null; log(s, { k: 'siegeCollapsed', seat, ...t }); }
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
  // A neutral House's Standard gives its captor the House (its Proctor, its card bonuses). Its other land stays neutral.
  if (victim) dominate(s, victim.seat, captor);
}

/** Take `seat` out of its alliance (it died, walked out, or answered a Rally). `leaver` logs a walk-out. */
function leaveAlliance(s: GameState, seat: number, leaver = false) {
  s.invites = s.invites.filter((i) => i.from !== seat && i.to !== seat);
  const a = allianceOf(s, seat);
  if (!a) return;
  const before = [...a.members];
  a.members = a.members.filter((m) => m !== seat);
  const dissolved = a.members.length < 2;
  if (dissolved) s.alliances = s.alliances.filter((x) => x !== a);
  if (dissolved || leaver) log(s, { k: 'allianceEnds', members: before, ...(leaver ? { leaver: seat } : {}), dissolved, vis: a.public ? undefined : before });
  if (s.vote && !s.alliances.some((x) => x.id === s.vote!.alliance)) s.vote = null;
  if (s.siege) {
    s.siege.members = s.siege.members.filter((m) => m !== seat);
    if (!s.alliances.some((x) => x.id === s.siege!.alliance)) { const t = siegeTally(s.siege!); s.siege = null; log(s, { k: 'siegeCollapsed', seat, ...t }); }
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
  ultForget(s, victim);
  if (s.rally?.by === victim) { log(s, { k: 'rallyClosed', by: victim, why: 'fallen' }); s.rally = null; }
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
    snap(s, -1);
    log(s, { k: 'win', seat: s.winner });
  }
}

/** A Keep changed hands this turn: its new holder may swear in a Primus on the spot. */
function noteKeep(s: GameState, to: number) {
  if (!geo(s).territories[to].isKeep) return;
  (s.ts.keepsTaken ??= []).push(to);
}

function conquer(s: GameState, seat: number, from: number, to: number, minMove: number) {
  const prev = s.owner[to];
  s.owner[to] = seat;
  s.armies[to] = 0;
  s.ts.conquered++;
  noteKeep(s, to);
  const bonus = s.ts.conquered === 1 ? passive(s, seat, 'conquest') : 0;
  s.armies[to] += bonus;
  log(s, { k: 'conquer', seat, from, to, prev, bonus });
  // Taking a House's territory is a battle won, for the Win %.
  if (s.ult && prev >= 0 && prev !== seat) s.ult.pvp[seat]++;
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
  const reach = spendsLongStrike(s, seat, from, to);
  // A small neutral garrison facing twice its number lays down its arms: no dice, no losses.
  if (overwhelms(s, from, to)) {
    if (reach && s.ts.battle?.key !== `${from}>${to}`) s.ts.buffs.longStrike--;
    const n = s.armies[from] - 1, garrison = s.armies[to];
    log(s, { k: 'overwhelm', seat, from, to, n, garrison });
    conquer(s, seat, from, to, Math.max(1, Math.min(3, a.dice ?? 3, n)));
    return;
  }
  const def = s.owner[to];
  // A rival holding a REACTION card may spring it before the first die of a new battle.
  // (Not a House Hunted by the attacker's party: it springs nothing against the hunters.)
  if (def >= 0 && s.ts.battle?.key !== `${from}>${to}` && mayReact(s, def) && !ultFight(s, seat, to).hunted) {
    s.reaction = { defender: def, deadline: NOW + REACTION_MS, from, to, commit: null, dice: a.dice, blitz: !!a.blitz, at: NOW };
    log(s, { k: 'ambushWait', seat, def, from, to });
    return;
  }
  fight(s, seat, from, to, a.dice, !!a.blitz, null);
}

const modList = (m: Mods) => [m.atkHigh, m.atkLow, m.atkAll, m.defHigh, m.defLow, m.defAll];

/** A normal battle (one roll, or a blitz). `counter`: the REACTION card the defender springs on it. */
function fight(s: GameState, seat: number, from: number, to: number, diceWanted: number | undefined, blitz: boolean, counter: string | null) {
  const battle = startBattle(s, `${from}>${to}`, spendsLongStrike(s, seat, from, to));
  const def = s.owner[to];
  if (counter && def >= 0) {
    const c = takeFromHand(s, def, counter);
    const n = activeValue(s, def, c);
    battle.ph = (battle.ph ?? 0) + n;
    battle.amb = true;
    log(s, { k: 'counter', seat: def, card: c.id, n, vs: seat, from, to });
  }
  const tm = terrainMods(s, from, to);
  // Ultimates in force between the two: Glared and Radiant change the dice, and a Hunted House fights without its honor guard.
  const uf = ultFight(s, seat, to);
  const gAt = (t: number) => (uf.hunted ? 0 : guardAt(s, t));
  const ultNote = { ...(uf.glared ? { glared: true } : {}), ...(uf.radiant ? { radiant: true } : {}), ...(uf.hunted ? { hunted: true } : {}) };
  noteAttacked(s, to, def);
  const mods = (): Mods => battleMods(s, seat, from, to, battle.atk, !!battle.amb);
  // Where the battle started, for anyone who wants to check the math afterwards.
  const start = { a0: s.armies[from], d0: s.armies[to], g0: gAt(to), ph0: battle.ph ?? 0, m: modList(mods()), ...ultNote };
  const rolls: any[] = [];
  let aLost = 0, dLost = 0;
  do {
    const dice = Math.max(1, Math.min(3, diceWanted ?? 3, s.armies[from] - 1));
    const dUnits = s.armies[to] + gAt(to) + (battle.ph ?? 0);
    const dDice = battle.breakLine ? 1 : Math.min(defenderDiceCap(s, to), dUnits);
    const r = roll(dice, dDice, mods());
    s.armies[from] -= r.aLoss;
    // The real soldiers fall first, then the honor guard, then any ambushers.
    let dl = r.dLoss;
    const realLoss = Math.min(dl, s.armies[to]);
    s.armies[to] -= realLoss; dl -= realLoss;
    const h = standardAt(s, to);
    if (dl > 0 && h >= 0 && !uf.hunted) { const gl = Math.min(dl, s.standards[h].guard); s.standards[h].guard -= gl; dl -= gl; }
    if (dl > 0 && battle.ph) battle.ph = Math.max(0, battle.ph - dl);
    aLost += r.aLoss; dLost += r.dLoss;
    rolls.push({ a: r.a, d: r.d, raw: r.raw, aLoss: r.aLoss, dLoss: r.dLoss });
    if (s.armies[to] === 0 && gAt(to) === 0 && !battle.ph) {
      if (def >= 0) wonBattle(s, seat);
      log(s, { k: 'battle', seat, def, from, to, rolls, n: rolls.length, aLost, dLost, won: true, blitz, tA: tm.atk, tD: tm.def, ...start });
      conquer(s, seat, from, to, dice);
      return;
    }
  } while (blitz && s.armies[from] >= 2);
  // A blitz that runs dry against another House is a battle that House won.
  if (def >= 0 && blitz) wonBattle(s, def);
  log(s, { k: 'battle', seat, def, from, to, rolls, n: rolls.length, aLost, dLost, won: false, blitz, tA: tm.atk, tD: tm.def, ...start });
}

/** A REACTION card `seat` may spring (a Proctor only answers to the owner of its House). */
const springable = (s: GameState, seat: number, c: HandCard) =>
  !c.locked && CARD[c.id].active.kind === 'counter' && (CARD[c.id].kind !== 'proctor' || ownsHouse(s, seat, CARD[c.id].house));
const counterCards = (s: GameState, seat: number) => hand(s, seat).filter((c) => springable(s, seat, c));
/** The REACTION cards `seat` could spring right now (works on the full state or on that seat's own view). */
export function reactionCards(s: GameState, seat: number): string[] {
  const h = s.priv ? s.priv.hands[seat] : s.me?.seat === seat ? s.me.hand : [];
  return h.filter((c) => springable(s, seat, c)).map((c) => c.id);
}
/** Would `seat` be asked to spring a REACTION card right now (it holds one, and isn't skipping until its turn)? */
function mayReact(s: GameState, seat: number) {
  return counterCards(s, seat).length > 0 && !(s.reactHold ?? []).includes(seat);
}

/** The defender has answered (or the clock ran out): the paused attack goes ahead, with `counter` if they sprang one. */
function resolveReaction(s: GameState, counter: string | null) {
  const r = s.reaction!;
  s.reaction = null;
  // The attacker's turn clock stood still while the defender decided.
  if (s.deadline && r.at != null) s.deadline += Math.max(0, NOW - r.at);
  if (r.commit != null) resolveStandard(s, s.cur, r.from, r.to, r.commit, counter);
  else fight(s, s.cur, r.from, r.to, r.dice, !!r.blitz, counter);
}

function standardAttack(s: GameState, seat: number, from: number, to: number, commit: number) {
  const h = s.players[seat].house;
  if (standardAt(s, from) !== h) fail('Your Standard is not in that territory.');
  if (s.ts.stdRaised) fail('You already raised the Standard this turn. It can be raised once per turn.');
  if (!Number.isInteger(commit) || commit < 1 || commit > s.armies[from] - 1) fail('Commit between 1 and all-but-one of your armies.');
  const def = s.owner[to];
  s.ts.stdRaised = true;
  onHostility(s, seat, def);
  if (def >= 0 && mayReact(s, def) && !ultFight(s, seat, to).hunted) {
    s.reaction = { defender: def, deadline: NOW + REACTION_MS, from, to, commit, at: NOW };
    log(s, { k: 'stdRaised', seat, from, to, commit, def, pending: true });
    return;
  }
  log(s, { k: 'stdRaised', seat, from, to, commit, def, pending: false });
  resolveStandard(s, seat, from, to, commit, null);
}

function resolveStandard(s: GameState, seat: number, from: number, to: number, commit: number, counter: string | null) {
  s.reaction = null;
  const me = s.players[seat];
  const battle = startBattle(s, `${from}>${to}`, spendsLongStrike(s, seat, from, to));
  const def = s.owner[to];
  const uf = ultFight(s, seat, to);
  const ultNote = { ...(uf.glared ? { glared: true } : {}), ...(uf.radiant ? { radiant: true } : {}), ...(uf.hunted ? { hunted: true } : {}) };
  noteAttacked(s, to, def);
  s.armies[from] -= commit;
  let aReal = commit, aPh = STD_PHANTOMS;
  let dReal = s.armies[to], dPh = uf.hunted ? 0 : guardAt(s, to);
  let defAll = 0;
  if (counter && def >= 0) {
    const c = takeFromHand(s, def, counter);
    const n = activeValue(s, def, c);
    dPh += n; defAll = 1;
    log(s, { k: 'counter', seat: def, card: c.id, n, vs: seat, from, to, std: true });
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
  const am = attackMods(s, seat, from, to, battle.atk || wcAtk);
  const m: Mods = {
    ...am,
    atkHigh: am.atkHigh + passive(s, seat, 'atkStd') + (uf.radiant ? 1 : 0),
    atkAll: s.ts.buffs.fury || wcFury ? 1 : 0,
    ...defenseMods(s, to, defAll),
  };
  if (uf.glared) m.defHigh -= 1;
  const start = { a0: aReal, aPh0: aPh, d0: dReal, dPh0: dPh, m: modList(m), ...ultNote };
  const rolls: any[] = [];
  const stdH = standardAt(s, to);
  const cap = defenderDiceCap(s, to);
  let guard = 0;
  while (aReal + aPh > 0 && dReal + dPh > 0 && guard++ < 500) {
    const aDice = Math.min(3, aReal + aPh);
    const dDice = battle.breakLine || wcBreak ? 1 : Math.min(cap, dReal + dPh);
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
    noteKeep(s, to);
    if (s.ts.conquered === 1) s.armies[to] += passive(s, seat, 'conquest');
    if (def >= 0) wonBattle(s, seat);
    if (s.ult && def >= 0) s.ult.pvp[seat]++;
    log(s, { k: 'stdBattle', seat, def, from, to, rolls, n: rolls.length, won: true, enslaved, survivors: aReal, aLost: commit - aReal, dLost: dStart, commit, ...start });
    if (stdH >= 0 && stdH !== me.house) captureStandard(s, stdH, seat);
  } else {
    s.armies[to] = Math.max(1, dReal);
    if (def >= 0) wonBattle(s, def);
    log(s, { k: 'stdBattle', seat, def, from, to, rolls, n: rolls.length, won: false, aLost: commit, dLost: dStart - dReal, commit, ...start });
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
  if (banned(s, seat)) return banMsg(s);
  // Only a *public* rival alliance blocks the offer, so the error never gives away a secret pact.
  // (If the target turns out to be secretly sworn elsewhere, they simply can't accept.)
  if (allianceOf(s, to)?.public) return 'They are sworn to another alliance.';
  if (s.invites.some((i) => (i.from === seat && i.to === to) || (i.from === to && i.to === seat))) return 'A message is already on its way between you.';
  if (s.invites.filter((i) => i.from === seat).length >= MAX_INVITES) return `You can have at most ${MAX_INVITES} invitations out at once.`;
  if (s.siege) return 'The valley is at war with Olympus.';
  return null;
}

/**
 * A seat that walked out of an alliance sits out a full round before it can join another. With Ultimates on, leaving
 * one in any way (walking out, answering a Rally, attacking an ally) locks it out for 2 of its own turns.
 */
const banned = (s: GameState, seat: number) => (s.allyBan?.[seat] ?? 0) > s.turn;
const banMsg = (s: GameState) => (s.ult ? `You left an alliance. No one will have you for ${ULT_LOCKOUT} of your turns.` : 'You walked out of an alliance. No one will have you for a round.');

/** One alliance per House: the invitee joins the inviter's alliance (or they found one together). */
function joinAlliance(s: GameState, inv: Invite) {
  const A = allianceOf(s, inv.from);
  let al: Alliance;
  if (A) { A.members.push(inv.to); al = A; }
  else { al = { id: ++s.uid, members: [inv.from, inv.to], public: inv.public, since: s.turn }; s.alliances.push(al); }
  // Pending invites that can no longer be honoured are withdrawn.
  s.invites = s.invites.filter((i) => !allied(s, i.from, i.to));
  log(s, { k: 'allianceFormed', members: [...al.members], joined: inv.to, by: inv.from, pub: al.public, quip: Math.floor(R() * 1000), vis: al.public ? undefined : [...al.members] });
}

/** Total armies per seat. */
export const armyTotal = (s: GameState, seat: number) => s.owner.reduce((a, o, t) => (o === seat ? a + s.armies[t] : a), 0);
/** The living House with the most armies, or -1 on a tie. */
export function strongestSeat(s: GameState): number {
  const living = s.players.filter((p) => p.alive).map((p) => ({ seat: p.seat, n: armyTotal(s, p.seat) })).sort((a, b) => b.n - a.n);
  if (!living.length || (living[1] && living[1].n === living[0].n)) return -1;
  return living[0].seat;
}
/** How many Houses a Rally may gather, the rallier included. */
export const rallySlots = (s: GameState) => Math.floor(s.players.filter((p) => p.alive).length / 2);

/** Why `seat` can't call a Rally Against Olympus right now, or null if it can. */
export function rallyBlocker(s: GameState, seat: number): string | null {
  if (s.phase === 'passage' || s.phase === 'over') return 'Not now.';
  if (!s.opts.alliances) return 'Alliances are off in this war.';
  if (!s.players[seat]?.alive) return 'The dead rally no one.';
  if (!s.warBegun) return 'Diplomacy opens once one House has attacked another.';
  if (s.siege) return 'The valley is already at war with Olympus.';
  if (s.rally) return s.rally.by === seat ? 'Your Rally is already open.' : 'Another Rally is already open.';
  if (strongestSeat(s) !== seat) return 'Only the strongest House (the most armies, no ties) may call a Rally.';
  const slots = rallySlots(s);
  if (slots < 2) return 'Too few Houses still stand for a Rally.';
  if ((allianceOf(s, seat)?.members.length ?? 1) >= slots) return 'Your alliance is already as large as a Rally allows.';
  return null;
}
/** Why `seat` can't answer the open Rally, or null if it can. */
export function joinRallyBlocker(s: GameState, seat: number): string | null {
  const r = s.rally;
  if (!r) return 'There is no Rally to answer.';
  if (!s.players[seat]?.alive) return 'The dead answer no one.';
  if (seat === r.by) return 'It is your own Rally.';
  if (allied(s, seat, r.by)) return 'You already stand with them.';
  if (banned(s, seat)) return banMsg(s);
  if ((allianceOf(s, r.by)?.members.length ?? 1) >= r.slots) return 'The Rally is full.';
  return null;
}

function joinRally(s: GameState, seat: number) {
  const r = s.rally!;
  const old = allianceOf(s, seat);
  if (old) {
    // Answering the Rally means walking out on your old allies: they hear about it as a betrayal.
    log(s, { k: 'defect', seat, by: r.by, members: [...old.members], wasPublic: old.public, quip: Math.floor(R() * 1000), vis: old.public ? undefined : [...old.members] });
    lockOut(s, seat, old.public ? undefined : [...old.members]);
    leaveAlliance(s, seat);
  }
  let al = allianceOf(s, r.by);
  if (!al) { al = { id: ++s.uid, members: [r.by], public: true, since: s.turn }; s.alliances.push(al); }
  al.members.push(seat);
  al.public = true;
  s.invites = s.invites.filter((i) => !allied(s, i.from, i.to));
  log(s, { k: 'rallyJoined', seat, by: r.by, members: [...al.members], slots: r.slots });
  if (al.members.length >= r.slots) { log(s, { k: 'rallyClosed', by: r.by, why: 'full' }); s.rally = null; }
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
  s.rally = null;
  s.siege = {
    alliance: a.id, members: [...a.members], garrison: o.garrison, start: o.garrison, proctors: o.proctors,
    regen: o.regen, smite: o.smite, defHigh: o.defHigh, turnsLeft: o.turns, shield: [],
    dmg: s.players.map(() => 0), lost: s.players.map(() => 0), hits: s.players.map(() => 0),
  };
  log(s, { k: 'siegeBegins', members: [...a.members], garrison: o.garrison, proctors: o.proctors, turns: o.turns });
}

/** Who did what in a siege, for its final tally: damage dealt to Olympus, soldiers lost, assaults made (by seat). */
export function siegeTally(sg: Siege) {
  return { members: [...sg.members], start: sg.start, proctors: [...sg.proctors], dmg: [...(sg.dmg ?? [])], lost: [...(sg.lost ?? [])], hits: [...(sg.hits ?? [])] };
}
/** Credit `seat` in the siege's tally. */
function siegeCredit(sg: Siege, seat: number, k: 'dmg' | 'lost' | 'hits', n: number) {
  const arr = (sg[k] ??= []);
  arr[seat] = (arr[seat] ?? 0) + n;
}

/** At the start of each allied turn in a siege: Olympus regrows and smites the Foot. */
function olympusTurn(s: GameState, seat: number) {
  const sg = s.siege!;
  if (sg.turnsLeft <= 0) {
    const a = s.alliances.find((x) => x.id === sg.alliance);
    s.siege = null;
    if (a) s.alliances = s.alliances.filter((x) => x !== a);
    s.siegeCooldown = s.turn + BALANCE.olyCooldown * s.players.length;
    log(s, { k: 'siegeFailed', garrison: sg.garrison, ...siegeTally(sg) });
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
    siegeCredit(sg, seat, 'lost', killed);
  }
  sg.shield = sg.shield.filter((x) => x !== seat);
  log(s, { k: 'olympusTurn', seat, regen: sg.regen, killed, garrison: sg.garrison, turnsLeft: sg.turnsLeft });
}

function assault(s: GameState, seat: number, a: Extract<Action, { type: 'assault' }>) {
  const sg = s.siege;
  const g = geo(s);
  if (s.phase !== 'attack') fail('Not the attack phase.');
  if (s.ts.ultMuted) fail('Silenced by Blackout: no attacks this turn.');
  if (s.ts.mustMove) fail('Move your armies into the conquered territory first.');
  if (!sg || !sg.members.includes(seat)) fail('There is no siege on Olympus for you to join.');
  const from = a.from;
  if (!(from >= 0 && from < g.nt) || !g.territories[from].foot || s.owner[from] !== seat) fail('Assault from the Foot of Olympus: an inner-ring territory you hold.');
  if (s.armies[from] < 2) fail('Need at least 2 armies to assault.');
  const battle = startBattle(s, `${from}>O`, false);
  const walls = s.ts.buffs.siegeWalls > 0 ? 0 : BALANCE.olyWall;
  if (s.ts.buffs.siegeWalls > 0) s.ts.buffs.siegeWalls--;
  const rolls: any[] = [];
  let aLost = 0, dLost = 0;
  do {
    const dice = Math.max(1, Math.min(3, a.dice ?? 3, s.armies[from] - 1));
    const dDice = battle.breakLine ? 1 : Math.min(2, sg.garrison);
    const m: Mods = {
      atkHigh: (battle.atk ? 1 : 0) + s.ts.buffs.siegeAtk,
      atkLow: terrainMods(s, from, -1).atk,
      atkAll: s.ts.buffs.fury ? 1 : 0,
      defHigh: sg.defHigh,
      defLow: 0,
      defAll: walls,
    };
    const r = roll(dice, dDice, m);
    s.armies[from] -= r.aLoss;
    const killed = Math.min(r.dLoss, sg.garrison);
    sg.garrison -= r.dLoss;
    aLost += r.aLoss; dLost += killed;
    rolls.push({ a: r.a, d: r.d, raw: r.raw, aLoss: r.aLoss, dLoss: r.dLoss });
  } while (a.blitz && s.armies[from] >= 2 && sg.garrison > 0);
  const won = sg.garrison <= 0;
  siegeCredit(sg, seat, 'dmg', dLost);
  siegeCredit(sg, seat, 'lost', aLost);
  siegeCredit(sg, seat, 'hits', 1);
  // Each House storms the wall its own Proctor commands.
  const proctor = `p-${HOUSES[s.players[seat].house].id}`;
  log(s, { k: 'assault', seat, from, rolls, n: rolls.length, aLost, dLost, garrison: Math.max(0, sg.garrison), won, blitz: !!a.blitz, walls: walls > 0, proctor, start: sg.start });
  if (won) {
    sg.garrison = 0;
    s.phase = 'over';
    s.winner = seat;
    s.winners = [...sg.members];
    s.ts.mustMove = null;
    snap(s, -1);
    log(s, { k: 'olympusFalls', seat, ...siegeTally(sg) });
  }
}

// ---------------------------------------------------------------------------
// cards

const SILENCED = 'Silenced by Blackout: no cards this turn.';
const PINNED_STD = 'Pinned by the Wild Hunt: your Standard cannot move this turn.';

function playCard(s: GameState, seat: number, a: Extract<Action, { type: 'play' }>) {
  const g = geo(s);
  if (s.phase !== 'draft') fail('Cards can only be played during the Draft.');
  if (s.ts.ultMuted) fail(SILENCED);
  const def = CARD[a.card];
  if (!def) fail('Unknown card.');
  if (!hand(s, seat).some((c) => c.id === a.card && !c.locked)) fail('That card is not playable (missing or locked).');
  if (def.active.kind === 'counter') fail('REACTION cards are sprung when a rival attacks you. You can still trade them.');
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
      if (s.ts.ultPinned) fail(PINNED_STD);
      s.standards[me.house].at = t; s.armies[t] += n; detail = { t }; break;
    }
    case 'draw': { let k = 0; for (let i = 0; i < n; i++) if (drawCard(s, seat, true)) k++; detail = { drew: k }; break; }
    case 'siegeWalls': s.ts.buffs.siegeWalls += n; break;
    case 'siegeCut': { const sg = s.siege!; const k = Math.min(n, sg.garrison - 1); sg.garrison -= k; siegeCredit(sg, seat, 'dmg', k); detail = { killed: k }; break; }
    case 'siegeLevy': s.ts.reinforcements += n; break;
    case 'siegeMoon': s.siege!.shield.push(seat); s.ts.buffs.siegeAtk = 1; break;
  }
  takeFromHand(s, seat, a.card);
  log(s, { k: 'play', seat, card: def.id, n, ...detail });
}

// ---------------------------------------------------------------------------
// dispatcher

export function act(s: GameState, seat: number, a: Action, ctx: Ctx): Result {
  return commit(s, seat, ctx, () => apply(s, seat, a));
}

/** The host hands a seat to an AI Primus (a kicked player): the House fights on without them. */
export function kickToAI(s: GameState, seat: number, ctx: Ctx): Result {
  return commit(s, seat, ctx, () => {
    const p = s.players[seat];
    if (!p) fail('No such seat.');
    if (p.ai) fail('That seat is already an AI.');
    p.ai = true;
    log(s, { k: 'kicked', seat, alive: p.alive });
  });
}

/** A Primus whose Keep is lost dies with it: the card goes to the discard pile. */
function slayPrimi(s: GameState) {
  const g = geo(s);
  (s.primus ?? []).forEach((p, h) => {
    if (!p || s.owner[g.keepOf(h)] === p.seat) return;
    s.primus![h] = null;
    s.priv?.discard.push(p.card);
    log(s, { k: 'primusSlain', seat: p.seat, card: p.card, t: g.keepOf(h), by: s.owner[g.keepOf(h)] });
  });
}

function commit(s: GameState, seat: number, ctx: Ctx, fn: () => void): Result {
  R = ctx.rng;
  NOW = ctx.now;
  norm(s);
  const owner0 = s.owner.slice(), armies0 = s.armies.slice(), std0 = s.standards.map((x) => x.at + (x.captured ? 'c' : ''));
  const mark = FRESH.length;
  try {
    fn();
    slayPrimi(s);
    // Announce every bonus region that just fell wholly into one House's hands.
    for (const r of geo(s).regions) {
      const o = s.owner[r.terr[0]];
      if (o >= 0 && r.terr.every((t) => s.owner[t] === o) && !r.terr.every((t) => owner0[t] === o)) log(s, { k: 'region', seat: o, region: r.id, bonus: r.bonus });
    }
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
    if (e instanceof RuleError) { FRESH.length = Math.min(FRESH.length, mark); return { ok: false, err: e.message }; }
    throw e;
  }
}

export const EMOTE_COOLDOWN_MS = 15_000;

/** Why `seat` can't swear `card` in as Primus of the Keep `keep` right now, or null if it can. */
export function primusBlocker(s: GameState, seat: number, keep: number, card?: string): string | null {
  const g = geo(s), T = g.territories, me = s.players[seat];
  if (!me?.alive) return 'The dead swear no one in.';
  if (s.cur !== seat || !['draft', 'attack', 'fortify'].includes(s.phase)) return 'Only on your own turn.';
  if (s.ts.ultMuted) return SILENCED;
  if (s.reaction) return 'Waiting on the defender to react.';
  if (!(keep >= 0 && keep < g.nt) || !T[keep].isKeep) return 'Pick a Keep.';
  if (s.owner[keep] !== seat) return `You do not hold ${T[keep].name}.`;
  if (keep === g.keepOf(me.house)) return 'Your home Keep answers to your General, not a Primus.';
  const h = T[keep].house;
  if (s.primus?.[h]) return `${T[keep].name} already has a Primus.`;
  if (s.phase !== 'draft' && !s.ts.keepsTaken?.includes(keep)) return 'Swear in a Primus when you take the Keep, or in a later Draft.';
  const hand = s.priv ? s.priv.hands[seat] : s.me?.seat === seat ? s.me.hand : [];
  const fits = hand.filter((c) => !c.locked && CARD[c.id]?.kind === 'character' && CARD[c.id].house === h);
  if (!fits.length) return `You hold no House ${HOUSES[h].name} Character to swear in.`;
  if (card != null && !fits.some((c) => c.id === card)) return `Only a House ${HOUSES[h].name} Character from your hand (not locked) can be its Primus.`;
  return null;
}

/** Keeps where `seat` could swear in a Primus right now, with the cards that fit. */
export function primusOptions(s: GameState, seat: number): { keep: number; cards: string[] }[] {
  const g = geo(s);
  const hand = s.priv ? s.priv.hands[seat] : s.me?.seat === seat ? s.me.hand : [];
  return g.territories.filter((t) => t.isKeep && s.owner[t.id] === seat && !primusBlocker(s, seat, t.id))
    .map((t) => ({ keep: t.id, cards: hand.filter((c) => !c.locked && CARD[c.id]?.kind === 'character' && CARD[c.id].house === t.house).map((c) => c.id) }));
}

function apply(s: GameState, seat: number, a: Action) {
  if (!s.players[seat]) fail('No such seat.');
  // Emotes: a short line to the War Log, any time, from anyone at the table.
  if (a.type === 'emote') {
    if (!Number.isInteger(a.line) || a.line < 0 || a.line >= EMOTES.length) fail('No such line.');
    const last = s.lastEmote![seat] ?? -1e15;
    if (NOW - last < EMOTE_COOLDOWN_MS) fail(`Catch your breath: one emote every ${EMOTE_COOLDOWN_MS / 1000} seconds.`);
    s.lastEmote![seat] = NOW;
    log(s, { k: 'emote', seat, line: a.line });
    return;
  }
  if (s.phase === 'over') fail('The game is over.');

  if (a.type === 'choose') {
    const pick = !!s.opts.pick;
    if (s.phase !== 'passage') fail(pick ? 'Every Primus is already chosen.' : 'The Passage is over.');
    const opts = s.priv!.passage[seat];
    if (!opts) fail(pick ? 'You already chose your Primus.' : 'You already walked out of the Passage.');
    if (!opts.includes(a.card)) fail(pick ? 'That Character is not of your House.' : 'That card was not dealt to you.');
    s.players[seat].general = a.card;
    if (!pick) {
      // A war from before .008: the Passage. Two cards, and the other one dies.
      const other = opts.find((c) => c !== a.card)!;
      s.killed.push({ seat, card: other });
      s.priv!.discard.push(other);
    }
    s.priv!.passage[seat] = null;
    log(s, { k: 'chosen', seat });
    if (s.priv!.passage.every((p) => p === null)) {
      for (const p of s.players) log(s, { k: 'passage', seat: p.seat, general: p.general, ...(pick ? {} : { killed: s.killed.find((k) => k.seat === p.seat)!.card }) });
      returnUnchosen(s);
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
      if (s.priv!.passage.every((p) => p === null)) { returnUnchosen(s); startTurn(s, s.order.find((x) => s.players[x].alive)!); }
    } else if (wasCur) advance(s);
    return;
  }

  if (s.phase === 'passage') fail(s.opts.pick ? 'Every House must first choose its Primus.' : 'Everyone must first survive the Passage.');

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
      if (a.accept && allianceOf(s, seat)) fail('You are already sworn to an alliance. Leave it first, or burn the letter.');
      if (a.accept && banned(s, seat)) fail(banMsg(s));
      if (a.accept && banned(s, inv.from)) fail('They left an alliance, and no one will have them yet.');
      s.invites = s.invites.filter((i) => i !== inv);
      if (!a.accept) { log(s, { k: 'inviteDeclined', from: inv.from, to: inv.to, vis: [inv.from, inv.to] }); return; }
      joinAlliance(s, inv);
      return;
    }
    case 'cancelInvite': {
      const inv = s.invites.find((i) => i.id === a.invite);
      if (!inv || inv.from !== seat) fail('That invitation is gone.');
      s.invites = s.invites.filter((i) => i !== inv);
      log(s, { k: 'inviteCancelled', from: inv.from, to: inv.to, vis: [inv.from, inv.to] });
      return;
    }
    case 'leaveAlliance': {
      const al = allianceOf(s, seat);
      if (!al) fail('You are not in an alliance.');
      const members = [...al.members], secret = !al.public;
      leaveAlliance(s, seat, true);
      s.allyBan![seat] = Math.max(s.allyBan![seat] ?? 0, s.turn + s.players.filter((p) => p.alive).length);
      lockOut(s, seat, secret ? members : undefined);
      return;
    }
    case 'openRally': {
      const err = rallyBlocker(s, seat);
      if (err) fail(err);
      const al = allianceOf(s, seat);
      if (al && !al.public) { al.public = true; log(s, { k: 'allianceRevealed', seat, members: [...al.members], quip: Math.floor(R() * 1000) }); }
      s.rally = { by: seat, slots: rallySlots(s), turn: s.turn };
      log(s, { k: 'rallyOpened', seat, slots: s.rally.slots });
      return;
    }
    case 'joinRally': {
      const err = joinRallyBlocker(s, seat);
      if (err) fail(err);
      joinRally(s, seat);
      return;
    }
    case 'cancelRally': {
      if (s.rally?.by !== seat) fail('You have no Rally open.');
      log(s, { k: 'rallyClosed', by: seat, why: 'cancelled' });
      s.rally = null;
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
    case 'holdReactions': {
      if (!s.players[seat].alive) fail('The dead ambush no one.');
      s.reactHold = (s.reactHold ?? []).filter((x) => x !== seat);
      if (a.on) s.reactHold.push(seat);
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
      if (a.card && !counterCards(s, seat).some((c) => c.id === a.card)) fail('That is not a REACTION card in your hand.');
      if (a.hold && !a.card) s.reactHold = [...(s.reactHold ?? []).filter((x) => x !== seat), seat];
      resolveReaction(s, a.card);
      return;
    }
    if (a.type === 'timeout') {
      if (NOW < r.deadline) fail('The defender still has time.');
      resolveReaction(s, null);
      return;
    }
    fail('Waiting on the defender to react.');
  }

  if (a.type === 'turnTimeout') return turnTimeout(s);
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
    case 'ultimate': return castUlt(s, seat, a);
    case 'trade': {
      if (s.phase !== 'draft') fail('Trade during the Draft.');
      if (ts.ultMuted) fail(SILENCED);
      if (a.cards.length !== 3 || new Set(a.cards).size !== 3) fail('Trade exactly 3 cards.');
      const h = hand(s, seat);
      if (!a.cards.every((id) => h.some((c) => c.id === id && !c.locked))) fail('You can only trade unlocked cards in your hand.');
      for (const id of a.cards) takeFromHand(s, seat, id);
      ts.reinforcements += TRADE_VALUE;
      log(s, { k: 'trade', seat, cards: a.cards, n: TRADE_VALUE });
      return;
    }
    case 'play': return playCard(s, seat, a);
    case 'primus': {
      const err = primusBlocker(s, seat, a.keep, a.card);
      if (err) fail(err);
      const h = hand(s, seat);
      h.splice(h.findIndex((c) => c.id === a.card && !c.locked), 1);
      const house = g.territories[a.keep].house;
      s.primus![house] = { card: a.card, seat };
      log(s, { k: 'primus', seat, card: a.card, t: a.keep, house });
      return;
    }
    case 'discardProctor': {
      if (s.phase !== 'draft') fail('Only during the Draft.');
      if (ts.ultMuted) fail(SILENCED);
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
      // (A Silenced House can't trade, so it isn't made to.)
      if (mustTrade(s, seat) && !ts.ultMuted) fail(`You hold ${hand(s, seat).length} cards. Trade or play down below ${HAND_LIMIT}.`);
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
      if (ts.ultMuted) fail('Silenced by Blackout: no Fortify this turn.');
      if (ts.ultPinned) fail('Pinned by the Wild Hunt: no Fortify this turn.');
      const limit = 1 + passive(s, seat, 'fortify');
      if (!ts.buffs.fortifyAll && ts.fortifies >= limit) fail('No fortify moves left this turn.');
      if (s.owner[a.from] !== seat || s.owner[a.to] !== seat || a.from === a.to) fail('Fortify between two of your territories.');
      const route = fortifyRoute(s, seat, a.from, a.to);
      if (!route) fail('Those territories are not connected by your land.');
      const n = Math.floor(a.n);
      if (n < 1 || n > s.armies[a.from] - 1) fail('Bad army count (leave at least 1 behind).');
      const { path } = route!;
      s.armies[a.from] -= n; s.armies[a.to] += n; ts.fortifies++;
      log(s, { k: 'fortify', seat, from: a.from, to: a.to, n, path });
      return;
    }
    case 'moveStd': {
      if (s.phase !== 'fortify') fail('Move the Standard during Fortify.');
      if (ts.ultPinned) fail(PINNED_STD);
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
    case 'react': case 'timeout': fail('No attack is waiting on an ambush.');
  }
  fail('Unknown action.');
}

/** The turn timer ran out: finish the Draft for them (spread over the frontier), march into any conquest, and pass the turn. */
function turnTimeout(s: GameState) {
  if (!s.deadline || NOW < s.deadline) fail('There is still time on the clock.');
  const seat = s.cur, ts = s.ts, g = geo(s);
  let placed = 0;
  if (s.phase === 'draft' && ts.reinforcements > 0) {
    const mine = territoriesOf(s, seat);
    const front = mine.filter((t) => g.adj[t].some((n) => s.owner[n] !== seat));
    const pool = (front.length ? front : mine).sort((a, b) => s.armies[b] - s.armies[a]);
    for (let i = 0; ts.reinforcements > 0 && pool.length; i++, ts.reinforcements--, placed++) s.armies[pool[i % pool.length]]++;
  }
  if (ts.mustMove) { const mm = ts.mustMove; s.armies[mm.from] -= mm.max; s.armies[mm.to] += mm.max; ts.mustMove = null; }
  if (ts.conquered > 0) { const c = drawCard(s, seat, false); if (c) log(s, { k: 'earned', seat }); }
  log(s, { k: 'timeUp', seat, placed });
  advance(s);
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
  v.reactHold = (v.reactHold ?? []).filter((x) => x === seat);
  // The Book only shows alliances this seat could see at the time.
  if (v.stats) v.stats.hist = v.stats.hist.map((h) => ({ ...h, al: h.al.filter((x) => x.pub || (seat != null && x.m.includes(seat))) }));
  if (seat != null && priv) {
    v.me = { seat, hand: JSON.parse(JSON.stringify(priv.hands[seat])), passage: priv.passage[seat] };
    // Blackout's Revealed: the Minerva caster reads the target's hand until the caster's next turn. Nobody else does.
    for (const e of s.ult?.effects ?? []) if (e.kind === 'reveal' && e.caster === seat && e.target != null && s.players[e.target].alive) {
      (v.me.seen ??= {})[e.target] = JSON.parse(JSON.stringify(priv.hands[e.target]));
    }
  }
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
