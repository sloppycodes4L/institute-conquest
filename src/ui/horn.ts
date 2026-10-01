// The turn horn: a short brass call, synthesized from scratch (no samples, no ElevenLabs). Pure math, so the game
// and scripts/horn-preview.ts render exactly the same sound.
//
// The cadence is a bugle call, "do-doo do-DUM doo": a pickup into the root, again into the accented third, and a held
// root to close. It's pitched low like a war horn, with a breathy attack, a little scoop into each note, brightness
// that grows with how hard it's blown, and an echo off the valley walls.

/** [frequency Hz, start s, length s, loudness 0–1]. */
const CALL: [number, number, number, number][] = [
  [196.0, 0.0, 0.11, 0.72],  // do   G3
  [261.63, 0.15, 0.3, 0.86], // doo  C4
  [196.0, 0.55, 0.11, 0.72], // do   G3
  [329.63, 0.7, 0.36, 1],    // DUM  E4, accented
  [261.63, 1.12, 0.78, 0.9], // doo  C4, held
];
/** When the last note has died away: the shout comes in here. */
export const HORN_END = 1.95;
const ECHOES: [number, number][] = [[0.34, 0.26], [0.73, 0.12]];
const LENGTH = 2.9;

export function hornCall(sr: number): Float32Array {
  const n = Math.floor(sr * LENGTH);
  const out = new Float32Array(n);
  for (const [f, at, len, loud] of CALL) {
    const k0 = Math.floor(at * sr), k1 = Math.min(n, Math.floor((at + len + 0.12) * sr));
    let ph = 0;
    for (let k = k0; k < k1; k++) {
      const t = (k - k0) / sr;
      // Lips find the note: a quick scoop up from a little flat, and a slow vibrato on the long one.
      const scoop = 1 - 0.025 * Math.exp(-t / 0.018);
      const vib = len > 0.5 ? 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.3) : 1;
      ph += (f * scoop * vib) / sr;
      // Envelope: a 25 ms attack, the note held, then a short release (longer on the last note).
      const rel = len > 0.5 ? 0.12 : 0.05;
      const env = t < 0.025 ? t / 0.025 : t < len ? 1 - 0.12 * (t / len) : Math.max(0, 1 - (t - len) / rel);
      const a = env * loud;
      // Brass brightens the harder it's blown: the higher harmonics follow the envelope.
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * ph * h) * Math.exp(-h / (1.6 + 4.2 * a)) / h ** 0.55;
      const breath = (Math.random() * 2 - 1) * 0.06 * a * Math.exp(-t / 0.08);
      out[k] += (v * 0.33 + breath) * a;
    }
  }
  for (const [d, g] of ECHOES) {
    const off = Math.floor(d * sr);
    for (let k = n - 1; k >= off; k--) out[k] += out[k - off] * g;
  }
  let peak = 0;
  for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(out[k]));
  if (peak > 0) for (let k = 0; k < n; k++) out[k] *= 0.9 / peak;
  return out;
}
