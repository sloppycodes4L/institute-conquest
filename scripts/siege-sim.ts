// Siege balance: how often a 2- or 3-House alliance breaks Olympus by army size. Usage: npx tsx scripts/siege-sim.ts
import { act, actingSeat, aiDuty, createGame, viewFor, geo, olympusPreview, BALANCE } from '../src/engine/engine.ts';
import { botAction } from '../src/engine/bot.ts';
const rng = Math.random;
function trial(members: number, perHouse: number): boolean {
  const s = createGame(['A', 'B', 'C', 'D'], rng);
  for (const p of s.players) act(s, p.seat, { type: 'choose', card: s.priv!.passage[p.seat]![0] }, { rng, now: 0 });
  const keep = [0, 1, 2].slice(0, members);
  for (const p of s.players) if (!keep.includes(p.seat)) { p.alive = false; s.standards[p.house].captured = true; s.standards[p.house].by = 0; }
  s.standards.forEach((st, h) => { if (!s.players.some((p) => p.house === h)) { st.captured = true; st.by = 0; } });
  const g = geo(s);
  s.owner = s.owner.map((_, t) => keep[t % members]);
  for (const m of keep) {
    const mine = s.owner.flatMap((o, t) => (o === m ? [t] : []));
    const foot = mine.filter((t) => g.territories[t].foot);
    for (const t of mine) s.armies[t] = 1;
    let rest = perHouse - mine.length;
    const staged = Math.round(rest * 0.6); rest -= staged;
    for (let i = 0; i < staged; i++) s.armies[foot[i % 2]]++;
    while (rest-- > 0) s.armies[mine[Math.floor(rng() * mine.length)]]++;
  }
  s.alliances = [{ id: 99, members: keep, public: true, since: 0 }];
  s.warBegun = true; s.turn = 20; s.cur = keep[0]; s.phase = 'fortify';
  // Any accepted action opens the final vote: the alliance has no enemy left.
  act(s, keep[0], { type: 'holdReactions', on: false }, { rng, now: 0 });
  for (const m of keep) if (s.vote) act(s, m, { type: 'vote', yes: true }, { rng, now: 0 });
  act(s, keep[0], { type: 'endTurn' }, { rng, now: 0 });
  let now = 0;
  while (s.siege && s.phase !== 'over' && s.turn < 200) {
    const d = aiDuty(s); const seat = d >= 0 ? d : actingSeat(s); now += 1000;
    const r = act(s, seat, botAction(viewFor(s, seat), seat), { rng, now });
    if (!r.ok) act(s, actingSeat(s), s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' }, { rng, now });
  }
  return s.log.some((e) => e.k === 'olympusFalls');
}
for (const per of [BALANCE.olyPerTerr]) {
  BALANCE.olyPerTerr = per;
  const s0 = createGame(['A', 'B', 'C', 'D'], rng);
  console.log(`olyPerTerr ${per}: garrison ~${olympusPreview(s0, [0, 1]).garrison}`);
  for (const members of [2, 3]) {
    const row: string[] = [];
    for (const size of [110, 150, 190, 240, 300]) {
      let w = 0; const N = 30;
      for (let i = 0; i < N; i++) if (trial(members, size)) w++;
      row.push(`${size}:${Math.round((100 * w) / N)}%`);
    }
    console.log(`  ${members} houses  ${row.join('  ')}`);
  }
}
