import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { geoFor, mapGeo, HOUSES, LAYOUTS, MAX_PLAYERS, MIN_PLAYERS } from '../src/engine/data.ts';
import { CARD, CARDS, EMOTES } from '../src/engine/cards.ts';
import {
  act, actingSeat, aiDuty, allianceOf, attackTargets, BALANCE, createGame, geo, olympusPreview, passive, reinforcementBreakdown, viewFor,
  type GameState, type Action, NEUTRAL, clone, attackBlocker, fortifyRoute, resolveSettings, spreadSlices, TRAIL_MAX, territoriesOf,
  drainLog, kickToAI, primusBlocker, rallyBlocker, joinRallyBlocker, strongestSeat, rallySlots, modifyDice, inviteBlocker, EMOTE_COOLDOWN_MS,
  defenseMods, housesOwned, ownsHouse, passiveValue, pickHouse,
} from '../src/engine/engine.ts';
import { attackFight, defenseNote, keepWalls, standardFight, winChance } from '../src/ui/odds.ts';
import { describe as describeEvent } from '../src/ui/copy.ts';
import { botAction } from '../src/engine/bot.ts';

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ctx = (rng: () => number, now = 0) => ({ rng, now });

function passage(s: GameState, rng: () => number) {
  for (const p of s.players) {
    const r = act(s, p.seat, { type: 'choose', card: s.priv!.passage[p.seat]![0] }, ctx(rng));
    expect(r).toEqual({ ok: true });
  }
}

describe('map', () => {
  for (let L = 0; L < LAYOUTS.length; L++) for (const seed of [undefined, 1, 7, 12345]) {
    const g = mapGeo(L, seed);
    const T = g.territories;
    const n = `Layout ${L} seed ${seed ?? 'legacy'}`;
    it(`${n}: ${g.nt} connected territories with sane sizes`, () => {
      expect(g.nt).toBe(7 * g.perHouse);
      for (let t = 0; t < g.nt; t++) {
        expect(g.hexes.filter((h) => h.t === t).length).toBeGreaterThanOrEqual(5);
        expect(g.adj[t].length).toBeGreaterThan(0);
      }
      expect(Math.max(...g.dist.flat())).toBeLessThan(Infinity);
      g.adj.forEach((ns, t) => ns.forEach((x) => expect(g.adj[x]).toContain(t)));
    });
    it(`${n}: every Keep is walled in by its own land`, () => {
      for (const k of T.filter((t) => t.isKeep)) {
        for (const t of T) if (t.house !== k.house) expect(g.dist[k.id][t.id], `${k.name} → ${t.name}`).toBeGreaterThanOrEqual(3);
      }
    });
    it(`${n}: land bridges join every quadrant to its neighbours, and ports cross the water`, () => {
      const landLinked = (a: number, b: number) => T.some((t) => t.quadrant === a && g.adj[t.id].some((x) => T[x].quadrant === b && t.port !== x));
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) expect(landLinked(a, b), `${a}-${b}`).toBe(true);
      if (seed == null) { expect(g.ports).toHaveLength(0); return; }
      expect(g.ports.length).toBe(3);
      for (const [a, b] of g.ports) {
        expect(T[a].quadrant).not.toBe(T[b].quadrant);
        expect(T[a].port).toBe(b);
        expect(g.adj[a]).toContain(b);
      }
      const far = g.ports.map(([a, b]) => [T[a].quadrant, T[b].quadrant].sort().join());
      expect(far).toContain('0,2');
      expect(far).toContain('1,3');
    });
    it(`${n}: every territory is in exactly one bonus region`, () => {
      const seen = g.regions.flatMap((r) => r.terr);
      expect(new Set(seen).size).toBe(g.nt);
      expect(seen.length).toBe(g.nt);
      for (const r of g.regions) {
        expect(r.bonus).toBeGreaterThanOrEqual(1);
        expect(r.terr.length).toBeLessThanOrEqual(7);
        for (const t of r.terr) expect(T[t].region).toBe(r.id);
      }
      expect(g.regions.length).toBeGreaterThanOrEqual(21);
    });
  }
  it('every war rolls its own crossings, and the same seed rebuilds the same map', () => {
    expect(mapGeo(3, 5)).toBe(mapGeo(3, 5));
    const shapes = new Set([1, 2, 3, 4, 5, 6].map((sd) => JSON.stringify(mapGeo(3, sd).ports)));
    expect(shapes.size).toBeGreaterThan(3);
  });
  it('grows with the player count, and the size setting nudges it', () => {
    expect(geoFor(4).nt).toBeGreaterThanOrEqual(84);
    for (let n = MIN_PLAYERS; n < MAX_PLAYERS; n++) expect(geoFor(n + 1).nt).toBeGreaterThan(geoFor(n).nt);
    expect(geoFor(4, 2).nt).toBeGreaterThan(geoFor(4).nt);
    expect(geoFor(4, -2).nt).toBeLessThan(geoFor(4).nt);
    expect(geoFor(7, 2)).toBe(mapGeo(LAYOUTS.length - 1));
  });
  it('every territory has a terrain', () => {
    const T = mapGeo(LAYOUTS.length - 1).territories;
    expect(T.every((t) => t.terrain)).toBe(true);
    expect(T.filter((t) => t.isKeep).every((t) => t.terrain === 'keep')).toBe(true);
  });
});

describe('cards', () => {
  it('have unique ids and valid houses', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) expect(c.house).toBeGreaterThanOrEqual(0);
  });
});

