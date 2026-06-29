/**
 * Employee list page — admin sees all employees (RLS allows admin to read all profiles).
 * Manager sees employees they manage (RLS filters automatically).
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { PageHeader } from '../../_components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function EmployeesData({ locale, isAdmin }: { locale: string; isAdmin: boolean }) {
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
    <>
      {/* Desktop table */}
      <Card className="hidden md:block overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('employees.code')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('employees.name')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('employees.department')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('employees.roles')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('employees.status')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('employees.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(employees ?? []).map((emp) => (
                <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm">{emp.employee_code}</td>
                  <td className="px-4 py-3">{emp.full_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {emp.departments
                      ? locale === 'fa'
                        ? (emp.departments as { name_fa: string }).name_fa
                        : (emp.departments as { name_en: string }).name_en
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {(emp.user_roles as { role: string }[])
                      .map((r) => r.role)
                      .join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={emp.active ? 'default' : 'secondary'}
                      className={
                        emp.active
                          ? 'bg-success-foreground text-success hover:bg-success-foreground'
                          : 'bg-destructive/10 text-destructive hover:bg-destructive/10'
                      }
                    >
                      {emp.active ? t('employees.active') : t('employees.inactive')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                      <Link href={`/${locale}/manage/employees/${emp.id}`}>
                        {t('employees.edit')}
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {(employees ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {t('employees.noEmployees')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {(employees ?? []).length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t('employees.noEmployees')}
            </CardContent>
          </Card>
        )}
        {(employees ?? []).map((emp) => (
          <Card key={emp.id}>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{emp.full_name}</p>
                  <p className="font-mono text-sm text-muted-foreground">{emp.employee_code}</p>
                </div>
                <Badge
                  className={
                    emp.active
                      ? 'bg-green-100 text-green-700 hover:bg-green-100 shrink-0'
                      : 'bg-red-100 text-red-700 hover:bg-red-100 shrink-0'
                  }
                >
                  {emp.active ? t('employees.active') : t('employees.inactive')}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {emp.departments
                  ? locale === 'fa'
                    ? (emp.departments as { name_fa: string }).name_fa
                    : (emp.departments as { name_en: string }).name_en
                  : '—'}
              </p>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {(emp.user_roles as { role: string }[]).map((r) => r.role).join(', ') || '—'}
                </p>
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myRoles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user?.id ?? '');
  const isAdmin = (myRoles ?? []).some((r) => r.role === 'admin');

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title={t('employees.title')}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/${locale}/team`}>{tTeam('navLink')}</Link>
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/${locale}/manage/settings`} data-testid="nav-settings">
                  {t('settingsLink')}
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/${locale}/manage/approvals`}>{t('approvalsLink')}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/${locale}/manage/employees/new`}>{t('employees.addNew')}</Link>
            </Button>
          </div>
        }
      />
      <Suspense fallback={<ListSkeleton count={4} />}>
        <EmployeesData locale={locale} isAdmin={isAdmin} />
      </Suspense>
    </main>
  );
}
