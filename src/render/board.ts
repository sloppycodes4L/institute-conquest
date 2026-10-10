// A Skirmish board: a war-room map on a table. The sheet (warmap.ts) is vellum, inked and washed in its holders'
// colours; it lies on dark wood with the rods it hangs from, and the armies on it are wooden pieces: a cube for one,
// a long block for five, a pyramid for ten, and a wooden coin beside each garrison with its count. Take a territory and
// its wash turns to your colour. There is no Olympus here, no Keeps and no Standards.
//
// It answers to the same interface as the valley (valley.ts), so World (scene.ts) drives either without knowing which.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HOUSES } from '../engine/data.ts';
import { composeSheet, landAt, paintSheet, sheetFonts, sheetFor } from './warmap.ts';
import type { GlowKind, GlowOpts, Odds, Valley, ValleyEnv, WarView } from './valley.ts';

const GLOW: Record<GlowKind, string> = { attack: '#ff5a3c', fortify: '#5fe08a', place: '#5fe08a', target: '#ffd166', std: '#ffd166', assault: '#ffd166' };
/** Land no House holds (a House that conceded leaves it behind): a grey-brown wash. */
const NEUTRAL = '#8d8573';
const ROOM = '#050302';
/** The sheet lies this far above the table. */
const SHEET_Y = 0.04;
/** How large the pieces are drawn up close; from further off they grow, so a count can still be read. */
const PIECE = 1.5, PIECE_FAR = 2.8;
type Kind = 'cube' | 'bar' | 'pyr';
const TALL: Record<Kind, number> = { cube: 0.86, bar: 0.8, pyr: 1.25 };
type Pt = [number, number];

