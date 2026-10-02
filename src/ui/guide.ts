// The Proctor's Guide, DOM half: draws what lessons.ts decides (Read / Your move / Tip / Hint), the spotlight and its
// input blocker, the pulse on real controls, the 🎓 menu and the first-launch chooser. One #guide root on the body.

import {
  GROUPS, closeRecap, closeTip, dismiss, freshRun, pickStep, queueTip, replay, resetSeen, setLevel,
  type Card, type GuideCtx, type GuideState, type GuideView, type Level,
} from './lessons.ts';

export interface GuideHost {
  store: { get(k: string): string | null; set(k: string, v: string): void };
  /** This browser has never played (checked once, before the title screen saves a name). */
  isNew: boolean;
  /** Bring a territory on screen (the host decides whether the camera may move). */
  focus(t: number): void;
  /** A Read card closed: whatever waited on it (replays, local AIs) may go on. */
  onUnblock(): void;
}

const LEVELS: Level[] = ['full', 'hints', 'off'];
const LEVEL_NAME: Record<Level, string> = { full: 'Full', hints: 'Hints', off: 'Off' };
const LEVEL_NOTE: Record<Level, string> = {
  full: 'Step-by-step cards on your turn, and every new mechanic explained.',
  hints: 'A pulse and one line on your turn. New mechanics still explained once.',
  off: 'No guide. Lessons wait in this menu if you want one.',
};
const PIP: Record<Level, string> = { full: 'ON', hints: 'HINT', off: 'OFF' };
const TIP_MS = 6000;
const narrow = () => window.innerWidth <= 900;

/** The first sentence of a card body's first line, for the narrow strip (tags left open are closed by the parser). */
function firstSentence(html: string) {
  let tag = false;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') tag = true;
    else if (ch === '>') tag = false;
    else if (!tag && (ch === '.' || ch === '?' || ch === '!') && (i === html.length - 1 || html[i + 1] === ' ' || html[i + 1] === '<')) return html.slice(0, i + 1);
  }
  return html;
}

export class Guide {
  private st: GuideState;
  private prev: GuideCtx | null = null;
  private last: GuideCtx | null = null;
  private view: GuideView = { card: null, hint: null, tip: null, blocking: false };
  private root: HTMLElement | null = null;
  private returning = false;
  private menuOpen = false;
  private resetAsk = false;
  private more = '';
  private shownCard = '';
  private focused = '';
  private tipTimer = 0;
  private tipShown = '';
  private raf = 0;
  private pulsed: Element[] = [];
  /** A Read card is open and the war waits for it. */
  blocking = false;

  constructor(private host: GuideHost) {
    const raw = host.store.get('ic-tutor');
    let level: Level | null = LEVELS.includes(raw as Level) ? (raw as Level) : null;
    let seen: string[] = [];
    try { const s = JSON.parse(host.store.get('ic-tutor-seen') || '[]'); if (Array.isArray(s)) seen = s.filter((x) => typeof x === 'string'); } catch { /* ignore */ }
    const hints = Math.max(0, Math.floor(+(host.store.get('ic-tutor-hints') || 0) || 0));
    // Players from before .007 start with the guide off, and hear about it once.
    if (level == null && !host.isNew) { level = 'off'; this.returning = true; }
    this.st = { mem: { level, seen, hintsLeft: hints }, run: freshRun() };
    this.save();
    window.addEventListener('pointerdown', (e) => this.onOutside(e), true);
    window.addEventListener('resize', () => this.place());
  }

  get level() { return this.st.mem.level; }
  /** The pip on the 🎓 button: ON, HINT or OFF. */
  get pip() { return PIP[this.st.mem.level ?? 'off']; }

  // ---------------------------------------------------------------- state

  private save() {
    const m = this.st.mem;
    if (m.level) this.host.store.set('ic-tutor', m.level);
    this.host.store.set('ic-tutor-seen', JSON.stringify(m.seen));
    this.host.store.set('ic-tutor-hints', String(m.hintsLeft));
  }
  private commit(st: GuideState) {
    const before = JSON.stringify(this.st.mem);
    this.st = st;
    if (JSON.stringify(st.mem) !== before) this.save();
  }
  /** Re-decide with the last snapshot (after a click in the guide). */
  private refresh() {
    if (this.last) this.update(this.last);
    else this.paint();
  }

