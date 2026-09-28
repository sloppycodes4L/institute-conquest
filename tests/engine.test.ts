import { describe, expect, it } from 'vitest';
import { geoFor, mapGeo, HOUSES, LAYOUTS, MAX_PLAYERS, MIN_PLAYERS, isRough } from '../src/engine/data.ts';
import { CARDS } from '../src/engine/cards.ts';
import {
  act, actingSeat, aiDuty, allianceOf, attackTargets, BALANCE, createGame, geo, olympusPreview, passive, reinforcementBreakdown, viewFor,
  type GameState, type Action, NEUTRAL, clone, attackBlocker, fortifyRoute, resolveSettings, spreadHouses, TRAIL_MAX, territoriesOf,
} from '../src/engine/engine.ts';
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
        expect(s.priv!.passage[p.seat]!.length).toBe(2);
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
  it('spreads the players out so neighbours are as rare as possible', () => {
    const g = geoFor(3);
    for (let i = 0; i < 20; i++) {
      const hs = spreadHouses(g, 3, Math.random);
      for (const a of hs) for (const b of hs) if (a !== b) expect(g.dist[g.keepOf(a)][g.keepOf(b)]).toBeGreaterThan(5);
    }
  });
  it('the Passage kills one card per player and starts the war', () => {
    const rng = mulberry(5);
    const s = createGame(['A', 'B', 'C'], rng);
    passage(s, rng);
    expect(s.phase).toBe('draft');
    expect(s.killed.length).toBe(3);
    expect(s.players.every((p) => p.general)).toBe(true);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, s.cur).total);
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
  it('hide other hands and passage picks', () => {
    const rng = mulberry(9);
    const s = createGame(['A', 'B'], rng);
    act(s, 0, { type: 'choose', card: s.priv!.passage[0]![0] }, ctx(rng));
    const v = viewFor(s, 1);
    expect(v.priv).toBeNull();
    expect(v.players[0].general).toBe('?');
    expect(v.me!.seat).toBe(1);
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

  it('inviting someone in a secret pact never gives the pact away', () => {
    const { s, a, b, c, rng } = threeWay();
    ally(s, b, c, rng, false);
    s.alliances.push({ id: 999, members: [a], public: false, since: 0 }); // a is secretly sworn elsewhere too
    const r = act(s, a, { type: 'invite', to: b, public: true }, ctx(rng));
    expect(r).toEqual({ ok: true }); // no "sworn to another alliance" error
    const inv = s.invites.find((i) => i.from === a && i.to === b)!;
    expect(act(s, b, { type: 'answer', invite: inv.id, accept: true }, ctx(rng))).toEqual({ ok: true });
    expect(allianceOf(s, b)?.members.sort()).toEqual([b, c].sort()); // voided, not merged
    expect(s.log.at(-1)!.k).toBe('inviteVoid');
    expect(viewFor(s, a).alliances.some((x) => x.members.includes(b))).toBe(false);
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

describe('terrain', () => {
  it('forests add cover, and it shows in the log', () => {
    const { s, seat, rng, g } = setupDuel();
    const forest = g.territories.find((t) => t.terrain === 'forest')!.id;
    const from = beside(s, seat, forest);
    s.owner[forest] = NEUTRAL; s.armies[forest] = 3; s.armies[from] = 10;
    expect(act(s, seat, { type: 'attack', from, to: forest }, ctx(rng)).ok).toBe(true);
    const ev = [...s.log].reverse().find((e) => e.k === 'battle')!;
    expect(ev.tD).toBe(BALANCE.forestDef);
    expect(ev.rolls[0].d[0] - ev.rolls[0].raw.d[0]).toBe(BALANCE.forestDef);
  });
  it('mountains give the high ground', () => {
    const { s, seat, rng, g } = setupDuel();
    const mtn = g.territories.find((t) => t.terrain === 'mountain')!.id;
    const to = g.adj[mtn].find((x) => g.territories[x].terrain !== 'forest' && !g.territories[x].isKeep)!;
    s.owner[mtn] = seat; s.armies[mtn] = 10; s.owner[to] = NEUTRAL; s.armies[to] = 3;
    expect(act(s, seat, { type: 'attack', from: mtn, to }, ctx(rng)).ok).toBe(true);
    const ev = [...s.log].reverse().find((e) => e.k === 'battle')!;
    expect(ev.tA).toBe(BALANCE.mountainAtk);
    expect(ev.rolls[0].a[0] - ev.rolls[0].raw.a[0]).toBe(BALANCE.mountainAtk);
  });
  it('a fortify march halts on mountains, water or marsh it has to cross', () => {
    const { s, seat, rng, g } = setupDuel();
    const T = g.territories;
    s.phase = 'fortify';
    // find a → rough → b where a and b don't touch
    let a = -1, rough = -1, b = -1;
    for (const t of T) {
      if (!isRough(t.terrain)) continue;
      const ns = g.adj[t.id];
      for (const x of ns) for (const y of ns) if (x !== y && !g.adj[x].includes(y) && a < 0) { a = x; rough = t.id; b = y; }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    s.owner = s.owner.map(() => NEUTRAL);
    for (const t of [a, rough, b]) s.owner[t] = seat;
    s.armies[a] = 10; s.armies[rough] = 1; s.armies[b] = 1;
    expect(fortifyRoute(s, seat, a, b)).toEqual({ path: [a, rough, b], stop: rough });
    expect(act(s, seat, { type: 'fortify', from: a, to: b, n: 6 }, ctx(rng))).toEqual({ ok: true });
    expect([s.armies[a], s.armies[rough], s.armies[b]]).toEqual([4, 7, 1]);
    expect(s.log.at(-1)).toMatchObject({ k: 'fortify', from: a, to: rough, aim: b, path: [a, rough] });
    // …and it can march on from the rough ground next turn
    expect(fortifyRoute(s, seat, rough, b)!.stop).toBe(b);
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
