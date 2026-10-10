// The war's 3D scene, as the UI knows it. World owns the renderer, the camera, the pointer and the loop, and turns a
// GameState into what the map should show. The valley itself (land, water, Olympus, armies, ships) is built by
// valley.ts, once per map, a stage at a time so the page never freezes while it is made.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HOUSES, type Geo } from '../engine/data.ts';
import type { GameState } from '../engine/engine.ts';
import { CARD } from '../engine/cards.ts';
import { createValley, type GeneralView, type Odds, type Quality, type Valley, type WarView } from './valley.ts';
import { createBoard } from './board.ts';

export const NEUTRAL_COLOR = '#a39a88';
/** Olympus, wherever a territory id is asked for: a pick, an arrow's end, a burst. */
export const OLYMPUS = -2;

export type HighlightKind = 'attack' | 'fortify' | 'place' | 'target' | 'std' | 'assault';
export type OlympusMode = 'solid' | 'ghost' | 'hidden';
export interface HighlightOpts {
  /** Territories you could act from (shown while nothing is selected). */
  sources?: number[];
  /** Draw an arc from the selection to every target. */
  fan?: boolean;
  /** Targets held by an ally: striking them breaks the alliance. */
  warn?: number[];
  /** With `fan`: also an arc to Olympus. */
  olympus?: boolean;
  /** Territories already chosen (a multi-pick). */
  picked?: number[];
  /** The targets are your own land (where armies can go), not somebody else's. */
  own?: boolean;
}
export type { Odds } from './valley.ts';

/** How much the device is asked to draw. `auto` starts from a guess and steps down if frames run slow. */
export type Graphics = 'auto' | 'high' | 'medium' | 'low';
const LEVELS: Record<Exclude<Graphics, 'auto'>, Quality & { ratio: number }> = {
  high: { shadow: 2048, dressing: 1, figureShadows: true, ratio: 2 },
  medium: { shadow: 1024, dressing: 0.6, figureShadows: false, ratio: 1.5 },
  low: { shadow: 0, dressing: 0.35, figureShadows: false, ratio: 1 },
};
const GFX_KEY = 'ic-gfx', GFX_AUTO_KEY = 'ic-gfx-auto';
const MARS = HOUSES.findIndex((h) => h.id === 'mars');

export class World {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  geo: Geo;
  /** A tap or click on the map that was not a drag: a territory, OLYMPUS, or null for empty space. */
  onPick: (t: number | null) => void = () => {};
  /** The pointer is over a territory (a mouse), or a finger has been held on one: x, y in client pixels. */
  onHover: (t: number | null, x: number, y: number) => void = () => {};
  /** Something on the map made a sound: a ship setting sail ('sail'). */
  onSound: (name: string) => void = () => {};

  private layer: HTMLElement;
  private v: Valley | null = null;
  private build = 0;
  private built: Geo | null = null;
  private paused = false;
  private state: GameState | null = null;
  private viewer: number | null = null;
  private glow: { sel: number | null; targets: number[]; kind: HighlightKind; opts: HighlightOpts } = { sel: null, targets: [], kind: 'attack', opts: {} };
  private marks: { seized: { t: number; color: string }[]; storm: number[] } = { seized: [], storm: [] };
  private focusSeat: number | null = null;
  private odds: Record<number, Odds> | null = null;
  private olyMode: OlympusMode = 'solid';
  private reveal = false;
  private insets: [number, number] = [0, 0];
  private speed = 1;
  private gfx: Graphics;
  private level: Exclude<Graphics, 'auto'>;
  private slow = 0;
  private keep: { p: THREE.Vector3; t: THREE.Vector3 } | null = null;
  private last = 0;

  constructor(private container: HTMLElement, geo: Geo) {
    this.geo = geo;
    this.gfx = (localStorage.getItem(GFX_KEY) as Graphics | null) ?? 'auto';
    if (!['auto', 'high', 'medium', 'low'].includes(this.gfx)) this.gfx = 'auto';
    this.level = this.gfx === 'auto' ? this.guess() : this.gfx;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, LEVELS[this.level].ratio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor('#1a1420');
    container.appendChild(this.renderer.domElement);
    this.layer = document.createElement('div');
    this.layer.id = 'plates';
    container.appendChild(this.layer);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxPolarAngle = 1.15;
    this.controls.screenSpacePanning = false;
    // Scroll zooms toward the cursor, left-drag pans, right-drag turns. One finger pans, two pinch and turn.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.zoomToCursor = true;
    this.controls.target.set(0, 0, 1);
    this.camera.position.set(0, 104, 66);
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
    this.ensure();
  }