  /** Called after every App.render(). */
  update(c: GuideCtx) {
    this.last = c;
    const r = pickStep(c, this.prev, this.st);
    this.prev = c;
    this.commit(r.st);
    this.view = r.view;
    this.paint();
  }

  /** On the first HUD of a session: the returning player's one Tip about 🎓. */
  hudMounted() {
    if (!this.returning) return;
    this.returning = false;
    this.commit(queueTip(this.st, 'new-007'));
  }

  /** A new war (or the title screen): drop this session's progress and every guide element. */
  unmount() {
    this.st = { mem: this.st.mem, run: freshRun() };
    this.prev = null; this.last = null;
    this.view = { card: null, hint: null, tip: null, blocking: false };
    this.menuOpen = false; this.resetAsk = false; this.shownCard = ''; this.focused = ''; this.tipShown = '';
    clearTimeout(this.tipTimer);
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.setPulse([]);
    this.root?.remove(); this.root = null;
    this.blocking = false;
  }

  setLevel(level: Level) {
    this.commit(setLevel(this.st, level));
    this.refresh();
  }

  /** The title screen's buttons wait on this: the first time, a new player picks a level. */
  ensureChosen(): Promise<void> {
    if (this.st.mem.level != null) return Promise.resolve();
    return new Promise((res) => {
      const root = this.ensureRoot();
      root.querySelector('.g-choose')?.remove();
      root.insertAdjacentHTML('beforeend', `<div class="g-choose">
        <div class="g-card read g-welcome" role="dialog" aria-modal="true" aria-label="Choose your guide">
          <div class="g-head"><span class="g-badge read">◼ Read</span><span class="g-step">Asked once</span></div>
          <h4>First time in the Institute?</h4>
          <div class="g-body"><span>A Proctor can point out each step as you play your first war. It takes one turn, and you can turn it off any time with 🎓.</span></div>
          <div class="g-choice">
            <button class="rec" data-level="full"><span class="ct">Guide me</span><span class="cd">Step by step through the first turn, then hints.</span><span class="tag">RECOMMENDED</span></button>
            <button data-level="hints"><span class="ct">Hints only</span><span class="cd">I've played Risk. Just show me what's different.</span></button>
            <button data-level="off"><span class="ct">No guide</span><span class="cd">I'll find my own way. (🎓 brings it back.)</span></button>
          </div>
        </div></div>`);
      const box = root.querySelector<HTMLElement>('.g-choose')!;
      box.querySelector<HTMLElement>('.rec')!.focus();
      box.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-level]');
        if (!b) return;
        box.remove();
        this.commit(setLevel(this.st, b.dataset.level as Level));
        res();
      });
    });
  }

  // ---------------------------------------------------------------- input

  /** App.onKey hands keys here first. True when the guide used (or swallowed) the key. */
  onKey(e: KeyboardEvent): boolean {
    if (!document.getElementById('hud')) return false;
    const k = e.key;
    if ((k === 't' || k === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) { this.toggleMenu(); return true; }
    if (k === 'Escape' && this.menuOpen) { this.closeMenu(); return true; }
    const c = this.view.card;
    if (c?.kind === 'read' && (k === 'Enter' || k === ' ')) {
      // A focused button or fold answers Enter itself.
      if ((e.target as HTMLElement)?.closest?.('button, summary, input, textarea, select, a')) return false;
      e.preventDefault();
      this.got();
      return true;
    }
    // Under a Read dim, only the guide (and M for mute) answer.
    return this.blocking && k !== 'm' && k !== 'M';
  }

  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    this.resetAsk = false;
    this.paint();
  }
  private closeMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.paint();
  }
  private onOutside(e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (this.menuOpen && !t.closest?.('.g-menu, [data-a=guide], .g-cap')) this.closeMenu();
    // Any click sends a Tip away (unless it's pinned to its UI, or the click is on the Tip itself).
    const tip = this.view.tip;
    if (tip && !tip.pinned && !t.closest?.('.g-tip')) this.dropTip(tip.id);
  }
  private dropTip(id: string) {
    clearTimeout(this.tipTimer);
    this.tipShown = '';
    this.commit(closeTip(this.st, id));
    this.refresh();
  }
  private got() {
    const c = this.view.card;
    if (!c) return;
    this.commit(c.recap ? closeRecap(this.st, false) : dismiss(this.st, c.id));
    this.refresh();
  }

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
    if (!b) return;
    const g = b.dataset.g!;
    const c = this.view.card;
    if (g === 'got' || g === 'skip') return this.got();
    if (g === 'keep' && c?.recap) { this.commit(closeRecap(this.st, true)); return this.refresh(); }
    if (g === 'more') { this.more = this.more === c?.id ? '' : c?.id ?? ''; return this.paint(true); }
    if (g === 'tipx' && this.view.tip) return this.dropTip(this.view.tip.id);
    if (g === 'quiz') {
      const box = b.closest('.g-quiz')!;
      const right = b.dataset.v === 'you';
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('gold', x === b));
      const fb = box.querySelector<HTMLElement>('.fb')!;
      fb.className = `fb ${right ? 'ok' : 'no'}`;
      fb.textContent = (right ? fb.dataset.ok : fb.dataset.no) ?? '';
      return;
    }
    if (g === 'cap') return this.toggleMenu();
    if (g === 'level') return this.setLevel(b.dataset.v as Level);
    if (g === 'replay') { this.commit(replay(this.st, GROUPS[+b.dataset.i!].ids)); this.menuOpen = false; return this.refresh(); }
    if (g === 'reset') { this.resetAsk = true; return this.paint(); }
    if (g === 'reset-no') { this.resetAsk = false; return this.paint(); }
    if (g === 'reset-yes') { this.resetAsk = false; this.commit(resetSeen(this.st)); return this.refresh(); }
  }

  // ---------------------------------------------------------------- drawing

  private ensureRoot() {
    if (this.root?.isConnected) return this.root;
    this.root = document.createElement('div');
    this.root.id = 'guide';
    this.root.innerHTML = '<div class="g-blocker hidden"></div><div class="g-spot hidden"></div><div class="g-dim hidden"></div>';
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    const blk = this.root.querySelector('.g-blocker')!;
    for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) blk.addEventListener(ev, stop);
    blk.addEventListener('wheel', stop, { passive: false });
    this.root.addEventListener('click', (e) => this.onClick(e));
    document.body.appendChild(this.root);
    return this.root;
  }

  private cardHTML(c: Card) {
    const read = c.kind === 'read';
    const docked = read && !this.view.blocking && !c.recap;
    const short = narrow() && this.more !== c.id;
    let body = c.body;
    if (narrow()) {
      const tmp = document.createElement('div');
      tmp.innerHTML = c.body;
      const first = tmp.firstElementChild;
      const extra = tmp.children.length > 1 || (first && firstSentence(first.innerHTML) !== first.innerHTML);
      if (short && first) body = `<span>${firstSentence(first.innerHTML)}</span>`;
      if (extra) body += `<button class="g-more" data-g="more">${short ? 'More' : 'Less'}</button>`;
    }
    const prog = c.prog ? `<div class="g-prog"><div class="bar"><i style="width:${(100 * c.prog.n) / Math.max(1, c.prog.of)}%"></i></div><span>${c.prog.label}</span></div>` : '';
    const kbd = '<span class="g-kbd">↵</span>';
    const foot = c.recap
      ? `<button class="g-skip" data-g="keep">Keep the full guide</button><button class="btn gold sm" data-g="got">${c.cta}${kbd}</button>`
      : read
        ? `${docked ? '<span></span>' : '<span class="g-wait read">⏸ The war waits for you</span>'}<button class="btn gold sm" data-g="got">${c.cta ?? 'Got it ▸'}${kbd}</button>`
        : `<span class="g-wait do"><i class="g-dot"></i>${c.wait ?? ''}</span><button class="g-skip" data-g="skip">Skip</button>`;
    return `<div class="g-head"><span class="g-badge ${read ? 'read' : 'do'}">${read ? '◼ Read' : '▶ Your move'}</span><span class="g-step">${c.step}</span></div>
      <h4>${c.title}</h4><div class="g-body">${body}</div>${prog}<div class="g-foot">${foot}</div>`;
  }

  private setPulse(selectors: string[]) {
    const now = selectors.flatMap((s) => [...document.querySelectorAll(s)]);
    for (const x of this.pulsed) if (!now.includes(x)) x.classList.remove('g-pulse');
    for (const x of now) x.classList.add('g-pulse');
    this.pulsed = now;
  }

  private paint(force = false) {
    const v = this.view;
    const anything = v.card || v.hint || v.tip || this.menuOpen;
    if (!anything && !this.root) { this.setBlocking(false); this.setPulse([]); return; }
    const root = this.ensureRoot();

    // The card.
    const c = v.card;
    let card = root.querySelector<HTMLElement>(':scope > .g-card');
    if (!c) { card?.remove(); this.shownCard = ''; }
    else {
      const key = `${c.id}|${v.blocking}`;
      const fresh = !card || card.dataset.id !== key;
      if (fresh) {
        card?.remove();
        card = document.createElement('div');
        card.dataset.id = key;
        root.appendChild(card);
      }
      const read = c.kind === 'read';
      card!.className = `g-card ${read ? 'read' : 'do'} ${c.recap ? 'g-recap' : ''} ${read && v.blocking && !c.recap ? 'spotted' : 'docked'}`;
      card!.setAttribute('role', read ? 'dialog' : 'status');
      if (read) { card!.setAttribute('aria-label', c.title); card!.removeAttribute('aria-live'); } else card!.setAttribute('aria-live', 'polite');
      const html = this.cardHTML(c);
      if (html !== card!.dataset.html || force) {
        // Keep folds open across redraws (the place lesson redraws on every army).
        const open = [...card!.querySelectorAll('details')].map((d) => d.open);
        const quiz = card!.querySelector('.g-quiz')?.innerHTML;
        card!.innerHTML = html;
        card!.dataset.html = html;
        card!.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
        if (quiz && !fresh) card!.querySelector('.g-quiz')!.innerHTML = quiz;
      }
      if (c.id !== this.shownCard) {
        this.shownCard = c.id;
        if (read) card!.querySelector<HTMLElement>('[data-g=got]')?.focus({ preventScroll: true });
      }
      const fk = `${c.id}:${c.focus ?? ''}`;
      if (c.focus != null && fk !== this.focused) this.host.focus(c.focus);
      this.focused = fk;
    }

    // The hint pill.
    let hint = root.querySelector<HTMLElement>(':scope > .g-hint');
    if (!v.hint) hint?.remove();
    else {
      if (!hint) { hint = document.createElement('div'); hint.className = 'g-hint'; hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite'); root.appendChild(hint); }
      const h = `<span class="g-badge do">▶</span>${v.hint.text}`;
      if (hint.innerHTML !== h) hint.innerHTML = h;
    }

    // The Tip.
    let tip = root.querySelector<HTMLElement>(':scope > .g-tip');
    if (!v.tip) { tip?.remove(); this.tipShown = ''; clearTimeout(this.tipTimer); }
    else if (this.tipShown !== v.tip.id || !tip) {
      tip?.remove();
      tip = document.createElement('div');
      tip.className = 'g-tip';
      tip.setAttribute('role', 'status');
      tip.innerHTML = `<div class="tr"><span class="g-badge g-t">Tip</span><span class="g-wait g-t">No action needed</span><button class="x" data-g="tipx" aria-label="Dismiss">✕</button></div>
        <p>${v.tip.html}</p>${v.tip.pinned ? '' : '<i class="g-timer"></i>'}`;
      root.appendChild(tip);
      this.tipShown = v.tip.id;
      clearTimeout(this.tipTimer);
      if (!v.tip.pinned) { const id = v.tip.id; this.tipTimer = window.setTimeout(() => { if (this.view.tip?.id === id) this.dropTip(id); }, TIP_MS); }
    }

    // The 🎓 menu, and the pip on its button.
    this.paintMenu(root);
    const btn = document.getElementById('btnGuide');
    const lv = this.st.mem.level ?? 'off';
    if (btn) {
      btn.classList.toggle('off', lv === 'off');
      const pip = btn.querySelector('.g-pip');
      if (pip && pip.textContent !== PIP[lv]) pip.textContent = PIP[lv];
    }

    this.setPulse([...(c?.pulse ?? []), ...(v.hint?.pulse ?? []), ...(v.tip?.pulse ?? [])]);
    this.setBlocking(v.blocking);
    this.place();
    // Read steps follow the HUD as it reflows.
    if ((v.card || v.hint || v.tip || this.menuOpen) && !this.raf) {
      const loop = () => { this.place(); this.raf = this.view.card || this.view.hint || this.view.tip || this.menuOpen ? requestAnimationFrame(loop) : 0; };
      this.raf = requestAnimationFrame(loop);
    }
  }

  private paintMenu(root: HTMLElement) {
    let m = root.querySelector<HTMLElement>(':scope > .g-menu');
    if (!this.menuOpen || !document.getElementById('hud')) { m?.remove(); this.menuOpen = this.menuOpen && !!document.getElementById('hud'); return; }
    const lv = this.st.mem.level ?? 'off';
    const seen = this.st.mem.seen;
    const html = `<h4>THE PROCTOR'S GUIDE</h4>
      <div class="seg">${LEVELS.map((k) => `<button data-g="level" data-v="${k}" class="${lv === k ? 'on' : ''}" aria-pressed="${lv === k}">${LEVEL_NAME[k]}</button>`).join('')}</div>
      <div class="lvl-note">${LEVEL_NOTE[lv]}</div>
      <div class="ls">${GROUPS.map((g, i) => {
        const done = g.ids.every((id) => seen.includes(id));
        return `<div><span class="s ${done ? '' : 'no'}">${done ? '✓' : '○'}</span><span>${g.name}</span>${done ? `<button data-g="replay" data-i="${i}">Replay</button>` : '<span class="g-fine">not yet</span>'}</div>`;
      }).join('')}</div>
      <div class="ft"><span>Press <span class="g-kbd">T</span> to open</span>${this.resetAsk
        ? '<span class="g-ask">Reset every lesson? <button class="g-skip" data-g="reset-yes">Reset</button> <button class="g-skip" data-g="reset-no">Cancel</button></span>'
        : '<button class="g-skip" data-g="reset">Reset all lessons</button>'}</div>`;
    if (!m) { m = document.createElement('div'); m.className = 'g-menu'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', "The Proctor's Guide"); root.appendChild(m); }
    if (m.dataset.html !== html) { m.innerHTML = html; m.dataset.html = html; }
  }

  private setBlocking(on: boolean) {
    const was = this.blocking;
    this.blocking = on;
    if (this.root) {
      this.root.querySelector('.g-blocker')!.classList.toggle('hidden', !on);
      let cap = this.root.querySelector<HTMLElement>(':scope > .g-cap');
      // 🎓 stays lit and clickable above the dim.
      if (on && document.getElementById('btnGuide')) {
        if (!cap) { cap = document.createElement('button'); cap.className = 'icon-btn g-cap'; cap.dataset.g = 'cap'; cap.title = "The Proctor's Guide (T)"; this.root.appendChild(cap); }
        const src = document.getElementById('btnGuide')!;
        if (cap.innerHTML !== src.innerHTML) cap.innerHTML = src.innerHTML;
        cap.classList.toggle('off', src.classList.contains('off'));
      } else cap?.remove();
    }
    if (was && !on) this.host.onUnblock();
  }

  /** Lay out the spotlight, cards, hint, tip and menu against the live HUD. */
  private place() {
    const root = this.root;
    if (!root) return;
    const W = window.innerWidth, H = window.innerHeight;
    const dock = document.querySelector('#hud .dock');
    const dockTop = dock && dock.getBoundingClientRect().height > 0 ? dock.getBoundingClientRect().top : H - 10;
    const above = Math.max(12, H - dockTop + 12);
    const v = this.view;
    const spot = root.querySelector<HTMLElement>('.g-spot')!, dim = root.querySelector<HTMLElement>('.g-dim')!;
    const card = root.querySelector<HTMLElement>(':scope > .g-card');
    const c = v.card;
    let rect: { l: number; t: number; r: number; b: number } | null = null;
    if (c && v.blocking && c.spot && !c.recap) {
      for (const s of c.spot) for (const e of document.querySelectorAll(s)) {
        const q = e.getBoundingClientRect();
        if (!q.width || !q.height) continue;
        rect = rect ? { l: Math.min(rect.l, q.left), t: Math.min(rect.t, q.top), r: Math.max(rect.r, q.right), b: Math.max(rect.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom };
      }
    }
    if (rect) {
      const p = 6;
      rect = { l: rect.l - p, t: rect.t - p, r: rect.r + p, b: rect.b + p };
      Object.assign(spot.style, { left: `${rect.l}px`, top: `${rect.t}px`, width: `${rect.r - rect.l}px`, height: `${rect.b - rect.t}px` });
    }
    spot.classList.toggle('hidden', !rect);
    // No target found (or the recap): dim everything and center the card.
    dim.classList.toggle('hidden', !(c && v.blocking && !rect));

    if (card && c) {
      const read = c.kind === 'read';
      card.style.left = card.style.right = card.style.top = card.style.bottom = '';
      if (narrow() && !c.recap) {
        Object.assign(card.style, { left: '16px', right: '16px', width: 'auto', bottom: `${above}px` });
      } else if (read && (v.blocking || c.recap)) {
        const w = Math.min(c.width ?? 360, W - 32);
        card.style.width = `${w}px`;
        const h = card.offsetHeight;
        let x = (W - w) / 2, y = (H - h) / 2;
        if (rect && !c.recap) {
          const gap = 14;
          const cx = Math.max(16, Math.min(W - w - 16, (rect.l + rect.r) / 2 - w / 2));
          if (rect.b + gap + h <= H - 8) { x = cx; y = rect.b + gap; }
          else if (rect.t - gap - h >= 8) { x = cx; y = rect.t - gap - h; }
          else if (rect.r + gap + w <= W - 8) { x = rect.r + gap; y = Math.max(8, Math.min(H - h - 8, (rect.t + rect.b) / 2 - h / 2)); }
          else if (rect.l - gap - w >= 8) { x = rect.l - gap - w; y = Math.max(8, Math.min(H - h - 8, (rect.t + rect.b) / 2 - h / 2)); }
          else { x = cx; y = H - h - 8; }
        }
        Object.assign(card.style, { left: `${Math.max(8, x)}px`, top: `${Math.max(8, Math.min(H - h - 8, y))}px` });
      } else {
        // Your move (and a Read in a timed war): docked bottom-right, just above the dock.
        Object.assign(card.style, { right: '10px', width: `${read ? 320 : 260}px`, bottom: `${above}px` });
      }
    }
    const hint = root.querySelector<HTMLElement>(':scope > .g-hint');
    if (hint) hint.style.bottom = `${above}px`;
    const tip = root.querySelector<HTMLElement>(':scope > .g-tip');
    if (tip) {
      const top = document.getElementById('topbar')?.getBoundingClientRect();
      tip.style.top = `${(top && top.height ? top.bottom : 50) + 10}px`;
    }
    const cap = root.querySelector<HTMLElement>(':scope > .g-cap'), btn = document.getElementById('btnGuide');
    const br = btn?.getBoundingClientRect();
    if (cap && br) Object.assign(cap.style, { left: `${br.left}px`, top: `${br.top}px`, width: `${br.width}px`, height: `${br.height}px` });
    const menu = root.querySelector<HTMLElement>(':scope > .g-menu');
    if (menu && br) {
      const w = Math.min(330, W - 16);
      menu.style.width = `${w}px`;
      menu.style.left = `${Math.max(8, Math.min(W - w - 8, br.left - w / 2 + br.width / 2))}px`;
      menu.style.top = `${br.bottom + 10}px`;
    }
  }
}
