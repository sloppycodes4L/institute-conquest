// The deck: Character cards (Passive when General, Active when played), Proctor cards,
// and siege-only Relics.
// Canon Houses follow Red Rising (Book One); names marked `oc` are original fan characters
// filling Houses the book barely names.

import { HOUSE_INDEX, type HouseId } from './data.ts';

export type PassiveKind =
  | 'draft'      // +n reinforcements each Draft
  | 'keep'       // +n armies on your home Keep each Draft (if you hold it)
  | 'border'     // +n armies on a random border territory each Draft
  | 'atkStd'     // +n to highest attack die when your Standard attacks
  | 'atkNeutral' // +n to highest attack die against neutral garrisons
  | 'defKeep'    // +n to highest defense die in every Keep you hold
  | 'conquest'   // first conquest each turn drops +n armies on the new territory
  | 'perHouse'   // +n reinforcements per House you own
  | 'stdGuard'   // +n phantom defenders on your Standard
  | 'slaver'     // +n extra armies whenever your Standard enslaves a territory
  | 'fortify';   // +n extra fortify moves each turn

export type ActiveKind =
  | 'armies'      // +n armies to place
  | 'atkBuff'     // +1 to your highest attack die for the next n battles
  | 'breakLine'   // defender rolls a single die for your next n battles
  | 'longStrike'  // n attacks this turn may hit territories two steps away
  | 'sabotage'    // kill n armies in one enemy territory next to yours (leaves 1)
  | 'raid'        // kill 1 army in each of up to n enemy territories next to yours
  | 'parley'      // take an adjacent neutral territory with <= n armies, no fight
  | 'steal'       // take n random cards from a rival
  | 'fortifyAll'  // unlimited fortify moves this turn, +n armies
  | 'moveStd'     // move your Standard to any territory you hold, +n armies there
  | 'draw'        // draw n cards (locked until your next turn)
  | 'harvest'     // +1 army per territory you hold in the Lowlands, +n
  | 'fury'        // all your attack dice +1 for the rest of the turn
  | 'counter'     // REACTION: +n phantom defenders and +1 to defense dice vs a Standard attack
  // Relics: only playable during a Siege on Olympus.
  | 'siegeWalls'  // your next n assaults on Olympus ignore its walls
  | 'siegeCut'    // kill n of Olympus's defenders
  | 'siegeLevy'   // +n armies to place this turn
  | 'siegeMoon';  // Olympus can't smite on your next turn; +1 to your highest attack die vs Olympus this turn

export interface CardDef {
  id: string;
  name: string;
  title: string;
  house: number;
  kind: 'character' | 'proctor' | 'relic';
  oc?: boolean;
  passive?: { kind: PassiveKind; n: number; text: string };
  active: { kind: ActiveKind; n: number; bonus: number; text: string };
  quote: string;
}

type Raw = [id: string, name: string, title: string, house: HouseId, passive: [PassiveKind, number, string] | null,
  active: [ActiveKind, number, number, string], quote: string, oc?: boolean];

