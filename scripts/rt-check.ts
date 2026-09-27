import { RealtimeClient } from '@supabase/realtime-js';
import { SUPABASE_URL, SUPABASE_ANON } from '../src/net/session.ts';
const FN = `${SUPABASE_URL}/functions/v1/institute`;
const call = async (body: any) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }, body: JSON.stringify(body) })).json();
const host = await call({ op: 'create', name: 'RT host' });
const rt = new RealtimeClient(`${SUPABASE_URL.replace('https', 'wss')}/realtime/v1`, { params: { apikey: SUPABASE_ANON } });
rt.connect();
let t0 = 0;
const got = new Promise<number>((res) => {
  rt.channel(`ic-${host.code}`).on('broadcast', { event: 'update' }, (m: any) => res(Date.now() - t0)).subscribe(async (status) => {
    if (status === 'SUBSCRIBED') { t0 = Date.now(); await call({ op: 'addBot', game: host.id, token: host.token }); }
  });
});
const ms = await Promise.race([got, new Promise<number>((r) => setTimeout(() => r(-1), 15000))]);
console.log(ms >= 0 ? `broadcast received ${ms}ms after the action` : 'NO broadcast within 15s');
rt.disconnect();
process.exit(0);
