import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GROUPS, LESSON_IDS, TURN_LESSONS, closeRecap, closeTip, dismiss, freshRun, pickStep, queueTip, replay, setLevel,
  type GuideCtx, type GuideState, type GuideView, type Level,
} from '../src/ui/lessons.ts';

// A snapshot of an idle board on someone else's turn; each step below overrides what changed.
const base: GuideCtx = {
  timed: false, silent: false, playing: false, phase: 'draft', myTurn: false, turnKey: '1:1', round: 1,
  reinforcements: 0, placed: 0, pending: false, sel: null, target: null, targetIsOlympus: false, targets: 0, sources: 0,
  bestSource: null, odds: null, overwhelm: false, oneDie: false, fightsThisTurn: 0, taken: [], mustMove: null,
  fortifies: 0, moved: null, interior: null, mustTrade: false, breakdown: null, passageOpen: false,
  hand: 0, confirm: false, canRaiseStd: false, canMoveStd: false, primusAsk: false, reactionMine: false, ambushHit: false, alliancesOpen: false,
  invitesIn: 0, rallyOpen: false, voteOwed: false, terrainTarget: false, neutralKeepTarget: false, regionTaken: null, timerSecs: 0,
  ultOpen: false, ultBtn: null, ult: null, castOpen: false, ultHit: null, rivalIcon: false, lockedOut: false,
};
const ctx = (o: Partial<GuideCtx> = {}): GuideCtx => ({ ...base, ...o });
const state = (level: Level | null = 'full', seen: string[] = [], hintsLeft = 0): GuideState => ({ mem: { level, seen, hintsLeft }, run: freshRun() });

/** Feeds snapshots through pickStep like App does after each render. */
class Sim {
  st: GuideState;
  prev: GuideCtx | null = null;
  view: GuideView = { card: null, hint: null, tip: null, blocking: false };
  constructor(st: GuideState) { this.st = st; }
  see(c: GuideCtx) { const r = pickStep(c, this.prev, this.st); this.st = r.st; this.view = r.view; this.prev = c; return r.view; }
  got() { this.st = dismiss(this.st, this.view.card!.id); return this.see(this.prev!); }
  get id() { return this.view.card?.id ?? null; }
}

// My first turn, step by step.
const T = '2:0';
const draft = (o: Partial<GuideCtx> = {}) => ctx({ myTurn: true, turnKey: T, phase: 'draft', reinforcements: 7, ...o });
const attack = (o: Partial<GuideCtx> = {}) => ctx({ myTurn: true, turnKey: T, phase: 'attack', placed: 0, sources: 4, bestSource: { id: 19, name: 'Red Gully', armies: 8 }, ...o });
const fortify = (o: Partial<GuideCtx> = {}) => ctx({ myTurn: true, turnKey: T, phase: 'fortify', interior: { id: 12, name: 'Mars Keep' }, fightsThisTurn: 1, taken: ['Bog of Sorrow'], ...o });

