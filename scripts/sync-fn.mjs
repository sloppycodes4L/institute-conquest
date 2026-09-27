// Copy the shared engine next to the edge function so the deployed files mirror the repo exactly.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('supabase/functions/institute/engine', { recursive: true });
for (const f of ['data.ts', 'cards.ts', 'engine.ts', 'bot.ts']) cpSync(`src/engine/${f}`, `supabase/functions/institute/engine/${f}`);
console.log('engine synced into supabase/functions/institute/engine');
