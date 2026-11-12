'use client';

import { Fragment, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Lock, Pencil } from 'lucide-react';
import {
  bulkResetPasswords,
  type IssuedCredential,
} from '@/lib/actions/employees';
import { CredentialsDownload } from '@/components/CredentialsDownload';
import { STATUS_BADGE_STYLES } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/i18n/format';
import {
  employeesHref,
  nextSort,
  type EmployeesQuery,
  type EmployeesSort,
} from '@/lib/employees/list';
import { COLUMN_SHOW, DETAIL_HIDE, EXPAND_HIDE, type EmpColumn } from '@/lib/employees/columns';
import { resetSelectableIds } from '@/lib/employees/passwordReset';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export type EmployeeRow = {
  id: string;
  employee_code: string;
  /** The ID column (FR-83); null shows «—». */
  personnel_no: string | null;
  full_name: string;
  first_name: string;
  /** Blank until someone splits the name (FR-83): first_name then holds all of it. */
  last_name: string | null;
  active: boolean;
  hireDateLabel: string;
  departmentLabel: string;
  /** Role names as stored (FR-55 D11: English everywhere, custom roles included) — never the raw enum values. */
  roleLabels: string[];
  /** Next pending/approved leave, pre-formatted; null when none. */
  upcoming: { label: string; status: 'pending' | 'approved' } | null;
  /** Annual-leave balance, pre-formatted; «—» when none (FR-92). */
  balanceLabel: string;
  balanceNegative: boolean;
  /** Annual leave used this year, pre-formatted. */
  usedLabel: string;
  /** Unpaid time this year, pre-formatted. */
  unpaidLabel: string;
  isSelf: boolean;
  /** The caller may bulk-reset this person's password (the database rule; never yourself). */
  canReset: boolean;
};

type Props = {
  employees: EmployeeRow[];
  /** The admin: row checkboxes and bulk password regeneration (resets are admin-only). */
  canBulkReset: boolean;
  /** Manager without people edit: department and roles are read-only for them. */
  showLocks: boolean;
  locale: string;
  /** List URL and current list state, for the sortable headers (FR-83). */
  base: string;
  query: EmployeesQuery;
};

const TH = 'px-3 py-2.5 text-start';

/** A sortable header: a link, so it keeps every other list param and works without state. */
function SortableTh({
  sort,
  label,
  base,
  query,
  col,
}: {
  sort: EmployeesSort;
  col?: EmpColumn;
  label: string;
  base: string;
  query: EmployeesQuery;
}) {
  const active = query.sort === sort;
  const Icon = !active ? ChevronsUpDown : query.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={cn(TH, col && COLUMN_SHOW[col])} aria-sort={!active ? 'none' : query.dir === 'asc' ? 'ascending' : 'descending'}>
      <Link
        href={employeesHref(base, { ...query, ...nextSort(query, sort) })}
        replace
        scroll={false}
        data-testid={`emp-sort-${sort}`}
        className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {label}
        <Icon
          aria-hidden="true"
          className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground/60')}
        />
      </Link>
    </th>
  );
}

/**
 * Desktop employees table. For the admin each eligible row gets a checkbox; a selection
 * opens a bar offering bulk password regeneration (the recovery path for a lost
 * one-time credentials file) — confirmed first: old passwords stop working.
 */
