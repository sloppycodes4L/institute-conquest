// Two ways to play, one interface: a local hot-seat/AI game running the engine in the
// browser, or an online game where the Supabase edge function is the authority.

import { RealtimeClient } from '@supabase/realtime-js';
import { act, actingSeat, aiDuty, createGame, viewFor, type Action, type GameState } from '../engine/engine.ts';
import { botAction } from '../engine/bot.ts';

export const SUPABASE_URL = 'https://hflggavblnedfgyjqbsr.supabase.co';
// Publishable anon key: safe to ship in the client. The game tables are not readable with it.
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmbGdnYXZibG5lZGZneWpxYnNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NDQ1OTcsImV4cCI6MjEwNDMyMDU5N30.MWm1amKwcsMJc9VdpiNc_OajeXaYRdzJQZGBN2rB44Y';
const FN = `${SUPABASE_URL}/functions/v1/institute`;

export interface LobbySeat { seat: number; name: string; ai?: boolean }
export interface Session {
  mode: 'local' | 'online';
  /** The view for whoever is at this screen right now. */
  view: GameState | null;
  /** The seat this screen controls (online: fixed; local: the acting human). */
  seat: number | null;
  status: 'lobby' | 'playing' | 'over';
  lobby: LobbySeat[];
  code?: string;
  hostSeat?: number;
  send(a: Action): Promise<string | null>;
  onUpdate(cb: () => void): void;
  /** Local hot-seat: true when the device must be handed to another human. */
  handoff?: number | null;
  ackHandoff?(): void;
  close(): void;
}

const secureRng = () => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296;
};

// ---------------------------------------------------------------------------

export class LocalSession implements Session {
  mode = 'local' as const;
  status: Session['status'] = 'playing';
  lobby: LobbySeat[];
  view: GameState | null = null;
  seat: number | null = null;
  handoff: number | null = null;
  private s: GameState;
  private cbs: (() => void)[] = [];
  private shownSeat: number | null = null;
  private timer = 0;
  private humans: number;

  constructor(seats: LobbySeat[]) {
    this.lobby = seats;
    this.humans = seats.filter((x) => !x.ai).length;
    this.s = createGame(seats.map((x) => x.name), secureRng, { ai: seats.map((x) => !!x.ai) });
    this.refresh();
  }

  private refresh() {
    const s = this.s;
    this.status = s.phase === 'over' ? 'over' : 'playing';
    const acting = actingSeat(s);
    const humanActing = acting >= 0 && !s.players[acting].ai;
    // Whose eyes are on the screen: the acting human, else the last human we showed.
    let eyes = humanActing ? acting : this.shownSeat ?? s.players.find((p) => !p.ai)?.seat ?? 0;
    if (s.phase === 'over') eyes = this.shownSeat ?? eyes;
    if (humanActing && this.humans > 1 && this.shownSeat !== null && this.shownSeat !== acting) this.handoff = acting;
    if (this.handoff == null) this.shownSeat = eyes;
    this.seat = this.handoff ?? eyes;
    this.view = viewFor(s, this.handoff != null ? null : eyes);
    if (this.handoff != null) this.view.me = undefined;
    this.cbs.forEach((c) => c());
    this.scheduleBots();
  }

  ackHandoff() {
    if (this.handoff == null) return;
    this.shownSeat = this.handoff;
    this.handoff = null;
    this.refresh();
  }

  private scheduleBots() {
    clearTimeout(this.timer);
    const s = this.s;
    if (s.phase === 'over' || this.handoff != null) return;
    // AI seats answer invitations and siege votes even when it isn't their turn.
    const duty = aiDuty(s);
    const acting = duty >= 0 ? duty : actingSeat(s);
    if (acting < 0 || !s.players[acting].ai) return;
    const delay = duty >= 0 ? 900 : s.phase === 'attack' ? 650 : s.phase === 'passage' ? 300 : 420;
    this.timer = window.setTimeout(() => {
      const a = botAction(viewFor(s, acting), acting);
      let r = act(s, acting, a, { rng: secureRng, now: Date.now() });
      if (!r.ok && duty < 0) {
        const fb: Action = s.reaction ? { type: 'react', card: null } : s.ts.mustMove ? { type: 'move', n: s.ts.mustMove.min } : s.phase === 'draft' ? { type: 'endDraft' } : { type: 'endTurn' };
        r = act(s, acting, fb, { rng: secureRng, now: Date.now() });
      }
      this.refresh();
    }, delay);
  }

