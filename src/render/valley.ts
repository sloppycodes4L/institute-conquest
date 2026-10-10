// @ts-nocheck
// The valley of the Institute as a war is fought over it: the land (one plate per territory), the rifts between
// quadrants, lakes with shores, the sea beneath Olympus, the ridge, the floating city, Keeps, squads of soldiers,
// generals, Standards, ships that sail only while an army crosses, and the count plate that floats over every army.
//
// It was worked out in docs/in-game-mockup.html, and is that script kept as ONE closure per map: everything below
// is built for one Geo and thrown away with it (`dispose`). That is why the body is not indented, and why names are
// shared freely between its parts. World (scene.ts) owns the renderer, the camera, the pointer and the loop, and is
// the only caller. The type checker is off for this file; its surface is the interfaces just below, and scene.ts
// is checked against them.

import * as THREE_NS from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HOUSES as GAME_HOUSES, type Geo } from '../engine/data.ts';

/** How much the device is asked to draw. */
export interface Quality {
  /** Side of the sun's shadow map, in pixels (0: no shadows). */
  shadow: number;
  /** 1 for everything; less thins out what grows on the land and the rocks along the shores. */
  dressing: number;
  /** Squads cast shadows (hundreds of small figures). */
  figureShadows: boolean;
}

export interface GeneralView {
  /** The Keep they stand at. */
  t: number;
  /** The House whose colours they wear: whoever holds the Keep. */
  holder: number;
  name: string;
  sub: string;
  /** The Primus of House Mars wears a wolf pelt. No one else does. */
  wolf: boolean;
}

/** A war as the map shows it. Owners are HOUSES (the House of the seat that holds the land), not seats. */
export interface WarView {
  owner: number[];
  armies: number[];
  /** The viewer's House, or -1 when only watching. */
  me: number;
  /** By House: where its Standard is, whether it has been captured, and its honor guard. */
  standards: { at: number; taken: boolean; guard: number }[];
  /** Armies placed this Draft, by territory (they can still be taken back). */
  placed: Record<number, number>;
  generals: GeneralView[];
}

export type GlowKind = 'attack' | 'fortify' | 'place' | 'target' | 'std' | 'assault';
export interface GlowOpts { sources?: number[]; fan?: boolean; warn?: number[]; olympus?: boolean; picked?: number[]; own?: boolean }
export type OlympusLook = 'solid' | 'ghost' | 'hidden';
/** The chance to take a territory, shown on its plate while it is a target. */
export interface Odds { p: number; overwhelm?: boolean }

export interface ValleyEnv {
  renderer: THREE_NS.WebGLRenderer;
  camera: THREE_NS.PerspectiveCamera;
  controls: OrbitControls;
  /** The element the canvas fills. Sizes and screen positions are measured against it. */
  host: HTMLElement;
  /** Where count plates and names go: an overlay over the canvas, under the HUD. */
  layer: HTMLElement;
  geo: Geo;
  quality: Quality;
  /** Awaited between the stages of the build, so the page can draw (and a loading line can say what is being made). */
  pause?: (stage: string) => Promise<void> | void;
  /** Something on the map made a sound (a ship setting sail). */
  sound?: (name: string) => void;
}

export interface Valley {
  scene: THREE_NS.Scene;
  /** Advance everything that moves and draw one frame. */
  frame(): void;
  /** The host changed size. `home`: also go back to the opening view. */
  resize(home?: boolean): void;
  /** The opening view: the whole valley, or (on an upright phone, in a war) the viewer's own Keep. */
  home(): void;
  dispose(): void;

  apply(v: WarView): void;
  /** No war: the land as it lies, no armies. */
  idle(): void;

  setHighlights(sel: number | null, targets: number[], kind: GlowKind, opts?: GlowOpts): void;
  setHover(t: number | null): void;
  setOdds(odds: Record<number, Odds> | null): void;
  /** Grey out every territory not in `keep` (null: none). */
  setDim(keep: boolean[] | null): void;
  setMarks(seized: { t: number; color: string }[], storm: number[]): void;
  /** Olympus's garrison while it is under siege (null: none). */
  setSiege(garrison: number | null): void;
  setOlympus(look: OlympusLook): void;
  /** Names of territories, regions and land bridges, and brighter sea lanes. */
  setReveal(on: boolean): void;
  /** What the HUD covers at the top and bottom of the host, in pixels: the view centres on what is left. */
  setInsets(top: number, bottom: number): void;
  setSpeed(k: number): void;

  arrow(from: number, to: number, color: string): void;
  route(path: number[], stop: number, color: string): void;
  clearArrow(): void;
  flash(ts: number[], color: string, dur: number): void;
  burst(t: number, color: string, big: boolean): void;
  bleed(t: number, dead: number, big: boolean): void;

  /** The garrison of `from` goes out against `to`: up to the border by land, across the lane by sea. Resolves when it is in place. */
  sortie(from: number, to: number): Promise<void>;
  /** The fight is over: they go in (`won`), or fall back. `more`: by sea, they stand off the shore for another try. */
  settle(from: number, to: number, won: boolean, more?: boolean): Promise<void>;
  /** A march along `path` as far as `stop` (a territory on it): on foot, and by ship where it crosses a sea lane. */
  travel(path: number[], stop: number): Promise<void>;
  /** Is the way from `from` to `to` a sea lane? */
  bySea(from: number, to: number): boolean;

  /** The territory under a point of the screen (client pixels): its id, -2 for Olympus, or null. */
  pickAt(x: number, y: number): number | null;
  /** Client pixels of a point `lift` above a territory's army (or above Olympus, for -2). */
  screenPos(t: number, lift?: number): { x: number; y: number };
  /** Glide to the middle of these territories; with `near`, come in close if the view is far out. */
  glide(ts: number[], near?: boolean): void;
  /** Counts for the curious (and for choosing a quality level). */
  stats(): { calls: number; triangles: number };
  /** What can be heard from where the camera is, each 0 to 1: water lapping, Olympus's falls, a ship's oars, the Frostfangs' ice. */
  ambience(): { water: number; falls: number; oars: number; frost: number };
}

export async function createValley(env: ValleyEnv): Promise<Valley> {
const { renderer, camera, controls, geo } = env;
const device = env.host, platesEl = env.layer, Q = env.quality;
const pause = async (stage) => { await env.pause?.(stage); if (dead) throw new Error('valley: disposed while building'); };
/** Set when this valley is thrown away: every timer and promise of its own stops at the next look. */
let dead = false;
/** Every texture painted here, so that each can be let go again with the valley. */
const made = [];
const THREE = {
  ...THREE_NS,
  CanvasTexture: class extends THREE_NS.CanvasTexture { constructor(...a) { super(...a); made.push(this); } },
  DataTexture: class extends THREE_NS.DataTexture { constructor(...a) { super(...a); made.push(this); } },
};
/** The host's size in pixels (kept here so nothing has to ask the page for it every frame). */
let vw = 1, vh = 1;

// =============================================================================
// data: the valley, from the map the rules made

const G = geo;
const SQ3 = Math.sqrt(3);
const HOUSES = GAME_HOUSES.map((h, i) => ({ i, name: h.name, color: h.color, sigil: h.sigil, epithet: h.epithet }));
const T = geo.territories.map((t) => ({ id: t.id, name: t.name, biome: t.biome, terrain: t.terrain, house: t.house, quadrant: t.quadrant, row: t.row, region: t.region, port: t.port, isKeep: t.isKeep, foot: t.foot }));
const NT = T.length;
const { R_IN, R_OUT } = geo;
const HEX = geo.hexes.map((h) => { const r = Math.round(h.y / 1.5), q = Math.round(h.x / SQ3 - r / 2); return { q, r, x: SQ3 * (q + r / 2), y: 1.5 * r, t: h.t }; });
const hexAt = new Map(HEX.map((h) => [h.q + ',' + h.r, h]));
const byT = Array.from({ length: NT }, () => []);
for (const h of HEX) byT[h.t].push(h);
const CEN = geo.centroid;
const ADJ = geo.adj;
/** The Keep of each House, wherever its slice was dealt. */
const KEEP = HOUSES.map((_, h) => geo.keepOf(h));
const REGIONS = geo.regions.map((r) => ({ id: r.id, name: r.name, bonus: r.bonus, house: r.house, terr: r.terr, at: r.at }));
const STRAITS = geo.straits;

// The war, as World last told it (see `apply`). An owner here is a House: the House of the seat that holds the land.
let ME = -1;
const owner = new Array(NT).fill(-1);
const armies = new Array(NT).fill(0);
const rnd = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const standardAt = KEEP.slice();
const stdTaken = HOUSES.map(() => true), stdGuard = HOUSES.map(() => 0);
/** How fast marches and crossings play (the game's speed setting). */
let SPEED = 1;
/** How Olympus is drawn. */
let olyLook = 'solid';

await pause("the ground");
// =============================================================================
// helpers

const hash2 = (x, y, s = 0) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s = 0, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (t) => t * t * (3 - 2 * t), m = (v) => (period ? ((v % period) + period) % period : v);
  const a = hash2(m(xi), m(yi), s), b = hash2(m(xi + 1), m(yi), s), c = hash2(m(xi), m(yi + 1), s), d = hash2(m(xi + 1), m(yi + 1), s);
  const u = w(xf), v = w(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/** Fractal noise, 0..1. With a period it tiles. */
function fbm(x, y, s = 0, oct = 4, period = 0) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * vnoise(x * f, y * f, s + i * 17, period ? period * f : 0); norm += a; a *= 0.5; f *= 2; }
  return sum / norm;
}
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** A 0..255 sRGB colour as the linear values vertex colours are read as. */
const lin = (c, k = 1) => [Math.pow(c[0] / 255, 2.2) * k, Math.pow(c[1] / 255, 2.2) * k, Math.pow(c[2] / 255, 2.2) * k];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ramp = (stops, t) => { t = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1); const i = Math.floor(t); return mix3(stops[i], stops[i + 1], t - i); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const w2v = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const NEUTRAL = '#8f8676';
const colorOf = (o) => (o >= 0 ? HOUSES[o].color : NEUTRAL);
/** Gradient noise, about -1..1: smoother than vnoise, and without its grid showing through. With a period it tiles. */
function gnoise(x, y, s = 0, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const m = (v) => (period ? ((v % period) + period) % period : v);
  const g = (ix, iy, dx, dy) => { const a = hash2(m(ix), m(iy), s) * 6.2831853; return Math.cos(a) * dx + Math.sin(a) * dy; };
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  return ((g(xi, yi, xf, yf) * (1 - u) + g(xi + 1, yi, xf - 1, yf) * u) * (1 - v) + (g(xi, yi + 1, xf, yf - 1) * (1 - u) + g(xi + 1, yi + 1, xf - 1, yf - 1) * u) * v) * 1.41;
}
/** Noise through space, 0..1: for shaping solids, where a flat noise would leave a seam. */
function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), w = (t) => t * t * (3 - 2 * t), u = w(x - xi), v = w(y - yi), q = w(z - zi);
  const h = (i, j, k) => hash2(i + k * 57, j - k * 131, s + k * 7);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), q);
}
function fbm3(x, y, z, s = 0, oct = 4) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 19); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}
/**
 * A tiling texture of a surface's relief, read by the shaders that light rock and water:
 * its slope across and up in R and G, its height in B, and a second pattern in A.
 */
function reliefTex(size, heightFn, extraFn) {
  const H = new Float32Array(size * size);
  let lo = 1e9, hi = -1e9;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const h = heightFn(x / size, y / size); H[y * size + x] = h; if (h < lo) lo = h; if (h > hi) hi = h; }
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  let steep = 1e-9;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) steep = Math.max(steep, Math.abs(at(x + 1, y) - at(x - 1, y)), Math.abs(at(x, y + 1) - at(x, y - 1)));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    data[o] = 127.5 + 127.5 * (at(x + 1, y) - at(x - 1, y)) / steep;
    data[o + 1] = 127.5 + 127.5 * (at(x, y + 1) - at(x, y - 1)) / steep;
    data[o + 2] = 255 * (H[y * size + x] - lo) / (hi - lo);
    data[o + 3] = 255 * clamp(extraFn(x / size, y / size), 0, 1);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}


// building solids out of simple ones
const mat4 = (x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
/** One geometry out of many parts, each painted its own colour: [geometry, colour, matrix]. Round parts stay round, flat ones flat. */
function fuse(parts) {
  let n = 0;
  const gs = parts.map(([g0, color, m]) => {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    n += g.attributes.position.count;
    return [g, color];
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
  let o = 0;
  for (const [g, color] of gs) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    // (a part given no colour keeps the colours it was made with)
    if (color == null) { col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; continue; }
    c.set(color);
    for (let i = 0; i < g.attributes.position.count; i++, o++) { col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
/** Smooth shading for a solid whose faces share no vertices: each vertex takes the normal of every face that meets at its spot. */
function smoothNormals(g0) {
  const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position, sum = new Map(), key = new Array(p.count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1).sub(a); c.fromBufferAttribute(p, i + 2).sub(a); b.cross(c);
    for (let j = i; j < i + 3; j++) {
      const k = key[j] = Math.round(p.getX(j) * 500) + ',' + Math.round(p.getY(j) * 500) + ',' + Math.round(p.getZ(j) * 500), s = sum.get(k);
      if (s) s.add(b); else sum.set(k, b.clone());
    }
  }
  const n = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const s = sum.get(key[i]), l = s.length() || 1; n[i * 3] = s.x / l; n[i * 3 + 1] = s.y / l; n[i * 3 + 2] = s.z / l; }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}
/** A rough lump: a solid with its corners pushed about, the same way every time. */
function lump(geo, amt, seed) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash2(Math.round(x * 50), Math.round(y * 50) + Math.round(z * 50) * 131, seed) - 0.5) * amt;
    p.setXYZ(i, x * k, y * (1 + (k - 1) * 0.5), z * k);
  }
  g.computeVertexNormals();
  return g;
}
/** A boulder: a ball swollen and pinched by noise, and shaded smooth. */
function boulder(r, seed, detail = 2, amt = 0.5) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r;
    const k = 1 + (fbm3(x * 1.3 + 7, y * 1.3, z * 1.3, seed, 3) - 0.5) * amt * 2 + (noise3(x * 4, y * 4, z * 4, seed + 5) - 0.5) * amt * 0.35;
    p.setXYZ(i, x * k * r, y * k * r, z * k * r);
  }
  return smoothNormals(g);
}
/** A solid cut in flat faces, where a round one would look wrong (a blade, a pyramid roof). */
const flat = (g0) => { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); return g; };
const cyl = (a, b, h, n = 8) => new THREE.CylinderGeometry(a, b, h, n);
const cone = (r, h, n = 7) => new THREE.ConeGeometry(r, h, n);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
/** A shape turned on a lathe, from its outline as [radius, height] pairs. */
const turned = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** A pitched roof: a prism `len` long (x) and `wid` across (z), rising `h` to a ridge that runs along x. */
function gable(len, wid, h) {
  const x = len / 2, z = wid / 2, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0, // the two slopes
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0,
    x, 0, z, x, 0, -z, x, h, 0, -x, 0, -z, -x, 0, z, -x, h, 0, // the two gable ends
    -x, 0, -z, x, 0, -z, x, 0, z, -x, 0, -z, x, 0, z, -x, 0, z], 3)); // the underside
  g.computeVertexNormals();
  return g;
}
/** A limb or a bar: a rounded rod from one point to another. */
function rod(p0, p1, r0, r1 = r0, seg = 10) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), len = a.distanceTo(b);
  const g = r0 === r1 ? new THREE.CapsuleGeometry(r0, len, Math.max(2, seg >> 1), seg) : new THREE.CylinderGeometry(r1, r0, len, seg);
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1)));
  return g;
}


await pause("the sky");
// =============================================================================
// renderer, camera, sky, light

const scene = new THREE.Scene();

const SUN = new THREE.Vector3(-0.62, 0.56, 0.44).normalize();
const SKY = { top: new THREE.Color('#161226'), mid: new THREE.Color('#6a4350'), bot: new THREE.Color('#d08a5a'), haze: new THREE.Color('#7d5a58') };
const U = {
  time: { value: 0 },
  /** 1 far out (the political map), 0 close in (the terrain). */
  pol: { value: 1 },
  /** 1 while names and regions are being shown (hold Alt, or the eye). */
  reveal: { value: 0 },
  fogNear: { value: 150 }, fogFar: { value: 460 },
};
scene.fog = new THREE.Fog(SKY.haze, 150, 460);

/** What the sky looks like from the ground, for reflections. */
let ENV, envTarget;
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY.top }, mid: { value: SKY.mid }, bot: { value: SKY.bot }, sunDir: { value: SUN }, sunCol: { value: new THREE.Color('#ffc890') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = h > 0.10 ? mix(mid, top, smoothstep(0.10, 0.72, h)) : mix(bot, mid, smoothstep(-0.06, 0.10, h));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 5.0) * 0.30 + pow(s, 48.0) * 0.55 + pow(s, 1200.0) * 4.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);
  // The same sky, as what polished things reflect: gold, steel and marble take their shine from it.
  const around = new THREE.Scene(), ground = new THREE.Mesh(new THREE.CircleGeometry(880, 24), new THREE.MeshBasicMaterial({ color: '#2a1d1a' }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -6;
  around.add(sky.clone(), ground);
  const pm = new THREE.PMREMGenerator(renderer);
  envTarget = pm.fromScene(around, 0, 1, 2000);
  ENV = envTarget.texture;
  pm.dispose();
  // stars, and the two moons
  const pts = [];
  for (let i = 0; i < 700; i++) { const th = rnd(i, 1) * Math.PI * 2, ph = Math.acos(1 - rnd(i, 2) * 0.75); pts.push(Math.sin(ph) * Math.cos(th) * 860, Math.cos(ph) * 860, Math.sin(ph) * Math.sin(th) * 860); }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffe9d6', size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55 })));
  const moon = (r, pos, c) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), new THREE.MeshStandardMaterial({ color: c, roughness: 1, fog: false, flatShading: true })); m.position.copy(pos); scene.add(m); };
  moon(15, new THREE.Vector3(-260, 300, -560), '#b9a48f');
  moon(7, new THREE.Vector3(330, 235, -520), '#d8c7b0');
}

scene.add(new THREE.HemisphereLight('#bccbee', '#5b4a40', 0.9));
const sun = new THREE.DirectionalLight('#fff0da', 2.5);
sun.position.copy(SUN).multiplyScalar(140);
sun.castShadow = Q.shadow > 0;
sun.shadow.mapSize.set(Q.shadow || 512, Q.shadow || 512);
{ const c = sun.shadow.camera; const s = R_OUT * 1.25; c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = 20; c.far = 320; c.updateProjectionMatrix(); }
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);
const fill = new THREE.DirectionalLight('#8aa0ff', 0.32);
fill.position.set(60, 40, -50);
scene.add(fill);


await pause("the ground");
// =============================================================================
// ground textures: one tiling painting per biome, made here

function makeTex(size, fn) {
  const c = document.createElement('canvas'), b = document.createElement('canvas');
  c.width = c.height = b.width = b.height = size;
  const g = c.getContext('2d'), gb = b.getContext('2d');
  const img = g.createImageData(size, size), bimg = gb.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4, r = fn(x / size, y / size);
    img.data[o] = r[0]; img.data[o + 1] = r[1]; img.data[o + 2] = r[2]; img.data[o + 3] = 255;
    bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = clamp(r[3] * 255, 0, 255); bimg.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); gb.putImageData(bimg, 0, 0);
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(b);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, bump };
}
/** Height of a territory's plate, its palette (dark to light), and what its ground is made of. */
const BIOME = {
  plain: { h: 0.8, pal: ['#56633a', '#718044', '#8e9150', '#a59c5e'], rough: 0.95, bump: 0.5 },
  fields: { h: 0.75, pal: ['#8d7330', '#b89540', '#d0ad50', '#e2c66c'], rough: 0.92, bump: 0.7, furrow: 1 },
  forest: { h: 0.95, pal: ['#263c22', '#33522c', '#446232', '#5b6e3e'], rough: 1, bump: 0.6 },
  highland: { h: 1.3, pal: ['#55573c', '#6c6c4c', '#84805a', '#9a916f'], rough: 0.95, bump: 0.8 },
  crag: { h: 1.45, pal: ['#574c42', '#74665a', '#8c7c6c', '#a39382'], rough: 0.9, bump: 1.3 },
  mountain: { h: 1.75, pal: ['#565049', '#72695f', '#8c8277', '#a69b90'], rough: 0.9, bump: 1.4 },
  snow: { h: 1.35, pal: ['#bccad6', '#d4dee7', '#e7eef3', '#f6f9fb'], rough: 0.72, bump: 0.3 },
  swamp: { h: 0.5, pal: ['#1f2e25', '#30402a', '#434f30', '#595e3e'], rough: 0.62, bump: 0.5, pools: 1 },
  deadwood: { h: 0.9, pal: ['#3b3835', '#504b46', '#645d56', '#7a7168'], rough: 1, bump: 0.7 },
  lake: { h: 0.42, pal: ['#6f6349', '#8c7d5c', '#a59672', '#bdb08c'], rough: 0.9, bump: 0.4 },
  keep: { h: 1.2, pal: ['#5d5348', '#73685d', '#877c6f', '#9c9083'], rough: 0.95, bump: 0.7, cobble: 1 },
};
let texSeed = 11;
for (const def of Object.values(BIOME)) {
  const P = 8, pal = def.pal.map(hex2rgb), seed = (texSeed += 23);
  def.tex = makeTex(256, (u, v) => {
    const x = u * P, y = v * P;
    const n = fbm(x, y, seed, 5, P), fine = fbm(x * 6, y * 6, seed + 50, 3, P * 6);
    let t = n * 0.72 + fine * 0.28, hgt = fine * 0.6 + n * 0.4;
    if (def.furrow) { const f = 0.5 + 0.5 * Math.sin((u * 22 + v * 3) * Math.PI * 2); t = t * 0.62 + f * 0.38; hgt = f * 0.8 + fine * 0.2; }
    if (def.strata) { const s = 0.5 + 0.5 * Math.sin((v * 9 + n * 2.2) * Math.PI * 2); t = t * 0.72 + s * 0.28; hgt = hgt * 0.5 + s * 0.5; }
    if (def.pools && fbm(x * 1.5 + 9, y * 1.5, seed + 9, 3, P * 1.5) < 0.43) { t *= 0.35; hgt = 0.08; }
    if (def.cobble) {
      const row = Math.floor(v * 26), cx = (u * 26 + (row % 2) * 0.5) % 1, cy = (v * 26) % 1, d = Math.min(cx, 1 - cx, cy, 1 - cy);
      t *= d < 0.09 ? 0.55 : 1; hgt = d < 0.09 ? 0.15 : 0.7 + fine * 0.3;
    }
    const c = ramp(pal, (t - 0.18) / 0.64);
    return [c[0], c[1], c[2], hgt];
  });
}


// =============================================================================
// rock and water: what their surfaces are made of

/** Rock is cracked and ridged; water is many small waves running every way at once. */
const ROCK_RELIEF = reliefTex(256, (u, v) => {
  let a = 0.5, f = 4, h = 0, prev = 1;
  for (let o = 0; o < 5; o++) { let n = 1 - Math.abs(gnoise(u * f, v * f, 91 + o * 7, f)); n *= n; h += n * a * prev; prev = 0.3 + 0.7 * n; a *= 0.5; f *= 2; }
  return h;
}, (u, v) => 0.5 + 0.5 * (gnoise(u * 3, v * 3, 97, 3) * 0.7 + gnoise(u * 9, v * 9, 99, 9) * 0.3));
const WATER_RELIEF = (() => {
  const waves = [];
  for (let i = 0; i < 46; i++) {
    const a = rnd(i, 71) * 6.2831853, k = 2 + Math.pow(rnd(i, 72), 1.5) * 13, kx = Math.round(Math.cos(a) * k), ky = Math.round(Math.sin(a) * k);
    if (kx || ky) waves.push([kx, ky, rnd(i, 73) * 6.2831853, Math.pow(Math.hypot(kx, ky), -1.15)]);
  }
  return reliefTex(256, (u, v) => { let h = 0; for (const [kx, ky, ph, am] of waves) h += am * Math.pow(0.5 + 0.5 * Math.sin(6.2831853 * (kx * u + ky * v) + ph), 1.6); return h; },
    (u, v) => 0.5 + 0.5 * (gnoise(u * 5, v * 5, 61, 5) * 0.6 + gnoise(u * 13, v * 13, 63, 13) * 0.4));
})();
/**
 * Stone that reads as stone from any distance. Its colour comes from where each point is: scrub on low, gentle
 * ground, bare rock on the faces, snow where it is high and can lie, dark and wet at the waterline. Its small
 * relief comes from ROCK_RELIEF, laid on from three sides so that no face smears it.
 */
