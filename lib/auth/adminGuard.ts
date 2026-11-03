import { redirect } from 'next/navigation';
import { getCachedRoles, getCachedUser } from '@/lib/auth/context';

/**
 * Pages for the single admin alone (Settings › Roles, the FR-77 admin panel). Anyone else goes
 * to `fallback`, which applies its own guard. The database functions refuse non-admins too.
 */
export async function requireAdminPage(locale: string, fallback = '/settings'): Promise<void> {
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}${fallback}`);
}
