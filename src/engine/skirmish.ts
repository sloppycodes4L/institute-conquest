// Skirmish maps: small boards for classic wars. No Keeps, no Standards, no neutral land, no Olympus: every
// territory starts in a player's hands, and the last House standing wins.
//
// A map is painted as rows of runs ("b7-16 c19-25": territory `b` on columns 7 to 16, `c` on 19 to 25). Two
// territories that touch in the painting share a border; sea lanes are listed apart. The painting is then laid over
// the same hex grid the valley uses, with its lines wobbled so that borders look drawn rather than typed.
// Pure TS with no deps, like data.ts: it runs in the browser and in the Deno edge function.

import { vnoise, type Biome, type Geo, type Hex, type Region, type Territory } from './data.ts';

const GROUND: Record<string, Biome> = { p: 'plain', f: 'fields', F: 'forest', h: 'highland', c: 'crag', m: 'mountain', s: 'snow', w: 'swamp', d: 'deadwood' };

export interface SkirmishDef {
  id: string;
  name: string;
  blurb: string;
  cols: number;
  /** The painting: row → runs. Rows left out are open sea. */
  art: Record<number, string>;
  /**
   * Regions: name, bonus, and the ground of each of its territories in the order they are named below, a letter each:
   * p plain, f fields, F forest, h highland, c crag, m mountain, s snow, w swamp, d deadwood. The ground is only what
   * the board looks like: terrain plays no part in a Skirmish.
   */
  regions: [name: string, bonus: number, ground: string][];
  /** Territories by letter: name and region. */
  terr: Record<string, [name: string, region: number]>;
  /** Sea lanes, as two letters. With a `~` between them the lane runs off both edges of the map (around the world). */
  lanes: string[];
}

/** A sea lane between two territories. `wrap`: it leaves the map on one side and comes back on the other. */
export interface Lane { a: number; b: number; wrap: boolean }
export interface SkirmishInfo {
  id: string;
  name: string;
  blurb: string;
  lanes: Lane[];
  /** Half the map's width and height, in world units (the map is centred on the origin). */
  w: number;
  h: number;
}

/** Most Houses in a Skirmish. */
export const SKIRMISH_MAX = 4;

