// House Ultimates in the UI: each House's Ultimate by name, its cast prompt, the state of the Ultimate button and the
// status icons on a banner. Pure (no DOM), so the icon logic is tested. The words and the icons are the design
// sheet's (docs/house-ultimates-sheet.html).

import { HOUSES } from '../engine/data.ts';
import { ULT_ROUND, allied, bottomHalfSeats, lockoutLeft, ultBlocker, ultStandings, type GameState } from '../engine/engine.ts';

export interface UltInfo {
  name: string;
  /** What kind of move it is, in two or three words. */
  kind: string;
  /** The line shown when it is cast, and who says it. */
  prompt: string;
  by: string;
  /** One line for the tutorial: "you may cast X: {one}". */
  one: string;
}
/** The seven Ultimates, by House id. */
export const ULTIMATE: Record<string, UltInfo> = {
  mars: { name: "Where's Sevro?", kind: 'Seize territory', prompt: 'They were in the dead horses…', by: '', one: 'seize 3 territories, and half their armies join you' },
  jupiter: { name: 'Stormfall', kind: 'Quadrant strike', prompt: 'I am the storm, you damp little shit.', by: 'Thunderjaw, Primus of Jupiter', one: 'cut every stack of theirs in one quadrant to 5, and cap their next Draft at 5' },
  pluto: { name: 'Rot', kind: 'Over 3 turns', prompt: 'The dead keep excellent secrets.', by: 'Proctor Pluto', one: 'their stacks of 5 or more decay for three turns, and so do their Drafts' },
  minerva: { name: 'Blackout', kind: 'Stun', prompt: 'Wisdom is just cruelty with patience.', by: 'Proctor Minerva', one: 'their next turn is skipped, and you read their hand' },
  ceres: { name: 'The Tithe', kind: 'Steal income · 2 turns', prompt: 'Bread first. Then we talk. Then I stab you.', by: 'Barley, Ceres Envoy', one: 'take half of their next Draft and a quarter of the one after' },
  apollo: { name: 'Solar Flare', kind: 'Defense debuff', prompt: 'Fair? Oh, sweet child.', by: 'Proctor Apollo', one: 'until your next turn their highest defense die is −1 against you and your allies' },
  diana: { name: 'The Wild Hunt', kind: 'Go for the Standard', prompt: 'Run, little deer.', by: 'Proctor Diana', one: 'their Standard loses its honor guard, and your party strikes 2 spaces away' },
};
export const ultOf = (house: number): UltInfo => ULTIMATE[HOUSES[house].id];

// ---------------------------------------------------------------------------
// status icons

