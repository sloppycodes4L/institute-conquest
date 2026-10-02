# Proctor's Guide (.007) — progress

## Status
READY TO DEPLOY

## Next step
None. Waiting for the user to say "deploy" (push main via the scratchpad clone, per the deploy memory; no edge function redeploy needed, src/engine/ is unchanged).

---

## Before WS1
- [x] Read the spec (`docs/proctors-guide-007.md`), the mockup and this file's instructions
- [x] Add the `institute-007` launch configuration (port 5207) to `../.claude/launch.json`
- [x] Baseline: `npm test` on untouched code (203 passed)
- [x] Baseline: `npm run build` on untouched code (clean)
- [x] Read README.md and the app.ts functions the spec names

## WS1 — Guide core + first turn
- [x] Backup `src/` + `tests/` → `../.backups/007-ws1-start/` (18 files)
- [x] `src/ui/lessons.ts`: types (`GuideCtx`, `GuideMem`, `GuideRun`, `Card`), lesson registry, `pickStep(ctx, prev, st)` (pure) + `dismiss`, `closeRecap`, `closeTip`, `setLevel`, `replay`, `resetSeen`, `queueTip`
- [x] Lessons §5.1 `passage`
- [x] Lessons §5.2 1–10 (`turn-shape`, `place`, `end-draft`, `pick-source`, `odds`, `dice`, `roll`, `march-in`, `attack-loop`, `fortify`) + `recap`
- [x] Off-script drop rule (context gone → mark seen, drop; a later turn lesson marks earlier ones seen)
- [x] Lifecycle §4 (pure part): full → recap → hints(2) → off + Tip; Keep full guide re-arms 2–10; `new-007` and `fade` Tips (returning-player detection is in guide.ts)
- [x] Hints mode §5.3 pills
- [x] Timed-war rule (Read never blocks, any action dismisses), silent states
- [x] `tests/guide.test.ts`: turn-1 sequence, off-script drop, hints/fade, timed non-blocking, silent states (19 tests pass)
- [x] `src/ui/guide.ts`: DOM layer — `#guide` root, Read / Your move / Tip / Hint cards, spotlight + blocker, pulse, docking, ≤900px strip + More
- [x] Chooser (mockup screen 00) + `ensureChosen()` promise; "who is new" check (computed once at App construction)
- [x] 🎓 menu (segmented level, lesson groups, Replay, Reset all with inline confirm), T key, Esc/outside click
- [x] `style.css` guide section (`g-` prefixed copies of mockup rules), reduced motion
- [x] app.ts hooks: `guide` field, `render()` → `guide.update(guideCtx())`, `guideCtx()`, `session.hold` + `playQueue` wait on `guide.blocking` (ingest keeps frames queued), title Create/Join/Local via `ensureChosen()`, `mountHUD()` 🎓 + pip, `onKey` → `guide.onKey`, `modalSettings()` row (`guideRow`), `endSession()` → `guide.unmount()` (tsc clean)
- [x] `npm test` + `npm run build` pass (222 tests)
- [x] Browser check: chooser, passage, lessons 1–10, recap, hints turns, fade Tip, returning Tip, menu + T under dim, Off clears all, settings row, 1920/1366/390 (see log)

## WS2 — Just-in-time lessons (§5.4)
- [x] Backup `src/` + `tests/` → `../.backups/007-ws2-start/` (21 files)
- [x] `guideCtx()` fields for §5.4
- [x] `watching` (Tip)
- [x] `cards` (Read), `must-trade` (Your move), `card-preview` (Tip)
- [x] `standard` (Read), `standard-move` (Tip)
- [x] `primus` (Read)
- [x] `terrain` (Tip), `neutral-keep` (Tip)
- [x] `ambush-defend` (pinned Tip), `ambush-hit` (Tip)
- [x] `alliances` (Tip), `invite` (pinned Tip), `rally` (Tip), `siege-vote` (Read)
- [x] `book` (Tip), `timer` (Tip), `region` (Tip)
- [x] 🎓 menu groups for these lessons
- [x] Tests: each JIT trigger fires once; pinned Tips; replay re-arms; Off vs replay (41 guide tests pass)
- [x] `npm test` + `npm run build` pass (244 tests)
- [x] Browser check (sample: watching, timer, standard-move, hint pulses; see log)

