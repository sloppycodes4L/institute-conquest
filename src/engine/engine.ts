// The rules engine. `act()` validates and applies one action to a GameState in place.
// Deterministic given the injected rng/now, so the server and local mode share it verbatim.

import { ADJ, DIST, HOUSES, NT, QUADRANTS, TERRITORIES, keepOf } from './data.ts';
import { CARD, CHARACTER_IDS, ALL_CARD_IDS, type CardDef, type PassiveKind } from './cards.ts';

export const NEUTRAL = -1;
export const STD_PHANTOMS = 3;
/** Tunables, exported so the balance simulator can sweep them. */
export const BALANCE = { keepWall: 1, stdGuard: 5, graceRounds: 1, stdDefDice: 3 };
export const TRADE_VALUE = 10;
export const HAND_LIMIT = 5;
export const REACTION_MS = 25_000;
export const START_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30 };
export const START_TERRITORIES: Record<number, number> = { 2: 12, 3: 10, 4: 8 };

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
export interface Buffs { atk: number; breakLine: number; longStrike: number; fortifyAll: boolean; fury: boolean }
export interface Battle { key: string; atk: boolean; breakLine: boolean }
export interface TurnState {
  reinforcements: number;
  conquered: number;
  fortifies: number;
  stdMoved: boolean;
  warCry: boolean;
  buffs: Buffs;
  battle: Battle | null;
  mustMove: { from: number; to: number; min: number; max: number } | null;
}
export interface Reaction { defender: number; deadline: number; from: number; to: number; commit: number }
export interface GameEvent { id: number; k: string; [x: string]: any }
export interface Private { deck: string[]; discard: string[]; hands: HandCard[][]; passage: (string[] | null)[] }

export interface GameState {
  v: 1;
  version: number;
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
  log: GameEvent[];
  seq: number;
  handCounts: number[];
  deckCount: number;
  priv: Private | null;
  me?: { seat: number; hand: HandCard[]; passage: string[] | null };
}

export type Action =
  | { type: 'choose'; card: string }
  | { type: 'place'; t: number; n: number }
  | { type: 'trade'; cards: string[] }
  | { type: 'play'; card: string; t?: number; seat?: number }
  | { type: 'discardProctor'; card: string }
  | { type: 'endDraft' }
  | { type: 'attack'; from: number; to: number; dice?: number; blitz?: boolean; commit?: number }
  | { type: 'react'; card: string | null }
  | { type: 'timeout' }
  | { type: 'move'; n: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; from: number; to: number; n: number }
  | { type: 'moveStd'; to: number }
  | { type: 'endTurn' }
  | { type: 'concede' };

export interface Ctx { rng: () => number; now: number }
export type Result = { ok: true } | { ok: false; err: string };

class RuleError extends Error {}
function fail(msg: string): never { throw new RuleError(msg); }

let R: () => number = Math.random;
let NOW = 0;

// ---------------------------------------------------------------------------
// helpers

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
  if (s.log.length > 120) s.log.splice(0, s.log.length - 120);
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

/** General passive value for a seat (canon House match gives +1). */
export function passive(s: GameState, seat: number, kind: PassiveKind): number {
  if (seat < 0) return 0;
  const p = s.players[seat];
  if (!p.general) return 0;
  const c = CARD[p.general];
  if (!c?.passive || c.passive.kind !== kind) return 0;
  return c.passive.n + (c.house === p.house ? 1 : 0);
}
export function passiveValue(card: CardDef, playerHouse: number) {
  return card.passive ? card.passive.n + (card.house === playerHouse ? 1 : 0) : 0;
}
export function activeValue(s: GameState, seat: number, card: CardDef) {
  return card.active.n + (card.kind === 'character' && ownsHouse(s, seat, card.house) ? card.active.bonus : 0);
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
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const c = q.pop()!;
    for (const n of ADJ[c]) if (s.owner[n] === seat && !seen.has(n)) { seen.add(n); q.push(n); }
  }
  return seen;
}

