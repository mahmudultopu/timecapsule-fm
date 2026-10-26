import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { isLocale, negotiate } from './config';

// Locale comes from the user's explicit choice (cookie) or Accept-Language.
// No locale prefix in URLs, so shared links work for everyone.
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get('tc_locale')?.value;
  const locale = isLocale(fromCookie) ? fromCookie : negotiate((await headers()).get('accept-language'));
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