export type IconId = 'ls' | 'radiant' | 'harvest' | 'ready' | 'recharge' | 'glared' | 'rot' | 'storm' | 'tithed' | 'hunted' | 'revealed' | 'blackout' | 'silenced' | 'pinned' | 'locked';
/** The ring: a buff (gold), a debuff (red) or a restriction (blue). */
export type IconKind = 'buff' | 'debuff' | 'ctrl';
export interface IconDef { n: string; k: IconKind; t: string; src: string; svg: string }
/** Name, kind, one-line text, where it comes from, and the drawing (a 24 x 24 stroke icon). */
export const ICON: Record<IconId, IconDef> = {
  ls: { n: 'Long Strike', k: 'buff', t: 'Attacks territories 2 spaces away, any target, as often as they like.', src: "The Wild Hunt · caster's party",
    svg: '<circle cx="5" cy="18" r="1.6"/><path d="M5 18C7 8 14 5 19 6"/><path d="M15 3.5 19.5 6 17 10"/>' },
  radiant: { n: 'Radiant', k: 'buff', t: '+1 on their highest attack die against Glared targets, this turn.', src: 'Solar Flare · caster · casting turn',
    svg: '<circle cx="12" cy="14" r="4"/><path d="M12 4v3M3 14h2M19 14h2M5.6 7.6l1.4 1.4M18.4 7.6 17 9M12 21v-1"/>' },
  harvest: { n: 'Harvest', k: 'buff', t: 'Their next Drafts gain what the Tithe took, up to 100 in total.', src: 'The Tithe · caster',
    svg: '<path d="M11 21V8"/><path d="M11 8c-3 0-4-3-4-5 2 0 4 1 4 5zM11 8c3 0 4-3 4-5-2 0-4 1-4 5zM11 13c-3 0-4-2.5-4-4 2 0 4 1 4 4zM11 13c3 0 4-2.5 4-4-2 0-4 1-4 4z"/><path d="M19 16v6M16 19h6"/>' },
  ready: { n: 'Ultimate ready', k: 'buff', t: 'In the bottom half and off cooldown. Can cast in the Draft with 3 cards, 1 from their own House.', src: 'Bottom half of parties · round 4+',
    svg: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>' },
  recharge: { n: 'Recharging', k: 'buff', t: 'Their Ultimate is on cooldown for this many of their turns.', src: 'After any cast',
    svg: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>' },
  glared: { n: 'Glared', k: 'debuff', t: "Their highest defense die is −1 against the caster's party.", src: 'Solar Flare',
    svg: '<path d="M12 21s-6-2.5-6-8V7l6-2 6 2v6c0 5.5-6 8-6 8z"/><path d="M9 12.5h6"/>' },
  rot: { n: 'Rot', k: 'debuff', t: 'Stacks of 5+ decay 30%, 20%, 10%, and their next Drafts are cut by the same amounts.', src: 'Rot',
    svg: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/><path d="M10 12.5l4 4M14 12.5l-4 4"/>' },
  storm: { n: 'Storm-bound', k: 'debuff', t: 'Their next Draft is capped at 5. Trades still add on top.', src: 'Stormfall',
    svg: '<path d="M13 2 5 13h6l-1 9 8-12h-6z"/>' },
  tithed: { n: 'Tithed', k: 'debuff', t: 'Their next Draft is cut 50%, the one after 25% (30% and 15% for an alliance).', src: 'The Tithe',
    svg: '<path d="M11 21V8"/><path d="M11 8c-3 0-4-3-4-5 2 0 4 1 4 5zM11 8c3 0 4-3 4-5-2 0-4 1-4 5zM11 13c-3 0-4-2.5-4-4 2 0 4 1 4 4zM11 13c3 0 4-2.5 4-4-2 0-4 1-4 4z"/><path d="M16 19h6"/>' },
  hunted: { n: 'Hunted', k: 'debuff', t: "Their Standard has no honor guard and they can't spring reaction cards against the hunters.", src: 'The Wild Hunt',
    svg: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' },
  revealed: { n: 'Revealed', k: 'debuff', t: 'The Minerva caster can see this whole hand. Click to open it.', src: 'Blackout · one player',
    svg: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>' },
  blackout: { n: 'Blacked Out', k: 'ctrl', t: 'Their next turn is skipped: no Draft, cards, attacks or Fortify.', src: 'Blackout · one player',
    svg: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><path d="M4 4l16 16"/>' },
  silenced: { n: 'Silenced', k: 'ctrl', t: 'Next turn: Draft −60%, and no cards, attacks or Fortify.', src: 'Blackout · alliance',
    svg: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><path d="M7 12h10"/>' },
  pinned: { n: 'Pinned', k: 'ctrl', t: "Their Standard can't move and they can't Fortify next turn.", src: 'The Wild Hunt',
    svg: '<path d="M9 3h6l-1 6 3 3H7l3-3-1-6zM12 15v6"/>' },
  locked: { n: 'Locked out', k: 'ctrl', t: "Can't form or join any alliance for 2 of their turns.", src: 'Walked out of an alliance',
    svg: '<path d="M9.5 14.5l-2.5 2.5a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0"/><path d="M14.5 9.5 17 7a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0"/><path d="M8 3.5l1 2M3.5 8l2 1M16 20.5l-1-2M20.5 16l-2-1"/>' },
};
/** Buffs first, then debuffs, then restrictions, as on the sheet. */
const ICON_ORDER: IconId[] = ['ready', 'recharge', 'ls', 'radiant', 'harvest', 'glared', 'rot', 'storm', 'tithed', 'hunted', 'revealed', 'blackout', 'silenced', 'pinned', 'locked'];

/**
 * One icon on a banner. `house`: the House that caused it (its colour is the dot), or null. `n`: how many of the
 * bearer's turns it has left, or 0 for an effect that ends at the caster's next turn (no number). `glow`: the bearer
 * can cast right now (only ever set on the viewer's own Ultimate ready).
 */
export interface StatusIcon { id: IconId; house: number | null; n: number; glow?: boolean }

/**
 * The status icons on `seat`'s banner, as `viewer` sees them (null: a spectator). Everything comes from the public
 * state: the lasting effects, the cooldowns, the standings and the alliance lockout. A war without Ultimates has none.
 */
export function statusIcons(v: GameState, seat: number, viewer: number | null): StatusIcon[] {
  const u = v.ult, p = v.players[seat];
  if (!u || !p?.alive) return [];
  const out = new Map<IconId, StatusIcon>();
  const add = (id: IconId, house: number | null, n = 0) => {
    const had = out.get(id);
    if (!had || n > had.n) out.set(id, { id, house: had?.house ?? house, n: Math.max(n, had?.n ?? 0) });
  };
  const houseOf = (cast: number) => u.casts.find((c) => c.id === cast)?.house ?? null;
  const live = ['draft', 'attack', 'fortify'].includes(v.phase);
  // The right to cast: decided at the start of a House's own turn, so on its turn the engine's word stands, and between
  // turns the standing as it is now.
  if (u.cd[seat] > 0) add('recharge', p.house, u.cd[seat]);
  else if (u.round >= ULT_ROUND && (live && v.cur === seat ? u.eligible[seat] : bottomHalfSeats(v).has(seat))) {
    add('ready', null);
    if (viewer === seat && !ultBlocker(v, seat)) out.get('ready')!.glow = true;
  }
  for (const e of u.effects) {
    const h = houseOf(e.cast);
    const left = (e.waves?.length ?? 1) - (e.i ?? 0);
    switch (e.kind) {
      case 'skip': if (e.target === seat) add('blackout', h, 1); break;
      case 'mute': if (e.target === seat) add('silenced', h, 1); break;
      case 'reveal': if (e.target === seat) add('revealed', h); break;
      case 'tithe': if (e.target === seat) add('tithed', h, left); break;
      case 'titheGain': if (e.caster === seat) add('harvest', h, 2 - (e.i ?? 0)); break;
      case 'rot': case 'drain': if (e.target === seat) add('rot', h, left); break;
      case 'cap': if (e.target === seat) add('storm', h, 1); break;
      case 'pin': if (e.target === seat) add('pinned', h, 1); break;
      case 'flare':
        if (e.targets?.includes(seat)) add('glared', h);
        if (e.caster === seat && e.turn === v.turn) add('radiant', h);
        break;
      case 'hunt':
        if (e.targets?.includes(seat)) add('hunted', h);
        if (e.caster === seat || allied(v, seat, e.caster!)) add('ls', h);
        break;
    }
  }
  // A restriction that has already ticked holds for the turn being played.
  if (live && v.cur === seat) {
    const by = (kind: string) => v.log.filter((e) => e.k === 'ultTick' && e.kind === kind && e.seat === seat).at(-1)?.house ?? null;
    if (v.ts.ultMuted && !out.has('silenced')) add('silenced', by('silenced'));
    if (v.ts.ultPinned && !out.has('pinned')) add('pinned', by('pinned'));
  }
  const lock = lockoutLeft(v, seat);
  if (lock > 0) add('locked', null, lock);
  return ICON_ORDER.flatMap((id) => (out.has(id) ? [out.get(id)!] : []));
}

/** Who Silenced or Pinned `seat` on the turn it is playing (the House of the caster), from the War Log. */
export function restrictedBy(v: GameState, seat: number, kind: 'silenced' | 'pinned'): { house: number; n: number } | null {
  const e = v.log.filter((x) => x.k === 'ultTick' && x.kind === kind && x.seat === seat).at(-1);
  return e ? { house: e.house, n: e.n ?? 0 } : null;
}

// ---------------------------------------------------------------------------
// the Ultimate button

export type UltButtonState = 'locked' | 'top' | 'cd' | 'cards' | 'silenced' | 'ready';
/** The Ultimate button in `seat`'s Draft: its label (the House's Ultimate), its second line (why not, or READY) and a tooltip. */
export function ultButton(v: GameState, seat: number): { name: string; state: UltButtonState; sub: string; tip: string } | null {
  if (!v.ult || !v.players[seat]) return null;
  const house = v.players[seat].house, name = ultOf(house).name;
  const b = ultBlocker(v, seat);
  if (!b) return { name, state: 'ready', sub: 'READY', tip: `Cast ${name}: pick a target, 3 cards, then preview.` };
  const standing = () => {
    const ps = ultStandings(v);
    const at = ps.findIndex((p) => p.members.includes(seat));
    const k = ps.filter((p) => p.bottom).length;
    return `You are ${at + 1}${['st', 'nd', 'rd'][at] ?? 'th'} of ${ps.length} by Win %. The bottom ${k} may cast.`;
  };
  switch (b.code) {
    case 'round': return { name, state: 'locked', sub: `Opens in round ${ULT_ROUND}`, tip: `House Ultimates open in round ${ULT_ROUND}. It is round ${v.ult.round}.` };
    case 'cooldown': return { name, state: 'cd', sub: `Recharging: ${b.n} turn${b.n === 1 ? '' : 's'}`, tip: b.msg };
    case 'cards': return { name, state: 'cards', sub: `Needs 3 cards, 1 from House ${HOUSES[house].name}`, tip: b.msg };
    case 'silenced': return { name, state: 'silenced', sub: 'Silenced: no cards this turn', tip: b.msg };
    default: return { name, state: 'top', sub: 'Top half: no Ultimate', tip: `${b.msg} ${standing()}` };
  }
}