describe('setup', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    it(`deals a legal ${n}-player opening`, () => {
      const rng = mulberry(n * 77);
      const s = createGame(Array.from({ length: n }, (_, i) => `P${i}`), rng);
      const g = geo(s);
      expect(new Set(s.players.map((p) => p.house)).size).toBe(n);
      for (const p of s.players) {
        const keep = g.keepOf(p.house);
        const mine = s.owner.flatMap((o, t) => (o === p.seat ? [t] : []));
        expect(mine.length).toBeGreaterThanOrEqual(4);
        expect(mine.length).toBeLessThan(g.perHouse);
        expect(mine.every((t) => g.territories[t].house === p.house && g.dist[keep][t] <= 1)).toBe(true);
        expect(s.owner[keep]).toBe(p.seat);
        expect(mine.reduce((a, t) => a + s.armies[t], 0)).toBe(s.opts.troops);
        // Choose your Primus: every Character of the player's own House, and nothing else.
        expect(s.priv!.passage[p.seat]).toEqual(CARDS.filter((c) => c.kind === 'character' && c.house === p.house).map((c) => c.id));
        expect(s.priv!.passage[p.seat]!.length).toBe(HOUSES[p.house].id === 'mars' ? 7 : 5);
        // Nobody starts touching another player: there's neutral land in between.
        for (const t of mine) for (const x of g.adj[t]) expect(s.owner[x] === p.seat || s.owner[x] === NEUTRAL).toBe(true);
      }
      expect(s.owner.some((o) => o === NEUTRAL)).toBe(true);
    });
  }
  it('settings pick the valley size, the troops, and switch alliances and the siege off', () => {
    const rng = mulberry(8);
    const s = createGame(['A', 'B', 'C'], rng, { settings: { size: 2, troops: 2, alliances: false, siege: true } });
    expect(s.opts.layout).toBe(resolveSettings(3).layout + 2);
    expect(s.opts.troops).toBeGreaterThan(resolveSettings(3, { size: 2 }).troops);
    expect(s.opts.alliances).toBe(false);
    expect(s.opts.siege).toBe(false); // no alliances, no siege
    passage(s, rng);
    s.warBegun = true;
    expect(act(s, s.cur, { type: 'invite', to: (s.cur + 1) % 3, public: true }, ctx(rng))).toEqual({ ok: false, err: 'Alliances are off in this war.' });
  });
  it('spreads the players out: Keeps as far apart as possible, then the fewest touching slices', () => {
    for (const n of [2, 3, 4]) {
      const g = geoFor(n);
      const keeps = HOUSES.map((_, sl) => g.keepOfSlice(sl));
      // The best possible smallest Keep-to-Keep distance for n slices, by brute force.
      let best = 0;
      const walk = (from: number, pick: number[]) => {
        if (pick.length === n) { let m = Infinity; for (const a of pick) for (const b of pick) if (a < b) m = Math.min(m, g.dist[keeps[a]][keeps[b]]); best = Math.max(best, m); return; }
        for (let x = from; x < 7; x++) walk(x + 1, [...pick, x]);
      };
      walk(0, []);
      for (let i = 0; i < 15; i++) {
        const sl = spreadSlices(g, n, Math.random);
        expect(new Set(sl).size).toBe(n);
        let m = Infinity;
        for (const a of sl) for (const b of sl) if (a !== b) m = Math.min(m, g.dist[keeps[a]][keeps[b]]);
        expect(m).toBe(best);
      }
    }
    const g3 = geoFor(3);
    for (let i = 0; i < 20; i++) {
      const hs = spreadSlices(g3, 3, Math.random);
      for (const a of hs) for (const b of hs) if (a !== b) expect(g3.dist[g3.keepOfSlice(a)][g3.keepOfSlice(b)]).toBeGreaterThan(5);
    }
  });
  it('deals random Houses onto the spread slices, and neutral Houses fill the rest', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const rng = mulberry(500 + k);
      const s = createGame(['A', 'B', 'C'], rng);
      const g = geo(s);
      const deal = s.opts.houses!;
      expect([...deal].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      for (const p of s.players) {
        seen.add(p.house);
        const sl = deal.indexOf(p.house);
        expect(g.keepOf(p.house)).toBe(g.keepOfSlice(sl));
        expect(g.territories[g.keepOf(p.house)].house).toBe(p.house);
        expect(s.standards[p.house].at).toBe(g.keepOf(p.house));
        expect(s.owner[g.keepOf(p.house)]).toBe(p.seat);
      }
      // Slices keep their land: names and quadrants don't move with the House.
      expect(g.territories.map((t) => t.name)).toEqual(mapGeo(s.opts.layout, s.opts.seed).territories.map((t) => t.name));
      expect(g.territories.every((t) => t.house === deal[t.slice])).toBe(true);
      for (const r of g.regions) expect(r.house).toBe(deal[g.territories[r.terr[0]].slice]);
      for (let h = 0; h < 7; h++) if (!s.players.some((p) => p.house === h)) {
        expect(s.owner[g.keepOf(h)]).toBe(NEUTRAL);
        expect(s.armies[g.keepOf(h)]).toBe(BALANCE.neutralKeep);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6); // any House can be drawn
  });
  it('wars without a deal keep House i on slice i', () => {
    const rng = mulberry(77);
    const s = createGame(['A', 'B'], rng);
    delete s.opts.houses;
    const g = geo(s);
    expect(g.sliceHouse).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(g.keepOf(3)).toBe(g.keepOfSlice(3));
  });
  it('Choose your Primus: every player picks a Character of their House, nobody dies, and the war starts', () => {
    const rng = mulberry(5);
    const s = createGame(['A', 'B', 'C'], rng);
    expect(s.opts.pick).toBe(true);
    expect(s.phase).toBe('passage');
    const chars = CARDS.filter((c) => c.kind === 'character').map((c) => c.id);
    const offered = s.priv!.passage.flatMap((p) => p!);
    // The deck starts with everything that isn't on offer.
    expect([...s.priv!.deck].sort()).toEqual(CARDS.map((c) => c.id).filter((id) => !offered.includes(id)).sort());
    // A Character of another House is refused.
    const foreign = chars.find((id) => CARD[id].house !== s.players[0].house)!;
    expect(act(s, 0, { type: 'choose', card: foreign }, ctx(rng))).toEqual({ ok: false, err: 'That Character is not of your House.' });
    expect(act(s, 0, { type: 'place', t: 0, n: 1 }, ctx(rng))).toEqual({ ok: false, err: 'Every House must first choose its Primus.' });
    passage(s, rng);
    expect(act(s, 0, { type: 'choose', card: offered[0] }, ctx(rng))).toEqual({ ok: false, err: 'Every Primus is already chosen.' });
    expect(s.phase).toBe('draft');
    expect(s.killed).toEqual([]);
    expect(s.priv!.discard).toEqual([]);
    expect(s.players.every((p) => p.general && CARD[p.general].house === p.house)).toBe(true);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, s.cur).total);
    // The Characters nobody chose were shuffled into the deck: every card is in the deck or leads a House.
    const generals = s.players.map((p) => p.general!);
    expect(s.priv!.deck.length).toBe(CARDS.length - 3);
    expect([...s.priv!.deck, ...generals].sort()).toEqual(CARDS.map((c) => c.id).sort());
    for (const id of offered) expect(s.priv!.deck.includes(id)).toBe(!generals.includes(id));
    // The log names each Primus, and no card was killed.
    const evs = s.log.filter((e) => e.k === 'passage');
    expect(evs.map((e) => e.general)).toEqual(generals);
    expect(evs.every((e) => !('killed' in e))).toBe(true);
    expect(describeEvent(s, evs[0])).toContain('as its Primus');
    expect(s.log.filter((e) => e.k === 'chosen').length).toBe(3);
  });
  it('a player who concedes while the others choose gives their Characters back to the deck', () => {
    const rng = mulberry(6);
    const s = createGame(['A', 'B', 'C'], rng);
    act(s, 0, { type: 'choose', card: s.priv!.passage[0]![1] }, ctx(rng));
    act(s, 1, { type: 'choose', card: s.priv!.passage[1]![0] }, ctx(rng));
    expect(act(s, 2, { type: 'concede' }, ctx(rng)).ok).toBe(true);
    expect(s.phase).toBe('draft');
    expect(s.priv!.deck.length).toBe(CARDS.length - 2);
    expect(new Set(s.priv!.deck).size).toBe(s.priv!.deck.length);
  });
  it('picked Houses are honoured and never duplicated, and Random fills the rest', () => {
    for (let k = 0; k < 40; k++) {
      const rng = mulberry(900 + k);
      // Seats 0 and 3 pick; seat 2 asks for a House seat 0 already holds (first come, first served); seat 4 sends junk.
      const picks = [3, null, 3, 6, 99 as number, null];
      const s = createGame(['A', 'B', 'C', 'D', 'E', 'F'], rng, { houses: picks });
      const hs = s.players.map((p) => p.house);
      expect(hs[0]).toBe(3);
      expect(hs[3]).toBe(6);
      expect(new Set(hs).size).toBe(6);
      expect(hs.every((h) => h >= 0 && h < 7)).toBe(true);
      const sorted = s.log.filter((e) => e.k === 'sorted');
      expect(sorted.map((e) => e.picked)).toEqual([true, false, false, true, false, false]);
      expect(sorted.map((e) => e.house)).toEqual(hs);
      // The pick chooses the House, not the position: the map is still a full deal, with the Keep under its House.
      const g = geo(s);
      expect([...s.opts.houses!].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
      for (const p of s.players) expect(s.owner[g.keepOf(p.house)]).toBe(p.seat);
    }
    // Everyone on Random: all seven Houses can still come up, and no `picked` flag is set.
    const seen = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const s = createGame(['A', 'B', 'C'], mulberry(40 + k), { houses: [null, null, null] });
      s.players.forEach((p) => seen.add(p.house));
      expect(s.log.filter((e) => e.k === 'sorted').every((e) => e.picked === false)).toBe(true);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    // All seven seats picked: the deal is exactly the picks.
    const full = createGame(['A', 'B', 'C', 'D', 'E', 'F', 'G'], mulberry(3), { houses: [6, 5, 4, 3, 2, 1, 0] });
    expect(full.players.map((p) => p.house)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    // The spread of the slices doesn't change with picks: the same rng gives the same slices either way.
    const a = createGame(['A', 'B', 'C'], mulberry(77)), b = createGame(['A', 'B', 'C'], mulberry(77), { houses: [2, null, 5] });
    const slices = (x: GameState) => x.players.map((p) => x.opts.houses!.indexOf(p.house));
    expect(slices(b)).toEqual(slices(a));
    expect(b.players[0].house).toBe(2);
    expect(b.players[2].house).toBe(5);
  });
  it('pickHouse: first come, first served; the host sets any seat and locks it; Random unlocks', () => {
    type Seat = { seat: number; name: string; ai?: boolean; house?: number | null; houseBy?: 'host' };
    const lobby0: Seat[] = [{ seat: 0, name: 'Host' }, { seat: 1, name: 'Guest' }, { seat: 2, name: 'Bot', ai: true }];
    const ok = (r: ReturnType<typeof pickHouse<Seat>>) => { if (!r.ok) throw new Error(r.err); return r.lobby; };
    // A player picks their own House. The lobby passed in is not changed.
    let lobby = ok(pickHouse(lobby0, 1, 3, false));
    expect(lobby[1]).toEqual({ seat: 1, name: 'Guest', house: 3 });
    expect(lobby0[1]).toEqual({ seat: 1, name: 'Guest' });
    // A second player cannot take the same House, by their own hand or the host's.
    expect(pickHouse(lobby, 0, 3, false)).toEqual({ ok: false, err: 'House Mars is taken.' });
    expect(pickHouse(lobby, 2, 3, true)).toEqual({ ok: false, err: 'House Mars is taken.' });
    // Picking the House you already hold is fine, and so is changing it.
    lobby = ok(pickHouse(lobby, 1, 3, false));
    lobby = ok(pickHouse(lobby, 1, 0, false));
    expect(lobby[1].house).toBe(0);
    // The host sets a House for an AI and for a player: both are locked.
    lobby = ok(pickHouse(lobby, 2, 4, true));
    expect(lobby[2]).toMatchObject({ house: 4, houseBy: 'host' });
    lobby = ok(pickHouse(lobby, 1, 5, true));
    expect(lobby[1]).toMatchObject({ house: 5, houseBy: 'host' });
    // The locked player can no longer change it, not even back to Random.
    expect(pickHouse(lobby, 1, 0, false).ok).toBe(false);
    expect(pickHouse(lobby, 1, null, false)).toEqual({ ok: false, err: 'The host set your House. Ask them to set it back to Random.' });
    // The host sets it back to Random: unlocked, and the player picks again.
    lobby = ok(pickHouse(lobby, 1, null, true));
    expect(lobby[1]).toEqual({ seat: 1, name: 'Guest' });
    lobby = ok(pickHouse(lobby, 1, 6, false));
    expect(lobby[1]).toEqual({ seat: 1, name: 'Guest', house: 6 });
    // A player goes back to Random by themselves too. The host's own pick is never locked.
    lobby = ok(pickHouse(lobby, 1, null, false));
    expect('house' in lobby[1]).toBe(false);
    lobby = ok(pickHouse(lobby, 0, 3, false));
    expect(lobby[0]).toEqual({ seat: 0, name: 'Host', house: 3 });
    // Junk is refused.
    expect(pickHouse(lobby, 9, 1, true)).toEqual({ ok: false, err: 'No such seat.' });
    expect(pickHouse(lobby, 1, 7, false)).toEqual({ ok: false, err: 'No such House.' });
    expect(pickHouse(lobby, 1, 1.5, false)).toEqual({ ok: false, err: 'No such House.' });
    expect(pickHouse(lobby, NaN, 1, false).ok).toBe(false);
    // What the server does at Start: the lobby's picks go to createGame, and the rest are drawn.
    const s = createGame(lobby.map((l) => l.name), mulberry(8), { ai: lobby.map((l) => !!l.ai), houses: lobby.map((l) => l.house ?? null) });
    expect(s.players[0].house).toBe(3);
    expect(s.players[2].house).toBe(4);
    expect([3, 4]).not.toContain(s.players[1].house);
  });
  it('a Primus works at its printed Passive in a .008 war; wars from before keep the House-match +1', () => {
    const rng = mulberry(12);
    const s = createGame(['A', 'B'], rng, { houses: [3, 2] }); // Mars, Minerva
    act(s, 0, { type: 'choose', card: 'cassius' }, ctx(rng)); // defKeep 1, a Mars card
    act(s, 1, { type: 'choose', card: 'cook' }, ctx(rng)); // draft 1, a Minerva card
    expect(passive(s, 0, 'defKeep')).toBe(1);
    expect(passive(s, 1, 'draft')).toBe(1);
    expect(passiveValue(CARD.cassius, 3, true)).toBe(1);
    expect(passiveValue(CARD.cassius, 3)).toBe(2);
    expect(passiveValue(CARD.cassius, 2)).toBe(1);
    // Cassius's own Keep: Walls +1 and his +1, not +3.
    const g = geo(s);
    expect(defenseMods(s, g.keepOf(3)).defHigh).toBe(2);
    // The same state as a war from before .008.
    const old = clone(s);
    delete old.opts.pick;
    expect(passive(old, 0, 'defKeep')).toBe(2);
    expect(passive(old, 1, 'draft')).toBe(2);
  });
  it('the AI chooses its Primus from every option', () => {
    const picks = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const rng = mulberry(300 + k);
      const s = createGame(['A', 'B', 'C'], rng, { ai: [true, true, true], houses: [3, null, null] });
      const a = botAction(viewFor(s, 0), 0, rng);
      expect(a.type).toBe('choose');
      const card = (a as { card: string }).card;
      expect(s.priv!.passage[0]).toContain(card);
      picks.add(card);
      expect(act(s, 0, a, ctx(rng)).ok).toBe(true);
    }
    // Not only the first two cards on offer.
    expect([...picks].some((c) => !['darrow', 'sevro'].includes(c))).toBe(true);
  });
  it('a war saved mid-Passage by the v.0071 engine finishes the old way and plays to the end', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/v0071-mid-passage.json', import.meta.url), 'utf8')) as GameState;
    const rng = mulberry(71);
    expect(s.opts.pick).toBeUndefined();
    expect(s.phase).toBe('passage');
    expect(s.priv!.passage.map((p) => p?.length ?? 0)).toEqual([0, 2, 2, 2]);
    // Seat 0 chose before the save and can't again.
    expect(act(s, 0, { type: 'choose', card: 'lyre' }, ctx(rng))).toEqual({ ok: false, err: 'You already walked out of the Passage.' });
    // The view still hides the pick, and the others still see their two cards.
    expect(viewFor(s, 1).players[0].general).toBe('?');
    expect(viewFor(s, 1).me!.passage!.length).toBe(2);
    for (const seat of [1, 2, 3]) {
      const [keep, dies] = s.priv!.passage[seat]!;
      expect(act(s, seat, { type: 'choose', card: keep }, ctx(rng)).ok).toBe(true);
      expect(s.killed.find((k) => k.seat === seat)!.card).toBe(dies);
      expect(s.priv!.discard).toContain(dies);
    }
    expect(s.phase).toBe('draft');
    expect(s.killed.length).toBe(4);
    expect(s.log.filter((e) => e.k === 'passage').every((e) => typeof e.killed === 'string')).toBe(true);
    expect(describeEvent(s, s.log.find((e) => e.k === 'chosen')!)).toContain('Passage');
    // Its Generals keep the House-match +1.
    const p = s.players.find((x) => x.general && CARD[x.general].passive);
    if (p) {
      const c = CARD[p.general!];
      expect(passive(s, p.seat, c.passive!.kind)).toBe(c.passive!.n + (c.house === p.house ? 1 : 0));
    }
    // And the war plays to the end on this engine, with no Ultimates.
    for (const x of s.players) x.ai = true;
    let now = 0;
    while (s.phase !== 'over' && s.turn < 600) {
      const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
      const r = act(s, seat, botAction(viewFor(s, seat), seat, rng), { rng, now });
      if (!r.ok) expect(act(s, actingSeat(s), s.reaction ? { type: 'react', card: null } : s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, { rng, now }).ok).toBe(true);
    }
    expect(s.phase).toBe('over');
    expect(s.v).toBe(2);
  });
  it('rolls a map seed for every war', () => {
    const a = createGame(['A', 'B'], mulberry(1)), b = createGame(['A', 'B'], mulberry(2));
    expect(a.opts.seed).toBeGreaterThan(0);
    expect(a.opts.seed).not.toBe(b.opts.seed);
    expect(geo(a).seed).toBe(a.opts.seed);
  });
});

