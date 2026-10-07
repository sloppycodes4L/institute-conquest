// Institute Conquest game server (Supabase Edge Function).
// Authoritative: every action runs through the shared engine here with a crypto RNG,
// then the new version is broadcast on Realtime so clients refetch their private view.
// The engine lives in ./engine, copied verbatim from src/engine by scripts/sync-fn.mjs.

import { act, actingSeat, aiDuty, cleanSettings, createGame, draftPick, draftSeat, drainLog, kickToAI, openDraft, viewFor, type Action, type GameEvent, type GameState, type HouseDraft, type WarSettings } from './engine/engine.ts';
import { botAction, botFallback } from './engine/bot.ts';
import { MAX_PLAYERS } from './engine/data.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** `house`: the House this seat chose in the House Draft (missing: not chosen yet, or House Selection is Random). */
interface LobbySeat { seat: number; name: string; ai?: boolean; house?: number | null; houseBy?: 'host' }
/** `opts.draft`: the House Draft, while one is running (the war is still in its lobby until the last House is chosen). */
interface GameRow { id: string; code: string; status: 'lobby' | 'playing' | 'over'; host_seat: number; lobby: LobbySeat[]; opts: (Partial<WarSettings> & { draft?: HouseDraft }) | null; state: GameState | null; version: number }

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

/** Wars started before the 7-House valley can't be loaded by the new engine. */
function current(g: GameRow) {
  if (g.state && (g.state as any).v !== 2) bad('This war was fought on the old, smaller valley and can no longer be loaded. Start a new one.', 410);
  return g;
}

/** `tv`: the state version the client already has, so it only gets the replay frames it hasn't seen. */
function payload(g: GameRow, seat: number | null, tv?: unknown) {
  const view = g.state ? viewFor(g.state, seat) : null;
  if (view && typeof tv === 'number') view.trail = view.trail.filter((f) => f.v > tv);
  return {
    id: g.id, code: g.code, status: g.status, hostSeat: g.host_seat, lobby: g.lobby, settings: cleanSettings(g.opts ?? {}), version: g.version, seat, view,
    // The House Draft, and the server's clock to read its deadline by.
    draft: g.status === 'lobby' ? g.opts?.draft ?? null : null, now: Date.now(),
  };
}
/** The House Draft a lobby is in, if any. */
const draftOf = (g: GameRow) => (g.status === 'lobby' ? g.opts?.draft ?? null : null);
const noHouses = (lobby: LobbySeat[]) => lobby.map((l) => { const x = { ...l }; delete x.house; delete x.houseBy; return x; });

