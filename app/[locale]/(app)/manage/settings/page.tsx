/**
 * Old Manage › Settings. Its contents were split up in the 2026-10 redesign:
 * work settings and holidays moved to /settings, the approval chain to
 * /manage/approval-steps, departments and accrual to /manage/departments.
 * Old links land on the right one for the caller's permissions (FR-55).
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { settingsItemForRoles } from '@/lib/nav/tabs';
import { can } from '@/lib/permissions/catalog';

type Props = { params: Promise<{ locale: string }> };

export default async function OldSettingsPage({ params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const [roles, perms] = await Promise.all([getCachedRoles(user.id), getCachedPermissions(user.id)]);
  if (settingsItemForRoles(roles, perms)) redirect(`/${locale}/settings`);
  if (can(perms, 'approval_steps', 'read')) redirect(`/${locale}/manage/approval-steps`);
  redirect(`/${locale}/home`);
}
