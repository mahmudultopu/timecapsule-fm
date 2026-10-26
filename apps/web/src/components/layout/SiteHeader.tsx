import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { signOut } from '@/auth';
import { getViewer } from '@/lib/server/session';
import { LogoMark } from '../ui/Logo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NavLink } from './NavLink';

export async function SiteHeader() {
  const t = await getTranslations('nav');
  const viewer = await getViewer();
  const isModerator = viewer?.role === 'moderator' || viewer?.role === 'admin';

  return (
    <header className="glass-night sticky top-0 z-40 border-b border-white/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2.5 text-paper">
          <LogoMark />
          <span className="font-display text-xl font-semibold tracking-tight">TimeCapsule.fm</span>
        </Link>

        <nav aria-label={t('primary')} className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex gap-1 overflow-x-auto text-sm">
            <li><NavLink href="/">{t('explore')}</NavLink></li>
            <li><NavLink href="/list">{t('list')}</NavLink></li>
            <li><NavLink href="/contribute">{t('contribute')}</NavLink></li>
            {isModerator && <li><NavLink href="/moderation">{t('moderation')}</NavLink></li>}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LanguageSwitcher />
          {viewer ? (
            <details className="group relative">
              <summary
                className="flex cursor-pointer list-none items-center gap-2 rounded-full bg-white/10 py-1 ps-1 pe-3 text-sm text-paper hover:bg-white/15 [&::-webkit-details-marker]:hidden"
                aria-label={t('accountMenu')}
              >
                <span className="grid size-7 place-items-center rounded-full bg-glow font-semibold text-night" aria-hidden="true">
                  {(viewer.displayName ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-32 truncate">{viewer.displayName ?? t('account')}</span>
              </summary>
              <div className="card absolute end-0 top-full z-50 mt-2 w-52 p-1.5 text-ink motion-safe:animate-fade-up">
                <Link href="/account" className="block rounded-lg px-3 py-2 text-sm hover:bg-paper">{t('account')}</Link>
                <Link href="/contribute" className="block rounded-lg px-3 py-2 text-sm hover:bg-paper">{t('mySubmissions')}</Link>
                {isModerator && (
                  <Link href="/moderation" className="block rounded-lg px-3 py-2 text-sm hover:bg-paper">{t('moderation')}</Link>
                )}
                <form
                  action={async () => {
                    'use server';
                    await signOut({ redirectTo: '/' });
                  }}
                >
                  <button type="submit" className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-paper">
                    {t('signOut')}
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <Link href="/signin" className="btn btn-accent min-h-9 py-1.5 text-sm">
              {t('signIn')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