describe('regions', () => {
  it('holding a whole region pays its bonus, and taking it is announced', () => {
    const { s, seat, rng, g } = setupDuel();
    const r = g.regions.find((x) => x.terr.some((t) => s.owner[t] !== seat) && x.terr.some((t) => s.owner[t] === seat))!;
    const missing = r.terr.filter((t) => s.owner[t] !== seat);
    for (const t of missing.slice(1)) s.owner[t] = seat;
    const to = missing[0];
    const from = r.terr.find((t) => t !== to && g.adj[t].includes(to)) ?? beside(s, seat, to);
    s.owner[from] = seat; s.armies[from] = 200; s.armies[to] = 1; s.owner[to] = NEUTRAL;
    const before = reinforcementBreakdown(s, seat).total;
    expect(act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng)).ok).toBe(true);
    expect(s.owner[to]).toBe(seat);
    const rb = reinforcementBreakdown(s, seat);
    expect(rb.regions.map((x) => x.i)).toContain(r.id);
    expect(rb.total).toBeGreaterThanOrEqual(before + r.bonus - 1);
    expect(s.log.some((e) => e.k === 'region' && e.region === r.id && e.seat === seat)).toBe(true);
  });
});

describe('turn timer', () => {
  it('passes the turn when time runs out, placing leftover armies on the front', () => {
    const rng = mulberry(44);
    const s = createGame(['A', 'B'], rng, { settings: { timer: 60 } });
    expect(s.opts.timer).toBe(60);
    for (const p of s.players) act(s, p.seat, { type: 'choose', card: s.priv!.passage[p.seat]![0] }, ctx(rng, 1000));
    const seat = s.cur, other = s.players.find((p) => p.seat !== seat)!.seat;
    expect(s.deadline).toBe(1000 + 60000);
    const left = s.ts.reinforcements;
    const armies = territoriesOf(s, seat).reduce((a, t) => a + s.armies[t], 0);
    expect(act(s, other, { type: 'turnTimeout' }, ctx(rng, 30000)).ok).toBe(false);
    expect(act(s, other, { type: 'turnTimeout' }, ctx(rng, 61001))).toEqual({ ok: true });
    expect(s.cur).toBe(other);
    expect(territoriesOf(s, seat).reduce((a, t) => a + s.armies[t], 0)).toBe(armies + left);
    expect(s.log.some((e) => e.k === 'timeUp' && e.seat === seat && e.placed === left)).toBe(true);
    expect(s.deadline).toBe(61001 + 60000);
  });
  it('is off by default', () => {
    const rng = mulberry(45);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    expect(s.deadline).toBeNull();
    expect(act(s, s.cur, { type: 'turnTimeout' }, ctx(rng, 1e12)).ok).toBe(false);
  });
});

describe('views', () => {
  it('hide other hands and Primus picks until everyone has chosen', () => {
    const rng = mulberry(9);
    const s = createGame(['A', 'B'], rng);
    const mine = s.priv!.passage[0]![0];
    act(s, 0, { type: 'choose', card: mine }, ctx(rng));
    const v = viewFor(s, 1);
    expect(v.priv).toBeNull();
    expect(v.players[0].general).toBe('?');
    expect(v.me!.seat).toBe(1);
    // Seat 1 sees its own options (its House's Characters) and nobody else's.
    expect(v.me!.passage).toEqual(s.priv!.passage[1]);
    expect(JSON.stringify(v)).not.toContain(`"${mine}"`);
    // The chooser sees their own pick, and has no options left. A spectator sees neither.
    expect(viewFor(s, 0).players[0].general).toBe(mine);
    expect(viewFor(s, 0).me!.passage).toBeNull();
    expect(viewFor(s, null).players[0].general).toBe('?');
    expect(viewFor(s, null).me).toBeUndefined();
    // When the last player has chosen, every Primus is public.
    act(s, 1, { type: 'choose', card: s.priv!.passage[1]![0] }, ctx(rng));
    expect(viewFor(s, 1).players[0].general).toBe(mine);
  });
});

function setupDuel(names = ['A', 'B'], seed = 11) {
  const rng = mulberry(seed);
  const s = createGame(names, rng);
  passage(s, rng);
  const seat = s.cur;
  const t = s.owner.findIndex((o) => o === seat);
  act(s, seat, { type: 'place', t, n: s.ts.reinforcements }, ctx(rng));
  s.priv!.hands[seat] = [];
  act(s, seat, { type: 'endDraft' }, ctx(rng));
  s.turn = 10; // past the first-round grace period
  return { s, seat, rng, g: geo(s) };
}
/** A territory `seat` holds that touches `target`. */
function beside(s: GameState, seat: number, target: number) {
  const g = geo(s);
  const from = g.adj[target][0];
  s.owner[from] = seat;
  return from;
}

describe('draft', () => {
  it('placements can be taken back one by one or all at once', () => {
    const rng = mulberry(21);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    const seat = s.cur;
    const [a, b] = s.owner.flatMap((o, t) => (o === seat ? [t] : []));
    const r0 = s.ts.reinforcements, a0 = s.armies[a], b0 = s.armies[b];
    act(s, seat, { type: 'place', t: a, n: 2 }, ctx(rng));
    act(s, seat, { type: 'place', t: b, n: 1 }, ctx(rng));
    expect(act(s, seat, { type: 'unplace', t: a, n: 3 }, ctx(rng)).ok).toBe(false);
    expect(act(s, seat, { type: 'unplace', t: a, n: 1 }, ctx(rng)).ok).toBe(true);
    expect(s.armies[a]).toBe(a0 + 1);
    expect(s.ts.reinforcements).toBe(r0 - 2);
    expect(act(s, seat, { type: 'undoDraft' }, ctx(rng)).ok).toBe(true);
    expect([s.armies[a], s.armies[b], s.ts.reinforcements]).toEqual([a0, b0, r0]);
    expect(act(s, seat, { type: 'undoDraft' }, ctx(rng)).ok).toBe(false);
  });
});

describe('combat rules', () => {
  it('conquering a territory with an enemy Standard dominates that House', () => {
    const { s, seat, rng, g } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!;
    const foeKeep = g.keepOf(foe.house);
    const from = beside(s, seat, foeKeep);
    s.armies[from] = 200;
    s.armies[foeKeep] = 1; s.standards[foe.house].guard = 0;
    const res = act(s, seat, { type: 'attack', from, to: foeKeep, blitz: true }, ctx(rng));
    expect(res.ok).toBe(true);
    expect(s.players[foe.seat].alive).toBe(false);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(seat);
    expect(s.owner.every((o) => o !== foe.seat)).toBe(true);
  });

  it('you can attack anything touching, and there is no limit on attacks', () => {
    const { s, seat, rng, g } = setupDuel();
    const from = s.owner.findIndex((o, t) => o === seat && g.adj[t].some((x) => s.owner[x] !== seat));
    s.armies[from] = 500;
    const target = attackTargets(s, seat, from)[0];
    expect(g.adj[from]).toContain(target);
    for (let i = 0; i < 12 && s.owner[target] !== seat; i++) {
      s.armies[target] = Math.max(s.armies[target], 40);
      expect(act(s, seat, { type: 'attack', from, to: target }, ctx(rng)).ok).toBe(true);
    }
  });

  it('a winning Standard attack enslaves the defenders', () => {
    const { s, seat, rng, g } = setupDuel();
    const me = s.players[seat];
    const from = g.keepOf(me.house);
    const to = g.adj[from][0];
    s.owner[to] = NEUTRAL; s.armies[to] = 4;
    s.armies[from] = 300;
    const res = act(s, seat, { type: 'attack', from, to, commit: 299 }, ctx(rng));
    expect(res.ok).toBe(true);
    expect(s.owner[to]).toBe(seat);
    expect(s.standards[me.house].at).toBe(to);
    expect(s.armies[to]).toBeGreaterThanOrEqual(4); // survivors + 4 enslaved
    expect(s.log.some((e) => e.k === 'stdBattle' && e.won && e.enslaved >= 4)).toBe(true);
  });

  it('a failed Standard attack hands your whole House to the defender', () => {
    const { s, seat, rng, g } = setupDuel();
    const me = s.players[seat];
    const foe = s.players.find((p) => p.seat !== seat)!;
    const from = g.keepOf(me.house);
    const to = g.adj[from][0];
    s.owner[to] = foe.seat; s.armies[to] = 500;
    s.armies[from] = 2;
    s.players[seat].general = 'roque'; // war cry adds +2, still hopeless
    s.priv!.hands[foe.seat] = [];
    const res = act(s, seat, { type: 'attack', from, to, commit: 1 }, ctx(rng));
    expect(res.ok).toBe(true);
    expect(s.players[seat].alive).toBe(false);
    expect(s.winner).toBe(foe.seat);
  });

  it('a defender holding a counter card gets a reaction window', () => {
    const { s, seat, rng, g } = setupDuel();
    const me = s.players[seat];
    const foe = s.players.find((p) => p.seat !== seat)!;
    const from = g.keepOf(me.house);
    const to = g.adj[from][0];
    s.owner[to] = foe.seat; s.armies[to] = 3; s.armies[from] = 40;
    s.priv!.hands[foe.seat] = [{ id: 'jackal', locked: false }];
    act(s, seat, { type: 'attack', from, to, commit: 20 }, ctx(rng, 1000));
    expect(s.reaction?.defender).toBe(foe.seat);
    expect(act(s, seat, { type: 'endAttack' }, ctx(rng)).ok).toBe(false);
    expect(act(s, seat, { type: 'timeout' }, ctx(rng, 2000)).ok).toBe(false);
    expect(act(s, foe.seat, { type: 'react', card: 'jackal' }, ctx(rng, 2000))).toEqual({ ok: true });
    expect(s.reaction).toBeNull();
    expect(s.log.some((e) => e.k === 'counter')).toBe(true);
  });

  it('refuses illegal moves', () => {
    const { s, seat, rng, g } = setupDuel();
    const other = s.players.find((p) => p.seat !== seat)!.seat;
    expect(act(s, other, { type: 'endAttack' }, ctx(rng)).ok).toBe(false);
    const mine = s.owner.findIndex((o) => o === seat);
    const far = s.owner.findIndex((o, t) => o !== seat && g.dist[mine][t] > 3);
    expect(act(s, seat, { type: 'attack', from: mine, to: far }, ctx(rng)).ok).toBe(false);
  });

  it('trading three cards gives 10 armies', () => {
    const rng = mulberry(3);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    const seat = s.cur;
    s.priv!.hands[seat] = ['pax', 'cook', 'lyre'].map((id) => ({ id, locked: false }));
    const before = s.ts.reinforcements;
    expect(act(s, seat, { type: 'trade', cards: ['pax', 'cook', 'lyre'] }, ctx(rng)).ok).toBe(true);
    expect(s.ts.reinforcements).toBe(before + 10);
  });
});

