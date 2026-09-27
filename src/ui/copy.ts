// All the words. Original fan copy in the voice of the Institute: brutal, profane,
// and full of the setting's own slurs (Pixie, slag, lowColor, gorydamn, bloodydamn...).

import { HOUSES, TERRITORIES } from '../engine/data.ts';
import { CARD } from '../engine/cards.ts';
import type { GameEvent, GameState } from '../engine/engine.ts';

const pick = <T>(a: T[], seed: number) => a[Math.abs(seed) % a.length];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function who(s: GameState, seat: number | null | undefined) {
  if (seat == null || seat < 0) return `<b class="nt">the neutral garrison</b>`;
  const p = s.players[seat];
  const h = HOUSES[p.house];
  return `<b style="color:${h.color}">${esc(p.name)}</b>`;
}
export const house = (h: number) => `<b style="color:${HOUSES[h].color}">House ${HOUSES[h].name}</b>`;
export const terr = (t: number) => `<i>${esc(TERRITORIES[t].name)}</i>`;
const card = (id: string) => `<b class="cardref">${esc(CARD[id]?.name ?? id)}</b>`;

export const TAGLINES = [
  'Make one House out of many. Or die in the mud trying.',
  'The Proctors are watching. The Proctors are betting.',
  'Kill in the dark. Rule in the light.',
  'Break them. Collar them. Make them yours.',
  'Nobody remembers the Gold who came second.',
];

export const PASSAGE_INTRO = [
  'They drag you from your bunk in the dark. Two names. One ring. One of you walks out of this room.',
  'Stone walls. No light. Fitchner tosses a ring on the floor and says "only one of you wears it." Choose, Pixie.',
  'This is the Passage. Mercy is for lowColors. Pick your General, and put the other one in the ground.',
];

export function passageLine(general: string, killed: string, seed: number) {
  return pick([
    `${card(general)} walks out of the dark wearing the ring. ${card(killed)} does not walk out at all.`,
    `${card(killed)} begged. ${card(general)} didn't listen. That's the Institute, you gorydamn children.`,
    `${card(general)} rises. ${card(killed)} is a smear on the Passage floor, and nobody's going to scrub it.`,
  ], seed);
}

