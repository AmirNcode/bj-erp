/**
 * Employee list page — admin sees all employees (RLS allows admin to read all profiles).
 * Manager sees employees they manage (RLS filters automatically).
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function EmployeesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');
  const supabase = await createClient();

  // Fetch all employees. RLS allows admin to read all profiles.
  // Use '!profiles_department_id_fkey' to disambiguate from the manager_id FK.
  const { data: employees } = await supabase
    .from('profiles')
    .select(
      `
      id,
      employee_code,
      full_name,
      active,
      hire_date,
      department_id,
      departments!profiles_department_id_fkey (name_fa, name_en),
      user_roles (role)
    `
    )
    .order('full_name');


  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('employees.title')}</h1>
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/manage/approvals`}
            className="text-blue-600 hover:underline px-2 py-2"
          >
            {t('approvalsLink')}
          </Link>
          <Link
            href={`/${locale}/manage/employees/new`}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('employees.addNew')}
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-start px-4 py-3 font-semibold text-gray-700">
                {t('employees.code')}
              </th>
              <th className="text-start px-4 py-3 font-semibold text-gray-700">
                {t('employees.name')}
              </th>
              <th className="text-start px-4 py-3 font-semibold text-gray-700">
                {t('employees.department')}
              </th>
              <th className="text-start px-4 py-3 font-semibold text-gray-700">
                {t('employees.roles')}
              </th>
              <th className="text-start px-4 py-3 font-semibold text-gray-700">
                {t('employees.status')}
              </th>
              <th className="text-start px-4 py-3 font-semibold text-gray-700">
                {t('employees.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(employees ?? []).map((emp) => (
              <tr key={emp.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">{emp.employee_code}</td>
                <td className="px-4 py-3">{emp.full_name}</td>
                <td className="px-4 py-3">
                  {emp.departments
                    ? locale === 'fa'
                      ? (emp.departments as { name_fa: string }).name_fa
                      : (emp.departments as { name_en: string }).name_en
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  {(emp.user_roles as { role: string }[])
                    .map((r) => r.role)
                    .join(', ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      emp.active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {emp.active ? t('employees.active') : t('employees.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/${locale}/manage/employees/${emp.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {t('employees.edit')}
                  </Link>
                </td>
              </tr>
            ))}
            {(employees ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {t('employees.noEmployees')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
