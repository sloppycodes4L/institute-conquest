// The home screen's backdrop: how the scene and its six standards fit a window (src/ui/title-scene.ts).
import { describe, expect, it } from 'vitest';
import { titleLayout } from '../src/ui/title-scene.ts';

/** Left and right edges of each standard, in the order they are drawn: Apollo, Diana, Minerva | Pluto, Jupiter, Ceres. */
const edges = (vw: number, vh: number) => titleLayout(vw, vh).std.map((s) => [s.x - s.w / 2, s.x + s.w / 2]);

describe('home screen layout', () => {
  const desktops = [[1350, 820], [1440, 810], [1920, 1080], [1280, 720], [1024, 768], [2560, 1440]];

  it('plants the standards beside the menu on every desktop window, none covering another', () => {
    for (const [vw, vh] of desktops) {
      const lay = titleLayout(vw, vh);
      expect(lay.mode, `${vw}x${vh}`).toBe('avenue');
      const e = edges(vw, vh);
      // Each side runs outward from the menu: far, mid, near. A gap between every pair.
      for (const [a, b] of [[0, 1], [1, 2], [3, 4], [4, 5]]) expect(e[b][0] - e[a][1], `${vw}x${vh} standards ${a} and ${b}`).toBeGreaterThan(4);
      // Clear of the gate's jambs and of the menu (440 wide, in the middle).
      expect(e[0][0]).toBeGreaterThanOrEqual(lay.jamb);
      expect(e[5][1]).toBeLessThanOrEqual(vw - lay.jamb);
      expect(e[2][1]).toBeLessThanOrEqual(vw / 2 - 220);
      expect(e[3][0]).toBeGreaterThanOrEqual(vw / 2 + 220);
    }
  });

  it('is the same on both sides of the gate, and nearer standards are bigger and drawn in front', () => {
    const { std } = titleLayout(1350, 820);
    for (const [l, r] of [[0, 5], [1, 4], [2, 3]]) {
      expect(std[l].x + std[r].x).toBeCloseTo(1350, 3);
      expect(std[l].w).toBeCloseTo(std[r].w, 6);
    }
    expect(std[0].w).toBeGreaterThan(std[1].w);
    expect(std[1].w).toBeGreaterThan(std[2].w);
    expect(std[0].z).toBeGreaterThan(std[1].z);
    expect(std[1].z).toBeGreaterThan(std[2].z);
  });

  it('hangs the banners in a row on a phone, where there is no ground beside the menu', () => {
    for (const [vw, vh] of [[375, 812], [390, 844], [430, 932], [360, 640]]) expect(titleLayout(vw, vh).mode, `${vw}x${vh}`).toBe('row');
  });

  it('covers the window with the scene, anchored to its bottom edge', () => {
    for (const [vw, vh] of [...desktops, [375, 812]]) {
      const { S, OX, OY } = titleLayout(vw, vh);
      expect(OX).toBeLessThanOrEqual(-20 + 1e-6);
      expect(1800 * S + OX).toBeGreaterThanOrEqual(vw + 20 - 1e-6);
      expect(OY).toBeLessThanOrEqual(-20 + 1e-6);
      expect(900 * S + OY).toBeCloseTo(vh + 20, 6);
    }
  });
});
