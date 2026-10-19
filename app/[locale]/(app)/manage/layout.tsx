/**
 * Manage section layout — server guard.
 * Anyone who reaches at least one Manage item (FR-55 permissions; approvers and
 * managers keep theirs by identity) may enter. Everyone else is redirected to /home.
 *
 * This is the outer door only. Every page behind it guards itself with the
 * permission it needs.
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { manageItemsForRoles } from '@/lib/nav/tabs';

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

  const [roles, perms, capabilities] = await Promise.all([getCachedRoles(user.id), getCachedPermissions(user.id), getApprovalCapabilities()]);
  const canAccess = manageItemsForRoles(roles, perms, capabilities.canApprove).length > 0 || capabilities.canDelegate;

  if (!canAccess) {
    redirect(`/${locale}/home`);
  }

  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
