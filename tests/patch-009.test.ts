// .009: the House Draft, Primus Selection (Pick or the Passage), and the alliance's final choice (End Game or the Siege).
import { describe, expect, it } from 'vitest';
import { HOUSES } from '../src/engine/data.ts';
import { CARD, CHARACTER_IDS } from '../src/engine/cards.ts';
import {
  act, actingSeat, aiDuty, allianceOf, cleanSettings, createGame, DEFAULT_SETTINGS, DRAFT_MS, draftFree, draftPick, draftSeat, generalPassive, lastAlliance,
  openDraft, siegeBlocker, viewFor, type GameState,
} from '../src/engine/engine.ts';
import { botAction } from '../src/engine/bot.ts';
import { HOUSE_INFO, houseInfo } from '../src/ui/houses.ts';
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
function passage(s: GameState, rng: () => number) {
  for (const p of s.players) expect(act(s, p.seat, { type: 'choose', card: s.priv!.passage[p.seat]![0] }, ctx(rng))).toEqual({ ok: true });
}
function ally(s: GameState, x: number, y: number, rng: () => number, pub = true) {
  s.warBegun = true;
  expect(act(s, x, { type: 'invite', to: y, public: pub }, ctx(rng))).toEqual({ ok: true });
  const inv = s.invites.find((i) => i.from === x && i.to === y)!;
  expect(act(s, y, { type: 'answer', invite: inv.id, accept: true }, ctx(rng))).toEqual({ ok: true });
}
function war(names: string[], seed: number, settings = {}, ai?: boolean[]) {
  const rng = mulberry(seed);
  const s = createGame(names, rng, { settings, ai });
  passage(s, rng);
  return { s, rng };
}

describe('war settings', () => {
  it('House Selection defaults to Draft and Primus Selection to Pick; anything else is cleaned', () => {
    expect(DEFAULT_SETTINGS.houseSel).toBe('draft');
    expect(DEFAULT_SETTINGS.primusSel).toBe('pick');
    expect(cleanSettings({})).toMatchObject({ houseSel: 'draft', primusSel: 'pick' });
    expect(cleanSettings({ houseSel: 'random', primusSel: 'random' })).toMatchObject({ houseSel: 'random', primusSel: 'random' });
    expect(cleanSettings({ houseSel: 'whatever', primusSel: 7 })).toMatchObject({ houseSel: 'draft', primusSel: 'pick' });
  });
});