const EARTH: SkirmishDef = {
  id: 'earth', name: 'Earth', blurb: 'The classic board: 42 territories on six continents.', cols: 63,
  art: {
    2: 'c20-24',
    3: 'c19-25 B46-49 C50-54 D55-59',
    4: 'b7-16 c19-25 o31-33 t35-40 B46-49 C50-54 D55-60',
    5: 'a2-6 b7-16 c20-25 o30-33 t34-41 A42-45 B46-49 C50-54 D55-60',
    6: 'a2-6 b7-16 c21-23 n26-27 o30-33 t34-41 A42-45 B46-49 E50-54 D55-59',
    7: 'a3-6 d7-12 e13-17 n26-27 o30-33 t34-41 A42-45 B46-49 E50-54 D55-58',
    8: 'd7-12 e13-17 f18-21 o31-33 t34-41 A42-45 B46-49 E50-54 D55-57',
    9: 'd7-12 e13-17 f18-21 p24-26 o32-33 t34-41 A42-45 B46-49 E50-54 D55-57',
    10: 'g8-12 e13-17 f18-21 p24-26 t34-41 A42-45 B46-49 E50-54 D55-56',
    11: 'g8-12 h13-19 p24-26 q29-33 t34-41 A42-45 B46-49 F50-56 G59-60',
    12: 'g8-12 h13-19 q29-33 t34-41 H42-44 A45 I46-49 F50-56 G59-60',
    13: 'g8-12 h13-18 r27-29 s30-34 t35-41 H42-45 I46-49 F50-55 G59',
    14: 'i9-12 h13-17 r26-29 s30-34 t35-40 J41 H42-45 I46-54 G58-59',
    15: 'i9-12 h13-15 r25-29 s30-34 J35-41 K42-45 I46-54',
    16: 'i10-13 r25-28 s31-33 J35-41 K42-46 I47-54',
    17: 'i11-13 r25-27 J35-41 K42-47 I48-53',
    18: 'j12-18 J36-41 K43-47 L48-52',
    19: 'j13-18 u27-33 v34-37 J38-41 K43-46 L49-52',
    20: 'k13-16 l17-22 u26-33 v34-37 K44-46 L50-51',
    21: 'k13-16 l17-23 u26-34 w35-39 K44-45 L50',
    22: 'k13-16 l17-23 u26-34 w35-40 N56-60',
    23: 'k13-16 l17-22 u27-34 w35-40 M48-52 N56-60',
    24: 'k14-16 l17-21 u28-34 w35-39 M49-53',
    25: 'm14-20 x31-36 w37-39 M51-53',
    26: 'm14-19 x31-36 w37-38 P57-59',
    27: 'm14-18 y32-37 z40-41 O52-55 P56-60',
    28: 'm15-18 y32-37 z40-41 O51-55 P56-60',
    29: 'm15-17 y33-36 z40-41 O51-55 P56-60',
    30: 'm15-17 y33-36 z40 O51-55 P56-59',
    31: 'm16-17 y34-35 O53-55 P56-58',
  },
  regions: [['North America', 5, 'sssFFFmpw'], ['South America', 2, 'FmFp'], ['Europe', 5, 'sFpffhp'], ['Africa', 3, 'cfhFpF'], ['Asia', 7, 'mssmFhFcfcpw'], ['Australia', 2, 'Fwcp']],
  terr: {
    a: ['Alaska', 0], b: ['Northwest Territory', 0], c: ['Greenland', 0], d: ['Alberta', 0], e: ['Ontario', 0], f: ['Quebec', 0],
    g: ['Western United States', 0], h: ['Eastern United States', 0], i: ['Central America', 0],
    j: ['Venezuela', 1], k: ['Peru', 1], l: ['Brazil', 1], m: ['Argentina', 1],
    n: ['Iceland', 2], o: ['Scandinavia', 2], p: ['Great Britain', 2], q: ['Northern Europe', 2], r: ['Western Europe', 2], s: ['Southern Europe', 2], t: ['Ukraine', 2],
    u: ['North Africa', 3], v: ['Egypt', 3], w: ['East Africa', 3], x: ['Congo', 3], y: ['South Africa', 3], z: ['Madagascar', 3],
    A: ['Ural', 4], B: ['Siberia', 4], C: ['Yakutsk', 4], D: ['Kamchatka', 4], E: ['Irkutsk', 4], F: ['Mongolia', 4], G: ['Japan', 4],
    H: ['Afghanistan', 4], I: ['China', 4], J: ['Middle East', 4], K: ['India', 4], L: ['Siam', 4],
    M: ['Indonesia', 5], N: ['New Guinea', 5], O: ['Western Australia', 5], P: ['Eastern Australia', 5],
  },
  lanes: ['a~D', 'bc', 'ec', 'fc', 'cn', 'np', 'no', 'po', 'pq', 'pr', 'oq', 'ru', 'su', 'sv', 'lu', 'wJ', 'wz', 'yz', 'DG', 'FG', 'LM', 'MN', 'MO', 'NO', 'NP'],
};

