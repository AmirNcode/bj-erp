/**
 * Entry-locale resolution (FR-34). Pure — no I/O, no next-intl import, so the
 * middleware can use it on the edge path and the unit tests can exercise every
 * branch without a request.
 *
 * The problem this solves: `localePrefix: 'as-needed'` means Farsi carries no
 * prefix, and `localeDetection: false` makes next-intl skip both the cookie and
 * `accept-language` (verified against its `resolveLocaleFromPrefix`). So a URL
 * with no prefix resolved to Farsi unconditionally, no matter what the user had
 * chosen — most visibly on every PWA launch, since `start_url` is `/`.
 *
 * The rule now: a prefix in the URL is an explicit choice and always wins; a URL
 * with no prefix means "unspecified", and the stored preference decides.
 *
 * `accept-language` is still deliberately ignored. A factory worker who picked
 * Farsi must not be flipped to English because the handset's browser is English.
 */

/** Must stay in step with `i18n/routing.ts`; a unit test asserts it does. */
export const APP_LOCALES = ['fa', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** Must stay in step with `i18n/routing.ts`; a unit test asserts it does. */
export const DEFAULT_LOCALE: AppLocale = 'fa';

/**
 * Our own cookie name rather than next-intl's `NEXT_LOCALE`. next-intl writes
 * and reads that one on its own schedule; sharing it would mean two owners for
 * one value, with `localeDetection: false` making its reads invisible anyway.
 */
export const LOCALE_COOKIE = 'bj-locale';

/** One year. The preference is a durable choice, not a session detail. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}

/**
 * The locale a URL states explicitly, or null when it states nothing.
 *
 * Matches whole first segments only: `/en/home` is English, `/english` is not.
 */
export function localePrefixOf(pathname: string): AppLocale | null {
  const first = pathname.split('/')[1];
  return isAppLocale(first) ? first : null;
}

/**
 * Which locale to use for a URL that named none. Cookie first (set the instant
 * the user changes the setting), then the `app_locale` JWT claim (survives a
 * cleared cookie and follows the user to a new device), then Farsi.
 *
 * Junk is ignored rather than trusted: both inputs are attacker-supplied in
 * principle — the cookie is not httpOnly and the claim is only as good as the
 * token — and an unknown value must not become a 404-producing path segment.
 */
export function resolveEntryLocale(
  cookieValue?: string | null,
  claimValue?: unknown
): AppLocale {
  if (isAppLocale(cookieValue)) return cookieValue;
  if (isAppLocale(claimValue)) return claimValue;
  return DEFAULT_LOCALE;
}

/**
 * The canonical path for a locale, given a path that carries no prefix.
 *
 * The default locale stays bare, because that is what `as-needed` means —
 * returning `/fa/home` here would send every Farsi user through a pointless
 * extra redirect back to `/home`.
 */
export function withLocalePrefix(pathname: string, locale: AppLocale): string {
  if (locale === DEFAULT_LOCALE) return pathname;
  return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
}

/**
 * Whether a request for `pathname` should be redirected so the stored
 * preference is honoured. False when the URL already states a locale — an
 * explicit `/en` or `/fa` is the user's choice for that navigation and is not
 * second-guessed.
 */
export function shouldRedirectToPreferredLocale(
  pathname: string,
  preferred: AppLocale
): boolean {
  return localePrefixOf(pathname) === null && preferred !== DEFAULT_LOCALE;
}

/** `document.cookie` / `Set-Cookie` attributes shared by every writer. */
export const LOCALE_COOKIE_ATTRS = {
  path: '/',
  maxAge: LOCALE_COOKIE_MAX_AGE,
  sameSite: 'lax',
} as const;
