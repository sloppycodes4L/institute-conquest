// Plays a full online game against the deployed edge function: 1 scripted "human" + 3 server AIs.
import { botAction } from '../src/engine/bot.ts';
import { reinforcementBreakdown } from '../src/engine/engine.ts';
import { SUPABASE_URL, SUPABASE_ANON } from '../src/net/session.ts';
const FN = `${SUPABASE_URL}/functions/v1/institute`;
async function call(body: any) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
  return j;
}
const t0 = Date.now();
let j = await call({ op: 'create', name: 'Smoke Reaper' });
const { id: game, token, code } = j;
console.log('created', code, Date.now() - t0, 'ms');
for (let i = 0; i < 3; i++) j = await call({ op: 'addBot', game, token });
j = await call({ op: 'start', game, token });
let steps = 0, errors = 0, mismatches = 0;
while (j.view.phase !== 'over' && steps < 1500) {
  steps++;
  const v = j.view;
  const acting = v.phase === 'passage' ? (v.me.passage ? 0 : -1) : v.reaction ? v.reaction.defender : v.cur;
  if (acting !== 0) { j = await call({ op: 'state', game, token }); continue; }
  if (v.phase === 'draft' && v.log.at(-1)?.k === 'turn' && v.log.at(-1).seat === 0) {
    const local = reinforcementBreakdown(v, 0).total;
    if (local !== v.log.at(-1).reinf) { mismatches++; console.log('reinf mismatch', local, v.log.at(-1).reinf); }
  }
  const a = botAction(v, 0);
  j = await call({ op: 'act', game, token, action: a });
  if (j.error) {
    errors++;
    if (errors < 10) console.log('server rejected', JSON.stringify(a), '->', j.error);
    const fb = v.ts.mustMove ? { type: 'move', n: v.ts.mustMove.min } : v.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' };
    j = await call({ op: 'act', game, token, action: fb });
  }
}
const v = j.view;
console.log(`steps ${steps}, errors ${errors}, mismatches ${mismatches}, phase ${v.phase}, turn ${v.turn}, winner ${v.winner != null ? v.players[v.winner].name : '-'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
