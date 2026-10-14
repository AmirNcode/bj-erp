/**
 * Settings › Roles (FR-55): the role list. Admin only (D2).
 */
export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { getRoleHolders, listRoles } from '@/lib/actions/roles';
import { SettingsTabs } from '../_components/SettingsTabs';
import { requireAdminPage } from './_components/adminGuard';
import { RolesList } from './_components/RolesList';

type Props = { params: Promise<{ locale: string }> };

export default async function RolesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale);

  const list = await listRoles();
  const roles = list.ok ? list.roles : [];
  const adminRole = roles.find((r) => r.systemKey === 'admin');
  const holders = adminRole ? await getRoleHolders(adminRole.id) : null;
  const adminHolder = holders?.ok ? (holders.holders[0] ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <SettingsTabs locale={locale} active="roles" />
      {!list.ok && (
        <p role="alert" className="text-sm text-destructive">
          {list.error}
        </p>
      )}
      <RolesList roles={roles} adminHolder={adminHolder} locale={locale} />
    </div>
  );
}