export function reinforcementBreakdown(s: GameState, seat: number) {
  const owned = territoriesOf(s, seat);
  const base = Math.max(3, Math.floor(owned.length / 3));
  const quads = QUADRANTS.map((q, i) => ({ i, name: q.name, bonus: q.bonus }))
    .filter((q) => TERRITORIES.every((t) => t.quadrant !== q.i || s.owner[t.id] === seat));
  const keeps = owned.filter((t) => TERRITORIES[t].isKeep).length;
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

export function createGame(names: string[], rng: () => number, opts: { ai?: boolean[] } = {}): GameState {
  R = rng;
  const n = names.length;
  if (n < 2 || n > 4) throw new Error('2 to 4 players');
  const houses = shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, n);
  const players: Player[] = names.map((name, seat) => ({
    seat, name: name.slice(0, 24) || `Gold ${seat + 1}`, house: houses[seat], general: null, alive: true, dominatedBy: null, ai: opts.ai?.[seat] || undefined,
  }));

  const chars = shuffle([...CHARACTER_IDS]);
  const passage = players.map(() => [chars.pop()!, chars.pop()!]);
  const deck = shuffle([...chars, ...ALL_CARD_IDS.filter((id) => CARD[id].kind === 'proctor')]);

  const owner = new Array(NT).fill(NEUTRAL);
  const armies: number[] = TERRITORIES.map((t) => (t.isKeep ? 8 : 3));
  const playerHouses = new Set(houses);

  for (const p of players) {
    const keep = keepOf(p.house);
    owner[keep] = p.seat;
    const home = shuffle([1, 2, 3, 4, 5].map((s) => keep + s)).slice(0, 4);
    for (const t of home) owner[t] = p.seat;
  }
  const target = START_TERRITORIES[n];
  let progress = true;
  while (progress) {
    progress = false;
    for (const p of players) {
      if (owner.filter((o) => o === p.seat).length >= target) continue;
      const keep = keepOf(p.house);
      let cands = TERRITORIES.filter((t) => owner[t.id] === NEUTRAL && !t.isKeep && (!playerHouses.has(t.house) || t.house === p.house));
      if (!cands.length) cands = TERRITORIES.filter((t) => owner[t.id] === NEUTRAL && !t.isKeep);
      if (!cands.length) continue;
      const w = cands.map((t) => 1 / Math.pow(1 + DIST[keep][t.id], 2.5));
      let x = R() * w.reduce((a, b) => a + b, 0);
      let pick = cands[cands.length - 1];
      for (let i = 0; i < cands.length; i++) { x -= w[i]; if (x <= 0) { pick = cands[i]; break; } }
      owner[pick.id] = p.seat;
      progress = true;
    }
  }
  for (const p of players) {
    const mine = owner.flatMap((o, t) => (o === p.seat ? [t] : []));
    for (const t of mine) armies[t] = 1;
    let rest = START_ARMIES[n] - mine.length;
    const keep = keepOf(p.house);
    const toKeep = Math.round(rest * 0.3);
    armies[keep] += toKeep;
    rest -= toKeep;
    const w = mine.map((t) => 1 / (1 + DIST[keep][t]));
    const W = w.reduce((a, b) => a + b, 0);
    while (rest-- > 0) {
      let x = R() * W;
      let pick = mine[mine.length - 1];
      for (let i = 0; i < mine.length; i++) { x -= w[i]; if (x <= 0) { pick = mine[i]; break; } }
      armies[pick]++;
    }
  }

  const s: GameState = {
    v: 1, version: 0, phase: 'passage', players, order: shuffle(players.map((p) => p.seat)), cur: -1, turn: 0,
    owner, armies,
    standards: HOUSES.map((_, h) => ({ at: keepOf(h), captured: false, by: null, guard: playerHouses.has(h) ? BALANCE.stdGuard : 0 })),
    killed: [], ts: freshTurn(), reaction: null, winner: null, log: [], seq: 0, handCounts: [], deckCount: 0,
    priv: { deck, discard: [], hands: players.map(() => []), passage },
  };
  s.cur = s.order[0];
  for (const p of players) log(s, { k: 'sorted', seat: p.seat, house: p.house });
  sync(s);
  return s;
}

