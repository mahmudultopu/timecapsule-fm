import { Notification, Profile } from '@timecapsule/shared';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { z } from 'zod';
import { apiAsViewer } from '@/lib/server/api';
import { requireViewer } from '@/lib/server/session';
import { MarkReadButton, ProfileForm } from './AccountForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('account'))('title') };
}

export default async function AccountPage() {
  await requireViewer('/account');
  const t = await getTranslations('account');
  const format = await getFormatter();
  const [profile, notifications] = await Promise.all([
    apiAsViewer(Profile, '/v1/me'),
    apiAsViewer(z.array(Notification), '/v1/me/notifications'),
  ]);
  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_1.4fr]">
      <header className="lg:col-span-2">
        <h1 className="font-display text-4xl font-semibold">{t('title')}</h1>
      </header>

      <section className="card h-fit p-6" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="font-display text-xl font-semibold">
          {t('profile')}
        </h2>
        {profile && <ProfileForm profile={profile} />}
      </section>

      <section className="card p-6" aria-labelledby="notifications-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="notifications-heading" className="font-display text-xl font-semibold">
            {t('notifications')}
            {unread > 0 && <span className="chip ms-2 bg-accent text-white align-middle">{unread}</span>}
          </h2>
          {unread > 0 && <MarkReadButton />}
        </div>
        {!notifications?.length ? (
          <p className="mt-4 text-sm text-muted">{t('noNotifications')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {notifications.map((n) => (
              <li key={n.id} className="flex gap-3 py-3">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-accent'}`}
                  aria-label={n.readAt ? undefined : t('unread')}
                  role={n.readAt ? undefined : 'img'}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p dir="auto">{n.message}</p>
                  <p className="mt-1 flex gap-3 text-xs text-muted">
                    <time dateTime={n.createdAt}>{format.relativeTime(new Date(n.createdAt))}</time>
                    {n.recordingId && (
                      <Link href={`/contribute/${n.recordingId}`} className="underline hover:text-ink">
                        {t('viewSubmission')}
                      </Link>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
