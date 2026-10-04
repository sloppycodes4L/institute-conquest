// House Ultimates (.008): who may cast and when, what each of the seven does against one House and against a public
// alliance, the lasting effects, the alliance lockout, the AI, and wars in flight. The rules are the design sheet's
// "v5 as written" (docs/house-ultimates-sheet.html) and section 5 of docs/patch-008.md.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOUSES } from '../src/engine/data.ts';
import { CARD } from '../src/engine/cards.ts';
import {
  act, actingSeat, aiDuty, allianceOf, attackBlocker, attackTargets, battleMods, bottomHalfSeats, clone, createGame, defenseMods, drainLog, geo,
  guardAgainst, inviteBlocker, lockoutLeft, marsPickBlocker, marsTargets, passive, reinforcementBreakdown, resolveSettings, cleanSettings, standardAt,
  stormCut, territoriesOf, ultBlocker, ultCards, ultCardsOk, ultFight, ultStandings, viewFor, winScores,
  DEFAULT_SETTINGS, NEUTRAL, ULT, ULT_COOLDOWN, ULT_ROUND,
  type Action, type GameEvent, type GameState, type WarSettings,
} from '../src/engine/engine.ts';
import { botAction, botFallback } from '../src/engine/bot.ts';
import { ULTIMATE, statusIcons, ultButton } from '../src/ui/ultimates.ts';
import { describe as describeEvent, headline } from '../src/ui/copy.ts';

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ctx = (rng: () => number, now = 0) => ({ rng, now });
const hid = (id: string) => HOUSES.findIndex((h) => h.id === id);

