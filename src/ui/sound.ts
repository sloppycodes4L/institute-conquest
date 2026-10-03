// The game's sound: a soundtrack that follows the war's mood, and effects for what happens on the map.
// Files come from public/audio (built by scripts/audio-build.ts from the local library). A sound with no file
// yet borrows another one or is synthesized (steel, dice, marching feet), so nothing ever waits on a download
// or an API. Everything stays silent until the first click or key press, as browsers require.

import { MUSIC, SFX_TAKES, type Mood } from './audio-manifest.ts';
import { HORN_END, hornCall } from './horn.ts';

export type { Mood };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const url = (p: string) => new URL(`audio/${p}`, document.baseURI).href;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** How loud each sound sits in the mix (before the Effects slider). */
const LEVEL: Record<string, number> = {
  click: 0.22, confirm: 0.45, cue: 0.5, dread: 0.55, thud: 0.4, grunt: 0.45, scream: 0.45, boom: 0.5, whoosh: 0.45,
  drum: 0.7, thunder: 0.55, rumble: 0.55, chaos: 0.4, nature: 0.2, clash: 0.55, dice: 0.5, horn: 0.5, warcry: 0.45,
  march: 0.5, card: 0.5, wind: 0.15, shout: 0.5,
};
/** A sound with no file borrows another. */
const STAND_IN: Record<string, string> = { horn: 'drum', warcry: 'chaos', card: 'whoosh', shout: 'warcry' };
/** Musical sounds keep their pitch; the rest vary a little each time so repeats don't sound canned. */
const STEADY = new Set(['cue', 'dread', 'horn', 'drum', 'nature', 'wind', 'confirm']);
/** Below this the music swaps between calm and tense only after the current piece has had its say. */
const SOFT_DWELL_MS = 40_000;
const MUSIC_LEVEL = 0.5;

// ---------------------------------------------------------------------------
// synthesized stand-ins

type Synth = (c: AudioContext, out: AudioNode, t: number, level: number) => void;

function noise(c: AudioContext, secs: number, shape: (x: number) => number) {
  const len = Math.max(1, Math.floor(c.sampleRate * secs));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * shape(i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Struck steel: ringing inharmonic partials plus a short scrape. */
function strike(c: AudioContext, out: AudioNode, t: number, pitch: number, level: number) {
  // Struck steel rings at inharmonic ratios, the high ones dying fastest.
  [1, 2.76, 5.4, 8.93, 13.34].forEach((r, k) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = pitch * r * (1 + (Math.random() - 0.5) * 0.01);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level / (k + 1), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 / (1 + k * 0.45));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.2);
  });
  // The scrape of blade on blade: a burst of bright noise.
  const src = noise(c, 0.14, (x) => 1 - x);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(5200, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(level * 0.9, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

/** One knock of bone on wood. */
function clack(c: AudioContext, out: AudioNode, t: number, level: number) {
  const src = noise(c, 0.03, (x) => (1 - x) ** 3);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = rnd(1800, 3200);
  bp.Q.value = 3;
  const g = c.createGain();
  g.gain.value = level;
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

/** A soft footfall: a low thump with a little jingle of kit. */
function step(c: AudioContext, out: AudioNode, t: number, level: number) {
  const src = noise(c, 0.09, (x) => (1 - x) ** 2);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = rnd(260, 380);
  const g = c.createGain();
  g.gain.value = level * 2.2;
  src.connect(lp).connect(g).connect(out);
  src.start(t);
  const j = noise(c, 0.05, (x) => (1 - x) ** 4);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const jg = c.createGain();
  jg.gain.value = level * 0.25;
  j.connect(hp).connect(jg).connect(out);
  j.start(t + 0.01);
}

const SYNTH: Record<string, Synth> = {
  clash: (c, out, t, l) => strike(c, out, t, rnd(560, 780), l * 0.8),
  dice: (c, out, t, l) => {
    // Tumbling: the knocks come quicker, then slow and soften as the dice settle.
    let at = t;
    for (let k = 0; k < 11; k++) {
      clack(c, out, at, l * (1 - k / 13) * rnd(0.6, 1));
      if (Math.random() < 0.5) clack(c, out, at + 0.012, l * 0.4);
      at += 0.035 + k * 0.012 + Math.random() * 0.02;
    }
  },
  march: (c, out, t, l) => { for (let k = 0; k < 6; k++) step(c, out, t + k * 0.29 + Math.random() * 0.02, l * (k % 2 ? 0.8 : 1)); },
  tick: (c, out, t, l) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 1900;
    const g = c.createGain();
    g.gain.setValueAtTime(l * 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.02);
  },
  deny: (c, out, t, l) => {
    for (const [dt, f] of [[0, 150], [0.11, 115]]) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f, t + dt);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + dt + 0.12);
      const g = c.createGain();
      g.gain.setValueAtTime(l * 0.7, t + dt);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.13);
      o.connect(g).connect(out);
      o.start(t + dt);
      o.stop(t + dt + 0.15);
    }
  },
};
LEVEL.tick = 1;
LEVEL.deny = 0.5;

