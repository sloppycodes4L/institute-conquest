// Print map stats (and an ASCII render with `--draw`) for every valley size. Usage: npx tsx scripts/mapcheck.ts [layout] [--draw] [--seed=N]
import { mapGeo, LAYOUTS } from '../src/engine/data.ts';
const only = process.argv.find((a) => /^\d$/.test(a));
const draw = process.argv.includes('--draw');
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const seed = seedArg ? +seedArg.slice(7) : 1;
for (let L = 0; L < LAYOUTS.length; L++) {
  if (only && +only !== L) continue;
  const g = mapGeo(L, seed);
  const sizes = Array.from({ length: g.nt }, (_, t) => g.hexes.filter((h) => h.t === t).length);
  const T = g.territories;
  const keepBuffer = Math.min(...T.filter((t) => t.isKeep).map((k) => Math.min(...T.filter((t) => t.house !== k.house).map((t) => g.dist[k.id][t.id]))));
  const keepToKeep = Math.min(...T.filter((t) => t.isKeep).flatMap((a) => T.filter((b) => b.isKeep && b.id !== a.id).map((b) => g.dist[a.id][b.id])));
  const gates = T.filter((t) => t.quadrant === 2 && g.adj[t.id].some((a) => T[a].quadrant !== 2)).length;
  const core = T.filter((t) => t.isKeep).map((k) => T.filter((t) => t.house === k.house && g.dist[k.id][t.id] <= 1).length);
  const terr: Record<string, number> = {};
  T.forEach((t) => { terr[t.terrain] = (terr[t.terrain] ?? 0) + 1; });
  console.log(`L${L} seed ${seed} K=${g.perHouse} rows=${g.rows} territories=${g.nt} hexes=${g.hexes.length} size min/max ${Math.min(...sizes)}/${Math.max(...sizes)} R ${g.R_IN.toFixed(1)}–${g.R_OUT.toFixed(1)}`);
  console.log(`   keep→foreign ≥ ${keepBuffer}, keep→keep ≥ ${keepToKeep}, diameter ${Math.max(...g.dist.flat())}, pluto gates ${gates}, core sizes ${core}, terrain ${JSON.stringify(terr)}`);
  console.log(`   ports ${g.ports.map(([a, b]) => `${T[a].name}⇄${T[b].name}`).join(', ')}`);
  console.log(`   regions ${g.regions.length}: ${g.regions.slice(0, 4).map((r) => `${r.name} (${r.terr.length}, +${r.bonus})`).join(', ')} …`);
  if (draw) {
    const ch = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const grid: string[][] = [];
    const R = Math.ceil(g.R_OUT) + 2;
    for (const h of g.hexes) {
      const row = Math.round(-h.y / 1.5) + Math.ceil(R / 1.5);
      const col = Math.round(h.x / 0.866) + Math.ceil(R / 0.866);
      const tt = T[h.t];
      (grid[row] ||= Array(Math.ceil(2 * R / 0.866) + 2).fill(' '))[col] = tt.isKeep ? '#' : tt.port >= 0 ? '@' : ch[(h.t % g.perHouse) + (tt.house % 2 ? 26 : 0)] ?? '?';
    }
    console.log(grid.map((r) => (r || []).join('')).join('\n'));
  }
}
