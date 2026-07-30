/**
 * Edit employee page — fields available depend on caller's role.
 * Admin gets full editor + roles + reset-password + activate/deactivate.
 * Manager gets limited field subset.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import {
  getEmployeeBalances,
  getWorkSettings,
  getEmployeePolicies,
  getCurrentJalaliMonthStart,
} from '@/lib/actions/leave';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../_components/PageHeader';
import { EditEmployeeForm } from './EditEmployeeForm';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function EditEmployeePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');
  const tTeam = await getTranslations('team');
  const supabase = await createClient();

  const user = await getCachedUser();

  if (!user) return notFound();

  // Fetch caller's roles
  const callerRoles = await getCachedRoles(user.id);
  const isAdmin = callerRoles.includes('admin');

  // Fetch target employee
  const { data: employee } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (!employee) return notFound();

  // Fetch employee's current roles
  const { data: empRolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', id);
  const empRoles = (empRolesData ?? []).map((r) => r.role);

  // Fetch departments and potential managers
  const [{ data: departments }, { data: managers }] = await Promise.all([
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
    supabase.from('profiles').select('id, full_name, employee_code').eq('active', true).order('full_name'),
  ]);
  const balancesRes = isAdmin ? await getEmployeeBalances(id) : null;
  const balances = balancesRes?.ok ? balancesRes.balances : [];
  // Balances are stored in minutes; the editor renders and accepts days, so it
  // needs the company's day length to convert at the boundary.
  const workSettingsRes = isAdmin ? await getWorkSettings() : null;
  const hoursPerDay = workSettingsRes?.ok ? workSettingsRes.settings.hoursPerDay : 8;
  // Accrual policy: existing rows pre-fill the form; the leave-type defaults fill
  // the gaps, and the start month defaults to the current Jalali month so turning
  // accrual on never back-credits months nobody worked.
  const policiesRes = isAdmin ? await getEmployeePolicies(id) : null;
  const policies = policiesRes?.ok ? policiesRes.policies : [];
  const accrualStartMonth = isAdmin ? await getCurrentJalaliMonthStart() : '';
  const { data: typeDefaults } = isAdmin
    ? await supabase
        .from('leave_types')
        .select(
          'id, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes'
        )
        .eq('active', true)
        .eq('affects_balance', true)
    : { data: [] };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <PageHeader
        title={t('employees.editTitle')}
        action={
          <span className="font-mono text-sm text-muted-foreground">{employee.employee_code}</span>
        }
      />
      <EditEmployeeForm
        employee={employee}
        empRoles={empRoles as string[]}
        isAdmin={isAdmin}
        departments={departments ?? []}
        managers={managers ?? []}
        balances={balances}
        hoursPerDay={hoursPerDay}
        policies={policies}
        typeDefaults={typeDefaults ?? []}
        accrualStartMonth={accrualStartMonth}
        locale={locale}
        labels={{
          code: t('employees.code'),
          name: t('employees.name'),
          department: t('employees.department'),
          manager: t('employees.manager'),
          roles: t('employees.roles'),
          hireDate: t('employees.hireDate'),
          save: t('employees.save'),
          cancel: t('employees.cancel'),
          resetPwd: t('employees.resetPwd'),
          activate: t('employees.activate'),
          deactivate: t('employees.deactivate'),
          tempPasswordLabel: t('employees.tempPasswordLabel'),
          tempPasswordHint: t('employees.tempPasswordHint'),
          errorLabel: t('employees.error'),
          selectDept: t('employees.selectDept'),
          selectMgr: t('employees.selectMgr'),
          noneOption: t('employees.none'),
          saved: t('employees.saved'),
          managerNote: tTeam('managerNote'),
          balancesTitle: t('employees.balancesTitle'),
          policyTitle: t('employees.policyTitle'),
          policyHint: t('employees.policyHint'),
          policyRate: t('employees.policyRate'),
          policyAnnualCap: t('employees.policyAnnualCap'),
          policyCarryCap: t('employees.policyCarryCap'),
          policyWarn: t('employees.policyWarn'),
        }}
      />
    </main>
  );
}
