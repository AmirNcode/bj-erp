'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createEmployee } from '@/lib/actions/employees';
import { allocateLeave } from '@/lib/actions/leave';
import { currentYearPeriod } from '@/lib/leave/allocations';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { nativeSelectClass } from '@/lib/native-select';

type Department = { id: string; name_fa: string; name_en: string };
type Manager = { id: string; full_name: string; employee_code: string };
type InitialLeaveType = {
  id: string;
  name_fa: string;
  name_en: string | null;
  default_annual_quota_days: number | null;
};

const ROLES = ['admin', 'manager', 'employee', 'security'] as const;
type Role = (typeof ROLES)[number];

type Props = {
  departments: Department[];
  managers: Manager[];
  leaveTypes: InitialLeaveType[];
  locale: string;
  labels: {
    code: string;
    name: string;
    department: string;
    manager: string;
    roles: string;
    hireDate: string;
    submit: string;
    cancel: string;
    done: string;
    tempPasswordLabel: string;
    tempPasswordHint: string;
    errorLabel: string;
    selectDept: string;
    selectMgr: string;
    noneOption: string;
    allocTitle: string;
    allocWarn: string;
  };
};

function leaveTypeSlug(type: { name_en: string | null; name_fa: string }) {
  const label = (type.name_en ?? type.name_fa).toLowerCase();
  if (label.includes('annual')) return 'annual';
  if (label.includes('sick')) return 'sick';
  return label.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'leave';
}

function defaultDaysFor(type: InitialLeaveType) {
  return type.default_annual_quota_days ?? 0;
}

export function NewEmployeeForm({ departments, managers, leaveTypes, locale, labels }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(['employee']);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAllocationError(null);
    setPending(true);

    const fd = new FormData(e.currentTarget);
    const requestedAllocations = leaveTypes
      .map((type) => ({
        typeId: type.id,
        days: Number(fd.get(`alloc_${type.id}`) || 0),
      }))
      .filter((allocation) => allocation.days > 0);

    const result = await createEmployee({
      employee_code: (fd.get('employee_code') as string).trim(),
      full_name: (fd.get('full_name') as string).trim(),
      department_id: (fd.get('department_id') as string) || undefined,
      manager_id: (fd.get('manager_id') as string) || undefined,
      roles: selectedRoles,
      hire_date: (fd.get('hire_date') as string) || undefined,
    });

    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }

    if (requestedAllocations.length > 0) {
      const { start, end } = currentYearPeriod();
      for (const allocation of requestedAllocations) {
        const allocationResult = await allocateLeave({
          employeeId: result.userId,
          leaveTypeId: allocation.typeId,
          periodStart: start,
          periodEnd: end,
          days: allocation.days,
        });

        if (!allocationResult.ok) {
          setAllocationError(`${labels.allocWarn} ${allocationResult.error}`);
          break;
        }
      }
    }

    setPending(false);
    setTempPassword(result.tempPassword);
  }

  function toggleRole(role: Role) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  if (tempPassword) {
    return (
      <Card className="border-2 border-success/30 bg-success-foreground">
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold text-success">{labels.tempPasswordLabel}</h2>
          <p className="font-mono text-2xl bg-background border border-success/20 rounded-lg px-4 py-3 select-all tracking-widest">
            {tempPassword}
          </p>
          <p className="text-sm text-success">{labels.tempPasswordHint}</p>
          {allocationError && (
            <p
              role="alert"
              className="rounded-lg border border-warning/20 bg-warning-foreground px-4 py-3 text-sm text-warning"
            >
              {allocationError}
            </p>
          )}
          <a
            href={`/${locale}/manage/employees`}
            className="inline-block mt-4 bg-success text-success-foreground px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
            data-testid="done-link"
          >
            ✓ {labels.done}
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <p
              role="alert"
              className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm"
            >
              {labels.errorLabel}: {error}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="employee_code">{labels.code}</Label>
            <Input id="employee_code" name="employee_code" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="full_name">{labels.name}</Label>
            <Input id="full_name" name="full_name" required />
          </div>

          {/* Native <select> — must stay native for Playwright selectOption e2e */}
          <div className="space-y-1.5">
            <Label htmlFor="department_id">{labels.department}</Label>
            <select
              id="department_id"
              name="department_id"
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
              className={nativeSelectClass}
            >
              <option value="">{labels.selectMgr}</option>
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
              {ROLES.map((role) => (
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

          <div className="space-y-1.5">
            <Label htmlFor="hire_date">{labels.hireDate}</Label>
            <Input id="hire_date" name="hire_date" type="date" />
          </div>

          {leaveTypes.length > 0 && (
            <div
              className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4"
              data-testid="alloc-section"
            >
              <span className="block text-sm font-semibold">{labels.allocTitle}</span>
              {leaveTypes.map((type) => {
                const slug = leaveTypeSlug(type);
                const label = locale === 'fa' ? type.name_fa : type.name_en ?? type.name_fa;
                return (
                  <div className="space-y-1.5" key={type.id}>
                    <Label htmlFor={`alloc_${type.id}`}>{label}</Label>
                    <Input
                      id={`alloc_${type.id}`}
                      name={`alloc_${type.id}`}
                      type="number"
                      min={0}
                      step="0.5"
                      defaultValue={defaultDaysFor(type)}
                      data-testid={`alloc-days-${slug}`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={pending}>
              {pending ? '...' : labels.submit}
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
  );
}
