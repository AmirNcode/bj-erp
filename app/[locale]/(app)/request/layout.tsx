/**
 * Request section layout — server guard (FR-76). Security staff without the Employee role send
 * no requests (leave, hourly leave, errands), so every page under /request sends them Home. The
 * database refuses their requests anyway (trigger on leave_requests); this keeps the pages away.
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { hasTimeOff } from '@/lib/auth/timeOff';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function RequestLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  if (!hasTimeOff(await getCachedRoles(user.id))) redirect(`/${locale}/home`);
  return children;
}
