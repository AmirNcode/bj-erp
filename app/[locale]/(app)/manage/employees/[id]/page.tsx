/**
 * Edit employee page — fields available depend on the caller's permissions and
 * the target (employeeEditCapabilities, FR-51 / FR-55 D3–D5). Admin: everything.
 * A permission holder acts on a target only when the target holds nothing above
 * them, is not the admin and is not themselves. Manager: name and hire date of
 * their reports.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getEmployeeBalances, getEmployeePolicies, getCurrentJalaliMonthStart } from '@/lib/actions/leave/balances';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { listRoles } from '@/lib/actions/roles';
import { notFound, redirect } from 'next/navigation';
import { employeeEditCapabilities, type TargetIdentity } from '@/lib/employees/editCapabilities';
import { can, type Perms } from '@/lib/permissions/catalog';
import { PageHeader } from '../../../_components/PageHeader';
import { EditEmployeeForm } from './EditEmployeeForm';
import { getPersonalInfo } from '@/lib/actions/personal-info';
import { PersonalInfoForm } from '@/components/personal-info/PersonalInfoForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSpecialLeaveGrants } from '@/lib/actions/specialLeave';
import { SpecialLeaveCard } from './SpecialLeaveCard';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The target's identity powers that private.can_act_on guards (approval and
 * clearance signers). Only read when the caller lacks the power that covers
 * them; a failed read counts as true, so the form locks rather than offers a
 * save the database will refuse.
 *
 * Signer rows of open clearance forms are readable only with `clearance` read.
 * Without it the check falls back to the clearance units (readable by everyone):
 * locking every record for such a caller would make the page useless, and the
 * database still refuses the rare per-form signer.
 */
async function targetIdentity(supabase: Supabase, id: string, perms: Perms): Promise<TargetIdentity> {
  const approverQuery = can(perms, 'approval_steps')
    ? null
    : supabase.from('approval_steps').select('id').eq('approver_id', id).eq('active', true).limit(1);
  const unitQuery = can(perms, 'clearance')
    ? null
    : supabase.from('separation_units').select('id').eq('signer_id', id).limit(1);
  const signoffQuery =
    can(perms, 'clearance') || !can(perms, 'clearance', 'read')
      ? null
      : supabase
          .from('separation_signoffs')
          .select('id, separations!separation_signoffs_separation_id_fkey!inner(status)')
          .eq('signer_id', id)
          .in('separations.status', ['in_progress', 'awaiting_finance'])
          .limit(1);
  const [approver, unit, signoff] = await Promise.all([approverQuery, unitQuery, signoffQuery]);
  const found = (r: { data: unknown[] | null; error: unknown } | null) =>
    r !== null && (r.error != null || (r.data?.length ?? 0) > 0);
  return { approver: found(approver), clearanceSigner: found(unit) || found(signoff) };
}

