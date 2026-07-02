/**
 * Manage section layout — server guard.
 * Only users with 'admin' or 'manager' role may enter.
 * Everyone else is redirected to /home.
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
  const canAccess = roles.includes('admin') || roles.includes('manager');

  if (!canAccess) {
    redirect(`/${locale}/home`);
  }

  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
