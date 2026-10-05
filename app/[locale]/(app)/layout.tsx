/**
 * Auth guard layout for all (app) routes.
 * Reads the session via the server client; redirects to /login if absent.
 */

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';
import { AppShell } from './_components/AppShell';

// The role shown under the name in the side panel: the most senior one held.
const ROLE_PRIORITY = ['admin', 'hr', 'manager', 'security', 'employee'] as const;

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

  const [t, tProfile, tRoles] = await Promise.all([
    getTranslations({ locale, namespace: 'nav' }),
    getTranslations({ locale, namespace: 'profile' }),
    getTranslations({ locale, namespace: 'roles' }),
  ]);
  const labels = {
    home: t('home'),
    request: t('request'),
    calendar: t('calendar'),
    profile: t('profile'),
    manage: t('manage'),
    manageGroup: t('manage'),
    employees: t('employees'),
    departments: t('departments'),
    approvals: t('approvals'),
    requests: t('requests'),
    approvalSteps: t('approvalSteps'),
    reports: t('reports'),
    settings: t('settings'),
    language: t('language'),
    langFa: tProfile('langFa'),
    langEn: tProfile('langEn'),
  };

  const topRole = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? 'employee';
  const profileSummary = {
    name: profile.full_name ?? '',
    subtitle: t('profileSubtitle', { role: tRoles(topRole) }),
  };

  // Approvals badge. Not awaited: the promise streams into the side panel so
  // the shell paints without waiting on the queue read.
  const canApprove =
    roles.includes('admin') || roles.includes('manager') || roles.includes('hr');
  const pendingCount = canApprove
    ? getPendingApprovals()
        .then((r) => (r.ok ? r.requests.length : 0))
        .catch(() => 0)
    : undefined;

  return (
    <AppShell
      roles={roles}
      locale={locale}
      labels={labels}
      appName={t('appName')}
      profile={profileSummary}
      pendingCount={pendingCount}
    >
      {children}
    </AppShell>
  );
}
