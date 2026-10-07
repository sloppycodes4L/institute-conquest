// All the words. Original fan copy in the voice of the Institute: brutal, profane,
// and full of the setting's own slurs (Pixie, slag, lowColor, gorydamn, bloodydamn...).

import { HOUSES, QUADRANTS, geoFor } from '../engine/data.ts';
import { CARD, EMOTES } from '../engine/cards.ts';
import { geo, type GameEvent, type GameState } from '../engine/engine.ts';
import { ULTIMATE } from './ultimates.ts';

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
  return g && g !== '?' ? CARD[g]?.name ?? 'their Primus' : 'their Primus';
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

/** Who an Ultimate struck, by name: one House, or "the alliance of A and B". */
export function ultTargetNames(s: GameState, e: GameEvent, plain = false): string {
  const name = (x: number) => (plain ? esc(s.players[x].name) : who(s, x));
  const ts: number[] = e.targets ?? [e.target];
  if (ts.length < 2) return name(ts[0] ?? e.target);
  return `the alliance of ${ts.slice(0, -1).map(name).join(', ')} and ${name(ts[ts.length - 1])}`;
}
/** The War Log line of a cast: who, what, on whom, and the numbers. */
function ultimateLine(s: GameState, e: GameEvent): string {
  const hid = HOUSES[e.house].id, u = ULTIMATE[hid], me = who(s, e.seat);
  let tail = '.';
  switch (hid) {
    case 'mars': tail = `: ${e.removed} destroyed, ${e.gained} join ${house(e.house)}.`; break;
    case 'jupiter': tail = `: ${e.removed} armies cut in ${QUADRANTS[e.picks?.[0]]?.name ?? 'one quadrant'}. ${who(s, e.target)}'s next Draft is capped at 5.`; break;
    case 'pluto': tail = `: ${e.removed} rot away at once, and their stacks and Drafts keep rotting for ${e.alliance ? 'a turn' : '2 turns'} more.`; break;
    case 'minerva': tail = e.alliance ? '. On their next turn: Draft −60%, and no cards, attacks or Fortify.' : `. Their next turn is skipped, and ${me} reads their hand.`; break;
    case 'ceres': tail = `. Their next Draft is cut ${e.alliance ? '30%, the one after 15%' : '50%, the one after 25%'}, and ${me} collects it.`; break;
    case 'apollo': tail = `. Until ${me}'s next turn, their highest defense die is −1 against ${me} and allies.`; break;
    case 'diana': tail = `. Until ${me}'s next turn: no honor guard, no ambushes, and the hunters strike 2 spaces away.`; break;
  }
  return `<b>⚡ ${me} casts ${esc(u.name)}</b> on ${ultTargetNames(s, e)}${tail}`;
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
    case 'allianceFormed': return `${e.pub ? '🤝' : '🤫'} ${e.pub ? 'ALLIANCE' : 'SECRET PACT'}: ${houses(e.members)}. ${allianceLine(s, e)} Their Primuses' Passives are now shared.`;
    case 'allianceRevealed': return `🤝 ${who(s, e.seat)} reveals it to the valley: ${houses(e.members)} have been allies all along.`;
    case 'allianceEnds': return e.leaver != null
      ? `🚪 ${who(s, e.leaver)} walks out of the alliance of ${houses(e.members)}${e.dissolved ? ', and it falls apart' : ''}.${s.ult ? '' : ' No one will swear to them for a round.'}`
      : `The alliance of ${houses(e.members)} falls apart. Too many funerals.`;
    case 'inviteCancelled': return `📜 ${who(s, e.from)} snatches back their letter to ${who(s, e.to)}.`;
    case 'rallyOpened': return `📯 ${who(s, e.seat)}, the strongest House in the valley, calls a <b>RALLY AGAINST OLYMPUS</b>: the first ${e.slots - 1} to answer join their public alliance.`;
    case 'rallyJoined': return `📯 ${who(s, e.seat)} answers ${who(s, e.by)}'s Rally. The alliance: ${houses(e.members)}.`;
    case 'rallyClosed': return e.why === 'full' ? `📯 ${who(s, e.by)}'s Rally is full. The banners are counted.`
      : e.why === 'cancelled' ? `📯 ${who(s, e.by)} calls off the Rally.`
      : e.why === 'fallen' ? `📯 ${who(s, e.by)} has fallen, and their Rally with them.`
      : e.why === 'won' ? `📯 ${who(s, e.by)}'s Rally is over: there is nobody left to rally against.`
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
    case 'finale': return `♛ THE VALLEY IS WON. ${houses(e.members)} have no enemy left. The alliance votes: <b>end the war</b>, or <b>besiege Olympus</b>.`;
    case 'siegeVote': return e.final
      ? `♛ ${who(s, e.seat)} votes to ${e.yes ? '<b>BESIEGE OLYMPUS</b>' : '<b>end the war</b>'}.`
      : `🏛 ${who(s, e.seat)} votes ${e.yes ? '<b>STORM IT</b>' : '<b>not yet</b>'}.`;
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
      return e.picked ? `${who(s, e.seat)} takes ${house(e.house)}, ${HOUSES[e.house].epithet}.` : `${who(s, e.seat)} is sorted into ${house(e.house)}, ${HOUSES[e.house].epithet}.`;
    case 'chosen':
      // Choose your Primus: nobody dies. In a war with the Passage (Primus Selection: Random, or one from before .008) somebody does.
      return s.opts?.pick ? `${who(s, e.seat)} has chosen a Primus.` : `${who(s, e.seat)} walks out of the Passage with blood on their hands.`;
    case 'passage':
      return e.killed ? `${who(s, e.seat)}: ${passageLine(e.general, e.killed, sd)}` : `${who(s, e.seat)}: ${card(e.general)} leads ${house(s.players[e.seat].house)} as its Primus.`;
    case 'ultimate': return ultimateLine(s, e);
    case 'seized': return `⚑ ${terr(e.t)} is seized from ${who(s, e.from)}: ${e.dead} die, ${e.joined} join ${who(s, e.seat)}.`;
    case 'ultTick': {
      const h = HOUSES[e.house], w = who(s, e.seat);
      switch (e.kind) {
        case 'blackout': return `${h.sigil} ${w} is <b>Blacked Out</b> by ${house(e.house)}: the turn is skipped${e.n ? `, and a Draft of ${e.n} with it` : ''}.`;
        case 'silenced': return `${h.sigil} ${w} is <b>Silenced</b> by ${house(e.house)}: Draft −${e.n}, and no cards, attacks or Fortify this turn.`;
        case 'pinned': return `${h.sigil} ${w} is <b>Pinned</b> by ${house(e.house)}: no Fortify this turn, and the Standard can't move.`;
        case 'storm': return `${h.sigil} <b>Storm-bound</b>: ${w}'s Draft is capped at 5${e.n ? ` (${e.n} lost)` : ''}.`;
        case 'tithe': return e.n ? `${h.sigil} <b>The Tithe</b> takes ${e.n} from ${w}'s Draft.` : '';
        case 'harvest': return e.n ? `${h.sigil} <b>Harvest</b>: ${w} gains the ${e.n} the Tithe took.` : '';
        case 'rot': return e.n ? `${h.sigil} <b>Rot</b>: ${e.n} of ${w}'s soldiers decay in ${e.stacks} stack${e.stacks === 1 ? '' : 's'}.` : '';
        case 'rotDraft': return e.n ? `${h.sigil} <b>Rot</b> takes ${e.n} from ${w}'s Draft.` : '';
      }
      return '';
    }
    case 'lockout': return `⛓ ${who(s, e.seat)} left an alliance: no new alliance for ${e.turns} of their turns.`;
    case 'turn': {
      // A Blacked Out turn: the Blackout line right after it says so.
      if (e.skipped) return '';
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
    case 'conquer': return e.bonus ? `${who(s, e.seat)}'s Primus drops ${e.bonus} extra on ${terr(e.to)}.` : '';
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
    case 'win': return e.shared
      ? `♛ THE WAR IS OVER. ${houses(e.members)} end it together, with no enemy left in the valley. Olympus keeps its walls.`
      : e.seat != null
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
    case 'ultimate': return { title: `⚡ ${ULTIMATE[HOUSES[e.house].id].name.toUpperCase()}`, sub: `${s.players[e.seat].name} of House ${HOUSES[e.house].name} strikes ${ultTargetNames(s, e, true)}`, color: hc(e.seat), long: true };
    case 'finale': return { title: 'THE VALLEY IS WON', sub: `Houses ${names(e.members)} have no enemy left. End the war, or besiege Olympus?`, color: '#f3d27a', long: true };
    case 'win': return e.shared ? { title: 'THE WAR IS OVER', sub: `Houses ${names(e.members)} end it together`, color: '#f3d27a', long: true }
      : e.seat != null ? { title: 'ARCHPRIMUS', sub: `${s.players[e.seat].name} of House ${HOUSES[s.players[e.seat].house].name} rules the Institute`, color: hc(e.seat) } : null;
  }
  return null;
}