describe('Proctor\'s Guide: pickStep', () => {
  it('stays quiet until a level is chosen', () => {
    const s = new Sim(state(null));
    expect(s.see(draft())).toEqual({ card: null, hint: null, tip: null, blocking: false });
  });

  it('runs the Choose your Primus lesson, then turn 1 in order, then the recap', () => {
    const s = new Sim(state('full'));
    let v = s.see(ctx({ phase: 'passage', passageOpen: true, turnKey: '0:0' }));
    expect(s.id).toBe('choose-primus');
    expect(v.card!.title).toBe('Choose your Primus');
    expect(v.card!.body).toContain('Pick any Character of your House.');
    expect(v.card!.spot).toEqual(['#modal-root .cards-row']);
    expect(v.blocking).toBe(true);
    s.got();
    expect(s.see(ctx({ phase: 'passage', passageOpen: false, turnKey: '0:0' })).card).toBeNull();

    // 1 · the shape of a turn (Read, blocks)
    v = s.see(draft());
    expect(s.id).toBe('turn-shape');
    expect(v.card!.step).toBe('Lesson 1 of 10');
    expect(v.card!.spot).toEqual(['#topbar .phases']);
    expect(v.blocking).toBe(true);
    s.got();
    // 2 · place (Your move, counts up)
    expect(s.id).toBe('place');
    expect(s.view.blocking).toBe(false);
    v = s.see(draft({ reinforcements: 4, placed: 3 }));
    expect(v.card!.prog).toEqual({ n: 3, of: 7, label: 'Placed 3 / 7' });
    expect(v.card!.title).toBe('Place 7 armies');
    // 3 · end the draft
    v = s.see(draft({ reinforcements: 0, placed: 7 }));
    expect(s.id).toBe('end-draft');
    expect(v.card!.title).toBe('All 7 placed');
    expect(v.card!.pulse).toEqual(['[data-a=endDraft]']);
    // 4 · pick a source
    v = s.see(attack());
    expect(s.id).toBe('pick-source');
    expect(v.card!.body).toContain('Red Gully (8)');
    expect(v.card!.focus).toBe(19);
    // 5 · odds (Read)
    v = s.see(attack({ sel: 19, targets: 4 }));
    expect(s.id).toBe('odds');
    expect(v.blocking).toBe(true);
    s.got();
    expect(s.id).toBeNull();
    // 6 · dice (Read) → 7 · roll
    v = s.see(attack({ sel: 19, targets: 4, target: 20, odds: 0.84, oneDie: true }));
    expect(s.id).toBe('dice');
    expect(v.card!.body).toContain('rolls only 1 die');
    s.got();
    expect(s.id).toBe('roll');
    expect(s.view.card!.body).toContain('At <b>84%</b>, Blitz is a safe bet');
    // 8 · march in
    v = s.see(attack({ sel: 19, target: 20, fightsThisTurn: 1, taken: ['Bog of Sorrow'], mustMove: { from: 'Red Gully', to: 'Bog of Sorrow' } }));
    expect(s.id).toBe('march-in');
    expect(v.card!.body).toContain('hold <b>Bog of Sorrow</b>');
    // 9 · attack again, or move on
    v = s.see(attack({ fightsThisTurn: 1, taken: ['Bog of Sorrow'] }));
    expect(s.id).toBe('attack-loop');
    // 10 · fortify, two steps
    v = s.see(fortify());
    expect(s.id).toBe('fortify');
    expect(v.card!.prog!.label).toBe('Step 1 of 2');
    expect(v.card!.focus).toBe(12);
    v = s.see(fortify({ sel: 12 }));
    expect(v.card!.prog!.label).toBe('Step 2 of 2');
    v = s.see(fortify({ fortifies: 1, moved: { n: 5, to: 'Bog of Sorrow' } }));
    expect(s.id).toBeNull();
    // The turn ends: the recap (Read, blocks), with what actually happened.
    v = s.see(ctx({ phase: 'draft', turnKey: '3:1' }));
    expect(s.id).toBe('recap');
    expect(v.blocking).toBe(true);
    expect(v.card!.body).toContain('Placed 7 armies');
    expect(v.card!.body).toContain('Took Bog of Sorrow');
    expect(v.card!.body).toContain('Moved 5 troops to Bog of Sorrow');
    expect(TURN_LESSONS.every((id) => s.st.mem.seen.includes(id))).toBe(true);
    // Continue: hints from now on.
    s.st = closeRecap(s.st, false);
    expect(s.see(ctx({ phase: 'draft', turnKey: '3:1' })).card).toBeNull();
    expect(s.st.mem).toMatchObject({ level: 'hints', hintsLeft: 2 });
  });

  it('turns the dice lesson into the Overwhelm line when the target yields', () => {
    const s = new Sim(state('full', TURN_LESSONS.slice(0, 5)));
    const v = s.see(attack({ sel: 1, target: 2, overwhelm: true, odds: 1 }));
    expect(s.id).toBe('dice');
    expect(v.card!.body).toContain('Overwhelm');
    expect(v.card!.body).not.toContain('Ties go to the defender');
  });

  it('drops a Your-move lesson whose moment passed, and never chases the player backwards', () => {
    const s = new Sim(state('full', ['turn-shape']));
    s.see(draft());
    expect(s.id).toBe('place');
    // Straight to the attack (say a timer placed the rest): place is spent and pick-source takes over.
    s.see(attack());
    expect(s.st.mem.seen).toContain('place');
    expect(s.id).toBe('pick-source');
    // Clicking a rival's land picks source and target at once: odds never had its moment and is skipped.
    s.see(attack({ sel: 3, target: 4, targets: 2, odds: 0.5 }));
    expect(s.id).toBe('dice');
    expect(s.st.mem.seen).toEqual(expect.arrayContaining(['end-draft', 'pick-source', 'odds']));
  });

  it('ending the turn straight from the Draft strands nothing and still recaps', () => {
    const s = new Sim(state('full'));
    s.see(draft()); s.got();
    s.see(draft({ reinforcements: 0, placed: 7 }));
    expect(s.id).toBe('end-draft');
    // The turn passes (the clock ran out): no card is left over, the recap shows the skipped phases.
    const v = s.see(ctx({ phase: 'draft', turnKey: '3:1' }));
    expect(s.id).toBe('recap');
    expect(v.card!.body).toContain('Placed 7 armies');
    expect(v.card!.body.match(/Skipped/g)).toHaveLength(2);
    s.st = closeRecap(s.st, false);
    expect(s.see(ctx({ phase: 'draft', turnKey: '3:1' })).card).toBeNull();
  });

  it('ending the Attack without fighting drops the attack lessons', () => {
    const s = new Sim(state('full', TURN_LESSONS.slice(0, 3)));
    s.see(attack());
    expect(s.id).toBe('pick-source');
    s.see(fortify({ fightsThisTurn: 0, taken: [] }));
    expect(s.id).toBe('fortify');
    expect(s.st.mem.seen).toEqual(expect.arrayContaining(['pick-source', 'odds', 'dice', 'roll', 'march-in', 'attack-loop']));
  });

  it('Skip on a Your-move card moves on', () => {
    const s = new Sim(state('full', ['turn-shape']));
    s.see(draft());
    expect(s.id).toBe('place');
    s.got();
    expect(s.id).toBeNull();
    s.see(draft({ reinforcements: 0, placed: 7 }));
    expect(s.id).toBe('end-draft');
  });

  it('Keep the full guide re-arms lessons 2–10 for one more turn', () => {
    const s = new Sim(state('full'));
    s.see(draft()); s.got();
    s.see(ctx({ turnKey: '3:1' }));
    expect(s.id).toBe('recap');
    s.st = closeRecap(s.st, true);
    expect(s.st.mem.level).toBe('full');
    expect(s.st.mem.seen).toContain('turn-shape');
    expect(s.st.mem.seen).not.toContain('place');
    s.see(draft({ turnKey: '4:0' }));
    expect(s.id).toBe('place');
  });

  it('hints: two hinted turns, then Off with a Tip', () => {
    const s = new Sim(state('hints', TURN_LESSONS, 2));
    // Turn 2
    let v = s.see(draft({ turnKey: '4:0', reinforcements: 8 }));
    expect(v.card).toBeNull();
    expect(v.hint).toEqual({ text: 'Place 8 armies on your glowing land' });
    expect(s.st.mem.hintsLeft).toBe(1);
    v = s.see(draft({ turnKey: '4:0', reinforcements: 0, placed: 8 }));
    expect(v.hint!.text).toBe("End Draft ▸ when you're ready");
    expect(v.hint!.pulse).toEqual(['[data-a=endDraft]']);
    v = s.see(attack({ turnKey: '4:0' }));
    expect(v.hint!.text).toBe('Attack from a glowing territory, or Fortify ▸');
    v = s.see(attack({ turnKey: '4:0', sel: 1, targets: 3 }));
    expect(v.hint!.text).toBe('Pick a target. Green odds are likely wins');
    v = s.see(attack({ turnKey: '4:0', sel: 1, target: 2 }));
    expect(v.hint!.text).toBe('Roll or Blitz');
    v = s.see(fortify({ turnKey: '4:0' }));
    expect(v.hint!.text).toBe('Move troops once, or End Turn ▸');
    // Not my turn: no hint.
    expect(s.see(ctx({ turnKey: '5:1' })).hint).toBeNull();
    // Turn 3: still hinted.
    v = s.see(draft({ turnKey: '6:0' }));
    expect(v.hint).not.toBeNull();
    expect(s.st.mem.hintsLeft).toBe(0);
    // Turn 4: the guide steps back.
    v = s.see(draft({ turnKey: '8:0' }));
    expect(v.hint).toBeNull();
    expect(s.st.mem.level).toBe('off');
    expect(v.tip!.id).toBe('fade');
    expect(v.tip!.html).toContain('The Proctor steps back');
    s.st = closeTip(s.st, 'fade');
    expect(s.see(draft({ turnKey: '8:0' })).tip).toBeNull();
  });

  it('hints mode never shows the turn-1 cards', () => {
    const s = new Sim(state('hints', [], 2));
    const v = s.see(draft());
    expect(v.card).toBeNull();
    expect(v.hint).not.toBeNull();
  });

  it('Off shows nothing; Replay still fires a lesson', () => {
    const s = new Sim(state('off', TURN_LESSONS));
    expect(s.see(attack({ sel: 1, targets: 3 })).card).toBeNull();
    s.st = replay(s.st, ['odds', 'dice']);
    const v = s.see(attack({ sel: 1, targets: 3 }));
    expect(s.id).toBe('odds');
    expect(v.blocking).toBe(true);
    s.got();
    expect(s.st.mem.seen).toContain('odds');
  });

  it('switching Full to Hints mid-turn swaps the lesson card for the hint pill', () => {
    const s = new Sim(state('full', ['turn-shape']));
    s.see(draft());
    expect(s.id).toBe('place');
    s.st = setLevel(s.st, 'hints');
    const v = s.see(draft());
    expect(v.card).toBeNull();
    expect(v.hint!.text).toBe('Place 7 armies on your glowing land');
    expect(s.st.mem.hintsLeft).toBe(2);
  });

  it('setting the level to Off clears the card at once', () => {
    const s = new Sim(state('full'));
    s.see(draft());
    expect(s.id).toBe('turn-shape');
    s.st = setLevel(s.st, 'off');
    expect(s.see(draft()).card).toBeNull();
  });

  it('a timed war never blocks: Read steps dock, and any game action dismisses them', () => {
    const s = new Sim(state('full'));
    let v = s.see(draft({ timed: true }));
    expect(s.id).toBe('turn-shape');
    expect(v.card!.kind).toBe('read');
    expect(v.blocking).toBe(false);
    // The player places an army without pressing Got it: the Read is spent.
    v = s.see(draft({ timed: true, reinforcements: 6, placed: 1 }));
    expect(s.st.mem.seen).toContain('turn-shape');
    expect(s.id).toBe('place');
    // The recap doesn't block either.
    v = s.see(ctx({ timed: true, turnKey: '3:1' }));
    expect(s.id).toBe('recap');
    expect(v.blocking).toBe(false);
  });

  it('silent states show nothing and advance nothing', () => {
    const s = new Sim(state('full'));
    const v = s.see(draft({ silent: true }));
    expect(v).toEqual({ card: null, hint: null, tip: null, blocking: false });
    expect(s.st.mem.seen).toEqual([]);
    expect(s.st.run.ownTurn).toBeNull();
    // An open Read hides while silent (and stops blocking), then comes back.
    s.see(draft());
    expect(s.id).toBe('turn-shape');
    expect(s.see(draft({ silent: true })).blocking).toBe(false);
    expect(s.see(draft()).card!.id).toBe('turn-shape');
  });

  it('replays show Tips only', () => {
    let st = state('off');
    st = queueTip(st, 'new-007');
    const s = new Sim(st);
    const v = s.see(ctx({ playing: true }));
    expect(v.card).toBeNull();
    expect(v.tip!.id).toBe('new-007');
    expect(v.tip!.html).toContain('New in .007');
    // Queued once only.
    s.st = closeTip(s.st, 'new-007');
    s.st = queueTip(s.st, 'new-007');
    expect(s.st.run.tips).toEqual([]);
  });

  it('a card waiting for a target hides the place lesson without dropping it', () => {
    const s = new Sim(state('full', ['turn-shape']));
    s.see(draft());
    expect(s.id).toBe('place');
    expect(s.see(draft({ pending: true })).card).toBeNull();
    expect(s.see(draft()).card!.id).toBe('place');
  });

  it('the Why fold adds up the reinforcements', () => {
    const s = new Sim(state('full', ['turn-shape']));
    const v = s.see(draft({ breakdown: { territories: 5, base: 3, regions: [{ name: 'Mars Heart', bonus: 2 }], keeps: 1, keepBonus: 2, general: 0, total: 7 } }));
    expect(v.card!.body).toContain('Why 7?');
    expect(v.card!.body).toContain('5 territories ÷ 3 (at least 3)');
    expect(v.card!.body).toContain('You hold the Mars Heart region');
    expect(v.card!.body).toContain('You hold your Keep');
  });

  it('roll copy follows the odds band', () => {
    for (const [p, say] of [[0.5, 'this is a gamble'], [0.2, "you'll probably lose this"]] as const) {
      const s = new Sim(state('full', TURN_LESSONS.slice(0, 6)));
      s.st.run.diceAt = 0;
      const v = s.see(attack({ sel: 1, target: 2, odds: p }));
      expect(s.id).toBe('roll');
      expect(v.card!.body).toContain(say);
    }
  });

  it('escapes names from the game', () => {
    const s = new Sim(state('full', TURN_LESSONS.slice(0, 3)));
    const v = s.see(attack({ bestSource: { id: 1, name: '<b>x</b>', armies: 3 } }));
    expect(v.card!.body).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('Proctor\'s Guide: just-in-time lessons', () => {
  // Turn 1 is behind us: the guide is in Hints, where mechanic lessons still fire at full size.
  const later = (o: Partial<GuideCtx> = {}) => ctx({ myTurn: true, turnKey: '6:0', round: 2, phase: 'draft', reinforcements: 0, placed: 5, ...o });
  const hinted = () => state('hints', TURN_LESSONS, 2);

  // Each Tip, the snapshot that triggers it, and a phrase of its copy.
  const TIPS: [string, Partial<GuideCtx>, string][] = [
    ['watching', { myTurn: false, playing: true }, 'replay one at a time'],
    ['card-preview', { confirm: true }, '<b>Commit</b> to play it'],
    ['standard-move', { phase: 'fortify', canMoveStd: true }, 'Your Standard can move once per turn too'],
    ['terrain', { phase: 'attack', sel: 1, targets: 2, terrainTarget: true }, 'Attacking from mountains'],
    ['neutral-keep', { phase: 'attack', sel: 1, targets: 2, neutralKeepTarget: true }, 'Neutral Keeps hold 10'],
    ['ambush-hit', { phase: 'attack', ambushHit: true }, 'They sprang an ambush card'],
    ['alliances', { alliancesOpen: true }, 'Alliances are open'],
    ['rally', { myTurn: false, rallyOpen: true }, 'calling a public alliance'],
    ['book', { round: 3 }, "The Proctors' Book"],
    ['timer', { timerSecs: 90, timed: true }, '<b>90s</b> turn clock'],
    ['region', { regionTaken: { name: 'Mars Heart', bonus: 2 } }, 'You hold all of <b>Mars Heart</b>: +2 armies'],
    ['ult-open', { myTurn: false, ultOpen: true }, 'Houses in the <b>bottom half</b> can spend 3 cards to strike the leader'],
    ['ult-short', { ultBtn: 'cards', ult: { name: 'Stormfall', line: 'a storm', house: 'Jupiter' } }, 'it needs <b>3 cards, one from House Jupiter</b>'],
    ['ult-status', { myTurn: false, rivalIcon: true }, 'The number is the turns left'],
    ['lockout', { myTurn: false, lockedOut: true }, "you can't join another for 2 of your turns"],
  ];

  for (const [id, o, phrase] of TIPS) {
    it(`Tip ${id} fires once`, () => {
      const s = new Sim(hinted());
      const v = s.see(later(o));
      expect(v.tip?.id).toBe(id);
      expect(v.tip!.html).toContain(phrase);
      expect(v.tip!.pinned).toBe(false);
      expect(v.card).toBeNull();
      expect(s.st.mem.seen).toContain(id);
      s.st = closeTip(s.st, id);
      expect(s.see(later(o)).tip).toBeNull();
    });
  }

  it('Tip copy is fixed when it fires', () => {
    const s = new Sim(hinted());
    s.see(later({ regionTaken: { name: 'Mars Heart', bonus: 2 } }));
    expect(s.see(ctx({ turnKey: '7:1' })).tip!.html).toContain('Mars Heart');
  });

  it('the alliances and Book Tips pulse 🤝 War council (where they live now) and the timer Tip pulses the clock', () => {
    expect(new Sim(hinted()).see(later({ alliancesOpen: true })).tip!.pulse).toEqual(['#btnWar']);
    expect(new Sim(hinted()).see(later({ round: 3 })).tip!.pulse).toEqual(['#btnWar']);
    expect(new Sim(hinted()).see(later({ timerSecs: 60 })).tip!.pulse).toEqual(['#tmr']);
  });

  it('pinned Tips stay while their UI is open, then leave on their own', () => {
    for (const [id, on] of [['ambush-defend', { myTurn: false, reactionMine: true }], ['invite', { myTurn: false, invitesIn: 1 }]] as const) {
      const s = new Sim(hinted());
      let v = s.see(later(on));
      expect(v.tip!.id).toBe(id);
      expect(v.tip!.pinned).toBe(true);
      v = s.see(later(on));
      expect(v.tip!.id).toBe(id);
      v = s.see(later({ myTurn: false }));
      expect(v.tip).toBeNull();
      expect(s.st.run.tips).toEqual([]);
      expect(s.see(later(on)).tip).toBeNull();
    }
  });

  const MARS = { name: "Where's Sevro?", line: 'seize 3 territories, and half their armies join you', house: 'Mars' };

  it('ult-open pulses the Ultimate button', () => {
    expect(new Sim(hinted()).see(later({ ultOpen: true })).tip!.pulse).toEqual(['#ultBtn']);
  });

  it('ult-ready: a Read on the Ultimate button that names the Ultimate, what it does and its cost, once', () => {
    const s = new Sim(state('hints', [...TURN_LESSONS, 'ult-open'], 2));
    const on = { ultOpen: true, ultBtn: 'ready' as const, ult: MARS, reinforcements: 7, placed: 0 };
    const v = s.see(later(on));
    expect(s.id).toBe('ult-ready');
    expect(v.card!.step).toBe('New: House Ultimates');
    expect(v.card!.title).toBe('Your Ultimate is ready');
    expect(v.card!.spot).toEqual(['#ultBtn']);
    expect(v.card!.body).toContain("you may cast <b>Where&#39;s Sevro?</b>: seize 3 territories, and half their armies join you.");
    expect(v.card!.body).toContain('It costs <b>3 cards</b> (one from House Mars) instead of a trade, then recharges for 3 turns.');
    expect(v.blocking).toBe(true);
    s.got();
    expect(s.see(later(on)).card).toBeNull();
    expect(s.st.mem.seen).toContain('ult-ready');
    // Not for a House that is short of cards, in the top half, or looking at someone else's turn.
    for (const off of [{ ultBtn: 'cards' as const }, { ultBtn: null }, { myTurn: false }, { phase: 'attack' }]) {
      expect(new Sim(state('hints', [...TURN_LESSONS, 'ult-open', 'ult-short'], 2)).see(later({ ...on, ...off })).card).toBeNull();
    }
  });

  it('ult-ready never blocks a timed war, and opening the cast flow puts it away', () => {
    const on = { ultOpen: true, ultBtn: 'ready' as const, ult: MARS, reinforcements: 7, placed: 0 };
    const t = new Sim(state('hints', [...TURN_LESSONS, 'ult-open'], 2));
    let v = t.see(later({ ...on, timed: true, timerSecs: 90 }));
    expect(t.id).toBe('ult-ready');
    expect(v.blocking).toBe(false);
    // The player acts through it (places an army): it is gone.
    v = t.see(later({ ...on, timed: true, timerSecs: 90, reinforcements: 6, placed: 1 }));
    expect(v.card).toBeNull();
    const s = new Sim(state('hints', [...TURN_LESSONS, 'ult-open'], 2));
    s.see(later(on));
    v = s.see(later({ ...on, castOpen: true }));
    expect(v.card).toBeNull();
    expect(s.st.mem.seen).toContain('ult-ready');
    // The cast flow has its own pinned Tip, which leaves with the flow.
    expect(v.tip!.id).toBe('ult-target');
    expect(v.tip!.pinned).toBe(true);
    expect(v.tip!.html).toContain('Nothing happens until you <b>Commit</b>');
    expect(s.see(later({ ...on, castOpen: true })).tip!.id).toBe('ult-target');
    expect(s.see(later(on)).tip).toBeNull();
  });

  it('ult-hit: a Read on my own icons that names the Ultimate, dropped when the effect ends', () => {
    const s = new Sim(state('hints', [...TURN_LESSONS, 'ult-open', 'ult-status'], 2));
    const v = s.see(later({ myTurn: false, ultOpen: true, ultHit: 'Stormfall', rivalIcon: true }));
    expect(s.id).toBe('ult-hit');
    expect(v.card!.title).toBe('Stormfall hit you');
    expect(v.card!.spot).toEqual(['#general .icons']);
    expect(v.card!.body).toContain('for how many of your turns');
    expect(v.blocking).toBe(true);
    s.see(later({ myTurn: false, ultOpen: true }));
    expect(s.id).toBeNull();
    expect(s.st.mem.seen).toContain('ult-hit');
    // It waits for the announcement (a silent moment) to close.
    const w = new Sim(state('hints', [...TURN_LESSONS, 'ult-open', 'ult-status'], 2));
    expect(w.see(later({ myTurn: false, silent: true, ultHit: 'Rot' })).card).toBeNull();
    expect(w.see(later({ myTurn: false, ultHit: 'Rot' })).card!.title).toBe('Rot hit you');
  });

  it('the 🎓 menu groups: Your Primus, and House Ultimates with its seven lessons; every id is a lesson', () => {
    expect(GROUPS.find((g) => g.name === 'Your Primus')!.ids).toEqual(['choose-primus']);
    expect(GROUPS.find((g) => g.name === 'House Ultimates')!.ids).toEqual(['ult-open', 'ult-ready', 'ult-short', 'ult-target', 'ult-hit', 'ult-status', 'lockout']);
    expect(GROUPS.some((g) => g.name === 'Your General')).toBe(false);
    for (const g of GROUPS) for (const id of g.ids) expect(LESSON_IDS).toContain(id);
    expect(LESSON_IDS).not.toContain('passage');
    // Replayed from the menu, an Ultimate lesson fires again at its next trigger, even with the guide Off.
    const s = new Sim(state('off', [...TURN_LESSONS, ...GROUPS.flatMap((g) => g.ids)]));
    const on = { ultOpen: true, ultBtn: 'ready' as const, ult: MARS, reinforcements: 7, placed: 0 };
    expect(s.see(later(on)).card).toBeNull();
    s.st = replay(s.st, GROUPS.find((g) => g.name === 'House Ultimates')!.ids);
    const v = s.see(later(on));
    expect(s.id).toBe('ult-ready');
    expect(v.tip!.id).toBe('ult-open');
  });

  it('no lesson still speaks of a General or the Passage', () => {
    const src = readFileSync(new URL('../src/ui/lessons.ts', import.meta.url), 'utf8');
    expect(src.match(/\bGenerals?\b|\bPassage\b/g)).toBeNull();
  });

  it('cards: a Read on the hand, once', () => {
    const s = new Sim(hinted());
    const v = s.see(later({ hand: 1 }));
    expect(s.id).toBe('cards');
    expect(v.card!.step).toBe('New: cards');
    expect(v.card!.spot).toEqual(['#hand']);
    expect(v.blocking).toBe(true);
    expect(v.hint).toBeNull();
    s.got();
    expect(s.see(later({ hand: 2 })).card).toBeNull();
    expect(s.view.hint).not.toBeNull();
  });

  it('must-trade: a Your-move card that ends when the trade happens', () => {
    const s = new Sim(state('hints', [...TURN_LESSONS, 'cards'], 2));
    let v = s.see(later({ hand: 5, mustTrade: true }));
    expect(s.id).toBe('must-trade');
    expect(v.card!.kind).toBe('do');
    expect(v.card!.pulse).toEqual(['#hand']);
    v = s.see(later({ hand: 2, mustTrade: false, reinforcements: 10 }));
    expect(s.id).toBeNull();
    expect(s.st.mem.seen).toContain('must-trade');
  });

  it('standard: a Read on the Standard button once a target is picked', () => {
    const s = new Sim(hinted());
    const v = s.see(later({ phase: 'attack', sel: 1, target: 2, canRaiseStd: true, odds: 0.6 }));
    expect(s.id).toBe('standard');
    expect(v.card!.spot).toContain('#actionbar [data-a=std]');
    expect(v.blocking).toBe(true);
    s.got();
    expect(s.see(later({ phase: 'attack', sel: 1, target: 3, canRaiseStd: true })).card).toBeNull();
  });

  it('primus: a Read on the Keep prompt, dropped if the prompt closes', () => {
    const s = new Sim(hinted());
    s.see(later({ phase: 'attack', primusAsk: true }));
    expect(s.id).toBe('primus');
    expect(s.view.card!.spot).toEqual(['#modal-root .cards-row']);
    s.see(later({ phase: 'attack' }));
    expect(s.id).toBeNull();
    expect(s.st.mem.seen).toContain('primus');
  });

  it('siege-vote: a Read on the vote notice, never in a timed war', () => {
    const t = new Sim(hinted());
    expect(t.see(later({ myTurn: false, voteOwed: true, timed: true })).card).toBeNull();
    expect(t.st.mem.seen).not.toContain('siege-vote');
    const s = new Sim(hinted());
    const v = s.see(later({ myTurn: false, voteOwed: true }));
    expect(s.id).toBe('siege-vote');
    expect(v.blocking).toBe(true);
  });

  it('mechanic lessons wait while a turn-1 lesson is open', () => {
    const s = new Sim(state('full', ['turn-shape']));
    s.see(draft({ hand: 1 }));
    expect(s.id).toBe('place');
    s.see(draft({ hand: 1, reinforcements: 0, placed: 7 }));
    expect(s.id).toBe('end-draft');
    s.got();
    expect(s.see(draft({ hand: 1, reinforcements: 0, placed: 7 })).card!.id).toBe('cards');
  });

  it('nothing fires at Off, but a replayed group does', () => {
    const s = new Sim(state('off', TURN_LESSONS));
    expect(s.see(later({ hand: 1, confirm: true })).card).toBeNull();
    expect(s.view.tip).toBeNull();
    expect(s.st.mem.seen).not.toContain('cards');
    s.st = replay(s.st, ['cards', 'must-trade', 'card-preview']);
    const v = s.see(later({ hand: 1, confirm: true }));
    expect(s.id).toBe('cards');
    expect(v.tip!.id).toBe('card-preview');
  });

  it('replay re-arms a seen lesson', () => {
    const s = new Sim(state('hints', [...TURN_LESSONS, 'terrain'], 2));
    expect(s.see(later({ phase: 'attack', sel: 1, terrainTarget: true })).tip).toBeNull();
    s.st = replay(s.st, ['terrain', 'neutral-keep']);
    expect(s.see(later({ phase: 'attack', sel: 1, terrainTarget: true })).tip!.id).toBe('terrain');
  });
});
