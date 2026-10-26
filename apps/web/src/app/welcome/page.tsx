import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getViewer, safeReturnTo } from '@/lib/server/session';
import { WelcomeForm } from './WelcomeForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('welcome'))('title') };
}

/** First-run step: public name and the 16+ confirmation, before contributing. */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const returnTo = safeReturnTo((await searchParams).returnTo, '/contribute');
  const viewer = await getViewer();
  if (!viewer) redirect(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  if (viewer.onboarded) redirect(returnTo);
  const t = await getTranslations('welcome');
  return (
    <div className="mx-auto w-full max-w-lg py-6">
      <div className="card p-6 sm:p-8 motion-safe:animate-fade-up">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-muted">{t('lead')}</p>
        <WelcomeForm returnTo={returnTo} initialName={viewer.displayName ?? ''} />
      </div>
    </div>
  );
}
