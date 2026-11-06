'use client';

import { PersonSearch } from '@/components/PersonSearch';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { updateEmployee, setRoles, setActive, resetPassword, signOutEverywhere } from '@/lib/actions/employees';
import type { PasswordSmsResult } from '@/lib/admin/types';
import { setLeaveBalance, setEmployeeLeavePolicy } from '@/lib/actions/leave/balances';
import type { LeavePolicyRow } from '@/lib/actions/leave/balances';
import type { BalanceItem } from '@/lib/leave/balances';
import type { QuickAddRow } from '@/lib/leave/balanceBreakdown';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { ChevronDown } from 'lucide-react';
import { BalanceQuickAdd } from './BalanceQuickAdd';
import { BalanceHistory } from './BalanceHistory';
import { BalanceBreakdownLines } from './BalanceBreakdownLines';
import { balanceAdjustments } from '@/lib/leave/allocations';
import type { DaysHoursError } from '@/lib/leave/duration';
import { editFormView, type EditCapabilities } from '@/lib/employees/editCapabilities';
import type { RoleRow } from '@/lib/actions/roles-helpers';
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
  leaveAmountReader,
  leaveTypeSlug,
  type PolicyMinutes,
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
  first_name: string;
  last_name: string | null;
  department_id: string | null;
  manager_id: string | null;
  hire_date: string | null;
  job_title: string | null;
  active: boolean;
  language_pref: string;
};

/** This screen's copy. */
function useLabels() {
  const t = useTranslations('manage');
  const tTeam = useTranslations('team');
  return {
    code: t('employees.code'),
    firstName: t('employees.firstName'),
    lastName: t('employees.lastName'),
    department: t('employees.department'),
    manager: t('employees.manager'),
    roles: t('employees.roles'),
    adminTransferHint: t('employees.adminTransferHint'),
    hireDate: t('employees.hireDate'),
    jobTitle: t('employees.jobTitle'),
    save: t('employees.save'),
    cancel: t('employees.cancel'),
    resetPwd: t('employees.resetPwd'),
    activate: t('employees.activate'),
    deactivate: t('employees.deactivate'),
    deactivateConfirmTitle: t('employees.deactivateConfirmTitle'),
    deactivateConfirmBody: t.raw('employees.deactivateConfirmBody') as string,
    tempPasswordLabel: t('employees.tempPasswordLabel'),
    tempPasswordHint: t('employees.tempPasswordHint'),
    textPassword: t('employees.textPassword'),
    smsQueued: t('employees.smsQueued'),
    smsSkipped: t('employees.smsSkipped'),
    smsOff: t('employees.smsOff'),
    smsFailed: t('employees.smsFailed'),
    errorLabel: t('employees.error'),
    selectDept: t('employees.selectDept'),
    selectMgr: t('employees.selectMgr'),
    noneOption: t('employees.none'),
    saved: t('employees.saved'),
    managerNote: tTeam('managerNote'),
    balancesTitle: t('employees.balancesTitle'),
    policyTitle: t('employees.policyTitle'),
    policyHint: t('employees.policyHint'),
    policyRate: t('employees.policyRate'),
    policyRateHint: t('employees.policyRateHint'),
    policyAnnualCap: t('employees.policyAnnualCap'),
    policyAnnualCapHint: t('employees.policyAnnualCapHint'),
    policyCarryCap: t('employees.policyCarryCap'),
    policyCarryCapHint: t('employees.policyCarryCapHint'),
    policyWarn: t('employees.policyWarn'),
  };
}

