# Patch .008: House Ultimates, walled Keeps, House pick and Choose your Primus

The build spec for version .008. One agent builds it in seven workstreams and deploys it.

- **Patch notes this implements:**
  1. Build the House Ultimates.
  2. Make Ultimates an option when a war is created.
  3. Taking a neutral Keep no longer hands over that House's land. A Keep gives its holder Walls instead.
  4. Players pick their House (the host can also assign it) and pick any Character of that House as their Primus. This removes the Passage.
  5. Update the tutorial for all of the above.
- **Scope:** engine (`src/engine/`), server (`supabase/functions/institute/`), UI (`src/ui/`, `src/style.css`), tests, scripts, README. The engine changes, so the deploy includes `npm run sync:fn` and an edge function redeploy.
- **Rules source for Ultimates:** the design sheet, [`docs/house-ultimates-sheet.html`](house-ultimates-sheet.html) (live at https://claude.ai/artifact/5a6Q8CzKi7QWzhKasPQyUw). Its rule text, status icons and cast prompts are the target. Section 5 below is the summary and says where the build goes beyond the sheet.
- **Mockup of the new screens (approved 2 October 2026):** https://claude.ai/artifact/8th6GWBj8efu78UGwJQSy1, with a local copy at [`docs/patch-008-mockup.html`](patch-008-mockup.html). Open it in a browser and use the left rail to step through 20 screens. Its copy, layout and states are the target for sections 4.1, 4.2, 6 and the two lesson cards in 8.1. It draws the 3D map as flat hexes and does not cover the phone layout.
- **Reference implementation:** `C:\Users\jjsot\Desktop\institute-conquest\.reference\ult-sim-v5\` (outside the project, not deployed). Its `engine/engine.ts` is the v.0071 engine plus the Ultimates behind env switches, and its `sim.ts` holds the bots' Ultimate logic. Read its `README.md` first.
- **Workstreams and kick-off prompts:** sections 12 and 13.

---

## 1. Goals

- A House that is losing has one strong move against the leader, and everyone can see what it did and how long it lasts.
- A Keep is a fortress worth holding. It is no longer a shortcut to a whole slice of the map.
- Players choose who they are (House and Primus) before the war instead of being dealt it.
- A first-time player can learn all of it from the Proctor's Guide and the rules.

## 2. Decisions (locked)

| Question | Decision |
|---|---|
| Which Ultimate rules | **"v5 as written"** on the design sheet. **No deserter bar.** Jupiter's Draft cap hits only the targeted player. Diana blocks reaction cards against the hunters. Cost is 3 cards, cooldown is 3 of the caster's own turns. The sheet's "with deserter bar" columns and its older proposals are history, not rules. |
| Ultimates on or off | A War Settings switch, **On by default**. With 2 Houses it is Off and disabled. |
| Keep Walls | The defender of **any Keep** (a House or a neutral garrison) gets **+1 on its highest defense die**. It stacks with `defKeep` Passives. |
| Neutral Keep taken | The captor gets the Keep and that House's Standard (so it owns the House: its cards are boosted and its Proctor answers). **No other territory changes hands.** |
| House pick | In the lobby (online) and on the setup screen (local). First come, first served, no duplicates, **Random** by default. The host can set any seat's House, AIs included. A House the host set is locked for that player until the host sets it back to Random. |
| Primus pool | Any Character of **your own House** (5 choices, 7 for Mars). |
| House-match +1 | **Retired for .008 wars.** Every Primus is now from its own House, so a Primus's Passive works at its printed value. (Keeping the +1 would raise every Passive in the game and put Cassius-type Keeps at +3 on the highest defense die.) |
| Names | The UI says **Primus** ("Choose your Primus"; rules: "your Primus is your General"). The engine keeps `player.general`, the phase id `'passage'` and the `choose` action, to limit churn and stay compatible with wars in flight. |
| Mars's picks | 3 territories held by the target (any member, against an alliance) or by neutrals. Not other rivals. |
| Secret alliances | Ranking for eligibility sums real alliances, secret ones included (as simulated). The "whole alliance" target and Stormfall's spread to allies only apply to **public** alliances. A secret ally of the target is treated as a separate House. |
| Who sees "Ultimate ready" | Everyone sees the icon on an eligible House's banner (eligibility is public math). It glows only for its owner, and only when they hold the cards. |
| Standing | The Ultimate panel shows each party's standing by the Ultimates' Win % (40/40/20). The Proctors' Book keeps its own formula and is not changed. |
| AI and alliances | The AI casts when it is eligible. It **never leaves an alliance to become eligible** (the sim's walk-out behaviour is not ported). |
| Audio | **No new audio files.** Reuse existing effects (`boom`, `scream`, the horn, card sounds). The user auditions new audio before it ships, so it is out of scope. |
| Deploy | The agent deploys at the end (WS7), only if every acceptance item passes. |
| Diana's reaction cards (sim, 1,500 games per variant) | Kept blocked. Letting them work barely changed bot games: the hunted House held a reaction card in 18% of Hunts, and where it played one (11 Hunts) the hunters still took the House in 10; the eleventh Hunt also failed with reactions blocked. |

## 3. Keeps (WS1)

**Rule changes**
- `captureStandard()` in `engine.ts`: when a neutral House's Standard is taken, delete the branch that flips its neutral territories to the captor (the `neutralFall` event). Keep `stdCaptured`. Keep the `neutralFall` line in `copy.ts` so old War Logs still read correctly.
- New `BALANCE.keepWall = 1`. `defenseMods()`: when `to` is a Keep, add `keepWall` to `defHigh`, for a House and for neutrals. It must also apply to Standard charges and show in `odds.ts` (`attackFight`, `standardFight`, `defenseNote`).
- A neutral Keep is now: exactly 10, 2 dice, Walls (+1 highest die), never yields to Overwhelm.

**Follow-through**
- Copy: `RULES_HTML` ("Keeps have no walls" and the neutral Keep sentence), README (Neutrals, Keeps), the `neutral-keep` Tip. Recompute every quoted number with `odds.ts` (today: "15 armies take it ~83%", "Bring about 15", "10 armies beat 1 army plus a 5-strong guard ~80%").
- AI: `bot.ts` must still take neutral Keeps (re-tune its thresholds for the Walls) and must not expect free land afterwards.
- Tests: update the two Keep tests in `tests/engine.test.ts` ("a neutral Keep: exactly 10, no walls…", "a House's Keep has no walls…"). Add: a neutral Keep's fall leaves every other neutral territory neutral; the captor owns the House; Walls apply to House and neutral Keeps and stack with `defKeep`.
- Pace: run `node scripts/pace-sim.ts 40` and `node scripts/sim.ts 20` before and after WS1 and record both in the progress file. If any bot game no longer finishes, or median rounds grow by more than 25%, tune the AI (not the rules) and log what changed.

## 4. House pick and Choose your Primus (WS2)

### 4.1 House pick

- **Engine:** `createGame(names, rng, { ai, settings, houses })`, where `houses?: (number | null)[]` holds each seat's pick (`null` = Random). `dealHouses()` gives picked seats their House and draws the rest at random from what is left. Slices are still spread and dealt at random: the pick chooses the House, not the position. The `sorted` log event gains `picked: boolean`.
- **Server (`index.ts`):** `LobbySeat` gains `house?: number | null` and `houseBy?: 'host'`. New op `setHouse { seat?, house }`: a player sets their own seat unless the host locked it; the host sets any seat (that locks it; the host setting `null` unlocks it and returns it to Random). A taken House is refused ("House Mars is taken."). `join` starts on Random. `kick` and `removeBot` keep everyone else's pick. `start` passes the picks to `createGame`. No database migration: `lobby` is JSON.
- **The pick rules live in one pure, exported engine helper** (for example `pickHouse(lobby, seat, house, byHost)` returning the new lobby or an error). The server op and the local setup screen both call it, and vitest covers it, because the server itself cannot be exercised before WS7.
- **Client:** `OnlineSession.setHouse()`. In `showLobby()`, each seat row gets a House picker (the seven Houses with their colours, plus Random); taken Houses are disabled; rows the viewer cannot edit are read-only and show "set by host" when locked. `showLocalSetup()` step 1 gets the same picker per seat. Practice war stays Random.
- **The Sorting wheel** (`showWheel`) only spins for Houses that were drawn at random. A player whose House was picked skips it. Its button becomes **Choose your Primus ▸**.

### 4.2 Choose your Primus (replaces the Passage)

- **Engine:** `createGame` deals `priv.passage[seat]` = every Character of that seat's House. The deck starts with everything else. When the last player has chosen, the unchosen options are shuffled into the deck. Nobody dies: `killed` stays empty and the `passage` log event carries no `killed` card. `GameOpts.pick = true` marks a .008 war; a war without it finishes the old Passage (two cards, the other dies).
- **House-match +1:** `generalPassive()` and `passiveValue()` return the printed value when `opts.pick` is set. Wars without it keep the +1.
- **UI:** the Passage modal in `renderModals()` becomes **Choose your Primus**: one card per option with its Passive, wrapping to two rows on narrow screens (7 cards for Mars at 390 px), pick then confirm. The top bar reads `CHOOSE YOUR PRIMUS`. The waiting modal reads "Waiting for the other Houses to choose." Rivals' picks stay secret (`'?'`) until everyone has chosen, as today. Remove the Passage flavour text and the scream on the `passage` event for .008 wars.
- **AI:** `bot.ts` scores every option with its existing `score()` and picks the best.
- **Fix while here:** in hot-seat, `onModalClick('choose')` calls `this.modal(null)` after `send()`, which wipes the handoff screen (known issue from .007).
- **Tests:** update "the Passage kills one card per player and starts the war" and "hide other hands and passage picks". Add: picked Houses are honoured and never duplicated; Random fills the rest; the options are exactly the House's Characters; unchosen Characters end up in the deck; printed-value Passives in .008 wars; a pre-.008 state mid-Passage still completes.

## 5. House Ultimates: rules (WS3)

### 5.1 The setting

`WarSettings.ultimates: boolean` (default `true`), carried by `DEFAULT_SETTINGS`, `cleanSettings()` and `resolveSettings()`. `GameOpts.ultimates` is `true` only when the setting is on **and** there are 3 or more players. `createGame` creates `s.ult` only then. A war without `s.ult` plays exactly as today.

### 5.2 Who can cast, and when

| | |
|---|---|
| Unlocks | Round 4, counted by a real round counter (`s.ult.round`, +1 each time the turn order wraps). |
| Win % | 40% territory share + 40% army share + 20% PvP-win share, among living players. An attacker's win counts when it takes a House's territory; a defensive win counts once per territory per enemy turn. |
| Parties | Solo players, and alliances with their members' Win % added. |
| Eligible | The bottom `floor(parties / 2)` parties, checked at the start of your turn. |
| Cost | 3 unlocked cards, at least 1 from your birth House. Cast during your Draft. It gives no +10 armies and counts as the forced trade at 5 cards. |
| Cooldown | 3 of the caster's own turns. |
| Target | One living rival, or a whole public alliance (every living member, with each House's alliance version). Never an ally. |
| Limits | Damage never takes a territory below 1. The territory holding a Standard is immune. A House only falls when its Standard is captured. |
| Alliance lockout | With Ultimates on, leaving an alliance (walking out, answering a Rally, attacking an ally) bars you from every alliance for 2 of your turns. With Ultimates off, today's rule stays. |
| Timing | Lasting effects tick at the start of the **target's** turn. Flares and Hunts end at the start of the **caster's** next turn. |

### 5.3 The seven Ultimates

| House · Ultimate | vs one player | vs an alliance | Icons |
|---|---|---|---|
| **Mars** · Where's Sevro? | Pick 3 territories held by the target or by neutrals, in quadrants where Mars holds land. On each, half the armies die (rounded down) and the rest join Mars with the territory. Never a Keep, never a Standard's territory. | The 3 picks may come from any member. | Map: Seized, until Mars's next turn |
| **Jupiter** · Stormfall | Pick a quadrant. Every territory the target holds there above 5 armies is cut to 5. The target's next Draft is capped at 5 (trades still add). | Every member's territories in that quadrant are cut. Only the targeted player's Draft is capped. | Storm-bound; map: Storm-struck |
| **Pluto** · Rot | Stacks of 5+ lose 30% on cast, 20% at the target's next turn, 10% the turn after (a stack under 5 stops). The target's next three Drafts are cut 30%, 20%, 10%. | First two ticks only, stacks and Drafts. | Rot |
| **Minerva** · Blackout | The target's next turn is skipped entirely. The caster sees the target's whole hand until the caster's next turn. | Each member's next turn: Draft −60%, no cards, attacks or Fortify. No hand reveal. | Blacked Out, Revealed · Silenced |
| **Ceres** · The Tithe | The target's next Draft −50%, the one after −25%. The caster gains the same on its own next two Drafts, at most 100 in total. | Each member −30%, then −15%. The caster collects the totals (same cap). | Tithed, Harvest |
| **Apollo** · Solar Flare | Until the caster's next turn, the target's highest defense die is −1 against the caster and the caster's allies. On the casting turn the caster gets +1 on its highest attack die against the target. | The same for every member. | Glared, Radiant |
| **Diana** · The Wild Hunt | Until the caster's next turn, against the caster and the caster's allies: the target's Standard has no honor guard and the target cannot spring reaction cards. On its next turn the target cannot move its Standard or Fortify. The caster and every ally get Long Strike (attack 2 spaces away, any target, any number of times) until the caster's next turn. | The same for every member. | Hunted, Pinned, Long Strike |

Also on banners: **Ultimate ready**, **Recharging** (turns left), **Locked out** (turns left).

### 5.4 Porting from the reference engine

The reference engine runs these rules with `V5U_MARS V5U_MARS_QUAD V5U_JUP V5U_JUP_DRAFT V5U_ROT_MIN=5 V5U_ROT_DRAIN V5U_CERES_TOTAL=100 V5_APOLLO_HI V5U_DIANA_LS V5U_LOCKOUT=2 V5_NOLOCK`. Port the code paths those switches select and delete the rest. The shipped engine has **no `process.env`, no `V5` object and no switches** (it also runs in Deno).

- **Port:** `UltState`, `UltEffect`, `UltCastRec`, `winScores`, `partiesOf`, `bottomHalfSeats`, `ultDamage`, `ultEffectOn`, `flareCasterBonus`, `ultStartTurn`, `ultEndTurn`, `noteAttacked`, `ultCardsOk`, `castUlt`, the Wild Hunt's Long Strike (`huntReach`, `dianaLS`, `spendsLongStrike`), the `ultMuted` and `ultPinned` turn flags and every check that reads them, the round counter in `advance()`, the PvP counters, the skipped turn in `startTurn()`, the 2-turn lockout.
- **Drop:** `enableUlt` (create `s.ult` in `createGame`), `ULT_HOOK`, the `_t` and `_r` fields on log events, `ultWalkOut`, pair locks (`locks`, `lockExp`, `left`, `prevStart`, `leftR`, `ultLocked`, `lockBlocks`), the `sap` rider, the v4 Mars and Jupiter branches, `ceresCap`, `dianaHalf`, `dianaReach`, `dianaReact`, `dianaReactOwn`, `desert`, `settle`.
- **Add (not in the sim):**
  - `Action`: `{ type: 'ultimate'; target; alliance; cards; picks? }`. Mars's `picks` are validated against section 2 (target's or neutral land, Mars's quadrants, no Keep, no Standard); fewer than 3 valid picks is allowed only when fewer exist. Jupiter's `picks[0]` is the quadrant.
  - `ultBlocker(s, seat)`: why `seat` cannot cast right now, or `null` (round, standing, cooldown, cards, Blackout). The UI and the AI both use it.
  - Minerva's reveal: `viewFor(s, seat)` includes the target's hand for the caster while the Revealed effect lasts. It is the only way a hand leaves the server for a non-owner.
  - Public alliances only for the alliance target and Stormfall's spread (section 2).
  - A log event for every army an Ultimate moves, kills or denies, on cast and on each tick, so the War Log and the replay frames explain it: `ultimate` (with `picks`), `seized`, and an `ultTick` for Rot, Tithe, Harvest, Storm-bound, Silenced and the skipped turn. Every map change goes through the same snapshot path as other actions so online clients replay it.
  - `simulate()` in `app.ts` must be able to preview a cast (section 6.2).

### 5.5 Tests (`tests/ultimates.test.ts`)

Port every check in `unitU.ts` and `unitU2.ts` to vitest, and add:
- Setting off, or 2 players: no `s.ult`, `ultimate` is refused, state and views match a pre-.008 war.
- Eligibility: nothing before round 4; exactly the bottom `floor(parties / 2)`; alliances ranked as one party; cooldown of 3 own turns.
- Cost: 3 unlocked cards, one from the birth House; no +10; the forced trade is satisfied.
- Each House, vs one player and vs an alliance: the numbers in section 5.3, rounding included.
- Never below 1; Standard territories immune; Mars never takes a Keep.
- Blackout skips the turn and the turn clock; Silenced blocks cards, attacks and Fortify; Pinned blocks Fortify and moving the Standard.
- Revealed: the caster's view holds the target's hand until the caster's next turn; nobody else's does.
- Hunt: guard 0 and no reaction prompt against the caster's party only; Long Strike for the party; ends at the caster's next turn.
- Flare: −1 on the highest defense die against the party; +1 for the caster on the casting turn only.
- Lockout: 2 own turns after walking out, answering a Rally or betraying, then free to ally with anyone.
- 5 bot-vs-bot games per player count 3 to 7 with Ultimates on all finish, with at least one cast somewhere (the 100-game runs are in WS6, outside the test suite).

## 6. House Ultimates: UI (WS4)

The mockup (`docs/patch-008-mockup.html`, screens 00 and 06 to 19) is the target for everything in this section: match its copy, layout, states and colours. Its styles are a scoped copy of `src/style.css`, so build with the game's existing classes (`.seg`, `.btn`, `.modal .box`, `.cards-row`, the showcase overlay, the roster banners) and add new rules only for the new pieces. Where the mockup and this text differ, the mockup wins on look and wording, and this text wins on rules.

### 6.1 Create stage
`settingsHTML()` gets a row after Siege on Olympus: **House Ultimates** *(comeback powers)*, On / Off, with the note "From round 4, Houses in the bottom half can spend 3 cards to strike the leader." With fewer than 3 Houses the switch shows Off, is disabled, and the note reads "House Ultimates need 3 or more Houses." It appears in Local step 2 and in the War Council (read-only for guests). `applySetting()` and Reset handle it.

### 6.2 Casting
- **The Ultimate button** sits with the Draft controls in `renderActionBar()` whenever the war has Ultimates, labelled with the House's Ultimate ("⚡ The Wild Hunt"). Its state comes from `ultBlocker()`: *Opens in round 4* · *Top half: no Ultimate* (with the standing) · *Recharging: n turns* · *Needs 3 cards, 1 from House X* · **Ready** (glows).
- **The cast flow** (one modal, steps in order, Back at each step):
  1. **Target.** Every rival party, ranked by Win %, the leader marked. A public alliance can be picked whole ("every member, weaker hit") or one member at a time.
  2. **Cards.** Pick 3; the birth-House card is required and preselected with the two cheapest others. Shows "Replaces a trade: no +10 armies."
  3. **Mars only:** pick 3 territories on the map (valid ones glow; the count shows "2 of 3"). **Jupiter only:** pick a quadrant, each one showing how many armies it would cut.
  4. **Preview.** The exact outcome on the map and in numbers, using the existing preview (`simulate()`, changed territories lit, Commit / Back). Random parts do not exist in any Ultimate, so the preview is exact.
- Standing: the Target step shows every party's Win % and where the cut-off for casting sits.

### 6.3 Seeing what happened
- **Announcement:** every cast plays for everyone as a showcase, like a played card: House emblem and colour, the Ultimate's name, the cast prompt from the sheet (for example "They were in the dead horses…"), the targets and the numbers. It respects replay speed and Skip.
- **War Log lines** in `copy.ts` for `ultimate`, `seized`, each `ultTick`, the skipped turn and the lockout.
- **Status icons** on roster banners (`renderRoster()`), copied from the sheet: the ring says buff, debuff or restriction; the dot is the causing House's colour; the number is the bearer's turns left (no number: ends at the caster's next turn). Hover or tap shows the sheet's one-line text. The viewer's own icons also show by their Primus (`renderGeneral()`).
- **Map markers:** Seized on the 3 territories until Mars's next turn; Storm-struck shading on the quadrant until Jupiter's next turn.
- **When it hits you:** a skipped turn shows a short screen ("Blacked out by House Minerva: your turn was skipped"). Under Silenced or Pinned, the blocked buttons are disabled and say why.
- **Revealed:** the Minerva caster can open the target's hand from the target's banner while the icon is there.
- **Odds:** every odds chip, the odds tip and the fallen-House math include Walls, Glared, Radiant and Hunted. Long Strike targets light up for the hunting party.

### 6.4 Layout
Works at 1920, 1366 and 390 px wide: the icon strip wraps inside the banner, the cast flow fits the phone layout, nothing scrolls sideways. Every new animation turns off under `prefers-reduced-motion`.

## 7. AI (`bot.ts`)

Port the casting logic from the reference `sim.ts` into `bot.ts`, working from the bot's own view (public state plus its own hand):
- `bestOption` (target choice), `directValue` (Mars, Jupiter, Pluto, Minerva, Ceres), `planFollow` with `mcBlitz` (Apollo and Diana need a follow-up attack). Thresholds: cast when the value is 20 or more; Diana only when the Standard attack would then win 70% or more. Apollo and Diana may hit any party ranked above the caster's own; the others hit the Win % leader.
- From round 3, keep one birth-House card out of trades and plays (`pickCards`, `botView`).
- After an Apollo or Diana cast, carry out the planned attacks that turn.
- Mars picks the 3 largest valid stacks; Jupiter picks the quadrant with the largest cut.
- Never walk out of an alliance to become eligible.
- Under Blackout, Silenced or Pinned, never send an action the engine will refuse.
- Monte Carlo draws use the rng passed to `botAction`, so games stay deterministic for a seed.

## 8. Tutorial, rules and README (WS5)

### 8.1 Lessons (`lessons.ts`, `guide.ts`, `tests/guide.test.ts`)

Same step types and copy rules as the .007 spec (`docs/proctors-guide-007.md` section 3): one idea per card, two sentences at most.

| id | Type | Fires when | Ends when | Spotlight / pulse | Copy |
|---|---|---|---|---|---|
| `choose-primus` (replaces `passage`) | Read | The Choose your Primus modal is open for me | Got it | the modal's `.cards-row` | **Choose your Primus.** Pick any Character of your House. Their **Passive** works for you all war. |
| `ult-open` | Tip | Ultimates are on and round 4 has begun | 6 s | pulse the Ultimate button | House Ultimates are open. Houses in the **bottom half** can spend 3 cards to strike the leader. |
| `ult-ready` | Read | My Draft, the button is Ready, first time | Got it | the Ultimate button | **Your Ultimate is ready** / You're in the bottom half, so you may cast **{name}**: {one line from the sheet}. It costs 3 cards (one from House {X}) instead of a trade, then recharges for 3 turns. |
| `ult-short` | Tip | My Draft, eligible but short of cards, first time | 6 s | none | You may cast your Ultimate, but it needs **3 cards, one from House {X}**. Keep one in hand. |
| `ult-target` | Tip (pinned) | The cast flow opens for the first time | The flow closes | none | Pick one House, or a whole public alliance for a weaker hit on every member. Nothing happens until you **Commit**. |
| `ult-hit` | Read | An Ultimate targets me for the first time (after its showcase) | Got it | my banner's icon strip | **{Name} hit you** / The icons on your banner show what is on you and for how many of your turns. Hover one to read it. |
| `ult-status` | Tip | A status icon appears on a rival for the first time | 6 s | none | Icons on a banner are lasting effects. The number is the turns left. |
| `lockout` | Tip | I become Locked out for the first time | 6 s | none | You left an alliance, so you can't join another for 2 of your turns. |

- Read steps follow the .007 timed-war rule (never block in a timed war).
- 🎓 menu: rename the group **Your General** to **Your Primus** (`choose-primus`); add **House Ultimates** (the seven `ult-*` and `lockout` ids).
- Update the `neutral-keep` Tip for Walls with the recomputed army count. Check every other lesson's copy for "General", "Passage" and Keep rules that changed.
- Practice war has 2 Houses, so Ultimates are off there. The lessons fire in the player's first 3+ House war.

### 8.2 Rules and README
- `RULES_HTML` (`copy.ts`): replace the Passage section with **Choose your House and Primus**; rewrite the Keeps and neutral Keep text (Walls, no land hand-over); add a **House Ultimates** section (section 5.2 as prose, the seven Ultimates as a table, the status icons); the lockout in the Alliances text; the Ultimates switch in the settings text.
- README: How it plays (War settings, the Sorting, Neutrals, Keeps, the Passage entry becomes Choose your Primus, a new House Ultimates entry), Architecture and Develop (new test file, the Ultimates in `sim.ts`).
- `scripts/sim.ts` prints casts per game and runs with Ultimates on by default for 3+ players.
- `scripts/smoke-online.ts`: pick a House with `setHouse` before starting, count the Ultimates cast, and make its reinforcement check allow for Ultimate Draft cuts (Tithe, Rot, Storm-bound, Silenced).

## 9. Wars in flight

Online wars created before .008 keep running on the new engine:
- They have no `opts.ultimates`, so no Ultimates.
- They adopt the new Keep rules at once (Walls, no land hand-over).
- A war caught mid-Passage finishes it the old way (no `opts.pick`), and its General keeps the House-match +1.
- Every new state field is optional. The state stays `v: 2`.

## 10. Acceptance criteria

- [ ] War Settings shows House Ultimates, On by default, in Local and in the War Council. With 2 Houses it is Off and disabled. A war started with it Off has no Ultimate UI at all.
- [ ] Lobby: a player picks a House; a second player cannot pick the same one; the host assigns and locks a House for a player and for an AI; Random seats get a House nobody picked. Local setup does the same.
- [ ] The wheel only spins for random Houses. Every player then sees Choose your Primus with exactly their House's Characters, picks one, and the war starts. No Passage text remains anywhere in a .008 war.
- [ ] Taking a neutral Keep changes one territory, captures that House's Standard, and leaves the rest of its land neutral. Odds against any Keep include the Walls.
- [ ] From round 4, a bottom-half House with the cards can cast. A top-half House, a House on cooldown and a House without a birth-House card cannot, and the button says why.
- [ ] Each of the seven Ultimates, cast once against one player and once against a public alliance in the running game, does what section 5.3 says, and the preview matched the result.
- [ ] Every lasting effect shows the right icon and count on the right banners and disappears on time. Seized and Storm-struck show on the map.
- [ ] Blackout skips a human player's turn with an explanation. Silenced and Pinned disable the right buttons with a reason.
- [ ] The Minerva caster, and nobody else, can read the target's hand until the caster's next turn (checked in an online war with two browsers, or with `viewFor` in a test).
- [ ] Leaving an alliance with Ultimates on shows Locked out for 2 turns, and invites are refused until it clears.
- [ ] AI Houses cast Ultimates in a local war, follow up Apollo and Diana casts, and never stall under Blackout, Silenced or Pinned.
- [ ] The server's new code paths (`setHouse`, `start` with picks, the Revealed view) are covered by tests of the engine helpers they call. The live online check is in WS7, because the dev build talks to the production server.
- [ ] Hot-seat: the handoff screen survives choosing a Primus; no Ultimate UI leaks another player's hand.
- [ ] Guide: `choose-primus` replaces `passage`; each `ult-*` lesson and `lockout` fires once and replays from 🎓; no Read step blocks in a timed war.
- [ ] Rules (?) and README describe House pick, Choose your Primus, Walls, neutral Keeps and House Ultimates, with recomputed odds.
- [ ] Every screen in `docs/patch-008-mockup.html` has its counterpart in the game with the same copy, states and layout, checked side by side at 1366 px.
- [ ] Layout holds at 1920, 1366 and 390 px. `prefers-reduced-motion` turns off the new animations.
- [ ] `npm test` passes: the existing suites updated, `tests/ultimates.test.ts`, the bot-vs-bot games, and "ships the exact same engine as the client" after `npm run sync:fn`.
- [ ] `npm run build` passes (tsc clean).
- [ ] Sim on the real engine, 100 games per player count 3 to 7: every game finishes with Ultimates on and with them off. Record turns, Siege reached, Olympus wins and casts per game for both in the progress file. Flag it in the final report if games with Ultimates run more than 20% longer.
- [ ] A state saved by the v.0071 engine (mid-Passage, and mid-war) loads and plays to the end on the new engine (a test with a fixture made from the WS0 backup).
- [ ] `src/version.ts` is `'.008'`.

## 11. Out of scope for .008

- New audio.
- The deserter bar, and any balance change to the Ultimates beyond section 5.
- Changes to the Proctors' Book formula.
- A scripted tutorial for Ultimates, or Ultimates in the 2-House Practice war.
- Renaming `general`, `passage` or `choose` in the engine.
- Translations.

---

## 12. Workstreams

One agent builds all seven **in order**. The Desktop folder is not a git repository, so the work is sequential and protected by backups and a progress file.

```
WS1 Keeps → WS2 House pick + Primus → WS3 Ultimates engine + AI → WS4 Ultimates UI → WS5 Tutorial + docs → WS6 QA + release prep → WS7 Deploy
```

| WS | Scope | Done when |
|---|---|---|
| **WS1** Keeps | Section 3 | Tests and build pass; pace numbers recorded; checked in a local war |
| **WS2** House pick + Primus | Section 4 (engine, server op, lobby, local setup, wheel, Choose your Primus, AI, tests) | A local war and the lobby UI work end to end; tests and build pass |
| **WS3** Ultimates engine + AI | Sections 5 and 7, `tests/ultimates.test.ts`, `scripts/sim.ts` | Every rule tested; bot games finish and cast |
| **WS4** Ultimates UI | Section 6 | Every Ultimate castable by a human in a local war, with icons, markers, log and showcase |
| **WS5** Tutorial + docs | Section 8 | Lessons fire once and replay; rules and README updated |
| **WS6** QA + release prep | Every section 10 item in the running game; fixes only; the sim; `version.ts`; the read-only comparison with GitHub `main` | Every section 10 item passes; the progress file says READY TO DEPLOY |
| **WS7** Deploy | Push to GitHub `main`, wait for Pages, redeploy the `institute` edge function, verify live, online smoke test | The live site shows `.008` and a full online war runs on the deployed server |

Progress, decisions and blockers live in `docs/patch-008-progress.md`, which the agent creates on its first run. That file is the agent's memory between sessions.

---

## 13. Agent prompts

### Kick-off (paste once into a new session opened on `C:\Users\jjsot\Desktop\institute-conquest`)

```
You are building and deploying version .008 of Institute Conquest: House Ultimates (a comeback mechanic), walled Keeps, House pick, and Choose your Primus in place of the Passage. You work autonomously across several sessions. The session can stop at any moment when the 5-hour usage limit is hit, and it resumes when the next window opens. Your job ends when .008 is live in production and verified, or when you are blocked.

DEFINITION OF DONE
- Workstreams WS1-WS7 in institute-conquest/docs/patch-008.md section 12 are complete, and every acceptance item in section 10 passes in the running game.
- src/version.ts is '.008'. npm test and npm run build pass.
- .008 is deployed: GitHub main pushed, the Pages build green, the institute edge function redeployed, the live site verified, and the online smoke test passed.
- docs/patch-008-progress.md says DEPLOYED, and you have sent the final report.

SOURCES OF TRUTH (read in this order before any work)
1. institute-conquest/docs/patch-008-progress.md: your checklist and memory between sessions. ALWAYS read it first, in every session and after every resume. If it doesn't exist yet, this is the first run: create it (see PROGRESS FILE).
2. institute-conquest/docs/patch-008.md: the spec. Sections 2-10 are the contract. Section 2 lists decisions that are already made: do not reopen them.
3. institute-conquest/docs/patch-008-mockup.html: the approved mockup of every new or changed screen (20 screens; open it in the browser and step through the left rail, and read its source for exact copy and styles). Match its copy, layout, states and colours. It draws the map as flat hexes; the real markers go on the 3D map.
4. institute-conquest/docs/house-ultimates-sheet.html: the Ultimates design sheet. Its rule text, status icons (inline SVG symbols) and cast prompts are the target. Its "with deserter bar" numbers and older proposals are history, not rules.
5. C:\Users\jjsot\Desktop\institute-conquest\.reference\ult-sim-v5\: the reference implementation (README.md first, then engine/engine.ts and sim.ts). Port from it as spec sections 5.4 and 7 describe. Never import from it and never copy its env switches.
6. institute-conquest/docs/proctors-guide-007.md section 3: the lesson step types and copy rules the tutorial follows.
7. institute-conquest/README.md, then the code the current workstream needs (the spec names the functions).

PROGRESS FILE (create it on the first run)
Use these sections:
- Status (NOT STARTED / IN PROGRESS (WSn) / BLOCKED / READY TO DEPLOY / DEPLOYED)
- Next step (precise: file, function, what's left)
- One checklist per workstream: "Before WS1" (read the sources; add the launch configuration; run npm test and npm run build on the untouched code; record the baseline numbers from node scripts/pace-sim.ts 40 and node scripts/sim.ts 20; save a mid-Passage and a mid-war game state from the untouched engine as test fixtures), then WS1 to WS7. Break each into the items in the spec section it covers. Start every workstream with a backup item.
- A section 10 pass/fail table (Result and Notes columns)
- Sim results (before and after, per workstream that changes the engine)
- Decisions, Known issues, and a Session log

RESUME PROTOCOL (the start of every session or resume)
1. Read the progress file. Find "Status" and "Next step".
2. If Status is BLOCKED, re-check the blocker. If it is still there, report it in one short message and stop. If Status is DEPLOYED, re-send the final report and stop.
3. Run npm test and npx tsc --noEmit to confirm the code matches what the progress file says. If the build is broken from an interrupted edit, fix that first.
4. Continue from "Next step". Don't redo checked items.

CHECKPOINTING (assume any message could be your last)
- Work in small steps. After each checklist item: make sure the code type-checks (npx tsc --noEmit), tick the item in the progress file, rewrite "Next step" precisely, and add a one-line entry to the Session log.
- Never leave a multi-file change half-applied at a checkpoint. Finish the edit set and type-check first.
- Before starting each workstream, copy src/, tests/, scripts/ and supabase/ to C:\Users\jjsot\Desktop\institute-conquest\.backups\008-<ws>-start\ (outside the project folder). There's no git locally; these backups are your rollback.
- After any change in src/engine/, run npm run sync:fn so supabase/functions/institute/engine/ matches (a test checks it). That only copies files locally. It deploys nothing.
- When the spec is ambiguous, choose what's closest to the design sheet and the spec's intent, log the choice under "Decisions", and keep going. Don't stop to ask.

ORDER OF WORK
WS1 → WS2 → WS3 → WS4 → WS5 → WS6 → WS7, one at a time. A workstream is finished only when its tests and build pass and you've checked it in the browser (WS3 is checked by tests and sims).

HARD RULES
- Nothing goes live before WS7: no git push, no commits to the GitHub repo, no edge function deploys, no changes to the database.
- Stay inside the spec. No extra features, no balance changes beyond spec section 5, no new audio files. Fixes in WS6 are the smallest change that works.
- The engine stays pure and deterministic: no process.env, no Date.now() or Math.random() outside the injected rng and now, nothing Node-only (it also runs in Deno on the server).
- A war created before .008 must keep playing on the new engine (spec section 9). Every new state field is optional.
- Platform: Windows. Bash is Git Bash and PowerShell is 5.1. Bash heredocs containing apostrophes fail here, so write scripts and long text with the Write tool. Node runs scripts/*.ts directly; scripts that import src/net/session.ts need node --experimental-transform-types. Several source files use CRLF line endings: match exact text with care.
- Other Claude sessions sometimes use this folder. If a file changes under you (an Edit fails because the file changed), re-read it, keep their changes, and continue. Note it in the Session log.

BROWSER VERIFICATION
- Never start dev servers with Bash. Use preview_start with a launch config. Add this configuration to C:\Users\jjsot\Desktop\institute-conquest\.claude\launch.json if it's missing (other sessions may hold other ports):
  {"name": "institute-008", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "institute-conquest", "run", "dev", "--", "--port", "5208", "--strictPort"], "port": 5208}
- Use local wars for the checks: 1 human with 2 or more AIs for Ultimates (they need 3 Houses), hot-seat with 2 or more humans for hand privacy and handoffs. The dev build talks to the production server for online wars, which runs the old engine until WS7, so do not create online wars before WS7. Check the lobby's House pick UI through tests and the local setup screen.
- To reach round 4 and an eligible House quickly, drive the war with the AI or set up the state through the engine in a test; do not add debug switches to the shipped code.
- Check 1920, 1366 and 390 px wide, and reduced motion.
- Record what you verified, with a screenshot reference, in the progress file. In WS6, fill in the section 10 pass/fail table.

RELEASE CHECK (last part of WS6, read-only)
1. Confirm src/version.ts is '.008', and that npm test and npm run build pass.
2. Clone https://github.com/sloppycodes4L/institute-conquest.git into your scratchpad. Diff it against the local institute-conquest folder.
3. In the progress file, list every file that would change in a deploy, split into: the .008 work, and anything else (local changes from other sessions, or files where GitHub looks newer than the local copy). Anything in the second group that you cannot explain is a blocker.
4. Confirm you can deploy: the Supabase tools answer a read-only call (get_edge_function for function "institute" on project hflggavblnedfgyjqbsr), and git in the clone can reach the remote (git ls-remote). If either fails, set Status to READY TO DEPLOY, report what is missing, and stop.
5. Set Status to READY TO DEPLOY and go straight on to WS7.

DEPLOY (WS7). The user authorized this deploy by starting this build. Do it only when every section 10 item passes.
1. In a fresh clone in your scratchpad, copy in the changed files from the release check list (src, tests, scripts, supabase, docs, README, and public only if it changed). Commit as the repository's existing author (use the name and email of the latest commit on main) with a message starting "v.008:". Push main.
2. Watch the GitHub Actions run for that commit (api.github.com/repos/sloppycodes4L/institute-conquest/actions/runs?head_sha=<full sha>) until it succeeds. If it fails, fix the cause locally, re-run the tests, and push again.
3. As soon as the Pages build is green, redeploy the Supabase edge function "institute" (project hflggavblnedfgyjqbsr, verify_jwt false, entrypoint index.ts, files index.ts and engine/data.ts, engine/cards.ts, engine/engine.ts, engine/bot.ts) with the full contents of the files in supabase/functions/institute/.
4. Verify: the live bundle at https://sloppycodes4l.github.io/institute-conquest/ contains '.008' and a string that is new in .008. Then run node --experimental-transform-types scripts/smoke-online.ts (update the script in WS6 if the new start-of-war flow needs it) and confirm a full online war with 3 or more Houses plays to the end on the deployed server with House picks honoured. Report how many Ultimates were cast; if none, run it again (up to 3 times).
5. If the live check or the smoke test fails, fix forward: find the cause, fix it locally, run the tests, and deploy again. If you cannot fix it in 3 attempts, restore the previous edge function and the previous commit's files from the clone's history, deploy those, set Status to BLOCKED and report.
6. Set Status to DEPLOYED with the commit sha.

FINAL REPORT (one short message)
What was built (WS1-WS7), test and build results, the section 10 table summary, the sim numbers before and after (turns, Siege reached, Olympus wins, casts per game), the commit sha and what was deployed, and everything under Decisions and Known issues. End with: "Reload https://sloppycodes4l.github.io/institute-conquest/ to play .008."

BLOCKED
Stop only for things you can't solve yourself: a spec requirement that contradicts another, a failure you can't fix after 3 attempts, unexplained differences from GitHub, or missing deploy access. Set Status to BLOCKED, write exactly what's wrong and what you need, and report in one short message.

Start now: follow the RESUME PROTOCOL.
```

### Resume (only if a session has to be started fresh instead of resumed)

```
Continue the .008 build of Institute Conquest. Read institute-conquest/docs/patch-008-progress.md first, then follow the kick-off prompt in section 13 of institute-conquest/docs/patch-008.md (RESUME PROTOCOL, CHECKPOINTING, HARD RULES, RELEASE CHECK, DEPLOY). Pick up at "Next step". You're done when the progress file says DEPLOYED and you've sent the final report.
```

### To build without deploying

Delete the DEPLOY block and step 5 of RELEASE CHECK from the kick-off prompt, and change "DEPLOYED" to "READY TO DEPLOY" in DEFINITION OF DONE. The agent then stops with a report, and .008 ships when you say "deploy".
