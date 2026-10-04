// Battle odds: the exact chance that a blitz takes the target, using the engine's dice rules and modifiers.

import {
  BALANCE, battleMods, defenseMods, defenderDiceCap, geo, guardAgainst, isNeutralKeep, isWildGarrison, modifyDice, overwhelms, passive, terrainMods,
  type GameState, type Mods,
} from '../engine/engine.ts';

export interface Fight extends Mods {
  /** Attacking units (armies that can fight; one always stays behind in a normal attack). */
  att: number;
  /** Defending units, honor guard included. */
  def: number;
  /** Most dice the defender may roll. */
  defCap: number;
  /** The garrison yields without a fight (a neutral facing twice its number). */
  overwhelm?: boolean;
}

// One roll's outcomes for a dice matchup: [attacker losses, defender losses, probability].
const ROLLS = new Map<string, [number, number, number][]>();
function rollOutcomes(aDice: number, dDice: number, f: Fight): [number, number, number][] {
  const key = `${aDice},${dDice},${f.atkHigh},${f.atkLow},${f.atkAll},${f.defHigh},${f.defLow},${f.defAll}`;
  let out = ROLLS.get(key);
  if (out) return out;
  const tally = new Map<string, number>();
  const n = aDice + dDice, total = 6 ** n;
  const dice = new Array(n).fill(1);
  for (let i = 0; i < total; i++) {
    let x = i;
    for (let k = 0; k < n; k++) { dice[k] = 1 + (x % 6); x = Math.floor(x / 6); }
    const a = dice.slice(0, aDice).sort((p, q) => q - p), d = dice.slice(aDice).sort((p, q) => q - p);
    modifyDice(a, d, f);
    let al = 0, dl = 0;
    for (let k = 0; k < Math.min(aDice, dDice); k++) (a[k] > d[k] ? dl++ : al++);
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
  if (f.overwhelm) return 1;
  const A = Math.max(0, Math.floor(f.att)), D = Math.max(0, Math.floor(f.def));
  if (D === 0) return 1;
  if (A === 0) return 0;
  const key = `${A},${D},${f.defCap},${f.atkHigh},${f.atkLow},${f.atkAll},${f.defHigh},${f.defLow},${f.defAll}`;
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

/**
 * The fight as the engine would run `seat`'s blitz from `from` on `to` right now: the Walls, and any Ultimate in force
 * between the two (Glared, Radiant, and no honor guard for a Hunted House).
 */
export function attackFight(s: GameState, seat: number, from: number, to: number): Fight {
  const guard = guardAgainst(s, seat, to);
  const same = s.ts.battle?.key === `${from}>${to}`;
  const atkBuff = same ? s.ts.battle!.atk : s.ts.buffs.atk > 0;
  const breakLine = same ? s.ts.battle!.breakLine : s.ts.buffs.breakLine > 0;
  return {
    att: s.armies[from] - 1,
    def: s.armies[to] + guard,
    defCap: breakLine ? 1 : defenderDiceCap(s, to),
    ...battleMods(s, seat, from, to, atkBuff),
    overwhelm: overwhelms(s, from, to),
  };
}

/** Raising the Standard with `commit` (plus its 3 phantoms). Leaves out the General's war cry, so it's a floor. */
export function standardFight(s: GameState, seat: number, from: number, to: number, commit: number): Fight {
  const f = attackFight(s, seat, from, to);
  return { ...f, overwhelm: false, att: commit + 3, atkHigh: f.atkHigh + passive(s, seat, 'atkStd') };
}

/** Blitzing Olympus from the Foot. */
export function assaultFight(s: GameState, from: number): Fight {
  const sg = s.siege!;
  const same = s.ts.battle?.key === `${from}>O`;
  return {
    att: s.armies[from] - 1,
    def: sg.garrison,
    defCap: (same ? s.ts.battle!.breakLine : s.ts.buffs.breakLine > 0) ? 1 : 2,
    atkHigh: ((same ? s.ts.battle!.atk : s.ts.buffs.atk > 0) ? 1 : 0) + s.ts.buffs.siegeAtk,
    atkLow: terrainMods(s, from, -1).atk,
    atkAll: s.ts.buffs.fury ? 1 : 0,
    defHigh: sg.defHigh,
    defLow: 0,
    defAll: s.ts.buffs.siegeWalls > 0 ? 0 : BALANCE.olyWall,
  };
}

/**
 * A short note on how the defender fights: "Overwhelm", "1 die" (a lone neutral garrison), "neutral Keep" or "Keep"
 * (both behind Walls: see keepWalls).
 */
export function defenseNote(s: GameState, from: number, to: number): string {
  if (overwhelms(s, from, to)) return 'Overwhelm';
  if (isWildGarrison(s, to)) return '1 die';
  if (isNeutralKeep(s, to)) return 'neutral Keep';
  if (geo(s).territories[to]?.isKeep) return 'Keep';
  return '';
}
/** What a Keep's defender adds to its highest defense die: the Walls, plus a House's defKeep Passives. 0 off a Keep. */
export const keepWalls = (s: GameState, to: number) => (geo(s).territories[to]?.isKeep ? defenseMods(s, to).defHigh : 0);

export const pct = (p: number) => (p > 0.995 && p < 1 ? '>99%' : p < 0.005 && p > 0 ? '<1%' : `${Math.round(p * 100)}%`);
export const oddsClass = (p: number) => (p >= 0.65 ? 'good' : p >= 0.35 ? 'even' : 'bad');