describe('the House Draft', () => {
  type Seat = { seat: number; name: string; ai?: boolean; house?: number | null; houseBy?: 'host' };
  const lobbyOf = (kinds: string) => [...kinds].map((k, i): Seat => ({ seat: i, name: `P${i}`, ...(k === 'a' ? { ai: true } : {}) }));

  it('puts every seat in a random order, clears old picks, and starts the 30 second clock', () => {
    const lobby = lobbyOf('hhhh');
    lobby[2].house = 3; lobby[2].houseBy = 'host';
    const d = openDraft(lobby, mulberry(5), 1000);
    expect([...d.draft.order].sort()).toEqual([0, 1, 2, 3]);
    expect(d.draft.at).toBe(0);
    expect(d.draft.deadline).toBe(1000 + DRAFT_MS);
    expect(DRAFT_MS).toBe(30_000);
    expect(d.lobby.every((l) => l.house == null && !l.houseBy)).toBe(true);
    expect(d.done).toBe(false);
    // The lobby passed in is not changed.
    expect(lobby[2].house).toBe(3);
    const orders = new Set(Array.from({ length: 12 }, (_, k) => openDraft(lobbyOf('hhhh'), mulberry(k), null).draft.order.join()));
    expect(orders.size).toBeGreaterThan(3);
  });

  it('one pick at a time: only the seat that is up, and never a House that is taken', () => {
    const rng = mulberry(9);
    let { lobby, draft } = openDraft(lobbyOf('hhh'), rng, 0);
    const [a, b, c] = draft.order;
    expect(draftSeat(draft)).toBe(a);
    expect(draftPick(draft, lobby, b, 0, rng, 0)).toEqual({ ok: false, err: 'It is not your pick.' });
    let r = draftPick(draft, lobby, a, 3, rng, 500);
    if (!r.ok) throw new Error(r.err);
    ({ lobby, draft } = r);
    expect(lobby[a].house).toBe(3);
    expect(r.done).toBe(false);
    expect(draft.deadline).toBe(500 + DRAFT_MS);
    expect(draftSeat(draft)).toBe(b);
    expect(draftPick(draft, lobby, b, 3, rng, 0)).toEqual({ ok: false, err: 'House Mars is taken.' });
    expect(draftPick(draft, lobby, b, 99, rng, 0).ok).toBe(false);
    r = draftPick(draft, lobby, b, 0, rng, 0);
    if (!r.ok) throw new Error(r.err);
    ({ lobby, draft } = r);
    r = draftPick(draft, lobby, c, 6, rng, 0);
    if (!r.ok) throw new Error(r.err);
    expect(r.done).toBe(true);
    expect(draftSeat(r.draft)).toBe(-1);
    expect(r.lobby.map((l) => l.house)).toEqual([a, b, c].map((_, i) => [3, 0, 6][[a, b, c].indexOf(i)]));
    expect(draftPick(r.draft, r.lobby, c, 1, rng, 0)).toEqual({ ok: false, err: 'The Draft is over.' });
  });

  it('a clock that ran out deals a random House from those left', () => {
    const rng = mulberry(12);
    const o = openDraft(lobbyOf('hh'), rng, 0);
    const first = draftSeat(o.draft);
    const r1 = draftPick(o.draft, o.lobby, first, 2, rng, 0);
    if (!r1.ok) throw new Error(r1.err);
    const second = draftSeat(r1.draft);
    const r2 = draftPick(r1.draft, r1.lobby, second, null, rng, 0);
    if (!r2.ok) throw new Error(r2.err);
    expect(r2.done).toBe(true);
    expect(r2.lobby[second].house).not.toBe(2);
    expect(r2.lobby[second].house).toBeGreaterThanOrEqual(0);
    expect(draftFree(r2.lobby)).toHaveLength(HOUSES.length - 2);
  });

  it('AI seats pick at once: at the head of the order, and after every human pick', () => {
    for (let k = 0; k < 30; k++) {
      const rng = mulberry(100 + k);
      let st: { lobby: Seat[]; draft: ReturnType<typeof openDraft>['draft']; done: boolean } = openDraft(lobbyOf('haaha'), rng, null);
      expect(st.draft.deadline).toBeNull();
      let picks = 0;
      while (!st.done) {
        const up = draftSeat(st.draft);
        // Whoever is up is always a human: every AI before them has a House.
        expect(st.lobby[up].ai).toBeFalsy();
        for (let i = 0; i < st.draft.at; i++) expect(st.lobby[st.draft.order[i]].house).not.toBeNull();
        const r = draftPick(st.draft, st.lobby, up, draftFree(st.lobby)[0], rng, null);
        if (!r.ok) throw new Error(r.err);
        st = r; picks++;
      }
      expect(picks).toBe(2);
      const houses = st.lobby.map((l) => l.house ?? null);
      expect(new Set(houses).size).toBe(5);
      // The war is then dealt exactly these Houses.
      const s = createGame(st.lobby.map((l) => l.name), rng, { houses });
      expect(s.players.map((p) => p.house)).toEqual(houses);
      expect(s.log.filter((e) => e.k === 'sorted').every((e) => e.picked)).toBe(true);
    }
  });

  it('a lobby of one human and AIs that all pick first leaves just the human to choose', () => {
    let seen = false;
    for (let k = 0; k < 40 && !seen; k++) {
      const o = openDraft(lobbyOf('haa'), mulberry(k), 0);
      if (o.draft.at === 2) { seen = true; expect(draftSeat(o.draft)).toBe(0); expect(o.lobby.filter((l) => l.house != null)).toHaveLength(2); }
    }
    expect(seen).toBe(true);
  });
});

