import { redirect } from 'next/navigation';
import { getCachedRoles, getCachedUser } from '@/lib/auth/context';

/**
 * Settings › Roles pages are the admin's alone (D2: the role editor is never a
 * permission). Anyone else goes back to Settings › General, which applies its
 * own guard. The RPCs refuse non-admins too.
 */
export async function requireAdminPage(locale: string): Promise<void> {
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}/settings`);
}
