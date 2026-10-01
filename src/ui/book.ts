// The Proctors' Book: the Proctors' running odds on who takes the Institute, from the engine's turn snapshots.
//
// Strength = 45% share of the valley's armies + 40% share of its territories + 15% share of battles won (against
// other Houses). The odds sharpen it (strength squared, normalized), so a clear leader reads as a favourite.
// Allies are booked as one side: their strengths add up, and every member shows the side's shared odds.

import { HOUSES } from '../engine/data.ts';
import type { GameState, Snap } from '../engine/engine.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface Side { members: number[]; pct: number }
export interface Line { snap: Snap; sides: Side[]; /** Odds by seat (a member of a side shows the side's). */ pct: number[] }

/** The alliances a snapshot shows to this viewer, as sides; everyone else stands alone. */
function sidesOf(v: GameState, s: Snap): number[][] {
  const alive = v.players.map((p) => s.t[p.seat] > 0);
  const sides: number[][] = [];
  const taken = new Set<number>();
  for (const al of s.al) {
    const m = al.m.filter((x) => alive[x]);
    if (m.length > 1) { sides.push(m); m.forEach((x) => taken.add(x)); }
  }
  for (const p of v.players) if (alive[p.seat] && !taken.has(p.seat)) sides.push([p.seat]);
  return sides;
}

export function strengths(v: GameState, s: Snap): number[] {
  const n = v.players.length;
  const alive = v.players.map((p) => s.t[p.seat] > 0);
  const sum = (xs: number[]) => xs.reduce((a, b, i) => a + (alive[i] ? b : 0), 0);
  const T = sum(s.t) || 1, A = sum(s.a) || 1, W = sum(s.w.map((w) => w + 1)) || 1;
  return Array.from({ length: n }, (_, i) => (alive[i] ? 0.45 * (s.a[i] / A) + 0.4 * (s.t[i] / T) + 0.15 * ((s.w[i] + 1) / W) : 0));
}

export function oddsAt(v: GameState, s: Snap, winners?: number[]): Line {
  const n = v.players.length;
  const pct = new Array(n).fill(0);
  // The war is over: the Book pays out.
  if (winners?.length) {
    winners.forEach((w) => { pct[w] = 100; });
    return { snap: s, sides: [{ members: [...winners], pct: 100 }], pct };
  }
  const str = strengths(v, s);
  const raw = sidesOf(v, s).map((m) => ({ members: m, k: m.reduce((a, x) => a + str[x], 0) ** 2 }));
  const K = raw.reduce((a, x) => a + x.k, 0) || 1;
  const sides = raw.map((x) => ({ members: x.members, pct: (100 * x.k) / K }));
  for (const sd of sides) for (const m of sd.members) pct[m] = sd.pct;
  return { snap: s, sides, pct };
}

/** One point per snapshot (the last one pays out if the war is over). */
export function bookLines(v: GameState): Line[] {
  const hist = v.stats?.hist ?? [];
  return hist.map((s, i) => oddsAt(v, s, i === hist.length - 1 && v.phase === 'over' && s.seat === -1 ? v.winners : undefined));
}

export const roundOf = (v: GameState, turn: number) => Math.max(1, Math.ceil(turn / Math.max(1, v.players.length)));

// ---------------------------------------------------------------------------
// the chart

const W = 680, H = 260, PL = 38, PR = 128, PT = 14, PB = 28;
const SURFACE = '#140c0b';

