import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FilterBar } from '@/components/filters/FilterBar';
import { RecordingList } from '@/components/recording/RecordingList';
import { listRecordings } from '@/lib/api';
import { parseFilters, toSearchParams } from '@/lib/filters';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('list'))('heading') };
}

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('list');
  const filters = parseFilters(await searchParams);
  let page = null;
  let failed = false;
  try {
    page = await listRecordings(filters, undefined, { cache: 'no-store' });
  } catch {
    failed = true;
  }

  return (
    <div className="space-y-6">
      <header className="max-w-2xl motion-safe:animate-fade-up">
        <h1 className="font-display text-4xl font-semibold">{t('heading')}</h1>
        <p className="mt-2 text-muted">{t('lead')}</p>
      </header>
      <div className="card p-4">
        <FilterBar filters={filters} />
      </div>
      {failed || !page ? (
        <p role="alert" className="card p-6 text-danger">
          {t('error')}
        </p>
      ) : (
        <RecordingList key={toSearchParams(filters).toString()} initial={page} filters={filters} />
      )}
    </div>
  );
}
