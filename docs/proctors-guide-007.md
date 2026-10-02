# The Proctor's Guide (.007)

The build spec for the first-time-player tutorial in version .007.

- **Mockup (approved):** https://claude.ai/artifact/7rXF5rYLBcVd3b7UN1NazH, with a local copy at [`docs/proctors-guide-mockup.html`](proctors-guide-mockup.html). Open it in a browser and use the left rail to step through 16 screens. The copy, colours and layout in the mockup are the target.
- **Scope:** UI only (`src/ui/`, `src/style.css`, `tests/`). **No changes to `src/engine/`**, so no `sync:fn` and no edge function redeploy.
- **Workstreams and kick-off prompts:** at the bottom of this file.

---

## 1. Goal

A new player should finish their first turn knowing the three phases, how to read the odds, how dice resolve, and where to click. They should never have to wonder whether the game is waiting on them. Players who already know the game should never be slowed down.

The guide is **on by default for new players** and can be **turned off or back on at any time**.

## 2. Decisions (locked)

| Question | Decision |
|---|---|
| Timed wars (`v.opts.timer > 0`, local or online) | Read steps **never block** in a timed war. They render docked like a Your-move card, with no dim, no input blocker and no pause. "Got it" still dismisses them, and so does any game action. |
| Where the first war happens | In **any** war. Also add a **Practice war** button for new players (local, 1 human vs 1 AI, smallest valley, no timer). No scripted map. |
| Who counts as new | This browser has no `ic-tutor`, no `ic-name`, no `ic-last-code` and `allCreds()` is empty. Anyone else gets `ic-tutor = off` plus one Tip pointing at 🎓. |
| How fast help fades | 1 full guided turn, then 2 turns of hints, then off (with a Tip saying so). Just-in-time mechanic lessons keep firing once each until the guide is Off. |

## 3. Step types (the core contract)

Every step is exactly one of these. Never mix them, and never invent a fifth.

| | **Read** | **Your move** | **Tip** | **Hint** (hints mode only) |
|---|---|---|---|---|
| Colour | Gold border, gold `◼ READ` badge | Red border, red `▶ YOUR MOVE` badge | Thin `--line-hi` border, outlined `TIP` badge | Red pill with a `▶` badge |
| Does the game wait? | **Yes.** Dims everything except the spotlight; input is blocked (except 🎓). Not in timed wars, see §2. | The **guide** waits. The game is fully usable. | Nobody waits. | Nobody waits. |
| Footer line | `⏸ The war waits for you` | `● <what to do>` with a live dot, plus `Skip` | `No action needed` | none |
| Ends when | **Got it** button, Enter or Space | The player does the thing (state-driven, see §6), or Skip | 6 s, any click, or ✕. A *pinned* Tip lasts until its UI closes. | The state moves on |
| Position | Next to its spotlight: below if there's room, else above, clamped to the viewport | **Always docked bottom-right**, just above the dock | Centered under the top bar | Centered just above the action bar |
| Progress | `Lesson n of 10` | `Lesson n of 10` and a progress bar when countable (`Placed 3 / 7`) | none | none |

Rules for all of them:
- **One idea per card, two sentences at most.** Extra detail goes behind a `<details>` fold (for example "Why 7?").
- **Point at the thing.** A Read step spotlights the real HUD element. A Your-move step pulses the real control (`.pulse`) and relies on the existing map glow (`renderHighlights`) for territories.
- **Accessibility:** a Read card is `role="dialog"` and takes focus on its Got it button. A Your-move card is `role="status" aria-live="polite"`. Every animation turns off under `prefers-reduced-motion`.
- **🎓 is never dimmed or blocked**, so a player can always turn the guide off.

## 4. Levels, storage and lifecycle

Use the existing `store` helper in `app.ts` (localStorage wrapped in try/catch). These are per-device settings, the same as `ic-follow` and `ic-speed`.

| Key | Values | Meaning |
|---|---|---|
| `ic-tutor` | `full` · `hints` · `off` (absent = undecided) | Guide level |
| `ic-tutor-seen` | JSON array of lesson ids | Lessons already completed or skipped |
| `ic-tutor-hints` | integer | Hinted own-turns left before the guide turns itself off |

