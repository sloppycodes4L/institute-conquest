// Fills the sound library's gaps with ElevenLabs sound effects (POST /v1/sound-generation).
// A build-time tool only: the game never calls ElevenLabs. Takes are saved to audio-src/eleven/ and reused
// forever, so credits are spent once per take. Then `node scripts/audio-build.ts` puts them in the game.
//
//   node scripts/sfx-gen.ts --check        key works? credits left?
//   node scripts/sfx-gen.ts --dry          what would be generated (nothing is spent)
//   node scripts/sfx-gen.ts                generate every missing take
//   node scripts/sfx-gen.ts horn dice      only these sounds
//   node scripts/sfx-gen.ts --force horn   regenerate (replaces the saved takes)
//
// The key lives in .env.local (git-ignored, and never bundled: Vite only exposes VITE_* variables):
//   ELEVENLABS_API_KEY=sk_...

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SFX, type ElevenSpec } from './audio-picks.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'audio-src', 'eleven');
const API = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_text_to_sound_v2';

try { process.loadEnvFile(join(ROOT, '.env.local')); } catch { /* no .env.local */ }
const KEY = process.env.ELEVENLABS_API_KEY?.trim();

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.filter((a) => !a.startsWith('--'));

function needKey() {
  if (KEY) return KEY;
  console.error('No ELEVENLABS_API_KEY. Create .env.local in the project root with the line:\n  ELEVENLABS_API_KEY=your_key_here\n(elevenlabs.io → Developers → API Keys; the key needs Sound Effects access.)');
  process.exit(1);
}

async function check() {
  const r = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': needKey() } });
  if (!r.ok) {
    console.error(`ElevenLabs said ${r.status}: ${await r.text()}`);
    if (r.status === 401) console.error('The key was refused. If it is a restricted key, give it "User: Read" to run --check (sound generation only needs "Sound Effects").');
    process.exit(1);
  }
  const s = await r.json() as { tier: string; character_count: number; character_limit: number; next_character_count_reset_unix?: number };
  const reset = s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toLocaleDateString() : '?';
  console.log(`Key OK. Plan: ${s.tier}. Credits used ${s.character_count} of ${s.character_limit} (resets ${reset}).`);
  if (s.tier === 'free') console.log('Free plan: outputs need "elevenlabs.io" attribution and non-commercial use (the game credits it on the title screen).');
}

const takePath = (id: string, i: number) => join(OUT, `${id}-${i + 1}.mp3`);

async function generate(id: string, spec: ElevenSpec, i: number) {
  const body = {
    text: spec.prompt,
    duration_seconds: spec.duration,
    prompt_influence: spec.influence ?? 0.3,
    model_id: MODEL,
    ...(spec.loop ? { loop: true } : {}),
  };
  const r = await fetch(`${API}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': needKey(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${id} take ${i + 1}: ElevenLabs said ${r.status}: ${await r.text()}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(takePath(id, i), buf);
  return buf.length;
}

async function main() {
  if (flags.has('--check')) return check();
  if (flags.has('--force') && !only.length) throw new Error('--force spends credits again: name the sounds to redo, e.g. --force horn');
  const jobs: { id: string; spec: ElevenSpec; i: number }[] = [];
  for (const [id, g] of Object.entries(SFX)) {
    if (!g.eleven || (only.length && !only.includes(id))) continue;
    for (let i = 0; i < g.eleven.takes; i++) if (flags.has('--force') || !existsSync(takePath(id, i))) jobs.push({ id, spec: g.eleven, i });
  }
  const unknown = only.filter((id) => !SFX[id]?.eleven);
  if (unknown.length) console.warn(`Not ElevenLabs sounds (see scripts/audio-picks.ts): ${unknown.join(', ')}`);
  if (!jobs.length) { console.log('Nothing to generate: every take is already saved in audio-src/eleven/.'); return; }
  const secs = jobs.reduce((n, j) => n + j.spec.duration, 0);
  console.log(`${jobs.length} take(s), ${secs.toFixed(1)} s of audio:`);
  for (const j of jobs) console.log(`  ${j.id}-${j.i + 1}  ${j.spec.duration}s${j.spec.loop ? ' loop' : ''}  "${j.spec.prompt}"`);
  if (flags.has('--dry')) return;
  needKey();
  mkdirSync(OUT, { recursive: true });
  // A record of what made each file: for attribution, and to regenerate one the same way.
  const logPath = join(OUT, 'prompts.json');
  const log: Record<string, unknown> = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : {};
  for (const j of jobs) {
    const bytes = await generate(j.id, j.spec, j.i);
    log[`${j.id}-${j.i + 1}.mp3`] = { prompt: j.spec.prompt, duration: j.spec.duration, loop: !!j.spec.loop, influence: j.spec.influence ?? 0.3, model: MODEL, made: new Date().toISOString() };
    writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
    console.log(`  ✓ ${j.id}-${j.i + 1}.mp3 (${(bytes / 1024).toFixed(0)} KB)`);
  }
  console.log('Done. Listen in audio-src/eleven/, regenerate any dud with --force <name>, then run: node scripts/audio-build.ts');
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