const MARS: SkirmishDef = {
  id: 'mars', name: 'Mars', blurb: 'The Red Planet, terraformed: Agea, Lykos, Olympus Mons, and both moons. 42 territories.', cols: 63,
  art: {
    1: 'a24-36',
    2: 'd16-22 a23-37 b38-44 P53-55',
    3: 'd15-22 a23-30 c31-37 b38-45 P53-55',
    4: 'O6-8 d15-21 c30-37 b38-45',
    5: 'O6-8 d16-20 c31-36 b39-44',
    6: 'y50-56',
    7: 's37-42 y50-57',
    8: 'g4-9 k12-17 s36-42 t43-47 y50-57',
    9: 'g3-9 e10-13 k14-18 o25-31 s36-41 t42-47 z50-53 x54-59',
    10: 'g3-8 e9-13 k14-18 n21-24 o25-32 r36-41 t42-47 z50-53 x54-59',
    11: 'g3-8 e9-13 f14-18 n21-24 o25-32 r36-41 t42-46 z50-53 x54-59',
    12: 'g4-8 e9-12 f13-18 n21-25 o26-31 r36-41 u42-46 A50-54 x55-59',
    13: 'j4-8 h9-12 f13-18 m19-27 l28-33 r37-41 u42-46 A50-54 C55-59',
    14: 'j4-8 h9-12 f13-17 m20-27 l28-33 w36-40 v41-45 u46 A50-54 C55-59',
    15: 'j4-8 h9-12 i13-17 p21-25 m26-27 l28-33 w36-40 v41-46 B50-54 C55-58',
    16: 'j5-8 h9-11 i12-17 p21-26 q27-33 w36-40 v41-45 B50-54 D55-58',
    17: 'j5-9 i10-16 p21-26 q27-33 w37-39 v40-44 B50-54 D55-58',
    18: 'j6-9 i10-15 p22-26 q27-32 B51-54 D55-57',
    19: 'i10-14 p23-25 D53-56',
    21: 'F31-37 E40-46',
    22: 'G24-29 F30-38 E39-47',
    23: 'M6-11 G23-29 F30-38 E39-47 I48-52',
    24: 'M5-11 N12-18 G23-29 F30-37 E38-46 I47-53',
    25: 'M6-10 N12-18 G24-29 H30-37 E38-45 I46-53',
    26: 'L8-13 N14-17 H30-38 J39-46 I47-52',
    27: 'L8-14 K15-20 H31-38 J39-46',
    28: 'L9-13 K14-20 H32-37 J39-45',
    29: 'K14-20',
  },
  regions: [['The Boreal Cap', 2, 'sssh'], ['Tharsis', 5, 'mcpchdh'], ['Agea', 4, 'fchphF'], ['Attica', 3, 'hcfphp'], ['Elysium', 5, 'mpwfhcF'], ['Hellas', 3, 'wcpfhs'], ['The Austral Isles', 2, 'sshd'], ['The Moons', 1, 'cc']],
  terr: {
    a: ['Planum Boreum', 0], b: ['Vastitas', 0], c: ['Acidalia', 0], d: ['Arcadia', 0],
    e: ['Olympus Mons', 1], f: ['Tharsis', 1], g: ['Amazonis', 1], h: ['Lykos', 1], i: ['Daedalia', 1], j: ['Memnonia', 1], k: ['Tempe', 1],
    l: ['Agea', 2], m: ['Valles Marineris', 2], n: ['Lunae', 2], o: ['Chryse', 2], p: ['Solis', 2], q: ['Margaritifer', 2],
    r: ['Arabia', 3], s: ['Cydonia', 3], t: ['Attica', 3], u: ['Syrtis', 3], v: ['Sabaea', 3], w: ['Meridiani', 3],
    x: ['Elysium', 4], y: ['Utopia', 4], z: ['Isidis', 4], A: ['Thessalonica', 4], B: ['Hesperia', 4], C: ['Aeolis', 4], D: ['Cimmeria', 4],
    E: ['Hellas', 5], F: ['Noachis', 5], G: ['Argyre', 5], H: ['Olympia', 5], I: ['Promethei', 5], J: ['Malea', 5],
    K: ['Planum Australe', 6], L: ['Aonia', 6], M: ['Sirenum', 6], N: ['Icaria', 6],
    O: ['Phobos', 7], P: ['Deimos', 7],
  },
  lanes: ['dk', 'dg', 'co', 'cs', 'by', 'bt', 'kn', 'or', 'lw', 'ty', 'uz', 'vE', 'qF', 'pG', 'iN', 'jM', 'KG', 'BI', 'DI', 'g~x', 'Oe', 'Od', 'Py', 'Pb', 'Px'],
};

