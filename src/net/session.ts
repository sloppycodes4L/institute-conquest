// Two ways to play, one interface: a local hot-seat/AI game running the engine in the
// browser, or an online game where the Supabase edge function is the authority.

import { RealtimeClient } from '@supabase/realtime-js';
import { DEFAULT_SETTINGS, act, actingSeat, aiDuty, createGame, draftSeat, viewFor, type Action, type GameEvent, type GameState, type HouseDraft, type WarSettings } from '../engine/engine.ts';
import { botAction, botFallback } from '../engine/bot.ts';

export const SUPABASE_URL = 'https://hflggavblnedfgyjqbsr.supabase.co';
// Publishable anon key: safe to ship in the client. The game tables are not readable with it.
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmbGdnYXZibG5lZGZneWpxYnNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NDQ1OTcsImV4cCI6MjEwNDMyMDU5N30.MWm1amKwcsMJc9VdpiNc_OajeXaYRdzJQZGBN2rB44Y';
const FN = `${SUPABASE_URL}/functions/v1/institute`;

/** A seat before the war. `house`: the House it chose in the House Draft (missing or null: not yet, or dealt at random). */
export interface LobbySeat { seat: number; name: string; ai?: boolean; house?: number | null; houseBy?: 'host' }
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
  /** A key for this war, to remember per-war things on this device (like having watched the Sorting). */
  key: string;
  settings: WarSettings;
  /** While this returns true, local AI seats wait (the screen is still replaying earlier moves). */
  hold?: () => boolean;
  /** Nudge local AI seats after a hold ends. */
  kick?(): void;
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
  key = `local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
  settings: WarSettings;
  hold?: () => boolean;
  lobby: LobbySeat[];
  view: GameState | null = null;
  seat: number | null = null;
  handoff: number | null = null;
  private s: GameState;
  private cbs: (() => void)[] = [];
  private shownSeat: number | null = null;
  private timer = 0;
  private clock = 0;
  private humans: number;

  constructor(seats: LobbySeat[], settings: WarSettings = DEFAULT_SETTINGS) {
    this.lobby = seats;
    this.settings = settings;
    this.humans = seats.filter((x) => !x.ai).length;
    this.s = createGame(seats.map((x) => x.name), secureRng, { ai: seats.map((x) => !!x.ai), settings, houses: seats.map((x) => x.house ?? null) });
    this.refresh();
    if (this.s.opts.timer) this.clock = window.setInterval(() => this.tickClock(), 500);
  }

  /**
   * The turn timer, hot-seat style: it only runs while a human can actually see their turn (not during the
   * hand-over screen or while earlier moves are still replaying), and calls time when it runs out.
   */
  private lastTick = Date.now();
  private tickClock() {
    const s = this.s, now = Date.now(), dt = now - this.lastTick;
    this.lastTick = now;
    if (!s.deadline || s.phase === 'over' || s.phase === 'passage' || s.reaction) return;
    if (s.players[s.cur]?.ai) return;
    if (this.handoff != null || this.hold?.()) {
      s.deadline += dt;
      if (this.view) this.view.deadline = s.deadline;
      return;
    }
    if (now >= s.deadline) {
      act(s, s.cur, { type: 'turnTimeout' }, { rng: secureRng, now });
      this.refresh();
    }
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
    // The new player's clock starts when they take the device.
    if (this.s.deadline && this.s.opts.timer) this.s.deadline = Date.now() + this.s.opts.timer * 1000;
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
    // The screen paces the replay of each move, so the AI only has to wait for it to catch up.
    const delay = duty >= 0 ? 700 : s.phase === 'passage' ? 250 : 60;
    this.timer = window.setTimeout(() => {
      if (this.hold?.()) { this.scheduleBots(); return; }
      const a = botAction(viewFor(s, acting), acting);
      let r = act(s, acting, a, { rng: secureRng, now: Date.now() });
      if (!r.ok && duty >= 0) {
        // An answer the AI can no longer give: burn the letter rather than ask again forever.
        const inv = s.invites.find((x) => x.to === acting);
        if (inv) act(s, acting, { type: 'answer', invite: inv.id, accept: false }, { rng: secureRng, now: Date.now() });
      }
      if (!r.ok && duty < 0) r = act(s, acting, botFallback(s, acting), { rng: secureRng, now: Date.now() });
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
  kick() { this.scheduleBots(); }
  close() { clearTimeout(this.timer); clearInterval(this.clock); this.cbs = []; }
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

export interface Creds { game: string; token: string; code: string; seat: number }
const credKey = (code: string) => `ic-creds-${code}`;
export function savedCreds(code: string): Creds | null {
  try { return JSON.parse(localStorage.getItem(credKey(code)) || 'null'); } catch { return null; }
}
function saveCreds(c: Creds) { try { localStorage.setItem(credKey(c.code), JSON.stringify(c)); } catch { /* private mode */ } }
/** Every online war this browser has joined. */
export function allCreds(): Creds[] {
  const out: Creds[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('ic-creds-')) continue;
      const c = JSON.parse(localStorage.getItem(k) || 'null');
      if (c?.game && c?.token) out.push(c);
    }
  } catch { /* private mode */ }
  return out;
}

/** A war's permanent War Log (every event, whole), as this seat may see it. */
export async function fetchWarLog(c: Creds): Promise<{ seat: number; events: GameEvent[] }> {
  return call({ op: 'logs', game: c.game, token: c.token });
}
/** Pin a short public note to one line of a War Log. */
export async function flagLine(c: Creds, seq: number, note: string): Promise<void> {
  const j = await call({ op: 'flag', game: c.game, token: c.token, seq, note });
  if (j.error) throw new Error(j.error);
}
export interface WarSummary { game: string; code: string; started: string; players: { seat: number; name: string; house: number; ai: boolean }[]; over: boolean; winners: number[] }
/** What the server remembers of the wars in `list`. */
export async function fetchWars(list: Creds[]): Promise<WarSummary[]> {
  const j = await call({ op: 'wars', wars: list.map((c) => ({ game: c.game, token: c.token })) });
  return j.wars ?? [];
}

export class OnlineSession implements Session {
  mode = 'online' as const;
  status: Session['status'] = 'lobby';
  lobby: LobbySeat[] = [];
  view: GameState | null = null;
  seat: number | null = null;
  code: string;
  hostSeat = 0;
  settings: WarSettings = { ...DEFAULT_SETTINGS };
  /** The House Draft, while the lobby is in one. */
  draft: HouseDraft | null = null;
  /** The server's clock minus this device's (ms), to read the Draft's deadline by. */
  skew = 0;
  get key() { return `online-${this.creds.game}`; }
  private version = -1;
  private cbs: (() => void)[] = [];
  private rt: RealtimeClient | null = null;
  private poll = 0;
  private timeoutTimer = 0;
  private turnTimer = 0;
  private draftTimer = 0;
  private lastTimeUp = 0;
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

  get credentials(): Creds { return this.creds; }
  /** Called when the server no longer seats this token (the host kicked us). */
  onGone?: (msg: string) => void;
  private gone = false;

  private apply(j: any) {
    if (j.unchanged) return;
    if (j.version != null && j.version < this.version) return;
    this.version = j.version;
    // Seats move up when someone ahead of us is kicked from the lobby.
    if (typeof j.seat === 'number' && j.seat !== this.seat) { this.seat = j.seat; this.creds.seat = j.seat; saveCreds(this.creds); }
    this.status = j.status;
    this.lobby = j.lobby;
    this.hostSeat = j.hostSeat;
    if (j.settings) this.settings = j.settings;
    this.draft = j.draft ?? null;
    if (typeof j.now === 'number') this.skew = j.now - Date.now();
    this.view = j.view;
    this.cbs.forEach((c) => c());
    this.armTimeout();
    this.armTurnTimer();
    this.armDraftTimer();
  }

  /**
   * When a House Draft pick runs out of time, any screen may call time on the server (which checks the clock itself and
   * deals that seat a random House). The picker's own screen asks first; the others wait a little longer.
   */
  private armDraftTimer() {
    clearTimeout(this.draftTimer);
    const d = this.draft;
    if (this.status !== 'lobby' || !d?.deadline) return;
    const wait = Math.max(0, d.deadline - (Date.now() + this.skew)) + (draftSeat(d) === this.seat ? 600 : 2500);
    this.draftTimer = window.setTimeout(async () => {
      try { this.apply(await call({ op: 'draftTimeout', game: this.creds.game, token: this.creds.token })); }
      catch (e) { this.checkGone(e); this.refresh(); }
    }, wait);
  }

  /**
   * When the turn timer runs out, any screen may call time on the server (which checks the clock itself).
   * The current player's screen asks first; the others wait a little longer, and nobody asks more than every few seconds.
   */
  private armTurnTimer() {
    clearTimeout(this.turnTimer);
    const v = this.view;
    if (!v?.deadline || v.reaction || !['draft', 'attack', 'fortify'].includes(v.phase)) return;
    const mine = this.seat === v.cur;
    const wait = Math.max(v.deadline - Date.now() + (mine ? 600 : 3500), this.lastTimeUp + 4000 - Date.now(), 0);
    this.turnTimer = window.setTimeout(() => {
      this.lastTimeUp = Date.now();
      this.send({ type: 'turnTimeout' }).catch(() => {});
    }, wait);
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
    try { this.apply(await call({ op: 'state', game: this.creds.game, token: this.creds.token, since: this.version, tv: this.view?.version })); }
    catch (e) { this.checkGone(e); }
    finally { this.busy = false; }
  }

  private checkGone(e: unknown) {
    if (this.gone || !/not seated/i.test((e as Error)?.message ?? '')) return;
    this.gone = true;
    try { localStorage.removeItem(credKey(this.code)); } catch { /* ignore */ }
    this.onGone?.('The host removed you from this war.');
  }

  async hostOp(op: 'start' | 'addBot' | 'removeBot' | 'setOpts' | 'kick', settings?: WarSettings, seat?: number): Promise<string | null> {
    try { this.apply(await call({ op, game: this.creds.game, token: this.creds.token, settings, seat })); return null; }
    catch (e) { this.checkGone(e); return (e as Error).message; }
  }

  /** The House Draft: take `house` (it must be this seat's pick). */
  async draftPick(house: number): Promise<string | null> {
    try { this.apply(await call({ op: 'draftPick', game: this.creds.game, token: this.creds.token, house })); return null; }
    catch (e) { this.checkGone(e); return (e as Error).message; }
  }
  /** The host calls the House Draft off: back to the War Council. */
  async draftCancel(): Promise<string | null> {
    try { this.apply(await call({ op: 'draftCancel', game: this.creds.game, token: this.creds.token })); return null; }
    catch (e) { this.checkGone(e); return (e as Error).message; }
  }

  async send(a: Action): Promise<string | null> {
    try {
      const j = await call({ op: 'act', game: this.creds.game, token: this.creds.token, action: a, tv: this.view?.version });
      this.apply(j);
      return j.error ?? null;
    } catch (e) { this.checkGone(e); return (e as Error).message; }
  }
  onUpdate(cb: () => void) { this.cbs.push(cb); }
  close() {
    clearInterval(this.poll);
    clearTimeout(this.timeoutTimer);
    clearTimeout(this.turnTimer);
    clearTimeout(this.draftTimer);
    this.rt?.disconnect();
    this.cbs = [];
  }
}
