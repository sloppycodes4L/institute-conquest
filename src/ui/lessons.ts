// The Proctor's Guide, pure half: the lesson registry and pickStep(), which turns a snapshot of the game (GuideCtx)
// into what the guide shows. No DOM and no imports from app.ts, so the whole schedule is testable in node.

export type Level = 'full' | 'hints' | 'off';
export type Kind = 'read' | 'do' | 'tip';

/** A plain-data snapshot of everything the lessons look at, built by App after every render. */
export interface GuideCtx {
  /** A turn timer is on (`v.opts.timer > 0`): Read steps never block. */
  timed: boolean;
  /** Handoff, wheel, showcase, ambush/siege/fallen overlay, someone else's ambush prompt, spectating. */
  silent: boolean;
  /** Replaying someone else's moves. */
  playing: boolean;
  phase: string;
  myTurn: boolean;
  /** `${v.turn}:${v.cur}`, to tell turns apart. */
  turnKey: string;
  round: number;
  reinforcements: number;
  /** Armies placed this Draft. */
  placed: number;
  /** A card is waiting for a target, or its outcome is being previewed. */
  pending: boolean;
  sel: number | null;
  target: number | null;
  targetIsOlympus: boolean;
  /** Targets in reach of the selected territory (each wears its odds on the map). */
  targets: number;
  /** Territories that can attack right now. */
  sources: number;
  bestSource: { id: number; name: string; armies: number } | null;
  /** Blitz odds on the current target (0..1). */
  odds: number | null;
  overwhelm: boolean;
  oneDie: boolean;
  /** Battles and Overwhelms I fought this turn. */
  fightsThisTurn: number;
  /** Territories I took this turn, by name. */
  taken: string[];
  mustMove: { from: string; to: string } | null;
  fortifies: number;
  /** My last fortify march this turn. */
  moved: { n: number; to: string } | null;
  /** My interior territory (no enemy neighbours) with the most armies. */
  interior: { id: number; name: string } | null;
  mustTrade: boolean;
  breakdown: Breakdown | null;
  passageOpen: boolean;
  // ---- just-in-time lessons ----
  /** Cards in my hand (on my turn). */
  hand: number;
  /** A card play is being previewed (Commit / Back). */
  confirm: boolean;
  /** The Raise the Standard button is on the action bar. */
  canRaiseStd: boolean;
  /** ⚑ Move Standard is on the Fortify bar. */
  canMoveStd: boolean;
  /** The "A Keep without a master" prompt is open. */
  primusAsk: boolean;
  /** My REACTION prompt is open (I'm attacked and hold an ambush card). */
  reactionMine: boolean;
  /** A rival sprang an ambush on my attack this turn. */
  ambushHit: boolean;
  /** Alliances are on and one House has attacked another. */
  alliancesOpen: boolean;
  invitesIn: number;
  rallyOpen: boolean;
  voteOwed: boolean;
  /** A target in reach (or the current one) has ⛰ or 🌲 modifiers. */
  terrainTarget: boolean;
  /** A target in reach (or the current one) is a neutral House's Keep. */
  neutralKeepTarget: boolean;
  /** A region I completed this turn. */
  regionTaken: { name: string; bonus: number } | null;
  /** The turn timer in seconds (0: none). */
  timerSecs: number;
  // ---- House Ultimates (.008) ----
  /** House Ultimates are on in this war and round 4 has begun. */
  ultOpen: boolean;
  /** The Ultimate button on my Draft: Ready, or allowed to cast but short of cards. Null for every other state. */
  ultBtn: 'ready' | 'cards' | null;
  /** My House's Ultimate: its name, what it does in one line, and my House's name. */
  ult: { name: string; line: string; house: string } | null;
  /** The cast flow is open. */
  castOpen: boolean;
  /** The Ultimate whose effect is on my banner now (its name), or null. */
  ultHit: string | null;
  /** A rival's banner carries a status icon. */
  rivalIcon: boolean;
  /** I am Locked out of alliances. */
  lockedOut: boolean;
}

export interface Breakdown {
  territories: number;
  base: number;
  regions: { name: string; bonus: number }[];
  keeps: number;
  keepBonus: number;
  general: number;
  total: number;
}

/** Saved per device (ic-tutor, ic-tutor-seen, ic-tutor-hints). */
export interface GuideMem {
  level: Level | null;
  seen: string[];
  hintsLeft: number;
}

/** What one guided turn did, for the recap. */
export interface TurnLog {
  turn: string;
  round: number;
  placed: number;
  taken: string[];
  fights: number;
  moved: { n: number; to: string } | null;
}

/** This session's progress through the lessons (plain data, not saved). */
export interface GuideRun {
  /** The Read or Your-move lesson open now. */
  active: string | null;
  /** The last own turn seen (hints count down once per own turn). */
  ownTurn: string | null;
  /** The turn the turn-1 lessons are running in. */
  guided: TurnLog | null;
  /** A guided turn just ended: the recap is open (or waits for the guide to be allowed to speak). */
  recap: TurnLog | null;
  /** Lessons re-armed from the 🎓 menu: they fire at their next trigger whatever the level. */
  replay: string[];
  /** Tips waiting to show (copy fixed when they fired); the first one is on screen. */
  tips: Tip[];
  /** Battles fought when the dice lesson opened (the roll lesson follows it in the same fight). */
  diceAt: number;
}