const WESTEROS: SkirmishDef = {
  id: 'westeros', name: 'Westeros', blurb: 'From the Lands of Always Winter to Sunspear: 52 territories, and the Neck is the only road south.', cols: 31,
  art: {
    1: 'a6-13',
    2: 'a5-13 c14-16 d17-21',
    3: 'a5-13 c14-16 d17-21',
    4: 'b7-13 c14-16 d17-21 f25-26',
    5: 'b7-13 c14-16 d17-21 f25-26',
    6: 'e14-22 f25-26',
    7: 'k9-10 e14-22 f25-26',
    8: 'k9-10 e15-22',
    9: 'm14-17 h18-20 g21-26',
    10: 'l9-13 m14-17 h18-21 g22-26',
    11: 'n5-8 l9-13 m14-17 h18-21 g22-26',
    12: 'n5-8 l9-13 m14-17 h18-22 g23-25',
    13: 'n5-8 l9-13 m14-17 h18-22 i23-24',
    14: 'n5-8 l9-12 m13-17 h18-22 i23-24',
    15: 'n5-8 l9-12 m13-17 i18-24',
    16: 'n5-8 o9-15 m16-17 i18-24',
    17: 'n5-8 o9-15 m16-17 i18-24',
    18: 'n5-8 o9-15 m16-17 i18-23',
    19: 'n5-8 o9-15 j16-21 i22-23',
    20: 'n5-8 o9-15 j16-22',
    21: 'n6-8 o9-15 j16-22',
    22: 'n6-8 o9-15 j16-21',
    23: 'q11-17 j18-21',
    24: 'p5-10 q11-17',
    25: 'p5-10 q11-17',
    26: 'p5-9 q11-17',
    27: 'p6-8 q12-17 z22-26',
    28: 'q13-15 z21-26',
    29: 't12-15 y16-21 z22-26',
    30: 't12-15 y16-21 A22-26',
    31: 'r8-9 t12-13 u14-17 y18-22 A23-26',
    32: 'r8-9 u13-18 y19-22 A23-26',
    33: 's4-5 v12-15 u16-18 y19-22 A23-26',
    34: 's4-5 C8-11 v12-15 u16-18 y19-22 B23-27',
    35: 'C8-11 v12-15 u16-18 y19-21 B23-27',
    36: 'C8-11 v12-15 x16-19 y20-21 B24-26',
    37: 'C8-9 D10-12 w13-15 x16-19',
    38: 'E6-9 D10-12 w13-15 x16-19 H20-25',
    39: 'E6-10 D11 w12-15 x16-19 H20-25',
    40: 'E6-10 F11 w12-15 x16-18 I19-22 K27-28',
    41: 'E6-10 F11-13 P14-16 I17-22 K27-28',
    42: 'G6-10 F11-13 P14-16 I17-21',
    43: 'G6-10 F11-13 P14-16 I17-21',
    44: 'G6-10 P11-16 J17-24',
    45: 'G6-9 P10-16 J17-24',
    46: 'Q6-12 P13-16 J17-24',
    47: 'Q6-12 R13-16 L17-24 O27-28',
    48: 'Q6-12 R13-16 L17-24 O27-28',
    49: 'S8-13 R14-16 L17-24',
    50: 'S8-13 R14-15 N16-20 M21-26',
    51: 'S8-13 R14-15 N16-20 M21-26',
    52: 'T5-7 S8-13 N14-20 M21-25',
    53: 'T5-8 S9-13 W14-19',
    54: 'T5-8 W10-19',
    55: 'T5-8 W10-19',
    56: 'U6-10 W11-18',
    57: 'U6-10 X12-15 Y16-21 Z22-26',
    58: 'U6-9 X12-15 Y16-21 Z22-26',
    59: 'U7-9 X12-15 Y16-21',
    60: 'V4-5 X13-15 Y16-20',
    61: 'V4-5',
  },
  regions: [
    ['Beyond the Wall', 2, 'sssF'], ['Winterfell', 3, 'FFhcpww'], ['The Dreadfort', 2, 'scmdhp'], ['The Iron Islands', 1, 'cc'], ['The Riverlands', 2, 'wpfpd'], ['The Vale of Arryn', 1, 'mcmp'],
    ['The Westerlands', 2, 'cmmhF'], ['The Crownlands', 2, 'FfFc'], ['The Stormlands', 1, 'hFhp'], ['The Reach', 4, 'pwfffpf'], ['Dorne', 1, 'mcfc'],
  ],
  terr: {
    a: ['The Lands of Always Winter', 0], b: ['Frozen Shore', 0], c: ['Fist of the First Men', 0], d: ['The Haunted Forest', 0],
    e: ['The Gift', 2], f: ['Skagos', 2], g: ['Karhold', 2], h: ['The Dreadfort', 2], i: ["Widow's Watch", 2], j: ['White Harbor', 2],
    k: ['Bear Island', 1], l: ['Wolfswood', 1], m: ['Winterfell', 1], n: ['Stoney Shore', 1], o: ['Barrowlands', 1], p: ['Cape Kraken', 1], q: ['The Neck', 1],
    r: ['Harlaw', 3], s: ['Pyke', 3],
    t: ['The Twins', 4], u: ['The Trident', 4], v: ['Riverrun', 4], w: ['Stoney Sept', 4], x: ['Harrenhal', 4],
    y: ['Mountains of the Moon', 5], z: ['The Fingers', 5], A: ['The Eyrie', 5], B: ['Gulltown', 5],
    C: ['The Crag', 6], D: ['Golden Tooth', 6], E: ['Casterly Rock', 6], F: ['Silverhill', 6], G: ['Crakehall', 6],
    H: ['Crackclaw Point', 7], I: ["King's Landing", 7], J: ['Kingswood', 7], K: ['Dragonstone', 7],
    L: ["Storm's End", 8], M: ['Rainwood', 8], N: ['Dornish Marches', 8], O: ['Tarth', 8],
    P: ['Blackwater Rush', 9], Q: ['Searoad Marshes', 9], R: ['The Mander', 9], S: ['Highgarden', 9], T: ['Oldtown', 9], U: ['Three Towers', 9], V: ['The Arbor', 9],
    W: ['Red Mountains', 10], X: ['Sandstone', 10], Y: ['Greenblood', 10], Z: ['Sunspear', 10],
  },
  lanes: ['kb', 'kl', 'kn', 'fd', 'fe', 'fg', 'rp', 'rs', 'rt', 'sC', 'sE', 'KH', 'KI', 'OL', 'OM', 'VU', 'VT', 'jB', 'BK', 'ZO'],
};