Lifecycle:
1. **First launch.** On the first click of *Create Online War*, *Join*, *Local* or *Practice war* while `ic-tutor` is absent and the player counts as new, show the **chooser** (mockup screen 00): Guide me (recommended, gold) / Hints only / No guide. Save the choice, then continue the original action.
2. **Returning players** (absent `ic-tutor`, not new): silently set `off`. On the first HUD mount, show one Tip: *"New in .007: the Proctor's Guide. Press 🎓 to turn it on."* Mark it seen.
3. **Full.** The Passage lesson and turn-1 lessons 1–10 run, then the recap. After the recap, the level becomes `hints` with `ic-tutor-hints = 2`, unless the player picks *Keep the full guide*, which re-arms lessons 2–10 for one more turn.
4. **Hints.** Each own turn shows Hint pills (§5.3) and still fires unseen just-in-time lessons at full size. At the start of each own turn, decrement `ic-tutor-hints`. At 0, set `off` and show the Tip *"The Proctor steps back. 🎓 brings the guide back."*
5. **Off.** Nothing shows. Lessons can still be replayed from the 🎓 menu.

When the guide stays silent:
- During a hot-seat handoff (`session.handoff != null`), the Sorting wheel (`wheelOpen`), a showcase (`showcaseOpen`), the ambush, siege or fallen-House overlays, or while spectating a fallen House.
- During replays of other players' moves (`this.playing`). **Tips are the exception**, for example the *watching* Tip.
- **Hot-seat:** the setting belongs to the device, so the guided turn is the first human turn on it. That's acceptable and needs no per-seat tracking.

**The replay queue waits for Read steps.** `playQueue` must not advance while a blocking Read card is open, the same way it waits on showcases. Add the guide to `session.hold` so local AIs wait too. Online, other players' frames queue up behind the card and play when it closes.

## 5. Lesson catalog

`Ctx` is the snapshot described in §6. `me` = `this.me`, `v` = the live view.

### 5.1 Before turn 1

| id | Type | Fires when | Ends when | Spotlight / pulse | Copy |
|---|---|---|---|---|---|
| `passage` | Read | The Passage modal is open for me (`v.phase === 'passage' && v.me?.passage`) | Got it | The two cards in the Passage modal (`.cards-row`) | **Choose your General.** Keep one Character: their **Passive** works for you all war. The other dies here. ★ A card from your own House gets +1. |

> `passage` is **not in the mockup.** It was added because the Passage is the first decision a new player makes. It uses the same Read layout as lesson 1.

### 5.2 Turn 1, full guide (mockup screens 01–11)

