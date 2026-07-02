/**
 * Admin leave allocation page.
 * Admin picks employee + leave type + period + days and calls allocateLeave.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getAllEmployees, getActiveLeaveTypes } from '@/lib/actions/leave';
import { PageHeader } from '../../_components/PageHeader';
import { AllocateForm } from './AllocateForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function AllocationsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();

  if (!user) redirect(`/${locale}/login`);

  // Admin guard
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}/home`);

  const t = await getTranslations('allocations');

  const [employeesResult, leaveTypesResult] = await Promise.all([
    getAllEmployees(),
    getActiveLeaveTypes(),
  ]);

  const employees = employeesResult.ok ? employeesResult.employees : [];
  const leaveTypes = leaveTypesResult.ok ? leaveTypesResult.types : [];

  const labels = {
    title: t('title'),
    employee: t('employee'),
    selectEmployee: t('selectEmployee'),
    leaveType: t('leaveType'),
    selectType: t('selectType'),
    periodStart: t('periodStart'),
    periodEnd: t('periodEnd'),
    days: t('days'),
    submit: t('submit'),
    success: t('success'),
    errorLabel: t('error'),
  };

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <PageHeader title={labels.title} />
      <AllocateForm
        employees={employees}
        leaveTypes={leaveTypes}
        labels={labels}
      />
    </main>
  );
}