export async function createBoard(env: ValleyEnv): Promise<Valley> {
  const { renderer, camera, controls, geo: G } = env;
  const host = env.host, layer = env.layer, Q = env.quality;
  const info = G.skirmish!, NT = G.nt;
  let dead = false, vw = 1, vh = 1;

  await env.pause?.('the war table');
  await sheetFonts();
  const sheet = sheetFor(info.id);
  const SW: number = sheet.SW, SH: number = sheet.SH, W2 = SW / 2, H2 = SH / 2;
  await env.pause?.('the map');
  const side = Math.min(renderer.capabilities.maxTextureSize, Q.shadow >= 2048 ? 5120 : Q.shadow ? 3584 : 2560);
  const art = paintSheet(sheet, side);
  const tints: (string | null)[] = new Array(NT).fill(null);
  composeSheet(art, sheet, tints);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ROOM);
  scene.fog = new THREE.Fog(ROOM, 400, 1400);
  const rnd = (seed: number) => { let s = seed | 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /** Everything here is lit as it was painted: the renderer's film curve would grey the vellum. */
  const plain = <M extends THREE.Material>(m: M) => { m.toneMapped = false; return m; };

  // ---------------------------------------------------------------------------
  // the room: lamplight, a table of dark wood, the sheet and its rods

  const R = Math.max(SW, SH) / 2 + 8;
  scene.add(new THREE.HemisphereLight('#fff1dc', '#2a1a10', 1.75));
  const sun = new THREE.DirectionalLight('#ffe3bd', 2.3);
  sun.position.set(-R * 0.55, R * 1.35, -R * 0.5);
  if (Q.shadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(Q.shadow * 2, Q.shadow * 2);
    const c = sun.shadow.camera;
    c.left = -R * 1.1; c.right = R * 1.1; c.top = R * 1.1; c.bottom = -R * 1.1; c.near = 1; c.far = R * 5;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun, sun.target);

  function grain(w: number, h: number, bg: string, lines: number, tint: (v: number) => string) {
    const c = canvasOf(w, h), x = c.getContext('2d')!, r = rnd(w + lines);
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i++) {
      const y = r() * h, len = w * (0.2 + r() * 0.8), x0 = r() * w - len / 2;
      x.strokeStyle = tint(r()); x.lineWidth = 0.6 + r() * 1.8;
      x.beginPath(); x.moveTo(x0, y); x.bezierCurveTo(x0 + len * 0.3, y + (r() - 0.5) * 7, x0 + len * 0.7, y + (r() - 0.5) * 7, x0 + len, y + (r() - 0.5) * 4); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  const tableTex = grain(1024, 1024, '#2b1a0f', 1500, (v) => (v < 0.7 ? `rgba(8,4,2,${0.08 + v * 0.22})` : `rgba(140,92,48,${0.05 + (v - 0.7) * 0.2})`));
  { const c = (tableTex.image as HTMLCanvasElement).getContext('2d')!; c.fillStyle = 'rgba(0,0,0,.55)'; for (const y of [0, 340, 690]) c.fillRect(0, y, 1024, 3); }
  tableTex.repeat.set(5000 / 90, 5000 / 90);
  const woodTex = grain(256, 256, '#ffffff', 220, (v) => `rgba(40,20,5,${0.04 + v * 0.12})`);
  {
    const table = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), plain(new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.62 })));
    table.rotation.x = -Math.PI / 2; table.receiveShadow = true;
    scene.add(table);
  }
  const sheetTex = new THREE.CanvasTexture(art.out as HTMLCanvasElement);
  sheetTex.colorSpace = THREE.SRGBColorSpace;
  sheetTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), plain(new THREE.MeshLambertMaterial({ map: sheetTex, alphaTest: 0.5 })));
    m.rotation.x = -Math.PI / 2; m.position.y = SHEET_Y; m.receiveShadow = true;
    scene.add(m);
    // the dark it throws on the table round its edges
    const c = canvasOf(256, 256), x = c.getContext('2d')!;
    x.fillStyle = 'rgba(0,0,0,.1)';
    for (let i = 0; i < 12; i++) x.fillRect(2 + i * 1.6, 2 + i * 1.6, 252 - i * 3.2, 252 - i * 3.2);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(SW * 1.085, SH * (SW > SH ? 1.13 : 1.085)), plain(new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0.8, 0.015, 1);
    scene.add(sh);
    // the rods it hangs from, lying with it on the table
    const rodMat = plain(new THREE.MeshStandardMaterial({ color: '#4a2c17', map: woodTex, roughness: 0.5 })), brass = plain(new THREE.MeshStandardMaterial({ color: '#c79a3c', roughness: 0.32, metalness: 0.35 }));
    for (const z of [-H2 + 0.5, H2 - 0.5]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, SW + 7, 24), rodMat);
      rod.rotation.z = Math.PI / 2; rod.position.set(0, 1, z); rod.castShadow = !!Q.shadow; rod.receiveShadow = true;
      scene.add(rod);
      for (const px of [-W2 - 3.5, W2 + 3.5]) { const f = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 14), brass); f.position.set(px, 1, z); f.castShadow = !!Q.shadow; scene.add(f); }
    }
  }

  const HEART: Pt[] = sheet.heart;
  /** A point over a territory's garrison, `lift` above the sheet. */
  const at = (t: number, lift = 0) => new THREE.Vector3(HEART[t][0] - W2, SHEET_Y + lift, HEART[t][1] - H2 - 0.35);
  const ok = (t: number | null | undefined): t is number => t != null && t >= 0 && t < NT;
  const onSheet = (p: Pt, y: number) => new THREE.Vector3(p[0] - W2, y, p[1] - H2);

  // ---------------------------------------------------------------------------
  // what lights up on the sheet: a territory's whole ground, and a band just inside its border

  const fills: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  const bands: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let t = 0; t < NT; t++) {
    const ring: Pt[] = (sheet.rings[t][0] as Pt[]).filter((_, i) => i % 2 === 0);
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x - W2, -(y - H2))))), plain(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })));
    fill.rotation.x = -Math.PI / 2; fill.position.y = SHEET_Y + 0.02; fill.visible = false; fill.renderOrder = 1;
    // the band: a ribbon from the border inward
    const n = ring.length, area = ring.reduce((s, p, i) => { const q = ring[(i + 1) % n]; return s + p[0] * q[1] - q[0] * p[1]; }, 0), turn = area > 0 ? 1 : -1;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n], p = ring[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (-(b[1] - a[1]) / len) * turn, ny = ((b[0] - a[0]) / len) * turn;
      pos.push(p[0] + nx * 0.14 - W2, 0, p[1] + ny * 0.14 - H2, p[0] + nx * 0.78 - W2, 0, p[1] + ny * 0.78 - H2);
      const j = (i + 1) % n;
      idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setIndex(idx);
    const band = new THREE.Mesh(bg, plain(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
    band.position.y = SHEET_Y + 0.03; band.visible = false; band.renderOrder = 2;
    fills.push(fill); bands.push(band);
    scene.add(fill, band);
  }

  // ---------------------------------------------------------------------------
  // sea lanes: the road an army takes across the water

  interface Way { a: number; b: number; wrap: boolean; pts: THREE.Vector3[]; back?: THREE.Vector3[] }
  const ways: Way[] = (sheet.ways as { a: number; b: number; wrap: boolean; pts: Pt[]; back?: Pt[] }[]).map((w) => ({ a: w.a, b: w.b, wrap: w.wrap, pts: w.pts.map((p) => onSheet(p, SHEET_Y + 0.3)), back: w.back?.map((p) => onSheet(p, SHEET_Y + 0.3)) }));
  const wayOf = (from: number, to: number) => ways.find((w) => (w.a === from && w.b === to) || (w.a === to && w.b === from)) ?? null;
  /** From one territory to a neighbour: over the border, or out along the lane. */
  function road(from: number, to: number): THREE.Vector3[] {
    const w = wayOf(from, to);
    if (!w) return [at(from), at(to)];
    const fwd = w.a === from;
    const sea = fwd ? w.pts : w.back ? w.back.slice().reverse() : w.pts.slice().reverse();
    const rest = w.back ? (fwd ? w.back : w.pts.slice().reverse()) : [];
    return [at(from), ...sea.map((p) => p.clone().setY(SHEET_Y)), ...rest.map((p) => p.clone().setY(SHEET_Y)), at(to)];
  }

  // ---------------------------------------------------------------------------
  // the war on the table

  let ME = -1, live = false, SPEED = 1;
  const owner = new Array<number>(NT).fill(-1), armies = new Array<number>(NT).fill(0);
  const placed: Record<number, number> = {};
  let plateOdds: Record<number, Odds> = {};
  let dim: boolean[] | null = null;
  const stormy = new Set<number>(), seized = new Map<number, string>();
  let hover: number | null = null;
  const hi = Array.from({ length: NT }, () => ({ color: '#ffffff', amt: 0, pulse: false }));
  const flashes = new Map<number, { color: string; dur: number; until: number }>();

  // the pieces
  const shapes: Record<Kind | 'coin' | 'face', THREE.BufferGeometry> = {
    cube: new RoundedBoxGeometry(0.86, 0.86, 0.86, 3, 0.09),
    bar: new RoundedBoxGeometry(2.05, 0.8, 0.8, 3, 0.09),
    pyr: (() => { const g = new THREE.ConeGeometry(0.84, 1.25, 4).toNonIndexed(); g.rotateY(Math.PI / 4); g.computeVertexNormals(); return g; })(),
    coin: new THREE.CylinderGeometry(0.98, 0.98, 0.26, 36),
    face: new THREE.CircleGeometry(0.98, 36),
  };
  const paint = [...HOUSES.map((h) => h.color), NEUTRAL].map((c) => plain(new THREE.MeshStandardMaterial({ color: c, map: woodTex, roughness: 0.46 })));
  const paintOf = (h: number) => paint[h >= 0 && h < HOUSES.length ? h : HOUSES.length];
  const coinMat = plain(new THREE.MeshStandardMaterial({ color: '#c9a56b', map: woodTex, roughness: 0.6 }));
  const faces = new Map<number, THREE.MeshStandardMaterial>();
  function faceOf(n: number) {
    let m = faces.get(n);
    if (!m) {
      const c = canvasOf(128, 128), x = c.getContext('2d')!, r = rnd(n * 13 + 1);
      x.fillStyle = '#d6b47a'; x.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 30; i++) { x.strokeStyle = `rgba(90,55,20,${0.05 + r() * 0.1})`; x.lineWidth = 1 + r() * 2; const y = r() * 128; x.beginPath(); x.moveTo(0, y); x.lineTo(128, y + (r() - 0.5) * 8); x.stroke(); }
      x.strokeStyle = 'rgba(60,34,12,.7)'; x.lineWidth = 4; x.beginPath(); x.arc(64, 64, 55, 0, 6.3); x.stroke();
      x.fillStyle = '#2a160a'; x.font = `900 ${n > 99 ? 46 : n > 9 ? 62 : 76}px Cinzel, serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 64, 69);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      m = plain(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      faces.set(n, m);
    }
    return m;
  }
  /** Where each piece of a garrison of `n` stands, around its territory's heart. */
  function spotsFor(n: number, r: () => number) {
    const P = Math.min(4, Math.floor(n / 10)), rest = Math.min(n - P * 10, 49), B = Math.floor(rest / 5), C = rest % 5;
    const cubes: [number, number, number][] = [[], [[0, 0, 0]], [[-0.5, 0, 0], [0.5, 0, 0]], [[-0.5, 0, 0], [0.5, 0, 0], [0, 1, 0]], [[-0.5, 0, -0.42], [0.5, 0, -0.42], [-0.12, 0, 0.56], [0, 1, -0.42]]][C] as [number, number, number][];
    const cw = C > 1 ? 1.95 : C ? 0.95 : 0, bars = Math.min(B, 2), fw = bars * 2.2 + (bars && C ? 0.25 : 0) + cw, two = P > 0 && (B > 0 || C > 0), zf = two ? 0.8 : 0, zb = two ? -0.72 : 0;
    const spots: { kind: Kind; x: number; z: number; lvl: number; rot: number }[] = [];
    for (let i = 0; i < P; i++) spots.push({ kind: 'pyr', x: (i - (P - 1) / 2) * 1.5, z: zb, lvl: 0, rot: 0 });
    let x = -fw / 2;
    // (a garrison past forty stacks its long blocks)
    for (let i = 0; i < B; i++) { const col = i % 2, lvl = Math.floor(i / 2); spots.push({ kind: 'bar', x: x + 1.05 + col * 2.2, z: zf, lvl, rot: 0 }); }
    x += bars * 2.2 + (bars && C ? 0.25 : 0);
    for (const [dx, lvl, dz] of cubes) spots.push({ kind: 'cube', x: x + cw / 2 + dx * 0.95, z: zf + dz * 0.95, lvl, rot: 0 });
    for (const s of spots) { s.rot = (r() - 0.5) * (s.kind === 'bar' ? 0.22 : 0.5); s.x += (r() - 0.5) * 0.08; s.z += (r() - 0.5) * 0.08; }
    return { spots, width: Math.max(fw, P * 1.5) };
  }
  interface Pile { g: THREE.Group; key: string; reach: number }
  const piles: (Pile | null)[] = new Array(NT).fill(null);
  const drops: { m: THREE.Object3D; y: number; t0: number }[] = [];
  let pieceScale = PIECE;
  function dropPile(t: number) {
    const p = piles[t];
    if (!p) return;
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].m.parent === p.g) drops.splice(i, 1);
    scene.remove(p.g);
    piles[t] = null;
  }
  /** Stand a territory's garrison on the sheet. `fresh`: how it arrives ('all' drops every piece in, 'one' the last). */
  function standPile(t: number, fresh: 'none' | 'one' | 'all') {
    const n = armies[t], h = owner[t], key = h + '|' + n;
    if (!live || n <= 0) { dropPile(t); return; }
    if (piles[t]?.key === key) return;
    dropPile(t);
    const g = new THREE.Group(), { spots, width } = spotsFor(n, rnd(t * 97 + 5));
    const shift = -(1.15 + 0.98) / 2, now = performance.now();
    spots.forEach((s, i) => {
      const m = new THREE.Mesh(shapes[s.kind], paintOf(h));
      m.castShadow = !!Q.shadow; m.receiveShadow = true;
      m.position.set(s.x + shift, TALL[s.kind] / 2 + s.lvl * (s.kind === 'bar' ? TALL.bar : TALL.cube), s.z);
      m.rotation.y = s.rot;
      if (fresh === 'all' || (fresh === 'one' && i === spots.length - 1)) { drops.push({ m, y: m.position.y, t0: now + (fresh === 'all' ? i * 45 : 0) }); m.visible = false; }
      g.add(m);
    });
    const body = new THREE.Mesh(shapes.coin, coinMat), face = new THREE.Mesh(shapes.face, faceOf(n));
    body.position.set(width / 2 + 1.15 + shift, 0.13, 0.25); body.castShadow = !!Q.shadow; body.receiveShadow = true;
    face.rotation.x = -Math.PI / 2; face.position.set(body.position.x, 0.262, 0.25);
    g.add(body, face);
    g.position.copy(at(t));
    g.scale.setScalar(pieceScale);
    scene.add(g);
    piles[t] = { g, key, reach: width / 2 + 1.6 };
  }
  const bounce = (x: number) => { const n = 7.5625, d = 2.75; return x < 1 / d ? n * x * x : x < 2 / d ? n * (x -= 1.5 / d) * x + 0.75 : x < 2.5 / d ? n * (x -= 2.25 / d) * x + 0.9375 : n * (x -= 2.625 / d) * x + 0.984375; };
  function dropFrame() {
    const now = performance.now();
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (now < d.t0) continue;
      const k = Math.min(1, ((now - d.t0) / 420) * SPEED);
      d.m.visible = true;
      d.m.position.y = d.y + (1 - bounce(k)) * 4;
      if (k >= 1) drops.splice(i, 1);
    }
  }

  // What the coin cannot say: armies placed this Draft, and the odds of an attack. A small plate over the garrison.
  layer.classList.add('table');
  const plateEls = sheet.names.map((_: string, t: number) => { const el = document.createElement('div'); el.className = 'plate'; el.dataset.t = String(t); el.style.display = 'none'; layer.appendChild(el); return el; }) as HTMLDivElement[];
  const regionEls = (sheet.regions as { name: string; bonus: number; at: Pt }[]).map((r) => { const el = document.createElement('div'); el.className = 'rn'; el.innerHTML = `${r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')} <b>+${r.bonus}</b>`; layer.appendChild(el); return el; });
  const plateBox = Array.from({ length: NT }, () => ({ on: false, x: -1, y: -1, w: 0, h: 0, key: '', has: false }));
  let glowTargets = new Set<number>(), glowSources = new Set<number>(), glowWarn = new Set<number>();
  function paintPlate(t: number) {
    const el = plateEls[t], od = plateOdds[t], b = plateBox[t], add = placed[t] || 0;
    const cls = (glowTargets.has(t) ? ' tgt' : '') + (glowWarn.has(t) ? ' ally' : '') + (dim && !dim[t] ? ' dim' : '');
    const key = [add, od ? (od.overwhelm ? 'w' : Math.round(od.p * 100)) : '', cls].join('|');
    if (b.key === key) return;
    b.key = key; b.w = 0; b.has = !!add || !!od;
    el.className = 'plate' + cls;
    el.innerHTML = (add ? `<em>+${add}</em>` : '')
      + (od ? `<u class="${od.overwhelm || od.p >= 0.65 ? 'good' : od.p >= 0.4 ? 'even' : 'bad'}">${od.overwhelm ? '🏳' : Math.round(od.p * 100) + '%'}</u>` : '');
  }

  const _v = new THREE.Vector3();
  function toScreen(p: THREE.Vector3, lift = 0) {
    _v.set(p.x, p.y + lift, p.z).project(camera);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * vw, y: (-_v.y * 0.5 + 0.5) * vh };
  }
  let ppu = 6, plateFs = 0, reveal = false;
  const regionMine = regionEls.map(() => false);
  function placeLabels() {
    const fs = +Math.max(12.5, Math.min(18, ppu * 2)).toFixed(1);
    if (fs !== plateFs) { plateFs = fs; layer.style.setProperty('--fs', fs + 'px'); for (const b of plateBox) b.w = 0; }
    // (a coin about 30 pixels across can be read; closer in, the pieces keep their own size)
    const want = Math.max(PIECE, Math.min(PIECE_FAR, 30 / (1.96 * ppu)));
    if (Math.abs(want - pieceScale) > 0.01) { pieceScale = want; for (const p of piles) p?.g.scale.setScalar(want); }
    for (let t = 0; t < NT; t++) {
      const el = plateEls[t], b = plateBox[t];
      const s = b.has && live && armies[t] > 0 ? toScreen(at(t), 2.3 * pieceScale) : null;
      if (!s || s.x < -80 || s.x > vw + 80 || s.y < -10 || s.y > vh + 60) { if (b.on) { b.on = false; el.style.display = 'none'; } continue; }
      if (!b.on) { b.on = true; el.style.display = ''; }
      const x = Math.round(s.x * 10) / 10, y = Math.round(s.y * 10) / 10;
      if (x !== b.x || y !== b.y) { b.x = x; b.y = y; el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`; el.style.zIndex = String(Math.round(y)); }
    }
    (sheet.regions as { at: Pt }[]).forEach((r, i) => {
      const el = regionEls[i], s = reveal ? toScreen(onSheet(r.at, SHEET_Y), 0) : null;
      if (!s) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.transform = `translate(${s.x.toFixed(1)}px,${(s.y - 26).toFixed(1)}px) translate(-50%,-100%)`;
      el.classList.toggle('mine', regionMine[i]);
    });
  }
  function plateAt(px: number, py: number) {
    let best = -1;
    for (let t = 0; t < NT; t++) {
      const b = plateBox[t];
      if (!b.on) continue;
      if (!b.w) { b.w = plateEls[t].offsetWidth; b.h = plateEls[t].offsetHeight; }
      if (px >= b.x - b.w / 2 - 2 && px <= b.x + b.w / 2 + 2 && py >= b.y - b.h - 2 && py <= b.y + 4 && (best < 0 || b.y > plateBox[best].y)) best = t;
    }
    return best;
  }

  /** Lay the holders' colours on the sheet again, for the territories whose holder changed (all of them, with none named). */
  function wash(changed?: number[]) {
    for (let t = 0; t < NT; t++) tints[t] = owner[t] >= 0 ? HOUSES[owner[t]].color : live ? NEUTRAL : null;
    composeSheet(art, sheet, tints, changed);
    sheetTex.needsUpdate = true;
  }
  function apply(v: WarView) {
    const first = !live, changed: number[] = [];
    live = true;
    ME = v.me;
    for (let t = 0; t < NT; t++) {
      const o = v.owner[t] ?? -1, n = v.armies[t] ?? 0, was = owner[t], had = armies[t];
      owner[t] = o; armies[t] = n;
      if (o !== was) changed.push(t);
      standPile(t, first ? 'none' : o !== was ? 'all' : n > had ? 'one' : 'none');
    }
    for (const k of Object.keys(placed)) delete placed[+k];
    Object.assign(placed, v.placed);
    (G.regions as { terr: number[] }[]).forEach((r, i) => { regionMine[i] = ME >= 0 && r.terr.every((t) => owner[t] === ME); });
    if (first) wash(); else if (changed.length) wash(changed);
    for (let t = 0; t < NT; t++) paintPlate(t);
  }
  function idle() {
    const was = live;
    live = false; ME = -1;
    owner.fill(-1); armies.fill(0);
    for (const k of Object.keys(placed)) delete placed[+k];
    plateOdds = {};
    regionMine.fill(false);
    for (let t = 0; t < NT; t++) { dropPile(t); paintPlate(t); }
    if (was) wash();
  }

  // ---------------------------------------------------------------------------
  // what the board shows of a choice: lands that glow, arrows, a flicker where something happened

  const fanG = new THREE.Group(), arrowG = new THREE.Group(), fxG = new THREE.Group();
  scene.add(fanG, arrowG, fxG);
  const clearGroup = (g: THREE.Group) => { for (const o of [...g.children] as THREE.Mesh[]) { o.geometry?.dispose(); (o.material as THREE.Material)?.dispose(); g.remove(o); } };
  function arc(group: THREE.Group, pts: THREE.Vector3[], color: string, r: number, opacity: number, head = true) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const m = plain(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 6), r, 6), m);
    tube.renderOrder = 5;
    group.add(tube);
    if (!head) return;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 3.2, r * 7.5, 10), m);
    cone.position.copy(pts[pts.length - 1]);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
    cone.renderOrder = 5;
    group.add(cone);
  }
  /** An arc from one garrison to another: bowed over the land between, or lying along the sea lane. */
  function span(from: number, to: number): THREE.Vector3[] {
    if (wayOf(from, to)) return road(from, to).map((p, i, all) => (i === 0 || i === all.length - 1 ? p.clone().setY(2.6) : p.clone().setY(0.9)));
    const a = at(from, 2.6), b = at(to, 2.6), mid = a.clone().lerp(b, 0.5);
    mid.y += a.distanceTo(b) * 0.22 + 1;
    return [a, mid, b];
  }
  const clearArrow = () => clearGroup(arrowG);
  function arrow(from: number, to: number, color: string) { clearArrow(); if (ok(from) && ok(to) && from !== to) arc(arrowG, span(from, to), color, 0.24, 0.9); }
  function route(path: number[], stop: number, color: string) {
    clearArrow();
    path = path.filter(ok);
    if (path.length < 2) return;
    const k = Math.max(1, path.indexOf(stop));
    const pts: THREE.Vector3[] = [];
    for (let i = 1; i <= k; i++) { const s = span(path[i - 1], path[i]); pts.push(...(i === 1 ? s : s.slice(1))); }
    arc(arrowG, pts, color, 0.24, 0.9);
  }
  function setHi(t: number, color: string, amt: number, pulse = false) { hi[t].color = color; hi[t].amt = amt; hi[t].pulse = pulse; }
  function setHighlights(sel: number | null, targets: number[], kind: GlowKind, opts: GlowOpts = {}) {
    for (const h of hi) { h.amt = 0; h.pulse = false; }
    clearGroup(fanG);
    const color = opts.own ? GLOW.fortify : GLOW[kind] ?? GLOW.attack;
    glowTargets = new Set(kind === 'place' ? [] : targets.filter(ok));
    glowWarn = new Set((opts.warn ?? []).filter(ok));
    glowSources = new Set(sel == null ? (opts.sources ?? []).filter(ok) : []);
    for (const t of glowSources) setHi(t, '#fff3c8', 0.6, true);
    for (const t of targets) if (ok(t)) setHi(t, glowWarn.has(t) ? '#ffd166' : color, 0.95, kind !== 'place');
    for (const t of opts.picked ?? []) if (ok(t)) setHi(t, '#ffffff', 1);
    if (ok(sel)) {
      setHi(sel, '#ffffff', 1);
      if (opts.fan) for (const t of targets) if (ok(t) && t !== sel) arc(fanG, span(sel, t), glowWarn.has(t) ? '#ffd166' : color, 0.1, 0.55, false);
    }
    for (let t = 0; t < NT; t++) paintPlate(t);
  }
  function flash(ts: number[], color: string, dur: number) { const now = performance.now(); for (const t of ts) if (ok(t)) flashes.set(t, { color, dur, until: now + dur }); }
  function glowFrame(time: number) {
    const k = 0.5 + 0.5 * Math.sin(time * 5), now = performance.now();
    for (let t = 0; t < NT; t++) {
      const h = hi[t], f = flashes.get(t), band = bands[t], fill = fills[t];
      let color = h.color, amt = h.pulse ? h.amt * (0.5 + 0.5 * k) : h.amt;
      if (f) {
        const left = (f.until - now) / f.dur;
        if (left <= 0) flashes.delete(t);
        else { color = f.color; amt = (0.6 + 0.4 * Math.sin(now * 0.02)) * Math.min(1, left * 3); }
      }
      if (!amt && seized.has(t)) { color = seized.get(t)!; amt = 0.7; }
      const lit = amt > 0.02;
      band.visible = lit;
      if (lit) { band.material.color.set(color); band.material.opacity = Math.min(1, amt); }
      // the ground itself: a choice's colour, or grey when it is out of play, or the storm, or white under the pointer
      const hov = hover === t ? 0.3 : hover != null && sheet.region[hover] === sheet.region[t] ? 0.07 : 0;
      let ground = '#ffffff', op = hov;
      if (lit) { ground = color; op = amt * 0.24 + hov * 0.5; }
      else if (dim && !dim[t]) { ground = '#241d18'; op = 0.58; }
      else if (stormy.has(t)) { ground = '#33466e'; op = 0.42 + hov * 0.4; }
      fill.visible = op > 0.01;
      if (fill.visible) { fill.material.color.set(ground); fill.material.opacity = op; }
    }
  }

  // a ring that runs out from a blow
  const rings: { m: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; t0: number; dur: number; big: number }[] = [];
  function ring(t: number, color: string, big: boolean, dur = 700) {
    if (!ok(t)) return;
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), plain(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at(t, 0.1));
    m.renderOrder = 4;
    fxG.add(m);
    rings.push({ m, t0: performance.now(), dur, big: big ? 9 : 5 });
  }
  const burst = (t: number, color: string, big: boolean) => ring(t, color, big);
  const bleed = (t: number, deadN: number, big: boolean) => ring(t, '#c0161c', big || deadN > 4, 520);
  function ringsFrame() {
    const now = performance.now();
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i], k = (now - r.t0) / r.dur;
      if (k >= 1) { fxG.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); continue; }
      r.m.scale.setScalar(1 + (1 - Math.pow(1 - k, 2)) * r.big);
      r.m.material.opacity = 0.9 * (1 - k);
    }
  }

  // ---------------------------------------------------------------------------
  // moving: a piece is pushed out to a fight, comes home or goes in, is walked along a road or a lane

  interface March { g: THREE.Object3D; pts: THREE.Vector3[]; len: number[]; total: number; t0: number; dur: number; a: number; b: number; done: () => void }
  const marches: March[] = [];
  /** The piece standing off a fight, by "from>to". */
  const out = new Map<string, { g: THREE.Object3D; pts: THREE.Vector3[]; at: number }>();
  const marcher = (h: number) => {
    const g = new THREE.Group(), m = new THREE.Mesh(shapes.cube, paintOf(h));
    m.position.y = TALL.cube / 2; m.rotation.y = 0.3; m.castShadow = !!Q.shadow;
    g.add(m); g.scale.setScalar(pieceScale);
    scene.add(g);
    return g;
  };
  function walk(g: THREE.Object3D, pts: THREE.Vector3[], a: number, b: number, ms: number): Promise<void> {
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return new Promise((done) => {
      if (dead) return done();
      marches.push({ g, pts, len, total: len[len.length - 1] || 1, t0: performance.now(), dur: Math.max(60, ms / SPEED), a, b, done });
    });
  }
  function marchFrame() {
    const now = performance.now();
    for (let i = marches.length - 1; i >= 0; i--) {
      const m = marches[i], k = Math.min(1, (now - m.t0) / m.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const d = (m.a + (m.b - m.a) * e) * m.total;
      let s = 1;
      while (s < m.len.length - 1 && m.len[s] < d) s++;
      const u = (d - m.len[s - 1]) / Math.max(1e-6, m.len[s] - m.len[s - 1]);
      m.g.position.lerpVectors(m.pts[s - 1], m.pts[s], Math.max(0, Math.min(1, u)));
      // lifted over a border by hand; slid along a lane
      if (m.pts.length === 2) m.g.position.y += Math.sin(Math.PI * (m.a + (m.b - m.a) * e)) * 1.6;
      if (k >= 1) { marches.splice(i, 1); m.done(); }
    }
  }
  const retire = (g: THREE.Object3D) => { scene.remove(g); };
  const bySea = (from: number, to: number) => !!wayOf(from, to);
  async function sortie(from: number, to: number) {
    if (dead || !ok(from) || !ok(to)) return;
    const key = from + '>' + to;
    if (out.has(key)) return;
    const pts = road(from, to), sea = bySea(from, to), stand = sea ? 0.86 : 0.42;
    const g = marcher(owner[from]);
    g.position.copy(pts[0]);
    out.set(key, { g, pts, at: stand });
    await walk(g, pts, 0, stand, sea ? 900 : 260);
  }
  async function settle(from: number, to: number, won: boolean, more = false) {
    const key = from + '>' + to, o = out.get(key);
    if (!o || dead) return;
    if (!won && more) return;
    out.delete(key);
    await walk(o.g, o.pts, o.at, won ? 1 : 0, won ? 220 : bySea(from, to) ? 600 : 240);
    retire(o.g);
  }
  async function travel(path: number[], stop: number) {
    path = path.filter(ok);
    const k = path.indexOf(stop);
    if (dead || path.length < 2 || k < 1) return;
    const g = marcher(owner[path[0]]);
    for (let i = 1; i <= k && !dead; i++) await walk(g, road(path[i - 1], path[i]), 0, 1, bySea(path[i - 1], path[i]) ? 900 : 300);
    retire(g);
  }

  // ---------------------------------------------------------------------------
  // the camera

  let insetTop = 0, insetBottom = 0, fitDist = 160;
  const maxDist0 = controls.maxDistance;
  let camAnim: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dist: { from: number; to: number } | null } | null = null;
  function setInsets(top: number, bottom: number) {
    insetTop = top; insetBottom = bottom;
    if (vw > 1 && vh > 1) camera.setViewOffset(vw, vh, 0, Math.round((bottom - top) / 2), vw, vh);
  }
  function home() {
    // A table is looked down on: nearly from above, tipped toward the player.
    const dir = new THREE.Vector3(0, Math.cos(0.5), Math.sin(0.5));
    const mine = live && ME >= 0 && vw / vh < 0.8 ? owner.reduce((b, o, t) => (o === ME && (b < 0 || armies[t] > armies[b]) ? t : b), -1) : -1;
    if (mine >= 0) controls.target.copy(at(mine).setY(0)); else controls.target.set(0, 0, 0);
    camera.position.copy(controls.target).addScaledVector(dir, mine >= 0 ? fitDist * 0.4 : fitDist);
    camAnim = null;
  }
  let sized = false;
  function resize(goHome = false) {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    vw = w; vh = h;
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 55 : 42;
    camera.updateProjectionMatrix();
    const vHalf = (camera.fov * Math.PI) / 360, open = Math.max(0.45, (h - insetTop - insetBottom) / h);
    // (the sheet is tipped away, so it stands a little shorter on the screen than it is long)
    fitDist = Math.max(40, (W2 + 6) / (Math.tan(vHalf) * aspect), (H2 + 5) / (Math.tan(vHalf) * open));
    // (on an upright phone the whole board is too small to read: it may still be pulled back to it)
    controls.maxDistance = fitDist * 1.2;
    if (!sized || goHome) home();
    else {
      const d = camera.position.distanceTo(controls.target);
      if (d > controls.maxDistance) camera.position.sub(controls.target).multiplyScalar(controls.maxDistance / d).add(controls.target);
    }
    sized = true;
    setInsets(insetTop, insetBottom);
    for (const b of plateBox) b.w = 0;
  }
  function glide(ts: number[], near = false) {
    const pts = ts.filter(ok).map((t) => at(t).setY(0));
    if (!pts.length) return;
    const to = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const d = camera.position.distanceTo(controls.target);
    const want = near ? Math.max(controls.minDistance * 3, fitDist * 0.42, Math.max(...pts.map((p) => p.distanceTo(to))) * 2.6) : 0;
    camAnim = { from: controls.target.clone(), to, t0: performance.now(), dist: want && d > want * 1.15 ? { from: d, to: want } : null };
  }
  function cameraFrame() {
    if (camAnim) {
      const k = Math.min(1, (performance.now() - camAnim.t0) / 700), e = 1 - Math.pow(1 - k, 3);
      const delta = camAnim.from.clone().lerp(camAnim.to, e).sub(controls.target);
      controls.target.add(delta); camera.position.add(delta);
      if (camAnim.dist) { const dir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(controls.target).addScaledVector(dir, camAnim.dist.from + (camAnim.dist.to - camAnim.dist.from) * e); }
      if (k >= 1) camAnim = null;
    }
    // Don't let the camera wander off the table.
    const tg = controls.target, cx = Math.max(-W2, Math.min(W2, tg.x)), cz = Math.max(-H2, Math.min(H2, tg.z));
    if (cx !== tg.x || cz !== tg.z) { camera.position.x += cx - tg.x; camera.position.z += cz - tg.z; tg.x = cx; tg.z = cz; }
    tg.y = 0;
    // (a table does not turn by itself behind a menu, as the valley does)
    const spin = controls.autoRotate;
    controls.autoRotate = false;
    controls.update();
    controls.autoRotate = spin;
    const d = camera.position.distanceTo(controls.target);
    ppu = vh / (2 * d * Math.tan((camera.fov * Math.PI) / 360));
    // The room goes dark beyond the table's lamp, however far back you stand.
    (scene.fog as THREE.Fog).near = d * 1.1 + R * 1.6;
    (scene.fog as THREE.Fog).far = Math.min(1500, d * 2.2 + R * 4.5);
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tabletop = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SHEET_Y), hitP = new THREE.Vector3(), ball = new THREE.Sphere();
  function pickAt(x: number, y: number): number | null {
    const r = renderer.domElement.getBoundingClientRect();
    const px = x - r.left, py = y - r.top;
    const p = plateAt(px, py);
    if (p >= 0) return p;
    ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // a garrison stands up off the sheet: a click on its pieces is a click on its territory
    let best = -1, bd = Infinity;
    for (let t = 0; t < NT; t++) {
      const pile = piles[t];
      if (!pile) continue;
      ball.center.copy(pile.g.position).setY(SHEET_Y + 0.5 * pieceScale);
      ball.radius = pile.reach * pieceScale * 0.7;
      const h = ray.ray.intersectSphere(ball, hitP);
      if (h) { const d = h.distanceTo(ray.ray.origin); if (d < bd) { bd = d; best = t; } }
    }
    if (best >= 0) return best;
    if (!ray.ray.intersectPlane(tabletop, hitP)) return null;
    const t: number = landAt(sheet, hitP.x + W2, hitP.z + H2);
    return t >= 0 ? t : null;
  }
  function screenPos(t: number, lift = 0) {
    const r = renderer.domElement.getBoundingClientRect();
    const s = ok(t) ? toScreen(at(t), lift) : null;
    return s ? { x: r.left + s.x, y: r.top + s.y } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  const t0 = performance.now();
  function frame() {
    if (dead) return;
    const time = (performance.now() - t0) / 1000;
    cameraFrame();
    camera.updateMatrixWorld();
    glowFrame(time);
    ringsFrame();
    marchFrame();
    dropFrame();
    placeLabels();
    renderer.render(scene, camera);
  }

  function dispose() {
    dead = true;
    for (const m of marches.splice(0)) m.done();
    layer.replaceChildren();
    layer.classList.remove('reveal', 'table');
    camera.clearViewOffset();
    controls.maxDistance = maxDist0;
    const seen = new Set<unknown>();
    const drop = (x: any) => { if (x && typeof x.dispose === 'function' && !seen.has(x)) { seen.add(x); x.dispose(); } };
    scene.traverse((o: any) => { drop(o.geometry); for (const m of [].concat(o.material ?? []) as any[]) { drop(m.map); drop(m); } o.shadow?.dispose?.(); });
    for (const x of [...Object.values(shapes), ...paint, coinMat, ...[...faces.values()].flatMap((m) => [m.map, m]), tableTex, woodTex, sheetTex]) drop(x);
    scene.clear();
    // (the sheet's canvases are large: let them go at once)
    for (const c of [art.base, art.ink, art.out] as HTMLCanvasElement[]) c.width = c.height = 0;
  }

  resize();
  idle();
  return {
    scene, frame, resize, home, dispose, apply, idle,
    setHighlights,
    setHover: (t) => { hover = ok(t) ? t : null; },
    setOdds: (odds) => { plateOdds = odds ?? {}; for (let t = 0; t < NT; t++) paintPlate(t); },
    setDim: (keep) => { dim = keep; for (let t = 0; t < NT; t++) paintPlate(t); },
    setMarks: (sz, storm) => {
      seized.clear(); for (const s of sz) if (ok(s.t)) seized.set(s.t, s.color);
      stormy.clear(); for (const t of storm) if (ok(t)) stormy.add(t);
    },
    setSiege: () => {},
    setOlympus: () => {},
    setReveal: (on) => { reveal = on; layer.classList.toggle('reveal', on); },
    setInsets,
    setSpeed: (k) => { SPEED = Math.max(0.25, k || 1); },
    arrow, route, clearArrow, flash, burst, bleed,
    sortie, settle, travel, bySea,
    pickAt, screenPos, glide,
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    // (a table in a quiet room: no sea to hear)
    ambience: () => ({ water: 0, falls: 0, oars: 0, frost: 0 }),
  };
}
