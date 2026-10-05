# Patch .008: build progress

The build agent's checklist and memory between sessions. Spec: [patch-008.md](patch-008.md).

## Status

DEPLOYED (2026-10-04): commit 848a92ee5b70a524f5088bddb49587dc0c813420 on main, GitHub Pages build green, edge function `institute` version 6, live site verified, online smoke test passed. Final report sent.

## Next step

None. .008 is live. If a session lands here, re-send the final report. For the next engine change, read "How the edge function was deployed" under Decisions first.

## Before WS1

- [x] Read the spec, README, reference README, `src/engine/engine.ts`, and the diff of the reference engine against the v.0071 engine (508 lines; `bot.ts`, `cards.ts`, `data.ts` are identical in the reference)
- [x] Mockup: structure and screen list read (20 screens: 00 War settings, 01-03 War Council and Local Houses, 04-05 Choose your Primus, 06 Ultimate button, 07-11 cast flow, 12 announcement, 13 icons, 14 map marks, 15 skipped turn, 16 Silenced or Pinned, 17 Revealed, 18-19 lessons). Exact copy and styles are re-read per workstream: WS2 reads screens 00-05, WS4 reads 06-17 and the design sheet, WS3 reads reference `sim.ts` and `unitU*.ts`, WS5 reads the guide spec section 3 and screens 18-19
- [x] Launch configuration `institute-008` (port 5208) added to `.claude/launch.json`
- [x] `npm test` on untouched code: 2 files, 245 tests pass. `npm run build`: passes
- [x] Untouched code saved as `.backups/008-ws0-start/`
- [x] Baseline `node scripts/pace-sim.ts 40` and `node scripts/sim.ts 20` recorded under Sim results
- [x] Fixtures from the untouched engine: `tests/fixtures/v0071-mid-passage.json` (4 players, seat 0 has chosen, seed 71) and `tests/fixtures/v0071-mid-war.json` (4 bots, turn 21, Draft, a public alliance 1+2, a secret alliance 0+3, a Primus, neutral Standards standing; seed 5). Script: scratchpad `make-fixtures.ts` (copy in `.backups/008-ws0-start/`)

## WS1 Keeps (spec 3)

- [x] Backup to `.backups/008-ws1-start/`
- [x] `captureStandard()`: no land hand-over for a neutral House (keep `stdCaptured`; keep the `neutralFall` line in `copy.ts`)
- [x] `BALANCE.keepWall = 1`; `defenseMods()` adds it to `defHigh` for any Keep (House or neutral); applies to Standard charges (through `defenseMods` in `resolveStandard`)
- [x] `odds.ts`: `attackFight` and `standardFight` carry the Walls through `defenseMods`; `defenseNote` returns `'Keep'` for a House's Keep; new `keepWalls(s, to)`. `app.ts`: target chips show `♜+n`, the attack bar and the fallen-House math name the Walls
- [x] `bot.ts`: Walls count as +35% defenders per point of `defHigh` in its attack ratio (a neutral Keep now needs 21 attackers, ~86-89%); a neutral Standard scores +2 instead of +4 (no free land)
- [x] Copy: `RULES_HTML` (Keeps, neutral Keep, Neutral Houses), README (Neutrals, Keeps), `neutral-keep` Tip, the Keep line in `TERRAIN_INFO` (`data.ts`). Recomputed with `odds.ts`: 20 armies take a neutral Keep 83.0% (was 15); 13 armies beat 1 army + 5 guard 79.5% (was 10)
- [x] Tests: the two Keep tests updated; added "taking a neutral Keep captures its House and nothing else" and "Walls defend a Standard charge too"; defKeep stacking is in the House Keep test
- [x] `npm run sync:fn`, `npm test` (247 pass)
- [x] `npm run build`
- [x] Pace: `pace-sim 40` and `sim 20` after. First run: every game finished, but median rounds grew 17-29% (over 25% at 2, 6 and 7 players). Tuned the AI (see Decisions); second run is back at the baseline
- [x] Browser check in a local war at 1366 px (session s1, screenshots in the session transcript): from a 20-army stack the chip read "The Ovens 10 ⚑ 83% ♜+1" and the attack bar "Blitz wins: 83% · ♜ neutral Keep: Walls +1 (highest die), never yields"; the blitz changed one territory (The Ovens), 10 House Apollo territories stayed neutral, the Standard was captured and the War Log said so; against a House Keep the chip read "Castle Mars 1+5 ⚑ 79% ♜+1" from 13 armies and the bar "♜ Keep Walls +1 (highest die)"

## WS2 House pick + Choose your Primus (spec 4)

