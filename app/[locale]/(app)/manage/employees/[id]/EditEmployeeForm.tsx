'use client';

import { PersonSearch } from '@/components/PersonSearch';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { updateEmployee, setRoles, setActive, resetPassword } from '@/lib/actions/employees';
import { setLeaveBalance, setEmployeeLeavePolicy } from '@/lib/actions/leave/balances';
import type { LeavePolicyRow } from '@/lib/actions/leave/balances';
import type { BalanceItem } from '@/lib/leave/balances';
import { balanceAdjustments } from '@/lib/leave/allocations';
import type { DaysHoursError } from '@/lib/leave/duration';
import type { EditCapabilities } from '@/lib/employees/editCapabilities';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { nativeSelectClass } from '@/lib/native-select';
import { PersianDateField } from '@/components/PersianDateField';
import {
  AccrualPolicyFields,
  DaysHoursField,
  RoleCheckboxes,
  ROLES,
  leaveAmountReader,
  leaveTypeSlug,
  type PolicyMinutes,
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
  job_title: string | null;
  active: boolean;
  language_pref: string;
};

type Props = {
  employee: Profile;
  empRoles: string[];
  /**
   * What this caller may change on this employee (FR-51), from
   * employeeEditCapabilities. The database enforces the same rules; a section
   * the caller cannot save renders read-only, or not at all.
   */
  caps: EditCapabilities;
  departments: Department[];
  managers: Manager[];
  balances: BalanceItem[];
  /** Company day length: the inputs below are days + hours, the ledger is minutes. */
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
    jobTitle: string;
    save: string;
    cancel: string;
    resetPwd: string;
    activate: string;
    deactivate: string;
    /** Deactivation is confirmed first; activation is not (it is harmless to undo). */
    deactivateConfirmTitle: string;
    /** Raw: {name}. */
    deactivateConfirmBody: string;
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
  caps,
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
  const tDuration = useTranslations('manage.employees.duration');
  const t = useTranslations('manage.employees');
  const canManageLeave = caps.leave;
  const [pending, setPending] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(employee.manager_id ?? null);
  const managerOptions = managers.map((m) => ({ id: m.id, name: m.full_name, personnelNo: m.employee_code }));
  const [error, setError] = useState<string | null>(null);
  const [amountErrors, setAmountErrors] = useState<Record<string, DaysHoursError>>({});
  const [success, setSuccess] = useState(false);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(
    (empRoles as Role[]).filter((r) => ROLES.includes(r))
  );
  const [hireDate, setHireDate] = useState<PickerDate | null>(() =>
    employee.hire_date ? gregorianToPersianDateObject(employee.hire_date, locale) : null
  );
  // The current policy in minutes, falling back to the leave-type default. A
  // null cap ("no cap") shows as 0, which the save turns back into null.
  const policyMinutesFor = (leaveTypeId: string): PolicyMinutes & { startMonth: string } => {
    const existing = policies.find((p) => p.leaveTypeId === leaveTypeId);
    const fallback = typeDefaults.find((t) => t.id === leaveTypeId);
    return {
      rate: existing?.accrualMinutesPerMonth ?? fallback?.default_accrual_minutes_per_month ?? 0,
      cap: existing?.annualCapMinutes ?? fallback?.default_annual_cap_minutes ?? 0,
      carry: existing?.carryoverCapMinutes ?? fallback?.default_carryover_cap_minutes ?? 0,
      startMonth: existing?.accrualStartMonth ?? accrualStartMonth,
    };
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);

    const fd = new FormData(e.currentTarget);

    // Leave amounts are read and checked before ANY write, so a bad entry cannot
    // leave the profile and roles saved but the balances not.
    const amounts = leaveAmountReader(fd, hoursPerDay);
    const targets = canManageLeave
      ? balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          target: amounts.read(`balance_${balance.leaveTypeId}`, true),
        }))
      : [];
    const policyInputs = canManageLeave
      ? balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          ...amounts.policy(balance.leaveTypeId),
        }))
      : [];
    setAmountErrors(amounts.errors);
    if (Object.keys(amounts.errors).length > 0) {
      setPending(false);
      setError(tDuration('invalid'));
      return;
    }

    // Basic fields — skipped entirely for a caller who may not change them (hr
    // on an admin or on themselves), so the save proceeds straight to the leave
    // sections instead of failing here on a write they were never allowed to make.
    if (caps.profile) {
      const result = await updateEmployee(employee.id, {
        full_name: (fd.get('full_name') as string).trim(),
        hire_date: hireDate ? dateObjectToGregorian(hireDate) : null,
        ...(caps.org
          ? {
              department_id: (fd.get('department_id') as string) || null,
              manager_id: (fd.get('manager_id') as string) || null,
              job_title: ((fd.get('job_title') as string) ?? '').trim() || null,
            }
          : {}),
      });

      if (!result.ok) {
        setPending(false);
        setError(result.error);
        return;
      }
    }

    // Roles: admin sets any; hr may only add or remove `manager` (FR-51) — the
    // other boxes are disabled and app_set_user_roles refuses anything else.
    // Written only when the set changed, so a plain save adds no audit row.
    const rolesChanged =
      [...selectedRoles].sort().join(',') !==
      (empRoles as Role[]).filter((r) => ROLES.includes(r)).sort().join(',');
    if (caps.editableRoles.length > 0 && rolesChanged) {
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
      // Only balances whose minute total changed are written, so saving a role
      // change never touches a balance.
      const changes = balanceAdjustments(
        balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          balance: balance.balanceMinutes,
        })),
        targets
      );

      for (const change of changes) {
        const balanceResult = await setLeaveBalance(employee.id, change.leaveTypeId, change.target);
        if (!balanceResult.ok) {
          setPending(false);
          setError(balanceResult.error);
          return;
        }
      }

      // Accrual policy per balance-affecting type, already in minutes.
      for (const policy of policyInputs) {
        const policyResult = await setEmployeeLeavePolicy({
          employeeId: employee.id,
          leaveTypeId: policy.leaveTypeId,
          accrualMinutesPerMonth: policy.rate,
          annualCapMinutes: policy.cap > 0 ? policy.cap : null,
          carryoverCapMinutes: policy.carry,
          accrualStartMonth: policyMinutesFor(policy.leaveTypeId).startMonth,
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
      {(caps.lockedReason || (!caps.org && labels.managerNote)) && (
        <p
          className="bg-secondary text-secondary-foreground border border-border px-4 py-3 rounded-lg text-sm"
          data-testid="edit-scope-note"
        >
          {caps.lockedReason === 'admin'
            ? t('lockedAdmin')
            : caps.lockedReason === 'self'
              ? t('lockedSelf')
              : labels.managerNote}
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
                // Read-only for a caller who cannot save it: an editable box
                // whose value is silently discarded is worse than a disabled one.
                disabled={!caps.profile}
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

            {/* Department, manager, title and roles: admin, or hr on a non-admin
                other than themselves (FR-51). hr sees them read-only on an admin's
                record or their own; a manager does not see them. */}
            {(caps.org || caps.lockedReason) && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="job_title">{labels.jobTitle}</Label>
                  <Input
                    id="job_title"
                    name="job_title"
                    defaultValue={employee.job_title ?? ''}
                    disabled={!caps.org}
                    data-testid="job-title"
                  />
                </div>

                {/* Native <select> — must stay native for Playwright selectOption e2e */}
                <div className="space-y-1.5">
                  <Label htmlFor="department_id">{labels.department}</Label>
                  <select
                    id="department_id"
                    name="department_id"
                    defaultValue={employee.department_id ?? ''}
                    disabled={!caps.org}
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
                  <PersonSearch
                    id="manager_id"
                    name="manager_id"
                    people={managerOptions}
                    value={managerId}
                    onChange={setManagerId}
                    disabled={!caps.org}
                    testId="manager-search"
                  />
                </div>

                <RoleCheckboxes
                  label={labels.roles}
                  selected={selectedRoles}
                  onChange={setSelectedRoles}
                  editable={caps.editableRoles}
                />
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
                      const name = `balance_${balance.leaveTypeId}`;
                      return (
                        <DaysHoursField
                          key={balance.leaveTypeId}
                          name={name}
                          label={label}
                          minutes={balance.balanceMinutes}
                          hoursPerDay={hoursPerDay}
                          // FR-48: a balance may be negative (leave taken in
                          // advance); the database bounds it at -366 days.
                          allowNegative
                          testId={`balance-days-${slug}`}
                          hoursTestId={`balance-hours-${slug}`}
                          leaveTypeId={balance.leaveTypeId}
                          error={amountErrors[name]}
                        />
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
                      return (
                        <AccrualPolicyFields
                          key={`policy-${balance.leaveTypeId}`}
                          leaveTypeId={balance.leaveTypeId}
                          slug={slug}
                          legend={label}
                          defaults={policyMinutesFor(balance.leaveTypeId)}
                          hoursPerDay={hoursPerDay}
                          errors={amountErrors}
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

      {(caps.resetPassword || caps.org) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t('accountActions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {caps.resetPassword && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPassword}
                disabled={pending}
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                {labels.resetPwd}
              </Button>
            )}
            {!caps.org ? null : employee.active ? (
              // Deactivating locks the person out at once, so it asks first.
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    className="border-destructive/30 text-destructive hover:bg-destructive/10"
                    data-testid="employee-deactivate"
                  >
                    {labels.deactivate}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{labels.deactivateConfirmTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {labels.deactivateConfirmBody.replace('{name}', employee.full_name)}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="employee-deactivate-cancel">{labels.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={handleToggleActive}
                      data-testid="employee-deactivate-confirm"
                    >
                      {labels.deactivate}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleActive}
                disabled={pending}
                className="border-success/30 text-success hover:bg-success-foreground"
                data-testid="employee-activate"
              >
                {labels.activate}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