/** A war between these Houses (seat i plays ids[i]), every Primus chosen, at the first turn. No Passives, so the numbers are bare. */
function war(ids: string[], seed = 1, settings: Partial<WarSettings> = {}) {
  const rng = mulberry(seed);
  const s = createGame(ids.map((h, i) => `${h}${i}`), rng, { houses: ids.map(hid), settings });
  for (const p of s.players) expect(act(s, p.seat, { type: 'choose', card: s.priv!.passage[p.seat]![0] }, ctx(rng)).ok).toBe(true);
  for (const p of s.players) p.general = null;
  s.turn = 20; // long past the first-round grace period
  return { s, rng, g: geo(s) };
}
const ok = (r: { ok: boolean; err?: string }) => { if (!r.ok) throw new Error(r.err); };
/** Where a seat's Drafts go in these tests: its home Keep, so that no stack under test is ever reinforced. */
function dump(s: GameState, seat: number) {
  const keep = geo(s).keepOf(s.players[seat].house);
  return s.owner[keep] === seat ? keep : territoriesOf(s, seat)[0];
}
/** The current seat plays an empty turn: its Draft goes on its home Keep, no attack, no Fortify. */
function pass(s: GameState, rng: () => number) {
  const seat = s.cur;
  if (s.phase === 'draft') {
    if (s.ts.reinforcements > 0) ok(act(s, seat, { type: 'place', t: dump(s, seat), n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, seat, { type: 'endDraft' }, ctx(rng)));
  }
  if (s.phase === 'attack') ok(act(s, seat, { type: 'endAttack' }, ctx(rng)));
  ok(act(s, seat, { type: 'endTurn' }, ctx(rng)));
}
/** Empty turns until it is `seat`'s Draft. */
function until(s: GameState, seat: number, rng: () => number) {
  for (let i = 0; i < 40 && s.cur !== seat; i++) pass(s, rng);
  expect(s.cur).toBe(seat);
  expect(s.phase).toBe('draft');
}
/** The next turn of `seat` (its current one ends first, if it is playing). */
function nextTurn(s: GameState, seat: number, rng: () => number) {
  if (s.cur === seat) pass(s, rng);
  until(s, seat, rng);
}
/** Three unlocked cards from the deck into `seat`'s hand: one of its birth House, two others (no REACTION cards). */
function give(s: GameState, seat: number, n = 3): string[] {
  const house = s.players[seat].house, deck = s.priv!.deck;
  const take = (pred: (id: string) => boolean) => deck.splice(deck.findIndex(pred), 1)[0];
  const cards = [take((id) => CARD[id].house === house), ...Array.from({ length: n - 1 }, () => take((id) => CARD[id].house !== house && CARD[id].active.kind !== 'counter' && CARD[id].kind === 'character'))];
  s.priv!.hands[seat].push(...cards.map((id) => ({ id, locked: false })));
  return cards;
}
/** `seat` at its Draft in round `round`, entitled to cast and holding the cards. */
function open(s: GameState, rng: () => number, seat: number, round = 5): string[] {
  s.ult!.round = round;
  until(s, seat, rng);
  s.ult!.eligible[seat] = true;
  return give(s, seat);
}
const cast = (s: GameState, rng: () => number, seat: number, target: number, cards: string[], more: { alliance?: boolean; picks?: number[] } = {}) =>
  act(s, seat, { type: 'ultimate', target, alliance: !!more.alliance, cards, ...(more.picks ? { picks: more.picks } : {}) }, ctx(rng));
/** Neutral land that is no Keep (so it holds no Standard), in quadrant `q` if given. */
function wilds(s: GameState, q?: number): number[] {
  const T = geo(s).territories;
  return T.filter((t) => s.owner[t.id] === NEUTRAL && !t.isKeep && (q == null || t.quadrant === q)).map((t) => t.id);
}
function hold(s: GameState, t: number, seat: number, armies: number) { s.owner[t] = seat; s.armies[t] = armies; return t; }
const ally = (s: GameState, members: number[], pub = true) => { s.alliances.push({ id: ++s.uid, members, public: pub, since: s.turn }); s.warBegun = true; };
const ticks = (s: GameState, kind: string) => s.log.filter((e) => e.k === 'ultTick' && e.kind === kind);
const lastCast = (s: GameState) => s.ult!.casts.at(-1)!;
const seatOf = (s: GameState, id: string) => s.players.find((p) => p.house === hid(id))!.seat;
/** These seats in the order their turns come after `from`'s. */
const inTurnOrder = (s: GameState, from: number, seats: number[]) => {
  const at = (x: number) => (s.order.indexOf(x) - s.order.indexOf(from) + s.order.length) % s.order.length;
  return [...seats].sort((a, b) => at(a) - at(b));
};
const last = <T>(a: T[], f: (x: T) => boolean) => a.filter(f).at(-1);

describe('the setting', () => {
  it('is on by default, off with 2 Houses, and a war without it has no trace of Ultimates', () => {
    expect(DEFAULT_SETTINGS.ultimates).toBe(true);
    expect(cleanSettings({}).ultimates).toBe(true);
    expect(cleanSettings({ ultimates: false }).ultimates).toBe(false);
    expect(resolveSettings(3).ultimates).toBe(true);
    expect(resolveSettings(7, { ultimates: true }).ultimates).toBe(true);
    expect(resolveSettings(2).ultimates).toBe(false);
    expect(resolveSettings(2, { ultimates: true }).ultimates).toBe(false);
    expect(resolveSettings(5, { ultimates: false }).ultimates).toBe(false);

    const on = war(['mars', 'jupiter', 'pluto']).s;
    expect(on.opts.ultimates).toBe(true);
    expect(on.ult).toMatchObject({ round: 1, cd: [0, 0, 0], eligible: [false, false, false], pvp: [0, 0, 0], effects: [], casts: [] });

    for (const { s, rng } of [war(['mars', 'jupiter']), war(['mars', 'jupiter', 'pluto', 'ceres'], 2, { ultimates: false })]) {
      expect(s.opts.ultimates).toBe(false);
      expect('ult' in s).toBe(false);
      const seat = s.cur;
      const cards = give(s, seat);
      expect(act(s, seat, { type: 'ultimate', target: (seat + 1) % s.players.length, alliance: false, cards }, ctx(rng))).toEqual({ ok: false, err: 'House Ultimates are off in this war.' });
      expect(ultBlocker(s, seat)).toMatchObject({ code: 'off' });
      // The state and every view are those of a war from before .008: no `ult`, no Ultimate flags on the turn.
      for (const v of [s, viewFor(s, seat), viewFor(s, null)]) {
        expect(JSON.stringify(v)).not.toMatch(/"ult"|ultMuted|ultPinned|"seen"/);
      }
      // Trading still gives its 10, and the war plays on as before.
      const r0 = s.ts.reinforcements;
      ok(act(s, seat, { type: 'trade', cards }, ctx(rng)));
      expect(s.ts.reinforcements).toBe(r0 + 10);
      for (let i = 0; i < 12; i++) pass(s, rng);
      expect(s.log.some((e) => ['ultimate', 'ultTick', 'seized', 'lockout'].includes(e.k))).toBe(false);
      expect(s.log.filter((e) => e.k === 'turn').every((e) => !e.skipped)).toBe(true);
    }
  });
});

describe('who can cast, and when', () => {
  it('counts rounds by the turn order, and opens in round 4', () => {
    const { s, rng } = war(['mars', 'jupiter', 'pluto', 'ceres']);
    expect(s.ult!.round).toBe(1);
    const first = s.order[0], last = s.order[3];
    for (let r = 1; r <= 3; r++) {
      until(s, last, rng);
      expect(s.ult!.round).toBe(r);
      // Nothing before round 4, whatever the standing and the hand.
      give(s, s.cur);
      expect(ultBlocker(s, s.cur)).toMatchObject({ code: 'round', n: ULT_ROUND });
      expect(s.ult!.eligible.some(Boolean)).toBe(false);
      s.priv!.hands[s.cur] = [];
      pass(s, rng);
      expect(s.cur).toBe(first);
      expect(s.ult!.round).toBe(r + 1);
    }
    expect(s.ult!.round).toBe(4);
    // The round counter doesn't care how many turns it took: a fallen House shortens the round, not the count.
    const dead = s.order[1];
    ok(act(s, dead, { type: 'concede' }, ctx(rng)));
    until(s, last, rng);
    pass(s, rng);
    expect(s.ult!.round).toBe(5);
  });

  it('the bottom floor(parties / 2) by Win % may cast: 40% territory, 40% armies, 20% battles won', () => {
    const { s, rng } = war(['mars', 'jupiter', 'pluto', 'ceres', 'apollo']);
    s.ult!.round = 4;
    // Five solo Houses of the same size. Armies set them apart: seat 0 strongest ... seat 4 weakest.
    const size = Math.max(...s.players.map((p) => territoriesOf(s, p.seat).length));
    for (const p of s.players) while (territoriesOf(s, p.seat).length < size) hold(s, wilds(s)[0], p.seat, 1);
    s.players.forEach((p, i) => { for (const t of territoriesOf(s, p.seat)) s.armies[t] = 10 - 2 * i; });
    const w = winScores(s);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect([...w].sort((a, b) => b - a)).toEqual(w);
    // One of them by hand: equal territory share, its army share, and an equal split of the battle share (nobody has won one).
    const terr = s.players.map((p) => territoriesOf(s, p.seat).length), arm = s.players.map((p) => territoriesOf(s, p.seat).reduce((a, t) => a + s.armies[t], 0));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(w[2]).toBeCloseTo(100 * (0.4 * terr[2] / sum(terr) + 0.4 * arm[2] / sum(arm) + 0.2 / 5), 6);
    // 5 parties: the bottom 2.
    expect([...bottomHalfSeats(s)].sort()).toEqual([3, 4]);
    expect(ultStandings(s).map((p) => [p.members, p.bottom])).toEqual([[[0], false], [[1], false], [[2], false], [[3], true], [[4], true]]);
    // Checked at the start of each House's turn.
    for (let i = 0; i < 5; i++) { pass(s, rng); expect(s.ult!.eligible[s.cur]).toBe(s.cur >= 3); }
    for (const seat of [0, 1, 2]) { until(s, seat, rng); give(s, seat); expect(ultBlocker(s, seat)).toMatchObject({ code: 'top' }); }
    // Battles won count: the weakest House with every win on the books climbs out of the bottom half.
    s.ult!.pvp = [0, 0, 0, 0, 6];
    const terr2 = s.players.map((p) => territoriesOf(s, p.seat).length), arm2 = s.players.map((p) => territoriesOf(s, p.seat).reduce((a, t) => a + s.armies[t], 0));
    expect(winScores(s)[4]).toBeCloseTo(100 * (0.4 * terr2[4] / sum(terr2) + 0.4 * arm2[4] / sum(arm2) + 0.2), 6);
    expect(bottomHalfSeats(s).has(4)).toBe(false);
    // The fallen score nothing and are no party.
    s.players[4].alive = false;
    expect(winScores(s)[4]).toBe(0);
    expect(ultStandings(s).length).toBe(4);
    expect(bottomHalfSeats(s).size).toBe(2);
  });

  it('an alliance is one party, with its members\' Win % added (secret ones too)', () => {
    for (const pub of [true, false]) {
      const { s, rng } = war(['mars', 'jupiter', 'pluto', 'ceres']);
      s.ult!.round = 4;
      const size = Math.max(...s.players.map((p) => territoriesOf(s, p.seat).length));
      for (const p of s.players) while (territoriesOf(s, p.seat).length < size) hold(s, wilds(s)[0], p.seat, 1);
      s.players.forEach((p, i) => { for (const t of territoriesOf(s, p.seat)) s.armies[t] = [3, 9, 6, 4][i]; });
      // Alone, seat 0 is last and seat 3 next: both in the bottom half of four.
      expect([...bottomHalfSeats(s)].sort()).toEqual([0, 3]);
      // Seats 0 and 1 allied are one party, and the strongest: three parties, so only the last one (seat 3) may cast.
      ally(s, [0, 1], pub);
      expect(ultStandings(s).map((p) => p.members)).toEqual([[0, 1], [2], [3]]);
      expect([...bottomHalfSeats(s)]).toEqual([3]);
      for (let i = 0; i < 4; i++) { pass(s, rng); expect(s.ult!.eligible[s.cur]).toBe(s.cur === 3); }
      // A rival's view only ranks the alliances it can see; the right to cast was decided on the real ones.
      const v = viewFor(s, 2);
      expect(ultStandings(v).length).toBe(pub ? 3 : 4);
      expect(v.ult!.eligible).toEqual(s.ult!.eligible);
    }
  });

  it('costs 3 unlocked cards, one from the birth House, gives no +10, and stands in for the forced trade', () => {
    const { s, rng } = war(['ceres', 'jupiter', 'pluto', 'mars']);
    const c = seatOf(s, 'ceres'), t = seatOf(s, 'jupiter');
    s.ult!.round = 5;
    until(s, c, rng);
    s.ult!.eligible[c] = true;
    const deck = s.priv!.deck;
    const plain = (id: string) => CARD[id].kind === 'character' && CARD[id].active.kind !== 'counter';
    const birth = deck.filter((id) => CARD[id].house === hid('ceres') && plain(id)), other = deck.filter((id) => CARD[id].house !== hid('ceres') && plain(id));
    const hand = (ids: string[], locked: string[] = []) => { s.priv!.hands[c] = ids.map((id) => ({ id, locked: locked.includes(id) })); };
    const err = { ok: false, err: 'An Ultimate costs 3 unlocked cards, at least 1 from House Ceres.' };
    // No card of House Ceres.
    hand(other.slice(0, 4));
    expect(ultBlocker(s, c)).toMatchObject({ code: 'cards' });
    expect(ultCards(s, c)).toBeNull();
    expect(cast(s, rng, c, t, other.slice(0, 3))).toEqual(err);
    // Two cards.
    hand([birth[0], other[0]]);
    expect(ultBlocker(s, c)).toMatchObject({ code: 'cards' });
    expect(cast(s, rng, c, t, [birth[0], other[0]])).toEqual(err);
    // The birth card is locked.
    hand([birth[0], other[0], other[1]], [birth[0]]);
    expect(ultBlocker(s, c)).toMatchObject({ code: 'cards' });
    expect(cast(s, rng, c, t, [birth[0], other[0], other[1]])).toEqual(err);
    // The same card twice, four cards, a card not in hand.
    hand([birth[0], other[0], other[1], other[2], other[3]]);
    expect(ultCardsOk(s, c, [birth[0], other[0], other[0]])).toBe(false);
    expect(ultCardsOk(s, c, [birth[0], other[0], other[1], other[2]])).toBe(false);
    expect(ultCardsOk(s, c, [birth[0], other[0], other[9]])).toBe(false);
    expect(ultCardsOk(s, c, [other[0], other[1], other[2]])).toBe(false);
    expect(ultCardsOk(s, c, [other[0], birth[0], other[2]])).toBe(true);
    // Five cards: the Draft can't end without a trade...
    expect(ultBlocker(s, c)).toBeNull();
    ok(act(s, c, { type: 'place', t: dump(s, c), n: s.ts.reinforcements }, ctx(rng)));
    expect(act(s, c, { type: 'endDraft' }, ctx(rng)).ok).toBe(false);
    // ...and the cast is that trade: three cards to the discard pile, no +10, and the Draft may end.
    const pick = ultCards(s, c)!;
    expect(pick[0]).toBe(birth[0]);
    expect(pick.length).toBe(3);
    const discard0 = s.priv!.discard.length;
    expect(cast(s, rng, c, t, pick)).toEqual({ ok: true });
    expect(s.ts.reinforcements).toBe(0);
    expect(s.priv!.hands[c].length).toBe(2);
    expect(s.priv!.discard.slice(discard0)).toEqual(pick);
    expect(act(s, c, { type: 'endDraft' }, ctx(rng))).toEqual({ ok: true });
    // The cards it would best pay with: a birth card, then what it will miss least (a Proctor it can't use before a REACTION card).
    const counter = deck.find((id) => CARD[id].active.kind === 'counter' && CARD[id].kind !== 'proctor' && CARD[id].house !== hid('ceres'))!;
    const dud = deck.find((id) => CARD[id].kind === 'proctor' && CARD[id].house !== hid('ceres'))!;
    hand([counter, other[5], dud, birth[1], birth[2]]);
    expect(ultCards(s, c)).toEqual([birth[1], dud, other[5]]);
  });

  it('only in your own Draft, on a living rival, never on an ally; then 3 of your own turns of cooldown', () => {
    const { s, rng } = war(['ceres', 'jupiter', 'pluto', 'mars']);
    const c = seatOf(s, 'ceres'), t = seatOf(s, 'jupiter'), friend = seatOf(s, 'pluto');
    const cards = open(s, rng, c);
    ally(s, [c, friend], false);
    const bad = (target: number, alliance = false) => cast(s, rng, c, target, cards, { alliance });
    expect(bad(c)).toEqual({ ok: false, err: 'Pick a living rival. An Ultimate never strikes an ally.' });
    expect(bad(friend).ok).toBe(false);
    expect(bad(9).ok).toBe(false);
    expect(bad(t, true)).toEqual({ ok: false, err: 'They are not in a public alliance. Strike them alone.' });
    // Not out of turn, and not after the Draft.
    expect(act(s, t, { type: 'ultimate', target: c, alliance: false, cards }, ctx(rng))).toEqual({ ok: false, err: 'It is not your turn.' });
    const later = clone(s);
    ok(act(later, c, { type: 'place', t: territoriesOf(later, c)[0], n: later.ts.reinforcements }, ctx(rng)));
    ok(act(later, c, { type: 'endDraft' }, ctx(rng)));
    expect(ultBlocker(later, c)).toMatchObject({ code: 'phase' });
    expect(act(later, c, { type: 'ultimate', target: t, alliance: false, cards }, ctx(rng)).ok).toBe(false);
    // Cast. The log says who, on whom, with what.
    drainLog();
    expect(bad(t)).toEqual({ ok: true });
    expect(s.log.at(-1)).toMatchObject({ k: 'ultimate', seat: c, house: hid('ceres'), target: t, targets: [t], alliance: false, cards, round: 5, cast: 1 });
    expect(drainLog().map((e) => e.k)).toEqual(['ultimate']);
    expect(lastCast(s)).toMatchObject({ id: 1, caster: c, house: hid('ceres'), target: t, targets: [t], alliance: false, round: 5 });
    // Not twice in a turn, and not for the next three of its own turns, whatever its standing.
    expect(s.ult!.cd[c]).toBe(ULT_COOLDOWN);
    give(s, c);
    expect(ultBlocker(s, c)).toMatchObject({ code: 'cooldown', n: 3 });
    for (const left of [3, 2, 1]) {
      nextTurn(s, c, rng);
      expect(s.ult!.cd[c]).toBe(left);
      expect(s.ult!.eligible[c]).toBe(false);
      s.ult!.eligible[c] = true;
      expect(ultBlocker(s, c)).toMatchObject({ code: 'cooldown', n: left });
      expect(cast(s, rng, c, t, ultCards(s, c)!).ok).toBe(false);
    }
    nextTurn(s, c, rng);
    expect(s.ult!.cd[c]).toBe(0);
    s.ult!.eligible[c] = true;
    expect(ultBlocker(s, c)).toBeNull();
    expect(cast(s, rng, c, t, ultCards(s, c)!)).toEqual({ ok: true });
    // A cooldown belongs to its House: an ally's cast doesn't start one.
    expect(s.ult!.cd[friend]).toBe(0);
  });
});

describe("Mars · Where's Sevro?", () => {
  /** Mars to play, with the target holding stacks of 15, 12, 10 and 7 in Mars's own quadrant. */
  function setup() {
    const w = war(['mars', 'jupiter', 'pluto', 'ceres']);
    const { s, rng, g } = w;
    const m = seatOf(s, 'mars'), t = seatOf(s, 'jupiter'), other = seatOf(s, 'pluto');
    const cards = open(s, rng, m);
    const q = g.territories[g.keepOf(hid('mars'))].quadrant;
    const land = wilds(s, q);
    expect(land.length).toBeGreaterThanOrEqual(6);
    const [a, b, c, d] = [15, 12, 10, 7].map((n, i) => hold(s, land[i], t, n));
    return { ...w, m, t, other, cards, q, land, a, b, c, d };
  }

  it('seizes 3 territories: half the armies die (rounded down), the rest join Mars with the land', () => {
    const { s, rng, m, t, cards, a, b, c, d } = setup();
    expect(marsTargets(s, m, [t])).toEqual(expect.arrayContaining([a, b, c, d]));
    drainLog();
    expect(cast(s, rng, m, t, cards, { picks: [a, b, c] })).toEqual({ ok: true });
    expect([a, b, c].map((x) => s.owner[x])).toEqual([m, m, m]);
    expect([a, b, c].map((x) => s.armies[x])).toEqual([8, 6, 5]); // 15: 7 die, 8 join. 12: 6 and 6. 10: 5 and 5.
    expect(s.owner[d]).toBe(t);
    expect(s.armies[d]).toBe(7);
    // The sheet's round-4 example: 18 destroyed, 19 join Mars.
    expect(lastCast(s)).toMatchObject({ removed: 18, gained: 19, picks: [a, b, c] });
    const evs = drainLog().filter((e) => e.k !== 'region');
    expect(evs.map((e) => e.k)).toEqual(['ultimate', 'seized', 'seized', 'seized']);
    expect(evs[0]).toMatchObject({ k: 'ultimate', picks: [a, b, c], removed: 18, gained: 19, hits: 3 });
    expect(evs.slice(1)).toMatchObject([{ t: a, from: t, dead: 7, joined: 8 }, { t: b, from: t, dead: 6, joined: 6 }, { t: c, from: t, dead: 5, joined: 5 }]);
    // The replay frame carries the three territories, like any other move.
    const d3 = s.trail.at(-1)!.d;
    expect(d3.filter((_, i) => i % 3 === 0).sort()).toEqual([a, b, c].sort());
    // No conquest, so no card for it; the land is marked Seized until Mars's next turn.
    expect(s.ts.conquered).toBe(0);
    expect(s.ult!.effects).toContainEqual({ kind: 'seized', cast: 1, caster: m, terrs: [a, b, c] });
    nextTurn(s, t, rng);
    expect(s.ult!.effects.some((e) => e.kind === 'seized')).toBe(true);
    nextTurn(s, m, rng);
    expect(s.ult!.effects.some((e) => e.kind === 'seized')).toBe(false);
  });

  it('left to itself takes the largest stacks; a neutral is fair game; a single army joins whole', () => {
    const { s, rng, m, t, cards, a, b, c, land } = setup();
    const auto = clone(s);
    expect(cast(auto, rng, m, t, cards)).toEqual({ ok: true });
    expect(lastCast(auto).picks).toEqual([a, b, c]);
    // A neutral garrison of 9: 4 die, 5 join. A lone army is never destroyed.
    const n9 = land[4], one = hold(s, land[5], t, 1);
    s.armies[n9] = 9;
    expect(s.owner[n9]).toBe(NEUTRAL);
    expect(cast(s, rng, m, t, cards, { picks: [n9, one, a] })).toEqual({ ok: true });
    expect([s.owner[n9], s.armies[n9]]).toEqual([m, 5]);
    expect([s.owner[one], s.armies[one]]).toEqual([m, 1]);
    expect(s.log.filter((e) => e.k === 'seized').map((e) => [e.from, e.dead, e.joined])).toEqual([[NEUTRAL, 4, 5], [t, 0, 1], [t, 7, 8]]);
  });

  it('never a Keep, never under a Standard, never outside Mars\'s quadrants, never a third House', () => {
    const { s, rng, g, m, t, other, cards, q, a, b, c } = setup();
    const T = g.territories;
    const refuse = (picks: number[], why: RegExp | string) => {
      const before = JSON.stringify(s);
      const r = cast(s, rng, m, t, cards, { picks });
      expect(r.ok).toBe(false);
      expect((r as { err: string }).err).toMatch(why);
      expect(JSON.stringify(s)).toBe(before); // refused before a card is spent
    };
    // The target's Keep, with its Standard, however big the stack; a Keep whose Standard has moved away; the Standard's new ground.
    const keep = g.keepOf(hid('jupiter'));
    s.armies[keep] = 99;
    expect(marsPickBlocker(s, m, [t], keep)).toBe('A Keep, and it holds a Standard.');
    refuse([a, b, keep], /A Keep, and it holds a Standard/);
    const camp = hold(s, wilds(s, q)[0], t, 30);
    const moved = clone(s);
    moved.standards[hid('jupiter')].at = camp;
    expect(marsPickBlocker(moved, m, [t], keep)).toBe('A Keep is never seized.');
    expect(marsPickBlocker(moved, m, [t], camp)).toBe('It holds a Standard.');
    expect(marsTargets(moved, m, [t])).not.toContain(camp);
    // A neutral Keep (it holds that House's Standard, and it is a Keep).
    const nk = T.find((x) => x.isKeep && s.owner[x.id] === NEUTRAL)!.id;
    expect(marsPickBlocker(s, m, [t], nk)).toMatch(/Keep/);
    // A tempting stack across the water: a quadrant where Mars holds nothing.
    const myQ = new Set(territoriesOf(s, m).map((x) => T[x].quadrant));
    const far = hold(s, wilds(s).find((x) => !myQ.has(T[x].quadrant))!, t, 99);
    refuse([a, b, far], /Mars holds no land/);
    expect(marsTargets(s, m, [t])).not.toContain(far);
    // Once Mars holds land there, it may.
    const reach = clone(s);
    hold(reach, wilds(reach).find((x) => T[x].quadrant === T[far].quadrant)!, m, 1);
    expect(marsTargets(reach, m, [t])).toContain(far);
    // Another rival's land, Mars's own, the same territory twice, too few picks, no such territory.
    const theirs = hold(s, wilds(s, q)[0], other, 40);
    refuse([a, b, theirs], /belongs to another House/);
    refuse([a, b, territoriesOf(s, m)[0]], /already hold/);
    refuse([a, a, b], /different/);
    refuse([a, b], /Pick 3 territories/);
    refuse([a, b, 9999], /No such territory/);
    // With only two valid territories on the board, two picks are a full cast.
    const few = clone(s);
    for (const x of marsTargets(few, m, [t])) if (x !== a && x !== b) hold(few, x, other, few.armies[x]);
    expect(marsTargets(few, m, [t]).sort()).toEqual([a, b].sort());
    expect(cast(few, rng, m, t, cards, { picks: [a, b, c] }).ok).toBe(false);
    expect(cast(few, rng, m, t, cards, { picks: [a, b] })).toEqual({ ok: true });
    // And with none at all, the cast is refused and costs nothing.
    const none = clone(s);
    for (const x of marsTargets(none, m, [t])) hold(none, x, other, none.armies[x]);
    const r = cast(none, rng, m, t, cards);
    expect(r).toMatchObject({ ok: false });
    expect((r as { err: string }).err).toMatch(/Nothing to seize/);
    expect(none.priv!.hands[m].length).toBe(3);
  });

  it('against a public alliance, the 3 picks may come from any member (and only then)', () => {
    const { s, rng, m, t, other, cards, q, a, b } = setup();
    const theirs = hold(s, wilds(s, q)[0], other, 40);
    ally(s, [t, other]);
    expect(cast(clone(s), rng, m, t, cards, { picks: [a, b, theirs] }).ok).toBe(false);
    expect(cast(s, rng, m, t, cards, { alliance: true, picks: [a, b, theirs] })).toEqual({ ok: true });
    expect([s.owner[theirs], s.armies[theirs]]).toEqual([m, 20]);
    expect(lastCast(s)).toMatchObject({ alliance: true, targets: [t, other], removed: 7 + 6 + 20 });
    // A secret alliance can't be struck whole.
    const secret = setup();
    ally(secret.s, [secret.t, secret.other], false);
    expect(cast(secret.s, secret.rng, secret.m, secret.t, secret.cards, { alliance: true })).toEqual({ ok: false, err: 'They are not in a public alliance. Strike them alone.' });
  });
});

describe('Jupiter · Stormfall', () => {
  function setup() {
    const w = war(['jupiter', 'mars', 'pluto', 'ceres']);
    const { s, rng, g } = w;
    const j = seatOf(s, 'jupiter'), t = seatOf(s, 'mars'), friend = seatOf(s, 'pluto');
    const cards = open(s, rng, j);
    const T = g.territories;
    const keep = g.keepOf(hid('mars')), q = T[keep].quadrant, q2 = (q + 1) % 4;
    s.armies[keep] = 20; // under the Standard
    const inQ = wilds(s, q), out = wilds(s, q2);
    const [big, six, five] = [12, 6, 5].map((n, i) => hold(s, inQ[i], t, n));
    const elsewhere = hold(s, out[0], t, 12);
    return { ...w, j, t, friend, cards, q, keep, big, six, five, elsewhere, inQ, out };
  }

  it('cuts every stack above 5 in one quadrant to 5, spares the Standard, and caps the next Draft at 5', () => {
    const { s, rng, j, t, cards, q, keep, big, six, five, elsewhere } = setup();
    const before = stormCut(s, t, q);
    expect(before.terrs).toEqual(expect.arrayContaining([big, six]));
    expect(before.terrs).not.toContain(keep);
    expect(before.terrs).not.toContain(five);
    drainLog();
    expect(cast(s, rng, j, t, cards, { picks: [q] })).toEqual({ ok: true });
    expect([s.armies[big], s.armies[six], s.armies[five]]).toEqual([5, 5, 5]);
    expect(s.armies[keep]).toBe(20); // the Standard's territory is immune
    expect(s.armies[elsewhere]).toBe(12); // another quadrant
    expect(lastCast(s)).toMatchObject({ removed: before.cut, picks: [q], targets: [t], alliance: false });
    expect(drainLog()[0]).toMatchObject({ k: 'ultimate', picks: [q], removed: before.cut, hits: before.terrs.length });
    expect(s.ult!.effects).toContainEqual({ kind: 'cap', cast: 1, target: t });
    expect(s.ult!.effects.find((e) => e.kind === 'storm')).toMatchObject({ caster: j, q, targets: [t], terrs: before.terrs });
    // Storm-bound: the next Draft is 5. A trade still adds on top.
    for (const x of wilds(s).slice(0, 30)) hold(s, x, t, 1);
    const total = reinforcementBreakdown(s, t).total;
    expect(total).toBeGreaterThan(12);
    const hand = give(s, t);
    nextTurn(s, t, rng);
    expect(s.ts.reinforcements).toBe(5);
    expect(ticks(s, 'storm').at(-1)).toMatchObject({ seat: t, n: total - 5, by: j, house: hid('jupiter') });
    expect(s.log.filter((e) => e.k === 'turn').at(-1)).toMatchObject({ seat: t, reinf: 5 });
    expect(lastCast(s).denied).toBe(total - 5);
    ok(act(s, t, { type: 'trade', cards: hand }, ctx(rng)));
    expect(s.ts.reinforcements).toBe(15);
    expect(s.ult!.effects.some((e) => e.kind === 'cap')).toBe(false);
    // Only that one Draft, and the quadrant stays marked until Jupiter's next turn.
    expect(s.ult!.effects.some((e) => e.kind === 'storm')).toBe(true);
    nextTurn(s, j, rng);
    expect(s.ult!.effects.some((e) => e.kind === 'storm')).toBe(false);
    nextTurn(s, t, rng);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, t).total);
  });

  it('a Draft of 5 or less is not cut, left to itself it picks the worst-hit quadrant, and a bad quadrant is refused', () => {
    const { s, rng, j, t, cards, q } = setup();
    expect(cast(clone(s), rng, j, t, cards, { picks: [7] })).toEqual({ ok: false, err: 'Pick one of the four quadrants.' });
    expect(cast(clone(s), rng, j, t, cards, { picks: [-1] }).ok).toBe(false);
    expect(cast(s, rng, j, t, cards)).toEqual({ ok: true });
    expect(lastCast(s).picks).toEqual([q]);
    const total = reinforcementBreakdown(s, t).total;
    expect(total).toBeLessThanOrEqual(5);
    nextTurn(s, t, rng);
    expect(s.ts.reinforcements).toBe(total);
    expect(ticks(s, 'storm').at(-1)).toMatchObject({ n: 0 });
  });

  it('spreads to every member of the target\'s public alliance; only the targeted House\'s Draft is capped', () => {
    for (const pub of [true, false]) {
      const { s, rng, j, t, friend, cards, q, big, inQ, out } = setup();
      const theirs = hold(s, inQ[4], friend, 30), theirsElsewhere = hold(s, out[1], friend, 30);
      ally(s, [t, friend], pub);
      expect(cast(s, rng, j, t, cards, { picks: [q] })).toEqual({ ok: true });
      expect(s.armies[big]).toBe(5);
      // A secret ally is a separate House: the storm passes it by.
      expect(s.armies[theirs]).toBe(pub ? 5 : 30);
      expect(s.armies[theirsElsewhere]).toBe(30);
      expect(lastCast(s)).toMatchObject({ targets: pub ? [t, friend] : [t], alliance: pub });
      expect(s.ult!.effects.filter((e) => e.kind === 'cap').map((e) => e.target)).toEqual([t]);
      for (const x of wilds(s).slice(0, 30)) hold(s, x, friend, 1);
      const total = reinforcementBreakdown(s, friend).total;
      nextTurn(s, friend, rng);
      expect(s.ts.reinforcements).toBe(total);
    }
  });
});

