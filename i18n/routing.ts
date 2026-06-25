import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['fa', 'en'],
  defaultLocale: 'fa',
  localePrefix: 'as-needed',
  // Disable Accept-Language / cookie detection — locale is URL-driven only.
  // Default locale (fa) is used when no prefix is present in the URL.
  localeDetection: false,
});
