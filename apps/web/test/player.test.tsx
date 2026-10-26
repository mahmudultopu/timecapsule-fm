import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerBar } from '@/components/player/PlayerBar';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { PlayButton } from '@/components/recording/PlayButton';
import { getPlayback } from '@/lib/api';
import { recording, renderWithIntl } from './utils';

vi.mock('@/lib/api', () => ({ getPlayback: vi.fn() }));

const playback = (n: number, expiresInMs = 600_000) => ({
  audioUrl: `https://media.test/a${n}.mp3?sig=${n}`,
  audioMimeType: 'audio/mpeg',
  peaksUrl: `https://media.test/p${n}.json?sig=${n}`,
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
});

beforeEach(() => {
  // jsdom has no media playback; emulate the element's events.
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) {
    queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
    this.dispatchEvent(new Event('pause'));
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1, sampleRate: 22050, samplesPerPeak: 100, data: [0.5, 1] }))));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  renderWithIntl(
    <PlayerProvider>
      <PlayButton recording={recording} />
      <PlayerBar />
    </PlayerProvider>,
  );
  return document.querySelector('audio')!;
}

describe('player', () => {
  it('prompts when nothing is playing', () => {
    setup();
    expect(screen.getByRole('region', { name: 'Audio player' })).toHaveTextContent('Choose a recording');
  });

  it('streams from a signed URL and exposes labelled controls', async () => {
    vi.mocked(getPlayback).mockResolvedValue(playback(1));
    const audio = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play Shibuya Crossing' }));

    await waitFor(() => expect(audio.src).toBe('https://media.test/a1.mp3?sig=1'));
    expect(audio.crossOrigin).toBe('anonymous');
    expect(audio.preload).toBe('none');
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause Shibuya Crossing' })).toHaveAttribute('aria-pressed', 'true');

    const seek = screen.getByRole('slider', { name: 'Seek' });
    expect(seek).toHaveAttribute('aria-valuetext', '0:00 of 1:15');
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeInTheDocument();
  });

  it('toggles loop on the media element', async () => {
    vi.mocked(getPlayback).mockResolvedValue(playback(1));
    const audio = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play Shibuya Crossing' }));
    const loop = await screen.findByRole('button', { name: 'Loop' });
    await userEvent.click(loop);
    expect(audio.loop).toBe(true);
    expect(loop).toHaveAttribute('aria-pressed', 'true');
  });

  it('renews an expiring signed URL before seeking and keeps the position', async () => {
    vi.mocked(getPlayback).mockResolvedValueOnce(playback(1, 10_000)).mockResolvedValueOnce(playback(2));
    const audio = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play Shibuya Crossing' }));
    await waitFor(() => expect(audio.src).toContain('a1.mp3'));

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '30' } });
    await waitFor(() => expect(audio.src).toContain('a2.mp3'));
    await waitFor(() => expect(audio.currentTime).toBe(30));
    expect(getPlayback).toHaveBeenCalledTimes(2);
  });

  it('shows a retry action when playback fails', async () => {
    vi.mocked(getPlayback).mockResolvedValue(null);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play Shibuya Crossing' }));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