- [x] Backup to `.backups/008-ws2-start/`
- [x] Engine: `createGame(names, rng, { ai, settings, houses })`, `dealHouses()` honours picks, `sorted` event gains `picked`
- [x] Engine: pure exported `pickHouse(lobby, seat, house, byHost)` helper (taken House refused, host lock, host `null` unlocks)
- [x] Engine: `GameOpts.pick`, `priv.passage[seat]` = every Character of the seat's House, deck holds the rest, unchosen shuffled into the deck when the last player chooses (`returnUnchosen()`, also when the last one concedes), nobody dies, `passage` event without `killed`
- [x] Engine: `generalPassive()` / `passiveValue(card, house, printed)` printed value when `opts.pick`; old wars keep the +1
- [x] Engine: a pre-.008 state mid-Passage completes the old way (the old branch of `choose` stays for wars without `opts.pick`)
- [x] Server `index.ts`: `LobbySeat.house`, `houseBy`, op `setHouse` (calls `pickHouse`), `join` on Random, `kick` / `removeBot` keep picks (the seat objects are spread), `start` passes picks. Not type-checked by tsc (Deno file) and not exercised before WS7
- [x] Client: `OnlineSession.setHouse()`; `showLobby()` House picker per seat (`housePill`, `housePopover`); `showLocalSetup()` step 1 picker; Practice war stays Random (it passes no House)
- [x] Wheel (`showWheel`) spins only for random Houses (picked seats are shown already revealed, "· picked"); not opened at all when every seat picked; button **Choose your Primus ▸**
- [x] Choose your Primus modal (`renderModals()`), top bar `CHOOSE YOUR PRIMUS` + House, waiting modal text, no Passage flavour, no scream for a `passage` event without `killed`; War Log lines for `sorted` (picked), `chosen`, `passage`
- [x] AI: `bot.ts` scores every option with `score()`
- [x] Hot-seat fix: `onModalClick('choose')` no longer wipes the handoff screen
- [x] Tests: the opening, Passage and views tests updated; added picks honoured / no duplicates / Random fills; options are the House's Characters; unchosen go to the deck; concede while choosing; printed-value Passives; the AI chooses among all options; the v.0071 mid-Passage fixture completes and plays to the end; `pickHouse` rules
- [x] `npm run sync:fn`, `npm test` (253 pass), `npm run build`
- [x] Browser check (session s1, screenshots in the session transcript), at 1366 px unless noted:
  - Local setup: seat pills; the picker lists Random and the seven Houses; a taken House is greyed out with the holder's name; None hides the pill.
  - Wheel with seats 0 and 1 picked and seat 2 on Random: "2 Golds have picked a House. The Proctors spin the wheel for the other."; the picked rows read "House Mars · the Wolves · picked"; one spin; button "CHOOSE YOUR PRIMUS ▸". With every seat picked the wheel did not open.
  - Choose your Primus: top bar "CHOOSE YOUR PRIMUS / House Mars"; Mars's 7 cards in rows of 4 and 3 (box 740 px); a House of five in one row (box 900 px; 880 px wrapped the fifth card); pick shows "YOUR PRIMUS" and "SWEAR IN CASSIUS ▸"; then "Cassius au Bellona leads House Mars / Waiting for the other Houses to choose. 1 of 3 are ready. / Rivals see your Primus when everyone has chosen."
  - After: deck 46, nobody killed, War Log "Reaper: Cassius au Bellona leads House Mars as its Primus.", panel "YOUR PRIMUS" with the printed Passive and no House-match badge.
  - Hot-seat (2 humans): after seat 0 swore in, the hand-over screen for seat 1 stayed up; seat 1's modal showed its own 7 cards, nothing picked, and no trace of seat 0's pick.
  - 390 px: two cards a row (four rows for Mars), the swear-in button sticks to the bottom of the box, nothing scrolls sideways.
  - War Council, driven with a stand-in session object that calls the real `pickHouse` (no server): host view shows editable pills on every seat, "set by host" and 🔒 on a locked player, Kick buttons; the host's pick for an AI stored `houseBy: 'host'`; guest view shows read-only dashed pills except its own, and the guest changed its own House.

## WS3 Ultimates engine + AI (spec 5, 7)

