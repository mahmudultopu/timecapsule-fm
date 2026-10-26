'use client';

import {
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  SNIFF_BYTES,
  SubmissionDetail,
  UploadIntent,
  sniffAudioFormat,
  type SubmissionDetail as Detail,
} from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { api, putWithProgress } from '@/lib/client-api';
import { formatDuration } from '@/lib/format';
import { usePlayer } from '../player/PlayerProvider';
import { PauseIcon, PlayIcon, UploadIcon } from '../ui/Icons';

type Phase = { kind: 'idle' } | { kind: 'checking' } | { kind: 'uploading'; progress: number } | { kind: 'error'; message: string };

/** Best-effort duration read; formats the browser can't decode just skip the check (the worker enforces it). */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    audio.src = url;
  });
}

export function AudioStep({
  detail,
  locked,
  onDetail,
}: {
  detail: Detail;
  locked: boolean;
  onDetail: (d: Detail) => void;
}) {
  const t = useTranslations('editor');
  const player = usePlayer();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const busy = phase.kind === 'checking' || phase.kind === 'uploading';

  async function handle(file: File) {
    setPhase({ kind: 'checking' });
    // Quick client-side checks for fast feedback; the server and worker
    // repeat every one of them.
    if (file.size > MAX_UPLOAD_BYTES) return setPhase({ kind: 'error', message: t('audio.tooLarge') });
    const format = sniffAudioFormat(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
    if (!format) return setPhase({ kind: 'error', message: t('audio.unsupported') });
    const seconds = await readDuration(file);
    if (seconds !== null && seconds > MAX_DURATION_SECONDS) return setPhase({ kind: 'error', message: t('audio.tooLong') });

    try {
      const intent = await api(`/v1/submissions/${detail.id}/upload-intent`, {
        method: 'POST',
        body: { bytes: file.size, format },
        schema: UploadIntent,
      });
      setPhase({ kind: 'uploading', progress: 0 });
      await putWithProgress(intent.url, file, intent.headers, (progress) => setPhase({ kind: 'uploading', progress }));
      const next = await api(`/v1/submissions/${detail.id}/upload-complete`, {
        method: 'POST',
        body: { uploadId: intent.uploadId },
        schema: SubmissionDetail,
      });
      onDetail(next);
      setPhase({ kind: 'idle' });
    } catch {
      setPhase({ kind: 'error', message: t('audio.uploadFailed') });
    }
  }

  const processing = detail.status === 'processing';
  const failed = detail.status === 'processing_failed' || detail.upload?.status === 'rejected';
  const ready = detail.durationMs !== null && !processing;
  const previewing = player.track?.id === detail.id && player.status === 'playing';

  return (
    <div className="space-y-4">
      {ready && (
        <div className="flex items-center gap-4 rounded-2xl bg-success-bg p-4">
          <button
            type="button"
            className="btn-icon bg-success"
            aria-label={previewing ? t('audio.pausePreview') : t('audio.preview')}
            onClick={() =>
              void player.play({
                id: detail.id,
                title: detail.fields.titleEn ?? t('untitled'),
                subtitle: t('audio.previewSubtitle'),
                durationMs: detail.durationMs!,
                isReconstruction: detail.fields.sourceType === 'community_reconstruction',
                href: null,
                source: 'submission',
              })
            }
          >
            {previewing ? <PauseIcon /> : <PlayIcon className="size-5 translate-x-px" />}
          </button>
          <div className="text-sm">
            <p className="font-semibold text-success">{t('audio.ready')}</p>
            <p className="text-muted">{t('audio.readyDetail', { duration: formatDuration(detail.durationMs!) })}</p>
          </div>
        </div>
      )}

      {processing && (
        <div className="flex items-center gap-3 rounded-2xl bg-[#e6ecfb] p-4 text-sm text-[#1d3fa8]" role="status">
          <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t('audio.processing')}</span> {t('audio.processingDetail')}
          </span>
        </div>
      )}

      {failed && !processing && detail.upload?.rejectionCode && (
        <p role="alert" className="rounded-2xl bg-danger-bg p-4 text-sm text-danger">
          {t(`rejection.${detail.upload.rejectionCode in REJECTION_KEYS ? (detail.upload.rejectionCode as RejectionKey) : 'processing_error'}`)}
        </p>
      )}

      {!locked && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && !busy) void handle(file);
          }}
          className={`relative rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
            dragging ? 'border-accent bg-accent-soft' : 'border-line bg-paper/50 hover:border-muted'
          }`}
        >
          <UploadIcon className="mx-auto size-8 text-accent" />
          <p className="mt-2 font-semibold">{ready || failed ? t('audio.replace') : t('audio.drop')}</p>
          <p className="mt-1 text-sm text-muted">{t('audio.limits')}</p>
          <label htmlFor={inputId} className="btn btn-secondary mt-4 cursor-pointer">
            {t('audio.choose')}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".wav,.flac,.mp3,.ogg,audio/wav,audio/flac,audio/mpeg,audio/ogg"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handle(file);
              e.target.value = '';
            }}
          />

          {phase.kind === 'uploading' && (
            <div className="mx-auto mt-5 max-w-sm" role="status" aria-live="polite">
              <div
                className="h-2 overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-label={t('audio.uploading')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(phase.progress * 100)}
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${phase.progress * 100}%` }} />
              </div>
              <p className="mt-2 text-sm tabular-nums text-muted">
                {t('audio.uploading')} {Math.round(phase.progress * 100)}%
              </p>
            </div>
          )}
          {phase.kind === 'checking' && <p className="mt-4 text-sm text-muted" role="status">{t('audio.checking')}</p>}
          {phase.kind === 'error' && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {phase.message}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted">{t('audio.privacy')}</p>
    </div>
  );
}

const REJECTION_KEYS = {
  unsupported_format: 1,
  format_mismatch: 1,
  unreadable_audio: 1,
  no_audio_stream: 1,
  too_long: 1,
  too_short: 1,
  too_large: 1,
  missing_object: 1,
  processing_timeout: 1,
  processing_error: 1,
} as const;
type RejectionKey = keyof typeof REJECTION_KEYS;