const NATIONS: SkirmishDef = {
  id: 'nations', name: 'The Four Nations', blurb: 'Water, Earth, Fire, Air: 39 territories from Agna Qel\'a to the South Pole.', cols: 46,
  art: {
    1: 'c19-27',
    2: 'a19-22 c23-27',
    3: 'a19-22 b23-27',
    4: 'a20-22 b23-26',
    6: 'd29-31',
    7: 'd29-31',
    8: 'e12-17 g18-21',
    9: 'I5-7 e12-17 g18-21 k24-31',
    10: 'I5-7 e12-16 g17-21 k22-31 l32-37',
    11: 'f11-15 h16-21 k22-30 l31-38',
    12: 'f11-15 h16-21 p22-27 l28-38',
    13: 'f11-15 h16-20 p21-27 l28-38',
    14: 'f12-15 i16-20 p21-27 m28-33 l34-38',
    15: 'j12-15 i16-20 p21-27 m28-34 l35-38',
    16: 'j12-15 i16-21 p22-27 m28-35',
    17: 'j13-16 i17-21 n22-27 m28-35',
    18: 'j14-16 n23-28 o29-34',
    19: 'G3-6 n24-28 o29-34',
    20: 'G2-6 A7-10 F17-18 r24-33 w34-37',
    21: 'G2-5 A6-11 F17-18 q21-23 r24-33 w34-37',
    22: 'H2-5 A6-11 D12-15 q21-24 r25-33 w34-37',
    23: 'H2-5 A6-10 D11-15 q21-24 r25-32 s33-36',
    24: 'H3-6 B7-11 D12-15 q21-24 t25-30 s31-36 z40-42',
    25: 'H4-6 B7-11 D12-14 v21-24 t25-30 s31-35 z40-42',
    26: 'B7-11 v21-24 t25-30 u31-35 z40-42',
    27: 'B8-10 v22-25 t26-29 u30-35',
    28: 'C13-15 v23-26 u27-34',
    29: 'E4-6 C13-15 v24-26 u27-33',
    30: 'E4-6 u28-31',
    32: 'y22-24',
    33: 'y22-24 x30-32',
    34: 'J14-16 x30-32',
    35: 'J14-16',
    38: 'K15-20 L21-27',
    39: 'K14-20 L21-28',
    40: 'K14-19 M20-25 L26-28',
    41: 'M17-25',
    42: 'M18-24',
  },
  regions: [
    ['The Northern Water Tribe', 2, 'sss'], ['The Air Temples', 2, 'mmmm'], ['The Western Earth Kingdom', 3, 'hfpmFF'], ['The Northern Earth Kingdom', 4, 'mffcpc'],
    ['The Southern Earth Kingdom', 5, 'mccwFphFp'], ['The Fire Nation', 5, 'mpphccFc'], ['The Southern Water Tribe', 2, 'sss'],
  ],
  terr: {
    a: ["Agna Qel'a", 0], b: ['The Spirit Oasis', 0], c: ['The Northern Ice Fields', 0],
    d: ['The Northern Air Temple', 1], I: ['The Western Air Temple', 1], J: ['The Southern Air Temple', 1], z: ['The Eastern Air Temple', 1],
    e: ['Pohuai Stronghold', 2], f: ['Yu Dao', 2], g: ['Taku', 2], h: ['Makapu', 2], i: ['Gaipan', 2], j: ['Senlin', 2],
    k: ['The Northern Mountains', 3], l: ['Ba Sing Se', 3], m: ['The Agrarian Zone', 3], n: ["Serpent's Pass", 3], o: ['Full Moon Bay', 3], p: ['The Great Divide', 3],
    q: ['Omashu', 4], r: ['Si Wong Desert', 4], s: ['Misty Palms Oasis', 4], t: ['Foggy Swamp', 4], u: ['Gaoling', 4], v: ['Chin Village', 4], w: ['Zaofu', 4],
    x: ['Kyoshi Island', 4], y: ['Whaletail Island', 4],
    A: ['Caldera City', 5], B: ['Fire Fountain City', 5], C: ['Ember Island', 5], D: ['Shu Jing', 5], E: ['The Boiling Rock', 5], F: ['Crescent Island', 5],
    G: ['The Sun Warrior Ruins', 5], H: ['The Black Cliffs', 5],
    K: ['Wolf Cove', 6], L: ['The Southern Tundra', 6], M: ['The South Pole', 6],
  },
  lanes: ['ae', 'bk', 'dk', 'dl', 'Ie', 'IG', 'If', 'FD', 'Fq', 'Fj', 'CB', 'CD', 'Cy', 'EH', 'EB', 'yv', 'yJ', 'xu', 'xL', 'JK', 'JC', 'zw', 'zs', 'dz'],
};

