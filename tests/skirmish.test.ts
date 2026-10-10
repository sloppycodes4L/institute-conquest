import { describe, expect, it } from 'vitest';
import { SKIRMISH_MAPS, SKIRMISH_MAX, skirmishGeo } from '../src/engine/skirmish.ts';
import { CARD, activeText, passiveText } from '../src/engine/cards.ts';
import {
  act, actingSeat, aiDuty, attackMods, cleanSettings, createGame, defenseMods, geo, housesOwned, inviteBlocker, isSkirmish, maxPlayers, NEUTRAL,
  reinforcementBreakdown, resolveSettings, siegeBlocker, territoriesOf, ultBlocker, viewFor, type GameState,
} from '../src/engine/engine.ts';
import { botAction, botFallback } from '../src/engine/bot.ts';

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ctx = (rng: () => number, now = 0) => ({ rng, now });
const war = (n: number, seed: number, map = 'earth', extra = {}) => {
  const rng = mulberry(seed);
  return { rng, s: createGame(Array.from({ length: n }, (_, i) => 'P' + i), rng, { settings: { mode: 'skirmish', map, ...extra } }) };
};
function choose(s: GameState, rng: () => number, cards: Record<number, string> = {}) {
  for (const p of s.players) expect(act(s, p.seat, { type: 'choose', card: cards[p.seat] ?? s.priv!.passage[p.seat]![0] }, ctx(rng))).toEqual({ ok: true });
}

// The classic board, as its box prints it: every border, by land or by sea.
const CLASSIC = `Alaska: Northwest Territory, Alberta, Kamchatka
Northwest Territory: Alaska, Alberta, Ontario, Greenland
Greenland: Northwest Territory, Ontario, Quebec, Iceland
Alberta: Alaska, Northwest Territory, Ontario, Western United States
Ontario: Northwest Territory, Alberta, Greenland, Quebec, Western United States, Eastern United States
Quebec: Ontario, Greenland, Eastern United States
Western United States: Alberta, Ontario, Eastern United States, Central America
Eastern United States: Ontario, Quebec, Western United States, Central America
Central America: Western United States, Eastern United States, Venezuela
Venezuela: Central America, Peru, Brazil
Peru: Venezuela, Brazil, Argentina
Brazil: Venezuela, Peru, Argentina, North Africa
Argentina: Peru, Brazil
Iceland: Greenland, Great Britain, Scandinavia
Scandinavia: Iceland, Great Britain, Northern Europe, Ukraine
Great Britain: Iceland, Scandinavia, Northern Europe, Western Europe
Northern Europe: Great Britain, Scandinavia, Ukraine, Southern Europe, Western Europe
Western Europe: Great Britain, Northern Europe, Southern Europe, North Africa
Southern Europe: Western Europe, Northern Europe, Ukraine, Middle East, Egypt, North Africa
Ukraine: Scandinavia, Northern Europe, Southern Europe, Ural, Afghanistan, Middle East
North Africa: Brazil, Western Europe, Southern Europe, Egypt, East Africa, Congo
Egypt: North Africa, Southern Europe, Middle East, East Africa
East Africa: Egypt, North Africa, Congo, South Africa, Madagascar, Middle East
Congo: North Africa, East Africa, South Africa
South Africa: Congo, East Africa, Madagascar
Madagascar: South Africa, East Africa
Ural: Ukraine, Siberia, China, Afghanistan
Siberia: Ural, Yakutsk, Irkutsk, Mongolia, China
Yakutsk: Siberia, Kamchatka, Irkutsk
Kamchatka: Yakutsk, Irkutsk, Mongolia, Japan, Alaska
Irkutsk: Siberia, Yakutsk, Kamchatka, Mongolia
Mongolia: Siberia, Irkutsk, Kamchatka, Japan, China
Japan: Kamchatka, Mongolia
Afghanistan: Ukraine, Ural, China, India, Middle East
China: Ural, Siberia, Mongolia, Afghanistan, India, Siam
Middle East: Ukraine, Southern Europe, Egypt, East Africa, Afghanistan, India
India: Middle East, Afghanistan, China, Siam
Siam: India, China, Indonesia
Indonesia: Siam, New Guinea, Western Australia
New Guinea: Indonesia, Western Australia, Eastern Australia
Western Australia: Indonesia, New Guinea, Eastern Australia
Eastern Australia: New Guinea, Western Australia`;

