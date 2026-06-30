/**
 * Create new employee page.
 * Fetches departments and potential managers server-side for selects.
 */

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '../../../_components/PageHeader';
import { NewEmployeeForm } from './NewEmployeeForm';
import { FormSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function NewEmployeeData({ locale }: { locale: string }) {
  const t = await getTranslations('manage');
  const supabase = await createClient();

  // Fetch departments, potential managers, and balance-affecting leave types in parallel.
  const [{ data: departments }, { data: managers }, { data: leaveTypes }] = await Promise.all([
    supabase.from('departments').select('id, name_fa, name_en').order('name_fa'),
    supabase.from('profiles').select('id, full_name, employee_code').eq('active', true).order('full_name'),
    supabase
      .from('leave_types')
      .select('id, name_fa, name_en, default_annual_quota_days')
      .eq('active', true)
      .eq('affects_balance', true)
      .order('name_fa'),
  ]);

  return (
    <NewEmployeeForm
      departments={departments ?? []}
      managers={managers ?? []}
      leaveTypes={leaveTypes ?? []}
      locale={locale}
      labels={{
        code: t('employees.code'),
        name: t('employees.name'),
        department: t('employees.department'),
        manager: t('employees.manager'),
        roles: t('employees.roles'),
        hireDate: t('employees.hireDate'),
        submit: t('employees.create'),
        cancel: t('employees.cancel'),
        done: t('employees.done'),
        tempPasswordLabel: t('employees.tempPasswordLabel'),
        tempPasswordHint: t('employees.tempPasswordHint'),
        errorLabel: t('employees.error'),
        selectDept: t('employees.selectDept'),
        selectMgr: t('employees.selectMgr'),
        noneOption: t('employees.none'),
        allocTitle: t('employees.allocTitle'),
        allocWarn: t('employees.allocWarn'),
      }}
    />
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function NewEmployeePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('manage');

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <PageHeader title={t('employees.newTitle')} />
      <Suspense fallback={<FormSkeleton />}>
        <NewEmployeeData locale={locale} />
      </Suspense>
    </main>
  );
}