describe('reactions', () => {
  /** `seat` lined up against a rival territory, the rival holding `cards`. */
  function ambushSetup(cards: string[], foeArmies = 6) {
    const { s, seat, rng, g } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!.seat;
    const to = s.owner.findIndex((o, t) => o === foe && !g.territories[t].isKeep && standardAtT(s, t) < 0);
    const from = beside(s, seat, to);
    s.armies[from] = 60; s.armies[to] = foeArmies;
    s.priv!.hands[foe] = cards.map((id) => ({ id, locked: false }));
    return { s, seat, foe, from, to, rng, g };
  }
  const standardAtT = (s: GameState, t: number) => s.standards.findIndex((st) => !st.captured && st.at === t);

  it('any attack on a House holding a REACTION card waits for its answer', () => {
    const { s, seat, foe, from, to, rng } = ambushSetup(['weasel']);
    const before = s.armies.slice();
    expect(act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng, 1000))).toEqual({ ok: true });
    expect(s.reaction).toMatchObject({ defender: foe, from, to, commit: null, blitz: true });
    expect(s.armies).toEqual(before); // not a die cast yet
    expect(actingSeat(s)).toBe(foe);
    expect(act(s, seat, { type: 'endAttack' }, ctx(rng)).ok).toBe(false);
    expect(act(s, foe, { type: 'react', card: 'weasel' }, ctx(rng, 2000))).toEqual({ ok: true });
    expect(s.reaction).toBeNull();
    const counter = s.log.find((e) => e.k === 'counter')!;
    expect(counter).toMatchObject({ seat: foe, card: 'weasel', vs: seat, from, to });
    const battle = s.log.find((e) => e.k === 'battle')!;
    expect(battle.ph0).toBe(counter.n);
    expect(battle.m[5]).toBe(1); // +1 to every defense die
    expect(s.priv!.hands[foe]).toHaveLength(0);
  });

  it('the ambushers die last: the land holds until every phantom is down', () => {
    const { s, seat, foe, from, to, rng } = ambushSetup(['jackal'], 1);
    s.armies[from] = 3; // two can fight
    act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng, 1000));
    act(s, foe, { type: 'react', card: 'jackal' }, ctx(rng, 2000));
    // One real soldier plus 4+ phantoms with +1 on every die, against two attackers: the land holds.
    expect(s.owner[to]).toBe(foe);
  });

  it('a skipped ambush is not offered again in the same battle', () => {
    const { s, seat, foe, from, to, rng } = ambushSetup(['weasel'], 30);
    act(s, seat, { type: 'attack', from, to }, ctx(rng, 1000));
    expect(act(s, foe, { type: 'react', card: null }, ctx(rng, 2000))).toEqual({ ok: true });
    expect(s.log.filter((e) => e.k === 'battle')).toHaveLength(1);
    expect(act(s, seat, { type: 'attack', from, to }, ctx(rng, 3000))).toEqual({ ok: true });
    expect(s.reaction).toBeNull();
    expect(s.log.filter((e) => e.k === 'battle')).toHaveLength(2);
  });

  it('"skip until my turn" stops the prompts until that House\'s next turn, and can be taken back', () => {
    const { s, seat, foe, from, to, rng, g } = ambushSetup(['weasel'], 30);
    act(s, seat, { type: 'attack', from, to }, ctx(rng, 1000));
    expect(act(s, foe, { type: 'react', card: null, hold: true }, ctx(rng, 2000))).toEqual({ ok: true });
    expect(s.reactHold).toEqual([foe]);
    const other = s.owner.findIndex((o, t) => o === foe && t !== to && g.adj[t].some((x) => s.owner[x] === seat) && standardAtT(s, t) < 0);
    const from2 = g.adj[other].find((x) => s.owner[x] === seat)!;
    s.armies[from2] = 30; s.armies[other] = 30;
    act(s, seat, { type: 'attack', from: from2, to: other }, ctx(rng, 3000));
    expect(s.reaction).toBeNull();
    // Only the skipper sees its own setting.
    expect(viewFor(s, seat).reactHold).toEqual([]);
    expect(viewFor(s, foe).reactHold).toEqual([foe]);
    // Cancel it: prompted again.
    expect(act(s, foe, { type: 'holdReactions', on: false }, ctx(rng, 4000))).toEqual({ ok: true });
    s.ts.battle = null;
    act(s, seat, { type: 'attack', from: from2, to: other }, ctx(rng, 5000));
    expect(s.reaction?.defender).toBe(foe);
    act(s, foe, { type: 'react', card: null }, ctx(rng, 6000));
    // Its own turn clears it.
    expect(act(s, foe, { type: 'holdReactions', on: true }, ctx(rng))).toEqual({ ok: true });
    s.phase = 'fortify';
    act(s, seat, { type: 'endTurn' }, ctx(rng));
    expect(s.cur).toBe(foe);
    expect(s.reactHold).toEqual([]);
  });

  it('the attacker\'s turn clock stands still while the defender decides', () => {
    const { s, seat, foe, from, to, rng } = ambushSetup(['weasel'], 30);
    s.deadline = 50_000;
    act(s, seat, { type: 'attack', from, to }, ctx(rng, 10_000));
    act(s, foe, { type: 'react', card: null }, ctx(rng, 18_000));
    expect(s.deadline).toBe(58_000);
  });

  it('a Proctor REACTION only answers to the owner of its House', () => {
    const { s, seat, foe, from, to, rng } = ambushSetup(['p-pluto']);
    const ownsPluto = s.players[foe].house === HOUSES.findIndex((h) => h.id === 'pluto');
    act(s, seat, { type: 'attack', from, to }, ctx(rng, 1000));
    expect(s.reaction != null).toBe(ownsPluto);
  });

  it('bots save their ambush for what matters', () => {
    const { s, seat, foe, from, to, rng } = ambushSetup(['weasel'], 2);
    act(s, seat, { type: 'attack', from, to }, ctx(rng, 1000));
    expect(botAction(viewFor(s, foe), foe, rng)).toEqual({ type: 'react', card: null }); // 2 soldiers: not worth it
    s.armies[to] = 9;
    expect(botAction(viewFor(s, foe), foe, rng)).toEqual({ type: 'react', card: 'weasel' });
  });
});

describe("the Proctors' Book", () => {
  it('snapshots every turn start, and counts battles won only between Houses', () => {
    const { s, seat, rng, g } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!.seat;
    expect(s.stats!.hist.length).toBeGreaterThan(0);
    const h0 = s.stats!.hist.at(-1)!;
    expect(h0.t[seat]).toBeGreaterThan(0);
    // Beat a neutral: no battle won.
    const wild = s.owner.findIndex((o, t) => o === NEUTRAL && !g.territories[t].isKeep && g.adj[t].length > 0);
    const from1 = beside(s, seat, wild);
    s.armies[from1] = 3; s.armies[wild] = 2;
    act(s, seat, { type: 'attack', from: from1, to: wild, blitz: true }, ctx(rng));
    expect(s.stats!.won[seat]).toBe(0);
    // Take a rival's territory: a battle won.
    const to = s.owner.findIndex((o, t) => o === foe && s.standards.every((st) => st.at !== t));
    const from = beside(s, seat, to);
    s.armies[from] = 200; s.armies[to] = 1;
    s.priv!.hands[foe] = [];
    act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng));
    if (s.ts.mustMove) act(s, seat, { type: 'move', n: s.ts.mustMove.min }, ctx(rng));
    expect(s.stats!.won[seat]).toBe(1);
    const n = s.stats!.hist.length;
    s.phase = 'fortify';
    act(s, seat, { type: 'endTurn' }, ctx(rng));
    expect(s.stats!.hist.length).toBe(n + 1);
    expect(s.stats!.hist.at(-1)).toMatchObject({ seat: foe, turn: s.turn });
    expect(s.stats!.hist.at(-1)!.w[seat]).toBe(1);
  });

  it('a repelled blitz is a battle won for the defender', () => {
    const { s, seat, rng } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!.seat;
    const to = s.owner.findIndex((o, t) => o === foe && s.standards.every((st) => st.at !== t));
    const from = beside(s, seat, to);
    s.armies[from] = 2; s.armies[to] = 300;
    s.priv!.hands[foe] = [];
    act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng));
    expect(s.stats!.won[foe]).toBe(1);
  });

  it('only shows a secret alliance to its members', () => {
    const { s, seat, rng } = setupDuel(['A', 'B', 'C']);
    const [b, c] = s.players.filter((p) => p.seat !== seat).map((p) => p.seat);
    s.warBegun = true;
    act(s, seat, { type: 'invite', to: b, public: false }, ctx(rng));
    act(s, b, { type: 'answer', invite: s.invites[0].id, accept: true }, ctx(rng));
    s.phase = 'fortify';
    act(s, seat, { type: 'endTurn' }, ctx(rng));
    expect(s.stats!.hist.at(-1)!.al).toHaveLength(1);
    expect(viewFor(s, seat).stats!.hist.at(-1)!.al).toHaveLength(1);
    expect(viewFor(s, c).stats!.hist.at(-1)!.al).toHaveLength(0);
    expect(viewFor(s, null).stats!.hist.at(-1)!.al).toHaveLength(0);
  });
});