type Props = {
  employee: Profile;
  /** Every role of the company (app_list_roles order). */
  allRoles: RoleRow[];
  /** The employee's current role ids. */
  targetRoleIds: string[];
  /**
   * What this caller may change on this employee (FR-51), from
   * employeeEditCapabilities. The database enforces the same rules; a section
   * the caller cannot save renders read-only, or not at all.
   */
  caps: EditCapabilities;
  /**
   * The caller holds people read. Without it they are a manager on the
   * reporting-line path and see only name and hire date (editFormView).
   */
  showOrg: boolean;
  departments: Department[];
  managers: Manager[];
  balances: BalanceItem[];
  /** FR-85: quick adds, for the breakdown under each balance. */
  quickAdds: QuickAddRow[];
  /** Company day length: the inputs below are days + hours, the ledger is minutes. */
  hoursPerDay: number;
  /**
   * Existing accrual policies; absent types fall back to the leave-type default.
   * null = the caller may not read them (FR-74 direct manager): the policy card is hidden.
   */
  policies: LeavePolicyRow[] | null;
  typeDefaults: {
    id: string;
    default_accrual_minutes_per_month: number | null;
    default_annual_cap_minutes: number | null;
    default_carryover_cap_minutes: number;
  }[];
  /** Gregorian start of the current Jalali month — used for new policy rows. */
  accrualStartMonth: string;
  locale: string;
};