/** The odds over the war as an SVG line chart. Allies share one braided line while the alliance lasts. */
export function bookChart(v: GameState, lines: Line[]): string {
  if (lines.length < 2) return '<p class="fine">The Proctors open the Book after the first full turn.</p>';
  const iw = W - PL - PR, ih = H - PT - PB;
  const x = (i: number) => PL + (iw * i) / (lines.length - 1);
  const y = (p: number) => PT + ih * (1 - p / 100);
  const col = (seat: number) => HOUSES[v.players[seat].house].color;
  const key = (m: number[]) => m.slice().sort((a, b) => a - b).join(',');
  const sideOf = (l: Line, seat: number) => l.sides.find((sd) => sd.members.includes(seat));
  let marks = '';
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    const done = new Set<number>();
    for (const p of v.players) {
      const seat = p.seat;
      if (done.has(seat)) continue;
      const sa = sideOf(a, seat), sb = sideOf(b, seat);
      if (!sa && !sb) continue;
      const y0 = y(a.pct[seat]), y1 = y(b.pct[seat]);
      // A side that holds together for the whole step is drawn once, braided in its members' colors.
      if (sa && sb && sa.members.length > 1 && key(sa.members) === key(sb.members)) {
        const m = sb.members;
        m.forEach((s) => done.add(s));
        marks += `<line x1="${x(i - 1)}" y1="${y0}" x2="${x(i)}" y2="${y1}" stroke="${col(m[0])}" stroke-width="3" stroke-linecap="round"/>`;
        m.slice(1).forEach((s, j) => {
          marks += `<line x1="${x(i - 1)}" y1="${y0}" x2="${x(i)}" y2="${y1}" stroke="${col(s)}" stroke-width="3" stroke-dasharray="6 ${6 * (m.length - 1)}" stroke-dashoffset="${-6 * (j + 1)}"/>`;
        });
        continue;
      }
      done.add(seat);
      const dead = !sb;
      marks += `<line x1="${x(i - 1)}" y1="${y0}" x2="${x(i)}" y2="${dead ? y(0) : y1}" stroke="${col(seat)}" stroke-width="2" stroke-linecap="round"${dead ? ' stroke-opacity=".45"' : ''}/>`;
    }
  }
  // Direct labels at the right edge, one per side, spread apart with a leader line if they'd collide.
  const last = lines[lines.length - 1];
  const tags = last.sides.map((sd) => ({ sd, y: y(sd.pct) })).sort((p, q) => p.y - q.y);
  const gap = 15;
  for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + gap);
  const over = tags.length ? tags[tags.length - 1].y - (H - PB) : 0;
  if (over > 0) for (const t of tags) t.y -= over;
  let ends = '';
  for (const t of tags) {
    const ex = x(lines.length - 1), ey = y(t.sd.pct);
    ends += `<circle cx="${ex}" cy="${ey}" r="5" fill="${col(t.sd.members[0])}" stroke="${SURFACE}" stroke-width="2"/>`;
    ends += `<line x1="${ex + 6}" y1="${ey}" x2="${ex + 14}" y2="${t.y}" stroke="#7d6b5a" stroke-width="1"/>`;
    const sig = t.sd.members.map((m) => `<tspan fill="${col(m)}">${HOUSES[v.players[m].house].sigil}</tspan>`).join('');
    const label = t.sd.members.length > 1 ? 'Allies' : esc(v.players[t.sd.members[0]].name.slice(0, 11));
    ends += `<text x="${ex + 17}" y="${t.y + 4}" class="bk-end">${sig} <tspan class="bk-pct">${Math.round(t.sd.pct)}%</tspan> ${label}</text>`;
  }
  // Recessive axes: 0–100% and the rounds.
  let axes = '';
  for (const p of [0, 25, 50, 75, 100]) {
    axes += `<line x1="${PL}" x2="${W - PR}" y1="${y(p)}" y2="${y(p)}" class="bk-grid"/><text x="${PL - 6}" y="${y(p) + 4}" class="bk-tick" text-anchor="end">${p}%</text>`;
  }
  const rounds = lines.map((l) => roundOf(v, l.snap.turn));
  const every = Math.max(1, Math.ceil(rounds[rounds.length - 1] / 8));
  rounds.forEach((r, i) => {
    if ((i === 0 || rounds[i - 1] !== r) && (r - 1) % every === 0) axes += `<text x="${x(i)}" y="${H - 8}" class="bk-tick" text-anchor="middle">R${r}</text>`;
  });
  return `<div class="bk-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The Proctors' odds on each House, turn by turn">
    ${axes}${marks}${ends}
    <line class="bk-cross hidden" x1="0" x2="0" y1="${PT}" y2="${H - PB}"/>
    <rect class="bk-hit" x="${PL}" y="${PT}" width="${iw}" height="${ih}" fill="transparent"/>
  </svg><div class="bk-tip hidden"></div></div>`;
}

/** Which snapshot the pointer is over, from an x in the SVG's own units. */
export function bookIndexAt(lines: Line[], svgX: number): number {
  const iw = W - PL - PR;
  return Math.max(0, Math.min(lines.length - 1, Math.round(((svgX - PL) / iw) * (lines.length - 1))));
}
export const bookX = (lines: Line[], i: number) => PL + ((W - PL - PR) * i) / Math.max(1, lines.length - 1);
export const BOOK_W = W;