/** Every Skirmish map, in the order the setup screen offers them. */
export const SKIRMISH_MAPS: SkirmishDef[] = [EARTH, MARS, WESTEROS, NATIONS];
export const skirmishDef = (id: string | undefined | null): SkirmishDef => SKIRMISH_MAPS.find((m) => m.id === id) ?? SKIRMISH_MAPS[0];

const SQ3 = Math.sqrt(3);
/** One cell of the painting, in world units: two hexes wide and two rows tall. */
const CW = 2 * SQ3, CH = 3;
const HEX_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

/** The painting as a grid of letters ('' is sea), and its letters in order of first appearance. */
function paint(def: SkirmishDef): { grid: string[][]; rows: number } {
  const rows = Math.max(...Object.keys(def.art).map(Number)) + 2;
  const grid: string[][] = Array.from({ length: rows }, () => new Array(def.cols).fill(''));
  for (const [row, runs] of Object.entries(def.art)) {
    for (const run of runs.split(/\s+/).filter(Boolean)) {
      const m = /^([A-Za-z])(\d+)(?:-(\d+))?$/.exec(run);
      if (!m) throw new Error(`${def.id}: bad run "${run}" on row ${row}`);
      const a = +m[2], b = m[3] ? +m[3] : a;
      for (let c = a; c <= b; c++) {
        if (c >= def.cols) throw new Error(`${def.id}: run "${run}" on row ${row} leaves the map`);
        if (grid[+row][c]) throw new Error(`${def.id}: "${run}" on row ${row} paints over "${grid[+row][c]}"`);
        grid[+row][c] = m[1];
      }
    }
  }
  return { grid, rows };
}

