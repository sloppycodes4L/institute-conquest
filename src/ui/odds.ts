// Battle odds: the exact chance that a blitz takes the target, using the engine's dice rules and modifiers.

import { BALANCE, NEUTRAL, geo, passive, standardAt, terrainMods, type GameState } from '../engine/engine.ts';

export interface Fight {
  /** Attacking units (armies that can fight; one always stays behind in a normal attack). */
  att: number;
  /** Defending units, honor guard included. */
  def: number;
  /** Most dice the defender may roll. */
  defCap: number;
  atkHigh: number; atkAll: number; defHigh: number; defAll: number;
}

// One roll's outcomes for a dice matchup: [attacker losses, defender losses, probability].
const ROLLS = new Map<string, [number, number, number][]>();
function rollOutcomes(aDice: number, dDice: number, f: Fight): [number, number, number][] {
  const key = `${aDice},${dDice},${f.atkHigh},${f.atkAll},${f.defHigh},${f.defAll}`;
  let out = ROLLS.get(key);
  if (out) return out;
  const tally = new Map<string, number>();
  const n = aDice + dDice, total = 6 ** n;
  const dice = new Array(n).fill(1);
  for (let i = 0; i < total; i++) {
    let x = i;
    for (let k = 0; k < n; k++) { dice[k] = 1 + (x % 6); x = Math.floor(x / 6); }
    const a = dice.slice(0, aDice).sort((p, q) => q - p), d = dice.slice(aDice).sort((p, q) => q - p);
    a[0] += f.atkHigh; d[0] += f.defHigh;
    let al = 0, dl = 0;
    for (let k = 0; k < Math.min(aDice, dDice); k++) (a[k] + f.atkAll > d[k] + f.defAll ? dl++ : al++);
    const kk = `${al},${dl}`;
    tally.set(kk, (tally.get(kk) ?? 0) + 1);
  }
  out = [...tally.entries()].map(([k, c]) => { const [al, dl] = k.split(',').map(Number); return [al, dl, c / total]; });
  ROLLS.set(key, out);
  return out;
}

const WINS = new Map<string, number>();
/** Chance the attacker wipes out every defender before running out of attackers. */
export function winChance(f: Fight): number {
  const A = Math.max(0, Math.floor(f.att)), D = Math.max(0, Math.floor(f.def));
  if (D === 0) return 1;
  if (A === 0) return 0;
  const key = `${A},${D},${f.defCap},${f.atkHigh},${f.atkAll},${f.defHigh},${f.defAll}`;
  const hit = WINS.get(key);
  if (hit != null) return hit;
  // p[a][d]: chance to win from a attackers vs d defenders. Every roll costs at least one unit, so fill upward.
  const p: Float64Array[] = Array.from({ length: A + 1 }, () => new Float64Array(D + 1));
  for (let a = 0; a <= A; a++) p[a][0] = 1;
  for (let a = 1; a <= A; a++) {
    for (let d = 1; d <= D; d++) {
      let v = 0;
      for (const [al, dl, pr] of rollOutcomes(Math.min(3, a), Math.min(f.defCap, d), f)) v += pr * p[Math.max(0, a - al)][Math.max(0, d - dl)];
      p[a][d] = v;
    }
  }
  const r = p[A][D];
  if (WINS.size > 4000) WINS.clear();
  WINS.set(key, r);
  return r;
}

/** The fight as the engine would run `seat`'s blitz from `from` on `to` right now. */
export function attackFight(s: GameState, seat: number, from: number, to: number): Fight {
  const g = geo(s);
  const def = s.owner[to];
  const h = standardAt(s, to);
  const guard = h >= 0 ? s.standards[h].guard : 0;
  const same = s.ts.battle?.key === `${from}>${to}`;
  const atkBuff = same ? s.ts.battle!.atk : s.ts.buffs.atk > 0;
  const breakLine = same ? s.ts.battle!.breakLine : s.ts.buffs.breakLine > 0;
  const tm = terrainMods(s, from, to);
  const keep = g.territories[to].isKeep;
  return {
    att: s.armies[from] - 1,
    def: s.armies[to] + guard,
    defCap: breakLine ? 1 : h >= 0 ? BALANCE.stdDefDice : 2,
    atkHigh: (atkBuff ? 1 : 0) + (def === NEUTRAL ? passive(s, seat, 'atkNeutral') : 0) + tm.atk,
    atkAll: s.ts.buffs.fury ? 1 : 0,
    defHigh: (keep && def >= 0 ? passive(s, def, 'defKeep') : 0) + tm.def,
    defAll: keep ? BALANCE.keepWall : 0,
  };
}

/** Raising the Standard with `commit` (plus its 3 phantoms). Leaves out the General's war cry, so it's a floor. */
export function standardFight(s: GameState, seat: number, from: number, to: number, commit: number): Fight {
  const f = attackFight(s, seat, from, to);
  return { ...f, att: commit + 3, atkHigh: f.atkHigh + passive(s, seat, 'atkStd') };
}

/** Blitzing Olympus from the Foot. */
export function assaultFight(s: GameState, from: number): Fight {
  const sg = s.siege!;
  const same = s.ts.battle?.key === `${from}>O`;
  return {
    att: s.armies[from] - 1,
    def: sg.garrison,
    defCap: (same ? s.ts.battle!.breakLine : s.ts.buffs.breakLine > 0) ? 1 : 2,
    atkHigh: ((same ? s.ts.battle!.atk : s.ts.buffs.atk > 0) ? 1 : 0) + s.ts.buffs.siegeAtk + terrainMods(s, from, -1).atk,
    atkAll: s.ts.buffs.fury ? 1 : 0,
    defHigh: sg.defHigh,
    defAll: s.ts.buffs.siegeWalls > 0 ? 0 : BALANCE.keepWall,
  };
}

export const pct = (p: number) => (p > 0.995 && p < 1 ? '>99%' : p < 0.005 && p > 0 ? '<1%' : `${Math.round(p * 100)}%`);
export const oddsClass = (p: number) => (p >= 0.65 ? 'good' : p >= 0.35 ? 'even' : 'bad');
