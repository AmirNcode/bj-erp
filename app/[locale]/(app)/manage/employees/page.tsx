/**
 * Manage › Employees. admin, hr and manager read company-wide (RLS
 * `can_read_all`); writes stay restricted per role on the edit page and in RLS.
 * Absorbs the old My Team page as the `reports` filter (/team redirects here).
 *
 * All list state is in the URL (q, dept, filter, page) and the query runs
 * server-side, 25 rows per page. The desktop table is a client component
 * (admin bulk selection + password regeneration); the mobile cards stay
 * server-rendered.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Lock, Plus, Upload } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { todayInAppTz } from '@/lib/appDate';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import {
  EMPLOYEES_PAGE_SIZE,
  employeesHref,
  ilikeTerm,
  pageRange,
  parseEmployeesQuery,
  type EmployeesQuery,
} from '@/lib/employees/list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ListSkeleton } from '@/components/Skeletons';
import { EmployeesTable, Avatar, type EmployeeRow } from './EmployeesTable';
import { EmployeesToolbar } from './EmployeesToolbar';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ROLE_ORDER = ['admin', 'hr', 'manager', 'security', 'employee'] as const;

// ── async child that owns the list query ───────────────────────────────────
async function EmployeesData({
  locale,
  query,
  isAdmin,
  showLocks,
}: {
  locale: string;
  query: EmployeesQuery;
  isAdmin: boolean;
  showLocks: boolean;
}) {
  const [t, tl, tr, tRoles, tErrand] = await Promise.all([
    getTranslations('manage.employees'),
    getTranslations('manage.employees.list'),
    getTranslations('manage.employees.regen'),
    getTranslations('roles'),
    getTranslations('errand'),
  ]);
  const supabase = await createClient();
  const user = await getCachedUser();
  const base = `/${locale}/manage/employees`;

  // '!profiles_department_id_fkey' disambiguates from the manager_id FK.
  let list = supabase
    .from('profiles')
    .select(
      `id, employee_code, full_name, active, hire_date,
       departments!profiles_department_id_fkey (name_fa, name_en),
       user_roles (role)`,
      { count: 'exact' }
    )
    .eq('active', query.filter !== 'inactive');
  if (query.filter === 'reports' && user) list = list.eq('manager_id', user.id);
  if (query.dept) list = list.eq('department_id', query.dept);
  const term = ilikeTerm(query.q);
  if (term) {
    list = list.or(
      `full_name.ilike.${term},employee_code.ilike.${term},personnel_no.ilike.${term}`
    );
  }
  const { from, to } = pageRange(query.page);
  const { data: employees, count, error } = await list
    .order('full_name')
    .order('id')
    .range(from, to);

  // Each person's next pending/approved time off, from the reason-less view.
  const ids = (employees ?? []).map((e) => e.id);
  const { data: upcoming } = ids.length
    ? await supabase
        .from('team_leave_calendar')
        .select('employee_id, kind, leave_type_name_fa, leave_type_name_en, start_date, status')
        .in('employee_id', ids)
        .gte('end_date', todayInAppTz())
        .order('start_date')
    : { data: [] };
  const nextByEmployee = new Map<string, NonNullable<typeof upcoming>[number]>();
  for (const u of upcoming ?? []) {
    if (u.employee_id && !nextByEmployee.has(u.employee_id)) nextByEmployee.set(u.employee_id, u);
  }

  const deptName = (d: unknown) => {
    const dep = d as { name_fa: string; name_en: string | null } | null;
    return dep ? localizedLeaveTypeName(dep, locale) : '—';
  };

  const rows: EmployeeRow[] = (employees ?? []).map((emp) => {
    const next = nextByEmployee.get(emp.id);
    const roleSet = new Set((emp.user_roles as { role: string }[]).map((r) => r.role));
    return {
      id: emp.id,
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      active: emp.active,
      hireDateLabel: emp.hire_date ? formatCalendarDate(emp.hire_date, locale) : '—',
      departmentLabel: deptName(emp.departments),
      roleLabels: ROLE_ORDER.filter((r) => roleSet.has(r)).map((r) => tRoles(r)),
      upcoming:
        next && next.start_date
          ? {
              label: `${
                next.kind === 'errand'
                  ? tErrand('badge')
                  : localizedLeaveTypeName(
                      { name_fa: next.leave_type_name_fa ?? '—', name_en: next.leave_type_name_en },
                      locale
                    )
              } ، ${formatCalendarDate(next.start_date, locale)}`,
              status: next.status === 'approved' ? 'approved' : 'pending',
            }
          : null,
      isSelf: emp.id === user?.id,
    };
  });

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / EMPLOYEES_PAGE_SIZE));
  const Prev = locale === 'fa' ? ChevronRight : ChevronLeft;
  const Next = locale === 'fa' ? ChevronLeft : ChevronRight;

  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('error')}: {error.message}
        </p>
      )}

      {/* Desktop table (client: admin selection + bulk password regeneration) */}
      <EmployeesTable
        employees={rows}
        isAdmin={isAdmin}
        showLocks={showLocks}
        locale={locale}
        labels={{
          employee: tl('employee'),
          hireDate: t('hireDate'),
          department: t('department'),
          roles: t('roles'),
          upcomingLeave: tl('upcomingLeave'),
          edit: t('edit'),
          locked: tl('locked'),
          noEmployees: t('noEmployees'),
          errorLabel: t('error'),
          // .raw(): EmployeesTable substitutes {count} itself once a selection
          // exists. Calling it with no value throws FORMATTING_ERROR under
          // `next dev` (docs/MEMORY.md).
          selected: tl.raw('selected'),
          clearSelection: tl('clearSelection'),
          regen: {
            button: tr('button'),
            confirmTitle: tr('confirmTitle'),
            confirmBody: tr.raw('confirmBody'),
            cancel: tr('cancel'),
            confirm: tr('confirm'),
          },
        }}
      />

      {/* Mobile cards */}
      <Card className="gap-0 overflow-hidden py-0 md:hidden">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('noEmployees')}</p>
        ) : (
          <ul className="divide-y divide-muted">
            {rows.map((emp) => (
              <li key={emp.id} className={emp.active ? undefined : 'opacity-55'}>
                <Link
                  href={`/${locale}/manage/employees/${emp.id}`}
                  className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <Avatar name={emp.full_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate whitespace-nowrap font-medium">
                      <bdi>{emp.full_name}</bdi>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <bdi dir="ltr">{emp.employee_code}</bdi> ، {emp.departmentLabel}
                    </span>
                  </span>
                  <Next aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {total > 0 && (
        <nav
          aria-label={tl('pagination')}
          className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
          data-testid="emp-pagination"
        >
          <span className="whitespace-nowrap">
            {tl('rangeOf', {
              from: formatNumber(Math.min(from + 1, total), locale),
              to: formatNumber(Math.min(to + 1, total), locale),
              total: formatNumber(total, locale),
            })}
          </span>
          <div className="flex gap-2">
            {query.page > 1 ? (
              <Button variant="outline" size="sm" className="rounded-[10px]" asChild>
                <Link
                  href={employeesHref(base, { ...query, page: query.page - 1 })}
                  data-testid="emp-page-prev"
                >
                  <Prev aria-hidden="true" />
                  {tl('prev')}
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="rounded-[10px]" disabled>
                <Prev aria-hidden="true" />
                {tl('prev')}
              </Button>
            )}
            {query.page < lastPage ? (
              <Button variant="outline" size="sm" className="rounded-[10px]" asChild>
                <Link
                  href={employeesHref(base, { ...query, page: query.page + 1 })}
                  data-testid="emp-page-next"
                >
                  {tl('next')}
                  <Next aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="rounded-[10px]" disabled>
                {tl('next')}
                <Next aria-hidden="true" />
              </Button>
            )}
          </div>
        </nav>
      )}
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function EmployeesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const [t, tl, tNav] = await Promise.all([
    getTranslations('manage'),
    getTranslations('manage.employees.list'),
    getTranslations('nav'),
  ]);

  const user = await getCachedUser();
  const myRoles = user ? await getCachedRoles(user.id) : [];
  const isAdmin = myRoles.includes('admin');
  const isHr = myRoles.includes('hr');
  const isManager = myRoles.includes('manager');
  const query = parseEmployeesQuery(sp, { isManager });
  const base = `/${locale}/manage/employees`;

  // Segment counts and the department list: head-only counts, cheap enough to
  // keep outside Suspense so the toolbar (and its search box) never remounts.
  const supabase = await createClient();
  const profilesHead = () =>
    supabase.from('profiles').select('id', { count: 'exact', head: true });
  const [allRes, reportsRes, inactiveRes, { data: departments }] = await Promise.all([
    profilesHead().eq('active', true),
    isManager && user
      ? profilesHead().eq('active', true).eq('manager_id', user.id)
      : Promise.resolve(null),
    profilesHead().eq('active', false),
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
  ]);
  const allCount = allRes.count ?? 0;
  const reportsCount = reportsRes ? (reportsRes.count ?? 0) : null;
  const inactiveCount = inactiveRes.count ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12.5px] text-muted-foreground">{tNav('manage')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{tl('title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(isAdmin || isHr) && (
            <Button variant="outline" className="rounded-[10px]" asChild>
              <Link href={`${base}/import`} data-testid="import-link">
                <Upload aria-hidden="true" />
                {t('employees.regen.importLink')}
              </Link>
            </Button>
          )}
          {/* Add Department lives under Manage › Departments (D9). */}
          <Button className="hidden rounded-[10px] sm:inline-flex" asChild>
            <Link href={`${base}/new`} data-testid="add-employee-link">
              <Plus aria-hidden="true" />
              {t('employees.addNew')}
            </Link>
          </Button>
        </div>
      </div>

      <EmployeesToolbar
        base={base}
        query={query}
        counts={{
          all: formatNumber(allCount, locale),
          reports: reportsCount === null ? null : formatNumber(reportsCount, locale),
          inactive: formatNumber(inactiveCount, locale),
        }}
        departments={(departments ?? []).map((d) => ({
          id: d.id,
          name: localizedLeaveTypeName(d, locale),
        }))}
        labels={{
          filterLabel: tl('filterLabel'),
          filterAll: tl('filterAll'),
          filterReports: tl('filterReports'),
          filterInactive: tl('filterInactive'),
          search: tl('search'),
          department: tl('department'),
          allDepartments: tl('allDepartments'),
        }}
      />

      {/* Managers edit only name and hire date of their direct reports. */}
      {isManager && !isAdmin && !isHr && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid="emp-locked-hint">
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          {tl('lockedHint')}
        </p>
      )}

      <Suspense fallback={<ListSkeleton count={4} />}>
        <EmployeesData
          locale={locale}
          query={query}
          isAdmin={isAdmin}
          showLocks={isManager && !isAdmin && !isHr}
        />
      </Suspense>

      {/* Mobile: floating add button (the header one is desktop-only). */}
      <Link
        href={`${base}/new`}
        aria-label={t('employees.addNew')}
        data-testid="add-employee-fab"
        className="fixed bottom-24 end-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg sm:hidden"
      >
        <Plus aria-hidden="true" className="size-6" />
      </Link>
    </div>
  );
}