function rockMaterial(o = {}) {
  const uni = {
    uRelief: { value: ROCK_RELIEF }, uScale: { value: o.scale ?? 0.3 }, uBump: { value: o.bump ?? 1.0 },
    uLo: { value: new THREE.Color(o.lo ?? '#3d322c') }, uHi: { value: new THREE.Color(o.hi ?? '#8d7b6b') },
    uSnow: { value: new THREE.Vector2(...(o.snow ?? [999, 1000])) }, uSnowCol: { value: new THREE.Color(o.snowCol ?? '#eef1f4') },
    uScrub: { value: new THREE.Vector2(...(o.scrub ?? [-1000, -999])) }, uScrubCol: { value: new THREE.Color(o.scrubCol ?? '#3f4a2c') },
    uWet: { value: o.wet ?? -1000 }, uJit: { value: o.jit ?? 1 }, uBounce: { value: new THREE.Color(o.bounce ?? '#000000') },
    // (beds laid one on another, showing on its faces: how dark, and how many to a unit of height; and how low scrub will grow)
    uStrata: { value: new THREE.Vector2(...(o.strata ?? [0, 1])) }, uScrubFrom: { value: o.scrubFrom ?? -1000 },
    // (and what it is dimmed by: the rifts go dark when the map is political, so that the quadrants stand apart)
    uDim: o.dim ?? { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: !!o.vertexColors, roughness: o.roughness ?? 0.94, metalness: 0, side: o.side ?? THREE.FrontSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'varying vec3 vWp;\nvarying vec3 vWn;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
    sh.fragmentShader = `uniform sampler2D uRelief; uniform float uScale; uniform float uBump; uniform vec3 uLo; uniform vec3 uHi; uniform vec2 uSnow; uniform vec3 uSnowCol; uniform vec2 uScrub; uniform vec3 uScrubCol; uniform float uWet; uniform float uJit; uniform vec3 uBounce; uniform vec2 uStrata; uniform float uScrubFrom; uniform float uDim;
      varying vec3 vWp; varying vec3 vWn;\n` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 rkN = normalize(vWn);
        vec3 rkW = pow(abs(rkN), vec3(4.0)); rkW /= rkW.x + rkW.y + rkW.z;
        vec4 rkX = texture2D(uRelief, vWp.zy * uScale), rkY = texture2D(uRelief, vWp.xz * uScale), rkZ = texture2D(uRelief, vWp.xy * uScale);
        vec4 rk = rkX * rkW.x + rkY * rkW.y + rkZ * rkW.z;
        vec4 rkFar = texture2D(uRelief, vWp.zy * uScale * 0.23 + 0.11) * rkW.x + texture2D(uRelief, vWp.xz * uScale * 0.23 + 0.37) * rkW.y + texture2D(uRelief, vWp.xy * uScale * 0.23 + 0.53) * rkW.z;
        float rkSteep = 1.0 - rkN.y;
        float rkCrack = smoothstep(0.50, 0.92, rk.b);
        vec3 rkCol = mix(uLo, uHi, smoothstep(0.22, 0.80, rk.a * 0.45 + rkFar.a * 0.40 + (1.0 - rkFar.b) * 0.25));
        rkCol *= (1.0 - 0.42 * rkCrack) * (0.86 + 0.28 * (1.0 - rkFar.b));
        float rkBed = smoothstep(-0.1, 0.55, sin((vWp.y + (rkFar.a - 0.5) * 0.7 + (rk.a - 0.5) * 0.1) * 6.2832 * uStrata.y));
        rkCol *= 1.0 - uStrata.x * rkBed * smoothstep(0.12, 0.45, rkSteep);
        float rkScrub = (1.0 - smoothstep(uScrub.x, uScrub.y, vWp.y + (rkFar.a - 0.5) * 2.5 * uJit)) * smoothstep(0.62, 0.30, rkSteep + (rk.b - 0.5) * 0.25) * smoothstep(uScrubFrom, uScrubFrom + 1.2, vWp.y);
        rkCol = mix(rkCol, uScrubCol * (0.7 + 0.6 * rk.a), rkScrub * 0.85);
        float rkSnow = smoothstep(uSnow.x, uSnow.y, vWp.y + ((rkFar.a - 0.5) * 3.4 + (rk.a - 0.5) * 1.4) * uJit) * smoothstep(0.82, 0.40, rkSteep + (rk.a - 0.5) * 0.3);
        rkCol = mix(rkCol, uSnowCol, rkSnow);
        float rkWet = 1.0 - smoothstep(uWet - 0.05, uWet + 0.16, vWp.y + (rk.a - 0.5) * 0.12);
        rkCol *= (1.0 - 0.55 * rkWet) * (1.0 - 0.55 * uDim);
        diffuseColor.rgb *= rkCol;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor, 0.7, rkSnow * 0.6), 0.32, rkWet * 0.8);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uBounce * diffuseColor.rgb * smoothstep(0.3, -0.7, rkN.y);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 gx = rkX.rg - 0.5, gy = rkY.rg - 0.5, gz = rkZ.rg - 0.5;
          vec3 bend = vec3(0.0, gx.y, gx.x) * rkW.x + vec3(gy.x, 0.0, gy.y) * rkW.y + vec3(gz.x, gz.y, 0.0) * rkW.z;
          normal = normalize(normal + (viewMatrix * vec4(bend, 0.0)).xyz * uBump * (1.0 - 0.7 * rkSnow));
        }`);
  };
  mat.customProgramCacheKey = () => 'rock' + (o.vertexColors ? 'c' : '');
  return mat;
}


await pause("the land");
// =============================================================================
// the land: every territory is one plate

const DIR = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // axial steps, 60° apart from east
const CORNER = Array.from({ length: 6 }, (_, k) => { const a = ((30 + 60 * k) * Math.PI) / 180; return [Math.cos(a), Math.sin(a)]; });
const hexXY = (q, r) => [SQ3 * (q + r / 2), 1.5 * r];
/** Height of each territory's plate. */
const topH = T.map((t) => BIOME[t.biome].h + (t.isKeep ? 0 : (rnd(t.id, 7) - 0.5) * 0.16));
/** What lies past a coast edge: the sea beneath Olympus, a rift between two quadrants, or the foothills. */
function voidKind(mx, my) {
  const rad = Math.hypot(mx, my);
  if (rad < R_IN + 2.2) return 'sea';
  const a = Math.atan2(my, mx);
  for (const st of STRAITS) { const d = Math.atan2(Math.sin(a - st.angle), Math.cos(a - st.angle)); if (Math.abs(d) * rad < 4.2) return 'rift'; }
  return 'rim';
}
/**
 * A hex corner is shared by three cells. For the territory `t` standing on it: is it on t's border, which way is
 * inward, and which way is open (no land).
 */
const cornerCache = new Map();
function cornerInfo(h, k) {
  const cells = [[h.q, h.r], [h.q + DIR[k][0], h.r + DIR[k][1]], [h.q + DIR[(k + 1) % 6][0], h.r + DIR[(k + 1) % 6][1]]];
  const key = cells.map((c) => c[0] + ',' + c[1]).sort().join('|') + '|' + h.t;
  let info = cornerCache.get(key);
  if (info) return info;
  const cx = h.x + CORNER[k][0], cy = h.y + CORNER[k][1];
  let border = false, region = false, ix = 0, iy = 0, vx = 0, vy = 0, open = false;
  const others = []; // who else stands on this corner: territories, or -1 for open ground
  for (const [q, r] of cells) {
    const c = hexAt.get(q + ',' + r), [x, y] = hexXY(q, r);
    if (c && c.t === h.t) { ix += x - cx; iy += y - cy; } else { border = true; others.push(c ? c.t : -1); }
    if (!c || T[c.t].region !== T[h.t].region) region = true;
    if (!c) { vx += x - cx; vy += y - cy; open = true; }
  }
  const il = Math.hypot(ix, iy) || 1, vl = Math.hypot(vx, vy) || 1;
  info = { x: cx, y: cy, border, region, others, ix: ix / il, iy: iy / il, open, vx: vx / vl, vy: vy / vl };
  cornerCache.set(key, info);
  return info;
}

const land = new THREE.Group();
scene.add(land);
const plates = []; // per territory: { mesh, mat, uni }
const UV = 0.16;
const cliff = { pos: [], col: [] };
/** How high Olympus hangs. How high the sea stands, and every stretch of coast: a plate's edge (a, b) and the waterline below it (wa, wb). */
const OLY_Y = 8.6;
const SEA_Y = -0.5;
const coast = [];
const INNER = 0.6; // where the border band begins, as a share of the hex
const LAKE_CUT = 8; // how finely each edge of a lake's hexes is cut: its ground is no flat plate
const SAND = lin(hex2rgb('#c9b98c')), WET = lin(hex2rgb('#4f4c3c')), PIT = [0.02, 0.015, 0.012];
const pushV = (arr, v) => arr.push(v.x, v.y, v.z);

function plateMaterial(t, lake) {
  // (A lake's ground is turf above its shore, shingle along it and mud under its water: see the lakes.)
  const def = BIOME[lake ? 'plain' : T[t].biome];
  const uni = {
    uTint: { value: new THREE.Color(colorOf(owner[t])) }, uOwn: { value: owner[t] >= 0 ? 1 : 0 }, uPol: U.pol, uReveal: U.reveal,
    uHi: { value: new THREE.Color('#f3d27a') }, uHiAmt: { value: 0 }, uHov: { value: 0 }, uHovR: { value: 0 }, uDim: { value: 0 }, uStorm: { value: 0 }, uFrost: { value: T[t].quadrant === 2 && !['snow', 'lake'].includes(T[t].biome) ? 0.5 : 0 },
  };
  if (lake) Object.assign(uni, { uShingle: { value: BIOME.lake.tex.map }, uWater: { value: lake.water }, uSnowy: { value: T[t].quadrant === 2 ? 1 : 0 } });
  const mat = new THREE.MeshStandardMaterial({ map: def.tex.map, bumpMap: def.tex.bump, bumpScale: def.bump * 0.35, roughness: def.rough, metalness: 0 });
  if (lake) mat.defines.LAKE_GROUND = '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'attribute float aB;\nattribute float aR;\nattribute float aG;\nattribute float aF;\nvarying float vB;\nvarying float vR;\nvarying float vG;\nvarying float vF;\nvarying float vHigh;\nvarying float vSteep;\nvarying vec3 vBank;\n#ifdef LAKE_GROUND\nattribute vec3 aBank;\n#endif\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vB = aB; vR = aR; vG = aG; vF = aF; vHigh = transformed.y; vSteep = 1.0 - objectNormal.y;\n#ifdef LAKE_GROUND\n  vBank = aBank;\n#endif');
    sh.fragmentShader = 'uniform float uDim;\nuniform float uStorm;\nuniform vec3 uTint;\nuniform float uOwn;\nuniform float uPol;\nuniform float uReveal;\nuniform vec3 uHi;\nuniform float uHiAmt;\nuniform float uHov;\nuniform float uHovR;\nuniform float uFrost;\nuniform sampler2D uShingle;\nuniform float uWater;\nuniform float uSnowy;\nvarying float vB;\nvarying float vR;\nvarying float vG;\nvarying float vF;\nvarying float vHigh;\nvarying float vSteep;\nvarying vec3 vBank;\n'
      + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef LAKE_GROUND
        {
          // A lake's ground: its banks take after the land beyond them, and are bare rock where they are steep;
          // shingle along the water's edge, dark where it is wet; and a bed that sinks out of sight.
          float up = vHigh - uWater;
          float grain = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 turf = vBank * (0.45 + 3.1 * grain), shingle = texture2D(uShingle, vMapUv * 2.3).rgb;
          vec3 ground = mix(shingle, turf, smoothstep(0.09, 0.22, up + (grain - 0.17) * 0.6));
          // (a rock face is painted as it stands, upright, so that it does not smear)
          float face = dot(texture2D(uShingle, vec2((vMapUv.x + vMapUv.y) * 1.6, vHigh * 0.55)).rgb, vec3(0.333));
          ground = mix(ground, vec3(0.30, 0.255, 0.215) * (0.35 + 2.6 * face), smoothstep(0.34, 0.6, vSteep) * smoothstep(0.03, 0.18, up));
          ground = mix(ground, vec3(0.86, 0.90, 0.93), uSnowy * smoothstep(0.05, 0.15, up) * (1.0 - smoothstep(0.45, 0.75, vSteep)));
          ground *= mix(0.5, 1.0, smoothstep(-0.01, 0.06, up));
          ground = mix(ground, vec3(0.045, 0.075, 0.065), smoothstep(0.0, -0.5, up) * 0.8);
          diffuseColor.rgb = ground;
        }
        #endif
        float lum0 = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        // The Frostfangs: snow lies in the hollows of whatever ground is there.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.90, 0.93), uFrost * smoothstep(0.03, 0.14, lum0));
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        // Far out the map is political: held land wears its House, unheld land goes quiet. Close in, the ground shows.
        vec3 paint = uTint * (0.50 + 0.85 * lum);
        float far = uPol * uPol;
        diffuseColor.rgb = mix(diffuseColor.rgb, paint, uOwn * mix(0.06, 0.82, far));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.80, 0.76, 0.70), (1.0 - uOwn) * far * 0.5);
        // A region's edge, lit while regions are being shown.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.66, 0.22), smoothstep(0.30, 0.60, vG) * uReveal);
        // The border: a band of the holder's colour inside the plate's edge, bold along a frontier and faint between two
        // territories of one House, and a dark seam at the edge itself.
        float w0 = mix(0.52, 0.30, uPol);
        float band = clamp(smoothstep(w0, w0 + 0.26, vB) + smoothstep(0.0, 0.5, vB) * 0.16, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uTint, band * uOwn * mix(0.22, 1.0, vF) * mix(0.88, 0.5, far));
        // Every land is outlined in ink, and every region in a heavier line with a pale thread inside it: thin close in,
        // and bold from far out, where the whole valley has to read as lands and regions at a glance.
        diffuseColor.rgb *= 1.0 - mix(0.55, 0.92, far) * smoothstep(mix(0.90, 0.60, far), mix(1.0, 0.80, far), vB);
        float rEdge = smoothstep(mix(0.84, 0.34, far), mix(0.98, 0.52, far), vG);
        float rThread = smoothstep(mix(0.70, 0.10, far), mix(0.80, 0.22, far), vG) * (1.0 - rEdge);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.86, 0.60), rThread * mix(0.25, 0.8, far));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.02, 0.015), rEdge * mix(0.6, 0.96, far));
        diffuseColor.rgb *= 1.0 - 0.08 * smoothstep(0.92, 1.0, vR) * (1.0 - uPol);
        // Under the pointer: the land itself is lit and rimmed in white, and the rest of its region wears a warm rim.
        // (its whole border band turns white, ink and all, against the dark ink of the lands around it; and the edge of
        // its region turns gold the same way)
        float hovRim = smoothstep(0.20, 0.40, vB), regRim = smoothstep(0.08, 0.24, vG);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.80, 0.30), uHovR * max(0.22, regRim));
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 + 0.35 * uHov), vec3(1.0), uHov * max(0.30, hovRim));
        float hiBand = smoothstep(0.20, 0.65, vB);
        diffuseColor.rgb = mix(diffuseColor.rgb, uHi, hiBand * uHiAmt * 0.85);
        // Land a storm has struck is hatched, and land outside "My Lands" goes grey.
        float hatch = smoothstep(0.30, 0.42, abs(fract((vMapUv.x + vMapUv.y) * 3.0) - 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.89, 0.85), uStorm * (0.14 + 0.42 * hatch));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 0.55 + 0.03), uDim);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uHi * uHiAmt * (0.02 + 0.5 * hiBand) + vec3(1.0) * uHov * (0.10 + 0.55 * hovRim) + vec3(1.0, 0.72, 0.22) * uHovR * (0.03 + 0.5 * regRim);');
  };
  mat.customProgramCacheKey = () => (lake ? 'plateLake' : 'plate');
  return { mat, uni };
}

for (let t = 0; t < NT; t++) {
  const H = topH[t], lake = T[t].biome === 'lake';
  const pos = [], uv = [], aB = [], aR = [], aG = [], corners = [];
  const def = BIOME[T[t].biome], earth = lin(hex2rgb(def.pal[0]), 0.7);
  for (const h of byT[t]) {
    const C = new THREE.Vector3(h.x, H, -h.y);
    const info = CORNER.map((_, k) => cornerInfo(h, k));
    const I = info.map((c) => new THREE.Vector3(h.x + (c.x - h.x) * INNER, H, -(h.y + (c.y - h.y) * INNER)));
    // (Round a lake, its edge stands as high as the bank does there.)
    const O = info.map((c) => (c.border ? new THREE.Vector3(c.x + c.ix * 0.05, lake ? lakeRim(c, t) : H - 0.09, -(c.y + c.iy * 0.05)) : new THREE.Vector3(c.x, H, -c.y)));
    const tri = (a, b, c, fb, fr, fg, ci) => {
      for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); uv.push(p.x * UV, p.z * UV); }
      aB.push(...fb); aR.push(...fr); aG.push(...fg); corners.push(...ci);
    };
    for (let k = 0; k < 6; k++) {
      const n = (k + 1) % 6, bk = info[k].border ? 1 : 0, bn = info[n].border ? 1 : 0, gk = info[k].region ? 1 : 0, gn = info[n].region ? 1 : 0;
      // (A lake's ground is no flat plate: it is laid further on, once it is known where its garrison stands.)
      if (!lake) {
        tri(C, I[k], I[n], [0, 0, 0], [0, 0, 0], [0, 0, 0], [null, null, null]);
        tri(I[k], O[k], O[n], [0, bk, bn], [0, 1, 1], [0, gk, gn], [null, info[k], info[n]]);
        tri(I[k], O[n], I[n], [0, bn, 0], [0, 1, 0], [0, gn, 0], [null, info[n], null]);
      }
      // The plate's side, wherever this edge is the territory's border.
      const nb = hexAt.get((h.q + DIR[n][0]) + ',' + (h.r + DIR[n][1]));
      if (nb && nb.t === t) continue;
      const a = O[k], b = O[n];
      let A2, B2, top = earth, bot = PIT;
      if (nb && lake) {
        // (a lake's bank does not run straight along its edge, and its side follows it)
        for (let s = 0; s < LAKE_CUT; s++) {
          const p = a.clone().lerp(b, s / LAKE_CUT).setY(lakeBank(info[k], info[n], t, nb.t, s / LAKE_CUT)), q = a.clone().lerp(b, (s + 1) / LAKE_CUT).setY(lakeBank(info[k], info[n], t, nb.t, (s + 1) / LAKE_CUT));
          const p2 = new THREE.Vector3(p.x, -0.7, p.z), q2 = new THREE.Vector3(q.x, -0.7, q.z);
          for (const [v, c] of [[p, top], [p2, bot], [q2, bot], [p, top], [q2, bot], [q, top]]) { pushV(cliff.pos, v); cliff.col.push(c[0], c[1], c[2]); }
        }
        continue;
      }
      if (nb) { A2 = new THREE.Vector3(a.x, -0.7, a.z); B2 = new THREE.Vector3(b.x, -0.7, b.z); }
      else {
        const kind = voidKind(h.x + (info[k].x + info[n].x - 2 * h.x) * 0.65, h.y + (info[k].y + info[n].y - 2 * h.y) * 0.65);
        if (kind === 'sea') {
          // a beach running down under the water
          A2 = new THREE.Vector3(info[k].x + info[k].vx * 1.25, -0.9, -(info[k].y + info[k].vy * 1.25));
          B2 = new THREE.Vector3(info[n].x + info[n].vx * 1.25, -0.9, -(info[n].y + info[n].vy * 1.25));
          top = SAND; bot = WET;
          // where the sea's surface crosses it: the waterline
          coast.push({ t, h, a: a.clone(), b: b.clone(), wa: a.clone().lerp(A2, (a.y - SEA_Y) / (a.y + 0.9)), wb: b.clone().lerp(B2, (b.y - SEA_Y) / (b.y + 0.9)) });
        } else {
          const y = kind === 'rift' ? -5 : -0.9;
          A2 = new THREE.Vector3(a.x, y, a.z); B2 = new THREE.Vector3(b.x, y, b.z);
        }
      }
      for (const [p, c] of [[a, top], [A2, bot], [B2, bot], [a, top], [B2, bot], [b, top]]) { pushV(cliff.pos, p); cliff.col.push(c[0], c[1], c[2]); }
    }
  }
  if (lake) { plates.push(null); continue; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 1));
  geo.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 1));
  geo.setAttribute('aG', new THREE.Float32BufferAttribute(aG, 1));
  geo.setAttribute('aF', new THREE.Float32BufferAttribute(new Float32Array(corners.length), 1));
  geo.computeVertexNormals();
  const { mat, uni } = plateMaterial(t);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.t = t;
  land.add(mesh);
  plates.push({ mesh, mat, uni, corners });
}
/** Mark where a territory's edge is a frontier: the land past it is someone else's, or nobody's. Its border is drawn boldest there. */
function paintFrontier(t) {
  const { mesh, corners } = plates[t], a = mesh.geometry.attributes.aF, o = owner[t];
  for (let i = 0; i < corners.length; i++) a.array[i] = corners[i] && corners[i].others.some((x) => x < 0 || owner[x] !== o) ? 1 : 0;
  a.needsUpdate = true;
}
for (let t = 0; t < NT; t++) if (plates[t]) paintFrontier(t);
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cliff.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cliff.col, 3));
  geo.computeVertexNormals();
  // bare earth and beach, weathered like rock, and dark where the sea wets it
  const m = new THREE.Mesh(geo, rockMaterial({ vertexColors: true, lo: '#a39a8c', hi: '#fff8ea', scale: 0.95, bump: 1.1, wet: SEA_Y + 0.06 }));
  m.castShadow = true; m.receiveShadow = true;
  land.add(m);
}


// =============================================================================
// where things stand: every army, castle and Primus inside its own borders

/** A territory's outline: the edges of its hexes that face other land, or none. Each is [ax, ay, bx, by] on the map, one unit long. */
const outline = T.map(() => []);
for (const h of HEX) for (let k = 0; k < 6; k++) {
  const n = (k + 1) % 6, nb = hexAt.get((h.q + DIR[n][0]) + ',' + (h.r + DIR[n][1]));
  if (!nb || nb.t !== h.t) outline[h.t].push([h.x + CORNER[k][0], h.y + CORNER[k][1], h.x + CORNER[n][0], h.y + CORNER[n][1]]);
}
/** How far inside territory t a point of the map lies: its distance to the outline, negative once it is outside. */
function inset(t, x, y) {
  let d = 1e9, inside = false;
  for (const [ax, ay, bx, by] of outline[t]) { const ex = bx - ax, ey = by - ay, u = clamp((x - ax) * ex + (y - ay) * ey, 0, 1), v = Math.hypot(x - ax - ex * u, y - ay - ey * u); if (v < d) d = v; }
  for (const h of byT[t]) { const dx = Math.abs(x - h.x), dy = Math.abs(y - h.y); if (dx <= SQ3 / 2 + 1e-6 && dx * 0.5 + dy * (SQ3 / 2) <= SQ3 / 2 + 1e-6) { inside = true; break; } }
  return inside ? d : -d;
}
/**
 * Where a territory's army stands, and how much room it has there: its own middle where that is open ground,
 * or else the widest ground it has (the middle of a crooked territory can lie on its edge, or outside it).
 */
const spot = [], room = [];
for (const t of T) {
  const [cx, cy] = CEN[t.id];
  let x = cx, y = cy, top = inset(t.id, cx, cy);
  if (top < 1.6) for (const h of byT[t.id]) for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const px = h.x + i * (SQ3 / 8), py = h.y + j * 0.25, c = inset(t.id, px, py) - Math.hypot(px - cx, py - cy) * 0.02;
    if (c > top) { top = c; x = px; y = py; }
  }
  spot.push([x, y]); room.push(inset(t.id, x, y));
}
/** A lake's garrison stands on an islet, which is no wider than its lake. */
const isletSize = T.map((t) => (t.biome === 'lake' ? clamp((room[t.id] - 0.1) / 1.4, 0.6, 1) : 0));
for (const t of T) if (isletSize[t.id]) room[t.id] = Math.min(room[t.id], 1.15 * isletSize[t.id]);
/**
 * A Keep's ground has to hold a castle, the garrison in the yard before its gate, its Primus and its Standard.
 * The castle is set down, and turned, wherever that leaves all of them the most room: facing south if it can.
 */
const CASTLE = 0.72; // how large a castle is built
const court = {};
for (const t of KEEP) {
  // In the castle's own frame (x along the gate wall, y out through the gate): its four corner towers, its gate,
  // and the room the garrison, the Primus and the Standard each need.
  const h = 1.3 * CASTLE, tw = 0.44 * CASTLE + 0.02;
  const need = [[-h, -h, tw], [h, -h, tw], [-h, h, tw], [h, h, tw], [0, h + 0.3, 0.1], [0.62, h + 1.1, 0.85], [-0.72, h + 0.82, 0.62], [1.5, h + 0.42, 0.42]];
  let best = null;
  for (const flip of [1, -1]) for (let a = 0; a < 12; a++) {
    const th = -Math.PI / 2 + (a * Math.PI) / 6, fx = Math.cos(th), fy = Math.sin(th), turned = 0.12 * (1 - Math.cos((a * Math.PI) / 6));
    for (const hx of byT[t]) for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
      const ox = hx.x + i * 0.18, oy = hx.y + j * 0.18, at = ([lx, ly]) => [ox - lx * flip * fy + ly * fx, oy + lx * flip * fx + ly * fy];
      let worst = 0.3;
      for (const p of need) { const [px, py] = at(p); worst = Math.min(worst, inset(t, px, py) - p[2]); if (best && worst - turned <= best.score) break; }
      if (!best || worst - turned > best.score) best = { score: worst - turned, x: ox, y: oy, th, at };
    }
  }
  const [squad, general, standard] = need.slice(5).map(best.at);
  court[t] = { x: best.x, y: best.y, turn: Math.atan2(Math.cos(best.th), -Math.sin(best.th)), squad, general, standard };
  spot[t] = squad; room[t] = inset(t, squad[0], squad[1]);
}


await pause("the rifts");
// =============================================================================
// the rifts: where two quadrants stand apart, the ground between them has fallen away

/** How far a point of the map is from land (negative inside it), and how high the nearest land stands. */
function landAt(x, y) {
  const r0 = Math.round(y / 1.5), q0 = Math.round(x / SQ3 - r0 / 2);
  let d = 9, sum = 0, wsum = 0;
  for (let dr = -2; dr <= 2; dr++) for (let dq = -2; dq <= 2; dq++) {
    const h = hexAt.get((q0 + dq) + ',' + (r0 + dr));
    if (!h) continue;
    // the distance to a six-sided cell: fold the point into one sixth of it, and measure to that edge
    let px = Math.abs(y - h.y), py = Math.abs(x - h.x);
    const k = Math.min(0.5 * py - 0.8660254 * px, 0);
    px += k * 1.7320508; py -= k;
    px -= clamp(px, -0.5, 0.5); py -= 0.8660254;
    const v = Math.hypot(px, py) * Math.sign(py), w = 1 / Math.pow(Math.max(v, 0) + 0.08, 4);
    if (v < d) d = v;
    sum += topH[h.t] * w; wsum += w;
  }
  return [d, wsum ? sum / wsum : 0.6];
}
/** Each rift's own bearings: the way it runs out from the middle of the valley. */
const RIFTS = STRAITS.map((st, i) => ({ i, ca: Math.cos(st.angle), sa: Math.sin(st.angle) }));
/** How deep a rift is cut, and the first rank of the ridge, which it runs out into. */
const RIFT_DEEP = -3.1, FOOTHILLS = [R_OUT - 1.5, R_OUT + 17, 8, 5];
/**
 * How far to either side of its middle a rift reaches, `s` out from the middle of the valley. Between two quadrants
 * it is as wide as the land leaves it; past the last of the land it is a gorge in the foothills, closing as it climbs.
 */
const riftHalf = (s) => 3.4 - 1.9 * smooth(R_OUT - 1.6, R_OUT - 0.2, s) - 1.15 * smooth(R_OUT, R_OUT + 7, s);
const riftWobble = (x, y, i) => (fbm(x * 0.7 + i * 3.3, y * 0.7, 77, 2) - 0.5) * 0.7;
/**
 * How deep a rift's floor lies, `s` out. A sill of rock across its mouth holds the sea out of it; behind the sill it
 * drops to its full depth, and at its head it climbs into the foothills.
 */
function riftFloor(s, i) {
  const sill = -1.6 + (SEA_Y + 0.8 + 1.6) * smooth(R_IN + 1.4, R_IN + 2.9, s);
  const deep = RIFT_DEEP + (fbm(s * 0.45, i * 9.1, 141, 2) - 0.5) * 0.9;
  return sill + (deep - sill) * smooth(R_IN + 3.9, R_IN + 5.6, s) + 5.2 * Math.pow(smooth(R_OUT - 0.5, R_OUT + 7.5, s), 1.3);
}
/**
 * The ground of a rift at a point of the map: its height, how far inside the rift's walls the point lies (negative
 * outside them), how far it is from land, how far out, and how deep in shadow. The walls come straight down from
 * the land's edge, break in a ledge, and end in a floor of broken rock.
 */
function riftAt(rf, x, y) {
  const s = x * rf.ca + y * rf.sa, c = y * rf.ca - x * rf.sa;
  const [d, land] = landAt(x, y);
  const floor = riftFloor(s, rf.i);
  const raw = ridgeRaw(x, -y, ...FOOTHILLS), ec = riftHalf(s) - Math.abs(c) - riftWobble(x, y, rf.i);
  // its lip: the land's edge where there is land, and the foothills' own slope where it has run on past the land
  const gorge = smooth(0, 0.8, raw - floor), hill = raw + 0.05 * gorge - 0.3 * (1 - gorge);
  const lip = hill + (land - 0.3 - hill) * smooth(1.5, 0.5, d) * smooth(-0.3, 0.1, ec);
  const e = Math.min(d, ec);
  let h;
  if (e <= 0) h = lip + e * (d < ec ? 2.2 : 0.6); // under the land, or out under the foothills: out of sight
  else {
    const k = e * (0.75 + 0.6 * fbm(x * 1.7, y * 1.7, 93 + rf.i, 2)), drop = Math.max(0, lip - floor);
    const down = 0.5 * smooth(0, 0.26, k) + 0.16 * smooth(0.26, 0.6, k) + 0.34 * smooth(0.5, 0.95, k);
    h = lip - drop * down + (crests(x * 5.5, -y * 5.5, 31 + rf.i) - 0.32) * (0.35 + 0.95 * smooth(0.45, 1.0, k)) * smooth(0, 0.14, e) * Math.min(1, drop / 2);
  }
  return { h, e, d, s, shade: 1 - 0.5 * smooth(0.3, 3.4, lip - h) };
}
/** Where a rift's sill stands out of the sea, for the water to break on, and its waterline, for boulders to lie along: [x, z]. */
const riftShore = [], riftToe = [];
{
  // The ridge's own red-brown rock, its beds showing in the walls. (Only the sill at a rift's mouth is ever wet.) Out
  // in the foothills it is the foothills' own ground, scrub and all, down to where the gorge gets too deep for scrub.
  const look = { scale: 0.6, bump: 1.5, lo: '#3a2820', hi: '#9a735c', strata: [0.34, 2.6], dim: U.pol };
  const dry = rockMaterial({ ...look, vertexColors: true }), wet = rockMaterial({ ...look, vertexColors: true, wet: SEA_Y + 0.08 });
  const hills = rockMaterial({ vertexColors: true, scale: 0.17, bump: 1.25, lo: '#33231d', hi: '#80604e', scrub: [1.5, 5.5], scrubCol: '#3f3a22', scrubFrom: -2.2, strata: [0.3, 2.6], dim: U.pol });
  const STEP = 0.12, HALF = 3.6, S0 = R_IN + 1.2, S1 = R_OUT + 8.4, nc = Math.round((2 * HALF) / STEP), ns = Math.round((S1 - S0) / STEP);
  const stones = [];
  for (const rf of RIFTS) {
    const n = (nc + 1) * (ns + 1), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), inside = new Float32Array(n), far = new Float32Array(n), idxWet = [], idxDry = [], idxHills = [];
    for (let j = 0; j <= ns; j++) for (let i = 0; i <= nc; i++) {
      const s = S0 + j * STEP, c = -HALF + i * STEP, x = rf.ca * s - rf.sa * c, y = rf.sa * s + rf.ca * c, o = j * (nc + 1) + i, p = riftAt(rf, x, y);
      pos[o * 3] = x; pos[o * 3 + 1] = p.h; pos[o * 3 + 2] = -y;
      col[o * 3] = col[o * 3 + 1] = col[o * 3 + 2] = p.shade;
      inside[o] = p.e; far[o] = p.d;
      if (p.d > -0.1 && p.h > SEA_Y && s < R_IN + 4.6) riftShore.push([x, -y]);
      if (p.d > 0.15 && Math.abs(p.h - SEA_Y) < 0.09 && s < R_IN + 3.2) riftToe.push([x, -y]);
    }
    // only what shows: not the rock under the land or out under the foothills, nor what lies under the sea
    for (let j = 0; j < ns; j++) for (let i = 0; i < nc; i++) {
      const a = j * (nc + 1) + i, b = a + 1, c = a + nc + 1, e = c + 1, s = S0 + j * STEP;
      if (Math.max(far[a], far[b], far[c], far[e]) < 0 || Math.max(inside[a], inside[b], inside[c], inside[e]) < -0.6) continue;
      if (s < R_IN + 3 && Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1], pos[e * 3 + 1]) < SEA_Y - 0.3) continue;
      (s < R_IN + 3.6 ? idxWet : s > R_OUT - 0.4 ? idxHills : idxDry).push(a, c, b, b, c, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idxWet.concat(idxDry, idxHills));
    geo.addGroup(0, idxWet.length, 0); geo.addGroup(idxWet.length, idxDry.length, 1); geo.addGroup(idxWet.length + idxDry.length, idxHills.length, 2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, [wet, dry, hills]);
    m.receiveShadow = true; // (the land on either side throws its shadow down into it)
    scene.add(m);
    // What has fallen from its walls lies along its floor.
    for (let s = R_IN + 5.4, k = rf.i * 500; s < R_OUT - 0.2; s += 0.3, k++) {
      const c0 = (rnd(k, 81) - 0.5) * 3.2;
      let best = null;
      for (const dc of [0, -0.5, 0.5, -1, 1]) { const c = c0 + dc, x = rf.ca * s - rf.sa * c, y = rf.sa * s + rf.ca * c, p = riftAt(rf, x, y); if (!best || p.e > best.e) best = { ...p, x, y }; }
      if (best.e < 0.95) continue;
      const size = 0.45 + 1.2 * Math.pow(rnd(k, 82), 2);
      stones.push({ x: best.x, y: best.h + size * 0.1, z: -best.y, sx: size, sy: size * (0.6 + rnd(k, 83) * 0.5), sz: size * (0.8 + rnd(k, 84) * 0.4), ry: rnd(k, 85) * TAU, v: Math.min(1, best.shade * (1.15 + rnd(k, 86) * 0.4)), shape: rnd(k, 87) < 0.5 ? 0 : 1 });
    }
  }
  const shapes = [boulder(0.5, 41), boulder(0.5, 57, 2, 0.7)], stone = rockMaterial({ ...look, scale: 0.9 }), o = new THREE.Object3D(), c = new THREE.Color();
  shapes.forEach((shape, k) => {
    const list = stones.filter((p) => p.shape === k);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(shape, stone, list.length);
    list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.ry, 0); o.scale.set(p.sx, p.sy, p.sz); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.setScalar(p.v)); });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  });
}


await pause("the shores");
// =============================================================================
// the shore: a harbour wherever a sea lane lands, and boulders along the waterline

/**
 * Per port territory: its pier's foot at the waterline and the way the pier runs; the quay at the head of its steps
 * and the end of the pier, which an army walks to go aboard; and where a ship lies off the pier's head.
 */
const harbour = {};
const harbourHex = new Set();
{
  const WOOD = '#7a5b3c', PLANK = '#8f7150', PILE = '#4b3726', STONE = '#9a8d7c', TILE = '#8f4b35', CRATE = '#8c6d49', CASK = '#6b4a30';
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffcf80' });
  for (const [pa, pb] of G.ports) for (const [t, other] of [[pa, pb], [pb, pa]]) {
    // the stretch of this territory's coast that looks across at the other port
    const tx = CEN[other][0] - CEN[t][0], tz = -(CEN[other][1] - CEN[t][1]), tl = Math.hypot(tx, tz);
    let best = null, score = -1e9;
    for (const e of coast) {
      if (e.t !== t) continue;
      const mx = (e.wa.x + e.wb.x) / 2, mz = (e.wa.z + e.wb.z) / 2, ex = (e.a.x + e.b.x) / 2, ez = (e.a.z + e.b.z) / 2, back = Math.hypot(mx - ex, mz - ez), ox = (mx - ex) / back, oz = (mz - ez) / back;
      const s = (ox * tx + oz * tz) / tl - Math.hypot(mx, mz) * 0.05;
      if (s > score) { score = s; best = { e, mx, mz, ox, oz, back, top: (e.a.y + e.b.y) / 2 - SEA_Y }; }
    }
    if (!best) continue;
    // Built lying along x from the waterline out to sea, with the sea's surface at y = 0.
    const { mx, mz, ox, oz, back, top } = best, L = 2.5, deck = 0.3, parts = [];
    for (let i = 0; i < 11; i++) parts.push([box(L / 11 - 0.012, 0.05, 0.46), i % 2 ? WOOD : PLANK, mat4(-0.1 + (i + 0.5) * (L / 11), deck, 0)]);
    parts.push([box(0.8, 0.05, 1.2), WOOD, mat4(L + 0.28, deck, 0)]);
    for (const x of [0.15, 0.9, 1.65, 2.3]) for (const z of [-0.2, 0.2]) parts.push([cyl(0.045, 0.05, 1.0, 7), PILE, mat4(x, deck - 0.44, z)]);
    for (const x of [L - 0.05, L + 0.6]) for (const z of [-0.54, 0.54]) parts.push([cyl(0.05, 0.055, 1.06, 7), PILE, mat4(x, deck - 0.4, z)]);
    for (const z of [-0.4, 0.4]) parts.push([cyl(0.045, 0.055, 0.16, 7), PILE, mat4(L + 0.55, deck + 0.1, z)]);
    parts.push([box(0.22, 0.2, 0.22), CRATE, mat4(L + 0.05, deck + 0.125, -0.38, 1, 1, 1, 0, 0.3, 0)], [box(0.16, 0.15, 0.16), '#7a5d3e', mat4(L + 0.3, deck + 0.1, -0.44, 1, 1, 1, 0, -0.2, 0)],
      [cyl(0.085, 0.085, 0.2, 10), CASK, mat4(L + 0.02, deck + 0.125, 0.42)], [cyl(0.018, 0.024, 0.8, 6), PILE, mat4(L + 0.6, deck + 0.42, -0.52)], [box(0.03, 0.02, 0.16), PILE, mat4(L + 0.6, deck + 0.8, -0.45)]);
    // steps down the bank from the land, and a landing at their head
    const xTop = -back - 0.02, xBot = -0.08, yTop = top - 0.03, n = Math.max(3, Math.ceil((yTop - deck) / 0.13));
    for (let i = 0; i <= n; i++) { const u = i / n; parts.push([box((xBot - xTop) / n + 0.04, 0.05, 0.44), i % 2 ? PLANK : WOOD, mat4(xTop + (xBot - xTop) * u, yTop + (deck - yTop) * u, 0)]); }
    for (const z of [-0.2, 0.2]) parts.push([rod([xTop, yTop - 0.07, z], [xBot, deck - 0.07, z], 0.03, 0.03, 6), PILE], [cyl(0.04, 0.045, (yTop + deck) / 2 + 0.5, 6), PILE, mat4((xTop + xBot) / 2, (yTop + deck) / 4 - 0.25, z)]);
    parts.push([box(0.5, 0.05, 0.62), WOOD, mat4(xTop - 0.22, top + 0.015, 0)]);
    // the harbourmaster's house, with what came off the last ship stacked beside it
    const hx = xTop - 0.8, hz = 0.42;
    parts.push([box(0.6, 0.36, 0.46), STONE, mat4(hx, top + 0.18, hz)], [gable(0.7, 0.58, 0.2), TILE, mat4(hx, top + 0.36, hz)], [box(0.02, 0.2, 0.12), '#2a1d14', mat4(hx + 0.305, top + 0.1, hz)],
      [box(0.2, 0.2, 0.2), CRATE, mat4(hx + 0.12, top + 0.1, hz - 0.42, 1, 1, 1, 0, 0.4, 0)], [cyl(0.08, 0.08, 0.2, 10), CASK, mat4(hx - 0.16, top + 0.1, hz - 0.4)]);
    // (No boat lies here: a ship comes to the pier only when an army is to cross.)
    const g = new THREE.Group(), pier = new THREE.Mesh(fuse(parts), woodMat), bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), lampMat);
    pier.castShadow = true; pier.receiveShadow = true;
    bulb.position.set(L + 0.6, deck + 0.72, -0.38);
    g.add(pier, bulb);
    g.position.set(mx, SEA_Y, mz);
    g.rotation.y = Math.atan2(-oz, ox);
    g.traverse((o) => { if (o.isMesh) o.userData.t = t; });
    scene.add(g);
    const along = (d, y) => new THREE.Vector3(mx + ox * d, SEA_Y + y, mz + oz * d);
    harbour[t] = { x: mx, z: mz, ox, oz, len: L + 0.7, quay: along(-back - 0.3, top + 0.02), head: along(L + 0.25, deck + 0.03), berth: along(L + 3.3, 0) };
    harbourHex.add(best.e.h);
  }
}

/** The boulders that stand in the water, as [x, z, radius]: the sea foams round each one. */
const wetRocks = [];
{
  const shapes = [boulder(0.5, 11), boulder(0.5, 23), boulder(0.5, 37, 2, 0.7)];
  const mat = rockMaterial({ scale: 1.1, lo: '#4b4139', hi: '#a39483', wet: SEA_Y + 0.1 });
  const lists = shapes.map(() => []);
  const nearPier = (x, z) => Object.values(harbour).some((p) => { const dx = x - p.x, dz = z - p.z, along = dx * p.ox + dz * p.oz; return along > -1.6 && along < p.len + 0.8 && Math.abs(dx * p.oz - dz * p.ox) < 1.3; });
  coast.forEach((e, i) => {
    const r = (k) => rnd(i * 3.17 + k, e.t * 1.31 - k * 0.7);
    const ox = (e.wa.x + e.wb.x - e.a.x - e.b.x) / 2, oz = (e.wa.z + e.wb.z - e.a.z - e.b.z) / 2, ol = Math.hypot(ox, oz), drop = ((e.a.y + e.b.y) / 2 - SEA_Y) / ol;
    const put = (u, off, s, tall) => {
      const x = e.wa.x + (e.wb.x - e.wa.x) * u + (ox / ol) * off, z = e.wa.z + (e.wb.z - e.wa.z) * u + (oz / ol) * off;
      if (nearPier(x, z)) return;
      // On the beach it lies on the slope; in the water it stands on the bottom with its head out.
      const y = off < 0 ? SEA_Y - off * drop + s * 0.1 : SEA_Y - s * 0.1;
      lists[Math.floor(r(u * 97 + 3) * shapes.length)].push({ x, y, z, sx: s * (0.85 + r(u * 31) * 0.4), sy: s * (tall ? 1.7 : 0.6 + r(u * 53) * 0.35), sz: s * (0.8 + r(u * 71) * 0.4), ry: r(u * 13) * 6.283, v: 0.85 + r(u * 7) * 0.3 });
      if (off > -0.15) wetRocks.push([x, z, s * 0.5]);
    };
    const n = r(1) < 0.14 ? 0 : r(1) < 0.45 ? 1 : r(1) < 0.78 ? 2 : r(1) < 0.94 ? 3 : 4;
    for (let j = 0; j < n; j++) put(0.08 + 0.84 * r(10 + j * 5), -0.6 + 1.3 * Math.pow(r(11 + j * 5), 1.1), 0.24 + 0.7 * Math.pow(r(12 + j * 5), 2.2), false);
    // here and there an outcrop the beach runs up against, and now and then a stack standing off the shore
    if (r(40) < 0.13) { put(0.3 + 0.4 * r(41), -0.15 + 0.3 * r(42), 1.0 + 0.5 * r(43), false); put(0.2 + 0.6 * r(44), 0.35 + 0.3 * r(45), 0.45 + 0.2 * r(46), false); }
    if (r(30) < 0.06) put(0.5, 1.5 + r(31) * 1.3, 0.8 + r(32) * 0.5, true);
  });
  // Where the sill across a rift's mouth meets the sea it breaks up into boulders of its own red rock.
  riftToe.forEach(([x0, z0], i) => {
    if (rnd(i, 61) > 0.34) return;
    const s = 0.3 + 0.8 * Math.pow(rnd(i, 62), 2), x = x0 + (rnd(i, 63) - 0.5) * 0.9, z = z0 + (rnd(i, 64) - 0.5) * 0.9;
    if (nearPier(x, z)) return;
    lists[Math.floor(rnd(i, 65) * shapes.length)].push({ x, y: SEA_Y - s * 0.08, z, sx: s, sy: s * (0.6 + rnd(i, 66) * 0.45), sz: s * (0.8 + rnd(i, 67) * 0.4), ry: rnd(i, 68) * 6.283, v: 0.78 + rnd(i, 69) * 0.22, red: true });
    wetRocks.push([x, z, s * 0.5]);
  });
  const o = new THREE.Object3D(), c = new THREE.Color();
  lists.forEach((list, k) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(shapes[k], mat, list.length);
    list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.ry, 0); o.scale.set(p.sx, p.sy, p.sz); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, p.red ? c.setRGB(p.v, p.v * 0.78, p.v * 0.68) : c.setScalar(p.v)); });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  });
}


await pause("the lakes");
// =============================================================================
// the lakes: banks that come down to the water from the land around, a shore, shallows, and the island each garrison holds

/**
 * How high a lake's bank stands at a corner of its border: as high as the highest land that meets it there, or, where
 * only water and open ground do, a low bar.
 */
function lakeRim(c, t) {
  let land = -9, mere = topH[t];
  for (const o of c.others) if (o >= 0) { if (T[o].biome === 'lake') mere = Math.min(mere, topH[o]); else land = Math.max(land, topH[o]); }
  return land > -9 ? land - 0.12 : mere - 0.09;
}
/**
 * And along the border between two corners, `v` of the way from the first: level with whatever lies across it (a
 * territory, or null for open ground), but for the climb to a corner where higher land stands.
 */
function lakeBank(ca, cb, t, across, v) {
  const ha = lakeRim(ca, t), hb = lakeRim(cb, t);
  if (across == null) return ha + (hb - ha) * v;
  const level = T[across].biome === 'lake' ? Math.min(topH[t], topH[across]) - 0.09 : topH[across] - 0.12;
  return level + (ha - level) * (1 - smooth(0, 0.42, v)) + (hb - level) * smooth(0.58, 1, v);
}
/** Per lake: how high its water stands, the lie of its ground, and where nothing should grow (its island, the neck out to it, its harbour). */
const lakeOf = {};
const lakeWater = { pos: [], depth: [], terr: [], ice: [], idx: [] };
{
  const N = LAKE_CUT;
  const ROUND = 5; // how far the corners of its border are rounded out of its shore: about a fifth of a hex
  const over = (a, b) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + 0.0016)); // the higher of two grounds, without a crease
  const tone = (biome) => mix3(lin(hex2rgb(BIOME[biome].pal[1])), lin(hex2rgb(BIOME[biome].pal[2])), 0.5), TURF = tone('plain'), SHINGLE = tone('lake');
  for (const t of T) {
    if (t.biome !== 'lake') continue;
    const id = t.id, D = topH[id], size = isletSize[id], S = spot[id], top = D + 0.15 * size;
    // Its border: every corner, and every edge with how high the bank stands along it and what ground lies beyond.
    const rimOf = new Map(), edges = [];
    const rimAt = (c) => {
      let r = rimOf.get(c);
      if (!r) rimOf.set(c, r = { c, x: c.x, y: c.y, px: c.x + c.ix * 0.05, py: c.y + c.iy * 0.05, hgt: lakeRim(c, id), land: c.others.some((o) => o >= 0 && T[o].biome !== 'lake') });
      return r;
    };
    let low = D - 0.24;
    for (const h of byT[id]) for (let k = 0; k < 6; k++) {
      const n = (k + 1) % 6, a = cornerInfo(h, k), b = cornerInfo(h, n), nb = hexAt.get((h.q + DIR[n][0]) + ',' + (h.r + DIR[n][1]));
      if (a.border) rimAt(a);
      if (nb && nb.t === id) continue;
      const across = nb ? nb.t : null, dry = across != null && T[across].biome !== 'lake';
      edges.push({ a: rimAt(a), b: rimAt(b), rim: (u) => lakeBank(a, b, id, across, u), col: dry ? tone(T[across].biome) : SHINGLE });
      low = Math.min(low, lakeBank(a, b, id, across, 0.5) - (dry ? 0.24 : 0.1));
    }
    const rims = [...rimOf.values()];
    // Its water lies well below the lowest of its banks.
    const water = low;
    // The island is joined to the land: a neck of shingle runs out to it from the nearest low corner of the shore.
    let Q = rims[0], qd = 1e9;
    for (const r of rims) { const d = Math.hypot(r.x - S[0], r.y - S[1]) + (r.hgt - water) * 0.5 + (r.land ? 0 : 3); if (d < qd) { qd = d; Q = r; } }
    const nx = Q.x - S[0], ny = Q.y - S[1], nl2 = nx * nx + ny * ny;
    const neckOff = (x, y) => { const u = clamp(((x - S[0]) * nx + (y - S[1]) * ny) / nl2, 0, 1); return Math.hypot(x - S[0] - nx * u, y - S[1] - ny * u); };
    // (A lake with a harbour keeps a yard of dry ground at the head of its pier, for the harbourmaster's house.)
    const hb = harbour[id], back = hb ? -((hb.quay.x - hb.x) * hb.ox + (hb.quay.z - hb.z) * hb.oz) - 0.3 : 0;
    const yard = (x, y) => {
      if (!hb) return 0;
      const lx = (x - hb.x) * hb.ox + (-y - hb.z) * hb.oz, lz = (-y - hb.z) * hb.ox - (x - hb.x) * hb.oz;
      return smooth(-back - 1.6, -back - 1.3, lx) * smooth(-0.85, -0.55, lz) * smooth(1.15, 0.85, lz);
    };
    /**
     * What its border means for a point of the lake: how near it is, and how near once its corners are rounded off;
     * how high the bank stands on the nearest stretch of it; and the colour of the ground beyond.
     */
    const survey = (x, y) => {
      let near = 1e9, acc = 0, sw = 0, sh = 0, r = 0, g = 0, b = 0;
      for (const e of edges) {
        const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y, u = clamp((x - e.a.x) * ex + (y - e.a.y) * ey, 0, 1), dist = Math.hypot(x - e.a.x - ex * u, y - e.a.y - ey * u), w = 1 / ((dist * dist + 1e-4) ** 2);
        if (dist < near) near = dist;
        acc += Math.exp(-ROUND * dist); sw += w; sh += w * e.rim(u); r += w * e.col[0]; g += w * e.col[1]; b += w * e.col[2];
      }
      return { near, soft: -Math.log(acc) / ROUND, rim: sh / sw, col: [r / sw, g / sw, b / sw] };
    };
    const ground = (x, y, sv = survey(x, y)) => {
      const rise = sv.rim - water, out = Math.hypot(x - S[0], y - S[1]);
      const d = sv.soft + (fbm(x * 0.8 + id * 3.7, y * 0.8, 211, 3) - 0.5) * 0.5 * smooth(0.03, 0.35, sv.near);
      // The bank: wider where it has further to come down, and drawn back near the island so that water runs round it.
      const wide = clamp(0.3 + 0.22 * rise, 0.36, 0.7) * (1 - 0.5 * smooth(2.6 * size, 1.8 * size, out));
      let h = d < wide ? water + rise * Math.pow(1 - Math.max(d, 0) / wide, 1.5) : water - Math.min(0.6, (d - wide) * 0.9);
      // The island: flat on top for its garrison, a step of rock down to the water, and shoals round its foot.
      const ang = Math.atan2(y - S[1], x - S[0]), r = out / (size * (1 + 0.12 * (0.5 + 0.5 * Math.sin(ang * 3 + id)) + 0.06 * (0.5 + 0.5 * Math.sin(ang * 7 + id * 2.3))));
      h = over(h, top - (top - water + 0.08) * smooth(1.02, 1.22, r) - 0.5 * smooth(1.18, 1.75, r));
      // The neck out to it.
      const wob = fbm(x * 1.9 + id, y * 1.9, 223, 2) - 0.5;
      h = over(h, water + 0.15 + wob * 0.06 - 0.75 * smooth(0.26, 0.85, neckOff(x, y) + wob * 0.3));
      const k = yard(x, y);
      return k ? h + (Math.max(h, hb.quay.y - 0.02) - h) * k : h;
    };
    // Its ground: every hex cut into small triangles that share their corners, so that the whole lake is one smooth surface.
    const index = new Map(), P = [], uvs = [], aB = [], aG = [], tint = [], corners = [], deep = [], idx = [];
    const vertex = (x, y, fix) => {
      const key = Math.round(x * 1000) + ',' + Math.round(y * 1000);
      let i = index.get(key);
      if (i != null) return i;
      index.set(key, i = P.length / 3);
      const sv = survey(x, y), [px, py, h] = fix ?? [x, y, ground(x, y, sv)];
      // (for the band that marks the border: how far in from it this lies, and the corner of it nearest)
      let nr = rims[0], nd = 1e9;
      for (const r of rims) { const d = Math.hypot(x - r.x, y - r.y); if (d < nd) { nd = d; nr = r; } }
      const band = clamp(1 - sv.near / 0.346, 0, 1), c = mix3(sv.col, TURF, smooth(0.5, 1.2, sv.near));
      P.push(px, h, -py); uvs.push(px * UV, -py * UV); aB.push(band); aG.push(nr.c.region ? band : 0); tint.push(c[0], c[1], c[2]); corners.push(band > 0 ? nr.c : null); deep.push(water - h);
      return i;
    };
    for (const h of byT[id]) for (let k = 0; k < 6; k++) {
      const n = (k + 1) % 6, ca = cornerInfo(h, k), cb = cornerInfo(h, n), nb = hexAt.get((h.q + DIR[n][0]) + ',' + (h.r + DIR[n][1])), out = !nb || nb.t !== id, row = [];
      for (let i = 0; i <= N; i++) {
        row.push([]);
        for (let j = 0; j <= i; j++) {
          const u = i / N, v = j / N, x = h.x + (ca.x - h.x) * u + (cb.x - ca.x) * v, y = h.y + (ca.y - h.y) * u + (cb.y - ca.y) * v;
          // (on the border itself it stands where the border does, at the height of the bank there)
          let fix = null;
          if (i === N) {
            const a = ca.border ? rimAt(ca) : null, b = cb.border ? rimAt(cb) : null;
            if (out) fix = [a.px + (b.px - a.px) * v, a.py + (b.py - a.py) * v, lakeBank(ca, cb, id, nb ? nb.t : null, v)];
            else if (j === 0 && a) fix = [a.px, a.py, a.hgt];
            else if (j === N && b) fix = [b.px, b.py, b.hgt];
          }
          row[i].push(vertex(x, y, fix));
        }
      }
      for (let i = 0; i < N; i++) for (let j = 0; j <= i; j++) {
        idx.push(row[i][j], row[i + 1][j], row[i + 1][j + 1]);
        if (j < i) idx.push(row[i][j], row[i + 1][j + 1], row[i][j + 1]);
      }
    }
    const geo = new THREE.BufferGeometry(), nv = P.length / 3;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 1));
    geo.setAttribute('aR', new THREE.BufferAttribute(new Float32Array(nv), 1));
    geo.setAttribute('aG', new THREE.Float32BufferAttribute(aG, 1));
    geo.setAttribute('aF', new THREE.BufferAttribute(new Float32Array(nv), 1));
    geo.setAttribute('aBank', new THREE.Float32BufferAttribute(tint, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const { mat, uni } = plateMaterial(id, { water });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; // (it lies low: what stands round it throws the shadows)
    mesh.userData.t = id;
    land.add(mesh);
    plates[id] = { mesh, mat, uni, corners };
    paintFrontier(id);
    // Its water: a level sheet over the same ground, wherever any of that ground lies under it.
    const base = lakeWater.pos.length / 3;
    for (let i = 0; i < nv; i++) { lakeWater.pos.push(P[i * 3], water, P[i * 3 + 2]); lakeWater.depth.push(deep[i]); lakeWater.terr.push(id); lakeWater.ice.push(t.quadrant === 2 ? 1 : 0); }
    for (let i = 0; i < idx.length; i += 3) if (Math.max(deep[idx[i]], deep[idx[i + 1]], deep[idx[i + 2]]) > 0) lakeWater.idx.push(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
    lakeOf[id] = { water, at: ground, neck: [Q.x, Q.y], clear: (x, y) => Math.hypot(x - S[0], y - S[1]) < 1.9 * size || neckOff(x, y) < 0.6 || yard(x, y) > 0 };
  }
}
const lakes = new THREE.BufferGeometry();
/** Lake water wears its holder's colour from far out: repaint it whenever land changes hands. */
function paintLakes() {
  const tint = lakes.attributes.aTint, own = lakes.attributes.aOwn, c = new THREE.Color();
  lakeWater.terr.forEach((t, i) => { c.set(colorOf(owner[t])); tint.setXYZ(i, c.r, c.g, c.b); own.setX(i, owner[t] >= 0 ? 1 : 0); });
  tint.needsUpdate = own.needsUpdate = true;
}
{
  const n = lakeWater.terr.length, up = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) up[i * 3 + 1] = 1;
  lakes.setAttribute('position', new THREE.Float32BufferAttribute(lakeWater.pos, 3));
  lakes.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  lakes.setAttribute('aDepth', new THREE.Float32BufferAttribute(lakeWater.depth, 1));
  lakes.setAttribute('aIce', new THREE.Float32BufferAttribute(lakeWater.ice, 1));
  lakes.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  lakes.setAttribute('aOwn', new THREE.BufferAttribute(new Float32Array(n), 1));
  lakes.setIndex(lakeWater.idx);
  paintLakes();
  // Still water. It mirrors the sky, is clear over the shingle at its edge, green over its shoals and dark over its
  // deeps, and lies in the shade of whatever stands beside it. In the Frostfangs it is frozen out from the shore.
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.14, metalness: 0, envMap: ENV, envMapIntensity: 1.1, transparent: true });
  const uni = { uTime: U.time, uRelief: { value: WATER_RELIEF }, uPol: U.pol, uDeep: { value: new THREE.Color('#0e313c') }, uShoal: { value: new THREE.Color('#3c8b82') } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'attribute vec3 aTint;\nattribute float aOwn;\nattribute float aDepth;\nattribute float aIce;\nvarying vec3 vTint;\nvarying float vOwn;\nvarying float vDepth;\nvarying float vIce;\nvarying vec3 vWp;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTint = aTint; vOwn = aOwn; vDepth = aDepth; vIce = aIce; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime;\nuniform sampler2D uRelief;\nuniform float uPol;\nuniform vec3 uDeep;\nuniform vec3 uShoal;\nvarying vec3 vTint;\nvarying float vOwn;\nvarying float vDepth;\nvarying float vIce;\nvarying vec3 vWp;\n'
      + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 lkP = vWp.xz;
          // two sets of ripples, crossing
          vec4 lkA = texture2D(uRelief, lkP * 0.23 + uTime * vec2(0.006, 0.004)), lkB = texture2D(uRelief, vec2(lkP.y, -lkP.x) * 0.61 + uTime * vec2(-0.011, 0.008));
          float lkDeep = vDepth + (lkA.a - 0.5) * 0.04;
          vec3 lkBody = mix(uShoal, uDeep, smoothstep(0.03, 0.46, lkDeep));
          float lkAlpha = smoothstep(0.0, 0.03, lkDeep) * mix(0.4, 0.96, smoothstep(0.0, 0.34, lkDeep));
          float lkIce = vIce * smoothstep(0.0, 0.02, lkDeep) * max(smoothstep(0.34, 0.26, lkDeep + (lkB.b - 0.5) * 0.3), smoothstep(0.60, 0.64, texture2D(uRelief, lkP * 0.09 + uTime * vec2(0.0015, 0.001)).a));
          lkBody = mix(lkBody, vec3(0.80, 0.87, 0.92) * (0.8 + 0.3 * lkB.b), lkIce);
          lkAlpha = mix(lkAlpha, 1.0, lkIce);
          // A held lake takes its holder's colour when the map is political: a deeper shade of it, so that it still reads as water.
          float lkPol = vOwn * 0.7 * smoothstep(0.45, 1.0, uPol);
          lkBody = mix(lkBody, mix(vTint, uDeep * 3.0, 0.4) * 0.5, lkPol);
          lkAlpha = mix(lkAlpha, max(lkAlpha, 0.9 * smoothstep(0.0, 0.03, lkDeep)), lkPol);
          diffuseColor = vec4(lkBody, lkAlpha);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.6, lkIce);')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 lkTilt = ((lkA.rg - 0.5) * 0.36 + vec2(-(lkB.g - 0.5), lkB.r - 0.5) * 0.26) * (1.0 - lkIce);
            normal = normalize((viewMatrix * vec4(-lkTilt.x, 1.45, -lkTilt.y, 0.0)).xyz);
          }`);
  };
  mat.customProgramCacheKey = () => 'lake';
  const mesh = new THREE.Mesh(lakes, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = -1; // (before anything else that is seen through, so that an arrow or a glow over a lake is drawn over its water)
  scene.add(mesh);
}


