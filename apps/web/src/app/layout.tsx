import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { PlayerBar } from '@/components/player/PlayerBar';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { LogoMark } from '@/components/ui/Logo';
import { ToastProvider } from '@/components/ui/Toast';
import { dirFor } from '@/i18n/config';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: { default: t('title'), template: `%s · ${t('title')}` }, description: t('description') };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0e1424' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations();
  const demo = process.env.DEMO_MODE === 'true';
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-paper focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
        >
          {t('nav.skipToContent')}
        </a>
        <NextIntlClientProvider>
          <ToastProvider dismissLabel={t('common.dismiss')}>
            {/* The player wraps every page, so audio keeps playing across navigation. */}
            <PlayerProvider>
              <SiteHeader />
              {demo && (
                <p role="note" className="bg-warn-bg px-4 py-2 text-center text-sm text-warn-ink">
                  {t('demo.banner')}
                </p>
              )}
              <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pt-5 pb-32 outline-none">
                {children}
              </main>
              <footer className="border-t border-line bg-card/60">
                <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-8 pb-32 text-sm text-muted sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-md space-y-2">
                    <p className="flex items-center gap-2 font-display text-base font-semibold text-ink">
                      <LogoMark className="size-5" /> TimeCapsule.fm
                    </p>
                    <p>{t('footer.honesty')}</p>
                  </div>
                  <nav aria-label={t('footer.label')}>
                    <ul className="flex flex-wrap gap-x-5 gap-y-2">
                      <li><Link className="hover:text-ink" href="/legal/takedown">{t('nav.takedown')}</Link></li>
                      <li><Link className="hover:text-ink" href="/legal/agreement">{t('footer.agreement')}</Link></li>
                      <li><Link className="hover:text-ink" href="/list">{t('nav.list')}</Link></li>
                    </ul>
                  </nav>
                </div>
              </footer>
              <PlayerBar />
            </PlayerProvider>
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
