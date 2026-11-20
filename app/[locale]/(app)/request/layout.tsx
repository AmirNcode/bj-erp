/**
 * Request section layout — server guard (FR-76). Security staff without the Employee role send
 * no requests (leave, hourly leave, errands), so every page under /request sends them Home. The
 * database refuses their requests anyway (trigger on leave_requests); this keeps the pages away.
 * Roles are read live, so a role change shows on the next page load, not after the token refresh.
 * FR-95: a test account keeps the pages, with a notice and every Submit button disabled.
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedTimeOff, getCachedTestAccount } from '@/lib/auth/context';
import { TestAccountProvider } from './_components/TestAccount';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function RequestLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  if (!(await getCachedTimeOff(user.id))) redirect(`/${locale}/home`);
  return <TestAccountProvider value={await getCachedTestAccount(user.id)}>{children}</TestAccountProvider>;
}