await pause("the sea");
// =============================================================================
// water: the sea beneath Olympus

/**
 * The coast seen from above, for the sea to read: how near the waterline a point is (R, blurred wide: the water
 * shoals toward it) and where the sea touches land or a boulder (G, blurred tight: foam gathers there).
 */
const MASK_SPAN = R_IN + 5;
const shoreMask = (() => {
  const S = 1024, k = S / (2 * MASK_SPAN), px = (x) => S / 2 + x * k;
  const paint = (rocks) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.fillStyle = g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    for (const h of HEX) {
      g.beginPath();
      CORNER.forEach(([cx, cy], i) => { const X = px(h.x + cx * 1.01), Y = px(-(h.y + cy * 1.01)); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.closePath(); g.fill();
    }
    // the beach above the waterline is land too
    for (const e of coast) { g.beginPath(); g.moveTo(px(e.a.x), px(e.a.z)); g.lineTo(px(e.b.x), px(e.b.z)); g.lineTo(px(e.wb.x), px(e.wb.z)); g.lineTo(px(e.wa.x), px(e.wa.z)); g.closePath(); g.fill(); g.stroke(); }
    // and so is the sill of rock across each rift's mouth
    for (const [x, z] of riftShore) { g.beginPath(); g.arc(px(x), px(z), 0.1 * k, 0, 6.2832); g.fill(); }
    if (rocks) for (const [x, z, r] of wetRocks) { g.beginPath(); g.arc(px(x), px(z), r * k, 0, 6.2832); g.fill(); }
    const d = g.getImageData(0, 0, S, S).data, f = new Float32Array(S * S);
    for (let i = 0; i < f.length; i++) f[i] = d[i * 4] / 255;
    return f;
  };
  const blur = (f, r) => {
    const tmp = new Float32Array(S * S), w = 2 * r + 1;
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < S; y++) {
        const row = y * S; let acc = 0;
        for (let x = -r; x <= r; x++) acc += f[row + clamp(x, 0, S - 1)];
        for (let x = 0; x < S; x++) { tmp[row + x] = acc / w; acc += f[row + Math.min(S - 1, x + r + 1)] - f[row + Math.max(0, x - r)]; }
      }
      for (let x = 0; x < S; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, S - 1) * S + x];
        for (let y = 0; y < S; y++) { f[y * S + x] = acc / w; acc += tmp[Math.min(S - 1, y + r + 1) * S + x] - tmp[Math.max(0, y - r) * S + x]; }
      }
    }
    return f;
  };
  const wide = blur(paint(false), 26), tight = blur(paint(true), 2), data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { data[i * 4] = wide[i] * 255; data[i * 4 + 1] = tight[i] * 255; data[i * 4 + 3] = 255; }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
})();
/**
 * What the sea is told each frame. Every ship: where it is and which way it is going; how fast (as a share of full
 * speed), how tightly it is turning, how large it is drawn, and whether it is there at all; the last stretch of water
 * its stern passed through, as points [x, z, when, how hard it was being driven]; and a box round all of that.
 * Then every waterfall's foot, and Olympus's shadow.
 */
