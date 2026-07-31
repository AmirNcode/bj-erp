'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createEmployee } from '@/lib/actions/employees';
import { allocateLeave, setEmployeeLeavePolicy } from '@/lib/actions/leave';
import { daysToMinutes } from '@/lib/leave/duration';
import { currentYearPeriod } from '@/lib/leave/allocations';
import {
  buildEmployeeCode,
  isValidPersonnelNo,
  normalizePersonnelNo,
} from '@/lib/employees/code';
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
  default_accrual_minutes_per_month: number | null;
  default_annual_cap_minutes: number | null;
  default_carryover_cap_minutes: number;
};

const ROLES = ['admin', 'manager', 'employee', 'security'] as const;
type Role = (typeof ROLES)[number];

type Props = {
  isAdmin: boolean;
  ownDepartment: Department | null;
  ownName: string;
  departments: Department[];
  managers: Manager[];
  leaveTypes: InitialLeaveType[];
  /** Company day length: the inputs are days, the ledger stores minutes. */
  hoursPerDay: number;
  /** Gregorian start of the current Jalali month — the accrual start default. */
  accrualStartMonth: string;
  locale: string;
  labels: {
    personnelNo: string;
    jobTitle: string;
    codePreview: string;
    defaultQuotaHint: string;
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
    policyTitle: string;
    policyHint: string;
    policyRate: string;
    policyAnnualCap: string;
    policyCarryCap: string;
    policyWarn: string;
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

/**
 * Minutes -> the days figure the policy inputs show. 0 means "no cap" for the
 * annual field, which setEmployeeLeavePolicy turns back into null.
 */
function minutesToDaysInput(minutes: number | null, hoursPerDay: number): number {
  if (!minutes || minutes <= 0) return 0;
  return Math.round((minutes / (hoursPerDay * 60)) * 100) / 100;
}

export function NewEmployeeForm({
  isAdmin,
  ownDepartment,
  ownName,
  departments,
  managers,
  leaveTypes,
  hoursPerDay,
  accrualStartMonth,
  locale,
  labels,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(['employee']);
  const [personnelNo, setPersonnelNo] = useState('');
  // Admin picks a department; manager is locked to their own.
  const [deptId, setDeptId] = useState(isAdmin ? '' : ownDepartment?.id ?? '');

  // Since 20260730130002 the login code is the personnel number alone — the
  // department no longer feeds it, so the preview does not wait for one.
  const normalizedPno = normalizePersonnelNo(personnelNo);
  const codePreview = isValidPersonnelNo(normalizedPno)
    ? buildEmployeeCode(normalizedPno)
    : '—';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAllocationError(null);
    setPolicyError(null);
    setPending(true);

    const fd = new FormData(e.currentTarget);
    const requestedAllocations = isAdmin
      ? leaveTypes
          .map((type) => ({
            typeId: type.id,
            days: Number(fd.get(`alloc_${type.id}`) || 0),
          }))
          .filter((allocation) => allocation.days > 0)
      : [];

    const result = await createEmployee({
      personnel_no: normalizedPno,
      full_name: (fd.get('full_name') as string).trim(),
      job_title: ((fd.get('job_title') as string) || '').trim() || undefined,
      department_id: isAdmin ? (fd.get('department_id') as string) || undefined : undefined,
      manager_id: isAdmin ? (fd.get('manager_id') as string) || undefined : undefined,
      roles: isAdmin ? selectedRoles : undefined,
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
          minutes: daysToMinutes(allocation.days, hoursPerDay),
        });

        if (!allocationResult.ok) {
          setAllocationError(`${labels.allocWarn} ${allocationResult.error}`);
          break;
        }
      }
    }

    // Accrual policy per balance-affecting type. Separate from the opening
    // allocation above: that is a one-off starting position, this is the rule that
    // keeps adding to it every month.
    if (isAdmin) {
      for (const type of leaveTypes) {
        const rateDays = Number(fd.get(`policy_rate_${type.id}`) || 0);
        const capDays = Number(fd.get(`policy_cap_${type.id}`) || 0);
        const carryDays = Number(fd.get(`policy_carry_${type.id}`) || 0);

        const policyResult = await setEmployeeLeavePolicy({
          employeeId: result.userId,
          leaveTypeId: type.id,
          accrualMinutesPerMonth: daysToMinutes(rateDays, hoursPerDay),
          annualCapMinutes: capDays > 0 ? daysToMinutes(capDays, hoursPerDay) : null,
          carryoverCapMinutes: daysToMinutes(carryDays, hoursPerDay),
          accrualStartMonth,
        });

        if (!policyResult.ok) {
          setPolicyError(`${labels.policyWarn} ${policyResult.error}`);
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
          <p
            data-testid="temp-password"
            className="font-mono text-2xl bg-background border border-success/20 rounded-lg px-4 py-3 select-all tracking-widest"
          >
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
            <Label htmlFor="full_name">{labels.name}</Label>
            <Input id="full_name" name="full_name" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="personnel_no">{labels.personnelNo}</Label>
            {/* Becomes part of the login code — digits only, LTR even in fa. */}
            <Input
              id="personnel_no"
              name="personnel_no"
              data-testid="personnel-no"
              required
              dir="ltr"
              inputMode="numeric"
              autoCapitalize="off"
              autoCorrect="off"
              value={personnelNo}
              onChange={(e) => setPersonnelNo(e.target.value)}
            />
          </div>

          {isAdmin ? (
            /* Native <select> — must stay native for Playwright selectOption e2e */
            <div className="space-y-1.5">
              <Label htmlFor="department_id">{labels.department}</Label>
              <select
                id="department_id"
                name="department_id"
                required
                className={nativeSelectClass}
                value={deptId}
                onChange={(e) => setDeptId(e.target.value)}
              >
                <option value="">{labels.selectDept}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {locale === 'fa' ? d.name_fa : d.name_en}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium leading-none">{labels.department}</span>
              <p className="text-sm rounded-lg border border-border bg-secondary/40 px-3 py-2" data-testid="dept-locked">
                {locale === 'fa' ? ownDepartment?.name_fa : ownDepartment?.name_en}
              </p>
            </div>
          )}

          {isAdmin ? (
            <div className="space-y-1.5">
              <Label htmlFor="manager_id">{labels.manager}</Label>
              <select id="manager_id" name="manager_id" className={nativeSelectClass}>
                <option value="">{labels.selectMgr}</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({m.employee_code})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium leading-none">{labels.manager}</span>
              <p className="text-sm rounded-lg border border-border bg-secondary/40 px-3 py-2" data-testid="mgr-locked">
                {ownName}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="job_title">{labels.jobTitle}</Label>
            <Input id="job_title" name="job_title" data-testid="job-title" />
          </div>

          {/* Live preview of the generated login code (source of truth: DB). */}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium leading-none">{labels.codePreview}</span>
            <p
              className="font-mono text-sm rounded-lg border border-border bg-secondary/40 px-3 py-2 select-all"
              dir="ltr"
              data-testid="code-preview"
            >
              {codePreview}
            </p>
          </div>

          {isAdmin && (
            /* Native role checkboxes — must stay native for Playwright label+checkbox e2e */
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
          )}

          <div className="space-y-1.5">
            <Label htmlFor="hire_date">{labels.hireDate}</Label>
            <Input id="hire_date" name="hire_date" type="date" />
          </div>

          {isAdmin && leaveTypes.length > 0 && (
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

          {isAdmin && leaveTypes.length > 0 && (
            <div
              className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4"
              data-testid="policy-section"
            >
              <div>
                <span className="block text-sm font-semibold">{labels.policyTitle}</span>
                <p className="mt-1 text-sm text-muted-foreground">{labels.policyHint}</p>
              </div>
              {leaveTypes.map((type) => {
                const slug = leaveTypeSlug(type);
                const label = locale === 'fa' ? type.name_fa : type.name_en ?? type.name_fa;
                return (
                  <fieldset className="space-y-1.5" key={`policy-${type.id}`}>
                    <legend className="text-sm font-medium">{label}</legend>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor={`policy_rate_${type.id}`} className="text-xs">
                          {labels.policyRate}
                        </Label>
                        <Input
                          id={`policy_rate_${type.id}`}
                          name={`policy_rate_${type.id}`}
                          type="number"
                          min={0}
                          step="0.5"
                          defaultValue={minutesToDaysInput(
                            type.default_accrual_minutes_per_month,
                            hoursPerDay
                          )}
                          data-testid={`policy-rate-${slug}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`policy_cap_${type.id}`} className="text-xs">
                          {labels.policyAnnualCap}
                        </Label>
                        <Input
                          id={`policy_cap_${type.id}`}
                          name={`policy_cap_${type.id}`}
                          type="number"
                          min={0}
                          step="0.5"
                          defaultValue={minutesToDaysInput(
                            type.default_annual_cap_minutes,
                            hoursPerDay
                          )}
                          data-testid={`policy-cap-${slug}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`policy_carry_${type.id}`} className="text-xs">
                          {labels.policyCarryCap}
                        </Label>
                        <Input
                          id={`policy_carry_${type.id}`}
                          name={`policy_carry_${type.id}`}
                          type="number"
                          min={0}
                          step="0.5"
                          defaultValue={minutesToDaysInput(
                            type.default_carryover_cap_minutes,
                            hoursPerDay
                          )}
                          data-testid={`policy-carry-${slug}`}
                        />
                      </div>
                    </div>
                  </fieldset>
                );
              })}
              {policyError && (
                <p role="alert" className="text-sm text-destructive" data-testid="policy-error">
                  {policyError}
                </p>
              )}
            </div>
          )}

          {!isAdmin && (
            <p className="text-sm text-muted-foreground rounded-lg border border-border bg-secondary/40 px-3 py-2" data-testid="default-quota-hint">
              {labels.defaultQuotaHint}
            </p>
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