describe('Pluto · Rot', () => {
  function setup(n = 4) {
    const w = war(['pluto', 'mars', 'jupiter', 'ceres'].slice(0, n).concat(n > 4 ? ['apollo'] : []));
    const { s, rng, g } = w;
    const p = seatOf(s, 'pluto'), t = seatOf(s, 'mars'), friend = seatOf(s, 'jupiter');
    const cards = open(s, rng, p);
    const land = wilds(s);
    // The target's first territory takes its Drafts in these tests, so the stacks under test are never reinforced.
    for (const x of territoriesOf(s, t)) s.armies[x] = 1;
    const sizes = [4, 6, 10, 20, 40, 62];
    const stacks = sizes.map((k, i) => hold(s, land[i], t, k));
    const keep = g.keepOf(hid('mars'));
    s.armies[keep] = 50;
    for (const x of land.slice(10, 40)) hold(s, x, t, 1);
    return { ...w, p, t, friend, cards, stacks, keep, land };
  }
  const draftAfter = (total: number, pct: number) => total - Math.floor(total * pct);

  it('stacks of 5+ lose 30% on cast, 20% and 10% at the target\'s next turns, rounded down; the Standard is spared', () => {
    const { s, rng, p, t, cards, stacks, keep } = setup();
    drainLog();
    expect(cast(s, rng, p, t, cards)).toEqual({ ok: true });
    // The sheet's table: 4 is immune; 6 → 5 → 4 and stops; 10 → 7 → 6 → 6; 20 → 14 → 12 → 11; 40 → 28 → 23 → 21; 62 → 44 → 36 → 33.
    expect(stacks.map((x) => s.armies[x])).toEqual([4, 5, 7, 14, 28, 44]);
    expect(s.armies[keep]).toBe(50);
    expect(lastCast(s).removed).toBe(1 + 3 + 6 + 12 + 18);
    expect(drainLog()[0]).toMatchObject({ k: 'ultimate', removed: 40, hits: 5 });
    const total = reinforcementBreakdown(s, t).total;
    expect(total).toBeGreaterThanOrEqual(13);

    nextTurn(s, t, rng);
    expect(stacks.map((x) => s.armies[x])).toEqual([4, 4, 6, 12, 23, 36]);
    expect(s.ts.reinforcements).toBe(draftAfter(total, 0.3));
    expect(ticks(s, 'rot').at(-1)).toMatchObject({ seat: t, n: 1 + 1 + 2 + 5 + 8, stacks: 5, by: p, house: hid('pluto') });
    expect(ticks(s, 'rotDraft').at(-1)).toMatchObject({ seat: t, n: Math.floor(total * 0.3) });

    nextTurn(s, t, rng);
    expect(stacks.map((x) => s.armies[x])).toEqual([4, 4, 6, 11, 21, 33]); // the 4 is under 5 now: it stopped rotting
    expect(s.ts.reinforcements).toBe(draftAfter(reinforcementBreakdown(s, t).total, 0.2));
    expect(s.ult!.effects.some((e) => e.kind === 'rot')).toBe(false);

    // The third Draft is cut 10%, and then it is over.
    nextTurn(s, t, rng);
    expect(stacks.map((x) => s.armies[x])).toEqual([4, 4, 6, 11, 21, 33]);
    expect(s.ts.reinforcements).toBe(draftAfter(reinforcementBreakdown(s, t).total, 0.1));
    expect(s.ult!.effects.length).toBe(0);
    nextTurn(s, t, rng);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, t).total);
    expect(lastCast(s).removed).toBe(40 + 17 + 6);
    expect(ticks(s, 'rot').length).toBe(2);
    expect(ticks(s, 'rotDraft').length).toBe(3);
  });

  it('rot never takes a territory below 1, and lost ground stops rotting', () => {
    const { s, rng, p, t, friend, cards, stacks } = setup();
    expect(cast(s, rng, p, t, cards)).toEqual({ ok: true });
    for (const x of territoriesOf(s, t)) expect(s.armies[x]).toBeGreaterThanOrEqual(1);
    // The 62-stack (now 44) changes hands before the next tick: it is no longer the target's to rot.
    hold(s, stacks[5], friend, 44);
    nextTurn(s, t, rng);
    expect(s.armies[stacks[5]]).toBe(44);
    expect(s.armies[stacks[4]]).toBe(23);
  });

  it('against an alliance: each member takes the first two ticks only, on stacks and on Drafts', () => {
    const { s, rng, p, t, friend, cards, stacks, land } = setup();
    const theirs = hold(s, land[45], friend, 20);
    for (const x of land.slice(50, 70)) hold(s, x, friend, 1);
    ally(s, [t, friend]);
    expect(cast(s, rng, p, t, cards, { alliance: true })).toEqual({ ok: true });
    expect(lastCast(s).targets).toEqual([t, friend]);
    expect(stacks.map((x) => s.armies[x])).toEqual([4, 5, 7, 14, 28, 44]);
    expect(s.armies[theirs]).toBe(14);
    const members = inTurnOrder(s, p, [t, friend]);
    for (const m of members) {
      const total = reinforcementBreakdown(s, m).total;
      nextTurn(s, m, rng);
      expect(s.ts.reinforcements).toBe(draftAfter(total, 0.3));
    }
    expect(s.armies[theirs]).toBe(12);
    for (const m of members) {
      nextTurn(s, m, rng);
      expect(s.ts.reinforcements).toBe(draftAfter(reinforcementBreakdown(s, m).total, 0.2));
    }
    // No third tick: the stacks hold at their second-tick size, and the third Draft is whole.
    expect(stacks.map((x) => s.armies[x])).toEqual([4, 4, 6, 12, 23, 36]);
    expect(s.armies[theirs]).toBe(12);
    expect(s.ult!.effects.length).toBe(0);
    for (const m of members) { nextTurn(s, m, rng); expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, m).total); }
  });
});