describe('alliances', () => {
  function threeWay(seed = 31) {
    const { s, seat, rng, g } = setupDuel(['A', 'B', 'C'], seed);
    const [b, c] = s.players.filter((p) => p.seat !== seat).map((p) => p.seat);
    return { s, a: seat, b, c, rng, g };
  }
  function ally(s: GameState, x: number, y: number, rng: () => number, pub = true) {
    s.warBegun = true;
    expect(act(s, x, { type: 'invite', to: y, public: pub }, ctx(rng))).toEqual({ ok: true });
    const inv = s.invites.find((i) => i.from === x && i.to === y)!;
    expect(act(s, y, { type: 'answer', invite: inv.id, accept: true }, ctx(rng))).toEqual({ ok: true });
  }

  it('open only after one House attacks another', () => {
    const { s, a, b, rng, g } = threeWay();
    expect(act(s, a, { type: 'invite', to: b, public: true }, ctx(rng)).ok).toBe(false);
    const target = s.owner.findIndex((o) => o === b);
    const from = beside(s, a, target);
    s.armies[from] = 30;
    act(s, a, { type: 'attack', from, to: target }, ctx(rng));
    expect(s.warBegun).toBe(true);
    expect(act(s, a, { type: 'invite', to: b, public: true }, ctx(rng)).ok).toBe(true);
    expect(g.nt).toBeGreaterThan(0);
  });

  it('invitations are quiet and secret alliances stay secret', () => {
    const { s, a, b, c, rng } = threeWay();
    s.warBegun = true;
    act(s, a, { type: 'invite', to: b, public: false }, ctx(rng));
    expect(viewFor(s, c).invites).toHaveLength(0);
    expect(viewFor(s, b).invites).toHaveLength(1);
    expect(viewFor(s, c).log.some((e) => e.k === 'invite')).toBe(false);
    act(s, b, { type: 'answer', invite: s.invites[0].id, accept: true }, ctx(rng));
    expect(allianceOf(s, a)?.members.sort()).toEqual([a, b].sort());
    expect(viewFor(s, c).alliances).toHaveLength(0);
    expect(viewFor(s, a).alliances).toHaveLength(1);
    expect(viewFor(s, c).log.some((e) => e.k === 'allianceFormed')).toBe(false);
  });

  it('one alliance per House: an invite to someone in a secret pact goes out, but they can\'t accept it', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, b, c, rng, false);
    const r = act(s, a, { type: 'invite', to: b, public: true }, ctx(rng));
    expect(r).toEqual({ ok: true }); // no "sworn to another alliance" error: the pact stays secret
    const inv = s.invites.find((i) => i.from === a && i.to === b)!;
    const before = clone(s);
    const res = act(s, b, { type: 'answer', invite: inv.id, accept: true }, ctx(rng));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.err).toMatch(/^You are already sworn to an alliance/);
    expect(s).toEqual(before);
    expect(allianceOf(s, b)?.members.sort()).toEqual([b, c].sort());
    expect(viewFor(s, a).alliances.some((x) => x.members.includes(b))).toBe(false);
    expect(act(s, b, { type: 'answer', invite: inv.id, accept: false }, ctx(rng)).ok).toBe(true);
  });

  it('members can still invite unallied Houses in', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, a, b, rng);
    ally(s, b, c, rng);
    expect(allianceOf(s, a)?.members.sort()).toEqual([a, b, c].sort());
  });

  it('a public alliance blocks invites into it from outside', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, b, c, rng, true);
    expect(inviteBlocker(s, a, b)).toMatch(/sworn to another alliance/);
  });

  it('leaving an alliance is logged, and (with Ultimates off) you sit out a full round', () => {
    const { s, a, b, c, rng } = threeWay();
    delete s.ult; // a war without House Ultimates keeps the one-round rule (the 2-turn lockout is in ultimates.test.ts)
    ally(s, a, b, rng, false);
    expect(act(s, a, { type: 'leaveAlliance' }, ctx(rng))).toEqual({ ok: true });
    expect(allianceOf(s, a)).toBeNull();
    expect(allianceOf(s, b)).toBeNull();
    const ev = s.log.at(-1)!;
    expect(ev).toMatchObject({ k: 'allianceEnds', leaver: a, dissolved: true });
    expect(ev.vis?.sort()).toEqual([a, b].sort()); // it was a secret pact
    expect(act(s, a, { type: 'leaveAlliance' }, ctx(rng)).ok).toBe(false);
    // Banned: can't invite or accept for a round.
    expect(inviteBlocker(s, a, c)).toMatch(/walked out/);
    s.invites.push({ id: 900, from: c, to: a, public: true, turn: s.turn });
    expect(act(s, a, { type: 'answer', invite: 900, accept: true }, ctx(rng)).ok).toBe(false);
    s.turn += 3;
    expect(act(s, a, { type: 'answer', invite: 900, accept: true }, ctx(rng))).toEqual({ ok: true });
    expect(allianceOf(s, a)?.members.sort()).toEqual([a, c].sort());
  });

  it('a sender can cancel a pending invite, and both sides hear of it', () => {
    const { s, a, b, c, rng } = threeWay();
    s.warBegun = true;
    act(s, a, { type: 'invite', to: b, public: false }, ctx(rng));
    const inv = s.invites[0];
    expect(act(s, b, { type: 'cancelInvite', invite: inv.id }, ctx(rng)).ok).toBe(false);
    expect(act(s, a, { type: 'cancelInvite', invite: inv.id }, ctx(rng))).toEqual({ ok: true });
    expect(s.invites).toHaveLength(0);
    expect(s.log.at(-1)).toMatchObject({ k: 'inviteCancelled', from: a, to: b, vis: [a, b] });
    expect(viewFor(s, c).log.some((e) => e.k === 'inviteCancelled')).toBe(false);
  });

  it('only the strongest House may open a Rally, capped at half the living Houses', () => {
    const { s, rng, g } = threeWay();
    // Seven Houses: floor(7/2) = 3 slots.
    const s7 = createGame(['A', 'B', 'C', 'D', 'E', 'F', 'G'], rng);
    passage(s7, rng);
    s7.warBegun = true;
    const big = s7.players[2].seat;
    const t = s7.owner.findIndex((o) => o === big);
    s7.armies[t] += 500;
    expect(strongestSeat(s7)).toBe(big);
    expect(rallySlots(s7)).toBe(3);
    expect(rallyBlocker(s7, 0)).toMatch(/strongest/);
    expect(act(s7, 0, { type: 'openRally' }, ctx(rng)).ok).toBe(false);
    expect(act(s7, big, { type: 'openRally' }, ctx(rng))).toEqual({ ok: true });
    expect(s7.rally).toMatchObject({ by: big, slots: 3 });
    expect(act(s7, 0, { type: 'openRally' }, ctx(rng)).ok).toBe(false); // one at a time
    // An existing secret ally of seat 1 answers: it's a betrayal to its old allies, and it joins a public alliance.
    s7.alliances.push({ id: 77, members: [1, 3], public: false, since: 0 });
    expect(act(s7, 1, { type: 'joinRally' }, ctx(rng))).toEqual({ ok: true });
    const defect = s7.log.find((e) => e.k === 'defect')!;
    expect(defect).toMatchObject({ seat: 1, by: big });
    expect(defect.vis?.sort()).toEqual([1, 3]);
    expect(allianceOf(s7, 3)).toBeNull(); // the old pact dissolved
    expect(allianceOf(s7, 1)).toMatchObject({ public: true });
    expect(allianceOf(s7, 1)!.members.sort()).toEqual([1, big].sort());
    expect(act(s7, 1, { type: 'joinRally' }, ctx(rng)).ok).toBe(false); // already in
    expect(act(s7, 4, { type: 'joinRally' }, ctx(rng))).toEqual({ ok: true });
    expect(allianceOf(s7, big)!.members.length).toBe(3);
    expect(s7.rally).toBeNull(); // full
    expect(s7.log.at(-1)).toMatchObject({ k: 'rallyClosed', why: 'full' });
    expect(act(s7, 5, { type: 'joinRally' }, ctx(rng)).ok).toBe(false);
    // Three Houses: floor(3/2) = 1 slot, so no Rally at all.
    s.warBegun = true;
    expect(rallySlots(s)).toBe(1);
    expect(g.nt).toBeGreaterThan(0);
  });

  it('a Rally expires at the rallier\'s next turn, and the rallier can cancel it', () => {
    const rng = mulberry(61);
    const s = createGame(['A', 'B', 'C', 'D'], rng);
    passage(s, rng);
    s.warBegun = true;
    const big = s.cur;
    s.armies[s.owner.findIndex((o) => o === big)] += 300;
    expect(act(s, big, { type: 'openRally' }, ctx(rng))).toEqual({ ok: true });
    const other = s.order.find((x) => x !== big)!;
    expect(act(s, other, { type: 'cancelRally' }, ctx(rng)).ok).toBe(false);
    expect(act(s, big, { type: 'cancelRally' }, ctx(rng))).toEqual({ ok: true });
    expect(s.rally).toBeNull();
    expect(act(s, big, { type: 'openRally' }, ctx(rng))).toEqual({ ok: true });
    // Play the round out: when the rallier's turn comes back around, the Rally is gone.
    for (let i = 0; i < 40 && s.rally; i++) {
      const seat = s.cur;
      if (s.phase === 'draft') { act(s, seat, { type: 'place', t: s.owner.findIndex((o) => o === seat), n: s.ts.reinforcements }, ctx(rng)); s.priv!.hands[seat] = []; act(s, seat, { type: 'endDraft' }, ctx(rng)); }
      act(s, seat, { type: 'endTurn' }, ctx(rng));
    }
    expect(s.rally).toBeNull();
    expect(s.cur).toBe(big);
    expect(s.log.some((e) => e.k === 'rallyClosed' && e.why === 'expired')).toBe(true);
  });

  it('a Rally needs alliances switched on', () => {
    const rng = mulberry(62);
    const s = createGame(['A', 'B', 'C', 'D'], rng, { settings: { alliances: false } });
    passage(s, rng);
    s.warBegun = true;
    s.armies[s.owner.findIndex((o) => o === s.cur)] += 300;
    expect(rallyBlocker(s, s.cur)).toMatch(/Alliances are off/);
    expect(joinRallyBlocker(s, s.cur)).toMatch(/no Rally/);
  });

  it('allies share their Generals\' Passives', () => {
    const { s, a, b, rng } = threeWay();
    s.players[a].general = 'cook'; // draft +1 (+1 if Minerva)
    s.players[b].general = 'miller'; // draft +1 (+1 if Ceres)
    const alone = passive(s, a, 'draft');
    ally(s, a, b, rng);
    expect(passive(s, a, 'draft')).toBeGreaterThan(alone);
    expect(passive(s, a, 'draft')).toBe(passive(s, b, 'draft'));
  });

  it('attacking an ally shatters the alliance', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, a, b, rng);
    ally(s, a, c, rng);
    expect(allianceOf(s, c)?.members.length).toBe(3);
    const target = s.owner.findIndex((o) => o === b);
    const from = beside(s, a, target);
    s.armies[from] = 30;
    expect(act(s, a, { type: 'attack', from, to: target }, ctx(rng)).ok).toBe(true);
    expect(s.alliances).toHaveLength(0);
    const ev = s.log.find((e) => e.k === 'betrayal')!;
    expect(ev.seat).toBe(a);
    expect(ev.victim).toBe(b);
    expect(ev.vis).toBeUndefined();
  });

  function clearTheBoard(s: GameState, keep: number[]) {
    for (const p of s.players) if (!keep.includes(p.seat)) { p.alive = false; s.standards[p.house].captured = true; s.standards[p.house].by = keep[0]; }
    s.standards.forEach((st, h) => { if (!s.players.some((p) => p.house === h)) { st.captured = true; st.by = keep[0]; } });
    s.owner = s.owner.map((o, t) => (keep.includes(o) ? o : keep[t % keep.length]));
  }

  it('Olympus can only be besieged by an alliance that stands alone, by majority vote', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, a, b, rng);
    expect(act(s, a, { type: 'proposeSiege' }, ctx(rng)).ok).toBe(false); // c and the neutrals still stand
    ally(s, a, c, rng);
    expect(act(s, a, { type: 'proposeSiege' }, ctx(rng)).ok).toBe(false); // neutral Standards remain
    clearTheBoard(s, [a, b, c]);
    expect(act(s, a, { type: 'proposeSiege' }, ctx(rng))).toEqual({ ok: true });
    expect(s.siege).toBeNull();
    expect(act(s, b, { type: 'vote', yes: false }, ctx(rng)).ok).toBe(true);
    expect(s.siege).toBeNull();
    expect(act(s, c, { type: 'vote', yes: true }, ctx(rng)).ok).toBe(true);
    expect(s.siege).not.toBeNull();
    expect(s.siege!.proctors.length).toBe(3);
    expect(s.siege!.garrison).toBe(olympusPreview(s, [a, b, c]).garrison);
  });

  it('a successful assault on Olympus wins for the whole alliance', () => {
    const { s, a, b, c, rng, g } = threeWay();
    ally(s, a, b, rng); ally(s, a, c, rng);
    clearTheBoard(s, [a, b, c]);
    act(s, a, { type: 'proposeSiege' }, ctx(rng));
    act(s, b, { type: 'vote', yes: true }, ctx(rng));
    const foot = g.foot[0];
    s.owner[foot] = a; s.armies[foot] = 2000;
    s.phase = 'attack'; s.cur = a;
    const inland = g.territories.find((t) => !t.foot)!.id;
    s.owner[inland] = a; s.armies[inland] = 50;
    expect(act(s, a, { type: 'assault', from: inland }, ctx(rng)).ok).toBe(false);
    expect(act(s, a, { type: 'assault', from: foot, blitz: true }, ctx(rng))).toEqual({ ok: true });
    expect(s.phase).toBe('over');
    expect(s.winners.sort()).toEqual([a, b, c].sort());
    // The final tally: every defender the garrison started with fell to House a.
    const end = s.log.find((e) => e.k === 'olympusFalls')!;
    expect(end.dmg[a]).toBe(end.start);
    expect(end.hits[a]).toBe(1);
    expect(s.log.find((e) => e.k === 'assault')!.proctor).toBe(`p-${HOUSES[s.players[a].house].id}`);
  });

  it('a siege that runs out of time breaks the alliance', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, a, b, rng); ally(s, a, c, rng);
    clearTheBoard(s, [a, b, c]);
    act(s, a, { type: 'proposeSiege' }, ctx(rng));
    act(s, b, { type: 'vote', yes: true }, ctx(rng));
    for (let i = 0; i < 3 * BALANCE.olyRounds + 1 && s.siege; i++) {
      s.phase = 'fortify';
      expect(act(s, s.cur, { type: 'endTurn' }, ctx(rng)).ok).toBe(true);
    }
    expect(s.siege).toBeNull();
    expect(s.alliances).toHaveLength(0);
    expect(s.log.some((e) => e.k === 'siegeFailed')).toBe(true);
    expect(HOUSES.length).toBe(7);
  });
});

