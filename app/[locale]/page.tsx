/**
 * Locale root — redirects to /home if authenticated, else to /login.
 *
 * This is the PWA's landing page: `manifest.ts` sets `start_url: '/'`, so an
 * installed app passes through here on every launch. That made it the single
 * biggest source of the FR-34 bug — it used to redirect using the *URL* locale,
 * which for a bare `/` is always Farsi, so an English user was sent back to
 * Farsi every time they opened the app from their home screen.
 *
 * The middleware normally fixes the locale before this page runs. This is the
 * backstop for the one case it cannot cover: no `bj-locale` cookie yet AND a
 * token issued before the `app_locale` claim existed (or with the auth hook
 * disabled). The profile is authoritative and already cached for this request,
 * so consulting it costs nothing extra.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import {
  LOCALE_COOKIE,
  isAppLocale,
  withLocalePrefix,
  type AppLocale,
} from '@/lib/i18n/locale';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function RootPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();

  // Signed in: the profile is the source of truth. Signed out: fall back to the
  // cookie so a returning user at least meets the login page in their own
  // language. `locale` from the URL is the last resort.
  let target: AppLocale = isAppLocale(locale) ? locale : 'fa';
  if (user) {
    const profile = await getCachedProfile(user.id);
    if (isAppLocale(profile?.language_pref)) target = profile.language_pref;
  } else {
    const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isAppLocale(cookieLocale)) target = cookieLocale;
  }

  redirect(withLocalePrefix(user ? '/home' : '/login', target));
}
