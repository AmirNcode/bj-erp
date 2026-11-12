/**
 * Manage › Employees. `people` read holders read company-wide; anyone with
 * direct reports (FR-74, any role) reads only those. Writes stay restricted per
 * permission on the edit page and in RLS (FR-55); managers write nothing.
 * Absorbs the old My Team page as the `reports` filter (/team redirects here).
 *
 * All list state is in the URL (q, dept, filter, page, sort, dir) and the query runs
 * server-side, 25 rows per page. The desktop table is a client component
 * (admin bulk selection + password regeneration); the mobile cards stay
 * server-rendered.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight, ClipboardCheck, IdCard, Lock, Plus, Upload } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { listRoles } from '@/lib/actions/roles';
import { can } from '@/lib/permissions/catalog';
import { todayInAppTz } from '@/lib/appDate';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import {
  EMPLOYEES_PAGE_SIZE,
  employeesHref,
  employeesOrder,
  ilikeTerm,
  pageRange,
  parseEmployeesQuery,
  type EmployeesQuery,
} from '@/lib/employees/list';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/Skeletons';
import { getEmployeeLeaveTotals } from '@/lib/actions/leave/totals';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { passwordResetEligibleIds } from '@/lib/employees/passwordReset';
import { EmployeesTable, type EmployeeRow } from './EmployeesTable';
import { PersonAvatar } from '@/components/PersonAvatar';
import { EmployeesToolbar } from './EmployeesToolbar';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const LIST_SELECT = `id, employee_code, personnel_no, full_name, first_name, last_name, active, hire_date,
       departments!profiles_department_id_fkey (name_fa, name_en),
       user_roles (user_id, role_id)`;
const INCOMPLETE_EMBED = 'employee_personal_info!employee_personal_info_employee_id_fkey!inner(complete)';

// ── async child that owns the list query ───────────────────────────────────
async function EmployeesData({
  locale,
  query,
  canBulkReset,
  showLocks,
}: {
  locale: string;
  query: EmployeesQuery;
  canBulkReset: boolean;
  showLocks: boolean;
}) {
  const [t, tl, tErrand, tLeave, rolesRes, ws] = await Promise.all([
    getTranslations('manage.employees'),
    getTranslations('manage.employees.list'),
    getTranslations('errand'),
    getTranslations('leave'),
    listRoles(),
    getWorkSettings(),
  ]);
  const hoursPerDay = ws.ok ? ws.settings.hoursPerDay : WORK_SETTINGS_FALLBACK.hoursPerDay;
  const durationLabels = durationLabelsFrom(tLeave);
  // Role chips: English role names (D11), in app_list_roles order (system,
  // preset, custom).
  const allRoles = rolesRes.ok ? rolesRes.roles : [];
  const supabase = await createClient();
  const user = await getCachedUser();
  const base = `/${locale}/manage/employees`;

  // '!profiles_department_id_fkey' disambiguates from the manager_id FK; the
  // personal-info embed (FR-53, `incomplete` only) names its FK because
  // updated_by also points at profiles.
  const incomplete = query.filter === 'incomplete';
  let list = supabase
    .from('profiles')
    .select(
      // Same columns either way; the embed only narrows the rows.
      (incomplete ? `${LIST_SELECT}, ${INCOMPLETE_EMBED}` : LIST_SELECT) as typeof LIST_SELECT,
      { count: 'exact' }
    )
    .eq('active', query.filter !== 'inactive');
  if (incomplete) list = list.eq('employee_personal_info.complete', false);
  if (query.filter === 'reports' && user) list = list.eq('manager_id', user.id);
  if (query.dept) list = list.eq('department_id', query.dept);
  const term = ilikeTerm(query.q);
  if (term) {
    list = list.or(
      `full_name.ilike.${term},employee_code.ilike.${term},personnel_no.ilike.${term}`
    );
  }
  const { from, to } = pageRange(query.page);
  for (const { column, ...options } of employeesOrder(query.sort, query.dir)) {
    list = list.order(column, options);
  }
  const { data: employees, count, error } = await list.range(from, to);

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
  // Bulk password reset: checkboxes only on rows the database would accept.
  const [resettable, totalsRes] = await Promise.all([
    canBulkReset ? passwordResetEligibleIds(supabase, ids) : Promise.resolve(new Set<string>()),
    getEmployeeLeaveTotals(ids),
  ]);
  const totals = totalsRes.ok ? totalsRes.totals : {};
  const dur = (m: number) => formatDuration(m, hoursPerDay, locale, durationLabels);
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
    const tot = totals[emp.id];
    const roleSet = new Set((emp.user_roles as { role_id: string }[]).map((r) => r.role_id));
    return {
      id: emp.id,
      employee_code: emp.employee_code,
      personnel_no: emp.personnel_no,
      full_name: emp.full_name,
      first_name: emp.first_name,
      last_name: emp.last_name,
      active: emp.active,
      hireDateLabel: emp.hire_date ? formatCalendarDate(emp.hire_date, locale) : '—',
      departmentLabel: deptName(emp.departments),
      roleLabels: allRoles.filter((r) => roleSet.has(r.id)).map((r) => r.name),
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
      balanceLabel: tot && tot.balanceMinutes !== null ? dur(tot.balanceMinutes) : '—',
      balanceNegative: !!tot && tot.balanceMinutes !== null && tot.balanceMinutes < 0,
      usedLabel: tot ? dur(tot.usedMinutes) : '—',
      unpaidLabel: tot ? dur(tot.unpaidMinutes) : '—',
      isSelf: emp.id === user?.id,
      canReset: resettable.has(emp.id),
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
        canBulkReset={canBulkReset}
        showLocks={showLocks}
        locale={locale}
        base={base}
        query={query}
      />

      {/* Mobile rows: hairlines, no box */}
      <div className="-mx-4 border-y border-border md:hidden">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('noEmployees')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((emp) => (
              <li key={emp.id} className={emp.active ? undefined : 'opacity-55'}>
                <Link
                  href={`/${locale}/manage/employees/${emp.id}`}
                  className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <PersonAvatar id={emp.id} name={emp.full_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate whitespace-nowrap font-medium">
                      <bdi>{emp.full_name}</bdi>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <bdi dir="ltr">{emp.personnel_no ?? '—'}</bdi> ، {emp.departmentLabel}
                    </span>
                  </span>
                  <Next aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

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
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={employeesHref(base, { ...query, page: query.page - 1 })}
                  data-testid="emp-page-prev"
                >
                  <Prev aria-hidden="true" />
                  {tl('prev')}
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <Prev aria-hidden="true" />
                {tl('prev')}
              </Button>
            )}
            {query.page < lastPage ? (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={employeesHref(base, { ...query, page: query.page + 1 })}
                  data-testid="emp-page-next"
                >
                  {tl('next')}
                  <Next aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
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

  const [t, tl, tNav, tClr] = await Promise.all([
    getTranslations('manage'),
    getTranslations('manage.employees.list'),
    getTranslations('nav'),
    getTranslations('clearance'),
  ]);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const [myRoles, perms, capabilities] = await Promise.all([
    getCachedRoles(user.id),
    getCachedPermissions(user.id),
    getApprovalCapabilities(),
  ]);
  const { hasReports } = capabilities;
  // The Manage layout admits anyone with a Manage item; this page is the
  // Employees one (lib/nav/tabs.ts): `people` read only (owner, 2026-11-02);
  // a manager without it finds their team on the org chart.
  if (!can(perms, 'people', 'read')) redirect(`/${locale}/organization`);
  const canSeePersonalInfo = can(perms, 'personal_info', 'read');
  // FR-74: only `people` edit (HR, admin) changes employees; everyone else reads.
  const readOnly = !can(perms, 'people');
  // Same rule as the Add page's guard (FR-74: managers cannot add).
  const canAdd = can(perms, 'people_create');
  const query = parseEmployeesQuery(sp, { isManager: hasReports, canSeePersonalInfo });
  const base = `/${locale}/manage/employees`;

  // Segment counts and the department list: head-only counts, cheap enough to
  // keep outside Suspense so the toolbar (and its search box) never remounts.
  const supabase = await createClient();
  const profilesHead = () => supabase.from('profiles').select('id', { count: 'exact', head: true });
  const [allRes, reportsRes, inactiveRes, incompleteRes, { data: departments }] = await Promise.all([
    profilesHead().eq('active', true),
    hasReports
      ? profilesHead().eq('active', true).eq('manager_id', user.id)
      : Promise.resolve(null),
    profilesHead().eq('active', false),
    canSeePersonalInfo
      ? supabase
          .from('profiles')
          .select(`id, ${INCOMPLETE_EMBED}`, { count: 'exact', head: true })
          .eq('active', true)
          .eq('employee_personal_info.complete', false)
      : Promise.resolve(null),
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
  ]);
  const allCount = allRes.count ?? 0;
  const reportsCount = reportsRes ? (reportsRes.count ?? 0) : null;
  const inactiveCount = inactiveRes.count ?? 0;

  return (
    <div data-wide className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {/* Phones: the top bar already names the section. */}
        <div className="max-md:sr-only">
          <p className="text-[12.5px] text-muted-foreground">{tNav('manage')}</p>
          <h1 className="text-2xl font-bold tracking-tight">{tl('title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSeePersonalInfo && (
            <Button variant="outline" asChild>
              <Link href={`${base}/personal-info`} data-testid="personal-info-link">
                <IdCard aria-hidden="true" />
                {tl('personalInfoLink')}
              </Link>
            </Button>
          )}
          {/* FR-54: clearance forms (فرم تسویه حساب): clearance read lists them,
              edit files new ones (the clearance pages gate each). */}
          {can(perms, 'clearance', 'read') && (
            <Button variant="outline" asChild>
              <Link href={`/${locale}/clearance`} data-testid="clearance-link">
                <ClipboardCheck aria-hidden="true" />
                {tClr('employeesButton')}
              </Link>
            </Button>
          )}
          {can(perms, 'people_create') && (
            <Button variant="outline" asChild>
              <Link href={`${base}/import`} data-testid="import-link">
                <Upload aria-hidden="true" />
                {t('employees.regen.importLink')}
              </Link>
            </Button>
          )}
          {/* Add Department lives under Manage › Departments (D9). */}
          {canAdd && (
            // Phones: full width, first, above the filters (owner, 2026-11-09).
            <Button className="max-sm:order-first max-sm:h-11 max-sm:w-full" asChild>
              <Link href={`${base}/new`} data-testid="add-employee-link">
                <Plus aria-hidden="true" />
                {t('employees.addNew')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <EmployeesToolbar
        base={base}
        query={query}
        counts={{
          all: formatNumber(allCount, locale),
          reports: reportsCount === null ? null : formatNumber(reportsCount, locale),
          inactive: formatNumber(inactiveCount, locale),
          incomplete: incompleteRes ? formatNumber(incompleteRes.count ?? 0, locale) : null,
        }}
        departments={(departments ?? []).map((d) => ({
          id: d.id,
          name: localizedLeaveTypeName(d, locale),
        }))}
      />

      {/* FR-74: only admin and HR change employees. */}
      {readOnly && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid="emp-locked-hint">
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          {tl('lockedHint')}
        </p>
      )}

      <Suspense fallback={<ListSkeleton count={4} />}>
        <EmployeesData
          locale={locale}
          query={query}
          canBulkReset={myRoles.includes('admin')}
          showLocks={readOnly}
        />
      </Suspense>

    </div>
  );
}
