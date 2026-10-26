import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { AudioFormat } from '@timecapsule/shared';

/** Thrown for anything wrong with the *file* (as opposed to the worker). */
export class Rejection extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

export interface ProbeResult {
  formatName: string;
  durationSeconds: number;
  audioStreams: number;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  /** Every metadata tag key found at container or stream level. */
  tagKeys: string[];
}

export interface TranscodeResult {
  masterPath: string;
  previewPath: string;
}

/** The operations the pipeline needs from ffmpeg (faked in unit tests). */
export interface MediaTool {
  probe(path: string, format: AudioFormat | 'output'): Promise<ProbeResult>;
  transcode(input: string, format: AudioFormat, outDir: string): Promise<TranscodeResult>;
  /** Mono 16-bit PCM at `sampleRate`, for drawing the waveform. */
  decodePcm(input: string, format: AudioFormat, sampleRate: number): Promise<Int16Array>;
}

// Demuxer names, used both to force the input format and as an allow-list,
// so ffmpeg can never be talked into a different parser by the file itself.
const DEMUXER: Record<AudioFormat, string> = { wav: 'wav', flac: 'flac', mp3: 'mp3', ogg: 'ogg' };

// Applied to every invocation: only local files, no network protocols
// (playlist-style formats could otherwise make ffmpeg fetch URLs).
const SAFE_INPUT = ['-protocol_whitelist', 'file,pipe'];
// Strip every metadata source: global tags, chapters, and stream tags;
// bitexact keeps encoder version strings out of the output.
const STRIP = ['-map', '0:a:0', '-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];

interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export class FfmpegMediaTool implements MediaTool {
  constructor(
    private readonly opts: { ffmpeg: string; ffprobe: string; timeoutMs: number },
  ) {}

  async probe(path: string, format: AudioFormat | 'output'): Promise<ProbeResult> {
    const forced = format === 'output' ? [] : ['-f', DEMUXER[format], '-format_whitelist', DEMUXER[format]];
    const { stdout } = await this.run(this.opts.ffprobe, [
      '-v', 'error', ...SAFE_INPUT, ...forced,
      '-show_format', '-show_streams', '-of', 'json', path,
    ]).catch(() => {
      throw new Rejection('unreadable_audio', 'The file could not be read as audio');
    });
    return parseProbe(stdout.toString('utf8'));
  }

  async transcode(input: string, format: AudioFormat, outDir: string): Promise<TranscodeResult> {
    const masterPath = join(outDir, 'master.flac');
    const previewPath = join(outDir, 'preview.mp3');
    const base = ['-nostdin', '-hide_banner', '-v', 'error', ...SAFE_INPUT, '-f', DEMUXER[format], '-i', input, '-threads', '1'];
    // Lossless master for archiving, then a streaming-friendly preview.
    await this.run(this.opts.ffmpeg, [...base, ...STRIP, '-c:a', 'flac', '-compression_level', '5', '-y', masterPath]);
    await this.run(this.opts.ffmpeg, [
      ...base, ...STRIP,
      '-c:a', 'libmp3lame', '-b:a', '160k', '-id3v2_version', '0', '-write_id3v1', '0',
      '-y', previewPath,
    ]);
    return { masterPath, previewPath };
  }

  async decodePcm(input: string, format: AudioFormat, sampleRate: number): Promise<Int16Array> {
    const { stdout } = await this.run(this.opts.ffmpeg, [
      '-nostdin', '-hide_banner', '-v', 'error', ...SAFE_INPUT, '-f', DEMUXER[format], '-i', input,
      '-map', '0:a:0', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-threads', '1', 'pipe:1',
    ]);
    return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
  }

  /** Runs a binary with a hard timeout and bounded stderr. No shell is involved. */
  private run(bin: string, args: string[]): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Rejection('processing_timeout', 'Processing took too long'));
      }, this.opts.timeoutMs);
      child.stdout.on('data', (c: Buffer) => out.push(c));
      child.stderr.on('data', (c: Buffer) => {
        if (err.length < 4000) err += c.toString('utf8');
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
        else reject(new Error(`${bin} exited with ${code}: ${err.slice(0, 500)}`));
      });
    });
  }
}

interface FfprobeJson {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; tags?: Record<string, string> }[];
}

export function parseProbe(json: string): ProbeResult {
  const data = JSON.parse(json) as FfprobeJson;
  const audio = (data.streams ?? []).filter((s) => s.codec_type === 'audio');
  const first = audio[0];
  const tagKeys = [
    ...Object.keys(data.format?.tags ?? {}),
    ...(data.streams ?? []).flatMap((s) => Object.keys(s.tags ?? {})),
  ].map((k) => k.toLowerCase());
  return {
    formatName: data.format?.format_name ?? '',
    durationSeconds: Number(data.format?.duration ?? 0),
    audioStreams: audio.length,
    sampleRate: first?.sample_rate ? Number(first.sample_rate) : null,
    channels: first?.channels ?? null,
    codec: first?.codec_name ?? null,
    tagKeys,
  };
}
