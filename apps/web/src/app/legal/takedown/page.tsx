import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TakedownForm } from './TakedownForm';

// ⚖️ PLACEHOLDER contact details. A US DMCA safe harbor requires a designated
// agent registered with the U.S. Copyright Office; confirm before launch.
const TAKEDOWN_EMAIL = process.env.TAKEDOWN_EMAIL ?? 'legal@example.com';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('legal'))('takedownTitle') };
}

export default async function TakedownPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('legal');
  const recording = (await searchParams).recording;
  const prefill = typeof recording === 'string' && /^[0-9a-f-]{36}$/.test(recording) ? `/recordings/${recording}` : '';

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_1.2fr]">
      <article className="space-y-4">
        <h1 className="font-display text-4xl font-semibold">{t('takedownTitle')}</h1>
        <p className="text-muted">{t('takedownIntro')}</p>

        <p role="note" className="rounded-2xl border border-warn-ink/20 bg-warn-bg p-4 text-sm text-warn-ink">
          {t('placeholderNotice')}
        </p>

        <h2 className="font-display text-xl font-semibold">{t('contactHeading')}</h2>
        <p>
          {t('contactEmailLabel')}:{' '}
          <a className="underline" href={`mailto:${TAKEDOWN_EMAIL}`}>
            {TAKEDOWN_EMAIL}
          </a>
        </p>

        <h2 className="font-display text-xl font-semibold">{t('agentHeading')}</h2>
        <address className="not-italic text-muted">
          {t('agentPlaceholder')}
          <br />
          {TAKEDOWN_EMAIL}
        </address>

        <h2 className="font-display text-xl font-semibold">{t('includeHeading')}</h2>
        <ul className="list-disc space-y-1 ps-6 text-muted">
          <li>{t('include1')}</li>
          <li>{t('include2')}</li>
          <li>{t('include3')}</li>
          <li>{t('include4')}</li>
        </ul>
      </article>

      <section className="card h-fit p-6" aria-labelledby="takedown-form-title">
        <h2 id="takedown-form-title" className="font-display text-2xl font-semibold">
          {t('formTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('formLead')}</p>
        <TakedownForm prefillUrl={prefill} />
      </section>
    </div>
  );
}