export const ERRORS_FLAVOR = ['Nope.', 'Gorydamn no.', 'The Proctors laugh at you.', 'Try again, Pixie.'];

export const RULES_HTML = `
<h2>How to Conquer the Institute</h2>
<p>Every House gets a castle, a Standard, and a slice of the valley full of children with swords. Make one House out of many.
Up to <b>7 players</b>, one per House. The valley grows with the number of players.</p>
<h3>Setting up a war</h3>
<p>Whoever creates the war picks the <b>House Selection</b> (Draft or Random) and the <b>Primus Selection</b> (Pick, or Random: the Passage), the <b>map size</b> and <b>starting troops</b> (both default to the recommended settings), can switch
<b>Alliances</b>, the <b>Siege on Olympus</b> and <b>House Ultimates</b> off, and can set a <b>turn timer</b> (60, 90 or 120 seconds). When time runs out, your unplaced armies
go to your front and the turn passes. House Ultimates need 3 or more Houses: with 2 they are off.</p>
<h3>Controls</h3>
<p><b>Scroll</b> to zoom (toward the cursor). <b>Left-drag</b> to pan the map. <b>Right-drag</b> to turn the camera. <b>Left-click</b> to select.
<b>◐ My Lands</b> (or <b>G</b>) greys out everything you don't hold. Click a House in the roster to light up its land.
<b>⚙ Settings</b>: the camera follows the action (on by default), and a war horn tells you it's your turn. <b>⛰</b> (or <b>O</b>) makes Olympus solid, see-through, or hidden.
<b>🎓 The Proctor's Guide</b> (or <b>T</b>): step-by-step lessons on your first turn, then hints, and each new mechanic explained the first time you meet it. Set it to Full, Hints or Off, or replay any lesson.</p>
<h3>Winning</h3>
<p>Be the last House standing. You knock a House out by capturing its <b>Standard</b>: take the territory it stands on, or beat it when it charges you.
A dominated House gives you <b>everything</b>: its land, its armies, its cards, and any Standards it had taken.
Or win with allies: when an alliance's last enemy falls, it <b>ends the war</b> as a shared victory or <b>takes House Olympus</b> (below).</p>
<h3>Choose your House and Primus</h3>
<p><b>Your House.</b> The host sets the <b>House Selection</b>. With <b>Draft</b>, starting the war opens the <b>House Draft</b>: the players are put in a random order and choose their Houses one at a time.
Every House has a page to read first: its Ultimate against one player and against an alliance, its pros and cons, and its top 3 Primus options. Anyone can browse while they wait.
Online each pick has <b>30 seconds</b>; when the clock runs out you are dealt a random House. AI seats pick at once. No two players share a House. The host can call the Draft off.
With <b>Random</b>, every House is dealt on <b>the Sorting</b> wheel instead.</p>
<p><b>Your Primus.</b> The host sets the <b>Primus Selection</b>. With <b>Pick</b>, every player chooses a <b>Primus</b> from the Characters of their own House (5 to choose from, 7 for Mars). Your Primus is your General:
their <b>Passive</b> is always on, at the value printed on the card. Nobody dies for it: the Characters you pass over go into the deck.
With <b>Random (Passage)</b>, you are dealt <b>two</b> of your House's Characters at random. Keep one as your Primus, with <b>+1</b> on its Passive. The other dies.
Your Primus is always shown in the <b>Your Primus</b> panel; every rival Primus is in the roster.</p>
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
<p><b>Draft.</b> Reinforcements = max(3, territories ÷ 3) + region bonuses + Keep bonus (1 Keep: +2, 2: +5, 3: +9, 4: +14) + your Primus.
Click a territory to add armies; use <b>−</b>/<b>+</b> to adjust it, or <b>Undo</b> to take back everything you placed this Draft (Shift-click also removes).
Play cards now: trade any <b>3 for 10 armies</b>, or play one for its <b>Active</b>. Cards of a House you own get a bonus.
A Proctor card only works if you own its House; otherwise discard it for 2 cards (locked until next turn). Holding 5+ cards? Trade before you attack.
From round 4, a House in the bottom half can spend 3 cards on its <b>House Ultimate</b> instead (below).</p>
<p><b>Cards.</b> Cards you can play right now <b>glow</b>. Hover a card (or hit its <b>🔍</b>) to see every territory it would hit. Click it to <b>preview</b> the outcome on the map
(changed territories and armies; anything random shown as a range), then <b>Commit</b> or go <b>Back</b>.
When anyone else plays a card, it's pinned on the map beside what it hit until you <b>Acknowledge</b> it.</p>
<p><b>Attack.</b> Pick one of your territories and every target it can hit lights up (or just click an enemy territory, and your strongest neighbour attacks it). Attack as often as you like.
If an attack isn't allowed, the reason pops up over the map.
Every target shows your <b>odds to take it</b> if you blitz. Risk dice: attacker rolls up to 3 (needs one more army than dice), defender up to 2, highest vs highest, <b>ties go to the defender</b>.
<b>Keeps have Walls:</b> whoever defends a Keep (a House or a neutral garrison) adds <b>+1 to its highest defense die</b>. A House's Keep also holds with its armies, its honor guard (if its Standard is there) and its Passives: its Primus's (and allies'), plus the Primus of any Keep it conquered.
Conquer at least one territory to earn a card.</p>
<p><b>Neutrals.</b> A neutral garrison (not a Keep) rolls only <b>1 defense die</b>, and if you attack with <b>twice its number or more</b> (armies that can march, one stays behind) it <b>yields</b>:
no dice, no losses, the land is yours. The odds show <b>Overwhelm</b> when it will. A <b>neutral Keep</b> is different: exactly <b>10</b> soldiers behind its Walls (+1 to their highest defense die), 2 dice, and it never yields (20 armies take it about 83% of the time).</p>
<p><b>Fortify.</b> One army move through your connected land, any distance, plus one Standard move.</p>
<p><b>Watching.</b> Other players' moves (and the AI's) are replayed one at a time with their dice. Speed them up (2×, 4×) or <b>Skip</b> from the bar at the bottom.</p>
<h3>Alliances</h3>
<p>Once one House has attacked another, Houses can send each other <b>quiet invitations</b> (the 🤝 button). An alliance is either <b>Public</b> (announced to everyone) or <b>Secret</b> (only its members know).
Alliances change nothing except this: <b>allies share their Primuses' Passives</b>. If an ally attacks an ally, the whole alliance is cancelled on the spot.
<b>One alliance per House</b>: an offer can reach anyone (so secret pacts stay secret), but you can't accept one while you're sworn elsewhere. Members can still invite unsworn Houses in.
You can <b>take back</b> an offer you sent, and <b>walk out</b> of your alliance (everyone hears; you can't join another for a full round).
With House Ultimates on, leaving costs more: walk out, attack an ally, or leave to answer a Rally, and you are <b>Locked out</b> of every alliance for <b>2 of your own turns</b> (the broken-chain icon on your banner counts them down).</p>
<p><b>📯 Rally Against Olympus.</b> The strongest House (the most armies, no ties) may call a public Rally: the first Houses to answer join its public alliance, up to half the living Houses (the rallier counts).
Answering walks you out of your old alliance, and your old allies hear it as a betrayal. One Rally at a time; it closes when full, when the rallier calls it off, or when the rallier's next turn begins.</p>
<h3>The end of the war: End Game, or the Siege on Olympus</h3>
<p>The moment an alliance has <b>no enemy left</b> (its last rival House falls, or the last Houses standing swear to each other), the war stops and the alliance must choose. Two Houses are enough.
Every member votes: <b>End the war</b> (a shared victory, there and then) or <b>Siege Olympus</b>. The Siege needs <b>more than half</b> the votes; anything less, a tie included, ends the war.
Nothing else can be done until the vote is settled. Neutral Standards no longer matter. With the Siege on Olympus switched off, the war simply ends and the alliance wins together.</p>
<p><b>The Siege.</b> Olympus is defended by the <b>Proctors of the attacking Houses</b>, and gets all of their powers. It holds about 11 soldiers per territory of a House slice (143 on the 4-player map), fights behind walls (+1 to its defense dice), regrows every allied turn, and smites troops at its Foot.
Assault it from the <b>Foot of Olympus</b> (the inner ring, next to the chasm) with the normal dice; everyone rolls their own assaults and plays their own cards, including <b>Relics</b> that only work in the siege.
Each ally gets 3 turns. Every assault is that House against <b>its own Proctor</b>, and the siege panel keeps score: when it ends, the final tally shows each House's share of the damage.
Break it and the whole alliance wins. Fail and the Proctors laugh, the alliance shatters, and the war goes on between its Houses.
It usually takes three Houses, or two very large ones, so mass your armies at the Foot before your last enemy falls.</p>
<h3>The Standard: high risk, high reward</h3>
<p>Once per turn, from the territory holding your Standard, you can <b>Raise the Standard</b>: commit armies, add <b>+3 phantom soldiers</b> (they die last), and your Primus's Active fires for free.
There is <b>no retreat</b>. Win, and the territory is yours <b>and every defender you killed joins you as a slave</b>. Lose, and your Standard is captured: <b>your whole House goes to the defender</b>.</p>
<p>A defending Standard has an honor guard of <b>5 phantom defenders</b>, shown on its army count as a gold <b>+5</b> (restored each turn); it rolls the normal 2 defense dice. 10 armies against a lone soldier and the guard win about 80% of the time. Nobody may strike a player's Standard in the first round.
A <b>REACTION</b> card can ambush a Standard's charge too (below).</p>
<h3>Ambushes: REACTION cards</h3>
<p>When a rival attacks one of your territories (a normal attack or a Standard's charge) and you hold a <b>REACTION</b> card, the attack <b>pauses</b> before the first die and your REACTION cards glow.
<b>Play</b> one: <b>+n phantom defenders</b> (they die last) and <b>+1 to every defense die</b> for that battle. Or <b>Skip</b> and let it through (you won't be asked again in the same battle),
or <b>Skip until my turn</b>: no more prompts until your next turn begins (cancel it any time from the notice up top). Online you have 25 seconds to decide; the attacker's turn clock waits.
Neutral garrisons never ambush. When anyone springs one, the whole table sees it: the card, its rule, and how the battle went.</p>
<h3>House Ultimates</h3>
<p>Every House has one <b>Ultimate</b>, a comeback move for whoever is losing. They open in <b>round 4</b>, and only the <b>bottom half</b> may cast.
The standing is each party's <b>Win %</b>: 40% its share of the territories, 40% its share of the armies, 20% its share of battles won against other Houses. A party is a House alone, or an alliance (secret ones too) with its members' Win % added.
At the start of your turn, the bottom half of the parties (rounded down) may cast.</p>
<p><b>Casting.</b> In your Draft, press the <b>⚡</b> button: pick a target, pick the cards, read the preview, then <b>Commit</b>. It costs <b>3 unlocked cards, at least 1 from your own House</b>,
gives no +10 armies, and counts as your forced trade at 5 cards. Then it <b>recharges for 3 of your own turns</b>. The button always says why you can't cast.
Target one living rival, or a whole <b>public alliance</b>: every member is hit, each a little less. Never an ally. A secret ally of your target is a separate House.</p>
<p><b>Limits.</b> An Ultimate never takes a territory below 1 army, never touches the territory a Standard stands on, and never knocks a House out: only a captured Standard does.
Lasting effects tick at the start of the <b>target's</b> turn; Solar Flare and The Wild Hunt end at the start of the <b>caster's</b> next turn.</p>
<table class="ult-tbl">
<tr><th>House · Ultimate</th><th>Against one House</th><th>Against a public alliance</th></tr>
<tr><td><b>Mars</b><br>Where's Sevro?</td><td>Seize 3 territories of the target or of the neutrals, in quadrants where you hold land. On each, half the armies die (rounded down) and the rest join you with the land. Never a Keep, never under a Standard.</td><td>The 3 picks may come from any member.</td></tr>
<tr><td><b>Jupiter</b><br>Stormfall</td><td>Pick a quadrant: every stack the target holds there above 5 is cut to 5. Their next Draft is capped at 5 (trades still add).</td><td>Every member's stacks in that quadrant are cut. Only the House you targeted has its Draft capped.</td></tr>
<tr><td><b>Pluto</b><br>Rot</td><td>Their stacks of 5 or more lose 30% now, 20% at their next turn and 10% the turn after. Their next three Drafts are cut 30%, 20%, 10%.</td><td>The first two steps only, for each member.</td></tr>
<tr><td><b>Minerva</b><br>Blackout</td><td>Their next turn is skipped. You read their hand until your next turn.</td><td>Each member's next turn: Draft −60%, and no cards, attacks or Fortify. No hand is shown.</td></tr>
<tr><td><b>Ceres</b><br>The Tithe</td><td>Their next Draft −50%, the one after −25%. You gain what is taken on your own next two Drafts, up to 100 in all.</td><td>Each member −30%, then −15%. You collect it all (same cap).</td></tr>
<tr><td><b>Apollo</b><br>Solar Flare</td><td>Until your next turn their highest defense die is −1 against you and your allies. This turn your highest attack die is +1 against them.</td><td>The same for every member.</td></tr>
<tr><td><b>Diana</b><br>The Wild Hunt</td><td>Until your next turn, against you and your allies: their Standard has no honor guard and they spring no REACTION cards, and your party attacks 2 spaces away. On their next turn they can't Fortify or move their Standard.</td><td>The same for every member.</td></tr>
</table>
<p><b>Status icons.</b> Everything that lasts shows as an icon on a banner, with the turns it has left; click one to read it. Gold rings help their House: <b>Ultimate ready</b> (it glows on yours when you hold the cards), <b>Recharging</b>, <b>Long Strike</b>, <b>Radiant</b>, <b>Harvest</b>.
Red rings hurt it: <b>Glared</b>, <b>Rot</b>, <b>Storm-bound</b>, <b>Tithed</b>, <b>Hunted</b>, <b>Revealed</b>. Blue rings restrict it: <b>Blacked Out</b>, <b>Silenced</b>, <b>Pinned</b>, <b>Locked out</b>.
On the map, a pennant marks each territory <b>Seized</b> and hatching covers a <b>Storm-struck</b> quadrant, until the caster's next turn.</p>
<h3>Neutral Houses</h3>
<p>Houses nobody plays hold their land as neutral garrisons. Take a neutral Keep to seize its Standard: you <b>own that House</b> (its Proctor, its card bonuses). The rest of its land stays neutral until you take it.</p>
<h3>Primus of a conquered Keep</h3>
<p>When you conquer a Keep that isn't your home Keep (a rival's or a neutral House's), you may swear in <b>one Character card</b> from your hand whose suit is <b>that Keep's House</b>
as its <b>Primus</b> (the game asks on the spot; you can skip, and swear one in during any later Draft while the Keep has no Primus). The card leaves your hand.
Its <b>Passive</b> works for you on top of your own Primus's (it isn't shared with allies). Lose the Keep and the Primus is <b>slain</b>: the card is discarded.
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