function runBotGame(n: number, seed: number) {
  const rng = mulberry(seed);
  const s = createGame(Array.from({ length: n }, (_, i) => `Bot${i}`), rng);
  let steps = 0, errors = 0, now = 0;
  while (s.phase !== 'over' && steps < 60000 && s.turn < 500) {
    steps++; now += 1000;
    const duty = aiDuty(s);
    const seat = duty >= 0 ? duty : actingSeat(s);
    const snapshot = clone(s);
    const a: Action = botAction(viewFor(s, seat), seat, rng);
    const r = act(s, seat, a, ctx(rng, now));
    if (!r.ok) {
      errors++;
      expect(s).toEqual(snapshot); // failed actions must not mutate state
      const fallback: Action = s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' };
      if (!act(s, actingSeat(s), fallback, ctx(rng, now)).ok) throw new Error(`stuck: ${r.err} / ${JSON.stringify(a)}`);
    }
    for (let t = 0; t < s.owner.length; t++) {
      expect(s.armies[t]).toBeGreaterThanOrEqual(0);
      if (s.owner[t] >= 0) expect(s.players[s.owner[t]].alive).toBe(true);
    }
    for (const al of s.alliances) for (const m of al.members) expect(s.players[m].alive).toBe(true);
  }
  return { s, steps, errors };
}

