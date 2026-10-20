import { defineRouting } from 'next-intl/routing';
import { APP_LOCALES, DEFAULT_LOCALE } from '../lib/i18n/locale';

export const routing = defineRouting({
  locales: APP_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  // Disable Accept-Language / cookie detection — locale is URL-driven only.
  // Default locale (fa) is used when no prefix is present in the URL.
  localeDetection: false,
});