- [x] Backup to `.backups/008-ws3-start/`
- [x] Setting: `WarSettings.ultimates`, `DEFAULT_SETTINGS`, `cleanSettings()`, `resolveSettings()`, `GameOpts.ultimates` (on and 3+ players, `ULT_MIN_PLAYERS`), `s.ult` created in `createGame`
- [x] Port state and helpers: `UltState`, `UltEffect`, `UltCastRec`, `winScores`, `partiesOf`, `bottomHalfSeats` (on top of the new `ultStandings`), `ultDamage`, `ultEffectOn`, `ultStartTurn`, `ultEndTurn`, `noteAttacked`, `ultCardsOk`. `flareCasterBonus` became the `radiant` flag of `ultFight()`
- [x] Round counter in `advance()`, PvP counters (`conquer`, a won Standard charge, defensive wins in `ultEndTurn`), skipped turn in `startTurn()`
- [x] `castUlt` for the seven Houses (v5 as written; numbers in the `ULT` constant), `Action` type `ultimate`, Mars pick validation (`marsPickBlocker`, `marsTargets`), Jupiter quadrant (`stormCut`, `stormSide`)
- [x] Wild Hunt Long Strike (`huntReach`, `huntsWith` for `dianaLS`, `spendsLongStrike`), no guard, no reaction prompt; Solar Flare dice (`ultFight`, `battleMods`, `guardAgainst`)
- [x] `ultMuted` / `ultPinned` turn flags and every check that reads them (attack, Standard charge, assault, trade, play, discardProctor, Primus of a Keep, cast, endDraft at 5+ cards, Fortify, moveStd, and the moveStd card)
- [x] 2-turn alliance lockout with Ultimates on (walk-out, Rally answer, betrayal): `lockOut()`, `lockoutLeft()`, log event `lockout`
- [x] Added beyond the sim: `ultBlocker(s, seat)` (returns `{ code, msg, n }`); Minerva's Revealed in `viewFor` (`me.seen`); public alliances only for the alliance target and Stormfall's spread (`ultTargets`, `stormSide`); log events `ultimate` (with picks), `seized`, `ultTick` (kinds: blackout, silenced, tithe, harvest, rot, rotDraft, storm, pinned), `lockout`; map changes go through `commit()`'s snapshot like any action
- [x] No `process.env`, no `V5`, no switches; nothing from the Drop list
- [x] AI (`bot.ts`): `ultChoice` (the sim's `bestOption`), `directValue`, `planFollow` + `mcBlitz`, thresholds (value 20; the Hunt at 70%), keeps a birth-House card from round 3 (`held`), follow-up attacks after Apollo / Diana (`ultFollowUp`, stateless: it reads its own flare or hunt cast this turn), Mars 3 largest stacks, Jupiter best quadrant, never walks out (it never sends `leaveAlliance`), never sends a refused action under Silenced / Pinned, rng from `botAction`
- [x] `tests/ultimates.test.ts`: 38 tests. Ports every check of `unitU.ts` and `unitU2.ts`, plus every item in spec 5.5, the AI's choices, determinism, and the v.0071 mid-war fixture
- [x] `scripts/sim.ts`: turns, Siege reached, Olympus wins, casts per game (and by House), lockouts, refused actions; Ultimates on by default for 3+ (`off` as the 3rd argument; player counts as the 4th)
- [x] `npm run sync:fn`, `npm test` (3 files, 291 tests), `npm run build`
- [x] `src/ui/odds.ts`: `attackFight` and `standardFight` use `battleMods` and `guardAgainst`, so every odds number already carries Glared, Radiant and Hunted
- [x] Sims: `sim.ts` with Ultimates on and off, 30 games per count: every game finishes (numbers under Sim results)

## WS4 Ultimates UI (spec 6)

- [x] Backup to `.backups/008-ws4-start/`
- [x] 6.1 Create stage: House Ultimates row in `settingsHTML()`, `applySetting()`, Reset, disabled under 3 Houses, War Council read-only for guests (the row uses the same `toggle()` as the others, which is disabled when `edit` is false)
- [x] 6.2 Ultimate button in `renderActionBar()` with the `ultBlocker()` states (`ultButton()` in `src/ui/ultimates.ts`)
- [x] 6.2 Cast flow: Target and Cards in a modal (`castModal()`), Mars picks on the map (`castPick()`), Jupiter quadrant panel (`renderQuadrants()`), Preview through `simulate()` (`castBar()`), Commit
- [x] 6.3 Showcase announcement for every cast (`showUltimate()`; it is pinned by the same `pinShowcase()` as a rival's card, so it follows the replay's speed and Skip). Seen in the browser for an AI's Blackout on me
- [x] 6.3 War Log lines (`ultimate`, `seized`, `ultTick`, skipped turn, lockout): tested in `tests/ultimates.test.ts` ("what the screen shows") and read in the running game
- [x] 6.3 Status icons on roster banners and by the viewer's Primus, with their text (tested: `statusIcons()`)
- [x] 6.3 Map markers: Seized (a pennant in the caster's colour), Storm-struck (hatching over the quadrant); both seen on the 3D map
- [x] 6.3 Skipped-turn screen; Silenced / Pinned disabled buttons with reasons, and the banner above the bar
- [x] 6.3 Revealed: the Minerva caster opens the target's hand from the banner (it also opens by itself right after the cast)
- [x] 6.3 Odds: Walls, Glared, Radiant, Hunted in the chips and the attack bar; Long Strike targets lit (a Standard 2 spaces away showed "⚑ >99% ♜+1 ☾")
- [x] 6.4 Layout at 1920, 1366, 375 (the pane's phone preset); reduced motion (the rule that stops the button's and the icons' pulse is in the stylesheet; the pane cannot switch the media query on)
- [x] `npm test` (295 pass), `npm run build` (passes)
- [x] Browser check: every Ultimate cast by a human in a local war, once on one House and once on a public alliance (14 casts; for the 6 with numbers the preview equalled the result: Rot 30 and 63, Stormfall 63 and 108, Where's Sevro? 13 + 13)

## WS5 Tutorial + docs (spec 8)

- [x] Backup to `.backups/008-ws5-start/`
- [x] Lessons: `choose-primus` replaces `passage`; `ult-open`, `ult-ready`, `ult-short`, `ult-target`, `ult-hit`, `ult-status`, `lockout` (seven new `GuideCtx` fields, filled in `guideCtx()`)
- [x] 🎓 menu groups: Your Primus, House Ultimates
- [x] `neutral-keep` Tip (done in WS1) and every other lesson checked: "General" is now "Primus" in the lessons, the rules, the Codex note, the War Log and the tooltips (a test reads `lessons.ts` for "General" and "Passage")
- [x] `tests/guide.test.ts` updated (52 tests)
- [x] `RULES_HTML`: Choose your House and Primus, Keeps (WS1), House Ultimates section with the table and the icons, lockout, settings
- [x] README: How it plays, Architecture, Develop
- [x] `scripts/sim.ts` (WS3), `scripts/smoke-online.ts` (`setHouse` for my seat and by the host, a taken House refused, cast count, Draft-cut tolerant check). The smoke script runs for the first time in WS7
- [x] `npm test` (305 pass), `npm run build`
- [x] Browser check at 1366 px: `choose-primus` on the Primus cards; `ult-open` (pulses the button) and `ult-ready` (names Where's Sevro?, its line and House Mars) on my Draft; `ult-target` pinned while the cast flow is open; `lockout` after leaving an alliance; `ult-status` and "Stormfall hit you" after an AI's cast, spotlight on my icon strip; none fired a second time; Replay from 🎓 fired them again; the rules table renders inside the box

## WS6 QA + release prep

- [x] Backup to `.backups/008-ws6-start/`
- [x] Every section 10 item checked in the running game (table below)
- [x] Sim on the real engine, 100 games per player count 3 to 7, Ultimates on and off
- [x] The AI fallback (Known issues): `botFallback()` in `bot.ts` places the Draft before ending it; used by the server's `runBots`, the local session and `sim.ts`; a test
- [x] `src/version.ts` = `'.008'`
- [x] Release check: clone GitHub `main`, diff, list of files, deploy access confirmed

### Release check (2026-10-04)

GitHub `main` is at 9bb5bec ("v.0071 hotfix: Sound checkbox, off by default"), author `sloppycodes4L <298088978+sloppycodes4L@users.noreply.github.com>`. With the local project laid over a clone, these files differ:

- Changed by .008 (21): `README.md`, `scripts/sim.ts`, `scripts/smoke-online.ts`, `src/engine/bot.ts`, `data.ts`, `engine.ts`, `src/net/session.ts`, `src/render/scene.ts`, `src/style.css`, `src/ui/app.ts`, `copy.ts`, `guide.ts`, `lessons.ts`, `odds.ts`, `src/version.ts`, `supabase/functions/institute/index.ts` and its `engine/bot.ts`, `data.ts`, `engine.ts`, `tests/engine.test.ts`, `tests/guide.test.ts`.
- New with .008 (7): `src/ui/ultimates.ts`, `tests/ultimates.test.ts`, `tests/fixtures/` (2 files), `docs/patch-008.md`, `docs/patch-008-mockup.html`, `docs/house-ultimates-sheet.html`, `docs/patch-008-progress.md`.
- Not .008, explained (1): `docs/proctors-guide-progress.md`, 3 lines: the .007 session recorded its own deploy after pushing. It goes along.
- Nothing else differs (`package.json`, the workflow, `index.html`, `public/` are identical).

Deploy access: `git ls-remote` and `git push --dry-run` succeed; Supabase lists the function `institute` (version 5, ACTIVE, verify_jwt false).

## WS7 Deploy

- [x] Commit `v.008: …` as the repository's author, push `main` (848a92ee5b70a524f5088bddb49587dc0c813420; the committed tree passed `npm test` and `npm run build` in the clone before the push)
- [x] GitHub Actions run green (run 37238670701: tests, build and Pages)
- [x] Edge function `institute` redeployed (version 6, verify_jwt false, entrypoint index.ts; see Decisions for how)
- [x] Live bundle (`assets/index-Dupb81Ik.js`, the same file as the local build) contains `.008`, "Choose your Primus", "HOUSE ULTIMATE", "BLACKED OUT" and `setHouse`; the title screen reads "Version .008" with no console error
- [x] Online smoke test, first run: war XQ343, Houses mars, minerva, jupiter, pluto; both picks honoured, a taken House refused, Ultimates on; 143 steps, 0 server refusals, 0 Draft mismatches, the war ended at turn 61; 3 Ultimates cast (Minerva 2, Jupiter 1)
- [x] Status DEPLOYED with the commit sha; final report sent

## Section 10 acceptance

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | War Settings shows House Ultimates (On by default, Off and disabled with 2 Houses, no Ultimate UI when Off) | PASS | Local setup at 1366 px: On by default, Off, disabled with 2 Houses (WS4). A 4-House war started with it Off: no `s.ult`, no Ultimate button, no icons. The War Council row is the same `toggle()` (read-only for guests); live check in WS7 |
| 2 | Lobby and Local setup: House pick, no duplicates, host assigns and locks, Random fills | PASS | Local setup in the browser (WS2); the War Council with a stand-in session (WS2); `pickHouse()` tests for the rules the server op calls. The live `setHouse` check is the WS7 smoke test |
| 3 | Wheel spins only for random Houses; Choose your Primus with the House's Characters; no Passage text in a .008 war | PASS | Browser (WS2): the wheel is skipped when every House was picked and spins only for random ones; 5 options (7 for Mars); top bar CHOOSE YOUR PRIMUS. "Passage" and "General" wording is only left in the branches for wars begun before .008 |
| 4 | Neutral Keep: one territory changes, Standard captured, the rest stays neutral; odds include Walls | PASS | Browser (WS1): The Ovens fell alone, 10 Apollo territories stayed neutral, the Standard was captured; chips and the attack bar show the Walls |
| 5 | Round 4 bottom-half House can cast; top half, cooldown, no birth-House card cannot, and the button says why | PASS | Browser (WS4): locked before round 4, Top half, Recharging, Needs 3 cards, READY. Tests: "who can cast, and when", "the Ultimate button says why not" |
| 6 | Each of the seven Ultimates vs one player and vs a public alliance does what 5.3 says; preview matched | PASS | Browser, 2026-10-04: 14 casts by a human. Preview equalled the result wherever there are numbers (Rot 30 and 63, Stormfall 63 and 108, Where's Sevro? 13 + 13). Jupiter has no "whole alliance" option (the storm spreads by itself, see Decisions) |
| 7 | Lasting effects: right icon and count on the right banners, gone on time; Seized and Storm-struck on the map | PASS | Browser: Revealed and Blacked Out on the target, Recharging 3 on the caster, Silenced, Pinned, Hunted, Long Strike, Glared, Radiant, Rot, Storm-bound, Tithed, Harvest, Locked out seen with their counts. Silenced was gone after the Silenced turn, the Seized pennants and their effect at Mars's next turn. Tests: `statusIcons()` and each effect's expiry |
| 8 | Blackout skips a human's turn with an explanation; Silenced and Pinned disable the right buttons with a reason | PASS | Browser: the BLACKED OUT screen (who, Draft lost, hand seen); Silenced: Trade, Attack, Fortify disabled with reasons, cards marked, End Turn ends the turn; Pinned: Fortify and Move Standard disabled with reasons |
| 9 | Only the Minerva caster reads the target's hand, until the caster's next turn | PASS | Test "Revealed: the caster, and nobody else" (`viewFor`). Browser: the panel opens for the caster; in hot-seat the next human gets no panel, no eye button and no `me.seen` |
| 10 | Leaving an alliance with Ultimates on: Locked out for 2 turns, invites refused | PASS | Tests "the alliance lockout" (invites refused, cleared after 2 own turns). Browser: "Locked out, 2 turns left" on my banner after leaving |
| 11 | AI casts, follows up Apollo and Diana, never stalls under Blackout, Silenced, Pinned | PASS | Browser: AI Houses cast Blackout, Rot and Stormfall on me in a local war; two Silenced AIs played their turns and the war came back to me. Tests: follow-ups for Solar Flare and The Wild Hunt, 25 bot games never refused. Sims: 1,000 games all finish |
| 12 | Server paths (`setHouse`, `start` with picks, Revealed view) covered by engine-helper tests | PASS | `pickHouse` tests, `createGame` with `houses`, the Revealed view test. Live check in WS7 |
| 13 | Hot-seat: handoff survives choosing a Primus; no Ultimate UI leaks a hand | PASS | Browser, 2 humans + 2 AIs: the handoff screen stayed up after seat 0 chose its Primus; after Blackout by seat 0 the handoff screen and seat 1's view had no Revealed panel, no hand and no cast flow |
| 14 | Guide: `choose-primus` replaces `passage`; `ult-*` and `lockout` fire once and replay; no Read step blocks a timed war | PASS | Tests (52 in `guide.test.ts`: once, replay, timed war). Browser: every new lesson seen once, then again after Replay from the menu |
| 15 | Rules (?) and README describe House pick, Choose your Primus, Walls, neutral Keeps, Ultimates, with recomputed odds | PASS | `RULES_HTML` and README rewritten; 20 armies for a neutral Keep (83%), 13 for a lightly held House Keep (80%), from `odds.ts` |
| 16 | Every mockup screen has its counterpart (copy, states, layout) at 1366 px | PASS | Screens 00 to 05 compared in WS2, 06 to 17 in WS4, 18 and 19 in WS5. The differences are listed under Decisions (no "New" badge, the quadrant panel above the bar, Jupiter's target options, the extra Move Standard button, icon text on click) |
| 17 | Layout at 1920, 1366, 390; reduced motion turns off the new animations | PASS | 1920, 1366 and the pane's phone preset (375 px, narrower than 390): cast flow, quadrant panel, announcement, skipped turn, restriction banner, Revealed panel all inside the viewport. The reduced-motion rule for the button and icon pulse is in the stylesheet; the pane cannot switch the media query on, so it was read, not seen |
| 18 | `npm test` passes (updated suites, `ultimates.test.ts`, bot games, same engine on the server) | PASS | 306 tests pass, including "ships the exact same engine as the client" |
| 19 | `npm run build` passes | PASS | tsc clean, bundle built |
| 20 | Sim, 100 games per count 3 to 7, Ultimates on and off: every game finishes; numbers recorded | PASS | See "After WS6" under Sim results: unfinished 0 in all 1,000 games; Ultimates add 0% to 8% in turns |
| 21 | v.0071 fixtures (mid-Passage, mid-war) load and play to the end | PASS | Tests with `tests/fixtures/v0071-mid-passage.json` and `v0071-mid-war.json` |
| 22 | `src/version.ts` is `'.008'` | PASS | Set |

## Sim results

### Baseline (untouched v.0071 engine)

`node scripts/pace-sim.ts 40`:

| Players | First PvP round p10/med/p90 | Game rounds med | p90 | Unfinished |
|---|---|---|---|---|
| 2 | 3/4/5 | 14 | 22 | 0 |
| 3 | 2/3/4 | 12 | 17 | 0 |
| 4 | 2/2/3 | 12 | 15 | 0 |
| 5 | 2/3/4 | 12 | 15 | 0 |
| 6 | 2/3/4 | 11 | 14 | 0 |
| 7 | 3/3/4 | 11 | 15 | 0 |

`node scripts/sim.ts 20`:

| Players | Rounds p10/med/p90 | Std/game | Sieges (won, failed) | Unfinished |
|---|---|---|---|---|
| 2 | 7/16/20 | 0.3 | 0 | 0 |
| 3 | 11/13/17 | 0.1 | 14 (14, 1) | 0 |
| 4 | 9/13/15 | 0.2 | 20 (20, 0) | 0 |
| 5 | 10/11/18 | 0.6 | 20 (19, 1) | 0 |
| 6 | 10/12/17 | 0.7 | 20 (18, 2) | 0 |
| 7 | 9/12/16 | 0.8 | 19 (18, 2) | 0 |

### After WS1 (Keep Walls, no land hand-over)

First run, before the AI tuning (`pace-sim 40`, game rounds med / p90, unfinished 0 everywhere): 2p 18/23, 3p 15/19, 4p 14/20, 5p 14/19, 6p 14/21, 7p 14/19. That is +29%, +25%, +17%, +17%, +27%, +27% on the baseline medians.

After the AI tuning (the shipped WS1 bot). `node scripts/pace-sim.ts 40`:

| Players | First PvP round p10/med/p90 | Game rounds med | p90 | Unfinished |
|---|---|---|---|---|
| 2 | 2/4/5 | 14 | 18 | 0 |
| 3 | 2/3/4 | 13 | 18 | 0 |
| 4 | 2/2/3 | 12 | 17 | 0 |
| 5 | 2/3/3 | 12 | 15 | 0 |
| 6 | 2/3/4 | 12 | 16 | 0 |
| 7 | 3/3/4 | 11 | 18 | 0 |

`node scripts/sim.ts 20`:

| Players | Rounds p10/med/p90 | Std/game | Sieges (won, failed) | Unfinished |
|---|---|---|---|---|
| 2 | 11/16/19 | 0.2 | 0 | 0 |
| 3 | 10/12/16 | 0.4 | 15 (15, 0) | 0 |
| 4 | 10/12/16 | 0.3 | 19 (19, 0) | 0 |
| 5 | 10/13/15 | 0.1 | 18 (18, 1) | 0 |
| 6 | 9/12/14 | 0.5 | 19 (19, 0) | 0 |
| 7 | 11/13/17 | 0.9 | 19 (18, 1) | 0 |

### After WS6 (the release candidate)

`node scripts/sim.ts 100 "" on N` and `... off N` for N = 3 to 7 (100 games each, unfinished 0 everywhere):

| Players | Turns on | Turns off | Longer | Rounds med on / off | Siege reached on / off | Olympus wins on / off | Casts per game (games with a cast) | Lockouts |
|---|---|---|---|---|---|---|---|---|
| 3 | 39.6 | 39.5 | 0% | 13 / 13 | 76% / 77% | 72% / 71% | 0.92 (57%) | 1 |
| 4 | 50.6 | 48.9 | 3% | 12 / 12 | 96% / 96% | 88% / 89% | 1.13 (65%) | 9 |
| 5 | 68.7 | 64.4 | 7% | 14 / 13 | 97% / 94% | 93% / 88% | 1.86 (84%) | 9 |
| 6 | 80.3 | 74.7 | 7% | 13 / 13 | 97% / 98% | 92% / 94% | 2.53 (88%) | 26 |
| 7 | 96.7 | 89.3 | 8% | 14 / 13 | 99% / 100% | 94% / 94% | 2.86 (92%) | 41 |

Casts by House over the 500 games with Ultimates on: Minerva 231, Ceres 192, Pluto 179, Jupiter 157, Mars 132, Diana 24, Apollo 15. The AI rarely finds Solar Flare or The Wild Hunt worth 3 cards (they pay off only with an attack behind them). Refused bot actions: 9 (5 players) and 5 (7 players) with Ultimates on, 13 (5 players) with them off, none in the other seven batches. This is the Rally case under Known issues (one episode is several refusals), and every game played on to its end with the new fallback. A seeded hunt after the fix (650 games at 4, 5 and 7 players) found no refusal and no stall.

### After WS3 (Ultimates in the engine, the AI casts)

`node scripts/sim.ts 30 "" on 3,4,5,6,7` and the same with `off` (30 games per count, unfinished 0 everywhere):

| Players | Turns on | Turns off | Rounds med on / off | Siege reached on / off | Olympus wins on / off | Casts per game | Lockouts |
|---|---|---|---|---|---|---|---|
| 3 | 41.3 | 38.0 | 14 / 12 | 83% / 67% | 80% / 57% | 0.83 | 0 |
| 4 | 51.8 | 47.0 | 13 / 12 | 100% / 100% | 83% / 93% | 0.90 | 2 |
| 5 | 67.8 | 68.0 | 14 / 13 | 100% / 97% | 97% / 93% | 1.67 | 0 |
| 6 | 75.6 | 73.8 | 13 / 12 | 100% / 97% | 100% / 93% | 2.53 | 8 |
| 7 | 94.0 | 87.7 | 14 / 13 | 93% / 100% | 87% / 93% | 3.07 | 13 |

Casts by House over the 150 games with Ultimates on: Minerva 67, Ceres 63, Pluto 53, Jupiter 48, Mars 28, Diana 10, Apollo 1. Games with Ultimates run 0% to 10% longer in turns. One 4-player game had 17 bot actions refused in a row (being looked into; the other 299 games had none).

`node scripts/pace-sim.ts 30` (Ultimates on for 3+): first PvP round med 4/3/3/3/3/3, game rounds med 13/15/13/14/14/13 for 2 to 7 players, unfinished 0.

## Decisions

- WS1: `defenseNote()` returns `'Keep'` for a House's Keep (it returned `''`), so the UI can name the Walls; `keepWalls()` gives the number (Walls plus `defKeep`).
- WS1: the bot treats each point on a Keep's highest defense die as 35% more defenders (calibrated on `odds.ts`: 6 defenders need 9, 12, 16 attackers for ~80% at +0, +1, +2).
- WS7, how the edge function was deployed: `index.ts` was uploaded as it is in the repository. The four engine files were uploaded as one-line re-exports of the committed files on GitHub, pinned to the commit (`export * from 'https://raw.githubusercontent.com/sloppycodes4L/institute-conquest/848a92ee5b70a524f5088bddb49587dc0c813420/supabase/functions/institute/engine/engine.ts'` and the same for `bot.ts`, `data.ts`, `cards.ts`). Supabase fetches them once, when it bundles the function. Reason: the function is now 214 KB, and uploading it through the Supabase tool means the agent re-types every byte in one message, which risks a typo in the server and may not fit in one message at all. The engine the server runs is byte for byte the committed one (hashes checked against `src/engine/`). The same file names are deployed as the spec lists; only their content differs. A later deploy can do the same with its own commit sha, or upload the files whole.
- WS5: `ult-hit` fires when an Ultimate leaves an icon on my banner (that is what its card points at). Where's Sevro? leaves none on its victim (its marks are on the map), so a Mars cast does not trigger it.
- WS5: `choose-primus` only runs in a .008 war. A war caught mid-Passage by the update finishes it without a lesson (its text would be wrong there).
- WS5: the 🎓 menu offered Replay only when every lesson of a group had been seen. House Ultimates has seven, two of which need a war to go a certain way (short of cards, Locked out), so a group now offers Replay as soon as one of its lessons has been seen, and shows ◐ until all are (`guide.ts` `paintMenu()`). This applies to every group.
- WS5: the group "Your General" is renamed "Your Primus" as specified; the older group "Primus" (swearing one in at a conquered Keep) keeps its name.
- WS4: the "New" badge and the gold box around the House Ultimates row in the mockup are the mockup's way of pointing at the change; the game shows the row like the other switches.
- WS4: Jupiter's quadrant chooser sits in the dock above the action bar (four buttons across), not at the right edge as drawn: the right edge holds the Regions and War Log panels at every width.
- WS4: for Jupiter the Target step offers each member of a public alliance but no "Whole alliance" choice (the storm spreads by itself; the pick decides whose Draft is capped).
- WS4: under Silenced the Draft bar shows Trade, Attack and Fortify greyed out and one "End Turn ▸" (it ends the Draft and the turn), as drawn. A "⚑ Move Standard" button is added because the rules still allow it.
- WS4: an icon's text opens on click or tap, in the banner under the strip (and as a hover title). A floating tooltip would be clipped by the scrolling roster.
- WS4: the `ultimate` log event carries `cut` (territory and armies lost, in pairs) for Stormfall and Rot, so the announcement can list the stacks.
- WS4: the announcement plays for every screen that replays the caster's move (rivals online, AI casts locally). The caster's own screen gets the headline banner and the War Log lines: it has just seen the preview.
- WS3: the AI is stateless, so it weighs a cast on every Draft action while it may cast (the sim decided once per turn). Its follow-up attacks are not a stored plan either: on the casting turn it attacks the hunted Standard with every stack of 4+ in reach, largest first, and takes every Glared fight it would win half the time or more, before its usual attacks.
- WS3: the AI's Mars picks are the 3 largest valid stacks of its target, with neutral stacks only to fill up (the sim valued the target's land only).
- WS3: the cooldown counter `ult.cd[seat]` counts own turns still blocked, the current one included, and drops at the end of each own turn except the casting turn. Same three blocked turns as the reference (which counted down at the turn start), but the number reads right on a banner ("Recharging 3" right after a cast, "1" on the last blocked turn).
- WS3: Stormfall always spreads to the target's public allies (the sheet: "If the target is in an alliance, every member's territories in that quadrant are cut to 5 as well"), whether or not the cast names the alliance. Only the targeted House's Draft is capped.
- WS3: Where's Sevro? with picks left out takes the largest valid stacks, the target's before the neutrals'. A cast with no valid territory at all is refused before any card is spent.
- WS3: under Pinned, the Standard cannot be moved by a card either (the reference only blocked the Fortify move). The rule says the Standard can't move.
- WS3: effects on a House that falls are dropped, and so are the Solar Flare, Wild Hunt, Revealed hand, Harvest and map markers of a caster that falls (`ultForget`).
- WS3: the `lockout` log event is visible to the same seats as the alliance's end (the members only, for a secret alliance). The Locked out icon reads the public `allyBan`.
- WS3: the `turn` log event now carries the reinforcements actually received (after Ultimate cuts and gains), and `skipped: true` on a Blacked Out turn.
- WS3: `tests/engine.test.ts` "leaving an alliance ... sit out a full round" now runs with Ultimates off (`delete s.ult`); the 2-turn lockout is tested in `tests/ultimates.test.ts`.
- WS2: the host's own House is never locked (the server passes `byHost` only when the host sets another seat). A locked player cannot change the House at all, not even back to Random; only the host can.
- WS2: `createGame` treats a pick that is not a House, or that an earlier seat already holds, as Random (the lobby rules already prevent both; this keeps a bad payload from breaking the deal).
- WS2: when every seat picked a House, the Sorting wheel does not open and the war goes straight to Choose your Primus. With some seats on Random, the picked seats are listed as already sorted ("· picked") and the wheel spins only for the others.
- WS2: the HUD says "Your Primus" for the leader in every war. Wars from before .008 still show the House-match badge and +1; .008 wars show the printed Passive with no badge. Cards say "PASSIVE · AS PRIMUS" in .008 wars.
- WS2: at 390 px the Primus cards go two a row (Mars: four rows) with the swear-in button stuck to the bottom of the box. Fitting seven cards in two rows on a phone would make them about 80 px wide and unreadable.
- WS2: the five-card box is 900 px wide, not the mockup's 880: with the game's box padding and border, 880 wrapped the fifth card to a second row.
- WS2: on a Primus card, "AS A CARD" shows the Active's name (the text before the colon), as in the mockup, with the full text on hover.
- WS1 AI tuning (pace grew more than 25% at 2, 6 and 7 players): (a) in the Draft the bot masses all its reinforcements on a border next to a Keep when that is enough to storm it this turn (`keepToStorm()` in `bot.ts`); (b) one attack ratio (1.4) for every target, so a neutral Keep is attacked with 19 or more (83%) instead of the old 1.5 special case. No rule or `BALANCE` value changed. Result: medians back at the baseline.
- WS1: the Keep line of the territory tooltip (`TERRAIN_INFO.keep` in `data.ts`) said "No walls"; it now describes the Walls. Not named in the spec, but it would contradict the rules otherwise.

## Known issues

- Before .008 and still there (found by the WS3 hunt, 1 game in 1,150): the AI answers a Rally it believes has room, the engine says "The Rally is full" (the rallier made a secret alliance after calling it), and the fallback `endDraft` is refused because armies are unplaced. **Fixed in WS6** (`botFallback()`: the Draft is placed, then ended; the AI loses the attack of that turn; rare). Before the fix: locally the AI gets past it by chance; on the server `runBots` gives up until the next request. WS6 fix: a fallback that places the Draft first (`index.ts`, `session.ts`, the sim scripts).
- Before .008 and still there: when the war ends on a conquest, the winner's last conquered territory shows 0 armies (`dominate()` clears `ts.mustMove` before `conquer()` can march in). The war is over at that point, so nothing reads it. Not fixed: out of scope.
- Before .008 and still there: a territory can stand at 0 armies after a battle its honor guard or its ambushers won. An Ultimate does no damage to such a territory; Where's Sevro? seizes it with 1 army.

## Session log

- 2026-10-03 s1: first run. Read spec, README, engine, reference diff. Baseline tests (245) and build pass. Backup `008-ws0-start`. Fixtures saved. Launch config added. Baseline sims started.
- 2026-10-03 s1: baseline sims recorded. WS1 backup. WS1 engine, odds, bot, UI notes, copy and tests done; sync:fn; 247 tests pass. After-WS1 sims running in the background.
- 2026-10-03 s1: WS1 pace +17-29%, so the bot was tuned (Keep storming in the Draft); pace back at baseline. Browser check done. Tests 247 pass, build passes. WS1 complete.
- 2026-10-03 s1: WS2 backup. WS2 engine (picks, pickHouse, Choose your Primus, printed Passives), server op setHouse, session, lobby and local pickers, wheel, modal, CSS, log copy and tests written; tsc clean.
- 2026-10-04 s2: follow-up patch .0081 (asked for after the .008 report): a Patch notes button on the title screen beside the Sound checkbox, desktop widths only (hidden at 900 px and below), opening a modal with one fold per patch (`src/ui/patch-notes.ts`, `modalPatches()` in `app.ts`, styles at the end of `style.css`, `tests/patch-notes.test.ts`). Entries: .0081 and .008 (open by default). 307 tests pass, build passes, checked in the browser at 1366, 901 and 375 px. No engine change, so no edge function redeploy. Pushed as its own commit (v.0081).
- 2026-10-04 s2: WS7 done. Pushed 848a92e, Pages green, edge function version 6, live bundle and title screen show .008, smoke test passed on the first run. DEPLOYED.
- 2026-10-04 s2: WS6 done: AI fallback fix and test, 100-game sims, section 10 table filled (4 more browser checks: Ultimates Off, effects and marks clearing, Silenced AIs, hot-seat), version .008, release check. 306 tests pass, build passes. READY TO DEPLOY.
- 2026-10-04 s2: WS5 done: lessons, menu groups, guide tests, rules text, README, smoke script. 305 tests pass, build passes, lessons checked in the browser.
- 2026-10-04 s2: resumed (tests 291, tsc clean). WS4 browser check finished at 1366, 1920 and phone width. Two bugs found and fixed, both a CSS class shared by accident: the announcement's wrapper had the Ultimate button's class `ult` and painted a dark panel over the whole map (now plain `showcase`); the skipped-turn headline's class `big` also styled the Continue button (now `ttl`). 4 tests added ("what the screen shows"). 295 tests pass, build passes. WS4 complete.
- 2026-10-03 s1: WS4 stages A to D written (ultimates.ts, copy lines, settings row, button, icons, cast flow, announcement, skipped-turn screen, restrictions, Revealed panel, odds notes, map marks). tsc clean; ultimates and guide tests pass. Browser: settings row, button states, icons and a full Mars cast verified.
- 2026-10-03 s1: refused-action hunt (1,150 seeded games): the only refusal is a bot answering a Rally that is secretly full (before .008; 1 game). To fix in WS6 with a sturdier AI fallback.
- 2026-10-03 s1: WS3 sims recorded (on and off, 30 games per count, all finish). WS3 complete. WS4 backup made; mockup screens 06-17 and the sheet's icons read.
- 2026-10-03 s1: WS3 AI (bot.ts), tests/ultimates.test.ts (38 tests), scripts/sim.ts, odds.ts on battleMods. 291 tests pass, build passes. WS3 sims (30 games per count, on and off) running in the background.
- 2026-10-03 s1: WS3 backup. Read the design sheet, reference sim.ts, unitU.ts, unitU2.ts. Ported the Ultimates into engine.ts (two patches, 45 edits); tsc clean; sync:fn; 253 tests pass.
- 2026-10-03 s1: WS2 browser check done (local setup, wheel, Choose your Primus, hot-seat, 390 px, War Council with a stand-in session). 253 tests pass, build passes. WS2 complete.
