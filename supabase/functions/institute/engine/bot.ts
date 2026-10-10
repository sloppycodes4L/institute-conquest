// A plain-but-competent AI Primus. Works from a seat's *view* (no hidden info), so it can
// drive local AI seats in the browser and power the engine fuzz tests.

import { CARD, isSiegeCard } from './cards.ts';
import { HOUSES } from './data.ts';
import {
  type Action, type GameState, type Mods, BALANCE, NEUTRAL, ULT, ULT_ROUND, activeValue, allianceOf, allied, armyTotal, attackBlocker, attackMods,
  attackTargets, battleMods, connectedOwned, defenseMods, geo, guardAgainst, inviteBlocker, isSkirmish, isWildGarrison, joinRallyBlocker, marsTargets, modifyDice,
  mustTrade, olympusPreview, overwhelms, ownsHouse, passive, primusOptions, rallyBlocker, reactionCards, reinforcementBreakdown, siegeBlocker,
  quadCount, standardAt, stormCut, terrainMods, territoriesOf, ultBlocker, ultCards, ultStandings,
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

// ---------------------------------------------------------------------------
// House Ultimates: when to cast, on whom, and how to follow it up. All of it from the bot's own view.

/** Cast when the Ultimate is worth about two trades. */
const CAST_MIN = 20;
/** The Wild Hunt only when the strike on the Standard would then win this often. */
const HUNT_MIN = 0.7;
/** Blitzes rolled per fight when weighing a Solar Flare or a Wild Hunt. */
const MC_N = 300;

/**
 * A blitz of `att` armies (one stays behind) on `def` defenders and `guard`, rolled `N` times with the engine's dice
 * rules: how often it takes the territory, and what each side loses on average.
 */
function mcBlitz(att: number, def: number, guard: number, m: Mods, cap: number, rng: () => number, N = MC_N) {
  let wins = 0, aL = 0, dK = 0;
  const d6 = () => 1 + Math.floor(rng() * 6);
  for (let i = 0; i < N; i++) {
    let a = att, d = def, g = guard;
    while (a >= 2 && d + g > 0) {
      const A = Array.from({ length: Math.min(3, a - 1) }, d6).sort((x, y) => y - x);
      const D = Array.from({ length: Math.min(cap, d + g) }, d6).sort((x, y) => y - x);
      modifyDice(A, D, m);
      let al = 0, dl = 0;
      for (let k = 0; k < Math.min(A.length, D.length); k++) (A[k] > D[k] ? dl++ : al++);
      a -= al;
      const rl = Math.min(dl, d); d -= rl; g = Math.max(0, g - (dl - rl));
    }
    if (d + g === 0) wins++;
    aL += att - a; dK += def - d;
  }
  return { p: wins / N, aLost: aL / N, dKilled: dK / N };
}

const income = (v: GameState, m: number) => reinforcementBreakdown(v, m).total;

/** What a Solar Flare or a Wild Hunt on `targets` would be worth: the attacks it opens, and (the Hunt) the odds on the Standard. */
function planFollow(v: GameState, seat: number, targets: number[], kind: 'apollo' | 'diana', rng: () => number): { value: number; stdP: number } {
  const g = geo(v);
  const cands: { from: number; to: number; pW: number; gain: number; std: boolean }[] = [];
  for (const from of territoriesOf(v, seat)) {
    if (v.armies[from] < 4) continue;
    for (let to = 0; to < g.nt; to++) {
      if (!targets.includes(v.owner[to])) continue;
      // The Hunt gives its party Long Strike; a Flare is fought where the armies touch.
      if (kind === 'diana' ? g.dist[from][to] < 1 || g.dist[from][to] > 2 : !g.adj[from].includes(to)) continue;
      const h = standardAt(v, to), std = h >= 0;
      if (kind === 'diana' && !std) continue;
      const guard = std ? v.standards[h].guard : 0;
      const base: Mods = { ...attackMods(v, seat, from, to, false), ...defenseMods(v, to, 0) };
      const withM: Mods = kind === 'apollo' ? { ...base, atkHigh: base.atkHigh + 1, defHigh: base.defHigh - 1 } : base;
      const w = mcBlitz(v.armies[from], v.armies[to], kind === 'diana' ? 0 : guard, withM, 2, rng);
      const wo = mcBlitz(v.armies[from], v.armies[to], guard, base, 2, rng);
      // Taking a Standard takes the whole House.
      const dom = std ? armyTotal(v, v.owner[to]) : 0;
      cands.push({ from, to, pW: w.p, std, gain: (w.dKilled - w.aLost) - (wo.dKilled - wo.aLost) + (std ? (w.p - wo.p) * dom : 0) });
    }
  }
  if (kind === 'diana') {
    const best = cands.sort((a, b) => b.pW - a.pW)[0];
    return best ? { value: best.pW * armyTotal(v, v.owner[best.to]), stdP: best.pW } : { value: 0, stdP: 0 };
  }
  // Each stack attacks once, each territory is hit once, best gain first, and only fights it would win half the time.
  const used = new Set<number>(), hit = new Set<number>();
  let value = 0;
  for (const c of cands.sort((a, b) => b.gain - a.gain)) {
    if (used.has(c.from) || hit.has(c.to) || c.pW < 0.5) continue;
    used.add(c.from); hit.add(c.to); value += c.gain;
  }
  return { value, stdP: 0 };
}

/** What a strike, a stun or a theft would cost `targets`: armies destroyed, moved or denied. */
function directValue(v: GameState, seat: number, hid: string, target: number, targets: number[], ally: boolean): number {
  if (hid === 'mars') {
    // The whole stack swings: half dies, half joins Mars.
    return marsTargets(v, seat, targets).filter((t) => v.owner[t] >= 0).map((t) => v.armies[t]).sort((a, b) => b - a).slice(0, ULT.marsPicks).reduce((a, x) => a + x, 0);
  }
  if (hid === 'jupiter') return Math.max(0, income(v, target) - ULT.stormCut) + Math.max(...Array.from({ length: quadCount(v) }, (_, q) => stormCut(v, target, q).cut));
  let val = 0;
  for (const m of targets) {
    switch (hid) {
      case 'pluto':
        for (const t of territoriesOf(v, m)) {
          let a = v.armies[t];
          if (standardAt(v, t) >= 0) continue;
          for (const pct of ally ? ULT.rot.slice(0, 2) : ULT.rot) { if (a < ULT.rotMin) break; const k = Math.floor(a * pct); val += k; a -= k; }
        }
        val += (ally ? 0.5 : 0.6) * income(v, m);
        break;
      // Blackout: the skipped Draft, and about half again for the attacks and the Fortify lost with it.
      case 'minerva': val += (ally ? 1.1 : 1.5) * income(v, m); break;
      // The Tithe: what they lose, and what we gain.
      case 'ceres': { const d = (ally ? 0.45 : 0.75) * income(v, m); val += d + Math.min(ULT.titheCap, d); break; }
    }
  }
  return val;
}

/**
 * The Ultimate to cast now, or null to hold it. Strikes, stuns and thefts go at the Win % leader; a Solar Flare or a Wild
 * Hunt needs a follow-up attack, so it may go at any party ranked above the bot's own. Against a public alliance it
 * weighs the whole alliance and each member alone.
 */
function ultChoice(v: GameState, seat: number, rng: () => number): Action | null {
  const cards = ultCards(v, seat);
  if (!cards) return null;
  const hid = HOUSES[v.players[seat].house].id;
  const parties = ultStandings(v);
  const mine = parties.find((p) => p.members.includes(seat));
  const others = parties.filter((p) => !p.members.includes(seat));
  if (!others.length) return null;
  const follow = hid === 'apollo' || hid === 'diana';
  const pool = follow ? others.filter((p) => p.score > (mine?.score ?? 0)) : [others[0]];
  let best: { target: number; alliance: boolean; value: number; ok: boolean } | null = null;
  for (const p of pool) {
    const opts = p.members.map((m) => ({ target: m, targets: [m], alliance: false }));
    // Stormfall spreads to the target's allies by itself.
    if (p.members.length > 1 && hid !== 'jupiter') opts.unshift({ target: p.members[0], targets: p.members, alliance: true });
    for (const o of opts) {
      let value: number, ok: boolean;
      if (hid === 'apollo' || hid === 'diana') {
        const plan = planFollow(v, seat, o.targets, hid, rng);
        value = plan.value;
        ok = value >= CAST_MIN && (hid !== 'diana' || plan.stdP >= HUNT_MIN);
      } else {
        value = directValue(v, seat, hid, o.target, o.targets, o.alliance);
        ok = value >= CAST_MIN;
      }
      if (!best || (ok && !best.ok) || (ok === best.ok && value > best.value)) best = { target: o.target, alliance: o.alliance, value, ok };
    }
  }
  if (!best?.ok) return null;
  const a: Action = { type: 'ultimate', target: best.target, alliance: best.alliance, cards };
  if (hid === 'mars') {
    // The three largest stacks it may seize: the target's first, a neutral's only to fill up.
    const targets = best.alliance ? ultStandings(v).find((p) => p.members.includes(best!.target))!.members : [best.target];
    a.picks = marsTargets(v, seat, targets).sort((x, y) => (v.owner[x] < 0 ? 1 : 0) - (v.owner[y] < 0 ? 1 : 0) || v.armies[y] - v.armies[x] || x - y).slice(0, ULT.marsPicks);
  }
  if (hid === 'jupiter') a.picks = [Array.from({ length: quadCount(v) }, (_, q) => q).reduce((b, q) => (stormCut(v, best!.target, q).cut > stormCut(v, best!.target, b).cut ? q : b), 0)];
  return a;
}

/**
 * The attack that follows the bot's own Solar Flare or Wild Hunt, on the turn it was cast: the Hunt throws every stack
 * in reach at the hunted Standard, largest first; the Flare takes the fights it would win at least half the time.
 */
function ultFollowUp(v: GameState, seat: number, rng: () => number): Action | null {
  const e = v.ult?.effects.find((x) => (x.kind === 'flare' || x.kind === 'hunt') && x.caster === seat && x.turn === v.turn);
  if (!e) return null;
  let best: { from: number; to: number; score: number } | null = null;
  for (const from of territoriesOf(v, seat)) {
    if (v.armies[from] < 4) continue;
    for (const to of attackTargets(v, seat, from)) {
      if (!e.targets!.includes(v.owner[to]) || attackBlocker(v, seat, from, to)) continue;
      let score: number;
      if (e.kind === 'hunt') {
        if (standardAt(v, to) < 0) continue;
        score = v.armies[from] - v.armies[to] / 1000;
      } else {
        score = mcBlitz(v.armies[from], v.armies[to], guardAgainst(v, seat, to), battleMods(v, seat, from, to, false), 2, rng).p;
        if (score < 0.5) continue;
      }
      if (!best || score > best.score) best = { from, to, score };
    }
  }
  return best ? { type: 'attack', from: best.from, to: best.to, blitz: true } : null;
}

/**
 * What to play for an AI whose move the engine refused: the plainest legal step, so no war stalls on it. A Draft is
 * placed (all of it, on one territory) before it is ended: End Draft with armies in hand is itself refused. The
 * known case is a Rally that filled in secret: the AI can't see that, answers it, and is turned away.
 */
export function botFallback(s: GameState, seat: number): Action {
  if (s.reaction) return { type: 'react', card: null };
  if (s.ts.mustMove) return { type: 'move', n: s.ts.mustMove.min };
  if (s.phase === 'draft') {
    const t = s.owner.indexOf(seat);
    return s.ts.reinforcements > 0 && t >= 0 ? { type: 'place', t, n: s.ts.reinforcements } : { type: 'endDraft' };
  }
  return { type: 'endTurn' };
}

export function botAction(v: GameState, seat: number, rng: () => number = Math.random): Action {
  const g = geo(v);
  const me = v.players[seat];
  // From the round before Ultimates open, one card of the birth House stays out of trades and plays: an Ultimate needs it.
  const held = v.ult && (isSkirmish(v) || v.ult.round >= ULT_ROUND - 1) ? (v.me?.hand ?? []).find((c) => !c.locked && CARD[c.id].house === me.house) : undefined;
  const hand = (v.me?.hand ?? []).filter((c) => c !== held);
  // Silenced (no cards, attacks or Fortify) or Pinned (no Fortify, the Standard stays): never ask for what the engine will refuse.
  const muted = !!v.ts.ultMuted && v.cur === seat, pinned = !!v.ts.ultPinned && v.cur === seat;

  if (v.phase === 'passage') {
    const opts = v.me?.passage;
    if (!opts) return { type: 'concede' }; // should never happen
    // Choose your Primus (or, in a war from before .008, the Passage): score every option and take the best.
    const score = (id: string) => (CARD[id].house === me.house ? 2 : 0) + (CARD[id].passive?.n ?? 0) + rng();
    const scores = opts.map(score);
    return { type: 'choose', card: opts[scores.reduce((b, x, i) => (x > scores[b] ? i : b), 0)] };
  }

  // Out-of-turn duties first: answer whispers, cast votes.
  const inv = v.invites.find((i) => i.to === seat);
  if (inv) {
    const living = v.players.filter((p) => p.alive);
    const strength = (x: number) => armiesOf(v, x);
    const strongest = living.reduce((b, p) => (strength(p.seat) > strength(b.seat) ? p : b), living[0]).seat;
    // The strongest House needs no friends, and nobody trusts a crowd. One alliance at a time.
    const size = allianceOf(v, inv.from)?.members.length ?? 1;
    const free = !allianceOf(v, seat) && (v.allyBan?.[seat] ?? 0) <= v.turn && (v.allyBan?.[inv.from] ?? 0) <= v.turn;
    return { type: 'answer', invite: inv.id, accept: free && strongest !== inv.from && strongest !== seat && size < 3 && rng() < 0.75 };
  }
  if (v.vote && !v.vote.yes.includes(seat) && !v.vote.no.includes(seat)) {
    const a = allianceOf(v, seat);
    return { type: 'vote', yes: !!a && readyForOlympus(v, a.members) };
  }

  if (v.reaction) {
    const r = v.reaction;
    const c = reactionCards(v, seat)[0];
    // Save the ambush for a Standard charge, a Keep, a Standard, or a garrison worth defending.
    const worth = r.commit != null || g.territories[r.to].isKeep || standardAt(v, r.to) >= 0 || v.armies[r.to] >= 5;
    return { type: 'react', card: c && worth ? c : null };
  }

  const sieging = !!v.siege?.members.includes(seat);
  // Allies are off limits until a siege has already failed or been voted down.
  const spare = (t: number) => v.owner[t] >= 0 && allied(v, seat, v.owner[t]) && v.siegeCooldown === 0;
  const mine = territoriesOf(v, seat);
  const enemyAdj = (t: number) => g.adj[t].filter((n) => v.owner[n] !== seat && !spare(n));
  const threat = (t: number) => enemyAdj(t).reduce((a, n) => a + v.armies[n], 0);
  const borders = mine.filter((t) => enemyAdj(t).length > 0);
  const myFoot = g.foot.filter((t) => v.owner[t] === seat);
  // Taking a territory is worth more the closer it brings us to holding its whole region.
  const regionPull = (t: number) => {
    const r = g.regions[g.territories[t].region];
    const held = r.terr.filter((x) => x !== t && v.owner[x] === seat).length;
    return held === r.terr.length - 1 ? 1 + r.bonus * 0.4 : (held / r.terr.length) * 0.8;
  };
  const bestFoot = myFoot.reduce((b, t) => (b < 0 || v.armies[t] > v.armies[b] ? t : b), -1);
  // How an attack on `to` weighs up: its defenders (honor guard included), counted for what they are worth on the dice.
  // Forest cover is worth a little, a lone neutral garrison rolls one die, and a Keep's Walls (with its holder's Keep
  // Passives) make every defender worth about a third more per point on the highest die.
  const defenders = (to: number) => v.armies[to] + guardAgainst(v, seat, to);
  const stiffness = (from: number, to: number) =>
    (terrainMods(v, from, to).def ? 1.15 : 1) * (isWildGarrison(v, to) ? 0.6 : 1) * (g.territories[to].isKeep ? 1 + 0.35 * Math.max(0, battleMods(v, seat, from, to, false).defHigh) : 1);
  const ATTACK_RATIO = 1.4;
  /** One of our territories beside a Keep that this Draft, massed there, would let us storm (the cheapest such Keep). */
  const keepToStorm = (): number | null => {
    let best: { t: number; short: number } | null = null;
    for (const t of borders) for (const k of enemyAdj(t)) {
      if (!g.territories[k].isKeep) continue;
      if (standardAt(v, k) >= 0 && v.owner[k] >= 0 && v.turn <= v.players.length) continue;
      const need = Math.ceil(ATTACK_RATIO * defenders(k) * stiffness(t, k)) + 1;
      const short = need - v.armies[t];
      // Already enough there: nothing to mass. Out of this Draft's reach: keep building where the usual score says.
      if (short <= 0 || short > v.ts.reinforcements) continue;
      if (!best || short < best.short) best = { t, short };
    }
    return best ? best.t : null;
  };

  // A conquered Keep with a matching Character in hand gets a Primus: the one with the biggest Passive.
  if (!v.ts.mustMove) {
    const opt = primusOptions(v, seat)[0];
    if (opt) {
      const card = opt.cards.reduce((b, c) => ((CARD[c].passive?.n ?? 0) > (CARD[b].passive?.n ?? 0) ? c : b), opt.cards[0]);
      return { type: 'primus', keep: opt.keep, card };
    }
  }

  if (v.phase === 'draft') {
    // An Ultimate comes before anything else spends the cards. The AI casts when it may; it never leaves an alliance to get the right.
    if (v.ult && !ultBlocker(v, seat)) {
      const cast = ultChoice(v, seat, rng);
      if (cast) return cast;
    }
    const a = allianceOf(v, seat);
    if (a && !siegeBlocker(v, seat) && readyForOlympus(v, a.members)) return { type: 'proposeSiege' };
    // The strongest House calls the valley to its banner now and then.
    if (!rallyBlocker(v, seat) && rng() < 0.2) return { type: 'openRally' };
    // Answer a Rally when the rallier's side is clearly stronger than ours.
    if (v.rally && !joinRallyBlocker(v, seat)) {
      const side = (x: number) => (allianceOf(v, x)?.members ?? [x]).reduce((s, m) => s + armyTotal(v, m), 0);
      if (side(v.rally.by) + armyTotal(v, seat) > side(seat) * 1.4 && rng() < 0.8) return { type: 'joinRally' };
    }
    if ((a?.members.length ?? 1) < 3 && v.warBegun && rng() < 0.12) {
      const living = v.players.filter((p) => p.alive && p.seat !== seat);
      const strongest = living.reduce((b, p) => (armiesOf(v, p.seat) > armiesOf(v, b.seat) ? p : b), living[0]);
      const pick = living.filter((p) => p !== strongest && !inviteBlocker(v, seat, p.seat));
      if (pick.length) return { type: 'invite', to: pick[Math.floor(rng() * pick.length)].seat, public: rng() < 0.5 };
    }
    const unlocked = muted ? [] : hand.filter((h) => !h.locked);
    // Proctors we can't use are worth two fresh cards.
    const dud = unlocked.find((h) => CARD[h.id].kind === 'proctor' && !ownsHouse(v, seat, CARD[h.id].house));
    if (dud && hand.length < 4) return { type: 'discardProctor', card: dud.id };
    const tradeable = unlocked.filter((h) => CARD[h.id].active.kind !== 'counter' || hand.length >= 5);
    if (hand.length >= 5 && unlocked.length >= 3) return { type: 'trade', cards: unlocked.slice(0, 3).map((h) => h.id) };
    // The hand is full with the held card in it: the Draft can't end without a trade, so the held card goes if it must.
    if (!muted && mustTrade(v, seat)) {
      const all = (v.me?.hand ?? []).filter((h) => !h.locked);
      return { type: 'trade', cards: [...unlocked, ...all.filter((h) => !unlocked.includes(h))].slice(0, 3).map((h) => h.id) };
    }
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
        case 'moveStd': {
          // (Only in a Skirmish, where the card is plain armies on one territory: the most threatened border.)
          if (!isSkirmish(v)) break;
          const tgt = [...borders].sort((a, b) => threat(b) - v.armies[b] - (threat(a) - v.armies[a]))[0];
          if (tgt != null) return { type: 'play', card: h.id, t: tgt };
          break;
        }
        case 'parley': {
          const tgt = [...new Set(mine.flatMap(enemyAdj))].find((t) => (isSkirmish(v) || v.owner[t] === NEUTRAL) && v.armies[t] <= n);
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
      // A Keep's Walls take a real stack to break: when this Draft is enough to storm one, mass it there.
      const storm = keepToStorm();
      if (storm != null) return { type: 'place', t: storm, n: v.ts.reinforcements };
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
    if (muted) return { type: 'endAttack' };
    // The attacks a Solar Flare or a Wild Hunt was cast for come first.
    const follow = ultFollowUp(v, seat, rng);
    if (follow) return follow;
    if (sieging && bestFoot >= 0 && v.armies[bestFoot] >= 4) return { type: 'assault', from: bestFoot, blitz: true };
    const stdAt = v.standards[me.house].captured ? -1 : v.standards[me.house].at;
    let best: { from: number; to: number; score: number } | null = null;
    for (const from of mine) {
      if (v.armies[from] < 3) continue;
      for (const to of attackTargets(v, seat, from)) {
        if (spare(to)) continue;
        const defStd = standardAt(v, to);
        if (defStd >= 0 && v.owner[to] >= 0 && v.turn <= v.players.length) continue;
        const def = defenders(to);
        // The high ground is worth a little; a lone neutral garrison yields to twice its number.
        const tm = terrainMods(v, from, to);
        const free = overwhelms(v, from, to);
        const ratio = free ? 9 : ((v.armies[from] - 1) * (tm.atk ? 1.1 : 1)) / Math.max(1, def * stiffness(from, to));
        if (ratio < ATTACK_RATIO) continue;
        // A neutral House's Standard brings its Keep and the House itself (card boosts, its Proctor), but no land.
        let score = ratio + (defStd >= 0 ? (v.owner[to] === NEUTRAL ? 2 : 4) : 0) + (g.territories[to].isKeep ? 1.5 : 0) + (v.owner[to] === NEUTRAL ? 0 : 0.5) + regionPull(to);
        if (from === stdAt && enemyAdj(from).length === 1 && v.armies[from] - 1 < def + 2) score -= 3; // don't strip the Standard
        if (!best || score > best.score) best = { from, to, score };
      }
    }
    if (best) {
      if (best.from === stdAt && !v.ts.stdRaised && !overwhelms(v, best.from, best.to) && v.armies[best.from] >= 2 * v.armies[best.to] + 6 && rng() < 0.35) {
        return { type: 'attack', from: best.from, to: best.to, commit: v.armies[best.from] - 1 };
      }
      return { type: 'attack', from: best.from, to: best.to, blitz: true };
    }
    return { type: 'endAttack' };
  }

  if (v.phase === 'fortify') {
    const st = v.standards[me.house];
    if (!v.ts.stdMoved && !st.captured && !pinned) {
      // Pull the Standard home if it wandered onto a dangerous frontier.
      const home = g.keepOf(me.house);
      if (st.at !== home && v.owner[home] === seat && threat(st.at) > v.armies[st.at] && connectedOwned(v, seat, st.at).has(home)) {
        return { type: 'moveStd', to: home };
      }
    }
    const limit = v.ts.buffs.fortifyAll ? 99 : 1 + passive(v, seat, 'fortify');
    if (v.ts.fortifies < limit && !muted && !pinned) {
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