export function EmployeesTable({ employees, canBulkReset, showLocks, locale, base, query }: Props) {
  const t = useTranslations('manage.employees');
  const tl = useTranslations('manage.employees.list');
  const tr = useTranslations('manage.employees.regen');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<IssuedCredential[] | null>(null);
  const [isPending, startTransition] = useTransition();

  // Only rows the database would accept (lib/employees/passwordReset.ts): never
  // the caller's own account, and for a non-admin never the admin or anyone who
  // holds more (D4), since one refused row refuses the whole batch.
  const selectable = resetSelectableIds(employees);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable));

  const regenerate = () =>
    startTransition(async () => {
      setError(null);
      const result = await bulkResetPasswords([...selected]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      setCredentials(result.credentials);
    });

  if (credentials) {
    return <CredentialsDownload credentials={credentials} />;
  }

  const lock = showLocks ? (
    <Lock aria-label={tl('locked')} className="inline size-3 text-muted-foreground" />
  ) : null;
  const th = TH;
  const colCount = (canBulkReset ? 1 : 0) + 11;

  return (
    <div className="hidden space-y-3 md:block">
      {canBulkReset && selected.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-secondary px-3 py-2.5"
          data-testid="emp-bulk-bar"
        >
          <span className="whitespace-nowrap text-sm font-semibold text-secondary-foreground">
            {tl('selected', { count: formatNumber(selected.size, locale) })}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending} data-testid="regen-passwords">
                {tr('button')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr('confirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tr('confirmBody', { count: String(selected.size) })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr('cancel')}</AlertDialogCancel>
                <AlertDialogAction data-testid="regen-confirm" onClick={regenerate}>
                  {tr('confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {tl('clearSelection')}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t('error')}: {error}
            </p>
          )}
        </div>
      )}

      <div className="border-b border-border">
        <div className="@container">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                {canBulkReset && (
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="select all"
                      data-testid="emp-check-all"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-input text-primary focus:ring-ring"
                    />
                  </th>
                )}
                <SortableTh sort="first" label={tl('firstName')} base={base} query={query} />
                <SortableTh col="last" sort="last" label={tl('lastName')} base={base} query={query} />
                <SortableTh col="id" sort="id" label={tl('idColumn')} base={base} query={query} />
                <SortableTh col="hire" sort="hire" label={t('hireDate')} base={base} query={query} />
                <th className={cn(th, COLUMN_SHOW.department)}>
                  <span className="inline-flex items-center gap-1">
                    {t('department')}
                    {lock}
                  </span>
                </th>
                <th className={cn(th, COLUMN_SHOW.roles)}>
                  <span className="inline-flex items-center gap-1">
                    {t('roles')}
                    {lock}
                  </span>
                </th>
                <th className={cn(th, COLUMN_SHOW.upcoming)}>{tl('upcomingLeave')}</th>
                <th className={cn(th, COLUMN_SHOW.balance)}>{t('balance')}</th>
                <th className={cn(th, COLUMN_SHOW.used)}>{t('usedThisYear')}</th>
                <th className={cn(th, COLUMN_SHOW.unpaid)}>{t('unpaid')}</th>
                <th className={cn('w-12 px-3 py-2.5', COLUMN_SHOW.edit)}>
                  <span className="sr-only">{t('edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.map((emp) => {
                const expanded = open.has(emp.id);
                const roles =
                  emp.roleLabels.length === 0
                    ? '—'
                    : emp.roleLabels.map((r) => (
                        <span
                          key={r}
                          className="whitespace-nowrap rounded-sm bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                        >
                          {r}
                        </span>
                      ));
                const upcoming = emp.upcoming ? (
                  <Badge
                    variant="outline"
                    className={cn('rounded-sm', STATUS_BADGE_STYLES[emp.upcoming.status])}
                  >
                    {emp.upcoming.label}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                );
                const balance = (
                  <span className={cn(emp.balanceNegative && 'text-destructive')}>
                    <bdi>{emp.balanceLabel}</bdi>
                  </span>
                );
                const lastName = emp.last_name ? (
                  <bdi>{emp.last_name}</bdi>
                ) : (
                  <span className="font-normal text-muted-foreground">—</span>
                );
                // The columns hidden at the current width, in table order, for the panel.
                const details: { col: EmpColumn; label: string; value: React.ReactNode }[] = [
                  { col: 'last', label: tl('lastName'), value: lastName },
                  { col: 'id', label: tl('idColumn'), value: <bdi dir="ltr">{emp.personnel_no ?? '—'}</bdi> },
                  { col: 'hire', label: t('hireDate'), value: emp.hireDateLabel },
                  { col: 'department', label: t('department'), value: emp.departmentLabel },
                  { col: 'roles', label: t('roles'), value: <div className="flex flex-wrap gap-1">{roles}</div> },
                  { col: 'upcoming', label: tl('upcomingLeave'), value: upcoming },
                  { col: 'balance', label: t('balance'), value: balance },
                  { col: 'used', label: t('usedThisYear'), value: <bdi>{emp.usedLabel}</bdi> },
                  { col: 'unpaid', label: t('unpaid'), value: <bdi>{emp.unpaidLabel}</bdi> },
                ];
                return (
                  <Fragment key={emp.id}>
                    <tr className={cn(!emp.active && 'opacity-55')}>
                      {canBulkReset && (
                        <td className="px-3 py-2.5">
                          {emp.canReset && (
                            <input
                              type="checkbox"
                              aria-label={emp.employee_code}
                              data-testid={`emp-check-${emp.employee_code}`}
                              checked={selected.has(emp.id)}
                              onChange={() => toggle(emp.id)}
                              className="rounded border-input text-primary focus:ring-ring"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn('-ms-1 shrink-0', EXPAND_HIDE)}
                            aria-expanded={expanded}
                            aria-label={expanded ? t('hideDetails') : t('showDetails')}
                            data-testid={`emp-expand-${emp.employee_code}`}
                            onClick={() => toggleOpen(emp.id)}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={cn('transition-transform', expanded && 'rotate-180')}
                            />
                          </Button>
                          <PersonAvatar id={emp.id} name={emp.full_name} />
                          <span className="whitespace-nowrap font-medium">
                            <bdi>{emp.first_name}</bdi>
                            {/* Narrow: the last-name column is hidden, so show the whole name. */}
                            {emp.last_name && (
                              <span className="@xl:hidden">
                                {' '}
                                <bdi>{emp.last_name}</bdi>
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 font-medium', COLUMN_SHOW.last)}>
                        {lastName}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 text-muted-foreground', COLUMN_SHOW.id)}>
                        <bdi dir="ltr">{emp.personnel_no ?? '—'}</bdi>
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5', COLUMN_SHOW.hire)}>
                        {emp.hireDateLabel}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 text-muted-foreground', COLUMN_SHOW.department)}>
                        {emp.departmentLabel}
                      </td>
                      <td className={cn('px-3 py-2.5', COLUMN_SHOW.roles)}>
                        <div className="flex flex-wrap gap-1">{roles}</div>
                      </td>
                      <td className={cn('px-3 py-2.5', COLUMN_SHOW.upcoming)}>{upcoming}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5', COLUMN_SHOW.balance)}>{balance}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5', COLUMN_SHOW.used)}>
                        <bdi>{emp.usedLabel}</bdi>
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5', COLUMN_SHOW.unpaid)}>
                        <bdi>{emp.unpaidLabel}</bdi>
                      </td>
                      <td className={cn('px-3 py-2.5', COLUMN_SHOW.edit)}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-primary hover:text-primary"
                          asChild
                        >
                          <Link href={`/${locale}/manage/employees/${emp.id}`}>
                            <Pencil aria-hidden="true" />
                            {/* Visible to screen readers and to e2e `a:has-text("Edit")`. */}
                            <span className="sr-only">{t('edit')}</span>
                          </Link>
                        </Button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr
                        className={cn('bg-muted/30', EXPAND_HIDE)}
                        data-testid={`emp-details-${emp.employee_code}`}
                      >
                        <td colSpan={colCount} className="px-3 py-3">
                          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
                            {details.map((d) => (
                              <Fragment key={d.col}>
                                <dt className={cn('text-muted-foreground', DETAIL_HIDE[d.col])}>{d.label}</dt>
                                <dd className={cn('min-w-0 font-medium', DETAIL_HIDE[d.col])}>{d.value}</dd>
                              </Fragment>
                            ))}
                          </dl>
                          <Button
                            variant="outline"
                            className="mt-3 w-full @xl:hidden"
                            asChild
                            data-testid={`emp-details-edit-${emp.employee_code}`}
                          >
                            <Link href={`/${locale}/manage/employees/${emp.id}`}>
                              <Pencil aria-hidden="true" />
                              {t('edit')}
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">
                    {t('noEmployees')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
