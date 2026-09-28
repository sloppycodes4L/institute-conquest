// The Valley of the Institute in three.js: hex terrain per territory, biome dressing,
// castles, floating Olympus, army tokens, animated House Standards, and a lot of blood.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { HOUSES, vnoise, type Biome, type Geo } from '../engine/data.ts';
import type { GameState, Siege } from '../engine/engine.ts';

const BIOME: Record<Biome, { color: string; h: number; v: number }> = {
  keep: { color: '#7a6d60', h: 1.25, v: 0.12 },
  forest: { color: '#2f5c2c', h: 0.95, v: 0.18 },
  lake: { color: '#1f5a7a', h: 0.32, v: 0.0 },
  swamp: { color: '#3d4a2c', h: 0.5, v: 0.08 },
  crag: { color: '#7d6b58', h: 1.45, v: 0.7 },
  mountain: { color: '#857666', h: 2.0, v: 1.1 },
  plain: { color: '#8f7d3f', h: 0.8, v: 0.12 },
  fields: { color: '#c79d3a', h: 0.75, v: 0.05 },
  highland: { color: '#6e6a47', h: 1.3, v: 0.4 },
  snow: { color: '#dde6ee', h: 1.4, v: 0.45 },
  deadwood: { color: '#4d4b45', h: 0.9, v: 0.15 },
};
export const NEUTRAL_COLOR = '#a39a88';
/** Pick id for Olympus itself (territories are 0..nt-1). */
export const OLYMPUS = -2;

const w2v = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
const rnd = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export type HighlightKind = 'attack' | 'fortify' | 'place' | 'target' | 'std' | 'assault';
export type OlympusMode = 'solid' | 'ghost' | 'hidden';
export interface HighlightOpts {
  /** Territories that could act (soft glow while nothing is selected). */
  sources?: number[];
  /** Draw an arc from the selection to every target. */
  fan?: boolean;
  /** Targets that belong to allies (shown in warning orange). */
  warn?: number[];
  /** Include Olympus as a target. */
  olympus?: boolean;
}

