/**
 * Auth guard layout for all (app) routes.
 * Reads the session via the server client; redirects to /login if absent.
 */

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { AppShell } from './_components/AppShell';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function AppLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);
  if (!profile?.active) {
    redirect(`/${locale}/login`);
  }

  const t = await getTranslations({ locale, namespace: 'nav' });
  const labels = {
    home: t('home'),
    request: t('request'),
    calendar: t('calendar'),
    profile: t('profile'),
    manage: t('manage'),
  };

  return (
    <AppShell roles={roles} locale={locale} labels={labels} appName={t('appName')}>
      {children}
    </AppShell>
  );
}