describe('Primus Selection', () => {
  it('Pick: every Character of your House, nobody dies, printed Passive', () => {
    const s = createGame(['A', 'B', 'C'], mulberry(3));
    expect(s.opts.pick).toBe(true);
    for (const p of s.players) expect(s.priv!.passage[p.seat]).toEqual(CHARACTER_IDS.filter((id) => CARD[id].house === p.house));
  });

  it('Random (the Passage): two of your own House, one walks out with +1, the other dies', () => {
    for (let k = 0; k < 20; k++) {
      const rng = mulberry(200 + k);
      const s = createGame(['A', 'B', 'C', 'D'], rng, { settings: { primusSel: 'random' } });
      expect(s.opts.pick).toBeUndefined();
      expect(s.opts.finale).toBe(true);
      expect(s.phase).toBe('passage');
      const dealt = s.players.map((p) => [...s.priv!.passage[p.seat]!]);
      for (const p of s.players) {
        const two = dealt[p.seat];
        expect(two).toHaveLength(2);
        expect(new Set(two).size).toBe(2);
        for (const id of two) { expect(CARD[id].kind).toBe('character'); expect(CARD[id].house).toBe(p.house); }
        // Neither is in the deck; the House's other Characters are.
        for (const id of two) expect(s.priv!.deck).not.toContain(id);
        expect(viewFor(s, p.seat).me!.passage).toEqual(two);
      }
      expect(act(s, 0, { type: 'choose', card: 'not-dealt' }, ctx(rng)).ok).toBe(false);
      for (const p of s.players) expect(act(s, p.seat, { type: 'choose', card: dealt[p.seat][1] }, ctx(rng))).toEqual({ ok: true });
      expect(s.phase).toBe('draft');
      for (const p of s.players) {
        expect(p.general).toBe(dealt[p.seat][1]);
        expect(s.killed.find((x) => x.seat === p.seat)!.card).toBe(dealt[p.seat][0]);
        const c = CARD[p.general!];
        if (c.passive) expect(generalPassive(s, p.seat, c.passive.kind)).toBe(c.passive.n + 1);
      }
      expect(s.log.filter((e) => e.k === 'passage' && e.killed)).toHaveLength(4);
    }
  });

  it('the Passage deals different pairs from war to war', () => {
    const pairs = new Set(Array.from({ length: 20 }, (_, k) => {
      const s = createGame(['A', 'B'], mulberry(300 + k), { settings: { primusSel: 'random' }, houses: [3, 2] });
      return [...s.priv!.passage[0]!].sort().join();
    }));
    expect(pairs.size).toBeGreaterThan(4);
  });

  it('the AI walks out of the Passage', () => {
    const rng = mulberry(8);
    const s = createGame(['A', 'B'], rng, { settings: { primusSel: 'random' } });
    for (let i = 0; i < 2; i++) { const seat = actingSeat(s); expect(act(s, seat, botAction(viewFor(s, seat), seat, rng), ctx(rng))).toEqual({ ok: true }); }
    expect(s.phase).toBe('draft');
    expect(s.killed).toHaveLength(2);
  });
});

