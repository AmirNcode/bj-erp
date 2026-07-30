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

  // Admin picks dept/manager and types allocations; a manager's variant only
  // needs their own department row.
  const [{ data: departments }, { data: managers }, { data: leaveTypes }, { data: ws }] =
    await Promise.all([
    supabase.from('departments').select('id, name_fa, name_en, code').order('name_fa'),
    isAdmin
      ? supabase.from('profiles').select('id, full_name, employee_code').eq('active', true).order('full_name')
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase
          .from('leave_types')
          .select('id, name_fa, name_en, default_annual_quota_days')
          .eq('active', true)
          .eq('affects_balance', true)
          .order('name_fa')
      : Promise.resolve({ data: [] }),
    // Allocation inputs are days; the ledger stores minutes.
    supabase.from('work_settings').select('hours_per_day').maybeSingle(),
  ]);
  const hoursPerDay = ws?.hours_per_day ?? 8;

  const ownDepartment =
    (departments ?? []).find((d) => d.id === callerProfile?.department_id) ?? null;

  return (
    <NewEmployeeForm
      isAdmin={isAdmin}
      ownDepartment={ownDepartment}
      ownName={callerProfile?.full_name ?? ''}
      departments={departments ?? []}
      managers={managers ?? []}
      leaveTypes={leaveTypes ?? []}
      hoursPerDay={hoursPerDay}
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
        allocWarn: t('employees.allocWarn'),
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
