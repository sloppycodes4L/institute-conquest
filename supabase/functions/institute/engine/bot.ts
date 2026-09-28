// A plain-but-competent AI Primus. Works from a seat's *view* (no hidden info), so it can
// drive local AI seats in the browser and power the engine fuzz tests.

import { CARD, isSiegeCard } from './cards.ts';
import {
  type Action, type GameState, BALANCE, NEUTRAL, activeValue, allianceOf, allied, attackTargets, connectedOwned, geo,
  inviteBlocker, olympusPreview, ownsHouse, passive, reinforcementBreakdown, siegeBlocker, standardAt, territoriesOf,
} from './engine.ts';

const armiesOf = (v: GameState, seat: number) => territoriesOf(v, seat).reduce((a, t) => a + v.armies[t], 0);

/** Rough odds check: can this alliance's armies break Olympus before time runs out? */
function readyForOlympus(v: GameState, members: number[]) {
  const o = olympusPreview(v, members);
  const need = (o.garrison + o.regen * o.turns) * 2.1;
  // Only armies that can march (one must stay in every territory), plus the drafts to come.
  const have = members.reduce((a, m) => a + armiesOf(v, m) - territoriesOf(v, m).length + reinforcementBreakdown(v, m).total * BALANCE.olyRounds, 0) * 0.75;
  return have >= need;
}