const RAW: Raw[] = [
  // ---------------- MARS ----------------
  ['darrow', 'Darrow', 'The Reaper of Mars', 'mars', ['atkStd', 1, '+{n} to your highest attack die when your Standard attacks.'],
    ['breakLine', 1, 1, 'Break the Line: the defender rolls only 1 die in your next {n} battle(s).'],
    'I would have your heart, Mars. I will take it with a slingBlade.'],
  ['sevro', 'Sevro au Barca', 'Goblin of the Howlers', 'mars', ['border', 1, '+{n} army on a random frontline territory each Draft.'],
    ['longStrike', 1, 1, 'Howlers in the Night: {n} attack(s) this turn may strike two territories away.'],
    'Wolfcloaks on, Howlers. Tonight we eat Minerva\'s stew.'],
  ['cassius', 'Cassius au Bellona', 'The Morning Knight', 'mars', ['defKeep', 1, '+{n} to your highest defense die in every Keep you hold.'],
    ['atkBuff', 2, 1, 'Bellona Blade: +1 to your highest attack die for your next {n} battles.'],
    'My brother bled for you. Now you bleed for me.'],
  ['roque', 'Roque au Fabii', 'The Poet', 'mars', ['fortify', 1, '+{n} extra fortify move each turn.'],
    ['fortifyAll', 0, 3, 'Verse and Logistics: unlimited fortify moves this turn.'],
    'An army marches on poetry and bread. Mostly bread.'],
  ['titus', 'Titus au Ladros', 'The Butcher of Castle Mars', 'mars', ['atkNeutral', 1, '+{n} to your highest attack die against neutral garrisons.'],
    ['sabotage', 3, 2, 'Raid the Weak: kill {n} armies in one enemy territory beside yours.'],
    'Kneel, Pixie. Or bleed. I honestly do not care which.'],
  ['antonia', 'Antonia au Severus-Julii', 'The Knife in the Back', 'mars', ['slaver', 1, '+{n} extra army whenever your Standard enslaves a territory.'],
    ['steal', 1, 1, 'Bought Loyalty: steal {n} random card(s) from a rival.'],
    'Loyalty is a currency, darling. I simply pay better.'],
  ['cassandra', 'Cassandra', 'Traitor of Mars', 'mars', ['conquest', 1, 'Your first conquest each turn drops +{n} army on the new ground.'],
    ['raid', 3, 1, 'Jackal\'s Coin: kill 1 army in each of up to {n} enemy territories beside yours.'],
    'The Jackal pays in gold. You pay in blood. Easy math.'],
  // ---------------- MINERVA ----------------
  ['mustang', 'Mustang', 'Primus of Minerva', 'minerva', ['perHouse', 1, '+{n} reinforcement for every House you own.'],
    ['parley', 4, 2, 'Silver Tongue: take a neighboring neutral territory with {n} or fewer armies, no fight.'],
    'You fight like a wolf. I think like the whole damn pack.'],
  ['pax', 'Pax au Telemanus', 'The Giant of Minerva', 'minerva', ['keep', 2, '+{n} armies on your home Keep each Draft.'],
    ['armies', 5, 2, 'I Am Pax au Telemanus!: +{n} armies this turn.'],
    'Behold! Pax au Telemanus! Kneel, you glorious bastards!'],
  ['cook', 'The Cook', 'Minerva\'s Kitchen Tyrant', 'minerva', ['draft', 1, '+{n} reinforcement each Draft. An army fights on its stomach.'],
    ['armies', 4, 2, 'Hot Stew: +{n} armies this turn.'],
    'Steal my ladle and I\'ll boil your fuckin\' fingers.'],
  ['quill', 'Quill au Veran', 'Minerva\'s Spymistress', 'minerva', ['stdGuard', 2, '+{n} phantom defenders on your Standard.'],
    ['steal', 1, 1, 'Pickpocket: steal {n} random card(s) from a rival.'], 'Owls see in the dark, slag.', true],
  ['nightjar', 'Nightjar', 'Owl of the Marsh', 'minerva', ['conquest', 1, 'Your first conquest each turn drops +{n} army on the new ground.'],
    ['raid', 3, 2, 'Night Raid: kill 1 army in each of up to {n} enemy territories beside yours.'], 'Shh. Sleep, goryhead. Forever.', true],
  // ---------------- PLUTO ----------------
  ['jackal', 'The Jackal', 'Adrius au Augustus, Primus of Pluto', 'pluto', ['slaver', 2, '+{n} extra armies whenever your Standard enslaves a territory.'],
    ['counter', 4, 2, 'The Trap (REACTION): vs a Standard attack, +{n} phantom defenders and +1 to your defense dice.'],
    'I\'d cut off my own hand to win. Would you?'],
  ['lilath', 'Lilath au Faran', 'The Bone-Wearer', 'pluto', ['conquest', 1, 'Your first conquest each turn drops +{n} army on the new ground.'],
    ['sabotage', 2, 2, 'Teeth in Her Hair: kill {n} armies in one enemy territory beside yours.'],
    'He sends his regards. I keep the teeth.'],
  ['weasel', 'Weasel', 'Pluto Snare-Setter', 'pluto', ['border', 1, '+{n} army on a random frontline territory each Draft.'],
    ['counter', 3, 1, 'Snare (REACTION): vs a Standard attack, +{n} phantom defenders and +1 to your defense dice.'], 'Step lightly, bloodydamn fool.', true],
  ['rime', 'Rime', 'Frostfang Scout', 'pluto', ['defKeep', 1, '+{n} to your highest defense die in every Keep you hold.'],
    ['moveStd', 3, 2, 'Whiteout: move your Standard to any territory you hold, +{n} armies there.'], 'Nobody tracks you in a blizzard.', true],
  ['gravedigger', 'Gravedigger', 'Pluto\'s Undertaker', 'pluto', ['stdGuard', 2, '+{n} phantom defenders on your Standard.'],
    ['steal', 1, 1, 'Grave Robbing: steal {n} random card(s) from a rival.'], 'Dead Golds don\'t need rings.', true],
  // ---------------- DIANA ----------------
  ['tamara', 'Tamara', 'Primus of Diana', 'diana', ['atkNeutral', 1, '+{n} to your highest attack die against neutral garrisons.'],
    ['longStrike', 1, 1, 'The Hunt: {n} attack(s) this turn may strike two territories away.'], 'The forest is mine. So is the meat in it.'],
  ['tactus', 'Tactus au Rath', 'The Rotten Apple', 'diana', ['conquest', 1, 'Your first conquest each turn drops +{n} army on the new ground.'],
    ['atkBuff', 2, 1, 'Knife for the Primus: +1 to your highest attack die for your next {n} battles.'],
    'I kill Primuses for sport. Want to watch?'],
  ['hartsbane', 'Hartsbane', 'Diana Stalker', 'diana', ['border', 1, '+{n} army on a random frontline territory each Draft.'],
    ['raid', 3, 2, 'Arrow Storm: kill 1 army in each of up to {n} enemy territories beside yours.'], 'Bow down or get shot down.', true],
  ['quiver', 'Quiver', 'Diana Archer', 'diana', ['fortify', 1, '+{n} extra fortify move each turn.'],
    ['breakLine', 1, 1, 'Pinned Down: the defender rolls only 1 die in your next {n} battle(s).'], 'Keep your head down, Pixie.', true],
  ['moonsong', 'Moonsong', 'Diana Ambusher', 'diana', ['draft', 1, '+{n} reinforcement each Draft.'],
    ['counter', 3, 2, 'Birchwood Ambush (REACTION): vs a Standard attack, +{n} phantom defenders and +1 to your defense dice.'], 'The trees have knives tonight.', true],
  // ---------------- APOLLO ----------------
  ['novas', 'Novas', 'Primus of Apollo', 'apollo', ['atkStd', 1, '+{n} to your highest attack die when your Standard attacks.'],
    ['atkBuff', 3, 1, 'Sunblind: +1 to your highest attack die for your next {n} battles.'], 'The Proctors love me. Pray they never love you.'],
  ['sunspit', 'Sunspit', 'Apollo Bruiser', 'apollo', ['slaver', 1, '+{n} extra army whenever your Standard enslaves a territory.'],
    ['sabotage', 3, 2, 'Scorched Earth: kill {n} armies in one enemy territory beside yours.'], 'Burn it. Then burn the ashes.', true],
  ['gilt', 'Gilt', 'Apollo Bribe-Broker', 'apollo', ['perHouse', 1, '+{n} reinforcement for every House you own.'],
    ['steal', 1, 1, 'Proctor\'s Favor: steal {n} random card(s) from a rival.'], 'Everyone\'s got a price. Yours is cheap.', true],
  ['lyre', 'Lyre', 'Apollo War-Singer', 'apollo', ['draft', 1, '+{n} reinforcement each Draft.'],
    ['armies', 4, 2, 'Battle Hymn: +{n} armies this turn.'], 'Sing, you gorydamn peasants. Louder.', true],
  ['pyre', 'Pyre', 'Apollo Torch-Bearer', 'apollo', ['conquest', 1, 'Your first conquest each turn drops +{n} army on the new ground.'],
    ['raid', 4, 2, 'Firebrands: kill 1 army in each of up to {n} enemy territories beside yours.'], 'Smell that? That\'s your harvest, Ceres.', true],
  // ---------------- JUPITER ----------------
  ['lucian', '"Lucian"', 'Jupiter\'s Garrison Leader', 'jupiter', ['stdGuard', 2, '+{n} phantom defenders on your Standard.'],
    ['counter', 3, 2, 'Nobody Suspects Lucian (REACTION): vs a Standard attack, +{n} phantom defenders and +1 to your defense dice.'],
    'Me? I\'m nobody. Just a humble garrison boy.'],
  ['thunderjaw', 'Thunderjaw', 'Primus of Jupiter', 'jupiter', ['atkNeutral', 1, '+{n} to your highest attack die against neutral garrisons.'],
    ['breakLine', 1, 1, 'Thunderclap: the defender rolls only 1 die in your next {n} battle(s).'], 'I am the storm, you damp little shit.', true],
  ['stormcrow', 'Stormcrow', 'Jupiter Outrider', 'jupiter', ['border', 1, '+{n} army on a random frontline territory each Draft.'],
    ['longStrike', 1, 1, 'Ride the Lightning: {n} attack(s) this turn may strike two territories away.'], 'Fast as a bolt. Twice as rude.', true],
  ['castor', 'Castor au Pyre', 'Jupiter Siege-Master', 'jupiter', ['defKeep', 1, '+{n} to your highest defense die in every Keep you hold.'],
    ['armies', 4, 2, 'Siege Levy: +{n} armies this turn.'], 'Walls win wars. Morons climb them.', true],
  ['brontes', 'Brontes', 'Jupiter Shield-Wall', 'jupiter', ['keep', 2, '+{n} armies on your home Keep each Draft.'],
    ['draw', 2, 0, 'Plunder the Stores: draw {n} cards (usable next turn).'], 'Hit me again. I dare you.', true],
  // ---------------- CERES ----------------
  ['sheaf', 'Sheaf', 'Primus of Ceres', 'ceres', ['keep', 2, '+{n} armies on your home Keep each Draft.'],
    ['harvest', 0, 3, 'Bread Ovens: +1 army per territory you hold in the Argos Lowlands.'], 'Everyone mocks Ceres until they\'re hungry.', true],
  ['miller', 'Miller', 'Ceres Quartermaster', 'ceres', ['draft', 1, '+{n} reinforcement each Draft.'],
    ['armies', 4, 2, 'Full Granaries: +{n} armies this turn.'], 'Flour in the wound. Ancient technique.', true],
  ['scythe', 'Scythe', 'Ceres Reaper (not that one)', 'ceres', ['conquest', 1, 'Your first conquest each turn drops +{n} army on the new ground.'],
    ['raid', 3, 2, 'Harvest Season: kill 1 army in each of up to {n} enemy territories beside yours.'], 'There\'s room in this valley for two reapers.', true],
  ['barley', 'Barley', 'Ceres Envoy', 'ceres', ['perHouse', 1, '+{n} reinforcement for every House you own.'],
    ['parley', 3, 2, 'Share the Loaf: take a neighboring neutral territory with {n} or fewer armies, no fight.'], 'Bread first. Then we talk. Then I stab you.', true],
  ['kiln', 'Kiln', 'Keeper of the Ovens', 'ceres', ['defKeep', 1, '+{n} to your highest defense die in every Keep you hold.'],
    ['counter', 3, 2, 'Oven Doors (REACTION): vs a Standard attack, +{n} phantom defenders and +1 to your defense dice.'], 'Come on in. It\'s warm.', true],
];

