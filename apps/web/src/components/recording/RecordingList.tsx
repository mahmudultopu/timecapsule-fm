'use client';

import { completeProvenance, type RecordingPage, type RecordingSummary } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { listRecordings } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { CATEGORY_COLORS, formatDuration } from '@/lib/format';
import { usePlayer } from '../player/PlayerProvider';
import { Equalizer } from '../ui/Icons';
import { RecordingBadges } from './Badges';
import { PlayButton } from './PlayButton';

/**
 * Keyboard- and screen-reader-friendly alternative to the map. The first
 * page is rendered on the server; "Load more" fetches further pages.
 * Callers key this component by the filter query so new filters remount it.
 */
export function RecordingList({ initial, filters }: { initial: RecordingPage; filters: Filters }) {
  const t = useTranslations();
  const player = usePlayer();
  const [items, setItems] = useState<RecordingSummary[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    setError(false);
    try {
      const page = await listRecordings(filters, cursor);
      if (page) {
        setItems((xs) => [...xs, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const visible = items.filter((r) => completeProvenance(r.provenance));
  if (visible.length === 0) {
    return (
      <div className="card px-6 py-14 text-center">
        <p className="font-display text-xl">{t('list.empty')}</p>
        <p className="mt-1 text-sm text-muted">{t('list.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div>
      <ul className="grid gap-3 md:grid-cols-2">
        {visible.map((r, i) => {
          const active = player.track?.id === r.id;
          return (
            <li
              key={r.id}
              className={`card flex items-start gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-lift)] motion-safe:animate-fade-up ${active ? 'ring-2 ring-accent/40' : ''}`}
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            >
              <PlayButton recording={r} className="shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  {active && (
                    <span className="text-accent">
                      <Equalizer paused={player.status !== 'playing'} />
                    </span>
                  )}
                  <Link
                    href={`/recordings/${r.id}`}
                    className="font-semibold leading-snug underline-offset-2 hover:underline"
                    dir="auto"
                  >
                    {r.title.en}
                  </Link>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <span dir="auto">{r.place.cityEn}</span>
                  <span aria-hidden="true">·</span>
                  <span>{r.eraYear}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[r.category] }} aria-hidden="true" />
                    {t(`category.${r.category}`)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{formatDuration(r.durationMs)}</span>
                </p>
                <p className="text-xs text-muted">{t(`license.${r.provenance.license}`)}</p>
                <RecordingBadges sourceType={r.provenance.sourceType} isDemo={r.isDemo} />
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="py-2 text-sm text-danger">
          {t('list.error')}
        </p>
      )}
      {cursor && (
        <div className="py-6 text-center">
          <button type="button" className="btn btn-secondary" onClick={() => void loadMore()} disabled={loading} aria-busy={loading}>
            {loading ? t('common.loading') : t('list.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
