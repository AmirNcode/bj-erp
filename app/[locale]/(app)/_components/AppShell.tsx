import type { Perms } from '@/lib/permissions/catalog';
import { Toaster } from '@/components/ui/sonner';
import { MainNav } from './MainNav';
import { RoutePrefetcher } from './RoutePrefetcher';
import { RequestOutcomeBanner } from './RequestOutcomeBanner';
import type { WatchedRequest } from '@/lib/actions/leave/outcomes';

type Props = {
  roles: string[];
  /** FR-55 effective permissions: they decide which links the nav offers. */
  perms: Perms;
  canApprove?: boolean;
  canDelegate?: boolean;
  /** FR-74: someone reports to the caller (Employees shows them). */
  hasReports?: boolean;
  locale: string;
  appName: string;
  /** Side-panel footer identity: name and "{role} ، profile". */
  profile?: { name: string; subtitle: string };
  /** Pending approvals for the side-panel badge; streamed, never awaited here. */
  pendingCount?: Promise<number>;
  /** The caller's own pending requests, for the outcome banner; streamed. */
  myPending?: Promise<WatchedRequest[]>;
  children: React.ReactNode;
};

/**
 * No top header: logo, nav, refresh, profile and the language switch all live
 * in the side panel (desktop). Mobile keeps the bottom tab bar.
 */
export function AppShell({
  roles,
  perms,
  canApprove,
  canDelegate,
  hasReports,
  locale,
  appName,
  profile,
  pendingCount,
  myPending,
  children,
}: Props) {
  const initialUpdatedAt = new Date().toISOString();

  return (
    <div className="min-h-dvh md:ps-60">
      {/* Safe-area insets are 0 outside the installed iPhone PWA, so browsers keep 20px / 96px. */}
      <main className="mx-auto w-full max-w-6xl px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-7 md:pb-8">
        {myPending && <RequestOutcomeBanner pending={myPending} />}
        {children}
      </main>
      <MainNav
        roles={roles}
        perms={perms}
        canApprove={canApprove}
        canDelegate={canDelegate}
        hasReports={hasReports}
        locale={locale}
        appName={appName}
        profile={profile}
        initialUpdatedAt={initialUpdatedAt}
        pendingCount={pendingCount}
      />
      <RoutePrefetcher roles={roles} perms={perms} canApprove={canApprove} canDelegate={canDelegate} hasReports={hasReports} locale={locale} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
