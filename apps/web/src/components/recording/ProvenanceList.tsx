import { completeProvenance } from '@timecapsule/shared';
import { useTranslations } from 'next-intl';

/**
 * Renders every provenance field. If provenance is incomplete or invalid it
 * renders a notice instead — never a partial list. Callers must also hide
 * the recording itself in that case (see RecordingDetailView).
 */
export function ProvenanceList({ provenance }: { provenance: unknown }) {
  const t = useTranslations();
  const p = completeProvenance(provenance);
  if (!p) return <p role="alert">{t('provenance.unavailable')}</p>;

  const captured = p.capturedFrom === p.capturedTo ? p.capturedFrom : `${p.capturedFrom} – ${p.capturedTo}`;

  const rows: [string, string][] = [
    [t('provenance.sourceType'), t(`sourceType.${p.sourceType}`)],
    [t('provenance.captured'), captured],
    [t('provenance.dateConfidence'), t(`dateConfidence.${p.dateConfidence}`)],
    [t('provenance.recorder'), p.recorderName ?? t('provenance.unknownRecorder')],
    [t('provenance.locationPrecision'), t(`precision.${p.locationPrecision}`)],
    [t('provenance.rightsStatus'), t(`rightsStatus.${p.rightsStatus}`)],
    [t('provenance.license'), t(`license.${p.license}`)],
    [t('provenance.rightsHolder'), p.rightsHolder],
    [t('provenance.attribution'), p.attribution],
    [t('provenance.speech'), t(`speechConsent.${p.speechConsent}`)],
  ];

  return (
    <section aria-labelledby="provenance-heading" className="rounded-2xl border border-line p-4">
      <h3 id="provenance-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('provenance.heading')}
      </h3>
      <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd dir="auto" className="font-medium">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {p.syntheticDisclosure && (
        <div className="mt-4 rounded-xl border border-warn-ink/20 bg-warn-bg p-3 text-sm text-warn-ink">
          <p className="font-semibold">{t('provenance.howMade')}</p>
          <p dir="auto" className="mt-0.5">
            {p.syntheticDisclosure}
          </p>
        </div>
      )}
    </section>
  );
}
