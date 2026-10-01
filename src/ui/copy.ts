// All the words. Original fan copy in the voice of the Institute: brutal, profane,
// and full of the setting's own slurs (Pixie, slag, lowColor, gorydamn, bloodydamn...).

import { HOUSES, geoFor } from '../engine/data.ts';
import { CARD, EMOTES } from '../engine/cards.ts';
import { geo, type GameEvent, type GameState } from '../engine/engine.ts';

// Territory names come from the current game's valley (it grows with the player count).
let T = geoFor(4).territories;

const pick = <T>(a: T[], seed: number) => a[Math.abs(seed) % a.length];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function who(s: GameState, seat: number | null | undefined) {
  if (seat == null || seat < 0) return `<b class="nt">the neutral garrison</b>`;
  const p = s.players[seat];
  const h = HOUSES[p.house];
  return `<b style="color:${h.color}">${esc(p.name)}</b>`;
}
export const house = (h: number) => `<b style="color:${HOUSES[h].color}">House ${HOUSES[h].name}</b>`;
export const terr = (t: number) => `<i>${esc(T[t]?.name ?? 'Olympus')}</i>`;
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

const genName = (s: GameState, seat: number) => {
  const g = s.players[seat]?.general;
  return g && g !== '?' ? CARD[g]?.name ?? 'their General' : 'their General';
};

/** The betrayer's General, explaining themselves. Sometimes badly. */
export function betrayalLine(s: GameState, e: GameEvent): { speaker: string; line: string } {
  const g = genName(s, e.seat), vg = genName(s, e.victim);
  const vh = HOUSES[s.players[e.victim].house].name;
  const lines = [
    `Alliance? I thought we were just holding hands.`,
    `Nothing personal, ${vg}. Actually, it's a little personal.`,
    `I said I'd watch your back. I'm watching it right now. It's wide open.`,
    `Oaths are for lowColors and poets.`,
    `The Proctors gave me a knife. Was I supposed to NOT use it?`,
    `We had a good run, House ${vh}. Three turns. Beautiful. Tragic.`,
    `Break bread, break oaths. It's called efficiency.`,
    `I'm not betraying you, ${vg}. I'm promoting you to enemy.`,
    `In my defense, you looked very stabbable.`,
    `Did you really think a ring and a handshake would stop me? Adorable.`,
    `Friendship is a luxury. I'm on a budget.`,
    `Tell Fitchner I said hi. He'll find this interesting.`,
  ];
  return { speaker: g, line: pick(lines, e.quip ?? e.id) };
}

/** Two Generals shaking on it. */
export function allianceLine(s: GameState, e: GameEvent): string {
  const a = genName(s, e.by), b = genName(s, e.joined === e.by ? e.members.find((m: number) => m !== e.by) : e.joined);
  return pick([
    `${a} and ${b} clasp forearms over a dead man's campfire.`,
    `${a} offers ${b} half a stolen ration. That's basically marriage in the Institute.`,
    `${b} spits in their palm. ${a} regrets the handshake immediately, but it's done.`,
    `${a} and ${b} agree to kill everyone else first. Then, presumably, each other.`,
  ], e.quip ?? e.id);
}

