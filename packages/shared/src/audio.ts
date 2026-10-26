// Upload limits and audio format detection, shared by the browser (early
// feedback), the API (declared format) and the worker (authoritative check).

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 30 * 60;

export const AUDIO_FORMATS = ['wav', 'flac', 'mp3', 'ogg'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** Content-Type the browser must send with its signed PUT, per format. */
export const UPLOAD_CONTENT_TYPES: Record<AudioFormat, string> = {
  wav: 'audio/wav',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

/** How many leading bytes sniffAudioFormat needs. */
export const SNIFF_BYTES = 16;

/**
 * Identifies an audio container from its first bytes (magic numbers), never
 * from the file name or a client-supplied MIME type.
 */
export function sniffAudioFormat(head: Uint8Array): AudioFormat | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (head.length >= 4 && ascii(0, 4) === 'fLaC') return 'flac';
  if (head.length >= 4 && ascii(0, 4) === 'OggS') return 'ogg';
  if (head.length >= 3 && ascii(0, 3) === 'ID3') return 'mp3';
  // Bare MPEG audio frame: 11 sync bits, MPEG version != reserved, Layer III.
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
    const version = (head[1]! >> 3) & 0b11;
    const layer = (head[1]! >> 1) & 0b11;
    if (version !== 0b01 && layer === 0b01) return 'mp3';
  }
  return null;
}

export interface PeaksData {
  version: 1;
  sampleRate: number;
  samplesPerPeak: number;
  data: number[];
}

/**
 * Downsamples audio to ~`buckets` absolute peaks in 0..1 for the waveform.
 * Accepts float samples (-1..1) or 16-bit PCM.
 */
export function computePeaks(samples: Float32Array | Int16Array, sampleRate: number, buckets = 800): PeaksData {
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  const samplesPerPeak = Math.max(1, Math.ceil(samples.length / buckets));
  const data: number[] = [];
  for (let i = 0; i < samples.length; i += samplesPerPeak) {
    let max = 0;
    const end = Math.min(samples.length, i + samplesPerPeak);
    for (let j = i; j < end; j++) max = Math.max(max, Math.abs(samples[j]! * scale));
    data.push(Math.min(1, Math.round(max * 1000) / 1000));
  }
  return { version: 1, sampleRate, samplesPerPeak, data };
}
