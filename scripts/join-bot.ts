// Join an online war as a scripted "human" and play with the bot brain. Usage: npx tsx scripts/join-bot.ts CODE [name]
import { botAction } from '../src/engine/bot.ts';
import { SUPABASE_URL, SUPABASE_ANON } from '../src/net/session.ts';
const FN = `${SUPABASE_URL}/functions/v1/institute`;
const call = async (body: any) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }, body: JSON.stringify(body) })).json();
const [code, name = 'Scripted Jackal'] = process.argv.slice(2);
let j = await call({ op: 'join', code, name });
if (j.error) { console.log(j.error); process.exit(1); }
const { id: game, token, seat } = j;
console.log('joined as seat', seat);
const until = Date.now() + 8 * 60_000;
while (Date.now() < until) {
  j = await call({ op: 'state', game, token });
  const v = j.view;
  if (!v) { await new Promise((r) => setTimeout(r, 2000)); continue; }
  if (v.phase === 'over') { console.log('over, winner', v.winner); break; }
  const acting = v.phase === 'passage' ? (v.me.passage ? seat : -1) : v.reaction ? v.reaction.defender : v.cur;
  if (acting !== seat) { await new Promise((r) => setTimeout(r, 1500)); continue; }
  const a = botAction(v, seat);
  const r = await call({ op: 'act', game, token, action: a });
  console.log(a.type, r.error ?? '');
  await new Promise((r) => setTimeout(r, 700));
}