describe('skirmish boards', () => {
  for (const def of SKIRMISH_MAPS) {
    const g = skirmishGeo(def.id);
    it(`${def.name}: one connected board of sane territories, borders both ways`, () => {
      expect(g.skirmish!.id).toBe(def.id);
      expect(g.nt).toBe(Object.keys(def.terr).length);
      expect(new Set(g.territories.map((t) => t.name)).size).toBe(g.nt);
      for (let t = 0; t < g.nt; t++) {
        expect(g.hexes.filter((h) => h.t === t).length).toBeGreaterThanOrEqual(10);
        expect(g.adj[t].length).toBeGreaterThanOrEqual(2);
        for (const x of g.adj[t]) expect(g.adj[x]).toContain(t);
        expect(g.dist[0][t]).toBeLessThan(Infinity);
        expect(g.territories[t].isKeep).toBe(false);
        expect(g.territories[t].terrain).toBe('open');
      }
      expect(g.regions.flatMap((r) => r.terr).sort((a, b) => a - b)).toEqual(g.territories.map((t) => t.id));
      expect(g.foot).toEqual([]);
    });
  }
  it('Earth is the classic board: 42 territories, the six continents and their bonuses, and every border', () => {
    const g = skirmishGeo('earth'), T = g.territories;
    expect(g.nt).toBe(42);
    expect(g.regions.map((r) => [r.name, r.terr.length, r.bonus])).toEqual([
      ['North America', 9, 5], ['South America', 4, 2], ['Europe', 7, 5], ['Africa', 6, 3], ['Asia', 12, 7], ['Australia', 4, 2],
    ]);
    const want = new Map(CLASSIC.split('\n').map((l) => { const [a, b] = l.split(': '); return [a, b.split(', ').sort()] as const; }));
    expect(want.size).toBe(42);
    for (const t of T) expect(g.adj[t.id].map((x) => T[x].name).sort(), t.name).toEqual(want.get(t.name));
  });
  it('an unknown board is the first one', () => {
    expect(skirmishGeo('nowhere')).toBe(skirmishGeo(SKIRMISH_MAPS[0].id));
    expect(cleanSettings({ mode: 'skirmish', map: 'nowhere' }).map).toBe(SKIRMISH_MAPS[0].id);
    expect(cleanSettings({}).mode).toBe('conquest');
  });
});

