// UI controller: menus, lobby, HUD, cards, modals, diplomacy, and board interaction.

import { World, OLYMPUS, type OlympusMode } from '../render/scene.ts';
import { DiceTray } from '../render/dice.ts';
import { HOUSES, MAX_PLAYERS, QUADRANTS, geoFor } from '../engine/data.ts';
import { CARD, CARDS, OLYMPUS_POWER, fmt, isSiegeCard } from '../engine/cards.ts';
import {
  type Action, type GameEvent, type GameState, HAND_LIMIT, NEUTRAL, allianceOf, allied, attackTargets, connectedOwned, geo,
  housesOwned, inviteBlocker, mustTrade, olympusPreview, ownsHouse, passive, reinforcementBreakdown, siegeBlocker, standardAt, territoriesOf,
} from '../engine/engine.ts';
import { LocalSession, OnlineSession, savedCreds, type LobbySeat, type Session } from '../net/session.ts';
import { ERRORS_FLAVOR, PASSAGE_INTRO, RULES_HTML, TAGLINES, describe, headline } from './copy.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const el = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const sig = (h: number, cls = 'sig') => `<span class="${cls}" style="background:${HOUSES[h].color};${h === 5 ? 'color:#222;text-shadow:none' : ''}">${HOUSES[h].sigil}</span>`;
const AI_NAMES = ['Proctor\'s Pet', 'Some Tall Bastard', 'A Very Angry Gold', 'The Draft Pick Nobody Wanted', 'Knife in a Nice Coat', 'Lord of Mud', 'The Quiet One'];