export function describe(s: GameState, e: GameEvent): string {
  const sd = e.id * 7919;
  switch (e.k) {
    case 'sorted':
      return `${who(s, e.seat)} is sorted into ${house(e.house)}, ${HOUSES[e.house].epithet}.`;
    case 'chosen':
      return `${who(s, e.seat)} walks out of the Passage with blood on their hands.`;
    case 'passage':
      return `${who(s, e.seat)}: ${passageLine(e.general, e.killed, sd)}`;
    case 'turn': {
      const extra = e.extras?.length ? ` (${e.extras.join(', ')})` : '';
      return pick([
        `${who(s, e.seat)} wakes up hungry. <b>${e.reinf}</b> fresh bodies to throw at the valley${extra}.`,
        `${who(s, e.seat)}'s turn. <b>${e.reinf}</b> reinforcements crawl out of the barracks${extra}. Spend them, slag.`,
        `The Proctors point at ${who(s, e.seat)}. <b>${e.reinf}</b> new soldiers, no excuses${extra}.`,
      ], sd);
    }
    case 'place': return `${who(s, e.seat)} stacks ${e.n} on ${terr(e.t)}.`;
    case 'trade': return `${who(s, e.seat)} cashes in three cards for <b>${e.n}</b> armies. Loyalty, bought wholesale.`;
    case 'play': {
      const c = CARD[e.card];
      let tail = '';
      if (e.t != null && c.active.kind === 'sabotage') tail = ` ${e.killed} soldiers in ${terr(e.t)} never wake up.`;
      if (c.active.kind === 'parley') tail = ` ${terr(e.t)} surrenders without a single broken nose.`;
      if (c.active.kind === 'steal') tail = ` ${who(s, e.victim)} is ${e.stolen} card(s) lighter.`;
      if (c.active.kind === 'raid') tail = ` ${e.targets?.length ?? 0} enemy camps bleed.`;
      if (c.active.kind === 'moveStd') tail = ` The Standard now flies over ${terr(e.t)}.`;
      if (c.active.kind === 'draw') tail = ` Drew ${e.drew}.`;
      return `${who(s, e.seat)} plays ${card(e.card)}: <i>${esc(c.active.text.replace(/\{n\}/g, String(e.n)))}</i>${tail}`;
    }
    case 'discardProctor': return `${who(s, e.seat)} spits on ${card(e.card)} and draws ${e.drew} cards. A Proctor you don't own is a Proctor you don't need.`;
    case 'phase': return e.phase === 'attack'
      ? pick([`${who(s, e.seat)} draws steel.`, `${who(s, e.seat)} is done counting. Time to bleed.`, `${who(s, e.seat)} goes to war.`], sd)
      : `${who(s, e.seat)} regroups.`;
    case 'battle': {
      const tag = e.blitz ? ' (blitz)' : '';
      if (e.won) return pick([
        `${who(s, e.seat)} smashes into ${terr(e.to)}${tag}, loses ${e.aLost}, kills ${e.dLost}. ${who(s, e.def)} runs crying for their mothers.`,
        `${terr(e.to)} falls to ${who(s, e.seat)}${tag}. ${e.dLost} of ${who(s, e.def)}'s lot face down in the mud.`,
        `Blood in ${terr(e.to)}. ${who(s, e.seat)} takes it${tag}; ${e.aLost} of their own didn't make it.`,
      ], sd);
      return pick([
        `${who(s, e.seat)} hits ${terr(e.to)}${tag}: ${e.aLost} lost, ${e.dLost} killed. ${who(s, e.def)} holds, barely.`,
        `${who(s, e.def)} bloodies ${who(s, e.seat)}'s nose at ${terr(e.to)}: ${e.aLost} attackers down, ${e.dLost} defenders.`,
      ], sd);
    }
    case 'conquer': return e.bonus ? `${who(s, e.seat)}'s General drops ${e.bonus} extra on ${terr(e.to)}.` : '';
    case 'stdRaised': return e.pending
      ? `⚑ ${who(s, e.seat)} RAISES THE STANDARD with ${e.commit} soldiers against ${terr(e.to)}. ${who(s, e.def)} is reaching for something...`
      : pick([
        `⚑ ${who(s, e.seat)} RAISES THE STANDARD and charges ${terr(e.to)} with ${e.commit}. Everyone in the valley just shat themselves.`,
        `⚑ The Standard of ${house(s.players[e.seat].house)} goes up. ${e.commit} fanatics march on ${terr(e.to)}. No retreat.`,
      ], sd);
    case 'counter': return `⚔ AMBUSH! ${who(s, e.seat)} springs ${card(e.card)}: ${e.n} ghosts rise from the ditches to defend.`;
    case 'warCry': return `${card(e.general)} leads the charge: ${esc(e.effect)}.`;
    case 'stdBattle': return e.won
      ? pick([
        `⚑ ${who(s, e.seat)}'s Standard takes ${terr(e.to)}. ${e.enslaved} of the defeated kneel and take the collar. Welcome to the family, slaves.`,
        `⚑ ${terr(e.to)} is broken. ${e.enslaved} prisoners swear to ${house(s.players[e.seat].house)} with knives at their throats.`,
      ], sd)
      : `⚑ ${who(s, e.seat)}'s Standard charge DIES at ${terr(e.to)}. Every last soldier cut down. The banner is in the mud.`;
    case 'stdCaptured': return e.victim != null
      ? `☠ The Standard of ${house(e.house)} is taken by ${who(s, e.captor)}.`
      : `☠ ${who(s, e.captor)} rips down the Standard of neutral ${house(e.house)}. The garrison kneels.`;
    case 'neutralFall': return e.flipped?.length ? `${e.flipped.length} ${HOUSES[e.house].name} garrisons swap colors for ${who(s, e.captor)}. They don't look happy about it.` : '';
    case 'dominated': return e.captor >= 0
      ? pick([
        `☠ ${house(s.players[e.victim].house)} IS BROKEN. ${who(s, e.victim)} and every soldier they had now belong to ${who(s, e.captor)}. Kneel, you gorydamn Pixies.`,
        `☠ ${who(s, e.victim)} is DOMINATED. ${e.terr} territories and ${e.cards} cards go to ${who(s, e.captor)}. Collars all around.`,
      ], sd)
      : `☠ ${who(s, e.victim)} is finished. Their lands fall to the wilds.`;
    case 'concede': return `${who(s, e.seat)} throws down their sword and walks into the snow. Coward.`;
    case 'fortify': return `${who(s, e.seat)} marches ${e.n} from ${terr(e.from)} to ${terr(e.to)}.`;
    case 'moveStd': return `⚑ ${who(s, e.seat)} carries the Standard to ${terr(e.to)}.`;
    case 'earned': return `${who(s, e.seat)} loots a card from the dead.`;
    case 'endTurn': return '';
    case 'win': return e.seat != null
      ? `♛ ${who(s, e.seat)} is ARCHPRIMUS OF THE INSTITUTE. One House out of many. Hail, you magnificent bastard.`
      : 'Nobody is left standing. The Proctors are furious.';
  }
  return '';
}

