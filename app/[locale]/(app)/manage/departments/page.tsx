/**
 * Manage › Departments (spec 2026-07-30 §7): the department list with its
 * members panel and Add Department, plus the monthly accrual runner. Company
 * configuration — admin only; everyone else goes back to the employees hub.
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '../../_components/PageHeader';
import { DepartmentsCard } from './DepartmentsCard';
import { AccrualRunner } from './AccrualRunner';

type Props = { params: Promise<{ locale: string }> };

export default async function DepartmentsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}/manage/employees`);

  const [tNav, t] = await Promise.all([
    getTranslations('nav'),
    getTranslations('manage.settings'),
  ]);
  const supabase = await createClient();
  // The code is shown read-only since FR-46 (it is the bulk-import key); the
  // manager is the department's second signer (FR-47).
  const [{ data: departments, error: departmentsError }, { data: managerRows }] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name_fa, name_en, code, manager_id, manager:profiles!departments_manager_id_fkey(full_name)')
      .order('name_fa'),
    supabase
      .from('user_roles')
      .select('profiles!inner(id, full_name, active)')
      .eq('role', 'manager')
      .eq('profiles.active', true),
  ]);
  const managers = ((managerRows ?? []) as unknown as { profiles: { id: string; full_name: string } }[])
    .map((r) => ({ id: r.profiles.id, fullName: r.profiles.full_name }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'));

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <PageHeader title={tNav('departments')} />

      <Card>
        <CardContent>
          <DepartmentsCard
            departments={((departments ?? []) as unknown as {
              id: string;
              name_fa: string;
              name_en: string;
              code: string;
              manager_id: string | null;
              manager: { full_name: string } | null;
            }[]).map(({ manager, ...d }) => ({ ...d, manager_name: manager?.full_name ?? null }))}
            managers={managers}
            loadError={departmentsError?.message ?? null}
            locale={locale}
            labels={{
              title: t('departments.title'),
              hint: t('departments.hint'),
              addNew: t('departments.addNew'),
              empty: t('departments.empty'),
              managersLabel: t('departments.managersLabel'),
              workersLabel: t('departments.workersLabel'),
              noMembers: t('departments.noMembers'),
              loading: t('departments.loading'),
              close: t('departments.close'),
              managerLabel: t('departments.managerLabel'),
              noManager: t('departments.noManager'),
              managerSaved: t('departments.managerSaved'),
              errorLabel: t('error'),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <AccrualRunner
            locale={locale}
            labels={{
              title: t('accrual.title'),
              hint: t('accrual.hint'),
              run: t('accrual.run'),
              resultTitle: t('accrual.resultTitle'),
              employeesLabel: t('accrual.employeesLabel'),
              rowsLabel: t('accrual.rowsLabel'),
              nothingToDo: t('accrual.nothingToDo'),
              errorLabel: t('error'),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