  async send(a: Action) {
    if (this.handoff != null) return 'Hand the device over first.';
    const seat = a.type === 'timeout' ? actingSeat(this.s) : this.seat!;
    const r = act(this.s, seat, a, { rng: secureRng, now: Date.now() + (a.type === 'timeout' ? 1e9 : 0) });
    this.refresh();
    return r.ok ? null : r.err;
  }
  onUpdate(cb: () => void) { this.cbs.push(cb); }
  close() { clearTimeout(this.timer); this.cbs = []; }
}

// ---------------------------------------------------------------------------

async function call(body: any) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify(body),
  });
  let j: any;
  try { j = await r.json(); } catch { throw new Error(`Server said ${r.status}`); }
  if (!r.ok && j?.error) throw new Error(j.error);
  return j;
}

interface Creds { game: string; token: string; code: string; seat: number }
const credKey = (code: string) => `ic-creds-${code}`;
export function savedCreds(code: string): Creds | null {
  try { return JSON.parse(localStorage.getItem(credKey(code)) || 'null'); } catch { return null; }
}
function saveCreds(c: Creds) { try { localStorage.setItem(credKey(c.code), JSON.stringify(c)); } catch { /* private mode */ } }

export class OnlineSession implements Session {
  mode = 'online' as const;
  status: Session['status'] = 'lobby';
  lobby: LobbySeat[] = [];
  view: GameState | null = null;
  seat: number | null = null;
  code: string;
  hostSeat = 0;
  private version = -1;
  private cbs: (() => void)[] = [];
  private rt: RealtimeClient | null = null;
  private poll = 0;
  private timeoutTimer = 0;
  private busy = false;

  private constructor(private creds: Creds) {
    this.code = creds.code;
    this.seat = creds.seat;
  }

  static async create(name: string) {
    const j = await call({ op: 'create', name });
    const s = new OnlineSession({ game: j.id, token: j.token, code: j.code, seat: j.seat });
    saveCreds(s.creds);
    s.apply(j);
    s.connect();
    return s;
  }
  static async join(code: string, name: string) {
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const saved = savedCreds(code);
    if (saved) return OnlineSession.resume(saved);
    const j = await call({ op: 'join', code, name });
    const s = new OnlineSession({ game: j.id, token: j.token, code: j.code, seat: j.seat });
    saveCreds(s.creds);
    s.apply(j);
    s.connect();
    return s;
  }
  static async resume(c: Creds) {
    const s = new OnlineSession(c);
    const j = await call({ op: 'state', game: c.game, token: c.token });
    s.apply(j);
    s.connect();
    return s;
  }

  private apply(j: any) {
    if (j.unchanged) return;
    if (j.version != null && j.version < this.version) return;
    this.version = j.version;
    this.status = j.status;
    this.lobby = j.lobby;
    this.hostSeat = j.hostSeat;
    this.view = j.view;
    this.cbs.forEach((c) => c());
    this.armTimeout();
  }

  /** If a Standard attack is waiting on a defender who went quiet, nudge the server after the deadline. */
  private armTimeout() {
    clearTimeout(this.timeoutTimer);
    const r = this.view?.reaction;
    if (!r) return;
    const wait = Math.max(0, r.deadline - Date.now()) + 1500 + (this.seat === this.view!.cur ? 0 : 2500);
    this.timeoutTimer = window.setTimeout(() => { this.send({ type: 'timeout' }).catch(() => {}); }, wait);
  }

  private connect() {
    this.rt = new RealtimeClient(`${SUPABASE_URL.replace('https', 'wss')}/realtime/v1`, { params: { apikey: SUPABASE_ANON } });
    this.rt.connect();
    this.rt.channel(`ic-${this.code}`).on('broadcast', { event: 'update' }, (m: any) => {
      if ((m?.payload?.version ?? 0) > this.version) this.refresh();
    }).subscribe();
    this.poll = window.setInterval(() => { if (!document.hidden) this.refresh(); }, 9000);
  }

  async refresh() {
    if (this.busy) return;
    this.busy = true;
    try { this.apply(await call({ op: 'state', game: this.creds.game, token: this.creds.token, since: this.version })); }
    catch { /* transient */ }
    finally { this.busy = false; }
  }

  async hostOp(op: 'start' | 'addBot' | 'removeBot'): Promise<string | null> {
    try { this.apply(await call({ op, game: this.creds.game, token: this.creds.token })); return null; }
    catch (e) { return (e as Error).message; }
  }

  async send(a: Action): Promise<string | null> {
    try {
      const j = await call({ op: 'act', game: this.creds.game, token: this.creds.token, action: a });
      this.apply(j);
      return j.error ?? null;
    } catch (e) { return (e as Error).message; }
  }
  onUpdate(cb: () => void) { this.cbs.push(cb); }
  close() {
    clearInterval(this.poll);
    clearTimeout(this.timeoutTimer);
    this.rt?.disconnect();
    this.cbs = [];
  }
}
