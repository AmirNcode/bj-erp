/**
 * Create new employee page — role-adaptive.
 * Admin: any department / manager / roles, plus manual allocations.
 * Manager: locked to own department + self as manager, employee role only,
 * default quotas applied in-DB. Enforcement lives in app_create_employee;
 * this page only mirrors it.
 */

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { getCurrentJalaliMonthStart } from '@/lib/actions/leave';
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
  const [roles, callerProfile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);
  const isAdmin = roles.includes('admin');
  // FR-35 D4: hr picks the department and reporting line like an admin, but gets
  // neither the role checkboxes nor the allocation/policy fields.
  const canChooseScope = isAdmin || roles.includes('hr');
  // FR-43: HR sets the opening balance and accrual policy too. Kept separate from
  // `canChooseScope` because they answer different questions — where the hire
  // lands, versus what leave they start with — and separate from `isAdmin`
  // because role assignment stays admin-only (FR-35 D4).
  const canManageLeave = isAdmin || roles.includes('hr');

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
      isAdmin={isAdmin}
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
