// Balance simulator: bot-vs-bot games per player count, with House Ultimates on (the default for 3+ Houses) or off.
// Usage: node scripts/sim.ts [games-per-count] ['{"olyPerTerr":6}'] [on|off] [counts, e.g. 3,4,5]
import { act, actingSeat, aiDuty, createGame, drainLog, viewFor, BALANCE } from '../src/engine/engine.ts';
import { botAction, botFallback } from '../src/engine/bot.ts';
import { HOUSES, MIN_PLAYERS, MAX_PLAYERS } from '../src/engine/data.ts';
const games = +(process.argv[2] ?? 20);
if (process.argv[3]) Object.assign(BALANCE, JSON.parse(process.argv[3]));
const ultimates = process.argv[4] !== 'off';
const counts = process.argv[5] ? process.argv[5].split(',').map(Number) : Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);
console.log(`House Ultimates ${ultimates ? 'on (3+ Houses)' : 'off'}, ${games} games per count`);
const byHouse: Record<string, number> = {};
for (const n of counts) {
  const rounds: number[] = []; let turns = 0, std = 0, stuck = 0, al = 0, bt = 0, sg = 0, sgGames = 0, sgWon = 0, sgFail = 0, casts = 0, castGames = 0, lockouts = 0, refused = 0;
  for (let g = 0; g < games; g++) {
    const s = createGame(Array.from({ length: n }, (_, i) => 'B' + i), Math.random, { settings: { ultimates } });
    drainLog();
    let now = 0, sieged = false, cast = false;
    while (s.phase !== 'over' && s.turn < 120 * n) {
      const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
      const r = act(s, seat, botAction(viewFor(s, seat), seat), { rng: Math.random, now });
      if (!r.ok) {
        refused++;
        act(s, actingSeat(s), botFallback(s, actingSeat(s)), { rng: Math.random, now });
      }
      // The game state keeps only the last few hundred events, so count them as they are logged.
      for (const e of drainLog()) switch (e.k) {
        case 'stdBattle': std++; break;
        case 'allianceFormed': al++; break;
        case 'betrayal': bt++; break;
        case 'siegeBegins': sg++; sieged = true; break;
        case 'olympusFalls': sgWon++; break;
        case 'siegeFailed': sgFail++; break;
        case 'lockout': lockouts++; break;
        case 'ultimate': casts++; cast = true; byHouse[HOUSES[e.house].id] = (byHouse[HOUSES[e.house].id] ?? 0) + 1; break;
      }
    }
    if (s.phase !== 'over') stuck++;
    if (sieged) sgGames++;
    if (cast) castGames++;
    turns += s.turn;
    rounds.push(Math.ceil(s.turn / n));
  }
  rounds.sort((a, b) => a - b);
  const q = (p: number) => rounds[Math.floor(rounds.length * p)];
  const pc = (x: number) => `${Math.round((100 * x) / games)}%`;
  console.log(`${n}p turns ${(turns / games).toFixed(1)}  rounds p10/med/p90 ${q(0.1)}/${q(0.5)}/${q(0.9)}  Siege reached ${pc(sgGames)}  Olympus wins ${pc(sgWon)}  casts/game ${(casts / games).toFixed(2)} (in ${pc(castGames)} of games)`
    + `  std/game ${(std / games).toFixed(1)}  alliances ${al} betrayals ${bt} lockouts ${lockouts} sieges ${sg} (won ${sgWon}, failed ${sgFail})  refused ${refused}  unfinished ${stuck}`);
}
if (Object.keys(byHouse).length) console.log('casts by House: ' + HOUSES.map((h) => `${h.name} ${byHouse[h.id] ?? 0}`).join(', '));