describe('Minerva · Blackout', () => {
  function setup(settings: Partial<WarSettings> = {}) {
    const w = war(['minerva', 'mars', 'jupiter', 'ceres'], 3, settings);
    const { s, rng } = w;
    const m = seatOf(s, 'minerva'), t = seatOf(s, 'mars'), friend = seatOf(s, 'jupiter'), other = seatOf(s, 'ceres');
    const cards = open(s, rng, m);
    return { ...w, m, t, friend, other, cards };
  }

  it('against one House: its next turn is skipped whole, and so is its clock', () => {
    const { s, rng, m, t, cards } = setup({ timer: 60 });
    for (const x of wilds(s).slice(0, 30)) hold(s, x, t, 1);
    expect(cast(s, rng, m, t, cards)).toEqual({ ok: true });
    expect(s.ult!.effects.map((e) => e.kind).sort()).toEqual(['reveal', 'skip']);
    const hand = give(s, t, 5).slice(0, 3);
    const armies0 = territoriesOf(s, t).map((x) => s.armies[x]);
    const total = reinforcementBreakdown(s, t).total;
    // Play up to the House before the target.
    const before = s.order[(s.order.indexOf(t) + s.order.length - 1) % s.order.length];
    until(s, before, rng);
    ok(act(s, before, { type: 'place', t: territoriesOf(s, before)[0], n: s.ts.reinforcements }, ctx(rng, 5000)));
    ok(act(s, before, { type: 'endDraft' }, ctx(rng, 5000)));
    ok(act(s, before, { type: 'endAttack' }, ctx(rng, 5000)));
    const turn0 = s.turn;
    drainLog();
    ok(act(s, before, { type: 'endTurn' }, ctx(rng, 7000)));
    // The target's turn came and went inside that one action: the next House is already in its Draft.
    const after = s.order[(s.order.indexOf(t) + 1) % s.order.length];
    expect(s.cur).toBe(after);
    expect(s.phase).toBe('draft');
    expect(s.turn).toBe(turn0 + 2);
    // Its clock never started: the deadline is the next House's, counted from now.
    expect(s.deadline).toBe(7000 + 60_000);
    const evs = drainLog();
    const skipped = evs.find((e) => e.k === 'turn' && e.seat === t)!;
    expect(skipped).toMatchObject({ skipped: true, reinf: 0, turn: turn0 + 1 });
    expect(evs.find((e) => e.k === 'ultTick')).toMatchObject({ kind: 'blackout', seat: t, n: total, by: m, house: hid('minerva') });
    expect(evs.indexOf(skipped)).toBeLessThan(evs.findIndex((e) => e.k === 'ultTick'));
    // No Draft, no cards, no attacks, no Fortify: nothing of the target's moved, and its 5 cards are still there.
    expect(territoriesOf(s, t).map((x) => s.armies[x])).toEqual(armies0);
    expect(s.priv!.hands[t].length).toBe(5);
    expect(act(s, t, { type: 'trade', cards: hand }, ctx(rng)).ok).toBe(false);
    expect(lastCast(s)).toMatchObject({ skipped: 1, denied: total });
    // The Book still has a snapshot for the skipped turn.
    expect(s.stats!.hist.some((h) => h.turn === turn0 + 1 && h.seat === t)).toBe(true);
    // Only the one turn.
    expect(s.ult!.effects.some((e) => e.kind === 'skip')).toBe(false);
    nextTurn(s, t, rng);
    expect(s.cur).toBe(t);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, t).total);
  });

  it('Revealed: the caster, and nobody else, reads the target\'s hand until the caster\'s next turn', () => {
    const { s, rng, m, t, friend, other, cards } = setup();
    const hand = give(s, t, 4);
    ally(s, [m, friend], false);
    expect(viewFor(s, m).me!.seen).toBeUndefined();
    expect(cast(s, rng, m, t, cards)).toEqual({ ok: true });
    const seen = () => viewFor(s, m).me!.seen;
    expect(seen()).toEqual({ [t]: hand.map((id) => ({ id, locked: false })) });
    // Not the caster's ally, not a rival, not the target itself, not a spectator.
    for (const seat of [friend, other, t]) expect(viewFor(s, seat).me!.seen).toBeUndefined();
    expect(viewFor(s, null).me).toBeUndefined();
    for (const seat of [friend, other, null]) expect(JSON.stringify(viewFor(s, seat))).not.toContain(`"${hand[0]}"`);
    // It follows the hand as it changes, through the others' turns...
    nextTurn(s, other, rng);
    const extra = give(s, t, 1);
    expect(seen()![t].map((c) => c.id)).toEqual([...hand, ...extra]);
    // ...and ends at the start of the caster's next turn.
    nextTurn(s, m, rng);
    expect(seen()).toBeUndefined();
    expect(s.ult!.effects.some((e) => e.kind === 'reveal')).toBe(false);
  });

  it('against an alliance: each member is Silenced (Draft −60%, no cards, attacks or Fortify), and no hand is shown', () => {
    const { s, rng, g, m, t, friend, cards } = setup();
    for (const x of wilds(s).slice(0, 30)) hold(s, x, t, 2);
    ally(s, [t, friend]);
    expect(cast(s, rng, m, t, cards, { alliance: true })).toEqual({ ok: true });
    expect(s.ult!.effects.map((e) => [e.kind, e.target])).toEqual([['mute', t], ['mute', friend]]);
    expect(viewFor(s, m).me!.seen).toBeUndefined();
    const hand = give(s, t, 5);
    const total = reinforcementBreakdown(s, t).total;
    nextTurn(s, t, rng);
    // The turn is played, on 40% of the Draft.
    expect(s.cur).toBe(t);
    expect(s.ts.ultMuted).toBe(true);
    expect(s.ts.reinforcements).toBe(total - Math.floor(total * 0.6));
    expect(ticks(s, 'silenced').at(-1)).toMatchObject({ seat: t, n: Math.floor(total * 0.6), by: m });
    expect(viewFor(s, t).ts.ultMuted).toBe(true);
    // No cards: no trade, no play, no Proctor swap, no Primus, no Ultimate.
    const no = (a: Action, why: RegExp) => { const r = act(s, t, a, ctx(rng)); expect(r.ok).toBe(false); expect((r as { err: string }).err).toMatch(why); };
    no({ type: 'trade', cards: hand.slice(0, 3) }, /Silenced by Blackout: no cards/);
    no({ type: 'play', card: hand[1] }, /Silenced by Blackout: no cards/);
    s.priv!.hands[t].push({ id: 'p-apollo', locked: false });
    no({ type: 'discardProctor', card: 'p-apollo' }, /Silenced by Blackout: no cards/);
    s.ult!.eligible[t] = true;
    expect(ultBlocker(s, t)).toMatchObject({ code: 'silenced' });
    no({ type: 'ultimate', target: m, alliance: false, cards: hand.slice(0, 3) }, /Silenced by Blackout: no cards/);
    // Six cards in hand and no way to trade: the Draft ends anyway.
    ok(act(s, t, { type: 'place', t: dump(s, t), n: s.ts.reinforcements }, ctx(rng)));
    expect(act(s, t, { type: 'endDraft' }, ctx(rng))).toEqual({ ok: true });
    // No attacks (a normal one, a Standard charge), and the reason is the one the UI shows.
    const from = territoriesOf(s, t).find((x) => g.adj[x].some((y) => s.owner[y] !== t))!;
    const to = g.adj[from].find((y) => s.owner[y] !== t)!;
    s.armies[from] = 30;
    expect(attackBlocker(s, t, from, to)).toBe('Silenced by Blackout: no attacks this turn.');
    no({ type: 'attack', from, to, blitz: true }, /no attacks/);
    no({ type: 'attack', from, to, commit: 5 }, /no attacks/);
    ok(act(s, t, { type: 'endAttack' }, ctx(rng)));
    // No Fortify. The Standard may still move.
    const mine = territoriesOf(s, t);
    const a = mine.find((x) => s.armies[x] > 1)!, b = mine.find((x) => x !== a && g.adj[a].includes(x))!;
    no({ type: 'fortify', from: a, to: b, n: 1 }, /Silenced by Blackout: no Fortify/);
    const std = s.standards[hid('mars')].at;
    const next = g.adj[std].find((x) => s.owner[x] === t)!;
    expect(act(s, t, { type: 'moveStd', to: next }, ctx(rng))).toEqual({ ok: true });
    ok(act(s, t, { type: 'endTurn' }, ctx(rng)));
    // The ally is Silenced on its own next turn too (it may already have been), and then it is over for both.
    if (s.ult!.effects.some((e) => e.kind === 'mute')) { nextTurn(s, friend, rng); expect(s.ts.ultMuted).toBe(true); }
    expect(ticks(s, 'silenced').map((e) => e.seat).sort()).toEqual([t, friend].sort());
    nextTurn(s, t, rng);
    expect(s.ts.ultMuted).toBeFalsy();
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, t).total);
    expect(act(s, t, { type: 'trade', cards: hand.slice(0, 3) }, ctx(rng))).toEqual({ ok: true });
    expect(s.ult!.effects.length).toBe(0);
  });
});

