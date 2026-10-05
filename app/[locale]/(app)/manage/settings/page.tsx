/**
 * Old Manage › Settings. Its contents were split up in the 2026-10 redesign:
 * work settings and holidays moved to /settings (admin), the approval chain to
 * /manage/approval-steps (admin + hr), departments and accrual to
 * /manage/departments (admin). Old links land on the right one.
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';

type Props = { params: Promise<{ locale: string }> };

export default async function OldSettingsPage({ params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (roles.includes('admin')) redirect(`/${locale}/settings`);
  if (roles.includes('hr')) redirect(`/${locale}/manage/approval-steps`);
  redirect(`/${locale}/home`);
}
