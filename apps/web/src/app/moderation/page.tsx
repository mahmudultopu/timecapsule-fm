import { QueueItem, TakedownItem } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { z } from 'zod';
import { ChevronIcon, ClockIcon } from '@/components/ui/Icons';
import { apiAsViewer } from '@/lib/server/api';
import { requireModerator } from '@/lib/server/session';
import { TakedownCard } from './TakedownCard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('moderation'))('title') };
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModerator('/moderation');
  const tab = (await searchParams).tab === 'takedowns' ? 'takedowns' : 'queue';
  const t = await getTranslations('moderation');
  const format = await getFormatter();
  const [queue, takedowns] = await Promise.all([
    apiAsViewer(z.array(QueueItem), '/v1/moderation/queue'),
    apiAsViewer(z.array(TakedownItem), '/v1/moderation/takedowns'),
  ]);
  const openTakedowns = takedowns?.filter((x) => x.status === 'received').length ?? 0;

  const tabClass = (active: boolean) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${active ? 'bg-ink text-paper' : 'hover:bg-ink/5'}`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-4xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-muted">{t('lead')}</p>
      </header>

      <nav aria-label={t('sections')} className="flex gap-2">
        <Link href="/moderation" aria-current={tab === 'queue' ? 'page' : undefined} className={tabClass(tab === 'queue')}>
          {t('queueTab')} <span className="ms-1 opacity-70">{queue?.length ?? 0}</span>
        </Link>
        <Link href="/moderation?tab=takedowns" aria-current={tab === 'takedowns' ? 'page' : undefined} className={tabClass(tab === 'takedowns')}>
          {t('takedownsTab')} <span className="ms-1 opacity-70">{openTakedowns}</span>
        </Link>
      </nav>

      {tab === 'queue' ? (
        !queue?.length ? (
          <p className="card px-6 py-14 text-center font-display text-xl">{t('queueEmpty')}</p>
        ) : (
          <ul className="card divide-y divide-line">
            {queue.map((q) => (
              <li key={q.id}>
                <Link href={`/moderation/${q.id}`} className="group flex items-center gap-4 p-4 hover:bg-paper/70">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" dir="auto">{q.title}</p>
                    <p className="text-sm text-muted">
                      <span dir="auto">{q.cityEn}</span> · {q.eraYear} · {t('by', { name: q.contributor })}
                      {q.sourceType === 'community_reconstruction' && <span className="chip ms-2 bg-warn-bg text-warn-ink">{t('reconstruction')}</span>}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <ClockIcon className="size-3.5" />
                    {format.relativeTime(new Date(q.submittedAt))}
                  </span>
                  <ChevronIcon className="size-4 text-muted rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : !takedowns?.length ? (
        <p className="card px-6 py-14 text-center font-display text-xl">{t('takedownsEmpty')}</p>
      ) : (
        <ul className="space-y-3">
          {takedowns.map((item) => (
            <li key={item.id}>
              <TakedownCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