describe('Ceres · The Tithe', () => {
  function setup() {
    const w = war(['ceres', 'mars', 'jupiter', 'pluto']);
    const { s, rng } = w;
    const c = seatOf(s, 'ceres'), t = seatOf(s, 'mars'), friend = seatOf(s, 'jupiter');
    const cards = open(s, rng, c);
    const land = wilds(s);
    for (const x of land.slice(0, 31)) hold(s, x, t, 1);
    return { ...w, c, t, friend, cards, land };
  }

  it('takes 50% of the target\'s next Draft and 25% of the one after, and the caster gains the same', () => {
    const { s, rng, c, t, cards } = setup();
    expect(cast(s, rng, c, t, cards)).toEqual({ ok: true });
    const total = reinforcementBreakdown(s, t).total;
    expect(total % 2).toBe(1); // an odd Draft: the cut rounds down
    nextTurn(s, t, rng);
    const cut1 = Math.floor(total * 0.5);
    expect(s.ts.reinforcements).toBe(total - cut1);
    expect(ticks(s, 'tithe').at(-1)).toMatchObject({ seat: t, n: cut1, by: c, house: hid('ceres') });
    const mine = reinforcementBreakdown(s, c).total;
    nextTurn(s, c, rng);
    expect(s.ts.reinforcements).toBe(mine + cut1);
    expect(ticks(s, 'harvest').at(-1)).toMatchObject({ seat: c, n: cut1 });
    expect(s.log.filter((e) => e.k === 'turn').at(-1)).toMatchObject({ seat: c, reinf: mine + cut1 });
    nextTurn(s, t, rng);
    const total2 = reinforcementBreakdown(s, t).total, cut2 = Math.floor(total2 * 0.25);
    expect(s.ts.reinforcements).toBe(total2 - cut2);
    nextTurn(s, c, rng);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, c).total + cut2);
    expect(lastCast(s)).toMatchObject({ denied: cut1 + cut2, gained: cut1 + cut2, gain: [cut1, cut2] });
    // Two Drafts each, and no more.
    expect(s.ult!.effects.length).toBe(0);
    nextTurn(s, t, rng);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, t).total);
    nextTurn(s, c, rng);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, c).total);
  });

  it('against an alliance: 30% then 15% from each member, and the caster collects the totals', () => {
    const { s, rng, c, t, friend, cards, land } = setup();
    for (const x of land.slice(40, 62)) hold(s, x, friend, 1);
    ally(s, [t, friend]);
    expect(cast(s, rng, c, t, cards, { alliance: true })).toEqual({ ok: true });
    const cuts: number[][] = [[], []];
    for (const wave of [0, 1]) {
      for (const m of inTurnOrder(s, c, [t, friend])) {
        const total = reinforcementBreakdown(s, m).total;
        nextTurn(s, m, rng);
        const cut = Math.floor(total * [0.3, 0.15][wave]);
        expect(s.ts.reinforcements).toBe(total - cut);
        cuts[wave].push(cut);
      }
      const mine = reinforcementBreakdown(s, c).total;
      nextTurn(s, c, rng);
      expect(s.ts.reinforcements).toBe(mine + cuts[wave][0] + cuts[wave][1]);
    }
    expect(cuts[0][0]).toBeGreaterThan(0);
    expect(lastCast(s).gained).toBe(cuts.flat().reduce((a, b) => a + b, 0));
  });

  it('the caster gains at most 100 in all; the target\'s cut has no cap', () => {
    const { s, rng, c, t, cards } = setup();
    expect(cast(s, rng, c, t, cards)).toEqual({ ok: true });
    const rec = lastCast(s);
    nextTurn(s, t, rng);
    rec.gain[0] = 80; // as if the first cut had taken 80
    const mine = reinforcementBreakdown(s, c).total;
    nextTurn(s, c, rng);
    expect(s.ts.reinforcements).toBe(mine + 80);
    nextTurn(s, t, rng);
    rec.gain[1] = 60;
    nextTurn(s, c, rng);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, c).total + 20);
    expect(rec.gained).toBe(ULT.titheCap);
    expect(ticks(s, 'harvest').map((e) => e.n)).toEqual([80, 20]);
  });
});