describe('terrain and dice', () => {
  const Z = { atkHigh: 0, atkLow: 0, atkAll: 0, defHigh: 0, defLow: 0, defAll: 0 };
  it('mountains add 1 to the lowest COMPARED attack die; forests 1 to the lowest defense die', () => {
    const a = [6, 4, 2], d = [5, 3];
    modifyDice(a, d, { ...Z, atkLow: 1, defLow: 1 });
    expect(a).toEqual([6, 5, 2]); // index min(3, 2) - 1 = 1, the third die isn't compared
    expect(d).toEqual([5, 4]);
    const a1 = [3], d1 = [5, 2];
    modifyDice(a1, d1, { ...Z, atkLow: 1, atkHigh: 1 });
    expect(a1).toEqual([5]); // one die: it's both the highest and the lowest compared
    const a2 = [5, 5], d2 = [6];
    modifyDice(a2, d2, { ...Z, atkLow: 1 });
    expect(a2).toEqual([6, 5]);
  });
  function houseFight(terrain: 'forest' | 'mountain') {
    const { s, seat, rng, g } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!.seat;
    const T = g.territories;
    if (terrain === 'forest') {
      const to = T.find((t) => t.terrain === 'forest' && !t.isKeep)!.id;
      const from = g.adj[to].find((x) => T[x].terrain !== 'mountain')!;
      return { s, seat, rng, g, from, to, foe };
    }
    const from = T.find((t) => t.terrain === 'mountain')!.id;
    const to = g.adj[from].find((x) => T[x].terrain !== 'forest' && !T[x].isKeep)!;
    return { s, seat, rng, g, from, to, foe };
  }
  it('a House defending a forest gets cover on its lowest die, and it shows in the log', () => {
    const { s, seat, rng, from, to, foe } = houseFight('forest');
    s.owner[from] = seat; s.owner[to] = foe; s.armies[to] = 3; s.armies[from] = 10;
    expect(act(s, seat, { type: 'attack', from, to }, ctx(rng)).ok).toBe(true);
    const ev = [...s.log].reverse().find((e) => e.k === 'battle')!;
    expect(ev.tD).toBe(BALANCE.forestDef);
    const r = ev.rolls[0];
    expect(r.d.at(-1) - r.raw.d.at(-1)).toBe(1);
    if (r.d.length > 1) expect(r.d[0]).toBe(r.raw.d[0]);
  });
  it('attacking from the mountains lifts the lowest compared attack die', () => {
    const { s, seat, rng, from, to, foe } = houseFight('mountain');
    s.owner[from] = seat; s.armies[from] = 10; s.owner[to] = foe; s.armies[to] = 3;
    expect(act(s, seat, { type: 'attack', from, to }, ctx(rng)).ok).toBe(true);
    const ev = [...s.log].reverse().find((e) => e.k === 'battle')!;
    expect(ev.tA).toBe(BALANCE.mountainAtk);
    const r = ev.rolls[0];
    const k = Math.min(r.a.length, r.d.length) - 1;
    expect(r.a[k] - r.raw.a[k]).toBe(1);
    expect(r.a[2] - r.raw.a[2]).toBe(k === 2 ? 1 : 0);
  });
  it('terrain never counts against a neutral defender', () => {
    for (const kind of ['forest', 'mountain'] as const) {
      const { s, seat, rng, from, to } = houseFight(kind);
      s.owner[from] = seat; s.armies[from] = 10; s.owner[to] = NEUTRAL; s.armies[to] = 8;
      expect(act(s, seat, { type: 'attack', from, to }, ctx(rng)).ok).toBe(true);
      const ev = [...s.log].reverse().find((e) => e.k === 'battle')!;
      expect([ev.tA, ev.tD]).toEqual([0, 0]);
      expect(ev.rolls[0].a).toEqual(ev.rolls[0].raw.a);
      expect(ev.rolls[0].d).toEqual(ev.rolls[0].raw.d);
    }
  });
  it('a fortify march never halts on rough ground', () => {
    const { s, seat, rng, g } = setupDuel();
    const T = g.territories;
    s.phase = 'fortify';
    let a = -1, rough = -1, b = -1;
    for (const t of T) {
      if (!['mountain', 'water', 'marsh'].includes(t.terrain)) continue;
      const ns = g.adj[t.id];
      for (const x of ns) for (const y of ns) if (x !== y && !g.adj[x].includes(y) && a < 0) { a = x; rough = t.id; b = y; }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    s.owner = s.owner.map(() => NEUTRAL);
    for (const t of [a, rough, b]) s.owner[t] = seat;
    s.armies[a] = 10; s.armies[rough] = 1; s.armies[b] = 1;
    expect(fortifyRoute(s, seat, a, b)).toEqual({ path: [a, rough, b], stop: b });
    expect(act(s, seat, { type: 'fortify', from: a, to: b, n: 6 }, ctx(rng))).toEqual({ ok: true });
    expect([s.armies[a], s.armies[rough], s.armies[b]]).toEqual([4, 1, 7]);
    expect(s.log.at(-1)).toMatchObject({ k: 'fortify', from: a, to: b, path: [a, rough, b] });
    expect(s.log.at(-1)!.aim).toBeUndefined();
  });
});

describe('neutrals and Keeps', () => {
  /** A neutral territory next to one of `seat`'s, that isn't a Keep. */
  function wild(s: GameState, seat: number) {
    const g = geo(s);
    const to = g.territories.find((t) => !t.isKeep && s.owner[t.id] === NEUTRAL && g.adj[t.id].some((x) => !g.territories[x].isKeep))!.id;
    const from = g.adj[to].find((x) => !g.territories[x].isKeep)!;
    s.owner[from] = seat;
    return { from, to };
  }
  it('a neutral garrison facing twice its number yields: no dice, no losses', () => {
    const { s, seat, rng } = setupDuel();
    const { from, to } = wild(s, seat);
    s.armies[to] = 4; s.armies[from] = 9; // 8 attackers ≥ 2 × 4
    drainLog();
    expect(act(s, seat, { type: 'attack', from, to }, ctx(rng))).toEqual({ ok: true });
    expect(s.owner[to]).toBe(seat);
    expect(s.log.some((e) => e.k === 'battle' && e.to === to)).toBe(false);
    expect(s.log.find((e) => e.k === 'overwhelm')).toMatchObject({ seat, from, to, n: 8, garrison: 4 });
    const moved = s.ts.mustMove ? s.ts.mustMove.max : 0;
    expect(s.armies[from] + s.armies[to] + moved - (s.ts.mustMove ? moved : 0)).toBe(9); // nobody died
    expect(attackFight(s, seat, from, to).overwhelm).toBeFalsy();
  });
  it('one short of twice: it fights, with a single defense die', () => {
    const { s, seat, rng } = setupDuel();
    const { from, to } = wild(s, seat);
    s.armies[to] = 4; s.armies[from] = 8; // 7 attackers < 8
    expect(attackFight(s, seat, from, to)).toMatchObject({ overwhelm: false, defCap: 1 });
    expect(act(s, seat, { type: 'attack', from, to }, ctx(rng)).ok).toBe(true);
    const ev = s.log.find((e) => e.k === 'battle')!;
    expect(ev.rolls[0].d.length).toBe(1);
    expect(s.log.some((e) => e.k === 'overwhelm')).toBe(false);
  });
  it('a neutral Keep: exactly 10 behind its Walls (+1 highest die), 2 dice, never overwhelmed', () => {
    const rng = mulberry(71);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    const g = geo(s);
    const seat = s.cur;
    const nh = [0, 1, 2, 3, 4, 5, 6].find((h) => !s.players.some((p) => p.house === h))!;
    const keep = g.keepOf(nh);
    expect(s.armies[keep]).toBe(10);
    expect(s.standards[nh].guard).toBe(0);
    const from = g.adj[keep][0];
    s.owner[from] = seat; s.armies[from] = 200;
    s.phase = 'attack'; s.turn = 10;
    s.players[seat].general = 'cassius'; // defKeep: only for Keeps a House holds
    const f = attackFight(s, seat, from, keep);
    expect(f).toMatchObject({ overwhelm: false, defCap: 2, defHigh: BALANCE.keepWall, defLow: 0, defAll: 0, atkLow: 0, def: 10 });
    expect(BALANCE.keepWall).toBe(1);
    expect(defenseNote(s, from, keep)).toBe('neutral Keep');
    expect(keepWalls(s, keep)).toBe(1);
    expect(act(s, seat, { type: 'attack', from, to: keep }, ctx(rng)).ok).toBe(true);
    const ev = s.log.find((e) => e.k === 'battle')!;
    expect(ev.rolls[0].d.length).toBe(2);
    // The Walls lift the highest defense die, and only that one.
    expect(ev.rolls[0].d[0]).toBe(ev.rolls[0].raw.d[0] + 1);
    expect(ev.rolls[0].d[1]).toBe(ev.rolls[0].raw.d[1]);
    expect(ev.m[3]).toBe(1);
    // 20 armies (19 attacking) against the 10 behind Walls: about 83%. Without Walls, 15 armies did that.
    const z = { atkHigh: 0, atkLow: 0, atkAll: 0, defHigh: 0, defLow: 0, defAll: 0 };
    expect(winChance({ ...z, att: 19, def: 10, defCap: 2, defHigh: 1 })).toBeCloseTo(0.83, 2);
    expect(winChance({ ...z, att: 14, def: 10, defCap: 2, defHigh: 1 })).toBeCloseTo(0.56, 2);
  });
  it('taking a neutral Keep captures its House and nothing else: the rest of its land stays neutral', () => {
    const rng = mulberry(71);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    const g = geo(s);
    const seat = s.cur;
    const nh = [0, 1, 2, 3, 4, 5, 6].find((h) => !s.players.some((p) => p.house === h))!;
    const keep = g.keepOf(nh);
    const from = g.adj[keep][0];
    s.owner[from] = seat; s.armies[from] = 400;
    s.phase = 'attack'; s.turn = 10;
    const others = g.territories.filter((t) => t.house === nh && t.id !== keep && s.owner[t.id] === NEUTRAL).map((t) => t.id);
    expect(others.length).toBeGreaterThan(3);
    const owner0 = s.owner.slice();
    expect(act(s, seat, { type: 'attack', from, to: keep, blitz: true }, ctx(rng)).ok).toBe(true);
    expect(s.owner[keep]).toBe(seat);
    // One territory changed hands.
    expect(s.owner.flatMap((o, t) => (o !== owner0[t] ? [t] : []))).toEqual([keep]);
    for (const t of others) expect(s.owner[t]).toBe(NEUTRAL);
    // The captor owns the House: its Standard, its card boosts, its Proctor.
    expect(s.standards[nh]).toMatchObject({ captured: true, by: seat });
    expect(ownsHouse(s, seat, nh)).toBe(true);
    expect(housesOwned(s, seat)).toContain(nh);
    expect(s.log.find((e) => e.k === 'stdCaptured')).toMatchObject({ house: nh, captor: seat, victim: null });
    expect(s.log.some((e) => e.k === 'neutralFall')).toBe(false);
    // The replay frame shows the one territory.
    const frame = s.trail.at(-1)!;
    expect(frame.d.filter((_, i) => i % 3 === 0)).toEqual(expect.arrayContaining([keep]));
    expect(frame.d.filter((_, i) => i % 3 === 0).every((t) => t === keep || t === from)).toBe(true);
  });
  it('Walls defend a Standard charge too, for a neutral Keep and for a House', () => {
    const { s, seat, g } = setupDuel();
    const me = s.players[seat], foe = s.players.find((p) => p.seat !== seat)!;
    const nh = [0, 1, 2, 3, 4, 5, 6].find((h) => !s.players.some((p) => p.house === h))!;
    for (const keep of [g.keepOf(nh), g.keepOf(foe.house)]) {
      const c = clone(s);
      const from = beside(c, seat, keep);
      c.armies[from] = 60; c.standards[me.house].at = from;
      c.players[foe.seat].general = 'pax';
      expect(standardFight(c, seat, from, keep, 40).defHigh).toBe(1);
      expect(act(c, seat, { type: 'attack', from, to: keep, commit: 40 }, ctx(mulberry(5))).ok).toBe(true);
      const ev = c.log.find((e) => e.k === 'stdBattle')!;
      expect(ev.m[3]).toBe(1);
      expect(ev.rolls[0].d[0]).toBe(ev.rolls[0].raw.d[0] + 1);
    }
  });
  it('a House\'s Keep has Walls (+1 highest die) and rolls 2 dice, with its Standard and honor guard', () => {
    const { s, seat, rng, g } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!;
    const keep = g.keepOf(foe.house);
    const from = beside(s, seat, keep);
    s.armies[from] = 10; s.armies[keep] = 1; s.standards[foe.house].guard = 5;
    s.players[foe.seat].general = 'pax'; // no defKeep
    const f = attackFight(s, seat, from, keep);
    expect(f).toMatchObject({ def: 6, defCap: 2, defAll: 0, defHigh: 1, defLow: 0 });
    expect(defenseNote(s, from, keep)).toBe('Keep');
    expect(winChance(f)).toBeCloseTo(0.58, 2); // 10 armies against 1 + 5 guard behind Walls
    // 13 armies against the same Keep: about 80%.
    expect(winChance({ ...f, att: 12 })).toBeCloseTo(0.8, 1);
    // Its General's defKeep stacks on the Walls, on the same die.
    const c = clone(s);
    c.players[foe.seat].general = 'cassius';
    expect(attackFight(c, seat, from, keep).defHigh).toBe(1 + passive(c, foe.seat, 'defKeep'));
    expect(attackFight(c, seat, from, keep).defHigh).toBeGreaterThanOrEqual(2);
    expect(keepWalls(c, keep)).toBe(attackFight(c, seat, from, keep).defHigh);
    expect(act(s, seat, { type: 'attack', from, to: keep }, ctx(rng)).ok).toBe(true);
    const ev = s.log.find((e) => e.k === 'battle')!;
    expect(ev.rolls[0].d.length).toBeLessThanOrEqual(2);
    expect(ev.rolls[0].d[0]).toBe(ev.rolls[0].raw.d[0] + 1);
    expect(ev.rolls[0].d.slice(1)).toEqual(ev.rolls[0].raw.d.slice(1));
    // Land that isn't a Keep has no Walls.
    const open = g.territories.find((t) => !t.isKeep && s.owner[t.id] === foe.seat)!.id;
    expect(defenseMods(s, open).defHigh).toBe(0);
    expect(keepWalls(s, open)).toBe(0);
  });
  it('the odds in the UI run the engine\'s own dice rules', () => {
    const { s, seat, rng } = setupDuel();
    const { from, to } = wild(s, seat);
    s.armies[to] = 3; s.armies[from] = 5;
    const p = winChance(attackFight(s, seat, from, to));
    let wins = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) {
      const c = clone(s);
      act(c, seat, { type: 'attack', from, to, blitz: true }, ctx(rng));
      if (c.owner[to] === seat) wins++;
    }
    expect(Math.abs(wins / N - p)).toBeLessThan(0.05);
  });
});

describe('the Standard', () => {
  it('can be raised once per turn', () => {
    const { s, seat, rng, g } = setupDuel();
    const me = s.players[seat];
    const from = g.keepOf(me.house);
    const [a, b] = g.adj[from];
    s.owner[a] = NEUTRAL; s.armies[a] = 2; s.owner[b] = NEUTRAL; s.armies[b] = 2;
    s.armies[from] = 300;
    expect(act(s, seat, { type: 'attack', from, to: a, commit: 50 }, ctx(rng))).toEqual({ ok: true });
    expect(s.ts.stdRaised).toBe(true);
    const at = s.standards[me.house].at;
    s.owner[b] = NEUTRAL;
    const next = g.adj[at].find((x) => s.owner[x] !== seat)!;
    s.owner[next] = NEUTRAL; s.armies[next] = 2;
    const r = act(s, seat, { type: 'attack', from: at, to: next, commit: 10 }, ctx(rng));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.err).toMatch(/once per turn/);
  });
});

