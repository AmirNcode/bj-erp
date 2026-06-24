/**
 * Create new employee page.
 * Fetches departments and potential managers server-side for selects.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { NewEmployeeForm } from './NewEmployeeForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function NewEmployeePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');
  const supabase = await createClient();

  // Fetch departments and potential managers in parallel
  const [{ data: departments }, { data: managers }] = await Promise.all([
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
    supabase.from('profiles').select('id, full_name, employee_code').eq('active', true).order('full_name'),
  ]);

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('employees.newTitle')}</h1>
      <NewEmployeeForm
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
          submit: t('employees.create'),
          cancel: t('employees.cancel'),
          tempPasswordLabel: t('employees.tempPasswordLabel'),
          tempPasswordHint: t('employees.tempPasswordHint'),
          errorLabel: t('employees.error'),
          selectDept: t('employees.selectDept'),
          selectMgr: t('employees.selectMgr'),
          noneOption: t('employees.none'),
        }}
      />
    </main>
  );
}