/** The war begins: the Houses are dealt (each seat's Draft pick, or at random) and the AI seats take their first moves. */
async function startWar(g: GameRow, lobby: LobbySeat[], seat: number) {
  const settings = cleanSettings(g.opts ?? {});
  drainLog();
  const s = createGame(lobby.map((l) => l.name), rng, { ai: lobby.map((l) => !!l.ai), settings, houses: lobby.map((l) => l.house ?? null) });
  runBots(s);
  const events = drainLog();
  if (!(await saveGame(g, g.version, { status: 'playing', state: s, lobby, opts: settings, version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
  await persistMeta(g, s);
  await persistLog(g.id, events);
  await broadcast(g.code, g.version + 1);
  return payload(await getGame(`id=eq.${g.id}`), seat);
}

/** Let AI seats take their moves (and answer invitations and siege votes) until a human must act. */
function runBots(s: GameState) {
  for (let i = 0; i < 4000 && s.phase !== 'over'; i++) {
    const duty = aiDuty(s);
    const seat = duty >= 0 ? duty : actingSeat(s);
    if (seat < 0 || !s.players[seat]?.ai) return;
    const a = botAction(viewFor(s, seat), seat, rng);
    const r = act(s, seat, a, { rng, now: Date.now() });
    if (!r.ok) {
      if (duty >= 0) {
        // An answer the AI can't give (say it was sworn elsewhere meanwhile): burn the letter instead of stalling.
        const inv = s.invites.find((x) => x.to === seat);
        if (!inv || !act(s, seat, { type: 'answer', invite: inv.id, accept: false }, { rng, now: Date.now() }).ok) return;
        continue;
      }
      if (!act(s, seat, botFallback(s, seat), { rng, now: Date.now() }).ok) return;
    }
  }
}

// ---------------------------------------------------------------------------
// The permanent War Log (ic_logs): every event, whole, kept 90 days. Only that war's players may read it.

const LOG_DAYS = 90;
/** Append events to a war's permanent log. A failure here never breaks the game. */
async function persistLog(gameId: string, events: GameEvent[]) {
  if (!events.length) return;
  try {
    for (let i = 0; i < events.length; i += 500) {
      await rest('ic_logs', { method: 'POST', body: JSON.stringify(events.slice(i, i + 500).map((e) => ({ game_id: gameId, seq: e.id, event: e }))) });
    }
  } catch (e) { console.error('persistLog', (e as Error).message); }
}
/** Seq 0: who fought, on which map, and each seat's token hash (so players can still read the log after the game row is cleaned up). */
async function persistMeta(g: GameRow, s: GameState) {
  const seats = await rest(`ic_players?game_id=eq.${g.id}&select=seat,token_hash`);
  const meta = {
    id: 0, k: 'meta', code: g.code, opts: s.opts, started: new Date().toISOString(),
    players: s.players.map((p) => ({ seat: p.seat, name: p.name, house: p.house, ai: !!p.ai })),
    seats: seats.map((x: any) => ({ seat: x.seat, hash: x.token_hash })),
  };
  await persistLog(g.id, [meta as GameEvent]);
}
async function readLog(gameId: string): Promise<{ seq: number; event: any; created_at: string }[]> {
  const out: any[] = [];
  for (let off = 0; off < 200_000; off += 1000) {
    const rows = await rest(`ic_logs?game_id=eq.${gameId}&select=seq,event,created_at&order=seq.asc,id.asc&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
/** A reader's seat: from the live game, or (after the game row is gone) from the log's own record of the seats. */
async function logSeat(gameId: string, token: unknown, rows?: { event: any }[]): Promise<number> {
  if (typeof token !== 'string' || token.length < 10) bad('Missing player token.', 401);
  const hash = await sha(token as string);
  const live = await rest(`ic_players?game_id=eq.${gameId}&token_hash=eq.${hash}&select=seat`);
  if (live.length) return live[0].seat;
  const list = rows ?? await readLog(gameId);
  const meta = list.find((r) => r.event?.k === 'meta')?.event;
  const kicked = new Set(list.filter((r) => r.event?.k === 'kicked').map((r) => r.event.seat));
  const hit = meta?.seats?.find((x: any) => x.hash === hash && !kicked.has(x.seat));
  if (!hit) bad('You did not fight in that war (or its log has expired).', 403);
  return hit.seat;
}
const cleanNote = (n: unknown) => String(n ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 140);

async function handle(body: any) {
  switch (body.op) {
    case 'create': {
      const token = newToken();
      const name = cleanName(body.name);
      await rest(`ic_games?updated_at=lt.${new Date(Date.now() - 30 * 864e5).toISOString()}`, { method: 'DELETE' }).catch(() => {});
      await rest(`ic_logs?created_at=lt.${new Date(Date.now() - LOG_DAYS * 864e5).toISOString()}`, { method: 'DELETE' }).catch(() => {});
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
      if (draftOf(g)) bad('That war is drafting its Houses. No latecomers.');
      if (g.lobby.length >= MAX_PLAYERS) bad('Seven Houses already. The valley is full.');
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
      if (draftOf(g)) bad('The House Draft is under way.');
      let lobby = g.lobby;
      if (body.op === 'addBot') {
        if (lobby.length >= MAX_PLAYERS) bad('Lobby full.');
        const names = ['Proctor\'s Pet', 'Some Tall Bastard', 'A Very Angry Gold', 'The Draft Pick Nobody Wanted', 'Knife in a Nice Coat', 'Lord of Mud', 'The Quiet One'];
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
    case 'draftPick': case 'draftTimeout': {
      // The House Draft: the seat whose pick it is takes a House. Once its clock has run out, anyone at the table may
      // call time, and it is dealt a random one. The last pick starts the war.
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      const d = draftOf(g);
      if (!d) return g.status === 'lobby' ? bad('There is no House Draft to pick in.') : payload(current(g), seat);
      let r;
      if (body.op === 'draftTimeout') {
        if (!d.deadline || Date.now() < d.deadline) bad('There is still time on the clock.');
        r = draftPick(d, g.lobby, draftSeat(d), null, rng, Date.now());
      } else {
        const house = Number(body.house);
        if (!Number.isInteger(house)) bad('Pick a House.');
        r = draftPick(d, g.lobby, seat, house, rng, Date.now());
      }
      if (!r.ok) return bad(r.err);
      if (r.done) return await startWar(g, r.lobby, seat);
      if (!(await saveGame(g, g.version, { lobby: r.lobby, opts: { ...cleanSettings(g.opts ?? {}), draft: r.draft }, version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await broadcast(g.code, g.version + 1);
      return payload(await getGame(`id=eq.${g.id}`), seat);
    }
    case 'draftCancel': {
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      if (seat !== g.host_seat) bad('Only the host can call off the Draft.', 403);
      if (!draftOf(g)) bad('There is no House Draft to call off.');
      if (!(await saveGame(g, g.version, { lobby: noHouses(g.lobby), opts: cleanSettings(g.opts ?? {}), version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await broadcast(g.code, g.version + 1);
      return payload(await getGame(`id=eq.${g.id}`), seat);
    }
    case 'setOpts': {
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      if (seat !== g.host_seat) bad('Only the host sets the rules of the war.', 403);
      if (g.status !== 'lobby') bad('Too late, the war has started.');
      if (draftOf(g)) bad('The House Draft is under way.');
      if (!(await saveGame(g, g.version, { opts: cleanSettings(body.settings), version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await broadcast(g.code, g.version + 1);
      return payload(await getGame(`id=eq.${g.id}`), seat);
    }
    case 'start': {
      const g = await getGame(`id=eq.${gameId(body.game)}`);
      const seat = await seatFor(g, body.token);
      if (seat !== g.host_seat) bad('Only the host can start the war.', 403);
      if (g.status !== 'lobby') bad('Already started.');
      if (g.lobby.length < 2) bad('You need at least one rival. Add a human or an AI.');
      if (draftOf(g)) bad('The House Draft is already under way.');
      const settings = cleanSettings(g.opts ?? {});
      // House Selection: Random deals every House by lot. Draft opens the House Draft first (the AI seats pick at once).
      if (settings.houseSel !== 'draft') return await startWar(g, noHouses(g.lobby), seat);
      const d = openDraft(g.lobby, rng, Date.now());
      if (d.done) return await startWar(g, d.lobby, seat);
      if (!(await saveGame(g, g.version, { lobby: d.lobby, opts: { ...settings, draft: d.draft }, version: g.version + 1 }))) bad('Lobby changed, try again.', 409);
      await broadcast(g.code, g.version + 1);
      return payload(await getGame(`id=eq.${g.id}`), seat);
    }
    case 'state': {
      const g = current(await getGame(`id=eq.${gameId(body.game)}`));
      const seat = await seatFor(g, body.token);
      if (body.since != null && body.since === g.version) return { unchanged: true, version: g.version };
      return payload(g, seat, body.tv);
    }
    case 'act': {
      for (let attempt = 0; attempt < 3; attempt++) {
        const g = current(await getGame(`id=eq.${gameId(body.game)}`));
        const seat = await seatFor(g, body.token);
        if (!g.state) bad('Game has not started.');
        const s = g.state!;
        drainLog();
        const r = act(s, seat, body.action as Action, { rng, now: Date.now() });
        if (!r.ok) return { ...payload(g, seat, body.tv), error: r.err };
        runBots(s);
        const events = drainLog();
        const status = s.phase === 'over' ? 'over' : 'playing';
        if (await saveGame(g, g.version, { state: s, status, version: g.version + 1 })) {
          await broadcast(g.code, g.version + 1);
          await persistLog(g.id, events);
          return payload({ ...g, state: s, status, version: g.version + 1 }, seat, body.tv);
        }
      }
      bad('The valley is busy. Try again.', 409);
    }
    case 'kick': {
      const g = current(await getGame(`id=eq.${gameId(body.game)}`));
      const seat = await seatFor(g, body.token);
      if (seat !== g.host_seat) bad('Only the host can kick.', 403);
      const k = Number(body.seat);
      if (!Number.isInteger(k) || k === g.host_seat || !g.lobby.some((l) => l.seat === k)) bad('Pick another seat to kick.');
      if (g.status === 'lobby') {
        if (draftOf(g)) bad('Call off the House Draft first.');
        // The seat leaves the lobby; everyone after it moves up one.
        const lobby = g.lobby.filter((l) => l.seat !== k).map((l, i) => ({ ...l, seat: i }));
        if (!(await saveGame(g, g.version, { lobby, version: g.version + 1, host_seat: g.host_seat > k ? g.host_seat - 1 : g.host_seat }))) bad('Lobby changed, try again.', 409);
        await rest(`ic_players?game_id=eq.${g.id}&seat=eq.${k}`, { method: 'DELETE' });
        for (const l of g.lobby.filter((x) => x.seat > k).sort((a, b) => a.seat - b.seat)) {
          await rest(`ic_players?game_id=eq.${g.id}&seat=eq.${l.seat}`, { method: 'PATCH', body: JSON.stringify({ seat: l.seat - 1 }) });
        }
        await broadcast(g.code, g.version + 1);
        return payload(await getGame(`id=eq.${g.id}`), seat);
      }
      if (!g.state) bad('Game has not started.');
      const s = g.state!;
      drainLog();
      const r = kickToAI(s, k, { rng, now: Date.now() });
      if (!r.ok) bad(r.err);
      runBots(s);
      const events = drainLog();
      const lobby = g.lobby.map((l) => (l.seat === k ? { ...l, ai: true } : l));
      const status = s.phase === 'over' ? 'over' : 'playing';
      if (!(await saveGame(g, g.version, { state: s, status, lobby, version: g.version + 1 }))) bad('The valley is busy. Try again.', 409);
      // Their token stops working at once.
      await rest(`ic_players?game_id=eq.${g.id}&seat=eq.${k}`, { method: 'DELETE' });
      await broadcast(g.code, g.version + 1);
      await persistLog(g.id, events);
      return payload({ ...g, state: s, status, lobby, version: g.version + 1 }, seat);
    }
    case 'logs': {
      const id = gameId(body.game);
      const rows = await readLog(id);
      if (!rows.length) bad('No War Log for that war (logs are kept 90 days).', 404);
      const seat = await logSeat(id, body.token, rows);
      const events = rows.filter((r) => !r.event?.vis || r.event.vis.includes(seat)).map((r) => {
        if (r.event?.k === 'meta') { const { seats: _s, ...m } = r.event; return m; }
        if (r.event?.k === 'flag') return { ...r.event, at: r.created_at };
        return r.event;
      });
      return { seat, events };
    }
    case 'flag': {
      const id = gameId(body.game);
      const rows = await readLog(id);
      const seat = await logSeat(id, body.token, rows);
      const seq = Number(body.seq);
      if (!rows.some((r) => r.seq === seq && r.event?.k !== 'flag' && (!r.event?.vis || r.event.vis.includes(seat)))) bad('No such line in the War Log.');
      const note = cleanNote(body.note);
      if (!note) bad('Write a short note first.');
      if (rows.filter((r) => r.event?.k === 'flag').length >= 500) bad('This War Log has all the flags it can hold.');
      const recent = rows.filter((r) => r.event?.k === 'flag' && r.event.seat === seat && Date.now() - Date.parse(r.created_at) < 5000);
      if (recent.length) bad('One flag every few seconds, Pixie.');
      await rest('ic_logs', { method: 'POST', body: JSON.stringify({ game_id: id, seq, event: { id: seq, k: 'flag', seat, note } }) });
      return { ok: true };
    }
    case 'wars': {
      // A summary of the wars this browser fought in (for the "Past wars" list).
      const list = Array.isArray(body.wars) ? body.wars.slice(0, 30) : [];
      const out = [];
      for (const w of list) {
        try {
          const id = gameId(w?.game);
          const meta = (await rest(`ic_logs?game_id=eq.${id}&seq=eq.0&select=event,created_at&limit=1`))[0];
          if (!meta || meta.event?.k !== 'meta') continue;
          const hash = await sha(String(w.token ?? ''));
          if (!meta.event.seats?.some((x: any) => x.hash === hash)) continue;
          const last = (await rest(`ic_logs?game_id=eq.${id}&select=event&order=id.desc&limit=40`)).map((r: any) => r.event);
          const win = last.find((e: any) => e.k === 'win' || e.k === 'olympusFalls');
          out.push({ game: id, code: meta.event.code, started: meta.created_at, players: meta.event.players, over: !!win, winners: win ? (win.members ?? (win.seat != null ? [win.seat] : [])) : [] });
        } catch { /* skip that one */ }
      }
      return { wars: out };
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
