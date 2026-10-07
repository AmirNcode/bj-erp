'use client';

import { PersonSearch } from '@/components/PersonSearch';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createEmployee } from '@/lib/actions/employees';
import { allocateLeave, setEmployeeLeavePolicy } from '@/lib/actions/leave/balances';
import { daysToMinutes, type DaysHoursError } from '@/lib/leave/duration';
import { currentYearPeriod } from '@/lib/leave/allocations';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
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
import { PersianDateField } from '@/components/PersianDateField';
import {
  AccrualPolicyFields,
  DaysHoursField,
  RoleCheckboxes,
  leaveAmountReader,
  leaveTypeSlug,
  type Role,
} from '../_components/EmployeeFormParts';

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

type Props = {
  isAdmin: boolean;
  /**
   * FR-43: may set the opening leave balance and the accrual policy. Admin or hr.
   * Separate from `isAdmin`, which still gates the ROLE checkboxes — HR creating
   * an admin is refused in the database (FR-35 D4).
   */
  canManageLeave: boolean;
  /**
   * Admin OR hr. Controls only the department and manager pickers (FR-35 D4).
   *
   * Kept separate from `isAdmin` on purpose: HR chooses where a new hire lands
   * without gaining the role checkboxes. (Until FR-43 it also excluded the
   * allocation and accrual fields, because `allocate_leave` and
   * `set_employee_leave_policy` were admin-only in the database; both now admit
   * hr, so those moved to `canManageLeave`.)
   */
  canChooseScope: boolean;
  ownDepartment: Department | null;
  ownName: string;
  departments: Department[];
  managers: Manager[];
  leaveTypes: InitialLeaveType[];
  /** Company day length: the inputs are days + hours, the ledger stores minutes. */
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
    allocHint: string;
    allocWarn: string;
    policyTitle: string;
    policyHint: string;
    policyRate: string;
    policyRateHint: string;
    policyAnnualCap: string;
    policyAnnualCapHint: string;
    policyCarryCap: string;
    policyCarryCapHint: string;
    policyWarn: string;
  };
};

function defaultMinutesFor(type: InitialLeaveType, hoursPerDay: number) {
  return daysToMinutes(type.default_annual_quota_days ?? 0, hoursPerDay);
}

