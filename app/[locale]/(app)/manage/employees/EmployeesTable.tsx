'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronsUpDown, Lock, Pencil } from 'lucide-react';
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

const TH = 'px-4 py-2.5 text-start';

/** A sortable header: a link, so it keeps every other list param and works without state. */
function SortableTh({
  sort,
  label,
  base,
  query,
}: {
  sort: EmployeesSort;
  label: string;
  base: string;
  query: EmployeesQuery;
}) {
  const active = query.sort === sort;
  const Icon = !active ? ChevronsUpDown : query.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={TH} aria-sort={!active ? 'none' : query.dir === 'asc' ? 'ascending' : 'descending'}>
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
  const colCount = (canBulkReset ? 1 : 0) + 8;

  return (
    <div className="hidden space-y-3 md:block">
      {canBulkReset && selected.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-secondary px-4 py-2.5"
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
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                {canBulkReset && (
                  <th className="w-10 px-4 py-2.5">
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
                <SortableTh sort="last" label={tl('lastName')} base={base} query={query} />
                <SortableTh sort="id" label={tl('idColumn')} base={base} query={query} />
                <SortableTh sort="hire" label={t('hireDate')} base={base} query={query} />
                <th className={th}>
                  <span className="inline-flex items-center gap-1">
                    {t('department')}
                    {lock}
                  </span>
                </th>
                <th className={th}>
                  <span className="inline-flex items-center gap-1">
                    {t('roles')}
                    {lock}
                  </span>
                </th>
                <th className={th}>{tl('upcomingLeave')}</th>
                <th className="w-12 px-4 py-2.5">
                  <span className="sr-only">{t('edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className={cn(!emp.active && 'opacity-55')}
                >
                  {canBulkReset && (
                    <td className="px-4 py-2.5">
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
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <PersonAvatar id={emp.id} name={emp.full_name} />
                      <span className="whitespace-nowrap font-medium">
                        <bdi>{emp.first_name}</bdi>
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                    {emp.last_name ? (
                      <bdi>{emp.last_name}</bdi>
                    ) : (
                      <span className="font-normal text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    <bdi dir="ltr">{emp.personnel_no ?? '—'}</bdi>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">{emp.hireDateLabel}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {emp.departmentLabel}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {emp.roleLabels.length === 0
                        ? '—'
                        : emp.roleLabels.map((r) => (
                            <span
                              key={r}
                              className="whitespace-nowrap rounded-sm bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                            >
                              {r}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {emp.upcoming ? (
                      <Badge
                        variant="outline"
                        className={cn('rounded-sm', STATUS_BADGE_STYLES[emp.upcoming.status])}
                      >
                        {emp.upcoming.label}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
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
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">
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