export function describe(s: GameState, e: GameEvent): string {
  T = geo(s).territories;
  const sd = e.id * 7919;
  const houses = (seats: number[]) => seats.map((x) => house(s.players[x].house)).join(' + ');
  switch (e.k) {
    case 'unplace': return '';
    case 'undoDraft': return `${who(s, e.seat)} thinks better of it and recalls ${e.n} soldiers.`;
    case 'warBegun': return `⚔ ${who(s, e.seat)} draws first blood from ${who(s, e.def)}. The Houses may now whisper to each other. Quietly.`;
    case 'invite': return e.from === s.me?.seat
      ? `📜 You send a quiet ${e.pub ? 'public' : 'secret'} alliance offer to ${who(s, e.to)}.`
      : `📜 ${who(s, e.from)} whispers an offer of ${e.pub ? 'open' : 'SECRET'} alliance.`;
    case 'inviteDeclined': return `📜 ${who(s, e.to)} burns ${who(s, e.from)}'s letter.`;
    case 'inviteVoid': return `📜 ${who(s, e.from)} and ${who(s, e.to)} are each sworn to other alliances. The offer is void.`;
    case 'inviteExpired': return `📜 ${who(s, e.from)}'s offer to ${who(s, e.to)} goes stale.`;
    case 'allianceFormed': return `${e.pub ? '🤝' : '🤫'} ${e.pub ? 'ALLIANCE' : 'SECRET PACT'}: ${houses(e.members)}. ${allianceLine(s, e)} Their Generals' Passives are now shared.`;
    case 'allianceRevealed': return `🤝 ${who(s, e.seat)} reveals it to the valley: ${houses(e.members)} have been allies all along.`;
    case 'allianceEnds': return e.leaver != null
      ? `🚪 ${who(s, e.leaver)} walks out of the alliance of ${houses(e.members)}${e.dissolved ? ', and it falls apart' : ''}. No one will swear to them for a round.`
      : `The alliance of ${houses(e.members)} falls apart. Too many funerals.`;
    case 'inviteCancelled': return `📜 ${who(s, e.from)} snatches back their letter to ${who(s, e.to)}.`;
    case 'rallyOpened': return `📯 ${who(s, e.seat)}, the strongest House in the valley, calls a <b>RALLY AGAINST OLYMPUS</b>: the first ${e.slots - 1} to answer join their public alliance.`;
    case 'rallyJoined': return `📯 ${who(s, e.seat)} answers ${who(s, e.by)}'s Rally. The alliance: ${houses(e.members)}.`;
    case 'rallyClosed': return e.why === 'full' ? `📯 ${who(s, e.by)}'s Rally is full. The banners are counted.`
      : e.why === 'cancelled' ? `📯 ${who(s, e.by)} calls off the Rally.`
      : e.why === 'fallen' ? `📯 ${who(s, e.by)} has fallen, and their Rally with them.`
      : `📯 Nobody else answers ${who(s, e.by)}'s Rally in time. The horns go quiet.`;
    case 'defect': {
      const b = betrayalLine(s, { ...e, victim: e.members.find((m: number) => m !== e.seat) ?? e.seat });
      return `🗡 BETRAYAL! ${who(s, e.seat)} abandons ${houses(e.members.filter((m: number) => m !== e.seat))} to answer ${who(s, e.by)}'s Rally. ${esc(b.speaker)}: <i>"${esc(b.line)}"</i>`;
    }
    case 'overwhelm': return `🏳 The ${e.garrison} neutral soldiers in ${terr(e.to)} see ${e.n} of ${who(s, e.seat)}'s coming and throw down their spears. Not a drop of blood.`;
    case 'primus': return `♛ ${who(s, e.seat)} swears in ${card(e.card)} as Primus of ${terr(e.t)}. Its Passive now serves them.`;
    case 'primusSlain': return `☠ ${card(e.card)}, Primus of ${terr(e.t)}, dies with the Keep${e.by != null && e.by >= 0 ? ` as ${who(s, e.by)} storms it` : ''}.`;
    case 'kicked': return `🥾 The host throws ${who(s, e.seat)} out of the war. ${e.alive ? 'An AI Primus takes up their House.' : ''}`;
    case 'emote': return `💬 ${who(s, e.seat)}: <i>"${esc(EMOTES[e.line] ?? '…')}"</i>`;
    case 'betrayal': {
      const b = betrayalLine(s, e);
      return `🗡 BETRAYAL! ${who(s, e.seat)} turns on ${who(s, e.victim)}.${e.wasPublic ? '' : ' (A secret pact, now very public.)'} ${esc(b.speaker)}: <i>"${esc(b.line)}"</i> The alliance is dead.`;
    }
    case 'siegeProposed': return `🏛 ${who(s, e.seat)} calls for a SIEGE ON OLYMPUS. The alliance votes.`;
    case 'siegeVote': return `🏛 ${who(s, e.seat)} votes ${e.yes ? '<b>STORM IT</b>' : '<b>not yet</b>'}.`;
    case 'siegeRejected': return `🏛 The alliance loses its nerve. Olympus will wait.`;
    case 'siegeBegins': return `🏛 TO OLYMPUS! ${houses(e.members)} march on the Proctors: <b>${e.garrison}</b> defenders behind the walls, commanded by ${e.proctors.map((p: string) => card(p)).join(', ')}. ${e.turns} allied turns to break it.`;
    case 'olympusTurn': return `🏛 Olympus regroups (+${e.regen})${e.killed ? ` and smites ${e.killed} of ${who(s, e.seat)}'s soldiers at the Foot` : ''}. <b>${e.garrison}</b> hold the walls; ${e.turnsLeft} allied turns left.`;
    case 'assault': return e.won
      ? `🏛 ${who(s, e.seat)} storms the last wall from ${terr(e.from)}!`
      : `🏛 ${who(s, e.seat)} assaults Olympus from ${terr(e.from)}${e.blitz ? ' (blitz)' : ''}${e.walls ? '' : ' over the walls'}: ${e.aLost} lost, ${e.dLost} Proctors' soldiers dead. <b>${e.garrison}</b> remain.`;
    case 'siegeFailed': return `🏛 The siege FAILS with ${e.garrison} still on the walls. The Proctors laugh, and the alliance of ${houses(e.members)} shatters.`;
    case 'siegeCollapsed': return `🏛 With the alliance broken, the siege of Olympus collapses.`;
    case 'olympusFalls': return `♛ OLYMPUS FALLS to ${houses(e.members)}. ${who(s, e.seat)} struck the last blow. The Proctors kneel.`;
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
      if (c.active.kind === 'siegeCut') tail = ` ${e.killed} of Olympus's defenders never wake up.`;
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
    case 'ambushWait': return `⚔ ${who(s, e.seat)} marches on ${terr(e.to)}. ${who(s, e.def)} is reaching for something...`;
    case 'counter': return `⚔ AMBUSH! ${who(s, e.seat)} springs ${card(e.card)}${e.to != null ? ` at ${terr(e.to)}` : ''}: ${e.n} ghosts rise from the ditches to defend, and every defense die gets +1.`;
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
    case 'timeUp': return `⏱ Time! The Proctors drag ${who(s, e.seat)} off the field${e.placed ? ` and dump their ${e.placed} unplaced soldiers on the front` : ''}.`;
    case 'region': return `⬡ ${who(s, e.seat)} holds all of <b>${esc(geo(s).regions[e.region].name)}</b>: <b>+${e.bonus}</b> armies every turn.`;
    case 'endTurn': return '';
    case 'win': return e.seat != null
      ? `♛ ${who(s, e.seat)} is ARCHPRIMUS OF THE INSTITUTE. One House out of many. Hail, you magnificent bastard.`
      : 'Nobody is left standing. The Proctors are furious.';
  }
  return '';
}

