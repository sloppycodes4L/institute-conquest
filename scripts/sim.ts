import { act, actingSeat, createGame, viewFor, BALANCE } from '../src/engine/engine.ts';
import { botAction } from '../src/engine/bot.ts';
function run(label: string, cfg: Partial<typeof BALANCE>, games = 240) {
  Object.assign(BALANCE, { keepWall: 1, stdGuard: 5, graceRounds: 1, stdDefDice: 3 }, cfg);
  const turns: number[] = []; let std = 0, stdLoss = 0, stuck = 0;
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 3);
    const s = createGame(Array.from({ length: n }, (_, i) => 'B' + i), Math.random);
    let now = 0;
    while (s.phase !== 'over' && s.turn < 600) {
      const seat = actingSeat(s); now += 1000;
      const r = act(s, seat, botAction(viewFor(s, seat), seat), { rng: Math.random, now });
      if (!r.ok) act(s, seat, s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, { rng: Math.random, now });
    }
    if (s.phase !== 'over') stuck++;
    turns.push(Math.ceil(s.turn / n));
    std += s.log.filter(e => e.k === 'stdBattle').length;
    stdLoss += s.log.filter(e => e.k === 'stdBattle' && !e.won).length;
  }
  turns.sort((a, b) => a - b);
  const q = (p: number) => turns[Math.floor(turns.length * p)];
  console.log(label.padEnd(28), 'rounds p10/med/p90', q(0.1), q(0.5), q(0.9), ' std attacks/game', (std / games).toFixed(1), 'lost', stdLoss, 'unfinished', stuck);
}
const which = process.argv[2];
if (which) run('custom', JSON.parse(which));
else {
  run('wall0 guard3 grace0', { keepWall: 0, graceRounds: 0 });
  run('wall1 guard3 grace1', {});
  run('wall1 guard5 grace1', { stdGuard: 5 });
  run('wall1 guard5 grace2', { stdGuard: 5, graceRounds: 2 });
}
