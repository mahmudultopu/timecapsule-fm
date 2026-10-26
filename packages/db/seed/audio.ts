// Procedural placeholder audio for local development. This is deliberately
// crude noise-and-tone synthesis: it must never be mistaken for a field
// recording, and every seeded row says so in its provenance.
import type { SoundCategory } from '@timecapsule/shared';

export const SAMPLE_RATE = 22_050;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns mono samples in [-1, 1]. */
export function synthesize(category: SoundCategory, seconds: number, seed: number): Float32Array {
  const n = Math.floor(seconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const rand = mulberry32(seed);
  const white = () => rand() * 2 - 1;
  let brown = 0;
  let lp = 0;
  const tau = 2 * Math.PI;

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    brown = (brown + white() * 0.02) * 0.995;
    lp += (white() - lp) * 0.05;
    let s = 0;
    switch (category) {
      case 'street': {
        const swell = 0.5 + 0.5 * Math.sin(tau * t * 0.11) * Math.sin(tau * t * 0.037);
        s = brown * 2.5 + lp * 0.25 * swell;
        if (t % 4 < 0.12) s += 0.12 * Math.sin(tau * 1000 * t);
        break;
      }
      case 'transit': {
        const arrival = Math.exp(-(((t - seconds * 0.45) / (seconds * 0.2)) ** 2));
        s = brown * 2 + (0.25 * Math.sin(tau * 48 * t) + lp * 0.5) * arrival;
        const chime = t - seconds * 0.85;
        if (chime > 0 && chime < 1.2) {
          s += 0.18 * Math.exp(-chime * 3) * Math.sin(tau * (chime < 0.5 ? 659 : 523) * t);
        }
        break;
      }
      case 'cafe': {
        s = lp * 0.18 + brown * 1.2;
        if (rand() < 0.0004) s += 0.6 * white();
        break;
      }
      case 'nature': {
        s = lp * (0.12 + 0.06 * Math.sin(tau * t * 0.2)) + brown;
        const phase = t % 2.7;
        if (phase < 0.15) s += 0.1 * Math.sin(tau * (2600 + 4000 * phase) * t);
        break;
      }
      case 'industrial': {
        s = 0.08 * (Math.sin(tau * 50 * t) + 0.5 * Math.sin(tau * 100 * t) + 0.25 * Math.sin(tau * 150 * t));
        const beat = t % 0.8;
        if (beat < 0.08) s += 0.5 * Math.exp(-beat * 40) * white();
        s += brown;
        break;
      }
    }
    out[i] = s;
  }
  // Normalise to -3 dBFS and fade in/out to avoid clicks.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.707 / peak : 0;
  const fade = Math.floor(SAMPLE_RATE * 0.5);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = out[i]! * gain * env;
  }
  return out;
}

/** 16-bit PCM mono WAV with no metadata chunks. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