export default async function EditEmployeePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');
  const tTeam = await getTranslations('team');
  const supabase = await createClient();

  const user = await getCachedUser();

  if (!user) return notFound();

  const [callerRoles, callerPerms] = await Promise.all([
    getCachedRoles(user.id),
    getCachedPermissions(user.id),
  ]);
  // The Manage layout admits anyone with a Manage item; this page needs the
  // Employees one.
  if (!callerRoles.includes('manager') && !can(callerPerms, 'people', 'read')) {
    redirect(`/${locale}/home`);
  }

  // Fetch target employee
  const { data: employee } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (!employee) return notFound();

  // The target's role ids (FR-55: custom roles have no enum), every role of the
  // company, and whether they manage a department (D4).
  const isAdmin = callerRoles.includes('admin');
  const [targetRolesRes, rolesRes, managedDeptRes, identity] = await Promise.all([
    supabase.from('user_roles').select('role_id').eq('user_id', id),
    listRoles(),
    supabase.from('departments').select('id').eq('manager_id', id).limit(1),
    isAdmin
      ? Promise.resolve({ approver: false, clearanceSigner: false })
      : targetIdentity(supabase, id, callerPerms),
  ]);
  // Without the roles the target's levels are unknown; render nothing rather
  // than offer edits the subset rule might refuse.
  if (!rolesRes.ok) throw new Error(rolesRes.error);
  if (targetRolesRes.error) throw new Error(targetRolesRes.error.message);
  const allRoles = rolesRes.roles;
  const targetRoleIds = (targetRolesRes.data ?? []).map((r) => r.role_id);

  const caps = employeeEditCapabilities({
    callerId: user.id,
    callerRoles,
    callerPerms,
    targetId: id,
    targetRoleIds,
    allRoles,
    // A failed read locks (fail closed); the database decides either way.
    targetIsDepartmentManager: managedDeptRes.error != null || (managedDeptRes.data?.length ?? 0) > 0,
    targetIdentity: identity,
  });
  const canManageLeave = caps.leave;

  // Fetch departments and potential managers
  const [{ data: departments }, { data: managers }] = await Promise.all([
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
    supabase
      .from('profiles')
      .select('id, full_name, employee_code')
      .eq('active', true)
      .neq('id', id)
      .order('full_name'),
  ]);
  const balancesRes = canManageLeave ? await getEmployeeBalances(id) : null;
  const balances = balancesRes?.ok ? balancesRes.balances : [];
  // Balances are stored in minutes; the editor renders and accepts days, so it
  // needs the company's day length to convert at the boundary.
  const workSettingsRes = canManageLeave ? await getWorkSettings() : null;
  const hoursPerDay = workSettingsRes?.ok ? workSettingsRes.settings.hoursPerDay : 8;
  // Accrual policy: existing rows pre-fill the form; the leave-type defaults fill
  // the gaps, and the start month defaults to the current Jalali month so turning
  // accrual on never back-credits months nobody worked.
  const policiesRes = canManageLeave ? await getEmployeePolicies(id) : null;
  const policies = policiesRes?.ok ? policiesRes.policies : [];
  const accrualStartMonth = canManageLeave ? await getCurrentJalaliMonthStart() : '';
  const { data: typeDefaults } = canManageLeave
    ? await supabase
        .from('leave_types')
        .select(
          'id, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes'
        )
        .eq('active', true)
        .eq('affects_balance', true)
    : { data: [] };

  // FR-53: personal_info read; managers never see personal information.
  const personalInfoRes = caps.personalInfo ? await getPersonalInfo(id) : null;
  // FR-65: special_leave edit holders grant extra leave for marriage / a death in the family.
  const specialLeaveRes = caps.specialLeave ? await getSpecialLeaveGrants(id) : null;
  const tPi = await getTranslations('personalInfo');

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader
        title={t('employees.editTitle')}
        action={
          <span className="font-mono text-sm text-muted-foreground">{employee.employee_code}</span>
        }
      />
      <EditEmployeeForm
        employee={employee}
        allRoles={allRoles}
        targetRoleIds={targetRoleIds}
        caps={caps}
        showOrg={can(callerPerms, 'people', 'read')}
        departments={departments ?? []}
        managers={managers ?? []}
        balances={balances}
        hoursPerDay={hoursPerDay}
        policies={policies}
        typeDefaults={typeDefaults ?? []}
        accrualStartMonth={accrualStartMonth}
        locale={locale}
        labels={{
          code: t('employees.code'),
          name: t('employees.name'),
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
        }}
      />
      {personalInfoRes?.ok && (
        <Card data-testid="employee-personal-info">
          <CardHeader className="border-b pb-4">
            <CardTitle>{tPi('title')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <PersonalInfoForm
              employeeId={id}
              initial={personalInfoRes.info}
              readOnly={caps.personalInfo === 'view'}
              readOnlyReason={caps.lockedReason === 'self' ? 'self' : 'admin'}
            />
          </CardContent>
        </Card>
      )}
      {specialLeaveRes?.ok && (
        <SpecialLeaveCard
          employeeId={id}
          grants={specialLeaveRes.grants}
          maritalStatus={personalInfoRes?.ok ? (personalInfoRes.info.marital_status ?? null) : null}
        />
      )}
    </main>
  );
}
