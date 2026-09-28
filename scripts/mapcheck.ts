// Print map stats (and an ASCII render with `--draw`) for every player count. Usage: npx tsx scripts/mapcheck.ts [n] [--draw]
import { geoFor, MIN_PLAYERS, MAX_PLAYERS } from '../src/engine/data.ts';
const only = process.argv.find((a) => /^\d$/.test(a));
const draw = process.argv.includes('--draw');
for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
  if (only && +only !== n) continue;
  const g = geoFor(n);
  const sizes = Array.from({ length: g.nt }, (_, t) => g.hexes.filter((h) => h.t === t).length);
  const T = g.territories;
  const keepBuffer = Math.min(...T.filter((t) => t.isKeep).map((k) => Math.min(...T.filter((t) => t.house !== k.house).map((t) => g.dist[k.id][t.id]))));
  const keepToKeep = Math.min(...T.filter((t) => t.isKeep).flatMap((a) => T.filter((b) => b.isKeep && b.id !== a.id).map((b) => g.dist[a.id][b.id])));
  const cross = new Set<string>();
  T.forEach((t) => g.adj[t.id].forEach((a) => { if (T[a].quadrant !== t.quadrant) cross.add([t.id, a].sort((x, y) => x - y).map((i) => T[i].name).join(' ↔ ')); }));
  const gates = T.filter((t) => t.quadrant === 2 && g.adj[t.id].some((a) => T[a].quadrant !== 2)).length;
  console.log(`n=${n} K=${g.perHouse} rows=${g.rows} territories=${g.nt} hexes=${g.hexes.length} size min/max ${Math.min(...sizes)}/${Math.max(...sizes)} R ${g.R_IN.toFixed(1)}–${g.R_OUT.toFixed(1)}`);
  console.log(`   keep→foreign ≥ ${keepBuffer}, keep→keep ≥ ${keepToKeep}, diameter ${Math.max(...g.dist.flat())}, pluto gates ${gates}, quad bonus ${g.quadBonus}`);
  console.log(`   passes: ${[...cross].join(' | ')}`);
  if (draw) {
    const ch = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const grid: string[][] = [];
    const R = Math.ceil(g.R_OUT) + 2;
    for (const h of g.hexes) {
      const row = Math.round(-h.y / 1.5) + Math.ceil(R / 1.5);
      const col = Math.round(h.x / 0.866) + Math.ceil(R / 0.866);
      const tt = T[h.t];
      (grid[row] ||= Array(Math.ceil(2 * R / 0.866) + 2).fill(' '))[col] = tt.isKeep ? '#' : ch[(h.t % g.perHouse) + (tt.house % 2 ? 26 : 0)] ?? '?';
    }
    console.log(grid.map((r) => (r || []).join('')).join('\n'));
  }
}