function freshTurn(): TurnState {
  return {
    reinforcements: 0, conquered: 0, fortifies: 0, stdMoved: false, warCry: false,
    buffs: { atk: 0, breakLine: 0, longStrike: 0, fortifyAll: false, fury: false }, battle: null, mustMove: null,
  };
}

function sync(s: GameState) {
  if (!s.priv) return;
  s.handCounts = s.priv.hands.map((h) => h.length);
  s.deckCount = s.priv.deck.length;
}

function startTurn(s: GameState, seat: number) {
  s.cur = seat;
  s.turn++;
  s.phase = 'draft';
  s.ts = freshTurn();
  const p = s.players[seat];
  for (const c of hand(s, seat)) c.locked = false;
  const st = s.standards[p.house];
  if (!st.captured) st.guard = BALANCE.stdGuard + passive(s, seat, 'stdGuard');
  const rb = reinforcementBreakdown(s, seat);
  s.ts.reinforcements = rb.total;
  const extras: string[] = [];
  const kp = passive(s, seat, 'keep');
  if (kp && s.owner[keepOf(p.house)] === seat) { s.armies[keepOf(p.house)] += kp; extras.push(`+${kp} on Keep`); }
  const bp = passive(s, seat, 'border');
  if (bp) {
    const borders = territoriesOf(s, seat).filter((t) => ADJ[t].some((n) => s.owner[n] !== seat));
    if (borders.length) { const t = borders[Math.floor(R() * borders.length)]; s.armies[t] += bp; extras.push(`+${bp} on ${TERRITORIES[t].name}`); }
  }
  log(s, { k: 'turn', seat, turn: s.turn, reinf: rb.total, rb, extras });
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

function startBattle(s: GameState, from: number, to: number): Battle {
  const key = `${from}>${to}`;
  if (s.ts.battle?.key === key) return s.ts.battle;
  const b = s.ts.buffs;
  const battle: Battle = { key, atk: b.atk > 0, breakLine: b.breakLine > 0 };
  if (battle.atk) b.atk--;
  if (battle.breakLine) b.breakLine--;
  if (!ADJ[from].includes(to)) b.longStrike--;
  s.ts.battle = battle;
  return battle;
}

/** Keeps are fortresses: walls add to every defense die, and the General's defKeep adds to the highest. */
function defenseMods(s: GameState, to: number, extraAll = 0): { defHigh: number; defAll: number } {
  const def = s.owner[to];
  const keep = TERRITORIES[to].isKeep;
  return {
    defHigh: keep && def >= 0 ? passive(s, def, 'defKeep') : 0,
    defAll: (keep ? BALANCE.keepWall : 0) + extraAll,
  };
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
    for (const t of TERRITORIES) if (t.house === h && s.owner[t.id] === NEUTRAL) { s.owner[t.id] = captor; flipped.push(t.id); }
    log(s, { k: 'neutralFall', house: h, captor, flipped });
  }
}

function dominate(s: GameState, victim: number, captor: number) {
  const vp = s.players[victim];
  vp.alive = false;
  vp.dominatedBy = captor;
  let terr = 0;
  for (let t = 0; t < NT; t++) if (s.owner[t] === victim) { s.owner[t] = captor; terr++; }
  const cards = s.priv!.hands[victim].splice(0);
  if (captor >= 0) s.priv!.hands[captor].push(...cards.map((c) => ({ id: c.id, locked: false })));
  else s.priv!.discard.push(...cards.map((c) => c.id));
  s.standards.forEach((st) => { if (st.captured && st.by === victim) st.by = captor; });
  log(s, { k: 'dominated', victim, captor, terr, cards: cards.length });
  const alive = s.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    s.phase = 'over';
    s.winner = alive[0]?.seat ?? null;
    s.reaction = null;
    s.ts.mustMove = null;
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
  if (s.phase !== 'attack') fail('Not the attack phase.');
  if (s.ts.mustMove) fail('Move your armies into the conquered territory first.');
  if (s.owner[from] !== seat) fail('You do not hold that territory.');
  if (s.owner[to] === seat) fail('You cannot attack yourself, gorydamn idiot.');
  if (s.armies[from] < 2) fail('Need at least 2 armies to attack.');
  const h = standardAt(s, to);
  if (h >= 0 && s.owner[to] >= 0 && s.turn <= BALANCE.graceRounds * s.players.length) {
    fail('The Proctors forbid strikes on a Standard during the first round. Let the children settle in.');
  }
  const adjacent = ADJ[from].includes(to);
  if (!adjacent) {
    const sameBattle = s.ts.battle?.key === `${from}>${to}`;
    if (DIST[from][to] !== 2 || (!sameBattle && s.ts.buffs.longStrike <= 0)) fail('That territory is not adjacent.');
  }
}