/** Big banner headline for dramatic events. */
export function headline(s: GameState, e: GameEvent): { title: string; sub: string; color: string } | null {
  const hc = (seat: number) => (seat >= 0 ? HOUSES[s.players[seat].house].color : '#aaa');
  switch (e.k) {
    case 'stdRaised': return { title: 'THE STANDARD IS RAISED', sub: `${s.players[e.seat].name} charges ${TERRITORIES[e.to].name}`, color: hc(e.seat) };
    case 'counter': return { title: 'AMBUSH', sub: `${CARD[e.card].name} springs the trap`, color: hc(e.seat) };
    case 'dominated': return e.captor >= 0
      ? { title: `HOUSE ${HOUSES[s.players[e.victim].house].name.toUpperCase()} KNEELS`, sub: `${s.players[e.victim].name} is dominated by ${s.players[e.captor].name}`, color: hc(e.captor) }
      : { title: `HOUSE ${HOUSES[s.players[e.victim].house].name.toUpperCase()} FALLS`, sub: `${s.players[e.victim].name} is out`, color: '#888' };
    case 'stdCaptured': return e.victim == null && e.captor >= 0 ? { title: `${HOUSES[e.house].name.toUpperCase()}'S STANDARD TAKEN`, sub: `${s.players[e.captor].name} now owns House ${HOUSES[e.house].name}`, color: hc(e.captor) } : null;
    case 'win': return e.seat != null ? { title: 'ARCHPRIMUS', sub: `${s.players[e.seat].name} of House ${HOUSES[s.players[e.seat].house].name} rules the Institute`, color: hc(e.seat) } : null;
  }
  return null;
}

export const ERRORS_FLAVOR = ['Nope.', 'Gorydamn no.', 'The Proctors laugh at you.', 'Try again, Pixie.'];

export const RULES_HTML = `
<h2>How to Conquer the Institute</h2>
<p>Every House gets a castle, a Standard, and a valley full of children with swords. Make one House out of many.</p>
<h3>Winning</h3>
<p>Be the last House standing. You knock a House out by capturing its <b>Standard</b>: take the territory it stands on, or beat it when it charges you.
A dominated House gives you <b>everything</b>: its land, its armies, its cards, and any Standards it had taken.</p>
<h3>The Passage</h3>
<p>You're dealt two Characters. Keep one as your <b>General</b>; the other dies. A General's <b>Passive</b> is always on.
If the General is from your own House in the books, the Passive gets <b>+1</b>.</p>
<h3>Your turn: Draft, Attack, Fortify</h3>
<p><b>Draft.</b> Reinforcements = max(3, territories ÷ 3) + quadrant bonuses + Keep bonus (1 Keep: +2, 2: +5, 3: +9, 4: +14) + your General.
Play cards now: trade any <b>3 for 10 armies</b>, or play one for its <b>Active</b>. Cards of a House you own get a bonus.
A Proctor card only works if you own its House; otherwise discard it for 2 cards (locked until next turn). Holding 5+ cards? Trade before you attack.</p>
<p><b>Attack.</b> Risk dice: attacker rolls up to 3 (needs one more army than dice), defender up to 2, highest vs highest, <b>ties go to the defender</b>.
<b>Keeps</b> are fortresses: +1 to every defense die. Conquer at least one territory to earn a card.</p>
<p><b>Fortify.</b> One army move through your connected land, plus one Standard move.</p>
<h3>The Standard: high risk, high reward</h3>
<p>From the territory holding your Standard you can <b>Raise the Standard</b>: commit armies, add <b>+3 phantom soldiers</b> (they die last), and your General's Active fires for free once per turn.
There is <b>no retreat</b>. Win, and the territory is yours <b>and every defender you killed joins you as a slave</b>. Lose, and your Standard is captured: <b>your whole House goes to the defender</b>.</p>
<p>A defending Standard has an honor guard of <b>5 phantom defenders</b> (restored each turn) and rolls up to <b>3 defense dice</b>. Nobody may strike a player's Standard in the first round.
Defenders holding a <b>REACTION</b> card get a few seconds to spring an ambush when a Standard charges them.</p>
<h3>Neutral Houses</h3>
<p>Houses nobody plays hold their land as neutral garrisons. Take a neutral Keep to seize its Standard: you <b>own that House</b> (its Proctor, its card bonuses) and its remaining garrisons switch to you.</p>
<h3>Quadrants</h3>
<p>The Greatwoods (Apollo, Diana) +5 · The Highlands (Minerva, Mars) +5 · The Argos Lowlands (Jupiter, Ceres) +5 · The Frostfangs (Pluto) +2, and only two ways in.</p>
`;
