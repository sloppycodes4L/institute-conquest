// Opening pace: in which round does the first player-vs-player battle happen? The goal is about two quiet
// rounds of grabbing neutral land first. Usage: npx tsx scripts/pace-sim.ts [games-per-count] ['{"marchGarrison":5}'] [size] [troops]
import { act, actingSeat, aiDuty, createGame, viewFor, BALANCE, spreadSlices, geo } from '../src/engine/engine.ts';
import { botAction } from '../src/engine/bot.ts';
import { MIN_PLAYERS, MAX_PLAYERS, geoFor } from '../src/engine/data.ts';
const games = +(process.argv[2] ?? 30);
if (process.argv[3]) Object.assign(BALANCE, JSON.parse(process.argv[3]));
const size = +(process.argv[4] ?? 0), troops = +(process.argv[5] ?? 0);
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
  const first: number[] = [], rounds: number[] = [];
  let unfinished = 0;
  const g = geoFor(n, size);
  const houseSets = new Set<string>();
  for (let i = 0; i < 400; i++) houseSets.add(spreadSlices(g, n, Math.random).join(''));
  for (let k = 0; k < games; k++) {
    const s = createGame(Array.from({ length: n }, (_, i) => 'B' + i), Math.random, { settings: { size, troops } });
    let now = 0, firstRound = 0;
    while (s.phase !== 'over' && s.turn < 120 * n) {
      const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
      const r = act(s, seat, botAction(viewFor(s, seat), seat), { rng: Math.random, now });
      if (!r.ok) act(s, actingSeat(s), s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, { rng: Math.random, now });
      if (!firstRound && s.warBegun) firstRound = Math.ceil(s.turn / n);
    }
    if (s.phase !== 'over') unfinished++;
    first.push(firstRound || 999);
    rounds.push(Math.ceil(s.turn / n));
  }
  const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
  console.log(`${n}p L${geo(createGame(Array.from({ length: n }, (_, i) => 'x' + i), Math.random, { settings: { size, troops } })).layout} (${g.nt} terr, ${houseSets.size} slice sets): first PvP round p10/med/p90 ${q(first, 0.1)}/${q(first, 0.5)}/${q(first, 0.9)}   game rounds med ${q(rounds, 0.5)} p90 ${q(rounds, 0.9)}  unfinished ${unfinished}`);
}
