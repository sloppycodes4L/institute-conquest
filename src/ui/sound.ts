// A clash of swords, synthesized (no audio files): ringing inharmonic partials plus a short steel scrape.

let ac: AudioContext | null = null;

function strike(ctx: AudioContext, out: AudioNode, t: number, pitch: number, level: number) {
  // Struck steel rings at inharmonic ratios, the high ones dying fastest.
  [1, 2.76, 5.4, 8.93, 13.34].forEach((r, k) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = pitch * r * (1 + (Math.random() - 0.5) * 0.01);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level / (k + 1), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 / (1 + k * 0.45));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.2);
  });
  // The scrape of blade on blade: a burst of bright noise.
  const len = Math.floor(ctx.sampleRate * 0.14);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(5200, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level * 0.9, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
}

/** Two blades meet, then a third ring: "your turn". Silently does nothing where audio isn't allowed. */
export function swordClash(volume = 0.5) {
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') void ac.resume();
    const out = ac.createGain();
    out.gain.value = volume;
    out.connect(ac.destination);
    const t = ac.currentTime + 0.03;
    strike(ac, out, t, 690, 0.5);
    strike(ac, out, t + 0.17, 610, 0.45);
    strike(ac, out, t + 0.42, 760, 0.35);
  } catch { /* no audio here */ }
}
