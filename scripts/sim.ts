// Balance simulator: bot-vs-bot games per player count. Usage: npx tsx scripts/sim.ts [games-per-count] ['{"olyPerTerr":6}']
import { act, actingSeat, aiDuty, createGame, viewFor, BALANCE } from '../src/engine/engine.ts';
import { botAction } from '../src/engine/bot.ts';
import { MIN_PLAYERS, MAX_PLAYERS } from '../src/engine/data.ts';
const games = +(process.argv[2] ?? 20);
if (process.argv[3]) Object.assign(BALANCE, JSON.parse(process.argv[3]));
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
  const rounds: number[] = []; let std = 0, stuck = 0, al = 0, bt = 0, sg = 0, sgWon = 0, sgFail = 0;
  for (let g = 0; g < games; g++) {
    const s = createGame(Array.from({ length: n }, (_, i) => 'B' + i), Math.random);
    let now = 0;
    while (s.phase !== 'over' && s.turn < 120 * n) {
      const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
      const r = act(s, seat, botAction(viewFor(s, seat), seat), { rng: Math.random, now });
      if (!r.ok) act(s, actingSeat(s), s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, { rng: Math.random, now });
    }
    if (s.phase !== 'over') stuck++;
    rounds.push(Math.ceil(s.turn / n));
    const c = (k: string) => s.log.filter((e) => e.k === k).length;
    std += c('stdBattle'); al += c('allianceFormed'); bt += c('betrayal'); sg += c('siegeBegins'); sgWon += c('olympusFalls'); sgFail += c('siegeFailed');
  }
  rounds.sort((a, b) => a - b);
  const q = (p: number) => rounds[Math.floor(rounds.length * p)];
  console.log(`${n}p rounds p10/med/p90 ${q(0.1)}/${q(0.5)}/${q(0.9)}  std/game ${(std / games).toFixed(1)}  alliances ${al} betrayals ${bt} sieges ${sg} (won ${sgWon}, failed ${sgFail})  unfinished ${stuck}`);
}