export function EditEmployeeForm({
  employee,
  allRoles,
  targetRoleIds,
  caps,
  showOrg,
  departments,
  managers,
  balances,
  quickAdds,
  hoursPerDay,
  policies,
  typeDefaults,
  accrualStartMonth,
  locale,
}: Props) {
  const labels = useLabels();
  const router = useRouter();
  const tDuration = useTranslations('manage.employees.duration');
  const tLeave = useTranslations('leave');
  const [openSections, setOpenSections] = useState({ balances: false, policy: false });
  const t = useTranslations('manage.employees');
  const canManageLeave = caps.leave;
  const view = editFormView(caps, { showOrg });
  // Shown with leave_balances read; saved only with edit on a target the caller
  // may act on (the database refuses the rest).
  const canSaveLeave = caps.leaveEdit;
  const [pending, setPending] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(employee.manager_id ?? null);
  const managerOptions = managers.map((m) => ({ id: m.id, name: m.full_name, personnelNo: m.employee_code }));
  const [error, setError] = useState<string | null>(null);
  const [amountErrors, setAmountErrors] = useState<Record<string, DaysHoursError>>({});
  const [success, setSuccess] = useState(false);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const [textPassword, setTextPassword] = useState(false);
  const [passwordSms, setPasswordSms] = useState<PasswordSmsResult>(null);
  const [signedOut, setSignedOut] = useState<number | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(targetRoleIds);
  const [hireDate, setHireDate] = useState<PickerDate | null>(() =>
    employee.hire_date ? gregorianToPersianDateObject(employee.hire_date, locale) : null
  );
  // The current policy in minutes, falling back to the leave-type default. A
  // null cap ("no cap") shows as 0, which the save turns back into null.
  const policyMinutesFor = (leaveTypeId: string): PolicyMinutes & { startMonth: string } => {
    const existing = policies?.find((p) => p.leaveTypeId === leaveTypeId);
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
    const targets = canSaveLeave
      ? balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          target: amounts.read(`balance_${balance.leaveTypeId}`, true),
        }))
      : [];
    const policyInputs = canSaveLeave
      ? balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          ...amounts.policy(balance.leaveTypeId),
        }))
      : [];
    setAmountErrors(amounts.errors);
    if (Object.keys(amounts.errors).length > 0) {
      // FR-85: never leave an error inside a closed section.
      const keys = Object.keys(amounts.errors);
      setOpenSections((open) => ({
        balances: open.balances || keys.some((k) => k.startsWith('balance_')),
        policy: open.policy || keys.some((k) => !k.startsWith('balance_')),
      }));
      setPending(false);
      setError(tDuration('invalid'));
      return;
    }

    // Basic fields — skipped entirely for a caller who may not change them (a
    // people-edit holder on the admin, on themselves or on someone with more
    // access, FR-55 D3/D4), so the save proceeds straight to the leave
    // sections instead of failing here on a write they were never allowed to make.
    const nameFields = {
      first_name: ((fd.get('first_name') as string) ?? '').trim(),
      // FR-83: may stay blank; a blank is the marker that the name still needs splitting.
      last_name: ((fd.get('last_name') as string) ?? '').trim() || null,
    };
    if (caps.name && !caps.profile) {
      // A people edit holder on their own record: the name is all they may change.
      const result = await updateEmployee(employee.id, nameFields);
      if (!result.ok) {
        setPending(false);
        setError(result.error);
        return;
      }
    }
    if (caps.profile) {
      const result = await updateEmployee(employee.id, {
        ...nameFields,
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

    // Roles (FR-55 D5): only the boxes in caps.editableRoleIds are enabled, and
    // app_set_user_role_ids refuses anything else. Written only when the set
    // changed, so a plain save adds no audit row.
    const rolesChanged =
      [...selectedRoleIds].sort().join(',') !== [...targetRoleIds].sort().join(',');
    if (caps.editableRoleIds.length > 0 && rolesChanged) {
      const rolesResult = await setRoles(employee.id, selectedRoleIds);
      if (!rolesResult.ok) {
        setPending(false);
        setError(rolesResult.error);
        return;
      }
    }

    // Balance and accrual policy (FR-43, leave_balances edit). Split out of the
    // branch above: assigning roles and administering leave are different
    // authorities that belong to different people.
    if (canSaveLeave) {
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
    const result = await resetPassword(employee.id, { textIt: textPassword });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewTempPassword(result.tempPassword);
    setPasswordSms(result.sms);
  }

  async function handleSignOutEverywhere() {
    setError(null);
    setSignedOut(null);
    setPending(true);
    const result = await signOutEverywhere(employee.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSignedOut(result.count);
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
      {view.note && (view.note !== 'manager' || labels.managerNote) && (
        <p
          className="bg-secondary text-secondary-foreground border border-border px-4 py-3 rounded-lg text-sm"
          data-testid="edit-scope-note"
        >
          {view.note === 'manager'
            ? labels.managerNote
            : t(view.note === 'readOnly' ? 'readOnlyNote' : view.note)}
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
            {passwordSms && (
              <p className="text-xs text-muted-foreground" data-testid="reset-password-sms">
                {{ queued: labels.smsQueued, skipped: labels.smsSkipped, off: labels.smsOff, failed: labels.smsFailed }[passwordSms]}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">{labels.firstName}</Label>
                <Input
                  id="first_name"
                  name="first_name"
                  required
                  defaultValue={employee.first_name}
                  // Read-only for a caller who cannot save it: an editable box
                  // whose value is silently discarded is worse than a disabled one.
                  disabled={!caps.name}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">{labels.lastName}</Label>
                <Input
                  id="last_name"
                  name="last_name"
                  defaultValue={employee.last_name ?? ''}
                  disabled={!caps.name}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hire_date">{labels.hireDate}</Label>
              <PersianDateField
                id="hire_date"
                testId="hire-date-picker"
                locale={locale}
                value={hireDate}
                onChange={setHireDate}
                disabled={!caps.profile}
              />
            </div>

            {/* Department, manager and title: people edit on a target the caller
                may act on (FR-51, FR-55 D3/D4). Read-only on a locked target (the
                admin, yourself, someone above you); a manager without people read
                does not see them. */}
            {view.orgBlock && (
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

              </>
            )}

            {/* Roles: shown with the org fields, and to a role assigner who
                cannot edit them (role_assign needs only people read). */}
            {view.rolesBlock && (
              <RoleCheckboxes
                label={labels.roles}
                roles={allRoles}
                selected={selectedRoleIds}
                onChange={setSelectedRoleIds}
                editable={caps.editableRoleIds}
                adminHint={labels.adminTransferHint}
              />
            )}

            {/* FR-43: balance and accrual policy, leave_balances read to see and
                edit to save — a different authority from the org fields above.
                A disabled fieldset also leaves its inputs out of the submit,
                which the leave writes skip anyway (canSaveLeave). */}
            {canManageLeave && (
              <fieldset disabled={!canSaveLeave} className="space-y-5">

                {/* FR-85: quick add and history. */}
                {balances.length > 0 && (
                  <div
                    className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4"
                    data-testid="quick-add-section"
                  >
                    <span className="block text-sm font-semibold">{t('quickAdd.title')}</span>
                    {canSaveLeave && (
                      <BalanceQuickAdd employeeId={employee.id} balances={balances} hoursPerDay={hoursPerDay} />
                    )}
                    <BalanceHistory employeeId={employee.id} balances={balances} hoursPerDay={hoursPerDay} />
                  </div>
                )}

                {/* Collapsed with <details> so the closed fields stay in the DOM: the
                    form reads them from FormData on Save. An invalid field opens its
                    section, since the browser cannot focus a hidden input. */}
                {balances.length > 0 && (
                  <details
                    className="group rounded-lg border border-border bg-secondary/40 p-4"
                    data-testid="balances-section"
                    open={openSections.balances}
                    onToggle={(e) => {
                      const open = e.currentTarget.open;
                      setOpenSections((s) => ({ ...s, balances: open }));
                    }}
                    onInvalidCapture={() => setOpenSections((s) => ({ ...s, balances: true }))}
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-2">
                      <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{labels.balancesTitle}</span>
                        {balances.map((balance) => (
                          <span
                            key={balance.leaveTypeId}
                            className="mt-0.5 block text-xs text-muted-foreground"
                            data-testid={`balance-total-${leaveTypeSlug(balance)}`}
                          >
                            {locale === 'fa' ? balance.name_fa : balance.name_en ?? balance.name_fa}:{' '}
                            {formatDuration(balance.balanceMinutes, hoursPerDay, locale, durationLabelsFrom(tLeave))}
                          </span>
                        ))}
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      {balances.map((balance) => {
                        const slug = leaveTypeSlug(balance);
                        const label =
                          locale === 'fa'
                            ? balance.name_fa
                            : balance.name_en ?? balance.name_fa;
                        const name = `balance_${balance.leaveTypeId}`;
                        return (
                          <div key={balance.leaveTypeId} className="space-y-1.5">
                            <DaysHoursField
                              // The inputs are uncontrolled: a quick add must remount them,
                              // or the next Save writes the old balance back over it.
                              key={`${balance.leaveTypeId}-${balance.balanceMinutes}`}
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
                            <BalanceBreakdownLines
                              balanceMinutes={balance.balanceMinutes}
                              leaveTypeId={balance.leaveTypeId}
                              quickAdds={quickAdds}
                              hoursPerDay={hoursPerDay}
                              testId={`balance-breakdown-${slug}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {balances.length > 0 && policies !== null && (
                  <details
                    className="group rounded-lg border border-border bg-secondary/40 p-4"
                    data-testid="policy-section"
                    open={openSections.policy}
                    onToggle={(e) => {
                      const open = e.currentTarget.open;
                      setOpenSections((s) => ({ ...s, policy: open }));
                    }}
                    onInvalidCapture={() => setOpenSections((s) => ({ ...s, policy: true }))}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                      <span className="block text-sm font-semibold">{labels.policyTitle}</span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-sm text-muted-foreground">{labels.policyHint}</p>
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
                  </details>
                )}
              </fieldset>
            )}

            <div className="flex gap-3 pt-2">
              {/* Hidden when nothing on the form can be written: a Save that
                  writes nothing would report a false "saved". */}
              {view.saveable && (
                <Button type="submit" disabled={pending} data-testid="edit-save">
                  {pending ? '...' : labels.save}
                </Button>
              )}
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
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetPassword}
                  disabled={pending}
                  data-testid="reset-password"
                  className="border-orange-300 text-orange-700 hover:bg-orange-50"
                >
                  {labels.resetPwd}
                </Button>
                {/* FR-78: optional text of the new password (admin panel › SMS decides if it goes out). */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={textPassword}
                    onChange={(e) => setTextPassword(e.target.checked)}
                    disabled={pending}
                    className="size-4 accent-primary"
                    data-testid="reset-password-text-it"
                  />
                  {labels.textPassword}
                </label>
              </div>
            )}
            {caps.resetPassword && (
              // FR-79: admin only, like the reset (resetPassword is admin-only since 20261013200007).
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={handleSignOutEverywhere} disabled={pending}
                  data-testid="sign-out-everywhere">
                  {t('signOutEverywhere')}
                </Button>
                {signedOut !== null && (
                  <span role="status" className="text-xs text-muted-foreground" data-testid="signed-out-count">
                    {t('signedOutDevices', { count: signedOut })}
                  </span>
                )}
              </div>
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
