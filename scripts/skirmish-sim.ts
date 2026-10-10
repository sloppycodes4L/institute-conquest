// Skirmish simulator: bot-vs-bot wars on every board.
// Usage: node scripts/skirmish-sim.ts [games] [on|off] [map id or -] ['{"skirmishLate":4}'] [counts, e.g. 2,3]
import { act, actingSeat, aiDuty, createGame, drainLog, viewFor, BALANCE } from '../src/engine/engine.ts';
import { botAction, botFallback } from '../src/engine/bot.ts';
import { SKIRMISH_MAPS, SKIRMISH_MAX } from '../src/engine/skirmish.ts';
const games = +(process.argv[2] ?? 20);
const ultimates = process.argv[3] !== 'off';
const only = process.argv[4] === '-' ? undefined : process.argv[4];
if (process.argv[5]) Object.assign(BALANCE, JSON.parse(process.argv[5]));
const counts = process.argv[6] ? process.argv[6].split(',').map(Number) : [2, 3, 4];
console.log(`House Ultimates ${ultimates ? 'on (3+ Houses)' : 'off'}, ${games} games per board and count`);
for (const map of SKIRMISH_MAPS) {
  if (only && map.id !== only) continue;
  for (const n of counts) {
    if (n > SKIRMISH_MAX) continue;
    const rounds: number[] = []; let stuck = 0, refused = 0, casts = 0, neutral = 0;
    const wins = new Array(n).fill(0);
    for (let g = 0; g < games; g++) {
      const s = createGame(Array.from({ length: n }, (_, i) => 'B' + i), Math.random, { settings: { mode: 'skirmish', map: map.id, ultimates } });
      drainLog();
      let now = 0;
      while (s.phase !== 'over' && s.turn < 150 * n) {
        const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
        const r = act(s, seat, botAction(viewFor(s, seat), seat), { rng: Math.random, now });
        if (!r.ok) { refused++; act(s, actingSeat(s), botFallback(s, actingSeat(s)), { rng: Math.random, now }); }
        for (const e of drainLog()) if (e.k === 'ultimate') casts++;
      }
      if (s.phase !== 'over') stuck++; else wins[s.order.indexOf(s.winner!)]++;
      if (s.owner.some((o) => o < 0)) neutral++;
      rounds.push(Math.ceil(s.turn / n));
    }
    rounds.sort((a, b) => a - b);
    const q = (p: number) => rounds[Math.floor(rounds.length * p)];
    console.log(`${map.id} ${n}p  rounds p10/med/p90 ${q(0.1)}/${q(0.5)}/${q(0.9)}  wins by turn order ${wins.join('/')}  casts/game ${(casts / games).toFixed(2)}  refused ${refused}  unfinished ${stuck}  neutral land ${neutral}`);
  }
}