interface Decor { mesh: THREE.InstancedMesh; terr: number[]; base: THREE.Color }
interface Blood { pts: THREE.Points; vel: Float32Array; t0: number; floor: number }

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  onPick: (t: number | null) => void = () => {};
  onHover: (t: number | null, x: number, y: number) => void = () => {};
  geo!: Geo;

  private map = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private mats: THREE.MeshStandardMaterial[] = [];
  private desat: { value: number }[] = [];
  private borderMats: LineMaterial[] = [];
  topH: number[] = [];
  private decor: Decor[] = [];
  private castles: { t: number; mats: THREE.MeshStandardMaterial[]; base: THREE.Color[] }[] = [];
  private tokens: { group: THREE.Group; base: THREE.Mesh; sprite: THREE.Sprite; key: string }[] = [];
  private flags: { group: THREE.Group; cloth: THREE.Mesh; base: Float32Array; house: number }[] = [];
  private olympus!: THREE.Group;
  private olyMeshes: THREE.Mesh[] = [];
  private olyY = 7;
  private olyToken: THREE.Sprite | null = null;
  private olyKey = '';
  private olyMode: OlympusMode = 'solid';
  private highlight: { sel: number | null; targets: Set<number>; kind: HighlightKind; opts: HighlightOpts } = { sel: null, targets: new Set(), kind: 'attack', opts: {} };
  private hover: number | null = null;
  private arrowObj: THREE.Object3D | null = null;
  private fanObj: THREE.Group | null = null;
  private fx: { obj: THREE.Mesh; t0: number; dur: number }[] = [];
  private blood: Blood[] = [];
  private decals: { mesh: THREE.Mesh; t0: number }[] = [];
  private splatTex: THREE.Texture[] = [];
  private camAnim: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null = null;
  private t0 = performance.now();
  private shakeUntil = 0;
  private raycaster = new THREE.Raycaster();
  private sun!: THREE.DirectionalLight;
  private focusSeat: number | null = null;
  private lastState: GameState | null = null;

  constructor(private container: HTMLElement, geo: Geo) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 1400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxPolarAngle = 1.28;
    this.controls.screenSpacePanning = false;
    // Scroll zooms (toward the cursor), left-drag pans the map, right-drag turns the camera.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.zoomToCursor = true;
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.buildSky();
    this.buildLights();
    this.buildSplats();
    this.scene.add(this.map);
    this.setGeo(geo);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Rebuild the valley for a different map size (the map grows with the player count). */
  setGeo(geo: Geo) {
    if (this.geo === geo) return;
    this.geo = geo;
    this.map.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.map.clear();
    this.meshes = []; this.mats = []; this.desat = []; this.borderMats = []; this.decor = []; this.castles = [];
    this.tokens = []; this.flags = []; this.olyMeshes = []; this.olyToken = null; this.olyKey = '';
    this.topH = new Array(geo.nt).fill(1);
    this.clearArrow();
    this.clearFan();
    for (const d of this.decals) this.scene.remove(d.mesh);
    this.decals = [];
    this.highlight = { sel: null, targets: new Set(), kind: 'attack', opts: {} };

    const k = geo.R_OUT / 25;
    this.scene.fog = new THREE.Fog('#3d1c1a', 90 * k, 300 * k);
    const c = this.sun.shadow.camera;
    c.left = -geo.R_OUT * 1.3; c.right = geo.R_OUT * 1.3; c.top = geo.R_OUT * 1.3; c.bottom = -geo.R_OUT * 1.3; c.far = 200 * k;
    this.sun.position.set(-40 * k, 60 * k, 25 * k);
    c.updateProjectionMatrix();
    this.controls.target.set(0, 0, 1);
    this.camera.position.set(0, 64 * k, 40 * k);

    this.buildGround();
    this.buildTerritories();
    this.buildDecor();
    this.buildCastles();
    this.buildOlympus();
    this.buildTokens();
    this.buildFlags();
    this.setOlympusMode(this.olyMode);
    this.resize();
  }

  // -------------------------------------------------------------------------
  // construction

  private buildSky() {
    const geo = new THREE.SphereGeometry(700, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#120a1c') }, mid: { value: new THREE.Color('#5a2320') }, bot: { value: new THREE.Color('#b8582c') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.55, h)) : mix(bot, mid, smoothstep(-0.05, 0.08, h)); gl_FragColor = vec4(c,1.0); }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    // stars
    const pts: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = rnd(i, 1), v = rnd(i, 2);
      const th = u * Math.PI * 2, ph = Math.acos(1 - v * 0.9);
      pts.push(Math.sin(ph) * Math.cos(th) * 680, Math.cos(ph) * 680, Math.sin(ph) * Math.sin(th) * 680);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffe9d6', size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
    // Phobos & Deimos
    const moon = (r: number, pos: THREE.Vector3, c: string) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshBasicMaterial({ color: c, fog: false }));
      m.position.copy(pos);
      this.scene.add(m);
    };
    moon(12, new THREE.Vector3(-220, 260, -450), '#b9a48f');
    moon(6, new THREE.Vector3(290, 205, -410), '#d8c7b0');
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight('#ffd9b8', '#3a1a12', 0.9));
    const sun = new THREE.DirectionalLight('#ffd7a8', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 10;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight('#8aa0ff', 0.35);
    fill.position.set(40, 30, -30);
    this.scene.add(fill);
  }

  private buildGround() {
    const { R_OUT, R_IN } = this.geo;
    // the burning chasm beneath everything
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(R_OUT + 4, 96),
      new THREE.MeshStandardMaterial({ color: '#1a0605', emissive: '#6b1406', emissiveIntensity: 0.9, roughness: 1 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -2.2;
    this.map.add(pit);
    // a brighter glow down the chasm around Olympus
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R_IN, 64), new THREE.MeshBasicMaterial({ color: '#ff5a1a', transparent: true, opacity: 0.08 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -2.1;
    this.map.add(glow);
    // outer badlands
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R_OUT + 1.5, R_OUT * 10, 128, 1),
      new THREE.MeshStandardMaterial({ color: '#4a2a1b', roughness: 1 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.3;
    ring.receiveShadow = true;
    this.map.add(ring);
    // mountain wall around the valley
    const N = Math.round(140 * R_OUT / 25);
    const cone = new THREE.ConeGeometry(1, 1, 7);
    const inst = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: '#6b3b25', roughness: 0.95, flatShading: true }), N);
    const snow = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: '#efe6dc', roughness: 0.8, flatShading: true }), N);
    const m = new THREE.Matrix4();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd(i, 3) * 0.05;
      const r = R_OUT + 14 + rnd(i, 4) * 30;
      const hgt = 5 + rnd(i, 5) * 12 + (r - R_OUT) * 0.35;
      const wd = 4 + rnd(i, 6) * 6;
      m.compose(new THREE.Vector3(Math.cos(a) * r, hgt / 2 - 0.4, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(i, 7) * 6), new THREE.Vector3(wd, hgt, wd));
      inst.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(Math.cos(a) * r, hgt * 0.86 - 0.4, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(i, 7) * 6), new THREE.Vector3(wd * 0.29, hgt * 0.29, wd * 0.29));
      snow.setMatrixAt(i, m);
    }
    inst.receiveShadow = true;
    this.map.add(inst, snow);
  }

  private hexHeight(h: { x: number; y: number; t: number }) {
    const b = BIOME[this.geo.territories[h.t].biome];
    return b.h + (vnoise(h.x * 0.45 + 11, h.y * 0.45) - 0.5) * 2 * b.v;
  }

  private buildTerritories() {
    const { nt, territories, hexes, centroid } = this.geo;
    const byT: { x: number; y: number; t: number }[][] = Array.from({ length: nt }, () => []);
    for (const h of hexes) byT[h.t].push(h);
    const tmp = new THREE.Color();
    for (let t = 0; t < nt; t++) {
      const tdef = territories[t];
      const base = new THREE.Color(BIOME[tdef.biome].color);
      if (tdef.quadrant === 2 && tdef.biome !== 'lake') base.lerp(new THREE.Color('#d6dde6'), 0.45);
      if (tdef.quadrant === 2 && tdef.biome === 'lake') base.set('#5c8fb0');
      const geos: THREE.BufferGeometry[] = [];
      let centerH = 1;
      const [cx, cy] = centroid[t];
      for (const h of byT[t]) {
        const top = this.hexHeight(h);
        const g = new THREE.CylinderGeometry(0.985, 0.985, top + 3, 6, 1);
        g.translate(h.x, (top - 3) / 2, -h.y);
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        const jitter = (vnoise(h.x * 1.7, h.y * 1.7) - 0.5) * 0.12;
        tmp.copy(base).offsetHSL(0, 0, jitter);
        if (tdef.biome === 'fields' && (Math.round(h.x + h.y * 0.3) & 1)) tmp.offsetHSL(0.03, -0.1, -0.05);
        for (let i = 0; i < n; i++) {
          const y = g.attributes.position.getY(i);
          const k = y > top - 0.01 ? 1 : 0.55 + 0.35 * Math.max(0, (y + 3) / (top + 3));
          col[i * 3] = tmp.r * k; col[i * 3 + 1] = tmp.g * k; col[i * 3 + 2] = tmp.b * k;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geos.push(g);
        if (Math.abs(h.x - cx) < 0.01 && Math.abs(h.y - cy) < 0.01) centerH = top;
      }
      this.topH[t] = centerH;
      const merged = mergeGeometries(geos)!;
      geos.forEach((g) => g.dispose());
      const water = tdef.biome === 'lake';
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: water ? 0.18 : 0.92, metalness: water ? 0.25 : 0.02, flatShading: true,
        emissive: new THREE.Color('#000000'),
      });
      // "My Lands" view: other Houses' land fades to a flat, dull grey.
      const uDesat = { value: 0 };
      this.desat.push(uDesat);
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uDesat = uDesat;
        sh.fragmentShader = 'uniform float uDesat;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum * 0.5 + 0.05), uDesat);`);
      };
      mat.customProgramCacheKey = () => 'terr-desat';
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.t = t;
      this.map.add(mesh);
      this.meshes.push(mesh);
      this.mats.push(mat);

      // territory outline, inset so neighbours' outlines sit side by side
      const hexSet = new Set(byT[t].map((h) => Math.round(h.x * 100) + ',' + Math.round(h.y * 100)));
      const segs: number[] = [];
      const SQ3 = Math.sqrt(3);
      const dirs = [0, 60, 120, 180, 240, 300].map((d) => [SQ3 * Math.cos((d * Math.PI) / 180), SQ3 * Math.sin((d * Math.PI) / 180)]);
      for (const h of byT[t]) {
        const top = this.hexHeight(h) + 0.06;
        for (const [dx, dy] of dirs) {
          const nx = h.x + dx, ny = h.y + dy;
          if (hexSet.has(Math.round(nx * 100) + ',' + Math.round(ny * 100))) continue;
          const mx = h.x + dx / 2 * 0.9, my = h.y + dy / 2 * 0.9;
          const px = -dy / SQ3 * 0.5, py = dx / SQ3 * 0.5;
          segs.push(mx + px, top, -(my + py), mx - px, top, -(my - py));
        }
      }
      const lg = new LineSegmentsGeometry();
      lg.setPositions(segs);
      const lm = new LineMaterial({ color: 0xffffff, linewidth: 2.2, transparent: true, opacity: 0.85 });
      this.map.add(new LineSegments2(lg, lm));
      this.borderMats.push(lm);
    }
  }

  private buildDecor() {
    const { hexes, territories, centroid } = this.geo;
    type L = { m: THREE.Matrix4; t: number }[];
    const trees: L = [], trunks: L = [], dead: L = [], rocks: L = [], peaks: L = [], caps: L = [], reeds: L = [], ice: L = [], bales: L = [];
    const M = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(sx, sy, sz));
    for (const h of hexes) {
      const tdef = territories[h.t];
      if (tdef.isKeep) continue;
      const [cx, cy] = centroid[h.t];
      if (Math.hypot(h.x - cx, h.y - cy) < 1.2) continue; // keep the token spot clear
      const top = this.hexHeight(h);
      const r1 = rnd(h.x, h.y), r2 = rnd(h.y, h.x), r3 = rnd(h.x + 3, h.y - 7);
      const ox = (r1 - 0.5) * 0.9, oy = (r2 - 0.5) * 0.9;
      const X = h.x + ox, Z = -(h.y + oy);
      const t = h.t;
      switch (tdef.biome) {
        case 'forest': {
          const n = 2 + Math.floor(r3 * 2);
          for (let i = 0; i < n; i++) {
            const a = i * 2.1 + r1 * 6, d = 0.35 + 0.1 * i;
            const tx = h.x + Math.cos(a) * d, tz = -(h.y + Math.sin(a) * d);
            const s = 0.55 + rnd(a, h.x) * 0.35;
            trees.push({ m: M(tx, top + 0.35 + s * 0.8, tz, s * 0.55, s * 1.6, s * 0.55), t });
            trunks.push({ m: M(tx, top + 0.2, tz, 0.09, 0.45, 0.09), t });
          }
          break;
        }
        case 'deadwood': if (r3 < 0.7) dead.push({ m: M(X, top + 0.7, Z, 0.08, 1.4, 0.08, r1, (r2 - 0.5) * 0.4), t }); break;
        case 'highland': if (r3 < 0.35) { trees.push({ m: M(X, top + 0.8, Z, 0.4, 1.3, 0.4), t }); trunks.push({ m: M(X, top + 0.2, Z, 0.08, 0.4, 0.08), t }); } else if (r3 < 0.6) rocks.push({ m: M(X, top + 0.1, Z, 0.35, 0.25, 0.3, r1 * 6), t }); break;
        case 'crag': rocks.push({ m: M(X, top + 0.15, Z, 0.45 + r3 * 0.3, 0.4 + r3 * 0.5, 0.4, r1 * 6), t }); break;
        case 'mountain':
          if (r3 < 0.6) { const ph = 1.2 + r3 * 2.4; peaks.push({ m: M(X, top + ph / 2, Z, 0.9, ph, 0.9, r1 * 6), t }); caps.push({ m: M(X, top + ph * 0.84, Z, 0.3, ph * 0.33, 0.3, r1 * 6), t }); }
          else rocks.push({ m: M(X, top + 0.1, Z, 0.4, 0.3, 0.4, r1 * 6), t });
          break;
        case 'swamp': for (let i = 0; i < 4; i++) reeds.push({ m: M(X + (rnd(i, h.x) - 0.5) * 0.7, top + 0.25, Z + (rnd(h.y, i) - 0.5) * 0.7, 0.03, 0.5, 0.03, 0, (rnd(i, i) - 0.5) * 0.4), t }); break;
        case 'snow': if (r3 < 0.5) ice.push({ m: M(X, top + 0.3, Z, 0.25, 0.6, 0.25, r1 * 6, (r2 - 0.5) * 0.3), t }); break;
        case 'fields': if (r3 < 0.25) bales.push({ m: M(X, top + 0.15, Z, 0.25, 0.3, 0.25, r1 * 6), t }); break;
        case 'plain': if (r3 < 0.15) rocks.push({ m: M(X, top + 0.05, Z, 0.2, 0.12, 0.2, r1 * 6), t }); break;
      }
    }
    const add = (geo: THREE.BufferGeometry, color: string, list: L, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      if (!list.length) return;
      // White material + per-instance colour, so each territory's dressing can go grey on its own.
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true, ...opts }), list.length);
      const base = new THREE.Color(color);
      list.forEach((x, i) => { im.setMatrixAt(i, x.m); im.setColorAt(i, base); });
      im.castShadow = true;
      im.receiveShadow = true;
      this.map.add(im);
      this.decor.push({ mesh: im, terr: list.map((x) => x.t), base });
    };
    add(new THREE.ConeGeometry(1, 1, 6), '#27512a', trees);
    add(new THREE.CylinderGeometry(1, 1, 1, 5), '#4a3322', trunks);
    add(new THREE.CylinderGeometry(0.4, 1, 1, 4), '#2c2926', dead);
    add(new THREE.DodecahedronGeometry(1, 0), '#8a7866', rocks);
    add(new THREE.ConeGeometry(1, 1, 5), '#7b6a5a', peaks);
    add(new THREE.ConeGeometry(1, 1, 5), '#f4efe8', caps);
    add(new THREE.CylinderGeometry(1, 1, 1, 3), '#7d8a3a', reeds);
    add(new THREE.OctahedronGeometry(1, 0), '#bfe3f5', ice, { roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
    add(new THREE.CylinderGeometry(1, 1, 1, 8), '#d8b45a', bales);
  }

  private buildCastles() {
    for (let h = 0; h < HOUSES.length; h++) {
      const t = this.geo.keepOf(h);
      const [x, y] = this.geo.centroid[t];
      const g = new THREE.Group();
      const stone = new THREE.MeshStandardMaterial({ color: '#8d8378', roughness: 0.85, flatShading: true });
      const roof = new THREE.MeshStandardMaterial({ color: HOUSES[h].color, roughness: 0.6, flatShading: true });
      const box = (w: number, hh: number, d: number, px: number, py: number, pz: number, m = stone) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
        b.position.set(px, py, pz); b.castShadow = true; b.receiveShadow = true; g.add(b);
      };
      box(3.0, 0.7, 3.0, 0, 0.35, 0);
      for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.45, 1.9, 8), stone);
        tw.position.set(dx, 0.95, dz); tw.castShadow = true; g.add(tw);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 8), roof);
        cone.position.set(dx, 2.3, dz); cone.castShadow = true; g.add(cone);
      }
      box(1.3, 2.6, 1.3, 0, 1.3, 0);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.4, 4), roof);
      spire.position.set(0, 3.3, 0); spire.rotation.y = Math.PI / 4; spire.castShadow = true; g.add(spire);
      g.position.copy(w2v(x - 1.6, y + 1.2, this.topH[t]));
      g.scale.setScalar(0.62);
      g.rotation.y = rnd(h, 9) * 2;
      this.map.add(g);
      this.castles.push({ t, mats: [stone, roof], base: [stone.color.clone(), roof.color.clone()] });
    }
  }

  private buildOlympus() {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.ConeGeometry(4.6, 7, 9, 2), new THREE.MeshStandardMaterial({ color: '#6a4a36', roughness: 1, flatShading: true }));
    rock.rotation.x = Math.PI; rock.position.y = -3.5; g.add(rock);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.6, 9), new THREE.MeshStandardMaterial({ color: '#d9d0c0', roughness: 0.6, flatShading: true }));
    g.add(top);
    const marble = new THREE.MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.4 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 2.2, 8), marble);
      col.position.set(Math.cos(a) * 2.3, 1.4, Math.sin(a) * 2.3); col.castShadow = true; g.add(col);
    }
    const ringTop = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.35, 24), marble);
    ringTop.position.y = 2.65; g.add(ringTop);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e7b53c', metalness: 0.8, roughness: 0.25, emissive: '#5a3a00', emissiveIntensity: 0.4 }));
    dome.position.y = 2.8; g.add(dome);
    const light = new THREE.PointLight('#ffcf6b', 60, 40, 1.6);
    light.position.y = 1.2; g.add(light);
    const scale = Math.max(0.85, this.geo.R_IN / 14);
    this.olyY = 5 + scale * 1.8;
    g.position.set(0, this.olyY, 0);
    g.scale.setScalar(scale);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { this.olyMeshes.push(o as THREE.Mesh); o.userData.t = OLYMPUS; } });
    this.olympus = g;
    this.map.add(g);
  }

  /** Solid, see-through ghost, or hidden, so Olympus never blocks your view of the valley. */
  setOlympusMode(mode: OlympusMode) {
    this.olyMode = mode;
    if (!this.olympus) return;
    this.olympus.visible = mode !== 'hidden';
    for (const m of this.olyMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = mode === 'ghost';
      mat.opacity = mode === 'ghost' ? 0.16 : 1;
      mat.depthWrite = mode !== 'ghost';
      m.castShadow = mode === 'solid';
      mat.needsUpdate = true;
    }
  }
  get olympusMode() { return this.olyMode; }

  private buildTokens() {
    for (let t = 0; t < this.geo.nt; t++) {
      const [x, y] = this.geo.centroid[t];
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.34, 20), new THREE.MeshStandardMaterial({ color: '#888', roughness: 0.4, metalness: 0.3 }));
      base.castShadow = true;
      base.position.y = 0.17;
      group.add(base);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      sprite.scale.set(2.8, 1.4, 1);
      sprite.position.y = 1.5;
      sprite.renderOrder = 10;
      group.add(sprite);
      group.position.copy(w2v(x, y, this.topH[t] + 0.02));
      group.visible = false;
      this.map.add(group);
      this.tokens.push({ group, base, sprite, key: '' });
    }
  }

  private flagTexture(h: number) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = HOUSES[h].color;
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 256; i += 32) g.fillRect(i, 0, 3, 160);
    g.strokeStyle = '#f3d27a'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 150);
    g.fillStyle = h === 5 ? '#2a2a2a' : '#fff6e0';
    g.font = 'bold 104px serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(HOUSES[h].sigil, 128, 86);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildFlags() {
    const gold = new THREE.MeshStandardMaterial({ color: '#d9b045', metalness: 0.8, roughness: 0.3 });
    for (let h = 0; h < HOUSES.length; h++) {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), gold);
      pole.position.y = 1.8; pole.castShadow = true; group.add(pole);
      const eagle = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), gold);
      eagle.position.y = 3.7; group.add(eagle);
      const geo = new THREE.PlaneGeometry(1.7, 1.05, 12, 6);
      geo.translate(0.85, 2.9, 0);
      const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.flagTexture(h), side: THREE.DoubleSide, roughness: 0.8 }));
      cloth.castShadow = true;
      group.add(cloth);
      group.visible = false;
      this.map.add(group);
      this.flags.push({ group, cloth, base: Float32Array.from(geo.attributes.position.array as Float32Array), house: h });
    }
  }

  private buildSplats() {
    for (let k = 0; k < 4; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const blob = (x: number, y: number, r: number, a: number) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(135,2,8,${a})`);
        grad.addColorStop(0.7, `rgba(165,10,14,${a * 0.9})`);
        grad.addColorStop(1, 'rgba(165,10,14,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      };
      blob(64, 64, 34, 0.95);
      for (let i = 0; i < 14; i++) {
        const a = rnd(k, i) * Math.PI * 2, d = 18 + rnd(i, k) * 38;
        blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + rnd(i + 3, k) * 12, 0.85);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.splatTex.push(tex);
    }
  }

  // -------------------------------------------------------------------------
  // state → visuals

  private tokenTexture(n: number, color: string, std: boolean, placed: number) {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(12,8,8,0.82)';
    g.strokeStyle = color; g.lineWidth = 8;
    g.beginPath();
    g.roundRect(8, 8, 176, 80, 26);
    g.fill(); g.stroke();
    g.fillStyle = '#fff';
    const shift = placed ? -18 : 0;
    g.font = `bold ${n >= 100 ? 50 : 58}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), (std ? 108 : 96) + shift, 52);
    if (std) { g.fillStyle = '#f3d27a'; g.font = 'bold 44px serif'; g.fillText('⚑', 44, 52); }
    if (placed) { g.fillStyle = '#7dff9a'; g.font = 'bold 38px "Barlow Condensed", sans-serif'; g.fillText(`+${placed}`, 150, 54); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private olympusTexture(n: number) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(30,6,6,0.88)'; g.strokeStyle = '#f3d27a'; g.lineWidth = 8;
    g.beginPath(); g.roundRect(8, 8, 240, 80, 26); g.fill(); g.stroke();
    g.fillStyle = '#ffe7a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 30px "Cinzel", serif'; g.fillText('OLYMPUS', 128, 32);
    g.fillStyle = '#fff'; g.font = 'bold 40px "Barlow Condensed", sans-serif'; g.fillText(`${n} defenders`, 128, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  colorOf(s: GameState, owner: number) {
    return owner >= 0 ? HOUSES[s.players[owner].house].color : NEUTRAL_COLOR;
  }

  /** Title-screen look: an unclaimed valley. */
  idle() {
    this.lastState = null;
    for (const t of this.tokens) { t.group.visible = false; t.key = ''; }
    for (const f of this.flags) f.group.visible = false;
    for (let t = 0; t < this.geo.nt; t++) {
      this.mats[t].color.set('#ffffff');
      this.borderMats[t].color.set(HOUSES[this.geo.territories[t].house].color);
      this.borderMats[t].linewidth = 1.6;
    }
    this.setSiege(null);
    this.setFocus(null);
    this.setHighlights(null, [], 'attack');
  }

  update(s: GameState) {
    this.lastState = s;
    const white = new THREE.Color('#ffffff');
    for (let t = 0; t < this.geo.nt; t++) {
      const col = this.colorOf(s, s.owner[t]);
      const tint = white.clone().lerp(new THREE.Color(col), s.owner[t] >= 0 ? 0.38 : 0.12);
      this.mats[t].color.copy(tint);
      this.borderMats[t].color.set(col);
      this.borderMats[t].linewidth = s.owner[t] >= 0 ? 2.6 : 1.4;
      const hasStd = s.standards.some((st) => !st.captured && st.at === t);
      const placed = s.phase === 'draft' ? s.ts.placed[t] ?? 0 : 0;
      const key = `${s.armies[t]}|${col}|${hasStd}|${placed}`;
      const tok = this.tokens[t];
      tok.group.visible = true;
      if (tok.key !== key) {
        (tok.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (tok.sprite.material as THREE.SpriteMaterial).map = this.tokenTexture(s.armies[t], col, hasStd, placed);
        (tok.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
        (tok.base.material as THREE.MeshStandardMaterial).color.set(col);
        tok.key = key;
      }
    }
    for (const f of this.flags) {
      const st = s.standards[f.house];
      f.group.visible = !st.captured;
      if (!st.captured) {
        const [x, y] = this.geo.centroid[st.at];
        f.group.position.copy(w2v(x + 0.9, y - 0.7, this.topH[st.at]));
      }
    }
    this.setSiege(s.siege);
    this.applyFocus();
    this.applyHighlights();
  }

  /** "My Lands" view: everything `seat` doesn't hold turns flat and dull; null turns it off. */
  setFocus(seat: number | null) {
    this.focusSeat = seat;
    this.applyFocus();
  }
  private applyFocus() {
    const s = this.lastState;
    const dull = (t: number) => this.focusSeat != null && !!s && s.owner[t] !== this.focusSeat;
    for (let t = 0; t < this.geo.nt; t++) {
      this.desat[t].value = dull(t) ? 1 : 0;
      this.borderMats[t].opacity = dull(t) ? 0.25 : 0.85;
      const sm = this.tokens[t].sprite.material as THREE.SpriteMaterial;
      sm.opacity = dull(t) ? 0.5 : 1;
    }
    const grey = new THREE.Color();
    for (const d of this.decor) {
      d.terr.forEach((t, i) => {
        if (dull(t)) { const l = d.base.r * 0.3 + d.base.g * 0.59 + d.base.b * 0.11; grey.setRGB(l * 0.55 + 0.04, l * 0.55 + 0.04, l * 0.55 + 0.04); d.mesh.setColorAt(i, grey); }
        else d.mesh.setColorAt(i, d.base);
      });
      if (d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true;
    }
    for (const c of this.castles) {
      c.mats.forEach((m, i) => {
        if (dull(c.t)) { const b = c.base[i]; const l = b.r * 0.3 + b.g * 0.59 + b.b * 0.11; m.color.setRGB(l * 0.5, l * 0.5, l * 0.5); }
        else m.color.copy(c.base[i]);
      });
    }
    this.applyHighlights();
  }

  setSiege(sg: Siege | null) {
    if (!sg) {
      if (this.olyToken) { this.olympus.remove(this.olyToken); this.olyToken = null; this.olyKey = ''; }
      return;
    }
    if (!this.olyToken) {
      this.olyToken = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      this.olyToken.renderOrder = 11;
      this.olyToken.position.y = 6.2;
      this.olyToken.scale.set(4.6, 1.72, 1);
      this.olympus.add(this.olyToken);
    }
    const key = String(sg.garrison);
    if (key !== this.olyKey) {
      const m = this.olyToken.material as THREE.SpriteMaterial;
      m.map?.dispose();
      m.map = this.olympusTexture(sg.garrison);
      m.needsUpdate = true;
      this.olyKey = key;
    }
  }

  setHighlights(sel: number | null, targets: number[], kind: HighlightKind, opts: HighlightOpts = {}) {
    const same = this.highlight.sel === sel && this.highlight.kind === kind && this.highlight.targets.size === targets.length
      && targets.every((t) => this.highlight.targets.has(t)) && !!this.highlight.opts.fan === !!opts.fan && !!this.highlight.opts.olympus === !!opts.olympus;
    this.highlight = { sel, targets: new Set(targets), kind, opts };
    if (!same) {
      this.clearFan();
      if (opts.fan && sel != null) {
        const warn = new Set(opts.warn ?? []);
        const g = new THREE.Group();
        for (const t of targets) g.add(this.arc(sel, t, warn.has(t) ? '#ffb020' : '#ff3b1f', 0.13, 0.8));
        if (opts.olympus) g.add(this.arc(sel, OLYMPUS, '#f3d27a', 0.15, 0.85));
        this.scene.add(g);
        this.fanObj = g;
      }
    }
    this.applyHighlights();
  }

  private applyHighlights() {
    const { sel, targets, kind, opts } = this.highlight;
    const kcol = { attack: '#ff3b1f', fortify: '#3bd16f', place: '#f3d27a', target: '#ff9b1f', std: '#f3d27a', assault: '#f3d27a' }[kind];
    const warn = new Set(opts.warn ?? []);
    const sources = new Set(opts.sources ?? []);
    const mineCol = this.focusSeat != null && this.lastState ? this.colorOf(this.lastState, this.focusSeat) : null;
    for (let t = 0; t < this.geo.nt; t++) {
      const m = this.mats[t];
      m.userData.pulse = 0;
      if (t === sel) { m.emissive.set('#f3d27a'); m.emissiveIntensity = 0.55; }
      else if (targets.has(t)) { m.emissive.set(warn.has(t) ? '#ffb020' : kcol); m.emissiveIntensity = 0.4; m.userData.pulse = 1; }
      else if (sources.has(t)) { m.emissive.set('#f3d27a'); m.emissiveIntensity = 0.16; m.userData.pulse = 0.5; }
      else if (t === this.hover) { m.emissive.set('#ffffff'); m.emissiveIntensity = 0.12; }
      else if (mineCol && this.lastState?.owner[t] === this.focusSeat) { m.emissive.set(mineCol); m.emissiveIntensity = 0.14; }
      else { m.emissive.set('#000000'); m.emissiveIntensity = 0; }
    }
  }

  // -------------------------------------------------------------------------
  // effects

  private anchor(t: number, lift: number) {
    if (t === OLYMPUS) return new THREE.Vector3(0, this.olyY + 1, 0);
    const [x, y] = this.geo.centroid[t];
    return w2v(x, y, this.topH[t] + lift);
  }

  private arc(from: number, to: number, color: string, r: number, opacity: number) {
    const a = this.anchor(from, 1.2), b = this.anchor(to, 1.2);
    const mid = a.clone().lerp(b, 0.5); mid.y += a.distanceTo(b) * 0.35 + 1;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    tube.renderOrder = 5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(r * 3, r * 7, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity + 0.2), depthTest: false }));
    head.position.copy(b);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
    head.renderOrder = 5;
    g.add(tube, head);
    return g;
  }

  arrow(from: number, to: number, color = '#ff3b1f') {
    this.clearArrow();
    this.arrowObj = this.arc(from, to, color, 0.16, 0.9);
    this.scene.add(this.arrowObj);
  }
  clearArrow() {
    if (this.arrowObj) { this.scene.remove(this.arrowObj); this.arrowObj = null; }
  }
  private clearFan() {
    if (this.fanObj) { this.scene.remove(this.fanObj); this.fanObj = null; }
  }

  burst(t: number, color: string, big = false) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthTest: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(this.anchor(t, 0.3));
    ring.renderOrder = 6;
    this.scene.add(ring);
    this.fx.push({ obj: ring, t0: performance.now(), dur: big ? 1600 : 900 });
    if (big) this.shakeUntil = performance.now() + 500;
  }

  /** A spray of blood from the fighting at `t`, leaving a stain that dries over time. */
  bleed(t: number, dead: number, big = false) {
    if (dead <= 0) return;
    const origin = this.anchor(t, t === OLYMPUS ? -0.5 : 0.9);
    const floor = t === OLYMPUS ? this.olyY - 0.2 : this.topH[t] + 0.05;
    const n = Math.round(Math.min(260, 24 + dead * 14) * (big ? 1.6 : 1));
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.8;
      pos[i * 3 + 1] = origin.y;
      pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.8;
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * (big ? 6 : 4);
      vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = 3 + Math.random() * (big ? 8 : 5); vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#a4060d', size: big ? 0.42 : 0.3, transparent: true, opacity: 0.95, depthWrite: false }));
    pts.renderOrder = 7;
    this.scene.add(pts);
    this.blood.push({ pts, vel, t0: performance.now(), floor });
    if (t === OLYMPUS) return;
    // the stain
    const size = Math.min(4.2, 1.1 + Math.sqrt(dead) * 0.55) * (big ? 1.3 : 1);
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: this.splatTex[Math.floor(Math.random() * this.splatTex.length)], transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = Math.random() * Math.PI * 2;
    const [cx, cy] = this.geo.centroid[t];
    const x = cx + (Math.random() - 0.5) * 1.4, y = cy + (Math.random() - 0.5) * 1.4;
    // Sit on top of the tallest hex under the stain so the terrain never swallows it.
    let top = this.topH[t];
    for (const h of this.geo.hexes) if (Math.abs(h.x - x) < size * 0.6 && Math.abs(h.y - y) < size * 0.6) top = Math.max(top, this.hexHeight(h));
    decal.position.copy(w2v(x, y, top + 0.1));
    decal.renderOrder = 2;
    this.scene.add(decal);
    this.decals.push({ mesh: decal, t0: performance.now() });
    if (this.decals.length > 90) { const old = this.decals.shift()!; this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
  }

  focus(t: number) {
    const to = t === OLYMPUS ? new THREE.Vector3(0, 0, 0) : (() => { const [x, y] = this.geo.centroid[t]; return w2v(x, y, 0); })();
    this.camAnim = { from: this.controls.target.clone(), to, t0: performance.now() };
  }

  screenPos(t: number) {
    const v = this.anchor(t, 1.5).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  // -------------------------------------------------------------------------
  // input & loop

  private pick(ev: PointerEvent): number | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const targets: THREE.Object3D[] = this.olyMode === 'hidden' ? this.meshes : [...this.meshes, ...this.olyMeshes];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? (hit.object.userData.t as number) : null;
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; button: number } | null = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, button: e.button }; });
    el.addEventListener('pointerup', (e) => {
      // A left click that didn't drag the map is a pick.
      if (down && down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7) this.onPick(this.pick(e));
      down = null;
    });
    let last = 0;
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      el.style.cursor = e.buttons & 1 ? 'grabbing' : e.buttons & 2 ? 'move' : '';
      const now = performance.now();
      if (now - last < 40) return;
      last = now;
      const t = this.pick(e);
      if (t !== this.hover) { this.hover = t; this.applyHighlights(); }
      this.onHover(t, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => { this.hover = null; this.applyHighlights(); this.onHover(null, 0, 0); });
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h || !this.geo) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // pull back so the whole valley fits the narrower screen axis
    const aspect = w / h;
    this.camera.fov = aspect < 0.8 ? 55 : 42;
    this.camera.updateProjectionMatrix();
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const R = this.geo.R_OUT + 4;
    const fit = Math.max(55, R / Math.tan(Math.min(vHalf, hHalf)));
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, fit);
    this.controls.maxDistance = fit * 1.25;
    for (const m of this.borderMats) m.resolution.set(w, h);
  }

  private frame() {
    const t = (performance.now() - this.t0) / 1000;
    const now = performance.now();
    this.olympus.position.y = this.olyY + Math.sin(t * 0.6) * 0.4;
    this.olympus.rotation.y = t * 0.05;
    for (const f of this.flags) {
      if (!f.group.visible) continue;
      const pos = f.cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const bx = f.base[i * 3];
        pos.setZ(i, Math.sin(bx * 3.2 - t * 4 + f.house) * 0.14 * bx);
      }
      pos.needsUpdate = true;
      f.cloth.geometry.computeVertexNormals();
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    for (let i = 0; i < this.mats.length; i++) {
      const m = this.mats[i];
      if (this.geo.territories[i].biome === 'lake') m.roughness = 0.16 + Math.sin(t * 1.3 + i) * 0.06;
      if (m.userData.pulse === 1) m.emissiveIntensity = 0.22 + 0.33 * pulse;
      else if (m.userData.pulse === 0.5) m.emissiveIntensity = 0.08 + 0.1 * pulse;
    }
    this.fx = this.fx.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) { this.scene.remove(f.obj); f.obj.geometry.dispose(); return false; }
      f.obj.scale.setScalar(1 + k * 5);
      (f.obj.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      return true;
    });
    const dt = 1 / 60;
    this.blood = this.blood.filter((b) => {
      const age = (now - b.t0) / 1000;
      const mat = b.pts.material as THREE.PointsMaterial;
      if (age > 1.6) { this.scene.remove(b.pts); b.pts.geometry.dispose(); mat.dispose(); return false; }
      const pos = b.pts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i);
        if (y <= b.floor) continue;
        b.vel[i * 3 + 1] -= 22 * dt;
        pos.setXYZ(i, pos.getX(i) + b.vel[i * 3] * dt, Math.max(b.floor, y + b.vel[i * 3 + 1] * dt), pos.getZ(i) + b.vel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      mat.opacity = age < 1 ? 0.95 : 0.95 * (1 - (age - 1) / 0.6);
      return true;
    });
    for (const d of this.decals) {
      const age = (now - d.t0) / 1000;
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.85 - age / 90);
    }
    if (this.camAnim) {
      const k = Math.min(1, (now - this.camAnim.t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      const next = this.camAnim.from.clone().lerp(this.camAnim.to, e);
      const delta = next.clone().sub(this.controls.target);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      if (k >= 1) this.camAnim = null;
    }
    // Don't let the camera wander off the edge of the world.
    const tg = this.controls.target, lim = this.geo.R_OUT + 6, r = Math.hypot(tg.x, tg.z);
    if (r > lim) { const k = lim / r; const dx = tg.x * (k - 1), dz = tg.z * (k - 1); tg.x += dx; tg.z += dz; this.camera.position.x += dx; this.camera.position.z += dz; }
    tg.y = 0;
    this.controls.update();
    if (now < this.shakeUntil) {
      const o = new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0);
      this.camera.position.add(o);
      this.renderer.render(this.scene, this.camera);
      this.camera.position.sub(o);
    } else this.renderer.render(this.scene, this.camera);
  }
}
