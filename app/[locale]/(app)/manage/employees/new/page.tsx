/**
 * Create new employee page — permission-adaptive (FR-55).
 * people_create: any department / manager; the initial roles the caller may
 * assign (D5); leave_balances edit adds manual allocations and accrual policy.
 * Manager without people_create: locked to own department + self as manager,
 * employee role only, default quotas applied in-DB. Enforcement lives in
 * app_create_employee; this page only mirrors it.
 */

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles, getCachedProfile, getCachedPermissions } from '@/lib/auth/context';
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
  const t = await getTranslations('manage');
  const supabase = await createClient();

  const user = await getCachedUser();
  if (!user) return null;
  const [roles, perms, callerProfile, rolesRes] = await Promise.all([
    getCachedRoles(user.id),
    getCachedPermissions(user.id),
    getCachedProfile(user.id),
    listRoles(),
  ]);
  // FR-35 D4: people_create picks the department and reporting line. A manager
  // without it is locked to their own team (app_create_employee overwrites both).
  const canChooseScope = can(perms, 'people_create');
  // FR-43: opening balance and accrual policy. A different question from
  // `canChooseScope` — what leave the hire starts with, not where they land.
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

  // Admin picks dept/manager and types allocations; a manager's variant only
  // needs their own department row.
  const [{ data: departments }, { data: managers }, { data: leaveTypes }, { data: ws }] =
    await Promise.all([
    // No `code`: the login code is the personnel number alone (20260730130002).
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
    canChooseScope
      ? supabase.from('profiles').select('id, full_name, employee_code').eq('active', true).order('full_name')
      : Promise.resolve({ data: [] }),
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

  const ownDepartment =
    (departments ?? []).find((d) => d.id === callerProfile?.department_id) ?? null;

  return (
    <NewEmployeeForm
      allRoles={allRoles}
      employeeRoleId={employeeRoleId}
      editableRoleIds={editableRoleIds}
      canManageLeave={canManageLeave}
      canChooseScope={canChooseScope}
      ownDepartment={ownDepartment}
      ownName={callerProfile?.full_name ?? ''}
      departments={departments ?? []}
      managers={managers ?? []}
      leaveTypes={leaveTypes ?? []}
      hoursPerDay={hoursPerDay}
      accrualStartMonth={accrualStartMonth}
      locale={locale}
      labels={{
        personnelNo: t('employees.personnelNo'),
        jobTitle: t('employees.jobTitle'),
        codePreview: t('employees.codePreview'),
        defaultQuotaHint: t('employees.defaultQuotaHint'),
        name: t('employees.name'),
        department: t('employees.department'),
        manager: t('employees.manager'),
        roles: t('employees.roles'),
        adminTransferHint: t('employees.adminTransferHint'),
        hireDate: t('employees.hireDate'),
        submit: t('employees.create'),
        cancel: t('employees.cancel'),
        done: t('employees.done'),
        tempPasswordLabel: t('employees.tempPasswordLabel'),
        tempPasswordHint: t('employees.tempPasswordHint'),
        errorLabel: t('employees.error'),
        selectDept: t('employees.selectDept'),
        selectMgr: t('employees.selectMgr'),
        noneOption: t('employees.none'),
        allocTitle: t('employees.allocTitle'),
        allocHint: t('employees.allocHint'),
        allocWarn: t('employees.allocWarn'),
        policyTitle: t('employees.policyTitle'),
        policyHint: t('employees.policyHint'),
        policyRate: t('employees.policyRate'),
        policyRateHint: t('employees.policyRateHint'),
        policyAnnualCap: t('employees.policyAnnualCap'),
        policyAnnualCapHint: t('employees.policyAnnualCapHint'),
        policyCarryCap: t('employees.policyCarryCap'),
        policyCarryCapHint: t('employees.policyCarryCapHint'),
        policyWarn: t('employees.policyWarn'),
      }}
    />
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function NewEmployeePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The Manage layout admits anyone with a Manage item; adding people needs
  // people_create, or a manager's own-team path.
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const [roles, perms] = await Promise.all([getCachedRoles(user.id), getCachedPermissions(user.id)]);
  if (!roles.includes('manager') && !can(perms, 'people_create')) {
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
