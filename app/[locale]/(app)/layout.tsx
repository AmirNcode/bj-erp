/**
 * Auth guard layout for all (app) routes.
 * Reads the session via the server client; redirects to /login if absent.
 */

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedProfile, getCachedPermissions } from '@/lib/auth/context';
import { ROLE_PRIORITY, subtitleRole } from '@/lib/auth/roleSubtitle';
import { parsePermsClaim, type Perms } from '@/lib/permissions/catalog';
import { createClient } from '@/lib/supabase/server';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';
import { getMyPendingRequests } from '@/lib/actions/leave/outcomes';
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

  const [roles, profile, perms] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
    getCachedPermissions(user.id),
  ]);
  if (!profile?.active) {
    redirect(`/${locale}/login`);
  }
  // FR-50: an account still on its admin-issued password sees only the
  // set-password screen until it chooses its own.
  if (profile.must_change_password) {
    redirect(`/${locale}/set-password`);
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
    organization: t('organization'),
    profile: t('profile'),
    manage: t('manage'),
    manageGroup: t('manage'),
    employees: t('employees'),
    departments: t('departments'),
    approvals: t('approvals'),
    requests: t('requests'),
    approvalSteps: t('approvalSteps'),
    reports: t('reports'),
    absences: t('absences'),
    finance: t('finance'),
    settings: t('settings'),
    language: t('language'),
    langFa: tProfile('langFa'),
    langEn: tProfile('langEn'),
  };

  // The role under the name: the most senior built-in one held; with none but
  // Employee, the caller's custom role with the most access (role names, FR-55).
  // Custom roles are read (own rows, RLS) only in that case.
  let customRoles: { name: string; permissions: Perms }[] = [];
  if (!ROLE_PRIORITY.some((r) => r !== 'employee' && roles.includes(r))) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('user_roles')
      .select('role:roles(name, kind, role_permissions(permission, level))')
      .eq('user_id', user.id);
    customRoles = (data ?? []).flatMap(({ role }) =>
      role && role.kind === 'custom'
        ? [{
            name: role.name,
            permissions:
              parsePermsClaim(Object.fromEntries(role.role_permissions.map((p) => [p.permission, p.level]))) ?? {},
          }]
        : []
    );
  }
  const shown = subtitleRole(roles, customRoles);
  const profileSummary = {
    name: profile.full_name ?? '',
    subtitle: t('profileSubtitle', { role: 'custom' in shown ? shown.custom : tRoles(shown.builtIn) }),
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
  // Everyone can request leave: the outcome banner watches the caller's own
  // pending requests. Streamed for the same reason as the badge.
  const myPending = getMyPendingRequests(locale)
    .then((r) => (r.ok ? r.requests : []))
    .catch(() => []);

  return (
    <AppShell
      roles={roles}
      perms={perms}
      locale={locale}
      labels={labels}
      appName={t('appName')}
      profile={profileSummary}
      pendingCount={pendingCount}
      myPending={myPending}
    >
      {children}
    </AppShell>
  );
}
