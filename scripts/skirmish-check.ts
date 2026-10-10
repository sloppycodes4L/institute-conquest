// Build every Skirmish map and print what came out: sizes, borders, sea lanes. With `--svg=<dir>` it also draws each
// map to an SVG file. Usage: node scripts/skirmish-check.ts [map id] [--svg=dir] [--adj]
import { writeFileSync } from 'node:fs';
import { SKIRMISH_MAPS, skirmishGeo } from '../src/engine/skirmish.ts';

const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const svgDir = process.argv.find((a) => a.startsWith('--svg='))?.slice(6);
const HUES = ['#c98f4a', '#d9c25a', '#7d84c9', '#c48a3c', '#8fb573', '#9a6fb8', '#5fa7b5', '#c96a6a', '#a8a15a', '#5f9a6a', '#d08a4a'];

for (const def of SKIRMISH_MAPS) {
  if (only && def.id !== only) continue;
  let g;
  try { g = skirmishGeo(def.id); } catch (e) { console.log(`${def.id}: FAILED: ${(e as Error).message}`); continue; }
  const T = g.territories;
  const sizes = T.map((t) => g.hexes.filter((h) => h.t === t.id).length);
  const lanes = g.skirmish!.lanes;
  const isLane = (a: number, b: number) => lanes.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  const edges = T.flatMap((t) => g.adj[t.id].filter((x) => x > t.id).map((x) => [t.id, x]));
  const small = sizes.map((n, t) => [n, T[t].name] as const).sort((a, b) => a[0] - b[0]).slice(0, 4).map(([n, name]) => `${name} ${n}`).join(', ');
  console.log(`${def.id}: ${g.nt} territories, ${g.hexes.length} hexes (smallest: ${small}), ${edges.length} borders (${lanes.length} by sea), diameter ${Math.max(...g.dist.flat())}`);
  console.log(`   regions: ${g.regions.map((r) => `${r.name} ${r.terr.length} +${r.bonus}`).join(' | ')}`);
  console.log(`   fewest borders: ${T.map((t) => [g.adj[t.id].length, t.name] as const).sort((a, b) => a[0] - b[0]).slice(0, 5).map(([n, name]) => `${name} ${n}`).join(', ')}`);
  if (process.argv.includes('--adj')) for (const t of T) console.log(`   ${t.name}: ${g.adj[t.id].map((x) => T[x].name + (isLane(t.id, x) ? ' ~' : '')).join(', ')}`);
  if (svgDir) {
    const { w, h } = g.skirmish!;
    const S = 6, X = (x: number) => ((x + w) * S).toFixed(1), Y = (y: number) => ((h - y) * S).toFixed(1);
    const hex = (x: number, y: number) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i + Math.PI / 6; return `${X(x + Math.cos(a) * 1.02)},${Y(y + Math.sin(a) * 1.02)}`; }).join(' ');
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${(2 * w * S).toFixed(0)}" height="${(2 * h * S).toFixed(0)}" style="background:#22364a;font:10px sans-serif">`];
    for (const hx of g.hexes) out.push(`<polygon points="${hex(hx.x, hx.y)}" fill="${HUES[T[hx.t].region % HUES.length]}" fill-opacity="${0.72 + 0.28 * ((hx.t * 7) % 5) / 4}"/>`);
    for (const l of lanes) out.push(`<line x1="${X(g.centroid[l.a][0])}" y1="${Y(g.centroid[l.a][1])}" x2="${X(g.centroid[l.b][0])}" y2="${Y(g.centroid[l.b][1])}" stroke="${l.wrap ? '#f66' : '#fff'}" stroke-dasharray="4 3"/>`);
    for (const t of T) out.push(`<text x="${X(g.centroid[t.id][0])}" y="${Y(g.centroid[t.id][1])}" text-anchor="middle" fill="#111" font-weight="bold">${t.name.replace(/&/g, '&amp;')}</text>`);
    out.push('</svg>');
    writeFileSync(`${svgDir}/${def.id}.svg`, out.join('\n'));
  }
}