function attack(s: GameState, seat: number, a: Extract<Action, { type: 'attack' }>) {
  const { from, to } = a;
  checkAttack(s, seat, from, to);
  if (a.commit != null) return standardAttack(s, seat, from, to, a.commit);
  const battle = startBattle(s, from, to);
  const def = s.owner[to];
  const rolls: any[] = [];
  let aLost = 0, dLost = 0;
  do {
    const dice = Math.max(1, Math.min(3, a.dice ?? 3, s.armies[from] - 1));
    const dUnits = s.armies[to] + guardAt(s, to);
    const dDice = battle.breakLine ? 1 : Math.min(standardAt(s, to) >= 0 ? BALANCE.stdDefDice : 2, dUnits);
    const m: Mods = {
      atkHigh: (battle.atk ? 1 : 0) + (def === NEUTRAL ? passive(s, seat, 'atkNeutral') : 0),
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
      log(s, { k: 'battle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, aLost, dLost, won: true, blitz: !!a.blitz });
      conquer(s, seat, from, to, dice);
      return;
    }
  } while (a.blitz && s.armies[from] >= 2);
  log(s, { k: 'battle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, aLost, dLost, won: false, blitz: !!a.blitz });
}

function counterCards(s: GameState, seat: number) {
  return hand(s, seat).filter((c) => !c.locked && CARD[c.id].active.kind === 'counter');
}

function standardAttack(s: GameState, seat: number, from: number, to: number, commit: number) {
  const h = s.players[seat].house;
  if (standardAt(s, from) !== h) fail('Your Standard is not in that territory.');
  if (!Number.isInteger(commit) || commit < 1 || commit > s.armies[from] - 1) fail('Commit between 1 and all-but-one of your armies.');
  const def = s.owner[to];
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
  const battle = startBattle(s, from, to);
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
    atkHigh: passive(s, seat, 'atkStd') + (battle.atk || wcAtk ? 1 : 0) + (def === NEUTRAL ? passive(s, seat, 'atkNeutral') : 0),
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
    log(s, { k: 'stdBattle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, won: true, enslaved, survivors: aReal });
    if (stdH >= 0 && stdH !== me.house) captureStandard(s, stdH, seat);
  } else {
    s.armies[to] = Math.max(1, dReal);
    log(s, { k: 'stdBattle', seat, def, from, to, rolls: rolls.slice(-4), n: rolls.length, won: false });
    captureStandard(s, me.house, def);
    if (s.phase !== 'over') advance(s);
  }
}

// ---------------------------------------------------------------------------
// cards

function playCard(s: GameState, seat: number, a: Extract<Action, { type: 'play' }>) {
  if (s.phase !== 'draft') fail('Cards can only be played during the Draft.');
  const def = CARD[a.card];
  if (!def) fail('Unknown card.');
  if (!hand(s, seat).some((c) => c.id === a.card && !c.locked)) fail('That card is not playable (missing or locked).');
  if (def.active.kind === 'counter') fail('Counter cards can only be played when a Standard attacks you. You can still trade them.');
  if (def.kind === 'proctor' && !ownsHouse(s, seat, def.house)) fail(`You don't own House ${HOUSES[def.house].name}. Discard this Proctor for 2 cards instead.`);
  const n = activeValue(s, seat, def);
  const me = s.players[seat];
  const adjToMine = (t: number) => ADJ[t].some((x) => s.owner[x] === seat);
  let detail: any = {};
  switch (def.active.kind) {
    case 'armies': s.ts.reinforcements += n; break;
    case 'atkBuff': s.ts.buffs.atk += n; break;
    case 'breakLine': s.ts.buffs.breakLine += n; break;
    case 'longStrike': s.ts.buffs.longStrike += n; break;
    case 'fortifyAll': s.ts.buffs.fortifyAll = true; s.ts.reinforcements += n; break;
    case 'fury': s.ts.buffs.fury = true; break;
    case 'harvest': {
      const k = TERRITORIES.filter((t) => t.quadrant === 3 && s.owner[t.id] === seat).length;
      s.ts.reinforcements += k + n; detail = { gained: k + n }; break;
    }
    case 'sabotage': {
      const t = a.t ?? -1;
      if (t < 0 || t >= NT || s.owner[t] === seat || !adjToMine(t)) fail('Pick an enemy territory next to yours.');
      const k = Math.min(n, s.armies[t] - 1);
      s.armies[t] -= k; detail = { t, killed: k }; break;
    }
    case 'raid': {
      const targets = [...new Set(territoriesOf(s, seat).flatMap((t) => ADJ[t]))]
        .filter((t) => s.owner[t] !== seat && s.armies[t] >= 2)
        .sort((x, y) => s.armies[y] - s.armies[x]).slice(0, n);
      for (const t of targets) s.armies[t]--;
      detail = { targets }; break;
    }
    case 'parley': {
      const t = a.t ?? -1;
      if (t < 0 || t >= NT || s.owner[t] !== NEUTRAL || !adjToMine(t)) fail('Pick a neutral territory next to yours.');
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
      if (t < 0 || t >= NT || s.owner[t] !== seat) fail('Pick a territory you hold.');
      if (s.standards[me.house].captured) fail('Your Standard is gone.');
      s.standards[me.house].at = t; s.armies[t] += n; detail = { t }; break;
    }
    case 'draw': { let k = 0; for (let i = 0; i < n; i++) if (drawCard(s, seat, true)) k++; detail = { drew: k }; break; }
  }
  takeFromHand(s, seat, a.card);
  log(s, { k: 'play', seat, card: def.id, n, ...detail });
}

// ---------------------------------------------------------------------------
// dispatcher

export function act(s: GameState, seat: number, a: Action, ctx: Ctx): Result {
  R = ctx.rng;
  NOW = ctx.now;
  try {
    apply(s, seat, a);
    s.version++;
    sync(s);
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

  switch (a.type) {
    case 'place': {
      if (s.phase !== 'draft') fail('Not the Draft.');
      const n = Math.floor(a.n);
      if (!(n >= 1 && n <= ts.reinforcements)) fail('Bad army count.');
      if (s.owner[a.t] !== seat) fail('You can only reinforce your own territory.');
      s.armies[a.t] += n; ts.reinforcements -= n;
      log(s, { k: 'place', seat, t: a.t, n });
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
      log(s, { k: 'phase', seat, phase: 'attack' });
      return;
    }
    case 'attack': return attack(s, seat, a);
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
      if (!connectedOwned(s, seat, a.from).has(a.to)) fail('Those territories are not connected by your land.');
      const n = Math.floor(a.n);
      if (n < 1 || n > s.armies[a.from] - 1) fail('Bad army count (leave at least 1 behind).');
      s.armies[a.from] -= n; s.armies[a.to] += n; ts.fortifies++;
      log(s, { k: 'fortify', seat, from: a.from, to: a.to, n });
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
  const { priv, ...pub } = s;
  const v: GameState = JSON.parse(JSON.stringify(pub));
  v.priv = null;
  if (priv) { v.handCounts = priv.hands.map((h) => h.length); v.deckCount = priv.deck.length; }
  if (s.phase === 'passage') v.players.forEach((p) => { if (p.seat !== seat && p.general) p.general = '?'; });
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
