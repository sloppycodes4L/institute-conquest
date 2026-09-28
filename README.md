# Institute Conquest

A free, non-commercial fan game: Risk-style conquest set in the Institute from Pierce Brown's *Red Rising* (Book One).
3D in the browser (three.js), online multiplayer for up to 7 Houses, plus local hot-seat and AI Primuses.

> Not affiliated with or endorsed by Pierce Brown or his publishers. Contains violence and foul language.

**Play:** https://sloppycodes4l.github.io/institute-conquest/

## How it plays

- **War settings:** whoever creates the war picks the map size (Smaller … Larger, 77–140 territories) and starting troops (Fewer … Lots), can switch Alliances and the Siege on Olympus off, and can set a turn timer (None, 60, 90 or 120 seconds; when it runs out, unplaced armies go to the front and the turn passes). Everything defaults to the recommended settings.
- **The Sorting:** 2–7 players get Houses out of Mars, Minerva, Diana, Apollo, Jupiter, Ceres, and Pluto, revealed on a spinning wheel ("Start Selection"). The valley's seven slices keep their land (names, biomes, regions, the Frostfangs) from war to war, but Houses are dealt onto them at random: the players get the slices whose Keeps are furthest apart (then the fewest touching slices), any House can land on any of them, and the Houses nobody drew fill the rest as neutrals.
- **The valley** grows with the player count (77 territories for 2 players, 91 for 4, 112 for 7, at the recommended size). Each player starts holding the heart of their slice (the Keep and its neighbours); the rest is neutral, with thick garrisons on fronts that face another player (14) and on marches by a neutral House (6). In bot games the first player-vs-player fight comes around round 3 (round 4 with 2 players) (`node scripts/pace-sim.ts`).
- **Neutrals:** a lone neutral garrison rolls 1 defense die, and yields without a fight (no dice, no losses: *Overwhelm*) to an attack of twice its number. A neutral House's Keep holds exactly 10, with no walls or modifiers and 2 dice, and never yields (15 armies take it ~83% of the time).
- **Terrain:** attacking from ⛰ Mountains adds +1 to the lowest attack die that gets compared; a House defending a 🌲 Forest adds +1 to its lowest defense die. Terrain never counts against neutrals. Fortify marches go anywhere through your connected land. Zoom in to read territory names.
- **Keeps:** no walls. A House's Keep holds with its armies, the honor guard (it travels with the Standard) and Passives (defKeep, stdGuard, and any Primus): 10 armies beat 1 army plus a 5-strong guard ~80% of the time.
- **Primus:** conquer a Keep other than your home Keep and you may swear in a Character from your hand of that Keep's House as its Primus (on the spot, or in a later Draft). Its Passive stacks with your General's (no House bonus, not shared with allies); lose the Keep and the Primus is slain.
- **The Passage:** each player is dealt 2 Characters, keeps one as their General (Passive always on, +1 if the General is from the player's own House in the books), and the other dies.
- **Controls:** scroll zooms, left-drag pans, right-drag turns the camera. ◐ (G) greys out everything you don't hold; ⛰ (O) makes Olympus solid, see-through, or hidden. Click a House in the roster to light up its land. ⚙ Settings: the camera follows the action (on by default) and a clash of swords marks your turn.
- **Turn:** Draft (with −/+ and Undo) → Attack (unlimited; every target the selected territory can hit lights up) → Fortify, with Risk Global Domination dice (3 attack vs 2 defense dice, ties go to the defender).
- **The map:** the four quadrants are separate landmasses around the sea beneath Olympus, split by glowing chasms that can't be crossed. Every war rolls its own land bridges (railed causeways marked "LAND BRIDGE") between neighbouring quadrants and three ⚓ port sea lanes to the far shores.
- **Reinforcements:** max(3, territories ÷ 3), plus region bonuses (each House slice's shore, heart and marches, outlined in gold on the map with their bonus), plus a stacking Keep bonus (+2 / +5 / +9 / +14).
- **Battle odds:** every attack target shows your exact chance to take it with a blitz (or 🏳 Overwhelm, or the neutral's single die).
- **Cards:** trade any 3 for 10 armies, or play one for its Active ability. Owning a card's House boosts it. Proctors only work for their House's owner; otherwise discard one to draw 2. Playable cards glow. Hover a card (or 🔍 it) to see the territories it would hit; click it to preview the outcome on the map (random parts shown as ranges), then Commit or go Back. Other players' cards are pinned on the map until you acknowledge them.
- **Watching:** other players' and the AI's moves replay one at a time with their dice (1×, 2×, 4×, or Skip).
- **The Standard:** once per turn, raise it from its territory to attack with +3 phantom soldiers and a free General war cry. There is no retreat. A defending Standard's honor guard shows on its token (for example `11 +5`).
  - Win: every defender you killed joins you as a slave.
  - Lose: your whole House goes to the defender.
  - Defenders holding a REACTION card can ambush a Standard attack.
- **Alliances:** once one House attacks another, Houses can trade quiet invitations. Alliances are public or secret, and only share their Generals' Passives. Attacking an ally cancels the alliance. One alliance per House (an invite can still reach someone in a secret pact; they just can't accept it). Senders can take back an invite, and anyone can walk out of their alliance (then sit out a round).
- **Rally Against Olympus:** the strongest House (most armies, no ties) may open a public Rally; the first Houses to answer join its public alliance, up to half the living Houses. Answering walks out on your old allies, who hear it as betrayal. It closes when full, when cancelled, or at the rallier's next turn.
- **Table talk:** 💬 emotes post a short line to the War Log any time (one per 15 seconds). The host can kick a player: from the lobby, or mid-war (an AI Primus takes over their House).
- **War Logs:** every online war's full log, dice included, is kept for 90 days in `ic_logs`. "Past wars" on the title screen reads it back, with turn and House filters, text export, and public ⚑ flags on any line.
- **Win:** be the last House standing. Capturing a House's Standard (take the territory it stands on) dominates that House.
- **Or take House Olympus:** when an alliance is all that's left, a majority vote starts a Siege on Olympus. Olympus holds 11 soldiers per territory of a House slice, fights behind walls, and gets the Proctors of the attacking Houses as its Generals. Each ally gets 3 turns; win and the whole alliance wins, fail and the alliance shatters. Siege-only Relic cards help. Tune it in `BALANCE` (`src/engine/engine.ts`) and check it with `node scripts/siege-sim.ts`.

The full rules are in the game (the **?** button). Every card is listed in the **Codex**.

## Architecture

| Piece | Where |
|---|---|
| Rules engine (pure TS, deterministic) | `src/engine/` |
| AI Primus | `src/engine/bot.ts` |
| 3D valley, dice | `src/render/` |
| UI, copy | `src/ui/` |
| Local and online sessions | `src/net/session.ts` |
| Game server (Supabase Edge Function) | `supabase/functions/institute/` |
| Version shown on the title screen | `src/version.ts` |

The server is authoritative:
- Every action runs through the same engine as the client, using a crypto RNG.
- The new version is broadcast over Supabase Realtime, and each client refetches its own private view.
- Each accepted action also records a small public replay frame (what changed on the map), so clients can replay AI and rival moves step by step.
- Hands and Passage picks never leave the server except to their owner.
- The full War Log is appended to `ic_logs` (migration in `supabase/migrations/`), kept 90 days, readable only by that war's players (private lines only by the Houses that saw them).
- The `ic_games`, `ic_players` and `ic_logs` tables have RLS on with no policies, so only the function can touch them.

## Develop

```bash
npm install
npm run dev          # local server
npm test             # engine tests + 42 bot-vs-bot games (2–7 players)
node scripts/sim.ts          # balance simulator (game length, alliances, sieges per player count)
node scripts/siege-sim.ts    # how often 2 or 3 allied Houses break Olympus, by army size
node scripts/mapcheck.ts     # map stats per valley size (add --draw for ASCII)
node scripts/pace-sim.ts     # opening pace: the round of the first player-vs-player battle
node --experimental-transform-types scripts/smoke-online.ts # full game against the deployed server
```

The scripts are TypeScript: Node 23.6+ runs them directly (the online ones, which import the client session, need `--experimental-transform-types`), or use `npx tsx`.

After changing anything in `src/engine/`:
1. Run `npm run sync:fn`.
2. Redeploy the `institute` edge function (the test suite fails until the copies match).

Pushing to `main` deploys the site to GitHub Pages.
