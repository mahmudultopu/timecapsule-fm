import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AudioFormat } from '@timecapsule/shared';
import { Rejection, type MediaTool, type ProbeResult } from '../src/media.js';
import type { WorkerStorage } from '../src/storage.js';

/** In-memory object storage with the same size-cap semantics as the real one. */
export class FakeStorage implements WorkerStorage {
  quarantine = new Map<string, Buffer>();
  media = new Map<string, Buffer>();

  async downloadQuarantine(key: string, dest: string, maxBytes: number) {
    const body = this.quarantine.get(key);
    if (!body) throw new Rejection('missing_object');
    if (body.length > maxBytes) throw new Rejection('too_large');
    await writeFile(dest, body);
    const { createHash } = await import('node:crypto');
    return { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), head: new Uint8Array(body.subarray(0, 16)) };
  }
  async putMedia(key: string, body: Buffer | string) {
    this.media.set(key, Buffer.from(body));
  }
  async putMediaFile(key: string, path: string) {
    this.media.set(key, await readFile(path));
  }
  async deleteQuarantine(keys: string[]) {
    keys.forEach((k) => this.quarantine.delete(k));
  }
  async deleteMedia(keys: string[]) {
    keys.forEach((k) => this.media.delete(k));
  }
}

/**
 * Reads WAV headers in JS instead of running ffmpeg, so pipeline logic can be
 * tested anywhere. The real ffmpeg path is covered by ffmpeg.test.ts.
 */
export class FakeMedia implements MediaTool {
  outputTags: string[] = [];

  async probe(path: string, format: AudioFormat | 'output'): Promise<ProbeResult> {
    if (format === 'output') {
      return { formatName: 'flac', durationSeconds: 1, audioStreams: 1, sampleRate: 8000, channels: 1, codec: 'flac', tagKeys: this.outputTags };
    }
    const b = await readFile(path);
    if (b.subarray(8, 12).toString('ascii') !== 'WAVE') throw new Rejection('unreadable_audio');
    const byteRate = b.readUInt32LE(28);
    const dataBytes = b.readUInt32LE(40);
    return {
      formatName: 'wav',
      durationSeconds: dataBytes / byteRate,
      audioStreams: 1,
      sampleRate: b.readUInt32LE(24),
      channels: b.readUInt16LE(22),
      codec: 'pcm_s16le',
      tagKeys: [],
    };
  }

  async transcode(input: string, _format: AudioFormat, outDir: string) {
    const masterPath = join(outDir, 'master.flac');
    const previewPath = join(outDir, 'preview.mp3');
    await copyFile(input, masterPath);
    await copyFile(input, previewPath);
    return { masterPath, previewPath };
  }

  async decodePcm(input: string) {
    const b = await readFile(input);
    const data = b.subarray(44);
    return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.byteLength & ~1)));
  }
}

/** Minimal 8 kHz mono 16-bit WAV. `claimSeconds` lets a test lie about the length in the header. */
export function wav(seconds: number, opts: { claimSeconds?: number; extraChunk?: Buffer } = {}): Buffer {
  const rate = 8000;
  const samples = Math.floor(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 10) * 12000), i * 2);
  const extra = opts.extraChunk ?? Buffer.alloc(0);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + extra.length + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(Math.floor((opts.claimSeconds ?? seconds) * rate) * 2, 40);
  // Metadata chunks (if any) go between fmt and data in real files; for the
  // fake prober we append them at the end so the header offsets stay fixed.
  return Buffer.concat([header, data, extra]);
}

/** A RIFF LIST/INFO chunk of the kind recorders write (artist, comment, software). */
export function infoChunk(fields: Record<string, string>): Buffer {
  const parts = Object.entries(fields).map(([id, value]) => {
    const text = Buffer.from(`${value}\0`, 'latin1');
    const padded = text.length % 2 ? Buffer.concat([text, Buffer.alloc(1)]) : text;
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(text.length, 4);
    return Buffer.concat([head, padded]);
  });
  const body = Buffer.concat([Buffer.from('INFO', 'ascii'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('LIST', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
