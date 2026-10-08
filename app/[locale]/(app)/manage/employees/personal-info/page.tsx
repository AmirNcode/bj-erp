/**
 * Manage › Employees › Personal info (FR-53): CSV export (personal_info read) and
 * import (personal_info edit). Both RPCs re-check the permission and write the
 * audit row; this page guard keeps everyone else out of the screen and hides the
 * import part from a read-only holder.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { PageHeader } from '../../../_components/PageHeader';
import { PersonalInfoBulk } from './PersonalInfoBulk';

type Props = { params: Promise<{ locale: string }> };

export default async function PersonalInfoBulkPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'personal_info', 'read')) {
    redirect(`/${locale}/manage/employees`);
  }

  const t = await getTranslations('personalInfo.bulk');
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('title')} />
      <PersonalInfoBulk locale={locale} canImport={can(perms, 'personal_info', 'edit')} />
    </main>
  );
}
