import { describe, it, expect } from 'vitest';
import { routing } from '@/i18n/routing';
import {
  isAppLocale,
  localePrefixOf,
  resolveEntryLocale,
  shouldRedirectToPreferredLocale,
  withLocalePrefix,
} from '@/lib/i18n/locale';

describe('i18n/routing', () => {
  it('assumes as-needed prefixing, which is what makes the bare path ambiguous', () => {
    expect(routing.localePrefix).toBe('as-needed');
  });
});

describe('isAppLocale', () => {
  it('accepts supported locales', () => {
    expect(isAppLocale('fa')).toBe(true);
    expect(isAppLocale('en')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of ['de', 'EN', '', 'fa-IR', null, undefined, 42, {}, ['en']]) {
      expect(isAppLocale(v)).toBe(false);
    }
  });
});

describe('localePrefixOf', () => {
  it('reads an explicit prefix', () => {
    expect(localePrefixOf('/en')).toBe('en');
    expect(localePrefixOf('/en/')).toBe('en');
    expect(localePrefixOf('/en/home')).toBe('en');
    expect(localePrefixOf('/fa/manage/approvals')).toBe('fa');
  });

  it('returns null when the path names no locale', () => {
    expect(localePrefixOf('/')).toBeNull();
    expect(localePrefixOf('/home')).toBeNull();
    expect(localePrefixOf('/manage/employees')).toBeNull();
  });

  it('matches whole segments only', () => {
    // The bug this guards: a naive startsWith('/en') turns /english into English
    // and mangles any future route beginning with a locale's letters.
    expect(localePrefixOf('/english')).toBeNull();
    expect(localePrefixOf('/entries')).toBeNull();
    expect(localePrefixOf('/family')).toBeNull();
  });
});

describe('resolveEntryLocale', () => {
  it('prefers the cookie, which is written the instant the setting changes', () => {
    expect(resolveEntryLocale('en', 'fa')).toBe('en');
    expect(resolveEntryLocale('fa', 'en')).toBe('fa');
  });

  it('falls back to the JWT claim when there is no cookie', () => {
    expect(resolveEntryLocale(undefined, 'en')).toBe('en');
    expect(resolveEntryLocale(null, 'en')).toBe('en');
    expect(resolveEntryLocale('', 'en')).toBe('en');
  });

  it('falls back to Farsi when neither is present', () => {
    expect(resolveEntryLocale(undefined, undefined)).toBe('fa');
    expect(resolveEntryLocale(null, null)).toBe('fa');
  });

  it('ignores junk in either carrier rather than trusting it', () => {
    // Both are attacker-influenced: the cookie is not httpOnly by design (the
    // client sets it too), and an unknown value must never reach the URL.
    expect(resolveEntryLocale('../../etc/passwd', undefined)).toBe('fa');
    expect(resolveEntryLocale('de', undefined)).toBe('fa');
    expect(resolveEntryLocale('de', 'en')).toBe('en');
    expect(resolveEntryLocale(undefined, { locale: 'en' })).toBe('fa');
    expect(resolveEntryLocale(undefined, ['en'])).toBe('fa');
  });
});

describe('withLocalePrefix', () => {
  it('leaves the default locale bare, since as-needed gives it no prefix', () => {
    expect(withLocalePrefix('/home', 'fa')).toBe('/home');
    expect(withLocalePrefix('/', 'fa')).toBe('/');
  });

  it('prefixes a non-default locale', () => {
    expect(withLocalePrefix('/home', 'en')).toBe('/en/home');
    expect(withLocalePrefix('/manage/employees', 'en')).toBe('/en/manage/employees');
  });

  it('does not produce a double slash at the root', () => {
    expect(withLocalePrefix('/', 'en')).toBe('/en');
  });
});

describe('shouldRedirectToPreferredLocale', () => {
  it('redirects a bare path for an English user — the reported bug', () => {
    // The PWA start_url is '/', so this is every home-screen launch.
    expect(shouldRedirectToPreferredLocale('/', 'en')).toBe(true);
    expect(shouldRedirectToPreferredLocale('/home', 'en')).toBe(true);
    expect(shouldRedirectToPreferredLocale('/login', 'en')).toBe(true);
  });

  it('leaves a bare path alone for a Farsi user', () => {
    // Bare IS Farsi under as-needed; redirecting would loop.
    expect(shouldRedirectToPreferredLocale('/', 'fa')).toBe(false);
    expect(shouldRedirectToPreferredLocale('/home', 'fa')).toBe(false);
  });

  it('never overrides a locale the URL states explicitly', () => {
    expect(shouldRedirectToPreferredLocale('/en/home', 'fa')).toBe(false);
    expect(shouldRedirectToPreferredLocale('/fa/home', 'en')).toBe(false);
    expect(shouldRedirectToPreferredLocale('/en/home', 'en')).toBe(false);
  });
});
