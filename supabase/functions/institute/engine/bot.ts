// A plain-but-competent AI Primus. Works from a seat's *view* (no hidden info), so it can
// drive local AI seats in the browser and power the engine fuzz tests.

import { ADJ, TERRITORIES, keepOf } from './data.ts';
import { CARD } from './cards.ts';
import { type Action, type GameState, NEUTRAL, activeValue, connectedOwned, ownsHouse, standardAt, territoriesOf } from './engine.ts';

export function botAction(v: GameState, seat: number, rng: () => number = Math.random): Action {
  const me = v.players[seat];
  const hand = v.me?.hand ?? [];

  if (v.phase === 'passage') {
    const opts = v.me?.passage;
    if (!opts) return { type: 'concede' }; // should never happen
    const score = (id: string) => (CARD[id].house === me.house ? 2 : 0) + (CARD[id].passive?.n ?? 0) + rng();
    return { type: 'choose', card: score(opts[0]) >= score(opts[1]) ? opts[0] : opts[1] };
  }

  if (v.reaction) {
    const c = hand.find((h) => !h.locked && CARD[h.id].active.kind === 'counter');
    return { type: 'react', card: c ? c.id : null };
  }

  const mine = territoriesOf(v, seat);
  const enemyAdj = (t: number) => ADJ[t].filter((n) => v.owner[n] !== seat);
  const threat = (t: number) => enemyAdj(t).reduce((a, n) => a + v.armies[n], 0);
  const borders = mine.filter((t) => enemyAdj(t).length > 0);

  if (v.phase === 'draft') {
    const unlocked = hand.filter((h) => !h.locked);
    // Proctors we can't use are worth two fresh cards.
    const dud = unlocked.find((h) => CARD[h.id].kind === 'proctor' && !ownsHouse(v, seat, CARD[h.id].house));
    if (dud && hand.length < 4) return { type: 'discardProctor', card: dud.id };
    const tradeable = unlocked.filter((h) => CARD[h.id].active.kind !== 'counter' || hand.length >= 5);
    if (hand.length >= 5 && unlocked.length >= 3) return { type: 'trade', cards: unlocked.slice(0, 3).map((h) => h.id) };
    for (const h of tradeable) {
      const c = CARD[h.id];
      if (c.kind === 'proctor' && !ownsHouse(v, seat, c.house)) continue;
      const n = activeValue(v, seat, c);
      switch (c.active.kind) {
        case 'armies': case 'harvest': case 'atkBuff': case 'breakLine': case 'fury': case 'draw': case 'raid':
          if (rng() < 0.6) return { type: 'play', card: h.id };
          break;
        case 'sabotage': {
          const tgt = [...new Set(mine.flatMap(enemyAdj))].sort((a, b) => v.armies[b] - v.armies[a])[0];
          if (tgt != null && v.armies[tgt] > 2) return { type: 'play', card: h.id, t: tgt };
          break;
        }
        case 'parley': {
          const tgt = [...new Set(mine.flatMap(enemyAdj))].find((t) => v.owner[t] === NEUTRAL && v.armies[t] <= n);
          if (tgt != null) return { type: 'play', card: h.id, t: tgt };
          break;
        }
        case 'steal': {
          const rich = v.players.filter((p) => p.alive && p.seat !== seat && v.handCounts[p.seat] > 0)
            .sort((a, b) => v.handCounts[b.seat] - v.handCounts[a.seat])[0];
          if (rich) return { type: 'play', card: h.id, seat: rich.seat };
          break;
        }
      }
    }
    if (unlocked.length >= 3 && (hand.length >= 4 || rng() < 0.3)) return { type: 'trade', cards: unlocked.slice(0, 3).map((h) => h.id) };
    if (v.ts.reinforcements > 0) {
      const pool = borders.length ? borders : mine;
      // Stack where we can hit something soft, or where the Standard needs guarding.
      const std = v.standards[me.house];
      const scoreT = (t: number) => {
        const weakest = Math.min(...enemyAdj(t).map((n) => v.armies[n]), 99);
        return v.armies[t] - weakest + (t === std.at ? threat(t) * 0.5 : 0) + rng() * 2;
      };
      const t = pool.reduce((b, t) => (scoreT(t) > scoreT(b) ? t : b), pool[0]);
      const n = v.ts.reinforcements > 6 && rng() < 0.4 ? Math.ceil(v.ts.reinforcements / 2) : v.ts.reinforcements;
      return { type: 'place', t, n };
    }
    return { type: 'endDraft' };
  }

  if (v.ts.mustMove) {
    const mm = v.ts.mustMove;
    const stay = threat(mm.from) > 0 ? Math.floor((mm.max - mm.min) / 3) : 0;
    return { type: 'move', n: Math.max(mm.min, mm.max - stay) };
  }

  if (v.phase === 'attack') {
    const stdAt = v.standards[me.house].captured ? -1 : v.standards[me.house].at;
    let best: { from: number; to: number; score: number } | null = null;
    for (const from of mine) {
      if (v.armies[from] < 3) continue;
      const targets = [...ADJ[from]];
      if (v.ts.buffs.longStrike > 0) for (const t of TERRITORIES) if (!targets.includes(t.id) && ADJ[from].some((m) => ADJ[m].includes(t.id))) targets.push(t.id);
      for (const to of targets) {
        if (v.owner[to] === seat) continue;
        const defStd = standardAt(v, to);
        const def = v.armies[to] + (defStd >= 0 ? v.standards[defStd].guard : 0);
        const ratio = (v.armies[from] - 1) / Math.max(1, def);
        if (ratio < 1.4) continue;
        let score = ratio + (defStd >= 0 ? 4 : 0) + (TERRITORIES[to].isKeep ? 1.5 : 0) + (v.owner[to] === NEUTRAL ? 0 : 0.5);
        if (from === stdAt && enemyAdj(from).length === 1 && v.armies[from] - 1 < def + 2) score -= 3; // don't strip the Standard
        if (!best || score > best.score) best = { from, to, score };
      }
    }
    if (best) {
      if (best.from === stdAt && v.armies[best.from] >= 2 * v.armies[best.to] + 6 && rng() < 0.35) {
        return { type: 'attack', from: best.from, to: best.to, commit: v.armies[best.from] - 1 };
      }
      return { type: 'attack', from: best.from, to: best.to, blitz: true };
    }
    return { type: 'endAttack' };
  }

  if (v.phase === 'fortify') {
    const st = v.standards[me.house];
    if (!v.ts.stdMoved && !st.captured) {
      // Pull the Standard home if it wandered onto a dangerous frontier.
      const home = keepOf(me.house);
      if (st.at !== home && v.owner[home] === seat && threat(st.at) > v.armies[st.at] && connectedOwned(v, seat, st.at).has(home)) {
        return { type: 'moveStd', to: home };
      }
    }
    const limit = v.ts.buffs.fortifyAll ? 99 : 1;
    if (v.ts.fortifies < limit) {
      const interior = mine.filter((t) => enemyAdj(t).length === 0 && v.armies[t] > 1).sort((a, b) => v.armies[b] - v.armies[a]);
      for (const from of interior) {
        const reach = connectedOwned(v, seat, from);
        const dest = borders.filter((t) => reach.has(t)).sort((a, b) => threat(b) - v.armies[b] - (threat(a) - v.armies[a]))[0];
        if (dest != null) return { type: 'fortify', from, to: dest, n: v.armies[from] - 1 };
      }
    }
    return { type: 'endTurn' };
  }
  return { type: 'endTurn' };
}
