'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateEmployee, setRoles, setActive, resetPassword } from '@/lib/actions/employees';
import { setLeaveBalance } from '@/lib/actions/leave';
import type { BalanceItem } from '@/lib/leave/balances';
import { balanceAdjustments } from '@/lib/leave/allocations';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nativeSelectClass } from '@/lib/native-select';

type Department = { id: string; name_fa: string; name_en: string };
type Manager = { id: string; full_name: string; employee_code: string };
type Profile = {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  manager_id: string | null;
  hire_date: string | null;
  active: boolean;
  language_pref: string;
  calendar_pref: string;
};

const ALL_ROLES = ['admin', 'manager', 'employee', 'security'] as const;
type Role = (typeof ALL_ROLES)[number];

type Props = {
  employee: Profile;
  empRoles: string[];
  isAdmin: boolean;
  departments: Department[];
  managers: Manager[];
  balances: BalanceItem[];
  locale: string;
  labels: {
    code: string;
    name: string;
    department: string;
    manager: string;
    roles: string;
    hireDate: string;
    save: string;
    cancel: string;
    resetPwd: string;
    activate: string;
    deactivate: string;
    tempPasswordLabel: string;
    tempPasswordHint: string;
    errorLabel: string;
    selectDept: string;
    selectMgr: string;
    noneOption: string;
    saved: string;
    managerNote?: string;
    balancesTitle: string;
  };
};

function leaveTypeSlug(type: { name_en: string | null; name_fa: string }) {
  const label = (type.name_en ?? type.name_fa).toLowerCase();
  if (label.includes('annual')) return 'annual';
  if (label.includes('sick')) return 'sick';
  return label.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'leave';
}

export function EditEmployeeForm({
  employee,
  empRoles,
  isAdmin,
  departments,
  managers,
  balances,
  locale,
  labels,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(
    (empRoles as Role[]).filter((r) => ALL_ROLES.includes(r))
  );
  const [targets, setTargets] = useState<Record<string, number>>(
    Object.fromEntries(balances.map((balance) => [balance.leaveTypeId, balance.balance]))
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);

    const fd = new FormData(e.currentTarget);

    // Update basic fields
    const result = await updateEmployee(employee.id, {
      full_name: (fd.get('full_name') as string).trim(),
      hire_date: (fd.get('hire_date') as string) || null,
      ...(isAdmin
        ? {
            department_id: (fd.get('department_id') as string) || null,
            manager_id: (fd.get('manager_id') as string) || null,
          }
        : {}),
    });

    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    // Update roles if admin
    if (isAdmin) {
      const rolesResult = await setRoles(employee.id, selectedRoles);
      if (!rolesResult.ok) {
        setPending(false);
        setError(rolesResult.error);
        return;
      }

      const changes = balanceAdjustments(
        balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          balance: balance.balance,
        })),
        Object.entries(targets).map(([leaveTypeId, target]) => ({ leaveTypeId, target }))
      );

      for (const change of changes) {
        const balanceResult = await setLeaveBalance(employee.id, change.leaveTypeId, change.target);
        if (!balanceResult.ok) {
          setPending(false);
          setError(balanceResult.error);
          return;
        }
      }
    }

    setPending(false);
    setSuccess(true);
  }

  async function handleResetPassword() {
    setError(null);
    setPending(true);
    const result = await resetPassword(employee.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewTempPassword(result.tempPassword);
  }

  async function handleToggleActive() {
    setError(null);
    setPending(true);
    const result = await setActive(employee.id, !employee.active);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function toggleRole(role: Role) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  return (
    <div className="space-y-6">
      {!isAdmin && labels.managerNote && (
        <p className="bg-secondary text-secondary-foreground border border-border px-4 py-3 rounded-lg text-sm">
          {labels.managerNote}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm"
        >
          {labels.errorLabel}: {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="bg-success-foreground border border-success/20 text-success px-4 py-3 rounded-lg text-sm"
        >
          {labels.saved}
        </p>
      )}
      {newTempPassword && (
        <Card className="border-2 border-success/30 bg-success-foreground">
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold text-success">{labels.tempPasswordLabel}</p>
            <p className="font-mono text-xl bg-background border border-success/20 rounded-lg px-4 py-2 select-all tracking-widest">
              {newTempPassword}
            </p>
            <p className="text-xs text-success">{labels.tempPasswordHint}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">{labels.name}</Label>
              <Input
                id="full_name"
                name="full_name"
                required
                defaultValue={employee.full_name}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hire_date">{labels.hireDate}</Label>
              <Input
                id="hire_date"
                name="hire_date"
                type="date"
                defaultValue={employee.hire_date ?? ''}
              />
            </div>

            {isAdmin && (
              <>
                {/* Native <select> — must stay native for Playwright selectOption e2e */}
                <div className="space-y-1.5">
                  <Label htmlFor="department_id">{labels.department}</Label>
                  <select
                    id="department_id"
                    name="department_id"
                    defaultValue={employee.department_id ?? ''}
                    className={nativeSelectClass}
                  >
                    <option value="">{labels.selectDept}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {locale === 'fa' ? d.name_fa : d.name_en}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="manager_id">{labels.manager}</Label>
                  <select
                    id="manager_id"
                    name="manager_id"
                    defaultValue={employee.manager_id ?? ''}
                    className={nativeSelectClass}
                  >
                    <option value="">{labels.noneOption}</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} ({m.employee_code})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Native role checkboxes — must stay native for Playwright label+checkbox e2e */}
                <div className="space-y-2">
                  <span className="block text-sm font-medium leading-none">{labels.roles}</span>
                  <div className="flex flex-wrap gap-3">
                    {ALL_ROLES.map((role) => (
                      <label key={role} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedRoles.includes(role)}
                          onChange={() => toggleRole(role)}
                          className="rounded border-input text-primary focus:ring-ring"
                        />
                        <span className="text-sm">{role}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {balances.length > 0 && (
                  <div
                    className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4"
                    data-testid="balances-section"
                  >
                    <span className="block text-sm font-semibold">{labels.balancesTitle}</span>
                    {balances.map((balance) => {
                      const slug = leaveTypeSlug(balance);
                      const label =
                        locale === 'fa'
                          ? balance.name_fa
                          : balance.name_en ?? balance.name_fa;
                      return (
                        <div className="space-y-1.5" key={balance.leaveTypeId}>
                          <Label htmlFor={`balance-${balance.leaveTypeId}`}>{label}</Label>
                          <Input
                            id={`balance-${balance.leaveTypeId}`}
                            type="number"
                            min={0}
                            step="0.5"
                            value={targets[balance.leaveTypeId] ?? 0}
                            onChange={(event) =>
                              setTargets((prev) => ({
                                ...prev,
                                [balance.leaveTypeId]: Number(event.target.value),
                              }))
                            }
                            data-testid={`balance-days-${slug}`}
                            data-leave-type-id={balance.leaveTypeId}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={pending}>
                {pending ? '...' : labels.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/${locale}/manage/employees`)}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Admin actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetPassword}
              disabled={pending}
              className="border-orange-300 text-orange-700 hover:bg-orange-50"
            >
              {labels.resetPwd}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleActive}
              disabled={pending}
              className={
                employee.active
                  ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                  : 'border-success/30 text-success hover:bg-success-foreground'
              }
            >
              {employee.active ? labels.deactivate : labels.activate}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
