// Plays a full online game against the deployed edge function: 1 scripted "human" + 3 server AIs.
// The human picks House Mars, the host gives the first AI House Minerva, and the other two stay on Random.
// Reports the Houses dealt, the House Ultimates cast, and any action or Draft count the server disagreed with.
import { botAction } from '../src/engine/bot.ts';
import { reinforcementBreakdown } from '../src/engine/engine.ts';
import { HOUSES } from '../src/engine/data.ts';
import { SUPABASE_URL, SUPABASE_ANON } from '../src/net/session.ts';
const FN = `${SUPABASE_URL}/functions/v1/institute`;
async function call(body: any) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
  return j;
}
const hid = (id: string) => HOUSES.findIndex((h) => h.id === id);
const t0 = Date.now();
let j = await call({ op: 'create', name: 'Smoke Reaper' });
const { id: game, token, code } = j;
console.log('created', code, Date.now() - t0, 'ms');
for (let i = 0; i < 3; i++) j = await call({ op: 'addBot', game, token });
// House pick: my own seat, then the host sets (and locks) an AI's. A House already taken is refused.
await call({ op: 'setHouse', game, token, house: hid('mars') });
await call({ op: 'setHouse', game, token, seat: 1, house: hid('minerva') });
let dup = 'accepted';
try { await call({ op: 'setHouse', game, token, seat: 2, house: hid('mars') }); } catch (e) { dup = String((e as Error).message); }
const dupRefused = /taken/i.test(dup);
console.log(`a taken House is refused: ${dupRefused ? 'yes' : `NO (${dup})`}`);
j = await call({ op: 'start', game, token });
const houses: string[] = j.view.players.map((p: any) => HOUSES[p.house].id);
const picksOk = houses[0] === 'mars' && houses[1] === 'minerva' && new Set(houses).size === houses.length;
console.log(`Houses: ${houses.join(', ')}. Picks honoured: ${picksOk ? 'yes' : 'NO'}. Ultimates ${j.view.ult ? 'on' : 'OFF'}`);
let steps = 0, errors = 0, mismatches = 0;
const casts = new Map<number, string>();
while (j.view.phase !== 'over' && steps < 1500) {
  steps++;
  const v = j.view;
  for (const e of v.log) if (e.k === 'ultimate' && !casts.has(e.id)) casts.set(e.id, HOUSES[e.house].id);
  const acting = v.phase === 'passage' ? (v.me.passage ? 0 : -1) : v.reaction ? v.reaction.defender : v.cur;
  if (acting !== 0) { j = await call({ op: 'state', game, token }); continue; }
  // My turn has just begun when the log ends with my `turn` event, followed only by the ticks of Ultimates on me.
  let ti = v.log.length - 1;
  while (ti >= 0 && v.log[ti].k === 'ultTick' && v.log[ti].seat === 0) ti--;
  const last = v.log[ti];
  if (v.phase === 'draft' && last?.k === 'turn' && last.seat === 0 && !last.skipped) {
    // An Ultimate on me changes the Draft after the sum: those ticks say by how much.
    let cut = 0, gain = 0;
    for (const t of v.log.slice(ti + 1)) {
      if (['tithe', 'rotDraft', 'storm', 'silenced'].includes(t.kind)) cut += t.n ?? 0;
      if (t.kind === 'harvest') gain += t.n ?? 0;
    }
    const local = reinforcementBreakdown(v, 0).total - cut + gain;
    if (local !== last.reinf) { mismatches++; console.log('reinf mismatch', local, last.reinf, cut || gain ? `(Ultimates: -${cut} +${gain})` : ''); }
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
for (const e of v.log) if (e.k === 'ultimate' && !casts.has(e.id)) casts.set(e.id, HOUSES[e.house].id);
const by: Record<string, number> = {};
for (const h of casts.values()) by[h] = (by[h] ?? 0) + 1;
console.log(`steps ${steps}, errors ${errors}, mismatches ${mismatches}, phase ${v.phase}, turn ${v.turn}, winner ${v.winner != null ? v.players[v.winner].name : '-'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Ultimates cast: ${casts.size}${casts.size ? ` (${Object.entries(by).map(([h, n]) => `${h} ${n}`).join(', ')})` : ''}`);
if (!picksOk || !dupRefused || v.phase !== 'over') process.exitCode = 1;
