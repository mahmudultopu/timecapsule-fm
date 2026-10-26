'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useTransition } from 'react';
import { LOCALE_COOKIE, LOCALES } from '@/i18n/config';

// Each language is named in itself so speakers can find theirs.
const NAMES: Record<string, string> = { en: 'English', ar: 'العربية', ja: '日本語' };

export function LanguageSwitcher() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <div className="flex items-center">
      <label htmlFor={id} className="sr-only">
        {t('language')}
      </label>
      <select
        id={id}
        value={locale}
        aria-busy={pending}
        onChange={(e) => {
          // A preference cookie, not a credential.
          const secure = window.location.protocol === 'https:' ? '; Secure' : '';
          document.cookie = `${LOCALE_COOKIE}=${e.target.value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
          startTransition(() => router.refresh());
        }}
        className="cursor-pointer rounded-full border border-white/15 bg-white/5 py-1.5 ps-3 pe-7 text-sm text-paper hover:bg-white/10 [&>option]:text-ink"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
