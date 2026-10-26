'use client';

import { Peaks, type RecordingSummary } from '@timecapsule/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getPlayback, getSubmissionPlayback } from '@/lib/api';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** What the player needs to know about whatever is playing. */
export interface PlayerTrack {
  id: string;
  title: string;
  /** e.g. "Tokyo · 1982" */
  subtitle: string;
  durationMs: number;
  /** Shown with a reconstruction label wherever the title appears. */
  isReconstruction: boolean;
  /** Public recording page, if it has one. */
  href: string | null;
  /** 'submission' previews unpublished audio through the authenticated endpoint. */
  source: 'public' | 'submission';
}

export function trackFromRecording(r: RecordingSummary): PlayerTrack {
  return {
    id: r.id,
    title: r.title.en,
    subtitle: `${r.place.cityEn} · ${r.eraYear}`,
    durationMs: r.durationMs,
    isReconstruction: r.provenance.sourceType === 'community_reconstruction',
    href: `/recordings/${r.id}`,
    source: 'public',
  };
}

export interface PlayerState {
  track: PlayerTrack | null;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  loop: boolean;
  volume: number;
  peaks: number[] | null;
}

export interface PlayerApi extends PlayerState {
  audio: HTMLAudioElement | null;
  play(track: PlayerTrack): Promise<void>;
  toggle(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** Jump forward or back by `delta` seconds. */
  skip(delta: number): Promise<void>;
  setLoop(loop: boolean): void;
  setVolume(volume: number): void;
  retry(): Promise<void>;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}

// Refresh a signed URL this long before it expires.
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Owns the single <audio> element for the whole app. It lives in the root
 * layout, so playback continues while the map pans or the route changes.
 *
 * Audio is streamed (HTTP range requests against a short-lived signed URL)
 * through a Web Audio graph: MediaElementSource -> Gain -> destination.
 * When the URL expires mid-listen, a fresh one is fetched and playback
 * resumes from the same position.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const graph = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const expiresAt = useRef(0);
  const refreshing = useRef<Promise<void> | null>(null);
  const loadToken = useRef(0);

  const [state, setState] = useState<PlayerState>({
    track: null,
    status: 'idle',
    currentTime: 0,
    duration: 0,
    loop: false,
    volume: 1,
    peaks: null,
  });
  // Event handlers read the latest state through this ref.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const patch = useCallback((p: Partial<PlayerState>) => setState((s) => ({ ...s, ...p })), []);