function build(def: SkirmishDef): Geo {
  const { grid, rows } = paint(def);
  const letters = Object.keys(def.terr);
  const idOf = new Map(letters.map((l, i) => [l, i]));
  const nt = letters.length;
  for (const row of grid) for (const ch of row) if (ch && !idOf.has(ch)) throw new Error(`${def.id}: "${ch}" is painted but not named`);

  // Borders, as painted: two territories whose cells share a side.
  const pair = (a: number, b: number) => (a < b ? a * nt + b : b * nt + a);
  const land = new Set<number>();
  for (let r = 0; r < rows; r++) for (let c = 0; c < def.cols; c++) {
    const a = grid[r][c];
    if (!a) continue;
    for (const b of [grid[r][c + 1], grid[r + 1]?.[c]]) if (b && b !== a) land.add(pair(idOf.get(a)!, idOf.get(b)!));
  }

  const W2 = (def.cols * CW) / 2, H2 = (rows * CH) / 2;
  type Cell = Hex & { t: number };
  const cells = new Map<string, Cell>();
  const key = (q: number, r: number) => q + ',' + r;
  const rMax = Math.ceil(H2 / 1.5) + 1;
  for (let r = -rMax; r <= rMax; r++) {
    const y = 1.5 * r;
    for (let q = Math.floor(-W2 / SQ3 - r / 2) - 1; q <= Math.ceil(W2 / SQ3 - r / 2) + 1; q++) {
      const x = SQ3 * (q + r / 2);
      // Wobble the painting's grid lines, so a border is a drawn line and not a staircase.
      const u = (x + W2) / CW + (vnoise(x * 0.11 + 3, y * 0.11 + 9) - 0.5) * 0.8 + (vnoise(x * 0.33 + 50, y * 0.33) - 0.5) * 0.3;
      const v = (H2 - y) / CH + (vnoise(x * 0.11 + 70, y * 0.11 - 20) - 0.5) * 0.8 + (vnoise(x * 0.33, y * 0.33 + 40) - 0.5) * 0.3;
      const ch = grid[Math.floor(v)]?.[Math.floor(u)];
      if (ch) cells.set(key(q, r), { q, r, x, y, t: idOf.get(ch)!, rad: Math.hypot(x, y) });
    }
  }

  /** Keep only the largest connected blob of each territory; hand orphans to a neighbour, or to the sea. */
  const tidy = () => {
    const byT: Cell[][] = Array.from({ length: nt }, () => []);
    for (const c of cells.values()) byT[c.t].push(c);
    for (let t = 0; t < nt; t++) {
      const seen = new Set<string>();
      const comps: Cell[][] = [];
      for (const c of byT[t]) {
        const k0 = key(c.q, c.r);
        if (seen.has(k0)) continue;
        const comp: Cell[] = [], stack = [c];
        seen.add(k0);
        while (stack.length) {
          const cur = stack.pop()!;
          comp.push(cur);
          for (const [dq, dr] of HEX_DIRS) {
            const nk = key(cur.q + dq, cur.r + dr), nb = cells.get(nk);
            if (nb && nb.t === t && !seen.has(nk)) { seen.add(nk); stack.push(nb); }
          }
        }
        comps.push(comp);
      }
      comps.sort((a, b) => b.length - a.length);
      for (const comp of comps.slice(1)) for (const c of comp) {
        const counts = new Map<number, number>();
        for (const [dq, dr] of HEX_DIRS) {
          const nb = cells.get(key(c.q + dq, c.r + dr));
          if (nb && nb.t !== t && land.has(pair(nb.t, t))) counts.set(nb.t, (counts.get(nb.t) || 0) + 1);
        }
        if (!counts.size) { cells.delete(key(c.q, c.r)); continue; }
        c.t = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
  };
  /** Where the wobble pushed two territories together that the painting keeps apart, the sea comes in between. */
  const carve = () => {
    const size = new Array(nt).fill(0);
    for (const c of cells.values()) size[c.t]++;
    let cut = 0;
    for (const c of [...cells.values()]) {
      if (!cells.has(key(c.q, c.r))) continue;
      for (const [dq, dr] of HEX_DIRS) {
        const nb = cells.get(key(c.q + dq, c.r + dr));
        if (!nb || nb.t === c.t || land.has(pair(nb.t, c.t))) continue;
        const lose = size[c.t] >= size[nb.t] ? c : nb;
        cells.delete(key(lose.q, lose.r));
        size[lose.t]--; cut++;
        if (lose === c) break;
      }
    }
    return cut;
  };
  for (let pass = 0; pass < 6; pass++) { tidy(); if (!carve()) break; }
  tidy();

  const hexes: Hex[] = [...cells.values()].map(({ q, r, x, y, t, rad }) => ({ q, r, x, y, t, rad }));
  const byT: Hex[][] = Array.from({ length: nt }, () => []);
  for (const h of hexes) byT[h.t].push(h);
  byT.forEach((hs, t) => { if (hs.length < 4) throw new Error(`${def.id}: ${def.terr[letters[t]][0]} came out with ${hs.length} hexes`); });

  const adjSet: Set<number>[] = Array.from({ length: nt }, () => new Set());
  const touching = new Set<number>();
  for (const c of cells.values()) for (const [dq, dr] of HEX_DIRS) {
    const nb = cells.get(key(c.q + dq, c.r + dr));
    if (nb && nb.t !== c.t) { touching.add(pair(c.t, nb.t)); adjSet[c.t].add(nb.t); adjSet[nb.t].add(c.t); }
  }
  for (const p of land) if (!touching.has(p)) throw new Error(`${def.id}: ${def.terr[letters[Math.floor(p / nt)]][0]} and ${def.terr[letters[p % nt]][0]} are painted as neighbours but do not touch`);
  for (const p of touching) if (!land.has(p)) throw new Error(`${def.id}: ${def.terr[letters[Math.floor(p / nt)]][0]} and ${def.terr[letters[p % nt]][0]} touch but are not painted as neighbours`);

  const lanes: Lane[] = def.lanes.map((l) => {
    const m = /^([A-Za-z])(~?)([A-Za-z])$/.exec(l);
    if (!m || !idOf.has(m[1]) || !idOf.has(m[3])) throw new Error(`${def.id}: bad lane "${l}"`);
    const a = idOf.get(m[1])!, b = idOf.get(m[3])!;
    if (adjSet[a].has(b)) throw new Error(`${def.id}: lane "${l}" joins two territories that already border`);
    return { a, b, wrap: !!m[2] };
  });
  for (const l of lanes) { adjSet[l.a].add(l.b); adjSet[l.b].add(l.a); }

  // An army stands at the heart of its territory: the hex furthest from every border and shore.
  const depth = new Map<string, number>();
  const ring: Cell[] = [];
  for (const c of cells.values()) {
    if (HEX_DIRS.some(([dq, dr]) => cells.get(key(c.q + dq, c.r + dr))?.t !== c.t)) { depth.set(key(c.q, c.r), 0); ring.push(c); }
  }
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i], d = depth.get(key(c.q, c.r))!;
    for (const [dq, dr] of HEX_DIRS) {
      const nk = key(c.q + dq, c.r + dr), nb = cells.get(nk);
      if (nb && !depth.has(nk)) { depth.set(nk, d + 1); ring.push(nb); }
    }
  }
  const centroid: [number, number][] = byT.map((hs) => {
    const cx = hs.reduce((a, h) => a + h.x, 0) / hs.length, cy = hs.reduce((a, h) => a + h.y, 0) / hs.length;
    const score = (h: Hex) => depth.get(key(h.q, h.r))! * 2.2 - Math.hypot(h.x - cx, h.y - cy);
    const best = hs.reduce((b, h) => (score(h) > score(b) ? h : b), hs[0]);
    return [best.x, best.y];
  });

  const dist = adjSet.map((_, from) => {
    const d = new Array(nt).fill(Infinity);
    d[from] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) for (const x of adjSet[q[i]]) if (d[x] === Infinity) { d[x] = d[q[i]] + 1; q.push(x); }
    return d;
  });
  if (dist[0].some((d) => d === Infinity)) throw new Error(`${def.id}: part of the map can't be reached`);

  const nth = new Array(def.regions.length).fill(0);
  const territories: Territory[] = letters.map((l, id) => ({
    id, name: def.terr[l][0], biome: GROUND[def.regions[def.terr[l][1]][2][nth[def.terr[l][1]]++]] ?? 'plain', terrain: 'open', house: -1, slice: -1, quadrant: def.terr[l][1], isKeep: false, row: 0, col: 0, foot: false,
    region: def.terr[l][1], port: -1,
  }));
  const regions: Region[] = def.regions.map(([name, bonus, ground], id) => {
    const terr = territories.filter((t) => t.region === id).map((t) => t.id);
    if (terr.length !== ground.length) throw new Error(`${def.id}: region ${name} has ${terr.length} territories and ground for ${ground.length}`);
    const hs = terr.flatMap((t) => byT[t]);
    const mx = hs.reduce((a, x) => a + x.x, 0) / hs.length, my = hs.reduce((a, x) => a + x.y, 0) / hs.length;
    const at = hs.reduce((b, x) => (Math.hypot(x.x - mx, x.y - my) < Math.hypot(b.x - mx, b.y - my) ? x : b), hs[0]);
    return { id, name, house: -1, terr, bonus, at: [at.x, at.y] };
  });

  return {
    layout: -1, perHouse: nt, rows: [], territories, nt, hexes, adj: adjSet.map((s) => [...s].sort((a, b) => a - b)), dist, centroid, regions,
    ports: lanes.map((l) => [l.a, l.b] as [number, number]), foot: [], R_IN: 0, R_OUT: Math.hypot(W2, H2), sliceHouse: [0, 1, 2, 3, 4, 5, 6],
    keepOf: () => -1, keepOfSlice: () => -1, straits: [],
    skirmish: { id: def.id, name: def.name, blurb: def.blurb, lanes, w: W2, h: H2 },
  };
}

const CACHE = new Map<string, Geo>();
/** A Skirmish map's board (built once, then kept). An unknown id gives the first map. */
export function skirmishGeo(id: string | undefined | null): Geo {
  const def = skirmishDef(id);
  let g = CACHE.get(def.id);
  if (!g) { g = build(def); CACHE.set(def.id, g); }
  return g;
}
