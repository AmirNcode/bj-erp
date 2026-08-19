/**
 * Manage section layout — server guard.
 * Only users with the 'admin', 'manager' or 'hr' role may enter.
 * Everyone else is redirected to /home.
 *
 * This is the outer door only. The pages behind it guard themselves further:
 * Settings, Allocations and Add-Department redirect anyone who is not an admin,
 * so `hr` reaching /manage does not reach company configuration (FR-35).
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function ManageLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const roles = await getCachedRoles(user.id);
  const canAccess =
    roles.includes('admin') || roles.includes('manager') || roles.includes('hr');

  if (!canAccess) {
    redirect(`/${locale}/home`);
  }

  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