  /** Must run synchronously inside the user gesture that starts playback. */
  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || graph.current || typeof window.AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
    gain.gain.value = stateRef.current.volume;
    graph.current = { ctx, gain };
  }, []);

  const loadSources = useCallback(
    async (track: PlayerTrack, resumeAt: number | null) => {
      const audio = audioRef.current;
      if (!audio) return;
      const token = ++loadToken.current;
      const playback = track.source === 'submission' ? await getSubmissionPlayback(track.id) : await getPlayback(track.id);
      if (token !== loadToken.current) return; // superseded by another track
      if (!playback) throw new Error('not_available');
      expiresAt.current = Date.parse(playback.expiresAt);
      audio.src = playback.audioUrl;
      audio.load();
      if (resumeAt !== null) {
        await new Promise<void>((resolve) => {
          audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
        });
        audio.currentTime = resumeAt;
      }
      if (resumeAt === null) {
        // Peaks are cosmetic: failure leaves a flat waveform, not an error.
        fetch(playback.peaksUrl)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((json) => {
            if (token === loadToken.current) patch({ peaks: Peaks.parse(json).data });
          })
          .catch(() => undefined);
      }
    },
    [patch],
  );

  const refreshIfExpiring = useCallback(async () => {
    const { track } = stateRef.current;
    const audio = audioRef.current;
    if (!track || !audio || Date.now() < expiresAt.current - EXPIRY_MARGIN_MS) return;
    refreshing.current ??= loadSources(track, audio.currentTime).finally(() => {
      refreshing.current = null;
    });
    await refreshing.current;
  }, [loadSources]);

  const play = useCallback(
    async (track: PlayerTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      ensureGraph();
      if (stateRef.current.track?.id === track.id && stateRef.current.status !== 'error') {
        if (audio.paused) {
          await refreshIfExpiring();
          await graph.current?.ctx.resume();
          await audio.play().catch(() => patch({ status: 'error' }));
        } else {
          audio.pause();
        }
        return;
      }
      audio.pause();
      patch({ track, status: 'loading', currentTime: 0, duration: track.durationMs / 1000, peaks: null });
      try {
        await graph.current?.ctx.resume();
        await loadSources(track, null);
        await audio.play();
      } catch {
        if (stateRef.current.track?.id === track.id) patch({ status: 'error' });
      }
    },
    [ensureGraph, loadSources, patch, refreshIfExpiring],
  );

  const toggle = useCallback(async () => {
    const { track } = stateRef.current;
    if (track) await play(track);
  }, [play]);

  const seek = useCallback(
    async (seconds: number) => {
      const audio = audioRef.current;
      if (!audio || !stateRef.current.track) return;
      await refreshIfExpiring();
      // Stop just short of the end: a seek that lands exactly on the end
      // neither loops nor plays out in some browsers.
      const end = (audio.duration || stateRef.current.duration) - 0.05;
      audio.currentTime = Math.max(0, Math.min(seconds, end));
      patch({ currentTime: audio.currentTime });
    },
    [patch, refreshIfExpiring],
  );

  const skip = useCallback(
    async (delta: number) => {
      const audio = audioRef.current;
      if (audio) await seek(audio.currentTime + delta);
    },
    [seek],
  );

  const retry = useCallback(async () => {
    const { track } = stateRef.current;
    if (!track) return;
    patch({ status: 'loading' });
    try {
      await loadSources(track, audioRef.current?.currentTime ?? 0);
      await audioRef.current?.play();
    } catch {
      patch({ status: 'error' });
    }
  }, [loadSources, patch]);

  const setLoop = useCallback(
    (loop: boolean) => {
      if (audioRef.current) audioRef.current.loop = loop;
      patch({ loop });
    },
    [patch],
  );

  const setVolume = useCallback(
    (volume: number) => {
      const v = Math.max(0, Math.min(1, volume));
      if (graph.current) graph.current.gain.gain.value = v;
      else if (audioRef.current) audioRef.current.volume = v;
      patch({ volume: v });
    },
    [patch],
  );

  // Media element events -> state.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioEl(audio);
    const on = (type: string, fn: () => void) => {
      audio.addEventListener(type, fn);
      return () => audio.removeEventListener(type, fn);
    };
    const offs = [
      on('playing', () => patch({ status: 'playing' })),
      on('pause', () => patch({ status: stateRef.current.status === 'error' ? 'error' : 'paused' })),
      on('waiting', () => patch({ status: 'loading' })),
      on('timeupdate', () => patch({ currentTime: audio.currentTime })),
      on('durationchange', () => {
        if (Number.isFinite(audio.duration)) patch({ duration: audio.duration });
      }),
      on('error', () => {
        // An expired signed URL surfaces as a network error: renew once and resume.
        if (stateRef.current.track && Date.now() >= expiresAt.current - EXPIRY_MARGIN_MS && !refreshing.current) {
          void refreshIfExpiring()
            .then(() => audio.play())
            .catch(() => patch({ status: 'error' }));
        } else if (audio.src) {
          patch({ status: 'error' });
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [patch, refreshIfExpiring]);

  // OS media controls (lock screen, hardware keys).
  useEffect(() => {
    if (!('mediaSession' in navigator) || !state.track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.track.title,
      artist: state.track.subtitle,
      album: 'TimeCapsule.fm',
    });
    navigator.mediaSession.setActionHandler('play', () => void toggle());
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d.seekTime !== undefined) void seek(d.seekTime);
    });
  }, [state.track, toggle, seek]);

  const api = useMemo<PlayerApi>(
    () => ({ ...state, audio: audioEl, play, toggle, seek, skip, setLoop, setVolume, retry }),
    [state, audioEl, play, toggle, seek, skip, setLoop, setVolume, retry],
  );

  return (
    <PlayerContext.Provider value={api}>
      {children}
      {/* crossOrigin is required for Web Audio; a bucket without CORS fails loudly instead of playing silence. */}
      <audio ref={audioRef} preload="none" crossOrigin="anonymous" className="hidden" />
    </PlayerContext.Provider>
  );
}
