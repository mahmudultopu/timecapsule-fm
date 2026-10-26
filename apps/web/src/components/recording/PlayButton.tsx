'use client';

import type { RecordingSummary } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { PauseIcon, PlayIcon } from '../ui/Icons';
import { trackFromRecording, usePlayer } from '../player/PlayerProvider';

export function PlayButton({ recording, className = '' }: { recording: RecordingSummary; className?: string }) {
  const t = useTranslations('recording');
  const player = usePlayer();
  const active = player.track?.id === recording.id;
  const playing = active && (player.status === 'playing' || player.status === 'loading');
  return (
    <button
      type="button"
      onClick={() => void player.play(trackFromRecording(recording))}
      aria-pressed={playing}
      aria-label={playing ? t('pause', { title: recording.title.en }) : t('play', { title: recording.title.en })}
      className={`btn-icon ${active ? 'bg-accent' : ''} ${className}`}
    >
      {playing ? <PauseIcon /> : <PlayIcon className="size-5 translate-x-px" />}
    </button>
  );
}
