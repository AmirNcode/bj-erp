/**
 * Employee list page — admin sees all employees (RLS allows admin to read all profiles).
 * Manager sees employees they manage (RLS filters automatically).
 * Desktop table is a client component (admin row-selection for bulk password
 * regeneration); mobile stacked cards stay server-rendered, read-only.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import Link from 'next/link';
import { PageHeader } from '../../_components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ListSkeleton } from '@/components/Skeletons';
import { EmployeesTable, type EmployeeRow } from './EmployeesTable';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function EmployeesData({ locale }: { locale: string }) {
  const t = await getTranslations('manage');
  const tr = await getTranslations('manage.employees.regen');
  const tc = await getTranslations('manage.import.credentials');
  const supabase = await createClient();

  const user = await getCachedUser();
  const roles = user ? await getCachedRoles(user.id) : [];
  const isAdmin = roles.includes('admin');

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

  const rows: EmployeeRow[] = (employees ?? []).map((emp) => ({
    id: emp.id,
    employee_code: emp.employee_code,
    full_name: emp.full_name,
    active: emp.active,
    departmentLabel: emp.departments
      ? locale === 'fa'
        ? (emp.departments as { name_fa: string }).name_fa
        : (emp.departments as { name_en: string }).name_en
      : '—',
    rolesLabel:
      (emp.user_roles as { role: string }[]).map((r) => r.role).join(', ') || '—',
    isSelf: emp.id === user?.id,
  }));

  return (
    <>
      {/* Desktop table (client: admin selection + bulk password regeneration) */}
      <EmployeesTable
        employees={rows}
        isAdmin={isAdmin}
        locale={locale}
        labels={{
          code: t('employees.code'),
          name: t('employees.name'),
          department: t('employees.department'),
          roles: t('employees.roles'),
          status: t('employees.status'),
          actions: t('employees.actions'),
          active: t('employees.active'),
          inactive: t('employees.inactive'),
          edit: t('employees.edit'),
          noEmployees: t('employees.noEmployees'),
          errorLabel: t('employees.error'),
          regen: {
            button: tr('button'),
            confirmTitle: tr('confirmTitle'),
            confirmBody: tr('confirmBody'),
            cancel: tr('cancel'),
            confirm: tr('confirm'),
          },
          credentials: {
            title: tc('title'),
            warn: tc('warn'),
            download: tc('download'),
            name: tc('name'),
            code: tc('code'),
            password: tc('password'),
          },
        }}
      />

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {rows.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t('employees.noEmployees')}
            </CardContent>
          </Card>
        )}
        {rows.map((emp) => (
          <Card key={emp.id}>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{emp.full_name}</p>
                  <p className="font-mono text-sm text-muted-foreground" dir="ltr">
                    {emp.employee_code}
                  </p>
                </div>
                <Badge
                  className={
                    emp.active
                      ? 'bg-success-foreground text-success hover:bg-success-foreground shrink-0'
                      : 'bg-destructive/10 text-destructive hover:bg-destructive/10 shrink-0'
                  }
                >
                  {emp.active ? t('employees.active') : t('employees.inactive')}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{emp.departmentLabel}</p>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{emp.rolesLabel}</p>
                <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                  <Link href={`/${locale}/manage/employees/${emp.id}`}>
                    {t('employees.edit')}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function EmployeesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');
  const tTeam = await getTranslations('team');

  // Resolve isAdmin for the header action buttons — needs to be outside
  // Suspense so that navigation links render immediately.
  const user = await getCachedUser();
  const myRoles = user ? await getCachedRoles(user.id) : [];
  const isAdmin = myRoles.includes('admin');

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title={t('employees.title')}
        action={
          <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 sm:w-auto sm:justify-end sm:gap-2">
            <Button variant="ghost" size="sm" className="px-0 sm:px-3" asChild>
              <Link href={`/${locale}/team`}>{tTeam('navLink')}</Link>
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" className="px-0 sm:px-3" asChild>
                <Link href={`/${locale}/manage/settings`} data-testid="nav-settings">
                  {t('settingsLink')}
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="px-0 sm:px-3" asChild>
              <Link href={`/${locale}/manage/approvals`}>{t('approvalsLink')}</Link>
            </Button>
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${locale}/manage/employees/import`} data-testid="import-link">
                  {t('employees.regen.importLink')}
                </Link>
              </Button>
            )}
            {/* Admin-only: a department must exist before anyone can be hired into it. */}
            {isAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/${locale}/manage/departments/new`}
                  data-testid="add-department-link"
                >
                  {t('departments.addNew')}
                </Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link href={`/${locale}/manage/employees/new`}>{t('employees.addNew')}</Link>
            </Button>
          </div>
        }
      />
      <Suspense fallback={<ListSkeleton count={4} />}>
        <EmployeesData locale={locale} />
      </Suspense>
    </main>
  );
}