const SHIPS = 2, TRAIL = 16;
U.ships = Array.from({ length: SHIPS }, () => new THREE.Vector4(0, 0, 1, 0));
U.shipK = Array.from({ length: SHIPS }, () => new THREE.Vector4(0, 0, 1, 0));
U.trail = Array.from({ length: SHIPS * TRAIL }, () => new THREE.Vector4(0, 0, -99, 0));
U.trailBox = Array.from({ length: SHIPS }, () => new THREE.Vector4(1, 1, -1, -1));
U.falls = [0, 1, 2, 3, 4].map(() => new THREE.Vector3(0, 0, 0));
const WATER_FRAG = `
  uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uSand; uniform vec3 uFoam; uniform vec3 uSkyLo; uniform vec3 uSkyHi;
  uniform sampler2D uRelief; uniform sampler2D uMask; uniform float uMaskSpan; uniform vec3 uFogCol; uniform float uFogNear; uniform float uFogFar;
  uniform vec4 uShip[${SHIPS}]; uniform vec4 uShipK[${SHIPS}]; uniform vec4 uTrail[${SHIPS * TRAIL}]; uniform vec4 uTrailBox[${SHIPS}]; uniform vec3 uFall[5]; uniform vec3 uShade;
  varying vec3 vW;
  // One set of waves: the relief laid at a scale and a bearing, and drifting. Gives the slope (xy) and the height (z).
  vec3 waves(vec2 p, float scale, vec2 cs, vec2 drift){
    vec4 t = texture2D(uRelief, vec2(cs.x * p.x - cs.y * p.y, cs.y * p.x + cs.x * p.y) * scale + drift * uTime);
    vec2 g = t.rg - 0.5;
    return vec3(cs.x * g.x + cs.y * g.y, cs.x * g.y - cs.y * g.x, t.b);
  }
  void main(){
    vec2 p = vW.xz;
    // a long swell, the waves on it, and the ripples on those
    vec3 w1 = waves(p, 0.036, vec2(0.970, 0.242), vec2(0.006, 0.004));
    vec3 w2 = waves(p, 0.105, vec2(0.602, -0.798), vec2(-0.012, 0.009));
    vec3 w3 = waves(p, 0.340, vec2(-0.416, 0.909), vec2(0.021, -0.018));
    vec2 slope = w1.xy * 1.1 + w2.xy * 0.85 + w3.xy * 0.5;
    float hgt = w1.z * 0.45 + w2.z * 0.35 + w3.z * 0.20;
    float grain = texture2D(uRelief, p * 0.19 + uTime * vec2(0.004, -0.006)).a;
    float foam = 0.0, slick = 0.0, wave = 0.0;
    vec2 mk = texture2D(uMask, p / uMaskSpan * 0.5 + 0.5).rg;
    float shoal = clamp(mk.r * 2.0, 0.0, 1.0); // 0 on open water, 1 at the waterline
    {
      // surf: where the sea touches land or rock, and thin lines of it running in over the shallows
      float touch = smoothstep(0.26, 0.62, mk.g + (grain - 0.5) * 0.75);
      float run = sin((shoal * 6.0 - uTime * 0.22 + grain * 1.1) * 6.2832);
      foam += touch * 0.85 + smoothstep(0.78, 0.98, run) * smoothstep(0.42, 0.7, shoal) * smoothstep(0.38, 0.62, grain) * 0.5;
      // Wakes. What a ship leaves behind is in the water, not towed along: it is drawn from where the ship has
      // been, so it lies along a curving course, and it is as long as the ship was fast.
      float lace = texture2D(uRelief, p * 0.37).a * 0.6 + texture2D(uRelief, p * 1.13 + 0.31).a * 0.4;
      for (int i = 0; i < ${SHIPS}; i++) {
        vec4 box = uTrailBox[i], K = uShipK[i];
        float size = K.z;
        if (p.x > box.x && p.y > box.y && p.x < box.z && p.y < box.w) {
          // the churned water astern: white where it is new, spreading and breaking into patches as it ages, and
          // leaving a smooth, paler road on the sea for a while after the white is gone
          float white = 0.0, road = 0.0;
          for (int j = 0; j < ${TRAIL - 1}; j++) {
            vec4 A = uTrail[i * ${TRAIL} + j], B = uTrail[i * ${TRAIL} + j + 1];
            if (A.w + B.w <= 0.0) continue;
            vec2 ab = B.xy - A.xy;
            float h = clamp(dot(p - A.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0), far = length(p - A.xy - ab * h);
            float age = max(uTime - mix(A.z, B.z, h), 0.0), drive = mix(A.w, B.w, h), wide = size * (0.2 + 0.34 * sqrt(age));
            white = max(white, drive * exp(-age / 0.9) * smoothstep(wide, wide * 0.15, far));
            road = max(road, drive * exp(-age / 3.2) * smoothstep(wide * 2.0, wide * 0.8, far));
          }
          white = min(white, 1.0);
          foam += white * smoothstep(0.8 - white * 0.85, 1.05 - white * 0.85, lace) * (0.7 + 0.42 * texture2D(uRelief, p * 2.9 + 0.17).a);
          slick = max(slick, min(road, 1.0));
        }
        float v = K.x;
        if (K.w > 0.0 && v > 0.02) {
          vec2 d = p - uShip[i].xy, f = uShip[i].zw, side = vec2(f.y, -f.x);
          float ahead = dot(d, f), off = dot(d, side), reach = size * (3.0 + 11.0 * v);
          float X = size * 1.5 - ahead; // how far astern of the bow
          if (X > -0.5 * size && X < reach && abs(off) < X * 0.45 + size) {
            // white water where the bow cuts in, and along the hull
            float along = ahead / (1.5 * size), beam = 0.34 * size * pow(max(1.0 - along * along, 0.0), 0.55);
            foam += K.w * v * smoothstep(0.17 * size, 0.03 * size, abs(abs(off) - beam)) * step(abs(along), 1.03) * (0.15 + 0.7 * smoothstep(-0.3, 1.0, along)) * (0.4 + 0.7 * lace);
            // The waves it sheds: the pattern every ship makes, whatever its speed. A wedge 19.5 degrees to either
            // side; within it waves that follow the ship square to its course, and along its arms waves that run
            // out at a slant, the two meeting in the feathered crests at its edge. Faster, and the waves are longer.
            float Y = off - K.y * X * X * 0.5; // (the wedge lies along the way the ship came)
            if (X > 0.0) {
              float t = abs(Y) / max(X, 0.02), tc = min(t, 0.3535), root = sqrt(max(1.0 - 8.0 * tc * tc, 0.0));
              float vv = max(v, 0.3), k0 = 6.2832 / (1.5 * size * vv * vv);
              float T1 = (1.0 - root) / max(4.0 * tc, 1e-3), s1 = sqrt(1.0 + T1 * T1), T2 = (1.0 + root) / max(4.0 * tc, 1e-3), s2 = sqrt(1.0 + T2 * T2);
              float ph1 = k0 * s1 * (X - abs(Y) * T1) - 0.785, ph2 = k0 * s2 * (X - abs(Y) * T2) + 0.785;
              float a1 = 0.55 * (1.0 - 0.6 * smoothstep(0.2, 0.35, t)), a2 = smoothstep(0.14, 0.3, t), sg = Y < 0.0 ? -1.0 : 1.0;
              float amp = K.w * v * v * smoothstep(0.43, 0.33, t) * (1.0 - smoothstep(0.55, 1.0, X / reach)) * smoothstep(0.0, 0.6 * size, X) / sqrt(1.0 + X / (1.2 * size));
              vec2 lean = -(a1 * sin(ph1) * vec2(1.0, -T1 * sg) / s1 + a2 * sin(ph2) * vec2(1.0, -T2 * sg) / s2) * amp * 1.7;
              slope -= f * lean.x - side * lean.y;
              wave += (a1 * cos(ph1) + a2 * cos(ph2)) * amp;
              // (their crests break white close to the ship)
              foam += smoothstep(0.55, 1.0, a2 * cos(ph2)) * amp * exp(-X / (size * (0.5 + 1.1 * v))) * 0.9 * lace;
            }
          }
        }
      }
      // where a waterfall lands: a boil of foam, and rings running out from it
      for (int i = 0; i < 5; i++) {
        vec2 d = p - uFall[i].xy; float r = length(d), s = uFall[i].z;
        float ring = sin(r * 7.0 - uTime * 4.5);
        foam += s * (exp(-r * r / 0.42) * (0.6 + 0.6 * grain) + smoothstep(0.7, 1.0, ring) * exp(-r * 0.85) * 0.2 * smoothstep(0.3, 0.7, grain));
        slope += s * (d / max(r, 0.001)) * ring * exp(-r * 0.6) * 0.5;
      }
    }
    // (in a ship's road the small waves are beaten flat)
    slope *= 1.0 - 0.62 * slick;
    hgt += wave * 0.5;
    vec3 n = normalize(vec3(-slope.x, 1.45, -slope.y));
    vec3 V = normalize(cameraPosition - vW);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(normalize(n + vec3(0.0, 1.6, 0.0)), V), 0.0, 1.0), 5.0);
    // the water itself: dark where it is deep, green-blue over the shoals, and the sand showing through at the edge
    vec3 body = mix(uDeep, uMid, smoothstep(0.0, 0.36, shoal));
    body = mix(body, uShallow, smoothstep(0.30, 0.78, shoal));
    body = mix(body, uSand, smoothstep(0.80, 1.0, shoal) * 0.5);
    body = mix(body, uShallow * 0.9, slick * 0.2);
    body *= 0.74 + 0.52 * hgt;
    body *= 0.66 + 0.5 * clamp(dot(n, uSun), 0.0, 1.0);
    body += uShallow * 0.16 * smoothstep(0.62, 0.95, hgt);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uSkyLo, uSkyHi, smoothstep(-0.05, 0.6, R.y));
    vec3 col = mix(body, sky, fres * 0.78);
    // the sun on it: a soft sheen, and small hard sparks off the finest ripples (which blur away with distance,
    // and are left out close to, where they would be seen for the flecks they are)
    vec3 Hs = normalize(uSun + V);
    float dist = length(cameraPosition - vW);
    vec3 w4 = waves(p, 1.0, vec2(0.276, 0.961), vec2(0.05, 0.03));
    vec3 nFine = normalize(vec3(-slope.x - w4.x * 1.5, 1.45, -slope.y - w4.y * 1.5));
    col += uSunCol * (pow(max(dot(n, Hs), 0.0), 55.0) * 0.10 + pow(max(dot(nFine, Hs), 0.0), 800.0) * 0.95 * smoothstep(7.0, 20.0, dist));
    {
      // Olympus hangs over the sea, and its shadow lies on it: long the way the sun throws it
      vec2 sd = normalize(uSun.xz), dq = p - uShade.xy;
      vec2 q = vec2(dot(dq, sd) * uSun.y, dq.x * sd.y - dq.y * sd.x) / uShade.z;
      float q2 = dot(q, q);
      col *= 1.0 - 0.58 * exp(-q2 * q2);
    }
    col = mix(col, uFoam * (0.80 + 0.2 * hgt), clamp(foam, 0.0, 1.0) * 0.92);
    col = mix(col, uFogCol, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
function seaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.time, uSun: { value: SUN }, uSunCol: { value: new THREE.Color('#ffe2b8') },
      uDeep: { value: new THREE.Color('#0a3a5c') }, uMid: { value: new THREE.Color('#12617f') }, uShallow: { value: new THREE.Color('#33ada6') },
      uSand: { value: new THREE.Color('#d8c99c') }, uFoam: { value: new THREE.Color('#f2f7f5') }, uSkyLo: { value: new THREE.Color('#c9a48e') }, uSkyHi: { value: new THREE.Color('#465a92') },
      uRelief: { value: WATER_RELIEF }, uMask: { value: shoreMask }, uMaskSpan: { value: MASK_SPAN },
      uFogCol: { value: SKY.haze }, uFogNear: U.fogNear, uFogFar: U.fogFar,
      uShip: { value: U.ships }, uShipK: { value: U.shipK }, uTrail: { value: U.trail }, uTrailBox: { value: U.trailBox }, uFall: { value: U.falls },
      // where the sun throws the shadow of something that high, and how wide the shadow is
      uShade: { value: new THREE.Vector3(-SUN.x / SUN.y * (OLY_Y - SEA_Y), -SUN.z / SUN.y * (OLY_Y - SEA_Y), 6.9) },
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: WATER_FRAG,
  });
}
{
  const sea = new THREE.Mesh(new THREE.CircleGeometry(R_IN + 3.4, 128), seaMaterial());
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y;
  scene.add(sea);
}


await pause("the ridge");
// =============================================================================
// the ridge: one wall of mountains in three ranks, each hazier than the last

/** Sharp-crested mountain noise, 0..1: each octave is folded into a ridge and weighted by the one before. */
function crests(x, z, seed) {
  const wx = x + (fbm(x * 0.03 + 5, z * 0.03, seed + 1, 3) - 0.5) * 16, wz = z + (fbm(x * 0.03, z * 0.03 + 9, seed + 2, 3) - 0.5) * 16;
  let sum = 0, a = 1, f = 0.05, norm = 0, prev = 1;
  for (let o = 0; o < 5; o++) {
    let n = 1 - Math.abs(2 * vnoise(wx * f, wz * f, seed + o * 13) - 1);
    n *= n;
    sum += n * a * prev; norm += a; prev = 0.35 + 0.65 * n; a *= 0.5; f *= 2.07;
  }
  return sum / norm;
}
/** How high a rank of the ridge would stand at a point, left whole: it climbs from its inner edge (r0 from the middle) and falls away to its outer (r1). */
function ridgeRaw(x, z, r0, r1, amp, seed) {
  const u = (Math.hypot(x, z) - r0) / (r1 - r0);
  if (u <= 0) return -0.8;
  const prof = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.03))), 0.8);
  // passes cut the wall into separate massifs
  const pass = 0.4 + 0.6 * smooth(0.32, 0.6, fbm(x * 0.021 + 40, z * 0.021, seed + 7, 2));
  return -0.8 + amp * prof * pass * (0.1 + 1.7 * crests(x, z, seed));
}
/** How high it does stand: the first rank has a gorge cut into it wherever a rift runs out of the valley. */
function ridgeHeight(x, z, r0, r1, amp, seed) {
  let h = ridgeRaw(x, z, r0, r1, amp, seed);
  if (r0 < R_OUT) for (const rf of RIFTS) {
    const s = x * rf.ca - z * rf.sa, c = -z * rf.ca - x * rf.sa;
    if (s < R_OUT - 3 || s > R_OUT + 9 || Math.abs(c) > 4.5) continue;
    // (cut a little wider than the rift itself, so that the rift's own walls are the ones seen)
    h -= smooth(-0.45, 0.05, riftHalf(s) - Math.abs(c) - riftWobble(x, -z, rf.i)) * Math.max(0, h - (riftFloor(s, rf.i) - 0.6));
  }
  return h;
}
/** Mars rock: red-brown, scrub on its lowest slopes, dusty snow on its heights. */
const ridgeMat = rockMaterial({ scale: 0.17, bump: 1.25, lo: '#33231d', hi: '#80604e', scrub: [1.5, 5.5], scrubCol: '#3f3a22', snow: [17, 26], snowCol: '#ddd5ce' });
function ridgeRing(r0, r1, amp, seed, na, nr) {
  const pos = new Float32Array((na + 1) * (nr + 1) * 3), idx = [];
  let o = 0;
  for (let j = 0; j <= nr; j++) {
    const u = j / nr, r = r0 + (r1 - r0) * u;
    for (let i = 0; i <= na; i++) {
      const a = (i / na) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos[o++] = x; pos[o++] = ridgeHeight(x, z, r0, r1, amp, seed); pos[o++] = z;
    }
  }
  for (let j = 0; j < nr; j++) for (let i = 0; i < na; i++) {
    const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The ring closes on itself: its first and last columns stand in the same place, and must be lit the same.
  const n = geo.attributes.normal;
  for (let j = 0; j <= nr; j++) {
    const a = j * (na + 1), b = a + na, x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  const m = new THREE.Mesh(geo, ridgeMat);
  m.receiveShadow = true;
  scene.add(m);
}
ridgeRing(R_OUT - 1.5, R_OUT + 17, 8, 5, 720, 34);
ridgeRing(R_OUT + 11, R_OUT + 42, 19, 9, 640, 44);
ridgeRing(R_OUT + 32, R_OUT + 90, 34, 14, 560, 56);
{
  // the floor past the last rank, and mist lying between the ranks
  const floor = new THREE.Mesh(new THREE.RingGeometry(R_OUT + 80, 900, 96, 1), new THREE.MeshStandardMaterial({ color: '#3a2620', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.9;
  scene.add(floor);
  const c = document.createElement('canvas'); c.width = 256; c.height = 8;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 8);
  const tex = new THREE.CanvasTexture(c);
  U.mist = [];
  for (const [r0, r1, y, op] of [[R_OUT + 6, R_OUT + 26, 2.0, 0.2], [R_OUT + 24, R_OUT + 56, 4.5, 0.3], [R_OUT + 50, R_OUT + 110, 8, 0.4]]) {
    const geo = new THREE.RingGeometry(r0, r1, 128, 1);
    // RingGeometry's u runs around; the fade has to run across, from the inner edge to the outer.
    const uv = geo.attributes.uv, p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (Math.hypot(p.getX(i), p.getY(i)) - r0) / (r1 - r0), 0.5);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: '#b99a94', transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    scene.add(m); U.mist.push(m);
  }
}


await pause("Olympus");
// =============================================================================
// Olympus: a mountain torn out of the ground, with the Proctors' citadel on top

const olympus = new THREE.Group();
const olyBase = new THREE.Group(); // turns with Olympus but doesn't bob: spray and cloud
{
  const R = 6.9, top = 0.15 * R, TAU = Math.PI * 2;
  /** How far the rock reaches along a bearing, as a share of R; and how high its top stands that far out along it. */
  const rimK = (a) => 1 + (fbm3(Math.cos(a) * 1.5 + 3, 0.5, Math.sin(a) * 1.5, 3, 3) - 0.5) * 0.11;
  const topY = (rho, a) => top * smooth(0, 0.3, Math.sqrt(Math.max(0, 1 - (rho / (R * rimK(a))) ** 2)));

  // The rock: flat on top, rounded at the rim, torn and tapering underneath.
  const rockMat = rockMaterial({ vertexColors: true, scale: 0.42, bump: 1.2, lo: '#3a2c25', hi: '#93786a', bounce: '#5f8fb5' });
  {
    const geo = new THREE.IcosahedronGeometry(1, 20), p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rk = rimK(Math.atan2(z, x));
      let Y = (top / R) * smooth(0, 0.3, y), k = rk, tint = 1;
      if (y < 0) {
        const t = -y, grow = smooth(0, 0.18, t), n = fbm3(x * 1.7 + 3, y * 2.4, z * 1.7, 5, 4) - 0.5, n2 = fbm3(x * 5 + 9, y * 5, z * 5, 8, 3) - 0.5;
        Y = -Math.pow(t, 0.9) * 1.02 + n2 * 0.06 * grow;
        k = rk * (1 - 0.34 * t) * (1 + (n * (0.26 + 0.5 * t) + n2 * 0.12) * grow);
        tint = 1 - 0.5 * smooth(0.15, 1, t); // darker toward the root
      }
      p.setXYZ(i, x * k * R, Y * R, z * k * R);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = tint;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const rock = new THREE.Mesh(smoothNormals(geo), rockMat);
    rock.castShadow = true; rock.receiveShadow = true;
    olympus.add(rock);
    // roots of rock hanging under it
    for (let i = 0; i < 10; i++) {
      const g = new THREE.ConeGeometry(1, 1, 12, 6), q = g.attributes.position;
      for (let j = 0; j < q.count; j++) { const x = q.getX(j), y = q.getY(j), z = q.getZ(j), k = 1 + (fbm3(x * 2 + i * 7, y * 3, z * 2, 31, 3) - 0.5) * 0.9; q.setXYZ(j, x * k, y, z * k); }
      const s = smoothNormals(g);
      s.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.attributes.position.count * 3).fill(0.55), 3));
      const a = rnd(i, 21) * TAU, d = rnd(i, 22) * 3.6, hgt = 2 + rnd(i, 23) * 3.4, m = new THREE.Mesh(s, rockMat);
      m.scale.set(0.5 + rnd(i, 24) * 0.9, hgt, 0.5 + rnd(i, 25) * 0.9);
      m.rotation.x = Math.PI; m.position.set(Math.cos(a) * d, -R * (0.72 - d * 0.07) - hgt * 0.3, Math.sin(a) * d);
      m.castShadow = true; olympus.add(m);
    }
  }
  // Grass over the top of it, thinning to bare rock at the rim.
  {
    const NA = 96, NR = 26, pos = [], uv = [], col = [], idx = [];
    for (let j = 0; j <= NR; j++) for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * TAU, rk = rimK(a), rho = R * rk * 0.992 * Math.pow(j / NR, 0.8), x = Math.cos(a) * rho, z = Math.sin(a) * rho;
      pos.push(x, topY(rho, a) + 0.012, z); uv.push(x * 0.16, z * 0.16);
      const ragged = (fbm3(x * 0.9, 0, z * 0.9, 21, 3) - 0.5) * 0.07, g = 0.8 + 0.34 * fbm3(x * 0.5 + 5, 0, z * 0.5, 23, 2);
      col.push(g, g, g * 0.9, 1 - smooth(0.925 + ragged, 0.985 + ragged, rho / (R * rk)));
    }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1; idx.push(a, b, c, b, c + 1, c); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const n = geo.attributes.normal;
    for (let j = 0; j <= NR; j++) { const a = j * (NA + 1), b = a + NA; if (j === 0) { for (let i = 0; i <= NA; i++) n.setXYZ(i, 0, 1, 0); continue; } const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1; n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l); }
    const grass = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: BIOME.plain.tex.map, bumpMap: BIOME.plain.tex.bump, bumpScale: 0.2, roughness: 0.96, vertexColors: true, transparent: true }));
    grass.receiveShadow = true; grass.renderOrder = -5;
    olympus.add(grass);
  }

  // The citadel: three terraces of marble, a rotunda under a gold dome, a temple on each quarter, a tower between.
  const marble = new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 0.46, envMap: ENV, envMapIntensity: 0.3 });
  const shade = new THREE.MeshStandardMaterial({ color: '#cfc5b4', roughness: 0.6, envMap: ENV, envMapIntensity: 0.2 });
  const gold = new THREE.MeshStandardMaterial({ color: '#e7b851', metalness: 1, roughness: 0.22, envMap: ENV, envMapIntensity: 1.25, emissive: '#5a3a00', emissiveIntensity: 0.22 });
  // roofs are gilded, but not so bright a mirror that they show only the dark sky overhead
  const gilt = new THREE.MeshStandardMaterial({ color: '#e9b545', metalness: 0.55, roughness: 0.42, envMap: ENV, envMapIntensity: 0.9, emissive: '#5a3a00', emissiveIntensity: 0.3 });
  const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; olympus.add(o); return o; };
  /** Something built facing outward along a bearing: x runs out from the middle, z along the terrace. */
  const spoke = (a, build) => { const g = new THREE.Group(); g.rotation.y = -a; build((geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; }); olympus.add(g); };
  /** Steps down and outward from a terrace whose top edge is at `r`, `h` high in all. */
  const steps = (part, r, y, h, w = 0.9) => { for (let s = 0; s < 3; s++) part(box(0.13 * (3 - s), h / 3, w), marble, r + 0.065 * (3 - s), y + (h / 3) * (s + 0.5), 0); };
  add(cyl(5.05, 5.3, 0.4, 72), marble, 0, top + 0.2, 0);
  add(cyl(3.85, 4.0, 0.4, 64), marble, 0, top + 0.6, 0);
  add(cyl(2.55, 2.7, 0.35, 56), marble, 0, top + 0.975, 0);
  const y0 = top + 1.15;
  add(cyl(2.3, 2.38, 0.08, 56), marble, 0, y0 + 0.04, 0);
  add(cyl(1.22, 1.22, 1.9, 32), shade, 0, y0 + 1.03, 0);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU, x = Math.cos(a) * 1.9, z = Math.sin(a) * 1.9;
    add(cyl(0.12, 0.13, 0.06, 12), marble, x, y0 + 0.11, z); add(cyl(0.085, 0.1, 1.7, 12), marble, x, y0 + 0.99, z); add(cyl(0.14, 0.095, 0.07, 12), marble, x, y0 + 1.875, z);
  }
  add(cyl(2.16, 2.16, 0.2, 56), marble, 0, y0 + 2.01, 0);
  add(cyl(2.26, 2.2, 0.07, 56), marble, 0, y0 + 2.145, 0);
  add(cyl(1.5, 1.6, 0.28, 40), marble, 0, y0 + 2.32, 0);
  add(new THREE.SphereGeometry(1.5, 40, 16, 0, TAU, 0, Math.PI / 2), gold, 0, y0 + 2.46, 0).scale.y = 0.9;
  add(cyl(0.15, 0.19, 0.3, 12), marble, 0, y0 + 3.93, 0);
  add(cone(0.17, 0.6, 12), gold, 0, y0 + 4.38, 0);
  for (let i = 0; i < 4; i++) {
    // A temple: steps, a colonnade round a closed room, and a gold roof. Its long side lies along the terrace.
    const a = (i / 4) * TAU + Math.PI / 4;
    spoke(a, (part) => {
      const x = 3.28, y = top + 0.8;
      part(box(0.74, 0.07, 1.5), marble, x, y + 0.035, 0); part(box(0.64, 0.07, 1.4), marble, x, y + 0.105, 0);
      for (let c = 0; c < 6; c++) for (const sx of [-0.25, 0.25]) { const z = -0.6 + c * 0.24; part(cyl(0.036, 0.044, 0.7, 10), marble, x + sx, y + 0.49, z); part(box(0.11, 0.03, 0.11), marble, x + sx, y + 0.855, z); }
      part(box(0.3, 0.7, 0.96), shade, x, y + 0.49, 0);
      part(box(0.64, 0.1, 1.4), marble, x, y + 0.92, 0);
      part(gable(1.46, 0.72, 0.27), gilt, x, y + 0.97, 0).rotation.y = Math.PI / 2;
      // a bridge over the canal, and steps up each terrace to its door
      part(box(0.62, 0.06, 0.8), marble, 5.73, top + 0.115, 0);
      steps(part, 5.05, top, 0.4); steps(part, 3.85, top + 0.4, 0.4);
    });
    // A tower on the lowest terrace, and on the same line the last flight of steps, up to the rotunda.
    spoke(a + Math.PI / 4, (part) => {
      part(cyl(0.33, 0.35, 0.12, 16), marble, 4.52, top + 0.46, 0); part(cyl(0.2, 0.25, 2.2, 16), marble, 4.52, top + 1.62, 0); part(cyl(0.31, 0.24, 0.12, 16), marble, 4.52, top + 2.78, 0);
      part(cone(0.3, 0.75, 16), gilt, 4.52, top + 3.21, 0);
      steps(part, 2.55, top + 0.8, 0.35, 0.8);
    });
  }
  const lamp = new THREE.PointLight('#ffcf7a', 90, 46, 1.5);
  lamp.position.y = top + 2.4;
  olympus.add(lamp);

  // Water. A canal rings the citadel, fountains play in it, and four rivers run from it to the rim and fall into the sea.
  const NOISE = `float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }`;
  // running water: uv.x is how far along it, uv.y runs bank to bank, aRush is how hard it runs (white at the lip)
  const flowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDeep: { value: new THREE.Color('#1c6676') }, uLight: { value: new THREE.Color('#77c9d0') }, uFoam: { value: new THREE.Color('#f3fbfb') } },
    vertexShader: 'attribute float aRush; varying vec2 vUv; varying float vRush; void main(){ vUv = uv; vRush = aRush; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uDeep; uniform vec3 uLight; uniform vec3 uFoam; varying vec2 vUv; varying float vRush;
      ${NOISE}
      void main(){
        float sp = 0.5 + 1.6 * vRush;
        float n1 = noise(vec2(vUv.x * 2.6 - uTime * sp, vUv.y * 4.0)), n2 = noise(vec2(vUv.x * 6.5 - uTime * sp * 1.6, vUv.y * 9.0 + 4.0));
        float bank = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
        vec3 col = mix(uDeep, uLight, n1 * 0.55 + n2 * 0.3);
        float foam = smoothstep(0.66 - 0.3 * vRush, 0.92 - 0.25 * vRush, n1 * 0.55 + n2 * 0.55) + (1.0 - bank) * 0.3 + vRush * vRush * 0.5;
        gl_FragColor = vec4(mix(col, uFoam, clamp(foam, 0.0, 1.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // falling water: uv.x runs round the column, uv.y from the lip (0) to the sea (1)
  U.fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: U.time },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        float q = vUv.y;
        // It falls faster the further it has fallen, so its streaks stretch as they go.
        float run = sqrt(q * 10.0 + 0.2) * 3.0 - uTime * 2.4;
        float streak = noise(vec2(vUv.x * 9.0, run * 1.4)) * 0.6 + noise(vec2(vUv.x * 24.0 + 3.0, run * 3.3)) * 0.4;
        // a whole sheet at the lip, tearing into strands, then into spray
        float sheet = smoothstep(0.22 + 0.42 * q, 0.62 + 0.3 * q, streak + (1.0 - q) * 0.5);
        float soft = pow(abs(dot(normalize(vN), normalize(vV))), 0.8);
        float a = sheet * soft * smoothstep(0.0, 0.025, q) * (1.0 - 0.75 * smoothstep(0.84, 1.0, q));
        vec3 col = mix(vec3(0.50, 0.72, 0.80), vec3(0.95, 0.98, 1.0), clamp(smoothstep(0.3, 0.8, streak) * 0.55 + q * 0.55, 0.0, 1.0));
        gl_FragColor = vec4(col, a * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const wet = (m) => { m.userData.wet = true; olympus.add(m); return m; };
  /** A strip of water laid along a path of [x, y, z, half-width, rush] points; `side` gives the way across at each. */
  const ribbon = (pts, side, lift = 0) => {
    const pos = [], uv = [], rush = [], idx = [];
    let len = 0;
    pts.forEach(([x, y, z, w, r], i) => {
      if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1], z - pts[i - 1][2]);
      const [sx, sz] = side(i);
      pos.push(x - sx * w, y + lift, z - sz * w, x + sx * w, y + lift, z + sz * w); uv.push(len, 0, len, 1); rush.push(r, r);
      if (i) { const a = i * 2 - 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aRush', new THREE.Float32BufferAttribute(rush, 1));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const CANAL = [5.5, 5.96], wy = top + 0.06;
  {
    const pts = [], N = 120;
    for (let i = 0; i <= N; i++) { const a = (i / N) * TAU; pts.push([Math.cos(a) * 5.73, wy, Math.sin(a) * 5.73, 0.23, 0]); }
    const canal = wet(new THREE.Mesh(ribbon(pts, (i) => { const a = (i / N) * TAU; return [-Math.cos(a), -Math.sin(a)]; }), flowMat));
    canal.material.side = THREE.DoubleSide;
    for (const r of CANAL) { const kerb = add(new THREE.TorusGeometry(r, 0.055, 6, 120), marble, 0, top + 0.05, 0); kerb.rotation.x = Math.PI / 2; kerb.scale.z = 0.8; }
    // fountains: a jet standing in the canal either side of each bridge
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8, x = Math.cos(a) * 5.73, z = Math.sin(a) * 5.73;
      add(cyl(0.05, 0.07, 0.3, 10), marble, x, wy + 0.12, z); add(cyl(0.16, 0.05, 0.08, 14), marble, x, wy + 0.3, z);
      const jet = wet(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.2, 0.62, 12, 6, true), U.fallMat));
      jet.position.set(x, wy + 0.5, z); jet.userData.fall = true;
    }
  }
  /** Where each waterfall meets the sea, from Olympus's middle: the sea foams there. */
  const feet = [];
  const bank = new THREE.MeshStandardMaterial({ color: '#6f6654', roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU, ca = Math.cos(a), sa = Math.sin(a), lip = R * rimK(a) * 0.992, N = 16, pts = [];
    // the river: out from the canal across the grass, quickening as the ground falls away
    for (let j = 0; j <= N; j++) {
      const s = j / N, rho = CANAL[1] - 0.04 + (lip - CANAL[1] + 0.04) * s, bend = Math.sin(s * 5 + i * 2) * 0.1 * (1 - s) * s * 4;
      pts.push([ca * rho - sa * bend, topY(rho, a) + 0.035, sa * rho + ca * bend, 0.18 + 0.1 * s, smooth(0.45, 1, s)]);
    }
    const across = () => [-sa, ca];
    add(ribbon(pts.map(([x, y, z, w]) => [x, y - 0.02, z, w + 0.07, 0]), across), bank, 0, 0, 0).castShadow = false;
    wet(new THREE.Mesh(ribbon(pts, across), flowMat));
    // the fall: it leaves the lip the way the river was running, and gravity does the rest
    const [x1, y1, z1] = pts[N], [x0, y0b, z0] = pts[N - 1], dr = Math.hypot(x1 - x0, z1 - z0), dl = Math.hypot(dr, y1 - y0b), vr = (dr / dl) * 1.5 + 0.25, vy = ((y1 - y0b) / dl) * 1.5;
    const floor = SEA_Y - OLY_Y - 0.7, M = 30, RS = 10, pos = [], nor = [], uv = [], idx = [];
    const tEnd = (vy + Math.sqrt(vy * vy + 2 * 9 * (y1 - floor))) / 9;
    for (let j = 0; j <= M; j++) {
      const q = j / M, t = tEnd * Math.pow(q, 0.7), rho = lip + vr * t, y = y1 + vy * t - 4.5 * t * t, fell = (y1 - y) / (y1 - floor);
      const wide = 0.26 + 0.46 * fell, deep = 0.09 + 0.34 * fell;
      for (let k = 0; k <= RS; k++) {
        const ph = (k / RS) * TAU, c = Math.cos(ph), s = Math.sin(ph);
        pos.push(ca * (rho + s * deep) - sa * c * wide, y, sa * (rho + s * deep) + ca * c * wide);
        nor.push(ca * s - sa * c, 0, sa * s + ca * c); uv.push(k / RS, fell);
        if (j && k) { const b = j * (RS + 1) + k, e = b - RS - 1; idx.push(e - 1, e, b - 1, e, b, b - 1); }
      }
      if (j === M) feet.push([ca * (lip + vr * tEnd * 0.985), sa * (lip + vr * tEnd * 0.985)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    wet(new THREE.Mesh(g, U.fallMat)).userData.fall = true;
  }
  U.feet = feet;
  const puff = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const x = 64 + (rnd(i, 41) - 0.5) * 60, y = 64 + (rnd(i, 42) - 0.5) * 34, r = 22 + rnd(i, 43) * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  })();
  // spray standing where each fall lands
  U.spray = [];
  feet.forEach(([x, z], i) => {
    for (const [sc, y, op] of [[3.0, 0.35, 0.5], [2.0, 1.0, 0.3]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#f1f7f8', transparent: true, opacity: op, depthWrite: false }));
      s.scale.set(sc, sc * 0.55, 1); s.position.set(x, SEA_Y + y, z); s.userData = { op, ph: i * 1.7 + y * 3 };
      olyBase.add(s); U.spray.push(s);
    }
  });
  // a few wisps of cloud caught under its rim: enough to say how high it hangs, not enough to hide the sea
  U.clouds = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: i % 3 ? '#eadbd5' : '#ffe6c9', transparent: true, opacity: 0.2 + rnd(i, 51) * 0.16, depthWrite: false }));
    const sc = 3.2 + rnd(i, 52) * 3;
    s.scale.set(sc, sc * 0.45, 1);
    s.userData = { a: rnd(i, 53) * TAU, d: 5.2 + rnd(i, 54) * 2.6, y: OLY_Y - 2.2 - rnd(i, 55) * 3, w: 0.02 + rnd(i, 56) * 0.03 };
    olyBase.add(s); U.clouds.push(s);
  }
  // cypresses on the grass beyond the canal, clear of the rivers and the bridges
  const cyp = new THREE.MeshStandardMaterial({ color: '#27402a', roughness: 1 });
  for (let i = 0, put = 0; put < 20 && i < 80; i++) {
    const a = rnd(i, 31) * TAU, d = 6.05 + rnd(i, 32) * 0.3, h = 0.8 + rnd(i, 33) * 0.7, off = Math.abs(((a / (Math.PI / 4) + 0.5) % 1) - 0.5) * (Math.PI / 4) * d;
    if (off < 0.6 || d > R * rimK(a) * 0.93) continue;
    add(cone(0.19, h, 9), cyp, Math.cos(a) * d, topY(d, a) + h / 2 - 0.05, Math.sin(a) * d); put++;
  }
  // Hundreds of stones, drawn as a handful: everything of one material becomes one solid.
  olympus.updateMatrixWorld(true);
  for (const mat of [marble, shade, gold, gilt, cyp, bank, rockMat]) {
    const parts = [];
    olympus.traverse((o) => { if (o.isMesh && o.material === mat) parts.push(o); });
    if (parts.length < 2) continue;
    const tinted = parts.every((o) => o.geometry.attributes.color), gs = parts.map((o) => (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld));
    const n = gs.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let k = 0;
    for (const g of gs) { pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3); if (tinted) col.set(g.attributes.color.array, k * 3); k += g.attributes.position.count; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (tinted) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const one = new THREE.Mesh(geo, mat);
    one.castShadow = parts[0].castShadow; one.receiveShadow = parts[0].receiveShadow;
    for (const o of parts) o.parent.remove(o);
    olympus.add(one);
  }
  olympus.position.y = OLY_Y;
  olympus.traverse((o) => { if (o.isMesh) o.userData.t = -2; });
  scene.add(olympus, olyBase);
}

/** Things that move: each is called once a frame with the time in seconds. */
const tickers = [];
/** Screen pixels per world unit at the point the camera looks at. */
let ppu = 10;
/** A small screen shows as much land in fewer pixels, so its zoom steps (political map, one champion, whole squads) come sooner. */
let zoomK = 1;


await pause("woods and rock");
// =============================================================================
// what grows and stands on the land

/** Leaves and needles have a fine relief of their own, laid over every tree from three sides. */
const LEAF_RELIEF = reliefTex(128, (u, v) => { let h = 0, a = 0.5, f = 6; for (let o = 0; o < 3; o++) { h += a * Math.abs(gnoise(u * f, v * f, 131 + o * 5, f)); a *= 0.5; f *= 2; } return h; },
  (u, v) => 0.5 + 0.5 * gnoise(u * 4, v * 4, 137, 4));
function leafMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLeaf = { value: LEAF_RELIEF };
    sh.vertexShader = 'varying vec3 vWp;\nvarying vec3 vWn;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
    sh.fragmentShader = 'uniform sampler2D uLeaf;\nvarying vec3 vWp;\nvarying vec3 vWn;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 lfN = normalize(vWn);
        vec3 lfW = pow(abs(lfN), vec3(4.0)); lfW /= lfW.x + lfW.y + lfW.z;
        vec4 lfX = texture2D(uLeaf, vWp.zy * 2.6), lfY = texture2D(uLeaf, vWp.xz * 2.6), lfZ = texture2D(uLeaf, vWp.xy * 2.6);
        vec4 lf = lfX * lfW.x + lfY * lfW.y + lfZ * lfW.z;
        diffuseColor.rgb *= 0.70 + 0.66 * lf.b;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 gx = lfX.rg - 0.5, gy = lfY.rg - 0.5, gz = lfZ.rg - 0.5;
          vec3 bend = vec3(0.0, gx.y, gx.x) * lfW.x + vec3(gy.x, 0.0, gy.y) * lfW.y + vec3(gz.x, gz.y, 0.0) * lfW.z;
          normal = normalize(normal + (viewMatrix * vec4(bend, 0.0)).xyz * 0.9);
        }`);
  };
  mat.customProgramCacheKey = () => 'leaf';
  return mat;
}
/** A clump of foliage: a ball swollen into lobes with creases between them, lit from above and shaded where it is deep. */
function clump(r, seed, detail, lo, hi, squash = 1) {
  const g0 = new THREE.IcosahedronGeometry(1, detail), p = g0.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = r * (0.76 + 0.36 * Math.abs(noise3(x * 1.7 + 3, y * 1.7, z * 1.7, seed) * 2 - 1) + 0.14 * Math.abs(noise3(x * 3.6, y * 3.6 + 5, z * 3.6, seed + 3) * 2 - 1));
    p.setXYZ(i, x * k, y * k * squash, z * k);
  }
  const g = smoothNormals(g0), q = g.attributes.position, nr = g.attributes.normal, col = new Float32Array(q.count * 3), a = lin(hex2rgb(lo)), b = lin(hex2rgb(hi));
  for (let i = 0; i < q.count; i++) {
    const out = Math.hypot(q.getX(i), q.getY(i) / squash, q.getZ(i)) / r, c = mix3(a, b, clamp(0.5 + 0.5 * nr.getY(i), 0, 1) * 0.72 + clamp((out - 0.8) / 0.45, 0, 1) * 0.28);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** A stand of rushes: thin blades leaning out from one root, and a cattail or two among them. */
function rushes(seed, blades, tails) {
  const pos = [], nor = [], col = [], lo = lin(hex2rgb('#4d5a2b')), hi = lin(hex2rgb('#99a056'));
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + rnd(seed, i) * 0.9, ca = Math.cos(a), sa = Math.sin(a), lean = 0.1 + rnd(seed, i + 20) * 0.34, hgt = 0.34 + rnd(seed, i + 40) * 0.3, r0 = 0.06 * rnd(seed, i + 60), w = 0.012 + rnd(seed, i + 80) * 0.008;
    // its spine: up from the root, then out and over at the tip
    const spine = [[r0, 0], [r0 + lean * hgt * 0.4, hgt * 0.55], [r0 + lean * hgt * 1.25, hgt * (1 - lean * 0.45)]].map(([r, y]) => [ca * r, y, sa * r]);
    const at = (p, k) => [p[0] - sa * w * k, p[1], p[2] + ca * w * k], n = [ca * 0.5, 0.86, sa * 0.5], c0 = mix3(lo, hi, 0.15 + rnd(seed, i + 90) * 0.3), c1 = mix3(lo, hi, 0.7 + rnd(seed, i + 95) * 0.3);
    const faces = [[at(spine[0], -1), at(spine[0], 1), at(spine[1], 0.7), c0, c0, c1], [at(spine[0], -1), at(spine[1], 0.7), at(spine[1], -0.7), c0, c1, c1], [at(spine[1], -0.7), at(spine[1], 0.7), spine[2], c1, c1, c1]];
    // (each face twice, once each way round, lit alike: a blade has no dark side)
    for (const [p, q, r, cp, cq, cr] of faces) for (const [vs, cs] of [[[p, q, r], [cp, cq, cr]], [[p, r, q], [cp, cr, cq]]]) vs.forEach((v, j) => { pos.push(...v); nor.push(...n); col.push(...cs[j]); });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const parts = [[g, null]];
  for (let i = 0; i < tails; i++) {
    const a = rnd(seed, i + 120) * TAU, r = 0.02 + rnd(seed, i + 130) * 0.05, hgt = 0.5 + rnd(seed, i + 140) * 0.16, x = Math.cos(a) * r, z = Math.sin(a) * r;
    parts.push([rod([x, 0, z], [x * 1.6, hgt, z * 1.6], 0.007, 0.005, 3), '#7d8546'], [cyl(0.019, 0.019, 0.11, 5), '#4a2e1b', mat4(x * 1.6, hgt - 0.02, z * 1.6)]);
  }
  return fuse(parts);
}
const BARK = '#4a3626', DEADWOOD = '#2e2925';
/** A conifer: a straight trunk carrying tiers of boughs, each sweeping down and out to a ragged hem. With snow, it lies along every bough. */
function conifer(seed, tiers, height, spread, lo, hi, snow) {
  const NA = 10, parts = [[cyl(0.034, 0.06, 0.42, 6), snow ? '#40302a' : BARK, mat4(0, 0.21, 0)]];
  const A = lin(hex2rgb(lo)), B = lin(hex2rgb(hi)), W = lin(hex2rgb('#eef3f6'));
  // down a tier: [its share of the tier's reach, its height above the hem, how far out along the bough it is]
  const ring = [[0.1, 1, 0], [0.6, 0.36, 0.55], [1, 0, 1]];
  for (let k = 0; k < tiers; k++) {
    const u = k / (tiers - 1), R = spread * (1 - 0.7 * u), hem = 0.24 + (height - 0.58) * u, th = 0.44 - 0.1 * u, pos = [], col = [];
    const vert = (row, i) => {
      const a = (i / NA) * TAU + k * 1.3 + seed, [rr, yy, out] = ring[row];
      // five boughs to a tier: their tips reach out and hang down, and the gaps between them draw in
      const bough = 0.5 + 0.5 * Math.cos(a * 5 + seed * 3 + k), wob = 1 + (rnd(seed * 7 + k, i % NA) - 0.5) * 0.2 * out;
      const rad = R * (row === 0 && k === tiers - 1 ? 0 : rr) * (1 - 0.22 * out * (1 - bough)) * wob, y = hem + yy * th - 0.2 * out * bough * R;
      const green = mix3(A, B, (0.12 + 0.88 * out * (0.5 + 0.5 * bough)) * (0.8 + 0.25 * u));
      return [Math.cos(a) * rad, y, Math.sin(a) * rad, snow ? mix3(green, W, row === 2 ? 0.2 + 0.3 * bough : row === 1 ? 0.92 : 0.78) : green];
    };
    for (let row = 0; row < 2; row++) for (let i = 0; i < NA; i++) {
      const a = vert(row, i), b = vert(row, i + 1), c = vert(row + 1, i), d = vert(row + 1, i + 1);
      for (const v of [a, b, c, b, d, c]) { pos.push(v[0], v[1], v[2]); col.push(v[3][0], v[3][1], v[3][2]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push([smoothNormals(g), null]);
  }
  return fuse(parts);
}
/** A broadleaf: a short bole dividing under a crown of clumps. */
function broadleaf(seed, lo, hi, wide) {
  const parts = [[turned([[0.125, 0], [0.078, 0.08], [0.06, 0.26], [0.052, 0.62]], 8), BARK],
    [rod([0, 0.4, 0], [0.17, 0.64, 0.05], 0.032, 0.02, 6), BARK], [rod([0, 0.36, 0], [-0.15, 0.62, -0.07], 0.03, 0.018, 6), BARK]];
  const crown = wide
    ? [[0, 0.76, 0, 0.41, 2, 0.74], [0.3, 0.74, 0.1, 0.25, 1, 0.8], [-0.29, 0.72, -0.1, 0.26, 1, 0.8]]
    : [[0, 0.82, 0, 0.36, 2, 0.95], [0.2, 0.67, 0.12, 0.24, 1, 0.85], [-0.19, 0.71, -0.1, 0.23, 1, 0.9]];
  crown.forEach(([x, y, z, r, detail, squash], i) => parts.push([clump(r, seed * 10 + i, detail, lo, hi, squash), null, mat4(x, y, z)]));
  return fuse(parts);
}
const PROP = {
  pine: conifer(1, 4, 1.32, 0.37, '#14281b', '#35643c'),
  pine2: conifer(2, 5, 1.55, 0.31, '#132619', '#305c3a'),
  snowPine: conifer(3, 4, 1.32, 0.37, '#263f31', '#4c6c57', true),
  oak: broadleaf(1, '#1c3017', '#4f7c33', false),
  oak2: broadleaf(2, '#20341a', '#5a8236', true),
  dead: fuse([[rod([0, 0, 0], [0.03, 0.95, -0.02], 0.062, 0.022, 7), DEADWOOD], [rod([0.01, 0.5, 0], [0.24, 0.86, 0.04], 0.026, 0.01, 6), DEADWOOD], [rod([0.02, 0.38, 0], [-0.2, 0.7, 0.1], 0.024, 0.009, 6), '#383230'],
    [rod([0.02, 0.66, -0.01], [-0.08, 0.98, -0.16], 0.018, 0.007, 5), DEADWOOD], [rod([0.13, 0.69, 0.02], [0.2, 0.98, -0.06], 0.012, 0.005, 5), '#383230']]),
  rock: boulder(0.5, 4, 2, 0.55).applyMatrix4(mat4(0, 0.2, 0, 1, 0.72, 0.9)),
  reed: rushes(3, 9, 2),
  lily: fuse([[0, 0, 0.13, 0.4], [0.21, 0.09, 0.1, 2.1], [-0.12, 0.2, 0.085, 4.0], [0.05, -0.21, 0.11, 5.2], [-0.25, -0.06, 0.07, 1.2]]
    .map(([x, z, r, a], i) => [new THREE.CircleGeometry(r, 9, a, TAU - 0.7).rotateX(-Math.PI / 2), i % 2 ? '#3d6833' : '#4b783a', mat4(x, i * 0.001, z)]).concat([[ball(0.026, 1), '#efe6ee', mat4(0.03, 0.022, 0.02)]])),
  bale: fuse([[cyl(0.16, 0.16, 0.28, 16), '#c9a550', mat4(0, 0.16, 0, 1, 1, 1, Math.PI / 2, 0, 0)]]),
  ice: fuse([[lump(new THREE.OctahedronGeometry(0.3, 0), 0.4, 5), '#bfe3f5', mat4(0, 0.28, 0, 0.7, 1.5, 0.7)]]),
  bush: fuse([[clump(0.2, 61, 1, '#2a401f', '#5f7f3c', 0.72), null, mat4(0, 0.13, 0)], [clump(0.13, 62, 1, '#2a401f', '#5f7f3c', 0.75), null, mat4(0.15, 0.09, 0.06)]]),
};
{
  // A mountain: a summit, a little off the middle, with spurs running down from it. It is wide enough at the foot
  // to run into its neighbours, so a territory of them reads as one range.
  const massif = (seed) => {
    const NA = 32, NR = 13, pos = new Float32Array((NA + 1) * (NR + 1) * 3), idx = [];
    const cx = (rnd(seed, 1) - 0.5) * 0.3, cz = (rnd(seed, 2) - 0.5) * 0.3;
    let o = 0;
    for (let j = 0; j <= NR; j++) for (let i = 0; i <= NA; i++) {
      const u = j / NR, a = (i / NA) * 6.2831853, x = Math.cos(a) * u, z = Math.sin(a) * u, d = Math.min(1, Math.hypot(x - cx * (1 - u), z - cz * (1 - u)));
      let rid = 0, amp = 1, f = 1.6, norm = 0, prev = 1;
      for (let k = 0; k < 4; k++) { let n = 1 - Math.abs(2 * vnoise(x * f + 9 + seed * 3.1, z * f + seed * 1.7, 40 + k * 11) - 1); n *= n; rid += n * amp * prev; norm += amp; prev = 0.4 + 0.6 * n; amp *= 0.5; f *= 2.1; }
      pos[o++] = x * 1.1; pos[o++] = (Math.pow(1 - d, 1.2) * (0.45 + rid / norm) + (1 - d) * 0.12) * 1.75; pos[o++] = z * 1.1;
    }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1; idx.push(a, b, c, b, c + 1, c); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // one normal for the middle, where every spoke meets, and one for the two ends of each ring
    const n = geo.attributes.normal, mean = (ids) => { let x = 0, y = 0, z = 0; for (const i of ids) { x += n.getX(i); y += n.getY(i); z += n.getZ(i); } const l = Math.hypot(x, y, z) || 1; for (const i of ids) n.setXYZ(i, x / l, y / l, z / l); };
    mean(Array.from({ length: NA + 1 }, (_, i) => i));
    for (let j = 1; j <= NR; j++) mean([j * (NA + 1), j * (NA + 1) + NA]);
    return geo;
  };
  PROP.peak = PROP.snowPeak = massif(1);
  PROP.peak2 = PROP.snowPeak2 = massif(2);
}
{
  const place = Object.fromEntries(Object.keys(PROP).map((k) => [k, []]));
  for (const h of HEX) {
    const t = T[h.t];
    if (t.isKeep || t.biome === 'lake' || harbourHex.has(h)) continue;
    // The ground its army stands on stays clear.
    if (Math.hypot(h.x - spot[h.t][0], h.y - spot[h.t][1]) < 2.05) continue;
    const top = topH[h.t], frost = t.quadrant === 2;
    const r = (k) => rnd(h.q * 7.13 + k, h.r * 3.71 - k);
    const add = (list, k, s, rad = 0.55, tall = 1) => { const a = r(k) * 6.283, d = Math.sqrt(r(k + 1)) * rad; list.push({ x: h.x + Math.cos(a) * d, y: top, z: -(h.y + Math.sin(a) * d), s, sy: s * tall, ry: r(k + 2) * 6.283, v: 0.84 + r(k + 3) * 0.3, warm: (r(k + 4) - 0.5) * 0.22 }); };
    // no two trees of a wood quite alike: two shapes of each kind, and every one its own height
    const pine = (k) => (frost ? place.snowPine : r(k) < 0.55 ? place.pine : place.pine2), oak = (k) => (r(k) < 0.5 ? place.oak : place.oak2);
    switch (t.biome) {
      case 'forest': for (let i = 0; i < 4; i++) add(frost || r(40 + i) < 0.62 ? pine(50 + i) : oak(60 + i), i * 5, 0.75 + r(30 + i) * 0.5, 0.62, 0.9 + r(70 + i) * 0.25); break;
      case 'highland': if (r(1) < 0.45) add(pine(2), 3, 0.7 + r(4) * 0.4); if (r(5) < 0.5) add(place.rock, 8, 0.5 + r(9) * 0.5); break;
      case 'crag': add(place.rock, 1, 0.9 + r(2) * 1.0); if (r(3) < 0.6) add(place.rock, 6, 0.6 + r(7) * 0.7); break;
      case 'mountain': {
        // Every hex of it carries a mountain: full size inside the territory, small at its edge so none hangs over a neighbour.
        const edge = DIR.some(([dq, dr]) => hexAt.get((h.q + dq) + ',' + (h.r + dr))?.t !== h.t), big = !edge && r(1) < 0.85, two = r(8) < 0.5;
        const list = frost ? (two ? place.snowPeak2 : place.snowPeak) : two ? place.peak2 : place.peak;
        add(list, 2, big ? 0.95 + r(3) * 0.45 : 0.82 + r(3) * 0.16, big ? 0.25 : 0.04, 0.8 + r(9) * 0.55);
        if (edge) {
          // lean it toward the hexes of its own territory
          let ix = 0, iy = 0;
          for (const [dq, dr] of DIR) { const nb = hexAt.get((h.q + dq) + ',' + (h.r + dr)), [nx, ny] = hexXY(h.q + dq, h.r + dr), w = nb?.t === h.t ? 1 : -1; ix += (nx - h.x) * w; iy += (ny - h.y) * w; }
          const il = Math.hypot(ix, iy) || 1, p = list[list.length - 1];
          p.x += (ix / il) * 0.3; p.z -= (iy / il) * 0.3;
        }
        if (r(5) < 0.3) add(place.rock, 5, 0.6 + r(6) * 0.6);
        break;
      }
      case 'plain': if (r(1) < 0.22) add(place.bush, 2, 0.8 + r(3) * 0.6); if (r(4) < 0.07) add(oak(5), 6, 0.8 + r(7) * 0.3); break;
      case 'fields': if (r(1) < 0.2) add(place.bale, 2, 0.9 + r(3) * 0.3); break;
      case 'swamp': for (let i = 0; i < 3; i++) add(place.reed, i * 4, 0.8 + r(20 + i) * 0.6, 0.6); if (r(15) < 0.25) add(place.dead, 16, 0.7 + r(17) * 0.4); break;
      case 'deadwood': if (r(1) < 0.85) add(place.dead, 2, 0.9 + r(3) * 0.6); if (r(5) < 0.3) add(place.rock, 6, 0.5 + r(7) * 0.4); break;
      case 'snow': if (r(1) < 0.3) add(place.snowPine, 2, 0.7 + r(3) * 0.4); if (r(5) < 0.35) add(place.ice, 6, 0.6 + r(7) * 0.7); break;
    }
  }
  // Along a lake's shore: rushes standing in the shallows, stones, and lily pads lying on the still water. (In the
  // Frostfangs there is only ice.)
  for (const t of T) {
    const L = lakeOf[t.id];
    if (!L) continue;
    for (const h of byT[t.id]) for (let i = 0; i < 30; i++) {
      const r = (k) => rnd(h.q * 5.3 + i * 1.71 + k, h.r * 2.9 - i * 0.63 - k);
      // somewhere in the hex: in one of its six triangles
      const k = Math.floor(r(1) * 6), n = (k + 1) % 6, a = r(2), b = r(3), u = a + b > 1 ? 1 - a : a, v = a + b > 1 ? 1 - b : b;
      const x = h.x + CORNER[k][0] * u + CORNER[n][0] * v, y = h.y + CORNER[k][1] * u + CORNER[n][1] * v;
      if (L.clear(x, y)) continue;
      const g = L.at(x, y), up = g - L.water;
      const put = (list, s, at, tall = 1) => list.push({ x, y: at, z: -y, s, sy: s * tall, ry: r(7) * 6.283, v: 0.85 + r(8) * 0.3, warm: 0 });
      if (t.quadrant === 2) { if (up > -0.04 && up < 0.2 && r(4) < 0.05) put(place.ice, 0.5 + r(5) * 0.5, g); }
      else if (up > -0.13 && up < 0.03 && r(4) < 0.55) put(place.reed, 0.8 + r(5) * 0.7, g, 0.8 + r(6) * 0.5);
      else if (up > -0.2 && up < 0.3 && r(4) > 0.9) put(place.rock, 0.25 + r(5) * 0.45, g - 0.03);
      else if (up < -0.16 && up > -0.5 && r(4) < 0.1) put(place.lily, 0.8 + r(5) * 0.6, L.water + 0.006);
    }
  }
  // On a lighter graphics level the woods are thinner. Each tree stays or goes by where it stands, so a wood keeps its
  // shape; mountains all stay (a mountain is what the ground IS).
  if (Q.dressing < 1) for (const k of Object.keys(place)) if (!/eak/.test(k)) place[k] = place[k].filter((p) => rnd(p.x * 3.1, p.z * 1.7) < Q.dressing);
  // Stone is lit as stone (and the Frostfangs' mountains carry their snow lower), and whatever is in leaf as foliage.
  const leaf = leafMaterial(), green = { pine: leaf, pine2: leaf, snowPine: leaf, oak: leaf, oak2: leaf, bush: leaf };
  const stone = rockMaterial({ scale: 1.0, lo: '#4f463e', hi: '#a59886' }), peak = rockMaterial({ scale: 0.75, bump: 1.1, lo: '#4a423b', hi: '#a09387', snow: [2.45, 3.0], jit: 0.3 }), white = rockMaterial({ scale: 0.75, bump: 1.1, lo: '#4a423b', hi: '#a09387', snow: [1.9, 2.6], jit: 0.3 });
  const MAT = { rock: stone, peak, peak2: peak, snowPeak: white, snowPeak2: white };
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (const [k, list] of Object.entries(place)) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(PROP[k], MAT[k] ?? green[k] ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: k === 'ice' ? 0.25 : 0.92 }), list.length);
    // (a tree's own shade of green: some a little yellower, some a little bluer)
    list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.ry, 0); o.scale.set(p.s, p.sy ?? p.s, p.s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, green[k] && k !== 'snowPine' ? c.setRGB(p.v * (1 + p.warm), p.v, p.v * (1 - p.warm * 0.7)) : c.setScalar(p.v)); });
    im.castShadow = k !== 'reed' && k !== 'lily'; im.receiveShadow = true;
    scene.add(im);
  }
}


