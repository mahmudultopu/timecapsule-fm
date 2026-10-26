import type en from '../messages/en.json';

// Type-checks every t('…') call against the English catalog, so a missing or
// misspelled key fails `tsc` instead of rendering a raw key at runtime.
declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof en;
  }
}