const PROCTORS: [string, string, HouseId, [ActiveKind, number, string], string][] = [
  ['p-mars', 'Proctor Fitchner', 'mars', ['moveStd', 4, 'Move your Standard to any territory you hold, +{n} armies there.'], 'I don\'t care if you live, kid. I care if you\'re interesting.'],
  ['p-apollo', 'Proctor Apollo', 'apollo', ['fury', 0, 'Rigged Game: all your attack dice +1 for the rest of this turn.'], 'Fair? Oh, sweet child.'],
  ['p-jupiter', 'Proctor Jupiter', 'jupiter', ['armies', 7, 'Supply Drop from Olympus: +{n} armies this turn.'], 'A gift from the gods. Don\'t make it weird.'],
  ['p-minerva', 'Proctor Minerva', 'minerva', ['draw', 3, 'Counsel of the Owl: draw {n} cards (usable next turn).'], 'Wisdom is just cruelty with patience.'],
  ['p-diana', 'Proctor Diana', 'diana', ['longStrike', 3, 'The Wild Hunt: {n} attacks this turn may strike two territories away.'], 'Run, little deer.'],
  ['p-ceres', 'Proctor Ceres', 'ceres', ['armies', 6, 'The Great Harvest: +{n} armies this turn.'], 'Eat. You\'ll need the strength to die properly.'],
  ['p-pluto', 'Proctor Pluto', 'pluto', ['counter', 6, 'Rigged Underworld (REACTION): vs a Standard attack, +{n} phantom defenders and +1 to your defense dice.'], 'The dead keep excellent secrets.'],
];

