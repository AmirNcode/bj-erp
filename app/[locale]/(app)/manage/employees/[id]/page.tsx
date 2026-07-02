/**
 * Edit employee page — fields available depend on caller's role.
 * Admin gets full editor + roles + reset-password + activate/deactivate.
 * Manager gets limited field subset.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getEmployeeBalances } from '@/lib/actions/leave';
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
        }}
      />
    </main>
  );
}
