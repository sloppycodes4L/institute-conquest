// Builds the game's audio from scripts/audio-picks.ts: the local library (and any ElevenLabs takes in
// audio-src/eleven/) → small MP3s in public/audio/, plus src/ui/audio-manifest.ts for the game to read.
// The outputs are committed, so CI and GitHub Pages never need the library, ffmpeg or ElevenLabs.
//
//   node scripts/audio-build.ts
//
// Needs ffmpeg (on PATH, in FFMPEG, or the winget install). The library defaults to
// Desktop/institute-conquest-audio-sorted; set AUDIO_LIB to point elsewhere.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MUSIC, SFX, type Mood } from './audio-picks.ts';

const ROOT = join(import.meta.dirname, '..');
const LIB = resolve(process.env.AUDIO_LIB ?? join(ROOT, '..', '..', 'institute-conquest-audio-sorted'));
const ELEVEN = join(ROOT, 'audio-src', 'eleven');
const OUT = join(ROOT, 'public', 'audio');

function findFfmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const wg = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(wg)) {
    for (const pkg of readdirSync(wg).filter((d) => d.startsWith('Gyan.FFmpeg'))) {
      for (const build of readdirSync(join(wg, pkg))) {
        const exe = join(wg, pkg, build, 'bin', 'ffmpeg.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error('ffmpeg not found: install it (winget install Gyan.FFmpeg) or set FFMPEG to its path.');
}
const FF = findFfmpeg();
const ff = (args: string[]) => spawnSync(FF, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' });

/** The sorter's measurements per file (lead/tail silence, ramps), keyed by library-relative path. */
function readManifest(): Map<string, Record<string, string>> {
  const text = readFileSync(join(LIB, 'manifest.csv'), 'utf8');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return new Map(body.map((r) => [r[0], Object.fromEntries(head.map((h, i) => [h, r[i]]))]));
}

/** Loudest sample in dBFS. */
function peakDb(file: string, filter: string): number {
  const r = ff(['-i', file, '-af', `${filter}volumedetect`, '-f', 'null', '-']);
  const m = /max_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? +m[1] : 0;
}

function encode(args: string[], out: string) {
  const r = ff(['-y', ...args, out]);
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${out}:\n${r.stderr.split('\n').slice(-6).join('\n')}`);
}

function main() {
  if (!existsSync(join(LIB, 'manifest.csv'))) throw new Error(`No sorted library at ${LIB} (set AUDIO_LIB).`);
  const meta = readManifest();
  console.log(`ffmpeg: ${FF}\nlibrary: ${LIB}`);
  for (const d of ['sfx', 'music']) { rmSync(join(OUT, d), { recursive: true, force: true }); mkdirSync(join(OUT, d), { recursive: true }); }

  // --- sound effects: mono, leading silence trimmed, peaks at -1 dBFS ---
  const sfxCounts: Record<string, number> = {};
  const elevenUsed: string[] = [];
  for (const [id, g] of Object.entries(SFX)) {
    const srcs = (g.local ?? []).map((p) => join(LIB, p));
    for (const p of srcs) if (!existsSync(p)) throw new Error(`Missing from the library: ${p}`);
    if (g.eleven) {
      for (let i = 0; i < g.eleven.takes; i++) {
        const p = join(ELEVEN, `${id}-${i + 1}.mp3`);
        if (existsSync(p)) { srcs.push(p); elevenUsed.push(id); }
      }
    }
    if (!srcs.length) { console.log(`  ${id.padEnd(8)} — (nothing yet: the game uses its stand-in)`); continue; }
    srcs.forEach((src, i) => {
      const trim = g.keepHead ? '' : 'silenceremove=start_periods=1:start_threshold=-50dB,';
      const gain = -1 - peakDb(src, trim);
      encode(['-i', src, '-af', `${trim}volume=${gain.toFixed(2)}dB`, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '4'], join(OUT, 'sfx', `${id}-${i + 1}.mp3`));
    });
    sfxCounts[id] = srcs.length;
    console.log(`  ${id.padEnd(8)} ${srcs.length} clip(s)`);
  }

  // --- music: lead silence cut, ~100 kbps stereo ---
  const music: { file: string; mood: Mood; dur: number; ramp: number | null }[] = [];
  for (const [mood, files] of Object.entries(MUSIC) as [Mood, string[]][]) {
    files.forEach((rel, i) => {
      const m = meta.get(`music/${rel}`);
      if (!m) throw new Error(`Not in the library manifest: music/${rel}`);
      const lead = Math.max(0, +m.lead_silence_s - 0.1);
      const dur = +m.duration_s - lead - Math.max(0, +m.tail_silence_s - 0.5);
      const ramp = m.ramp_start_s ? Math.round(Math.max(0, +m.ramp_start_s - lead) * 10) / 10 : null;
      const file = `${mood}-${i + 1}.mp3`;
      encode(['-ss', lead.toFixed(2), '-i', join(LIB, 'music', rel), '-t', dur.toFixed(2), '-af', 'afade=t=out:st=' + (dur - 1.5).toFixed(2) + ':d=1.5', '-c:a', 'libmp3lame', '-q:a', '7'], join(OUT, 'music', file));
      music.push({ file, mood, dur: Math.round(dur * 10) / 10, ramp });
      console.log(`  ${file.padEnd(14)} ${dur.toFixed(0)}s${ramp != null ? ` ramp @${ramp.toFixed(0)}s` : ''}  ← ${rel}  [${m.top_tags.split(';').slice(0, 3).join(';')}]`);
    });
  }

  const ts = `// Generated by scripts/audio-build.ts from scripts/audio-picks.ts. Do not edit by hand.

/** Takes per sound: public/audio/sfx/<name>-<n>.mp3, n = 1..count. A sound missing here uses its stand-in. */
export const SFX_TAKES: Record<string, number> = ${JSON.stringify(sfxCounts)};

export type Mood = 'title' | 'calm' | 'tense' | 'battle' | 'victory' | 'defeat';

/** public/audio/music/<file>. dur in seconds; ramp = where a build into a climax begins. */
export const MUSIC: { file: string; mood: Mood; dur: number; ramp: number | null }[] = ${JSON.stringify(music, null, 1).replace(/\n\s*/g, ' ')};

/** Sounds made with ElevenLabs (the free plan asks for attribution). */
export const ELEVEN_SOUNDS: string[] = ${JSON.stringify([...new Set(elevenUsed)])};
`;
  writeFileSync(join(ROOT, 'src', 'ui', 'audio-manifest.ts'), ts);

  const size = (d: string) => readdirSync(d).reduce((n, f) => n + statSync(join(d, f)).size, 0) / 1048576;
  console.log(`\nWrote public/audio: sfx ${size(join(OUT, 'sfx')).toFixed(1)} MB, music ${size(join(OUT, 'music')).toFixed(1)} MB, and src/ui/audio-manifest.ts.`);
}

main();
