import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('checkTitle') };
}

export default async function CheckEmailPage() {
  const t = await getTranslations('auth');
  return (
    <div className="mx-auto max-w-md py-10 text-center motion-safe:animate-fade-up">
      <div className="mx-auto grid size-16 place-items-center rounded-full bg-accent-soft text-3xl" aria-hidden="true">
        ✉
      </div>
      <h1 className="mt-5 font-display text-3xl font-semibold">{t('checkTitle')}</h1>
      <p className="mt-3 text-muted">{t('checkBody')}</p>
      <Link href="/signin" className="btn btn-secondary mt-8">
        {t('useDifferentEmail')}
      </Link>
    </div>
  );
}