describe('Apollo · Solar Flare', () => {
  function setup() {
    const w = war(['apollo', 'mars', 'jupiter', 'pluto']);
    const { s, rng, g } = w;
    const a = seatOf(s, 'apollo'), t = seatOf(s, 'mars'), friend = seatOf(s, 'jupiter'), other = seatOf(s, 'pluto');
    const cards = open(s, rng, a);
    ally(s, [a, friend], false);
    // Open ground of the target's, with one territory of each attacker beside it.
    const to = wilds(s).find((x) => g.territories[x].terrain === 'open' && g.adj[x].filter((y) => s.owner[y] === NEUTRAL && !g.territories[y].isKeep && g.territories[y].terrain === 'open').length >= 3)!;
    hold(s, to, t, 8);
    const [fa, ff, fo] = g.adj[to].filter((y) => s.owner[y] === NEUTRAL && !g.territories[y].isKeep && g.territories[y].terrain === 'open');
    hold(s, fa, a, 30); hold(s, ff, friend, 30); hold(s, fo, other, 30);
    return { ...w, a, t, friend, other, cards, to, fa, ff, fo };
  }

  it('Glared: −1 on the target\'s highest defense die against the caster\'s party only; Radiant: +1 for the caster on the casting turn', () => {
    const { s, rng, g, a, t, friend, other, cards, to, fa, ff, fo } = setup();
    const base = battleMods(s, a, fa, to, false);
    expect(base).toMatchObject({ atkHigh: 0, defHigh: 0, defAll: 0, defLow: 0 });
    expect(cast(s, rng, a, t, cards)).toEqual({ ok: true });
    expect(s.ult!.effects).toEqual([{ kind: 'flare', cast: 1, caster: a, targets: [t], turn: s.turn }]);
    // The caster, this turn: its highest attack die +1, their highest defense die −1. Nothing else moves.
    expect(ultFight(s, a, to)).toEqual({ glared: true, radiant: true, hunted: false });
    expect(battleMods(s, a, fa, to, false)).toEqual({ ...base, atkHigh: 1, defHigh: -1 });
    // The caster's ally (a secret one counts): Glared, not Radiant. A third House: nothing.
    expect(battleMods(s, friend, ff, to, false)).toEqual({ ...base, defHigh: -1 });
    expect(battleMods(s, other, fo, to, false)).toEqual(base);
    // Only against the target: the caster's attack on anyone else is plain.
    const elsewhere = territoriesOf(s, other).find((x) => x !== fo)!;
    expect(ultFight(s, a, elsewhere)).toEqual({ glared: false, radiant: false, hunted: false });
    // In a Keep the Walls still stand: +1 for the Walls, −1 for the glare.
    expect(battleMods(s, a, fa, g.keepOf(hid('mars')), false).defHigh).toBe(defenseMods(s, g.keepOf(hid('mars'))).defHigh - 1);
    // The dice of a real fight carry it, and the log says why.
    ok(act(s, a, { type: 'place', t: fa, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, a, { type: 'endDraft' }, ctx(rng)));
    ok(act(s, a, { type: 'attack', from: fa, to, dice: 3 }, ctx(rng)));
    const ev = s.log.find((e) => e.k === 'battle')!;
    expect(ev).toMatchObject({ glared: true, radiant: true });
    expect(ev.hunted).toBeUndefined();
    expect(ev.m).toEqual([1, 0, 0, -1, 0, 0]);
    expect(ev.rolls[0].a[0]).toBe(ev.rolls[0].raw.a[0] + 1);
    expect(ev.rolls[0].d[0]).toBe(ev.rolls[0].raw.d[0] - 1);
    expect(ev.rolls[0].a.slice(1)).toEqual(ev.rolls[0].raw.a.slice(1));
    expect(ev.rolls[0].d.slice(1)).toEqual(ev.rolls[0].raw.d.slice(1));
    s.armies[to] = 8; s.owner[to] = t; s.ts.mustMove = null;
    // The window stays open through the other turns: the ally strikes a Glared target, the caster is no longer Radiant.
    nextTurn(s, friend, rng);
    expect(ultFight(s, friend, to)).toEqual({ glared: true, radiant: false, hunted: false });
    expect(ultFight(s, a, to)).toEqual({ glared: true, radiant: false, hunted: false });
    ok(act(s, friend, { type: 'place', t: ff, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, friend, { type: 'endDraft' }, ctx(rng)));
    drainLog();
    ok(act(s, friend, { type: 'attack', from: ff, to, dice: 3 }, ctx(rng)));
    expect(drainLog().find((e) => e.k === 'battle')!.m).toEqual([0, 0, 0, -1, 0, 0]);
    // A Standard charge through the glare.
    const charge = clone(s);
    charge.standards[hid('jupiter')].at = ff;
    charge.armies[ff] = 40; charge.armies[to] = 3; charge.owner[to] = t; charge.ts.mustMove = null;
    ok(act(charge, friend, { type: 'attack', from: ff, to, commit: 20 }, ctx(rng)));
    expect(last(charge.log, (e) => e.k === 'stdBattle')).toMatchObject({ glared: true, m: [0, 0, 0, -1, 0, 0] });
    // It ends at the start of the caster's next turn.
    s.owner[to] = t; s.armies[to] = 8; s.ts.mustMove = null;
    nextTurn(s, a, rng);
    expect(s.ult!.effects).toEqual([]);
    expect(battleMods(s, a, fa, to, false)).toEqual(base);
  });

  it('against an alliance: the same for every member', () => {
    const { s, rng, g, a, t, other, cards, to, fa } = setup();
    ally(s, [t, other]);
    expect(cast(s, rng, a, t, cards, { alliance: true })).toEqual({ ok: true });
    expect(s.ult!.effects[0].targets).toEqual([t, other]);
    expect(ultFight(s, a, to)).toMatchObject({ glared: true, radiant: true });
    const theirs = territoriesOf(s, other)[0];
    expect(ultFight(s, a, theirs)).toMatchObject({ glared: true, radiant: true });
    expect(battleMods(s, a, fa, theirs, false).defHigh).toBe(defenseMods(s, theirs).defHigh - 1);
    // A member that falls drops off the list.
    ok(act(s, other, { type: 'concede' }, ctx(rng)));
    expect(s.ult!.effects[0].targets).toEqual([t]);
    expect(g.nt).toBeGreaterThan(0);
  });
});

describe('Diana · The Wild Hunt', () => {
  function setup() {
    const w = war(['diana', 'mars', 'jupiter', 'pluto']);
    const { s, rng, g } = w;
    const d = seatOf(s, 'diana'), t = seatOf(s, 'mars'), friend = seatOf(s, 'jupiter'), other = seatOf(s, 'pluto');
    const cards = open(s, rng, d);
    ally(s, [d, friend]);
    // The target's Standard stands on open ground with 2 soldiers and its honor guard of 5; an attacker of each kind beside it.
    const std = wilds(s).find((x) => g.territories[x].terrain === 'open' && g.adj[x].filter((y) => s.owner[y] === NEUTRAL && !g.territories[y].isKeep).length >= 3)!;
    hold(s, std, t, 2);
    s.standards[hid('mars')].at = std;
    s.standards[hid('mars')].guard = 5;
    const [fd, ff, fo] = g.adj[std].filter((y) => s.owner[y] === NEUTRAL && !g.territories[y].isKeep);
    hold(s, fd, d, 30); hold(s, ff, friend, 30); hold(s, fo, other, 30);
    return { ...w, d, t, friend, other, cards, std, fd, ff, fo };
  }

  it('Hunted: no honor guard and no REACTION cards against the hunters, and nobody else', () => {
    const { s, rng, d, t, friend, other, cards, std, fd, ff, fo } = setup();
    expect(guardAgainst(s, d, std)).toBe(5);
    expect(cast(s, rng, d, t, cards)).toEqual({ ok: true });
    expect(s.ult!.effects.map((e) => e.kind)).toEqual(['hunt', 'pin']);
    expect(ultFight(s, d, std)).toEqual({ glared: false, radiant: false, hunted: true });
    expect([guardAgainst(s, d, std), guardAgainst(s, friend, std), guardAgainst(s, other, std)]).toEqual([0, 0, 5]);
    // The target holds a REACTION card.
    const counter = s.priv!.deck.find((id) => CARD[id].active.kind === 'counter' && CARD[id].kind !== 'proctor')!;
    s.priv!.hands[t].push({ id: counter, locked: false });
    ok(act(s, d, { type: 'place', t: fd, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, d, { type: 'endDraft' }, ctx(rng)));
    // A third House attacking the same ground: the guard stands and the ambush is offered.
    const third = clone(s);
    third.cur = other; third.phase = 'attack';
    ok(act(third, other, { type: 'attack', from: fo, to: std, blitz: true }, ctx(rng)));
    expect(third.reaction).toMatchObject({ defender: t, to: std });
    ok(act(third, t, { type: 'react', card: null }, ctx(rng)));
    expect(last(third.log, (e) => e.k === 'battle')).toMatchObject({ d0: 2, g0: 5 });
    expect(last(third.log, (e) => e.k === 'battle')!.hunted).toBeUndefined();
    // The hunter: no prompt, and only the 2 soldiers stand between it and the Standard. The guard is never fought.
    drainLog();
    ok(act(s, d, { type: 'attack', from: fd, to: std, blitz: true }, ctx(rng)));
    expect(s.reaction).toBeNull();
    const evs = drainLog();
    expect(evs.some((e) => e.k === 'ambushWait' || e.k === 'counter')).toBe(false);
    const battle = evs.find((e) => e.k === 'battle')!;
    expect(battle).toMatchObject({ hunted: true, won: true, d0: 2, g0: 0, dLost: 2 });
    expect(battle.m[3]).toBe(0);
    // The Standard is taken, and with it the House.
    expect(s.standards[hid('mars')]).toMatchObject({ captured: true, by: d });
    expect(s.players[t].alive).toBe(false);
    expect(evs.some((e) => e.k === 'dominated' && e.victim === t && e.captor === d)).toBe(true);
    // The fallen House's effects are gone with it.
    expect(s.ult!.effects).toEqual([]);
    expect(ff).not.toBe(fd);
  });

  it('a Standard charge by the hunters meets no guard and no ambush either', () => {
    const { s, rng, d, t, cards, std, fd } = setup();
    expect(cast(s, rng, d, t, cards)).toEqual({ ok: true });
    const counter = s.priv!.deck.find((id) => CARD[id].active.kind === 'counter' && CARD[id].kind !== 'proctor')!;
    s.priv!.hands[t].push({ id: counter, locked: false });
    s.standards[hid('diana')].at = fd;
    ok(act(s, d, { type: 'place', t: fd, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, d, { type: 'endDraft' }, ctx(rng)));
    ok(act(s, d, { type: 'attack', from: fd, to: std, commit: 25 }, ctx(rng)));
    expect(s.reaction).toBeNull();
    expect(last(s.log, (e) => e.k === 'stdRaised')).toMatchObject({ pending: false });
    expect(last(s.log, (e) => e.k === 'stdBattle')).toMatchObject({ hunted: true, d0: 2, dPh0: 0, won: true });
  });

  it('Long Strike: the whole party attacks 2 spaces away, any target, as often as it likes, until the caster\'s next turn', () => {
    const { s, rng, g, d, t, friend, other, cards, fd, ff, fo } = setup();
    const far = (seat: number, from: number) => Array.from({ length: g.nt }, (_, x) => x).filter((x) => g.dist[from][x] === 2 && s.owner[x] !== seat);
    const reach = (seat: number, from: number) => { const c = clone(s); c.cur = seat; c.phase = 'attack'; return attackTargets(c, seat, from); };
    expect(far(d, fd).length).toBeGreaterThan(2);
    expect(reach(d, fd).some((x) => g.dist[fd][x] === 2)).toBe(false);
    expect(cast(s, rng, d, t, cards)).toEqual({ ok: true });
    // Every territory 2 away that isn't the attacker's own: the hunted House's, a neutral's, anyone's.
    expect(reach(d, fd)).toEqual(expect.arrayContaining(far(d, fd)));
    expect(reach(friend, ff)).toEqual(expect.arrayContaining(far(friend, ff)));
    expect(far(d, fd).some((x) => s.owner[x] === NEUTRAL)).toBe(true);
    // Not for a House outside the party.
    expect(reach(other, fo).some((x) => g.dist[fo][x] === 2)).toBe(false);
    // Two long strikes in one turn, and no Long Strike card is used up.
    ok(act(s, d, { type: 'place', t: fd, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, d, { type: 'endDraft' }, ctx(rng)));
    s.armies[fd] = 200;
    const strikes = far(d, fd).filter((x) => !g.adj[fd].includes(x) && standardAt(s, x) < 0 && !g.territories[x].isKeep && s.owner[x] !== friend).slice(0, 2);
    expect(strikes.length).toBe(2);
    for (const x of strikes) {
      expect(attackBlocker(s, d, fd, x)).toBeNull();
      ok(act(s, d, { type: 'attack', from: fd, to: x, blitz: true }, ctx(rng)));
      expect(s.owner[x]).toBe(d);
      ok(act(s, d, { type: 'move', n: s.ts.mustMove!.min }, ctx(rng)));
    }
    expect(s.ts.buffs.longStrike).toBe(0);
    // The ally, on its own turn.
    nextTurn(s, friend, rng);
    ok(act(s, friend, { type: 'place', t: ff, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, friend, { type: 'endDraft' }, ctx(rng)));
    const y = far(friend, ff).find((x) => !g.adj[ff].includes(x) && !(s.owner[x] >= 0 && s.owner[x] === d))!;
    expect(attackBlocker(s, friend, ff, y)).toBeNull();
    // Gone at the caster's next turn.
    nextTurn(s, d, rng);
    ok(act(s, d, { type: 'place', t: fd, n: s.ts.reinforcements }, ctx(rng)));
    ok(act(s, d, { type: 'endDraft' }, ctx(rng)));
    const z = far(d, fd).find((x) => !g.adj[fd].includes(x))!;
    expect(attackBlocker(s, d, fd, z)).toMatch(/doesn't border|across the water/);
    expect(s.ult!.effects.some((e) => e.kind === 'hunt')).toBe(false);
  });

  it('Pinned: on its next turn the target can\'t Fortify or move its Standard (by march or by card); against an alliance, every member', () => {
    const { s, rng, g, d, t, other, cards, std } = setup();
    ally(s, [t, other]);
    expect(cast(s, rng, d, t, cards, { alliance: true })).toEqual({ ok: true });
    expect(s.ult!.effects.map((e) => [e.kind, e.target ?? e.targets])).toEqual([['hunt', [t, other]], ['pin', t], ['pin', other]]);
    expect(guardAgainst(s, d, s.standards[hid('pluto')].at)).toBe(0);
    for (const m of inTurnOrder(s, d, [t, other])) {
      nextTurn(s, m, rng);
      expect(s.ts.ultPinned).toBe(true);
      expect(ticks(s, 'pinned').at(-1)).toMatchObject({ seat: m, by: d, house: hid('diana') });
      const mine = territoriesOf(s, m);
      const house = s.players[m].house, at = s.standards[house].at;
      // The card that moves a Standard is refused too.
      const mover = Object.values(CARD).find((c) => c.active.kind === 'moveStd' && c.kind === 'character')!;
      s.priv!.hands[m] = [{ id: mover.id, locked: false }];
      expect(act(s, m, { type: 'play', card: mover.id, t: mine[0] }, ctx(rng))).toEqual({ ok: false, err: 'Pinned by the Wild Hunt: your Standard cannot move this turn.' });
      ok(act(s, m, { type: 'place', t: mine[0], n: s.ts.reinforcements }, ctx(rng)));
      ok(act(s, m, { type: 'endDraft' }, ctx(rng)));
      // Attacks are allowed.
      expect(attackBlocker(s, m, mine[0], g.adj[mine[0]].find((x) => s.owner[x] !== m) ?? -1) ?? '').not.toMatch(/Pinned|Silenced/);
      ok(act(s, m, { type: 'endAttack' }, ctx(rng)));
      const a = mine.find((x) => s.armies[x] > 1 && g.adj[x].some((y) => s.owner[y] === m))!, b = g.adj[a].find((y) => s.owner[y] === m)!;
      expect(act(s, m, { type: 'fortify', from: a, to: b, n: 1 }, ctx(rng))).toEqual({ ok: false, err: 'Pinned by the Wild Hunt: no Fortify this turn.' });
      const step = g.adj[at].find((y) => s.owner[y] === m)!;
      expect(act(s, m, { type: 'moveStd', to: step }, ctx(rng))).toEqual({ ok: false, err: 'Pinned by the Wild Hunt: your Standard cannot move this turn.' });
      expect(s.standards[house].at).toBe(at);
    }
    // One turn only.
    nextTurn(s, t, rng);
    expect(s.ts.ultPinned).toBeFalsy();
    expect(std).toBe(s.standards[hid('mars')].at);
  });
});

describe('the alliance lockout', () => {
  function setup() {
    const w = war(['mars', 'jupiter', 'pluto', 'ceres'], 5);
    const { s } = w;
    s.warBegun = true;
    return w;
  }
  /** Is `seat` locked out? An invitation from `from` tells. */
  const refused = (s: GameState, rng: () => number, seat: number, from: number) => {
    const c = clone(s);
    c.invites.push({ id: 999, from, to: seat, public: true, turn: c.turn });
    return !act(c, seat, { type: 'answer', invite: 999, accept: true }, ctx(rng)).ok;
  };

  it('walking out locks a House out of every alliance for 2 of its own turns, then it is free to ally with anyone', () => {
    const { s, rng } = setup();
    const a = s.cur, [b, c] = s.players.filter((p) => p.seat !== a).map((p) => p.seat);
    ally(s, [a, b], false);
    drainLog();
    ok(act(s, a, { type: 'leaveAlliance' }, ctx(rng)));
    expect(s.allyBan![a]).toBe(s.turn + 2 * 4);
    expect(lockoutLeft(s, a)).toBe(2);
    expect(lockoutLeft(s, b)).toBe(0);
    // The log line goes to those who knew of the alliance (it was secret).
    const ev = drainLog().find((e) => e.k === 'lockout')!;
    expect(ev).toMatchObject({ seat: a, turns: 2, vis: [a, b] });
    expect(viewFor(s, c).log.some((e) => e.k === 'lockout')).toBe(false);
    expect(viewFor(s, b).log.some((e) => e.k === 'lockout')).toBe(true);
    // Nobody will have it: it can't invite, and it can't accept. Its old partner can, with someone else.
    expect(inviteBlocker(s, a, c)).toBe('You left an alliance. No one will have you for 2 of your turns.');
    expect(refused(s, rng, a, c)).toBe(true);
    expect(inviteBlocker(s, b, c)).toBeNull();
    // An invitation to a locked-out House goes out, but can't be accepted yet.
    const inv = clone(s);
    inv.invites.push({ id: 998, from: a, to: c, public: true, turn: inv.turn });
    expect(act(inv, c, { type: 'answer', invite: 998, accept: true }, ctx(rng))).toEqual({ ok: false, err: 'They left an alliance, and no one will have them yet.' });
    // Through the rest of this turn and all of its next one.
    pass(s, rng);
    expect(refused(s, rng, a, c)).toBe(true);
    nextTurn(s, a, rng);
    expect(lockoutLeft(s, a)).toBe(1);
    expect(inviteBlocker(s, a, c)).toMatch(/2 of your turns/);
    expect(refused(s, rng, a, c)).toBe(true);
    pass(s, rng);
    expect(refused(s, rng, a, c)).toBe(true);
    // Free at its turn after that: with a new House, or with the one it walked out on.
    nextTurn(s, a, rng);
    expect(lockoutLeft(s, a)).toBe(0);
    expect(inviteBlocker(s, a, c)).toBeNull();
    expect(refused(s, rng, a, b)).toBe(false);
    ok(act(s, a, { type: 'invite', to: c, public: true }, ctx(rng)));
    ok(act(s, c, { type: 'answer', invite: s.invites[0].id, accept: true }, ctx(rng)));
    expect(allianceOf(s, a)?.members.sort()).toEqual([a, c].sort());
  });

  it('attacking an ally and answering a Rally lock out too', () => {
    // Betrayal.
    {
      const { s, rng, g } = setup();
      const a = s.cur, [b, c] = s.players.filter((p) => p.seat !== a).map((p) => p.seat);
      ally(s, [a, b]);
      const from = territoriesOf(s, a).find((x) => g.adj[x].some((y) => s.owner[y] !== a && !g.territories[y].isKeep))!;
      const to = hold(s, g.adj[from].find((x) => s.owner[x] !== a && !g.territories[x].isKeep)!, b, 1);
      s.armies[from] = 30;
      ok(act(s, a, { type: 'place', t: from, n: s.ts.reinforcements }, ctx(rng)));
      ok(act(s, a, { type: 'endDraft' }, ctx(rng)));
      drainLog();
      ok(act(s, a, { type: 'attack', from, to, blitz: true }, ctx(rng)));
      const evs = drainLog();
      expect(evs.map((e) => e.k)).toEqual(expect.arrayContaining(['betrayal', 'lockout']));
      expect(evs.find((e) => e.k === 'lockout')).toMatchObject({ seat: a, turns: 2 });
      expect(evs.find((e) => e.k === 'lockout')!.vis).toBeUndefined();
      expect(allianceOf(s, a)).toBeNull();
      expect(lockoutLeft(s, a)).toBe(2);
      // The betrayed House is free.
      expect(lockoutLeft(s, b)).toBe(0);
      expect(inviteBlocker(s, a, c)).toMatch(/No one will have you/);
    }
    // A Rally: the House that answers walks out on its allies, joins the Rally, and is locked out of any other alliance after it.
    {
      const { s, rng } = setup();
      const strong = s.cur;
      for (const t of territoriesOf(s, strong)) s.armies[t] = 40;
      const [b, c] = s.players.filter((p) => p.seat !== strong).map((p) => p.seat);
      ally(s, [b, c], false);
      ok(act(s, strong, { type: 'openRally' }, ctx(rng)));
      drainLog();
      ok(act(s, b, { type: 'joinRally' }, ctx(rng)));
      const evs = drainLog();
      expect(evs.find((e) => e.k === 'lockout')).toMatchObject({ seat: b, turns: 2, vis: [b, c] });
      expect(allianceOf(s, b)?.members.sort()).toEqual([strong, b].sort());
      expect(lockoutLeft(s, b)).toBe(2);
      expect(lockoutLeft(s, c)).toBe(0);
    }
  });
});

describe('the AI', () => {
  /** A bot's choice at the top of its Draft. */
  const choice = (s: GameState, seat: number, seed = 9) => botAction(viewFor(s, seat), seat, mulberry(seed));

  it('casts at the Win % leader when the Ultimate is worth two trades, with the cards it will miss least', () => {
    const { s, rng } = war(['pluto', 'mars', 'jupiter', 'ceres']);
    const p = seatOf(s, 'pluto'), lead = seatOf(s, 'mars');
    for (const x of wilds(s).slice(0, 12)) hold(s, x, lead, 20);
    const cards = open(s, rng, p);
    expect(ultStandings(s)[0].members).toEqual([lead]);
    const a = choice(s, p);
    expect(a).toMatchObject({ type: 'ultimate', target: lead, alliance: false });
    expect([...(a as { cards: string[] }).cards].sort()).toEqual([...cards].sort());
    expect(act(s, p, a, ctx(rng))).toEqual({ ok: true });
    // Not when the strike would be worth little.
    const weak = war(['pluto', 'mars', 'jupiter', 'ceres']);
    open(weak.s, weak.rng, p);
    expect(choice(weak.s, p).type).not.toBe('ultimate');
    // Not when it may not: cooldown, top half, the wrong round.
    for (const spoil of [(x: GameState) => { x.ult!.cd[p] = 2; }, (x: GameState) => { x.ult!.eligible[p] = false; }, (x: GameState) => { x.ult!.round = 3; }]) {
      const no = war(['pluto', 'mars', 'jupiter', 'ceres']);
      for (const x of wilds(no.s).slice(0, 12)) hold(no.s, x, lead, 20);
      open(no.s, no.rng, p);
      spoil(no.s);
      expect(choice(no.s, p).type).not.toBe('ultimate');
    }
  });

  it('Mars takes the 3 largest stacks it may seize; Jupiter the quadrant with the largest cut', () => {
    const { s, rng, g } = war(['mars', 'jupiter', 'pluto', 'ceres']);
    const m = seatOf(s, 'mars'), lead = seatOf(s, 'jupiter');
    const q = g.territories[g.keepOf(hid('mars'))].quadrant;
    const land = wilds(s, q);
    const stacks = [9, 30, 14, 22].map((n, i) => hold(s, land[i], lead, n));
    open(s, rng, m);
    const a = choice(s, m) as Extract<Action, { type: 'ultimate' }>;
    expect(a).toMatchObject({ type: 'ultimate', target: lead, picks: [stacks[1], stacks[3], stacks[2]] });
    expect(act(s, m, a, ctx(rng))).toEqual({ ok: true });

    const j = war(['jupiter', 'mars', 'pluto', 'ceres']);
    const js = seatOf(j.s, 'jupiter'), jl = seatOf(j.s, 'mars');
    const T = j.g.territories;
    const q1 = T[j.g.keepOf(hid('mars'))].quadrant, q2 = (q1 + 2) % 4;
    wilds(j.s, q1).slice(0, 3).forEach((x) => hold(j.s, x, jl, 10));
    wilds(j.s, q2).slice(0, 3).forEach((x) => hold(j.s, x, jl, 30));
    open(j.s, j.rng, js);
    expect(choice(j.s, js)).toMatchObject({ type: 'ultimate', target: jl, picks: [q2] });
  });

  it('against a public alliance it weighs the whole alliance and each member; a secret one it cannot see', () => {
    const { s, rng } = war(['ceres', 'mars', 'jupiter', 'pluto', 'apollo']);
    const c = seatOf(s, 'ceres'), x = seatOf(s, 'mars'), y = seatOf(s, 'jupiter');
    for (const t of wilds(s).slice(0, 30)) hold(s, t, x, 3);
    for (const t of wilds(s).slice(0, 30)) hold(s, t, y, 3);
    ally(s, [x, y]);
    open(s, rng, c);
    // Two Drafts taxed at 30% and 15% beat one at 50% and 25%.
    expect(choice(s, c)).toMatchObject({ type: 'ultimate', alliance: true });
    s.alliances[0].public = false;
    const a = choice(s, c);
    expect(a).toMatchObject({ type: 'ultimate', alliance: false });
    expect(act(s, c, a, ctx(rng))).toEqual({ ok: true });
  });

  it('follows a Wild Hunt and a Solar Flare with the attacks they were cast for', () => {
    // Diana: the leader's Standard with 3 soldiers behind its honor guard, one big stack two steps away.
    {
      const { s, rng, g } = war(['diana', 'mars', 'jupiter', 'pluto']);
      const d = seatOf(s, 'diana'), lead = seatOf(s, 'mars');
      const std = s.standards[hid('mars')].at;
      s.armies[std] = 3;
      const from = Array.from({ length: g.nt }, (_, x) => x).find((x) => g.dist[x][std] === 2 && s.owner[x] === NEUTRAL && !g.territories[x].isKeep)!;
      expect(from).toBeDefined();
      hold(s, from, d, 45);
      for (const x of wilds(s).slice(0, 14)) hold(s, x, lead, 12);
      open(s, rng, d);
      const a = choice(s, d);
      expect(a).toMatchObject({ type: 'ultimate', target: lead });
      ok(act(s, d, a, ctx(rng)));
      // Through its Draft, then straight at the Standard, from two spaces away.
      let b: Action = choice(s, d);
      for (let i = 0; i < 20 && s.phase === 'draft'; i++) { ok(act(s, d, b, ctx(rng))); b = botAction(viewFor(s, d), d, rng); }
      expect(s.phase).toBe('attack');
      expect(b).toEqual({ type: 'attack', from, to: std, blitz: true });
      ok(act(s, d, b, ctx(rng)));
      expect(s.players[lead].alive).toBe(false);
      expect(s.standards[hid('mars')].by).toBe(d);
    }
    // Apollo: a strong neighbour of the leader. The Flare is cast for the fights it wins, and they come first in the attack.
    {
      const { s, rng, g } = war(['apollo', 'mars', 'jupiter', 'pluto']);
      const a = seatOf(s, 'apollo'), lead = seatOf(s, 'mars');
      const spots = wilds(s).filter((x) => g.adj[x].some((y) => s.owner[y] === NEUTRAL && !g.territories[y].isKeep));
      const used = new Set<number>();
      const pairs: [number, number][] = [];
      for (const to of spots) {
        if (pairs.length === 4) break;
        const from = g.adj[to].find((y) => s.owner[y] === NEUTRAL && !g.territories[y].isKeep && !used.has(y));
        if (used.has(to) || from == null) continue;
        used.add(to); used.add(from);
        pairs.push([from, to]);
      }
      expect(pairs.length).toBe(4);
      for (const [from, to] of pairs) { hold(s, to, lead, 16); hold(s, from, a, 17); }
      // The leader is well ahead of the caster, so the Flare may go at it.
      for (const x of wilds(s).slice(0, 12)) hold(s, x, lead, 15);
      open(s, rng, a);
      const c = choice(s, a);
      expect(c).toMatchObject({ type: 'ultimate', target: lead });
      ok(act(s, a, c, ctx(rng)));
      let b: Action = choice(s, a);
      for (let i = 0; i < 20 && s.phase === 'draft'; i++) { ok(act(s, a, b, ctx(rng))); b = botAction(viewFor(s, a), a, rng); }
      expect(b.type).toBe('attack');
      const atk = b as Extract<Action, { type: 'attack' }>;
      expect(s.owner[atk.to]).toBe(lead);
      expect(ultFight(s, a, atk.to)).toMatchObject({ glared: true, radiant: true });
    }
  });

  it('holds one birth-House card back from round 3, and still trades when its hand is full', () => {
    const { s, rng } = war(['ceres', 'mars', 'jupiter', 'pluto']);
    const c = seatOf(s, 'ceres');
    until(s, c, rng);
    const [birth, x, y] = give(s, c);
    const trades = (round: number) => {
      const out = new Set<string>();
      for (let k = 0; k < 60; k++) {
        const t = clone(s);
        t.ult!.round = round;
        const a = botAction(viewFor(t, c), c, mulberry(k));
        if (a.type === 'trade') a.cards.forEach((id) => out.add(id));
        if (a.type === 'play') out.add(a.card);
      }
      return out;
    };
    // Before round 3 the birth card is traded like any other.
    expect(trades(2).has(birth)).toBe(true);
    // From round 3 it never is: with three cards in hand and one held, there is nothing to trade.
    expect(trades(3).has(birth)).toBe(false);
    expect(trades(4).has(birth)).toBe(false);
    // Five cards: a trade is forced. The held card stays if three others can pay.
    const extra = give(s, c).slice(1);
    s.ult!.round = 4;
    const a = botAction(viewFor(s, c), c, mulberry(1)) as Extract<Action, { type: 'trade' }>;
    expect(a.type).toBe('trade');
    expect(a.cards.length).toBe(3);
    expect(a.cards).not.toContain(birth);
    expect([x, y, ...extra].some((id) => a.cards.includes(id))).toBe(true);
    expect(act(s, c, a, ctx(rng))).toEqual({ ok: true });
  });

  it('5 bot games per player count (3 to 7) with Ultimates on all finish: bots cast, never walk out, and are never refused', { timeout: 300000 }, () => {
    let casts = 0, ticked = 0, lockouts = 0;
    const houses = new Set<number>();
    for (let n = 3; n <= 7; n++) for (let k = 0; k < 5; k++) {
      const rng = mulberry(8000 + 10 * n + k);
      const s = createGame(Array.from({ length: n }, (_, i) => `B${i}`), rng, { ai: Array(n).fill(true) });
      expect(s.ult).toBeDefined();
      drainLog();
      let now = 0;
      while (s.phase !== 'over' && s.turn < 150 * n) {
        const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
        const v = viewFor(s, seat);
        const a = botAction(v, seat, rng);
        // The AI never leaves an alliance (to become eligible, or for anything else).
        expect(a.type).not.toBe('leaveAlliance');
        // Under Blackout or the Hunt it asks for nothing the engine would refuse.
        if (v.ts.ultMuted && v.cur === seat) expect(['place', 'endDraft', 'endAttack', 'endTurn', 'moveStd', 'invite', 'answer', 'vote', 'proposeSiege', 'openRally', 'joinRally', 'move', 'react']).toContain(a.type);
        if (v.ts.ultPinned && v.cur === seat) expect(['fortify', 'moveStd']).not.toContain(a.type);
        const r = act(s, seat, a, { rng, now });
        if (!r.ok) {
          // The one thing a bot may still be told no: an invitation it can no longer accept (as before .008).
          expect(a.type, `${n}p game ${k}: ${JSON.stringify(a)} refused: ${(r as { err: string }).err}`).toBe('answer');
          const inv = s.invites.find((x) => x.to === seat)!;
          ok(act(s, seat, { type: 'answer', invite: inv.id, accept: false }, { rng, now }));
        }
        for (const e of drainLog()) {
          // Nothing an Ultimate does breaks the board: no negative stack, no negative Draft. (A territory can stand at 0
          // behind its honor guard or its ambushers, as before .008; the never-below-1 rule is tested House by House above.)
          if (e.k === 'ultimate' || e.k === 'ultTick') {
            expect(s.armies.every((x) => x >= 0)).toBe(true);
            expect(s.ts.reinforcements).toBeGreaterThanOrEqual(0);
          }
          if (e.k === 'ultimate') { casts++; houses.add(e.house); }
          if (e.k === 'ultTick') ticked++;
          if (e.k === 'lockout') lockouts++;
        }
      }
      expect(s.phase, `${n}p game ${k} did not finish (turn ${s.turn})`).toBe('over');
      // The state stays the v: 2 the server stores.
      expect(s.v).toBe(2);
    }
    expect(casts).toBeGreaterThanOrEqual(10);
    expect(ticked).toBeGreaterThan(0);
    expect(houses.size).toBeGreaterThanOrEqual(4);
    expect(lockouts).toBeGreaterThanOrEqual(0);
  });

  it('plays the same game from the same seed (its dice for weighing a cast come from the rng it is given)', () => {
    const run = () => {
      const rng = mulberry(4242);
      const s = createGame(['a', 'b', 'c', 'd', 'e'], rng, { ai: Array(5).fill(true), houses: [0, 1, 2, 3, 4] });
      let now = 0;
      while (s.phase !== 'over' && s.turn < 60) {
        const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
        const r = act(s, seat, botAction(viewFor(s, seat), seat, rng), { rng, now });
        if (!r.ok) { const inv = s.invites.find((x) => x.to === seat); if (inv) act(s, seat, { type: 'answer', invite: inv.id, accept: false }, { rng, now }); }
      }
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});

describe('wars in flight', () => {
  it('a war saved mid-war by the v.0071 engine plays to the end: no Ultimates, the new Keep rules, its Generals\' +1', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/v0071-mid-war.json', import.meta.url), 'utf8')) as GameState;
    const rng = mulberry(5);
    expect(s.v).toBe(2);
    expect(s.opts.ultimates).toBeUndefined();
    expect(s.opts.pick).toBeUndefined();
    expect(s.ult).toBeUndefined();
    expect(s.phase).toBe('draft');
    const g = geo(s);
    // Views load, and nothing in them speaks of Ultimates.
    for (const p of s.players) expect(JSON.stringify(viewFor(s, p.seat))).not.toMatch(/"ult"|ultMuted|"seen"/);
    // No Ultimates in a war that started without them, whatever the cards.
    const seat = s.cur;
    expect(ultBlocker(s, seat)).toMatchObject({ code: 'off' });
    expect(act(clone(s), seat, { type: 'ultimate', target: (seat + 1) % 4, alliance: false, cards: [] }, ctx(rng))).toEqual({ ok: false, err: 'House Ultimates are off in this war.' });
    // It adopts the new Keep rules at once: Walls on every Keep, a House's and a neutral's.
    for (const t of g.territories.filter((x) => x.isKeep)) expect(defenseMods(s, t.id).defHigh).toBeGreaterThanOrEqual(1);
    // Its Generals keep the House-match +1 of the Passage.
    for (const p of s.players) {
      const c = CARD[p.general!];
      if (c.passive) expect(passive(clone({ ...s, alliances: [], primus: s.primus!.map(() => null) } as GameState), p.seat, c.passive.kind)).toBe(c.passive.n + (c.house === p.house ? 1 : 0));
    }
    // Leaving an alliance is the old one-round rule.
    const leaver = s.alliances[0].members[0];
    const left = clone(s);
    ok(act(left, leaver, { type: 'leaveAlliance' }, ctx(rng)));
    expect(left.allyBan![leaver]).toBe(left.turn + 4);
    expect(left.log.some((e) => e.k === 'lockout')).toBe(false);
    // And the bots finish it.
    drainLog();
    const seen: GameEvent[] = [];
    let now = 0;
    while (s.phase !== 'over' && s.turn < 600) {
      const d = aiDuty(s); const who = d >= 0 ? d : actingSeat(s); now += 1000;
      const r = act(s, who, botAction(viewFor(s, who), who, rng), { rng, now });
      if (!r.ok) {
        const inv = s.invites.find((x) => x.to === who);
        ok(act(s, who, inv ? { type: 'answer', invite: inv.id, accept: false } : s.reaction ? { type: 'react', card: null } : s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, { rng, now }));
      }
      seen.push(...drainLog());
    }
    expect(s.phase).toBe('over');
    expect(s.ult).toBeUndefined();
    expect(seen.some((e) => ['ultimate', 'ultTick', 'seized', 'lockout', 'neutralFall'].includes(e.k))).toBe(false);
    // A neutral Keep taken after the load handed over no land: only the Keep changed hands in that action.
    const std = seen.filter((e) => e.k === 'stdCaptured' && e.victim == null);
    expect(std.length).toBeGreaterThanOrEqual(0);
    expect(s.v).toBe(2);
  });
});

describe('what the screen shows', () => {
  it('the Ultimate button says why not (the round, the standing, the cards), then READY, then the cooldown', () => {
    const { s, rng } = war(['minerva', 'pluto', 'ceres', 'apollo']);
    const me = seatOf(s, 'minerva'), foe = seatOf(s, 'pluto');
    const btn = () => ultButton(viewFor(s, me), me)!;
    until(s, me, rng);
    expect(btn()).toMatchObject({ name: ULTIMATE.minerva.name, state: 'locked', sub: `Opens in round ${ULT_ROUND}` });
    s.ult!.round = 5;
    s.ult!.eligible[me] = false;
    expect(btn()).toMatchObject({ state: 'top', sub: 'Top half: no Ultimate' });
    expect(btn().tip).toMatch(/of 4 by Win %\. The bottom 2 may cast\.$/);
    s.ult!.eligible[me] = true;
    s.priv!.hands[me] = [];
    expect(btn()).toMatchObject({ state: 'cards', sub: 'Needs 3 cards, 1 from House Minerva' });
    const cards = give(s, me);
    expect(btn()).toMatchObject({ state: 'ready', sub: 'READY' });
    ok(cast(s, rng, me, foe, cards));
    expect(btn()).toMatchObject({ state: 'cd', sub: `Recharging: ${ULT_COOLDOWN} turns` });
    // A war without Ultimates has no button and no icons.
    const off = war(['minerva', 'pluto', 'ceres', 'apollo'], 1, { ultimates: false }).s;
    expect(ultButton(viewFor(off, 0), 0)).toBeNull();
    expect(off.players.flatMap((p) => statusIcons(viewFor(off, 0), p.seat, 0))).toEqual([]);
  });

  it('a Silenced House reads "Silenced" on its button, whatever its standing and its hand', () => {
    const { s, rng } = war(['minerva', 'pluto', 'ceres', 'apollo']);
    const me = seatOf(s, 'minerva'), a = seatOf(s, 'pluto'), b = seatOf(s, 'ceres');
    ally(s, [a, b]);
    const cards = open(s, rng, me);
    ok(cast(s, rng, me, a, cards, { alliance: true }));
    nextTurn(s, a, rng);
    expect(s.ts.ultMuted).toBe(true);
    s.ult!.eligible[a] = true;
    give(s, a);
    expect(ultButton(viewFor(s, a), a)).toMatchObject({ state: 'silenced', sub: 'Silenced: no cards this turn' });
    // The icon stays on its banner for the turn it is playing, with the House that did it.
    expect(statusIcons(viewFor(s, a), a, a).find((x) => x.id === 'silenced')).toMatchObject({ house: hid('minerva') });
  });

  it('banner icons come from the public state: ready (glowing only for its owner), recharging, the effects, the lockout', () => {
    const { s, rng } = war(['minerva', 'pluto', 'ceres', 'apollo']);
    const me = seatOf(s, 'minerva'), foe = seatOf(s, 'pluto'), third = seatOf(s, 'ceres');
    until(s, me, rng);
    // Before round 4 there is nothing to show.
    expect(s.players.flatMap((p) => statusIcons(viewFor(s, me), p.seat, me))).toEqual([]);
    const cards = open(s, rng, me);
    expect(statusIcons(viewFor(s, me), me, me)).toEqual([{ id: 'ready', house: null, n: 0, glow: true }]);
    expect(statusIcons(viewFor(s, foe), me, foe)[0].glow).toBeUndefined();
    expect(statusIcons(viewFor(s, null), me, null)[0].glow).toBeUndefined();
    ok(cast(s, rng, me, foe, cards));
    expect(statusIcons(viewFor(s, me), me, me)).toEqual([{ id: 'recharge', house: hid('minerva'), n: ULT_COOLDOWN }]);
    // The target, as anyone sees it: Revealed (until the caster's next turn: no number) and Blacked Out (1 turn).
    for (const viewer of [me, foe, third, null]) {
      expect(statusIcons(viewFor(s, viewer), foe, viewer).filter((x) => x.id !== 'ready')).toEqual([
        { id: 'revealed', house: hid('minerva'), n: 0 },
        { id: 'blackout', house: hid('minerva'), n: 1 },
      ]);
    }
    // Rot counts the target's turns left; the lockout counts the leaver's.
    const w = war(['pluto', 'mars', 'ceres', 'apollo'], 3);
    const p = seatOf(w.s, 'pluto'), m = seatOf(w.s, 'mars'), c = seatOf(w.s, 'ceres');
    ok(cast(w.s, w.rng, p, m, open(w.s, w.rng, p)));
    expect(statusIcons(viewFor(w.s, null), m, null).find((x) => x.id === 'rot')).toEqual({ id: 'rot', house: hid('pluto'), n: 3 });
    ally(w.s, [m, c]);
    ok(act(w.s, c, { type: 'leaveAlliance' }, ctx(w.rng)));
    expect(statusIcons(viewFor(w.s, null), c, null).find((x) => x.id === 'locked')).toEqual({ id: 'locked', house: null, n: lockoutLeft(w.s, c) });
    expect(lockoutLeft(w.s, c)).toBeGreaterThan(0);
    // The fallen carry nothing.
    w.s.players[m].alive = false;
    expect(statusIcons(viewFor(w.s, null), m, null)).toEqual([]);
  });

  it('the War Log names the cast and its numbers, every tick, the lockout, and leaves a skipped turn to the Blackout line', () => {
    const { s, rng } = war(['minerva', 'pluto', 'ceres', 'apollo']);
    const me = seatOf(s, 'minerva'), foe = seatOf(s, 'pluto');
    ok(cast(s, rng, me, foe, open(s, rng, me)));
    const ev = s.log.filter((e) => e.k === 'ultimate').at(-1)!;
    const line = describeEvent(s, ev);
    expect(line).toContain(`casts ${ULTIMATE.minerva.name}`);
    expect(line).toContain('Their next turn is skipped');
    expect(headline(s, ev)).toMatchObject({ title: '⚡ BLACKOUT', long: true });
    expect(headline(s, ev)!.sub).toContain(`${s.players[me].name} of House Minerva strikes ${s.players[foe].name}`);
    for (let i = 0; i < 8 && !ticks(s, 'blackout').length; i++) pass(s, rng);
    const skipped = s.log.find((e) => e.k === 'turn' && e.skipped)!;
    expect(skipped.seat).toBe(foe);
    expect(describeEvent(s, skipped)).toBe('');
    expect(describeEvent(s, ticks(s, 'blackout')[0])).toMatch(/is <b>Blacked Out<\/b> by .*House Minerva.*: the turn is skipped/);
    // Against an alliance the line says so, and names its members.
    const w = war(['ceres', 'pluto', 'mars', 'apollo'], 2);
    const c = seatOf(w.s, 'ceres'), a = seatOf(w.s, 'pluto'), b = seatOf(w.s, 'mars');
    ally(w.s, [a, b]);
    ok(cast(w.s, w.rng, c, a, open(w.s, w.rng, c), { alliance: true }));
    const al = w.s.log.filter((e) => e.k === 'ultimate').at(-1)!;
    expect(describeEvent(w.s, al)).toMatch(/on the alliance of .* and .*\. Their next Draft is cut 30%, the one after 15%/);
    expect(headline(w.s, al)!.sub).toContain('strikes the alliance of');
    // The lines the other events get.
    const e = (x: Record<string, unknown>) => x as unknown as GameEvent;
    expect(describeEvent(s, e({ k: 'seized', t: 0, from: NEUTRAL, seat: me, dead: 3, joined: 4 }))).toMatch(/^⚑ .* is seized from .*: 3 die, 4 join /);
    expect(describeEvent(s, e({ k: 'ultTick', kind: 'silenced', seat: foe, house: hid('minerva'), n: 6 }))).toContain('Draft −6, and no cards, attacks or Fortify this turn');
    expect(describeEvent(s, e({ k: 'ultTick', kind: 'pinned', seat: foe, house: hid('diana') }))).toContain("no Fortify this turn, and the Standard can't move");
    expect(describeEvent(s, e({ k: 'ultTick', kind: 'storm', seat: foe, house: hid('jupiter'), n: 2 }))).toContain('Draft is capped at 5 (2 lost)');
    expect(describeEvent(s, e({ k: 'ultTick', kind: 'rot', seat: foe, house: hid('pluto'), n: 12, stacks: 1 }))).toContain('soldiers decay in 1 stack.');
    expect(describeEvent(s, e({ k: 'ultTick', kind: 'tithe', seat: foe, house: hid('ceres'), n: 0 }))).toBe('');
    expect(describeEvent(s, e({ k: 'ultTick', kind: 'harvest', seat: me, house: hid('ceres'), n: 5 }))).toContain('gains the 5 the Tithe took');
    expect(describeEvent(s, e({ k: 'lockout', seat: foe, turns: 2 }))).toContain('left an alliance: no new alliance for 2 of their turns.');
  });
});

describe('when the engine refuses an AI', () => {
  it('the fallback places the Draft before ending it, so a refused move never stalls the turn', () => {
    const { s, rng } = war(['mars', 'pluto', 'ceres']);
    const seat = s.cur;
    expect(s.phase).toBe('draft');
    expect(s.ts.reinforcements).toBeGreaterThan(0);
    // What the fallback used to play: End Draft with armies in hand, which is refused too.
    expect(act(clone(s), seat, { type: 'endDraft' }, ctx(rng)).ok).toBe(false);
    const a = botFallback(s, seat);
    expect(a).toMatchObject({ type: 'place', n: s.ts.reinforcements });
    ok(act(s, seat, a, ctx(rng)));
    expect(botFallback(s, seat)).toEqual({ type: 'endDraft' });
    ok(act(s, seat, botFallback(s, seat), ctx(rng)));
    expect(botFallback(s, seat)).toEqual({ type: 'endTurn' });
    ok(act(s, seat, botFallback(s, seat), ctx(rng)));
    expect(s.cur).not.toBe(seat);
  });
});
