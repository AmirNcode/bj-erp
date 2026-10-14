/**
 * Settings › Roles › edit one role (FR-55). Admin only (D2). Presets and custom
 * roles only: the system roles (Admin, Manager, Employee) are not in the matrix (D9).
 */
export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { listRoles } from '@/lib/actions/roles';
import { SettingsTabs } from '../../_components/SettingsTabs';
import { requireAdminPage } from '../_components/adminGuard';
import { RoleEditor } from '../_components/RoleEditor';

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function EditRolePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale);

  const list = await listRoles();
  const role = list.ok ? list.roles.find((r) => r.id === id) : undefined;
  if (!role) notFound();
  if (role.kind === 'system') redirect(`/${locale}/settings/roles`);

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <SettingsTabs locale={locale} active="roles" />
      <h1 className="text-2xl font-bold tracking-tight">
        <bdi>{role.name}</bdi>
      </h1>
      {/* Keyed by id: after saving a new role the editor remounts with the saved state. */}
      <RoleEditor key={role.id} role={role} locale={locale} />
    </div>
  );
}
