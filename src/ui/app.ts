// UI controller: menus, lobby, HUD, cards, modals, diplomacy, and board interaction.

import { World, OLYMPUS, type OlympusMode } from '../render/scene.ts';
import { DiceTray } from '../render/dice.ts';
import { HOUSES, MAX_PLAYERS, QUADRANTS, TERRAIN_INFO, geoFor, layoutFor, mapGeo } from '../engine/data.ts';
import { CARD, CARDS, EMOTES, OLYMPUS_POWER, fmt, isSiegeCard } from '../engine/cards.ts';
import {
  type Action, type Frame, type GameEvent, type GameState, type WarSettings, DEFAULT_SETTINGS, EMOTE_COOLDOWN_MS, HAND_LIMIT, NEUTRAL, TURN_TIMERS, act, activeValue, drainLog,
  allianceOf, allied, attackBlocker, attackTargets, connectedOwned, fortifyRoute, geo, housesOwned, inviteBlocker, joinRallyBlocker, mustTrade, olympusPreview,
  ownsHouse, passive, primiOf, primusOptions, rallyBlocker, reinforcementBreakdown, resolveSettings, siegeBlocker, standardAt, terrainMods, territoriesOf,
} from '../engine/engine.ts';
import { LocalSession, OnlineSession, allCreds, fetchWarLog, fetchWars, flagLine, savedCreds, type Creds, type LobbySeat, type Session } from '../net/session.ts';
import { ERRORS_FLAVOR, PASSAGE_INTRO, RULES_HTML, TAGLINES, describe, headline } from './copy.ts';
import { VERSION } from '../version.ts';
import { assaultFight, attackFight, defenseNote, oddsClass, pct, standardFight, winChance } from './odds.ts';
import { sound, swordClash, type Mood } from './sound.ts';
import { ELEVEN_SOUNDS } from './audio-manifest.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const el = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const sig = (h: number, cls = 'sig') => `<span class="${cls}" style="background:${HOUSES[h].color};${h === 5 ? 'color:#222;text-shadow:none' : ''}">${HOUSES[h].sigil}</span>`;
const AI_NAMES = ['Proctor\'s Pet', 'Some Tall Bastard', 'A Very Angry Gold', 'The Draft Pick Nobody Wanted', 'Knife in a Nice Coat', 'Lord of Mud', 'The Quiet One'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SIZE_NAMES: Record<string, string> = { '-2': 'Smaller', '-1': 'Small', '0': 'Recommended', '1': 'Large', '2': 'Larger' };
const TROOP_NAMES: Record<string, string> = { '-2': 'Fewer', '-1': 'Less', '0': 'Recommended', '1': 'More', '2': 'Lots' };

/** What a card would do right now: the territories it touches, and a line or two about it. */
interface Impact { targets: number[]; tone: 'target' | 'place'; lines: string[] }

interface UIState {
  sel: number | null;
  target: number | null;
  trade: Set<string>;
  pending: { card: string; needs: 'territory' | 'seat' } | null;
  /** A card open in the big inspector (🔍). */
  inspect: string | null;
  /** A hand card under the mouse: its targets glow on the map. */
  hoverCard: string | null;
  /** A card play being previewed: the map shows `preview` (the outcome) until Back or Commit. */
  confirm: { action: Extract<Action, { type: 'play' }>; targets: number[]; preview: GameState | null } | null;
  placeAmt: number | 'all';
  dice: number;
  commit: number;
  moveN: number;
  stdMode: boolean;
  follow: number | null;
  mobileTab: 'none' | 'roster' | 'log';
  rosterMin: boolean;
  logMin: boolean;
  genMin: boolean;
  regionsMin: boolean;
  /** A House lit up on the map from the roster. */
  spot: number | null;
  /** A region row under the mouse: its land glows. */
  hoverRegion: number | null;
  /** A Keep whose Primus prompt the player opened from the Draft bar. */
  primusOpen: number | null;
  /** The emote menu is open. */
  emotes: boolean;
}

export class App {
  world: World;
  dice!: DiceTray;
  session: Session | null = null;
  ui: UIState = this.freshUI();
  lastEvent = -1;
  private screen: HTMLElement | null = null;
  private tip = el('<div class="tip hidden"></div>');
  private diceQueue: Promise<void> = Promise.resolve();
  private battleHide = 0;
  private sentPassage = false;
  private focusMode = store.get('ic-focus') === '1';
  // --- replay of other players' moves ---
  /** The view the screen is showing mid-replay (null when it shows the live view). */
  private disp: GameState | null = null;
  /** The last view actually put on screen, live or replayed: the base the next replayed frame builds on. */
  private shown: GameState | null = null;
  private shownVersion = -1;
  private queue: Frame[] = [];
  private playing = false;
  private skipping = false;
  private speed = +(store.get('ic-speed') || 1) || 1;
  private showcaseOpen = false;
  private wheelOpen = false;
  private localSettings: WarSettings = { ...DEFAULT_SETTINGS };
  /** Player preferences (this device only). */
  private prefs = { follow: store.get('ic-follow') !== '0', sound: store.get('ic-sound') !== '0' };
  /** The music stays in battle until this long after the last fight (ms timestamp). */
  private battleUntil = 0;

  constructor() {
    this.world = new World(document.getElementById('world')!, geoFor(4));
    document.body.appendChild(this.tip);
    this.world.onPick = (t) => this.pick(t);
    this.world.onHover = (t, x, y) => this.hover(t, x, y);
    this.world.controls.autoRotate = true;
    this.world.controls.autoRotateSpeed = 0.35;
    this.world.setOlympusMode((store.get('ic-olympus') as OlympusMode) || 'solid');
    this.world.idle();
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Panels collapse into tabs on narrow screens, so re-lay them out when the window changes.
    let resizeT = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => this.render(), 120); });
    // The turn clock in the top bar ticks on its own, without re-rendering the HUD.
    window.setInterval(() => { this.tickClock(); this.syncMood(); }, 250);
    // Every button answers with a soft click.
    document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest?.('button:not(:disabled)')) sound.play('click'); }, true);
    // Shift-click in the Draft takes armies back.
    window.addEventListener('pointerdown', (e) => { this.lastShift = e.shiftKey; }, true);
    const q = new URLSearchParams(location.search);
    const join = q.get('join');
    if (join) {
      const saved = savedCreds(join.toUpperCase());
      if (saved) this.resume(saved.code);
      else this.showJoin(join.toUpperCase());
    } else this.showTitle();
  }

  private freshUI(): UIState {
    return { sel: null, target: null, trade: new Set(), pending: null, inspect: null, hoverCard: null, confirm: null, placeAmt: 1, dice: 3, commit: 1, moveN: 1, stdMode: false, follow: null, mobileTab: 'none', rosterMin: false, logMin: window.innerWidth < 1300, genMin: false, regionsMin: window.innerHeight < 760, spot: null, hoverRegion: null, primusOpen: null, emotes: false };
  }

  // =========================================================================
  // screens

  private setScreen(html: string | null) {
    this.screen?.remove();
    this.screen = null;
    if (html) { this.screen = el(html); document.body.appendChild(this.screen); }
    return this.screen;
  }
  private get name() { return store.get('ic-name') || ''; }

  showTitle() {
    this.endSession();
    this.world.controls.autoRotate = true;
    const last = store.get('ic-last-code');
    const s = this.setScreen(`
      <div class="screen"><div class="menu">
        <div class="logo-sub">RED RISING · THE INSTITUTE</div>
        <h1 class="logo">CONQUEST</h1>
        <div class="tagline">${TAGLINES[Math.floor(Math.random() * TAGLINES.length)]}</div>
        <div class="stack">
          <input class="field" id="nm" maxlength="24" placeholder="Your name, Gold" value="${esc(this.name)}">
          <button class="btn primary big" data-a="create">Create Online War</button>
          <div class="row"><input class="field" id="code" maxlength="5" placeholder="CODE" style="text-transform:uppercase;letter-spacing:.2em;text-align:center"><button class="btn big" data-a="join">Join</button></div>
          ${last && savedCreds(last) ? `<button class="btn gold" data-a="rejoin">Rejoin war ${esc(last)}</button>` : ''}
          <button class="btn" data-a="local">Local · Hot-seat & AI</button>
          ${allCreds().length ? '<button class="btn ghost" data-a="wars">📜 Past wars (War Logs)</button>' : ''}
          <button class="btn ghost" data-a="rules">How to Play</button>
          <button class="btn ghost" data-a="codex">The Codex (all cards)</button>
        </div>
        <p class="fine">A free, non-commercial fan game inspired by Pierce Brown's <i>Red Rising</i>. Not affiliated with or endorsed by the author or publisher. Contains violence and foul language.</p>
        <p class="fine credits">Music: A.T.W., <i>The Wrath of God</i>.${ELEVEN_SOUNDS.length ? ' Some sound effects made with <a href="https://elevenlabs.io" target="_blank" rel="noopener">elevenlabs.io</a>.' : ''} Press M to mute.</p>
        <div class="version" title="Game version">Version ${VERSION}</div>
      </div></div>`)!;
    const nm = s.querySelector<HTMLInputElement>('#nm')!;
    const nameOk = () => { const n = nm.value.trim(); if (!n) { this.toast('Give yourself a name first, Pixie.'); nm.focus(); return null; } store.set('ic-name', n); return n; };
    s.addEventListener('click', async (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      if (a === 'create') { const n = nameOk(); if (!n) return; await this.busy(async () => { this.startSession(await OnlineSession.create(n)); }); }
      if (a === 'join') {
        const n = nameOk(); if (!n) return;
        const code = s.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
        if (code.length < 5) return this.toast('Codes are 5 characters.');
        await this.busy(async () => { this.startSession(await OnlineSession.join(code, n)); });
      }
      if (a === 'rejoin' && last) this.resume(last);
      if (a === 'local') this.showLocalSetup();
      if (a === 'wars') this.showWars();
      if (a === 'rules') this.modalRules();
      if (a === 'codex') this.modalCodex();
    });
  }

  /** Every online war fought from this browser whose War Log the server still keeps (90 days). */
  async showWars() {
    const creds = allCreds();
    const scr = this.setScreen(`<div class="screen"><div class="menu card-panel wide"><h2>📜 Past wars</h2><p class="fine">Reading the archives…</p></div></div>`)!;
    let wars: Awaited<ReturnType<typeof fetchWars>> = [];
    try { wars = await fetchWars(creds); } catch (e) { this.toast((e as Error).message); }
    if (this.screen !== scr) return;
    wars.sort((a, b) => b.started.localeCompare(a.started));
    const credOf = (id: string) => creds.find((c) => c.game === id)!;
    scr.innerHTML = `<div class="menu card-panel wide">
      <h2>📜 Past wars</h2>
      <p class="fine" style="margin:0 0 10px">Wars this browser fought in. Their full War Logs (every die) are kept for 90 days. Wars from before version .004 have no log.</p>
      ${wars.length ? wars.map((w) => {
        const me = credOf(w.game).seat;
        return `<div class="war-row">
          <div><b class="code">${esc(w.code)}</b> <span class="fine">${new Date(w.started).toLocaleString()}</span>
            <div class="war-houses">${w.players.map((p) => `<span class="${w.winners.includes(p.seat) ? 'won' : ''}">${sig(p.house, 'sig sm')} ${esc(p.name)}${p.seat === me ? ' <span class="you">YOU</span>' : ''}${w.winners.includes(p.seat) ? ' ♛' : ''}</span>`).join('')}</div>
            <div class="fine" style="margin:0">${w.over ? 'Decided' : 'Still raging (or abandoned)'}</div></div>
          <button class="btn primary" data-a="readlog" data-game="${w.game}">Read the War Log</button>
        </div>`;
      }).join('') : '<p class="prose">No War Logs yet. Fight an online war first.</p>'}
      <div class="row" style="margin-top:12px"><button class="btn" data-a="back">◂ Back</button></div>
    </div>`;
    scr.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b?.dataset.a === 'back') this.showTitle();
      if (b?.dataset.a === 'readlog') this.showWarLog(credOf(b.dataset.game!));
    };
  }

  /** One war's full War Log: filter by turn or House, export it as text, and flag a line with a public note. */
  async showWarLog(c: Creds) {
    const scr = this.setScreen(`<div class="screen"><div class="menu card-panel logview"><h2>📜 War Log ${esc(c.code)}</h2><p class="fine">Unrolling the scroll…</p></div></div>`)!;
    let data: { seat: number; events: GameEvent[] };
    try { data = await fetchWarLog(c); } catch (e) { this.toast((e as Error).message); return this.showWars(); }
    if (this.screen !== scr) return;
    const meta = data.events.find((e) => e.k === 'meta');
    if (!meta) { this.toast('That War Log is missing its first page.'); return this.showWars(); }
    const events = data.events.filter((e) => e.k !== 'meta' && e.k !== 'flag');
    const flags = data.events.filter((e) => e.k === 'flag');
    // A stand-in game for the War Log's words: the players, the map, and whose eyes are reading.
    const st = {
      players: meta.players.map((p: any) => ({ ...p, general: null, alive: true, dominatedBy: null })),
      opts: meta.opts, me: { seat: data.seat, hand: [], passage: null }, log: [], standards: [],
    } as unknown as GameState;
    for (const e of events) if (e.k === 'passage' && st.players[e.seat]) st.players[e.seat].general = e.general;
    // Which turn (and whose) each event belongs to.
    let turn = 0, whose = -1;
    const rows = events.map((e) => {
      if (e.k === 'turn') { turn = e.turn; whose = e.seat; }
      return { e, turn, whose };
    });
    const turns = [...new Set(rows.map((r) => r.turn))];
    const seatsIn = (e: GameEvent): number[] => {
      if (e.k.startsWith('invite')) return [e.from, e.to];
      return [e.seat, e.def, e.victim, e.captor, e.by, e.leaver, ...(e.members ?? [])].filter((x) => typeof x === 'number' && x >= 0);
    };
    const dice = (e: GameEvent) => {
      if (!Array.isArray(e.rolls) || !e.rolls.length) return '';
      const one = (r: any) => `${r.a.map((x: number, i: number) => (x !== r.raw.a[i] ? `${r.raw.a[i]}<sup>+${x - r.raw.a[i]}</sup>` : `${x}`)).join(' ')} <span class="vs">vs</span> ${r.d.map((x: number, i: number) => (x !== r.raw.d[i] ? `${r.raw.d[i]}<sup>+${x - r.raw.d[i]}</sup>` : `${x}`)).join(' ')}`;
      return `<details class="dice"><summary>🎲 ${e.rolls.length} roll${e.rolls.length === 1 ? '' : 's'}</summary>${e.rolls.map((r: any, i: number) => `<div>${i + 1}. ${one(r)} <span class="fine">(−${r.aLoss} / −${r.dLoss})</span></div>`).join('')}</details>`;
    };
    const text = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent ?? ''; };
    const f = { turn: 'all', seat: 'all' };
    const visible = () => rows.filter((r) => (f.turn === 'all' || r.turn === +f.turn) && (f.seat === 'all' || seatsIn(r.e).includes(+f.seat)));
    const draw = () => {
      const list = visible().map((r) => {
        const line = describe(st, r.e);
        if (!line) return '';
        const fl = flags.filter((x) => x.id === r.e.id);
        return `<div class="lv-line" data-seq="${r.e.id}"><span class="lv-t">T${r.turn}</span><div class="lv-body">${line}${dice(r.e)}
          ${fl.map((x) => `<div class="lv-flag">⚑ ${sig(st.players[x.seat]?.house ?? 0, 'sig sm')} <b>${esc(st.players[x.seat]?.name ?? '?')}</b>: ${esc(x.note)}</div>`).join('')}</div>
          <button class="btn sm ghost" data-a="flag" data-seq="${r.e.id}" title="Pin a short public note to this line">⚑ Flag</button></div>`;
      }).join('');
      const body = scr.querySelector('#lvList');
      if (body) body.innerHTML = list || '<p class="fine">Nothing matches.</p>';
    };
    scr.innerHTML = `<div class="menu card-panel logview">
      <h2>📜 War Log ${esc(c.code)}</h2>
      <div class="war-houses">${st.players.map((p) => `<span>${sig(p.house, 'sig sm')} ${esc(p.name)}${p.seat === data.seat ? ' <span class="you">YOU</span>' : ''}</span>`).join('')}</div>
      <div class="row lv-filters">
        <label>Turn <select id="lvTurn"><option value="all">All ${turns.length}</option>${turns.filter((t) => t > 0).map((t) => { const r = rows.find((x) => x.turn === t)!; return `<option value="${t}">T${t}${r.whose >= 0 ? ` · ${esc(st.players[r.whose].name)}` : ''}</option>`; }).join('')}</select></label>
        <label>House <select id="lvSeat"><option value="all">Everyone</option>${st.players.map((p) => `<option value="${p.seat}">${esc(p.name)} (${HOUSES[p.house].name})</option>`).join('')}</select></label>
        <span class="grow"></span>
        <button class="btn sm" data-a="export">⤓ Export text</button>
        <button class="btn sm" data-a="back">◂ Past wars</button>
      </div>
      <div class="lv-list" id="lvList"></div>
    </div>`;
    draw();
    scr.querySelector<HTMLSelectElement>('#lvTurn')!.onchange = (e) => { f.turn = (e.target as HTMLSelectElement).value; draw(); };
    scr.querySelector<HTMLSelectElement>('#lvSeat')!.onchange = (e) => { f.seat = (e.target as HTMLSelectElement).value; draw(); };
    scr.onclick = async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'back') return this.showWars();
      if (b.dataset.a === 'export') {
        const out = visible().map((r) => {
          const line = text(describe(st, r.e));
          if (!line) return '';
          const rolls = Array.isArray(r.e.rolls) ? r.e.rolls.map((x: any) => `    dice ${x.a.join(' ')} vs ${x.d.join(' ')} (raw ${x.raw.a.join(' ')} vs ${x.raw.d.join(' ')})`).join('\n') : '';
          const fl = flags.filter((x) => x.id === r.e.id).map((x) => `    FLAG ${st.players[x.seat]?.name}: ${x.note}`).join('\n');
          return [`T${r.turn}  ${line}`, rolls, fl].filter(Boolean).join('\n');
        }).filter(Boolean).join('\n');
        const blob = new Blob([`Institute Conquest · War Log ${c.code}\n${st.players.map((p) => `${p.name} (House ${HOUSES[p.house].name})`).join(', ')}\n\n${out}\n`], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `war-log-${c.code}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return;
      }
      if (b.dataset.a === 'flag') {
        const note = prompt('A short note for everyone in this war (140 characters):')?.trim();
        if (!note) return;
        try {
          await flagLine(c, +b.dataset.seq!, note.slice(0, 140));
          flags.push({ id: +b.dataset.seq!, k: 'flag', seat: data.seat, note: note.slice(0, 140) });
          draw();
          this.toast('Flagged. Everyone in this war can see it.');
        } catch (err) { this.toast((err as Error).message); }
      }
    };
  }

  showJoin(code: string) {
    this.showTitle();
    this.screen!.querySelector<HTMLInputElement>('#code')!.value = code;
    this.toast(`You've been summoned to war ${code}. Enter a name and hit Join.`);
  }

  private async resume(code: string) {
    const c = savedCreds(code);
    if (!c) return this.showTitle();
    await this.busy(async () => { this.startSession(await OnlineSession.resume(c)); }, () => this.showTitle());
  }

  showLocalSetup() {
    const seats: { kind: 'human' | 'ai' | 'empty'; name: string }[] = Array.from({ length: MAX_PLAYERS }, (_, i) => ({
      kind: i === 0 ? 'human' : i < 3 ? 'ai' : 'empty',
      name: i === 0 ? this.name || 'Reaper' : AI_NAMES[i - 1],
    }));
    // Two steps: who fights, then the rules of the war.
    let step: 'seats' | 'rules' = 'seats';
    const ws = this.localSettings;
    const draw = () => {
      const n = seats.filter((x) => x.kind !== 'empty').length;
      const s = step === 'seats' ? this.setScreen(`
        <div class="screen"><div class="menu card-panel">
          <div class="steps"><span class="on">1 · Houses</span><span>2 · War settings</span></div>
          <h2>Local War</h2>
          <p class="fine" style="margin:0 0 14px">Up to ${MAX_PLAYERS} Houses. Hot-seat: pass one device between humans. Empty seats become neutral Houses.</p>
          ${seats.map((x, i) => `<div class="seat-row">
            <div class="seg">${(['human', 'ai', 'empty'] as const).map((k) => `<button data-seat="${i}" data-k="${k}" class="${x.kind === k ? 'on' : ''}">${k === 'human' ? 'Human' : k === 'ai' ? 'AI' : 'None'}</button>`).join('')}</div>
            <input class="field nm" data-name="${i}" value="${esc(x.name)}" maxlength="24" ${x.kind === 'empty' ? 'disabled' : ''}>
          </div>`).join('')}
          <div class="row" style="margin-top:12px"><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="next">Next: War settings ▸</button></div>
        </div></div>`)! : this.setScreen(`
        <div class="screen"><div class="menu card-panel">
          <div class="steps"><span>1 · Houses</span><span class="on">2 · War settings</span></div>
          <h2>War Settings</h2>
          ${this.settingsHTML(ws, n, true)}
          <div class="row" style="margin-top:12px"><button class="btn" data-a="prev">◂ Houses</button><button class="btn primary" data-a="go">Begin the Institute</button></div>
        </div></div>`)!;
      s.querySelectorAll<HTMLInputElement>('[data-name]').forEach((inp) => inp.addEventListener('input', () => { seats[+inp.dataset.name!].name = inp.value; }));
      s.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b || b.disabled) return;
        if (b.dataset.seat) { seats[+b.dataset.seat].kind = b.dataset.k as any; draw(); return; }
        if (b.dataset.set) { this.applySetting(ws, b.dataset.set, b.dataset.v!); draw(); return; }
        if (b.dataset.a === 'back') this.showTitle();
        if (b.dataset.a === 'prev') { step = 'seats'; draw(); }
        const chosen: LobbySeat[] = seats.filter((x) => x.kind !== 'empty').map((x, i) => ({ seat: i, name: x.name.trim() || `Gold ${i + 1}`, ai: x.kind === 'ai' }));
        if (b.dataset.a === 'next' || b.dataset.a === 'go') {
          if (chosen.length < 2) return this.toast('You need at least two Houses to have a war.');
          if (!chosen.some((x) => !x.ai)) return this.toast('At least one human, or who is this for?');
        }
        if (b.dataset.a === 'next') { step = 'rules'; draw(); }
        if (b.dataset.a === 'go') this.startSession(new LocalSession(chosen, { ...ws }));
      });
    };
    draw();
  }

  private applySetting(ws: WarSettings, k: string, v: string) {
    if (k === 'reset') Object.assign(ws, DEFAULT_SETTINGS);
    if (k === 'timer') ws.timer = +v;
    if (k === 'size' || k === 'troops') ws[k] = +v;
    if (k === 'alliances') { ws.alliances = v === '1'; if (!ws.alliances) ws.siege = false; }
    if (k === 'siege') ws.siege = v === '1';
  }

  /** Map size, starting troops, and the alliance/siege switches, for `n` players. Read-only unless `edit`. */
  private settingsHTML(ws: WarSettings, n: number, edit: boolean) {
    const N = Math.max(2, n);
    const rec = resolveSettings(N);
    const cur = resolveSettings(N, ws);
    const dis = edit ? '' : 'disabled';
    const sizes = [-2, -1, 0, 1, 2].map((d) => {
      const L = layoutFor(N, d);
      // Sizes that clamp to the same valley as one nearer the recommendation are pointless.
      const dup = d !== 0 && L === layoutFor(N, d - Math.sign(d));
      return `<button data-set="size" data-v="${d}" class="${ws.size === d ? 'on' : ''} ${d === 0 ? 'rec' : ''}" ${dup || !edit ? 'disabled' : ''}>
        <span>${SIZE_NAMES[d]}</span><small>${mapGeo(L).nt} terr.</small></button>`;
    }).join('');
    const troops = [-2, -1, 0, 1, 2].map((d) => `<button data-set="troops" data-v="${d}" class="${ws.troops === d ? 'on' : ''} ${d === 0 ? 'rec' : ''}" ${dis}>
        <span>${TROOP_NAMES[d]}</span><small>${resolveSettings(N, { ...ws, troops: d }).troops}</small></button>`).join('');
    const toggle = (k: 'alliances' | 'siege', on: boolean, off = false) => `<div class="seg">
        <button data-set="${k}" data-v="1" class="${on ? 'on' : ''}" ${off || !edit ? 'disabled' : ''}>On</button>
        <button data-set="${k}" data-v="0" class="${!on ? 'on' : ''}" ${off || !edit ? 'disabled' : ''}>Off</button></div>`;
    return `<div class="settings">
      <div class="set-row"><div class="set-k">Map size <span class="fine">${n < 2 ? 'for 2 Houses' : `for ${n} Houses`}</span></div><div class="seg wide">${sizes}</div>
        <div class="set-note">${mapGeo(cur.layout).nt} territories${cur.layout === rec.layout ? ' (recommended)' : ''}. Bigger valleys mean longer wars.</div></div>
      <div class="set-row"><div class="set-k">Starting troops</div><div class="seg wide">${troops}</div>
        <div class="set-note">${cur.troops} soldiers per House around its Keep${ws.troops === 0 ? ' (recommended)' : ''}.</div></div>
      <div class="set-row"><div class="set-k">Turn timer</div><div class="seg wide">${TURN_TIMERS.map((t) => `<button data-set="timer" data-v="${t}" class="${(ws.timer ?? 0) === t ? 'on' : ''} ${t === 0 ? 'rec' : ''}" ${dis}><span>${t ? `${t}s` : 'None'}</span></button>`).join('')}</div>
        <div class="set-note">${ws.timer ? `${ws.timer} seconds a turn. When time runs out, unplaced armies go to the front and the turn passes.` : 'Take as long as you like.'}</div></div>
      <div class="set-row inline"><div class="set-k">Alliances</div>${toggle('alliances', ws.alliances)}</div>
      <div class="set-row inline"><div class="set-k">Siege on Olympus <span class="fine">(win condition)</span></div>${toggle('siege', ws.alliances && ws.siege, !ws.alliances)}</div>
      ${!ws.alliances ? '<div class="set-note">No alliances means no Siege on Olympus: last House standing wins.</div>' : ''}
      ${edit ? '<button class="btn sm ghost" data-set="reset" data-v="0">Reset to recommended</button>' : ''}
    </div>`;
  }

  private showLobby() {
    const s = this.session as OnlineSession;
    const host = s.seat === s.hostSeat;
    const link = `${location.origin}${location.pathname}?join=${s.code}`;
    const scr = this.setScreen(`
      <div class="screen"><div class="menu card-panel">
        <h2>War Council</h2>
        <div class="fine" style="margin:0">Share this code or link. Up to ${MAX_PLAYERS} Houses; the valley grows with every House.</div>
        <div class="code-big">${s.code}</div>
        <div class="row" style="margin-bottom:14px"><input class="field" readonly value="${esc(link)}"><button class="btn" data-a="copy" style="flex:0 0 auto">Copy link</button></div>
        ${s.lobby.map((l) => `<div class="seat-row"><span class="nm">${esc(l.name)} ${l.seat === s.seat ? '<span class="you">YOU</span>' : ''} ${l.ai ? '<span class="ai-tag">AI</span>' : ''}</span>${l.seat === s.hostSeat ? '<span class="fine" style="margin:0">host</span>' : host && !l.ai ? `<button class="btn sm ghost" data-a="kickSeat" data-seat="${l.seat}">Kick</button>` : ''}</div>`).join('')}
        ${host ? `<div class="row" style="margin-top:10px">
            <button class="btn" data-a="addBot" ${s.lobby.length >= MAX_PLAYERS ? 'disabled' : ''}>+ AI Primus</button>
            <button class="btn" data-a="removeBot" ${!s.lobby[s.lobby.length - 1]?.ai ? 'disabled' : ''}>− AI</button></div>` : ''}
        <h3 class="sub-h">WAR SETTINGS ${host ? '' : '<span class="fine">(the host decides)</span>'}</h3>
        ${this.settingsHTML(s.settings, s.lobby.length, host)}
        ${host ? `<button class="btn primary big" style="width:100%;margin-top:10px" data-a="start" ${s.lobby.length < 2 ? 'disabled' : ''}>Start the War</button>`
        : '<p class="tagline">Waiting for the host to start. Sharpen something.</p>'}
        <button class="btn ghost" style="margin-top:10px" data-a="leave">Leave</button>
      </div></div>`)!;
    scr.addEventListener('click', async (e) => {
      const set = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-set]');
      if (set && !set.disabled && host) {
        const next = { ...s.settings };
        this.applySetting(next, set.dataset.set!, set.dataset.v!);
        const err = await s.hostOp('setOpts', next);
        if (err) this.toast(err);
        return;
      }
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'copy') { navigator.clipboard?.writeText(link).then(() => this.toast('Link copied. Go recruit.'), () => this.toast(link)); }
      if (a === 'addBot' || a === 'removeBot' || a === 'start') { const err = await s.hostOp(a); if (err) this.toast(err); }
      if (a === 'kickSeat') {
        const seat = +(e.target as HTMLElement).closest<HTMLElement>('[data-seat]')!.dataset.seat!;
        const who = s.lobby.find((l) => l.seat === seat);
        if (who && confirm(`Kick ${who.name} from the War Council?`)) { const err = await s.hostOp('kick', undefined, seat); if (err) this.toast(err); }
      }
      if (a === 'leave') this.showTitle();
    });
  }

  // =========================================================================
  // session lifecycle

  private startSession(s: Session) {
    this.endSession();
    this.session = s;
    this.ui = this.freshUI();
    this.lastEvent = -1;
    this.sentPassage = false;
    this.disp = null; this.shown = null; this.shownVersion = -1; this.queue = []; this.playing = false; this.skipping = false;
    this.showcaseOpen = false; this.wheelOpen = false;
    // Local AI seats wait while the screen is still replaying their earlier moves.
    s.hold = () => this.playing || this.showcaseOpen || this.wheelOpen;
    if (s instanceof OnlineSession) {
      s.onGone = (msg) => { this.showTitle(); this.toast(msg); };
      store.set('ic-last-code', s.code);
      history.replaceState(null, '', `${location.pathname}?join=${s.code}`);
    }
    s.onUpdate(() => this.onUpdate());
    this.onUpdate();
  }

  private endSession() {
    this.session?.close();
    this.session = null;
    this.skipping = true; // unwinds a replay in progress
    this.queue = [];
    document.getElementById('hud')?.remove();
    document.getElementById('modal-root')?.remove();
    document.getElementById('bloodflash')?.remove();
    document.querySelectorAll('.showcase, .terr-err, .wheel-wrap').forEach((x) => x.remove());
    document.body.classList.remove('sorting');
    this.world.clearArrow();
    this.world.setGeo(geoFor(4));
    this.world.idle();
    if (location.search) history.replaceState(null, '', location.pathname);
  }

  private onUpdate() {
    const s = this.session;
    if (!s) return;
    if (s.status === 'lobby') { this.showLobby(); return; }
    const v = s.view!;
    this.world.setGeo(geo(v));
    if (!document.getElementById('hud')) this.mountHUD();
    if (v.phase === 'passage' && !this.wheelOpen && store.get(`ic-sorted-${s.key}`) !== '1') this.showWheel(v);
    this.ingest(v);
  }

  // =========================================================================
  // replay: other players' moves, one step at a time

  /** Who counts as "someone else" whose moves get replayed: online, every other seat; local, only the AIs. */
  private replayable(f: Frame) {
    const s = this.session!, v = s.view!;
    if (s.mode === 'local') return !!v.players[f.seat]?.ai;
    return f.seat !== s.seat;
  }

  private ingest(v: GameState) {
    const fresh = (v.trail ?? []).filter((f) => f.v > Math.max(this.shownVersion, this.queue.at(-1)?.v ?? -1));
    const urgent = !!v.reaction && v.reaction.defender === this.me;
    const gap = this.shownVersion >= 0 && fresh.length > 0 && fresh[0].v !== Math.max(this.shownVersion, this.queue.at(-1)?.v ?? -1) + 1;
    if (this.shownVersion < 0 || urgent || gap || (v.phase === 'over' && !fresh.some((f) => this.replayable(f)))) {
      if (this.playing) this.skipping = true;
      else this.snap(v);
      return;
    }
    if (!this.playing && !fresh.some((f) => this.replayable(f))) { this.snap(v); return; }
    this.queue.push(...fresh);
    if (!this.playing) void this.playQueue();
    else this.render();
  }

  /** Show the live view as it is, animating only our own fresh events. */
  private snap(v: GameState) {
    this.disp = null;
    this.shown = v;
    this.shownVersion = v.version;
    this.queue = [];
    this.processEvents(v);
    this.world.update(v);
    this.validateUI(v);
    if (this.ui.confirm?.preview) this.world.update(this.ui.confirm.preview);
    this.render();
  }

  private async playQueue() {
    this.playing = true;
    this.skipping = false;
    this.ui.sel = null; this.ui.target = null; this.ui.pending = null; this.ui.confirm = null;
    this.world.clearArrow();
    try {
      while (this.queue.length && this.session) {
        const f = this.queue.shift()!;
        const live = this.session.view!;
        const base = this.shown ?? live;
        const d: GameState = {
          ...live,
          owner: base.owner.slice(), armies: base.armies.slice(), standards: base.standards.map((x) => ({ ...x })),
          cur: f.cur, phase: f.ph, reaction: null,
          ts: { ...live.ts, placed: {}, mustMove: null },
          log: live.log.filter((e) => e.id <= f.seq),
        };
        for (let i = 0; i < f.d.length; i += 3) { d.owner[f.d[i]] = f.d[i + 1]; d.armies[f.d[i]] = f.d[i + 2]; }
        for (let i = 0; i < (f.st?.length ?? 0); i += 3) { const st = d.standards[f.st![i]]; st.at = f.st![i + 1]; st.captured = !!f.st![i + 2]; }
        const evs = live.log.filter((e) => e.id > this.lastEvent && e.id <= f.seq);
        this.lastEvent = Math.max(this.lastEvent, f.seq);
        this.disp = d; this.shown = d; this.shownVersion = f.v;
        this.world.update(d);
        this.render();
        if (this.skipping) continue;
        if (this.replayable(f)) await this.present(d, evs, f);
        else for (const e of evs) this.quickEvent(d, e);
      }
    } finally {
      this.playing = false;
      this.skipping = false;
      this.world.clearArrow();
      const s = this.session;
      if (s?.view) {
        // Whatever arrived during the replay (or was skipped) lands at once.
        this.lastEvent = Math.max(this.lastEvent, s.view.log.at(-1)?.id ?? 0);
        this.snap(s.view);
        s.kick?.();
      }
    }
  }

  /** How long to linger on each kind of move (ms, before the speed setting). */
  private async present(d: GameState, evs: GameEvent[], f: Frame) {
    // While your own turn clock is running, catch up on the replay at top speed.
    const live = this.session?.view;
    const rush = !!live?.deadline && live.cur === this.me;
    const w = (ms: number) => (this.skipping ? Promise.resolve() : sleep(ms / (rush ? Math.max(4, this.speed) : this.speed)));
    const cam = (ts: number[]) => { if (this.prefs.follow) this.world.follow(ts); };
    let shown = false;
    this.regionWhisper(d, evs);
    for (const e of evs) {
      if (this.skipping || !this.session) return;
      const hl = headline(d, e);
      if (hl) this.banner(hl.title, hl.sub, hl.color, hl.long);
      this.sfx(d, e);
      switch (e.k) {
        case 'battle': case 'stdBattle': case 'assault':
          cam([e.from, e.k === 'assault' ? OLYMPUS : e.to]);
          await this.showBattle(d, e);
          await w(1000);
          shown = true;
          break;
        case 'overwhelm':
          cam([e.from, e.to]);
          this.world.arrow(e.from, e.to, '#f3d27a');
          this.world.burst(e.to, HOUSES[d.players[e.seat].house].color);
          this.whisper(describe(d, e));
          await w(900); this.world.clearArrow(); shown = true;
          break;
        case 'emote':
          this.whisper(describe(d, e));
          break;
        case 'place':
          cam([e.t]);
          this.world.burst(e.t, HOUSES[d.players[e.seat].house].color);
          this.world.flash([e.t], '#f3d27a', 700);
          await w(420); shown = true;
          break;
        case 'fortify':
          cam(e.path ?? [e.from, e.to]);
          this.world.route(e.path ?? [e.from, e.to], e.to);
          await w(1300); this.world.clearArrow(); shown = true;
          break;
        case 'moveStd':
          cam([e.from, e.to]);
          this.world.arrow(e.from, e.to, '#f3d27a');
          await w(1000); this.world.clearArrow(); shown = true;
          break;
        case 'play':
          await this.showcase(d, e);
          shown = true;
          break;
        case 'turn': {
          const st = d.standards[d.players[e.seat].house];
          if (e.seat !== this.me) cam([st.captured ? territoriesOf(d, e.seat)[0] ?? -1 : st.at]);
          this.turnBanner(d, e.seat);
          await w(1100); shown = true;
          break;
        }
        case 'trade': case 'discardProctor': case 'undoDraft':
          this.whisper(describe(d, e));
          await w(900); shown = true;
          break;
        default:
          if (hl) { await w(hl.long ? 2200 : 1400); shown = true; }
      }
    }
    if (!shown && f.d.length) await w(250);
  }

  /** Events from frames we don't linger on (our own), handled the snappy way. */
  private quickEvent(d: GameState, e: GameEvent) {
    const hl = headline(d, e);
    if (hl) this.banner(hl.title, hl.sub, hl.color, hl.long);
    this.sfx(d, e);
  }

  /** The sound of one event. Battles sound in showBattle instead, in time with the dice. */
  private sfx(v: GameState, e: GameEvent) {
    const p = (name: string, vol = 1, delay = 0) => sound.play(name, { vol, delay });
    switch (e.k) {
      case 'place': p('thud', 0.8); break;
      case 'unplace': case 'undoDraft': p('thud', 0.5); break;
      case 'phase': if (e.phase === 'attack' && e.seat === this.me) p('horn', 0.6); break;
      case 'fortify': case 'moveStd': p('march'); break;
      case 'overwhelm': p('whoosh'); p('warcry', 0.6, 0.12); break;
      case 'stdRaised': p('horn'); p('warcry', 1, 0.7); this.bumpBattle(); break;
      case 'warCry': p('warcry', 0.8); break;
      case 'counter': p('whoosh'); p('clash', 1, 0.15); break;
      case 'play': p('card'); p('cue', 0.8, 0.2); break;
      case 'trade': case 'discardProctor': p('card'); break;
      case 'region': p('cue', 0.7); break;
      case 'primus': p('confirm'); break;
      case 'stdCaptured': case 'dominated': p('boom'); p('scream', 0.8, 0.35); break;
      case 'neutralFall': p('boom', 0.6); break;
      case 'primusSlain': case 'passage': p('scream', 0.7); break;
      case 'betrayal': case 'defect': case 'siegeFailed': case 'siegeCollapsed': p('dread'); break;
      case 'allianceFormed': case 'rallyJoined': case 'allianceRevealed': p('confirm'); break;
      case 'warBegun': p('drum'); break;
      case 'siegeBegins': p('thunder'); p('horn', 1, 0.8); this.bumpBattle(); break;
      case 'olympusTurn': if (e.killed) p('boom', 0.6); break;
      case 'olympusFalls': p('boom'); p('rumble', 1, 0.3); p('warcry', 1, 0.9); break;
    }
  }

  /** Keep the battle music going for a while after a fight. */
  private bumpBattle() { this.battleUntil = Math.max(this.battleUntil, Date.now() + 45_000); }

  /** What the music should feel like right now (called every tick; the soundtrack only moves when this changes). */
  private syncMood() {
    const s = this.session;
    const v = s?.view;
    sound.ambience(!!v && s!.status !== 'lobby' && v.phase !== 'over');
    let m: Mood;
    if (!s || s.status === 'lobby' || !v) m = 'title';
    else if (v.phase === 'over') m = this.me == null || v.winners.includes(this.me) || !v.players[this.me] ? 'victory' : 'defeat';
    else if (v.phase === 'passage') m = 'calm';
    else if (Date.now() < this.battleUntil) m = 'battle';
    else m = v.warBegun || v.siege ? 'tense' : 'calm';
    sound.mood(m);
  }

  private turnBanner(v: GameState, seat: number) {
    const p = v.players[seat];
    const mine = seat === this.me;
    if (mine && this.prefs.sound && v.phase !== 'over') swordClash();
    else if (!mine && v.phase !== 'over') sound.play('drum', { vol: 0.4 });
    // Your turn: bring the camera home to your Standard (or your land if it's been taken).
    if (mine) this.ui.spot = null;
    if (mine && this.prefs.follow && v.phase !== 'over') {
      const st = v.standards[p.house];
      this.world.follow([st.captured ? territoriesOf(v, seat)[0] ?? -1 : st.at]);
    }
    const b = el(`<div class="turnban" style="--c:${HOUSES[p.house].color}">${sig(p.house)} <b>${mine ? 'YOUR TURN' : esc(p.name)}</b><span>${mine ? `House ${HOUSES[p.house].name}` : `House ${HOUSES[p.house].name}${p.ai ? ' · AI' : ''} takes the field`}</span></div>`);
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1900);
  }

  /** Regions that changed hands in these events, in one line (a domination can hand over several at once). */
  private regionWhisper(v: GameState, evs: GameEvent[]) {
    const got = evs.filter((e) => e.k === 'region');
    if (!got.length) return;
    const g = geo(v);
    const bySeat = new Map<number, GameEvent[]>();
    for (const e of got) bySeat.set(e.seat, [...(bySeat.get(e.seat) ?? []), e]);
    for (const [seat, es] of bySeat) {
      const p = v.players[seat];
      const names = es.map((e) => `<b>${esc(g.regions[e.region].name)}</b> +${e.bonus}`).join(', ');
      this.whisper(`⬡ ${sig(p.house, 'sig sm')} ${seat === this.me ? 'You hold' : `${esc(p.name)} holds`} ${names}`);
      this.world.flash(es.flatMap((e) => g.regions[e.region].terr), HOUSES[p.house].color, 1600);
    }
  }

  /** A small line of text over the map (used while replaying). */
  private whisper(html: string) {
    if (!html) return;
    const b = el(`<div class="whisper">${html}</div>`);
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2600);
  }

  private setSpeed(n: number) {
    this.speed = n;
    store.set('ic-speed', String(n));
    this.render();
  }

  private async busy(fn: () => Promise<void>, onErr?: () => void) {
    document.body.style.cursor = 'progress';
    try { await fn(); } catch (e) { this.toast((e as Error).message); onErr?.(); } finally { document.body.style.cursor = ''; }
  }

  // =========================================================================
  // HUD

  private mountHUD() {
    this.setScreen(null);
    this.world.controls.autoRotate = false;
    document.body.appendChild(el(`
      <div id="hud">
        <div class="corner left">
          <button class="icon-btn" data-a="menu" title="Menu">☰</button>
          <button class="icon-btn" data-a="rules" title="Rules">?</button>
          <button class="icon-btn" data-a="codex" title="Card codex">⚜</button>
          <button class="icon-btn" data-a="focus" id="btnFocus" title="My Lands: grey out everything you don't hold (G)">◐</button>
          <button class="icon-btn" data-a="olympus" id="btnOly" title="Olympus: solid / see-through / hidden (O)">⛰</button>
          <button class="icon-btn" data-a="diplo" id="btnDiplo" title="Diplomacy &amp; alliances">🤝<span class="dot hidden"></span></button>
          <button class="icon-btn" data-a="settings" title="Settings: camera and sound">⚙</button>
          <button class="icon-btn" data-a="emotes" id="btnEmote" title="Emote: shout a line into the War Log">💬</button>
        </div>
        <div class="emotes hidden" id="emotes"></div>
        <div class="corner right mobile-tabs">
          <button class="icon-btn" data-a="tab-roster" title="Houses &amp; your General">♜</button>
          <button class="icon-btn" data-a="tab-log" title="Regions &amp; war log">✎</button>
        </div>
        <div class="topbar" id="topbar"></div>
        <div class="battle hidden" id="battle"><div class="vs"><span id="bA"></span><span id="bD"></span></div><canvas id="dice"></canvas><div class="res" id="bRes"></div></div>
        <div class="leftcol" id="leftcol"><div class="general" id="general"></div><div class="side left" id="roster"></div></div>
        <div class="rightcol" id="rightcol"><div class="side regions" id="regions"></div><div class="side log" id="log"></div></div>
        <div class="notices" id="notices"></div>
        <div class="dock"><div class="actionbar" id="actionbar"></div><div class="hand" id="hand"></div></div>
      </div>`));
    document.body.appendChild(el('<div id="modal-root"></div>'));
    document.body.appendChild(el('<div class="bloodflash" id="bloodflash"></div>'));
    this.dice = new DiceTray(document.getElementById('dice') as HTMLCanvasElement);
    const hud = document.getElementById('hud')!;
    hud.addEventListener('click', (e) => this.onHudClick(e));
    hud.addEventListener('input', (e) => this.onHudInput(e));
  }

  /** What the screen shows: the replayed view mid-replay, else the live one. */
  private get v() { return this.disp ?? this.session!.view!; }
  private get me() { return this.session!.seat; }
  private get g() { return geo(this.v); }
  private tname(t: number) { return t === OLYMPUS ? 'Olympus' : this.g.territories[t].name; }
  private myTurn() {
    const s = this.session!, v = this.v;
    if (this.playing || this.wheelOpen) return false;
    return s.handoff == null && s.seat != null && v.cur === s.seat && !v.reaction && ['draft', 'attack', 'fortify'].includes(v.phase) && v.players[s.seat].alive;
  }
  private sieging() { const v = this.v; return this.me != null && !!v.siege?.members.includes(this.me); }

  private validateUI(v: GameState) {
    const u = this.ui;
    if (!this.myTurn()) { u.sel = null; u.target = null; u.pending = null; u.stdMode = false; }
    if (u.sel != null && v.owner[u.sel] !== this.me) { u.sel = null; u.target = null; }
    // A territory spent down to one army can't attack any more.
    if (u.sel != null && v.phase === 'attack' && v.armies[u.sel] < 2 && !v.ts.mustMove) { u.sel = null; u.target = null; this.world.clearArrow(); }
    if (u.target != null && u.sel == null) u.target = null;
    if (u.target === OLYMPUS && (!this.sieging() || u.sel == null || !this.g.territories[u.sel].foot)) u.target = null;
    if (v.phase !== 'draft') { u.pending = null; u.trade.clear(); }
    if (u.confirm && (!this.myTurn() || v.phase !== 'draft')) this.endPreview();
    if (v.phase === 'draft' && u.target != null) u.target = null;
    if (v.phase !== 'fortify') u.stdMode = false;
    const hand = v.me?.hand.map((c) => c.id) ?? [];
    for (const id of [...u.trade]) if (!hand.includes(id)) u.trade.delete(id);
  }

  render() {
    if (!this.session || this.session.status === 'lobby' || !document.getElementById('hud')) return;
    this.renderTop();
    this.renderGeneral();
    this.renderRoster();
    this.renderRegions();
    this.renderLog();
    this.renderActionBar();
    this.renderHand();
    this.renderNotices();
    this.renderHighlights();
    this.renderModals();
    this.renderEmotes();
    const lc = document.getElementById('leftcol')!, r = document.getElementById('roster')!, l = document.getElementById('log')!;
    const narrow = window.innerWidth <= 900;
    lc.classList.toggle('collapsed', narrow && this.ui.mobileTab !== 'roster');
    document.getElementById('rightcol')!.classList.toggle('collapsed', narrow && this.ui.mobileTab !== 'log');
    r.classList.toggle('min', !narrow && this.ui.rosterMin);
    l.classList.toggle('min', !narrow && this.ui.logMin);
    document.getElementById('btnFocus')!.classList.toggle('on', this.focusMode);
    document.getElementById('btnOly')!.classList.toggle('on', this.world.olympusMode !== 'solid');
    document.getElementById('btnOly')!.textContent = this.world.olympusMode === 'hidden' ? '⛶' : '⛰';
    const pending = this.me != null && (this.v.invites.some((i) => i.to === this.me) || this.voteOwed());
    document.querySelector('#btnDiplo .dot')!.classList.toggle('hidden', !pending);
    document.getElementById('btnDiplo')!.classList.toggle('hidden', this.v.opts?.alliances === false);
    const spot = this.ui.spot != null && this.v.players[this.ui.spot]?.alive ? this.ui.spot : null;
    this.world.setFocus(spot ?? (this.focusMode && this.me != null ? this.me : null));
    const root = document.getElementById('modal-root');
    if (root?.dataset.key === 'info-diplo') this.modalDiplo(true);
  }

  private lastEmoteAt = 0;
  /** The emote menu: a fixed list of lines; one every 15 seconds. */
  private renderEmotes() {
    const box = document.getElementById('emotes');
    if (!box) return;
    box.classList.toggle('hidden', !this.ui.emotes);
    if (!this.ui.emotes) return;
    const wait = Math.ceil((this.lastEmoteAt + EMOTE_COOLDOWN_MS - Date.now()) / 1000);
    box.innerHTML = `<div class="em-h">SAY IT TO THE VALLEY${wait > 0 ? ` <span class="fine">(${wait}s)</span>` : ''}</div>
      ${EMOTES.map((line, i) => `<button class="em" data-a="emote" data-n="${i}" ${wait > 0 ? 'disabled' : ''}>${esc(line)}</button>`).join('')}`;
  }

  private voteOwed() {
    const v = this.v;
    return !!v.vote && this.me != null && allianceOf(v, this.me)?.id === v.vote.alliance && !v.vote.yes.includes(this.me) && !v.vote.no.includes(this.me);
  }

  private renderTop() {
    const v = this.v;
    const p = v.players[v.cur];
    const phases = ['draft', 'attack', 'fortify'];
    const top = document.getElementById('topbar')!;
    if (v.phase === 'passage') { top.innerHTML = `<span class="turn-who">THE PASSAGE</span><span class="reinf">Choose your General</span>`; return; }
    if (v.phase === 'over') { top.innerHTML = `<span class="turn-who">THE WAR IS OVER</span>`; return; }
    const sg = v.siege;
    top.innerHTML = `
      ${sig(p.house)}
      <span class="turn-who" style="color:${HOUSES[p.house].color}">${esc(p.name)}${this.me === v.cur ? ' <span class="you">YOU</span>' : ''}</span>
      <div class="phases">${phases.map((ph) => `<span class="phase ${v.phase === ph ? 'on' : ''}">${ph}</span>`).join('')}</div>
      ${v.phase === 'draft' ? `<span class="reinf"><b>${v.ts.reinforcements}</b> to place</span>` : ''}
      ${sg ? `<span class="reinf siege-pill" title="Siege on Olympus: ${sg.turnsLeft} allied turns left">🏛 <b>${sg.garrison}</b> · ${sg.turnsLeft} left</span>` : ''}
      <span class="reinf" title="Round">R${Math.ceil(v.turn / Math.max(1, v.players.length))}</span>
      ${v.opts?.timer ? '<span class="reinf tmr" id="tmr" title="Turn timer"></span>' : ''}`;
    this.tickClock();
  }

  /** The turn clock: time left for whoever is acting, red in the last ten seconds. */
  private tickClock() {
    const el = document.getElementById('tmr');
    const live = this.session?.view;
    if (!el || !live) return;
    if (!live.deadline || live.reaction || live.players[live.cur]?.ai || !['draft', 'attack', 'fortify'].includes(live.phase)) { el.textContent = '⏱ —'; el.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((live.deadline - Date.now()) / 1000));
    el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 10);
    el.classList.toggle('mine', live.cur === this.me);
  }

  /** A General's passive, spelled out, with its suit (House) and whether it matches. */
  private primusHTML(seat: number, big = false) {
    const v = this.v, p = v.players[seat];
    if (!p.general || p.general === '?') return `<div class="primus muted">Primus: ${p.general === '?' ? 'chosen, still secret' : 'in the Passage…'}</div>`;
    const c = CARD[p.general];
    const match = c.house === p.house;
    const n = c.passive ? c.passive.n + (match ? 1 : 0) : 0;
    const suit = `<span class="suit" title="Card suit: House ${HOUSES[c.house].name}">${sig(c.house, 'sig sm')} ${HOUSES[c.house].name}</span>`;
    const badge = match
      ? `<span class="match" title="The card's House matches House ${HOUSES[p.house].name}: Passive +1">★ HOUSE MATCH +1</span>`
      : `<span class="nomatch" title="The card is House ${HOUSES[c.house].name}, the player is House ${HOUSES[p.house].name}: no bonus">≠ House ${HOUSES[p.house].name}</span>`;
    return `<div class="primus ${match ? 'is-match' : ''} ${big ? 'big' : ''}">
      <div class="pline"><b>${esc(c.name)}</b> ${suit} ${badge}</div>
      ${c.passive ? `<div class="ptext"><span class="k">PASSIVE</span> ${esc(fmt(c.passive.text, n))}</div>` : ''}
    </div>`;
  }

  /** The Primuses sworn in at the Keeps `seat` holds, with their Passives. */
  private primiHTML(seat: number, full = false) {
    const v = this.v, g = this.g;
    const list = primiOf(v, seat);
    if (!list.length) return '';
    return `<div class="primi">${list.map((x) => {
      const c = CARD[x.card];
      return `<div class="primi-row" title="${esc(c.name)}, Primus of ${esc(g.territories[g.keepOf(x.house)].name)}${c.passive ? `: ${esc(fmt(c.passive.text, c.passive.n))}` : ''}">♛ <b>${esc(c.name)}</b> <span class="muted">· ${esc(g.territories[g.keepOf(x.house)].name)}</span>${full && c.passive ? `<div class="ptext"><span class="k">PRIMUS</span> ${esc(fmt(c.passive.text, c.passive.n))}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  /** The online host may hand another human's seat to an AI. */
  private canKick(seat: number) {
    const s = this.session;
    return s instanceof OnlineSession && s.seat === s.hostSeat && seat !== s.seat && !this.v.players[seat].ai && this.v.phase !== 'over';
  }

  private renderGeneral() {
    const v = this.v, box = document.getElementById('general')!;
    if (this.me == null || v.phase === 'passage' || !v.players[this.me]) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const me = v.players[this.me];
    const al = allianceOf(v, this.me);
    const shared = (al?.members ?? []).filter((m) => m !== this.me).map((m) => {
      const p = v.players[m], c = p.general && p.general !== '?' ? CARD[p.general] : null;
      if (!c?.passive) return '';
      return `<div class="shared">${sig(p.house, 'sig sm')} <b>${esc(c.name)}</b> <span class="muted">(${esc(p.name)})</span>: ${esc(fmt(c.passive.text, c.passive.n + (c.house === p.house ? 1 : 0)))}</div>`;
    }).join('');
    box.innerHTML = `<h3 data-a="min-gen">YOUR GENERAL <span>${this.ui.genMin ? '▸' : '▾'}</span></h3>
      ${this.ui.genMin ? '' : `${this.primusHTML(this.me, true)}
      ${this.primiHTML(this.me, true)}
      ${shared ? `<div class="shared-h">🤝 SHARED BY ALLIES${al && !al.public ? ' (SECRET)' : ''}</div>${shared}` : ''}
      ${!me.alive ? '<div class="muted">Your House has fallen.</div>' : ''}`}`;
  }

  private renderRoster() {
    const v = this.v;
    const myAl = this.me != null ? allianceOf(v, this.me) : null;
    const rows = v.order.map((seat) => {
      const p = v.players[seat];
      const terr = territoriesOf(v, seat);
      const armies = terr.reduce((a, t) => a + v.armies[t], 0);
      const st = v.standards[p.house];
      const owned = housesOwned(v, seat);
      const al = allianceOf(v, seat);
      const allyTag = al ? `<span class="ally-tag ${al.public ? '' : 'secret'}" title="${al.public ? 'Public alliance' : 'Secret alliance (only members can see it)'}">${al.public ? '🤝' : '🤫'} ${al.members.filter((m) => m !== seat).map((m) => HOUSES[v.players[m].house].sigil).join('')}</span>` : '';
      return `<div class="player ${seat === v.cur && v.phase !== 'passage' ? 'cur' : ''} ${p.alive ? '' : 'dead'} ${myAl?.members.includes(seat) && seat !== this.me ? 'my-ally' : ''} ${this.ui.spot === seat ? 'spot' : ''}" ${p.alive ? `data-a="spot" data-seat="${seat}" title="Show ${esc(p.name)}'s land on the map"` : ''}>
        <div class="pn">${sig(p.house)} <span style="color:${HOUSES[p.house].color}">${esc(p.name)}</span>
          ${seat === this.me ? '<span class="you">YOU</span>' : ''}${p.ai ? '<span class="ai-tag">AI</span>' : ''}${allyTag}</div>
        ${this.primusHTML(seat)}
        ${this.primiHTML(seat)}
        ${this.canKick(seat) ? `<button class="btn sm ghost kick" data-a="kick" data-seat="${seat}" title="Hand ${esc(p.name)}'s House to an AI Primus">🥾 Kick</button>` : ''}
        ${p.alive ? `<div class="meta"><span>${terr.length} terr</span><span>${armies} armies</span><span>${v.handCounts[seat] ?? 0} cards</span>
          <span class="owned" title="Houses owned">${owned.map((h) => sig(h)).join('')}</span></div>
          <div class="meta">⚑ ${st.captured ? 'captured' : esc(this.g.territories[st.at].name)}${seat === v.cur && v.phase !== 'passage' ? '' : ` · +${reinforcementBreakdown(v, seat).total}/turn`}</div>`
        : `<div class="meta">Dominated by ${p.dominatedBy != null && p.dominatedBy >= 0 ? esc(v.players[p.dominatedBy].name) : 'the wilds'}</div>`}
      </div>`;
    }).join('');
    const neutral = HOUSES.map((_, h) => h).filter((h) => !v.players.some((p) => p.house === h));
    const nrows = neutral.map((h) => {
      const st = v.standards[h];
      return `<div class="player ${st.captured ? 'dead' : ''}"><div class="pn">${sig(h)} <span style="color:${HOUSES[h].color}">House ${HOUSES[h].name}</span> <span class="ai-tag">NEUTRAL</span></div>
        <div class="meta">${st.captured ? `Standard taken by ${st.by != null && st.by >= 0 ? esc(v.players[st.by].name) : '—'}` : `Garrison holds ${esc(this.g.territories[st.at].name)}`}</div></div>`;
    }).join('');
    document.getElementById('roster')!.innerHTML = `<h3 data-a="min-roster">THE HOUSES &amp; THEIR PRIMUSES <span>${this.ui.rosterMin ? '▸' : '▾'}</span></h3>${rows}${nrows}`;
  }

  private renderLog() {
    const v = this.v;
    const lines = v.log.slice().reverse().map((e) => describe(v, e)).filter(Boolean).slice(0, 70);
    document.getElementById('log')!.innerHTML = `<h3 data-a="min-log">WAR LOG <span>${this.ui.logMin ? '▸' : '▾'}</span></h3>${(this.ui.logMin ? lines.slice(0, 1) : lines).map((l) => `<div class="ev">${l}</div>`).join('')}`;
  }

  /**
   * Bonus regions: the ones you hold, then the ones you're closest to, so the next conquest has a goal.
   * Hover a row to light up its land.
   */
  private renderRegions() {
    const v = this.v, g = this.g, me = this.me;
    const box = document.getElementById('regions')!;
    const holder = (r: (typeof g.regions)[number]) => { const o = v.owner[r.terr[0]]; return o >= 0 && r.terr.every((t) => v.owner[t] === o) ? o : -1; };
    const row = (r: (typeof g.regions)[number], note: string, cls = '') =>
      `<div class="rg ${cls}" data-region="${r.id}"><span class="rg-n">${esc(r.name.replace(/^The /, ''))}</span><span class="rg-b">+${r.bonus}</span><span class="rg-note">${note}</span></div>`;
    let body = '';
    if (me != null && v.players[me] && v.phase !== 'passage') {
      const mine = g.regions.filter((r) => holder(r) === me);
      const near = g.regions.filter((r) => holder(r) !== me)
        .map((r) => ({ r, held: r.terr.filter((t) => v.owner[t] === me).length, touch: r.terr.some((t) => v.owner[t] === me || g.adj[t].some((x) => v.owner[x] === me)) }))
        .filter((x) => x.touch)
        .sort((a, b) => (b.held / b.r.terr.length) - (a.held / a.r.terr.length) || b.r.bonus - a.r.bonus)
        .slice(0, 6);
      body += mine.length ? `<div class="rg-h">YOURS · +${mine.reduce((a, r) => a + r.bonus, 0)} a turn</div>${mine.map((r) => row(r, '✓', 'held')).join('')}` : '';
      body += near.length ? `<div class="rg-h">WITHIN REACH</div>${near.map(({ r, held }) => {
        const miss = r.terr.filter((t) => v.owner[t] !== me);
        return row(r, `${held}/${r.terr.length}${miss.length <= 2 ? ` · need ${miss.map((t) => esc(g.territories[t].name)).join(', ')}` : ''}`);
      }).join('')}` : '';
    }
    const rivals = g.regions.map((r) => ({ r, o: holder(r) })).filter((x) => x.o >= 0 && x.o !== me);
    if (rivals.length) body += `<div class="rg-h">HELD BY RIVALS</div>${rivals.map(({ r, o }) => row(r, sig(v.players[o].house, 'sig sm'), 'rival')).join('')}`;
    if (!body) body = '<div class="rg-note" style="padding:6px 12px">Hold every territory of a region (gold borders on the map) for its bonus each turn.</div>';
    box.innerHTML = `<h3 data-a="min-regions">REGIONS <span>${this.ui.regionsMin ? '▸' : '▾'}</span></h3>${this.ui.regionsMin ? '' : body}`;
    if (!box.dataset.hover) {
      box.dataset.hover = '1';
      box.addEventListener('mouseover', (e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('.rg')?.dataset.region;
        const r = id != null ? +id : null;
        if (r !== this.ui.hoverRegion) { this.ui.hoverRegion = r; this.renderHighlights(); }
      });
      box.addEventListener('mouseleave', () => { if (this.ui.hoverRegion != null) { this.ui.hoverRegion = null; this.renderHighlights(); } });
    }
  }

  /** Floating cards for things you owe an answer to: invitations and siege votes. */
  private renderNotices() {
    const v = this.v, box = document.getElementById('notices')!;
    if (this.me == null || this.session!.handoff != null || v.phase === 'over') { box.innerHTML = ''; return; }
    const inv = v.invites.filter((i) => i.to === this.me).map((i) => {
      const p = v.players[i.from];
      const joining = allianceOf(v, i.from) ?? allianceOf(v, this.me!);
      const kind = joining ? `to join their ${joining.public ? 'public' : 'secret'} alliance` : i.public ? 'a PUBLIC alliance' : 'a SECRET alliance';
      return `<div class="notice" style="--c:${HOUSES[p.house].color}">
        <div class="nt">📜 A quiet message from ${sig(p.house)} <b>${esc(p.name)}</b></div>
        <div class="nb">They offer ${kind}. Allies share their Generals' Passives. Attacking an ally ends it.</div>
        <div class="row"><button class="btn sm primary" data-a="answer" data-id="${i.id}" data-yes="1">Accept</button><button class="btn sm" data-a="answer" data-id="${i.id}" data-yes="0">Burn it</button></div>
      </div>`;
    }).join('');
    let vote = '';
    if (this.voteOwed()) {
      const al = allianceOf(v, this.me)!;
      const o = olympusPreview(v, al.members);
      vote = `<div class="notice" style="--c:#f3d27a">
        <div class="nt">🏛 ${esc(v.players[v.vote!.by].name)} calls for a SIEGE ON OLYMPUS</div>
        <div class="nb">${o.garrison} defenders behind walls, +${o.regen}/turn, smites ${o.smite}/turn. ${o.turns} allied turns to break it, or the alliance shatters. Votes: ${v.vote!.yes.length} yes, ${v.vote!.no.length} no of ${al.members.length}.</div>
        <div class="row"><button class="btn sm gold" data-a="vote" data-yes="1">Storm it</button><button class="btn sm" data-a="vote" data-yes="0">Not yet</button></div>
      </div>`;
    }
    const r = v.rally;
    const rally = r && !joinRallyBlocker(v, this.me) && !this.rallyIgnored.has(`${r.by}:${r.turn}`) ? `<div class="notice" style="--c:${HOUSES[v.players[r.by].house].color}">
        <div class="nt">📯 ${sig(v.players[r.by].house)} <b>${esc(v.players[r.by].name)}</b> calls a RALLY AGAINST OLYMPUS</div>
        <div class="nb">The first to answer join their public alliance (${(allianceOf(v, r.by)?.members.length ?? 1)}/${r.slots}).${allianceOf(v, this.me) ? ' Answering walks out on your current allies: they\'ll call it betrayal.' : ''}</div>
        <div class="row"><button class="btn sm gold" data-a="joinRally">Answer it</button><button class="btn sm" data-a="ignoreRally">Ignore</button></div>
      </div>` : '';
    box.innerHTML = inv + vote + rally;
  }

  private attackSources(): number[] {
    const v = this.v, me = this.me!;
    const src = territoriesOf(v, me).filter((t) => v.armies[t] >= 2 && attackTargets(v, me, t).length > 0);
    if (this.sieging()) for (const t of this.g.foot) if (v.owner[t] === me && v.armies[t] >= 2 && !src.includes(t)) src.push(t);
    return src;
  }
  private canAssaultFrom(t: number) {
    return this.sieging() && this.g.territories[t].foot && this.v.owner[t] === this.me && this.v.armies[t] >= 2;
  }

  private renderHighlights() {
    const v = this.v, u = this.ui;
    if (this.showcaseOpen) return; // the card on the map owns the highlights
    if (u.confirm) { this.world.setHighlights(null, u.confirm.targets, 'target'); return; }
    if (u.hoverRegion != null && this.g.regions[u.hoverRegion]) { this.world.setHighlights(null, this.g.regions[u.hoverRegion].terr, 'place'); return; }
    const cardId = u.inspect ?? u.hoverCard;
    if (cardId && !this.playing && !u.pending && v.phase !== 'passage') {
      const imp = this.cardImpact(cardId);
      this.world.setHighlights(null, imp.targets, imp.tone);
      return;
    }
    if (!this.myTurn()) { this.world.setHighlights(null, [], 'attack'); return; }
    if (v.phase === 'draft') {
      if (u.pending?.needs === 'territory') this.world.setHighlights(null, this.cardImpact(u.pending.card).targets, 'target');
      else this.world.setHighlights(u.sel, territoriesOf(v, this.me!).filter((t) => t !== u.sel), 'place');
      return;
    }
    if (v.phase === 'attack') {
      if (u.sel == null) { this.world.setHighlights(null, [], 'attack', { sources: this.attackSources() }); return; }
      if (u.target != null) { this.world.setHighlights(u.sel, u.target === OLYMPUS ? [] : [u.target], 'attack'); return; }
      const tg = attackTargets(v, this.me!, u.sel);
      const warn = tg.filter((t) => allied(v, this.me!, v.owner[t]));
      this.world.setHighlights(u.sel, tg, 'attack', { fan: true, warn, olympus: this.canAssaultFrom(u.sel) });
      return;
    }
    if (v.phase === 'fortify') {
      const st = v.standards[v.players[this.me!].house];
      if (u.stdMode && !st.captured) { this.world.setHighlights(st.at, [...connectedOwned(v, this.me!, st.at)].filter((t) => t !== st.at), 'std'); return; }
      this.world.setHighlights(u.sel, u.sel != null ? (u.target != null ? [u.target] : [...connectedOwned(v, this.me!, u.sel)].filter((t) => t !== u.sel)) : [], 'fortify');
      // The guide line: where the troops will actually march.
      const r = u.sel != null && u.target != null ? fortifyRoute(v, this.me!, u.sel, u.target) : null;
      const key = r ? `${r.path.join('-')}>${r.stop}` : '';
      if (key !== this.routeKey) { this.routeKey = key; if (r) this.world.route(r.path, r.stop); else this.world.clearArrow(); }
      return;
    }
    if (this.routeKey) { this.routeKey = ''; this.world.clearArrow(); }
  }
  private routeKey = '';

  private renderActionBar() {
    const v = this.v, u = this.ui, bar = document.getElementById('actionbar')!;
    if (this.playing) {
      const p = v.players[v.cur];
      bar.classList.remove('hidden');
      bar.innerHTML = `<span class="hint watching">${sig(p.house, 'sig sm')} Watching <b style="color:${HOUSES[p.house].color}">${esc(p.name)}</b>${p.ai ? ' (AI)' : ''} · ${esc(v.phase)}${this.queue.length > 1 ? ` · ${this.queue.length} moves to go` : ''}</span>
        <div class="seg" title="Replay speed">${[1, 2, 4].map((n) => `<button data-a="speed" data-n="${n}" class="${this.speed === n ? 'on' : ''}">${n}×</button>`).join('')}</div>
        <button class="btn sm" data-a="skip" title="Jump to now">Skip ▸▸</button>`;
      return;
    }
    if (v.phase === 'passage' || v.phase === 'over') { bar.innerHTML = ''; bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    if (v.reaction) {
      const r = v.reaction;
      bar.innerHTML = r.defender === this.me ? `<span class="hint">A Standard is charging you!</span>` : `<span class="hint">${esc(v.players[r.defender].name)} is deciding whether to spring an ambush…</span>`;
      return;
    }
    if (!this.myTurn()) {
      const p = v.players[v.cur];
      bar.innerHTML = `<span class="hint">${p.ai ? `${esc(p.name)} (AI) is plotting your death…` : `Waiting on ${esc(p.name)}. The Proctors yawn.`}</span>`;
      return;
    }
    const T = this.g.territories;
    if (v.phase === 'draft') {
      if (u.pending) {
        bar.innerHTML = `<span class="hint">${u.pending.needs === 'territory' ? 'Click a glowing territory' : 'Pick a rival'} for <b>${esc(CARD[u.pending.card].name)}</b>.</span><button class="btn sm" data-a="cancel">Cancel</button>`;
        return;
      }
      const mt = mustTrade(v, this.me!);
      const placedTotal = Object.values(v.ts.placed).reduce((a, b) => a + b, 0);
      const sel = u.sel != null ? `<span class="selbox"><b>${esc(T[u.sel].name)}</b> ${v.armies[u.sel]}${v.ts.placed[u.sel] ? ` <span class="plus">(+${v.ts.placed[u.sel]})</span>` : ''}
          <button class="btn sm" data-a="minus" ${v.ts.placed[u.sel] ? '' : 'disabled'} title="Take back (Shift-click the territory)">−</button>
          <button class="btn sm" data-a="plus" ${v.ts.reinforcements > 0 ? '' : 'disabled'}>+</button></span>` : '';
      bar.innerHTML = `
        <span class="hint">${v.ts.reinforcements > 0 ? (u.sel == null ? 'Click your territories to place armies.' : '') : mt ? `You hold ${HAND_LIMIT}+ cards. Trade 3 before you march.` : 'Ready. Go to war.'}</span>
        ${sel}
        <div class="seg" title="How many each click / + adds">${[1, 3, 5, 'all'].map((n) => `<button data-a="amt" data-n="${n}" class="${u.placeAmt === n ? 'on' : ''}">${n === 'all' ? 'All' : '+' + n}</button>`).join('')}</div>
        <button class="btn" data-a="undo" ${placedTotal ? '' : 'disabled'} title="Take back every army you placed this Draft">↶ Undo${placedTotal ? ` (${placedTotal})` : ''}</button>
        ${u.trade.size === 3 ? `<button class="btn gold" data-a="trade">Trade 3 → 10 armies</button>` : u.trade.size ? `<span class="hint">${u.trade.size}/3 selected</span>` : ''}
        ${this.primusButton()}
        <button class="btn primary" data-a="endDraft" ${v.ts.reinforcements > 0 || mt ? 'disabled' : ''}>End Draft ▸</button>`;
      return;
    }
    if (v.phase === 'attack') {
      if (u.sel == null) {
        const n = this.attackSources().length;
        bar.innerHTML = `<span class="hint">${n ? `Pick one of your ${n} glowing territories to attack from. No limit on attacks.` : 'Nothing can attack right now.'}</span>${v.ts.buffs.longStrike > 0 ? `<span class="hint">(${v.ts.buffs.longStrike} long strike ready)</span>` : ''}
          <button class="btn" data-a="endAttack">Fortify ▸</button><button class="btn" data-a="endTurn">End Turn</button>`;
        return;
      }
      if (u.target == null) {
        const tg = attackTargets(v, this.me!, u.sel).sort((a, b) => v.armies[a] - v.armies[b]);
        const chips = tg.map((t) => {
          const o = v.owner[t];
          const ally = allied(v, this.me!, o);
          const col = o >= 0 ? HOUSES[v.players[o].house].color : '#a39a88';
          const sh = standardAt(v, t);
          const guard = sh >= 0 ? v.standards[sh].guard : 0;
          const tm = terrainMods(v, u.sel!, t);
          const icon = tm.def ? ' 🌲' : '';
          const note = defenseNote(v, u.sel!, t);
          const p = winChance(attackFight(v, this.me!, u.sel!, t));
          const tip = ally ? 'Your ally! Attacking ends the alliance. ' : note === 'Overwhelm' ? 'Twice their number: they yield without a fight. ' : note === '1 die' ? 'A lone neutral garrison rolls 1 defense die. ' : tm.def ? 'Forest: +1 to their lowest defense die. ' : '';
          return `<button class="chip ${ally ? 'ally' : ''}" data-a="tgt" data-t="${t}" style="--c:${col}" title="${tip}${note === 'Overwhelm' ? 'Certain' : `${pct(p)} chance to take it if you blitz`}">${ally ? '⚠ ' : ''}${esc(T[t].name)}${icon} <b>${v.armies[t]}${guard ? `<span class="guard">+${guard}</span>` : ''}</b>${sh >= 0 ? ' ⚑' : ''} ${note === 'Overwhelm' ? '<span class="odds good">🏳 Overwhelm</span>' : `<span class="odds ${oddsClass(p)}">${pct(p)}</span>${note === '1 die' ? ' <span class="dnote">1🎲</span>' : ''}`}</button>`;
        }).join('');
        const olyP = this.canAssaultFrom(u.sel) ? winChance(assaultFight(v, u.sel)) : 0;
        const oly = this.canAssaultFrom(u.sel) ? `<button class="chip oly" data-a="tgt" data-t="${OLYMPUS}">🏛 Olympus <b>${v.siege!.garrison}</b> <span class="odds ${oddsClass(olyP)}">${pct(olyP)}</span></button>` : '';
        bar.innerHTML = `<span class="hint">From <b>${esc(T[u.sel].name)}</b> (${v.armies[u.sel]}), ${tg.length + (oly ? 1 : 0)} target${tg.length + (oly ? 1 : 0) === 1 ? '' : 's'}:</span>
          <div class="chips">${chips}${oly}${!chips && !oly ? '<span class="hint">nothing in reach</span>' : ''}</div>
          <button class="btn sm" data-a="cancel">✕</button><button class="btn" data-a="endAttack">Fortify ▸</button>`;
        return;
      }
      const from = u.sel, to = u.target;
      const maxDice = Math.max(1, Math.min(3, v.armies[from] - 1));
      const dice = Math.min(u.dice, maxDice);
      const diceSeg = `<div class="seg">${[1, 2, 3].map((n) => `<button data-a="dice" data-n="${n}" class="${dice === n ? 'on' : ''}" ${n > maxDice ? 'disabled' : ''}>${n}🎲</button>`).join('')}</div>`;
      if (to === OLYMPUS) {
        const sg = v.siege!;
        const op = winChance(assaultFight(v, from));
        bar.innerHTML = `<span class="hint"><b>${esc(T[from].name)}</b> (${v.armies[from]}) ⚔ <b>OLYMPUS</b> (${sg.garrison}${v.ts.buffs.siegeWalls ? ', walls bypassed' : ', walls +1'})</span>
          <span class="odds big ${oddsClass(op)}" title="Chance a blitz breaks Olympus right now">Blitz breaks it: ${pct(op)}</span>
          ${diceSeg}<button class="btn gold" data-a="roll">Assault</button><button class="btn gold" data-a="blitz">Blitz</button><button class="btn sm" data-a="cancel">✕</button>`;
        return;
      }
      const myStd = v.standards[v.players[this.me!].house];
      const canStd = !myStd.captured && myStd.at === from && v.armies[from] >= 2;
      const commit = Math.max(1, Math.min(u.commit, v.armies[from] - 1));
      const defStd = standardAt(v, to);
      const ally = allied(v, this.me!, v.owner[to]);
      const tm = terrainMods(v, from, to);
      const note = defenseNote(v, from, to);
      const terr = [tm.atk ? `⛰ your high ground +${tm.atk} (lowest compared die)` : '', tm.def ? `🌲 their forest cover +${tm.def} (lowest die)` : '',
        note === '1 die' ? '🎲 a lone neutral garrison: 1 defense die' : '', note === 'neutral Keep' ? '♜ neutral Keep: no walls, no modifiers, never yields' : ''].filter(Boolean).join(' · ');
      const bp = winChance(attackFight(v, this.me!, from, to));
      const sp = canStd ? winChance(standardFight(v, this.me!, from, to, commit)) : 0;
      bar.innerHTML = `
        <span class="hint"><b>${esc(T[from].name)}</b> (${v.armies[from]}) ⚔ <b>${esc(T[to].name)}</b> (${v.armies[to]}${defStd >= 0 && v.standards[defStd].guard ? ` +${v.standards[defStd].guard} honor guard` : ''})</span>
        ${note === 'Overwhelm' ? `<span class="odds big good" title="${v.armies[from] - 1} against ${v.armies[to]}: twice their number or more">🏳 Overwhelm: they yield, no dice</span>`
          : `<span class="odds big ${oddsClass(bp)}" title="Chance to take it if you blitz with everything but one">Blitz wins: ${pct(bp)}</span>`}
        ${terr ? `<span class="terr-chip">${terr}</span>` : ''}
        ${ally ? '<span class="warn">⚠ Your ally. This shatters the alliance.</span>' : ''}
        ${diceSeg}
        <button class="btn primary" data-a="roll" ${v.armies[from] < 2 ? 'disabled' : ''}>Roll</button>
        <button class="btn primary" data-a="blitz" ${v.armies[from] < 2 ? 'disabled' : ''}>Blitz</button>
        ${canStd && !v.ts.stdRaised ? `<label>Commit <input type="range" data-a="commit" min="1" max="${v.armies[from] - 1}" value="${commit}"> <b id="commitN">${commit}</b>+3 <span class="odds ${oddsClass(sp)}" id="stdOdds" title="Chance the charge wins, before your General's war cry">≥${pct(sp)}</span></label>
          <button class="btn gold" data-a="std">⚑ Raise the Standard</button>` : ''}
        ${canStd && v.ts.stdRaised ? '<button class="btn gold" disabled title="The Standard can be raised once per turn">⚑ Raised this turn</button>' : ''}
        <button class="btn sm" data-a="retarget" title="Pick another target">↺</button>
        <button class="btn sm" data-a="cancel">✕</button>`;
      return;
    }
    if (v.phase === 'fortify') {
      const st = v.standards[v.players[this.me!].house];
      const stdBtn = !st.captured && !v.ts.stdMoved ? `<button class="btn ${u.stdMode ? 'gold' : ''}" data-a="stdMode">⚑ ${u.stdMode ? 'Pick where to plant it' : 'Move Standard'}</button>` : '';
      const limit = v.ts.buffs.fortifyAll ? '∞' : `${Math.max(0, 1 + passive(v, this.me!, 'fortify') - v.ts.fortifies)}`;
      if (u.sel != null && u.target != null) {
        const max = v.armies[u.sel] - 1;
        const n = Math.max(1, Math.min(u.moveN, max));
        const r = fortifyRoute(v, this.me!, u.sel, u.target);
        bar.innerHTML = `<span class="hint">March from <b>${esc(T[u.sel].name)}</b> to <b>${esc(T[u.target].name)}</b>${r ? ` · ${r.path.length - 1} step${r.path.length === 2 ? '' : 's'}` : ''}</span>
          <label><input type="range" data-a="moveN" min="1" max="${max}" value="${n}"> <b id="moveNv">${n}</b></label>
          <button class="btn primary" data-a="fortify">March</button><button class="btn sm" data-a="cancel">✕</button>`;
        return;
      }
      bar.innerHTML = `<span class="hint">${u.sel == null ? `Pick troops to move (${limit} move${limit === '1' ? '' : 's'} left).` : 'Pick a destination.'}</span>${stdBtn}<button class="btn primary" data-a="endTurn">End Turn ▸</button>`;
    }
  }

  /** A Keep of yours without a Primus, and a Character in hand that could be sworn in there. */
  private primusButton() {
    const opts = this.me != null ? primusOptions(this.v, this.me) : [];
    if (!opts.length) return '';
    return `<button class="btn gold" data-a="primusOpen" data-keep="${opts[0].keep}" title="Swear a Character in as Primus of ${esc(this.g.territories[opts[0].keep].name)}">♛ Primus${opts.length > 1 ? ` (${opts.length})` : ''}</button>`;
  }

  private cardHTML(id: string, o: { sel?: boolean; locked?: boolean; btns?: string; big?: boolean; forHouse?: number; ownsCheck?: boolean; an?: number; mag?: boolean; cls?: string } = {}) {
    const c = CARD[id];
    const v = this.session?.view ?? null;
    const me = this.session?.seat ?? null;
    const myHouse = o.forHouse ?? (v && me != null ? v.players[me].house : -1);
    const owns = o.ownsCheck !== false && v && me != null && v.phase !== 'passage' ? ownsHouse(v, me, c.house) : c.house === myHouse;
    const pn = c.passive ? c.passive.n + (c.house === myHouse ? 1 : 0) : 0;
    const an = o.an ?? c.active.n + (c.kind !== 'proctor' && owns ? c.active.bonus : 0);
    const bonusNote = c.active.bonus ? ` <span style="color:var(--gold-dim)">(House ${HOUSES[c.house].name} owners: +${c.active.bonus})</span>` : '';
    const top = c.passive
      ? `<div class="blk ${c.house === myHouse ? 'bonus' : ''}"><span class="k">PASSIVE · AS GENERAL${c.house === myHouse ? ' · ★ +1 HOUSE MATCH' : ''}</span>${esc(fmt(c.passive.text, pn))}</div>`
      : c.kind === 'relic'
        ? `<div class="blk"><span class="k">SIEGE RELIC</span>Only playable during a Siege on Olympus. Tradeable any time.</div>`
        : `<div class="blk"><span class="k">REQUIRES</span>You must own House ${HOUSES[c.house].name}. Otherwise, discard it for 2 cards.</div>`;
    const oly = c.kind === 'proctor' && OLYMPUS_POWER[id] ? `<div class="blk oly"><span class="k">DEFENDING OLYMPUS</span>${esc(OLYMPUS_POWER[id].text)}</div>` : '';
    return `<div class="gcard ${o.sel ? 'sel' : ''} ${o.locked ? 'locked' : ''} ${o.big ? 'big' : ''} ${o.cls ?? ''}" data-card="${id}" style="--hc:${HOUSES[c.house].color}">
      ${o.mag ? `<button class="mag" data-a="inspect" data-id="${id}" title="Enlarge, and show what it would hit">🔍</button>` : ''}
      ${c.kind === 'proctor' ? '<span class="badge">PROCTOR</span>' : c.kind === 'relic' ? '<span class="badge">RELIC</span>' : c.active.kind === 'counter' ? '<span class="badge">REACTION</span>' : ''}
      <div class="hdr">${sig(c.house)}<div><div class="nm">${esc(c.name)}</div><div class="tt">${esc(c.title)} · <span style="color:${HOUSES[c.house].color}">${HOUSES[c.house].name}</span></div></div></div>
      ${top}
      <div class="blk act ${owns && c.active.bonus ? 'bonus' : ''}"><span class="k">ACTIVE${owns && c.active.bonus ? ' · HOUSE BONUS' : ''}</span>${esc(fmt(c.active.text, an))}${!owns ? bonusNote : ''}</div>
      ${oly}
      <div class="q">“${esc(c.quote)}”${c.oc ? ' <span title="Original fan character">✦</span>' : ''}</div>
      ${o.btns ?? ''}
    </div>`;
  }

  /** Can this card be played this very moment (it glows)? A Draft Active, or a REACTION card when a Standard charges you. */
  private playableNow(id: string, locked: boolean) {
    const v = this.v, c = CARD[id];
    if (locked || this.me == null || this.playing) return false;
    if (v.reaction) return v.reaction.defender === this.me && c.active.kind === 'counter';
    if (!this.myTurn() || v.phase !== 'draft' || this.ui.pending || this.ui.confirm) return false;
    return c.active.kind !== 'counter' && (c.kind !== 'proctor' || ownsHouse(v, this.me, c.house)) && (!isSiegeCard(c) || this.sieging());
  }

  /** The Play / Discard / Trade buttons for a card in your hand, when you can use them. */
  private cardButtons(id: string, locked: boolean) {
    const v = this.v, u = this.ui, c = CARD[id];
    const draft = this.myTurn() && v.phase === 'draft' && !u.pending && !u.confirm;
    if (draft && !locked) {
      const usable = c.active.kind !== 'counter' && (c.kind !== 'proctor' || ownsHouse(v, this.me!, c.house)) && (!isSiegeCard(c) || this.sieging());
      const dud = c.kind === 'proctor' && !ownsHouse(v, this.me!, c.house);
      return `<div class="btns">${usable ? `<button class="btn primary" data-a="play" data-id="${id}">Play</button>` : ''}${dud ? `<button class="btn" data-a="dud" data-id="${id}">Discard +2</button>` : ''}<button class="btn ${u.trade.has(id) ? 'gold' : ''}" data-a="tsel" data-id="${id}">${u.trade.has(id) ? '✓ Trade' : 'Trade'}</button></div>`;
    }
    return locked ? '<div class="btns"><span class="fine" style="margin:0">Locked until your next turn</span></div>' : '';
  }

  private renderHand() {
    const v = this.v, u = this.ui;
    const hand = v.me?.hand ?? [];
    const box = document.getElementById('hand')!;
    if (v.phase === 'passage' || !hand.length) { box.innerHTML = ''; this.renderInspector(); return; }
    box.innerHTML = hand.map((h) => this.cardHTML(h.id, { sel: u.trade.has(h.id), locked: h.locked, btns: this.cardButtons(h.id, h.locked), mag: true, cls: `${u.inspect === h.id ? 'inspecting' : ''} ${this.playableNow(h.id, h.locked) ? 'playable' : ''}` })).join('');
    if (!box.dataset.hover) {
      box.dataset.hover = '1';
      // Hovering a card lights up what it would hit.
      box.addEventListener('mouseover', (e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('.gcard')?.dataset.card ?? null;
        if (id !== this.ui.hoverCard) { this.ui.hoverCard = id; this.renderHighlights(); }
      });
      box.addEventListener('mouseleave', () => { if (this.ui.hoverCard) { this.ui.hoverCard = null; this.renderHighlights(); } });
    }
    this.renderInspector();
  }

  /** Which territories a card would touch if you played it now, and what it would do. */
  private cardImpact(id: string): Impact {
    const v = this.v, me = this.me, c = CARD[id];
    const out: Impact = { targets: [], tone: 'target', lines: [] };
    if (me == null || !v.players[me] || v.phase === 'passage') return out;
    const g = this.g, T = g.territories;
    const n = activeValue(v, me, c);
    const mine = territoriesOf(v, me);
    const adjFoe = [...new Set(mine.flatMap((t) => g.adj[t]))].filter((t) => v.owner[t] !== me);
    const nm = (t: number) => `<b>${esc(T[t].name)}</b>`;
    switch (c.active.kind) {
      case 'sabotage': {
        out.targets = adjFoe.filter((t) => v.armies[t] >= 2).sort((a, b) => v.armies[b] - v.armies[a]);
        out.lines.push(`Pick one of ${out.targets.length} enemy territories beside yours: up to <b>${n}</b> of its soldiers die (1 always survives).`);
        out.lines.push(...out.targets.slice(0, 4).map((t) => `${nm(t)}: ${v.armies[t]} → ${v.armies[t] - Math.min(n, v.armies[t] - 1)}`));
        break;
      }
      case 'raid': {
        out.targets = adjFoe.filter((t) => v.armies[t] >= 2).sort((a, b) => v.armies[b] - v.armies[a]).slice(0, n);
        out.lines.push(out.targets.length ? `Hits your ${out.targets.length} biggest neighbours, 1 soldier each:` : 'No enemy beside you has 2+ soldiers. It would hit nothing.');
        out.lines.push(...out.targets.map((t) => `${nm(t)}: ${v.armies[t]} → ${v.armies[t] - 1}`));
        break;
      }
      case 'parley':
        out.targets = adjFoe.filter((t) => v.owner[t] === NEUTRAL && v.armies[t] <= n);
        out.lines.push(out.targets.length ? `Pick a neutral garrison of ${n} or fewer beside you. It joins you without a fight:` : `No neutral garrison of ${n} or fewer touches your land.`);
        out.lines.push(...out.targets.slice(0, 5).map((t) => `${nm(t)} (${v.armies[t]})`));
        break;
      case 'moveStd':
        out.targets = mine; out.tone = 'place';
        out.lines.push(`Pick any territory you hold: your Standard moves there with +${n} armies.`);
        break;
      case 'longStrike': {
        const near = new Set(adjFoe);
        out.targets = [...new Set(mine.flatMap((t) => g.dist[t].flatMap((d, x) => (d === 2 && v.owner[x] !== me && !near.has(x) ? [x] : []))))];
        out.lines.push(`${n} attack${n === 1 ? '' : 's'} this turn can reach two territories away. Newly in reach: ${out.targets.length}.`);
        break;
      }
      case 'atkBuff': case 'breakLine': case 'fury':
        out.targets = adjFoe.filter((t) => !allied(v, me, v.owner[t]));
        out.lines.push(`Helps against any of the ${out.targets.length} territories you can attack this turn.`);
        break;
      case 'harvest': {
        const low = mine.filter((t) => T[t].quadrant === 3);
        out.targets = low; out.tone = 'place';
        out.lines.push(`+${low.length + n} armies to place (${low.length} Lowlands territories + ${n}).`);
        break;
      }
      case 'steal': out.lines.push(`Steal ${n} random card${n === 1 ? '' : 's'} from a rival you pick.`); break;
      case 'counter': out.lines.push('REACTION: only when a Standard charges one of your territories. You can still trade it.'); break;
      default: out.lines.push(esc(fmt(c.active.text, n)));
    }
    if (c.kind === 'proctor' && !ownsHouse(v, me, c.house)) out.lines.unshift(`<span class="warn">You don't own House ${HOUSES[c.house].name}: discard it for 2 cards instead.</span>`);
    if (isSiegeCard(c) && !this.sieging()) out.lines.unshift('<span class="warn">Only playable during a Siege on Olympus.</span>');
    return out;
  }

  /**
   * Try a card play on a copy of the game, so the confirm box can show exactly what the War Log will say.
   * Random effects (stolen or drawn cards) use stand-in cards; only the counts matter for the preview.
   */
  private simulate(a: Action): { err: string | null; text: string; changed: number[]; state: GameState | null } {
    const v = this.session!.view!, me = this.me!;
    const s: GameState = JSON.parse(JSON.stringify(v));
    const dummy = () => ({ id: 'p-mars', locked: false });
    s.priv = {
      deck: Array.from({ length: v.deckCount }, () => 'p-mars'), discard: [],
      hands: v.players.map((p) => (p.seat === me ? JSON.parse(JSON.stringify(v.me?.hand ?? [])) : Array.from({ length: v.handCounts[p.seat] ?? 0 }, dummy))),
      passage: v.players.map(() => null),
    };
    const r = act(s, me, a, { rng: () => 0.5, now: Date.now() });
    drainLog(); // a make-believe play never reaches any War Log
    if (!r.ok) return { err: r.err, text: '', changed: [], state: null };
    const e = s.log.filter((x) => x.id > (v.log.at(-1)?.id ?? 0)).find((x) => x.k === 'play');
    const changed = s.owner.flatMap((o, t) => (o !== v.owner[t] || s.armies[t] !== v.armies[t] ? [t] : []));
    // The preview shows only what this seat may know: its own hand, and counts for everyone else.
    s.priv = null;
    s.me = { seat: me, hand: [], passage: null };
    return { err: null, text: e ? describe(s, e) : '', changed, state: s };
  }

  /**
   * Preview a card play: the map shows the outcome (the changed territories and their new armies) until you go
   * Back or Commit. Anything random (stolen or drawn cards) is shown as a range.
   */
  private confirmPlay(action: Extract<Action, { type: 'play' }>) {
    const sim = this.simulate(action);
    if (sim.err) { this.toast(sim.err); return; }
    const v = this.v, me = this.me!, T = this.g.territories;
    const imp = this.cardImpact(action.card);
    const targets = sim.changed.length ? sim.changed : action.t != null ? [action.t] : imp.targets;
    this.ui.confirm = { action, targets, preview: sim.state };
    this.ui.inspect = null;
    if (sim.state) this.world.update(sim.state);
    this.render();
    const c = CARD[action.card];
    const n = activeValue(v, me, c);
    const after = sim.state!;
    const lines: string[] = [];
    for (const t of sim.changed.slice(0, 8)) {
      const o0 = v.owner[t], o1 = after.owner[t];
      lines.push(`<b>${esc(T[t].name)}</b>: ${v.armies[t]} → <b>${after.armies[t]}</b>${o0 !== o1 ? ` · now ${o1 === me ? '<b style="color:var(--gold)">yours</b>' : esc(after.players[o1]?.name ?? 'neutral')}` : ''}`);
    }
    if (sim.changed.length > 8) lines.push(`…and ${sim.changed.length - 8} more`);
    if (after.ts.reinforcements !== v.ts.reinforcements) lines.push(`Armies to place: ${v.ts.reinforcements} → <b>${after.ts.reinforcements}</b>`);
    const b0 = v.ts.buffs, b1 = after.ts.buffs;
    if (b1.atk > b0.atk) lines.push(`+1 to your highest attack die in your next <b>${b1.atk}</b> battle${b1.atk === 1 ? '' : 's'}`);
    if (b1.breakLine > b0.breakLine) lines.push(`The defender rolls 1 die in your next <b>${b1.breakLine}</b> battle${b1.breakLine === 1 ? '' : 's'}`);
    if (b1.longStrike > b0.longStrike) lines.push(`<b>${b1.longStrike}</b> attack${b1.longStrike === 1 ? '' : 's'} may strike two territories away`);
    if (b1.fury && !b0.fury) lines.push('All your attack dice +1 for the rest of the turn');
    if (b1.fortifyAll && !b0.fortifyAll) lines.push('Unlimited fortify moves this turn');
    if (c.active.kind === 'steal' && action.seat != null) lines.push(`Steals <b>${Math.min(n, v.handCounts[action.seat] ?? 0) ? `0–${Math.min(n, v.handCounts[action.seat] ?? 0)}` : '0'}</b> random card${n === 1 ? '' : 's'} from ${esc(v.players[action.seat].name)} (you'll see which after)`);
    if (c.active.kind === 'draw') lines.push(`Draws <b>${v.deckCount >= n ? n : `0–${n}`}</b> card${n === 1 ? '' : 's'}, locked until your next turn`);
    const box = el(`<div class="confirm preview" style="--hc:${HOUSES[c.house].color}">
      <div class="ch">${sig(c.house)} <div><div class="logo-sub" style="margin:0;letter-spacing:.3em">PREVIEW · NOTHING IS PLAYED YET</div><b>${esc(c.name)}</b>${action.t != null ? ` → ${esc(this.tname(action.t))}` : ''}${action.seat != null ? ` → ${esc(v.players[action.seat].name)}` : ''}</div></div>
      ${lines.length ? `<div class="k">WHAT CHANGES</div><div class="outcome">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
      <div class="k">WAR LOG PREVIEW</div>
      <div class="preview">${sim.text || esc(fmt(c.active.text, n))}</div>
      ${targets.length ? `<div class="fine" style="margin:4px 0 0">${targets.length} territor${targets.length === 1 ? 'y' : 'ies'} glowing on the map${sim.changed.length ? ', showing their armies after the play' : ''}.</div>` : ''}
      <div class="row"><button class="btn" data-a="cancel-play">◂ Back</button><button class="btn primary" data-a="confirm-play">Commit ▸</button></div>
    </div>`);
    document.querySelector('.confirm')?.remove();
    document.getElementById('hud')!.appendChild(box);
    box.addEventListener('click', async (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      box.remove();
      const pending = this.ui.confirm;
      this.endPreview();
      if (a === 'confirm-play' && pending) await this.send(pending.action);
      this.render();
    });
    const t = targets[0];
    if (t != null && t >= 0) this.world.focus(t);
    this.world.flash(targets, '#ff9b1f', 1800);
  }

  /** Leave a card preview: the map goes back to the real valley. */
  private endPreview() {
    if (!this.ui.confirm) return;
    this.ui.confirm = null;
    document.querySelector('.confirm')?.remove();
    if (this.session?.view) this.world.update(this.v);
  }

  /** The 🔍 panel: the card, big, beside the map, with everything it would touch listed and lit up. */
  private renderInspector() {
    const id = this.ui.inspect;
    let box = document.getElementById('inspector');
    const hand = this.v.me?.hand ?? [];
    const h = hand.find((x) => x.id === id);
    document.getElementById('leftcol')?.classList.toggle('under-inspector', !!h);
    if (!h) { box?.remove(); if (id) this.ui.inspect = null; return; }
    if (!box) { box = el('<div id="inspector" class="inspector"></div>'); document.getElementById('hud')!.appendChild(box); }
    const imp = this.cardImpact(h.id);
    box.innerHTML = `<div class="ih"><span class="logo-sub" style="margin:0;letter-spacing:.3em">CARD</span><button class="btn sm" data-a="inspect-close" title="Close">✕</button></div>
      ${this.cardHTML(h.id, { big: true, locked: h.locked, btns: this.cardButtons(h.id, h.locked), cls: `huge ${this.playableNow(h.id, h.locked) ? 'playable' : ''}` })}
      <div class="impact"><div class="k">IF YOU PLAY IT NOW${imp.targets.length ? ` · <span style="color:#ff9b1f">${imp.targets.length} glowing</span>` : ''}</div>${imp.lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
  }

  // =========================================================================
  // modals

  private modal(html: string | null, key = '', force = false) {
    const root = document.getElementById('modal-root');
    if (!root) return null;
    if (!html) { root.innerHTML = ''; root.dataset.key = ''; return null; }
    if (key && root.dataset.key === key && !force) return root.firstElementChild as HTMLElement;
    const scroll = root.querySelector('.box')?.scrollTop ?? 0;
    root.innerHTML = html;
    root.dataset.key = key;
    const m = root.firstElementChild as HTMLElement;
    if (force) { const b = m.querySelector('.box'); if (b) b.scrollTop = scroll; }
    m.addEventListener('click', (e) => this.onModalClick(e));
    m.addEventListener('input', (e) => this.onModalInput(e));
    return m;
  }

  private renderModals() {
    const s = this.session!, v = this.v, root = document.getElementById('modal-root');
    if (!root) return;
    if (root.dataset.key?.startsWith('info')) return; // rules/codex/menu/diplomacy stay until closed
    if (this.playing || this.wheelOpen) { if (root.dataset.key && root.dataset.key !== 'closed-over') this.modal(null); return; }
    if (s.handoff != null) {
      const p = v.players[s.handoff];
      this.modal(`<div class="handoff"><div><div class="logo-sub">HAND THE DEVICE TO</div>
        <div class="who" style="color:${HOUSES[p.house].color}">${esc(p.name)}</div>
        <p class="tagline">House ${HOUSES[p.house].name}. Everyone else: eyes off the screen, you nosy slags.</p>
        <button class="btn primary big" data-a="ack">I am ${esc(p.name)}</button></div></div>`, `handoff-${s.handoff}`);
      return;
    }
    if (v.phase === 'passage' && v.me?.passage) {
      const [a, b] = v.me.passage;
      const myHouse = v.players[this.me!].house;
      this.modal(`<div class="modal"><div class="box" style="text-align:center">
        <div class="logo-sub">THE PASSAGE</div>
        <h2>${esc(v.players[this.me!].name)} of ${sig(myHouse)} House ${HOUSES[myHouse].name}</h2>
        <p class="prose">${PASSAGE_INTRO[(this.me! + v.turn) % PASSAGE_INTRO.length]}</p>
        <p class="fine">Keep one as your <b>General</b> (Passive always on). The other dies here. ★ A card whose suit is House ${HOUSES[myHouse].name} gets +1.</p>
        <div class="cards-row">${[a, b].map((id) => this.cardHTML(id, { big: true, forHouse: myHouse, ownsCheck: false, btns: `<div class="btns"><button class="btn primary" data-a="choose" data-id="${id}">Walk out with ${esc(CARD[id].name.replace(/^The /, '').split(' ')[0])}</button></div>` })).join('')}</div>
      </div></div>`, `passage-${this.me}`);
      return;
    }
    if (v.phase === 'passage') {
      this.modal(`<div class="modal"><div class="box" style="text-align:center"><h2>Blood on the floor</h2><p class="prose">You walked out. Now wait while the others finish killing their friends.</p></div></div>`, 'passage-wait');
      return;
    }
    if (v.reaction && v.reaction.defender === this.me) {
      const r = v.reaction;
      const counters = (v.me?.hand ?? []).filter((h) => !h.locked && CARD[h.id].active.kind === 'counter');
      const m = this.modal(`<div class="modal"><div class="box" style="text-align:center">
        <div class="logo-sub" style="color:var(--blood-hi)">⚑ THE STANDARD CHARGES ⚑</div>
        <h2>${esc(v.players[v.cur].name)} is coming for ${esc(this.tname(r.to))} with ${r.commit} + 3</h2>
        <p class="prose">Spring an ambush? Win this and their whole House is yours.</p>
        ${s.mode === 'online' ? '<div class="timer"><div id="rtimer"></div></div>' : ''}
        <div class="cards-row">${counters.map((h) => this.cardHTML(h.id, { btns: `<div class="btns"><button class="btn primary" data-a="react" data-id="${h.id}">Spring it</button></div>` })).join('')}</div>
        <button class="btn" data-a="react" data-id="">Let them come</button>
      </div></div>`, `react-${r.from}-${r.to}-${v.version}`);
      if (m && s.mode === 'online') {
        const bar = m.querySelector<HTMLElement>('#rtimer');
        const tick = () => { if (!bar?.isConnected) return; const left = Math.max(0, r.deadline - Date.now()); bar.style.width = `${(left / 25000) * 100}%`; if (left > 0) setTimeout(tick, 250); };
        tick();
      }
      return;
    }
    if (this.myTurn() && v.ts.mustMove) {
      const mm = v.ts.mustMove;
      const n = Math.max(mm.min, Math.min(this.ui.moveN > 1 ? this.ui.moveN : mm.max, mm.max));
      this.modal(`<div class="modal"><div class="box" style="text-align:center;max-width:460px">
        <h2>${esc(this.tname(mm.to))} is yours</h2>
        <p class="prose">How many march in? The rest hold ${esc(this.tname(mm.from))}.</p>
        <input type="range" data-a="mm" min="${mm.min}" max="${mm.max}" value="${n}" style="width:100%;accent-color:var(--blood-hi)">
        <div class="code-big" id="mmv" style="font-size:36px">${n}</div>
        <div class="row" style="display:flex;gap:8px;justify-content:center"><button class="btn" data-a="mmset" data-n="${mm.min}">Min</button><button class="btn" data-a="mmset" data-n="${mm.max}">All</button><button class="btn primary" data-a="move">March in</button></div>
      </div></div>`, `mm-${mm.from}-${mm.to}-${v.version}`);
      return;
    }
    if (this.myTurn() && !v.ts.mustMove) {
      const opts = primusOptions(v, this.me!);
      const ask = opts.find((o) => o.keep === this.ui.primusOpen) ?? opts.find((o) => v.ts.keepsTaken?.includes(o.keep) && !this.primusSkipped.has(`${v.turn}:${o.keep}`));
      if (ask) {
        const T = this.g.territories, h = T[ask.keep].house;
        this.modal(`<div class="modal"><div class="box" style="text-align:center">
          <div class="logo-sub">♛ A KEEP WITHOUT A MASTER</div>
          <h2>${sig(h)} ${esc(T[ask.keep].name)} is yours</h2>
          <p class="prose">Swear in one House ${HOUSES[h].name} Character from your hand as its <b>Primus</b>. Its Passive works for you on top of your General's (no House-match bonus, not shared with allies).
          The card leaves your hand, and if the Keep falls, the Primus dies with it.</p>
          <div class="cards-row">${ask.cards.map((id) => this.cardHTML(id, { forHouse: -1, ownsCheck: false, btns: `<div class="btns"><button class="btn primary" data-a="primus" data-keep="${ask.keep}" data-id="${id}">♛ Swear in ${esc(CARD[id].name.replace(/^The /, '').split(' ')[0])}</button></div>` })).join('')}</div>
          <button class="btn" data-a="primusSkip" data-keep="${ask.keep}">Not now${v.phase === 'draft' ? '' : ' (you can in a later Draft)'}</button>
        </div></div>`, `primus-${ask.keep}-${ask.cards.join(',')}`);
        return;
      }
    }
    if (v.phase === 'over') {
      const w = v.winner != null ? v.players[v.winner] : null;
      const team = v.winners.length > 1;
      const iWon = this.me != null && v.winners.includes(this.me);
      this.modal(`<div class="modal"><div class="box" style="text-align:center">
        <div class="logo-sub">${team ? 'OLYMPUS HAS FALLEN' : 'THE INSTITUTE IS DECIDED'}</div>
        ${team
          ? `<h1 class="logo" style="font-size:44px">${v.winners.map((x) => esc(v.players[x].name)).join(' · ')}</h1><p class="prose">Houses ${v.winners.map((x) => `${sig(v.players[x].house)} ${HOUSES[v.players[x].house].name}`).join(', ')} took Olympus together. ${w ? `${esc(w.name)} struck the last blow.` : ''} ${iWon ? 'Hail, conquerors.' : 'You watched from the mud.'}</p>`
          : w ? `<h1 class="logo" style="font-size:54px">${esc(w.name)}</h1><p class="prose">ArchPrimus of the Institute, of ${sig(w.house)} House ${HOUSES[w.house].name}. ${iWon ? 'Hail Reaper. You earned it.' : 'You lost. Go cry to your mother, Pixie.'}</p>` : '<h2>Nobody wins</h2>'}
        <div style="display:flex;gap:8px;justify-content:center"><button class="btn" data-a="close">Look at the carnage</button><button class="btn primary" data-a="title">Back to title</button></div>
      </div></div>`, 'over');
      return;
    }
    const root2 = document.getElementById('modal-root')!;
    if (root2.dataset.key && root2.dataset.key !== 'closed-over') this.modal(null);
  }

  modalRules() {
    const html = `<div class="modal"><div class="box"><div class="prose">${RULES_HTML}</div><div style="text-align:right;margin-top:10px"><button class="btn primary" data-a="close">Got it</button></div></div></div>`;
    if (document.getElementById('modal-root')) this.modal(html, 'info-rules');
    else this.standaloneModal(html);
  }

  modalCodex() {
    const groups = HOUSES.map((h, i) => `<h3 style="font-family:var(--display);color:${h.color};margin:18px 0 6px">${sig(i)} House ${h.name} <span class="fine">· ${esc(h.epithet)}</span></h3>
      <div class="cards-row" style="justify-content:flex-start;margin:0">${CARDS.filter((c) => c.house === i).map((c) => this.cardHTML(c.id, { forHouse: -1, ownsCheck: false })).join('')}</div>`).join('');
    const html = `<div class="modal"><div class="box" style="width:min(1100px,100%)"><h2>The Codex</h2>
      <p class="fine" style="margin:0">Every card in the deck. A card's suit is its House. Passives work on your General (+1 if the suit matches your House), and on a <b>Primus</b>: a Character sworn in at a Keep you conquered whose House matches its suit (no +1, not shared with allies, slain if the Keep falls). Actives are played in the Draft.
      Relics only work in a Siege on Olympus, where each attacking House's Proctor defends Olympus. ✦ marks original fan characters.</p>${groups}
      <div style="text-align:right;margin-top:12px"><button class="btn primary" data-a="close">Close</button></div></div></div>`;
    if (document.getElementById('modal-root')) this.modal(html, 'info-codex');
    else this.standaloneModal(html);
  }

  private standaloneModal(html: string) {
    const m = el(html);
    m.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a'); if (a === 'close' || e.target === m) m.remove(); });
    document.body.appendChild(m);
  }

  private modalMenu() {
    const s = this.session!;
    const online = s instanceof OnlineSession;
    const link = online ? `${location.origin}${location.pathname}?join=${s.code}` : '';
    this.modal(`<div class="modal"><div class="box" style="max-width:420px;text-align:center">
      <h2>Menu</h2>
      ${online ? `<p class="fine">War code <b style="color:var(--gold);letter-spacing:.2em">${s.code}</b>. Reopen the link to rejoin anytime.</p><button class="btn" data-a="copy" data-link="${esc(link)}" style="width:100%;margin-bottom:8px">Copy invite link</button>` : ''}
      <button class="btn" data-a="close" style="width:100%;margin-bottom:8px">Resume</button>
      <button class="btn" data-a="settings" style="width:100%;margin-bottom:8px">⚙ Settings</button>
      ${this.v.phase !== 'over' && this.me != null && this.v.players[this.me].alive ? '<button class="btn" data-a="concede" style="width:100%;margin-bottom:8px">Concede (your House goes neutral)</button>' : ''}
      <button class="btn primary" data-a="title" style="width:100%">Quit to title</button>
    </div></div>`, 'info-menu');
  }

  /** This device's preferences: the camera following the action, music and effects, and the sound of your turn. */
  private modalSettings() {
    const row = (k: string, on: boolean, title: string, note: string) => `<div class="set-row inline pref"><div><div class="set-k">${title}</div><div class="set-note">${note}</div></div>
      <div class="seg"><button data-a="pref" data-k="${k}" data-v="1" class="${on ? 'on' : ''}">On</button><button data-a="pref" data-k="${k}" data-v="0" class="${!on ? 'on' : ''}">Off</button></div></div>`;
    const slider = (k: string, v: number, title: string, note: string) => `<div class="set-row inline pref"><div><div class="set-k">${title}</div><div class="set-note">${note}</div></div>
      <input type="range" data-a="vol" data-k="${k}" min="0" max="100" value="${Math.round(v * 100)}" aria-label="${title} volume"></div>`;
    this.modal(`<div class="modal"><div class="box" style="max-width:520px">
      <h2>⚙ Settings</h2>
      <div class="settings">
        ${row('follow', this.prefs.follow, 'Follow the action', 'The camera glides to every attack, march and card as rivals and the AI move.')}
        ${row('mute', !sound.muted, 'Sound', 'Everything on or off. Press M anytime.')}
        ${slider('music', sound.musicVol, 'Music', 'The soundtrack follows the war: calm, tense, battle.')}
        ${slider('sfx', sound.sfxVol, 'Effects', 'Steel, dice, war cries and the valley.')}
        ${row('sound', this.prefs.sound, 'Turn chime', 'A clash of swords when your turn begins.')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:14px"><button class="btn sm" data-a="pref-test">Hear the chime</button><button class="btn primary" data-a="close">Done</button></div>
    </div></div>`, 'info-settings', true);
  }

  /** Alliances: who you're sworn to, quiet invitations, and the Siege on Olympus. */
  private modalDiplo(refresh = false) {
    const v = this.v, me = this.me;
    if (me == null) return;
    const al = allianceOf(v, me);
    const rivals = v.players.filter((p) => p.seat !== me && p.alive);
    const incoming = v.invites.filter((i) => i.to === me);
    const status = !v.warBegun
      ? '<p class="prose">The Houses are still circling. <b>Diplomacy opens once one House attacks another.</b></p>'
      : '<p class="prose">Send a quiet invitation. <b>Public</b> alliances are announced to the valley; <b>secret</b> ones only to members. Allies share their Generals\' Passives and nothing else. Attack an ally and the alliance dies on the spot.</p>';
    const sworn = al ? 'You are already sworn to an alliance: walk out of it first.' : '';
    const inc = incoming.map((i) => `<div class="drow">📜 ${sig(v.players[i.from].house)} <b>${esc(v.players[i.from].name)}</b> offers a ${i.public ? 'public' : 'secret'} alliance
      <span class="grow"></span><button class="btn sm primary" data-a="answer" data-id="${i.id}" data-yes="1" ${sworn ? `disabled title="${sworn}"` : ''}>Accept</button><button class="btn sm" data-a="answer" data-id="${i.id}" data-yes="0">Burn it</button></div>`).join('');
    const mine = al ? `<div class="dsec"><h3>YOUR ${al.public ? 'PUBLIC ALLIANCE' : 'SECRET PACT'}</h3>
      ${al.members.map((m) => `<div class="drow">${sig(v.players[m].house)} <b>${esc(v.players[m].name)}</b>${m === me ? ' <span class="you">YOU</span>' : ''}<span class="grow"></span>${this.primusHTML(m)}</div>`).join('')}
      <div class="row" style="gap:8px">${!al.public ? '<button class="btn sm" data-a="reveal">Reveal the pact to the valley</button>' : ''}
      ${!v.siege ? '<button class="btn sm ghost" data-a="leave" title="Everyone in it hears; you can\'t join another alliance for a full round">🚪 Walk out</button>' : ''}</div></div>` : '';
    const rally = this.rallyHTML();
    const siegeErr = siegeBlocker(v, me);
    const o = al ? olympusPreview(v, al.members) : null;
    const siege = al ? `<div class="dsec"><h3>🏛 SIEGE ON OLYMPUS</h3>
      ${v.siege ? `<p class="prose">The siege is on: <b>${v.siege.garrison}</b> defenders left, ${v.siege.turnsLeft} allied turns remaining. Assault from the Foot of Olympus (inner ring) during your Attack.</p>`
        : `<p class="fine" style="margin:4px 0">Olympus would hold <b>${o!.garrison}</b> defenders behind walls (+1 to defense dice${o!.defHigh ? `, +${o!.defHigh} highest die` : ''}), regrow +${o!.regen} and smite ${o!.smite} each allied turn, with ${o!.turns} allied turns to break it.
          Its Generals would be your Proctors: ${o!.proctors.map((p) => `<b>${esc(CARD[p].name)}</b> (${esc(OLYMPUS_POWER[p].text)})`).join('; ')}.</p>
          ${v.vote ? `<p class="prose">Voting: ${v.vote.yes.length} to storm it, ${v.vote.no.length} against, of ${al.members.length}.</p>${this.voteOwed() ? '<button class="btn gold" data-a="vote" data-yes="1">Storm it</button> <button class="btn" data-a="vote" data-yes="0">Not yet</button>' : ''}`
            : siegeErr ? `<p class="fine" style="margin:4px 0">${esc(siegeErr)}</p>` : '<button class="btn gold" data-a="proposeSiege">Call for a Siege on Olympus</button>'}`}
    </div>` : '';
    const list = rivals.map((p) => {
      const pending = v.invites.find((i) => i.from === me && i.to === p.seat);
      const err = inviteBlocker(v, me, p.seat);
      const isAlly = allied(v, me, p.seat);
      return `<div class="drow">${sig(p.house)} <b style="color:${HOUSES[p.house].color}">${esc(p.name)}</b>${p.ai ? ' <span class="ai-tag">AI</span>' : ''}<span class="grow"></span>
        ${isAlly ? '<span class="ally-tag">ally</span>' : pending ? `<span class="fine" style="margin:0">${pending.public ? 'public' : 'secret'} offer sent…</span> <button class="btn sm ghost" data-a="cancelInv" data-id="${pending.id}">Take it back</button>`
          : `<button class="btn sm" data-a="invite" data-seat="${p.seat}" data-pub="1" ${err ? `disabled title="${esc(err)}"` : ''}>Invite · Public</button><button class="btn sm" data-a="invite" data-seat="${p.seat}" data-pub="0" ${err ? `disabled title="${esc(err)}"` : ''}>Invite · Secret</button>`}</div>`;
    }).join('');
    this.modal(`<div class="modal"><div class="box" style="max-width:640px">
      <h2>🤝 Diplomacy</h2>${status}
      ${inc ? `<div class="dsec"><h3>INVITATIONS FOR YOU</h3>${inc}</div>` : ''}
      ${mine}${rally}${siege}
      ${v.players[me].alive ? `<div class="dsec"><h3>THE OTHER HOUSES</h3>${list || '<p class="fine">Nobody left to talk to.</p>'}</div>` : ''}
      <div style="text-align:right;margin-top:10px"><button class="btn primary" data-a="close">Close</button></div>
    </div></div>`, 'info-diplo', refresh);
  }

  private async onModalClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    const root = document.getElementById('modal-root')!;
    if (!b) { if (root.dataset.key?.startsWith('info') && (e.target as HTMLElement).classList.contains('modal')) this.modal(null); return; }
    if ((b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a;
    if (a === 'close') { const was = root.dataset.key; this.modal(null); if (was === 'over') root.dataset.key = 'closed-over'; this.render(); return; }
    if (a === 'title') { this.showTitle(); return; }
    if (a === 'settings') { this.modalSettings(); return; }
    if (a === 'pref') {
      const on = b.dataset.v === '1';
      if (b.dataset.k === 'follow') { this.prefs.follow = on; store.set('ic-follow', on ? '1' : '0'); }
      if (b.dataset.k === 'sound') { this.prefs.sound = on; store.set('ic-sound', on ? '1' : '0'); if (on) swordClash(); }
      if (b.dataset.k === 'mute') sound.setMuted(!on);
      this.modalSettings();
      return;
    }
    if (a === 'pref-test') { swordClash(); return; }
    if (a === 'copy') { navigator.clipboard?.writeText(b.dataset.link!).then(() => this.toast('Link copied.')); return; }
    if (a === 'concede') { if (confirm('Throw down your sword? Your House goes to the wilds.')) { this.modal(null); await this.send({ type: 'concede' }); } return; }
    if (a === 'ack') { this.modal(null); this.session?.ackHandoff?.(); return; }
    if (a === 'choose') { if (this.sentPassage) return; this.sentPassage = true; const err = await this.send({ type: 'choose', card: b.dataset.id! }); this.sentPassage = false; if (!err) this.modal(null); return; }
    if (a === 'react') { this.modal(null); await this.send({ type: 'react', card: b.dataset.id || null }); return; }
    if (a === 'mmset') { const inp = root.querySelector<HTMLInputElement>('[data-a=mm]')!; inp.value = b.dataset.n!; root.querySelector('#mmv')!.textContent = inp.value; return; }
    if (a === 'move') {
      const n = +root.querySelector<HTMLInputElement>('[data-a=mm]')!.value;
      const to = this.v.ts.mustMove?.to ?? null;
      this.modal(null); this.ui.moveN = 1;
      const err = await this.send({ type: 'move', n });
      if (!err) this.followUp(to);
      return;
    }
    if (a === 'primus') { this.ui.primusOpen = null; const err = await this.send({ type: 'primus', keep: +b.dataset.keep!, card: b.dataset.id! }); if (!err) this.modal(null); this.render(); return; }
    if (a === 'primusSkip') { this.primusSkipped.add(`${this.v.turn}:${b.dataset.keep}`); this.ui.primusOpen = null; this.modal(null); this.render(); return; }
    if (a === 'flag') return;
    if (['invite', 'answer', 'reveal', 'proposeSiege', 'vote', 'leave', 'cancelInv', 'openRally', 'joinRally', 'cancelRally', 'ignoreRally'].includes(a!)) return this.diplo(b);
  }
  private onModalInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'mm') document.getElementById('mmv')!.textContent = t.value;
    if (t.dataset.a === 'vol') {
      const v = +t.value / 100;
      if (t.dataset.k === 'music') sound.setMusic(v);
      else { sound.setSfx(v); sound.play('clash', { vol: 0.7 }); }
    }
  }

  /** The Rally Against Olympus: who called it, who answered, and what you can do about it. */
  private rallyHTML() {
    const v = this.v, me = this.me;
    if (me == null || !v.opts?.alliances || v.phase === 'passage') return '';
    const r = v.rally;
    if (r) {
      const p = v.players[r.by];
      const members = allianceOf(v, r.by)?.members ?? [r.by];
      const err = joinRallyBlocker(v, me);
      return `<div class="dsec"><h3>📯 RALLY AGAINST OLYMPUS</h3>
        <p class="prose">${sig(p.house)} <b>${esc(p.name)}</b> calls the valley to their banner: <b>${members.length}/${r.slots}</b> (${members.map((m) => sig(v.players[m].house, 'sig sm')).join('')}). First come, first sworn. It closes when full, or when ${esc(p.name)}'s next turn begins.</p>
        ${r.by === me ? '<button class="btn sm" data-a="cancelRally">Call it off</button>'
          : err ? `<p class="fine" style="margin:4px 0">${esc(err)}</p>` : `<button class="btn gold" data-a="joinRally">📯 Answer the Rally</button>${allianceOf(v, me) ? ' <span class="warn">Your current allies will call it betrayal.</span>' : ''}`}
      </div>`;
    }
    const err = rallyBlocker(v, me);
    return `<div class="dsec"><h3>📯 RALLY AGAINST OLYMPUS</h3>
      <p class="fine" style="margin:4px 0">The strongest House (the most armies, no ties) may call a public Rally: the first Houses to answer join its public alliance, up to half the living Houses. Answering walks out on your old allies.</p>
      ${err ? `<p class="fine" style="margin:4px 0">${esc(err)}</p>` : '<button class="btn gold" data-a="openRally">📯 Call a Rally</button>'}
    </div>`;
  }

  private async diplo(b: HTMLElement) {
    const a = b.dataset.a;
    if (a === 'leave') { if (confirm('Walk out of your alliance? Everyone in it will hear, and no one will swear to you for a full round.')) await this.send({ type: 'leaveAlliance' }); }
    if (a === 'cancelInv') await this.send({ type: 'cancelInvite', invite: +b.dataset.id! });
    if (a === 'openRally') { if (confirm('Call a public Rally Against Olympus? The whole valley will know, and your alliance becomes public.')) await this.send({ type: 'openRally' }); }
    if (a === 'joinRally') {
      const old = this.me != null ? allianceOf(this.v, this.me) : null;
      if (!old || confirm('Answer the Rally? You walk out of your current alliance, and your old allies will hear it as betrayal.')) await this.send({ type: 'joinRally' });
    }
    if (a === 'cancelRally') await this.send({ type: 'cancelRally' });
    if (a === 'ignoreRally') { this.rallyIgnored.add(`${this.v.rally?.by}:${this.v.rally?.turn}`); this.render(); }
    if (a === 'invite') {
      const pub = b.dataset.pub === '1', to = +b.dataset.seat!;
      const err = await this.send({ type: 'invite', to, public: pub });
      if (!err) this.toast(`A ${pub ? 'public' : 'secret'} offer is on its way to ${this.v.players[to].name}.`);
    }
    if (a === 'answer') await this.send({ type: 'answer', invite: +b.dataset.id!, accept: b.dataset.yes === '1' });
    if (a === 'reveal') { if (confirm('Tell the whole valley about your alliance?')) await this.send({ type: 'reveal' }); }
    if (a === 'proposeSiege') { if (confirm('Call for a Siege on Olympus? If the alliance votes yes and the siege fails, the alliance shatters.')) await this.send({ type: 'proposeSiege' }); }
    if (a === 'vote') await this.send({ type: 'vote', yes: b.dataset.yes === '1' });
    this.render();
  }

  // =========================================================================
  // interaction

  private async send(a: Action): Promise<string | null> {
    if (!this.session) return 'No game';
    const err = await this.session.send(a);
    if (err) this.toast(`${ERRORS_FLAVOR[Math.floor(Math.random() * ERRORS_FLAVOR.length)]} ${err}`);
    return err;
  }

  /** After a conquest, keep the attack rolling from the new ground if it can still fight. */
  private followUp(to: number | null) {
    const v = this.v, u = this.ui;
    if (to == null || v.phase !== 'attack' || v.owner[to] !== this.me) return;
    u.target = null;
    u.sel = v.armies[to] >= 2 && attackTargets(v, this.me!, to).length ? to : null;
    this.world.clearArrow();
    this.render();
  }

  private toggleFocus() {
    this.focusMode = !this.focusMode;
    store.set('ic-focus', this.focusMode ? '1' : '0');
    this.toast(this.focusMode ? 'My Lands: everything you don\'t hold is greyed out.' : 'Showing every House.');
    this.render();
  }
  private cycleOlympus() {
    const next: OlympusMode = ({ solid: 'ghost', ghost: 'hidden', hidden: 'solid' } as const)[this.world.olympusMode];
    this.world.setOlympusMode(next);
    store.set('ic-olympus', next);
    this.toast({ solid: 'Olympus: solid', ghost: 'Olympus: see-through', hidden: 'Olympus: hidden' }[next]);
    this.render();
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      sound.setMuted(!sound.muted);
      this.toast(sound.muted ? '🔇 Sound off (M to turn it back on)' : '🔊 Sound on');
      if (document.getElementById('modal-root')?.dataset.key === 'info-settings') this.modalSettings();
    }
    if (!this.session?.view) return;
    if (e.key === 'g' || e.key === 'G') this.toggleFocus();
    if (e.key === 'o' || e.key === 'O') this.cycleOlympus();
    if (e.key === 'Escape') {
      this.ui.sel = null; this.ui.target = null; this.ui.pending = null; this.ui.stdMode = false; this.ui.inspect = null; this.ui.spot = null; this.ui.emotes = false;
      this.endPreview();
      this.world.clearArrow(); this.render();
    }
  }

  private async onHudClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!b) {
      // Clicking a glowing card (not one of its buttons) plays it: straight into the preview.
      const card = (e.target as HTMLElement).closest<HTMLElement>('#hand .gcard.playable, #inspector .gcard.playable');
      if (card?.dataset.card) {
        if (this.v.reaction) { await this.send({ type: 'react', card: card.dataset.card }); return; }
        return this.startPlay(card.dataset.card);
      }
      return;
    }
    if ((b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a!, u = this.ui, v = this.v;
    switch (a) {
      case 'menu': return this.modalMenu();
      case 'rules': return this.modalRules();
      case 'codex': return this.modalCodex();
      case 'focus': return this.toggleFocus();
      case 'olympus': return this.cycleOlympus();
      case 'diplo': return this.modalDiplo();
      case 'settings': return this.modalSettings();
      case 'spot': {
        const seat = +b.dataset.seat!;
        u.spot = u.spot === seat ? null : seat;
        if (u.spot != null) {
          const land = territoriesOf(v, seat);
          this.world.follow(land);
          this.toast(`${v.players[seat].name}: ${land.length} territories lit up. Click again to clear.`);
        }
        return this.render();
      }
      case 'min-regions': u.regionsMin = !u.regionsMin; return this.render();
      case 'invite': case 'answer': case 'reveal': case 'proposeSiege': case 'vote': case 'joinRally': case 'ignoreRally': return this.diplo(b);
      case 'kick': {
        const seat = +b.dataset.seat!, s = this.session;
        if (!(s instanceof OnlineSession)) return;
        if (!confirm(`Kick ${v.players[seat].name}? Their House goes on under an AI Primus, and they can't come back.`)) return;
        const err = await s.hostOp('kick', undefined, seat);
        if (err) this.toast(err);
        return;
      }
      case 'primusOpen': u.primusOpen = +b.dataset.keep!; return this.render();
      case 'emotes': u.emotes = !u.emotes; return this.renderEmotes();
      case 'emote': {
        u.emotes = false;
        this.renderEmotes();
        const err = await this.send({ type: 'emote', line: +b.dataset.n! });
        if (!err) this.lastEmoteAt = Date.now();
        return;
      }
      case 'speed': return this.setSpeed(+b.dataset.n!);
      case 'skip': this.skipping = true; document.querySelector('.showcase [data-a=ack]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return;
      case 'tab-roster': u.mobileTab = u.mobileTab === 'roster' ? 'none' : 'roster'; return this.render();
      case 'tab-log': u.mobileTab = u.mobileTab === 'log' ? 'none' : 'log'; return this.render();
      case 'min-roster': if (window.innerWidth > 900) { u.rosterMin = !u.rosterMin; this.render(); } return;
      case 'min-log': if (window.innerWidth > 900) { u.logMin = !u.logMin; this.render(); } return;
      case 'min-gen': u.genMin = !u.genMin; return this.render();
      case 'amt': u.placeAmt = b.dataset.n === 'all' ? 'all' : +b.dataset.n!; return this.render();
      case 'plus': if (u.sel != null) return this.placeOn(u.sel, false); return;
      case 'minus': if (u.sel != null) return this.placeOn(u.sel, true); return;
      case 'undo': return void this.send({ type: 'undoDraft' });
      case 'cancel': u.sel = null; u.target = null; u.pending = null; u.stdMode = false; this.endPreview(); this.world.clearArrow(); return this.render();
      case 'retarget': u.target = null; this.world.clearArrow(); return this.render();
      case 'tgt': {
        const t = +b.dataset.t!;
        if (u.sel == null) return;
        u.target = t; this.world.arrow(u.sel, t, t === OLYMPUS ? '#f3d27a' : '#ff3b1f');
        return this.render();
      }
      case 'endDraft': u.sel = null; u.primusOpen = null; return void this.send({ type: 'endDraft' });
      case 'endAttack': u.sel = null; u.target = null; this.world.clearArrow(); return void this.send({ type: 'endAttack' });
      case 'endTurn': u.sel = null; u.target = null; this.world.clearArrow(); return void this.send({ type: 'endTurn' });
      case 'dice': u.dice = +b.dataset.n!; return this.render();
      case 'roll': case 'blitz': {
        if (u.sel == null || u.target == null) return;
        const from = u.sel, to = u.target;
        if (to === OLYMPUS) { await this.send({ type: 'assault', from, dice: u.dice, blitz: a === 'blitz' }); return; }
        if (allied(v, this.me!, v.owner[to]) && !confirm(`${v.players[v.owner[to]].name} is your ally. Attacking ends the alliance for everyone in it. Do it?`)) return;
        const err = await this.send({ type: 'attack', from, to, dice: u.dice, blitz: a === 'blitz' });
        if (!err && this.v.owner[to] === this.me && !this.v.ts.mustMove) this.followUp(to);
        return;
      }
      case 'std': {
        if (u.sel == null || u.target == null) return;
        const commit = Math.max(1, Math.min(u.commit, v.armies[u.sel] - 1));
        const ally = allied(v, this.me!, v.owner[u.target]);
        if (!confirm(`Raise the Standard with ${commit} (+3 phantoms)? No retreat. If you lose, your ENTIRE House goes to the defender.${ally ? ' This is your ally: the alliance ends.' : ''}`)) return;
        const to = u.target;
        u.sel = null; u.target = null;
        await this.send({ type: 'attack', from: this.v.standards[v.players[this.me!].house].at, to, commit });
        return;
      }
      case 'stdMode': u.stdMode = !u.stdMode; u.sel = null; u.target = null; return this.render();
      case 'fortify': {
        if (u.sel == null || u.target == null) return;
        const n = Math.max(1, Math.min(u.moveN, v.armies[u.sel] - 1));
        const err = await this.send({ type: 'fortify', from: u.sel, to: u.target, n });
        if (!err) { u.sel = null; u.target = null; u.moveN = 1; this.render(); }
        return;
      }
      case 'trade': { const cards = [...u.trade]; u.trade.clear(); return void this.send({ type: 'trade', cards }); }
      case 'tsel': { const id = b.dataset.id!; if (u.trade.has(id)) u.trade.delete(id); else if (u.trade.size < 3) u.trade.add(id); return this.render(); }
      case 'dud': return void this.send({ type: 'discardProctor', card: b.dataset.id! });
      case 'play': return this.startPlay(b.dataset.id!);
      case 'inspect': u.inspect = u.inspect === b.dataset.id ? null : b.dataset.id!; return this.render();
      case 'inspect-close': u.inspect = null; return this.render();
    }
  }

  /** Play a card: pick its target if it needs one, then preview the outcome on the map. */
  private startPlay(id: string) {
    const u = this.ui;
    const kind = CARD[id].active.kind;
    u.inspect = null;
    if (kind === 'sabotage' || kind === 'parley' || kind === 'moveStd') {
      if (!this.cardImpact(id).targets.length) { this.toast(kind === 'parley' ? 'No neutral garrison small enough touches your land.' : 'Nothing in reach for that card right now.'); return this.render(); }
      u.pending = { card: id, needs: 'territory' };
      return this.render();
    }
    if (kind === 'steal') return this.pickRival(id);
    return this.confirmPlay({ type: 'play', card: id });
  }

  private onHudInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'commit') {
      this.ui.commit = +t.value;
      document.getElementById('commitN')!.textContent = t.value;
      const o = document.getElementById('stdOdds');
      if (o && this.ui.sel != null && this.ui.target != null) {
        const p = winChance(standardFight(this.v, this.me!, this.ui.sel, this.ui.target, +t.value));
        o.textContent = `≥${pct(p)}`; o.className = `odds ${oddsClass(p)}`;
      }
    }
    if (t.dataset.a === 'moveN') { this.ui.moveN = +t.value; document.getElementById('moveNv')!.textContent = t.value; }
  }

  private pickRival(card: string) {
    const v = this.v;
    const rivals = v.players.filter((p) => p.alive && p.seat !== this.me);
    this.modal(`<div class="modal"><div class="box" style="max-width:440px;text-align:center"><h2>Rob whom?</h2>
      ${rivals.map((p) => `<button class="btn" style="width:100%;margin-bottom:8px" data-a="rob" data-seat="${p.seat}">${sig(p.house)} ${esc(p.name)} · ${v.handCounts[p.seat] ?? 0} cards${allied(v, this.me!, p.seat) ? ' (ally)' : ''}</button>`).join('')}
      <button class="btn ghost" data-a="close">Cancel</button></div></div>`, 'info-rob');
    const root = document.getElementById('modal-root')!;
    root.querySelectorAll<HTMLElement>('[data-a=rob]').forEach((btn) => btn.addEventListener('click', () => {
      this.modal(null);
      this.confirmPlay({ type: 'play', card, seat: +btn.dataset.seat! });
    }));
  }

  /** Draft: add (or with `remove`, take back) the chosen amount on a territory. */
  private async placeOn(t: number, remove: boolean) {
    const v = this.v, u = this.ui;
    u.sel = t;
    if (remove) {
      const had = v.ts.placed[t] ?? 0;
      if (!had) { this.toast('You haven\'t placed anything there this Draft.'); return this.render(); }
      const n = u.placeAmt === 'all' ? had : Math.min(u.placeAmt, had);
      await this.send({ type: 'unplace', t, n });
      return;
    }
    if (v.ts.reinforcements <= 0) { this.toast(mustTrade(v, this.me!) ? 'Trade some cards first.' : 'No armies left. End the Draft.'); return this.render(); }
    const n = u.placeAmt === 'all' ? v.ts.reinforcements : Math.min(u.placeAmt, v.ts.reinforcements);
    this.world.burst(t, '#f3d27a');
    await this.send({ type: 'place', t, n });
  }

  private lastShift = false;
  /** Primus prompts dismissed this turn ("turn:keep"). */
  private primusSkipped = new Set<string>();
  /** Rallies this screen chose to ignore (by the turn they opened). */
  private rallyIgnored = new Set<string>();
  private async pick(t: number | null) {
    if (!this.session || this.session.status === 'lobby' || !document.getElementById('hud')) return;
    const v = this.v, u = this.ui;
    if (t == null) { if (u.target != null) u.target = null; else u.sel = null; this.world.clearArrow(); this.render(); return; }
    if (!this.myTurn()) { this.world.focus(t); return; }
    if (t === OLYMPUS) {
      if (v.phase === 'attack' && u.sel != null && this.canAssaultFrom(u.sel)) { u.target = OLYMPUS; this.world.arrow(u.sel, OLYMPUS, '#f3d27a'); this.render(); }
      else if (this.sieging() && v.phase === 'attack') this.toast('Pick one of your Foot of Olympus territories (inner ring) first.');
      return;
    }
    const mine = v.owner[t] === this.me;
    const me = this.me!;
    if (v.phase === 'draft') {
      if (u.pending?.needs === 'territory') {
        const card = u.pending.card;
        if (!this.cardImpact(card).targets.includes(t)) return this.territoryError([t], `${CARD[card].name} can't target ${this.tname(t)}. Pick a glowing territory.`);
        u.pending = null;
        this.confirmPlay({ type: 'play', card, t });
        return;
      }
      if (!mine) return this.territoryError([t], `${this.tname(t)} isn't yours. Reinforce your own land.`);
      return this.placeOn(t, this.lastShift);
    }
    if (v.phase === 'attack') {
      if (mine) {
        if (u.sel != null && u.sel === t) { u.sel = null; u.target = null; this.world.clearArrow(); }
        else if (v.armies[t] < 2) this.territoryError([t], `${this.tname(t)} has only 1 army. You need 2+ to attack (one always stays behind).`);
        else if (!attackTargets(v, me, t).length) this.territoryError([t], `Nothing to attack from ${this.tname(t)}: all its neighbours are yours.`);
        else { u.sel = t; u.target = null; u.dice = 3; u.commit = v.armies[t] - 1; this.world.clearArrow(); }
        this.render();
        return;
      }
      // Clicked someone else's land: attack it from the selection, or from your strongest territory that can.
      const why = u.sel != null ? attackBlocker(v, me, u.sel, t) : 'no source';
      if (!why) { u.target = t; this.world.arrow(u.sel!, t); this.render(); return; }
      const alt = this.bestSource(t);
      if (alt != null) {
        if (u.sel != null) this.whisper(`Attacking from <b>${esc(this.tname(alt))}</b> (${v.armies[alt]}) instead: ${esc(this.tname(u.sel))} can't reach.`);
        u.sel = alt; u.target = t; u.dice = 3; u.commit = v.armies[alt] - 1;
        this.world.arrow(alt, t);
        this.render();
        return;
      }
      this.territoryError(u.sel != null ? [t, u.sel] : [t], u.sel != null ? why! : this.whyUnreachable(t));
      return;
    }
    if (v.phase === 'fortify') {
      if (u.stdMode) {
        const st = v.standards[v.players[me].house];
        if (!mine || !connectedOwned(v, me, st.at).has(t)) return this.territoryError([t], 'The Standard only marches through your own connected land.');
        u.stdMode = false;
        await this.send({ type: 'moveStd', to: t });
        this.render();
        return;
      }
      if (!mine) return this.territoryError([t], `${this.tname(t)} isn't yours. Fortify only moves troops between your own territories.`);
      if (u.sel != null && u.sel !== t) {
        if (connectedOwned(v, me, u.sel).has(t)) { u.target = t; u.moveN = v.armies[u.sel] - 1; }
        else this.territoryError([t, u.sel], `${this.tname(t)} isn't connected to ${this.tname(u.sel)} through your land.`);
      } else if (u.sel === t) { u.sel = null; u.target = null; }
      else if (v.armies[t] >= 2) { u.sel = t; u.target = null; }
      else this.territoryError([t], `${this.tname(t)} has only 1 army, and one must always stay behind.`);
      this.render();
    }
  }

  /** Your strongest territory that can attack `t` right now, if any. */
  private bestSource(t: number): number | null {
    const v = this.v, me = this.me!;
    const ok = territoriesOf(v, me).filter((x) => !attackBlocker(v, me, x, t));
    return ok.length ? ok.reduce((b, x) => (v.armies[x] > v.armies[b] ? x : b), ok[0]) : null;
  }

  /** Why none of your territories can attack `t`. */
  private whyUnreachable(t: number): string {
    const v = this.v, me = this.me!, g = this.g;
    const touching = g.adj[t].filter((x) => v.owner[x] === me);
    if (touching.length) return attackBlocker(v, me, touching.sort((a, b) => v.armies[b] - v.armies[a])[0], t) ?? 'You cannot attack it right now.';
    const crossing = territoriesOf(v, me).find((x) => g.territories[x].quadrant !== g.territories[t].quadrant && g.dist[x][t] <= 2);
    return crossing != null
      ? `${this.tname(t)} doesn't border your land. It's across the water: cross on a land bridge, or sail from a ⚓ port.`
      : `${this.tname(t)} doesn't border any of your land. Attack a territory that touches yours.`;
  }

  /** A short error that pops up over the territories involved, flashes them red, and fades. */
  private territoryError(ts: number[], msg: string) {
    sound.play('deny');
    this.world.flash(ts);
    document.querySelectorAll('.terr-err').forEach((x) => x.remove());
    const p = this.world.screenPos(ts[0]);
    const b = el(`<div class="terr-err">${esc(msg)}</div>`);
    b.style.left = `${Math.max(12, Math.min(window.innerWidth - 292, p.x - 140))}px`;
    b.style.top = `${Math.max(60, Math.min(window.innerHeight - 180, p.y - 70))}px`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3200);
  }

  private hover(t: number | null, x: number, y: number) {
    if (t == null || !this.session?.view) { this.tip.classList.add('hidden'); return; }
    const v = this.v;
    if (t === OLYMPUS) {
      const sg = v.siege;
      this.tip.innerHTML = `<div class="tn">Olympus</div><div class="tm">Home of the Proctors</div>
        ${sg ? `<div><b>${sg.garrison}</b> defenders · ${sg.turnsLeft} allied turns left</div><div class="tm">Walls +1 · regrows ${sg.regen} · smites ${sg.smite}</div>` : '<div class="tm">Only an alliance that stands alone may besiege it.</div>'}`;
    } else {
      const td = this.g.territories[t];
      const o = v.owner[t];
      const std = standardAt(v, t);
      const ally = this.me != null && allied(v, this.me, o);
      this.tip.innerHTML = `<div class="tn">${esc(td.name)}${td.isKeep ? ' ♜' : ''}</div>
        <div class="tm">${td.biome === 'keep' ? `Keep of House ${HOUSES[td.house].name}` : td.biome} · House ${HOUSES[td.house].name} · ${QUADRANTS[td.quadrant].name}${td.foot ? ' · Foot of Olympus' : ''}</div>
        <div>${o >= 0 ? `<b style="color:${HOUSES[v.players[o].house].color}">${esc(v.players[o].name)}</b>${ally ? ' <span class="ally-tag">ally</span>' : ''}` : '<span class="tm">Neutral garrison</span>'} · <b>${v.armies[t]}</b> armies${v.phase === 'draft' && v.ts.placed[t] ? ` <span class="plus">(+${v.ts.placed[t]} this Draft)</span>` : ''}</div>
        ${td.isKeep && v.primus?.[td.house] ? `<div style="color:var(--gold)">♛ Primus: <b>${esc(CARD[v.primus[td.house]!.card].name)}</b> (${esc(v.players[v.primus[td.house]!.seat].name)})</div>` : ''}
        ${std >= 0 ? `<div style="color:var(--gold)">⚑ Standard of House ${HOUSES[std].name}${v.standards[std].guard ? ` · <b>${v.armies[t]} + ${v.standards[std].guard}</b> honor guard` : ''}</div>` : ''}
        ${td.terrain !== 'open' ? `<div class="tt-terr">${TERRAIN_INFO[td.terrain].icon} <b>${TERRAIN_INFO[td.terrain].name}.</b> ${TERRAIN_INFO[td.terrain].text}</div>` : ''}
        ${this.regionTip(t)}
        ${td.port >= 0 ? `<div class="tt-terr">⚓ <b>Port.</b> Its sea lane borders ${esc(this.g.territories[td.port].name)} across the water.</div>` : ''}
        ${this.oddsTip(t)}`;
    }
    this.tip.style.left = `${Math.min(x + 16, window.innerWidth - 270)}px`;
    this.tip.style.top = `${y + 14}px`;
    this.tip.classList.remove('hidden');
  }

  private regionTip(t: number) {
    const v = this.v, g = this.g, r = g.regions[g.territories[t].region];
    if (!r) return '';
    const mine = this.me != null ? r.terr.filter((x) => v.owner[x] === this.me).length : 0;
    return `<div class="tt-region">⬡ <b>${esc(r.name)}</b> <span class="rg-b">+${r.bonus}</span>${this.me != null ? ` · you hold ${mine}/${r.terr.length}` : ` · ${r.terr.length} territories`}</div>`;
  }

  /** In your attack, hovering a target shows your blitz odds from the selected (or best) territory. */
  private oddsTip(t: number) {
    const v = this.v, me = this.me;
    if (!this.myTurn() || v.phase !== 'attack' || me == null || v.owner[t] === me) return '';
    const from = this.ui.sel != null && !attackBlocker(v, me, this.ui.sel, t) ? this.ui.sel : this.bestSource(t);
    if (from == null) return '';
    const p = winChance(attackFight(v, me, from, t));
    return `<div class="tt-odds">⚔ From ${esc(this.tname(from))} (${v.armies[from]}): <span class="odds ${oddsClass(p)}">${pct(p)}</span> to take it</div>`;
  }

  // =========================================================================
  // event animation

  private processEvents(v: GameState) {
    const maxId = v.log.length ? v.log[v.log.length - 1].id : 0;
    if (this.lastEvent < 0) { this.lastEvent = maxId; return; }
    const fresh = v.log.filter((e) => e.id > this.lastEvent);
    this.lastEvent = maxId;
    // After a jump (a skipped replay), only the last couple of battles are worth rolling dice for.
    const battles = fresh.filter((e) => e.k === 'battle' || e.k === 'stdBattle' || e.k === 'assault').slice(-2);
    const lastTurn = [...fresh].reverse().find((e) => e.k === 'turn');
    this.regionWhisper(v, fresh);
    for (const e of fresh) {
      if (battles.includes(e)) this.animateBattle(v, e);
      if (e.k === 'turn' && e.seat === this.me && this.session?.mode === 'online') this.flashTitle();
      if (e === lastTurn) this.turnBanner(v, e.seat);
      if (e.k === 'invite' && e.to === this.me) this.toast(`📜 ${v.players[e.from].name} whispers an alliance offer. Check 🤝.`);
      if (e.k === 'olympusTurn' && e.killed) this.world.bleed(OLYMPUS, e.killed);
      const hl = headline(v, e);
      if (hl) this.banner(hl.title, hl.sub, hl.color, hl.long);
      this.sfx(v, e);
    }
  }

  private animateBattle(v: GameState, e: GameEvent) {
    this.diceQueue = this.diceQueue.then(() => this.showBattle(v, e));
  }

  /** Roll the dice of one battle in the tray, with an arrow on the map. Resolves once the dice have landed. */
  private async showBattle(v: GameState, e: GameEvent) {
    const last = e.rolls?.[e.rolls.length - 1];
    if (!last) return;
    {
      const box = document.getElementById('battle');
      if (!box) return;
      clearTimeout(this.battleHide);
      box.classList.remove('hidden');
      const olympus = e.k === 'assault';
      const to = olympus ? OLYMPUS : e.to;
      const aName = v.players[e.seat].name;
      const dName = olympus ? 'Olympus' : e.def >= 0 ? v.players[e.def].name : 'Neutral';
      document.getElementById('bA')!.innerHTML = `<span style="color:${HOUSES[v.players[e.seat].house].color}">${esc(aName)}</span>`;
      document.getElementById('bD')!.innerHTML = `<span style="color:${olympus ? '#f3d27a' : e.def >= 0 ? HOUSES[v.players[e.def].house].color : '#aaa'}">${esc(dName)}</span>`;
      document.getElementById('bRes')!.innerHTML = e.k === 'stdBattle' ? '⚑ Standard battle…' : `${esc(this.tname(e.from))} → ${esc(this.tname(to))}`;
      this.world.arrow(e.from, to, e.k === 'battle' ? '#ff3b1f' : '#f3d27a');
      // Skirmishes with neutral garrisons happen every turn; the battle music is for Houses meeting in the field.
      if (e.def >= 0 || e.k !== 'battle') this.bumpBattle();
      sound.play('dice');
      await this.dice.roll(last.raw.a, last.raw.d);
      this.battleSound(e);
      const mods = (raw: number[], mod: number[]) => raw.map((r, i) => (mod[i] !== r ? `${r}<sup>${mod[i] - r > 0 ? '+' : ''}${mod[i] - r}</sup>` : `${r}`)).join(' ');
      const summary = e.k === 'stdBattle'
        ? (e.won ? `<b>VICTORY</b> after ${e.n} rounds · ${e.enslaved} enslaved` : `<b>THE CHARGE DIES</b> after ${e.n} rounds`)
        : olympus
          ? `${e.n > 1 ? `${e.n} rolls · ` : ''}lost <b>${e.aLost}</b> · killed <b>${e.dLost}</b> · ${e.won ? '<b>OLYMPUS FALLS</b>' : `${e.garrison} left`}`
          : `${e.n > 1 ? `${e.n} rolls · ` : ''}lost <b>${e.aLost}</b> · killed <b>${e.dLost}</b>${e.won ? ' · <b>CONQUERED</b>' : ''}`;
      const terr = [e.tA ? `⛰ high ground +${e.tA}` : '', e.tD ? `🌲 forest cover +${e.tD}` : ''].filter(Boolean).join(' · ');
      document.getElementById('bRes')!.innerHTML = `<span style="color:#ff8a7a">${mods(last.raw.a, last.a)}</span> vs <span>${mods(last.raw.d, last.d)}</span> · ${summary}${terr ? `<div class="terr-note">${terr}</div>` : ''}`;
      // Blood on both sides of the line.
      this.world.bleed(to, e.dLost ?? 0, !!e.won);
      this.world.bleed(e.from, e.aLost ?? 0);
      const mineHit = (e.seat === this.me && (e.aLost ?? 0) >= 3) || (e.def === this.me && (e.dLost ?? 0) >= 2);
      if (mineHit || (e.won && (e.seat === this.me || e.def === this.me))) this.flashBlood(e.won && e.def === this.me ? 1 : 0.6);
      if (e.won) this.world.burst(to, HOUSES[v.players[e.seat].house].color, e.k !== 'battle');
      this.battleHide = window.setTimeout(() => { box.classList.add('hidden'); if (this.ui.target == null) this.world.clearArrow(); }, 2600);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  /** Steel as the dice land, a grunt per fallen soldier (up to three), and a cry if the ground was taken. */
  private battleSound(e: GameEvent) {
    const lost = (e.aLost ?? 0) + (e.dLost ?? 0);
    sound.play('clash');
    if (e.n > 1 || lost >= 3) sound.play('clash', { delay: 0.16, vol: 0.8 });
    if (e.k === 'assault') sound.play('boom', { vol: 0.6 });
    for (let i = 0; i < Math.min(lost, 3); i++) sound.play('grunt', { delay: 0.1 + i * 0.17, vol: 0.9 - i * 0.15 });
    if (e.won) sound.play(e.k === 'battle' ? 'scream' : 'warcry', { delay: 0.45, vol: 0.8 });
  }

  /**
   * Someone else played a card: show it big, pinned beside what it hit on the map, with the War Log line,
   * until this viewer acknowledges it.
   */
  private showcase(v: GameState, e: GameEvent): Promise<void> {
    const c = CARD[e.card];
    if (!c) return Promise.resolve();
    const p = v.players[e.seat];
    const targets: number[] = e.targets?.length ? e.targets : e.t != null ? [e.t] : e.victim != null ? territoriesOf(v, e.victim) : [];
    this.showcaseOpen = true;
    this.world.setHighlights(null, targets, 'target');
    const anchor = e.t ?? e.targets?.[0] ?? null;
    if (anchor != null) this.world.focus(anchor);
    const box = el(`<div class="showcase" style="--hc:${HOUSES[c.house].color}">
      <svg class="lead"><line x1="0" y1="0" x2="0" y2="0"/></svg>
      <div class="sc-body">
        <div class="sc-who">${sig(p.house)} <span><b style="color:${HOUSES[p.house].color}">${esc(p.name)}</b>${p.ai ? ' <span class="ai-tag">AI</span>' : ''} plays a card</span></div>
        ${this.cardHTML(e.card, { big: true, an: e.n, forHouse: p.house, ownsCheck: false })}
        <div class="sc-log">${describe(v, e)}</div>
        <button class="btn primary" data-a="ack" style="width:100%">Acknowledge</button>
      </div>
    </div>`);
    document.body.appendChild(box);
    const body = box.querySelector<HTMLElement>('.sc-body')!;
    const line = box.querySelector('line')!;
    let raf = 0;
    const place = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const bw = body.offsetWidth, bh = body.offsetHeight;
      let x = (W - bw) / 2, y = Math.max(64, (H - bh) / 2 - 40);
      if (anchor != null) {
        const a = this.world.screenPos(anchor);
        // Beside the target, on whichever side has room, so the card never covers it.
        x = a.x < W / 2 ? a.x + 70 : a.x - 70 - bw;
        x = Math.max(8, Math.min(W - bw - 8, x));
        y = Math.max(64, Math.min(H - bh - 8, a.y - bh / 2));
        const cx = x < a.x ? x + bw : x;
        line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(y + bh / 2));
        line.setAttribute('x2', String(a.x)); line.setAttribute('y2', String(a.y));
      }
      body.style.left = `${x}px`; body.style.top = `${y}px`;
      raf = requestAnimationFrame(place);
    };
    place();
    return new Promise((res) => {
      box.querySelector('[data-a=ack]')!.addEventListener('click', () => {
        cancelAnimationFrame(raf);
        box.remove();
        this.showcaseOpen = false;
        this.renderHighlights();
        res();
      });
    });
  }

  /**
   * The Sorting: a wheel of the seven Houses spins once per player and lands on the House the server already
   * dealt them. Purely a show, once per war per device, and skippable.
   */
  private showWheel(v: GameState) {
    const s = this.session!;
    this.wheelOpen = true;
    document.body.classList.add('sorting');
    const g = geo(v);
    const SEG = 360 / HOUSES.length;
    const R = 100;
    const pt = (deg: number, r: number) => { const a = ((deg - 90) * Math.PI) / 180; return `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`; };
    const wedges = HOUSES.map((h, i) => {
      const a0 = i * SEG - SEG / 2, a1 = i * SEG + SEG / 2;
      return `<g class="wedge" data-h="${i}">
        <path d="M0 0 L${pt(a0, R)} A${R} ${R} 0 0 1 ${pt(a1, R)} Z" fill="${h.color}" stroke="#1a0d0a" stroke-width="1.5"/>
        <text transform="translate(${pt(i * SEG, 70)}) rotate(${i * SEG})" text-anchor="middle" dominant-baseline="middle" class="w-sig" fill="${i === 5 ? '#222' : '#fff'}">${h.sigil}</text>
        <text transform="translate(${pt(i * SEG, 44)}) rotate(${i * SEG})" text-anchor="middle" dominant-baseline="middle" class="w-name" fill="${i === 5 ? '#222' : '#fff'}">${h.name.toUpperCase()}</text>
        <text transform="translate(${pt(i * SEG, 88)}) rotate(${i * SEG})" text-anchor="middle" dominant-baseline="middle" class="w-who" fill="#fff"></text>
      </g>`;
    }).join('');
    const box = el(`<div class="wheel-wrap"><div class="wheel-panel">
      <div class="logo-sub">THE SORTING</div>
      <h2>Which House will claim you?</h2>
      <p class="prose">The Proctors spin the wheel. Seven Houses, ${v.players.length} Golds. The Houses nobody draws become neutral garrisons.</p>
      <div class="wheel-body">
        <div class="wheel-box">
          <div class="pointer">▼</div>
          <svg viewBox="-104 -104 208 208" class="wheel"><g id="wheelG">${wedges}</g><circle r="16" fill="#1a0d0a" stroke="#e6bb5c" stroke-width="3"/><text class="w-hub" text-anchor="middle" dominant-baseline="middle" fill="#e6bb5c">⚔</text></svg>
        </div>
        <div class="wheel-list">${v.players.map((p) => `<div class="wl" data-seat="${p.seat}"><span class="wl-name">${esc(p.name)}${p.seat === this.me ? ' <span class="you">YOU</span>' : ''}${p.ai ? ' <span class="ai-tag">AI</span>' : ''}</span><span class="wl-house">?</span></div>`).join('')}
          <div class="wl-neutral hidden"></div></div>
      </div>
      <div class="row wheel-btns"><button class="btn ghost" data-a="wskip">Skip</button><button class="btn primary big" data-a="wstart">Start Selection</button></div>
    </div></div>`);
    document.body.appendChild(box);
    const wg = box.querySelector<SVGGElement>('#wheelG')!;
    let rot = 0, done = false, skip = false;
    let hush = () => {};
    const close = () => {
      if (done) return;
      done = true;
      skip = true;
      hush();
      store.set(`ic-sorted-${s.key}`, '1');
      box.remove();
      this.wheelOpen = false;
      document.body.classList.remove('sorting');
      this.world.setHighlights(null, [], 'attack');
      this.render();
      s.kick?.();
    };
    const reveal = (p: GameState['players'][number]) => {
      const row = box.querySelector<HTMLElement>(`.wl[data-seat="${p.seat}"]`)!;
      row.classList.remove('spinning');
      row.classList.add('got');
      row.style.setProperty('--c', HOUSES[p.house].color);
      row.querySelector('.wl-house')!.innerHTML = `${sig(p.house)} House ${HOUSES[p.house].name} <span class="fine">${esc(HOUSES[p.house].epithet)}</span>`;
      const w = box.querySelector(`.wedge[data-h="${p.house}"]`)!;
      w.classList.add('taken');
      w.querySelector('.w-who')!.textContent = p.name.slice(0, 10);
    };
    const finish = () => {
      for (const p of v.players) reveal(p);
      const free = HOUSES.map((_, h) => h).filter((h) => !v.players.some((p) => p.house === h));
      const nb = box.querySelector<HTMLElement>('.wl-neutral')!;
      nb.classList.remove('hidden');
      nb.innerHTML = free.length ? `Neutral garrisons: ${free.map((h) => `${sig(h, 'sig sm')} ${HOUSES[h].name}`).join(' ')}` : 'Every House has a master.';
      box.querySelector('.wheel-btns')!.innerHTML = '<button class="btn primary big" data-a="wdone">To the Passage ▸</button>';
    };
    box.addEventListener('click', async (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'wskip') { skip = true; hush(); finish(); return; }
      if (a === 'wdone') { close(); return; }
      if (a !== 'wstart') return;
      box.querySelector('.wheel-btns')!.innerHTML = '<button class="btn ghost" data-a="wskip">Skip</button>';
      for (let i = 0; i < v.players.length && !skip; i++) {
        const p = v.players[i];
        box.querySelectorAll('.wl').forEach((x) => x.classList.remove('spinning'));
        box.querySelector(`.wl[data-seat="${p.seat}"]`)!.classList.add('spinning');
        const dur = i === 0 ? 4200 : 3000;
        // Land somewhere inside the wedge, sometimes teasingly near its edge.
        const jitter = (Math.random() - 0.5) * SEG * 0.8;
        const delta = ((((-(p.house * SEG) - rot) % 360) + 360) % 360) + jitter;
        rot += 360 * (i === 0 ? 5 : 3) + delta;
        wg.style.transition = `transform ${dur}ms cubic-bezier(0.12, 0.72, 0.16, 1)`;
        wg.style.transform = `rotate(${rot}deg)`;
        hush = sound.spin(dur, 360 * (i === 0 ? 5 : 3) + delta, SEG);
        await sleep(dur + 150);
        if (skip) break;
        sound.play('drum', { vol: 0.8 });
        reveal(p);
        this.world.focus(g.keepOf(p.house));
        this.world.setHighlights(null, g.territories.filter((t) => t.house === p.house).map((t) => t.id), 'place');
        this.banner(`HOUSE ${HOUSES[p.house].name.toUpperCase()}`, `${p.name} · ${HOUSES[p.house].epithet}`, HOUSES[p.house].color);
        await sleep(1500);
        // Nudge back so the next spin doesn't start with the pointer on a seam.
        rot -= jitter;
      }
      if (!done) finish();
    });
  }

  private flashBlood(strength: number) {
    const f = document.getElementById('bloodflash');
    if (!f) return;
    f.style.setProperty('--s', String(strength));
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  private banner(title: string, sub: string, color: string, long = false) {
    const b = el(`<div class="banner ${long ? 'long' : ''}" style="--c:${color}"><div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div></div>`);
    document.body.appendChild(b);
    setTimeout(() => b.remove(), long ? 5200 : 2700);
  }

  private flashTitle() {
    const orig = 'Institute Conquest';
    let n = 0;
    const iv = setInterval(() => { document.title = n % 2 ? orig : '⚔ Your turn!'; if (++n > 8 || !document.hidden) { clearInterval(iv); document.title = orig; } }, 900);
  }

  toast(msg: string) {
    const t = el(`<div class="toast">${esc(msg)}</div>`);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3300);
  }
}
