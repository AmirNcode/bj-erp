/**
 * Create new employee page — permission-adaptive (FR-55).
 * people_create: any department / manager; the initial roles the caller may
 * assign (D5); leave_balances edit adds manual allocations and accrual policy.
 * FR-74: managers cannot add employees. Enforcement lives in
 * app_create_employee; this page only mirrors it.
 */

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getCurrentJalaliMonthStart } from '@/lib/actions/leave/balances';
import { listRoles } from '@/lib/actions/roles';
import { employeeEditCapabilities } from '@/lib/employees/editCapabilities';
import { can } from '@/lib/permissions/catalog';
import { PageHeader } from '../../../_components/PageHeader';
import { NewEmployeeForm } from './NewEmployeeForm';
import { FormSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function NewEmployeeData({ locale }: { locale: string }) {
  const supabase = await createClient();

  const user = await getCachedUser();
  if (!user) return null;
  const [roles, perms, rolesRes] = await Promise.all([
    getCachedRoles(user.id),
    getCachedPermissions(user.id),
    listRoles(),
  ]);
  // FR-43: opening balance and accrual policy.
  const canManageLeave = can(perms, 'leave_balances');
  // D5: the initial roles are checked like any later role change. The new person
  // holds only Employee, so the subset rule never locks them.
  const allRoles = rolesRes.ok ? rolesRes.roles : [];
  const employeeRoleId = allRoles.find((r) => r.systemKey === 'employee')?.id ?? null;
  const editableRoleIds = employeeRoleId
    ? employeeEditCapabilities({
        callerId: user.id,
        callerRoles: roles,
        callerPerms: perms,
        targetId: '',
        targetRoleIds: [employeeRoleId],
        allRoles,
        targetIsDepartmentManager: false,
        targetIdentity: { approver: false, clearanceSigner: false },
      }).editableRoleIds
    : [];

  // The creator picks dept/manager and types allocations.
  const [{ data: departments }, { data: managers }, { data: leaveTypes }, { data: ws }] =
    await Promise.all([
    // No `code`: the login code is the personnel number alone (20260730130002).
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
    supabase.from('profiles').select('id, full_name, employee_code').eq('active', true).order('full_name'),
    canManageLeave
      ? supabase
          .from('leave_types')
          .select(
            'id, name_fa, name_en, default_annual_quota_days, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes'
          )
          .eq('active', true)
          .eq('affects_balance', true)
          .order('name_fa')
      : Promise.resolve({ data: [] }),
    // Allocation inputs are days; the ledger stores minutes.
    supabase.from('work_settings').select('hours_per_day').maybeSingle(),
  ]);
  const hoursPerDay = ws?.hours_per_day ?? 8;
  // Default the accrual start to the CURRENT Jalali month, never earlier: switching
  // accrual on must not retroactively credit months nobody worked (spec §6, D10).
  const accrualStartMonth = await getCurrentJalaliMonthStart();

  return (
    <NewEmployeeForm
      allRoles={allRoles}
      employeeRoleId={employeeRoleId}
      editableRoleIds={editableRoleIds}
      canManageLeave={canManageLeave}
      canSetLoginCode={roles.includes('admin')}
      departments={departments ?? []}
      managers={managers ?? []}
      leaveTypes={leaveTypes ?? []}
      hoursPerDay={hoursPerDay}
      accrualStartMonth={accrualStartMonth}
      locale={locale}
    />
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function NewEmployeePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The Manage layout admits anyone with a Manage item; adding people needs
  // people_create (FR-74: managers cannot add).
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'people_create')) {
    redirect(`/${locale}/home`);
  }

  const t = await getTranslations('manage');

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <PageHeader title={t('employees.newTitle')} />
      <Suspense fallback={<FormSkeleton />}>
        <NewEmployeeData locale={locale} />
      </Suspense>
    </main>
  );
}