await pause("the Keeps");
// =============================================================================
// Keeps: a walled castle on every House's home ground, flying its holder's colours

const stand = (t, [x, y]) => w2v(x, y, topH[t]); // a spot of the map, on a territory's ground
const keeps = []; // per House: { t, flags: material }
{
  const W = 2.6, hw = 0.75, S = '#8b8177', D = '#6c635a';
  const stone = [[box(W, 0.06, W), '#5f564d', mat4(0, 0.03, 0)],
    [box(W, hw, 0.22), S, mat4(0, hw / 2, -W / 2)], [box(0.22, hw, W), S, mat4(-W / 2, hw / 2, 0)], [box(0.22, hw, W), S, mat4(W / 2, hw / 2, 0)],
    [box(W / 2 - 0.4, hw, 0.22), S, mat4(-(W / 4 + 0.2), hw / 2, W / 2)], [box(W / 2 - 0.4, hw, 0.22), S, mat4(W / 4 + 0.2, hw / 2, W / 2)],
    [box(0.9, 1.15, 0.5), D, mat4(0, 0.575, W / 2)], [box(0.42, 0.6, 0.06), '#16100e', mat4(0, 0.3, W / 2 + 0.24)],
    [box(1.0, 2.1, 1.0), S, mat4(0, 1.05, -0.3)], [box(1.16, 0.16, 1.16), D, mat4(0, 2.16, -0.3)]];
  // battlements along the walls, and round towers at the corners
  for (let i = 0; i < 8; i++) {
    const u = -W / 2 + 0.3 + i * ((W - 0.6) / 7);
    stone.push([box(0.16, 0.13, 0.26), D, mat4(u, hw + 0.065, -W / 2)], [box(0.26, 0.13, 0.16), D, mat4(-W / 2, hw + 0.065, u)], [box(0.26, 0.13, 0.16), D, mat4(W / 2, hw + 0.065, u)]);
    if (Math.abs(u) > 0.5) stone.push([box(0.16, 0.13, 0.26), D, mat4(u, hw + 0.065, W / 2)]);
  }
  const roofs = [[flat(new THREE.ConeGeometry(0.84, 0.72, 4)), '#ffffff', mat4(0, 2.6, -0.3, 1, 1, 1, 0, Math.PI / 4, 0)]];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    stone.push([cyl(0.36, 0.4, 1.45, 18), S, mat4(sx * W / 2, 0.725, sz * W / 2)], [cyl(0.44, 0.44, 0.16, 18), D, mat4(sx * W / 2, 1.5, sz * W / 2)]);
    roofs.push([cone(0.46, 0.62, 18), '#ffffff', mat4(sx * W / 2, 1.89, sz * W / 2)]);
  }
  const stoneGeo = fuse(stone), roofGeo = fuse(roofs);
  // dressed stone: the walls keep their colours, and the rock's grain lies over them
  const stoneMat = rockMaterial({ vertexColors: true, lo: '#a99f93', hi: '#ffffff', scale: 1.5, bump: 0.7, roughness: 0.9 });
  const flag = new THREE.PlaneGeometry(1, 1);
  for (let h = 0; h < HOUSES.length; h++) {
    const t = KEEP[h], g = new THREE.Group();
    const walls = new THREE.Mesh(stoneGeo, stoneMat), roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(HOUSES[h].color).multiplyScalar(0.62), roughness: 0.7 }));
    const flags = new THREE.MeshStandardMaterial({ color: colorOf(owner[t]), roughness: 0.85, side: THREE.DoubleSide });
    for (const m of [walls, roof]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    // long banners either side of the gate, and one at the top of the tower
    for (const sx of [-0.78, 0.78]) { const b = new THREE.Mesh(flag, flags); b.scale.set(0.3, 0.62, 1); b.position.set(sx, 0.52, W / 2 + 0.13); g.add(b); }
    const pole = new THREE.Mesh(cyl(0.02, 0.02, 0.9, 5), stoneMat); pole.position.set(0, 3.3, -0.3); g.add(pole);
    const top = new THREE.Mesh(flag, flags); top.scale.set(0.6, 0.34, 1); top.position.set(0.31, 3.55, -0.3); g.add(top);
    g.scale.setScalar(CASTLE);
    g.position.copy(stand(t, [court[t].x, court[t].y]));
    g.rotation.y = court[t].turn;
    g.traverse((o) => { if (o.isMesh) o.userData.t = t; });
    scene.add(g);
    keeps.push({ t, flags, group: g });
  }
}


await pause("the armies");
// =============================================================================
// armies: squads of soldiers in their House's colours, a general at a Keep that has a Primus, and the Standards

const STEEL = '#8a9098', LEATHER = '#3a2c22', SKIN = '#c49a76', GOLDC = '#c9a24a', GILT = '#d9b256', BRONZE = '#a97c38';
/** A cloak: the back half of a cone. A crest: half a disc stood on edge. A breastplate: a turned shape, flattened front to back. */
const half = (a, b, h) => new THREE.CylinderGeometry(a, b, h, 10, 2, true, Math.PI / 2, Math.PI);
const crest = (r, x, y, z, sy = 0.8, seg = 16) => [new THREE.CylinderGeometry(r, r, r * 0.2, seg, 1, false, 0, Math.PI), '#ffffff', mat4(x, y, z, sy, 1, 1, 0, 0, Math.PI / 2)];
const orb = (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);
const dome = (r, share, w = 14, h = 6) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, Math.PI * share);
/**
 * Every figure is three solids, because they shine differently: armour (steel and gilt), what armour doesn't
 * cover (skin, leather, wood), and cloth, which takes its House's colour.
 */
