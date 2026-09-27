import { describe, expect, it } from 'vitest';
import { MAP, NT, TERRITORIES, keepOf, DIST } from '../src/engine/data.ts';
import { CARDS } from '../src/engine/cards.ts';
import { act, actingSeat, createGame, reinforcementBreakdown, viewFor, type GameState, type Action, NEUTRAL, START_ARMIES, clone } from '../src/engine/engine.ts';
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
  it('has 42 connected territories with sane sizes', () => {
    expect(NT).toBe(42);
    for (let t = 0; t < NT; t++) {
      expect(MAP.hexes.filter((h) => h.t === t).length).toBeGreaterThanOrEqual(8);
      expect(MAP.adj[t].length).toBeGreaterThan(0);
    }
    expect(Math.max(...DIST.flat())).toBeLessThan(Infinity);
  });
  it('adjacency is symmetric', () => {
    MAP.adj.forEach((ns, t) => ns.forEach((n) => expect(MAP.adj[n]).toContain(t)));
  });
  it('the Frostfangs have exactly two gateways', () => {
    const pluto = TERRITORIES.filter((t) => t.quadrant === 2).map((t) => t.id);
    const gates = pluto.filter((t) => MAP.adj[t].some((n) => TERRITORIES[n].quadrant !== 2));
    expect(gates.length).toBe(2);
  });
});

describe('cards', () => {
  it('have unique ids and valid houses', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) expect(c.house).toBeGreaterThanOrEqual(0);
  });
});

describe('setup', () => {
  for (const n of [2, 3, 4]) {
    it(`deals a legal ${n}-player opening`, () => {
      const rng = mulberry(n * 77);
      const s = createGame(Array.from({ length: n }, (_, i) => `P${i}`), rng);
      expect(new Set(s.players.map((p) => p.house)).size).toBe(n);
      for (const p of s.players) {
        const mine = s.owner.flatMap((o, t) => (o === p.seat ? [t] : []));
        expect(s.owner[keepOf(p.house)]).toBe(p.seat);
        expect(mine.reduce((a, t) => a + s.armies[t], 0)).toBe(START_ARMIES[n]);
        expect(s.priv!.passage[p.seat]!.length).toBe(2);
      }
      expect(s.owner.some((o) => o === NEUTRAL)).toBe(true);
    });
  }
  it('the Passage kills one card per player and starts the war', () => {
    const rng = mulberry(5);
    const s = createGame(['A', 'B', 'C'], rng);
    passage(s, rng);
    expect(s.phase).toBe('draft');
    expect(s.killed.length).toBe(3);
    expect(s.players.every((p) => p.general)).toBe(true);
    expect(s.ts.reinforcements).toBe(reinforcementBreakdown(s, s.cur).total);
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

describe('combat rules', () => {
  function setupDuel() {
    const rng = mulberry(11);
    const s = createGame(['A', 'B'], rng);
    passage(s, rng);
    // skip to attack phase for current player
    const seat = s.cur;
    const r = s.ts.reinforcements;
    const t = s.owner.findIndex((o) => o === seat);
    act(s, seat, { type: 'place', t, n: r }, ctx(rng));
    s.priv!.hands[seat] = [];
    act(s, seat, { type: 'endDraft' }, ctx(rng));
    s.turn = 10; // past the first-round grace period
    return { s, seat, rng };
  }

  it('conquering a territory with an enemy Standard dominates that House', () => {
    const { s, seat, rng } = setupDuel();
    const foe = s.players.find((p) => p.seat !== seat)!;
    const foeKeep = keepOf(foe.house);
    const from = MAP.adj[foeKeep][0];
    s.owner[from] = seat; s.armies[from] = 200;
    s.armies[foeKeep] = 1; s.standards[foe.house].guard = 0;
    const res = act(s, seat, { type: 'attack', from, to: foeKeep, blitz: true }, ctx(rng));
    expect(res.ok).toBe(true);
    expect(s.players[foe.seat].alive).toBe(false);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(seat);
    expect(s.owner.every((o) => o !== foe.seat)).toBe(true);
  });

  it('a winning Standard attack enslaves the defenders', () => {
    const { s, seat, rng } = setupDuel();
    const me = s.players[seat];
    const from = keepOf(me.house);
    const to = MAP.adj[from].find((t) => s.owner[t] !== seat) ?? MAP.adj[from][0];
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
    const { s, seat, rng } = setupDuel();
    const me = s.players[seat];
    const foe = s.players.find((p) => p.seat !== seat)!;
    const from = keepOf(me.house);
    const to = MAP.adj[from][0];
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
    const { s, seat, rng } = setupDuel();
    const me = s.players[seat];
    const foe = s.players.find((p) => p.seat !== seat)!;
    const from = keepOf(me.house);
    const to = MAP.adj[from][0];
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
    const { s, seat, rng } = setupDuel();
    const other = s.players.find((p) => p.seat !== seat)!.seat;
    expect(act(s, other, { type: 'endAttack' }, ctx(rng)).ok).toBe(false);
    const mine = s.owner.findIndex((o) => o === seat);
    const far = s.owner.findIndex((o, t) => o !== seat && DIST[mine][t] > 3);
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

describe('full bot games', () => {
  const N = 120;
  it(`${N} bot-vs-bot games finish without rule errors`, { timeout: 120000 }, () => {
    let finished = 0, turns = 0;
    const wins: Record<number, number> = {};
    for (let g = 0; g < N; g++) {
      const rng = mulberry(1000 + g);
      const n = 2 + (g % 3);
      const s = createGame(Array.from({ length: n }, (_, i) => `Bot${i}`), rng);
      let steps = 0, errors = 0, now = 0;
      while (s.phase !== 'over' && steps < 40000 && s.turn < 400) {
        steps++; now += 1000;
        const seat = actingSeat(s);
        const snapshot = clone(s);
        let a: Action = botAction(viewFor(s, seat), seat, rng);
        const r = act(s, seat, a, ctx(rng, now));
        if (!r.ok) {
          errors++;
          expect(s).toEqual(snapshot); // failed actions must not mutate state
          const fallback: Action = s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' };
          if (!act(s, seat, fallback, ctx(rng, now)).ok) throw new Error(`stuck: ${r.err} / ${JSON.stringify(a)}`);
        }
        // invariants
        for (let t = 0; t < NT; t++) {
          expect(s.armies[t]).toBeGreaterThanOrEqual(0);
          if (s.owner[t] >= 0) expect(s.players[s.owner[t]].alive).toBe(true);
        }
      }
      expect(errors).toBeLessThan(steps * 0.05 + 5);
      if (s.phase === 'over') { finished++; wins[s.players[s.winner!].house] = (wins[s.players[s.winner!].house] || 0) + 1; }
      turns += s.turn;
    }
    console.log(`finished ${finished}/${N}, avg turns ${(turns / N).toFixed(1)}, wins by house`, wins);
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