describe('skirmish setup', () => {
  it('seats 2 to 4 Houses', () => {
    expect(maxPlayers('skirmish')).toBe(SKIRMISH_MAX);
    expect(maxPlayers('conquest')).toBe(7);
    expect(() => war(5, 1)).toThrow();
    expect(war(4, 1).s.players).toHaveLength(4);
  });
  for (const def of SKIRMISH_MAPS) for (const n of [2, 3, 4]) {
    it(`${def.name}, ${n} Houses: every territory is dealt, nothing is neutral, no Standards, no alliances, no Olympus`, () => {
      const { s } = war(n, 7 + n, def.id);
      const g = geo(s);
      expect(isSkirmish(s)).toBe(true);
      expect(g).toBe(skirmishGeo(def.id));
      expect(s.owner.every((o) => o >= 0 && o < n)).toBe(true);
      expect(s.armies.every((a) => a >= 1)).toBe(true);
      const counts = s.players.map((p) => territoriesOf(s, p.seat).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      // whoever moves last gets the odd territory
      if (g.nt % n) expect(counts[s.order[n - 1]]).toBe(Math.max(...counts));
      // armies: the same for all, plus a little for each place behind the first to move
      const armies = s.order.map((seat) => territoriesOf(s, seat).reduce((a, t) => a + s.armies[t], 0));
      for (let i = 1; i < n; i++) expect(armies[i]).toBeGreaterThanOrEqual(armies[i - 1]);
      expect(armies[0]).toBe(Math.max(s.opts.troops, territoriesOf(s, s.order[0]).length));
      expect(s.standards.every((st) => st.captured)).toBe(true);
      expect(s.opts.alliances).toBe(false);
      expect(s.opts.siege).toBe(false);
      expect(s.opts.finale).toBeUndefined();
      expect(s.priv!.deck.some((id) => CARD[id].kind === 'relic')).toBe(false);
      expect(!!s.ult).toBe(n >= 3);
    });
  }
  it('House picks are honoured, and Ultimates can be switched off', () => {
    const rng = mulberry(3);
    const s = createGame(['a', 'b', 'c'], rng, { settings: { mode: 'skirmish', map: 'mars', ultimates: false }, houses: [3, null, 3] });
    expect(s.players[0].house).toBe(3);
    expect(new Set(s.players.map((p) => p.house)).size).toBe(3);
    expect(s.ult).toBeUndefined();
    expect(resolveSettings(3, { mode: 'skirmish', map: 'mars' }).ultimates).toBe(true);
    expect(resolveSettings(2, { mode: 'skirmish', map: 'mars' }).ultimates).toBe(false);
  });
});

describe('skirmish rules', () => {
  it('no alliances and no siege', () => {
    const { s, rng } = war(3, 11);
    choose(s, rng);
    s.warBegun = true;
    expect(inviteBlocker(s, 0, 1)).toMatch(/off/);
    expect(siegeBlocker(s, 0)).toMatch(/off/);
    expect(act(s, s.cur, { type: 'invite', to: (s.cur + 1) % 3, public: true }, ctx(rng)).ok).toBe(false);
  });
  it('reinforcements: territories and whole regions, no Keep bonus', () => {
    const { s, rng } = war(2, 5);
    choose(s, rng, { 0: s.priv!.passage[0]!.find((id) => CARD[id].passive?.kind === 'fortify' || CARD[id].passive?.kind === 'conquest')! });
    const g = geo(s), aus = g.regions.find((r) => r.name === 'Australia')!;
    for (const t of aus.terr) s.owner[t] = 0;
    const rb = reinforcementBreakdown(s, 0);
    expect(rb.keeps).toBe(0);
    expect(rb.keepBonus).toBe(0);
    expect(rb.regions.map((r) => r.name)).toContain('Australia');
    expect(rb.total).toBe(Math.max(3, Math.floor(rb.territories / 3)) + rb.regions.reduce((a, r) => a + r.bonus, 0) + rb.general);
  });
  it('a House falls with its last territory: its cards and its House go to whoever took it, and the last one standing wins', () => {
    const { s, rng } = war(3, 21);
    choose(s, rng);
    const g = geo(s), a = s.cur, [b, c] = [0, 1, 2].filter((x) => x !== a);
    // b is down to one territory, next to a stack of a's
    const last = 0, from = g.adj[last][0];
    s.owner.fill(c);
    s.owner[last] = b; s.armies[last] = 1;
    s.owner[from] = a; s.armies[from] = 40;
    s.priv!.hands[b].push({ id: 'pax', locked: false });
    expect(act(s, a, { type: 'place', t: from, n: s.ts.reinforcements }, ctx(rng))).toEqual({ ok: true });
    expect(act(s, a, { type: 'endDraft' }, ctx(rng))).toEqual({ ok: true });
    expect(act(s, a, { type: 'attack', from, to: last, blitz: true }, ctx(rng))).toEqual({ ok: true });
    expect(s.owner[last]).toBe(a);
    expect(s.players[b].alive).toBe(false);
    expect(s.players[b].dominatedBy).toBe(a);
    expect(s.priv!.hands[a].some((x) => x.id === 'pax')).toBe(true);
    expect(housesOwned(s, a).sort()).toEqual([s.players[a].house, s.players[b].house].sort());
    expect(s.phase).not.toBe('over');
    // and now c's land, all of it but one, is a's: the last one ends the war
    if (s.ts.mustMove) act(s, a, { type: 'move', n: s.ts.mustMove.max }, ctx(rng));
    const cl = g.adj[last].find((t) => s.owner[t] === c)!;
    for (let t = 0; t < g.nt; t++) if (s.owner[t] === c && t !== cl) s.owner[t] = a;
    s.armies[cl] = 1; s.armies[last] = 60;
    expect(act(s, a, { type: 'attack', from: last, to: cl, blitz: true }, ctx(rng))).toEqual({ ok: true });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(a);
    expect(s.winners).toEqual([a]);
  });
  it('a concession leaves its land to the wilds, and the war goes on', () => {
    const { s, rng } = war(3, 31);
    choose(s, rng);
    const q = (s.cur + 1) % 3;
    expect(act(s, q, { type: 'concede' }, ctx(rng))).toEqual({ ok: true });
    expect(s.players[q].alive).toBe(false);
    expect(s.owner.some((o) => o === NEUTRAL)).toBe(true);
    expect(s.phase).not.toBe('over');
  });
});

describe('skirmish Ultimates', () => {
  it('no underdog rule and no waiting: any House may cast in its Draft from round 1, for the cards, with the cooldown after', () => {
    const { s, rng } = war(3, 61);
    choose(s, rng);
    const seat = s.cur, house = s.players[seat].house;
    expect(s.ult!.round).toBe(1);
    expect(ultBlocker(s, seat)?.code).toBe('cards');
    const own = Object.values(CARD).filter((c) => c.house === house && c.kind === 'character' && c.id !== s.players[seat].general).slice(0, 3).map((c) => c.id);
    s.priv!.hands[seat].push(...own.map((id) => ({ id, locked: false })));
    // make this House the clear leader: in the valley it could not cast
    for (let t = 0; t < s.owner.length - 2; t++) s.owner[t] = seat;
    expect(ultBlocker(s, seat)).toBeNull();
    const target = s.players.find((p) => p.seat !== seat && s.owner.includes(p.seat))!.seat;
    expect(act(s, seat, { type: 'ultimate', target, alliance: false, cards: own }, ctx(rng))).toEqual({ ok: true });
    expect(ultBlocker(s, seat)?.code).toBe('cooldown');
    // not on someone else's turn
    expect(ultBlocker(s, target)?.code).toBe('turn');
  });
  it('the valley keeps its rule', () => {
    const rng = mulberry(5);
    const s = createGame(['a', 'b', 'c'], rng, {});
    choose(s, rng);
    expect(ultBlocker(s, s.cur)?.code).toBe('round');
  });
});

describe('skirmish Passives and cards', () => {
  const withGeneral = (card: string, seed = 41) => {
    const { s, rng } = war(2, seed);
    const seat = s.players.find((p) => p.house === CARD[card].house)?.seat ?? 0;
    s.players[seat].house = CARD[card].house;
    s.priv!.passage[seat] = [card];
    choose(s, rng, { [seat]: card });
    return { s, rng, seat, foe: 1 - seat, g: geo(s) };
  };
  it('every Passive and card that leans on Keeps, Standards or neutrals says what it does on a board', () => {
    for (const c of Object.values(CARD)) {
      const p = passiveText(c, true), a = activeText(c, true);
      expect(`${p} ${a}`, c.id).not.toMatch(/Standard|Keep|neutral|Lowlands/);
      // the valley's text is untouched
      expect(passiveText(c, false)).toBe(c.passive?.text ?? '');
      expect(activeText(c, false)).toBe(c.active.text);
    }
    expect(activeText(CARD.mustang, true)).toMatch(/^Silver Tongue: /);
  });
  it('atkStd: +1 on the first battle of the turn only', () => {
    const { s, seat, foe, g } = withGeneral('darrow');
    s.cur = seat; s.phase = 'attack';
    const from = territoriesOf(s, seat).find((t) => g.adj[t].some((x) => s.owner[x] === foe))!, to = g.adj[from].find((x) => s.owner[x] === foe)!;
    // (even on land: the hunter's Passive is not in play)
    expect(attackMods(s, seat, from, to, false).atkHigh).toBe(1);
    s.ts.fought = 1;
    expect(attackMods(s, seat, from, to, false).atkHigh).toBe(0);
    s.ts.battle = { key: `${from}>${to}`, atk: false, breakLine: false, first: true };
    expect(attackMods(s, seat, from, to, false).atkHigh).toBe(1);
  });
  it('atkNeutral: +1 against a House that holds less land', () => {
    const { s, seat, foe, g } = withGeneral('titus');
    const from = territoriesOf(s, seat).find((t) => g.adj[t].some((x) => s.owner[x] === foe))!, to = g.adj[from].find((x) => s.owner[x] === foe)!;
    s.ts.fought = 1;
    expect(attackMods(s, seat, from, to, false).atkHigh).toBe(0);
    const spare = territoriesOf(s, foe).find((t) => t !== to)!;
    s.owner[spare] = seat;
    expect(attackMods(s, seat, from, to, false).atkHigh).toBe(1);
  });
  it('defKeep guards a region held whole; stdGuard stands where two of its own touch', () => {
    const k = withGeneral('cassius');
    const aus = k.g.regions.find((r) => r.name === 'Australia')!;
    for (const t of aus.terr) k.s.owner[t] = k.foe;
    k.s.owner[aus.terr[0]] = k.seat;
    expect(defenseMods(k.s, aus.terr[0]).defHigh).toBe(0);
    for (const t of aus.terr) k.s.owner[t] = k.seat;
    expect(defenseMods(k.s, aus.terr[0]).defHigh).toBe(1);

    const q = withGeneral('quill');
    const t = 0;
    q.s.owner.fill(q.foe);
    q.s.owner[t] = q.seat;
    expect(defenseMods(q.s, t).defLow).toBe(0);
    q.s.owner[q.g.adj[t][0]] = q.seat;
    expect(defenseMods(q.s, t).defLow).toBe(0);
    q.s.owner[q.g.adj[t][1]] = q.seat;
    expect(defenseMods(q.s, t).defLow).toBe(1);
  });
  it('a card that moved the Standard drops its armies; Silver Tongue talks round a small enemy garrison', () => {
    const { s, rng, seat, foe, g } = withGeneral('darrow', 51);
    while (s.cur !== seat) { const c = s.cur; act(s, c, { type: 'place', t: territoriesOf(s, c)[0], n: s.ts.reinforcements }, ctx(rng)); act(s, c, { type: 'endDraft' }, ctx(rng)); act(s, c, { type: 'endAttack' }, ctx(rng)); act(s, c, { type: 'endTurn' }, ctx(rng)); }
    const mine = territoriesOf(s, seat)[0], before = s.armies[mine];
    s.priv!.hands[seat].push({ id: 'rime', locked: false }, { id: 'mustang', locked: false });
    expect(act(s, seat, { type: 'play', card: 'rime', t: mine }, ctx(rng))).toEqual({ ok: true });
    expect(s.armies[mine]).toBe(before + 3);
    const from = territoriesOf(s, seat).find((t) => g.adj[t].some((x) => s.owner[x] === foe))!, to = g.adj[from].find((x) => s.owner[x] === foe)!;
    s.armies[to] = 3;
    expect(act(s, seat, { type: 'play', card: 'mustang', t: to }, ctx(rng)).ok).toBe(false); // 4 halves to 2
    s.armies[to] = 2;
    expect(act(s, seat, { type: 'play', card: 'mustang', t: to }, ctx(rng))).toEqual({ ok: true });
    expect(s.owner[to]).toBe(seat);
  });
});

describe('skirmish wars, bot against bot', () => {
  for (const def of SKIRMISH_MAPS) for (const n of [2, 3, 4]) {
    it(`${def.name}, ${n} Houses: the war ends with one House holding the board`, () => {
      const rng = mulberry(100 + n * 7 + def.id.length);
      const s = createGame(Array.from({ length: n }, (_, i) => 'B' + i), rng, { settings: { mode: 'skirmish', map: def.id } });
      let now = 0, refused = 0;
      while (s.phase !== 'over' && s.turn < 200 * n) {
        const d = aiDuty(s), seat = d >= 0 ? d : actingSeat(s);
        now += 1000;
        if (!act(s, seat, botAction(viewFor(s, seat), seat, rng), { rng, now }).ok) { refused++; act(s, actingSeat(s), botFallback(s, actingSeat(s)), { rng, now }); }
        expect(s.alliances).toHaveLength(0);
        expect(s.siege).toBeNull();
      }
      expect(s.phase).toBe('over');
      expect(refused).toBe(0);
      expect(s.winners).toEqual([s.winner]);
      expect(s.owner.every((o) => o === s.winner)).toBe(true);
      expect(s.players.filter((p) => p.alive).map((p) => p.seat)).toEqual([s.winner]);
    });
  }
});