| # | id | Type | Fires when | Ends when | Spotlight / pulse | Copy (title / body) |
|---|---|---|---|---|---|---|
| 1 | `turn-shape` | Read | First own turn, `draft`, nothing placed | Got it | `.topbar .phases` | **A turn has three phases** / They always run in this order. The bar at the top shows where you are. Then the 3-row list: DRAFT *Place new armies. Every turn* · ATTACK *Fight your neighbours, as often as you like. Optional* · FORTIFY *Move troops once. Optional*. Button: **Start the Draft ▸** |
| 2 | `place` | Your move | `draft`, `reinforcements > 0`, no card pending | `reinforcements === 0` or phase changes | Map glow (existing) | **Place {N} armies** / Click one of your glowing territories to add an army. Stack them where you plan to attack. Progress: `Placed {placed} / {N}`. Fold **Why {N}?** built from `reinforcementBreakdown()`: territories ÷ 3 (at least 3), one row per region bonus, Keeps, General. Footer: *Shift-click takes one back.* |
| 3 | `end-draft` | Your move | `draft`, `reinforcements === 0`, not `mustTrade` | phase becomes `attack` | pulse `[data-a=endDraft]` | **All {N} placed** / Press **End Draft ▸** to start fighting. Changed your mind? **Undo** takes them all back first. |
| 4 | `pick-source` | Your move | `attack`, `sel == null`, `attackSources().length > 0` | `sel != null` or phase changes | Map glow (existing). Name the best source in the copy and `world.focus()` it if `prefs.follow` | **Pick where to attack from** / Glowing territories can attack: they hold **2+ armies** and touch an enemy. One army always stays behind. *Try {best} ({armies}).* The best source is the one whose best target has the highest `winChance`. |
| 5 | `odds` | Read | `attack`, `sel != null`, `target == null`, at least 1 target chip | Got it | `#actionbar .chips` | **Every target shows your odds** / It's your chance to take it if you Blitz. Read the colour; the math is done for you. Key: `65%+` Likely · `35–64%` Coin flip · `under 35%` Long shot · `🏳 Overwhelm` Twice their number: neutrals give up, no dice. (Bands = `oddsClass()`.) |
| 6 | `dice` | Read | `attack`, `target != null`, not Olympus | Got it ("Let me fight ▸") | Union of the dice `.seg`, `[data-a=roll]` and `[data-a=blitz]` | **How a fight works** / You roll up to **3 dice**, they roll up to **2**. Highest against highest, then the next pair. **Ties go to the defender.** Fixed worked example: 6·4·2 vs 5·4 → *6 beats 5: they lose 1* / *Tie: you lose 1* / *No pair, no effect*. Then **Roll**: one throw, then you decide again. **Blitz**: keeps rolling until you win or 1 army is left. If `defenseNote === '1 die'`, add: *This garrison is neutral and alone, so it rolls only 1 die.* If Overwhelm, swap the body for the Overwhelm line. |
| 7 | `roll` | Your move | Straight after `dice` closes | A battle event of mine resolves, or `target` clears | pulse `[data-a=roll]`, `[data-a=blitz]` | **Roll or Blitz** / At **{p}%**, {Blitz is a safe bet / this is a gamble / you'll probably lose this}. Roll if you want to be able to stop partway. |
| 8 | `march-in` | Your move | `v.ts.mustMove` (the existing "X is yours" modal is open) | `mustMove` clears | pulse `[data-a=move]` (inside `#modal-root`) | **Move in** / Armies you march in hold **{to}**. The rest stay in {from}. Put more on the side that faces enemies. |
| 9 | `attack-loop` | Your move | Back at `attack`, `sel == null`, after at least one fight this turn | New `sel`, or phase changes | pulse `[data-a=endAttack]` + map glow | **Attack again, or move on** / There's no limit on attacks. When you're done, press **Fortify ▸**. Footer: *Attack again, or press Fortify*. |
| 10 | `fortify` | Your move | `fortify`, first time | A fortify move lands, or the turn ends | Step 1: `world.focus()` the interior territory with most armies. Step 2: map glow (existing) | **Move troops once** / Pick troops, then where they go. They march through any land you hold, so pull them out of safe spots like **{interior}**. Progress: `Step 1 of 2` → `Step 2 of 2`. |
| — | `recap` | Read | My guided turn just ended (`v.cur !== me` after a turn with lesson 10 seen) | Continue / Keep full guide | Full-screen dim, centered card | **That's a whole turn** / ✓ rows for what they actually did (armies placed, territories taken, troops moved; a phase skipped shows *Skipped*). Quiz: *You roll a 5, they roll a 5. Who loses an army?* **I do** / **They do**. Right: *Right. Ties go to the defender, so attack with the bigger stack.* Wrong: *Not quite. Ties go to the defender, which is why bigger stacks win.* Then: *Next turn the Proctor steps back to hints. New lessons still appear the first time you meet cards, the Standard, alliances and ambushes.* Buttons: **Keep the full guide** (quiet link) · **Continue the war ▸** (gold). |

If the player goes off-script (ends a phase early, ends the turn), any Your-move lesson whose context disappears is **marked seen and dropped**. Never chase the player backwards.

### 5.3 Hints mode (mockup screen 12)

One Hint pill at a time, centered above the action bar, plus the same `.pulse` as the full lesson. No card.

| State | Hint |
|---|---|
| `draft`, `reinforcements > 0` | ▶ Place {n} armies on your glowing land |
| `draft`, `reinforcements === 0` | ▶ End Draft ▸ when you're ready |
| `attack`, no `sel` | ▶ Attack from a glowing territory, or Fortify ▸ |
| `attack`, `sel`, no `target` | ▶ Pick a target. Green odds are likely wins |
| `attack`, `target` | ▶ Roll or Blitz |
| `fortify` | ▶ Move troops once, or End Turn ▸ |

### 5.4 Just-in-time mechanic lessons (mockup screens 13–14)

Each fires **once**, the first time its UI appears, in Full or Hints mode. All copy follows the two-sentence rule.

| id | Type | Fires when | Ends when | Spotlight | Copy |
|---|---|---|---|---|---|
| `watching` | Tip | First replay of another player's moves (`this.playing`, frame seat ≠ me) | 6 s | none | Rivals' moves replay one at a time. Speed them up with **2×** and **4×**, or jump to now with **Skip ▸▸**. |
| `cards` | Read | Own turn, hand non-empty for the first time | Got it | `#hand` | **You earned a card** / A card does one of two things. **Play it** for its Active ability (glowing cards can be played now), or **Trade 3** for 10 armies during your Draft. *Hover a card to see which territories it would hit.* |
| `must-trade` | Your move | `draft` and `mustTrade(v, me)` | The trade happens | pulse `#hand` | **Your hand is full** / Pick 3 cards and **Trade 3 → 10 armies** before you march. |
| `card-preview` | Tip | `ui.confirm` set for the first time | 6 s | none | This is a preview of the outcome. **Commit** to play it, or **Back** to change your mind. |
| `standard` | Read | Attack target picked and the **Raise the Standard** button is available | Got it | `[data-a=std]` and the Commit slider | **Raise the Standard** / Once per turn: +3 phantom soldiers and your General's war cry, with no retreat. **Win** and the defenders join you. **Lose** and your whole House goes to them. |
| `standard-move` | Tip | First own `fortify` with `⚑ Move Standard` available | 6 s | none | Your Standard can move once per turn too. If a rival takes the territory it stands on, your House is theirs. |
| `primus` | Read | The "A Keep without a master" modal opens for the first time | Got it | the modal's `.cards-row` | **Swear in a Primus** / A Character from this Keep's House guards it, and its Passive stacks with your General's. Lose the Keep and the Primus dies with it. |
| `terrain` | Tip | First target chip with ⛰ or 🌲 modifiers (`terrainMods`) | 6 s | none | ⛰ Attacking from mountains: +1 to your lowest compared die. 🌲 A House in a forest: +1 to its lowest defense die. Neither counts against neutrals. |
| `neutral-keep` | Tip | First target that is a neutral House's Keep (`defenseNote === 'neutral Keep'`) | 6 s | none | Neutral Keeps hold 10, roll 2 dice, and never yield. Bring about 15. |
| `ambush-defend` | Tip (pinned) | My first REACTION prompt (`renderAmbush` shows for me) | The prompt closes | none (a timer may be running) | You're under attack and you hold an ambush card. **Play** it for extra defenders this battle, **Skip** it, or **Skip until my turn** to stop being asked. |
| `ambush-hit` | Tip | My attack was ambushed for the first time (after the ambush overlay closes) | 6 s | none | They sprang an ambush card. Ambushes only last one battle. |
| `alliances` | Tip | Alliances are on and the first House-vs-House attack happens | 6 s | pulse `#btnDiplo` | Alliances are open. Press **🤝** to send a quiet invitation. Allies share their Generals' Passives. |
| `invite` | Tip (pinned) | My first incoming invite notice | The notice is answered | none | Accepting shares Passives. Attacking an ally later ends the alliance. |
| `rally` | Tip | First Rally Against Olympus notice | 6 s | none | The strongest House is calling a public alliance against it. The first to answer join. |
| `siege-vote` | Read | `voteOwed()` for the first time (not in timed wars) | Got it | the vote notice | **A Siege on Olympus** / Win and your whole alliance wins the war. Fail within the allied turns and the alliance shatters. |
| `book` | Tip | My own turn in round 3, first time | 6 s | pulse `[data-a=book]` | **📖 The Proctors' Book** shows every House's odds to win, turn by turn. (B) |
| `timer` | Tip | First own turn in a timed war | 6 s | `#tmr` | This war has a **{n}s** turn clock. When it runs out, unplaced armies go to the front and your turn passes. |
| `region` | Tip | I complete a region for the first time | 6 s | none | You hold all of **{region}**: +{bonus} armies every Draft. Gold outlines on the map mark each region. |

### 5.5 The 🎓 menu and settings (mockup screen 15)

- A new corner button **🎓** after 💬 in `mountHUD()`, with a small `ON` / `HINT` / `OFF` pip. Key **T** toggles the menu (add it to `onKey`, ignoring inputs like the other keys). Mention it in `RULES_HTML`.
- **Menu** (popover under the corner bar, closes on Esc or an outside click):
  - Segmented **Full / Hints / Off**, with a one-line note for each:
    - *Full:* Step-by-step cards on your turn, and every new mechanic explained.
    - *Hints:* A pulse and one line on your turn. New mechanics still explained once.
    - *Off:* No guide. Lessons wait in this menu if you want one.
  - **Lessons** grouped as: Turn basics (`turn-shape`…`fortify`), Dice & odds (`odds`, `dice`), Your General (`passage`), Cards (`cards`, `must-trade`, `card-preview`), The Standard, Primus, Terrain, Ambushes, Alliances (`alliances`, `invite`, `rally`), Siege on Olympus. Each group shows ✓ when all its ids are seen, or *not yet*. **Replay** removes the group's ids from `ic-tutor-seen`, so they fire at the next trigger. If the trigger is live right now (for example `odds` while a source is selected), fire it immediately.
  - **Reset all lessons** clears `ic-tutor-seen` (needs a confirm built into the menu; `confirm()` is fine in the game itself).
- **⚙ Settings** gets a matching row: *Proctor's Guide: Full / Hints / Off*.
- **Title screen:** *How to Play* stays as it is.

## 6. Architecture

```
src/ui/guide.ts        DOM layer: renders Read / Your move / Tip / Hint, spotlight, blocker, pulse, 🎓 menu, chooser
src/ui/lessons.ts      Pure: lesson registry + pickStep(ctx, mem) → what to show. No DOM, no imports from app.ts
tests/guide.test.ts    Vitest for lessons.ts (runs in node like engine.test.ts)
src/style.css          New "guide" section, using the existing tokens
src/ui/app.ts          Small hooks only (listed below)
```

**State-driven, not click-driven.** Lessons never hook into individual button handlers. After every `App.render()`, App builds a plain `GuideCtx` snapshot and calls `guide.update(ctx)`. `pickStep` compares it with the previous snapshot to decide what starts, what finishes and what to show. This keeps `lessons.ts` pure and testable, and keeps the `app.ts` diff small.

```ts
interface GuideCtx {
  level: 'full' | 'hints' | 'off';
  timed: boolean;                       // v.opts?.timer > 0
  silent: boolean;                      // handoff, wheel, showcase, ambush/siege/fallen overlay, spectating
  playing: boolean;                     // replaying someone else's moves
  phase: GameState['phase'];
  myTurn: boolean;                      // App.myTurn()
  turnKey: string;                      // `${v.turn}:${v.cur}` to detect turn starts
  reinforcements: number; placed: number;
  sel: number | null; target: number | null; targetIsOlympus: boolean;
  targets: number; sources: number; bestSource: { name: string; armies: number } | null;
  odds: number | null; overwhelm: boolean; oneDie: boolean;  // for the current target
  fightsThisTurn: number; mustMove: { from: string; to: string } | null;
  fortifies: number; interior: { name: string } | null;
  hand: number; mustTrade: boolean; confirm: boolean; canRaiseStd: boolean; canMoveStd: boolean;
  primusAsk: boolean; reactionMine: boolean; invitesIn: number; rallyOpen: boolean; voteOwed: boolean;
  terrainTarget: boolean; neutralKeepTarget: boolean; regionTaken: { name: string; bonus: number } | null;
  breakdown: ReturnType<typeof reinforcementBreakdown> | null;
  passageOpen: boolean; round: number;
}
```

The fields are a guide; add what lessons need. Keep everything as plain data.

**Hooks in `app.ts`:**
1. `this.guide = new Guide(...)` in the constructor. It reads and writes the `ic-tutor*` keys.
2. At the end of `render()`, and after `renderModals()` decides on a modal: `this.guide.update(this.guideCtx())`.
3. `guideCtx()`: builds the snapshot from `this.v`, `this.ui`, `this.session` and existing helpers (`attackSources`, `attackTargets`, `winChance(attackFight(...))`, `defenseNote`, `terrainMods`, `mustTrade`, `primusOptions`, `reinforcementBreakdown`, `voteOwed`).
4. `session.hold` and `playQueue()` also wait while `this.guide.blocking`.
5. Title-screen buttons go through `this.guide.ensureChosen()` (a promise) before acting.
6. `mountHUD()`: the 🎓 button. `onKey()`: T. `modalSettings()`: the level row.
7. `endSession()` removes the guide layer.

**DOM layer details:**
- A single `#guide` root on `document.body`, `z-index: 41`. That's above `.modal` (40), so Your-move cards can sit beside the move-in, Passage and Primus modals. It's below the wheel (42), handoff (45), ambush (45), siege (48), fallen-House overlay and toasts (50).
- **Spotlight:** one `.guide-spot` element with `box-shadow: 0 0 0 200vmax rgba(6,3,3,.74)`, sized to the union rect of its selectors plus 6px. A transparent `.guide-blocker` behind it swallows clicks and wheel events, except on `#guide` itself and `[data-a=guide]`. Recompute on `render()`, on `resize`, and on a rAF loop while a Read step is open (the HUD reflows). If the target isn't found, center the card and skip the spotlight.
- **Pulse:** add and remove `.guide-pulse` on the real elements after each render. The action bar is re-rendered from HTML strings, so re-apply the class after every `render()`.
- **Map territories** are 3D, so don't draw over them. Rely on the existing glow, name the suggested territory in the copy, and use `world.focus(t)` (when `prefs.follow` is on) to bring it on screen. `world.screenPos(t)` is available if a later iteration wants an anchored marker.
- **Docking:** the Your-move card sits at `right: 10px` with its `bottom` set from the measured height of `.dock` plus 12px, and width 260px. At **≤ 900px wide**, both Your-move and Read cards become a full-width strip (16px gutters) above the dock. The body collapses to its first sentence with a **More** toggle, and Read keeps its blocker.
- **Styles:** copy the mockup's `.coach`, `.badge`, `.wait`, `.dot-live`, `.c-prog`, `.why7`, `.odds-key`, `.dice-ex`, `.tipbar`, `.hintchip`, `.gmenu` and `.choice` rules into a `/* ---------- guide ---------- */` section of `style.css`. Rename them with a `g-` prefix to avoid clashes (the game already has `.tip`, `.toast`, `.chip` and `.badge`).

**Copy rules:** plain, short, active voice, second person. Light Institute flavour only in titles, never in the instruction itself. Numbers and names come from the live state (`{N}`, `{best}`, `{to}`). No em-dash asides.

## 7. Acceptance criteria

- [ ] A brand-new browser sees the chooser on its first Create, Join, Local or Practice. A returning browser never sees it and gets the single 🎓 Tip.
- [ ] Practice war with **Guide me**: Passage lesson, then lessons 1–10 in order, then the recap. Each Read step dims the board and needs Got it or Enter. Each Your-move step continues by itself when the action happens.
- [ ] Going off-script (End Turn straight from the Draft, ending Attack without fighting) never strands a card on screen or blocks the game.
- [ ] Turns 2 and 3 show Hint pills only, then the guide switches to Off with a Tip. *Keep the full guide* re-arms lessons 2–10 for one turn.
- [ ] 🎓 and **T** open the menu at any time, even under a Read dim. Off removes every guide element immediately. Replay re-fires a lesson.
- [ ] In a timed war, no Read step blocks input and the turn clock is never paused by the guide.
- [ ] AI replays wait behind an open Read card (local) and resume after it.
- [ ] Hot-seat: nothing shows during a handoff screen.
- [ ] Layout holds at 1920, 1366 and 390 px wide. Cards never cover the action bar's buttons, and nothing scrolls sideways.
- [ ] `prefers-reduced-motion` turns off pulses and the live dot.
- [ ] `npm test` passes, including new `tests/guide.test.ts` covering `pickStep`: the turn-1 sequence, an off-script drop, the hints/fade schedule, the timed-war non-blocking rule, the silent states, and each just-in-time trigger firing once.
- [ ] `npm run build` passes (tsc clean).
- [ ] No changes in `src/engine/` or `supabase/`.

## 8. Out of scope for .007

- Voice-over or audio for lessons.
- A scripted tutorial map or a scripted opponent.
- Server-side tracking of lesson progress (it stays per device).
- Translations.

---

## 9. Workstreams

One agent builds all four workstreams **in order**. The run ends with a verified, ready-to-ship .007 and a report. The production push happens when the user says "deploy". The Desktop folder is not a git repository, so the work is sequential and protected by backups and a progress file instead of branches.

```
WS1 Guide core + first turn → WS2 Just-in-time lessons → WS3 Practice war + docs → WS4 QA + release prep → (user: "deploy")
```

| WS | Scope | Done when |
|---|---|---|
| **WS1** Guide core + first turn | `src/ui/lessons.ts`, `src/ui/guide.ts`, `tests/guide.test.ts`, the guide section of `style.css`, the `app.ts` hooks (§6), the chooser, the 🎓 menu, the settings row, the T key. Lessons §5.1–5.3 and §5.5. | Those lessons work in the running game; `npm test` and `npm run build` pass |
| **WS2** Just-in-time lessons | Every lesson in §5.4, the `guideCtx()` fields they need, their 🎓 menu groups, their tests | Each fires once, can be replayed, and is tested |
| **WS3** Practice war + docs | The Practice war button and preset (§2), the 🎓 and T entry in `RULES_HTML` (`copy.ts`), the README | The button works through the chooser; rules and README describe the guide |
| **WS4** QA + release prep | Every §7 checkbox in the running game, plus bug fixes (no new features). `version.ts` becomes `'.007'`. A read-only comparison against GitHub `main`. | Every §7 item passes; the progress file says READY TO DEPLOY |

Progress, decisions and blockers are tracked in `docs/proctors-guide-progress.md`, which the agent creates on its first run. That file is the agent's memory between sessions.

---

## 10. Agent prompts

### Kick-off (paste once into a new session opened on `C:\Users\jjsot\Desktop\institute-conquest`)

```
You are building version .007 of Institute Conquest: the Proctor's Guide, a tutorial HUD for first-time players. You work autonomously across several sessions. The session can stop at any moment when the 5-hour usage limit is hit, and it resumes when the next window opens. Your job ends when the full tutorial is built, verified and ready to ship. You do not push to GitHub or deploy; the user does that by saying "deploy" after reading your report.

DEFINITION OF DONE
- Workstreams WS1-WS4 in institute-conquest/docs/proctors-guide-007.md section 9 are complete, and every acceptance item in section 7 passes in the running game.
- src/version.ts is '.007'. npm test and npm run build pass.
- The read-only release check (below) is done and recorded.
- docs/proctors-guide-progress.md says READY TO DEPLOY, and you've sent the final report.

SOURCES OF TRUTH (read in this order before any work)
1. institute-conquest/docs/proctors-guide-progress.md: your checklist and memory between sessions. ALWAYS read it first, in every session and after every resume. If it doesn't exist yet, this is the first run: create it (see PROGRESS FILE).
2. institute-conquest/docs/proctors-guide-007.md: the spec. Sections 2-7 are the contract; section 5 has the lesson copy.
3. institute-conquest/docs/proctors-guide-mockup.html: the approved mockup. Match its copy, colours and layout.
4. institute-conquest/README.md, then the code the current workstream needs (the spec names the functions in app.ts).

PROGRESS FILE (create it on the first run)
Use these sections:
- Status (NOT STARTED / IN PROGRESS (WSn) / BLOCKED / READY TO DEPLOY)
- Next step (precise: file, function, what's left)
- One checklist per workstream: "Before WS1" (read the spec; add the launch configuration; run npm test and npm run build on the untouched code), WS1, WS2, WS3, WS4. Break each into the items in spec sections 5, 6 and 9. Start every workstream with a backup item.
- A section 7 pass/fail table (Result and Notes columns)
- Decisions, Known issues, and a Session log

RESUME PROTOCOL (the start of every session or resume)
1. Read the progress file. Find "Status" and "Next step".
2. If Status is BLOCKED, re-check the blocker. If it is still there, report it in one short message and stop. If Status is READY TO DEPLOY, re-send the final report and stop.
3. Run npm test and npx tsc --noEmit to confirm the code matches what the progress file says. If the build is broken from an interrupted edit, fix that first.
4. Continue from "Next step". Don't redo checked items.

CHECKPOINTING (assume any message could be your last)
- Work in small steps. After each checklist item: make sure the code type-checks (npx tsc --noEmit), tick the item in the progress file, rewrite "Next step" precisely, and add a one-line entry to the Session log.
- Never leave a multi-file change half-applied at a checkpoint. Finish the edit set and type-check first.
- Before starting each workstream, copy src/ and tests/ to C:\Users\jjsot\Desktop\institute-conquest\.backups\007-<ws>-start\ (outside the project folder). There's no git locally; these backups are your rollback.
- When the spec is ambiguous, choose what's closest to the mockup and the spec's intent, log the choice under "Decisions", and keep going. Don't stop to ask.

ORDER OF WORK
WS1 → WS2 → WS3 → WS4, one at a time. A workstream is finished only when its tests and build pass and you've checked it in the browser.

HARD RULES
- No changes to institute-conquest/src/engine/ or institute-conquest/supabase/. The guide is UI only.
- No git push, no commits to the GitHub repo, no edge function deploys, no changes to anything live. Production is the user's call.
- Stay inside the spec. No extra features. Fixes in WS4 are the smallest change that works.
- Platform: Windows. Bash is Git Bash and PowerShell is 5.1. Bash heredocs containing apostrophes fail here, so write scripts and long text with the Write tool. Node runs scripts/*.ts directly.
- Other Claude sessions sometimes use this folder. If a file changes under you (an Edit fails because the file changed), re-read it, keep their changes, and continue. Note it in the Session log.

BROWSER VERIFICATION
- Never start dev servers with Bash. Use preview_start with a launch config. Add this configuration to C:\Users\jjsot\Desktop\institute-conquest\.claude\launch.json if it's missing (other sessions may hold port 5173):
  {"name": "institute-007", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "institute-conquest", "run", "dev", "--", "--port", "5207", "--strictPort"], "port": 5207}
- For a new-player run, clear the ic-* keys on the localhost page before reloading. Use local wars (Practice war, or Local with 1 human vs 1 AI) for most checks. Check 1920, 1366 and 390 px wide, and reduced motion.
- Record what you verified, with a screenshot reference, in the progress file. In WS4, fill in the section 7 pass/fail table.

RELEASE CHECK (last part of WS4, read-only)
1. Confirm src/version.ts is '.007', and that npm test and npm run build pass.
2. Clone https://github.com/sloppycodes4L/institute-conquest.git into your scratchpad (read-only: never commit or push from it). Diff it against the local institute-conquest folder.
3. In the progress file, list every file that would change in a deploy, split into: the .007 work, and anything else (local changes from other sessions, or files where GitHub looks newer than the local copy). Confirm src/engine/ is identical to GitHub, which means no edge function redeploy is needed.
4. Set Status to READY TO DEPLOY.

FINAL REPORT (one short message)
What was built (WS1-WS4), test and build results, the section 7 table summary, the deploy file list from the release check (calling out anything outside the .007 work), and everything under Decisions and Known issues. End with: "Say 'deploy' to ship .007."

BLOCKED
Stop only for things you can't solve yourself, for example a spec requirement that would need an engine change, or a failure you can't fix after 3 attempts. Set Status to BLOCKED, write exactly what's wrong and what you need, and report in one short message.

Start now: follow the RESUME PROTOCOL.
```

### Resume (only if a session has to be started fresh instead of resumed)

```
Continue the .007 Proctor's Guide build for Institute Conquest. Read institute-conquest/docs/proctors-guide-progress.md first, then follow the kick-off prompt in section 10 of institute-conquest/docs/proctors-guide-007.md (RESUME PROTOCOL, CHECKPOINTING, HARD RULES, RELEASE CHECK). Pick up at "Next step". You're done when the progress file says READY TO DEPLOY and you've sent the final report.
```