const FIG = {
  // A soldier: spear grounded in the right hand, shield on the left arm, a cloak over the back. There may be
  // hundreds on the map, so each is cut from few faces and shaded smooth.
  metal: fuse([
    [rod([-0.068, 0.08, 0.004], [-0.066, 0.26, 0.004], 0.05, 0.05, 5), STEEL], [rod([0.068, 0.08, 0.004], [0.066, 0.26, 0.004], 0.05, 0.05, 5), STEEL],
    [turned([[0.112, 0.52], [0.122, 0.58], [0.135, 0.68], [0.15, 0.78], [0.148, 0.83], [0.11, 0.875], [0.055, 0.89]], 10), STEEL, mat4(0, 0, 0, 1, 1, 0.76)],
    [orb(0.07, 6, 4), '#9aa0a8', mat4(-0.175, 0.815, 0, 1, 0.78, 1)], [orb(0.07, 6, 4), '#9aa0a8', mat4(0.175, 0.815, 0, 1, 0.78, 1)],
    [rod([0.195, 0.63, 0.03], [0.23, 0.6, 0.09], 0.036, 0.036, 5), STEEL], [rod([-0.195, 0.63, 0.03], [-0.245, 0.62, 0.1], 0.036, 0.036, 5), STEEL],
    [dome(0.086, 0.58, 10, 4), STEEL, mat4(0, 0.972, 0)], [new THREE.CylinderGeometry(0.086, 0.1, 0.06, 8, 1, true, Math.PI / 2, Math.PI), STEEL, mat4(0, 0.925, 0)],
    [cone(0.028, 0.13, 5), '#c7ccd2', mat4(0.235, 1.375, 0.1)], [orb(0.04, 6, 4), GOLDC, mat4(-0.265, 0.62, 0.165)]]),
  soft: fuse([
    [rod([-0.068, 0.045, 0], [-0.065, 0.47, 0], 0.046, 0.046, 5), LEATHER], [rod([0.068, 0.045, 0], [0.065, 0.47, 0], 0.046, 0.046, 5), LEATHER],
    [orb(0.045, 5, 4), '#241a14', mat4(-0.068, 0.036, 0.03, 0.85, 0.75, 1.9)], [orb(0.045, 5, 4), '#241a14', mat4(0.068, 0.036, 0.03, 0.85, 0.75, 1.9)],
    [cyl(0.12, 0.16, 0.17, 10), '#5a4030', mat4(0, 0.46, 0)],
    [rod([-0.165, 0.8, 0], [-0.195, 0.63, 0.03], 0.038, 0.038, 5), '#4a3a30'], [rod([0.165, 0.8, 0], [0.195, 0.63, 0.03], 0.038, 0.038, 5), '#4a3a30'],
    [orb(0.034, 5, 4), SKIN, mat4(0.235, 0.6, 0.1)], [orb(0.034, 5, 4), SKIN, mat4(-0.25, 0.62, 0.11)],
    [cyl(0.04, 0.045, 0.05, 6), SKIN, mat4(0, 0.9, 0)], [orb(0.076, 8, 6), SKIN, mat4(0, 0.96, 0.004, 0.93, 1.08, 1)],
    [cyl(0.012, 0.012, 1.3, 5), '#5d4630', mat4(0.235, 0.66, 0.1)]]),
  livery: fuse([[half(0.16, 0.25, 0.62), '#ffffff', mat4(0, 0.56, -0.02)], [box(0.19, 0.2, 0.018), '#ffffff', mat4(0, 0.43, 0.13)],
    [cyl(0.17, 0.17, 0.03, 12), '#ffffff', mat4(-0.265, 0.62, 0.13, 1, 1, 1, Math.PI / 2, 0, 0)], crest(0.1, 0, 1.03, -0.005, 0.8, 8)]),
  // The general: a head taller, in gilded armour, both hands on a sword grounded before them.
  genMetal: fuse([
    [rod([-0.095, 0.1, 0], [-0.092, 0.3, 0], 0.06), GILT], [rod([0.095, 0.1, 0], [0.092, 0.3, 0], 0.06), GILT],
    [orb(0.062), GILT, mat4(-0.092, 0.355, 0.014)], [orb(0.062), GILT, mat4(0.092, 0.355, 0.014)],
    [turned([[0.118, 0.585], [0.128, 0.64], [0.14, 0.72], [0.165, 0.83], [0.172, 0.9], [0.15, 0.955], [0.1, 0.985], [0.062, 0.995]], 24), GILT, mat4(0, 0, 0, 1, 1, 0.74)],
    [new THREE.TorusGeometry(0.125, 0.02, 8, 24), BRONZE, mat4(0, 0.59, 0, 1, 0.76, 1, Math.PI / 2, 0, 0)],
    [dome(0.092, 0.62, 16, 8), GILT, mat4(-0.205, 0.905, 0, 1.05, 0.8, 1.1)], [dome(0.092, 0.62, 16, 8), GILT, mat4(0.205, 0.905, 0, 1.05, 0.8, 1.1)],
    [orb(0.08), BRONZE, mat4(-0.232, 0.85, 0, 0.9, 0.7, 1)], [orb(0.08), BRONZE, mat4(0.232, 0.85, 0, 0.9, 0.7, 1)],
    [rod([-0.215, 0.69, 0.04], [-0.055, 0.735, 0.2], 0.043), GILT], [rod([0.215, 0.69, 0.04], [0.055, 0.735, 0.2], 0.043), GILT],
    [orb(0.042), STEEL, mat4(-0.03, 0.757, 0.212)], [orb(0.042), STEEL, mat4(0.03, 0.757, 0.212)],
    [dome(0.1, 0.6, 18, 8), GILT, mat4(0, 1.115, -0.005)], [new THREE.TorusGeometry(0.098, 0.012, 6, 24), BRONZE, mat4(0, 1.1, -0.005, 1, 1, 1, Math.PI / 2, 0, 0)],
    [orb(0.05), GILT, mat4(-0.082, 1.06, 0.03, 0.35, 1, 0.8)], [orb(0.05), GILT, mat4(0.082, 1.06, 0.03, 0.35, 1, 0.8)],
    [new THREE.CylinderGeometry(0.1, 0.116, 0.07, 14, 1, true, Math.PI / 2, Math.PI), GILT, mat4(0, 1.055, -0.005)],
    [box(0.02, 0.03, 0.17), BRONZE, mat4(0, 1.214, -0.01)],
    [flat(cyl(0.03, 0.01, 0.6, 4)), '#dfe4e8', mat4(0, 0.36, 0.215, 1, 1, 0.28)], [box(0.19, 0.022, 0.034), GILT, mat4(0, 0.665, 0.215)], [orb(0.026), GILT, mat4(0, 0.745, 0.215)]]),
  genSoft: fuse([
    [rod([-0.095, 0.045, -0.03], [-0.095, 0.045, 0.1], 0.05), '#2c2018'], [rod([0.095, 0.045, -0.03], [0.095, 0.045, 0.1], 0.05), '#2c2018'],
    [rod([-0.092, 0.36, 0], [-0.085, 0.56, 0], 0.072), '#3b2d24'], [rod([0.092, 0.36, 0], [0.085, 0.56, 0], 0.072), '#3b2d24'],
    [cyl(0.135, 0.19, 0.2, 18), '#6b4a2f', mat4(0, 0.5, 0)],
    [rod([-0.2, 0.9, 0], [-0.215, 0.69, 0.04], 0.045), '#4a3a30'], [rod([0.2, 0.9, 0], [0.215, 0.69, 0.04], 0.045), '#4a3a30'],
    [cyl(0.045, 0.052, 0.07, 10), SKIN, mat4(0, 1.0, 0)], [orb(0.083, 16, 12), SKIN, mat4(0, 1.085, 0.005, 0.93, 1.1, 1)],
    [cyl(0.014, 0.016, 0.075, 8), '#3a2416', mat4(0, 0.705, 0.215)]]),
  genCloth: fuse([crest(0.15, 0, 1.2, -0.01, 0.75), [cyl(0.14, 0.2, 0.06, 18), '#ffffff', mat4(0, 0.385, 0)]]),
  // (under a wolf's pelt the helm carries no crest)
  genTunic: fuse([[cyl(0.14, 0.2, 0.06, 18), '#ffffff', mat4(0, 0.385, 0)]]),
  pennant: fuse([[cyl(0.014, 0.014, 1.9, 5), '#5d4630', mat4(0, 0.95, 0)], [box(0.5, 0.26, 0.012), '#ffffff', mat4(0.26, 1.72, 0)], [ball(0.035), GOLDC, mat4(0, 1.92, 0)]]),
};
/** A cape: hung from the shoulders, falling in folds to the ankles and flaring behind. `v` runs down it, 0 to 1. */
function capeGeometry() {
  const NU = 12, NV = 14, pos = [], down = [], idx = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = (i / NU) * 2 - 1, v = j / NV;
    pos.push(u * (0.2 + 0.17 * Math.pow(v, 0.9)), 0.955 - v * 0.9, -0.14 - 0.19 * Math.pow(v, 1.2) - 0.024 * Math.sin(u * 7.5 + v * 2) * (0.3 + v) + 0.12 * u * u * Math.pow(1 - v, 3));
    down.push(v);
    if (i && j) { const b = j * (NU + 1) + i, a = b - NU - 1; idx.push(a - 1, b - 1, a, a, b - 1, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, base: Float32Array.from(pos), down };
}
/**
 * A wolf's pelt, worn the way a Primus of Mars wears it: the head riding on the helm with its muzzle over the brow,
 * the forelegs knotted on the breast, the hide over the shoulders and down the back, the tail hanging behind.
 * It is dark along the spine, grey over the back, and pale toward its edges.
 */
function wolfPelt() {
  const DARK = '#2b2826', GREY = '#5d5853', PALE = '#8e877b', CREAM = '#bbb19e', EAR = '#3d3835';
  const dark = lin(hex2rgb(DARK)), grey = lin(hex2rgb(GREY)), pale = lin(hex2rgb(PALE)), cream = lin(hex2rgb(CREAM));
  /** A hide: a sheet laid out by a function of how far across and how far down it a point is, shaded smooth. */
  const sheet = (nu, nv, at) => {
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const [x, y, z, c] = at(i / nu, j / nv, i, j);
      pos.push(x, y, z); col.push(c[0], c[1], c[2]);
      if (i && j) { const b = j * (nu + 1) + i, a = b - nu - 1; idx.push(a - 1, b - 1, a, a, b - 1, b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // The hide: from the neck it lies on the shoulders, then hangs: long down the back, short at the sides, open in front.
  const NV = 12, mantle = sheet(30, NV, (u, v, i, j) => {
    const a = (u * 2 - 1) * 2.2, s = Math.sin(a), c = Math.cos(a), side = Math.abs(a);
    const lie = smooth(0, 0.36, v), hang = Math.pow(Math.max(0, (v - 0.3) / 0.7), 1.25);
    const neck = 1.035 - 0.03 * smooth(1.2, 2.2, side), shoulder = 0.935 + 0.055 * s * s - 0.02 * smooth(1.6, 2.2, side), hem = 0.4 + 0.29 * smooth(0.45, 1.4, side) + 0.06 * smooth(1.4, 2.2, side);
    const wide = 0.125 + 0.21 * smooth(0, 0.4, v) + 0.02 * hang, back = 0.125 + 0.075 * lie + 0.105 * hang, front = 0.095 + 0.08 * smooth(0, 0.4, v);
    // tufts: every hair of it stands a little differently, and its hem and its two front edges are ragged
    const edge = Math.max(smooth(0.8, 1, v), smooth(0.86, 1, Math.abs(u * 2 - 1))), k = 1 + (rnd(i * 1.3, j * 2.9 + 3) - 0.5) * (0.05 + 0.07 * edge);
    let col = mix3(grey, dark, (1 - smooth(0.1, 1.0, side)) * (1 - 0.3 * v));
    col = mix3(col, pale, 0.75 * smooth(1.0, 2.1, side));
    col = mix3(col, cream, 0.55 * smooth(0.72, 1, v));
    return [wide * s * k, neck + (shoulder - neck) * lie + (hem - shoulder) * hang - (j === NV ? 0.01 + rnd(i, 91) * 0.045 : 0), (c > 0 ? -back : -front) * c * k, col];
  });
  // The scalp: over the crown of the helm, short above the brow and falling behind to meet the hide at the neck.
  const NP = 7, scalp = sheet(20, NP, (u, v, i, j) => {
    const b = u * TAU, off = Math.abs(b > Math.PI ? b - TAU : b), p = v * (0.95 + 1.25 * smooth(0.55, 1.7, off)), R = 0.12;
    const h = (p > Math.PI / 2 ? R * (1 + 0.06 * (p - Math.PI / 2)) : R * Math.sin(p)) * (1 + (j === NP ? (rnd(i, 93) - 0.5) * 0.08 : 0));
    let col = mix3(dark, grey, smooth(0.3, 1.3, p));
    col = mix3(col, pale, 0.5 * smooth(0.7, 1, v) * smooth(0.4, 1.2, off));
    return [h * Math.sin(b), 1.116 + R * Math.cos(p) - (j === NP ? rnd(i, 95) * 0.014 : 0), h * Math.cos(b) - 0.012, col];
  });
  const pair = (f) => [1, -1].map(f);
  const g = fuse([[mantle, null], [scalp, null],
    // the forehead, the long muzzle (the upper jaw only: it lies over the brow of the helm), and its black nose
    [orb(0.06, 12, 8), GREY, mat4(0, 1.213, 0.05, 1.25, 0.6, 1.1)],
    [new THREE.CylinderGeometry(0.027, 0.052, 0.17, 12), PALE, mat4(0, 1.183, 0.158, 1, 1, 0.7, Math.PI / 2 + 0.2, 0, 0)],
    [orb(0.03, 10, 6), GREY, mat4(0, 1.201, 0.15, 0.9, 0.5, 2.6, 0.2, 0, 0)],
    [orb(0.028, 10, 6), PALE, mat4(0, 1.166, 0.24, 1, 0.72, 0.8)], [orb(0.017, 8, 6), '#15110f', mat4(0, 1.172, 0.258, 1.1, 0.8, 0.7)],
    // its ears, the sockets of its eyes, and two fangs
    ...pair((s) => [cone(0.04, 0.105, 8), EAR, mat4(s * 0.068, 1.275, -0.03, 1, 1, 0.6, -0.12, 0, -s * 0.22)]),
    ...pair((s) => [cone(0.024, 0.07, 6), '#211c1a', mat4(s * 0.068, 1.266, -0.012, 1, 1, 0.45, -0.12, 0, -s * 0.22)]),
    ...pair((s) => [orb(0.012, 8, 6), '#0f0c0b', mat4(s * 0.043, 1.207, 0.098, 1.5, 0.6, 1)]),
    ...pair((s) => [cone(0.007, 0.028, 5), '#e9e1cd', mat4(s * 0.019, 1.146, 0.222, 1, 1, 1, Math.PI, 0, 0)]),
    // the forelegs: over the shoulders, crossed and knotted on the breast, the paws hanging
    ...pair((s) => [rod([s * 0.25, 0.955, 0.1], [0, 0.9, 0.166], 0.029, 0.024, 8), GREY, mat4(0, 0, 0.068, 1, 1, 0.55)]),
    ...pair((s) => [rod([0, 0.9, 0.166], [-s * 0.09, 0.832, 0.166], 0.024, 0.019, 8), PALE, mat4(0, 0, 0.068, 1, 1, 0.55)]),
    ...pair((s) => [orb(0.03, 8, 6), CREAM, mat4(-s * 0.096, 0.815, 0.162, 0.85, 1.15, 0.5)]),
    [orb(0.034, 10, 7), GREY, mat4(0, 0.9, 0.164, 1.1, 0.85, 0.55)],
    // the hind legs and the tail, hanging from the hem over the cape
    ...pair((s) => [rod([s * 0.165, 0.45, -0.275], [s * 0.2, 0.215, -0.315], 0.032, 0.017, 8), PALE]),
    ...pair((s) => [orb(0.026, 8, 6), CREAM, mat4(s * 0.202, 0.2, -0.318, 0.9, 1.2, 0.7)]),
    [turned([[0.012, 0], [0.034, 0.05], [0.047, 0.13], [0.041, 0.22], [0.026, 0.33]], 10), GREY, mat4(0.01, 0.105, -0.345, 1, 1, 1, 0.14, 0, 0.03)],
    [orb(0.02, 8, 6), DARK, mat4(0.01, 0.108, -0.345, 1, 1.5, 1)]]);
  // grizzled: no two hairs the same grey, and the tail darkens to its tip
  const p = g.attributes.position, col = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), tail = z < -0.3 && Math.abs(x) < 0.07 && y < 0.3 ? clamp(0.45 + (y - 0.1) * 3, 0.45, 1) : 1;
    const k = (0.8 + 0.4 * noise3(x * 55, y * 55, z * 55, 17)) * tail;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}
/** Fur: its hairs run down the pelt and back along the head, and it is soft at its edges where the light comes through it. */
const FUR_RELIEF = reliefTex(128, (u, v) => 0.6 * gnoise(u * 16, v * 16, 151, 16) + 0.4 * gnoise(u * 32, v * 32, 153, 32), (u, v) => 0.5 + 0.5 * gnoise(u * 5, v * 5, 157, 5));
function furMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFur = { value: FUR_RELIEF };
    sh.vertexShader = 'varying vec3 vFp;\nvarying vec3 vFn;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFp = position; vFn = normal;');
    sh.fragmentShader = 'uniform sampler2D uFur;\nuniform mat4 modelMatrix;\nvarying vec3 vFp;\nvarying vec3 vFn;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fuW = pow(abs(normalize(vFn)), vec3(4.0)); fuW /= fuW.x + fuW.y + fuW.z;
        // each hair is long and thin: the pattern is drawn out the way the hair lies
        vec4 fuX = texture2D(uFur, vec2(vFp.z * 7.0, vFp.y * 0.9)), fuY = texture2D(uFur, vec2(vFp.x * 7.0, vFp.z * 0.9)), fuZ = texture2D(uFur, vec2(vFp.x * 7.0, vFp.y * 0.9));
        vec4 fu = fuX * fuW.x + fuY * fuW.y + fuZ * fuW.z;
        diffuseColor.rgb *= (0.5 + 0.9 * fu.b) * (0.85 + 0.3 * fu.a);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 bend = vec3(0.0, 0.0, fuX.r - 0.5) * fuW.x + vec3(fuY.r - 0.5, 0.0, 0.0) * fuW.y + vec3(fuZ.r - 0.5, 0.0, 0.0) * fuW.z;
          normal = normalize(normal + normalize(mat3(viewMatrix) * mat3(modelMatrix) * bend + vec3(1e-5)) * length(bend) * 1.5);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.5) * 0.3;`);
  };
  mat.customProgramCacheKey = () => 'fur';
  return mat;
}
/** Model height of a soldier, and how much larger than life every figure is drawn. */
const FIG_H = 1.1, FIG_BASE = 1.0;
const MAXF = 480;
const armourMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.72, roughness: 0.4, envMap: ENV, envMapIntensity: 1.1 });
const softMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
const figBody = new THREE.InstancedMesh(FIG.metal, armourMat, MAXF), figSoft = new THREE.InstancedMesh(FIG.soft, softMat, MAXF), figCloth = new THREE.InstancedMesh(FIG.livery, clothMat, MAXF), figPennant = new THREE.InstancedMesh(FIG.pennant, clothMat, 64);
/** The three solids of every soldier, placed together. */
const figParts = [figBody, figSoft, figCloth];
for (const m of [...figParts, figPennant]) { m.castShadow = Q.figureShadows; m.frustumCulled = false; scene.add(m); }
/** The colour cloth takes: a House's own, a little deeper, or undyed wool for a neutral garrison. */
const cloth = (o) => (o >= 0 ? new THREE.Color(HOUSES[o].color).multiplyScalar(o === 5 ? 0.82 : 0.9) : new THREE.Color('#77705f'));
const SHAPE = { 0: [], 1: [[0, 0]], 3: [[0, 0.3], [-0.4, -0.2], [0.4, -0.2]], 5: [[0, 0.42], [-0.44, 0.06], [0.44, 0.06], [-0.24, -0.4], [0.24, -0.4]] };
const tierOf = (n) => (n >= 15 ? 5 : n >= 5 ? 3 : n >= 1 ? 1 : 0);
/** Where a territory's army stands: its middle, or the yard before the gate of a Keep. */
const anchor = T.map((t) => { const a = stand(t.id, spot[t.id]); a.y += 0.15 * isletSize[t.id]; return a; });
/** Which way a territory's army looks: at the nearest land it doesn't hold. */
function facing(t) {
  const o = owner[t];
  let best = null, bd = 1e9;
  for (const x of ADJ[t]) { if (owner[x] === o || T[t].port === x) continue; const d = Math.hypot(CEN[x][0] - CEN[t][0], CEN[x][1] - CEN[t][1]); if (d < bd) { bd = d; best = x; } }
  const dx = best != null ? CEN[best][0] - CEN[t][0] : -CEN[t][0], dy = best != null ? CEN[best][1] - CEN[t][1] : -CEN[t][1];
  return Math.atan2(dx, -dy);
}
const squads = T.map((t) => ({ t: t.id, n: 1, face: 0, lift: 0, off: null, aboard: null, size: 1 })); // off: where a marching squad is, instead of its anchor; aboard: the ship carrying it
/** Where a territory's army is just now: aboard a ship, on the march, or standing on its own ground. */
const squadAt = (sq) => (sq.aboard ? sq.aboard.group.position : sq.off ?? anchor[sq.t]);
/** How a squad stands along a galley's deck: [along, across] for each of its soldiers. */
const DECK = { 0: [], 1: [[0.62, 0]], 3: [[0.66, 0], [-0.3, 0.07], [-0.68, -0.07]], 5: [[0.8, 0], [0.46, 0.08], [-0.26, -0.08], [-0.58, 0.08], [-0.9, -0.06]] };
let squadsDirty = true, figMode = '', figScale = 1;
function refreshSquads() {
  for (const s of squads) { s.n = tierOf(armies[s.t]); s.face = facing(s.t); }
  squadsDirty = true;
}
refreshSquads();
const _o = new THREE.Object3D(), _at = new THREE.Vector3(), _view = new THREE.Matrix4(), _inv = new THREE.Matrix4();
/**
 * Figures are drawn larger than life, and larger still from far away, so an army reads at any zoom:
 * far out there are none (the count plates carry the map), nearer one champion per territory, close in the whole squad.
 */
function layFigures() {
  const mode = ppu < 6.5 * zoomK ? 'none' : ppu < 15 * zoomK ? 'one' : 'all';
  const s = clamp(26 / (FIG_H * FIG_BASE * ppu), 1, 2.4), rest = mode === 'all' ? smooth(13.5 * zoomK, 17.5 * zoomK, ppu) : 0;
  // Only the figures in view are drawn, so they are laid out again whenever the view moves on.
  const cp = camera.position, view = Math.round(cp.x / 3) + ',' + Math.round(cp.y / 3) + ',' + Math.round(cp.z / 3) + ',' + Math.round(controls.target.x / 2) + ',' + Math.round(controls.target.z / 2);
  if (!squadsDirty && mode === figMode && Math.abs(s - figScale) < 0.01 && rest === layFigures.rest && view === layFigures.view) return;
  squadsDirty = false; figMode = mode; figScale = s; layFigures.rest = rest; layFigures.view = view;
  camera.updateMatrixWorld();
  _view.multiplyMatrices(camera.projectionMatrix, _inv.copy(camera.matrixWorld).invert());
  let i = 0, p = 0;
  for (const sq of squads) {
    const a = squadAt(sq), col = cloth(owner[sq.t]), shape = SHAPE[sq.n], cs = Math.cos(sq.face), sn = Math.sin(sq.face);
    if (sq.aboard) {
      // At sea: its soldiers stand in file along the deck, the size of the ship's own crew.
      const ship = sq.aboard, k = ship.group.scale.x;
      sq.lift = 2.3 * k;
      if (mode !== 'none') for (const [lx, lz] of DECK[sq.n]) {
        if (i >= MAXF) break;
        _o.position.set(lx, GALLEY.deckY(lx), lz).applyMatrix4(ship.group.matrixWorld);
        _o.rotation.set(0, ship.group.rotation.y + Math.PI / 2, 0); _o.scale.setScalar(0.4 * k * ship.fade); _o.updateMatrix();
        for (const m of figParts) m.setMatrixAt(i, _o.matrix);
        figCloth.setColorAt(i, col); i++;
      }
      continue;
    }
    // It is drawn no larger than its own ground has room for, so that no soldier stands across a border.
    const alone = mode === 'one' || sq.n === 1, g = Math.min(s * (mode === 'one' ? 1 + (sq.n - 1) * 0.06 : 1), room[sq.t] / (alone ? 0.4 : 0.85)) * sq.size;
    sq.lift = mode === 'none' ? 0.55 : FIG_H * FIG_BASE * g + 0.42;
    if (mode === 'none') continue;
    _at.copy(a).applyMatrix4(_view);
    if (Math.abs(_at.x) > 1.3 || Math.abs(_at.y) > 1.45 || _at.z > 1) continue;
    shape.forEach(([lx, lz], k) => {
      const show = mode === 'all' ? (k === 0 ? 1 : rest) : mode === 'one' && k === 0 ? 1 : 0;
      if (i >= MAXF || !show) return;
      const fx = mode === 'one' ? 0 : lx * g, fz = mode === 'one' ? 0 : lz * g;
      _o.position.set(a.x + fx * cs + fz * sn, a.y, a.z - fx * sn + fz * cs);
      _o.rotation.set(0, sq.face + (rnd(sq.t, k) - 0.5) * 0.5, 0);
      _o.scale.setScalar(FIG_BASE * g * show * (0.94 + rnd(sq.t, k + 9) * 0.12));
      _o.updateMatrix();
      for (const m of figParts) m.setMatrixAt(i, _o.matrix);
      figCloth.setColorAt(i, col); i++;
    });
    // fifteen or more march under a pennant
    if (sq.n === 5 && mode === 'all' && p < 64) {
      _o.position.set(a.x + (-0.62 * g) * cs + (-0.1 * g) * sn, a.y, a.z + 0.62 * g * sn + (-0.1 * g) * cs);
      _o.rotation.set(0, sq.face, 0); _o.scale.setScalar(FIG_BASE * g * rest); _o.updateMatrix();
      figPennant.setMatrixAt(p, _o.matrix); figPennant.setColorAt(p, col); p++;
    }
  }
  for (const m of figParts) m.count = i;
  figPennant.count = p;
  for (const m of [...figParts, figPennant]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}
tickers.push(layFigures);

/** The House sigil on its colour, for a Standard's cloth. */
function sigilTexture(h) {
  const c = document.createElement('canvas'); c.width = 192; c.height = 288;
  const g = c.getContext('2d');
  g.fillStyle = HOUSES[h].color; g.fillRect(0, 0, 192, 288);
  const sh = g.createLinearGradient(0, 0, 192, 0);
  for (let i = 0; i <= 6; i++) sh.addColorStop(i / 6, i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.05)');
  g.fillStyle = sh; g.fillRect(0, 0, 192, 288);
  g.strokeStyle = '#d9b045'; g.lineWidth = 12; g.strokeRect(8, 8, 176, 272);
  g.fillStyle = h === 5 || h === 0 ? '#2a1c10' : '#fff6e0';
  g.font = 'bold 120px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(HOUSES[h].sigil, 96, 150);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const goldMat = new THREE.MeshStandardMaterial({ color: '#d9b045', metalness: 0.85, roughness: 0.3 });
const woodMat = new THREE.MeshStandardMaterial({ color: '#4d3a28', roughness: 0.9 });
const standards = HOUSES.map((H, h) => {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(cyl(0.035, 0.045, 3.0, 6), woodMat); pole.position.y = 1.5;
  const bar = new THREE.Mesh(cyl(0.025, 0.025, 0.86, 5), woodMat); bar.rotation.z = Math.PI / 2; bar.position.y = 2.86;
  const eagle = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), goldMat); eagle.position.y = 3.1;
  const geo = new THREE.PlaneGeometry(0.78, 1.17, 6, 8); geo.translate(0, -0.585, 0);
  const cl = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: sigilTexture(h), roughness: 0.85, side: THREE.DoubleSide }));
  cl.position.y = 2.84;
  for (const m of [pole, bar, eagle, cl]) { m.castShadow = true; g.add(m); }
  scene.add(g);
  return { h, group: g, cloth: cl, base: Float32Array.from(geo.attributes.position.array) };
});
const generals = []; // { t, group, cloth, cape }
let peltGeo = null, furMat = null;
/** A Primus stands at a Keep: `holder` is the House whose colours they wear, `wolf` whether they are of Mars and wear its pelt. */
function addGeneral(t, holder, name, sub, wolf) {
  const g = new THREE.Group();
  const dais = new THREE.Mesh(cyl(0.42, 0.46, 0.1, 24), new THREE.MeshStandardMaterial({ color: '#8b8177', roughness: 0.9 })); dais.position.y = 0.05;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 6, 28), goldMat); rim.rotation.x = Math.PI / 2; rim.position.y = 0.1;
  // armour, what it doesn't cover, and the cloth of whoever holds the Keep: crest, tunic and a cape that stirs
  const colour = new THREE.MeshStandardMaterial({ color: cloth(holder), roughness: 0.85, side: THREE.DoubleSide }), cape = capeGeometry();
  const cl = new THREE.Mesh(wolf ? FIG.genTunic : FIG.genCloth, colour), parts = [new THREE.Mesh(FIG.genMetal, armourMat), new THREE.Mesh(FIG.genSoft, softMat), cl, new THREE.Mesh(cape.geo, colour)];
  if (wolf) parts.push(new THREE.Mesh(peltGeo ??= wolfPelt(), furMat ??= furMaterial()));
  for (const m of parts) { m.position.y = 0.1; m.castShadow = true; }
  g.add(dais, rim, ...parts);
  g.traverse((o) => { if (o.isMesh) { o.userData.t = t; o.userData.general = true; } });
  // beside the garrison, before the gate of the Keep
  g.position.copy(stand(t, court[t].general));
  g.rotation.y = court[t].turn + 0.25;
  scene.add(g);
  generals.push({ t, group: g, cloth: cl, cape, name, sub, room: inset(t, ...court[t].general), mats: [dais.material, colour] });
}
const MARS = HOUSES.findIndex((h) => h.name === 'Mars');
function placeStandards() {
  for (const s of standards) {
    const t = standardAt[s.h], taken = stdTaken[s.h]; // a captured Standard is gone from the map
    s.group.visible = !taken;
    const at = T[t].isKeep ? court[t].standard : [spot[t][0] + Math.min(0.9, room[t] - 0.5), spot[t][1] - 0.3];
    s.group.position.copy(stand(t, at));
    s.group.rotation.y = T[t].isKeep ? court[t].turn : 0;
    s.room = inset(t, at[0], at[1]);
  }
}
placeStandards();
tickers.push((t) => {
  // Generals and Standards grow with distance like the soldiers do, so a Keep's Primus can be found from across the
  // valley: but never past the edge of the ground they stand on.
  const s = clamp(30 / (1.3 * FIG_BASE * ppu), 1, 2.2), show = ppu >= 6.5 * zoomK;
  for (const g of generals) {
    g.group.visible = show; g.group.scale.setScalar(FIG_BASE * 1.3 * Math.min(s, Math.max(1, g.room / 0.62)));
    if (!show) continue;
    // the cape stirs: a slow swing, and a ripple running down its folds
    const pos = g.cape.geo.attributes.position, { base, down } = g.cape, swing = Math.sin(t * 0.7 + g.t) * 0.03;
    for (let i = 0; i < pos.count; i++) { const v = down[i]; pos.setZ(i, base[i * 3 + 2] - (Math.sin(base[i * 3] * 6 + v * 3 - t * 1.6 + g.t) * 0.02 + swing) * v * v); }
    pos.needsUpdate = true; g.cape.geo.computeVertexNormals();
  }
  for (const st of standards) {
    st.group.scale.setScalar(Math.min(clamp(34 / (3.1 * ppu), 1, 2.2), Math.max(1, st.room / 0.45)));
    const pos = st.cloth.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const y = -st.base[i * 3 + 1]; pos.setZ(i, Math.sin(y * 4.2 - t * 2.6 + st.h) * 0.07 * y); }
    pos.needsUpdate = true;
  }
});


// =============================================================================
// count plates: every army's number, never smaller than you can read

/** Armies placed on a territory this Draft, shown as a green +n. */
const placed = {};
/** The odds to take a territory, shown on its plate while it is a target. */
const plateOdds = {};
const standardHere = (t) => standards.find((s) => !stdTaken[s.h] && standardAt[s.h] === t);
const guardOf = (t) => { const s = standardHere(t); return s ? stdGuard[s.h] : 0; };
const plateEls = T.map((t) => { const el = document.createElement('div'); el.className = 'plate'; el.dataset.t = t.id; el.style.display = 'none'; platesEl.appendChild(el); return el; });
/** Where each plate was last put and what it last said: nothing is written to the page that has not changed, and the pointer finds a plate without asking the page where it is. */
const plateBox = T.map(() => ({ on: false, x: -1, y: -1, z: -1, w: 0, h: 0, fade: '', key: '' }));
/** True while a war is being shown. With none, the land lies empty: no plates, no squads. */
let live = false;
function paintPlate(t) {
  const o = owner[t], el = plateEls[t], n = armies[t], std = !!standardHere(t), g = guardOf(t), od = plateOdds[t], b = plateBox[t];
  const key = [o, n, std, g, placed[t] || 0, od ? (od.overwhelm ? 'w' : Math.round(od.p * 100)) : '', o >= 0 && o === ME].join('|');
  if (b.key === key) return;
  b.key = key; b.w = 0;
  el.style.setProperty('--c', o >= 0 ? HOUSES[o].color : '#5d564c');
  el.classList.toggle('light', o === 0 || o === 5);
  el.classList.toggle('mine', o >= 0 && o === ME);
  el.innerHTML = `${std ? '<i>⚑</i>' : ''}<b>${n}</b>${g ? `<small>+${g}</small>` : ''}${placed[t] ? `<em>+${placed[t]}</em>` : ''}`
    + (od ? `<u class="${od.overwhelm || od.p >= 0.65 ? 'good' : od.p >= 0.4 ? 'even' : 'bad'}">${od.overwhelm ? '🏳' : Math.round(od.p * 100) + '%'}</u>` : '');
}
const _v = new THREE.Vector3();
/** A world point on the host's screen (its own pixels), or null when it is behind the camera. */
function toScreen(p, lift = 0) {
  _v.set(p.x, p.y + lift, p.z).project(camera);
  if (_v.z > 1) return null;
  return { x: (_v.x * 0.5 + 0.5) * vw, y: (-_v.y * 0.5 + 0.5) * vh };
}
const _c = new THREE.Vector3(), _d = new THREE.Vector3();
/** Is a point of the valley hidden behind Olympus from where the camera is? (A plate there fades, so it never floats over the mountain.) */
function behindOlympus(p) {
  if (olyLook !== 'solid') return false;
  _d.copy(p).sub(camera.position);
  const len = _d.length(), k = _c.set(0, OLY_Y - 1.5, 0).sub(camera.position).dot(_d) / (len * len);
  return k > 0 && k < 0.97 && _c.set(0, OLY_Y - 1.5, 0).sub(camera.position).addScaledVector(_d, -k).length() < 8;
}
let plateFs = 0;
tickers.push(() => {
  const fs = +clamp(ppu * 0.7, 12.5, 19).toFixed(1);
  if (fs !== plateFs) { plateFs = fs; platesEl.style.setProperty('--fs', fs + 'px'); for (const b of plateBox) b.w = 0; }
  for (const sq of squads) {
    const el = plateEls[sq.t], b = plateBox[sq.t], at = squadAt(sq), s = live && armies[sq.t] > 0 ? toScreen(at, sq.lift) : null;
    if (!s || s.x < -80 || s.x > vw + 80 || s.y < -10 || s.y > vh + 60) { if (b.on) { b.on = false; el.style.display = 'none'; } continue; }
    if (!b.on) { b.on = true; el.style.display = ''; }
    const x = Math.round(s.x * 10) / 10, y = Math.round(s.y * 10) / 10;
    if (x !== b.x || y !== b.y) {
      b.x = x; b.y = y;
      el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      const z = Math.round(y);
      if (z !== b.z) { b.z = z; el.style.zIndex = z; }
    }
    const fade = behindOlympus(at) ? '0.12' : '';
    if (fade !== b.fade) { b.fade = fade; el.style.opacity = fade; }
  }
});
/** The plate under a point of the host (its own pixels), the nearest to the eye if two overlap: or -1. */
function plateAt(px, py) {
  let best = -1;
  for (let t = 0; t < NT; t++) {
    const b = plateBox[t];
    if (!b.on || b.fade) continue;
    if (!b.w) { b.w = plateEls[t].offsetWidth; b.h = plateEls[t].offsetHeight; }
    if (px >= b.x - b.w / 2 - 2 && px <= b.x + b.w / 2 + 2 && py >= b.y - b.h - 2 && py <= b.y + 4 && (best < 0 || b.y > plateBox[best].y)) best = t;
  }
  return best;
}

await pause("the harbours");
// =============================================================================
// crossings: the sea lanes between ports, the ships that sail them only while an army crosses, and the land bridges

const lanes = [];
/** The lane whose port is under the pointer. */
let hoverLane = null;
const bridgeSpots = [];
/** Olympus's falls come down within this far of the middle of the sea: no lane runs inside it. */
const CLEAR = 10.5;
/** What a lane is called at both of its ends, so that a port can be matched to the one across the water. */
const LANE_MARK = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** And its colour, on the water and on its two marks: none of them a House's. */
const LANE_INK = ['#fff1cf', '#ffa6dd', '#9af2ff', '#d6ff8a', '#ffc9a0', '#d9c8ff'];
{
  const pairs = G.ports.filter(([a, b]) => harbour[a] && harbour[b]);
  const turn = ([a, b]) => { const A = harbour[a].berth, B = harbour[b].berth, d = Math.atan2(B.z, B.x) - Math.atan2(A.z, A.x); return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };
  // (the longest way round takes the innermost ring, so a short crossing is not carried in across a long one)
  const rank = pairs.map((p, k) => k).sort((x, y) => turn(pairs[y]) - turn(pairs[x]));
  pairs.forEach(([a, b], k) => {
    // Out from one pier, round Olympus on open water, and in to the other. Seen from above every lane is one clean
    // arc: it turns about the middle of the sea the short way round, and keeps a ring of its own (no two lanes lie on
    // top of each other) halfway between the falls and the shore. Two ports on the same shore barely leave it.
    const A = harbour[a].berth, B = harbour[b].berth, y = SEA_Y + 0.06;
    const ra = Math.hypot(A.x, A.z), rb = Math.hypot(B.x, B.z), aa = Math.atan2(A.z, A.x);
    const sweep = Math.atan2(Math.sin(Math.atan2(B.z, B.x) - aa), Math.cos(Math.atan2(B.z, B.x) - aa));
    const shore = Math.min(ra, rb), mid = (CLEAR + shore) / 2 + (rank.indexOf(k) - (pairs.length - 1) / 2) * 1.35;
    const ring = Math.min(Math.max(mid, CLEAR + 0.7), Math.max(CLEAR + 0.7, shore - 0.6));
    const reach = Math.min(1, Math.abs(sweep) / (Math.PI * 0.45));
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const u = i / 48, along = ra + (rb - ra) * u, dip = Math.pow(Math.sin(Math.PI * u), 0.55) * reach;
      const r = along + (Math.min(ring, along) - along) * dip, ang = aa + sweep * u;
      pts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 400;
    const len = curve.getLength();
    // Drawn as a broad dashed ribbon lying on the water, from one pier's head to the other's: it has to read from the
    // far view, where a hairline is lost, and it has to be seen to start and end at a port.
    const drawn = new THREE.CatmullRomCurve3([harbour[a].head.clone().setY(y), ...pts, harbour[b].head.clone().setY(y)], false, 'centripetal');
    drawn.arcLengthDivisions = 400;
    const dl = drawn.getLength(), DASH = 0.8, GAP = 0.5, HALF = 0.16, pos = [], idx = [];
    for (let d = 0.1; d + DASH < dl; d += DASH + GAP) {
      const CUT = 4;
      for (let j = 0; j <= CUT; j++) {
        const u = (d + (DASH * j) / CUT) / dl, p = drawn.getPointAt(u), t = drawn.getTangentAt(u), nx = -t.z, nz = t.x, at = pos.length / 3;
        pos.push(p.x + nx * HALF, y, p.z + nz * HALF, p.x - nx * HALF, y, p.z - nz * HALF);
        if (j) idx.push(at - 2, at, at - 1, at - 1, at, at + 1);
      }
    }
    const geoL = new THREE.BufferGeometry();
    geoL.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geoL.setIndex(idx);
    const line = new THREE.Mesh(geoL, new THREE.MeshBasicMaterial({ color: LANE_INK[k % LANE_INK.length], transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    line.renderOrder = 3;
    scene.add(line);
    lanes.push({ a, b, curve, line, len, mark: LANE_MARK[k] ?? String(k + 1), ink: LANE_INK[k % LANE_INK.length] });
  });
}
const laneOf = (from, to) => (T[from].port === to ? lanes.find((l) => (l.a === from && l.b === to) || (l.b === from && l.a === to)) : null);
/** Which lane a port's ships sail, if it is a port. */
const laneAt = (t) => lanes.find((l) => l.a === t || l.b === t) ?? null;
// A lane is always there to be seen. The one whose port is under the pointer stands out: the others fall back.
tickers.push(() => { for (const l of lanes) l.line.material.opacity = l === hoverLane ? 1 : hoverLane ? 0.3 : 0.7 + 0.25 * U.reveal.value; });

/**
 * A war galley: a long, low hull rising to a post at either end, one mast with a square sail, a bank of oars each
 * side and shields along the rail. It lies along x with its bow forward, and floats at y = 0.
 */
const GALLEY = (() => {
  const HL = 1.5, NX = 26, NP = 8, OAK = '#55371f', STRAKE = '#6d4a2b', TAR = '#2f2119', DECK = '#8a6b47', SPAR = '#4d3a28';
  // along the hull, from -1 at the stern to 1 at the bow: half its beam, the height of its rail, the depth of its keel
  const beam = (t) => 0.33 * (t > 0 ? Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.75) : Math.pow(Math.max(0, 1 - Math.pow(-t, 3)), 0.5));
  const rail = (t) => 0.2 + 0.25 * Math.pow(Math.abs(t), 2.6) + (t < 0 ? 0.05 * t * t : 0);
  const keel = (t) => -0.02 - 0.15 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 4)), 0.5);
  const c = (hex) => lin(hex2rgb(hex)), oak = c(OAK), strake = c(STRAKE), tar = c(TAR), deck = c(DECK);
  // one skin, wrapped round every frame of her: deck, the rail's inner face, down the side to the keel, and up again
  const pos = [], col = [], idx = [], NV = NP + 5;
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NX; i++) {
    const t = (i / NX) * 2 - 1, b = beam(t), g = rail(t), k = keel(t);
    let z, y, cc;
    if (j === 0 || j === NV) { z = 0.84 * b; y = g - 0.07; cc = deck; }
    else if (j === 1) { z = 0.9 * b; y = g; cc = strake; }
    else if (j === NV - 1) { z = -0.84 * b; y = g - 0.07; cc = deck; }
    else if (j === NV - 2) { z = -0.9 * b; y = g; cc = strake; }
    else {
      const ph = ((j - 2) / NP) * Math.PI, co = Math.cos(ph);
      z = b * Math.sign(co) * Math.pow(Math.abs(co), 0.8); y = g - (g - k) * Math.pow(Math.sin(ph), 0.75);
      cc = y < 0.03 ? tar : mix3(oak, strake, smooth(0.5, 1, (y - k) / (g - k)));
    }
    pos.push(t * HL, y, z); col.push(cc[0], cc[1], cc[2]);
    if (i && j) { const q = j * (NX + 1) + i, p = q - NX - 1; idx.push(p - 1, q - 1, p, p, q - 1, q); }
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skin.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  skin.setIndex(idx);
  skin.computeVertexNormals();
  const parts = [[skin, null],
    // the stem and its gilded head; the sternpost, curling forward over the helmsman
    [rod([1.46, 0.38, 0], [1.63, 0.66, 0], 0.046, 0.038, 8), OAK], [rod([1.63, 0.66, 0], [1.6, 0.92, 0], 0.038, 0.028, 8), OAK], [ball(0.05, 1), '#c9a24a', mat4(1.6, 0.95, 0)],
    [rod([-1.46, 0.44, 0], [-1.7, 0.76, 0], 0.05, 0.042, 8), OAK], [rod([-1.7, 0.76, 0], [-1.64, 1.04, 0], 0.042, 0.034, 8), OAK], [rod([-1.64, 1.04, 0], [-1.45, 1.14, 0], 0.034, 0.024, 8), OAK], [ball(0.04, 1), '#c9a24a', mat4(-1.42, 1.14, 0)],
    // the mast and its yard, and the steering oar over the quarter
    [cyl(0.022, 0.034, 1.92, 8), SPAR, mat4(0.1, 1.08, 0)], [cyl(0.018, 0.018, 1.56, 6), SPAR, mat4(0.13, 1.87, 0, 1, 1, 1, Math.PI / 2, 0, 0)],
    [rod([-1.12, 0.46, 0.3], [-1.42, -0.12, 0.4], 0.015, 0.015, 6), SPAR], [box(0.2, 0.2, 0.014), SPAR, mat4(-1.4, -0.08, 0.4, 1, 1, 1, 0, 0, 0.45)]];
  // the rowers' benches
  for (let i = 0; i < 7; i++) { const x = -0.95 + i * 0.3, t = x / HL; if (Math.abs(x - 0.1) > 0.12) parts.push([box(0.07, 0.025, 1.6 * beam(t)), STRAKE, mat4(x, rail(t) - 0.055, 0)]); }
  const hull = fuse(parts);
  // The sail: hung from the yard and bellying forward, most a little below its middle.
  const sail = new THREE.PlaneGeometry(1.42, 1.22, 8, 6).applyMatrix4(mat4(0.14, 1.24, 0, 1, 1, 1, 0, Math.PI / 2, 0));
  const belly = (zz, yy) => { const u = zz / 0.71, v = (yy - 1.24) / 0.61; return 0.25 * (1 - u * u) * (1 - Math.pow((v + 0.25) / 1.25, 2)); };
  { const p = sail.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, 0.14 + belly(p.getZ(i), p.getY(i))); sail.computeVertexNormals(); }
  // An oar: its loom inboard of the rail, its blade at the far end. Where each is pinned: eight to a side.
  const oar = fuse([[cyl(0.011, 0.014, 1.12, 6), '#7a5b3c', mat4(0, 0, 0.36, 1, 1, 1, Math.PI / 2, 0, 0)], [box(0.014, 0.085, 0.26), '#8a6b47', mat4(0, 0, 0.84)]]);
  const tholes = [];
  for (const s of [1, -1]) for (let i = 0; i < 8; i++) { const x = -0.9 + i * 0.235, t = x / HL; tholes.push([x, rail(t) + 0.015, s * beam(t) * 0.97, s]); }
  // What she wears of her House: a shield hung between every two oars, and a pennant at the masthead.
  const livery = [[new THREE.PlaneGeometry(0.36, 0.13), '#ffffff', mat4(-0.09, 2.0, 0)]];
  for (const s of [1, -1]) for (let i = 0; i < 7; i++) { const x = -0.78 + i * 0.235, t = x / HL; livery.push([cyl(0.1, 0.1, 0.024, 14), '#ffffff', mat4(x, rail(t) - 0.03, s * (beam(t) + 0.016), 1, 1, 1, Math.PI / 2, 0, 0)]); }
  return { hull, sail, belly, oar, tholes, livery: fuse(livery), deckY: (x) => rail(x / HL) - 0.07, HL };
})();
/** A House's sail: its colour in sewn panels, and its sigil large in the middle. */
const sailCloth = {};
function sailTexture(h) {
  if (sailCloth[h]) return sailCloth[h];
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 224;
  const g = cv.getContext('2d');
  g.fillStyle = '#' + cloth(h).getHexString(); g.fillRect(0, 0, 256, 224);
  for (let i = 0; i < 6; i++) {
    const sh = g.createLinearGradient((i * 256) / 6, 0, ((i + 1) * 256) / 6, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0.08)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = sh; g.fillRect((i * 256) / 6, 0, 256 / 6, 224);
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect((i * 256) / 6 - 1, 0, 2.5, 224);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, 256, 7); g.fillRect(0, 217, 256, 7);
  g.fillStyle = h === 5 || h === 0 ? '#2a1c10' : '#fff3da';
  g.font = 'bold 132px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(HOUSES[h].sigil, 128, 118);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return (sailCloth[h] = tex);
}

/** The ships at sea. There are none until an army crosses, and each is gone again once it has put its army ashore. */
const fleet = [];
/** A ship's full speed, in map units a second: its wake is measured against it. */
const CRUISE = 9;
const _oar = new THREE.Object3D();
_oar.rotation.order = 'YXZ';
/** A ship of the House that holds `from` appears at its pier, bows to the sea, to sail the lane to `to`. */
function launch(from, to) {
  const lane = laneOf(from, to), house = owner[from];
  // (the sea is only told about two at once: a third takes the place of the one longest out)
  while (fleet.filter((s) => !s.left).length >= SHIPS) scrap(fleet.find((s) => !s.left));
  for (const s of [...fleet]) if (fleet.length >= SHIPS) scrap(s);
  const mats = [new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({ map: sailTexture(house), roughness: 0.92, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: cloth(house), roughness: 0.75, side: THREE.DoubleSide })];
  const group = new THREE.Group(), sailGeo = GALLEY.sail.clone(), sail = new THREE.Mesh(sailGeo, mats[1]), oars = new THREE.InstancedMesh(GALLEY.oar, mats[0], GALLEY.tholes.length);
  for (const m of [new THREE.Mesh(GALLEY.hull, mats[0]), sail, new THREE.Mesh(GALLEY.livery, mats[2]), oars]) { m.castShadow = true; m.frustumCulled = false; group.add(m); }
  group.rotation.order = 'YXZ';
  scene.add(group);
  const ship = {
    group, mats, sheet: sail, sheetBase: Float32Array.from(sailGeo.attributes.position.array), oars, lane, from, to, house, back: lane.a !== from,
    slot: [0, 1].find((i) => !fleet.some((s) => s.slot === i)) ?? 0, u: 0, speed: 0, yaw: null, hx: 1, hz: 0, fade: 0, show: 1, row: 0, trail: [], move: null, left: false,
    /** Sail to a point of the lane (0 the pier it left, 1 the far one), taking `ms`: gathering way, and losing it as it arrives. */
    sail(u1, ms) { return new Promise((done) => { this.move?.done(); this.move = { u0: this.u, u1, t0: performance.now(), ms: ms / SPEED, done }; }); },
  };
  fleet.push(ship);
  sailFleet(lastSail);
  return ship;
}
/** Its work done, a ship fades from the sea (its wake lies a little longer). */
function dismiss(ship) { ship.show = 0; }
function scrap(ship) {
  ship.move?.done(); ship.move = null;
  if (!ship.left) { scene.remove(ship.group); ship.sheet.geometry.dispose(); for (const m of ship.mats) m.dispose(); ship.oars.dispose(); ship.left = true; }
  for (const sq of squads) if (sq.aboard === ship) { sq.aboard = null; squadsDirty = true; }
  if (camFollow === ship) camFollow = null;
  const i = fleet.indexOf(ship);
  if (i >= 0) fleet.splice(i, 1);
  U.shipK[ship.slot].set(0, 0, 1, 0); U.trailBox[ship.slot].set(1, 1, -1, -1);
  for (let j = 0; j < TRAIL; j++) U.trail[ship.slot * TRAIL + j].w = 0;
}
let lastSail = 0;
function sailFleet(t) {
  const dt = clamp(t - lastSail, 0, 0.1), size = clamp(15 / ppu, 1, 2.2);
  lastSail = t;
  for (const s of [...fleet]) {
    const was = s.u;
    if (s.move) {
      const k = Math.min(1, (performance.now() - s.move.t0) / s.move.ms);
      s.u = s.move.u0 + (s.move.u1 - s.move.u0) * k * k * (3 - 2 * k);
      if (k >= 1) { const { done } = s.move; s.move = null; done(); }
    }
    const uu = s.back ? 1 - s.u : s.u, p = s.lane.curve.getPointAt(uu), tan = s.lane.curve.getTangentAt(uu), way = (s.back ? -1 : 1) * (s.u < was ? -1 : 1);
    if (dt > 0) s.speed += (Math.abs(s.u - was) * s.lane.len / dt - s.speed) * Math.min(1, dt * 9);
    if (s.u !== was || s.yaw == null) { const l = Math.hypot(tan.x, tan.z) || 1; s.hx = (tan.x / l) * way; s.hz = (tan.z / l) * way; }
    // she swings to her course rather than snapping to it (and comes about, when she turns for home)
    const want = Math.atan2(-s.hz, s.hx);
    if (s.yaw == null) s.yaw = want; else { const d = want - s.yaw; s.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 2.8); }
    const v = Math.min(1.25, s.speed / CRUISE);
    s.fade += (s.show - s.fade) * Math.min(1, dt * 4.5);
    if (s.left) { if (!s.trail.length || t - s.trail[0].t > 7) { scrap(s); continue; } }
    else if (!s.show && s.fade < 0.03) { scene.remove(s.group); s.sheet.geometry.dispose(); for (const m of s.mats) m.dispose(); s.oars.dispose(); s.left = true; for (const sq of squads) if (sq.aboard === s) { sq.aboard = null; squadsDirty = true; } if (camFollow === s) camFollow = null; }
    if (!s.left) {
      const g = s.group;
      g.position.set(p.x, SEA_Y + 0.02 * Math.sin(t * 1.3 + s.slot * 2), p.z);
      g.rotation.set(0.035 * Math.sin(t * 0.9 + s.slot), s.yaw, 0.02 * Math.sin(t * 1.1 + 1) + 0.025 * v);
      g.scale.setScalar(size);
      for (const m of s.mats) { const clear = s.fade < 0.985; if (m.transparent !== clear) { m.transparent = clear; m.needsUpdate = true; } m.opacity = clear ? s.fade : 1; }
      g.traverse((o) => { if (o.isMesh) o.castShadow = s.fade > 0.5; });
      // the oars: all together, the faster the more often; the blades go in as they sweep aft and come out to swing forward
      s.row += dt * (1.2 + 6 * v);
      const pull = Math.min(1, v * 3), sweep = 0.5 * pull * Math.cos(s.row), dip = 0.2 + 0.16 * pull * clamp(Math.sin(s.row) * 1.6, -0.35, 1);
      GALLEY.tholes.forEach(([x, y, z, sd], i) => { _oar.position.set(x, y, z); _oar.rotation.set(dip, sd > 0 ? sweep : Math.PI - sweep, 0); _oar.updateMatrix(); s.oars.setMatrixAt(i, _oar.matrix); });
      s.oars.instanceMatrix.needsUpdate = true;
      // the sail: full of wind, and never quite still
      const sp = s.sheet.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) { const zz = s.sheetBase[i * 3 + 2], yy = s.sheetBase[i * 3 + 1]; sp.setX(i, s.sheetBase[i * 3] + Math.sin(zz * 5 + yy * 3 - t * 5.5 + s.slot) * 0.016 * (1.9 - yy) + Math.sin(t * 1.7) * 0.02 * GALLEY.belly(zz, yy) / 0.25); }
      sp.needsUpdate = true; s.sheet.geometry.computeVertexNormals();
      g.updateMatrixWorld(true);
      if (fleet.some((x) => squads.some((sq) => sq.aboard === x))) squadsDirty = true;
    }
    // What the sea is told. The water her stern has passed through is remembered for a few seconds, point by point.
    const sx = p.x - s.hx * 1.3 * size, sz = p.z - s.hz * 1.3 * size, drive = s.left ? 0 : v * s.fade, last = s.trail[0];
    if (drive > 0.02 && (!last || t - last.t > 0.4)) s.trail.unshift({ x: sx, z: sz, t, w: drive });
    while (s.trail.length && (s.trail.length > TRAIL - 1 || t - s.trail[s.trail.length - 1].t > 7)) s.trail.pop();
    const pts = [{ x: sx, z: sz, t, w: drive }, ...s.trail], box = U.trailBox[s.slot].set(1e9, 1e9, -1e9, -1e9);
    for (let j = 0; j < TRAIL; j++) {
      const q = pts[j], uq = U.trail[s.slot * TRAIL + j];
      if (!q) { uq.w = 0; continue; }
      uq.set(q.x, q.z, q.t, q.w);
      box.x = Math.min(box.x, q.x - 2.4 * size); box.y = Math.min(box.y, q.z - 2.4 * size); box.z = Math.max(box.z, q.x + 2.4 * size); box.w = Math.max(box.w, q.z + 2.4 * size);
    }
    // (and how her course is bending, so the waves she sheds lie along the way she came)
    const fore = clamp(uu + 0.012 * way, 0, 1), aft = clamp(uu - 0.012 * way, 0, 1), ta = s.lane.curve.getTangentAt(fore), tb = s.lane.curve.getTangentAt(aft);
    const bend = fore === aft ? 0 : (((ta.x - tb.x) * s.hz - (ta.z - tb.z) * s.hx) * way) / (Math.abs(fore - aft) * s.lane.len);
    U.ships[s.slot].set(p.x, p.z, s.hx, s.hz);
    U.shipK[s.slot].set(v, bend, size, s.left ? 0 : s.fade);
  }
}
// (ships move before the soldiers aboard them are set out)
tickers.unshift(sailFleet);
{
  // A land bridge needs no sign: low stone walls and four watch fires mark the crossing.
  const stone = new THREE.MeshStandardMaterial({ color: '#8b8177', roughness: 0.95, flatShading: true });
  const fire = new THREE.MeshBasicMaterial({ color: '#ffb35a' });
  for (const st of STRAITS) for (const b of st.bridges) {
    const near = HEX.reduce((best, h) => (Math.hypot(h.x - b.x, h.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y) ? h : best), HEX[0]);
    const top = topH[near.t], halfW = Math.min(b.w, 4.2) / 2 - 0.15, g = new THREE.Group();
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(box(0.16, 0.26, 3.6), stone);
      wall.position.set(side * halfW, 0.13, 0); wall.castShadow = true; g.add(wall);
      for (const end of [-1.8, 1.8]) {
        const post = new THREE.Mesh(box(0.26, 0.5, 0.26), stone); post.position.set(side * halfW, 0.25, end); post.castShadow = true; g.add(post);
        const flame = new THREE.Mesh(ball(0.09, 0), fire); flame.position.set(side * halfW, 0.6, end); g.add(flame);
      }
    }
    // the group's x runs along the strait, its z across it
    g.position.copy(w2v(b.x, b.y, top - 0.02));
    g.rotation.y = Math.atan2(b.y, b.x);
    scene.add(g);
    bridgeSpots.push(w2v(b.x, b.y, top + 1.0));
  }
}


await pause('the war');
// =============================================================================
// the war on the map: what World tells this valley of it

const TERRAIN = { mountain: ['⛰ ', 'Mountain'], forest: ['🌲 ', 'Forest'], water: ['🌊 ', 'Water'], marsh: ['🌾 ', 'Marsh'], keep: ['♜ ', 'Keep'], open: ['', 'Open ground'] };
const ok = (t) => Number.isInteger(t) && t >= 0 && t < NT;

/** Regions the viewer holds all but one territory of: on the map the missing territory wears the region's bonus. */
const goals = () => (ME < 0 || !live ? [] : REGIONS.map((r) => ({ r, miss: r.terr.filter((x) => owner[x] !== ME) })).filter((x) => x.miss.length === 1).map((x) => ({ t: x.miss[0], name: x.r.name, bonus: x.r.bonus })));
let goalEls = [], goalKey = '';
function paintGoals() {
  const gs = goals(), key = gs.map((g) => g.t + ':' + g.bonus).join(',');
  if (key === goalKey) return;
  goalKey = key;
  for (const g of goalEls) g.el.remove();
  goalEls = gs.map((g) => { const e = document.createElement('div'); e.className = 'goal'; e.textContent = `◈ +${g.bonus}`; e.style.display = 'none'; platesEl.appendChild(e); return { ...g, el: e, on: false }; });
}
tickers.push(() => {
  for (const g of goalEls) {
    const b = plateBox[g.t];
    if (b.on !== g.on) { g.on = b.on; g.el.style.display = b.on ? '' : 'none'; }
    if (b.on) { g.el.style.transform = `translate(${b.x}px,${(b.y - plateFs * 1.9 - 7).toFixed(1)}px) translate(-50%,-100%)`; g.el.style.zIndex = b.z + 1; }
  }
});

/** Generals are told, not kept: whenever the list changes they are set out again. */
let genKey = '', pickList = null;
function setGenerals(list) {
  list = list.filter((g) => ok(g.t) && court[g.t]);
  const key = list.map((g) => [g.t, g.holder, g.name, g.wolf ? 1 : 0].join(':')).join('|');
  if (key === genKey) return;
  genKey = key;
  for (const g of generals) { scene.remove(g.group); g.cape.geo.dispose(); for (const m of g.mats) m.dispose(); }
  generals.length = 0;
  for (const g of list) addGeneral(g.t, g.holder, g.name, g.sub, g.wolf);
  pickList = null;
}

function apply(v) {
  const was = live;
  live = true;
  ME = v.me;
  const turned = [];
  for (let t = 0; t < NT; t++) {
    const o = v.owner[t] ?? -1;
    if (o !== owner[t]) { owner[t] = o; turned.push(t); plates[t].uni.uTint.value.set(colorOf(o)); plates[t].uni.uOwn.value = o >= 0 ? 1 : 0; }
    armies[t] = v.armies[t] ?? 0;
  }
  if (turned.length) {
    const edge = new Set(turned);
    for (const t of turned) for (const x of ADJ[t]) edge.add(x);
    for (const x of edge) paintFrontier(x);
    paintLakes();
    for (const k of keeps) k.flags.color.set(colorOf(owner[k.t]));
  }
  let moved = !was || turned.length > 0;
  v.standards.forEach((s, h) => {
    if (h >= HOUSES.length) return;
    const at = ok(s.at) ? s.at : KEEP[h];
    if (standardAt[h] !== at || stdTaken[h] !== s.taken) moved = true;
    standardAt[h] = at; stdTaken[h] = s.taken; stdGuard[h] = s.guard;
  });
  if (moved) placeStandards();
  for (const k of Object.keys(placed)) delete placed[k];
  Object.assign(placed, v.placed);
  setGenerals(v.generals);
  refreshSquads(); paintGoals();
  for (let t = 0; t < NT; t++) paintPlate(t);
}
function idle() {
  apply({ owner: [], armies: [], me: -1, standards: HOUSES.map((_, h) => ({ at: KEEP[h], taken: true, guard: 0 })), placed: {}, generals: [] });
  live = false;
  paintGoals();
  setHighlights(null, [], 'attack');
  setOdds(null); setDim(null); setMarks([], []); setSiege(null); clearArrow();
}

// =============================================================================
// what the map shows of it: outlines that glow (the land keeps its colour), arrows, and odds on the targets themselves

const hi = T.map(() => ({ amt: 0, pulse: 0, color: '#f3d27a' }));
function setHi(t, color, amt, pulse = 0) { const h = hi[t]; h.color = color; h.amt = amt; h.pulse = pulse; plates[t].uni.uHi.value.set(color); plates[t].uni.uHiAmt.value = amt; }
function clearHi() { for (let t = 0; t < NT; t++) { hi[t].amt = hi[t].pulse = 0; plates[t].uni.uHiAmt.value = 0; } }
/** A territory that flickers for a moment (something just happened here), over whatever glow it has. */
const flashes = new Map();
tickers.push((t) => {
  const k = 0.5 + 0.5 * Math.sin(t * 5), now = performance.now();
  for (let i = 0; i < NT; i++) if (hi[i].pulse && !flashes.has(i)) plates[i].uni.uHiAmt.value = hi[i].amt * (0.45 + 0.55 * k);
  for (const [i, f] of flashes) {
    const u = plates[i].uni, left = (f.until - now) / f.dur;
    if (left <= 0) { flashes.delete(i); u.uHi.value.set(hi[i].color); u.uHiAmt.value = hi[i].amt; continue; }
    u.uHi.value.set(f.color);
    u.uHiAmt.value = (0.6 + 0.4 * Math.sin(now * 0.02)) * Math.min(1, left * 3);
  }
});
function flash(ts, color, dur) { const now = performance.now(); for (const t of ts) if (ok(t)) flashes.set(t, { color, dur, until: now + dur }); }

const fanG = new THREE.Group(), arrowG = new THREE.Group();
scene.add(fanG, arrowG);
/** Where an arrow to a territory ends: over its army, or over Olympus (-2). */
const over = (t, lift) => (t === -2 ? new THREE.Vector3(0, OLY_Y + lift, 0) : anchor[t].clone().setY(anchor[t].y + lift));
const seaWay = (from, to) => (ok(from) && ok(to) && harbour[from] && harbour[to] ? laneOf(from, to) : null);
function addArc(group, from, to, color) {
  if (!ok(from) || !(ok(to) || to === -2) || from === to) return;
  const lane = seaWay(from, to);
  if (lane) {
    // By sea, the lane itself lights up, from the pier it leaves to the pier it lands at.
    const pts = lane.curve.getPoints(60).map((p) => p.clone().setY(SEA_Y + 0.16));
    if (lane.a !== from) pts.reverse();
    const curve = new THREE.CatmullRomCurve3(pts), m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.1, 6), m), head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), m);
    head.position.copy(pts[pts.length - 1]);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
    tube.renderOrder = head.renderOrder = 5;
    group.add(tube, head);
    return;
  }
  const a = over(from, 1.3), b = over(to, 1.3);
  const mid = a.clone().lerp(b, 0.5);
  mid.y += a.distanceTo(b) * 0.32 + 0.8;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b), m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.09, 6), m), head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.66, 10), m);
  head.position.copy(b);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
  tube.renderOrder = head.renderOrder = 5;
  group.add(tube, head);
}
function clearGroup(g) { for (const o of [...g.children]) { o.geometry?.dispose(); o.material?.dispose(); g.remove(o); } }
const clearArrow = () => clearGroup(arrowG);
function arrow(from, to, color) { clearArrow(); addArc(arrowG, from, to, color); }
/** A march over several territories: a solid line as far as it gets, a faint one beyond, and a ring where rough ground stops it short. */
function route(path, stop, color) {
  clearArrow();
  path = path.filter(ok);
  if (path.length < 2) return;
  const k = Math.max(1, path.indexOf(stop)) * 2;
  const base = path.map((t) => over(t, 1.1)), pts = [base[0]];
  for (let i = 1; i < base.length; i++) { const mid = base[i - 1].clone().lerp(base[i], 0.5); mid.y += base[i - 1].distanceTo(base[i]) * 0.3 + 0.9; pts.push(mid, base[i]); }
  const tube = (p, col, r, op) => {
    const curve = new THREE.CatmullRomCurve3(p, false, 'centripetal');
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 16 * p.length, r, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false }));
    m.renderOrder = 5; arrowG.add(m);
    return curve;
  };
  const way = tube(pts.slice(0, k + 1), color, 0.1, 0.9);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false }));
  head.position.copy(pts[k]);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), way.getTangent(1).normalize());
  head.renderOrder = 5; arrowG.add(head);
  if (k < pts.length - 1) {
    tube(pts.slice(k), '#d9cdb8', 0.05, 0.45);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 32), new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(over(stop, 0.25)); ring.renderOrder = 6; arrowG.add(ring);
  }
}

let hoverT = null, glow = { sel: null, targets: [], kind: 'attack', opts: {} }, glowKey = '';
const KIND = { attack: '#ff3b1f', fortify: '#4fd16b', place: '#f3d27a', target: '#ff9b1f', std: '#f3d27a', assault: '#f3d27a' };
/** Land you can act from: a gold outline on the ground, and a gold ring on its plate that reads from any distance. Its colour stays its own. */
function offer(t) { setHi(t, '#f3d27a', 0.55, 1); plateEls[t].classList.add('src'); }
function setHighlights(sel, targets, kind, opts = {}) {
  glow = { sel, targets, kind, opts };
  const key = JSON.stringify([sel, targets, kind, opts.sources, opts.fan, opts.warn, opts.olympus, opts.picked, opts.own, hoverT]);
  if (key === glowKey) return;
  glowKey = key;
  clearHi(); clearGroup(fanG);
  for (let t = 0; t < NT; t++) plateEls[t].classList.remove('tgt', 'src', 'ally');
  for (const t of opts.sources ?? []) if (ok(t)) offer(t);
  const warn = new Set(opts.warn ?? []), from = ok(sel) ? sel : null;
  for (const t of targets) {
    if (!ok(t)) continue;
    if (opts.own) { offer(t); continue; }
    const c = warn.has(t) ? '#ffb020' : KIND[kind] ?? KIND.attack;
    setHi(t, c, 0.9, 1);
    if (kind === 'attack') plateEls[t].classList.add(warn.has(t) ? 'ally' : 'tgt');
    if (opts.fan && from != null) addArc(fanG, from, t, c);
  }
  if (opts.fan && opts.olympus && from != null) addArc(fanG, from, -2, '#f3d27a');
  for (const t of opts.picked ?? []) if (ok(t)) setHi(t, '#f3d27a', 0.95);
  if (from != null) setHi(from, '#f3d27a', 0.95);
}
function setHover(t) {
  t = ok(t) ? t : null;
  if (t === hoverT) return;
  hoverT = t;
  // The land under the pointer is lit, its region is rimmed, and a port shows where its ships land.
  const region = t == null ? -1 : T[t].region, far = t == null ? -1 : T[t].port;
  for (let i = 0; i < NT; i++) {
    const u = plates[i].uni;
    u.uHov.value = i === t ? 1 : i === far ? 0.55 : 0;
    u.uHovR.value = i !== t && region >= 0 && T[i].region === region ? 1 : 0;
  }
  hoverLane = t == null ? null : laneAt(t);
}
function setOdds(odds) {
  const next = odds ?? {};
  for (let t = 0; t < NT; t++) {
    const a = plateOdds[t], b = next[t];
    if (!a && !b) continue;
    if (b) plateOdds[t] = b; else delete plateOdds[t];
    paintPlate(t);
  }
}
/** "My Lands": everything outside `keep` goes grey, on the ground and on its plate. */
let dimKey = '';
function setDim(keep) {
  const key = keep ? keep.map((k) => (k ? 1 : 0)).join('') : '';
  if (key === dimKey) return;
  dimKey = key;
  for (let t = 0; t < NT; t++) { const off = !!keep && !keep[t]; plates[t].uni.uDim.value = off ? 1 : 0; plateEls[t].classList.toggle('dim', off); }
}

// What an Ultimate leaves behind: a pennant on land that was seized, and hatching over a quadrant the storm struck.
const marksG = new THREE.Group();
scene.add(marksG);
let marksKey = '';
function setMarks(seized, storm) {
  const key = `${seized.map((x) => `${x.t}:${x.color}`).join(',')}|${storm.join(',')}`;
  if (key === marksKey) return;
  marksKey = key;
  marksG.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  marksG.clear();
  const pole = new THREE.MeshStandardMaterial({ color: '#f1e6d6', roughness: 0.6 });
  for (const { t, color } of seized) {
    if (!ok(t)) continue;
    const g = new THREE.Group();
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 6), pole);
    staff.position.y = 0.85; staff.castShadow = true;
    // A swallow-tailed pennant, like the flag on the Seized icon.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(0.9, 0); shape.lineTo(0.68, 0.29); shape.lineTo(0.9, 0.58); shape.lineTo(0, 0.58); shape.closePath();
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    flag.position.set(0.035, 1.08, 0);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(flag.geometry), new THREE.LineBasicMaterial({ color: '#ffffff' }));
    edge.position.copy(flag.position);
    g.add(staff, flag, edge);
    const r = Math.max(0.2, Math.min(0.8, room[t] - 0.35));
    g.position.copy(stand(t, [spot[t][0] - r, spot[t][1] + 0.3]));
    g.position.y = anchor[t].y;
    g.userData.room = room[t];
    marksG.add(g);
  }
  const struck = new Set(storm);
  for (let t = 0; t < NT; t++) plates[t].uni.uStorm.value = struck.has(t) ? 1 : 0;
}
tickers.push(() => { const s = clamp(30 / (1.7 * ppu), 1, 2.2); for (const g of marksG.children) g.scale.setScalar(Math.min(s, Math.max(1, g.userData.room / 0.5))); });

// Olympus under siege wears its garrison's number, like any army.
const olyPlate = document.createElement('div');
olyPlate.className = 'plate oly';
olyPlate.style.display = 'none';
platesEl.appendChild(olyPlate);
let siegeN = null;
function setSiege(n) {
  if (n === siegeN) return;
  siegeN = n;
  olyPlate.style.display = n == null ? 'none' : '';
  if (n != null) olyPlate.innerHTML = `<i>⛰</i><b>${n}</b><small>Olympus</small>`;
}
tickers.push(() => {
  if (siegeN == null) return;
  const s = toScreen(olympus.position, 7.4);
  olyPlate.style.visibility = s ? '' : 'hidden';
  if (s) { olyPlate.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px) translate(-50%,-100%)`; olyPlate.style.zIndex = 3000; }
});

