// A Skirmish board, in the Institute's own country: the same ground the valley is made of (forest, fields, highland,
// crag, mountain, snow, marsh, deadwood), raised hex by hex out of the same dark sea, under the same dusk sky and its two
// moons. Every territory is tinted with its holder's colours (more from far out, as the valley is), ringed in them, and
// flies their banner beside its count plate. Region borders are inked heavy with a gold thread; sea lanes are dashed gold.
// There is no Olympus here, no Keeps and no Standards.
//
// It answers to the same interface as the valley (valley.ts), so World (scene.ts) drives either without knowing which.

import * as THREE from 'three';
import { HOUSES, vnoise, type Biome } from '../engine/data.ts';
import type { GlowKind, GlowOpts, Odds, Valley, ValleyEnv, WarView } from './valley.ts';

const SQ3 = Math.sqrt(3);
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
/** The valley's own ground: how high each kind stands, and its four tones (valley.ts, BIOME). */
const GROUND: Record<Biome, { h: number; bump: number; pal: string[] }> = {
  plain: { h: 0.8, bump: 0.5, pal: ['#56633a', '#718044', '#8e9150', '#a59c5e'] },
  fields: { h: 0.75, bump: 0.35, pal: ['#8d7330', '#b89540', '#d0ad50', '#e2c66c'] },
  forest: { h: 0.95, bump: 0.6, pal: ['#263c22', '#33522c', '#446232', '#5b6e3e'] },
  highland: { h: 1.3, bump: 0.9, pal: ['#55573c', '#6c6c4c', '#84805a', '#9a916f'] },
  crag: { h: 1.45, bump: 1.3, pal: ['#574c42', '#74665a', '#8c7c6c', '#a39382'] },
  mountain: { h: 1.9, bump: 1.6, pal: ['#565049', '#72695f', '#8c8277', '#a69b90'] },
  snow: { h: 1.35, bump: 0.4, pal: ['#bccad6', '#d4dee7', '#e7eef3', '#f6f9fb'] },
  swamp: { h: 0.5, bump: 0.3, pal: ['#1f2e25', '#30402a', '#434f30', '#595e3e'] },
  deadwood: { h: 0.9, bump: 0.7, pal: ['#3b3835', '#504b46', '#645d56', '#7a7168'] },
  lake: { h: 0.42, bump: 0.3, pal: ['#6f6349', '#8c7d5c', '#a59672', '#bdb08c'] },
  keep: { h: 1.2, bump: 0.6, pal: ['#5d5348', '#73685d', '#877c6f', '#9c9083'] },
};
const SHINGLE = new THREE.Color('#a59672'), INK = '#1d120a', NEUTRAL = new THREE.Color('#8d8573');
const SKY = { top: '#161226', mid: '#6a4350', bot: '#d08a5a', haze: '#7d5a58' };
const GLOW: Record<GlowKind, string> = { attack: '#ff5a3c', fortify: '#5fe08a', place: '#5fe08a', target: '#ffd166', std: '#ffd166', assault: '#ffd166' };

