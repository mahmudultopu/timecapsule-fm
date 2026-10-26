'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatDuration } from '@/lib/format';
import { Back10Icon, Equalizer, Forward10Icon, LoopIcon, PauseIcon, PlayIcon, VolumeIcon } from '../ui/Icons';
import { usePlayer } from './PlayerProvider';
import { Waveform } from './Waveform';

/** The persistent "now playing" bar at the bottom of every page. */
export function PlayerBar() {
  const t = useTranslations('player');
  const tr = useTranslations('recording');
  const p = usePlayer();
  const { track } = p;
  const current = formatDuration(p.currentTime * 1000);
  const total = formatDuration(p.duration * 1000);
  const playing = p.status === 'playing';

  return (
    <section aria-label={t('region')} className="glass-night fixed inset-x-0 bottom-0 z-30 border-t border-white/10">
      {!track ? (
        <p className="flex items-center justify-center gap-2 py-4 text-sm text-mist">
          <PlayIcon className="size-4 text-glow" /> {t('nothingPlaying')}
        </p>
      ) : (
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:gap-4">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void p.skip(-10)} className="hidden size-9 place-items-center rounded-full text-mist hover:bg-white/10 hover:text-paper sm:grid" aria-label={t('back10')}>
              <Back10Icon />
            </button>
            <button
              type="button"
              onClick={() => void p.toggle()}
              className="grid size-12 place-items-center rounded-full bg-paper text-night shadow-[0_0_0_6px_rgb(232_148_106/0.18)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
              aria-label={playing ? t('pause') : t('play')}
              disabled={p.status === 'loading'}
            >
              {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5 translate-x-px" />}
            </button>
            <button type="button" onClick={() => void p.skip(10)} className="hidden size-9 place-items-center rounded-full text-mist hover:bg-white/10 hover:text-paper sm:grid" aria-label={t('forward10')}>
              <Forward10Icon />
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-glow">
                  <Equalizer paused={!playing} />
                </span>
                {track.href ? (
                  <Link href={track.href} className="truncate font-medium text-paper hover:underline" dir="auto">
                    {track.title}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-paper" dir="auto">
                    {track.title}
                  </span>
                )}
                <span className="hidden shrink-0 text-mist md:inline" dir="auto">{track.subtitle}</span>
                {track.isReconstruction && (
                  <span className="hidden shrink-0 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-ink lg:inline">
                    {tr('reconstructionShort')}
                  </span>
                )}
              </div>
              <p className="shrink-0 text-xs tabular-nums text-mist" aria-hidden="true">
                {current} / {total}
              </p>
            </div>

            {/* Transparent range input over the canvas: mouse/touch and keyboard seek. */}
            <div className="relative mt-1 rounded focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-glow">
              <Waveform peaks={p.peaks} duration={p.duration} currentTime={p.currentTime} audio={p.audio} playing={playing} />
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(p.duration))}
                step={1}
                value={Math.floor(p.currentTime)}
                onChange={(e) => void p.seek(Number(e.target.value))}
                aria-label={t('seek')}
                aria-valuetext={t('position', { current, total })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => p.setLoop(!p.loop)}
            aria-pressed={p.loop}
            className="grid size-9 place-items-center rounded-full text-mist hover:bg-white/10 hover:text-paper aria-pressed:bg-white/15 aria-pressed:text-glow"
            aria-label={t('loop')}
            title={t('loop')}
          >
            <LoopIcon />
          </button>

          <label className="hidden items-center gap-2 text-mist md:flex">
            <VolumeIcon className="size-4" />
            <span className="sr-only">{t('volume')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(p.volume * 100)}
              onChange={(e) => p.setVolume(Number(e.target.value) / 100)}
              className="w-20 accent-glow"
            />
          </label>

          <p role="status" aria-live="polite" className="sr-only">
            {p.status === 'loading' ? t('loading') : p.status === 'error' ? t('error') : ''}
          </p>
          {p.status === 'error' && (
            <button type="button" onClick={() => void p.retry()} className="btn min-h-8 bg-white/10 py-1 text-sm text-paper hover:bg-white/20">
              {t('retry')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
