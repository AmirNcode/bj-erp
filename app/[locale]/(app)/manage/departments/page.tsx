/**
 * Manage › Departments (spec 2026-07-30 §7): the department list with its
 * members panel, rename and Add Department, plus the monthly accrual runner.
 * Needs the departments permission (FR-55): read shows the list, edit adds
 * rename / manager / Add Department, and the accrual runner needs leave_accrual.
 * Everyone else goes back to the employees hub. The department code stays
 * admin-only in the database.
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
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
  const [roles, perms] = await Promise.all([getCachedRoles(user.id), getCachedPermissions(user.id)]);
  if (!can(perms, 'departments', 'read')) redirect(`/${locale}/manage/employees`);

  const tNav = await getTranslations('nav');
  const supabase = await createClient();
  // A non-admin may not pick the manager of their own department: that person
  // signs the department-manager step on the caller's own requests.
  const { data: me } = roles.includes('admin')
    ? { data: null }
    : await supabase.from('profiles').select('department_id').eq('id', user.id).maybeSingle();
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
  // D7: a non-admin may not appoint themself department manager, so they are not
  // offered (a department they already manage still shows them as its value).
  const managers = ((managerRows ?? []) as unknown as { profiles: { id: string; full_name: string } }[])
    .map((r) => ({ id: r.profiles.id, fullName: r.profiles.full_name }))
    .filter((m) => roles.includes('admin') || m.id !== user.id)
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
            ownDepartmentId={me?.department_id ?? null}
            loadError={departmentsError?.message ?? null}
            canEdit={can(perms, 'departments', 'edit')}
            locale={locale}
          />
        </CardContent>
      </Card>

      {can(perms, 'leave_accrual') && (
      <Card>
        <CardContent>
          <AccrualRunner locale={locale} />
        </CardContent>
      </Card>
      )}
    </div>
  );
}