// Blood, and the ring that runs out from a blow.
const fx = [], blood = [], stains = [];
let splats = null, shakeUntil = 0;
function splatTextures() {
  return splats ??= [0, 1, 2, 3].map((k) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const blob = (x, y, r, a) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(135,2,8,${a})`); grad.addColorStop(0.7, `rgba(165,10,14,${a * 0.9})`); grad.addColorStop(1, 'rgba(165,10,14,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    blob(64, 64, 34, 0.95);
    for (let i = 0; i < 14; i++) { const a = rnd(k, i) * Math.PI * 2, d = 18 + rnd(i, k) * 38; blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + rnd(i + 3, k) * 12, 0.85); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}
function burst(t, color, big) {
  if (!(ok(t) || t === -2)) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.7, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthTest: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(over(t, 0.12));
  ring.renderOrder = 6;
  scene.add(ring);
  fx.push({ obj: ring, t0: performance.now(), dur: big ? 1600 : 900 });
  if (big && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) shakeUntil = performance.now() + 500;
}
function bleed(t, dead, big) {
  if (dead <= 0 || !(ok(t) || t === -2)) return;
  const origin = over(t, t === -2 ? -0.5 : 0.7), floor = t === -2 ? OLY_Y - 0.2 : anchor[t].y + 0.04;
  const n = Math.round(Math.min(220, 20 + dead * 12) * (big ? 1.6 : 1));
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.6; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.6;
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * (big ? 4.2 : 2.8);
    vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = 2.4 + Math.random() * (big ? 6 : 4); vel[i * 3 + 2] = Math.sin(a) * sp;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#a4060d', size: big ? 0.3 : 0.22, transparent: true, opacity: 0.95, depthWrite: false }));
  pts.renderOrder = 7;
  scene.add(pts);
  blood.push({ pts, vel, t0: performance.now(), floor });
  // the stain it leaves: on the ground it fell on, and never out over a lake's water or a neighbour's land
  if (t === -2 || T[t].biome === 'lake') return;
  const size = Math.min(room[t] * 1.5, Math.min(3, 0.8 + Math.sqrt(dead) * 0.4) * (big ? 1.3 : 1)), reach = Math.max(0, room[t] - size * 0.55);
  const a = Math.random() * Math.PI * 2, d = Math.random() * reach;
  const stain = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: splatTextures()[Math.floor(Math.random() * 4)], transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  stain.rotation.x = -Math.PI / 2; stain.rotation.z = Math.random() * Math.PI * 2;
  stain.position.copy(stand(t, [spot[t][0] + Math.cos(a) * d, spot[t][1] + Math.sin(a) * d]));
  stain.position.y += 0.03;
  stain.renderOrder = 2;
  scene.add(stain);
  stains.push({ mesh: stain, t0: performance.now() });
  if (stains.length > 70) { const old = stains.shift(); scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose(); }
}
tickers.push(() => {
  const now = performance.now();
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], k = (now - f.t0) / f.dur;
    if (k >= 1) { scene.remove(f.obj); f.obj.geometry.dispose(); f.obj.material.dispose(); fx.splice(i, 1); continue; }
    f.obj.scale.setScalar(1 + k * (f.dur > 1000 ? 7 : 4)); f.obj.material.opacity = 0.9 * (1 - k);
  }
  for (let i = blood.length - 1; i >= 0; i--) {
    const b = blood[i], age = (now - b.t0) / 1000, pos = b.pts.geometry.attributes.position;
    if (age > 1.6) { scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); blood.splice(i, 1); continue; }
    for (let j = 0; j < pos.count; j++) {
      const y = pos.getY(j);
      if (y <= b.floor) continue;
      b.vel[j * 3 + 1] -= 22 / 60;
      pos.setXYZ(j, pos.getX(j) + b.vel[j * 3] / 60, Math.max(b.floor, y + b.vel[j * 3 + 1] / 60), pos.getZ(j) + b.vel[j * 3 + 2] / 60);
    }
    pos.needsUpdate = true;
    b.pts.material.opacity = age < 1 ? 0.95 : 0.95 * (1 - (age - 1) / 0.6);
  }
  for (const s of stains) s.mesh.material.opacity = Math.max(0.12, 0.85 - (now - s.t0) / 90000);
});

// =============================================================================
// the camera glides to the action, and looks at the middle of what the HUD leaves uncovered

let camAnim = null;
/** A ship the camera keeps in view while it crosses (when the view is too close to hold the whole lane). */
let camFollow = null;
tickers.push(() => {
  if (!camFollow || camAnim || camera.position.distanceTo(controls.target) > controls.maxDistance * 0.62) return;
  const p = camFollow.group.position, dx = (p.x - controls.target.x) * 0.07, dz = (p.z - controls.target.z) * 0.07;
  controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
});
function glideTo(points, want) {
  const to = points.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length).setY(0);
  const d = camera.position.distanceTo(controls.target);
  camAnim = { from: controls.target.clone(), to, t0: performance.now(), dist: want && d > want * 1.15 ? { from: d, to: want } : null };
}
tickers.push(() => {
  if (!camAnim) return;
  const k = Math.min(1, (performance.now() - camAnim.t0) / 700), e = 1 - Math.pow(1 - k, 3);
  const delta = camAnim.from.clone().lerp(camAnim.to, e).sub(controls.target);
  controls.target.add(delta); camera.position.add(delta);
  if (camAnim.dist) { const dir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(controls.target).addScaledVector(dir, camAnim.dist.from + (camAnim.dist.to - camAnim.dist.from) * e); }
  if (k >= 1) camAnim = null;
});
function glide(ts, near = false) {
  const pts = ts.filter((t) => ok(t) || t === -2).map((t) => (t === -2 ? new THREE.Vector3() : anchor[t]));
  if (!pts.length) return;
  let want;
  if (near) {
    const mid = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    want = Math.max(controls.minDistance * 2.4, controls.maxDistance * 0.34, Math.max(...pts.map((p) => p.distanceTo(mid))) * 2.6);
  }
  glideTo(pts, want);
}
let insetTop = 0, insetBottom = 0;
function setInsets(top, bottom) {
  insetTop = top; insetBottom = bottom;
  if (vw > 1 && vh > 1) camera.setViewOffset(vw, vh, 0, Math.round((bottom - top) / 2), vw, vh);
}

// =============================================================================
// marching: a squad goes out to a fight, comes home or goes in, walks a road, takes ship

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => 1 - Math.pow(1 - k, 3);
/** Each squad's errand, by number: a new one starts, and whatever the old one still had to do is dropped. */
const errand = T.map(() => 0);
/** Calls fn with 0..1 over `ms`. A hidden tab, a dead valley or a newer errand ends it at once. */
function tween(ms, fn, t, g) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = () => {
      if (dead || errand[t] !== g) return res();
      const k = document.hidden ? 1 : Math.min(1, (performance.now() - t0) / ms);
      fn(k);
      if (k < 1) setTimeout(step, 16); else res();
    };
    step();
  });
}
const SAIL_OUT = 4200, SAIL_HOME = 3200;
async function march(from, to, k0, k1, ms, g) {
  const a = anchor[from], b = anchor[to], sq = squads[from];
  sq.aboard = null; sq.size = 1;
  sq.face = Math.atan2(b.x - a.x, b.z - a.z) + (k1 < k0 ? Math.PI : 0);
  await tween(ms / SPEED, (k) => { sq.off = a.clone().lerp(b, k0 + (k1 - k0) * ease(k)); squadsDirty = true; }, from, g);
}
/** A squad walks from one point to another, growing or shrinking on the way (soldiers are drawn smaller aboard ship). */
async function walk(sq, a, b, ms, s0, s1, g) {
  sq.face = Math.atan2(b.x - a.x, b.z - a.z);
  await tween(ms / SPEED, (k) => { sq.off = a.clone().lerp(b, ease(k)); sq.size = s0 + (s1 - s0) * ease(k); squadsDirty = true; }, sq.t, g);
}
/** A ship that has not sailed its whole way by the time it should have (a stopped loop, a hidden tab) is waited on no longer. */
const sail = (ship, u, ms) => Promise.race([ship.sail(u, ms), sleep(ms / SPEED + 600)]);
/** An army goes to sea: a ship of its House comes to the pier, the squad goes down to the quay, out along the pier and aboard, and it sails. */
async function crossing(sq, a, b, g, start) {
  const h = harbour[a], ship = launch(a, b);
  env.sound?.('sail');
  sq.aboard = null;
  await walk(sq, start, h.quay, 560, 1, 1, g);
  await walk(sq, h.quay, h.head, 440, 1, 0.5, g);
  if (dead || errand[sq.t] !== g) { dismiss(ship); return null; }
  sq.aboard = ship; sq.off = null; sq.size = 1; squadsDirty = true;
  camFollow = ship;
  await sail(ship, 1, SAIL_OUT);
  if (camFollow === ship) camFollow = null;
  return ship;
}
/** It lands: onto the far pier, up the steps, and (with `on`) on to where the army will stand. The ship has done its work, and goes. */
async function landing(sq, ship, b, g, on) {
  const h = harbour[b];
  sq.aboard = null;
  await walk(sq, h.head, h.quay, 420, 0.5, 1, g);
  dismiss(ship);
  if (on) await walk(sq, h.quay, anchor[b], 540, 1, 1, g);
}
/** It turns for home with whoever is still aboard, and is gone once it has put them ashore. */
function recall(ship, sq) {
  sail(ship, 0, SAIL_HOME).then(() => { if (sq.aboard === ship) { sq.aboard = null; sq.off = null; squadsDirty = true; } dismiss(ship); });
}
const home0 = (sq, g) => { if (errand[sq.t] === g && !sq.aboard) { sq.off = null; sq.size = 1; squadsDirty = true; } };
/** Ships out on an attack, by the territory they sailed from: fighting off the far shore, or standing off it between tries. */
const atSea = new Map();
const bySea = (from, to) => !!seaWay(from, to) && owner[from] >= 0;
async function sortie(from, to) {
  if (!live || !ok(from) || !ok(to) || from === to || armies[from] <= 0) return;
  const out = atSea.get(from);
  if (out) {
    clearTimeout(out.timer);
    if (out.to === to && !out.ship.left) return; // still standing off that shore: no need to sail again
    atSea.delete(from); recall(out.ship, squads[from]);
  }
  const g = ++errand[from], sq = squads[from];
  if (bySea(from, to)) { const ship = await crossing(sq, from, to, g, anchor[from]); if (ship) atSea.set(from, { to, ship, timer: 0 }); }
  else await march(from, to, 0, 0.58, 650, g);
}
async function settle(from, to, won, more = false) {
  if (!ok(from) || !ok(to)) return;
  const g = errand[from], sq = squads[from], out = atSea.get(from);
  if (out && out.to === to) {
    if (won) { atSea.delete(from); await landing(sq, out.ship, to, g, true); }
    else if (more) { out.timer = setTimeout(() => { if (atSea.get(from) === out) { atSea.delete(from); recall(out.ship, sq); } }, 7000 / SPEED); return; }
    else { atSea.delete(from); recall(out.ship, sq); return; }
  } else if (sq.off) await march(from, to, 0.58, won ? 1 : 0, won ? 380 : 420, g);
  home0(sq, g);
}
async function travel(path, stop) {
  path = path.filter(ok);
  const end = Math.max(1, path.indexOf(stop));
  if (!live || path.length < 2 || armies[path[0]] <= 0) return;
  const from = path[0], g = ++errand[from], sq = squads[from];
  let at = anchor[from];
  for (let i = 1; i <= end && !dead && errand[from] === g; i++) {
    const a = path[i - 1], b = path[i];
    if (bySea(a, b)) { const ship = await crossing(sq, a, b, g, at); if (ship) await landing(sq, ship, b, g, true); }
    else await walk(sq, at, anchor[b], 620, 1, 1, g);
    at = anchor[b];
  }
  if (errand[from] === g) { sq.aboard = null; home0(sq, g); }
}

// =============================================================================
// names and regions: only while asked for

let labels = null, reveal = false;
function setReveal(on) {
  if (reveal === on) return;
  reveal = on;
  U.reveal.value = on ? 1 : 0;
  platesEl.classList.toggle('reveal', on);
  if (on && !labels) {
    const mk = (cls, html) => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; platesEl.appendChild(e); return e; };
    labels = {
      terr: T.map((t) => mk('tn', `${TERRAIN[t.terrain]?.[0] ?? ''}${t.name}${laneAt(t.id) ? ` ⚓ ${laneAt(t.id).mark} → ${T[t.port].name}` : ''}`)),
      region: REGIONS.map((r) => mk('rn', `${r.name.replace(/^The /, '')}<b>+${r.bonus}</b>`)),
      bridge: bridgeSpots.map(() => mk('bn', '⇄ Land bridge')),
    };
  }
}
tickers.push(() => {
  if (!reveal || !labels) return;
  const put = (e, s, dy, z) => { e.style.display = s ? '' : 'none'; if (s) { e.style.transform = `translate(${s.x.toFixed(1)}px,${(s.y + dy).toFixed(1)}px) translate(-50%,0)`; e.style.zIndex = z; } };
  const near = ppu > 9 * zoomK; // names only once there is room for them
  labels.terr.forEach((e, t) => put(e, near ? toScreen(anchor[t], 0) : null, 6, 1));
  labels.region.forEach((e, i) => {
    const r = REGIONS[i], o = owner[r.terr[0]], held = live && o >= 0 && r.terr.every((x) => owner[x] === o);
    e.classList.toggle('mine', held && o === ME);
    e.style.borderColor = held && o !== ME ? HOUSES[o].color : '';
    put(e, toScreen(w2v(r.at[0], r.at[1], 1.2), 0), near ? 26 : 0, 2000);
  });
  labels.bridge.forEach((e, i) => put(e, toScreen(bridgeSpots[i], 0), 0, 2000));
});
// Every port wears its lane's mark over its pier, always: the two ends of a crossing can be matched from any distance.
const portEls = lanes.flatMap((l) => [l.a, l.b].map((t) => {
  const e = document.createElement('div');
  e.className = 'pt'; e.style.setProperty('--c', l.ink); e.innerHTML = `⚓<b>${l.mark}</b>`;
  platesEl.appendChild(e);
  return { e, t, l, key: '' };
}));
tickers.push(() => {
  for (const p of portEls) {
    const at = toScreen(harbour[p.t].head, 1.1), key = at ? `${at.x.toFixed(1)},${at.y.toFixed(1)},${p.l === hoverLane ? 1 : 0}` : '';
    if (key === p.key) continue;
    p.key = key;
    p.e.style.display = at ? '' : 'none';
    if (at) p.e.style.transform = `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px) translate(-50%,-50%)`;
    p.e.classList.toggle('on', p.l === hoverLane);
  }
});
const olyMats = [];
olympus.traverse((o) => { if (o.isMesh && o.castShadow) o.userData.casts = true; });
olympus.traverse((o) => { if (o.isMesh && !o.userData.wet && !olyMats.includes(o.material)) olyMats.push(o.material); });
function setGhost(on) {
  for (const m of olyMats) { m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true; }
  // its running water goes too (the falls stay, to show where it hangs)
  olympus.traverse((o) => { if (!o.isMesh) return; if (o.userData.wet) { if (!o.userData.fall) o.visible = !on; } else if (o.userData.casts) o.castShadow = !on; });
}
function setOlympus(look) {
  if (look === olyLook) return;
  olyLook = look;
  setGhost(look === 'ghost');
  olympus.visible = olyBase.visible = look !== 'hidden';
}

// =============================================================================
// the pointer on the map

const ray = new THREE.Raycaster();
function pickables() {
  const list = plates.map((p) => p.mesh);
  for (const k of keeps) k.group.traverse((o) => { if (o.isMesh) list.push(o); });
  for (const g of generals) g.group.traverse((o) => { if (o.isMesh) list.push(o); });
  olympus.traverse((o) => { if (o.isMesh && !o.userData.wet) list.push(o); });
  return list;
}
function pickAt(x, y) {
  const r = renderer.domElement.getBoundingClientRect(), px = x - r.left, py = y - r.top;
  // A count plate floats over its army, so a click on one means its territory, not the land behind it.
  const p = live ? plateAt(px, py) : -1;
  if (p >= 0) return p;
  ray.setFromCamera(new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), camera);
  pickList ??= pickables();
  const hit = ray.intersectObjects(olyLook === 'solid' ? pickList : pickList.filter((o) => o.userData.t !== -2), false)[0];
  return hit ? hit.object.userData.t ?? null : null;
}
function screenPos(t, lift = 1.5) {
  const r = renderer.domElement.getBoundingClientRect();
  const s = (ok(t) || t === -2) && toScreen(t === -2 ? new THREE.Vector3(0, OLY_Y, 0) : squadAt(squads[t]), lift);
  return s ? { x: r.left + s.x, y: r.top + s.y } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// =============================================================================
// size, and the loop

let fitDist = 100;
function home() {
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1 || dir.y / dir.length() < 0.3) dir.set(0, 104, 66);
  dir.normalize();
  const mine = live && ME >= 0 && vw / vh < 0.8 ? KEEP[ME] : -1;
  // A phone held upright opens on your own land, close enough to read; pinch out for the whole valley.
  if (mine >= 0) controls.target.copy(anchor[mine]).setY(0); else controls.target.set(0, 0, 1);
  camera.position.copy(controls.target).addScaledVector(dir, mine >= 0 ? fitDist * 0.34 : fitDist);
  camAnim = null;
}
let sized = false;
function resize(goHome = false) {
  const w = device.clientWidth, h = device.clientHeight;
  if (!w || !h) return;
  vw = w; vh = h;
  const aspect = w / h;
  camera.aspect = aspect;
  camera.fov = aspect < 0.8 ? 55 : 42;
  camera.updateProjectionMatrix();
  // pull back so the whole valley fits the narrower screen axis
  const vHalf = (camera.fov * Math.PI) / 360, hHalf = Math.atan(Math.tan(vHalf) * aspect);
  fitDist = Math.max(55, (R_OUT + 4) / Math.tan(Math.min(vHalf, hHalf)));
  controls.maxDistance = fitDist * 1.25;
  if (!sized || goHome) home();
  else {
    // (a phone's address bar coming and going is not a reason to lose your place)
    const d = camera.position.distanceTo(controls.target);
    if (d > controls.maxDistance) camera.position.sub(controls.target).multiplyScalar(controls.maxDistance / d).add(controls.target);
  }
  sized = true;
  setInsets(insetTop, insetBottom);
  for (const b of plateBox) b.w = 0;
}

const t0 = performance.now();
function frame() {
  if (dead) return;
  const now = performance.now(), t = (now - t0) / 1000;
  U.time.value = t;
  // Don't let the camera wander off the edge of the world.
  const tg = controls.target, lim = R_OUT + 6, r = Math.hypot(tg.x, tg.z);
  if (r > lim) { const k = lim / r, dx = tg.x * (k - 1), dz = tg.z * (k - 1); tg.x += dx; tg.z += dz; camera.position.x += dx; camera.position.z += dz; }
  tg.y = 0;
  controls.update();
  const d = camera.position.distanceTo(controls.target);
  ppu = vh / (2 * d * Math.tan((camera.fov * Math.PI) / 360));
  zoomK = clamp(Math.min(vw, vh) / 760, 0.5, 1);
  U.pol.value = 1 - smooth(11 * zoomK, 24 * zoomK, ppu);
  // Haze begins behind the board, so the land you play on stays clear at any zoom.
  scene.fog.near = U.fogNear.value = d * 0.9 + 18;
  scene.fog.far = U.fogFar.value = d + 250;
  olympus.position.y = OLY_Y + Math.sin(t * 0.6) * 0.3;
  olympus.rotation.y = olyBase.rotation.y = t * 0.03;
  for (const c of U.clouds) { const a = c.userData.a + t * c.userData.w; c.position.set(Math.cos(a) * c.userData.d, c.userData.y, Math.sin(a) * c.userData.d); }
  // the sea is told where each waterfall lands as Olympus turns, and the spray there breathes
  { const c = Math.cos(olympus.rotation.y), s = Math.sin(olympus.rotation.y), on = olyLook === 'hidden' ? 0 : 1; U.feet.forEach(([x, z], i) => U.falls[i].set(x * c + z * s, z * c - x * s, on)); }
  for (const sp of U.spray) sp.material.opacity = sp.userData.op * (0.8 + 0.2 * Math.sin(t * 1.3 + sp.userData.ph));
  U.mist.forEach((m, i) => { m.rotation.z = t * 0.004 * (i % 2 ? -1 : 1); });
  // (plates are put where the camera is now, not where it was a frame ago)
  camera.updateMatrixWorld();
  for (const f of tickers) f(t);
  if (now < shakeUntil) {
    const dx = (Math.random() - 0.5) * 0.4, dy = (Math.random() - 0.5) * 0.4;
    camera.position.x += dx; camera.position.y += dy;
    renderer.render(scene, camera);
    camera.position.x -= dx; camera.position.y -= dy;
  } else renderer.render(scene, camera);
}

/** The lakes' middles, for telling how near the camera is to one. */
const lakeSpots = T.filter((t) => t.biome === 'lake').map((t) => anchor[t.id]);
function ambience() {
  const tg = controls.target, d = camera.position.distanceTo(tg), near = 1 - smooth(fitDist * 0.22, fitDist * 0.85, d);
  const r = Math.hypot(tg.x, tg.z);
  let lake = 0;
  for (const p of lakeSpots) lake = Math.max(lake, 1 - smooth(2, 7, Math.hypot(p.x - tg.x, p.z - tg.z)));
  const sea = 1 - smooth(R_IN - 2, R_IN + 8, r);
  let oars = 0;
  for (const s of fleet) if (!s.left) oars = Math.max(oars, s.fade * Math.min(1, (s.speed || 0) / CRUISE) * (0.35 + 0.65 * (1 - smooth(8, 40, s.group.position.distanceTo(tg)))));
  const under = hexAt.get(Math.round(tg.x / SQ3 + tg.z / 3) + ',' + Math.round(-tg.z / 1.5));
  return {
    water: live ? Math.max(sea, lake) * (0.12 + 0.88 * near) : 0,
    falls: live && olyLook !== 'hidden' ? (1 - smooth(4, R_IN * 0.85, r)) * (0.1 + 0.9 * near) : 0,
    oars,
    frost: live && under && T[under.t].quadrant === 2 ? near : 0,
  };
}

function dispose() {
  dead = true;
  for (const m of atSea.values()) clearTimeout(m.timer);
  platesEl.replaceChildren();
  platesEl.classList.remove('reveal');
  camera.clearViewOffset();
  const seen = new Set();
  const drop = (x) => { if (x && typeof x.dispose === 'function' && !seen.has(x)) { seen.add(x); x.dispose(); } };
  scene.traverse((o) => {
    drop(o.geometry);
    for (const m of [].concat(o.material ?? [])) drop(m);
    if (o.isInstancedMesh) o.dispose();
    o.shadow?.dispose?.();
  });
  for (const tex of made) drop(tex);
  drop(envTarget);
  scene.clear();
}

resize();
idle();
return {
  scene, frame, resize, home, dispose, apply, idle,
  setHighlights, setHover, setOdds, setDim, setMarks, setSiege, setOlympus, setReveal, setInsets,
  setSpeed: (k) => { SPEED = Math.max(0.25, k || 1); },
  arrow, route, clearArrow, flash, burst, bleed,
  sortie, settle, travel, bySea,
  pickAt, screenPos, glide, ambience,
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
};
}