export interface GuideState { mem: GuideMem; run: GuideRun }

/** A Read or Your-move card. Copy is HTML; every name from the game is escaped. */
export interface Card {
  id: string;
  kind: 'read' | 'do';
  /** "Lesson 3 of 10", "Before the war"… */
  step: string;
  title: string;
  body: string;
  /** The Read button. */
  cta?: string;
  /** The Your-move footer ("● Press End Draft"). */
  wait?: string;
  prog?: { n: number; of: number; label: string };
  /** A Read step's spotlight (the union of these). */
  spot?: string[];
  /** Real controls to pulse. */
  pulse?: string[];
  width?: number;
  /** Bring this territory on screen (when the player lets the camera follow). */
  focus?: number | null;
  /** The recap: a centered card with its own buttons. */
  recap?: boolean;
}

export interface Hint { text: string; pulse?: string[] }
export interface Tip { id: string; html: string; pinned: boolean; pulse?: string[]; /** Shown even when the guide is Off (its own Tips, and replayed ones). */ always?: boolean }

export interface GuideView {
  card: Card | null;
  hint: Hint | null;
  tip: Tip | null;
  /** A Read card is open and the war waits for it (never in a timed war). */
  blocking: boolean;
}

interface Lesson {
  id: string;
  kind: Kind;
  /** 1–10: the turn-1 sequence (full guide only). */
  n?: number;
  /** Starts when this holds and the lesson hasn't been seen. */
  when(c: GuideCtx, st: GuideState): boolean;
  /** While open: false means the moment has passed, so it's marked seen and dropped. */
  alive?(c: GuideCtx, st: GuideState): boolean;
  /** While open: the player did the thing. */
  done?(c: GuideCtx, st: GuideState): boolean;
  /** While open: true hides it for now without dropping it. */
  hide?(c: GuideCtx): boolean;
  card?(c: GuideCtx, st: GuideState): Card;
  tip?(c?: GuideCtx): Omit<Tip, 'id'>;
  /** Tips shown even when the guide is Off. */
  always?: boolean;
  /** Pinned tips stay while this holds. */
  pinnedWhile?(c: GuideCtx): boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const pct = (p: number) => (p > 0.995 && p < 1 ? '>99%' : p < 0.005 && p > 0 ? '<1%' : `${Math.round(p * 100)}%`);
const lessonN = (n: number) => `Lesson ${n} of 10`;
const inAttack = (c: GuideCtx) => c.myTurn && c.phase === 'attack';

/** Lessons 1–10, in order. */
export const TURN_LESSONS = ['turn-shape', 'place', 'end-draft', 'pick-source', 'odds', 'dice', 'roll', 'march-in', 'attack-loop', 'fortify'];

/** The 🎓 menu's lesson groups. */
export const GROUPS: { name: string; ids: string[] }[] = [
  { name: 'Turn basics', ids: ['turn-shape', 'place', 'end-draft', 'pick-source', 'roll', 'march-in', 'attack-loop', 'fortify'] },
  { name: 'Dice & odds', ids: ['odds', 'dice'] },
  { name: 'Your Primus', ids: ['choose-primus'] },
  { name: 'Cards', ids: ['cards', 'must-trade', 'card-preview'] },
  { name: 'The Standard', ids: ['standard', 'standard-move'] },
  { name: 'Primus', ids: ['primus'] },
  { name: 'Terrain', ids: ['terrain', 'neutral-keep'] },
  { name: 'Ambushes', ids: ['ambush-defend', 'ambush-hit'] },
  { name: 'Alliances', ids: ['alliances', 'invite', 'rally'] },
  { name: 'Siege on Olympus', ids: ['siege-vote'] },
  { name: 'House Ultimates', ids: ['ult-open', 'ult-ready', 'ult-short', 'ult-target', 'ult-hit', 'ult-status', 'lockout'] },
];

function whyFold(c: GuideCtx, n: number) {
  const b = c.breakdown;
  if (!b) return '';
  const rows = [`<tr><td>${b.territories} territories ÷ 3 (at least 3)</td><td>${b.base}</td></tr>`];
  for (const r of b.regions) rows.push(`<tr><td>You hold the ${esc(r.name)} region</td><td>+${r.bonus}</td></tr>`);
  if (b.keeps) rows.push(`<tr><td>You hold ${b.keeps === 1 ? 'your Keep' : `${b.keeps} Keeps`}</td><td>+${b.keepBonus}</td></tr>`);
  if (b.general) rows.push(`<tr><td>Your Primus</td><td>+${b.general}</td></tr>`);
  if (n > b.total) rows.push(`<tr><td>Cards and other bonuses</td><td>+${n - b.total}</td></tr>`);
  return `<details class="g-why"><summary>Why ${n}?</summary><table>${rows.join('')}<tr class="tot"><td>This turn</td><td>${n}</td></tr></table></details>`;
}

const LESSONS: Lesson[] = [
  // ---- before turn 1 ----
  {
    id: 'choose-primus', kind: 'read',
    when: (c) => c.passageOpen,
    alive: (c) => c.passageOpen,
    card: () => ({
      id: 'choose-primus', kind: 'read', step: 'Before the war', title: 'Choose your Primus', width: 380, spot: ['#modal-root .cards-row'],
      body: '<span>Pick any Character of your House.</span><span>Their <b>Passive</b> works for you all war.</span>',
    }),
  },
  // ---- turn 1, full guide ----
  {
    id: 'turn-shape', kind: 'read', n: 1,
    when: (c) => c.myTurn && c.phase === 'draft' && c.placed === 0,
    alive: (c) => c.myTurn && c.phase === 'draft',
    card: () => ({
      id: 'turn-shape', kind: 'read', step: lessonN(1), title: 'A turn has three phases', width: 380, spot: ['#topbar .phases'], cta: 'Start the Draft ▸',
      body: `<span>They always run in this order. The bar at the top shows where you are.</span>
        <div class="g-phases">
          <div><span class="ph">DRAFT</span><span>Place new armies. <span class="opt">Every turn</span></span></div>
          <div><span class="ph">ATTACK</span><span>Fight your neighbours, as often as you like. <span class="opt">Optional</span></span></div>
          <div><span class="ph">FORTIFY</span><span>Move troops once. <span class="opt">Optional</span></span></div>
        </div>`,
    }),
  },
  {
    id: 'place', kind: 'do', n: 2,
    when: (c) => c.myTurn && c.phase === 'draft' && c.reinforcements > 0 && !c.pending,
    alive: (c) => c.myTurn && c.phase === 'draft',
    done: (c) => c.reinforcements === 0,
    hide: (c) => c.pending,
    card: (c) => {
      const n = c.reinforcements + c.placed;
      return {
        id: 'place', kind: 'do', step: lessonN(2), title: `Place ${n} armies`,
        body: `<span>Click one of your <b>glowing territories</b> to add an army. Mass them where you plan to attack.</span>${whyFold(c, n)}<span class="g-fine">Shift-click, or <b>−</b> in the bar, takes one back.</span>`,
        prog: { n: c.placed, of: n, label: `Placed ${c.placed} / ${n}` },
        wait: c.reinforcements > 0 ? 'Click a glowing territory' : 'All placed',
      };
    },
  },
  {
    id: 'end-draft', kind: 'do', n: 3,
    when: (c) => c.myTurn && c.phase === 'draft' && c.reinforcements === 0 && !c.mustTrade,
    alive: (c) => c.myTurn && c.phase === 'draft',
    hide: (c) => c.reinforcements > 0 || c.mustTrade,
    card: (c) => ({
      id: 'end-draft', kind: 'do', step: lessonN(3), title: `All ${c.placed} placed`, pulse: ['[data-a=endDraft]'], wait: 'Press End Draft',
      body: '<span>Press <b>End Draft ▸</b> to start fighting. Changed your mind? <b>Undo</b> takes them all back first.</span>',
    }),
  },
  {
    id: 'pick-source', kind: 'do', n: 4,
    when: (c) => inAttack(c) && c.sel == null && c.sources > 0 && c.fightsThisTurn === 0 && !c.mustMove,
    alive: inAttack,
    done: (c) => c.sel != null,
    card: (c) => ({
      id: 'pick-source', kind: 'do', step: lessonN(4), title: 'Pick where to attack from', wait: 'Click a glowing territory', focus: c.bestSource?.id ?? null,
      body: `<span>Glowing territories can attack: they hold <b>2+ armies</b> and touch an enemy. One army always stays behind.</span>${c.bestSource ? `<span>Try <b>${esc(c.bestSource.name)} (${c.bestSource.armies})</b>.</span>` : ''}`,
    }),
  },
  {
    id: 'odds', kind: 'read', n: 5,
    when: (c) => inAttack(c) && c.sel != null && c.target == null && c.targets >= 1,
    alive: (c) => inAttack(c) && c.sel != null && c.target == null,
    card: () => ({
      id: 'odds', kind: 'read', step: lessonN(5), title: 'Every target shows your odds', width: 420, spot: ['#plates .plate.tgt, #plates .plate.ally'],
      body: `<span>They are on the map, beside each target's count: your chance to take it if you Blitz. Read the colour; the math is done for you.</span>
        <div class="g-odds-key">
          <div><span class="odds good">65%+</span><span><b>Likely.</b> Go for it.</span></div>
          <div><span class="odds even">35–64%</span><span><b>Coin flip.</b> Bring more armies first.</span></div>
          <div><span class="odds bad">under 35%</span><span><b>Long shot.</b> Usually a waste.</span></div>
          <div><span class="odds good">🏳 Overwhelm</span><span>Twice their number: neutrals give up. No dice.</span></div>
        </div>`,
    }),
  },
  {
    id: 'dice', kind: 'read', n: 6,
    when: (c) => inAttack(c) && c.target != null && !c.targetIsOlympus,
    alive: (c) => inAttack(c) && c.target != null,
    card: (c) => ({
      id: 'dice', kind: 'read', step: lessonN(6), title: 'How a fight works', width: 400, cta: 'Let me fight ▸',
      spot: ['#actionbar .seg', '#actionbar [data-a=roll]', '#actionbar [data-a=blitz]'],
      body: c.overwhelm
        ? '<span><b>🏳 Overwhelm.</b> Twice their number: neutrals give up, no dice.</span>'
        : `<span>You roll up to <b>3 dice</b>, they roll up to <b>2</b>. Highest against highest, then the next pair. <b>Ties go to the defender.</b></span>
        <div class="g-dice-ex">
          <span class="g-die a">6</span><span class="g-die d">5</span><span class="res win">6 beats 5: they lose 1</span>
          <span class="g-die a">4</span><span class="g-die d">4</span><span class="res lose">Tie: you lose 1</span>
          <span class="g-die a x">2</span><span></span><span class="res">No pair, no effect</span>
        </div>
        <div class="g-rd"><div><b>Roll</b><span>One throw. Then you decide again.</span></div><div><b>Blitz</b><span>Keeps rolling until you win or 1 army is left.</span></div></div>
        ${c.oneDie ? '<span class="g-fine">This garrison is neutral and alone, so it rolls only 1 die.</span>' : ''}`,
    }),
  },
  {
    id: 'roll', kind: 'do', n: 7,
    when: (c, st) => inAttack(c) && c.target != null && !c.targetIsOlympus && st.mem.seen.includes('dice') && st.run.diceAt === c.fightsThisTurn,
    alive: (c) => inAttack(c) && c.target != null,
    done: (c, st) => c.fightsThisTurn > st.run.diceAt,
    card: (c) => {
      const p = c.overwhelm ? 1 : c.odds ?? 0;
      const say = p >= 0.65 ? 'Blitz is a safe bet' : p >= 0.35 ? 'this is a gamble' : "you'll probably lose this";
      return {
        id: 'roll', kind: 'do', step: lessonN(7), title: 'Roll or Blitz', pulse: ['[data-a=roll]', '[data-a=blitz]'], wait: 'Press Roll or Blitz',
        body: `<span>At <b>${pct(p)}</b>, ${say}. Roll if you want to be able to stop partway.</span>`,
      };
    },
  },
  {
    id: 'march-in', kind: 'do', n: 8,
    when: (c) => c.myTurn && c.mustMove != null,
    alive: (c) => c.myTurn && c.mustMove != null,
    card: (c) => ({
      id: 'march-in', kind: 'do', step: lessonN(8), title: 'Move in', pulse: ['#modal-root [data-a=move]'], wait: 'Press March in',
      body: `<span>Armies you march in hold <b>${esc(c.mustMove!.to)}</b>. The rest stay in ${esc(c.mustMove!.from)}. Put more on the side that faces enemies.</span>`,
    }),
  },
  {
    id: 'attack-loop', kind: 'do', n: 9,
    when: (c) => inAttack(c) && c.sel == null && c.fightsThisTurn >= 1 && !c.mustMove,
    alive: inAttack,
    done: (c) => c.sel != null,
    card: () => ({
      id: 'attack-loop', kind: 'do', step: lessonN(9), title: 'Attack again, or move on', pulse: ['[data-a=endAttack]'], wait: 'Attack again, or press Fortify',
      body: "<span>There's no limit on attacks. When you're done, press <b>Fortify ▸</b>.</span>",
    }),
  },
  {
    id: 'fortify', kind: 'do', n: 10,
    when: (c) => c.myTurn && c.phase === 'fortify',
    alive: (c) => c.myTurn && c.phase === 'fortify',
    done: (c) => c.fortifies > 0,
    card: (c) => {
      const step = c.sel == null ? 1 : 2;
      const where = c.interior ? ` like <b>${esc(c.interior.name)}</b>` : '';
      return {
        id: 'fortify', kind: 'do', step: lessonN(10), title: 'Move troops once', focus: step === 1 ? c.interior?.id ?? null : null,
        pulse: step === 2 && c.target != null ? ['[data-a=fortify]'] : undefined,
        body: `<span>Pick troops, then where they go. They march through any land you hold, so pull them out of safe spots${where}.</span>`,
        prog: { n: step - 1, of: 2, label: `Step ${step} of 2` },
        wait: step === 1 ? (c.interior ? `Click ${esc(c.interior.name)}` : 'Click your troops') : c.target == null ? 'Click a front-line territory' : 'Press March',
      };
    },
  },
  // ---- just-in-time: the first time each mechanic shows up (Full or Hints) ----
  {
    id: 'watching', kind: 'tip',
    when: (c) => c.playing,
    tip: () => ({ html: "Rivals' moves replay one at a time. Speed them up with <b>2×</b> and <b>4×</b>, or jump to now with <b>Skip ▸▸</b>.", pinned: false }),
  },
  {
    id: 'cards', kind: 'read',
    when: (c) => c.myTurn && c.hand > 0,
    alive: (c) => c.myTurn && c.hand > 0,
    card: () => ({
      id: 'cards', kind: 'read', step: 'New: cards', title: 'You earned a card', width: 340, spot: ['#hand'],
      body: `<span>A card does one of two things:</span>
        <div class="g-rd"><div><b>Play it</b><span>for its <b>Active</b> ability. Glowing cards can be played now.</span></div><div><b>Trade 3</b><span>for 10 armies during your Draft.</span></div></div>
        <span class="g-fine">Your cards wait in this tray. Open one to read it and to see which territories it would hit.</span>`,
    }),
  },
  {
    id: 'must-trade', kind: 'do',
    when: (c) => c.myTurn && c.phase === 'draft' && c.mustTrade,
    alive: (c) => c.myTurn && c.phase === 'draft',
    done: (c) => !c.mustTrade,
    card: () => ({
      id: 'must-trade', kind: 'do', step: 'New: cards', title: 'Your hand is full', pulse: ['#hand'], wait: 'Pick 3 cards, then Trade',
      body: '<span>Open a card and press <b>Trade</b> to pick it. Pick 3, then <b>Trade 3 → 10 armies</b> before you march.</span>',
    }),
  },
  {
    id: 'card-preview', kind: 'tip',
    when: (c) => c.confirm,
    tip: () => ({ html: 'This is a preview of the outcome. <b>Commit</b> to play it, or <b>Back</b> to change your mind.', pinned: false }),
  },
  {
    id: 'standard', kind: 'read',
    when: (c) => inAttack(c) && c.target != null && c.canRaiseStd,
    alive: (c) => inAttack(c) && c.target != null && c.canRaiseStd,
    card: () => ({
      id: 'standard', kind: 'read', step: 'New: the Standard', title: 'Raise the Standard', width: 380,
      spot: ['#actionbar [data-a=std]', '#actionbar label:has(> input[data-a=commit])'],
      body: "<span>Once per turn: +3 phantom soldiers and your Primus's war cry, with no retreat.</span><span><b>Win</b> and the defenders join you. <b>Lose</b> and your whole House goes to them.</span>",
    }),
  },
  {
    id: 'standard-move', kind: 'tip',
    when: (c) => c.myTurn && c.phase === 'fortify' && c.canMoveStd,
    tip: () => ({ html: 'Your Standard can move once per turn too. If a rival takes the territory it stands on, your House is theirs.', pinned: false }),
  },
  {
    id: 'primus', kind: 'read',
    when: (c) => c.primusAsk,
    alive: (c) => c.primusAsk,
    card: () => ({
      id: 'primus', kind: 'read', step: 'New: Primus', title: 'Swear in a Primus', width: 380, spot: ['#modal-root .cards-row'],
      body: "<span>A Character from this Keep's House guards it, and its Passive stacks with your own Primus's.</span><span>Lose the Keep and the Primus dies with it.</span>",
    }),
  },
  {
    id: 'terrain', kind: 'tip',
    when: (c) => inAttack(c) && c.sel != null && c.terrainTarget,
    tip: () => ({ html: '⛰ Attacking from mountains: +1 to your lowest compared die. 🌲 A House in a forest: +1 to its lowest defense die. Neither counts against neutrals.', pinned: false }),
  },
  {
    id: 'neutral-keep', kind: 'tip',
    when: (c) => inAttack(c) && c.sel != null && c.neutralKeepTarget,
    tip: () => ({ html: 'Neutral Keeps hold 10 behind Walls (+1 on their highest die) and never yield. Bring about 20.', pinned: false }),
  },
  {
    id: 'ambush-defend', kind: 'tip',
    when: (c) => c.reactionMine,
    pinnedWhile: (c) => c.reactionMine,
    tip: () => ({ html: "You're under attack and you hold an ambush card. <b>Play</b> it for extra defenders this battle, <b>Skip</b> it, or <b>Skip until my turn</b> to stop being asked.", pinned: true }),
  },
  {
    id: 'ambush-hit', kind: 'tip',
    when: (c) => c.myTurn && c.ambushHit,
    tip: () => ({ html: 'They sprang an ambush card. Ambushes only last one battle.', pinned: false }),
  },
  {
    id: 'alliances', kind: 'tip',
    when: (c) => c.alliancesOpen,
    tip: () => ({ html: "Alliances are open. Under <b>🤝 War council</b>, Diplomacy sends a quiet invitation. Allies share their Primuses' Passives.", pinned: false, pulse: ['#btnWar'] }),
  },
  {
    id: 'invite', kind: 'tip',
    when: (c) => c.invitesIn > 0,
    pinnedWhile: (c) => c.invitesIn > 0,
    tip: () => ({ html: 'Accepting shares Passives. Attacking an ally later ends the alliance.', pinned: true }),
  },
  {
    id: 'rally', kind: 'tip',
    when: (c) => c.rallyOpen,
    tip: () => ({ html: 'The strongest House is calling a public alliance against it. The first to answer join.', pinned: false }),
  },
  {
    id: 'siege-vote', kind: 'read',
    when: (c) => c.voteOwed && !c.timed,
    alive: (c) => c.voteOwed,
    card: () => ({
      id: 'siege-vote', kind: 'read', step: 'New: Siege on Olympus', title: 'A Siege on Olympus', width: 380, spot: ['#notices .notice:has([data-a=vote])'],
      body: '<span>Win and your whole alliance wins the war.</span><span>Fail within the allied turns and the alliance shatters.</span>',
    }),
  },
  {
    id: 'book', kind: 'tip',
    when: (c) => c.myTurn && c.round >= 3,
    tip: () => ({ html: "<b>📖 The Proctors' Book</b> shows every House's odds to win, turn by turn. It is under <b>🤝 War council</b>. (B)", pinned: false, pulse: ['#btnWar'] }),
  },
  {
    id: 'timer', kind: 'tip',
    when: (c) => c.myTurn && c.timerSecs > 0,
    tip: (c) => ({ html: `This war has a <b>${c!.timerSecs}s</b> turn clock. When it runs out, unplaced armies go to the front and your turn passes.`, pinned: false, pulse: ['#tmr'] }),
  },
  {
    id: 'region', kind: 'tip',
    when: (c) => c.myTurn && c.regionTaken != null,
    tip: (c) => ({ html: `You hold all of <b>${esc(c!.regionTaken?.name ?? '')}</b>: +${c!.regionTaken?.bonus ?? 0} armies every Draft. Hold <b>Alt</b> to see every region on the map.`, pinned: false }),
  },
  // ---- House Ultimates (.008) ----
  {
    id: 'ult-open', kind: 'tip',
    when: (c) => c.ultOpen,
    tip: () => ({ html: 'House Ultimates are open. Houses in the <b>bottom half</b> can spend 3 cards to strike the leader.', pinned: false, pulse: ['#ultBtn'] }),
  },
  {
    id: 'ult-ready', kind: 'read',
    when: (c) => c.myTurn && c.phase === 'draft' && c.ultBtn === 'ready' && c.ult != null && !c.castOpen,
    alive: (c) => c.myTurn && c.phase === 'draft' && c.ultBtn === 'ready' && !c.castOpen,
    card: (c) => ({
      id: 'ult-ready', kind: 'read', step: 'New: House Ultimates', title: 'Your Ultimate is ready', width: 400, spot: ['#ultBtn'],
      body: `<span>You're in the bottom half, so you may cast <b>${esc(c.ult?.name ?? 'your Ultimate')}</b>: ${esc(c.ult?.line ?? '')}.</span><span>It costs <b>3 cards</b> (one from House ${esc(c.ult?.house ?? '')}) instead of a trade, then recharges for 3 turns.</span>`,
    }),
  },
  {
    id: 'ult-short', kind: 'tip',
    when: (c) => c.myTurn && c.phase === 'draft' && c.ultBtn === 'cards' && c.ult != null,
    tip: (c) => ({ html: `You may cast your Ultimate, but it needs <b>3 cards, one from House ${esc(c?.ult?.house ?? '')}</b>. Keep one in hand.`, pinned: false }),
  },
  {
    id: 'ult-target', kind: 'tip',
    when: (c) => c.castOpen,
    pinnedWhile: (c) => c.castOpen,
    tip: () => ({ html: 'Pick one House, or a whole public alliance for a weaker hit on every member. Nothing happens until you <b>Commit</b>.', pinned: true }),
  },
  {
    id: 'ult-hit', kind: 'read',
    when: (c) => c.ultHit != null,
    alive: (c) => c.ultHit != null,
    card: (c) => ({
      id: 'ult-hit', kind: 'read', step: 'New: House Ultimates', title: `${esc(c.ultHit ?? 'An Ultimate')} hit you`, width: 380, spot: ['#general .icons'],
      body: '<span>The icons beside your Primus show what is on you and for how many of your turns.</span><span><b>Click one</b> to read it.</span>',
    }),
  },
  {
    id: 'ult-status', kind: 'tip',
    when: (c) => c.rivalIcon,
    tip: () => ({ html: "Icons under a House's name are lasting effects. The number is the turns left. Every House is in the <b>Houses</b> drawer (H).", pinned: false }),
  },
  {
    id: 'lockout', kind: 'tip',
    when: (c) => c.lockedOut,
    tip: () => ({ html: "You left an alliance, so you can't join another for 2 of your turns.", pinned: false }),
  },
  // ---- tips about the guide itself ----
  {
    id: 'new-007', kind: 'tip', always: true,
    when: () => false, // queued by the Guide on a returning player's first HUD
    tip: () => ({ html: 'New in .007: the Proctor\'s Guide. Press <b>🎓</b> to turn it on.', pinned: false }),
  },
  {
    id: 'fade', kind: 'tip', always: true,
    when: () => false, // queued when the hinted turns run out
    tip: () => ({ html: 'The Proctor steps back. <b>🎓</b> brings the guide back.', pinned: false }),
  },
];

const BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
export const LESSON_IDS = LESSONS.map((l) => l.id);

export function freshRun(): GuideRun {
  return { active: null, ownTurn: null, guided: null, recap: null, replay: [], tips: [], diceAt: -1 };
}

const clone = (st: GuideState): GuideState => JSON.parse(JSON.stringify(st));
const seen = (st: GuideState, id: string) => st.mem.seen.includes(id);
function markSeen(st: GuideState, ...ids: string[]) {
  for (const id of ids) {
    if (!st.mem.seen.includes(id)) st.mem.seen.push(id);
    st.run.replay = st.run.replay.filter((x) => x !== id);
  }
}
function finish(st: GuideState) {
  if (st.run.active) markSeen(st, st.run.active);
  st.run.active = null;
}

/** Put a Tip in the queue with its copy as it is now, and mark it seen. */
function pushTip(st: GuideState, l: Lesson, c?: GuideCtx) {
  if (!l.tip || st.run.tips.some((t) => t.id === l.id)) return;
  st.run.tips.push({ id: l.id, ...l.tip(c), always: !!l.always || st.run.replay.includes(l.id) });
  markSeen(st, l.id);
}

/** Queue one of the guide's own Tips (once ever). */
export function queueTip(st: GuideState, id: string): GuideState {
  const s = clone(st);
  if (!seen(s, id)) pushTip(s, BY_ID.get(id)!);
  return s;
}

/** May this lesson start at the current level? */
function eligible(st: GuideState, l: Lesson) {
  if (st.run.replay.includes(l.id)) return true;
  const lv = st.mem.level;
  if (l.n) return lv === 'full';
  return lv === 'full' || lv === 'hints';
}

/** The things a player does that end a Read step in a timed war. */
const actionKey = (c: GuideCtx) => `${c.phase}|${c.turnKey}|${c.placed}|${c.reinforcements}|${c.sel}|${c.target}|${c.fightsThisTurn}|${c.fortifies}|${c.mustMove?.to ?? ''}`;

function recapCard(t: TurnLog): Card {
  const row = (ok: boolean, ph: string, text: string) => `<div><span class="ck">${ok ? '✓' : '–'}</span><span class="ph">${ph}</span><span>${text}</span></div>`;
  const took = t.taken.length === 0 ? '' : t.taken.length === 1 ? `Took ${esc(t.taken[0])}`
    : t.taken.length <= 3 ? `Took ${t.taken.slice(0, -1).map(esc).join(', ')} and ${esc(t.taken.at(-1)!)}` : `Took ${esc(t.taken[0])}, ${esc(t.taken[1])} and ${t.taken.length - 2} more`;
  const attack = took ? row(true, 'ATTACK', took) : t.fights ? row(true, 'ATTACK', `Fought ${t.fights} battle${t.fights === 1 ? '' : 's'}`) : row(false, 'ATTACK', 'Skipped');
  const fortify = t.moved ? row(true, 'FORTIFY', `Moved ${t.moved.n} troop${t.moved.n === 1 ? '' : 's'} to ${esc(t.moved.to)}`) : row(false, 'FORTIFY', 'Skipped');
  return {
    id: 'recap', kind: 'read', recap: true, step: `Turn ${t.round} complete`, title: "That's a whole turn", width: 520,
    body: `<div class="g-done">${t.placed ? row(true, 'DRAFT', `Placed ${t.placed} armies`) : row(false, 'DRAFT', 'Skipped')}${attack}${fortify}</div>
      <div class="g-quiz"><div class="q">One question to lock it in. You roll a 5, they roll a 5. Who loses an army?</div>
        <div class="opts"><button class="btn sm" data-g="quiz" data-v="you">I do</button><button class="btn sm" data-g="quiz" data-v="them">They do</button></div>
        <div class="fb" data-ok="Right. Ties go to the defender, so attack with the bigger army." data-no="Not quite. Ties go to the defender, which is why bigger armies win."></div></div>
      <span>Next turn the Proctor steps back to <b>hints</b>. New lessons still appear the first time you meet cards, the Standard, alliances and ambushes.</span>`,
    cta: 'Continue the war ▸',
  };
}

function hintFor(c: GuideCtx): Hint | null {
  if (!c.myTurn || c.pending || c.mustMove) return null;
  if (c.phase === 'draft') return c.reinforcements > 0
    ? { text: `Place ${c.reinforcements} armies on your glowing land` }
    : { text: "End Draft ▸ when you're ready", pulse: ['[data-a=endDraft]'] };
  if (c.phase === 'attack') {
    if (c.sel == null) return { text: 'Attack from a glowing territory, or Fortify ▸', pulse: ['[data-a=endAttack]'] };
    if (c.target == null) return { text: 'Pick a target. Green odds are likely wins' };
    return { text: 'Roll or Blitz', pulse: ['[data-a=roll]', '[data-a=blitz]'] };
  }
  if (c.phase === 'fortify') return { text: 'Move troops once, or End Turn ▸', pulse: ['[data-a=endTurn]'] };
  return null;
}

function tipView(st: GuideState): Tip | null {
  const t = st.run.tips[0];
  if (!t || (st.mem.level === 'off' && !t.always)) return null;
  return t;
}

/** Tips fire whenever their moment comes, replays included; pinned ones leave with their UI. */
function tips(c: GuideCtx, st: GuideState) {
  for (const l of LESSONS) if (l.kind === 'tip' && !seen(st, l.id) && eligible(st, l) && l.when(c, st)) pushTip(st, l, c);
  st.run.tips = st.run.tips.filter((t) => { const l = BY_ID.get(t.id); return !l?.pinnedWhile || l.pinnedWhile(c); });
}

/**
 * The guide's whole schedule. Compares the new snapshot with the guide's state (and the previous snapshot) and
 * returns the new state and what to show. Pure: same input, same output.
 */
export function pickStep(c: GuideCtx, prev: GuideCtx | null, st0: GuideState): { st: GuideState; view: GuideView } {
  const st = clone(st0);
  const r = st.run;
  const none: GuideView = { card: null, hint: null, tip: null, blocking: false };
  if (st.mem.level == null) return { st, view: none };
  // Silent moments show nothing; replays show only Tips. Nothing advances meanwhile.
  if (c.silent) return { st, view: none };
  tips(c, st);
  if (c.playing) return { st, view: { ...none, tip: tipView(st) } };

  // A new own turn: hints count down, and fade out after the last hinted turn.
  if (c.myTurn && c.turnKey !== r.ownTurn) {
    r.ownTurn = c.turnKey;
    if (st.mem.level === 'hints') {
      if (st.mem.hintsLeft <= 0) {
        st.mem.level = 'off';
        pushTip(st, BY_ID.get('fade')!);
      } else st.mem.hintsLeft--;
    }
  }

  // The guided turn ended (however it ended): every turn-1 lesson is spent, and the recap is due.
  if (r.guided && c.turnKey !== r.guided.turn) {
    if (r.active && BY_ID.get(r.active)?.n) r.active = null;
    markSeen(st, ...TURN_LESSONS);
    if (st.mem.level === 'full') r.recap = r.guided;
    r.guided = null;
  }

  // The open lesson: did the player do it, or did the moment pass?
  if (r.active) {
    const l = BY_ID.get(r.active)!;
    const gone = l.alive && !l.alive(c, st);
    const did = l.done?.(c, st);
    const actedThrough = l.kind === 'read' && c.timed && prev != null && actionKey(prev) !== actionKey(c);
    if (gone || did || actedThrough) finish(st);
  }

  // Nothing open: start the first lesson whose moment has come.
  if (!r.active && !r.recap) {
    for (const l of LESSONS) {
      if (l.kind === 'tip' || seen(st, l.id) || !eligible(st, l) || !l.when(c, st)) continue;
      if (l.n) {
        // Never chase the player backwards: earlier turn lessons are spent.
        markSeen(st, ...TURN_LESSONS.slice(0, l.n - 1));
        if (c.myTurn && !r.guided) r.guided = { turn: c.turnKey, round: c.round, placed: 0, taken: [], fights: 0, moved: null };
      }
      if (l.id === 'dice') r.diceAt = c.fightsThisTurn;
      r.active = l.id;
      break;
    }
  }

  // Keep the recap's numbers current while the guided turn runs.
  const g = r.guided;
  if (g && c.myTurn && c.turnKey === g.turn) {
    if (c.phase === 'draft') g.placed = c.placed;
    g.taken = c.taken;
    g.fights = c.fightsThisTurn;
    g.moved = c.moved;
  }

  let card: Card | null = null;
  if (r.recap) card = recapCard(r.recap);
  else if (r.active) {
    const l = BY_ID.get(r.active)!;
    if (!l.hide?.(c)) card = l.card!(c, st);
  }
  const hint = !card && st.mem.level === 'hints' ? hintFor(c) : null;
  return { st, view: { card, hint, tip: tipView(st), blocking: card?.kind === 'read' && !c.timed } };
}

/** The player closed the open card: Got it (Read) or Skip (Your move). */
export function dismiss(st0: GuideState, id: string): GuideState {
  const st = clone(st0);
  if (st.run.active === id) finish(st);
  else markSeen(st, id);
  return st;
}

/** The recap's two ways out. */
export function closeRecap(st0: GuideState, keepFull: boolean): GuideState {
  const st = clone(st0);
  st.run.recap = null;
  if (keepFull) {
    // Lessons 2–10 run once more next turn.
    st.mem.seen = st.mem.seen.filter((x) => !TURN_LESSONS.slice(1).includes(x));
    st.mem.level = 'full';
  } else {
    st.mem.level = 'hints';
    st.mem.hintsLeft = 2;
  }
  return st;
}

/** A Tip left the screen (timed out, clicked, ✕, or its UI closed). */
export function closeTip(st0: GuideState, id: string): GuideState {
  const st = clone(st0);
  st.run.tips = st.run.tips.filter((x) => x.id !== id);
  return st;
}

/** The 🎓 menu or ⚙ Settings changed the level. Off clears the screen at once. */
export function setLevel(st0: GuideState, level: Level): GuideState {
  const st = clone(st0);
  st.mem.level = level;
  if (level === 'hints') st.mem.hintsLeft = 2;
  if (level !== 'full') st.run.recap = null;
  // Turn-1 cards belong to Full: leaving it drops the open one (unless it was replayed from the menu).
  const open = st.run.active ? BY_ID.get(st.run.active) : null;
  if (level !== 'full' && open?.n && !st.run.replay.includes(open.id)) st.run.active = null;
  if (level === 'off') { st.run.active = null; st.run.tips = []; st.run.replay = []; st.run.guided = null; }
  return st;
}

/** Re-arm lessons: they fire at their next trigger (right away if it's live), whatever the level. */
export function replay(st0: GuideState, ids: string[]): GuideState {
  const st = clone(st0);
  st.mem.seen = st.mem.seen.filter((x) => !ids.includes(x));
  for (const id of ids) if (!st.run.replay.includes(id)) st.run.replay.push(id);
  if (st.run.active && ids.includes(st.run.active)) st.run.active = null;
  return st;
}

/** Reset all lessons. */
export function resetSeen(st0: GuideState): GuideState {
  const st = clone(st0);
  st.mem.seen = [];
  return st;
}
