'use client';

import type { RecordingDetail } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { getRecording } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { CATEGORY_COLORS } from '@/lib/format';
import { FilterBar } from '../filters/FilterBar';
import { usePlayer } from '../player/PlayerProvider';
import { RecordingDetailView } from '../recording/RecordingDetailView';
import { ChevronIcon, CloseIcon, Equalizer } from '../ui/Icons';
import { MapExplorer, type PinsState } from './MapExplorer';

type Panel =
  | { state: 'closed' }
  | { state: 'loading'; id: string }
  | { state: 'ready'; recording: RecordingDetail }
  | { state: 'missing'; id: string };

/**
 * Map explorer layout. On large screens the map fills the frame and the
 * filters, "in view" list and detail panel float over it; on small screens
 * they stack below the map.
 */
export function ExploreView({
  filters,
  initialSelected,
  initialRecording,
  styleUrl,
  workerUrl,
}: {
  filters: Filters;
  initialSelected: string | null;
  /** Fetched on the server for shared links (?r=…), so the panel is in the first HTML. */
  initialRecording: RecordingDetail | null;
  styleUrl: string;
  workerUrl: string;
}) {
  const t = useTranslations();
  const player = usePlayer();
  const [panel, setPanel] = useState<Panel>(() => {
    if (initialRecording) return { state: 'ready', recording: initialRecording };
    return initialSelected ? { state: 'missing', id: initialSelected } : { state: 'closed' };
  });
  const [pins, setPins] = useState<PinsState>({ pins: [], truncated: false, failed: false });
  const panelRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  const loadDetail = useCallback(async (id: string) => {
    const mine = ++requestId.current;
    try {
      const rec = await getRecording(id);
      if (mine !== requestId.current) return;
      setPanel(rec ? { state: 'ready', recording: rec } : { state: 'missing', id });
      panelRef.current?.focus();
    } catch {
      if (mine === requestId.current) setPanel({ state: 'missing', id });
    }
  }, []);

  const select = useCallback(
    (id: string | null) => {
      // Keep the selection shareable without a server round-trip.
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('r', id);
      else url.searchParams.delete('r');
      window.history.replaceState(null, '', url);

      if (!id) {
        requestId.current++;
        setPanel({ state: 'closed' });
        return;
      }
      setPanel({ state: 'loading', id });
      void loadDetail(id);
    },
    [loadDetail],
  );

  const selectedId = panel.state === 'ready' ? panel.recording.id : panel.state === 'loading' ? panel.id : null;

  return (
    <div className="relative -mx-4 -mt-5 flex flex-col lg:mx-0 lg:mt-0 lg:block lg:h-[calc(100dvh-10.5rem)] lg:min-h-[36rem] lg:overflow-hidden lg:rounded-3xl lg:border lg:border-line lg:shadow-[var(--shadow-lift)]">
      <div className="h-[52vh] min-h-80 lg:absolute lg:inset-0 lg:h-auto">
        <MapExplorer
          styleUrl={styleUrl}
          workerUrl={workerUrl}
          filters={filters}
          selectedId={selectedId}
          onSelect={select}
          onPins={setPins}
        />
      </div>

      <div className="flex flex-col gap-3 p-4 lg:pointer-events-none lg:absolute lg:inset-0 lg:flex-row lg:items-start lg:p-4">
        {/* Filters and the keyboard-friendly list of what's on the map. */}
        <div className="glass flex flex-col rounded-2xl p-4 lg:pointer-events-auto lg:max-h-[calc(100%-3rem)] lg:w-[21rem] motion-safe:animate-fade-up">
          <h1 className="font-display text-2xl font-semibold leading-tight">{t('explore.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('explore.lead')}</p>
          <div className="mt-4">
            <FilterBar filters={filters} showSearch={false} compact />
          </div>

          <section aria-labelledby="in-view" className="mt-4 flex min-h-0 flex-1 flex-col border-t border-line pt-3">
            <h2 id="in-view" className="mb-2 font-sans text-sm font-semibold" aria-live="polite">
              {t('map.inView', { count: pins.pins.length })}
            </h2>
            {pins.failed && (
              <p role="alert" className="text-sm text-danger">
                {t('map.loadError')}
              </p>
            )}
            {pins.truncated && <p className="text-xs text-muted">{t('map.truncated', { count: pins.pins.length })}</p>}
            <ul className="-mx-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto lg:max-h-none">
              {pins.pins.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => select(p.id)}
                    aria-current={p.id === selectedId ? 'true' : undefined}
                    className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors hover:bg-ink/5 aria-[current=true]:bg-accent-soft"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: CATEGORY_COLORS[p.properties.category] }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" dir="auto">
                        {p.properties.title}
                      </span>
                      <span className="text-xs text-muted">
                        {p.properties.eraYear} · {t(`category.${p.properties.category}`)}
                        {p.properties.sourceType === 'community_reconstruction' && (
                          <span className="ms-1.5 font-semibold text-warn-ink">{t('recording.reconstructionShort')}</span>
                        )}
                      </span>
                    </span>
                    {player.track?.id === p.id ? (
                      <span className="text-accent">
                        <Equalizer paused={player.status !== 'playing'} />
                      </span>
                    ) : (
                      <ChevronIcon className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="hidden flex-1 lg:block" />

        {panel.state !== 'closed' && (
          <aside
            ref={panelRef}
            tabIndex={-1}
            aria-busy={panel.state === 'loading'}
            aria-label={t('recording.details')}
            className="glass relative overflow-y-auto rounded-2xl p-5 outline-none lg:pointer-events-auto lg:max-h-[calc(100%-4.5rem)] lg:w-[27rem] motion-safe:animate-slide-in"
          >
            <button
              type="button"
              onClick={() => select(null)}
              className="absolute end-3 top-3 grid size-9 place-items-center rounded-full hover:bg-ink/5"
              aria-label={t('recording.close')}
            >
              <CloseIcon />
            </button>
            {panel.state === 'loading' && (
              <div className="space-y-3 pe-10" aria-hidden="true">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-7 w-3/4" />
                <div className="skeleton h-24 w-full" />
                <div className="skeleton h-40 w-full" />
              </div>
            )}
            {panel.state === 'missing' && <p role="alert">{t('recording.notFound')}</p>}
            {panel.state === 'ready' && (
              <>
                <RecordingDetailView recording={panel.recording} />
                <Link href={`/recordings/${panel.recording.id}`} className="btn btn-secondary mt-5 w-full">
                  {t('recording.openPage')}
                </Link>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