export function NewEmployeeForm({
  isAdmin,
  canManageLeave,
  canChooseScope,
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
  const tDuration = useTranslations('manage.employees.duration');
  const [pending, setPending] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(null);
  const managerOptions = managers.map((m) => ({ id: m.id, name: m.full_name, personnelNo: m.employee_code }));
  const [error, setError] = useState<string | null>(null);
  const [amountErrors, setAmountErrors] = useState<Record<string, DaysHoursError>>({});
  // Errors the database attributes to one input (currently only the personnel
  // number) render beside that input instead of in the banner — a duplicate
  // personnel number used to arrive as a bare "unexpected error" at the top of
  // the page, naming neither the field nor the cause.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(['employee']);
  const [personnelNo, setPersonnelNo] = useState('');
  const [hireDate, setHireDate] = useState<PickerDate | null>(null);
  // Admin picks a department; manager is locked to their own.
  const [deptId, setDeptId] = useState(canChooseScope ? '' : ownDepartment?.id ?? '');

  // Since 20260730130002 the login code is the personnel number alone — the
  // department no longer feeds it, so the preview does not wait for one.
  const normalizedPno = normalizePersonnelNo(personnelNo);
  const codePreview = isValidPersonnelNo(normalizedPno)
    ? buildEmployeeCode(normalizedPno)
    : '—';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    setAllocationError(null);
    setPolicyError(null);
    setPending(true);

    const fd = new FormData(e.currentTarget);
    // Leave amounts are checked before the employee is created, so a bad entry
    // cannot leave a half-set-up account behind.
    const amounts = leaveAmountReader(fd, hoursPerDay);
    const requestedAllocations = canManageLeave
      ? leaveTypes
          .map((type) => ({
            typeId: type.id,
            minutes: amounts.read(`alloc_${type.id}`, false),
          }))
          .filter((allocation) => allocation.minutes > 0)
      : [];
    const policyInputs = canManageLeave
      ? leaveTypes.map((type) => ({ leaveTypeId: type.id, ...amounts.policy(type.id) }))
      : [];
    setAmountErrors(amounts.errors);
    if (Object.keys(amounts.errors).length > 0) {
      setPending(false);
      setError(tDuration('invalid'));
      return;
    }

    const result = await createEmployee({
      personnel_no: normalizedPno,
      full_name: (fd.get('full_name') as string).trim(),
      job_title: ((fd.get('job_title') as string) || '').trim() || undefined,
      department_id: canChooseScope ? (fd.get('department_id') as string) || undefined : undefined,
      manager_id: canChooseScope ? (fd.get('manager_id') as string) || undefined : undefined,
      roles: isAdmin ? selectedRoles : undefined,
      hire_date: hireDate ? dateObjectToGregorian(hireDate) : undefined,
    });

    if (!result.ok) {
      setPending(false);
      // Exactly one of the two is set, so the same failure is never reported
      // twice on the page.
      if (result.field === 'personnel_no') setFieldError(result.error);
      else setError(result.error);
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
          minutes: allocation.minutes,
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
    if (canManageLeave) {
      for (const policy of policyInputs) {
        const policyResult = await setEmployeeLeavePolicy({
          employeeId: result.userId,
          leaveTypeId: policy.leaveTypeId,
          accrualMinutesPerMonth: policy.rate,
          annualCapMinutes: policy.cap > 0 ? policy.cap : null,
          carryoverCapMinutes: policy.carry,
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
              data-testid="form-error"
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
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? 'personnel_no-error' : undefined}
              value={personnelNo}
              onChange={(e) => {
                setPersonnelNo(e.target.value);
                // Clear on edit: the message named a number the user is no
                // longer typing, so leaving it up contradicts the field.
                if (fieldError) setFieldError(null);
              }}
            />
            {fieldError && (
              <p
                id="personnel_no-error"
                role="alert"
                data-testid="personnel-no-error"
                className="text-sm text-destructive"
              >
                {fieldError}
              </p>
            )}
          </div>

          {canChooseScope ? (
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

          {canChooseScope ? (
            <div className="space-y-1.5">
              <Label htmlFor="manager_id">{labels.manager}</Label>
              <PersonSearch
                id="manager_id"
                name="manager_id"
                people={managerOptions}
                value={managerId}
                onChange={setManagerId}
                testId="manager-search"
              />
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
            <RoleCheckboxes label={labels.roles} selected={selectedRoles} onChange={setSelectedRoles} />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="hire_date">{labels.hireDate}</Label>
            <PersianDateField
              id="hire_date"
              testId="hire-date-picker"
              locale={locale}
              value={hireDate}
              onChange={setHireDate}
            />
          </div>

          {canManageLeave && leaveTypes.length > 0 && (
            <div
              className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4"
              data-testid="alloc-section"
            >
              <div>
                <span className="block text-sm font-semibold">{labels.allocTitle}</span>
                <p className="mt-1 text-sm text-muted-foreground">{labels.allocHint}</p>
              </div>
              {leaveTypes.map((type) => {
                const slug = leaveTypeSlug(type);
                const label = locale === 'fa' ? type.name_fa : type.name_en ?? type.name_fa;
                const name = `alloc_${type.id}`;
                return (
                  <DaysHoursField
                    key={type.id}
                    name={name}
                    label={label}
                    minutes={defaultMinutesFor(type, hoursPerDay)}
                    hoursPerDay={hoursPerDay}
                    // A one-off credit (allocate_leave); a debt is set on the
                    // Edit form after creation.
                    allowNegative={false}
                    testId={`alloc-days-${slug}`}
                    hoursTestId={`alloc-hours-${slug}`}
                    error={amountErrors[name]}
                  />
                );
              })}
            </div>
          )}

          {canManageLeave && leaveTypes.length > 0 && (
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
                  <AccrualPolicyFields
                    key={`policy-${type.id}`}
                    leaveTypeId={type.id}
                    slug={slug}
                    legend={label}
                    defaults={{
                      rate: type.default_accrual_minutes_per_month ?? 0,
                      cap: type.default_annual_cap_minutes ?? 0,
                      carry: type.default_carryover_cap_minutes,
                    }}
                    hoursPerDay={hoursPerDay}
                    errors={amountErrors}
                    labels={labels}
                  />
                );
              })}
              {policyError && (
                <p role="alert" className="text-sm text-destructive" data-testid="policy-error">
                  {policyError}
                </p>
              )}
            </div>
          )}

          {/* Managers get the leave-type default quotas applied in-database by
              app_create_employee, with no allocation fields here. Since FR-43 hr
              fills those fields in, so this hint would contradict what they typed. */}
          {!canManageLeave && (
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
