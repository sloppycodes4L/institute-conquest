# Institute Conquest

A free, non-commercial fan game: Risk-style conquest set in the Institute from Pierce Brown's *Red Rising* (Book One).
3D in the browser (three.js), online multiplayer for up to 7 Houses, plus local hot-seat and AI Primuses.

> Not affiliated with or endorsed by Pierce Brown or his publishers. Contains violence and foul language.

**Play:** https://sloppycodes4l.github.io/institute-conquest/

## How it plays

- **The Sorting:** 2–7 players get random Houses out of Mars, Minerva, Diana, Apollo, Jupiter, Ceres, and Pluto. Unclaimed Houses become neutral garrisons.
- **The valley** grows with the player count (77 territories for 2 players, 91 for 4, 112 for 7). Everyone starts holding their whole House slice, with the Keep at least 3 steps from any foreign border.
- **The Passage:** each player is dealt 2 Characters, keeps one as their General (Passive always on, +1 if the General is from the player's own House in the books), and the other dies.
- **Controls:** scroll zooms, left-drag pans, right-drag turns the camera. ◐ (G) greys out everything you don't hold; ⛰ (O) makes Olympus solid, see-through, or hidden.
- **Turn:** Draft (with −/+ and Undo) → Attack (unlimited; every target the selected territory can hit lights up) → Fortify, with Risk Global Domination dice (3 attack vs 2 defense dice, ties go to the defender).
- **Reinforcements:** max(3, territories ÷ 3), plus quadrant bonuses, plus a stacking Keep bonus (+2 / +5 / +9 / +14).
- **Cards:** trade any 3 for 10 armies, or play one for its Active ability. Owning a card's House boosts it. Proctors only work for their House's owner; otherwise discard one to draw 2.
- **The Standard:** raise it from its territory to attack with +3 phantom soldiers and a free General war cry. There is no retreat.
  - Win: every defender you killed joins you as a slave.
  - Lose: your whole House goes to the defender.
  - Defenders holding a REACTION card can ambush a Standard attack.
- **Alliances:** once one House attacks another, Houses can trade quiet invitations. Alliances are public or secret, and only share their Generals' Passives. Attacking an ally cancels the alliance.
- **Win:** be the last House standing. Capturing a House's Standard (take the territory it stands on) dominates that House.
- **Or take House Olympus:** when an alliance is all that's left, a majority vote starts a Siege on Olympus. Olympus holds 11 soldiers per territory of a House slice, fights behind walls, and gets the Proctors of the attacking Houses as its Generals. Each ally gets 3 turns; win and the whole alliance wins, fail and the alliance shatters. Siege-only Relic cards help. Tune it in `BALANCE` (`src/engine/engine.ts`) and check it with `npx tsx scripts/siege-sim.ts`.

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

The server is authoritative:
- Every action runs through the same engine as the client, using a crypto RNG.
- The new version is broadcast over Supabase Realtime, and each client refetches its own private view.
- Hands and Passage picks never leave the server except to their owner.
- The `ic_games` and `ic_players` tables have RLS on with no policies, so only the function can touch them.

## Develop

```bash
npm install
npm run dev          # local server
npm test             # engine tests + 42 bot-vs-bot games (2–7 players)
npx tsx scripts/sim.ts          # balance simulator (game length, alliances, sieges per player count)
npx tsx scripts/siege-sim.ts    # how often 2 or 3 allied Houses break Olympus, by army size
npx tsx scripts/mapcheck.ts     # map stats per player count (add --draw for ASCII)
npx tsx scripts/smoke-online.ts # full game against the deployed server
```

After changing anything in `src/engine/`:
1. Run `npm run sync:fn`.
2. Redeploy the `institute` edge function (the test suite fails until the copies match).

Pushing to `main` deploys the site to GitHub Pages.
