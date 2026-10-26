'use client';

import type { TakedownItem } from '@timecapsule/shared';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client-api';

/** One takedown request with its resolve form (unpublish or decline, with a note). */
export function TakedownCard({ item }: { item: TakedownItem }) {
  const t = useTranslations('moderation');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const open = item.status === 'received';

  async function resolve(action: 'unpublish' | 'decline') {
    setBusy(true);
    try {
      await api(`/v1/moderation/takedowns/${item.id}/resolve`, { method: 'POST', body: { action, note } });
      toast(action === 'unpublish' ? t('takedownActioned') : t('takedownDeclined'));
      router.refresh();
    } catch {
      toast(t('actionFailed'), 'error');
      setBusy(false);
    }
  }

  return (
    <article className={`card p-5 ${open ? '' : 'opacity-75'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`chip ${open ? 'bg-warn-bg text-warn-ink' : 'bg-ink/8'}`}>{t(`takedownStatus.${item.status}`)}</span>
        <span className="chip">{t(`basis.${item.basis}`)}</span>
        <time className="ms-auto text-xs text-muted" dateTime={item.receivedAt}>
          {format.dateTime(new Date(item.receivedAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </header>
      <p className="mt-3 text-sm">
        {item.recordingId ? (
          <Link href={`/moderation/${item.recordingId}`} className="font-semibold underline" dir="auto">
            {item.recordingTitle ?? item.recordingId}
          </Link>
        ) : (
          <span className="text-muted">{t('unlinked')}</span>
        )}
        {item.targetUrl && <span className="block break-all text-xs text-muted">{item.targetUrl}</span>}
      </p>
      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-paper/70 p-3 text-sm" dir="auto">
        {item.statement}
      </p>
      <p className="mt-2 text-xs text-muted">
        {item.claimantName} · {item.claimantEmail}
      </p>

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div>
            <label htmlFor={noteId} className="label">{t('resolutionNote')}</label>
            <textarea id={noteId} className="field" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" disabled={busy || note.trim().length < 3 || !item.recordingId} onClick={() => void resolve('unpublish')}>
              {t('unpublishRecording')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy || note.trim().length < 3} onClick={() => void resolve('decline')}>
              {t('decline')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