// ---------------------------------------------------------------------------

export interface PlayOpts {
  /** Multiplies the sound's mix level. */
  vol?: number;
  /** Seconds from now. Delayed sounds skip the repeat guard (they're deliberate bursts). */
  delay?: number;
  /** Playback rate (pitch); defaults to a small random variation. */
  rate?: number;
}

type Track = { el: HTMLAudioElement; gain: GainNode; node: MediaElementAudioSourceNode; t: (typeof MUSIC)[number]; started: number };

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private lastAt = new Map<string, number>();
  private lastTake = new Map<string, number>();
  private voices = 0;
  private track: Track | null = null;
  private want: Mood | null = null;
  /** After a track fails to load, wait before trying another. */
  private retryAt = 0;
  private bags = new Map<Mood, number[]>();
  private amb = { on: false, timer: 0, loop: null as AudioBufferSourceNode | null };

  musicVol = +(store.get('ic-vol-music') ?? 0.6);
  sfxVol = +(store.get('ic-vol-sfx') ?? 0.8);
  /** Sound starts off: the player turns it on with the Sound checkbox (or M). A new key, so everyone starts silent once. */
  muted = store.get('ic-sound-on') !== '1';
  private onMute = new Set<() => void>();
  /** Called whenever sound is switched on or off, so every switch on screen can follow. */
  listen(f: () => void) { this.onMute.add(f); }

  constructor() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true });
  }

  /** Called on every user gesture: the first one creates the audio graph, later ones revive a suspended context. */
  private unlock() {
    try {
      if (!this.ctx) {
        const c = new AudioContext();
        this.ctx = c;
        this.master = c.createGain();
        this.master.connect(c.destination);
        this.musicBus = c.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus = c.createGain();
        this.sfxBus.connect(this.master);
        this.applyVolumes();
        // Effects are small (well under a megabyte): fetch them all now so the first battle isn't silent.
        for (const [name, n] of Object.entries(SFX_TAKES)) for (let i = 1; i <= n; i++) void this.buffer(`${name}-${i}`);
        // Render the turn horn ahead of time, so the first one doesn't stutter.
        setTimeout(() => this.hornBuffer(c), 400);
        c.addEventListener('statechange', () => { if (c.state === 'running') { this.syncMusic(); this.syncAmbience(); } });
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
      else { this.syncMusic(); this.syncAmbience(); }
    } catch { /* no audio here */ }
  }

  private running() { return this.ctx?.state === 'running' ? this.ctx : null; }

  // --- volumes -----------------------------------------------------------

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Squared: sliders feel even to the ear.
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVol ** 2 * MUSIC_LEVEL, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.sfxVol ** 2, t, 0.05);
  }
  setMusic(v: number) { this.musicVol = v; store.set('ic-vol-music', String(v)); this.applyVolumes(); this.syncMusic(); }
  setSfx(v: number) { this.sfxVol = v; store.set('ic-vol-sfx', String(v)); this.applyVolumes(); }
  setMuted(m: boolean) {
    this.muted = m;
    store.set('ic-sound-on', m ? '0' : '1');
    this.applyVolumes();
    this.syncMusic();
    this.syncAmbience();
    this.onMute.forEach((f) => f());
  }

  // --- effects -----------------------------------------------------------

  private buffer(key: string) {
    let p = this.buffers.get(key);
    if (!p) {
      p = fetch(url(`sfx/${key}.mp3`))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(key, p);
    }
    return p;
  }

  play(name: string, o: PlayOpts = {}): void {
    const c = this.running();
    if (!c || this.muted || this.sfxVol === 0) return;
    const delay = o.delay ?? 0;
    const now = performance.now();
    // A catch-up after a skipped replay can fire dozens of events at once: one of each is plenty.
    if (!delay && now - (this.lastAt.get(name) ?? -1e9) < 90) return;
    this.lastAt.set(name, now);
    if (this.voices > 16) return;
    const level = (LEVEL[name] ?? 0.5) * (o.vol ?? 1);
    const takes = SFX_TAKES[name] ?? 0;
    if (!takes) {
      if (STAND_IN[name]) return this.play(STAND_IN[name], { ...o, vol: (o.vol ?? 1) * (LEVEL[name] ?? 0.5) / (LEVEL[STAND_IN[name]] ?? 0.5) });
      SYNTH[name]?.(c, this.sfxBus, c.currentTime + delay, level);
      return;
    }
    let take = 1 + Math.floor(Math.random() * takes);
    if (takes > 1 && take === this.lastTake.get(name)) take = (take % takes) + 1;
    this.lastTake.set(name, take);
    void this.buffer(`${name}-${take}`).then((buf) => {
      // Too late to still mean anything (a slow first load): drop it.
      if (!buf || performance.now() - now > 400) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = o.rate ?? (STEADY.has(name) ? 1 : rnd(0.94, 1.06));
      const g = c.createGain();
      g.gain.value = level;
      src.connect(g).connect(this.sfxBus);
      this.voices++;
      src.onended = () => { this.voices--; g.disconnect(); };
      src.start(c.currentTime + delay);
    });
  }

  private horn: AudioBuffer | null = null;
  private hornBuffer(c: AudioContext) {
    if (!this.horn) {
      const data = hornCall(c.sampleRate);
      this.horn = c.createBuffer(1, data.length, c.sampleRate);
      this.horn.getChannelData(0).set(data);
    }
    return this.horn;
  }

  /**
   * "Your turn": the war horn's call (synthesized, see horn.ts), and the men shouting back. It skips the Effects
   * slider's low end, so it's never lost: it's the one sound you must hear.
   */
  chime() {
    const c = this.running();
    if (!c || this.muted) return;
    const out = c.createGain();
    out.gain.value = 0.55 * Math.max(this.sfxVol, 0.35);
    out.connect(this.master);
    const t = c.currentTime + 0.03;
    const src = c.createBufferSource();
    src.buffer = this.hornBuffer(c);
    src.connect(out);
    src.start(t);
    // The shout (or its stand-in), right as the last note dies.
    const name = SFX_TAKES.shout ? 'shout' : SFX_TAKES.warcry ? 'warcry' : null;
    if (name) {
      const take = 1 + Math.floor(Math.random() * SFX_TAKES[name]);
      void this.buffer(`${name}-${take}`).then((buf) => {
        if (!buf) return;
        const s = c.createBufferSource();
        s.buffer = buf;
        const g = c.createGain();
        g.gain.value = name === 'shout' ? 0.8 : 0.45;
        s.connect(g).connect(out);
        s.start(Math.max(c.currentTime, t + HORN_END - 0.1));
      });
    }
    setTimeout(() => out.disconnect(), 5000);
  }

  /** The Sorting wheel: one tick per wedge passing the pointer, slowing with the wheel (an ease-out over `ms`). */
  spin(ms: number, degrees: number, seg: number): () => void {
    const c = this.running();
    if (!c || this.muted || this.sfxVol === 0) return () => {};
    const out = c.createGain();
    out.connect(this.sfxBus);
    const n = Math.floor(degrees / seg);
    const t0 = c.currentTime + 0.02;
    let lastAt = -1;
    for (let k = 1; k <= n; k++) {
      // Wheel progress p(t) ≈ 1 − (1 − t)³, so the k-th wedge passes at t = 1 − (1 − k/n)^(1/3).
      const at = (1 - Math.cbrt(1 - k / n)) * (ms / 1000);
      if (at - lastAt < 0.03) continue;
      lastAt = at;
      SYNTH.tick(c, out, t0 + at, 0.9);
    }
    return () => { out.gain.setValueAtTime(0, c.currentTime); setTimeout(() => out.disconnect(), 50); };
  }

  // --- music -------------------------------------------------------------

  /** Ask for a mood; cheap to call often (the app calls it every tick). */
  mood(m: Mood) {
    this.want = m;
    if (this.track ? this.track.t.mood !== m : performance.now() > this.retryAt) this.syncMusic();
  }

  /** The next piece for a mood: a shuffled bag, so every piece plays before any repeats. */
  private next(m: Mood) {
    let bag = this.bags.get(m);
    if (!bag?.length) {
      bag = MUSIC.map((t, i) => (t.mood === m ? i : -1)).filter((i) => i >= 0).sort(() => Math.random() - 0.5);
      // Don't open the new bag with the piece that just ended.
      if (bag.length > 1 && MUSIC[bag[0]] === this.track?.t) bag.push(bag.shift()!);
      this.bags.set(m, bag);
    }
    return MUSIC[bag.shift()!];
  }

  private syncMusic(advance = false) {
    const c = this.running();
    const off = this.muted || this.musicVol === 0;
    if (off) { this.fadeOut(this.track, 0.6); this.track = null; return; }
    if (!c || !this.want) return;
    const cur = this.track;
    if (cur && cur.t.mood === this.want && !advance) return;
    const soft = (m: Mood) => m === 'calm' || m === 'tense';
    if (cur && !advance && soft(cur.t.mood) && soft(this.want) && performance.now() - cur.started < SOFT_DWELL_MS) return;
    if (!MUSIC.some((t) => t.mood === this.want)) return;
    const t = this.next(this.want);
    // Into battle: start just before the track's build, so its climax lands on the fighting.
    const from = this.want === 'battle' && t.ramp != null && t.ramp < t.dur - 40 ? Math.max(0, t.ramp - 2) : 0;
    const el = new Audio(url(`music/${t.file}`) + (from ? `#t=${from.toFixed(1)}` : ''));
    el.preload = 'auto';
    const node = c.createMediaElementSource(el);
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    node.connect(gain).connect(this.musicBus);
    const fade = this.want === 'battle' || this.want === 'victory' || this.want === 'defeat' ? 1.2 : 3;
    const track: Track = { el, gain, node, t, started: performance.now() };
    const onward = () => { if (this.track === track) this.syncMusic(true); };
    el.addEventListener('timeupdate', () => { if (el.currentTime > t.dur - 3.5) onward(); });
    el.addEventListener('ended', onward);
    el.addEventListener('error', () => { if (this.track === track) { this.track = null; this.retryAt = performance.now() + 10_000; } });
    void el.play().then(() => gain.gain.setTargetAtTime(1, c.currentTime, fade / 3)).catch(() => {});
    this.fadeOut(cur, fade);
    this.track = track;
  }

  private fadeOut(tr: Track | null, secs: number) {
    if (!tr) return;
    const c = this.ctx!;
    tr.gain.gain.cancelScheduledValues(c.currentTime);
    tr.gain.gain.setTargetAtTime(0, c.currentTime, secs / 3);
    setTimeout(() => { tr.el.pause(); tr.el.removeAttribute('src'); tr.el.load(); tr.node.disconnect(); tr.gain.disconnect(); }, secs * 1000 + 400);
  }

  // --- ambience ----------------------------------------------------------

  /** The valley between the music's phrases: wind (once ElevenLabs makes it) and now and then a far-off animal. */
  ambience(on: boolean) {
    if (on === this.amb.on) return;
    this.amb.on = on;
    this.syncAmbience();
  }

  private syncAmbience() {
    const c = this.running();
    const live = this.amb.on && !!c && !this.muted;
    if (!live) {
      clearTimeout(this.amb.timer);
      this.amb.timer = 0;
      try { this.amb.loop?.stop(); } catch { /* not started */ }
      this.amb.loop = null;
      return;
    }
    if (!this.amb.loop && SFX_TAKES.wind) {
      void this.buffer('wind-1').then((buf) => {
        if (!buf || this.amb.loop || !this.amb.on) return;
        const src = c!.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = c!.createGain();
        g.gain.value = LEVEL.wind;
        src.connect(g).connect(this.sfxBus);
        src.start();
        this.amb.loop = src;
      });
    }
    const call = () => {
      if (this.want !== 'battle') this.play('nature', { vol: rnd(0.5, 1) });
      this.amb.timer = window.setTimeout(call, rnd(35_000, 80_000));
    };
    if (!this.amb.timer) this.amb.timer = window.setTimeout(call, rnd(20_000, 45_000));
  }
}

export const sound = new Sound();

/** The war horn and the men's shout: "your turn". */
export function turnHorn() { sound.chime(); }
