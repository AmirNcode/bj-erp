/**
 * Bulk CSV import v2 (FR-45) — admin and hr reach the page (managers are
 * bounced to the employees list); the RPC re-checks in-DB regardless. Stages,
 * all in ImportWizard: template download → upload + validation preview
 * (departments, managers, balance date) → import + one-time credentials.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { todayInAppTz } from '@/lib/appDate';
import { PageHeader } from '../../../_components/PageHeader';
import { ImportWizard } from './ImportWizard';

type WizardLabels = Parameters<typeof ImportWizard>[0]['labels'];

type Props = { params: Promise<{ locale: string }> };

export default async function ImportPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  // hr bulk-onboards too (FR-35 D4). app_bulk_create_employees clamps every
  // row's role to 'employee' for an hr caller, so the CSV cannot smuggle one in.
  if (!roles.includes('admin') && !roles.includes('hr')) {
    redirect(`/${locale}/manage/employees`);
  }

  const t = await getTranslations('manage.import');
  const supabase = await createClient();

  // Validation context (FR-45): departments with their current manager, every
  // existing personnel number with whether that person holds `manager`, and the
  // workday length that turns days + hours into minutes.
  // FR-49 plan context: every profile (active or not) with its department, manager
  // and admin flag, every department with its member count, and pending requests.
  const [
    { data: departments },
    { data: profiles },
    { data: roleRows },
    { data: ws },
    { data: pendingRows },
  ] = await Promise.all([
    supabase
      .from('departments')
      .select('id, code, name_fa, name_en, manager:profiles!departments_manager_id_fkey(personnel_no, active)')
      .order('name_fa'),
    supabase.from('profiles').select('id, personnel_no, full_name, active, manager_id, department_id'),
    supabase.from('user_roles').select('user_id, role').in('role', ['manager', 'admin']),
    supabase.from('work_settings').select('hours_per_day').maybeSingle(),
    supabase.from('leave_requests').select('employee_id').eq('status', 'pending'),
  ]);
  const managerIds = new Set((roleRows ?? []).filter((r) => r.role === 'manager').map((r) => r.user_id));
  const adminIds = new Set((roleRows ?? []).filter((r) => r.role === 'admin').map((r) => r.user_id));
  const deptRows = (departments ?? []) as unknown as {
    id: string;
    code: string;
    name_fa: string;
    name_en: string | null;
    manager: { personnel_no: string | null; active: boolean } | null;
  }[];
  const codeById = new Map(deptRows.map((d) => [d.id, d.code]));
  const pending = new Map<string, number>();
  for (const r of pendingRows ?? []) pending.set(r.employee_id, (pending.get(r.employee_id) ?? 0) + 1);
  const memberCount = new Map<string, number>();
  for (const p of profiles ?? []) {
    if (p.department_id) memberCount.set(p.department_id, (memberCount.get(p.department_id) ?? 0) + 1);
  }

  const errorKeys = [
    'missingColumn', 'required', 'badPersonnelNo', 'dupInFile', 'dupExisting', 'badDeptCode',
    'deptNamesRequired', 'deptCodeConflict', 'unknownSupervisor', 'unknownManager', 'refNotManager',
    'selfReference', 'cycle', 'badDate', 'badRole', 'badBalance', 'mixedSign', 'hoursTooLarge',
    'deptManagerTie',
  ] as const;
  const warningKeys = ['supervisorManagerMismatch', 'deptNamesDiffer', 'deptManagerKept', 'bothSign'] as const;

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title={t('title')} />
      <ImportWizard
        isAdmin={roles.includes('admin')}
        employees={(profiles ?? []).map((p) => ({
          id: p.id,
          personnelNo: p.personnel_no,
          fullName: p.full_name,
          active: p.active,
          isAdmin: adminIds.has(p.id),
          isManager: managerIds.has(p.id),
          managerId: p.manager_id,
          departmentCode: p.department_id ? (codeById.get(p.department_id) ?? null) : null,
          pendingRequests: pending.get(p.id) ?? 0,
        }))}
        existingDepartments={deptRows.map((d) => ({
          code: d.code,
          managerPersonnelNo: d.manager?.personnel_no ?? null,
          memberCount: memberCount.get(d.id) ?? 0,
        }))}
        context={{
          departments: deptRows.map((d) => ({
            code: d.code,
            name_fa: d.name_fa,
            name_en: d.name_en,
            managerPersonnelNo: d.manager?.personnel_no ?? null,
            managerActive: d.manager?.active ?? true,
          })),
          existingEmployees: (profiles ?? [])
            .filter((p): p is typeof p & { personnel_no: string } => p.personnel_no !== null)
            .map((p) => ({
              personnelNo: p.personnel_no,
              fullName: p.full_name,
              isManager: managerIds.has(p.id),
            })),
          hoursPerDay: Number(ws?.hours_per_day ?? 8),
        }}
        locale={locale}
        today={todayInAppTz()}
        labels={{
          intro: t('intro'),
          template: t('template'),
          templateHint: t('templateHint'),
          upload: t('upload'),
          rowsValid: t('rowsValid'),
          rowsInvalid: t('rowsInvalid'),
          line: t('line'),
          column: t('column'),
          problem: t('problem'),
          import: t('import'),
          importing: t('importing'),
          errorLabel: t('error'),
          errors: Object.fromEntries(errorKeys.map((k) => [k, t(`errors.${k}`)])) as Record<
            (typeof errorKeys)[number],
            string
          >,
          warningsTitle: t('warningsTitle'),
          // Raw: the wizard fills {placeholders} per row.
          warnings: Object.fromEntries(warningKeys.map((k) => [k, t.raw(`warnings.${k}`) as string])) as Record<
            (typeof warningKeys)[number],
            string
          >,
          balanceDate: t('balanceDate'),
          balanceDateHint: t('balanceDateHint'),
          balanceDateFuture: t('balanceDateFuture'),
          accrualStarts: t.raw('accrualStarts') as string,
          departmentsTitle: t('departmentsTitle'),
          departmentsHint: t('departmentsHint'),
          deptCode: t('deptCode'),
          deptName: t('deptName'),
          deptManager: t('deptManager'),
          deptStatus: t('deptStatus'),
          deptNew: t('deptNew'),
          deptNewGenerated: t('deptNewGenerated'),
          deptExisting: t('deptExisting'),
          deptKept: t('deptKept'),
          noManager: t('noManager'),
          ackDepartments: t('ackDepartments'),
          deptRenamed: t('deptRenamed'),
          deptManagerChanged: t('deptManagerChanged'),
          // Raw: templates with {placeholders} are filled in the wizard.
          modes: t.raw('modes') as WizardLabels['modes'],
          plan: t.raw('plan') as WizardLabels['plan'],
        }}
      />
    </main>
  );
}