  // ---------------------------------------------------------------------------
  // building

  /** A first guess at what this device can draw: phones and tablets start a step down. */
  private guess(): Exclude<Graphics, 'auto'> {
    const saved = localStorage.getItem(GFX_AUTO_KEY);
    if (saved === 'high' || saved === 'medium' || saved === 'low') return saved;
    const touch = window.matchMedia?.('(pointer: coarse)').matches, small = Math.min(window.screen.width, window.screen.height) < 820;
    return touch || small ? 'medium' : 'high';
  }

  get graphics(): Graphics { return this.gfx; }
  /** The level in use just now (what `auto` has settled on). */
  get graphicsLevel(): Exclude<Graphics, 'auto'> { return this.level; }
  setGraphics(g: Graphics) {
    this.gfx = g;
    localStorage.setItem(GFX_KEY, g);
    if (g === 'auto') localStorage.removeItem(GFX_AUTO_KEY);
    const level = g === 'auto' ? this.guess() : g;
    if (level !== this.level) this.setLevel(level);
  }
  private setLevel(level: Exclude<Graphics, 'auto'>) {
    this.level = level;
    this.slow = 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, LEVELS[level].ratio));
    this.resize();
    // (a new level means a new valley: it is made where the camera already is, so you keep your place)
    this.keep = { p: this.camera.position.clone(), t: this.controls.target.clone() };
    this.built = null;
    this.ensure();
  }

  /** Make the valley for the current map, unless it is made (or being made) already, or nothing is being shown. */
  private ensure() {
    if (this.paused || this.built === this.geo) return;
    const geo = this.geo, id = ++this.build;
    this.built = geo;
    this.v?.dispose();
    this.v = null;
    this.container.classList.add('building');
    const pause = async (stage: string) => {
      if (id !== this.build) throw new Error('superseded');
      this.container.dataset.stage = stage;
      await new Promise<void>((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });
    };
    // (a Skirmish is fought on a board, not in the valley)
    (geo.skirmish ? createBoard : createValley)({ renderer: this.renderer, camera: this.camera, controls: this.controls, host: this.container, layer: this.layer, geo, quality: LEVELS[this.level], pause, sound: (name) => this.onSound(name) })
      .then((v) => {
        if (id !== this.build) { v.dispose(); return; }
        this.v = v;
        this.sync();
        v.resize(true);
        if (this.keep) { this.camera.position.copy(this.keep.p); this.controls.target.copy(this.keep.t); this.keep = null; }
        this.container.classList.remove('building');
      })
      .catch((e) => {
        if (id !== this.build) return;
        this.container.classList.remove('building');
        console.error('The valley could not be built', e);
      });
  }

  /** Everything the UI has asked for, told again to a valley that has just been made. */
  private sync() {
    const v = this.v;
    if (!v) return;
    v.setOlympus(this.olyMode);
    v.setReveal(this.reveal);
    v.setSpeed(this.speed);
    v.setInsets(...this.insets);
    if (this.state) this.apply(this.state); else v.idle();
    v.setMarks(this.marks.seized, this.marks.storm);
    v.setOdds(this.odds);
    v.setHighlights(this.glow.sel, this.glow.targets, this.glow.kind, this.glow.opts);
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    this.renderer.setAnimationLoop(p ? null : () => this.frame());
    if (!p) { this.last = 0; this.ensure(); }
  }

  /** Show another map. The same Geo object again is a no-op. */
  setGeo(geo: Geo) {
    if (this.geo === geo) return;
    this.geo = geo;
    this.keep = null;
    this.state = null;
    this.glow = { sel: null, targets: [], kind: 'attack', opts: {} };
    this.marks = { seized: [], storm: [] };
    this.odds = null;
    this.camera.position.set(0, 104, 66);
    this.controls.target.set(0, 0, 1);
    this.ensure();
  }

  setOlympusMode(mode: OlympusMode) { this.olyMode = mode; this.v?.setOlympus(mode); }
  get olympusMode(): OlympusMode { return this.olyMode; }

  /** Names of territories, regions and land bridges, for as long as it is on. */
  setReveal(on: boolean) { this.reveal = on; this.v?.setReveal(on); }
  get revealed() { return this.reveal; }

  /** What the HUD covers at the top and bottom of the screen, in pixels. The view centres on what is left. */
  setInsets(top: number, bottom: number) {
    if (this.insets[0] === top && this.insets[1] === bottom) return;
    this.insets = [top, bottom];
    this.v?.setInsets(top, bottom);
  }
  /** How fast marches and crossings play (the war's speed setting). */
  setSpeed(k: number) { this.speed = k; this.v?.setSpeed(k); }

  // ---------------------------------------------------------------------------
  // state → the map

  colorOf(s: GameState, owner: number) {
    return owner >= 0 ? HOUSES[s.players[owner].house].color : NEUTRAL_COLOR;
  }

  /** Whose eyes the map is seen through (their plates are ringed, their near-won regions marked). null: nobody's. */
  setViewer(seat: number | null) {
    if (seat === this.viewer) return;
    this.viewer = seat;
    if (this.state) this.apply(this.state);
  }

  /** No war: the valley as it lies. */
  idle() {
    this.state = null;
    this.focusSeat = null;
    this.odds = null;
    this.v?.idle();
  }

  update(s: GameState) {
    this.state = s;
    this.apply(s);
  }

  private apply(s: GameState) {
    const v = this.v;
    if (!v) return;
    v.apply(this.view(s));
    v.setSiege(s.siege ? s.siege.garrison : null);
    this.applyFocus();
  }

  /** The war in the valley's terms: owners become Houses, and the Keeps that should show a Primus are named. */
  private view(s: GameState): WarView {
    const g = this.geo, house = (seat: number) => (seat >= 0 ? s.players[seat]?.house ?? -1 : -1);
    const generals: GeneralView[] = [];
    HOUSES.forEach((H, h) => {
      const keep = g.keepOf(h), holder = s.owner[keep];
      if (holder == null || holder < 0) return;
      const sworn = s.primus?.[h];
      if (sworn) {
        // a Character sworn in at a conquered Keep: in the colours of whoever holds it now
        generals.push({ t: keep, holder: house(holder), name: CARD[sworn.card]?.name ?? 'Primus', sub: `Sworn in at ${g.territories[keep].name}`, wolf: false });
        return;
      }
      // a House's own Primus stands at its home Keep for as long as the House holds it
      const p = s.players[holder];
      if (p && p.house === h && p.general) generals.push({ t: keep, holder: h, name: CARD[p.general]?.name ?? 'Primus', sub: `Primus of House ${H.name}`, wolf: h === MARS });
    });
    const me = this.viewer ?? s.me?.seat ?? -1;
    const placed: Record<number, number> = {};
    if (s.phase === 'draft') for (const [t, n] of Object.entries(s.ts?.placed ?? {})) if (n) placed[+t] = n as number;
    return {
      owner: s.owner.map(house),
      armies: s.armies,
      me: house(me),
      standards: s.standards.map((st) => ({ at: st.at, taken: st.captured, guard: st.guard ?? 0 })),
      placed,
      generals,
    };
  }

  /** Lasting marks of Ultimates: land seized under a House's pennant, and a quadrant the storm struck. */
  setMarks(seized: { t: number; color: string }[], storm: number[]) {
    this.marks = { seized, storm };
    this.v?.setMarks(seized, storm);
  }

  /** "My Lands" view: everything `seat` doesn't hold goes grey; null turns it off. */
  setFocus(seat: number | null) {
    if (seat === this.focusSeat) return;
    this.focusSeat = seat;
    this.applyFocus();
  }
  private applyFocus() {
    const s = this.state, seat = this.focusSeat;
    this.v?.setDim(s && seat != null ? s.owner.map((o) => o === seat) : null);
  }

  setHighlights(sel: number | null, targets: number[], kind: HighlightKind, opts: HighlightOpts = {}) {
    this.glow = { sel, targets, kind, opts };
    this.v?.setHighlights(sel, targets, kind, opts);
  }
  /** The chance to take each target, shown on its plate (null: none). */
  setOdds(odds: Record<number, Odds> | null) {
    this.odds = odds;
    this.v?.setOdds(odds);
  }

  arrow(from: number, to: number, color = '#ff3b1f') { this.v?.arrow(from, to, color); }
  /** A march over several territories, as far as `stop` (a ring marks where rough ground halts it early). */
  route(path: number[], stop: number, color = '#4fd16b') { this.v?.route(path, stop, color); }
  flash(ts: number[], color = '#ff2a1a', dur = 1400) { this.v?.flash(ts, color, dur); }
  clearArrow() { this.v?.clearArrow(); }
  burst(t: number, color: string, big = false) { this.v?.burst(t, color, big); }
  /** A spray of blood from the fighting at `t`, and a stain that dries over time. */
  bleed(t: number, dead: number, big = false) { this.v?.bleed(t, dead, big); }

  /** The garrison of `from` goes out against `to`: to the border by land, across the lane by sea. Resolves once it is there. */
  sortie(from: number, to: number): Promise<void> { return this.v?.sortie(from, to) ?? Promise.resolve(); }
  /** The fight is over: they go in (`won`) or fall back. `more`: by sea, they stand off the shore for another try. */
  settle(from: number, to: number, won: boolean, more = false): Promise<void> { return this.v?.settle(from, to, won, more) ?? Promise.resolve(); }
  /** A squad walks `path` as far as `stop`, and sails where the way is a sea lane. */
  travel(path: number[], stop: number): Promise<void> { return this.v?.travel(path, stop) ?? Promise.resolve(); }
  bySea(from: number, to: number) { return this.v?.bySea(from, to) ?? false; }

  /** Glide to a territory (or Olympus), keeping the zoom. */
  focus(t: number) { this.v?.glide([t]); }
  /** Glide to the middle of some territories, and come in close if the view is far out. */
  follow(ts: number[]) { this.v?.glide(ts, true); }
  /** Back to the opening view. */
  home() { this.v?.home(); }

  screenPos(t: number): { x: number; y: number } {
    if (this.v) return this.v.screenPos(t);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** What can be heard from where the camera is, each 0 to 1 (all 0 while nothing is shown). */
  ambience() { return (!this.paused && this.v?.ambience()) || { water: 0, falls: 0, oars: 0, frost: 0 }; }
  /** Draw calls and triangles of the last frame. */
  stats() { return this.v?.stats() ?? { calls: 0, triangles: 0 }; }

  // ---------------------------------------------------------------------------
  // the pointer

  private bindPointer() {
    const cv = this.renderer.domElement;
    /** Fingers (or buttons) down just now. A second one makes it a gesture: no pick at its end. */
    const downs = new Map<number, { x: number; y: number }>();
    let first: { id: number; x: number; y: number; button: number; touch: boolean } | null = null;
    let gesture = false, held = false, hold = 0, last = 0, tip = false;
    const pick = (x: number, y: number) => this.v?.pickAt(x, y) ?? null;
    const endHold = () => { clearTimeout(hold); hold = 0; };
    cv.addEventListener('pointerdown', (e) => {
      if (tip) { tip = false; this.onHover(null, 0, 0); }
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (downs.size > 1) { gesture = true; endHold(); return; }
      gesture = false; held = false;
      first = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, touch: e.pointerType !== 'mouse' };
      // A finger held still on a territory asks what it is: the same card a mouse gets by hovering.
      if (first.touch) hold = window.setTimeout(() => {
        hold = 0;
        if (!first || gesture) return;
        const t = pick(first.x, first.y);
        if (t == null) return;
        held = true; tip = true;
        this.onHover(t, first.x, first.y);
      }, 420);
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') {
        if (first && e.pointerId === first.id && Math.hypot(e.clientX - first.x, e.clientY - first.y) > 10) endHold();
        return;
      }
      cv.style.cursor = e.buttons & 1 ? 'grabbing' : e.buttons & 2 ? 'move' : '';
      const now = performance.now();
      if (now - last < 40 || e.buttons) return;
      last = now;
      const t = pick(e.clientX, e.clientY);
      this.v?.setHover(t);
      this.onHover(t, e.clientX, e.clientY);
    });
    const up = (e: PointerEvent, cancelled: boolean) => {
      downs.delete(e.pointerId);
      endHold();
      const f = first;
      if (!f || e.pointerId !== f.id) return;
      first = null;
      // A press that didn't drag the map, wasn't part of a pinch and wasn't held for the card is a pick.
      if (cancelled || gesture || held || f.button !== 0) return;
      if (Math.hypot(e.clientX - f.x, e.clientY - f.y) < (f.touch ? 10 : 7)) this.onPick(pick(e.clientX, e.clientY));
    };
    cv.addEventListener('pointerup', (e) => up(e, false));
    cv.addEventListener('pointercancel', (e) => up(e, true));
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.v?.setHover(null);
      this.onHover(null, 0, 0);
    });
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.v?.resize();
  }

  private frame() {
    const v = this.v;
    if (!v) return;
    v.frame();
    // On `auto`, a device that cannot keep up is asked for less: a second and a half of slow frames steps it down.
    const now = performance.now(), dt = this.last ? now - this.last : 0;
    this.last = now;
    if (this.gfx !== 'auto' || this.level === 'low' || dt > 250) return;
    this.slow = dt > 31 ? this.slow + 1 : Math.max(0, this.slow - 2);
    if (this.slow < 45) return;
    const next = this.level === 'high' ? 'medium' : 'low';
    localStorage.setItem(GFX_AUTO_KEY, next);
    this.setLevel(next);
  }
}
