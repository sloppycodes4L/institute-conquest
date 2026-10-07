// What a player reads about a House before choosing it in the House Draft: its Ultimate against one House and against
// an alliance, what the House is good and bad at, and the three Characters we'd make its Primus. Pure data (no DOM).
// The Ultimate texts follow the table in How to Play (copy.ts); keep the two in step.

import { HOUSES } from '../engine/data.ts';

export interface HouseInfo {
  /** The Ultimate against one House. */
  vsPlayer: string;
  /** The Ultimate against a public alliance. */
  vsAlliance: string;
  pros: string[];
  cons: string[];
  /** The top 3 Primus options, best first: a Character of this House, and why. */
  top: { card: string; why: string }[];
}

/** By House id. */
export const HOUSE_INFO: Record<string, HouseInfo> = {
  mars: {
    vsPlayer: 'Seize 3 territories of the target or of the neutrals, in quadrants where you hold land. On each, half the armies die and the rest join you with the land. Never a Keep, never under a Standard.',
    vsAlliance: 'The 3 picks may come from any member.',
    pros: ['The only Ultimate that takes land: their best stacks become yours.', 'The widest choice of Primus: 7 Characters.'],
    cons: ['Reaches only the quadrants where you already hold land.', 'Three territories at most, whatever the size of the alliance.'],
    top: [
      { card: 'sevro', why: 'Free armies on your front every Draft.' },
      { card: 'titus', why: 'The fastest land grab: an edge against every neutral garrison.' },
      { card: 'darrow', why: 'Your Standard hits harder when it charges.' },
    ],
  },
  minerva: {
    vsPlayer: 'Their next turn is skipped. You read their hand until your next turn.',
    vsAlliance: 'Each member\'s next turn: Draft −60%, and no cards, attacks or Fortify. No hand is shown.',
    pros: ['Takes a whole turn away from the leader.', 'Steady income from Pax and the Cook.'],
    cons: ['Destroys nothing: you have to use the turn it buys you.', 'An alliance is slowed, not skipped.'],
    top: [
      { card: 'pax', why: 'Your home Keep grows every Draft.' },
      { card: 'cook', why: 'More reinforcements every Draft, from turn one.' },
      { card: 'mustang', why: 'More reinforcements for every House you own. It grows with you.' },
    ],
  },
  pluto: {
    vsPlayer: 'Their stacks of 5 or more lose 30% now, 20% at their next turn and 10% the turn after. Their next three Drafts are cut 30%, 20%, 10%.',
    vsAlliance: 'The first two steps only, for each member.',
    pros: ['Punishes big stacks and hoarding, and keeps working for three turns.', 'Hits their armies and their Drafts at once.'],
    cons: ['Slow: most of the damage comes later.', 'A rival spread thin barely notices (stacks under 5 are safe).'],
    top: [
      { card: 'weasel', why: 'Free armies on your front every Draft.' },
      { card: 'gravedigger', why: 'Extra phantom defenders guard your Standard.' },
      { card: 'jackal', why: 'Extra armies for every territory your Standard enslaves.' },
    ],
  },
  diana: {
    vsPlayer: 'Until your next turn, against you and your allies: their Standard has no honor guard and they spring no REACTION cards, and your party attacks 2 spaces away. On their next turn they can\'t Fortify or move their Standard.',
    vsAlliance: 'The same for every member.',
    pros: ['Built to knock a House out: it strips the Standard\'s guard.', 'Full strength against a whole alliance.'],
    cons: ['All or nothing: it kills no one by itself.', 'You need an army within 2 spaces of their Standard.'],
    top: [
      { card: 'moonsong', why: 'More reinforcements every Draft, from turn one.' },
      { card: 'tamara', why: 'An edge against every neutral garrison: a fast start.' },
      { card: 'hartsbane', why: 'Free armies on your front every Draft.' },
    ],
  },
  apollo: {
    vsPlayer: 'Until your next turn their highest defense die is −1 against you and your allies. This turn your highest attack die is +1 against them.',
    vsAlliance: 'The same for every member.',
    pros: ['Tilts every fight against them, for you and your allies.', 'Full strength against a whole alliance.'],
    cons: ['Lasts one round: useless without armies ready to attack.', 'Kills nothing by itself.'],
    top: [
      { card: 'lyre', why: 'More reinforcements every Draft, from turn one.' },
      { card: 'gilt', why: 'More reinforcements for every House you own.' },
      { card: 'novas', why: 'Your Standard hits harder when it charges.' },
    ],
  },
  jupiter: {
    vsPlayer: 'Pick a quadrant: every stack the target holds there above 5 is cut to 5. Their next Draft is capped at 5 (trades still add).',
    vsAlliance: 'Every member\'s stacks in that quadrant are cut. Only the House you targeted has its Draft capped.',
    pros: ['The biggest single blow against a massed army.', 'Caps the target\'s next Draft at 5.'],
    cons: ['One quadrant only: a spread-out rival loses little.', 'The Standard\'s territory is immune.'],
    top: [
      { card: 'brontes', why: 'Your home Keep grows every Draft.' },
      { card: 'stormcrow', why: 'Free armies on your front every Draft.' },
      { card: 'thunderjaw', why: 'An edge against every neutral garrison: a fast start.' },
    ],
  },
  ceres: {
    vsPlayer: 'Their next Draft −50%, the one after −25%. You gain what is taken on your own next two Drafts, up to 100 in all.',
    vsAlliance: 'Each member −30%, then −15%. You collect it all (same cap).',
    pros: ['The only Ultimate that feeds you while it starves them.', 'The richest income Primuses: Sheaf, Miller, Barley.'],
    cons: ['Touches no army already on the map.', 'Your gain is capped at 100 and comes over two Drafts.'],
    top: [
      { card: 'sheaf', why: 'Your home Keep grows every Draft.' },
      { card: 'miller', why: 'More reinforcements every Draft, from turn one.' },
      { card: 'barley', why: 'More reinforcements for every House you own.' },
    ],
  },
};
export const houseInfo = (house: number): HouseInfo => HOUSE_INFO[HOUSES[house].id];