// Relics: stolen war-gear that only matters once the valley turns on Olympus itself.
const RELICS: [string, string, string, HouseId, [ActiveKind, number, number, string], string][] = [
  ['r-gravboots', 'Stolen GravBoots', 'Relic of the Siege', 'mars', ['siegeWalls', 3, 2, 'SIEGE ONLY: your next {n} assaults on Olympus fly over its walls (no wall bonus).'], 'Fitchner left them lying around. On purpose, probably.'],
  ['r-secrets', "The Proctors' Secrets", 'Relic of the Siege', 'minerva', ['siegeCut', 8, 3, 'SIEGE ONLY: {n} of Olympus\'s defenders are cut down in their beds.'], 'Every god has a back door. Owls find them.'],
  ['r-levy', 'Levy of the Valley', 'Relic of the Siege', 'ceres', ['siegeLevy', 10, 3, 'SIEGE ONLY: +{n} armies this turn.'], 'Every farmboy with a pitchfork, marching uphill.'],
  ['r-moon', "Hunter's Moon", 'Relic of the Siege', 'diana', ['siegeMoon', 0, 0, 'SIEGE ONLY: Olympus cannot smite on your next turn, and +1 to your highest attack die vs Olympus this turn.'], 'Dark enough to climb. Bright enough to aim.'],
  ['r-bolt', 'Pulsefist of Jupiter', 'Relic of the Siege', 'jupiter', ['siegeCut', 5, 2, 'SIEGE ONLY: {n} of Olympus\'s defenders are blasted off the walls.'], 'Point the loud end at the gods.'],
];

