import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <div className="mx-auto max-w-xl space-y-3 py-12 text-center">
      <h1 className="text-2xl font-semibold">{t('recording.notFound')}</h1>
      <Link href="/list" className="underline">
        {t('nav.list')}
      </Link>
    </div>
  );
}
