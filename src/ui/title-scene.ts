// The home screen's backdrop: the Keep in a storm, seen from under its gate. Lightning, rain, four braziers, the
// seven Houses' torn standards planted along the approach, and blood on the curtain wall. Everything is drawn in
// code (SVG for the stone and cloth, two canvases for fire and rain), so there is nothing to download.
//
// The scene is drawn 1800 x 900, cover-fitted and anchored to the bottom. A phone sees its middle column: the
// great tower above, the gate below. It was worked out in docs/home-screen-mockup.html.

import { HOUSES as GAME_HOUSES } from '../engine/data.ts';

const W = 1800, H = 900, VPX = 900, VPY = 700, WT = 566, WB = 744, PAD = 20;
// The eye stands in the yard, its focal length KD scene units. A level ring at height y opens toward us by kap(y):
// above the horizon (VPY) its near edge rides high, below it low.
const KD = 1560, kap = (y: number) => (VPY - y) / KD;
const VB = 'viewBox="0 0 1800 900" preserveAspectRatio="xMidYMax slice"';
function rng(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const f = (n: number) => n.toFixed(1), f2 = (n: number) => n.toFixed(2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => '#' + hx(a).map((v, i) => Math.round(v + (hx(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const sh = (h: string, k: number) => '#' + hx(h).map((v) => clamp(Math.round(v * (1 + k)), 0, 255).toString(16).padStart(2, '0')).join('');
const svgUrl = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

type Plane = { lit: string[]; night: string[]; clip: string[]; top: string[] };
type KPlane = { lit: string[]; sil: string[]; top: string[] };
type Stop = [number, string];
type Num = Record<string, number>;
type Edge = (x: number, y: number) => number;

/** sheet: far off, in the cloud. bolt: a strike beyond the Keep. close: overhead, and the ground shakes. */
export type StrikeKind = 'sheet' | 'bolt' | 'close';
export interface TitleSceneOpts {
  /** Lightning has struck, `x` of the way across the screen (0 to 1): time for thunder. */
  onStrike?: (kind: StrikeKind, x: number) => void;
}
export interface TitleScene { el: HTMLElement; strike(kind?: StrikeKind): void; destroy(): void }

// The six standards, nearest first on each side. x, bw and base are in scene units; h is the House.
const STD_SPEC = [
  { h: 0, x: 268, bw: 161, base: 910, lean: -2.2, L: 285, t: 'diagR', haze: 0, warm: .35, d: 30 },
  { h: 1, x: 445, bw: 113, base: 848, lean: 1.5, L: 268, t: 'shred', haze: .15, warm: .7, d: 22 },
  { h: 2, x: 570, bw: 80, base: 804, lean: -1.1, L: 272, t: 'swallow', haze: .28, warm: .9, d: 17 },
  { h: 4, x: 1230, bw: 80, base: 804, lean: 1.4, L: 256, t: 'diagL', haze: .28, warm: .9, d: 17 },
  { h: 5, x: 1355, bw: 113, base: 848, lean: -1.3, L: 280, t: 'swallow', haze: .15, warm: .7, d: 22 },
  { h: 6, x: 1532, bw: 161, base: 910, lean: 2.4, L: 282, t: 'shred', haze: 0, warm: .35, d: 30 },
];

/**
 * How the scene fits a window: its scale and offset (scene to screen: x * S + OX, y * S + OY), the gate arch we
 * look through, and where the standards stand. They are planted three a side between the jamb and the menu, each
 * clear of the next: the wind lays the nearer, longer cloth over toward its neighbour, and it must not cover it.
 * Short of room they all draw back together (smaller, their feet higher up the yard) and keep their gaps. Only
 * where there is no ground beside the menu at all (a phone) do the banners hang in a row from the lintel instead.
 */
export function titleLayout(vw: number, vh: number) {
  const S = Math.max((vw + 2 * PAD) / W, (vh + 2 * PAD) / H), OX = vw / 2 - W / 2 * S, OY = vh + PAD - H * S;
  const jamb = Math.round(clamp(vw * .034, 12, 60)), lintel = Math.round(clamp(vh * .042, 22, 42));
  const xmin = (jamb + 6 - OX) / S, farR = Math.min(610, (vw / 2 - 244 - OX) / S), A = farR - xmin;
  const q = clamp(A / 402, 0, 1), gap = Math.min(40, (A - 354 * q) / 2);
  const off = [80 * q + gap + 113 * q + gap + 80.5 * q, 80 * q + gap + 56.5 * q, 40 * q];      // near, mid, far: how far in from the menu side each one's pole stands
  const std = STD_SPEC.map((s) => { const left = s.x < VPX, slot = s.bw > 150 ? 0 : s.bw > 100 ? 1 : 2, cx = farR - off[slot], w = s.bw * q * S, h = w * 4.5;
    return { x: (left ? cx : W - cx) * S + OX, w, h, top: (VPY + (s.base - VPY) * q) * S + OY - h, z: 3 - slot }; });      // x is the pole's, on screen
  return { S, OX, OY, jamb, lintel, mode: q >= .5 ? 'avenue' : 'row', std };
}

const SKELETON = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<defs>
  <linearGradient id="ts-folds" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset=".17" stop-color="#fff" stop-opacity=".08"/>
    <stop offset=".36" stop-color="#000" stop-opacity=".24"/><stop offset=".55" stop-color="#fff" stop-opacity=".06"/>
    <stop offset=".76" stop-color="#000" stop-opacity=".27"/><stop offset=".9" stop-color="#fff" stop-opacity=".07"/>
    <stop offset="1" stop-color="#000" stop-opacity=".36"/>
  </linearGradient>
  <linearGradient id="ts-grime" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0" stop-color="#050303" stop-opacity=".2"/><stop offset=".12" stop-color="#050303" stop-opacity="0"/>
    <stop offset=".5" stop-color="#050303" stop-opacity=".12"/><stop offset="1" stop-color="#050303" stop-opacity=".82"/>
  </linearGradient>
  <linearGradient id="ts-warmUp" x1="0" x2="0" y1="0" y2="1"><stop offset=".35" stop-color="#ff7a28" stop-opacity="0"/><stop offset="1" stop-color="#ff7a28" stop-opacity=".34"/></linearGradient>
</defs>
<defs id="ts-gdefs"></defs>
</svg>

<div class="ts-plane" data-d="3">
  <svg class="ts-sky" ${VB}>
    <defs>
      <linearGradient id="ts-skyg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#04050a"/><stop offset=".3" stop-color="#0a0e1b"/><stop offset=".5" stop-color="#191827"/><stop offset=".62" stop-color="#2c161b"/><stop offset="1" stop-color="#120a0c"/>
      </linearGradient>
      <radialGradient id="ts-skyglow"><stop offset="0" stop-color="#7484c0" stop-opacity=".7"/><stop offset=".55" stop-color="#4c5a90" stop-opacity=".3"/><stop offset="1" stop-color="#4c5a90" stop-opacity="0"/></radialGradient>
      <filter id="ts-cl1" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency=".0028 .0075" numOctaves="5" seed="11"/>
        <feColorMatrix values="0 0 0 0 .21  0 0 0 0 .24  0 0 0 0 .35  1.9 0 0 0 -.72"/>
      </filter>
      <filter id="ts-cl2" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency=".0017 .0052" numOctaves="4" seed="3"/>
        <feColorMatrix values="0 0 0 0 .012  0 0 0 0 .016  0 0 0 0 .035  0 2.3 0 0 -.88"/>
      </filter>
    </defs>
    <rect width="1800" height="900" fill="url(#ts-skyg)"/>
    <ellipse cx="900" cy="350" rx="700" ry="320" fill="url(#ts-skyglow)"/>
    <rect width="1800" height="720" filter="url(#ts-cl1)"/>
    <rect width="1800" height="720" filter="url(#ts-cl2)"/>
  </svg>
</div>
<div class="ts-cover ts-skyflash a" id="ts-flashA"></div>
<div class="ts-cover ts-skyflash b" id="ts-flashB"></div>
<div class="ts-plane" data-d="4">
  <svg id="ts-bolts" ${VB}>
    <defs><filter id="ts-bglow" x="-100%" y="-10%" width="300%" height="120%"><feGaussianBlur stdDeviation="6"/></filter></defs>
    <g id="ts-boltg" fill="none" stroke-linecap="round" stroke-linejoin="round"></g>
  </svg>
</div>
<div class="ts-plane" data-d="5">
  <svg id="ts-far" ${VB}></svg>
  <svg id="ts-keepCLit" class="ts-klit" ${VB}></svg>
  <svg id="ts-keepCNight" class="ts-knight" ${VB}></svg>
  <svg id="ts-keepCTop" ${VB}></svg>
</div>
<div class="ts-fog f1"></div>
<div class="ts-plane" data-d="7">
  <svg id="ts-keepBLit" class="ts-klit" ${VB}></svg>
  <svg id="ts-keepBNight" class="ts-knight" ${VB}></svg>
  <svg id="ts-keepBTop" ${VB}></svg>
</div>
<div class="ts-plane" data-d="9.5">
  <svg id="ts-keepALit" class="ts-klit" ${VB}></svg>
  <svg id="ts-keepANight" class="ts-knight" ${VB}></svg>
  <svg id="ts-keepATop" ${VB}></svg>
</div>
<div class="ts-fog f2"></div>
<div class="ts-plane" data-d="13">
  <svg id="ts-wallLit" ${VB}></svg>
  <svg id="ts-wallNight" ${VB}></svg>
  <div id="ts-glows"></div>
</div>
<canvas class="ts-cover" id="ts-fx"></canvas>
<div class="ts-sheets"><i id="ts-sheet"></i></div>
<div class="ts-fog f3"></div>
<div class="ts-cover" id="ts-standards"></div>
<div class="ts-plane" data-d="36"><svg id="ts-frame" preserveAspectRatio="none"></svg><div id="ts-hang"></div></div>
<div class="ts-cover ts-vignette"></div>
<div class="ts-cover ts-grain" id="ts-grain"></div>
<canvas class="ts-cover" id="ts-near"></canvas>`;

/** Build the scene as the first thing in `host` (the title screen), and start the weather. */
export function mountTitleScene(host: HTMLElement, opts: TitleSceneOpts = {}): TitleScene {
  const stage = document.createElement('div');
  stage.className = 'ts-stage avenue';
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = SKELETON;
  host.prepend(stage);
  const $ = <E extends Element = HTMLElement>(id: string) => stage.querySelector('#ts-' + id) as unknown as E;
  const R = rng(20261006);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dead = false, raf = 0;

  // ================================================================= the Keep
  // The far towers, the curtain wall and the yard are drawn twice: as lightning shows them, and as the night leaves
  // them. The night copy lies on top and thins when the sky flashes. (The Keep itself is built differently: see below.)
  let PL: Plane;
  const mkPlane = (): Plane => ({ lit: [], night: [], clip: [], top: [] });
  function shape(d: string, cl: string, cn: string, tex = true) { PL.lit.push(`<path d="${d}" fill="${cl}"/>`); PL.night.push(`<path d="${d}" fill="${cn}" stroke="${cn}" stroke-width="1.2" stroke-linejoin="round"/>`); if (tex) PL.clip.push(d); }      // the night copy a hair wider, so no pale fringe shows round it
  const deco = (s: string) => PL.lit.push(s);          // detail only lightning shows
  const both = (s: string) => PL.top.push(s);          // the same by night and by flash: windows, braziers, silhouettes
  const tone = (lit: string, night: string, id: string) => ({ f: [lit, night], s: [sh(lit, -.42), sh(night, -.38)], l: [sh(lit, .22), sh(night, .35)], r: [sh(lit, -.5), sh(night, -.4)], rl: [sh(lit, -.15), sh(night, .2)], c: [`url(#ts-${id}0)`, `url(#ts-${id}1)`] });
  const TW = tone('#5c5660', '#0a0a10', 'wc');
  const cylDef = (id: string, c: string) => `<linearGradient id="ts-${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${sh(c, -.3)}"/><stop offset=".24" stop-color="${sh(c, .2)}"/><stop offset=".6" stop-color="${sh(c, -.14)}"/><stop offset=".9" stop-color="${sh(c, -.5)}"/><stop offset="1" stop-color="${sh(c, -.38)}"/></linearGradient>`;

  // Crenellations from x0 to x1 along y. Some merlons are knocked down.
  function cren(x0: number, x1: number, y: number, o: Num) {
    let d = '', x = x0, up = true;
    while (x < x1 - .5) {
      const xe = Math.min(x + (up ? o.mw : o.gw), x1);
      if (up) { let h = o.mh, s = 0; if (R() < o.broken) { h = o.mh * R() * .6; s = (R() - .5) * 6; } d += `L${f(x)},${f(y - h + s)}L${f(xe)},${f(y - h - s)}L${f(xe)},${y}`; }
      else d += `L${f(xe)},${y}`;
      x = xe; up = !up;
    }
    return d;
  }
  // A square tower: its front, and (off the centre line) the side that runs back toward the vanishing point.
  function box(x: number, w: number, top: number, base: number, T: any, o: Num = {}) {
    const mh = o.mh ?? 15;
    if (o.side) {
      const ex = o.side > 0 ? x + w : x, fx = ex + o.side * o.sw, st = o.ruin ? top : top - mh, dy = o.sw * (VPY - top) / Math.max(160, Math.abs(VPX - ex)) * .6, tt = o.side > 0 ? T.s : T.l;
      shape(`M${ex},${st}L${fx},${f(st + dy)}V${base}H${ex}Z`, tt[0], tt[1]);
    }
    let d = `M${x},${base}V${top}`;
    if (o.ruin) { const n = 6, sw = w / n; let cx = x; for (let i = 0; i < n; i++) { cx += sw; d += `H${f(cx)}V${f(top + o.ruin * Math.pow((i + 1) / n, 1.2) * (.8 + R() * .4))}`; } d += `V${base}Z`; }
    else d += cren(x, x + w, top, { mw: o.mw || 13, gw: o.gw || 9, mh, broken: o.brk ?? .12 }) + `V${base}Z`;
    shape(d, T.f[0], T.f[1]);
    PL.night.push(`<path d="M${x + .8},${base}V${top + 1}" stroke="${sh(T.f[1], .9)}" stroke-width="1.6"/>`);
    if (o.ruin) return;
    deco(`<rect x="${x - 2}" y="${top}" width="${w + 4}" height="${o.band || 6}" fill="#000" opacity=".3"/>`);
    let c = ''; for (let y = top + 22; y < base; y += o.course || 15) c += `M${x},${y}h${w}`;
    deco(`<path d="${c}" stroke="#000" stroke-opacity=".13" fill="none"/>`);
  }
  // A round tower: a shaded drum, crowned with merlons wrapped round it or capped with a cone. Its rings open the
  // way we see them from the yard.
  function round(cx: number, r: number, top: number, base: number, T: any, o: Num = {}) {
    const arc = (rr: number, y: number, x1: number) => `A${rr},${f(Math.abs(rr * kap(y)))} 0 0 ${(x1 > cx) === (kap(y) >= 0) ? 1 : 0} ${f(x1)},${y}`;
    shape(`M${cx - r},${base}V${top}${arc(r, top, cx + r)}V${base}Z`, T.c[0], T.c[1]);
    if (o.cone) {
      const e = r + 5, rye = e * kap(top), tip = top - o.cone, xs = cx - r * .2, ys = top - rye * Math.sqrt(1 - Math.pow(r * .2 / e, 2));
      shape(`M${cx - e},${top}${arc(e, top, cx + e)}L${cx + 1.5},${tip}h-3Z`, T.r[0], T.r[1], false);
      shape(`M${cx - e},${top}A${e},${f(rye)} 0 0 1 ${f(xs)},${f(ys)}L${cx - 1.5},${tip}Z`, T.rl[0], T.rl[1], false);
      deco(`<path d="M${cx - r},${top + 3}${arc(r, top + 3, cx + r)}" stroke="#000" stroke-opacity=".3" stroke-width="6" fill="none"/>`);
    } else {
      const e = r + 4, mh = o.mh ?? 13, rye = e * kap(top);
      let d = `M${cx - e},${top + 8}V${top}${arc(e, top, cx + e)}V${top + 8}${arc(e, top + 8, cx - e)}Z`;
      for (let k = -4; k <= 4; k++) { if (R() < (o.brk ?? .12)) continue; const a = k * 20 * Math.PI / 180, hw = 6.4 * Math.PI / 180, x1 = cx + e * Math.sin(a - hw), x2 = cx + e * Math.sin(a + hw), y1 = top - rye * Math.cos(a - hw), y2 = top - rye * Math.cos(a + hw);
        d += `M${f(x1)},${f(y1 + 1)}V${f(y1 - mh)}L${f(x2)},${f(y2 - mh)}V${f(y2 + 1)}Z`; }
      shape(d, T.c[0], T.c[1]);
      deco(`<path d="M${cx - r},${top + 11}${arc(r, top + 11, cx + r)}" stroke="#000" stroke-opacity=".35" stroke-width="5" fill="none"/>`);
    }
    let c = ''; for (let y = top + 24; y < base; y += o.course || 15) c += `M${cx - r},${y}${arc(r, y, cx + r)}`;
    deco(`<path d="${c}" stroke="#000" stroke-opacity=".12" fill="none"/>`);
  }
  const slit = (x: number, y: number, h = 10) => deco(`<rect x="${x}" y="${y}" width="2.4" height="${h}" fill="#000" opacity=".55"/>`);

  // ---- far: two ridges (the rear towers that stand on them are built with the Keep, below)
  PL = mkPlane(); const FAR = PL;
  FAR.night.push(`<path d="M-40,470L60,436 160,452 262,402 350,430 452,384 548,420 650,372 770,404 872,356 990,396 1100,364 1216,410 1340,378 1470,428 1590,394 1710,420 1840,398V940H-40Z" fill="#1c2238"/>`);
  FAR.night.push(`<rect x="-40" y="300" width="${W + 80}" height="290" fill="url(#ts-hazeR)"/>`);
  FAR.night.push(`<path d="M-40,520L90,486 210,504 340,466 480,496 610,472 740,500 880,462 1020,498 1160,470 1300,504 1440,474 1580,506 1720,480 1840,500V940H-40Z" fill="#151a2d"/>`);
  $('far').innerHTML = FAR.night.join('') + FAR.top.join('') + `<rect x="-40" y="380" width="${W + 80}" height="220" fill="url(#ts-hazeB)"/>`;

  // ---- the Keep on its crag
  // Built as solids under one light, high on the left, and seen from the yard below it. We look up at all of it, so a
  // level ring opens toward us and a level edge falls toward the horizon as it runs back. It is drawn once, as the
  // lightning shows it; the night is a blue-black wash multiplied over that, which thins when the sky flashes, so
  // every face keeps its form in the dark. Two planes: the outer works behind, the great tower and its halls in front.
  const KDEFS: string[] = [], RK = rng(8128);      // its own dice, so reworking the Keep never reshuffles the wall's damage or the blood
  let KP: KPlane;
  const kPlane = (): KPlane => ({ lit: [], sil: [], top: [] });
  const kshape = (d: string, fill: string) => { if (!d) return; KP.lit.push(`<path d="${d}" fill="${fill}"/>`); KP.sil.push(d); };
  const kdeco = (s: string) => KP.lit.push(s), ktop = (s: string) => KP.top.push(s);
  const kgrad = (stops: Stop[], v?: number) => { const id = 'kg' + KDEFS.length; KDEFS.push(`<linearGradient id="ts-${id}" x1="0" y1="0" x2="${v ? 0 : 1}" y2="${v ? 1 : 0}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`); return `url(#ts-${id})`; };
  // Light across a drum: brightest left of centre, a core of shadow on the right, a little thrown back at the far edge.
  const cylStops = (l: string, m: string, d: string): Stop[] => [[0, mix(l, m, .4)], [.14, l], [.46, m], [.8, d], [.94, sh(d, -.14)], [1, mix(d, m, .3)]];
  const stopAt = (st: Stop[], t: number) => { for (let i = 1; i < st.length; i++) if (t <= st[i][0]) return mix(st[i - 1][1], st[i][1], (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0])); return st[st.length - 1][1]; };
  // Stone and slate h of the way into the mist: the lit side, the face toward us, the side in shadow.
  const KT = (h: number) => { const m = (c: string) => mix(c, '#8790b0', h * .8), T: any = { l: m('#a3a8be'), f: m('#676b81'), d: m('#30323d'), rl: m('#6a738e'), rf: m('#454c61'), rd: m('#22252f') };
    T.st = cylStops(T.l, T.f, T.d); T.cy = kgrad(T.st); T.rc = kgrad(cylStops(T.rl, T.rf, T.rd)); T.rv = kgrad([[0, T.rl], [1, T.rf]], 1); T.cu = kgrad(cylStops(mix(T.l, T.d, .6), mix(T.f, T.d, .65), sh(T.d, -.2))); return T; };
  const lancet = (x: number, y: number, w: number, h: number) => `M${f(x)},${f(y + h)}V${f(y + w / 2)}a${w / 2},${w / 2} 0 0 1 ${w},0V${f(y + h)}Z`;
  // A window: a dark reveal with one lit jamb. If someone is home, the light is drawn over the night.
  function kwin(x: number, y: number, w: number, h: number, lit: number) {
    kdeco(`<path d="${lancet(x, y, w, h)}" fill="#05060a" opacity=".85"/><path d="M${f(x + w)},${f(y + w / 2)}V${f(y + h)}" stroke="#fff" stroke-opacity=".18" stroke-width=".8"/>`);
    if (lit) ktop(`<circle cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" r="${f(h * 1.15)}" fill="url(#ts-wglow)" opacity="${f2(lit * .7)}"/><path d="${lancet(x, y, w, h)}" fill="#f0a552" opacity="${lit}"/><path d="${lancet(x + w * .3, y + h * .3, w * .4, h * .7)}" fill="#ffd9a0" opacity="${f2(lit * .7)}"/>`);
  }
  const kslit = (x: number, y: number, h = 11) => kdeco(`<rect x="${x}" y="${y}" width="2.2" height="${h}" fill="#000" opacity=".6"/><rect x="${x + 2.2}" y="${y}" width=".8" height="${h}" fill="#fff" opacity=".14"/>`);
  // What a tower throws on the wall to its right.
  const kshadow = (x: number, y: number, w: number, h: number, a = 1) => kdeco(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#ts-ksh)" opacity="${a}"/>`);

  // A round tower. Crenellated, its parapet is corbelled out and the merlons follow the ring; or it carries a cone
  // of slate, with the underside of the eaves in shadow. corbel hangs it from a wall on an upturned cone.
  function kround(cx: number, r: number, top: number, base: number, T: any, o: Num = {}) {
    const hb = o.cone ? 0 : o.hb ?? 8, e = r + (o.e ?? (o.cone ? 5 : 4)), ry = r * kap(top), rye = e * kap(top);
    const ring = (rr: number, y: number, back?: number) => `A${f(rr)},${f(rr * kap(y))} 0 0 ${back ? 0 : 1} ${f(cx + (back ? -rr : rr))},${f(y)}`;      // the near half of a level ring, left to right (or back again)
    if (o.cone) kshape(`M${cx - e},${top}${ring(e, top)}A${e},${f(rye)} 0 0 1 ${cx - e},${top}Z`, T.rd);
    kshape(`M${cx - r},${base}V${top}${ring(r, top)}V${base}Z`, T.cy);
    if (o.corbel) kshape(`M${cx - r},${base}${ring(r, base)}L${cx},${base + o.corbel}Z`, T.cu);
    let c = ''; for (let y = top + hb + 18; y < base - 4; y += o.course || 14) c += `M${cx - r},${y}${ring(r, y)}`;
    kdeco(`<path d="${c}" stroke="#000" stroke-opacity=".13" fill="none"/><rect x="${cx - r}" y="${f(top + hb - ry)}" width="${2 * r}" height="${f(ry + 24)}" fill="url(#ts-kao)"/><rect x="${f(cx - r * .84)}" y="${top}" width="${f(r * .32)}" height="${base - top}" fill="url(#ts-krim)"/>`);
    if (o.cone) { const tip = top - o.cone;
      kshape(`M${cx - e},${top}${ring(e, top)}L${cx + 1.2},${tip}h-2.4Z`, T.rc);
      let s = ''; for (let k = -3; k <= 3; k++) { const a = k * .42; s += `M${cx},${tip}L${f(cx + e * Math.sin(a))},${f(top - rye * Math.cos(a))}`; }
      for (const u of [.34, .58, .8]) s += `M${f(cx - e * u)},${f(tip + o.cone * u)}A${f(e * u)},${f(rye * u)} 0 0 1 ${f(cx + e * u)},${f(tip + o.cone * u)}`;
      kdeco(`<path d="${s}" stroke="#000" stroke-opacity=".14" fill="none"/><path d="M${cx},${tip + 1}v-10" stroke="#0b0c12" stroke-width="1.5"/><path d="M${cx - .6},${tip + 2}L${f(cx - e * .84)},${f(top - rye * .54)}L${f(cx - e * .5)},${f(top - rye * .87)}Z" fill="#fff" opacity=".1"/>`);
    } else { const mh = o.mh ?? 11, ryb = e * kap(top + hb);
      kshape(`M${cx - e},${top + hb}V${top}${ring(e, top)}V${top + hb}${ring(e, top + hb, 1)}Z`, T.cy);
      let cb = ''; for (let k = -5; k <= 5; k++) { const a = k * .26; if (Math.abs(Math.sin(a)) * e < r - 1) cb += `M${f(cx + e * Math.sin(a))},${f(top + hb - ryb * Math.cos(a) + .5)}v3.6`; }
      kdeco(`<path d="${cb}" stroke="#000" stroke-opacity=".45" stroke-width="2.4"/>`);
      for (let k = -3; k <= 3; k++) { if (RK() < (o.brk ?? .14)) continue; const a = k * .42, hw = .13, x1 = cx + e * Math.sin(a - hw), x2 = cx + e * Math.sin(a + hw), y1 = top - rye * Math.cos(a - hw), y2 = top - rye * Math.cos(a + hw);
        kshape(`M${f(x1)},${f(y1 + .5)}V${f(y1 - mh)}L${f(x2)},${f(y2 - mh)}V${f(y2 + .5)}Z`, stopAt(T.st, (x1 + x2 - 2 * cx + 2 * e) / (4 * e))); }
    }
  }
  // A square tower seen corner-on, turned th degrees: the face left of the corner takes the light, the one right of it
  // is in shadow, and both fall away toward their own vanishing points. ruin breaks it down from the corner.
  function kbox(xc: number, w: number, dp: number, th: number, top: number, base: number, T: any, o: Num = {}) {
    const a = th * Math.PI / 180, ta = Math.tan(a), xl = xc - w * Math.cos(a), xr = xc + dp * Math.sin(a), hb = o.hb ?? 8, mh = o.mh ?? 12, ov = o.ov ?? 3;
    const L = (x: number, y: number) => y + (VPY - y) * (xc - x) * ta / KD, Rr = (x: number, y: number) => y + (VPY - y) * (x - xc) / ta / KD, P = (Y: Edge, x: number, y: number) => `${f(x)},${f(Y(x, y))}`;
    const cl = mix(T.f, T.l, clamp((Math.cos((50 - th) * Math.PI / 180) - .64) / .36, 0, 1)), cr = th > 55 ? mix(T.d, T.f, .3) : T.d;
    let dl = `M${f(xl)},${base}V${f(L(xl, top))}L${xc},${top}V${base}Z`, dr = `M${xc},${base}V${top}L${P(Rr, xr, top)}V${base}Z`;
    if (o.ruin) {
      const jag = (x0: number, x1: number, Y: Edge, d0: number, d1: number, n: number) => { let s = '', pd = d0; for (let i = 1; i <= n; i++) { const x = i === n ? x1 : x0 + (x1 - x0) * (i - .3 + RK() * .6) / n, dd = i === n ? d1 : Math.max(0, d0 + (d1 - d0) * Math.pow(i / n, 1.1) * (.5 + RK()) + (RK() - .5) * 8); s += `L${P(Y, x - (RK() < .5 ? 3 : 0), top + pd)}L${P(Y, x, top + dd)}`; pd = dd; } return s; };
      const xf = xl + xr - xc, yf = top + (VPY - top) * ((xc - xl) * ta + (xr - xc) / ta) / KD;
      // What is left of the far walls, seen through the break, and the charred beams of the floors.
      kshape(`M${P(L, xl, top + o.ruin * .3)}L${f(xf - 16)},${f(yf + 30)}L${f(xf - 7)},${f(yf + 8)}L${f(xf)},${f(yf)}L${f(xf + 13)},${f(yf + 20)}L${P(Rr, xr, top + 34)}V${base}H${f(xl)}Z`, sh(T.d, -.3));
      kdeco(`<path d="M${f(xc + 4)},${f(top + o.ruin * .62)}L${f(xr - 3)},${f(yf + 52)}M${f(xc + 10)},${f(top + o.ruin * .95)}L${f(xf + 6)},${f(yf + 40)}M${f(xr - 14)},${f(yf + 24)}l-5,${f(o.ruin * .7)}" stroke="#08080b" stroke-width="2.6" fill="none"/>`);
      dl = `M${f(xl)},${base}V${f(L(xl, top + o.ruin * .3))}${jag(xl, xc, L, o.ruin * .3, 0, 6)}V${base}Z`;
      dr = `M${xc},${base}V${top}${jag(xc, xr, Rr, 0, o.ruin, 9)}V${base}Z`;
    }
    kshape(dl, cl); kshape(dr, cr);
    const cid = 'kb' + KDEFS.length; KDEFS.push(`<clipPath id="ts-${cid}"><path d="${dl}"/><path d="${dr}"/></clipPath>`);
    let c = ''; for (let y = top + hb + 18; y < base; y += o.course || 15) c += `M${P(L, xl, y)}L${xc},${y}L${P(Rr, xr, y)}`;
    kdeco(`<path d="${dl}" fill="url(#ts-kfl)"/><path d="${dr}" fill="url(#ts-kfr)"/><g clip-path="url(#ts-${cid})"><path d="${c}" stroke="#000" stroke-opacity=".12" fill="none"/>${o.ruin ? '' : `<path d="M${P(L, xl, top + hb)}L${xc},${top + hb}L${P(Rr, xr, top + hb)}L${P(Rr, xr, top + hb + 22)}L${xc},${top + hb + 22}L${P(L, xl, top + hb + 22)}Z" fill="url(#ts-kao)"/>`}</g><path d="M${xc},${top}V${base}" stroke="#fff" stroke-opacity=".1"/>`);
    if (!o.ruin) {
      // The parapet, corbelled out a little, and its merlons: one wraps the corner.
      kshape(`M${P(L, xl - ov, top + hb)}L${xc},${top + hb + 1}V${top - 1}L${P(L, xl - ov, top)}Z`, sh(cl, .07));
      kshape(`M${xc},${top + hb + 1}L${P(Rr, xr + ov, top + hb)}L${P(Rr, xr + ov, top)}L${xc},${top - 1}Z`, sh(cr, .12));
      let cb = ''; for (let x = xc - 5; x > xl; x -= 7 * Math.cos(a) + 1) cb += `M${f(x)},${f(L(x, top + hb) + .8)}v3.4`; for (let x = xc + 4; x < xr; x += 7 * Math.sin(a) + 1) cb += `M${f(x)},${f(Rr(x, top + hb) + .8)}v3.4`;
      kdeco(`<path d="${cb}" stroke="#000" stroke-opacity=".4" stroke-width="2"/>`);
      const sl = (o.mw || 12) * Math.cos(a), gl = (o.gw || 8) * Math.cos(a), sr = (o.mw || 12) * Math.sin(a), gr = (o.gw || 8) * Math.sin(a);
      const mer = (x0: number, x1: number, Y: Edge, solid?: number) => { let h = mh, j = 0; if (!solid && RK() < (o.brk ?? .14)) { h = mh * RK() * .5; j = (RK() - .5) * 3; } return `M${f(x0)},${f(Y(x0, top) + .5)}V${f(Y(x0, top - h) + j)}L${f(x1)},${f(Y(x1, top - h) - j)}V${f(Y(x1, top) + .5)}Z`; };
      let ml = mer(xc - sl * .55, xc, L, 1), mr = mer(xc, xc + sr * .55, Rr, 1);
      for (let x = xc - sl * .55 - gl; x > xl - ov + 2; x -= sl + gl) ml += mer(Math.max(xl - ov, x - sl), x, L);
      for (let x = xc + sr * .55 + gr; x < xr + ov - 2; x += sr + gr) mr += mer(x, Math.min(xr + ov, x + sr), Rr);
      kshape(ml, sh(cl, .07)); kshape(mr, sh(cr, .12));
    }
    return { L, R: Rr, xl, xr };
  }
  // A hall: its long wall toward us under a pitched roof of wet slate, buttressed, with tall windows between.
  function khall(x0: number, x1: number, top: number, base: number, T: any, rh: number, o: { hip?: number; lit?: number[] } = {}) {
    const hw = rh * .55, ra = x0 - 3, rb = x1 + 3, ta = x0 + hw, tb = x1 - hw, n = Math.round((x1 - x0) / 34);
    kshape(`M${x0},${base}V${top}H${x1}V${base}Z`, mix(T.f, T.d, .12));
    kshape(`M${ra},${top}L${ta},${top - rh}H${tb}L${rb},${top}Z`, T.rv);
    let s = ''; for (let x = ra + 8; x < rb - 4; x += 9) s += `M${x},${top}L${f(ta + (x - ra) / (rb - ra) * (tb - ta))},${top - rh}`;
    kdeco(`<path d="${s}" stroke="#000" stroke-opacity=".13" fill="none"/><path d="M${ta},${top - rh + .8}H${tb}" stroke="#fff" stroke-opacity=".07" stroke-width="1.6"/>` +
      ((o.hip ?? 1) > 0 ? `<path d="M${tb},${top - rh}L${rb},${top}H${f(tb - hw * .5)}Z" fill="#000" opacity=".26"/>` : `<path d="M${ta},${top - rh}L${ra},${top}H${f(ta + hw * .5)}Z" fill="#fff" opacity=".1"/>`) +
      `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="18" fill="url(#ts-kao)"/><path d="M${ra},${top + .8}H${rb}" stroke="#000" stroke-opacity=".5" stroke-width="1.8"/>`);
    let c = ''; for (let y = top + 26; y < base; y += 15) c += `M${x0},${y}H${x1}`;
    kdeco(`<path d="${c}" stroke="#000" stroke-opacity=".1" fill="none"/>`);
    for (let i = 0; i < n; i++) { const cx = x0 + (i + .5) * (x1 - x0) / n, bx = x0 + i * (x1 - x0) / n - 3;
      kwin(cx - 2.6, top + 28, 5.2, 20, (o.lit || []).includes(i) ? .9 : 0);
      if (i) { kshadow(bx + 8.5, top + 16, 11, base - top - 16, .8); kdeco(`<path d="M${f(bx)},${base}V${top + 18}l6,-6V${base}Z" fill="${mix(T.f, T.l, .55)}"/><rect x="${f(bx + 6)}" y="${top + 12}" width="2.5" height="${base - top - 12}" fill="${T.d}"/>`); } }
  }
  // A length of curtain between two towers, its wall walk running from (x0, y0) to (x1, y1).
  function kcurt(x0: number, y0: number, x1: number, y1: number, base: number, T: any, o: Num = {}) {
    const col = mix(T.f, T.d, .2), Y = (x: number) => y0 + (y1 - y0) * (x - x0) / (x1 - x0), mh = o.mh ?? 9;
    kshape(`M${x0},${base}V${y0}L${x1},${y1}V${base}Z`, col);
    let m = ''; for (let x = x0 + 3; x < x1 - 9; x += 15) { if (RK() < .16) continue; m += `M${x},${f(Y(x) + .5)}V${f(Y(x) - mh)}L${x + 9},${f(Y(x + 9) - mh)}V${f(Y(x + 9) + .5)}Z`; }
    kshape(m, sh(col, .08));
    let c = ''; for (let t = .1; y0 + (VPY - y0) * t < base; t += .085) c += `M${x0},${f(y0 + (VPY - y0) * t)}L${x1},${f(y1 + (VPY - y1) * t)}`;
    kdeco(`<path d="M${x0},${y0}L${x1},${y1}V${y1 + 20}L${x0},${y0 + 20}Z" fill="url(#ts-kao)"/><path d="${c}" stroke="#000" stroke-opacity=".11" fill="none"/>`);
  }
  const T6 = KT(.95), T5 = KT(.6), T4 = KT(.45), T3 = KT(.3), T2 = KT(.17), T1 = KT(.07), T0 = KT(0);

  // Furthest: the rear towers on the ridge, half lost in the weather.
  KP = kPlane(); const KC = KP;
  kround(1052, 28, 150, 580, T6, { cone: 84 }); kwin(1050, 204, 3.4, 9, .6);
  kbox(742, 44, 44, 40, 226, 580, T6, { mh: 10, mw: 9, gw: 7, hb: 6, ov: 2 });
  kround(1470, 18, 350, 560, T6, { cone: 46 });
  kbox(262, 30, 32, 44, 384, 560, T6, { ruin: 38 });

  // Behind: the crag, the outer bastions and their curtains, and the tall towers of the inner ward.
  KP = kPlane(); const KB = KP;
  kshape('M236,640L290,594 350,566 430,546 520,528 620,514 720,506 1090,506 1200,512 1300,530 1384,552 1456,574 1510,600 1560,640Z', '#343745');
  kdeco('<path d="M290,594L350,566 430,546 452,640H262Z M1090,506L1200,512 1180,640H1070Z" fill="#fff" opacity=".05"/><path d="M1300,530L1384,552 1456,574 1510,600 1560,640H1330Z" fill="#000" opacity=".22"/>');
  kround(318, 20, 400, 640, T5, { cone: 44 });
  kbox(396, 66, 62, 42, 412, 640, T5, { mh: 9, mw: 10, gw: 7, hb: 6, ov: 2 });
  kround(1480, 20, 404, 640, T5, { cone: 42 });
  kbox(1400, 60, 70, 48, 416, 640, T5, { mh: 9, mw: 10, gw: 7, hb: 6, ov: 2 });
  kround(706, 23, 196, 640, T4, { cone: 84 }); kslit(700, 252); kslit(712, 304); kwin(703, 222, 4, 11, .8);
  kround(1104, 26, 178, 640, T4, { mh: 12 }); kslit(1098, 232); kslit(1110, 290);
  kcurt(436, 456, 610, 430, 640, T4);
  kcurt(1196, 424, 1362, 450, 640, T4);
  kround(490, 40, 316, 640, T3, { cone: 98, e: 6 }); kslit(473, 372, 12); kwin(499, 418, 5, 13, .9); kslit(481, 476, 12);
  kshadow(530, 446, 30, 194);
  kround(1296, 31, 296, 640, T3, { cone: 90 }); kwin(1289.5, 346, 4.6, 12, .9); kslit(1305, 418);
  kshadow(1327, 448, 26, 192);

  // In front: the halls, the square towers at their ends (the right one burnt out and broken), and the great tower
  // corner-on between them, a turret hung on each of its outer corners.
  KP = kPlane(); const KA = KP;
  khall(630, 800, 342, 640, T2, 30, { hip: 1, lit: [0] });
  kbox(596, 62, 56, 38, 256, 640, T1, { mh: 13, mw: 12, gw: 8, hb: 9 }); kslit(566, 326, 13); kslit(580, 398, 13); kwin(570.5, 474, 4.6, 12, .85); kslit(612, 352, 13);
  kshadow(630.5, 346, 26, 294);
  khall(1004, 1140, 328, 640, T2, 26, { hip: -1, lit: [2] });
  kbox(1180, 64, 58, 50, 246, 640, T1, { ruin: 88 }); kslit(1156, 372, 13); kslit(1166, 446, 13);
  { const D = kbox(900, 150, 150, 45, 214, 640, T0, { mh: 17, mw: 15, gw: 10, hb: 11, course: 17, ov: 4 }), sc = (y: number) => `M${f(D.xl)},${f(D.L(D.xl, y))}L900,${y}L${f(D.xr)},${f(D.R(D.xr, y))}`;
    kdeco(`<path d="${sc(372)}" stroke="#fff" stroke-opacity=".13" stroke-width="2.6" fill="none"/><path d="${sc(375)}" stroke="#000" stroke-opacity=".3" stroke-width="2.6" fill="none"/>`);
    for (const x of [826, 858, 942, 974]) kwin(x - 2.6, (x < 900 ? D.L(x, 292) : D.R(x, 292)), 5.2, 24, x === 858 ? .9 : 0);
    for (const x of [842, 958]) kwin(x - 2.6, (x < 900 ? D.L(x, 420) : D.R(x, 420)), 5.2, 20, x === 958 ? .7 : 0);
    kshadow(1006, 330, 34, 310);
    kshadow(D.xl + 21, 252, 20, 82, .9);
    for (const bx of [D.xl, D.xr]) { kround(Math.round(bx), 21, 176, 300, T0, { cone: 78, corbel: 34 }); kwin(bx - 2.2, 214, 4.4, 12, 1); kslit(bx + 7, 256, 10); } }

  for (const [id, P, mist, grain] of [['keepC', KC, 1, 0], ['keepB', KB, .85, 1], ['keepA', KA, .55, 1]] as [string, KPlane, number, number][]) {
    const box = 'x="220" y="30" width="1360" height="630"', clip = `clip-path="url(#ts-${id}c)"`;
    $(id + 'Lit').innerHTML = `<defs><clipPath id="ts-${id}c">${P.sil.map((d) => `<path d="${d}"/>`).join('')}</clipPath></defs>${P.lit.join('')}${grain ? `<rect ${box} filter="url(#ts-stk)" ${clip} style="mix-blend-mode:multiply"/>` : ''}`;
    const sil = P.sil.map((d) => `<path d="${d}"/>`).join('');
    $(id + 'Night').innerHTML = `<g fill="none" stroke="#0a0c17" stroke-width="1.6" stroke-linejoin="round">${sil}</g><g fill="url(#ts-ktint)">${sil}</g>`;      // a hair wider than the stone, so no pale fringe outlines it
    $(id + 'Top').innerHTML = `<rect ${box} fill="url(#ts-kmist)" ${clip} opacity="${mist}"/>${P.top.join('')}`;
  }
  for (let i = 0; i < 48; i++) R();      // the numbers the old Keep drew, so the wall below is dealt the same hand as before

  // ---- the curtain wall, the gatehouse, and the yard in front of them
  PL = mkPlane(); const WALL = PL;
  const FIRES: any[] = [{ x: 420, y: 760, k: 1 }, { x: 1380, y: 760, k: 1 }, { x: 742, y: 738, k: .62 }, { x: 1058, y: 738, k: .62 }];
  const BR = [612, 700];      // where the wall is breached
  const wallD = `M-40,${WB}V${WT}H${BR[0]}L622,586 636,582 648,618 668,628 676,652 690,640 696,598 ${BR[1]},${WT}H${W + 40}V${WB}Z`;
  shape(wallD, 'url(#ts-wallg)', TW.f[1]);
  // Merlons, each showing a sliver of the side that faces the middle of the yard.
  for (let x = -34; x < W + 40; x += 58) {
    if (x + 34 > BR[0] - 6 && x < BR[1] + 6) continue;
    let h = 26, s = 0; if (R() < .2) { h = 6 + R() * 12; s = (R() - .5) * 8; }
    const sl = clamp((VPX - (x + 17)) / 150, -5, 5);
    if (sl > .6) shape(`M${x + 34},${f(WT - h - s)}l${f(sl)},${f(sl * .5)}V${WT}H${x + 34}Z`, TW.s[0], TW.s[1]);
    if (sl < -.6) shape(`M${x},${f(WT - h + s)}l${f(sl)},${f(-sl * .5)}V${WT}H${x}Z`, TW.l[0], TW.l[1]);
    shape(`M${x},${WT}V${f(WT - h + s)}L${x + 34},${f(WT - h - s)}V${WT}Z`, '#645e68', TW.f[1]);
  }
  // Ashlar: every block its own shade.
  { let ms = '', jt = '';
    for (let y = WT + 4, row = 0; y < WB - 20; y += 25, row++) { jt += `M-40,${y}H${W + 40}`;
      for (let x = -40 - (row % 2) * 30; x < W + 40;) { const bw = 44 + R() * 48, v = R(); ms += `<rect x="${f(x)}" y="${y}" width="${f(bw)}" height="25" fill="${v < .5 ? '#000' : '#fff'}" opacity="${f2(Math.abs(v - .5) * (v < .5 ? .36 : .14))}"/>`; x += bw; jt += `M${f(x)},${y}v25`; } }
    deco(`<g clip-path="url(#ts-wbody)">${ms}<path d="${jt}" stroke="#0c0a10" stroke-opacity=".42" stroke-width="1.4" fill="none"/></g>`); }
  shape(`M-40,${WB}V${WB - 22}H${W + 40}V${WB}Z`, '#676069', TW.f[1]);
  deco(`<path d="M-40,${WB - 22}H${W + 40}" stroke="#fff" stroke-opacity=".12"/><path d="M-40,${WB - 3}H${W + 40}" stroke="#000" stroke-opacity=".5" stroke-width="5"/>`);
  for (const x of [150, 366, 512, 1262, 1408, 1624]) {
    shape(`M${x},${WB}V616L${x + 13},600V${WB}Z`, TW.l[0], sh(TW.f[1], .2)); shape(`M${x + 13},${WB}V600L${x + 26},616V${WB}Z`, TW.s[0], TW.s[1]);
    deco(`<path d="M${x + 26},616l16,14V${WB}h-16Z" fill="#000" opacity=".22"/>`);
  }
  round(40, 70, 524, WB, TW, { mh: 20, course: 25 }); round(1760, 70, 524, WB, TW, { mh: 20, course: 25 });
  round(800, 54, 458, WB, TW, { mh: 20, course: 25 }); round(1000, 54, 458, WB, TW, { mh: 20, course: 25 });
  slit(798.8, 520, 16); slit(998.8, 520, 16); slit(784, 610, 14); slit(1014, 610, 14);
  box(854, 92, 500, WB, TW, { mh: 18, mw: 14, gw: 10, course: 25 });
  // The gate: a deep arch, a light somewhere inside it, and the portcullis half down.
  shape('M862,744V660Q862,618 900,606Q938,618 938,660V744Z', '#040405', '#020203', false);
  shape('M862,744V660Q862,618 900,606L900,613Q873,625 873,663V744Z', '#2c2a31', '#060608', false);
  both(`<ellipse cx="902" cy="728" rx="30" ry="20" fill="url(#ts-wglow)" opacity=".6"/><path d="M878,618V690l5,9 5,-9V612M893,609V690l5,9 5,-9V607M909,608V690l5,9 5,-9V612M924,614V690l5,9 5,-9V622M873,640H938M873,668H938" stroke="#0b0a0d" stroke-width="3" fill="none" stroke-linejoin="round"/>`);
  // The yard: flagstones in perspective, standing water, and what the fighting left.
  shape(`M-40,${WB}H${W + 40}V${H + 40}H-40Z`, 'url(#ts-gndg)', '#060608', false);
  { let gj = ''; const rows = [WB]; for (let i = 1; i <= 9; i++) rows.push(WB + (H + 40 - WB) * Math.pow(i / 9, 1.7));
    rows.forEach((y, i) => { if (i) gj += `M-40,${f(y)}H${W + 40}`; if (i < 9) { const y2 = rows[i + 1]; for (let k = -17; k <= 17; k++) { const xb = VPX + (k + (i % 2) * .5) * 150; gj += `M${f(VPX + (xb - VPX) * (y - VPY) / 200)},${f(y)}L${f(VPX + (xb - VPX) * (y2 - VPY) / 200)},${f(y2)}`; } } });
    deco(`<path d="${gj}" stroke="#0d0b10" stroke-opacity=".6" stroke-width="1.4" fill="none"/>`); }
  const PUDDLES = [[620, 806, 70, 7], [1150, 800, 90, 8], [900, 846, 120, 11], [300, 862, 100, 10], [1520, 854, 110, 10], [770, 774, 40, 3.5], [1040, 780, 46, 4]];
  for (const [x, y, rx, ry] of PUDDLES) { PL.lit.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#93a8dc" opacity=".5"/>`); PL.night.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#0c0f1e"/><ellipse cx="${x}" cy="${f(y - ry * .15)}" rx="${f(rx * .72)}" ry="${f(ry * .5)}" fill="#1a2140"/>`); }
  // The braziers' iron.
  for (const { x, y, k } of FIRES) { const b = y + 52 * k;
    both(`<ellipse cx="${x}" cy="${f(b + 2)}" rx="${f(40 * k)}" ry="${f(5 * k)}" fill="#000" opacity=".5"/><path d="M${f(x - 24 * k)},${f(b)}L${f(x - 8 * k)},${f(y + 6 * k)}M${f(x + 24 * k)},${f(b)}L${f(x + 8 * k)},${f(y + 6 * k)}M${x},${f(b)}V${f(y + 8 * k)}" stroke="#120d0b" stroke-width="${f(4.6 * k)}" stroke-linecap="round"/><path d="M${f(x - 34 * k)},${y}Q${x},${f(y + 34 * k)} ${f(x + 34 * k)},${y}Z" fill="#150f0d" stroke="#4a3526" stroke-width="${f(1.8 * k)}"/><ellipse cx="${x}" cy="${y}" rx="${f(30 * k)}" ry="${f(4.5 * k)}" fill="#5a1a08"/>`); }

  // ================================================================= blood
  // Drawn as plain shapes, then run through a filter: rough edges, drops close together pulling into one, a body
  // that is darker where it lies thin, and a wet shine on the side the light comes from. Older blood is a stain
  // soaked into the stone (it multiplies with the texture under it). All of it is masked to the wall's own faces,
  // so nothing hangs in the breach, over the gate, above the battlements or out across the yard.
  const BL: string[] = [], ST: string[] = [], MIST: string[] = [], RB = R;
  const bel = (x: number, y: number, rx: number, ry: number, rot?: number) => BL.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}"${rot ? ` transform="rotate(${f(rot)} ${f(x)} ${f(y)})"` : ''}/>`);
  // A run: gravity takes it down, it wanders a little at each joint in the stone, thins, and ends in a bead.
  function run(x: number, y: number, len: number, w: number) {
    const pts = [[x, y, w]]; let px = x, py = y;
    while (py < y + len) { py = Math.min(y + len, py + 9 + RB() * 16); px += (RB() - .5) * 2.6; pts.push([px, py, Math.max(1.7, w * (1 - (py - y) / len * .62) * (.7 + RB() * .55))]); }
    BL.push(`<path d="M${pts.map((p) => `${f(p[0] + p[2] / 2)},${f(p[1])}`).join('L')}L${pts.slice().reverse().map((p) => `${f(p[0] - p[2] / 2)},${f(p[1])}`).join('L')}Z"/>`);
    const e = pts[pts.length - 1]; bel(e[0], e[1] + e[2] * .3, e[2] * .6 + .8, e[2] * .9 + 1.2);
    if (RB() < .5) bel(e[0] + (RB() - .5) * 2, e[1] + 9 + RB() * 16, 1.5 + RB() * .8, 2 + RB() * 1.4);      // a bead that fell on ahead
  }
  // An impact: a lobed wet heart, and drops flung out from it, longer the further they flew. fy flattens it onto the ground.
  function spatter(cx: number, cy: number, n: number, spread: number, core: number, fy = 1, floor = WB) {
    for (let i = 0; i < 9; i++) { const a = RB() * 6.283, q = RB() * core * .75; bel(cx + Math.cos(a) * q, cy + Math.sin(a) * q * .8 * fy, core * (.32 + RB() * .34), core * (.26 + RB() * .3) * fy, fy === 1 ? RB() * 180 : 0); }
    ST.push(`<ellipse cx="${f(cx)}" cy="${f(cy + core * .5 * fy)}" rx="${f(core * 2.3)}" ry="${f(core * 1.9 * fy)}"/>`);
    for (let i = 0; i < n * 1.6; i++) {
      const a = RB() * 6.283, q = Math.pow(RB(), 1.5), dist = core * .7 + q * spread, s = Math.max(1.2, core * .2 * (1 - q) * (.4 + RB()) + .8), lng = 1 + q * 2.8 * RB(), x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist * .85 * fy;
      bel(x, y, s * lng, s * .62 * fy, fy === 1 ? a * 57.3 : 0);
      if (lng > 1.8 && fy === 1) bel(x + Math.cos(a) * s * lng * 1.6, y + Math.sin(a) * s * lng * 1.4, s * .5, s * .34, a * 57.3);
      if (fy === 1 && s > 2.2 && RB() < .5) run(x, y, 14 + RB() * 80, s * .95);
    }
    // The finest of it: a mist of specks out past everything else.
    for (let i = 0; i < n * 2.2; i++) { const a = RB() * 6.283, dist = core + Math.pow(RB(), .8) * spread * 1.25; MIST.push(`<circle cx="${f(cx + Math.cos(a) * dist)}" cy="${f(cy + Math.sin(a) * dist * .85 * fy)}" r="${f(.5 + RB() * .9)}"/>`); }
    if (fy === 1) for (let i = 0; i < 3; i++) run(cx + (RB() - .5) * core * 1.2, cy + core * .3, 30 + RB() * Math.max(10, floor - cy - 30), core * (.16 + RB() * .16));
  }
  // Cast off a blade: a line of long drops along the swing.
  function castoff(x0: number, y0: number, x1: number, y1: number, bend: number, n: number, s0: number) {
    for (let i = 0; i < n; i++) { const t = i / (n - 1), u = 1 - t, mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - bend, x = u * u * x0 + 2 * u * t * mx + t * t * x1 + (RB() - .5) * 4, y = u * u * y0 + 2 * u * t * my + t * t * y1 + (RB() - .5) * 4,
      ang = Math.atan2(2 * u * (my - y0) + 2 * t * (y1 - my), 2 * u * (mx - x0) + 2 * t * (x1 - mx)) * 57.3, s = s0 * (1 - t * .65) * (.6 + RB() * .7);
      bel(x, y, s * 2.3, s * .7, ang); if (s > 2.2 && RB() < .4) run(x, y, 14 + RB() * 60, s * .85); }
  }
  // Where something slid down the stone: broad, thin, and dry at the edges.
  function smear(x: number, y: number, len: number, w: number) {
    for (let i = 0; i < 4; i++) { const ox = (i - 1.5) * w * .32 + (RB() - .5) * 2, l = len * (.6 + RB() * .5);
      ST.push(`<path d="M${f(x + ox)},${f(y + RB() * 8)}q${f((RB() - .5) * 8)},${f(l * .5)} ${f((RB() - .5) * 10)},${f(l)}" stroke-width="${f(w * (.22 + RB() * .14))}" fill="none" stroke-linecap="round" opacity="${f2(.45 + RB() * .35)}"/>`); }
  }
  // Left of the gate.
  spatter(322, 672, 42, 110, 15); castoff(196, 668, 300, 626, 26, 12, 3.2); smear(462, 640, 84, 26);
  spatter(520, 700, 24, 74, 10); spatter(650, 676, 30, 82, 11);
  [366, 512, 648, 668].forEach((x) => run(x + R() * 8, WT + 2 + R() * 6, 60 + R() * 120, 3 + R() * 3));
  // Right of the gate.
  spatter(1476, 680, 40, 106, 14); spatter(1296, 696, 26, 76, 10); smear(1342, 646, 78, 24); castoff(1150, 640, 1262, 612, 30, 13, 3.1); spatter(1158, 690, 22, 64, 9);
  [1160, 1284, 1300, 1432].forEach((x) => run(x + R() * 8, WT + 2 + R() * 6, 60 + R() * 120, 3 + R() * 3));
  // The gate towers (this is what a phone sees).
  spatter(826, 700, 22, 56, 9); spatter(1006, 688, 18, 50, 8); run(790, 480, 110, 4); run(1012, 478, 80, 3.4); run(1030, 484, 130, 4.4);

  $('wallLit').innerHTML = `<defs><clipPath id="ts-wclip">${WALL.clip.map((d) => `<path d="${d}"/>`).join('')}</clipPath><clipPath id="ts-wbody"><path d="${wallD}"/></clipPath>
      <mask id="ts-bmask" maskUnits="userSpaceOnUse" x="-40" y="380" width="${W + 80}" height="${WB - 380}"><g fill="#fff">${WALL.clip.map((d) => `<path d="${d}"/>`).join('')}</g><path d="M862,744V660Q862,618 900,606Q938,618 938,660V744Z" fill="#000"/></mask></defs>${WALL.lit.join('')}
    <rect x="-40" y="380" width="${W + 80}" height="380" filter="url(#ts-stw)" clip-path="url(#ts-wclip)" style="mix-blend-mode:multiply"/>
    ${FIRES.map((F) => `<circle cx="${F.x}" cy="${F.y - 10}" r="${f(330 * F.k)}" fill="url(#ts-warm)" style="mix-blend-mode:overlay"/>`).join('')}
    <g mask="url(#ts-bmask)" fill="#6a1a18" stroke="#6a1a18" filter="url(#ts-stain)" style="mix-blend-mode:multiply" opacity=".62">${ST.join('')}</g>
    <g mask="url(#ts-bmask)" fill="#7a1512" style="mix-blend-mode:multiply" opacity=".9">${MIST.join('')}</g>
    <g mask="url(#ts-bmask)" filter="url(#ts-blood)" style="mix-blend-mode:multiply">${BL.join('')}</g><g mask="url(#ts-bmask)" filter="url(#ts-bloodS)" style="mix-blend-mode:screen" opacity=".5">${BL.join('')}</g>${WALL.top.join('')}`;
  // The braziers cut holes in the night.
  $('wallNight').innerHTML = `<defs><mask id="ts-tm" maskUnits="userSpaceOnUse" x="-40" y="0" width="${W + 80}" height="${H + 40}"><rect x="-40" width="${W + 80}" height="${H + 40}" fill="#fff"/>${FIRES.map((F) => `<circle cx="${F.x}" cy="${F.y - 6}" r="${f(320 * F.k)}" fill="url(#ts-hole)"/>`).join('')}</mask></defs><g mask="url(#ts-tm)">${WALL.night.join('')}</g>${WALL.top.join('')}`;

  $('gdefs').innerHTML = cylDef('wc0', TW.f[0]) + cylDef('wc1', TW.f[1]) + KDEFS.join('') + `
    <linearGradient id="ts-kao" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".46"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="ts-kfl"><stop offset="0" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="ts-kfr"><stop offset="0" stop-color="#000" stop-opacity=".26"/><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".06"/></linearGradient>
    <linearGradient id="ts-ksh"><stop offset="0" stop-color="#000" stop-opacity=".36"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="ts-krim"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="ts-ktint" gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="640"><stop offset="0" stop-color="#2f3654"/><stop offset="1" stop-color="#3d4566"/></linearGradient>
    <linearGradient id="ts-kmist" gradientUnits="userSpaceOnUse" x1="0" y1="400" x2="0" y2="640"><stop offset="0" stop-color="#2c324e" stop-opacity="0"/><stop offset="1" stop-color="#2c324e"/></linearGradient>
    <linearGradient id="ts-wallg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#625c66"/><stop offset="1" stop-color="#3c373f"/></linearGradient>
    <linearGradient id="ts-gndg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a2830"/><stop offset="1" stop-color="#4b4a59"/></linearGradient>
    <linearGradient id="ts-hazeR" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5a1c22" stop-opacity="0"/><stop offset="1" stop-color="#5a1c22" stop-opacity=".42"/></linearGradient>
    <linearGradient id="ts-hazeB" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a4470" stop-opacity="0"/><stop offset="1" stop-color="#3a4470" stop-opacity=".34"/></linearGradient>
    <linearGradient id="ts-frg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0d0b0e"/><stop offset="1" stop-color="#050405"/></linearGradient>
    <radialGradient id="ts-wglow"><stop offset="0" stop-color="#ffb65c" stop-opacity=".55"/><stop offset="1" stop-color="#ffb65c" stop-opacity="0"/></radialGradient>
    <radialGradient id="ts-warm"><stop offset="0" stop-color="#ff9a48" stop-opacity=".95"/><stop offset=".45" stop-color="#ff7a30" stop-opacity=".5"/><stop offset="1" stop-color="#ff7a30" stop-opacity="0"/></radialGradient>
    <radialGradient id="ts-hole"><stop offset="0" stop-color="#000"/><stop offset=".4" stop-color="#000" stop-opacity=".84"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <filter id="ts-stw" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".03 .045" numOctaves="5" seed="21"/><feDiffuseLighting surfaceScale="2.6" diffuseConstant="1.12" lighting-color="#fff"><feDistantLight azimuth="235" elevation="56"/></feDiffuseLighting></filter>
    <filter id="ts-stk" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".06 .08" numOctaves="4" seed="8"/><feDiffuseLighting surfaceScale="1.5" diffuseConstant="1.12" lighting-color="#fff" result="g"><feDistantLight azimuth="235" elevation="56"/></feDiffuseLighting>
      <feTurbulence type="fractalNoise" baseFrequency=".034 .0024" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.3 0 0 0 -.56" result="w"/><feComposite in="w" in2="g" operator="over"/></filter>
    <filter id="ts-stain" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="12" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="1.8"/></filter>
    <filter id="ts-blood" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".075" numOctaves="3" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="1" result="b"/>
      <feColorMatrix in="b" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 12 -4.3" result="goo"/>
      <feGaussianBlur in="goo" stdDeviation="2.4" result="h"/>
      <feColorMatrix in="h" values="0 0 0 -.26 .88  0 0 0 -.2 .25  0 0 0 -.15 .21  0 0 0 0 1" result="col"/>
      <feComposite in="col" in2="goo" operator="in"/>
    </filter>
    <filter id="ts-bloodS" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".075" numOctaves="3" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="1" result="b"/>
      <feColorMatrix in="b" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 12 -4.3" result="goo"/>
      <feGaussianBlur in="goo" stdDeviation="1.8" result="h"/>
      <feSpecularLighting in="h" surfaceScale="3.2" specularConstant=".7" specularExponent="36" lighting-color="#ffc09a" result="sp"><feDistantLight azimuth="240" elevation="50"/></feSpecularLighting>
      <feComposite in="sp" in2="goo" operator="in"/>
    </filter>`;
  $('sheet').style.background = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.034 .0022' numOctaves='3' seed='5' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .78  0 0 0 0 .83  0 0 0 0 1  0 0 0 2.4 -1.12'/></filter><rect width='600' height='600' filter='url(#f)'/></svg>`);
  $('grain').style.background = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='g' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='220' height='220' filter='url(#g)'/></svg>`);
  $('glows').innerHTML = FIRES.map(() => '<div class="ts-gl"></div><div class="ts-gl refl"></div>').join('');

  // ================================================================= banners
  // The seven Houses are the game's own. Three of the banners are bloodied, and Jupiter's pale cloth takes dark ink.
  const HOUSES = GAME_HOUSES.map((h, i) => ({ n: h.name, c: h.color, s: h.sigil, blood: i === 0 || i === 2 || i === 5, dark: i === 5 }));
  // A torn cloth, 120 wide, hanging from y = 26. `lo` is the height below which it may be holed.
  function cloth(L: number, type: string, r: () => number, lo: number) {
    const xl = 12, xr = 108, top = 26;
    const prof = (x: number) => { const u = (x - xl) / (xr - xl);
      if (type === 'diagL') return L * (.6 + .4 * u);
      if (type === 'diagR') return L * (1 - .4 * u);
      if (type === 'swallow') return L * (.7 + .3 * Math.abs(u - .5) * 2) * (u > .56 ? .84 : 1);
      if (type === 'shred') return L * (.72 + .28 * (Math.sin(u * 9 + 1) + 1) / 2);
      return L * (.88 + .12 * Math.sin(u * 7 + 1)); };
    let d = `M${xl},${top}L${xr},${top}`, y = top;
    const yr = prof(xr) - L * .05;
    while (y < yr - 16) { y = Math.min(y + 12 + r() * 24, yr - 6); if (r() < .22) { const k = 4 + r() * 11; d += `L${xr},${f(y - 4)}L${f(xr - k)},${f(y)}L${xr},${f(y + 3)}`; } else d += `L${f(xr + (r() - .5) * 2.4)},${f(y)}`; }
    for (let x = xr; x > xl; x -= 2.5 + r() * 6) { const tooth = r() < .5 ? r() * L * .09 : -r() * L * .05; d += `L${f(x)},${f(prof(x) + tooth - L * .05)}`; }
    y = prof(xl) - L * .05; d += `L${xl},${f(y)}`;
    while (y > top + 16) { y = Math.max(y - 12 - r() * 24, top + 6); if (r() < .22) { const k = 4 + r() * 11; d += `L${xl},${f(y + 4)}L${f(xl + k)},${f(y)}L${xl},${f(y - 3)}`; } else d += `L${f(xl + (r() - .5) * 2.4)},${f(y)}`; }
    d += 'Z';
    // Holes and long rips (cut out with the even-odd rule), kept clear of the sigil.
    for (let i = 0; i < 4; i++) { const cx = 26 + r() * 68, hi = prof(cx) - L * .2, rad = 3 + r() * 6; if (hi - lo < 14) continue; const cy = lo + r() * (hi - lo); let h = '';
      for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, rr = rad * (.55 + r() * .8); h += `${k ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr * 1.5)}`; } d += h + 'Z'; }
    for (let i = 0, n = type === 'shred' ? 5 : 2; i < n; i++) { const x = 22 + r() * 76, yb = prof(x) - L * .12, up = Math.min(40 + r() * L * .3, yb - lo); if (up < 14) continue; d += `M${f(x - 2.2)},${f(yb)}L${f(x + (r() - .5) * 4)},${f(yb - up)}L${f(x + 2.2)},${f(yb)}Z`; }
    return d;
  }
  // The rod and the cloth on it. haze fades a distant cloth toward the mist; warm lays firelight on its foot.
  function clothArt(h: (typeof HOUSES)[number], uid: number, L: number, type: string, o: Num = {}) {
    const r = rng(77 + uid * 131), stub = type === 'stub', my = o.my || (stub ? 70 : 98), mr = o.mr || (stub ? 23 : 25), VH = Math.round(L * 1.06 + 12), d = cloth(L, type, r, stub ? 9999 : my + (o.name ? 62 : mr + 12));
    const ink = h.dark ? '#1c2233' : '#f3e6c4', trim = h.dark ? '#394055' : '#e9cf8f', hz = o.haze || 0;
    let spots = '';
    if (h.blood && !stub) { const bx = 34 + r() * 50, by = my + mr + 26 + r() * L * .18; for (let k = 0; k < 16; k++) { const a = r() * 6.283, q = Math.pow(r(), 1.6) * 28, rad = 1 + r() * 5.5 * (1 - q / 32); spots += `<ellipse cx="${f(bx + Math.cos(a) * q)}" cy="${f(by + Math.sin(a) * q)}" rx="${f(rad)}" ry="${f(rad * (1 + r()))}"/>`; } spots += `<path d="M${f(bx)},${f(by)}v${f(30 + r() * 50)}" stroke="#5c080c" stroke-width="3.4" stroke-linecap="round"/>`; }
    return { VH, svg: `<defs>
        <linearGradient id="ts-bg${uid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${mix(h.c, '#000000', .2)}"/><stop offset=".5" stop-color="${mix(h.c, '#000000', .42)}"/><stop offset="1" stop-color="${mix(h.c, '#000000', .74)}"/></linearGradient>
        <clipPath id="ts-bc${uid}"><path d="${d}" clip-rule="evenodd"/></clipPath>
      </defs>
      <rect x="3" y="19" width="114" height="8" rx="4" fill="${mix('#3a2a1c', '#12152a', hz)}" stroke="#120c08"/><circle cx="4" cy="23" r="5.5" fill="${mix('#6b5226', '#12152a', hz)}"/><circle cx="116" cy="23" r="5.5" fill="${mix('#6b5226', '#12152a', hz)}"/>
      <g clip-path="url(#ts-bc${uid})">
        <rect width="120" height="${VH}" fill="url(#ts-bg${uid})"/>
        <rect x="12" y="26" width="96" height="9" fill="${trim}" opacity=".55"/>
        <path d="M19.5,26V${VH}M100.5,26V${VH}" stroke="${trim}" stroke-width="1.6" opacity=".5"/>
        <circle cx="60" cy="${my}" r="${mr}" fill="${mix(h.c, '#000000', h.dark ? .12 : .62)}" stroke="${trim}" stroke-width="2"/>
        <text x="60" y="${my + 13}" font-size="${stub ? 34 : 37}" text-anchor="middle" fill="${ink}" font-family="'Segoe UI Symbol','Noto Sans Symbols 2','Apple Symbols',serif">${h.s}</text>
        ${o.name ? `<text x="61.5" y="${my + 49}" font-size="10.5" letter-spacing="3" text-anchor="middle" fill="${ink}" opacity=".85" font-family="Cinzel,serif" font-weight="700">${h.n.toUpperCase()}</text>` : ''}
        <g fill="#5c080c" opacity=".9">${spots}</g>
        <rect width="120" height="${VH}" fill="url(#ts-folds)"/>
        <rect width="120" height="${VH}" fill="url(#ts-grime)"/>
        ${o.warm ? `<rect width="120" height="${VH}" fill="url(#ts-warmUp)" opacity="${o.warm}"/>` : ''}
        ${hz ? `<rect width="120" height="${VH}" fill="#12152a" opacity="${hz}"/>` : ''}
      </g>
      <path d="${d}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="1.1"/>` };
  }
  // The approach: three standards a side, Roman vexilla on leaning poles, nearest first.
  const STD: any[] = STD_SPEC.map((s) => ({ ...s }));
  $('standards').innerHTML = STD.map((s, i) => {
    const h = HOUSES[s.h], art = clothArt(h, 10 + i, s.L, s.t, { name: 1, haze: s.haze, warm: s.warm }), pole = mix('#241a13', '#12152a', s.haze), gold = mix('#8a6a2c', '#12152a', s.haze);
    return `<div class="ts-std">
      <svg viewBox="0 0 120 540"><ellipse cx="60" cy="538" rx="30" ry="5" fill="#000" opacity=".55"/><path d="M60,12V540" stroke="${pole}" stroke-width="5.5" stroke-linecap="round"/><path d="M58.4,14V540" stroke="#fff" stroke-opacity=".1" stroke-width="1.2"/><path d="M60,0l5.5,13-5.5,7-5.5,-7Z" fill="${gold}"/><circle cx="60" cy="26" r="6.5" fill="none" stroke="${gold}" stroke-width="2.6"/></svg>
      <div class="ts-cl"><svg viewBox="0 0 120 540"><g transform="translate(0,15)">${art.svg}</g></svg></div></div>`;
  }).join('');
  STD.forEach((s, i) => { s.el = $('standards').children[i]; });
  // Hung from the lintel. Mars is torn off short.
  const HANG: any[] = [{ h: 0, L: 196, t: 'diagR' }, { h: 1, L: 214, t: 'shred' }, { h: 2, L: 180, t: 'swallow' }, { h: 3, L: 128, t: 'stub' }, { h: 4, L: 188, t: 'diagL' }, { h: 5, L: 210, t: 'swallow' }, { h: 6, L: 192, t: 'shred' }];
  $('hang').innerHTML = HANG.map((b, i) => { const h = HOUSES[b.h], art = clothArt(h, i, b.L, b.t, { my: b.t === 'stub' ? 70 : 78, mr: 23 }); b.VH = art.VH;
    return `<div class="ts-bn${b.t === 'stub' ? ' c' : ''}"><svg viewBox="0 0 120 ${art.VH}"><path d="M30,-30L24,22M90,-30L96,22" stroke="#2a2118" stroke-width="2.4"/>${art.svg}</svg></div>`; }).join('');
  HANG.forEach((b, i) => { b.el = $('hang').children[i]; });
  // Every cloth the wind moves, and where across the screen it hangs (set by layout).
  const CLOTHS: any[] = STD.map((s) => ({ o: s, el: s.el.querySelector('.ts-cl') })).concat(HANG.map((b) => ({ o: b, el: b.el })));
  CLOTHS.forEach((c, i) => { c.ph = i * 2.4; });

  // ================================================================= layout
  let vw = 0, vh = 0, S = 1, OX = 0, OY = 0, jamb = 40, lintel = 34, mode = 'avenue', FD = 1;
  const PLANES = [...stage.querySelectorAll<HTMLElement>('.ts-plane')].map((el) => ({ el, d: +el.dataset.d!, rot: '' })).concat(STD.map((s) => ({ el: s.el, d: s.d, rot: ` rotate(${s.lean}deg)` })));
  const GL = [...$('glows').children] as HTMLElement[], fx = $<HTMLCanvasElement>('fx'), fg = fx.getContext('2d')!, nearC = $<HTMLCanvasElement>('near'), ng = nearC.getContext('2d')!, sheets = stage.querySelector<HTMLElement>('.ts-sheets')!;
  // The gate arch we stand under: a broken lintel and two jambs.
  function buildFrame() {
    const w = vw + 2 * PAD, h = vh + 2 * PAD, J = jamb + PAD, Lt = lintel + PAD, r = rng(4242);
    let d = `M${J},${h}`;
    for (let y = h - 30; y > Lt + 46; y -= 46) d += `L${f(J + (r() - .5) * 7)},${y}`;
    d += `L${J + 3},${Lt + 26}L${J + 20},${Lt + 4}`;
    const span = w - 2 * J - 40, n = Math.max(3, Math.round(span / 58)), st = span / n;
    for (let i = 0; i < n; i++) { const yy = f(Lt + (r() - .5) * 7), x = J + 20 + i * st; d += `L${f(x)},${yy}L${f(x + st)},${yy}`; }
    d += `L${w - J - 3},${Lt + 26}`;
    for (let y = Lt + 46; y < h - 30; y += 46) d += `L${f(w - J + (r() - .5) * 7)},${y}`;
    d += `L${w - J},${h}`;
    let j = ''; for (let y = Lt + 30; y < h; y += 46) j += `M0,${y}H${J + 4}M${w - J - 4},${y}H${w}`; for (let x = J + 60; x < w - J; x += 116) j += `M${x},0V${Lt - 2}`;
    $('frame').setAttribute('viewBox', `0 0 ${w} ${h}`);
    $('frame').innerHTML = `<path d="M0,0H${w}V${h}H0Z${d}Z" fill-rule="evenodd" fill="url(#ts-frg)"/><path d="${j}" stroke="#000" stroke-opacity=".6" stroke-width="1.5" fill="none"/><path d="${d}" fill="none" stroke="#1f1c22" stroke-width="1.5"/><path id="ts-rim" d="${d}" fill="none" stroke="#a9bcf0" stroke-width="2" opacity="0"/>`;
  }
  function layout() {
    vw = innerWidth; vh = innerHeight;
    const lay = titleLayout(vw, vh);
    S = lay.S; OX = lay.OX; OY = lay.OY; jamb = lay.jamb; lintel = lay.lintel; mode = lay.mode;
    const root = host.style; root.setProperty('--S', String(S)); root.setProperty('--lintel', lintel + 'px');
    stage.classList.toggle('avenue', mode === 'avenue'); stage.classList.toggle('row', mode === 'row');
    STD.forEach((s, i) => { const b = lay.std[i];
      s.el.style.left = f(b.x - b.w / 2) + 'px'; s.el.style.top = f(b.top) + 'px'; s.el.style.width = f(b.w) + 'px'; s.el.style.height = f(b.h) + 'px'; s.el.style.zIndex = String(b.z); s.fx = b.x / vw; });
    let hangH: number;
    if (mode === 'avenue') { const bw = clamp(Math.min(vw * .075, vh * .13), 84, 150), c = HANG[3]; c.el.style.left = f(vw / 2 - bw / 2) + 'px'; c.el.style.width = f(bw) + 'px'; c.fx = .5; hangH = bw * c.VH / 120; }
    else { const gap = clamp(vw * .014, 5, 16), bw = clamp(Math.min((Math.min(vw - 2 * jamb - 2, 640) - 6 * gap) / 7, vh * .075), 34, 84), x0 = (vw - 7 * bw - 6 * gap) / 2; hangH = 0;
      HANG.forEach((b, i) => { b.el.style.left = f(x0 + i * (bw + gap)) + 'px'; b.el.style.width = f(bw) + 'px'; b.fx = (x0 + i * (bw + gap) + bw / 2) / vw; hangH = Math.max(hangH, bw * b.VH / 120); }); }
    root.setProperty('--hangH', f(hangH - 5) + 'px');
    FIRES.forEach((F, i) => { const r = 290 * F.k * S, cx = F.x * S + OX + PAD, cy = (F.y - 24 * F.k) * S + OY + PAD, rw = 250 * F.k * S, rh = 34 * F.k * S, ry = (F.y + 74 * F.k) * S + OY + PAD;
      GL[i * 2].style.cssText = `left:${f(cx - r)}px;top:${f(cy - r)}px;width:${f(2 * r)}px;height:${f(2 * r)}px`;
      GL[i * 2 + 1].style.cssText = `left:${f(cx - rw)}px;top:${f(ry - rh)}px;width:${f(2 * rw)}px;height:${f(2 * rh)}px`; });
    FD = Math.min(window.devicePixelRatio || 1, 1.5);
    fx.width = nearC.width = Math.round(vw * FD); fx.height = nearC.height = Math.round(vh * FD);
    buildFrame(); rainInit();
  }

  // ================================================================= the storm
  const storm = { wind: .16, gust: 0, flash: 0, f0: -1e9, fd: 1, fk: 0, boltX: .5 };
  const cam = { x: 0, y: 0, tx: 0, ty: 0, sx: 0, sy: 0, sh: 0 };
  let T = 0;

  // ---- fire and rain behind the standards
  let drops: any[] = [], splashes: any[] = [], embers: any[] = [], near: any[] = [];
  function newDrop(d: any, warm?: boolean) {
    d.z = Math.pow(Math.random(), 1.5); d.v = (780 + 1350 * d.z) * S; d.len = d.v * (.02 + .012 * d.z);
    d.x = -vh * .35 + Math.random() * (vw + vh * .45); d.y = warm ? Math.random() * vh : -d.len - Math.random() * 140;
    // Rain beyond the wall is lost behind it (no splash: there is nothing there to land on); the rest lands in the yard, the nearest lowest on the screen.
    const far = WB * S + OY; d.land = d.z < .3 ? WT * S + OY : far + (vh + 24 - far) * Math.pow((d.z - .3) / .7, .9);
    return d;
  }
  function rainInit() { const n = Math.round(clamp(380 * vw * vh / 1166400 + 110, 180, 640)); drops = Array.from({ length: n }, () => newDrop({}, true)); splashes = [];
    near = Array.from({ length: Math.round(clamp(vw * vh / 26000, 14, 46)) }, () => nearStreak({}, true)); }
  // Fire: a few hundred soft motes of light, added together. White where they crowd over the coals, then yellow,
  // orange and red as they thin, cool and climb. The wind leans it, and it never holds a shape.
  const FSPR = [[255, 232, 160], [255, 186, 80], [255, 116, 28], [186, 44, 12]].map(([r, g, b]) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!, gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(.3, `rgba(${r},${g},${b},.5)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c; });
  function fire(g: CanvasRenderingContext2D, F: any, x: number, y: number, dt: number) {
    const k = F.k * S, w = 22 * k, r = Math.random, P = F.p || (F.p = []);
    F.lum = .8 + .2 * (.5 * Math.sin(T * 11 + F.x) + .3 * Math.sin(T * 23 + F.x * 2) + .2 * Math.sin(T * 5.3 + F.x * 3));      // how bright the whole fire is this instant
    F.acc = (F.acc || 0) + dt * 190 * Math.max(.6, F.k);
    while (F.acc >= 1) { F.acc--; const e = r() * 3 | 0, c = (r() + r() + r()) / 3 - .5;      // three tongues; each mote starts near the middle of its own
      P.push({ e, x: (e - 1) * w * .42 + c * w * 1.1, y: (r() - .3) * 4 * k, vx: (r() - .5) * 10 * k, vy: -(62 + r() * 62) * k, age: 0, life: .5 + r() * .5, s: (11 + r() * 8) * k }); }
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = .26 * F.lum; g.drawImage(FSPR[2], x - w * 3.4, y - w * 4.8, w * 6.8, w * 6.8);      // the glow it stands in
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.age += dt; const q = p.age / p.life; if (q >= 1) { P.splice(i, 1); continue; }
      p.vy -= 55 * k * dt; p.vx += ((r() - .5) * 150 + storm.wind * 200) * k * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x -= p.x * dt * 2.2 * q;      // it narrows as it climbs
      const sway = Math.sin(T * (5.2 + p.e * 1.7) + p.e * 2.1 + F.x - p.y * .05 / k) * 7 * k * q,
        sz = p.s * (.6 + .6 * Math.min(1, q * 4)) * Math.pow(1 - q, .75), n = q < .16 ? 0 : q < .4 ? 1 : q < .7 ? 2 : 3;
      g.globalAlpha = [.6, .52, .44, .36][n] * Math.min(1, q * 16) * (q > .7 ? (1 - q) / .3 : 1);
      g.drawImage(FSPR[n], x + p.x + sway - sz, y + p.y - sz, sz * 2, sz * 2);
    }
    g.globalAlpha = .5 * F.lum; g.drawImage(FSPR[0], x - w * .95, y - w * 1.55, w * 1.9, w * 2.1);      // its white heart
    g.globalAlpha = .8 * F.lum; g.drawImage(FSPR[2], x - w * 1.6, y - w * .45, w * 3.2, w * .9);         // and the bed of coals
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function drawFx(dt: number) {
    const g = fg, fl = storm.flash, cxo = -cam.x * 13 + cam.sx, cyo = -cam.y * 13 * .6 + cam.sy;
    g.setTransform(FD, 0, 0, FD, 0, 0); g.clearRect(0, 0, vw, vh); g.lineCap = 'round';
    FIRES.forEach((F, i) => {
      const x = F.x * S + OX + cxo, y = F.y * S + OY + cyo, k = F.k * S; F.sx = x; F.sy = y - 43 * k; F.sr = 290 * k;
      if (x > -300 && x < vw + 300) fire(g, F, x, y, dt); else F.lum = 1;
      GL[i * 2].style.opacity = f2(F.lum); GL[i * 2 + 1].style.opacity = f2(.6 + .4 * F.lum);      // its light on the wall and the wet stone moves with it
      if (Math.random() < dt * 3.4 * F.k && embers.length < 50) embers.push({ x: x + (Math.random() - .5) * 30 * k, y: y - 24 * k, vx: ((Math.random() - .5) * 60 + storm.wind * 170) * k, vy: -(110 + Math.random() * 150) * k, t0: T, life: .7 + Math.random() * 1.1 });
    });
    // Sparks: thrown up fast, slowing, cooling from yellow to red.
    g.lineWidth = 1.3;
    for (let i = embers.length - 1; i >= 0; i--) { const e = embers[i], p = (T - e.t0) / e.life; if (p >= 1) { embers.splice(i, 1); continue; }
      e.vy += 70 * S * dt; e.vx += (Math.random() - .5) * 120 * dt; e.x += e.vx * dt; e.y += e.vy * dt;
      g.strokeStyle = `rgba(255,${200 - 110 * p | 0},${110 - 90 * p | 0},${f2((1 - p) * (.55 + .45 * Math.sin(T * 30 + i)))})`; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(e.x - e.vx * .03, e.y - e.vy * .03); g.stroke(); }
    // Rain: far drops are short, thin and faint, near ones long and fast. Drops that pass a fire catch its light.
    const sx = Math.sin(storm.wind), cy = Math.cos(storm.wind), P = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()], fireTop = (WT - 120) * S + OY;
    for (const d of drops) {
      d.x += d.v * sx * dt; d.y += d.v * cy * dt;
      if (d.y >= d.land) {
        if (d.z >= .3 && Math.random() < .26 && splashes.length < 110) { let warm = 0; for (const F of FIRES) { const q = Math.hypot(d.x - F.sx, d.land - F.sy - F.sr * .25); if (q < F.sr) warm = Math.max(warm, 1 - q / F.sr); }
          splashes.push({ x: d.x, y: d.land, r: (1.6 + 4.4 * (d.z - .3) / .7) * S + .8, t0: T, life: .2 + .14 * d.z, warm: warm > .3 }); }
        newDrop(d); continue;
      }
      let b = d.z < .34 ? 0 : d.z < .68 ? 1 : 2;
      if (d.y > fireTop) for (const F of FIRES) { const q = Math.hypot(d.x - F.sx, d.y - F.sy); if (q < F.sr) { b = q < F.sr * .45 ? 4 : 3; break; } }
      P[b].moveTo(d.x, d.y); P[b].lineTo(d.x - sx * d.len, d.y - cy * d.len);
    }
    const lit = 1 + 3.2 * fl, cool = fl > .3 ? '226,233,255' : '176,192,230';
    ([[.8, `rgba(${cool},${f2(Math.min(1, .1 * lit))})`], [1.1, `rgba(${cool},${f2(Math.min(1, .16 * lit))})`], [1.5, `rgba(${cool},${f2(Math.min(1, .23 * lit))})`], [1.2, 'rgba(255,176,110,.3)'], [1.3, 'rgba(255,208,156,.5)']] as [number, string][]).forEach(([lw, st], i) => { g.lineWidth = lw; g.strokeStyle = st; g.stroke(P[i]); });
    // Where it lands: a small crown thrown up, and a ring spreading on the wet stone.
    const Q = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    for (let i = splashes.length - 1; i >= 0; i--) { const s = splashes[i], p = (T - s.t0) / s.life; if (p >= 1) { splashes.splice(i, 1); continue; }
      const q = Q[(s.warm ? 3 : 0) + (p < .33 ? 0 : p < .66 ? 1 : 2)], rx = s.r * (1 + 2.2 * p), up = s.r * (1.7 - p * 1.1);
      q.moveTo(s.x + rx, s.y); q.ellipse(s.x, s.y, rx, rx * .3, 0, 0, 6.2832);
      q.moveTo(s.x - s.r * .4, s.y); q.lineTo(s.x - s.r * (.8 + p), s.y - up); q.moveTo(s.x + s.r * .4, s.y); q.lineTo(s.x + s.r * (.8 + p), s.y - up); }
    g.lineWidth = 1;
    [.5, .32, .14].forEach((a, i) => { g.strokeStyle = `rgba(205,216,242,${f2(Math.min(1, a * (1 + 2 * fl)))})`; g.stroke(Q[i]); g.strokeStyle = `rgba(255,196,140,${f2(a * 1.2)})`; g.stroke(Q[i + 3]); });
  }

  // ---- rain blown in under the arch, close to the eye: fast, out of focus, and in front of everything
  function nearStreak(n: any, warm?: boolean) { n.x = -vh * .3 + Math.random() * (vw + vh * .4); n.y = warm ? Math.random() * vh : -200 - Math.random() * 300; n.v = (2300 + Math.random() * 1100) * S; n.len = n.v * .05; n.a = .05 + Math.random() * .08; n.w = 1.4 + Math.random() * 1.4; return n; }
  function drawNear(dt: number) {
    const g = ng, fl = storm.flash, sx = Math.sin(storm.wind), cy = Math.cos(storm.wind);
    g.setTransform(FD, 0, 0, FD, 0, 0); g.clearRect(0, 0, vw, vh); g.lineCap = 'round';
    for (const n of near) { n.x += n.v * sx * dt; n.y += n.v * cy * dt; if (n.y - n.len > vh) nearStreak(n); g.strokeStyle = `rgba(190,204,238,${f2(Math.min(1, n.a * (1 + 2.5 * fl)))})`; g.lineWidth = n.w; g.beginPath(); g.moveTo(n.x, n.y); g.lineTo(n.x - sx * n.len, n.y - cy * n.len); g.stroke(); }
  }

  // ---- lightning
  const NIGHTS = [...stage.querySelectorAll('.ts-knight')], KF = [[0, 0], [.05, 1], [.18, .22], [.3, .8], [.55, .12], [1, 0]];      // two pulses, then dark: never more than that inside a second
  function flashAt(now: number) { const p = (now - storm.f0) / storm.fd; if (p <= 0 || p >= 1) return 0; for (let i = 1; i < KF.length; i++) if (p <= KF[i][0]) { const a = KF[i - 1], b = KF[i]; return (a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0])) * storm.fk; } return 0; }
  // A channel from a to b, broken at the midpoint again and again.
  function boltPts(x0: number, y0: number, x1: number, y1: number, rough: number, it: number, r: () => number) {
    let pts = [[x0, y0], [x1, y1]];
    for (let k = 0; k < it; k++) { const n = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, off = (r() - .5) * l * rough; n.push([(a[0] + b[0]) / 2 - dy / l * off, (a[1] + b[1]) / 2 + dx / l * off], b); } pts = n; }
    return pts;
  }
  const dOf = (p: number[][]) => 'M' + p.map((q) => `${f(q[0])},${f(q[1])}`).join('L');
  // sheet: far off, in the cloud. bolt: a strike beyond the Keep. close: overhead, and the ground shakes.
  function strike(kind?: unknown) {
    const r = Math.random; kind = typeof kind === 'string' ? kind : r() < .34 ? 'sheet' : r() < .8 ? 'bolt' : 'close';
    const k = kind === 'sheet' ? .45 : kind === 'bolt' ? .85 : 1, dur = 820 + r() * 320, vl = -OX / S, vr = (vw - OX) / S, x = vl + 70 + r() * Math.max(60, vr - vl - 140);
    storm.boltX = clamp((x * S + OX) / vw, 0, 1);
    if (!still) {
      stage.style.setProperty('--fx', f(storm.boltX * 100) + '%');
      if (kind !== 'sheet') {
        const main = boltPts(x, Math.max(-30, -OY / S - 30), x + (r() - .5) * 280, 420 + r() * 150, .4, 5, r), close = kind === 'close';
        let h = `<path d="${dOf(main)}" stroke="#7fa2ff" stroke-width="${close ? 16 : 11}" opacity=".5" filter="url(#ts-bglow)"/><path d="${dOf(main)}" stroke="#f4f7ff" stroke-width="${close ? 4.4 : 3}"/>`;
        for (let i = 0, n = 2 + (r() * 3 | 0); i < n; i++) { const a = main[4 + (r() * (main.length - 10) | 0)], ang = Math.PI / 2 + (r() < .5 ? -1 : 1) * (.4 + r() * .6), len = 70 + r() * 190, br = boltPts(a[0], a[1], a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len, .45, 4, r);
          h += `<path d="${dOf(br)}" stroke="#dfe8ff" stroke-width="1.6" opacity=".85"/>`;
          if (r() < .4) { const b = br[br.length >> 1], a2 = ang + (r() - .5) * 1.2; h += `<path d="${dOf(boltPts(b[0], b[1], b[0] + Math.cos(a2) * len * .45, b[1] + Math.sin(a2) * len * .45, .45, 3, r))}" stroke="#dfe8ff" stroke-width="1" opacity=".7"/>`; } }
        $('boltg').innerHTML = h;
        $('bolts').animate([{ opacity: 1 }, { opacity: 1, offset: .1 }, { opacity: 0, offset: .18 }, { opacity: .85, offset: .3 }, { opacity: 0, offset: .4 }, { opacity: 0 }], { duration: dur });
      }
      const o = { duration: dur, easing: 'linear' }, an = (el: Element | null, fn: (v: number) => Keyframe) => el && el.animate(KF.map(([offset, v]) => ({ offset, ...fn(v * k) })), o);
      an($('flashA'), (v) => ({ opacity: v })); an($('flashB'), (v) => ({ opacity: v }));
      for (const el of NIGHTS) an(el, (v) => ({ opacity: 1 - .72 * v })); an($('wallNight'), (v) => ({ opacity: 1 - .66 * v })); an($('rim'), (v) => ({ opacity: .5 * v }));
      an(host.querySelector('.logo'), (v) => ({ filter: `drop-shadow(0 4px 18px rgba(179,22,27,.6)) drop-shadow(0 1px 0 rgba(0,0,0,.8)) brightness(${1 + .22 * v})` }));
      storm.f0 = performance.now(); storm.fd = dur; storm.fk = k;
      // The gust comes with the thunder: harder rain, banners thrown further over, and for a close one the camera jumps.
      window.setTimeout(() => { if (dead) return; storm.gust = Math.min(1.5, storm.gust + (kind === 'close' ? 1 : kind === 'bolt' ? .55 : .25)); if (kind === 'close') cam.sh = 9; }, kind === 'close' ? 130 : 650);
    }
    opts.onStrike?.(kind as StrikeKind, storm.boltX);
  }

  // ---- the loop: camera, weather, canvases
  const onMove = (e: PointerEvent) => { if (e.pointerType === 'touch') return; cam.tx = (e.clientX / vw - .5) * 2; cam.ty = (e.clientY / vh - .5) * 2; };
  addEventListener('pointermove', onMove);
  let lastT = 0;
  function frame(now: number) {
    const t = now / 1000, dt = Math.min(.05, t - lastT || .016); lastT = t; T = t;
    if (dead) return;
    if (!rz && (innerWidth !== vw || innerHeight !== vh)) relayout();      // a size change that arrived without a resize event
    storm.gust *= Math.exp(-dt / 2.4); storm.wind = .15 + .05 * Math.sin(t * .11) + .03 * Math.sin(t * .37 + 2) + .12 * storm.gust; storm.flash = flashAt(now);
    // Nearer planes slide further: the mouse leans the camera, and it is never quite still.
    const dx = Math.sin(t * .21) * .3 + Math.sin(t * .13 + 1) * .22, dy = Math.cos(t * .17) * .22, e = Math.min(1, dt * 2.2);
    cam.x += (cam.tx * .8 + dx - cam.x) * e; cam.y += (cam.ty * .5 + dy - cam.y) * e;
    cam.sh *= Math.exp(-dt * 5.5); cam.sx = (Math.random() - .5) * cam.sh; cam.sy = (Math.random() - .5) * cam.sh;
    for (const p of PLANES) p.el.style.transform = `translate3d(${f2(-cam.x * p.d + cam.sx)}px,${f2(-cam.y * p.d * .6 + cam.sy)}px,0)${p.rot || ''}`;
    // One wind moves everything. The rain falls along it, the curtains of rain are turned to it, and every banner is
    // laid over the same way, by an angle that swells and lulls about the rain's own slant and jumps with the same
    // gusts. The swell crosses the screen left to right, so each cloth answers a moment after the one upwind of it;
    // only a small flutter is its own.
    blow(t);
    drawFx(dt); drawNear(dt);
    raf = requestAnimationFrame(frame);
  }
  function blow(t: number) {
    const windDeg = storm.wind * 57.3;
    sheets.style.transform = `rotate(${f2(-windDeg)}deg)`;
    for (const c of CLOTHS) { const tt = t - (c.o.fx || 0) * .7, lean = Math.min(14, windDeg * (.8 + .2 * Math.sin(tt * .9) + .12 * Math.sin(tt * 2.3 + 1) + .06 * Math.sin(tt * 4.3 + 2)));
      c.el.style.transform = `rotate(${f2(-Math.min(2.4, lean * .25) + Math.sin(t * 6.1 + c.ph) * .22)}deg) skewX(${f2(lean * .8)}deg)`; }
  }

  // ================================================================= go
  layout();
  let rz = 0;
  const relayout = () => { clearTimeout(rz); rz = window.setTimeout(() => { rz = 0; if (!dead) layout(); }, 140); };
  addEventListener('resize', relayout);
  if (still) { for (let i = 0; i < 60; i++) { T += .02; drawFx(.02); } drawNear(0); blow(0); } else raf = requestAnimationFrame(frame);
  // Lightning comes when it likes: every 6 to 17 seconds, and once soon after the screen opens.
  let next = 0;
  (function loop() { next = window.setTimeout(() => { if (dead) return; if (!document.hidden) strike(); loop(); }, 6500 + Math.random() * 10500); })();
  const first = still ? 0 : window.setTimeout(() => { if (!dead) strike('bolt'); }, 1200);
  return {
    el: stage,
    strike: (kind) => strike(kind),
    destroy() {
      dead = true;
      cancelAnimationFrame(raf); clearTimeout(rz); clearTimeout(next); clearTimeout(first);
      removeEventListener('resize', relayout); removeEventListener('pointermove', onMove);
      stage.remove();
    },
  };
}
