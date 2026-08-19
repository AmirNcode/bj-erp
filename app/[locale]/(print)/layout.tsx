/**
 * Print route group — a bare authenticated shell (FR-38).
 *
 * Deliberately NOT inside `(app)`: that layout wraps everything in AppShell, so
 * a printed page would carry the header, the bottom tab bar and the side rail.
 * Hiding all of that with `@media print` is possible but fragile — every future
 * chrome change has to remember to hide itself. A separate group means the
 * printed sheet only ever contains the form.
 *
 * The path is `/print/...` rather than `/request/...` on purpose: route groups
 * do not add a segment, so `(print)/request/[id]` would collide with the real
 * `(app)/request/hourly`, `/errand` and `/daily-errand` screens.
 *
 * The auth guard is duplicated from `(app)/layout.tsx` because this group does
 * not sit under it. RLS is still the actual authority for which request a caller
 * may read — this only stops a logged-out visitor reaching the route at all.
 */

import { redirect } from 'next/navigation';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function PrintLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  const profile = await getCachedProfile(user.id);
  if (!profile?.active) redirect(`/${locale}/login`);

  return <div className="min-h-dvh bg-white text-black">{children}</div>;
}