describe('the end of the war: End Game or the Siege', () => {
  /** Three Houses; `a` and `b` are allied, and `c` is their last enemy. */
  function three(seed = 31, settings = {}, ai?: boolean[]) {
    const { s, rng } = war(['A', 'B', 'C'], seed, settings, ai);
    const a = s.cur;
    const [b, c] = s.players.filter((p) => p.seat !== a).map((p) => p.seat);
    return { s, rng, a, b, c };
  }
  const fall = (s: GameState, seat: number, rng: () => number) => expect(act(s, seat, { type: 'concede' }, ctx(rng))).toEqual({ ok: true });

  it('nothing happens while an enemy stands', () => {
    const { s, rng, a, b } = three();
    ally(s, a, b, rng);
    expect(s.opts.finale).toBe(true);
    expect(lastAlliance(s)).toBeNull();
    expect(s.vote).toBeNull();
    expect(s.phase).not.toBe('over');
    // In a .009 war nobody calls a Siege by hand.
    expect(siegeBlocker(s, a)).toMatch(/last enemy falls/);
    expect(act(s, a, { type: 'proposeSiege' }, ctx(rng)).ok).toBe(false);
  });

  it('when the last enemy falls the alliance must vote, and nothing else moves', () => {
    const { s, rng, a, b, c } = three();
    ally(s, a, b, rng, false);
    fall(s, c, rng);
    expect(s.phase).not.toBe('over');
    expect(s.vote).toMatchObject({ final: true, yes: [], no: [] });
    expect(allianceOf(s, a)!.public).toBe(true);
    expect(s.log.some((e) => e.k === 'finale')).toBe(true);
    // No neutral Standard has been taken: it does not matter any more.
    expect(s.standards.some((st, h) => !s.players.some((p) => p.house === h) && !st.captured)).toBe(true);
    for (const seat of [a, b]) {
      expect(act(s, seat, { type: 'endTurn' }, ctx(rng))).toEqual({ ok: false, err: expect.stringMatching(/must first choose/) });
      expect(act(s, seat, { type: 'leaveAlliance' }, ctx(rng)).ok).toBe(false);
      expect(act(s, seat, { type: 'concede' }, ctx(rng)).ok).toBe(false);
    }
    // The fallen House watches the vote, but has none.
    expect(viewFor(s, c).vote?.final).toBe(true);
    expect(act(s, c, { type: 'vote', yes: true }, ctx(rng)).ok).toBe(false);
    expect([a, b]).toContain(actingSeat(s));
  });

  it('two allies: a tie ends the war as a shared victory', () => {
    const { s, rng, a, b, c } = three();
    ally(s, a, b, rng);
    fall(s, c, rng);
    expect(act(s, a, { type: 'vote', yes: true }, ctx(rng))).toEqual({ ok: true });
    expect(s.phase).not.toBe('over');
    expect(actingSeat(s)).toBe(b);
    expect(act(s, a, { type: 'vote', yes: false }, ctx(rng)).ok).toBe(false);
    expect(act(s, b, { type: 'vote', yes: false }, ctx(rng))).toEqual({ ok: true });
    expect(s.phase).toBe('over');
    expect([...s.winners].sort()).toEqual([a, b].sort());
    expect(s.siege).toBeNull();
    expect(s.vote).toBeNull();
    const win = s.log.find((e) => e.k === 'win')!;
    expect(win.shared).toBe(true);
    expect([...win.members].sort()).toEqual([a, b].sort());
    expect(describeEvent(s, win)).toMatch(/THE WAR IS OVER/);
    expect(headline(s, win)!.title).toBe('THE WAR IS OVER');
    expect(describeEvent(s, s.log.find((e) => e.k === 'finale')!)).toMatch(/end the war/);
    expect(describeEvent(s, s.log.find((e) => e.k === 'siegeVote' && e.final && !e.yes)!)).toMatch(/end the war/);
  });

  it('one vote to end it is enough for two: the Siege can no longer win the vote', () => {
    const { s, rng, a, b, c } = three();
    ally(s, a, b, rng);
    fall(s, c, rng);
    expect(act(s, b, { type: 'vote', yes: false }, ctx(rng))).toEqual({ ok: true });
    expect(s.phase).toBe('over');
    expect(s.winners).toHaveLength(2);
  });

  it('two allies who both want it besiege Olympus, with no neutral Standard taken', () => {
    const { s, rng, a, b, c } = three();
    ally(s, a, b, rng);
    fall(s, c, rng);
    act(s, a, { type: 'vote', yes: true }, ctx(rng));
    expect(s.siege).toBeNull();
    act(s, b, { type: 'vote', yes: true }, ctx(rng));
    expect(s.phase).not.toBe('over');
    expect(s.vote).toBeNull();
    expect(s.siege!.members.sort()).toEqual([a, b].sort());
    expect(s.siege!.proctors).toHaveLength(2);
    // The war moves again, and the vote does not come back while the Siege is on.
    s.phase = 'fortify';
    expect(act(s, s.cur, { type: 'endTurn' }, ctx(rng))).toEqual({ ok: true });
    expect(s.vote).toBeNull();
  });

  it('three allies: more than half decides either way', () => {
    for (const [votes, siege] of [[[true, true], true], [[false, false], false], [[true, false, true], true], [[true, false, false], false]] as [boolean[], boolean][]) {
      const { s, rng } = war(['A', 'B', 'C', 'D'], 44);
      const [a, b, c, d] = s.order;
      ally(s, a, b, rng); ally(s, a, c, rng);
      fall(s, d, rng);
      expect(s.vote?.final).toBe(true);
      [a, b, c].slice(0, votes.length).forEach((m, i) => expect(act(s, m, { type: 'vote', yes: votes[i] }, ctx(rng))).toEqual({ ok: true }));
      expect(!!s.siege).toBe(siege);
      expect(s.phase === 'over').toBe(!siege);
      if (!siege) expect(s.winners).toHaveLength(3);
    }
  });

  it('a failed Siege shatters the alliance and the war goes on', () => {
    const { s, rng, a, b, c } = three();
    ally(s, a, b, rng);
    fall(s, c, rng);
    act(s, a, { type: 'vote', yes: true }, ctx(rng));
    act(s, b, { type: 'vote', yes: true }, ctx(rng));
    for (let i = 0; i < 20 && s.siege; i++) { s.phase = 'fortify'; expect(act(s, s.cur, { type: 'endTurn' }, ctx(rng)).ok).toBe(true); }
    expect(s.siege).toBeNull();
    expect(s.log.some((e) => e.k === 'siegeFailed')).toBe(true);
    expect(s.alliances).toHaveLength(0);
    expect(s.phase).not.toBe('over');
    expect(s.vote).toBeNull();
  });

  it('with the Siege switched off the war simply ends', () => {
    const { s, rng, a, b, c } = three(31, { siege: false });
    ally(s, a, b, rng);
    fall(s, c, rng);
    expect(s.phase).toBe('over');
    expect([...s.winners].sort()).toEqual([a, b].sort());
    expect(s.log.find((e) => e.k === 'win')!.shared).toBe(true);
  });

  it('the last two Houses standing can swear to each other, and then they choose', () => {
    const { s, rng, a, b, c } = three();
    fall(s, c, rng);
    expect(s.vote).toBeNull();
    ally(s, a, b, rng, false);
    expect(s.vote?.final).toBe(true);
    expect(s.invites).toHaveLength(0);
  });

  it('the turn clock waits for the vote', () => {
    const { s, rng, a, b, c } = three(31, { timer: 60 });
    ally(s, a, b, rng);
    act(s, a, { type: 'holdReactions', on: false }, ctx(rng, 1000));
    s.deadline = 61_000;
    expect(act(s, c, { type: 'concede' }, ctx(rng, 21_000))).toEqual({ ok: true });
    expect(s.deadline).toBeNull();
    expect(s.vote!.left).toBe(40_000);
    act(s, a, { type: 'vote', yes: true }, ctx(rng, 500_000));
    act(s, b, { type: 'vote', yes: true }, ctx(rng, 900_000));
    expect(s.siege).not.toBeNull();
    expect(s.deadline).toBe(940_000);
  });

  it('AI allies vote without being asked twice', () => {
    const { s, rng, a, b, c } = three(31, {}, [true, true, true]);
    ally(s, a, b, rng);
    fall(s, c, rng);
    for (let i = 0; i < 4 && s.vote; i++) {
      const duty = aiDuty(s);
      expect([a, b]).toContain(duty);
      expect(act(s, duty, botAction(viewFor(s, duty), duty, rng), ctx(rng))).toEqual({ ok: true });
    }
    expect(s.vote).toBeNull();
    expect(s.phase === 'over' || !!s.siege).toBe(true);
  });

  it('a host who kicks a silent ally hands the vote to an AI', () => {
    const { s, rng, a, b, c } = three();
    ally(s, a, b, rng);
    fall(s, c, rng);
    s.players[b].ai = true;
    expect(aiDuty(s)).toBe(b);
  });

  it('a war from before .009 keeps its own rules', () => {
    const { s, rng, a, b, c } = three();
    delete s.opts.finale;
    ally(s, a, b, rng);
    fall(s, c, rng);
    expect(s.vote).toBeNull();
    expect(s.phase).not.toBe('over');
    expect(siegeBlocker(s, a)).toMatch(/neutral garrison/);
  });
});

describe('House pages for the Draft', () => {
  it('every House has its Ultimate both ways, pros and cons, and three Primus options from its own Characters', () => {
    expect(Object.keys(HOUSE_INFO).sort()).toEqual(HOUSES.map((h) => h.id).sort());
    HOUSES.forEach((H, h) => {
      const info = houseInfo(h);
      expect(info.vsPlayer.length, H.id).toBeGreaterThan(20);
      expect(info.vsAlliance.length, H.id).toBeGreaterThan(10);
      expect(info.pros.length, H.id).toBeGreaterThanOrEqual(2);
      expect(info.cons.length, H.id).toBeGreaterThanOrEqual(2);
      expect(info.top, H.id).toHaveLength(3);
      expect(new Set(info.top.map((t) => t.card)).size).toBe(3);
      for (const t of info.top) {
        expect(CARD[t.card], t.card).toBeDefined();
        expect(CARD[t.card].kind).toBe('character');
        expect(CARD[t.card].house, t.card).toBe(h);
        expect(CARD[t.card].passive, t.card).toBeDefined();
        expect(t.why.length).toBeGreaterThan(8);
      }
    });
  });
});