export async function createBoard(env: ValleyEnv): Promise<Valley> {
  const { renderer, camera, controls, geo: G } = env;
  const host = env.host, layer = env.layer, Q = env.quality;
  const info = G.skirmish!;
  const T = G.territories, NT = G.nt, W2 = info.w, H2 = info.h;
  let dead = false, vw = 1, vh = 1;
  await env.pause?.('the board');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY.haze, 300, 900);
  const made: { dispose(): void }[] = [];
  const rnd = (a: number, b = 0) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------------------------------------------------------------------------
  // sky and light: the valley's dusk, its stars and its two moons

  const SUN = new THREE.Vector3(-0.62, 0.56, 0.44).normalize();
  {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 40, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY.top) }, mid: { value: new THREE.Color(SKY.mid) }, bot: { value: new THREE.Color(SKY.bot) }, sunDir: { value: SUN }, sunCol: { value: new THREE.Color('#ffc890') } },
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
    const pts: number[] = [];
    for (let i = 0; i < 700; i++) { const th = rnd(i, 1) * Math.PI * 2, ph = Math.acos(1 - rnd(i, 2) * 0.75); pts.push(Math.sin(ph) * Math.cos(th) * 1340, Math.cos(ph) * 1340, Math.sin(ph) * Math.sin(th) * 1340); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffe9d6', size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55 })));
    const moon = (r: number, pos: THREE.Vector3, c: string) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), new THREE.MeshStandardMaterial({ color: c, roughness: 1, fog: false, flatShading: true })); m.position.copy(pos); scene.add(m); };
    moon(24, new THREE.Vector3(-400, 470, -880), '#b9a48f');
    moon(11, new THREE.Vector3(520, 370, -820), '#d8c7b0');
  }
  scene.add(new THREE.HemisphereLight('#bccbee', '#5b4a40', 0.9));
  const sun = new THREE.DirectionalLight('#fff0da', 2.5);
  sun.position.copy(SUN).multiplyScalar(240);
  if (Q.shadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const c = sun.shadow.camera, sz = Math.max(W2, H2) + 12;
    c.left = -sz; c.right = sz; c.top = sz; c.bottom = -sz; c.near = 20; c.far = 600;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.05;
  }
  const fill = new THREE.DirectionalLight('#8aa0ff', 0.32);
  fill.position.set(60, 40, -50);
  scene.add(sun, sun.target, fill);

  // ---------------------------------------------------------------------------
  // the sea: the water beneath Olympus, here running to the horizon

  const seaU = { uTime: { value: 0 } };
  {
    const m = new THREE.MeshStandardMaterial({ color: '#0a3a5c', roughness: 0.3, metalness: 0.05 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = seaU.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSea;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSea = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTime; varying vec3 vSea;
        float seaH(vec2 p){ return sin(p.x * 0.9 + uTime * 0.7) * 0.5 + sin(p.y * 1.3 - uTime * 0.55) * 0.35 + sin((p.x + p.y) * 2.1 + uTime * 0.9) * 0.15; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 p = vSea.xz * 0.55; float e = 0.12; float h0 = seaH(p);
          vec3 wn = normalize(vec3((h0 - seaH(p + vec2(e, 0.0))) * 0.5, 1.0, (h0 - seaH(p + vec2(0.0, e))) * 0.5));
          normal = normalize(mat3(viewMatrix) * wn); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.071, 0.380, 0.498), 0.16 + 0.12 * seaH(vSea.xz * 0.05));`);
    };
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), m);
    sea.rotation.x = -Math.PI / 2;
    sea.receiveShadow = true;
    scene.add(sea);
  }

  // ---------------------------------------------------------------------------
  // the land: every hex a step of ground, in the tones of what grows or lies there

  type Hx = { q: number; r: number; x: number; y: number; t: number; h: number; sea: number; in: number; tone: THREE.Color };
  const HEX: Hx[] = G.hexes.map((h) => ({ q: h.q, r: h.r, x: h.x, y: h.y, t: h.t, h: 0, sea: 99, in: 99, tone: new THREE.Color() }));
  const hexAt = new Map(HEX.map((h) => [h.q + ',' + h.r, h]));
  const byT: Hx[][] = Array.from({ length: NT }, () => []);
  for (const h of HEX) byT[h.t].push(h);
  /** The two ends of the side a hex shares with its neighbour in direction `d`, counter-clockwise. */
  const side = (h: { x: number; y: number }, d: number): [number, number, number, number] => {
    const [dq, dr] = DIRS[d], a = Math.atan2(1.5 * dr, SQ3 * (dq + dr / 2));
    return [h.x + Math.cos(a - Math.PI / 6), h.y + Math.sin(a - Math.PI / 6), h.x + Math.cos(a + Math.PI / 6), h.y + Math.sin(a + Math.PI / 6)];
  };
  const nb = (h: { q: number; r: number }, d: number) => hexAt.get((h.q + DIRS[d][0]) + ',' + (h.r + DIRS[d][1]));
  const geom = (pos: number[], normal?: [number, number, number]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (normal) { const n = new Float32Array(pos.length); for (let i = 0; i < n.length; i += 3) { n[i] = normal[0]; n[i + 1] = normal[1]; n[i + 2] = normal[2]; } g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); }
    else g.computeVertexNormals();
    return g;
  };
  /** A flat strip along a line on the map, `w` wide, at height `y`. */
  const strip = (out: number[], x1: number, y1: number, x2: number, y2: number, w: number, y: number, cap = 0.5) => {
    let ux = x2 - x1, uy = y2 - y1;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;
    const ax = x1 - ux * w * cap, ay = y1 - uy * w * cap, bx = x2 + ux * w * cap, by = y2 + uy * w * cap, nx = -uy * w * 0.5, ny = ux * w * 0.5;
    out.push(ax - nx, y, -(ay - ny), bx - nx, y, -(by - ny), bx + nx, y, -(by + ny), ax - nx, y, -(ay - ny), bx + nx, y, -(by + ny), ax + nx, y, -(ay + ny));
  };

  // How far each hex is from the sea, and from the edge of its own territory.
  {
    const flood = (key: 'sea' | 'in', edge: (h: Hx, o: Hx | undefined) => boolean, same: boolean) => {
      const q: Hx[] = [];
      for (const h of HEX) if (DIRS.some((_, d) => edge(h, nb(h, d)))) { h[key] = 0; q.push(h); }
      for (let i = 0; i < q.length; i++) for (let d = 0; d < 6; d++) {
        const o = nb(q[i], d);
        if (o && o[key] === 99 && (!same || o.t === q[i].t)) { o[key] = q[i][key] + 1; q.push(o); }
      }
    };
    flood('sea', (_, o) => !o, false);
    flood('in', (h, o) => !o || o.t !== h.t, true);
  }
  /** Where each territory's army stands: the hex its count plate is anchored to. */
  const heart = G.centroid.map(([x, y], t) => byT[t].reduce((b, h) => ((h.x - x) ** 2 + (h.y - y) ** 2 < (b.x - x) ** 2 + (b.y - y) ** 2 ? h : b), byT[t][0]));
  for (const h of HEX) {
    const B = GROUND[T[h.t].biome] ?? GROUND.plain;
    const n = vnoise(h.x * 0.33 + 7, h.y * 0.33 + 3), n2 = vnoise(h.x * 0.9, h.y * 0.9 + 50), n3 = vnoise(h.x * 0.5 + 20, h.y * 0.5 - 8);
    // the ground rises toward the middle of high country, and comes down to a shingle shore
    let y = B.h + (n - 0.5) * B.bump * 0.8 + (n2 - 0.5) * B.bump * 0.25 + (B.bump > 1 ? Math.min(3, h.in) * 0.22 * B.bump : 0);
    const k = Math.min(1, h.sea / 2), e = k * k * (3 - 2 * k);
    y = 0.26 + (y - 0.26) * e;
    h.h = Math.max(0.2, Math.round(y / 0.09) * 0.09);
    const i = T[h.t].biome === 'fields' ? 1 + ((h.r & 1) + (n3 > 0.5 ? 1 : 0)) : Math.min(3, Math.floor(n3 * 4.4));
    h.tone.set(B.pal[Math.max(0, Math.min(3, i))]).lerp(SHINGLE, h.sea === 0 ? 0.72 : h.sea === 1 ? 0.2 : 0);
  }
  // (an army stands on level ground)
  heart.forEach((c) => { for (let d = 0; d < 6; d++) { const o = nb(c, d); if (o && o.t === c.t && o.sea > 0) o.h = c.h; } });
  const tH = heart.map((c) => c.h);

  const tops: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  const outlines: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  /** The ground's own colours, vertex by vertex: what a territory is painted from before its holder's tint. */
  const ground: Float32Array[] = [];
  const thin: number[] = [], heavy: number[] = [], thread: number[] = [];
  /** Hexes of each territory that look out to sea (where a sea lane can land). */
  const shore: Hx[][] = Array.from({ length: NT }, () => []);
  const _w = new THREE.Color();
  for (let t = 0; t < NT; t++) {
    const pos: number[] = [], col: number[] = [], rim: number[] = [];
    for (const h of byT[t]) {
      for (let d = 0; d < 6; d++) {
        const [x1, y1, x2, y2] = side(h, d);
        pos.push(h.x, h.h, -h.y, x1, h.h, -y1, x2, h.h, -y2);
        for (let i = 0; i < 3; i++) col.push(h.tone.r, h.tone.g, h.tone.b);
        const o = nb(h, d), low = o ? o.h : -0.5;
        if (low < h.h - 0.01) {
          // the step down to lower ground, or into the sea
          pos.push(x1, h.h, -y1, x1, low, -y1, x2, low, -y2, x1, h.h, -y1, x2, low, -y2, x2, h.h, -y2);
          _w.copy(h.tone).multiplyScalar(0.58);
          for (let i = 0; i < 6; i++) col.push(_w.r, _w.g, _w.b);
        }
        if (o && o.t === t) continue;
        // its holder's ring runs just inside the border, on its own ground
        const cx = (h.x - (x1 + x2) / 2) * 0.26, cy = (h.y - (y1 + y2) / 2) * 0.26;
        strip(rim, x1 + cx, y1 + cy, x2 + cx, y2 + cy, 0.34, h.h + 0.05, 0.35);
        if (!o) { if (!shore[t].includes(h)) shore[t].push(h); continue; }
        if (d < 3) {
          // (each inland border is met from both sides: draw it once)
          const y = Math.max(h.h, o.h) + 0.035;
          if (T[o.t].region !== T[t].region) { strip(heavy, x1, y1, x2, y2, 0.4, y); strip(thread, x1, y1, x2, y2, 0.11, y + 0.012, 0.2); }
          else strip(thin, x1, y1, x2, y2, 0.13, y);
        }
      }
    }
    const g = geom(pos);
    ground.push(new Float32Array(col));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    const top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0 }));
    top.receiveShadow = true; top.castShadow = !!Q.shadow;
    top.userData.t = t;
    tops.push(top);
    const line = new THREE.Mesh(geom(rim, [0, 1, 0]), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    line.visible = false; line.renderOrder = 3;
    outlines.push(line);
    scene.add(top, line);
  }
  {
    const ink = (pos: number[], color: string, opacity: number, order: number) => { const m = new THREE.Mesh(geom(pos, [0, 1, 0]), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })); m.renderOrder = order; return m; };
    scene.add(ink(thin, INK, 0.5, 1), ink(heavy, INK, 0.9, 1), ink(thread, '#f3d27a', 0.9, 2));
  }

  // The shallows: the sea pales where it comes in over the shingle.
  {
    const near = new Map<string, { q: number; r: number; x: number; y: number; k: number }>();
    const grow = (from: Iterable<{ q: number; r: number }>, k: number) => {
      const out: { q: number; r: number }[] = [];
      for (const h of from) for (const [dq, dr] of DIRS) {
        const q = h.q + dq, r = h.r + dr, key = q + ',' + r;
        if (hexAt.has(key) || near.has(key)) continue;
        near.set(key, { q, r, x: SQ3 * (q + r / 2), y: 1.5 * r, k });
        out.push({ q, r });
      }
      return out;
    };
    grow(grow(HEX, 0), 1);
    for (const k of [0, 1]) {
      const pos: number[] = [];
      for (const c of near.values()) if (c.k === k) for (let d = 0; d < 6; d++) { const [x1, y1, x2, y2] = side(c, d); pos.push(c.x, 0.04 - k * 0.015, -c.y, x1, 0.04 - k * 0.015, -y1, x2, 0.04 - k * 0.015, -y2); }
      const m = new THREE.Mesh(geom(pos, [0, 1, 0]), new THREE.MeshLambertMaterial({ color: k ? '#1c7f90' : '#33ada6', transparent: true, opacity: k ? 0.38 : 0.55, depthWrite: false }));
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  // What grows and stands on the land: pines in the forests, peaks on the mountains, rock on the crags, dead trunks in the deadwood.
  {
    const spots: Record<string, { x: number; y: number; z: number; s: number; c: THREE.Color }[]> = { pine: [], peak: [], cap: [], rock: [], trunk: [] };
    const tone = (hex: string, k: number) => new THREE.Color(hex).offsetHSL(0, 0, (k - 0.5) * 0.08);
    HEX.forEach((h, i) => {
      if (h.sea === 0 || (h.x - heart[h.t].x) ** 2 + (h.y - heart[h.t].y) ** 2 < 6.5) return;
      const b = T[h.t].biome, r = (k: number) => rnd(i, k);
      const put = (kind: string, n: number, s0: number, s1: number, color: (k: number) => THREE.Color) => {
        for (let j = 0; j < n; j++) {
          if (r(40 + j) > Q.dressing) continue;
          const a = r(10 + j) * 6.283, d = r(20 + j) * 0.62;
          spots[kind].push({ x: h.x + Math.cos(a) * d, y: h.h, z: -(h.y + Math.sin(a) * d), s: s0 + r(30 + j) * (s1 - s0), c: color(r(50 + j)) });
        }
      };
      if (b === 'forest') put('pine', 3, 0.7, 1.25, (k) => tone('#2c4a28', k));
      else if (b === 'snow') { if (r(1) < 0.22) put('pine', 1, 0.7, 1.1, (k) => tone('#6f8c84', k)); }
      else if (b === 'plain' || b === 'highland') { if (r(1) < 0.16) put('pine', 1, 0.6, 0.95, (k) => tone('#3d5a30', k)); if (b === 'highland' && r(2) < 0.2) put('rock', 1, 0.6, 1.1, (k) => tone('#7b7462', k)); }
      else if (b === 'swamp') { if (r(1) < 0.3) put('trunk', 1, 0.6, 1, (k) => tone('#3a3f2c', k)); }
      else if (b === 'deadwood') put('trunk', 2, 0.7, 1.3, (k) => tone('#4f4a44', k));
      else if (b === 'crag') put('rock', 2, 0.7, 1.5, (k) => tone('#857565', k));
      else if (b === 'mountain' && h.in >= 1) {
        const s = 0.9 + r(3) * 0.9 + Math.min(2, h.in) * 0.25;
        spots.peak.push({ x: h.x, y: h.h, z: -h.y, s, c: tone('#7d7368', r(4)) });
        if (s > 1.35) spots.cap.push({ x: h.x, y: h.h + s * 1.02, z: -h.y, s: s * 0.42, c: new THREE.Color('#eef3f6') });
      }
    });
    const stand = (kind: string, g: THREE.BufferGeometry, rough: number) => {
      const list = spots[kind];
      if (!list.length) { g.dispose(); return; }
      const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: rough, flatShading: true }), list.length);
      const o = new THREE.Object3D();
      list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.scale.setScalar(p.s); o.rotation.y = rnd(i, 77) * 6.283; o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, p.c); });
      m.castShadow = !!Q.shadow; m.receiveShadow = true;
      scene.add(m);
    };
    stand('pine', new THREE.ConeGeometry(0.36, 1.25, 6).translate(0, 0.62, 0), 1);
    stand('peak', new THREE.ConeGeometry(0.98, 1.5, 5).translate(0, 0.72, 0), 0.9);
    stand('cap', new THREE.ConeGeometry(0.98, 1.1, 5).translate(0, 0.1, 0), 0.7);
    stand('rock', new THREE.IcosahedronGeometry(0.34, 0).translate(0, 0.16, 0), 0.9);
    stand('trunk', new THREE.CylinderGeometry(0.03, 0.08, 1.1, 5).translate(0, 0.55, 0), 1);
  }

  const CEN = heart.map((h) => [h.x, h.y] as [number, number]);
  /** A point over a territory's army, `lift` above the ground it stands on. */
  const at = (t: number, lift = 0) => new THREE.Vector3(CEN[t][0], tH[t] + lift, -CEN[t][1]);
  const ok = (t: number | null | undefined): t is number => t != null && t >= 0 && t < NT;

  // ---------------------------------------------------------------------------
  // sea lanes: dashed across the water, from shore to shore

  interface Way { a: number; b: number; wrap: boolean; pts: THREE.Vector3[]; /** A wrapped lane's second half (it leaves by one edge and comes back by the other). */ back?: THREE.Vector3[] }
  const ways: Way[] = [];
  {
    const dash: number[] = [], dots: number[] = [];
    const trace = (pts: THREE.Vector3[]) => {
      let run = 0;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i], len = p.distanceTo(q);
        if (run % 2.6 < 1.5) strip(dash, p.x, -p.z, q.x, -q.z, 0.34, 0.09, 0);
        run += len;
      }
    };
    const dot = (p: THREE.Vector3) => { for (let i = 0; i < 10; i++) { const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2; dots.push(p.x, 0.1, p.z, p.x + Math.cos(a1) * 0.62, 0.1, p.z - Math.sin(a1) * 0.62, p.x + Math.cos(a0) * 0.62, 0.1, p.z - Math.sin(a0) * 0.62); } };
    for (const l of info.lanes) {
      // from the two shores that face each other
      let best: [Hx, Hx] | null = null, bd = Infinity;
      const A = shore[l.a].length ? shore[l.a] : byT[l.a], B = shore[l.b].length ? shore[l.b] : byT[l.b];
      if (l.wrap) {
        const west = CEN[l.a][0] < CEN[l.b][0] ? l.a : l.b, east = west === l.a ? l.b : l.a;
        const pw = (west === l.a ? A : B).reduce((m, h) => (h.x < m.x ? h : m)), pe = (east === l.a ? A : B).reduce((m, h) => (h.x > m.x ? h : m));
        const out = (h: Hx, x: number) => Array.from({ length: 24 }, (_, i) => new THREE.Vector3(h.x + (x - h.x) * (i / 23), 0.09, -h.y));
        const ww = out(pw, -(W2 + 6)), ee = out(pe, W2 + 6);
        trace(ww); trace(ee); dot(ww[0]); dot(ee[0]);
        ways.push(west === l.a ? { a: l.a, b: l.b, wrap: true, pts: ww, back: ee.slice().reverse() } : { a: l.a, b: l.b, wrap: true, pts: ee, back: ww.slice().reverse() });
        continue;
      }
      for (const p of A) for (const q of B) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < bd) { bd = d; best = [p, q]; } }
      const [p, q] = best!;
      const a = new THREE.Vector3(p.x, 0.09, -p.y), b = new THREE.Vector3(q.x, 0.09, -q.y), mid = a.clone().lerp(b, 0.5), len = a.distanceTo(b);
      // a slight bow, always to the same hand, so two lanes side by side do not lie on each other
      mid.add(new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(len * 0.1));
      const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(Math.max(8, Math.round(len / 0.5)));
      trace(pts); dot(a); dot(b);
      ways.push({ a: l.a, b: l.b, wrap: false, pts });
    }
    const m = new THREE.MeshBasicMaterial({ color: '#f3d27a', transparent: true, opacity: 0.85, depthWrite: false });
    scene.add(new THREE.Mesh(geom(dash, [0, 1, 0]), m), new THREE.Mesh(geom(dots, [0, 1, 0]), m));
  }
  const wayOf = (from: number, to: number) => ways.find((w) => (w.a === from && w.b === to) || (w.a === to && w.b === from)) ?? null;
  /** The road an army takes from one territory to a neighbour: over the border, or down to the shore and along the lane. */
  function road(from: number, to: number): THREE.Vector3[] {
    const w = wayOf(from, to);
    if (!w) return [at(from, 0.3), at(to, 0.3)];
    const fwd = w.a === from;
    const lift = (p: THREE.Vector3) => p.clone().setY(0.5);
    const sea = (fwd ? w.pts : (w.back ? w.back.slice().reverse() : w.pts.slice().reverse())).map(lift);
    const rest = w.back ? (fwd ? w.back : w.pts.slice().reverse()).map(lift) : [];
    return [at(from, 0.3), ...sea, ...rest, at(to, 0.3)];
  }

  // ---------------------------------------------------------------------------
  // the war on the board

  let ME = -1, live = false, SPEED = 1;
  const owner = new Array<number>(NT).fill(-1), armies = new Array<number>(NT).fill(0);
  const placed: Record<number, number> = {};
  let plateOdds: Record<number, Odds> = {};
  let dim: boolean[] | null = null;
  const stormy = new Set<number>(), seized = new Map<number, string>();
  let hover: number | null = null;
  const hi = T.map(() => ({ color: '#ffffff', amt: 0, pulse: false }));
  const flashes = new Map<number, { color: string; dur: number; until: number }>();
  const houseColor = HOUSES.map((h) => new THREE.Color(h.color));
  const _c = new THREE.Color(), GREY = new THREE.Color('#4d4944'), STORM = new THREE.Color('#33466e');
  /** How much of its holder's colour the land wears: more from far out (the political map), less close in (the terrain). */
  let polK = 0.5;

  function paintLand(t: number) {
    const o = owner[t], base = ground[t], attr = tops[t].geometry.getAttribute('color') as THREE.BufferAttribute, out = attr.array as Float32Array;
    const tint = o >= 0 ? houseColor[o] : live ? NEUTRAL : null, k = tint ? (o >= 0 ? polK : polK * 0.6) : 0;
    const dimmed = !!dim && !dim[t], storm = stormy.has(t);
    for (let i = 0; i < base.length; i += 3) {
      _c.setRGB(base[i], base[i + 1], base[i + 2]);
      if (tint) _c.lerp(tint, k);
      if (storm) _c.lerp(STORM, 0.4);
      if (dimmed) _c.lerp(GREY, 0.8);
      out[i] = _c.r; out[i + 1] = _c.g; out[i + 2] = _c.b;
    }
    attr.needsUpdate = true;
  }

  // banners: every army flies its House's colours from a pole, on a foot of dark stone
  const footGeo = new THREE.CylinderGeometry(0.62, 0.78, 0.26, 14).translate(0, 0.13, 0);
  const poleGeo = new THREE.CylinderGeometry(0.055, 0.07, 2.5, 6).translate(0, 1.4, 0);
  const flagGeo = new THREE.BoxGeometry(1.25, 0.82, 0.05).translate(0.68, 2.16, 0);
  const tipGeo = new THREE.OctahedronGeometry(0.14).translate(0, 2.72, 0);
  const flagMat = [...houseColor, NEUTRAL].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, emissive: c, emissiveIntensity: 0.22, side: THREE.DoubleSide }));
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#3a322c', roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#2a1c12', roughness: 0.8 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#f3d27a', roughness: 0.35, metalness: 0.7 });
  function banner(h: number, shadow: boolean) {
    const g = new THREE.Group();
    const flag = new THREE.Mesh(flagGeo, flagMat[h >= 0 ? h : HOUSES.length]);
    const parts = [new THREE.Mesh(footGeo, stoneMat), new THREE.Mesh(poleGeo, woodMat), flag, new THREE.Mesh(tipGeo, goldMat)];
    for (const m of parts) { m.castShadow = shadow; g.add(m); }
    return { g, body: flag };
  }
  const tokens = T.map((t) => {
    const k = banner(-1, !!Q.shadow);
    k.g.position.copy(at(t.id));
    k.g.rotation.y = -0.5;
    k.g.visible = false;
    scene.add(k.g);
    return k;
  });
  function paintToken(t: number) {
    const k = tokens[t], n = armies[t];
    k.g.visible = live && n > 0;
    k.body.material = flagMat[owner[t] >= 0 ? owner[t] : HOUSES.length];
    k.g.scale.setScalar(0.9 + Math.min(0.5, Math.log10(Math.max(1, n)) * 0.28));
  }

  // count plates, names of territories and regions
  layer.classList.add('board');
  const plateEls = T.map((t) => { const el = document.createElement('div'); el.className = 'plate'; el.dataset.t = String(t.id); el.style.display = 'none'; layer.appendChild(el); return el; });
  const nameEls = T.map((t) => { const el = document.createElement('div'); el.className = 'tn'; el.textContent = t.name; layer.appendChild(el); return el; });
  const regionEls = G.regions.map((r) => { const el = document.createElement('div'); el.className = 'rn'; el.innerHTML = `${r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')} <b>+${r.bonus}</b>`; layer.appendChild(el); return el; });
  const plateBox = T.map(() => ({ on: false, x: -1, y: -1, w: 0, h: 0, key: '' }));
  let glowTargets = new Set<number>(), glowSources = new Set<number>(), glowWarn = new Set<number>();
  function paintPlate(t: number) {
    const o = owner[t], el = plateEls[t], n = armies[t], od = plateOdds[t], b = plateBox[t];
    const cls = (glowTargets.has(t) ? ' tgt' : '') + (glowWarn.has(t) ? ' ally' : '') + (glowSources.has(t) ? ' src' : '') + (dim && !dim[t] ? ' dim' : '');
    const key = [o, n, placed[t] || 0, od ? (od.overwhelm ? 'w' : Math.round(od.p * 100)) : '', o >= 0 && o === ME, cls].join('|');
    if (b.key === key) return;
    b.key = key; b.w = 0;
    el.style.setProperty('--c', o >= 0 ? HOUSES[o].color : '#5d564c');
    el.className = 'plate' + (o === 0 || o === 5 ? ' light' : '') + (o >= 0 && o === ME ? ' mine' : '') + cls;
    el.innerHTML = `<b>${n}</b>${placed[t] ? `<em>+${placed[t]}</em>` : ''}`
      + (od ? `<u class="${od.overwhelm || od.p >= 0.65 ? 'good' : od.p >= 0.4 ? 'even' : 'bad'}">${od.overwhelm ? '🏳' : Math.round(od.p * 100) + '%'}</u>` : '');
  }
  const paint = (t: number) => { paintLand(t); paintToken(t); paintPlate(t); };
  const paintAll = () => { for (let t = 0; t < NT; t++) paint(t); };

  const _v = new THREE.Vector3();
  function toScreen(p: THREE.Vector3, lift = 0) {
    _v.set(p.x, p.y + lift, p.z).project(camera);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * vw, y: (-_v.y * 0.5 + 0.5) * vh };
  }
  let ppu = 6, plateFs = 0, reveal = false;
  const regionMine = G.regions.map(() => false);
  function placeLabels() {
    const fs = +Math.max(12.5, Math.min(19, ppu * 2.1)).toFixed(1);
    // From far out the board is a political map; close in, the ground shows through its holders' colours.
    const pk = Math.round((0.5 - 0.3 * Math.max(0, Math.min(1, (ppu - 5.5) / 9))) / 0.05) * 0.05;
    if (pk !== polK) { polK = pk; for (let t = 0; t < NT; t++) paintLand(t); }
    if (fs !== plateFs) { plateFs = fs; layer.style.setProperty('--fs', fs + 'px'); for (const b of plateBox) b.w = 0; }
    const names = reveal || ppu > 8.2;
    layer.classList.toggle('near', names);
    for (let t = 0; t < NT; t++) {
      const el = plateEls[t], b = plateBox[t], p = tokens[t].g.position;
      const s = toScreen(p, 3.05 * tokens[t].g.scale.x);
      const off = !s || s.x < -80 || s.x > vw + 80 || s.y < -10 || s.y > vh + 60;
      if (off || !live || armies[t] <= 0) { if (b.on) { b.on = false; el.style.display = 'none'; } }
      else {
        if (!b.on) { b.on = true; el.style.display = ''; }
        const x = Math.round(s.x * 10) / 10, y = Math.round(s.y * 10) / 10;
        if (x !== b.x || y !== b.y) { b.x = x; b.y = y; el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`; el.style.zIndex = String(Math.round(y)); }
      }
      const ne = nameEls[t];
      const g0 = names && !off ? toScreen(p, 0) : null;
      if (!g0) { if (ne.style.display !== 'none') ne.style.display = 'none'; }
      else { ne.style.display = 'block'; ne.style.transform = `translate(${g0.x.toFixed(1)}px,${(g0.y + 5).toFixed(1)}px) translate(-50%,0)`; }
    }
    G.regions.forEach((r, i) => {
      const el = regionEls[i], s = reveal ? toScreen(new THREE.Vector3(r.at[0], 1.2, -r.at[1]), 0) : null;
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

  function apply(v: WarView) {
    live = true;
    ME = v.me;
    for (let t = 0; t < NT; t++) { owner[t] = v.owner[t] ?? -1; armies[t] = v.armies[t] ?? 0; }
    for (const k of Object.keys(placed)) delete placed[+k];
    Object.assign(placed, v.placed);
    G.regions.forEach((r, i) => { regionMine[i] = ME >= 0 && r.terr.every((t) => owner[t] === ME); });
    paintAll();
  }
  function idle() {
    live = false; ME = -1;
    owner.fill(-1); armies.fill(0);
    for (const k of Object.keys(placed)) delete placed[+k];
    plateOdds = {};
    regionMine.fill(false);
    paintAll();
  }

  // ---------------------------------------------------------------------------
  // what the board shows of a choice: outlines that glow, arrows, a flicker where something happened

  const fanG = new THREE.Group(), arrowG = new THREE.Group(), fxG = new THREE.Group();
  scene.add(fanG, arrowG, fxG);
  const clearGroup = (g: THREE.Group) => { for (const o of [...g.children] as THREE.Mesh[]) { o.geometry?.dispose(); (o.material as THREE.Material)?.dispose(); g.remove(o); } };
  function arc(group: THREE.Group, pts: THREE.Vector3[], color: string, r: number, opacity: number, head = true) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
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
  /** An arc from one army to another: bowed over the land between, or lying along the sea lane. */
  function span(from: number, to: number): THREE.Vector3[] {
    if (wayOf(from, to)) return road(from, to).map((p, i, all) => (i === 0 || i === all.length - 1 ? p.clone().setY(p.y + 1.6) : p.clone().setY(0.9)));
    const a = at(from, 1.9), b = at(to, 1.9), mid = a.clone().lerp(b, 0.5);
    mid.y += a.distanceTo(b) * 0.22 + 1;
    return [a, mid, b];
  }
  const clearArrow = () => clearGroup(arrowG);
  function arrow(from: number, to: number, color: string) { clearArrow(); if (ok(from) && ok(to) && from !== to) arc(arrowG, span(from, to), color, 0.2, 0.9); }
  function route(path: number[], stop: number, color: string) {
    clearArrow();
    path = path.filter(ok);
    if (path.length < 2) return;
    const k = Math.max(1, path.indexOf(stop));
    const pts: THREE.Vector3[] = [];
    for (let i = 1; i <= k; i++) { const s = span(path[i - 1], path[i]); pts.push(...(i === 1 ? s : s.slice(1))); }
    arc(arrowG, pts, color, 0.2, 0.9);
  }
  function setHi(t: number, color: string, amt: number, pulse = false) { hi[t].color = color; hi[t].amt = amt; hi[t].pulse = pulse; }
  function setHighlights(sel: number | null, targets: number[], kind: GlowKind, opts: GlowOpts = {}) {
    for (const h of hi) { h.amt = 0; h.pulse = false; }
    clearGroup(fanG);
    const color = opts.own ? GLOW.fortify : GLOW[kind] ?? GLOW.attack;
    glowTargets = new Set(kind === 'place' ? [] : targets.filter(ok));
    glowWarn = new Set((opts.warn ?? []).filter(ok));
    glowSources = new Set(sel == null ? (opts.sources ?? []).filter(ok) : []);
    for (const t of glowSources) setHi(t, '#ffe9b0', 0.55, true);
    for (const t of targets) if (ok(t)) setHi(t, glowWarn.has(t) ? '#ffd166' : color, 0.95, kind !== 'place');
    for (const t of opts.picked ?? []) if (ok(t)) setHi(t, '#ffffff', 1);
    if (ok(sel)) {
      setHi(sel, '#ffffff', 1);
      if (opts.fan) for (const t of targets) if (ok(t) && t !== sel) arc(fanG, span(sel, t), glowWarn.has(t) ? '#ffd166' : color, 0.09, 0.55, false);
    }
    for (let t = 0; t < NT; t++) paintPlate(t);
  }
  function flash(ts: number[], color: string, dur: number) { const now = performance.now(); for (const t of ts) if (ok(t)) flashes.set(t, { color, dur, until: now + dur }); }
  function glowFrame(time: number) {
    const k = 0.5 + 0.5 * Math.sin(time * 5), now = performance.now();
    for (let t = 0; t < NT; t++) {
      const h = hi[t], f = flashes.get(t), line = outlines[t], top = tops[t].material;
      let color = h.color, amt = h.pulse ? h.amt * (0.5 + 0.5 * k) : h.amt;
      if (f) {
        const left = (f.until - now) / f.dur;
        if (left <= 0) flashes.delete(t);
        else { color = f.color; amt = (0.6 + 0.4 * Math.sin(now * 0.02)) * Math.min(1, left * 3); }
      }
      if (!amt && seized.has(t)) { color = seized.get(t)!; amt = 0.7; }
      const own = !amt && live && owner[t] >= 0 && !(dim && !dim[t]);
      if (own) color = HOUSES[owner[t]].color;
      const hov = hover === t ? 0.22 : hover != null && T[hover].region === T[t].region ? 0.07 : 0;
      line.visible = own || amt > 0.02;
      if (line.visible) { line.material.color.set(color); line.material.opacity = own ? 0.8 : Math.min(1, amt); }
      top.emissive.set(amt > 0.02 ? color : '#ffffff');
      top.emissiveIntensity = amt > 0.02 ? amt * 0.16 + hov * 0.6 : hov * 0.6;
    }
  }

  // a ring that runs out from a blow
  const rings: { m: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; t0: number; dur: number; big: number }[] = [];
  function ring(t: number, color: string, big: boolean, dur = 700) {
    if (!ok(t)) return;
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at(t, 0.14));
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
  // marching: a token goes out to a fight, comes home or goes in, walks a road, crosses a lane

  interface March { g: THREE.Object3D; pts: THREE.Vector3[]; len: number[]; total: number; from: number; to: number; t0: number; dur: number; a: number; b: number; done: () => void }
  const marches: March[] = [];
  /** The token standing off a fight, by "from>to". */
  const out = new Map<string, { g: THREE.Object3D; pts: THREE.Vector3[]; at: number }>();
  const marcher = (h: number) => { const g = banner(h, false).g; g.scale.setScalar(0.72); g.rotation.y = -0.5; scene.add(g); return g; };
  function walk(g: THREE.Object3D, pts: THREE.Vector3[], a: number, b: number, ms: number): Promise<void> {
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return new Promise((done) => {
      if (dead) return done();
      marches.push({ g, pts, len, total: len[len.length - 1] || 1, from: 0, to: 0, t0: performance.now(), dur: Math.max(60, ms / SPEED), a, b, done });
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
      // a little hop on dry land
      if (m.pts.length === 2) m.g.position.y += Math.sin(Math.PI * (m.a + (m.b - m.a) * e)) * 0.8;
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
    if (sea) env.sound?.('sail');
    await walk(g, pts, 0, stand, sea ? 1100 : 260);
  }
  async function settle(from: number, to: number, won: boolean, more = false) {
    const key = from + '>' + to, o = out.get(key);
    if (!o || dead) return;
    if (!won && more) return;
    out.delete(key);
    await walk(o.g, o.pts, o.at, won ? 1 : 0, won ? 220 : bySea(from, to) ? 700 : 240);
    retire(o.g);
  }
  async function travel(path: number[], stop: number) {
    path = path.filter(ok);
    const k = path.indexOf(stop);
    if (dead || path.length < 2 || k < 1) return;
    const g = marcher(owner[path[0]]);
    for (let i = 1; i <= k && !dead; i++) {
      const pts = road(path[i - 1], path[i]), sea = bySea(path[i - 1], path[i]);
      if (sea) env.sound?.('sail');
      await walk(g, pts, 0, 1, sea ? 1100 : 300);
    }
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
    fitDist = Math.max(40, (W2 + 5) / (Math.tan(vHalf) * aspect), ((H2 + 5) * 1.04) / (Math.tan(vHalf) * open));
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
    // (the sum above is taken on a fresh vector: the points themselves are still where they were)
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
    // (a board does not turn by itself behind a menu, as the valley does)
    const spin = controls.autoRotate;
    controls.autoRotate = false;
    controls.update();
    controls.autoRotate = spin;
    const d = camera.position.distanceTo(controls.target);
    ppu = vh / (2 * d * Math.tan((camera.fov * Math.PI) / 360));
    // Haze begins behind the board, so the land you play on stays clear at any zoom.
    (scene.fog as THREE.Fog).near = d * 1.1 + 40;
    (scene.fog as THREE.Fog).far = d * 2.2 + 520;
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(x: number, y: number): number | null {
    const r = renderer.domElement.getBoundingClientRect();
    const px = x - r.left, py = y - r.top;
    const p = plateAt(px, py);
    if (p >= 0) return p;
    ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(tops, false)[0];
    return hit ? (hit.object.userData.t as number) : null;
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
    seaU.uTime.value = time;
    cameraFrame();
    camera.updateMatrixWorld();
    glowFrame(time);
    ringsFrame();
    marchFrame();
    placeLabels();
    renderer.render(scene, camera);
  }

  function dispose() {
    dead = true;
    for (const m of marches.splice(0)) m.done();
    layer.replaceChildren();
    layer.classList.remove('reveal', 'board', 'near');
    camera.clearViewOffset();
    controls.maxDistance = maxDist0;
    const seen = new Set<unknown>();
    const drop = (x: any) => { if (x && typeof x.dispose === 'function' && !seen.has(x)) { seen.add(x); x.dispose(); } };
    scene.traverse((o: any) => { drop(o.geometry); for (const m of [].concat(o.material ?? [])) drop(m); o.shadow?.dispose?.(); });
    for (const x of [...made, footGeo, poleGeo, flagGeo, tipGeo, stoneMat, woodMat, goldMat, ...flagMat]) drop(x);
    scene.clear();
  }

  resize();
  idle();
  return {
    scene, frame, resize, home, dispose, apply, idle,
    setHighlights,
    setHover: (t) => { hover = ok(t) ? t : null; },
    setOdds: (odds) => { plateOdds = odds ?? {}; for (let t = 0; t < NT; t++) paintPlate(t); },
    setDim: (keep) => { dim = keep; paintAll(); },
    setMarks: (sz, storm) => {
      seized.clear(); for (const s of sz) if (ok(s.t)) seized.set(s.t, s.color);
      stormy.clear(); for (const t of storm) if (ok(t)) stormy.add(t);
      paintAll();
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
    ambience: () => ({ water: live ? 0.22 : 0.1, falls: 0, oars: marches.some((m) => m.pts.length > 2) ? 0.6 : 0, frost: 0 }),
  };
}
