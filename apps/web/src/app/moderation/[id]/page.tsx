import { RecordingId, SubmissionDetail } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/contribute/StatusBadge';
import { apiAsViewer } from '@/lib/server/api';
import { requireModerator } from '@/lib/server/session';
import { ReviewPanel } from './ReviewPanel';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('moderation'))('reviewTitle') };
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireModerator(`/moderation/${id}`);
  if (!RecordingId.safeParse(id).success) notFound();
  const detail = await apiAsViewer(SubmissionDetail, `/v1/moderation/submissions/${id}`);
  if (!detail) notFound();
  const t = await getTranslations();
  const f = detail.fields;

  // Everything the moderator needs to judge, as plain text.
  const rows: [string, string | null][] = [
    [t('editor.f.placeNameEn'), [f.placeNameEn, f.placeNameLocal].filter(Boolean).join(' / ')],
    [t('editor.f.cityEn'), [f.cityEn, f.cityLocal, f.countryCode].filter(Boolean).join(' / ')],
    [t('editor.f.category'), f.category && t(`category.${f.category}`)],
    [t('editor.f.eraYear'), f.eraYear?.toString() ?? null],
    [t('provenance.captured'), f.capturedFrom && `${f.capturedFrom} – ${f.capturedTo}`],
    [t('provenance.dateConfidence'), f.dateConfidence && t(`dateConfidence.${f.dateConfidence}`)],
    [t('provenance.sourceType'), f.sourceType && t(`sourceType.${f.sourceType}`)],
    [t('provenance.howMade'), f.syntheticDisclosure],
    [t('provenance.recorder'), f.recorderName ?? t('provenance.unknownRecorder')],
    [t('provenance.locationPrecision'), f.locationPrecision && t(`precision.${f.locationPrecision}`)],
    [t('moderation.coordinates'), f.location && `${f.location.lat}, ${f.location.lon}`],
    [t('provenance.license'), f.license && t(`license.${f.license}`)],
    [t('provenance.rightsStatus'), f.rightsStatus && t(`rightsStatus.${f.rightsStatus}`)],
    [t('provenance.rightsHolder'), f.rightsHolder],
    [t('provenance.attribution'), f.attribution],
    [t('provenance.speech'), f.speechConsent && t(`speechConsent.${f.speechConsent}`)],
  ];

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-5">
        <Link href="/moderation" className="text-sm text-muted hover:text-ink">
          ← {t('moderation.backToQueue')}
        </Link>
        <article className="card space-y-5 p-6">
          <header className="space-y-2">
            <StatusBadge status={detail.status} />
            <h1 className="font-display text-3xl font-semibold" dir="auto">
              {f.titleEn}
            </h1>
            {f.titleLocal && (
              <p lang={f.titleLocalLang ?? undefined} dir="auto" className="text-muted">
                {f.titleLocal}
              </p>
            )}
          </header>
          <section className="rounded-2xl bg-paper/80 p-4">
            <h2 className="mb-1 font-sans text-xs font-semibold uppercase tracking-wider text-muted">{t('recording.scene')}</h2>
            <p dir="auto">{f.sceneDescriptionEn}</p>
            {f.sceneDescriptionLocal && <p dir="auto" className="mt-2 text-muted">{f.sceneDescriptionLocal}</p>}
          </section>
          <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm">
            {rows
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-medium" dir="auto">{value}</dd>
                </div>
              ))}
          </dl>
          <p className="text-xs text-muted">
            {t('moderation.agreement', { version: detail.agreementVersion ?? '—' })}
          </p>
        </article>
      </div>

      <ReviewPanel detail={detail} />
    </div>
  );
}
