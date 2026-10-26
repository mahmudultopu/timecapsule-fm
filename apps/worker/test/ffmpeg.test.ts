import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FfmpegMediaTool, Rejection } from '../src/media.js';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

function available(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const haveFfmpeg = available(FFMPEG) && available(FFPROBE);

// Real ffmpeg: runs in CI (which installs it) and anywhere ffmpeg is on PATH.
describe.skipIf(!haveFfmpeg)('ffmpeg media tool', () => {
  const tool = new FfmpegMediaTool({ ffmpeg: FFMPEG, ffprobe: FFPROBE, timeoutMs: 60_000 });

  async function fixture(): Promise<{ dir: string; input: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'tc-ffmpeg-'));
    const input = join(dir, 'input');
    // A WAV with the kind of metadata a field recorder writes, including a
    // location and a device identifier that must not survive.
    execFileSync(FFMPEG, [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-metadata', 'comment=GPS 51.50735,-0.12776',
      '-metadata', 'artist=Zoom H5 serial ZX-123456',
      '-metadata', 'title=Kitchen at home',
      '-f', 'wav', '-y', input,
    ]);
    return { dir, input };
  }

  it('probes a real file', async () => {
    const { input } = await fixture();
    const p = await tool.probe(input, 'wav');
    expect(p.formatName).toContain('wav');
    expect(p.durationSeconds).toBeCloseTo(3, 0);
    expect(p.tagKeys.length).toBeGreaterThan(0); // the fixture really has metadata
  });

  it('strips every tag and identifier when transcoding', async () => {
    const { dir, input } = await fixture();
    const out = await tool.transcode(input, 'wav', dir);
    for (const path of [out.masterPath, out.previewPath]) {
      const probe = await tool.probe(path, 'output');
      expect(probe.tagKeys.filter((k) => k !== 'encoder')).toEqual([]);
      const bytes = (await readFile(path)).toString('latin1');
      for (const secret of ['51.50735', 'ZX-123456', 'Kitchen at home', 'Lavf5', 'Lavc5']) {
        expect(bytes).not.toContain(secret);
      }
    }
  });

  it('decodes mono PCM for the waveform', async () => {
    const { input } = await fixture();
    const pcm = await tool.decodePcm(input, 'wav', 8000);
    expect(pcm.length).toBeGreaterThan(8000 * 2.9);
  });

  it('refuses a file that is not what it claims to be', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tc-ffmpeg-'));
    const bogus = join(dir, 'bogus');
    await writeFile(bogus, Buffer.from('RIFF\0\0\0\0WAVEnot really audio at all'));
    await expect(tool.probe(bogus, 'wav')).rejects.toBeInstanceOf(Rejection);
  });
});
