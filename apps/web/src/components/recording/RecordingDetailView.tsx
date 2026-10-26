import { completeProvenance, type RecordingDetail } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';
import { CATEGORY_COLORS, formatDuration } from '@/lib/format';
import { ClockIcon, PinIcon } from '../ui/Icons';
import { RecordingBadges } from './Badges';
import { PlayButton } from './PlayButton';
import { ProvenanceList } from './ProvenanceList';

/**
 * Shared by the map side panel and the recording page. All contributor text
 * is rendered as text nodes (React escapes it); local-language strings carry
 * their own lang and dir="auto" so mixed RTL/LTR content displays correctly.
 */
export function RecordingDetailView({
  recording: r,
  headingLevel = 2,
}: {
  recording: RecordingDetail;
  headingLevel?: 1 | 2;
}) {
  const t = useTranslations();
  // Never display a recording without provenance.
  if (!completeProvenance(r.provenance)) return <p role="alert">{t('provenance.unavailable')}</p>;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const lang = r.title.localLang ?? undefined;
  const localPlace = [r.place.nameLocal, r.place.cityLocal].filter(Boolean).join(' · ');

  return (
    <article className="space-y-5" aria-labelledby={`rec-${r.id}`}>
      <header className="space-y-3 pe-10">
        <RecordingBadges sourceType={r.provenance.sourceType} isDemo={r.isDemo} />
        <div className="flex items-start gap-4">
          <PlayButton recording={r} className="mt-1 size-12 shrink-0" />
          <div className="min-w-0">
            <Heading
              id={`rec-${r.id}`}
              className={`font-display font-semibold leading-tight ${headingLevel === 1 ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}
              dir="auto"
            >
              {r.title.en}
            </Heading>
            {r.title.local && (
              <p lang={lang} dir="auto" className="mt-1 text-muted">
                {r.title.local}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="chip">
          <PinIcon className="size-3.5" />
          <span dir="auto">
            {r.place.nameEn}, {r.place.cityEn}
          </span>
        </span>
        <span className="chip">{t('recording.eraValue', { year: r.eraYear, decade: r.decade })}</span>
        <span className="chip tabular-nums">
          <ClockIcon className="size-3.5" />
          {formatDuration(r.durationMs)}
        </span>
        <span className="chip">
          <span className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[r.category] }} aria-hidden="true" />
          {t(`category.${r.category}`)}
        </span>
      </div>

      {localPlace && (
        <p lang={lang} dir="auto" className="-mt-2 text-sm text-muted">
          {localPlace}
        </p>
      )}

      <section aria-labelledby={`scene-${r.id}`} className="rounded-2xl bg-paper/80 p-4">
        <h3 id={`scene-${r.id}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('recording.scene')}
        </h3>
        <p dir="auto" className="leading-relaxed">
          {r.sceneDescription.en}
        </p>
        {r.sceneDescription.local && (
          <p lang={lang} dir="auto" className="mt-2 leading-relaxed text-muted">
            {r.sceneDescription.local}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          {t('recording.contributor')}: <span dir="auto">{r.contributor.displayName}</span>
        </p>
      </section>

      <ProvenanceList provenance={r.provenance} />
    </article>
  );
}
