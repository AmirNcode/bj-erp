/**
 * Request section layout — server guard (FR-76). Security staff without the Employee role send
 * no requests (leave, hourly leave, errands), so every page under /request sends them Home. The
 * database refuses their requests anyway (trigger on leave_requests); this keeps the pages away.
 * Roles are read live, so a role change shows on the next page load, not after the token refresh.
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedTimeOff } from '@/lib/auth/context';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function RequestLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  if (!(await getCachedTimeOff(user.id))) redirect(`/${locale}/home`);
  return children;
}
