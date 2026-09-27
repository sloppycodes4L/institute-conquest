// Institute Conquest game server (Supabase Edge Function).
// Authoritative: every action runs through the shared engine here with a crypto RNG,
// then the new version is broadcast on Realtime so clients refetch their private view.
// The engine lives in ./engine, copied verbatim from src/engine by scripts/sync-fn.mjs.

import { act, actingSeat, createGame, viewFor, type Action, type GameState } from './engine/engine.ts';
import { botAction } from './engine/bot.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PLAYERS = 4;

interface LobbySeat { seat: number; name: string; ai?: boolean }
interface GameRow { id: string; code: string; status: 'lobby' | 'playing' | 'over'; host_seat: number; lobby: LobbySeat[]; state: GameState | null; version: number }

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const bad = (msg: string, status = 400): never => { throw new HttpError(status, msg); };

function rng(): number {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return (b[0] * 2 ** 21 + (b[1] >>> 11)) / 2 ** 53;
}
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function newToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(rng() * A.length)];
  return s;
}
const gameId = (x: unknown): string => (typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x) ? x : bad('Bad game id.'));
const cleanName = (n: unknown) => String(n ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Nameless Gold';

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`db ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function getGame(q: string): Promise<GameRow> {
  const rows = await rest(`ic_games?${q}&select=*`);
  if (!rows?.length) bad('No such game. Check the code, Pixie.', 404);
  return rows[0];
}
async function saveGame(g: GameRow, prevVersion: number, patch: Partial<GameRow>): Promise<boolean> {
  const rows = await rest(`ic_games?id=eq.${g.id}&version=eq.${prevVersion}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  return rows.length === 1;
}
async function seatFor(g: GameRow, token: unknown): Promise<number> {
  if (typeof token !== 'string' || token.length < 10) bad('Missing player token.', 401);
  const rows = await rest(`ic_players?game_id=eq.${g.id}&token_hash=eq.${await sha(token as string)}&select=seat`);
  if (!rows.length) bad('You are not seated in this game.', 403);
  return rows[0].seat;
}
async function broadcast(code: string, version: number) {
  try {
    await fetch(`${URL_}/realtime/v1/api/broadcast`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ messages: [{ topic: `ic-${code}`, event: 'update', payload: { version } }] }),
    });
  } catch { /* clients also poll */ }
}

function payload(g: GameRow, seat: number | null) {
  return {
    id: g.id, code: g.code, status: g.status, hostSeat: g.host_seat, lobby: g.lobby, version: g.version, seat,
    view: g.state ? viewFor(g.state, seat) : null,
  };
}

/** Let AI seats take their moves until a human must act. */
function runBots(s: GameState) {
  for (let i = 0; i < 2000 && s.phase !== 'over'; i++) {
    const seat = actingSeat(s);
    if (seat < 0 || !s.players[seat]?.ai) return;
    const a = botAction(viewFor(s, seat), seat, rng);
    const r = act(s, seat, a, { rng, now: Date.now() });
    if (!r.ok) {
      const fb: Action = s.reaction ? { type: 'react', card: null } : s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' };
      if (!act(s, seat, fb, { rng, now: Date.now() }).ok) return;
    }
  }
}

async function handle(body: any) {
  switch (body.op) {
    case 'create': {
      const token = newToken();
      const name = cleanName(body.name);
      await rest(`ic_games?updated_at=lt.${new Date(Date.now() - 30 * 864e5).toISOString()}`, { method: 'DELETE' }).catch(() => {});
      let g: GameRow | null = null;
      for (let i = 0; i < 5 && !g; i++) {
        try {
          const rows = await rest('ic_games', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ code: newCode(), lobby: [{ seat: 0, name }] }) });
          g = rows[0];
        } catch (e) { if (i === 4) throw e; }
      }
      await rest('ic_players', { method: 'POST', body: JSON.stringify({ game_id: g!.id, seat: 0, name, token_hash: await sha(token) }) });
      return { ...payload(g!, 0), token };
    }
    case 'join': {
      const g = await getGame(`code=eq.${String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`);
      if (g.status !== 'lobby') bad('That war already started. No latecomers.');
      if (g.lobby.length >= MAX_PLAYERS) bad('Four Houses already. The valley is full.');
      const token = newToken();
      const seat = g.lobby.length;
      const name = cleanName(body.name);
      if (!(await saveGame(g, g.version, { lobby: [...g.lobby, { seat, name }], version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await rest('ic_players', { method: 'POST', body: JSON.stringify({ game_id: g.id, seat, name, token_hash: await sha(token) }) });
      await broadcast(g.code, g.version + 1);
      const g2 = await getGame(`id=eq.${g.id}`);
      return { ...payload(g2, seat), token };
    }
    case 'addBot': case 'removeBot': {
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      if (seat !== g.host_seat) bad('Only the host can do that.', 403);
      if (g.status !== 'lobby') bad('Game already started.');
      let lobby = g.lobby;
      if (body.op === 'addBot') {
        if (lobby.length >= MAX_PLAYERS) bad('Lobby full.');
        const names = ['Proctor\'s Pet', 'Some Tall Bastard', 'A Very Angry Gold', 'The Draft Pick Nobody Wanted'];
        lobby = [...lobby, { seat: lobby.length, name: names[lobby.length % names.length], ai: true }];
      } else {
        const last = lobby[lobby.length - 1];
        if (!last?.ai) bad('The last seat is a human.');
        lobby = lobby.slice(0, -1);
      }
      if (!(await saveGame(g, g.version, { lobby, version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await broadcast(g.code, g.version + 1);
      return payload(await getGame(`id=eq.${g.id}`), seat);
    }
    case 'start': {
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      if (seat !== g.host_seat) bad('Only the host can start the war.', 403);
      if (g.status !== 'lobby') bad('Already started.');
      if (g.lobby.length < 2) bad('You need at least one rival. Add a human or an AI.');
      const s = createGame(g.lobby.map((l) => l.name), rng, { ai: g.lobby.map((l) => !!l.ai) });
      runBots(s);
      if (!(await saveGame(g, g.version, { status: 'playing', state: s, version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await broadcast(g.code, g.version + 1);
      return payload(await getGame(`id=eq.${g.id}`), seat);
    }
    case 'state': {
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      if (body.since != null && body.since === g.version) return { unchanged: true, version: g.version };
      return payload(g, seat);
    }
    case 'act': {
      for (let attempt = 0; attempt < 3; attempt++) {
        const g = await getGame(`id=eq.${gameId(body.game)}`);
        const seat = await seatFor(g, body.token);
        if (!g.state) bad('Game has not started.');
        const s = g.state!;
        const r = act(s, seat, body.action as Action, { rng, now: Date.now() });
        if (!r.ok) return { ...payload(g, seat), error: r.err };
        runBots(s);
        const status = s.phase === 'over' ? 'over' : 'playing';
        if (await saveGame(g, g.version, { state: s, status, version: g.version + 1 })) {
          await broadcast(g.code, g.version + 1);
          return payload({ ...g, state: s, status, version: g.version + 1 }, seat);
        }
      }
      bad('The valley is busy. Try again.', 409);
    }
  }
  bad('Unknown op.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const out = await handle(body);
    return new Response(JSON.stringify(out), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof HttpError ? e.message : 'Server error: ' + (e as Error).message;
    return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