export const CARDS: CardDef[] = [
  ...RAW.map(([id, name, title, house, p, a, quote, oc]): CardDef => ({
    id, name, title, house: HOUSE_INDEX[house], kind: 'character', oc,
    passive: p ? { kind: p[0], n: p[1], text: p[2] } : undefined,
    active: { kind: a[0], n: a[1], bonus: a[2], text: a[3] },
    quote,
  })),
  ...PROCTORS.map(([id, name, house, a, quote]): CardDef => ({
    id, name, title: `Proctor of House ${house[0].toUpperCase() + house.slice(1)}`, house: HOUSE_INDEX[house], kind: 'proctor',
    active: { kind: a[0], n: a[1], bonus: 0, text: a[2] }, quote,
  })),
  ...RELICS.map(([id, name, title, house, a, quote]): CardDef => ({
    id, name, title, house: HOUSE_INDEX[house], kind: 'relic',
    active: { kind: a[0], n: a[1], bonus: a[2], text: a[3] }, quote,
  })),
];
export const isSiegeCard = (c: CardDef) => c.active.kind.startsWith('siege');

/** When the valley besieges Olympus, the Proctors of the attacking Houses become its Generals. */
export interface OlympusPower { start: number; regen: number; smite: number; defHigh: number; text: string }
export const OLYMPUS_POWER: Record<string, OlympusPower> = {
  'p-mars': { start: 0, regen: 2, smite: 0, defHigh: 0, text: 'Interesting Children: +2 defenders every allied turn.' },
  'p-apollo': { start: 0, regen: 0, smite: 0, defHigh: 1, text: 'Rigged Game: +1 to Olympus\'s highest defense die.' },
  'p-jupiter': { start: 8, regen: 0, smite: 0, defHigh: 0, text: 'Supply Drop: +8 defenders when the siege begins.' },
  'p-minerva': { start: 0, regen: 0, smite: 2, defHigh: 0, text: 'Counsel of the Owl: smites 2 more soldiers at the Foot every allied turn.' },
  'p-diana': { start: 0, regen: 0, smite: 3, defHigh: 0, text: 'The Wild Hunt: smites 3 more soldiers at the Foot every allied turn.' },
  'p-ceres': { start: 5, regen: 1, smite: 0, defHigh: 0, text: 'The Great Harvest: +5 defenders at the start, +1 every allied turn.' },
  'p-pluto': { start: 6, regen: 0, smite: 1, defHigh: 0, text: 'Rigged Underworld: +6 defenders at the start, smites 1 more every allied turn.' },
};
export const CARD: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const CHARACTER_IDS = CARDS.filter((c) => c.kind === 'character').map((c) => c.id);
export const ALL_CARD_IDS = CARDS.map((c) => c.id);

export const fmt = (text: string, n: number) => text.replace(/\{n\}/g, String(n));