interface UIState {
  sel: number | null;
  target: number | null;
  trade: Set<string>;
  pending: { card: string; needs: 'territory' | 'seat' } | null;
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
    return { sel: null, target: null, trade: new Set(), pending: null, placeAmt: 1, dice: 3, commit: 1, moveN: 1, stdMode: false, follow: null, mobileTab: 'none', rosterMin: false, logMin: window.innerWidth < 1300, genMin: false };
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
          <button class="btn ghost" data-a="rules">How to Play</button>
          <button class="btn ghost" data-a="codex">The Codex (all cards)</button>
        </div>
        <p class="fine">A free, non-commercial fan game inspired by Pierce Brown's <i>Red Rising</i>. Not affiliated with or endorsed by the author or publisher. Contains violence and foul language.</p>
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
      if (a === 'rules') this.modalRules();
      if (a === 'codex') this.modalCodex();
    });
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
    const draw = () => {
      const n = seats.filter((x) => x.kind !== 'empty').length;
      const g = geoFor(Math.max(2, n));
      const s = this.setScreen(`
        <div class="screen"><div class="menu card-panel">
          <h2>Local War</h2>
          <p class="fine" style="margin:0 0 14px">Up to ${MAX_PLAYERS} Houses. Hot-seat: pass one device between humans. Empty seats become neutral Houses.
            <br><b style="color:var(--gold)">${n} House${n === 1 ? '' : 's'} → a valley of ${g.nt} territories.</b></p>
          ${seats.map((x, i) => `<div class="seat-row">
            <div class="seg">${(['human', 'ai', 'empty'] as const).map((k) => `<button data-seat="${i}" data-k="${k}" class="${x.kind === k ? 'on' : ''}">${k === 'human' ? 'Human' : k === 'ai' ? 'AI' : 'None'}</button>`).join('')}</div>
            <input class="field nm" data-name="${i}" value="${esc(x.name)}" maxlength="24" ${x.kind === 'empty' ? 'disabled' : ''}>
          </div>`).join('')}
          <div class="row" style="margin-top:12px"><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="go">Begin the Institute</button></div>
        </div></div>`)!;
      s.querySelectorAll<HTMLInputElement>('[data-name]').forEach((inp) => inp.addEventListener('input', () => { seats[+inp.dataset.name!].name = inp.value; }));
      s.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        if (b.dataset.seat) { seats[+b.dataset.seat].kind = b.dataset.k as any; draw(); return; }
        if (b.dataset.a === 'back') this.showTitle();
        if (b.dataset.a === 'go') {
          const chosen: LobbySeat[] = seats.filter((x) => x.kind !== 'empty').map((x, i) => ({ seat: i, name: x.name.trim() || `Gold ${i + 1}`, ai: x.kind === 'ai' }));
          if (chosen.length < 2) return this.toast('You need at least two Houses to have a war.');
          if (!chosen.some((x) => !x.ai)) return this.toast('At least one human, or who is this for?');
          this.startSession(new LocalSession(chosen));
        }
      });
    };
    draw();
  }

  private showLobby() {
    const s = this.session as OnlineSession;
    const host = s.seat === s.hostSeat;
    const link = `${location.origin}${location.pathname}?join=${s.code}`;
    const scr = this.setScreen(`
      <div class="screen"><div class="menu card-panel">
        <h2>War Council</h2>
        <div class="fine" style="margin:0">Share this code or link. Up to ${MAX_PLAYERS} Houses; the valley grows with every House (${geoFor(Math.max(2, s.lobby.length)).nt} territories right now).</div>
        <div class="code-big">${s.code}</div>
        <div class="row" style="margin-bottom:14px"><input class="field" readonly value="${esc(link)}"><button class="btn" data-a="copy" style="flex:0 0 auto">Copy link</button></div>
        ${s.lobby.map((l) => `<div class="seat-row"><span class="nm">${esc(l.name)} ${l.seat === s.seat ? '<span class="you">YOU</span>' : ''} ${l.ai ? '<span class="ai-tag">AI</span>' : ''}</span>${l.seat === s.hostSeat ? '<span class="fine" style="margin:0">host</span>' : ''}</div>`).join('')}
        ${host ? `<div class="row" style="margin-top:10px">
            <button class="btn" data-a="addBot" ${s.lobby.length >= MAX_PLAYERS ? 'disabled' : ''}>+ AI Primus</button>
            <button class="btn" data-a="removeBot" ${!s.lobby[s.lobby.length - 1]?.ai ? 'disabled' : ''}>− AI</button></div>
            <button class="btn primary big" style="width:100%;margin-top:10px" data-a="start" ${s.lobby.length < 2 ? 'disabled' : ''}>Start the War</button>`
        : '<p class="tagline">Waiting for the host to start. Sharpen something.</p>'}
        <button class="btn ghost" style="margin-top:10px" data-a="leave">Leave</button>
      </div></div>`)!;
    scr.addEventListener('click', async (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (a === 'copy') { navigator.clipboard?.writeText(link).then(() => this.toast('Link copied. Go recruit.'), () => this.toast(link)); }
      if (a === 'addBot' || a === 'removeBot' || a === 'start') { const err = await s.hostOp(a); if (err) this.toast(err); }
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
    if (s instanceof OnlineSession) {
      store.set('ic-last-code', s.code);
      history.replaceState(null, '', `${location.pathname}?join=${s.code}`);
    }
    s.onUpdate(() => this.onUpdate());
    this.onUpdate();
  }

  private endSession() {
    this.session?.close();
    this.session = null;
    document.getElementById('hud')?.remove();
    document.getElementById('modal-root')?.remove();
    document.getElementById('bloodflash')?.remove();
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
    this.processEvents(v);
    this.world.update(v);
    this.validateUI(v);
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
        </div>
        <div class="corner right mobile-tabs">
          <button class="icon-btn" data-a="tab-roster" title="Houses &amp; your General">♜</button>
          <button class="icon-btn" data-a="tab-log" title="War log">✎</button>
        </div>
        <div class="topbar" id="topbar"></div>
        <div class="battle hidden" id="battle"><div class="vs"><span id="bA"></span><span id="bD"></span></div><canvas id="dice"></canvas><div class="res" id="bRes"></div></div>
        <div class="leftcol" id="leftcol"><div class="general" id="general"></div><div class="side left" id="roster"></div></div>
        <div class="side right log" id="log"></div>
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

  private get v() { return this.session!.view!; }
  private get me() { return this.session!.seat; }
  private get g() { return geo(this.v); }
  private tname(t: number) { return t === OLYMPUS ? 'Olympus' : this.g.territories[t].name; }
  private myTurn() {
    const s = this.session!, v = this.v;
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
    this.renderLog();
    this.renderActionBar();
    this.renderHand();
    this.renderNotices();
    this.renderHighlights();
    this.renderModals();
    const lc = document.getElementById('leftcol')!, r = document.getElementById('roster')!, l = document.getElementById('log')!;
    const narrow = window.innerWidth <= 900;
    lc.classList.toggle('collapsed', narrow && this.ui.mobileTab !== 'roster');
    l.classList.toggle('collapsed', narrow && this.ui.mobileTab !== 'log');
    r.classList.toggle('min', !narrow && this.ui.rosterMin);
    l.classList.toggle('min', !narrow && this.ui.logMin);
    document.getElementById('btnFocus')!.classList.toggle('on', this.focusMode);
    document.getElementById('btnOly')!.classList.toggle('on', this.world.olympusMode !== 'solid');
    document.getElementById('btnOly')!.textContent = this.world.olympusMode === 'hidden' ? '⛶' : '⛰';
    const pending = this.me != null && (this.v.invites.some((i) => i.to === this.me) || this.voteOwed());
    document.querySelector('#btnDiplo .dot')!.classList.toggle('hidden', !pending);
    this.world.setFocus(this.focusMode && this.me != null ? this.me : null);
    const root = document.getElementById('modal-root');
    if (root?.dataset.key === 'info-diplo') this.modalDiplo(true);
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
      <span class="reinf" title="Round">R${Math.ceil(v.turn / Math.max(1, v.players.length))}</span>`;
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
      return `<div class="player ${seat === v.cur && v.phase !== 'passage' ? 'cur' : ''} ${p.alive ? '' : 'dead'} ${myAl?.members.includes(seat) && seat !== this.me ? 'my-ally' : ''}">
        <div class="pn">${sig(p.house)} <span style="color:${HOUSES[p.house].color}">${esc(p.name)}</span>
          ${seat === this.me ? '<span class="you">YOU</span>' : ''}${p.ai ? '<span class="ai-tag">AI</span>' : ''}${allyTag}</div>
        ${this.primusHTML(seat)}
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
    box.innerHTML = inv + vote;
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
    if (!this.myTurn()) { this.world.setHighlights(null, [], 'attack'); return; }
    if (v.phase === 'draft') {
      if (u.pending?.needs === 'territory') {
        const kind = CARD[u.pending.card].active.kind;
        const mine = territoriesOf(v, this.me!);
        const adjEnemy = [...new Set(mine.flatMap((t) => this.g.adj[t]))].filter((t) => v.owner[t] !== this.me);
        const tg = kind === 'moveStd' ? mine : kind === 'parley' ? adjEnemy.filter((t) => v.owner[t] === NEUTRAL) : adjEnemy;
        this.world.setHighlights(null, tg, 'target');
      } else this.world.setHighlights(u.sel, territoriesOf(v, this.me!).filter((t) => t !== u.sel), 'place');
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
    }
  }

  private renderActionBar() {
    const v = this.v, u = this.ui, bar = document.getElementById('actionbar')!;
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
          return `<button class="chip ${ally ? 'ally' : ''}" data-a="tgt" data-t="${t}" style="--c:${col}" title="${ally ? 'Your ally! Attacking ends the alliance.' : ''}">${ally ? '⚠ ' : ''}${esc(T[t].name)} <b>${v.armies[t]}</b>${standardAt(v, t) >= 0 ? ' ⚑' : ''}</button>`;
        }).join('');
        const oly = this.canAssaultFrom(u.sel) ? `<button class="chip oly" data-a="tgt" data-t="${OLYMPUS}">🏛 Olympus <b>${v.siege!.garrison}</b></button>` : '';
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
        bar.innerHTML = `<span class="hint"><b>${esc(T[from].name)}</b> (${v.armies[from]}) ⚔ <b>OLYMPUS</b> (${sg.garrison}${v.ts.buffs.siegeWalls ? ', walls bypassed' : ', walls +1'})</span>
          ${diceSeg}<button class="btn gold" data-a="roll">Assault</button><button class="btn gold" data-a="blitz">Blitz</button><button class="btn sm" data-a="cancel">✕</button>`;
        return;
      }
      const myStd = v.standards[v.players[this.me!].house];
      const canStd = !myStd.captured && myStd.at === from && v.armies[from] >= 2;
      const commit = Math.max(1, Math.min(u.commit, v.armies[from] - 1));
      const defStd = standardAt(v, to);
      const ally = allied(v, this.me!, v.owner[to]);
      bar.innerHTML = `
        <span class="hint"><b>${esc(T[from].name)}</b> (${v.armies[from]}) ⚔ <b>${esc(T[to].name)}</b> (${v.armies[to]}${defStd >= 0 && v.standards[defStd].guard ? ` +${v.standards[defStd].guard} guard` : ''})</span>
        ${ally ? '<span class="warn">⚠ Your ally. This shatters the alliance.</span>' : ''}
        ${diceSeg}
        <button class="btn primary" data-a="roll" ${v.armies[from] < 2 ? 'disabled' : ''}>Roll</button>
        <button class="btn primary" data-a="blitz" ${v.armies[from] < 2 ? 'disabled' : ''}>Blitz</button>
        ${canStd ? `<label>Commit <input type="range" data-a="commit" min="1" max="${v.armies[from] - 1}" value="${commit}"> <b id="commitN">${commit}</b>+3</label>
          <button class="btn gold" data-a="std">⚑ Raise the Standard</button>` : ''}
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
        bar.innerHTML = `<span class="hint">March from <b>${esc(T[u.sel].name)}</b> to <b>${esc(T[u.target].name)}</b></span>
          <label><input type="range" data-a="moveN" min="1" max="${max}" value="${n}"> <b id="moveNv">${n}</b></label>
          <button class="btn primary" data-a="fortify">March</button><button class="btn sm" data-a="cancel">✕</button>`;
        return;
      }
      bar.innerHTML = `<span class="hint">${u.sel == null ? `Pick troops to move (${limit} move${limit === '1' ? '' : 's'} left).` : 'Pick a destination.'}</span>${stdBtn}<button class="btn primary" data-a="endTurn">End Turn ▸</button>`;
    }
  }

  private cardHTML(id: string, o: { sel?: boolean; locked?: boolean; btns?: string; big?: boolean; forHouse?: number; ownsCheck?: boolean } = {}) {
    const c = CARD[id];
    const v = this.session?.view ?? null;
    const me = this.session?.seat ?? null;
    const myHouse = o.forHouse ?? (v && me != null ? v.players[me].house : -1);
    const owns = o.ownsCheck !== false && v && me != null && v.phase !== 'passage' ? ownsHouse(v, me, c.house) : c.house === myHouse;
    const pn = c.passive ? c.passive.n + (c.house === myHouse ? 1 : 0) : 0;
    const an = c.active.n + (c.kind !== 'proctor' && owns ? c.active.bonus : 0);
    const bonusNote = c.active.bonus ? ` <span style="color:var(--gold-dim)">(House ${HOUSES[c.house].name} owners: +${c.active.bonus})</span>` : '';
    const top = c.passive
      ? `<div class="blk ${c.house === myHouse ? 'bonus' : ''}"><span class="k">PASSIVE · AS GENERAL${c.house === myHouse ? ' · ★ +1 HOUSE MATCH' : ''}</span>${esc(fmt(c.passive.text, pn))}</div>`
      : c.kind === 'relic'
        ? `<div class="blk"><span class="k">SIEGE RELIC</span>Only playable during a Siege on Olympus. Tradeable any time.</div>`
        : `<div class="blk"><span class="k">REQUIRES</span>You must own House ${HOUSES[c.house].name}. Otherwise, discard it for 2 cards.</div>`;
    const oly = c.kind === 'proctor' && OLYMPUS_POWER[id] ? `<div class="blk oly"><span class="k">DEFENDING OLYMPUS</span>${esc(OLYMPUS_POWER[id].text)}</div>` : '';
    return `<div class="gcard ${o.sel ? 'sel' : ''} ${o.locked ? 'locked' : ''} ${o.big ? 'big' : ''}" data-card="${id}" style="--hc:${HOUSES[c.house].color}">
      ${c.kind === 'proctor' ? '<span class="badge">PROCTOR</span>' : c.kind === 'relic' ? '<span class="badge">RELIC</span>' : c.active.kind === 'counter' ? '<span class="badge">REACTION</span>' : ''}
      <div class="hdr">${sig(c.house)}<div><div class="nm">${esc(c.name)}</div><div class="tt">${esc(c.title)} · <span style="color:${HOUSES[c.house].color}">${HOUSES[c.house].name}</span></div></div></div>
      ${top}
      <div class="blk act ${owns && c.active.bonus ? 'bonus' : ''}"><span class="k">ACTIVE${owns && c.active.bonus ? ' · HOUSE BONUS' : ''}</span>${esc(fmt(c.active.text, an))}${!owns ? bonusNote : ''}</div>
      ${oly}
      <div class="q">“${esc(c.quote)}”${c.oc ? ' <span title="Original fan character">✦</span>' : ''}</div>
      ${o.btns ?? ''}
    </div>`;
  }

  private renderHand() {
    const v = this.v, u = this.ui;
    const hand = v.me?.hand ?? [];
    const box = document.getElementById('hand')!;
    if (v.phase === 'passage' || !hand.length) { box.innerHTML = ''; return; }
    const draft = this.myTurn() && v.phase === 'draft' && !u.pending;
    box.innerHTML = hand.map((h) => {
      const c = CARD[h.id];
      let btns = '';
      if (draft && !h.locked) {
        const usable = c.active.kind !== 'counter' && (c.kind !== 'proctor' || ownsHouse(v, this.me!, c.house)) && (!isSiegeCard(c) || this.sieging());
        const dud = c.kind === 'proctor' && !ownsHouse(v, this.me!, c.house);
        btns = `<div class="btns">${usable ? `<button class="btn primary" data-a="play" data-id="${h.id}">Play</button>` : ''}${dud ? `<button class="btn" data-a="dud" data-id="${h.id}">Discard +2</button>` : ''}<button class="btn ${u.trade.has(h.id) ? 'gold' : ''}" data-a="tsel" data-id="${h.id}">${u.trade.has(h.id) ? '✓ Trade' : 'Trade'}</button></div>`;
      } else if (h.locked) btns = '<div class="btns"><span class="fine" style="margin:0">Locked until your next turn</span></div>';
      return this.cardHTML(h.id, { sel: u.trade.has(h.id), locked: h.locked, btns });
    }).join('');
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
        <div class="cards-row">${[a, b].map((id) => this.cardHTML(id, { big: true, forHouse: myHouse, ownsCheck: false, btns: `<div class="btns"><button class="btn primary" data-a="choose" data-id="${id}">Walk out with ${esc(CARD[id].name.split(' ')[0])}</button></div>` })).join('')}</div>
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
    const groups = HOUSES.map((h, i) => `<h3 style="font-family:var(--display);color:${h.color};margin:18px 0 6px">${sig(i)} House ${h.name} <span class="fine">· ${QUADRANTS[h.quadrant].name}</span></h3>
      <div class="cards-row" style="justify-content:flex-start;margin:0">${CARDS.filter((c) => c.house === i).map((c) => this.cardHTML(c.id, { forHouse: -1, ownsCheck: false })).join('')}</div>`).join('');
    const html = `<div class="modal"><div class="box" style="width:min(1100px,100%)"><h2>The Codex</h2>
      <p class="fine" style="margin:0">Every card in the deck. A card's suit is its House. Passives only work on your General (+1 if the suit matches your House); Actives are played in the Draft.
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
      ${this.v.phase !== 'over' && this.me != null && this.v.players[this.me].alive ? '<button class="btn" data-a="concede" style="width:100%;margin-bottom:8px">Concede (your House goes neutral)</button>' : ''}
      <button class="btn primary" data-a="title" style="width:100%">Quit to title</button>
    </div></div>`, 'info-menu');
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
    const inc = incoming.map((i) => `<div class="drow">📜 ${sig(v.players[i.from].house)} <b>${esc(v.players[i.from].name)}</b> offers a ${i.public ? 'public' : 'secret'} alliance
      <span class="grow"></span><button class="btn sm primary" data-a="answer" data-id="${i.id}" data-yes="1">Accept</button><button class="btn sm" data-a="answer" data-id="${i.id}" data-yes="0">Burn it</button></div>`).join('');
    const mine = al ? `<div class="dsec"><h3>YOUR ${al.public ? 'PUBLIC ALLIANCE' : 'SECRET PACT'}</h3>
      ${al.members.map((m) => `<div class="drow">${sig(v.players[m].house)} <b>${esc(v.players[m].name)}</b>${m === me ? ' <span class="you">YOU</span>' : ''}<span class="grow"></span>${this.primusHTML(m)}</div>`).join('')}
      ${!al.public ? '<button class="btn sm" data-a="reveal">Reveal the pact to the valley</button>' : ''}</div>` : '';
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
        ${isAlly ? '<span class="ally-tag">ally</span>' : pending ? `<span class="fine" style="margin:0">${pending.public ? 'public' : 'secret'} offer sent…</span>`
          : `<button class="btn sm" data-a="invite" data-seat="${p.seat}" data-pub="1" ${err ? `disabled title="${esc(err)}"` : ''}>Invite · Public</button><button class="btn sm" data-a="invite" data-seat="${p.seat}" data-pub="0" ${err ? `disabled title="${esc(err)}"` : ''}>Invite · Secret</button>`}</div>`;
    }).join('');
    this.modal(`<div class="modal"><div class="box" style="max-width:640px">
      <h2>🤝 Diplomacy</h2>${status}
      ${inc ? `<div class="dsec"><h3>INVITATIONS FOR YOU</h3>${inc}</div>` : ''}
      ${mine}${siege}
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
    if (a === 'invite' || a === 'answer' || a === 'reveal' || a === 'proposeSiege' || a === 'vote') return this.diplo(b);
  }
  private onModalInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'mm') document.getElementById('mmv')!.textContent = t.value;
  }

  private async diplo(b: HTMLElement) {
    const a = b.dataset.a;
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
    if (!this.session?.view || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'g' || e.key === 'G') this.toggleFocus();
    if (e.key === 'o' || e.key === 'O') this.cycleOlympus();
    if (e.key === 'Escape') { this.ui.sel = null; this.ui.target = null; this.ui.pending = null; this.ui.stdMode = false; this.world.clearArrow(); this.render(); }
  }

  private async onHudClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!b || (b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a!, u = this.ui, v = this.v;
    switch (a) {
      case 'menu': return this.modalMenu();
      case 'rules': return this.modalRules();
      case 'codex': return this.modalCodex();
      case 'focus': return this.toggleFocus();
      case 'olympus': return this.cycleOlympus();
      case 'diplo': return this.modalDiplo();
      case 'invite': case 'answer': case 'reveal': case 'proposeSiege': case 'vote': return this.diplo(b);
      case 'tab-roster': u.mobileTab = u.mobileTab === 'roster' ? 'none' : 'roster'; return this.render();
      case 'tab-log': u.mobileTab = u.mobileTab === 'log' ? 'none' : 'log'; return this.render();
      case 'min-roster': if (window.innerWidth > 900) { u.rosterMin = !u.rosterMin; this.render(); } return;
      case 'min-log': if (window.innerWidth > 900) { u.logMin = !u.logMin; this.render(); } return;
      case 'min-gen': u.genMin = !u.genMin; return this.render();
      case 'amt': u.placeAmt = b.dataset.n === 'all' ? 'all' : +b.dataset.n!; return this.render();
      case 'plus': if (u.sel != null) return this.placeOn(u.sel, false); return;
      case 'minus': if (u.sel != null) return this.placeOn(u.sel, true); return;
      case 'undo': return void this.send({ type: 'undoDraft' });
      case 'cancel': u.sel = null; u.target = null; u.pending = null; u.stdMode = false; this.world.clearArrow(); return this.render();
      case 'retarget': u.target = null; this.world.clearArrow(); return this.render();
      case 'tgt': {
        const t = +b.dataset.t!;
        if (u.sel == null) return;
        u.target = t; this.world.arrow(u.sel, t, t === OLYMPUS ? '#f3d27a' : '#ff3b1f');
        return this.render();
      }
      case 'endDraft': u.sel = null; return void this.send({ type: 'endDraft' });
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
      case 'play': {
        const id = b.dataset.id!;
        const kind = CARD[id].active.kind;
        if (kind === 'sabotage' || kind === 'parley' || kind === 'moveStd') { u.pending = { card: id, needs: 'territory' }; return this.render(); }
        if (kind === 'steal') return this.pickRival(id);
        return void this.send({ type: 'play', card: id });
      }
    }
  }

  private onHudInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'commit') { this.ui.commit = +t.value; document.getElementById('commitN')!.textContent = t.value; }
    if (t.dataset.a === 'moveN') { this.ui.moveN = +t.value; document.getElementById('moveNv')!.textContent = t.value; }
  }

  private pickRival(card: string) {
    const v = this.v;
    const rivals = v.players.filter((p) => p.alive && p.seat !== this.me);
    this.modal(`<div class="modal"><div class="box" style="max-width:440px;text-align:center"><h2>Rob whom?</h2>
      ${rivals.map((p) => `<button class="btn" style="width:100%;margin-bottom:8px" data-a="rob" data-seat="${p.seat}">${sig(p.house)} ${esc(p.name)} · ${v.handCounts[p.seat] ?? 0} cards${allied(v, this.me!, p.seat) ? ' (ally)' : ''}</button>`).join('')}
      <button class="btn ghost" data-a="close">Cancel</button></div></div>`, 'info-rob');
    const root = document.getElementById('modal-root')!;
    root.querySelectorAll<HTMLElement>('[data-a=rob]').forEach((btn) => btn.addEventListener('click', async () => {
      this.modal(null);
      await this.send({ type: 'play', card, seat: +btn.dataset.seat! });
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
    if (v.phase === 'draft') {
      if (u.pending?.needs === 'territory') {
        const card = u.pending.card;
        u.pending = null;
        await this.send({ type: 'play', card, t });
        this.render();
        return;
      }
      if (!mine) return this.toast('Reinforce your own land, genius.');
      return this.placeOn(t, this.lastShift);
    }
    if (v.phase === 'attack') {
      if (u.sel != null && u.sel !== t && attackTargets(v, this.me!, u.sel).includes(t)) { u.target = t; this.world.arrow(u.sel, t); }
      else if (mine && v.armies[t] >= 2) { u.sel = t; u.target = null; u.dice = 3; u.commit = v.armies[t] - 1; this.world.clearArrow(); }
      else if (mine) this.toast('Need 2+ armies to attack from there.');
      else if (u.sel != null) this.toast(`${this.tname(t)} isn't touching ${this.tname(u.sel)}. The glowing ones are.`);
      this.render();
      return;
    }
    if (v.phase === 'fortify') {
      if (u.stdMode) {
        u.stdMode = false;
        await this.send({ type: 'moveStd', to: t });
        this.render();
        return;
      }
      if (!mine) return;
      if (u.sel != null && u.sel !== t && connectedOwned(v, this.me!, u.sel).has(t)) { u.target = t; u.moveN = v.armies[u.sel] - 1; }
      else if (v.armies[t] >= 2) { u.sel = t; u.target = null; }
      this.render();
    }
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
        ${std >= 0 ? `<div style="color:var(--gold)">⚑ Standard of House ${HOUSES[std].name}${v.standards[std].guard ? ` · honor guard ${v.standards[std].guard}` : ''}</div>` : ''}`;
    }
    this.tip.style.left = `${Math.min(x + 16, window.innerWidth - 270)}px`;
    this.tip.style.top = `${y + 14}px`;
    this.tip.classList.remove('hidden');
  }

  // =========================================================================
  // event animation

  private processEvents(v: GameState) {
    const maxId = v.log.length ? v.log[v.log.length - 1].id : 0;
    if (this.lastEvent < 0) { this.lastEvent = maxId; return; }
    const fresh = v.log.filter((e) => e.id > this.lastEvent);
    this.lastEvent = maxId;
    for (const e of fresh) {
      if (e.k === 'battle' || e.k === 'stdBattle' || e.k === 'assault') this.animateBattle(v, e);
      if (e.k === 'turn' && e.seat === this.me && this.session?.mode === 'online') this.flashTitle();
      if (e.k === 'invite' && e.to === this.me) this.toast(`📜 ${v.players[e.from].name} whispers an alliance offer. Check 🤝.`);
      if (e.k === 'olympusTurn' && e.killed) this.world.bleed(OLYMPUS, e.killed);
      const hl = headline(v, e);
      if (hl) this.banner(hl.title, hl.sub, hl.color, hl.long);
    }
  }

  private animateBattle(v: GameState, e: GameEvent) {
    const last = e.rolls[e.rolls.length - 1];
    if (!last) return;
    this.diceQueue = this.diceQueue.then(async () => {
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
      await this.dice.roll(last.raw.a, last.raw.d);
      const mods = (raw: number[], mod: number[]) => raw.map((r, i) => (mod[i] !== r ? `${r}<sup>${mod[i] - r > 0 ? '+' : ''}${mod[i] - r}</sup>` : `${r}`)).join(' ');
      const summary = e.k === 'stdBattle'
        ? (e.won ? `<b>VICTORY</b> after ${e.n} rounds · ${e.enslaved} enslaved` : `<b>THE CHARGE DIES</b> after ${e.n} rounds`)
        : olympus
          ? `${e.n > 1 ? `${e.n} rolls · ` : ''}lost <b>${e.aLost}</b> · killed <b>${e.dLost}</b> · ${e.won ? '<b>OLYMPUS FALLS</b>' : `${e.garrison} left`}`
          : `${e.n > 1 ? `${e.n} rolls · ` : ''}lost <b>${e.aLost}</b> · killed <b>${e.dLost}</b>${e.won ? ' · <b>CONQUERED</b>' : ''}`;
      document.getElementById('bRes')!.innerHTML = `<span style="color:#ff8a7a">${mods(last.raw.a, last.a)}</span> vs <span>${mods(last.raw.d, last.d)}</span> · ${summary}`;
      // Blood on both sides of the line.
      this.world.bleed(to, e.dLost ?? 0, !!e.won);
      this.world.bleed(e.from, e.aLost ?? 0);
      const mineHit = (e.seat === this.me && (e.aLost ?? 0) >= 3) || (e.def === this.me && (e.dLost ?? 0) >= 2);
      if (mineHit || (e.won && (e.seat === this.me || e.def === this.me))) this.flashBlood(e.won && e.def === this.me ? 1 : 0.6);
      if (e.won) this.world.burst(to, HOUSES[v.players[e.seat].house].color, e.k !== 'battle');
      this.battleHide = window.setTimeout(() => { box.classList.add('hidden'); if (this.ui.target == null) this.world.clearArrow(); }, 2600);
      await new Promise((r) => setTimeout(r, 350));
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
