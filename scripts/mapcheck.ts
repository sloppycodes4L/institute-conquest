import { MAP, TERRITORIES, NT, DIST } from '../src/engine/data.ts';
const sizes = Array.from({length: NT}, (_, t) => MAP.hexes.filter(h => h.t === t).length);
console.log('hexes', MAP.hexes.length, 'min', Math.min(...sizes), 'max', Math.max(...sizes));
TERRITORIES.forEach(t => console.log(String(t.id).padStart(2), t.name.padEnd(22), 'sz', String(sizes[t.id]).padStart(3), 'adj', MAP.adj[t.id].map(a => a + (TERRITORIES[a].quadrant !== t.quadrant ? '*' : '')).join(' ')));
const cross = new Set<string>();
TERRITORIES.forEach(t => MAP.adj[t.id].forEach(a => { if (TERRITORIES[a].quadrant !== t.quadrant) cross.add([t.id,a].sort((x,y)=>x-y).join('-')); }));
console.log('cross links', [...cross].join(', '));
console.log('diameter', Math.max(...DIST.flat()));
// ascii
const grid: string[][] = [];
const ch = '0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
for (const h of MAP.hexes) { const row = Math.round(-h.y/1.5)+18; const col = Math.round(h.x/0.866)+32; (grid[row] ||= Array(66).fill(' '))[col] = ch[h.t]; }
console.log(grid.map(r => (r||[]).join('')).join('\n'));
