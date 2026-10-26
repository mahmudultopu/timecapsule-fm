import { Agreement } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiAsViewer } from '@/lib/server/api';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('footer'))('agreement') };
}

export default async function AgreementPage() {
  const t = await getTranslations();
  const agreement = await apiAsViewer(Agreement, '/v1/agreements/current').catch(() => null);
  return (
    <article className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="font-display text-4xl font-semibold">{t('footer.agreement')}</h1>
      {agreement ? (
        <>
          <p className="text-sm text-muted">{t('legal.agreementVersion', { version: agreement.version })}</p>
          {agreement.isDraft && (
            <p role="note" className="rounded-2xl bg-warn-bg p-4 text-sm text-warn-ink">
              {t('editor.agreementDraft')}
            </p>
          )}
          {/* Rendered as plain text, never HTML. */}
          <div className="card whitespace-pre-wrap p-6 leading-relaxed">{agreement.bodyMd}</div>
        </>
      ) : (
        <p className="card p-6 text-muted">{t('editor.noAgreement')}</p>
      )}
    </article>
  );
}
