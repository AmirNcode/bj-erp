/**
 * My Team page — lists the current manager's direct reports.
 * Only users with the 'manager' role should navigate here (guarded via nav).
 * The auth layout already requires a session; this page adds a role check.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function MyTeamPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('team');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  // Check manager role
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const roles = (rolesData ?? []).map((r) => r.role);
  const isManager = roles.includes('manager');
  const isAdmin = roles.includes('admin');

  // Redirect non-managers back home
  if (!isManager && !isAdmin) {
    redirect(`/${locale}/home`);
  }

  // Fetch direct reports (profiles where manager_id = current user)
  const { data: reports } = await supabase
    .from('profiles')
    .select(
      `
      id,
      employee_code,
      full_name,
      department_id,
      departments!profiles_department_id_fkey (name_fa, name_en)
    `
    )
    .eq('manager_id', user.id)
    .order('full_name');

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {(reports ?? []).length === 0 ? (
        <p className="text-gray-500 py-8 text-center">{t('noReports')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-start px-4 py-3 font-semibold text-gray-700">
                  {t('code')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-gray-700">
                  {t('name')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-gray-700">
                  {t('department')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-gray-700">
                  {t('edit')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(reports ?? []).map((emp) => (
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
                    <Link
                      href={`/${locale}/manage/employees/${emp.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {t('edit')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
