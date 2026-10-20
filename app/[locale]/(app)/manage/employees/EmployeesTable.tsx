'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Lock, Pencil } from 'lucide-react';
import {
  bulkResetPasswords,
  type IssuedCredential,
} from '@/lib/actions/employees';
import { CredentialsDownload } from '@/components/CredentialsDownload';
import { STATUS_BADGE_STYLES } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/i18n/format';
import { resetSelectableIds } from '@/lib/employees/passwordReset';
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
  full_name: string;
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
};

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
    >
      {name.trim().charAt(0)}
    </span>
  );
}

/**
 * Desktop employees table. For the admin each eligible row gets a checkbox; a selection
 * opens a bar offering bulk password regeneration (the recovery path for a lost
 * one-time credentials file) — confirmed first: old passwords stop working.
 */
export function EmployeesTable({ employees, canBulkReset, showLocks, locale }: Props) {
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
  const th = 'px-4 py-3 text-start font-semibold whitespace-nowrap text-foreground/80';
  const colCount = (canBulkReset ? 1 : 0) + 6;

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

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                {canBulkReset && (
                  <th className="w-10 px-4 py-3">
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
                <th className={th}>{tl('employee')}</th>
                <th className={th}>{t('hireDate')}</th>
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
                <th className="w-12 px-4 py-3">
                  <span className="sr-only">{t('edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className={cn('transition-colors hover:bg-muted/30', !emp.active && 'opacity-55')}
                >
                  {canBulkReset && (
                    <td className="px-4 py-3">
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={emp.full_name} />
                      <div className="min-w-0">
                        <div className="whitespace-nowrap font-medium">
                          <bdi>{emp.full_name}</bdi>
                        </div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {emp.employee_code}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{emp.hireDateLabel}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {emp.departmentLabel}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {emp.roleLabels.length === 0
                        ? '—'
                        : emp.roleLabels.map((r) => (
                            <span
                              key={r}
                              className="whitespace-nowrap rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                            >
                              {r}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {emp.upcoming ? (
                      <Badge
                        variant="outline"
                        className={cn('rounded-full', STATUS_BADGE_STYLES[emp.upcoming.status])}
                      >
                        {emp.upcoming.label}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
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
      </Card>
    </div>
  );
}
