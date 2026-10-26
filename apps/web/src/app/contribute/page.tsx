import { SubmissionSummary } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { z } from 'zod';
import { StatusBadge } from '@/components/contribute/StatusBadge';
import { ChevronIcon } from '@/components/ui/Icons';
import { apiAsViewer } from '@/lib/server/api';
import { requireViewer } from '@/lib/server/session';
import { NewSubmissionButton } from './NewSubmissionButton';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('contribute'))('title') };
}

export default async function ContributePage() {
  await requireViewer('/contribute');
  const t = await getTranslations('contribute');
  const format = await getFormatter();
  const items = (await apiAsViewer(z.array(SubmissionSummary), '/v1/me/submissions')) ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="font-display text-4xl font-semibold">{t('title')}</h1>
          <p className="mt-2 text-muted">{t('lead')}</p>
        </div>
        <NewSubmissionButton />
      </header>

      <ol className="grid gap-3 sm:grid-cols-3">
        {(['step1', 'step2', 'step3'] as const).map((step, i) => (
          <li key={step} className="card flex gap-3 p-4 text-sm">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{i + 1}</span>
            <span>{t(step)}</span>
          </li>
        ))}
      </ol>

      {items.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="font-display text-xl">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((s) => (
            <li key={s.id}>
              <Link href={`/contribute/${s.id}`} className="group flex items-center gap-4 p-4 transition-colors hover:bg-paper/70">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold" dir="auto">
                    {s.title ?? t('untitled')}
                  </p>
                  <p className="text-sm text-muted">
                    {[s.cityEn, s.eraYear].filter(Boolean).join(' · ') || '—'} ·{' '}
                    {t('updated', { when: format.relativeTime(new Date(s.updatedAt)) })}
                  </p>
                </div>
                <StatusBadge status={s.status} />
                <ChevronIcon className="size-4 text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