export function botAction(v: GameState, seat: number, rng: () => number = Math.random): Action {
  const g = geo(v);
  const me = v.players[seat];
  const hand = v.me?.hand ?? [];

  if (v.phase === 'passage') {
    const opts = v.me?.passage;
    if (!opts) return { type: 'concede' }; // should never happen
    const score = (id: string) => (CARD[id].house === me.house ? 2 : 0) + (CARD[id].passive?.n ?? 0) + rng();
    return { type: 'choose', card: score(opts[0]) >= score(opts[1]) ? opts[0] : opts[1] };
  }

  // Out-of-turn duties first: answer whispers, cast votes.
  const inv = v.invites.find((i) => i.to === seat);
  if (inv) {
    const living = v.players.filter((p) => p.alive);
    const strength = (x: number) => armiesOf(v, x);
    const strongest = living.reduce((b, p) => (strength(p.seat) > strength(b.seat) ? p : b), living[0]).seat;
    // The strongest House needs no friends, and nobody trusts a crowd.
    const size = (allianceOf(v, inv.from) ?? allianceOf(v, seat))?.members.length ?? 1;
    return { type: 'answer', invite: inv.id, accept: strongest !== inv.from && strongest !== seat && size < 3 && rng() < 0.75 };
  }
  if (v.vote && !v.vote.yes.includes(seat) && !v.vote.no.includes(seat)) {
    const a = allianceOf(v, seat);
    return { type: 'vote', yes: !!a && readyForOlympus(v, a.members) };
  }

  if (v.reaction) {
    const c = hand.find((h) => !h.locked && CARD[h.id].active.kind === 'counter');
    return { type: 'react', card: c ? c.id : null };
  }

  const sieging = !!v.siege?.members.includes(seat);
  // Allies are off limits until a siege has already failed or been voted down.
  const spare = (t: number) => v.owner[t] >= 0 && allied(v, seat, v.owner[t]) && v.siegeCooldown === 0;
  const mine = territoriesOf(v, seat);
  const enemyAdj = (t: number) => g.adj[t].filter((n) => v.owner[n] !== seat && !spare(n));
  const threat = (t: number) => enemyAdj(t).reduce((a, n) => a + v.armies[n], 0);
  const borders = mine.filter((t) => enemyAdj(t).length > 0);
  const myFoot = g.foot.filter((t) => v.owner[t] === seat);
  const bestFoot = myFoot.reduce((b, t) => (b < 0 || v.armies[t] > v.armies[b] ? t : b), -1);

  if (v.phase === 'draft') {
    const a = allianceOf(v, seat);
    if (a && !siegeBlocker(v, seat) && readyForOlympus(v, a.members)) return { type: 'proposeSiege' };
    if ((a?.members.length ?? 1) < 3 && v.warBegun && rng() < 0.12) {
      const living = v.players.filter((p) => p.alive && p.seat !== seat);
      const strongest = living.reduce((b, p) => (armiesOf(v, p.seat) > armiesOf(v, b.seat) ? p : b), living[0]);
      const pick = living.filter((p) => p !== strongest && !inviteBlocker(v, seat, p.seat));
      if (pick.length) return { type: 'invite', to: pick[Math.floor(rng() * pick.length)].seat, public: rng() < 0.5 };
    }
    const unlocked = hand.filter((h) => !h.locked);
    // Proctors we can't use are worth two fresh cards.
    const dud = unlocked.find((h) => CARD[h.id].kind === 'proctor' && !ownsHouse(v, seat, CARD[h.id].house));
    if (dud && hand.length < 4) return { type: 'discardProctor', card: dud.id };
    const tradeable = unlocked.filter((h) => CARD[h.id].active.kind !== 'counter' || hand.length >= 5);
    if (hand.length >= 5 && unlocked.length >= 3) return { type: 'trade', cards: unlocked.slice(0, 3).map((h) => h.id) };
    for (const h of tradeable) {
      const c = CARD[h.id];
      if (c.kind === 'proctor' && !ownsHouse(v, seat, c.house)) continue;
      if (isSiegeCard(c)) { if (sieging) return { type: 'play', card: h.id }; continue; }
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
          const rich = v.players.filter((p) => p.alive && p.seat !== seat && !allied(v, seat, p.seat) && v.handCounts[p.seat] > 0)
            .sort((a, b) => v.handCounts[b.seat] - v.handCounts[a.seat])[0];
          if (rich) return { type: 'play', card: h.id, seat: rich.seat };
          break;
        }
      }
    }
    if (unlocked.length >= 3 && (hand.length >= 4 || rng() < 0.3)) return { type: 'trade', cards: unlocked.slice(0, 3).map((h) => h.id) };
    if (v.ts.reinforcements > 0) {
      if (sieging && bestFoot >= 0) return { type: 'place', t: bestFoot, n: v.ts.reinforcements };
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
    if (sieging && bestFoot >= 0 && v.armies[bestFoot] >= 4) return { type: 'assault', from: bestFoot, blitz: true };
    const stdAt = v.standards[me.house].captured ? -1 : v.standards[me.house].at;
    let best: { from: number; to: number; score: number } | null = null;
    for (const from of mine) {
      if (v.armies[from] < 3) continue;
      for (const to of attackTargets(v, seat, from)) {
        if (spare(to)) continue;
        const defStd = standardAt(v, to);
        if (defStd >= 0 && v.owner[to] >= 0 && v.turn <= v.players.length) continue;
        const def = v.armies[to] + (defStd >= 0 ? v.standards[defStd].guard : 0);
        const ratio = (v.armies[from] - 1) / Math.max(1, def);
        if (ratio < 1.4) continue;
        let score = ratio + (defStd >= 0 ? 4 : 0) + (g.territories[to].isKeep ? 1.5 : 0) + (v.owner[to] === NEUTRAL ? 0 : 0.5);
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
      const home = g.keepOf(me.house);
      if (st.at !== home && v.owner[home] === seat && threat(st.at) > v.armies[st.at] && connectedOwned(v, seat, st.at).has(home)) {
        return { type: 'moveStd', to: home };
      }
    }
    const limit = v.ts.buffs.fortifyAll ? 99 : 1 + passive(v, seat, 'fortify');
    if (v.ts.fortifies < limit) {
      const interior = mine.filter((t) => enemyAdj(t).length === 0 && v.armies[t] > 1).sort((a, b) => v.armies[b] - v.armies[a]);
      for (const from of interior) {
        const reach = connectedOwned(v, seat, from);
        if (sieging && bestFoot >= 0 && from !== bestFoot && reach.has(bestFoot)) return { type: 'fortify', from, to: bestFoot, n: v.armies[from] - 1 };
        const dest = borders.filter((t) => reach.has(t)).sort((a, b) => threat(b) - v.armies[b] - (threat(a) - v.armies[a]))[0];
        if (dest != null) return { type: 'fortify', from, to: dest, n: v.armies[from] - 1 };
      }
    }
    return { type: 'endTurn' };
  }
  return { type: 'endTurn' };
}
