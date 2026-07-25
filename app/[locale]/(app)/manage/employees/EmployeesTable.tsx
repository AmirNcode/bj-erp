'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  bulkResetPasswords,
  type IssuedCredential,
} from '@/lib/actions/employees';
import { CredentialsDownload } from '@/components/CredentialsDownload';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  departmentLabel: string;
  rolesLabel: string;
  isSelf: boolean;
};

type Props = {
  employees: EmployeeRow[];
  isAdmin: boolean;
  locale: string;
  labels: {
    code: string;
    name: string;
    department: string;
    roles: string;
    status: string;
    actions: string;
    active: string;
    inactive: string;
    edit: string;
    noEmployees: string;
    errorLabel: string;
    regen: {
      button: string;
      confirmTitle: string;
      confirmBody: string; // contains {count}
      cancel: string;
      confirm: string;
    };
    credentials: {
      title: string;
      warn: string;
      download: string;
      name: string;
      code: string;
      password: string;
    };
  };
};

/**
 * Desktop employees table. For admins each row gets a checkbox and the
 * toolbar offers bulk password regeneration (the recovery path for a lost
 * one-time credentials file) — confirmed first: old passwords stop working.
 */
export function EmployeesTable({ employees, isAdmin, locale, labels }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<IssuedCredential[] | null>(null);
  const [isPending, startTransition] = useTransition();

  // The caller's own account is excluded — bulk-resetting your own admin
  // password would hand you a lockout.
  const selectable = employees.filter((e) => !e.isSelf);
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.id)));

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
    return <CredentialsDownload credentials={credentials} labels={labels.credentials} />;
  }

  return (
    <div className="hidden md:block space-y-3">
      {isAdmin && selected.size > 0 && (
        <div className="flex items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending} data-testid="regen-passwords">
                {labels.regen.button} ({selected.size})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{labels.regen.confirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {labels.regen.confirmBody.replace('{count}', String(selected.size))}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{labels.regen.cancel}</AlertDialogCancel>
                <AlertDialogAction data-testid="regen-confirm" onClick={regenerate}>
                  {labels.regen.confirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {labels.errorLabel}: {error}
            </p>
          )}
        </div>
      )}

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                {isAdmin && (
                  <th className="px-4 py-3 w-10">
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
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">{labels.code}</th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">{labels.name}</th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">{labels.department}</th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">{labels.roles}</th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">{labels.status}</th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">{labels.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                  {isAdmin && (
                    <td className="px-4 py-3">
                      {!emp.isSelf && (
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
                  <td className="px-4 py-3 font-mono text-sm" dir="ltr">{emp.employee_code}</td>
                  <td className="px-4 py-3">{emp.full_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{emp.departmentLabel}</td>
                  <td className="px-4 py-3 text-muted-foreground">{emp.rolesLabel}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={emp.active ? 'default' : 'secondary'}
                      className={
                        emp.active
                          ? 'bg-success-foreground text-success hover:bg-success-foreground'
                          : 'bg-destructive/10 text-destructive hover:bg-destructive/10'
                      }
                    >
                      {emp.active ? labels.active : labels.inactive}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                      <Link href={`/${locale}/manage/employees/${emp.id}`}>{labels.edit}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    {labels.noEmployees}
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