describe('Primus', () => {
  /** Hand `seat` a conquered neutral Keep and a matching Character. */
  function keepWithCard(seed = 91) {
    const rng = mulberry(seed);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    const g = geo(s);
    const seat = s.cur;
    const nh = [0, 1, 2, 3, 4, 5, 6].find((h) => !s.players.some((p) => p.house === h) && CARDS.some((c) => c.kind === 'character' && c.house === h && c.passive?.kind === 'draft'))
      ?? [0, 1, 2, 3, 4, 5, 6].find((h) => !s.players.some((p) => p.house === h))!;
    const keep = g.keepOf(nh);
    const card = CARDS.find((c) => c.kind === 'character' && c.house === nh)!.id;
    const from = g.adj[keep][0];
    s.owner[from] = seat; s.armies[from] = 300;
    s.phase = 'attack'; s.turn = 10;
    s.priv!.hands[seat] = [{ id: card, locked: false }];
    for (const h of s.priv!.hands) if (h !== s.priv!.hands[seat]) h.splice(0);
    return { s, seat, rng, g, keep, card, nh, from };
  }
  it('conquering a Keep lets you swear in a matching Character; its Passive stacks, unshared', () => {
    const { s, seat, rng, g, keep, card, nh, from } = keepWithCard();
    expect(primusBlocker(s, seat, keep, card)).toMatch(/do not hold/);
    expect(act(s, seat, { type: 'attack', from, to: keep, blitz: true }, ctx(rng)).ok).toBe(true);
    expect(s.owner[keep]).toBe(seat);
    if (s.ts.mustMove) act(s, seat, { type: 'move', n: s.ts.mustMove.max }, ctx(rng));
    expect(s.ts.keepsTaken).toContain(keep);
    const kind = CARD[card].passive!.kind;
    const before = passive(s, seat, kind);
    // Wrong suit refused.
    const wrong = CARDS.find((c) => c.kind === 'character' && c.house !== nh)!.id;
    s.priv!.hands[seat].push({ id: wrong, locked: false });
    expect(act(s, seat, { type: 'primus', keep, card: wrong }, ctx(rng)).ok).toBe(false);
    expect(act(s, seat, { type: 'primus', keep: g.keepOf(s.players[seat].house), card }, ctx(rng)).ok).toBe(false); // not the home Keep
    expect(act(s, seat, { type: 'primus', keep, card }, ctx(rng))).toEqual({ ok: true });
    expect(s.primus![nh]).toEqual({ card, seat });
    expect(s.priv!.hands[seat].some((c) => c.id === card)).toBe(false); // it leaves your hand
    expect(passive(s, seat, kind)).toBe(before + CARD[card].passive!.n); // no House-match bonus
    expect(s.log.at(-1)).toMatchObject({ k: 'primus', seat, card, t: keep, house: nh });
    // One Primus per Keep.
    s.priv!.hands[seat].push({ id: card, locked: false });
    expect(act(s, seat, { type: 'primus', keep, card }, ctx(rng)).ok).toBe(false);
    // Not shared with allies.
    const other = s.players.find((p) => p.seat !== seat)!.seat;
    const alone = passive(s, other, kind);
    s.alliances.push({ id: 5, members: [seat, other], public: true, since: 0 });
    const withAlly = passive(s, other, kind);
    const general = s.players[seat].general ? CARD[s.players[seat].general!] : null;
    const shared = general?.passive?.kind === kind ? general.passive.n + (general.house === s.players[seat].house ? 1 : 0) : 0;
    expect(withAlly - alone).toBe(shared);
  });
  it('can wait for a later Draft, but not past the turn you took it outside the Draft', () => {
    const { s, seat, rng, keep, card, from } = keepWithCard(92);
    act(s, seat, { type: 'attack', from, to: keep, blitz: true }, ctx(rng));
    if (s.ts.mustMove) act(s, seat, { type: 'move', n: s.ts.mustMove.min }, ctx(rng));
    s.ts.keepsTaken = []; // as if it was taken on an earlier turn
    expect(primusBlocker(s, seat, keep, card)).toMatch(/later Draft/);
    s.phase = 'draft';
    expect(primusBlocker(s, seat, keep, card)).toBeNull();
    const other = s.players.find((p) => p.seat !== seat)!.seat;
    expect(primusBlocker(s, other, keep, card)).toMatch(/your own turn/);
  });
  it('dies with its Keep', () => {
    const { s, seat, rng, keep, card, nh, from } = keepWithCard(93);
    act(s, seat, { type: 'attack', from, to: keep, blitz: true }, ctx(rng));
    if (s.ts.mustMove) act(s, seat, { type: 'move', n: s.ts.mustMove.min }, ctx(rng));
    expect(act(s, seat, { type: 'primus', keep, card }, ctx(rng))).toEqual({ ok: true });
    const foe = s.players.find((p) => p.seat !== seat)!.seat;
    // The foe takes the Keep back.
    s.cur = foe; s.phase = 'attack';
    const src = geo(s).adj[keep].find((x) => x !== from)!;
    s.owner[src] = foe; s.armies[src] = 300; s.armies[keep] = 1;
    expect(act(s, foe, { type: 'attack', from: src, to: keep, blitz: true }, ctx(rng)).ok).toBe(true);
    expect(s.owner[keep]).toBe(foe);
    expect(s.primus![nh]).toBeNull();
    expect(s.priv!.discard).toContain(card);
    expect(s.log.find((e) => e.k === 'primusSlain')).toMatchObject({ seat, card, t: keep, by: foe });
  });
});

describe('host tools and table talk', () => {
  it('a kicked seat is handed to an AI Primus and the war goes on', () => {
    const rng = mulberry(101);
    const s = createGame(['A', 'B', 'C'], rng);
    passage(s, rng);
    const seat = s.cur;
    expect(kickToAI(s, seat, ctx(rng))).toEqual({ ok: true });
    expect(s.players[seat].ai).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ k: 'kicked', seat });
    expect(kickToAI(s, seat, ctx(rng)).ok).toBe(false);
    // The bot can take the turn from here.
    for (let i = 0; i < 200 && s.cur === seat; i++) {
      const r = act(s, seat, botAction(viewFor(s, seat), seat, rng), ctx(rng, i * 1000));
      if (!r.ok) act(s, seat, s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, ctx(rng));
    }
    expect(s.cur).not.toBe(seat);
  });
  it('emotes: a fixed menu, public, one every 15 seconds, any time', () => {
    const rng = mulberry(102);
    const s = createGame(['A', 'B'], rng);
    expect(EMOTES.length).toBeGreaterThan(20);
    for (const e of EMOTES) expect(e.split(/\s+/).length).toBeLessThanOrEqual(12);
    const off = s.order[1];
    expect(act(s, off, { type: 'emote', line: 0 }, ctx(rng, 1000))).toEqual({ ok: true }); // during the Passage, off-turn
    expect(s.log.at(-1)).toMatchObject({ k: 'emote', seat: off, line: 0 });
    expect(s.log.at(-1)!.vis).toBeUndefined();
    expect(act(s, off, { type: 'emote', line: 1 }, ctx(rng, 1000 + EMOTE_COOLDOWN_MS - 1)).ok).toBe(false);
    expect(act(s, off, { type: 'emote', line: 1 }, ctx(rng, 1000 + EMOTE_COOLDOWN_MS))).toEqual({ ok: true });
    expect(act(s, off, { type: 'emote', line: EMOTES.length }, ctx(rng, 1e9)).ok).toBe(false);
  });
  it('the full log keeps every die, while the game state keeps the last few', () => {
    const { s, seat, rng, g } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!.seat;
    const to = g.territories.find((t) => !t.isKeep && s.owner[t.id] === NEUTRAL)!.id;
    const from = beside(s, seat, to);
    s.owner[to] = foe; s.armies[to] = 60; s.armies[from] = 200;
    drainLog();
    expect(act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng)).ok).toBe(true);
    const full = drainLog().find((e) => e.k === 'battle')!;
    const kept = s.log.find((e) => e.k === 'battle')!;
    expect(full.rolls.length).toBe(full.n);
    expect(full.n).toBeGreaterThan(4);
    expect(kept.rolls.length).toBe(4);
    expect(kept.id).toBe(full.id);
    // A refused action leaves nothing behind.
    expect(act(s, seat, { type: 'attack', from: to, to: from }, ctx(rng)).ok).toBe(false);
    expect(drainLog()).toHaveLength(0);
  });
});

describe('attack reasons', () => {
  it('explain why an attack is refused', () => {
    const { s, seat, g } = setupDuel();
    const mine = s.owner.findIndex((o, t) => o === seat && g.adj[t].some((x) => s.owner[x] !== seat));
    const next = g.adj[mine].find((x) => s.owner[x] !== seat)!;
    s.armies[mine] = 1;
    expect(attackBlocker(s, seat, mine, next)).toMatch(/only 1 army/);
    s.armies[mine] = 5;
    expect(attackBlocker(s, seat, mine, next)).toBeNull();
    const far = s.owner.findIndex((o, t) => o !== seat && g.dist[mine][t] > 3);
    expect(attackBlocker(s, seat, mine, far)).toMatch(/doesn't border|across the water/);
  });
});

describe('replay trail', () => {
  it('records what each action changed on the map', () => {
    const { s, seat, rng, g } = setupDuel();
    const from = s.owner.findIndex((o, t) => o === seat && g.adj[t].some((x) => s.owner[x] !== seat));
    const to = g.adj[from].find((x) => s.owner[x] !== seat)!;
    s.armies[from] = 60; s.armies[to] = 1;
    const before = s.trail.length;
    expect(act(s, seat, { type: 'attack', from, to, blitz: true }, ctx(rng)).ok).toBe(true);
    const f = s.trail.at(-1)!;
    expect(s.trail.length).toBe(before + 1);
    expect(f).toMatchObject({ v: s.version, seat, seq: s.seq, cur: seat, ph: 'attack' });
    const d = new Map<number, [number, number]>();
    for (let i = 0; i < f.d.length; i += 3) d.set(f.d[i], [f.d[i + 1], f.d[i + 2]]);
    expect(d.get(to)).toEqual([s.owner[to], s.armies[to]]);
    expect(viewFor(s, null).trail.at(-1)).toEqual(f);
    expect(TRAIL_MAX).toBeGreaterThan(100);
  });
  it('loads wars saved before settings existed', () => {
    const rng = mulberry(4);
    const s = createGame(['A', 'B'], rng) as any;
    delete s.opts; delete s.trail;
    expect(act(s, 0, { type: 'choose', card: s.priv.passage[0][0] }, ctx(rng)).ok).toBe(true);
    expect(s.opts.alliances).toBe(true);
    expect(s.trail.length).toBe(1);
  });
});

describe('full bot games', () => {
  const N = 42;
  it(`${N} bot-vs-bot games (2–7 players) finish without rule errors`, { timeout: 300000 }, () => {
    let finished = 0, turns = 0, sieges = 0, betrayals = 0, alliances = 0;
    for (let g = 0; g < N; g++) {
      const n = MIN_PLAYERS + (g % (MAX_PLAYERS - MIN_PLAYERS + 1));
      const { s, steps, errors } = runBotGame(n, 1000 + g);
      expect(errors).toBeLessThan(steps * 0.05 + 5);
      if (s.phase === 'over') finished++;
      turns += s.turn;
      sieges += s.log.filter((e) => e.k === 'siegeBegins').length;
      betrayals += s.log.filter((e) => e.k === 'betrayal').length;
      alliances += s.log.filter((e) => e.k === 'allianceFormed').length;
    }
    console.log(`finished ${finished}/${N}, avg turns ${(turns / N).toFixed(1)}, alliances ${alliances}, betrayals ${betrayals}, sieges ${sieges}`);
    expect(finished).toBeGreaterThan(N * 0.8);
  });
});

describe('edge function', () => {
  it('ships the exact same engine as the client', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['data.ts', 'cards.ts', 'engine.ts', 'bot.ts']) {
      expect(readFileSync(`supabase/functions/institute/engine/${f}`, 'utf8'), `${f} out of sync: run npm run sync:fn and redeploy`).toBe(readFileSync(`src/engine/${f}`, 'utf8'));
    }
  });
});
