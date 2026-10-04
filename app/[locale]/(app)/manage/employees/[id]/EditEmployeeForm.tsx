'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateEmployee, setRoles, setActive, resetPassword } from '@/lib/actions/employees';
import { setLeaveBalance, setEmployeeLeavePolicy } from '@/lib/actions/leave/balances';
import type { LeavePolicyRow } from '@/lib/actions/leave/balances';
import type { BalanceItem } from '@/lib/leave/balances';
import { balanceAdjustments } from '@/lib/leave/allocations';
import { daysToMinutes } from '@/lib/leave/duration';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { nativeSelectClass } from '@/lib/native-select';
import { PersianDateField } from '@/components/PersianDateField';
import {
  AccrualPolicyFields,
  RoleCheckboxes,
  ROLES,
  leaveTypeSlug,
  minutesToDaysInput,
  type Role,
} from '../_components/EmployeeFormParts';
import {
  dateObjectToGregorian,
  gregorianToPersianDateObject,
  type PickerDate,
} from '@/lib/leave/dateConvert';

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
};

type Props = {
  employee: Profile;
  empRoles: string[];
  isAdmin: boolean;
  /**
   * FR-43: may edit the leave balance and accrual policy. Admin or hr.
   * `isAdmin` still gates roles and the department/manager pickers.
   */
  canManageLeave: boolean;
  /**
   * May change the basic profile fields (name, hire date, and — for an admin —
   * department, manager and roles). Admin or manager.
   *
   * HR is deliberately NOT included: `updateEmployee` requires admin or manager,
   * so submitting those fields as HR fails the whole save before the balance and
   * policy writes are reached.
   */
  canEditProfile: boolean;
  departments: Department[];
  managers: Manager[];
  balances: BalanceItem[];
  /** Company day length: the inputs below are days, the ledger is minutes. */
  hoursPerDay: number;
  /** Existing accrual policies; absent types fall back to the leave-type default. */
  policies: LeavePolicyRow[];
  typeDefaults: {
    id: string;
    default_accrual_minutes_per_month: number | null;
    default_annual_cap_minutes: number | null;
    default_carryover_cap_minutes: number;
  }[];
  /** Gregorian start of the current Jalali month — used for new policy rows. */
  accrualStartMonth: string;
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

export function EditEmployeeForm({
  employee,
  empRoles,
  isAdmin,
  canManageLeave,
  canEditProfile,
  departments,
  managers,
  balances,
  hoursPerDay,
  policies,
  typeDefaults,
  accrualStartMonth,
  locale,
  labels,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(
    (empRoles as Role[]).filter((r) => ROLES.includes(r))
  );
  const [hireDate, setHireDate] = useState<PickerDate | null>(() =>
    employee.hire_date ? gregorianToPersianDateObject(employee.hire_date, locale) : null
  );
  // Kept in MINUTES, the stored unit. The input renders days for the admin and
  // converts on change, so a rounded display can never produce a spurious
  // one-minute adjustment row on save.
  const [targets, setTargets] = useState<Record<string, number>>(
    Object.fromEntries(balances.map((balance) => [balance.leaveTypeId, balance.balanceMinutes]))
  );

  // Policy fields are day-denominated for the admin; conversion happens on save.
  const policyDaysFor = (leaveTypeId: string) => {
    const existing = policies.find((p) => p.leaveTypeId === leaveTypeId);
    const fallback = typeDefaults.find((t) => t.id === leaveTypeId);
    const toDays = (m: number | null | undefined) => minutesToDaysInput(m, hoursPerDay);
    return {
      rate: toDays(existing?.accrualMinutesPerMonth ?? fallback?.default_accrual_minutes_per_month),
      cap: toDays(existing?.annualCapMinutes ?? fallback?.default_annual_cap_minutes),
      carry: toDays(existing?.carryoverCapMinutes ?? fallback?.default_carryover_cap_minutes),
      startMonth: existing?.accrualStartMonth ?? accrualStartMonth,
    };
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);

    const fd = new FormData(e.currentTarget);

    // Basic fields — skipped entirely for a caller who may not change them, so an
    // HR user's save proceeds straight to the leave sections instead of failing
    // here on a write they were never allowed to make.
    if (canEditProfile) {
      const result = await updateEmployee(employee.id, {
        full_name: (fd.get('full_name') as string).trim(),
        hire_date: hireDate ? dateObjectToGregorian(hireDate) : null,
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
    }

    // Roles are admin-only — HR creating or promoting a role holder is refused
    // in the database (FR-35 D4), so this branch must NOT follow canManageLeave.
    if (isAdmin) {
      const rolesResult = await setRoles(employee.id, selectedRoles);
      if (!rolesResult.ok) {
        setPending(false);
        setError(rolesResult.error);
        return;
      }
    }

    // Balance and accrual policy: admin or hr (FR-43). Split out of the branch
    // above, which used to conflate "may assign roles" with "may administer
    // leave" — two different authorities that now belong to different people.
    if (canManageLeave) {
      const changes = balanceAdjustments(
        balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          balance: balance.balanceMinutes,
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

      // Accrual policy per balance-affecting type. Inputs are days; the ledger is
      // minutes, so convert here at the boundary.
      for (const balance of balances) {
        const rateDays = Number(fd.get(`policy_rate_${balance.leaveTypeId}`) || 0);
        const capDays = Number(fd.get(`policy_cap_${balance.leaveTypeId}`) || 0);
        const carryDays = Number(fd.get(`policy_carry_${balance.leaveTypeId}`) || 0);

        const policyResult = await setEmployeeLeavePolicy({
          employeeId: employee.id,
          leaveTypeId: balance.leaveTypeId,
          accrualMinutesPerMonth: daysToMinutes(rateDays, hoursPerDay),
          annualCapMinutes: capDays > 0 ? daysToMinutes(capDays, hoursPerDay) : null,
          carryoverCapMinutes: daysToMinutes(carryDays, hoursPerDay),
          accrualStartMonth: policyDaysFor(balance.leaveTypeId).startMonth,
        });

        if (!policyResult.ok) {
          setPending(false);
          setError(`${labels.policyWarn} ${policyResult.error}`);
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
          data-testid="edit-error"
          className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm"
        >
          {labels.errorLabel}: {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          data-testid="edit-success"
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
                // Read-only for a caller who cannot save it (HR): an editable box
                // whose value is silently discarded is worse than a disabled one.
                disabled={!canEditProfile}
              />
            </div>

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

                <RoleCheckboxes label={labels.roles} selected={selectedRoles} onChange={setSelectedRoles} />
              </>
            )}

            {/* FR-43: balance and accrual policy are admin OR hr. Deliberately
                a separate block from the admin one above — department, manager
                and roles are a different authority from administering leave, and
                they used to share one condition purely because only admins had
                either. */}
            {canManageLeave && (
              <>

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
                            value={(targets[balance.leaveTypeId] ?? 0) / (hoursPerDay * 60)}
                            onChange={(event) =>
                              setTargets((prev) => ({
                                ...prev,
                                [balance.leaveTypeId]: daysToMinutes(
                                  Number(event.target.value),
                                  hoursPerDay
                                ),
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

                {balances.length > 0 && (
                  <div
                    className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4"
                    data-testid="policy-section"
                  >
                    <div>
                      <span className="block text-sm font-semibold">{labels.policyTitle}</span>
                      <p className="mt-1 text-sm text-muted-foreground">{labels.policyHint}</p>
                    </div>
                    {balances.map((balance) => {
                      const slug = leaveTypeSlug(balance);
                      const label =
                        locale === 'fa'
                          ? balance.name_fa
                          : balance.name_en ?? balance.name_fa;
                      const p = policyDaysFor(balance.leaveTypeId);
                      return (
                        <AccrualPolicyFields
                          key={`policy-${balance.leaveTypeId}`}
                          leaveTypeId={balance.leaveTypeId}
                          slug={slug}
                          legend={label}
                          defaults={p}
                          labels={labels}
                        />
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