## WS3 — Practice war + docs
- [x] Backup `src/` + `tests/` → `../.backups/007-ws3-start/`
- [x] Practice war button + preset (local, 1 human vs 1 AI, smallest valley, no timer), through `ensureChosen()`
- [x] `RULES_HTML` (copy.ts): 🎓 and T entry (in Controls)
- [x] README: the guide, Practice war, architecture row, npm test line
- [x] `npm test` + `npm run build` pass (244 tests)
- [x] Browser check: fresh browser → Practice → chooser → Guide me → 2 seats (Reaper vs Proctor's Pet AI), no turn clock, Passage lesson; rules modal shows the 🎓 entry

## WS4 — QA + release prep
- [x] Backup `src/` + `tests/` → `../.backups/007-ws4-start/`
- [x] Walk every §7 item in the running game; fill the table below
- [x] Fixes (smallest change that works): ask for the guide level before Create/Join save the name; leaving Full drops an open turn-1 card (+ test)
- [x] 1920 / 1366 / 390 px and reduced motion
- [x] `src/version.ts` → `'.007'`
- [x] `npm test` + `npm run build` pass (245 tests)
- [x] Release check: clone GitHub into scratchpad, diff, list deploy files, confirm `src/engine/` identical (see below)
- [x] Status → READY TO DEPLOY; final report

## Release check (read-only, 2026-10-01)
- `src/version.ts` is `'.007'`. `npm test`: 245 passed. `npm run build`: clean.
- GitHub `main` cloned to the scratchpad at `cf95a1a` ("v.006: ambushes on any attack, the Proctors' Book, fallen Houses, siege view, turn horn", 2026-10-01 19:41 -0400). Nothing committed or pushed from it.
- **Files a deploy would change, all .007 work:**
  - Changed: `src/ui/app.ts` (guide hooks, guideCtx, Practice button), `src/style.css` (guide section, corner sizes), `src/ui/copy.ts` (🎓/T rules line), `src/version.ts` (.007), `README.md` (guide, Practice war, architecture row, npm test line).
  - New: `src/ui/guide.ts`, `src/ui/lessons.ts`, `tests/guide.test.ts`, `docs/proctors-guide-007.md` (spec), `docs/proctors-guide-mockup.html` (mockup), `docs/proctors-guide-progress.md` (this file).
- **Anything else:** none. The four changed source files were identical to GitHub in the pre-.007 backup (`.backups/007-ws1-start`), so no other session's local changes are mixed in, and GitHub has nothing newer than the local copy. `.env.local` is git-ignored.
- **`src/engine/` and `supabase/` are byte-identical to GitHub** (`git diff --no-index` exit 0): no `sync:fn`, no edge function redeploy.

## Section 7 acceptance

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | New browser sees chooser on first Create/Join/Local/Practice; returning browser gets single 🎓 Tip | PASS | Fresh browser: chooser on first Local (WS1), Practice (WS3), Create and Join (WS4: chooser shown, not picked, so nothing reached the live server). Returning browser (ic-name set): ic-tutor=off, no chooser, one "New in .007" Tip. |
| 2 | Practice + Guide me: Passage, lessons 1–10 in order, recap; Read dims + Got it/Enter; Your-move auto-continues | PASS | Practice + Guide me: Passage Read → lessons 1–10 in order → recap. A real map click and wheel were blocked under the dim; Enter and Got it close Reads; Your-move cards moved on by themselves (placing, End Draft, picking a source, Blitz, March in, Fortify, March). Lessons 1, 5, 6 match mockup screens 01/05/06. |
| 3 | Off-script never strands a card or blocks | PASS | Fortify ▸ with a selection (attack-loop dropped), End Turn without fortifying (recap: FORTIFY Skipped), End Draft → End Turn on the re-armed turn (recap: ATTACK and FORTIFY Skipped). No card left over, nothing blocked. (The UI has no End Turn during the Draft; armies must be placed first.) |
| 4 | Turns 2–3 Hint pills, then Off + Tip; Keep full guide re-arms 2–10 | PASS | Hint pills on turns 2 and 3 with matching pulses and the HINT pip; turn 4 → Off + fade Tip, OFF pip. Keep the full guide: level stays Full, lessons 2–10 re-armed (lesson 2 fired on turn 2), recap again after that turn. |
| 5 | 🎓 and T open menu any time (even under dim); Off removes everything; Replay re-fires | PASS | T opened the menu under the lesson-1 dim and the recap dim; 🎓 drawn above the dim. Full → lesson 1 at once; Off removed card, spotlight, blocker, dim and pulses at once. Replay of Turn basics at level Off fired lesson 1 immediately. Reset all lessons (inline confirm) cleared ic-tutor-seen. |
| 6 | Timed war: no Read blocks, clock never paused | PASS | Local 60s war, Full: Passage and lesson 1 docked bottom-right, no dim, no blocker; clock 1:00 → 0:57 with the card open (screenshot). Hints run: clock 1:00 → 0:45 with Tips up. |
| 7 | AI replays wait behind Read card and resume | PASS | Recap open after End Turn: the AI did not move for 4.5–5s (log unchanged, bar "plotting your death"); after Continue the replay played. Twice (WS1 Local, WS4 Practice). |
| 8 | Hot-seat: nothing during handoff | PASS | Local with 2 humans: both handoff screens (Passage and turn 1) showed no guide card, hint, Tip, blocker or pulse; after "I am Reaper" lesson 1 appeared. A pre-existing handoff glitch is under Known issues. |
| 9 | Layout 1920/1366/390; cards never cover action bar buttons; no sideways scroll | PASS | 1920: Your-move docked above the dock. 1366: Read cards beside their spotlight, Your-move docked right, corner clear of the top bar (fix). 390: Read and Your-move as the full-width strip with More above the bar (card bottom 727 < bar top 739), hint pill above the bar, menu inside the viewport, corner fits (fix), scrollWidth 390. |
| 10 | Reduced motion: no pulses, no live dot | PASS | The pane can't emulate the media query, so the guide's prefers-reduced-motion block was applied without its query: computed animation on .g-pulse gPulse → none, .g-dot gLive → none; the Tip timer bar is hidden. |
| 11 | `npm test` incl. guide.test.ts coverage | PASS | npm test: 245 passed (203 engine + 42 guide: turn-1 sequence, off-script drops, hints/fade, Keep full, timed non-blocking, silent states, replays and Tips, every JIT trigger once, pinned Tips, replay, Full→Hints). |
| 12 | `npm run build` | PASS | npm run build: tsc clean, vite build OK. |
| 13 | No changes in `src/engine/` or `supabase/` | PASS | src/engine/ and supabase/ untouched (diff against the WS1 backup and GitHub main; see Release check). |

## Decisions
- **Hint countdown:** at the start of each own turn in Hints, if `ic-tutor-hints` is 0 the guide goes Off (+ fade Tip), else it decrements. So recap → hints=2 gives exactly two hinted turns (turns 2 and 3), matching §7.
- **Chooser "Hints only" and menu → Hints** set `ic-tutor-hints = 2`.
- **Passage lesson** fires in Full and Hints (it's the first time the Passage UI appears, like a just-in-time lesson).
- **Recap after every full guided turn**, including the re-armed one after *Keep the full guide*, so the player can keep choosing.
- **Turn lessons are sequential:** when lesson k starts, lessons before k are marked seen (never chase backwards). When the guided turn ends, all ten are marked seen.
- **Replay works at any level** (including Off): replayed ids fire at their next trigger.
- **Timed wars:** a Read card is dismissed by any game action (phase, placement, selection, fight, fortify, turn change), and its footer drops the "⏸ The war waits" line (it would be untrue).
- **Lesson 2 footer:** the spec's "Shift-click takes one back." sits as a fine line under the body; the live-dot footer keeps the mockup's "Click a glowing territory".
- **Fortify lesson** pulses `March` once a destination is picked (Your-move steps pulse the real control); no End Turn pulse.
- **Recap rows:** an attack with no conquest reads "Fought N battles"; a phase with nothing done reads "Skipped" with a dash instead of ✓.
- **Settings row note:** "🎓 or T opens the guide and its lessons." (the 🎓 menu's level notes talk about "this menu", which reads wrong inside ⚙ Settings).
- **Phones (≤480px):** the corner now holds ten buttons, so `.corner .icon-btn` narrows to 28px with 2px gaps (it overflowed past the mobile tabs at 390px). At 390px the left row ends at 306px, the tabs start at 324px.
- **Class clash fix:** the game has global `.tip` and `.timer` rules, so the Tip modifiers are `g-t` and `g-timer`.
- **Tips** are queued with their copy fixed at the moment they fire (region/timer numbers stay right after the moment passes). Tips fire during replays too (the spec's exception), and any number can queue; one shows at a time.
- **JIT step labels:** "New: cards", "New: the Standard", "New: Primus", "New: Siege on Olympus" (mockup screen 14 uses "New: cards").
- **`book`** fires on my first own turn in round 3 or later; **`ambush-hit`** looks at this turn's log (a `counter` event against me) and shows once the ambush overlay closes (at the next render).
- **`watching`, `book`, `timer`, `region`** have no 🎓 menu group (the spec's group list leaves them out), so they can't be replayed.
- **Laptops (901–1500px):** corner buttons 36px with 4px gaps, so the ten of them end at 406px and clear the centered top bar at 1366 (it starts at ~460px; with 40px buttons the 10th overlapped it by 4px). The overlap at ~1024px existed with nine buttons too.
- **Practice war button** shows for everyone (under Local), labelled "Practice war · You vs 1 AI"; it uses the name field, or the saved name, or Reaper, and `{ ...DEFAULT_SETTINGS, size: -2, timer: 0 }` (the engine clamps -2 to the smallest valley for 2 players).
- **Create/Join ask for the guide level before saving the name** (nameOk stores ic-name, which would make a browser that reloads mid-chooser look returning).
- **Leaving Full** (menu or Settings) drops an open turn-1 card so the hint pill takes over; a replayed one stays.
- **Reduced motion** checked by applying the media block's rules directly (the browser pane can't emulate the query).
- **Menu groups:** Turn basics = turn-shape, place, end-draft, pick-source, roll, march-in, attack-loop, fortify (odds and dice live in "Dice & odds").

## Known issues
- **Turn 1 often meets an Overwhelm** (lone neutrals with 2 armies next to a stacked territory). Per spec the dice lesson then shows only the Overwhelm line, so the dice rules (3 vs 2, ties to the defender) may not appear on the guided turn. The recap quiz still asks about ties; *Dice & odds* can be replayed from 🎓. Not changed (spec is explicit); flagging for the user.
- **Clicking enemy land picks source and target in one click**, so `odds` (lesson 5) is skipped on that path (never chase backwards). After a conquest the game auto-selects the new territory, so `attack-loop` waits until the selection clears (spec: `sel == null`).
- **Hot-seat Passage handoff (pre-existing, not .007):** after the first human picks a General, `onModalClick('choose')` calls `this.modal(null)` after `send()`, which wipes the handoff screen that `send()` just rendered. The handoff state stays set and the next render (any click, resize) brings it back. The guide stays silent the whole time. Not fixed (outside the guide's scope); a one-line follow-up for later.

## Browser verification log
- WS1 (1366×768, local 1 human vs 1 AI, no timer, fresh ic-* keys): chooser on first Local click (screenshot: chooser over title); Guide me → Passage Read with spotlight on the cards and 🎓 lit above the dim; Enter closed it; lesson 1 spotlight on the phase pills (matches mockup screen 01); T opened the menu under the dim, Esc closed it; lessons 2 (progress + Why 5? fold: 3 + Keep 2), 3 (End Draft pulse), 4 (Try The Greatwood (9)), 6 (Overwhelm variant), 7 (100%, Roll/Blitz pulse), 8 (card beside the move-in modal, March in pulse), 9 (Fortify pulse), 10 (Step 1 → 2 → March pulse → done) in order; recap listed Placed 5 / Took Quiverwood / Moved 4 troops to Hartsblood Run, quiz feedback worked; **the AI did not move for 5s while the recap was open, then replayed after Continue**; turn 2 and 3 Hint pills with matching pulses and HINT pip; turn 4 → Off + fade Tip, OFF pip.
- Returning browser (ic-name set, no ic-tutor): no chooser, ic-tutor=off, single "New in .007" Tip after the wheel (screenshot: Tip over the Passage modal).
- Menu: Full fires lesson 1 at once; Off removes card, spotlight, blocker, dim and pulses at once. ⚙ Settings row switches level (pip follows).
- Layout: 1920 Your-move card docked right above the dock (bottom 990 < dock 1002); 390×844 Read and Your-move become the full-width strip with More, above the action bar (card bottom 727, bar top 739), no sideways scroll.
- WS2 (1366×768): local 60s war in Hints: `watching` Tip during the AI replay for 6s, then `timer` Tip ("60s turn clock") for 6s; the clock kept running (1:00 → 0:45) with Tips up. Untimed war in Hints: `standard-move` Tip on Fortify with the Hint pill and End Turn pulse (screenshot). Other JIT lessons covered by guide.test.ts; `cards` checked in the WS4 Practice run.
- WS4 (1366×768 unless noted): full Practice run (see §7 rows 2–5, 7); `cards` Read on turn 3 in Hints with the spotlight on the hand (screenshot), `book` Tip queued at R3; timed-war docked Read (screenshot); hot-seat handoffs silent; 390×844 hint pill and menu; reduced-motion rules applied directly.

## Session log
- 2026-10-01 S1: first run; created this file.
- 2026-10-01 S1: added institute-007 launch config; baseline npm test 203 pass, build clean.
- 2026-10-01 S1: WS1 backup taken; lessons.ts + tests/guide.test.ts written (19 pass, tsc clean).
- 2026-10-01 S1: guide.ts, guide CSS, app.ts hooks written; tsc clean. Next: browser check.
- 2026-10-01 S1: WS1 browser check passed after 3 fixes (.tip/.timer class clash, settings note, phone corner width). npm test 222 pass, build clean. WS1 DONE. WS2 backup taken.
- 2026-10-01 S1: WS2 lessons + guideCtx fields + tests written (41 guide tests pass, tsc clean).
- 2026-10-01 S1: WS2 browser sample passed; laptop corner fix. npm test 244 pass, build clean. WS2 DONE. WS3 backup taken.
- 2026-10-01 S1: WS3 done (Practice button, rules entry, README; copy.ts kept CRLF). npm test 244 pass, build clean. WS4 backup taken.
- 2026-10-01 S1: WS4 §7 walk: all 13 PASS; 2 small fixes (chooser before name save; leaving Full drops turn-1 card). version .007. npm test 245, build clean.
- 2026-10-01 S1: release check done (only .007 files differ; engine identical). Status READY TO DEPLOY. Final report sent.
