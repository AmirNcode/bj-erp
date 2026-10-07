/**
 * Manage › Employees › Personal info (FR-53): CSV export and import for hr and
 * admin. Both RPCs re-check the permission and write the audit row; this page
 * guard only keeps everyone else out of the screen.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { PageHeader } from '../../../_components/PageHeader';
import { PersonalInfoBulk } from './PersonalInfoBulk';

type Props = { params: Promise<{ locale: string }> };

export default async function PersonalInfoBulkPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin') && !roles.includes('hr')) {
    redirect(`/${locale}/manage/employees`);
  }

  const t = await getTranslations('personalInfo.bulk');
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('title')} />
      <PersonalInfoBulk locale={locale} />
    </main>
  );
}
