/**
 * Edit employee page — fields available depend on caller's role.
 * Admin gets full editor + roles + reset-password + activate/deactivate.
 * Manager gets limited field subset.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { EditEmployeeForm } from './EditEmployeeForm';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function EditEmployeePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return notFound();

  // Fetch caller's roles
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);
  const callerRoles = (rolesData ?? []).map((r) => r.role);
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

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{t('employees.editTitle')}</h1>
      <p className="text-gray-500 mb-6 font-mono">{employee.employee_code}</p>
      <EditEmployeeForm
        employee={employee}
        empRoles={empRoles as string[]}
        isAdmin={isAdmin}
        departments={departments ?? []}
        managers={managers ?? []}
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
        }}
      />
    </main>
  );
}