/** Big banner headline for dramatic events. */
export function headline(s: GameState, e: GameEvent): { title: string; sub: string; color: string; long?: boolean } | null {
  const hc = (seat: number) => (seat >= 0 ? HOUSES[s.players[seat].house].color : '#aaa');
  T = geo(s).territories;
  const names = (seats: number[]) => seats.map((x) => HOUSES[s.players[x].house].name).join(' & ');
  switch (e.k) {
    case 'warBegun': return { title: 'FIRST BLOOD', sub: `${s.players[e.seat].name} attacks ${s.players[e.def].name}. Alliances may now be whispered.`, color: hc(e.seat) };
    case 'allianceFormed': return e.pub
      ? { title: 'AN ALLIANCE IS FORGED', sub: `Houses ${names(e.members)} now fight as one. ${allianceLine(s, e)}`, color: hc(e.by), long: true }
      : { title: 'A SECRET PACT', sub: `Houses ${names(e.members)}, sworn in the dark. Nobody else knows.`, color: '#9c7a36', long: true };
    case 'allianceRevealed': return { title: 'THE PACT IS REVEALED', sub: `Houses ${names(e.members)} were allies all along`, color: hc(e.seat) };
    case 'betrayal': {
      const b = betrayalLine(s, e);
      return { title: 'BETRAYAL', sub: `${b.speaker}: "${b.line}"`, color: '#e0262c', long: true };
    }
    case 'rallyOpened': return { title: 'A RALLY AGAINST OLYMPUS', sub: `${s.players[e.seat].name} calls the valley to their banner: ${e.slots - 1} place${e.slots === 2 ? '' : 's'}, first come`, color: hc(e.seat), long: true };
    case 'defect': return { title: 'BETRAYAL', sub: `${s.players[e.seat].name} abandons their allies for ${s.players[e.by].name}'s Rally`, color: '#e0262c', long: true };
    case 'primusSlain': return { title: 'A PRIMUS FALLS', sub: `${CARD[e.card]?.name ?? 'The Primus'} dies with ${T[e.t]?.name ?? 'the Keep'}`, color: '#888' };
    case 'kicked': return { title: 'THROWN OUT', sub: `${s.players[e.seat].name} is out. ${e.alive ? 'An AI takes their House.' : ''}`, color: '#888' };
    case 'siegeProposed': return { title: 'A SIEGE IS CALLED', sub: `${s.players[e.seat].name} wants to storm Olympus. Vote.`, color: '#f3d27a' };
    case 'stdRaised': return { title: 'THE STANDARD IS RAISED', sub: `${s.players[e.seat].name} charges ${T[e.to].name}`, color: hc(e.seat) };
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
<p>Every House gets a castle, a Standard, and a slice of the valley full of children with swords. Make one House out of many.
Up to <b>7 players</b>, one per House. The valley grows with the number of players.</p>
<h3>Setting up a war</h3>
<p>Whoever creates the war picks the <b>map size</b> and <b>starting troops</b> (both default to the recommended settings), and can switch
<b>Alliances</b> and the <b>Siege on Olympus</b> off, and can set a <b>turn timer</b> (60, 90 or 120 seconds). When time runs out, your unplaced armies
go to your front and the turn passes. Then <b>the Sorting</b>: hit <b>Start Selection</b> and the wheel deals each Gold a House.</p>
<h3>Controls</h3>
<p><b>Scroll</b> to zoom (toward the cursor). <b>Left-drag</b> to pan the map. <b>Right-drag</b> to turn the camera. <b>Left-click</b> to select.
<b>◐ My Lands</b> (or <b>G</b>) greys out everything you don't hold. Click a House in the roster to light up its land.
<b>⚙ Settings</b>: the camera follows the action (on by default), and a war horn tells you it's your turn. <b>⛰</b> (or <b>O</b>) makes Olympus solid, see-through, or hidden.</p>
<h3>Winning</h3>
<p>Be the last House standing. You knock a House out by capturing its <b>Standard</b>: take the territory it stands on, or beat it when it charges you.
A dominated House gives you <b>everything</b>: its land, its armies, its cards, and any Standards it had taken.
Or, with allies, <b>take House Olympus</b> (below) and share the win.</p>
<h3>The Passage</h3>
<p>You're dealt two Characters. Keep one as your <b>General</b> (your Primus); the other dies. A General's <b>Passive</b> is always on.
If the card's House (its suit) matches your House, the Passive gets <b>+1</b>. Your General is always shown bottom-left; every rival Primus is in the roster.</p>
<h3>The valley</h3>
<p>You start holding the heart of your House slice: your Keep and the land around it. The rest of your slice, and every House nobody plays,
is held by <b>neutral garrisons</b>, thickest on the fronts facing another player. The valley's slices keep their land from war to war, but the Houses are dealt onto them at random: players get slices as far apart as possible,
so the first rounds are a land grab before the killing starts. You can attack <b>any territory touching yours</b>.
The four quadrants are separate landmasses split by <b>chasms</b> (the glowing red cliffs can't be crossed). Every war rolls its own <b>land bridges</b> (marked 🌉) between neighbouring quadrants, and its own <b>⚓ ports</b>:
a port's sea lane (the dashed line across the water) makes it border the port on the far shore, for attacks and marches alike. <b>Zoom in</b> to read the territory names.</p>
<h3>Terrain</h3>
<p><b>⛰ Mountains:</b> the high ground. Attacking <i>from</i> a mountain adds <b>+1</b> to your <b>lowest attack die that gets compared</b>
(dice are sorted high to low; with 3 dice against 2, that's your middle die).
<b>🌲 Forests:</b> cover. A House defending a forest adds <b>+1</b> to its <b>lowest defense die</b>.
Terrain <b>never counts when the defender is neutral</b>: the wilds know their own ground. Water and marsh are just scenery. Hover any territory to see its terrain.</p>
<h3>Your turn: Draft, Attack, Fortify</h3>
<p><b>Draft.</b> Reinforcements = max(3, territories ÷ 3) + region bonuses + Keep bonus (1 Keep: +2, 2: +5, 3: +9, 4: +14) + your General.
Click a territory to add armies; use <b>−</b>/<b>+</b> to adjust it, or <b>Undo</b> to take back everything you placed this Draft (Shift-click also removes).
Play cards now: trade any <b>3 for 10 armies</b>, or play one for its <b>Active</b>. Cards of a House you own get a bonus.
A Proctor card only works if you own its House; otherwise discard it for 2 cards (locked until next turn). Holding 5+ cards? Trade before you attack.</p>
<p><b>Cards.</b> Cards you can play right now <b>glow</b>. Hover a card (or hit its <b>🔍</b>) to see every territory it would hit. Click it to <b>preview</b> the outcome on the map
(changed territories and armies; anything random shown as a range), then <b>Commit</b> or go <b>Back</b>.
When anyone else plays a card, it's pinned on the map beside what it hit until you <b>Acknowledge</b> it.</p>
<p><b>Attack.</b> Pick one of your territories and every target it can hit lights up (or just click an enemy territory, and your strongest neighbour attacks it). Attack as often as you like.
If an attack isn't allowed, the reason pops up over the map.
Every target shows your <b>odds to take it</b> if you blitz. Risk dice: attacker rolls up to 3 (needs one more army than dice), defender up to 2, highest vs highest, <b>ties go to the defender</b>.
<b>Keeps have no walls.</b> A House's Keep holds with its armies, its honor guard (if its Standard is there) and its Passives: the General's (and allies'), plus any Primus.
Conquer at least one territory to earn a card.</p>
<p><b>Neutrals.</b> A neutral garrison (not a Keep) rolls only <b>1 defense die</b>, and if you attack with <b>twice its number or more</b> (armies that can march, one stays behind) it <b>yields</b>:
no dice, no losses, the land is yours. The odds show <b>Overwhelm</b> when it will. A <b>neutral Keep</b> is different: exactly <b>10</b> soldiers, no walls, no modifiers, 2 dice, and it never yields (15 armies take it about 83% of the time).</p>
<p><b>Fortify.</b> One army move through your connected land, any distance, plus one Standard move.</p>
<p><b>Watching.</b> Other players' moves (and the AI's) are replayed one at a time with their dice. Speed them up (2×, 4×) or <b>Skip</b> from the bar at the bottom.</p>
<h3>Alliances</h3>
<p>Once one House has attacked another, Houses can send each other <b>quiet invitations</b> (the 🤝 button). An alliance is either <b>Public</b> (announced to everyone) or <b>Secret</b> (only its members know).
Alliances change nothing except this: <b>allies share their Generals' Passives</b>. If an ally attacks an ally, the whole alliance is cancelled on the spot.
<b>One alliance per House</b>: an offer can reach anyone (so secret pacts stay secret), but you can't accept one while you're sworn elsewhere. Members can still invite unsworn Houses in.
You can <b>take back</b> an offer you sent, and <b>walk out</b> of your alliance (everyone hears; you can't join another for a full round).</p>
<p><b>📯 Rally Against Olympus.</b> The strongest House (the most armies, no ties) may call a public Rally: the first Houses to answer join its public alliance, up to half the living Houses (the rallier counts).
Answering walks you out of your old alliance, and your old allies hear it as a betrayal. One Rally at a time; it closes when full, when the rallier calls it off, or when the rallier's next turn begins.</p>
<h3>The Siege on Olympus</h3>
<p>When an alliance is all that is left (every rival House dominated and every neutral Standard taken), any member can call a <b>Siege on Olympus</b>. Majority vote decides.
Olympus is defended by the <b>Proctors of the attacking Houses</b>, and gets all of their powers. It holds about 11 soldiers per territory of a House slice (143 on the 4-player map), fights behind walls (+1 to its defense dice), regrows every allied turn, and smites troops at its Foot.
Assault it from the <b>Foot of Olympus</b> (the inner ring, next to the chasm) with the normal dice; everyone rolls their own assaults and plays their own cards, including <b>Relics</b> that only work in the siege.
Each ally gets 3 turns. Every assault is that House against <b>its own Proctor</b>, and the siege panel keeps score: when it ends, the final tally shows each House's share of the damage.
Break it and the whole alliance wins. Fail and the Proctors laugh, and the alliance shatters.
It usually takes three Houses, or two very large ones, so mass your armies at the Foot before you vote.</p>
<h3>The Standard: high risk, high reward</h3>
<p>Once per turn, from the territory holding your Standard, you can <b>Raise the Standard</b>: commit armies, add <b>+3 phantom soldiers</b> (they die last), and your General's Active fires for free.
There is <b>no retreat</b>. Win, and the territory is yours <b>and every defender you killed joins you as a slave</b>. Lose, and your Standard is captured: <b>your whole House goes to the defender</b>.</p>
<p>A defending Standard has an honor guard of <b>5 phantom defenders</b>, shown on its army count as a gold <b>+5</b> (restored each turn); it rolls the normal 2 defense dice. 10 armies against a lone soldier and the guard win about 80% of the time. Nobody may strike a player's Standard in the first round.
A <b>REACTION</b> card can ambush a Standard's charge too (below).</p>
<h3>Ambushes: REACTION cards</h3>
<p>When a rival attacks one of your territories (a normal attack or a Standard's charge) and you hold a <b>REACTION</b> card, the attack <b>pauses</b> before the first die and your REACTION cards glow.
<b>Play</b> one: <b>+n phantom defenders</b> (they die last) and <b>+1 to every defense die</b> for that battle. Or <b>Skip</b> and let it through (you won't be asked again in the same battle),
or <b>Skip until my turn</b>: no more prompts until your next turn begins (cancel it any time from the notice up top). Online you have 25 seconds to decide; the attacker's turn clock waits.
Neutral garrisons never ambush. When anyone springs one, the whole table sees it: the card, its rule, and how the battle went.</p>
<h3>Neutral Houses</h3>
<p>Houses nobody plays hold their land as neutral garrisons. Take a neutral Keep to seize its Standard: you <b>own that House</b> (its Proctor, its card bonuses) and its remaining garrisons switch to you.</p>
<h3>Primus of a conquered Keep</h3>
<p>When you conquer a Keep that isn't your home Keep (a rival's or a neutral House's), you may swear in <b>one Character card</b> from your hand whose suit is <b>that Keep's House</b>
as its <b>Primus</b> (the game asks on the spot; you can skip, and swear one in during any later Draft while the Keep has no Primus). The card leaves your hand.
Its <b>Passive</b> works for you on top of your General's (no House-match bonus, and it isn't shared with allies). Lose the Keep and the Primus is <b>slain</b>: the card is discarded.
A crown ♛ on the Keep's army count and in the roster shows every Primus.</p>
<h3>The Proctors' Book</h3>
<p>The <b>📖</b> button (or <b>B</b>) opens the Proctors' running odds on every House: territories, armies and <b>battles won</b> (only against other Houses: taking their land, breaking their blitz, winning a Standard charge),
and each House's chance to take the Institute, turn by turn on a line chart. The odds update between turns (45% armies, 40% territories, 15% battles won).
Allies are booked as <b>one side</b>: their lines merge into one braided line and they share the odds, until the alliance breaks and each is booked alone again.</p>
<h3>When your House falls</h3>
<p>You'll see how it happened, with the math of the final blow (the armies, the modifiers, the odds and the dice). Then <b>Return to Title</b>, or <b>Spectate</b>:
watch the rest of the war, read the Book, and keep shouting into the War Log with 💬.</p>
<h3>At the table</h3>
<p><b>💬 Emotes:</b> shout a line into the War Log any time (one every 15 seconds). <b>War Logs:</b> every online war's full log, dice and all, is kept for 90 days.
Open <b>Past wars</b> on the title screen to read it, filter it by turn or House, export it as text, or <b>flag</b> a line with a short note for everyone in that war.
The host can <b>kick</b> a player: in the lobby their seat is freed; mid-war an AI Primus takes over their House.</p>
<h3>Regions</h3>
<p>Each House slice is cut into bonus <b>regions</b>: its shore, its heart (around the Keep) and its marches. Hold every territory of a region at the start of your turn
for its bonus, shown on the map (<b>+2</b>, <b>+3</b>…) inside the gold region borders. The <b>Regions</b> panel lists the ones you're closest to.</p>
`;
