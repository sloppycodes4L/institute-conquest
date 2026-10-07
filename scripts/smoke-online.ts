// Plays a full online game against the deployed edge function: 1 scripted "human" + 3 server AIs.
// The war opens with the House Draft: the AI seats pick at once, the human tries a House that is taken (refused) and
// then takes a free one. Reports the Houses dealt, the House Ultimates cast, how the war ended, and any action or
// Draft count the server disagreed with.
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
j = await call({ op: 'start', game, token });
// The House Draft: AI seats ahead of me have picked already. A taken House is refused; a free one is mine.
let dupRefused = true, mine = -1;
if (j.status === 'lobby' && j.draft) {
  const taken = j.lobby.find((l: any) => l.house != null);
  if (taken) {
    let dup = 'accepted';
    try { await call({ op: 'draftPick', game, token, house: taken.house }); } catch (e) { dup = String((e as Error).message); }
    dupRefused = /taken/i.test(dup);
    console.log(`a taken House is refused: ${dupRefused ? 'yes' : `NO (${dup})`}`);
  } else console.log('I pick first: no taken House to try');
  const free = HOUSES.map((_, h) => h).filter((h) => !j.lobby.some((l: any) => l.house === h));
  mine = free.includes(hid('mars')) ? hid('mars') : free[0];
  j = await call({ op: 'draftPick', game, token, house: mine });
} else console.log('NO House Draft opened');
if (!j.view) throw new Error(`the war did not start after the Draft: ${JSON.stringify(j).slice(0, 300)}`);
const houses: string[] = j.view.players.map((p: any) => HOUSES[p.house].id);
const picksOk = mine >= 0 && j.view.players[0].house === mine && new Set(houses).size === houses.length;
console.log(`Houses: ${houses.join(', ')}. Draft pick honoured: ${picksOk ? 'yes' : 'NO'}. Ultimates ${j.view.ult ? 'on' : 'OFF'}. Finale rule ${j.view.opts.finale ? 'on' : 'OFF'}`);
let steps = 0, errors = 0, mismatches = 0;
const casts = new Map<number, string>();
while (j.view.phase !== 'over' && steps < 1500) {
  steps++;
  const v = j.view;
  for (const e of v.log) if (e.k === 'ultimate' && !casts.has(e.id)) casts.set(e.id, HOUSES[e.house].id);
  // The final vote stops the war until every ally has answered: mine comes first.
  const owesVote = !!v.vote && v.alliances.some((a: any) => a.id === v.vote.alliance && a.members.includes(0)) && !v.vote.yes.includes(0) && !v.vote.no.includes(0);
  const acting = v.phase === 'passage' ? (v.me.passage ? 0 : -1) : owesVote ? 0 : v.vote?.final ? -1 : v.reaction ? v.reaction.defender : v.cur;
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
const end = v.log.find((e: any) => e.k === 'win' || e.k === 'olympusFalls');
console.log(`Ending: ${!end ? '-' : end.k === 'olympusFalls' ? 'Olympus fell' : end.shared ? `the alliance ended the war (${end.members.length} Houses)` : 'last House standing'}. Final votes: ${v.log.filter((e: any) => e.k === 'finale').length}`);
if (!picksOk || !dupRefused || v.phase !== 'over') process.exitCode = 1;
