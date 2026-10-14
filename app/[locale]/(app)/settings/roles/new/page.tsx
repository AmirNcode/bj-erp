/**
 * Settings › Roles › New role (FR-55). Admin only (D2).
 */
export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsTabs } from '../../_components/SettingsTabs';
import { requireAdminPage } from '../_components/adminGuard';
import { RoleEditor } from '../_components/RoleEditor';

type Props = { params: Promise<{ locale: string }> };

export default async function NewRolePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale);
  const t = await getTranslations('rolesAdmin');

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <SettingsTabs locale={locale} active="roles" />
      <h1 className="text-2xl font-bold tracking-tight">{t('newTitle')}</h1>
      <RoleEditor role={null} locale={locale} />
    </div>
  );
}
