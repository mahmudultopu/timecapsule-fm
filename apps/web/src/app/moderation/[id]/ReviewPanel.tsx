'use client';

import type { SubmissionDetail } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { CheckboxField } from '@/components/contribute/fields';
import { usePlayer } from '@/components/player/PlayerProvider';
import { PauseIcon, PlayIcon } from '@/components/ui/Icons';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError, api } from '@/lib/client-api';
import { formatDuration } from '@/lib/format';

const CHECKS = ['audioQuality', 'rights', 'location', 'noPrivateSpeech'] as const;

/**
 * Listen, tick the checklist, decide. Approving needs every box ticked;
 * rejecting needs a reason, which the contributor will see.
 */
export function ReviewPanel({ detail }: { detail: SubmissionDetail }) {
  const t = useTranslations('moderation');
  const player = usePlayer();
  const router = useRouter();
  const toast = useToast();
  const reasonId = useId();
  const [checks, setChecks] = useState<Record<(typeof CHECKS)[number], boolean>>({
    audioQuality: false,
    rights: false,
    location: false,
    noPrivateSpeech: false,
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const allChecked = CHECKS.every((c) => checks[c]);
  const previewing = player.track?.id === detail.id && player.status === 'playing';

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api(`/v1/moderation/submissions/${detail.id}/decision`, {
        method: 'POST',
        body: decision === 'approve' ? { decision, checklist: checks } : { decision, checklist: checks, reason },
      });
      toast(decision === 'approve' ? t('approved') : t('rejected'));
      router.push('/moderation');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiRequestError && err.code === 'own_submission' ? t('ownSubmission') : t('actionFailed'), 'error');
      setBusy(false);
    }
  }

  async function unpublish() {
    if (reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/v1/moderation/recordings/${detail.id}/unpublish`, { method: 'POST', body: { reason } });
      toast(t('unpublished'));
      router.refresh();
    } catch {
      toast(t('actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="space-y-5 lg:sticky lg:top-20 lg:h-fit">
      {detail.durationMs && (
        <div className="card flex items-center gap-4 p-4">
          <button
            type="button"
            className="btn-icon size-12"
            aria-label={previewing ? t('pausePreview') : t('playPreview')}
            onClick={() =>
              void player.play({
                id: detail.id,
                title: detail.fields.titleEn ?? '',
                subtitle: t('reviewing'),
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
            <p className="font-semibold">{t('listenFirst')}</p>
            <p className="text-muted tabular-nums">{formatDuration(detail.durationMs)}</p>
          </div>
        </div>
      )}

      {detail.status === 'pending_review' && (
        <section className="card space-y-4 p-5" aria-labelledby="checklist-title">
          <h2 id="checklist-title" className="font-display text-xl font-semibold">
            {t('checklist')}
          </h2>
          <div className="space-y-2">
            {CHECKS.map((c) => (
              <CheckboxField key={c} label={t(`checks.${c}.label`)} help={t(`checks.${c}.help`)} checked={checks[c]} onChange={(v) => setChecks((s) => ({ ...s, [c]: v }))} />
            ))}
          </div>
          <div>
            <label htmlFor={reasonId} className="label">{t('reason')}</label>
            <textarea id={reasonId} className="field" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${reasonId}-help`} />
            <p id={`${reasonId}-help`} className="help">{t('reasonHelp')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-accent flex-1" disabled={busy || !allChecked} onClick={() => void decide('approve')}>
              {t('approve')}
            </button>
            <button type="button" className="btn btn-secondary flex-1" disabled={busy || reason.trim().length < 10} onClick={() => void decide('reject')}>
              {t('reject')}
            </button>
          </div>
          {!allChecked && <p className="text-xs text-muted">{t('approveNeedsAll')}</p>}
        </section>
      )}

      {detail.status === 'published' && (
        <section className="card space-y-3 p-5">
          <h2 className="font-display text-xl font-semibold">{t('unpublishTitle')}</h2>
          <label htmlFor={reasonId} className="label">{t('unpublishReason')}</label>
          <textarea id={reasonId} className="field" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void unpublish()}>
            {t('unpublishRecording')}
          </button>
        </section>
      )}
    </aside>
  );
}
