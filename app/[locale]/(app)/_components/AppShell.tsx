import { Toaster } from '@/components/ui/sonner';
import { MainNav, type NavLabels } from './MainNav';
import { RoutePrefetcher } from './RoutePrefetcher';

type Props = {
  roles: string[];
  locale: string;
  labels: NavLabels;
  appName: string;
  /** Side-panel footer identity: name and "{role} ، profile". */
  profile?: { name: string; subtitle: string };
  /** Pending approvals for the side-panel badge; streamed, never awaited here. */
  pendingCount?: Promise<number>;
  children: React.ReactNode;
};

/**
 * No top header: logo, nav, refresh, profile and the language switch all live
 * in the side panel (desktop). Mobile keeps the bottom tab bar.
 */
export function AppShell({ roles, locale, labels, appName, profile, pendingCount, children }: Props) {
  const initialUpdatedAt = new Date().toISOString();

  return (
    <div className="min-h-dvh md:ps-60">
      <main className="mx-auto w-full max-w-6xl px-4 py-5 pb-24 md:px-8 md:py-7 md:pb-8">{children}</main>
      <MainNav
        roles={roles}
        locale={locale}
        labels={labels}
        appName={appName}
        profile={profile}
        initialUpdatedAt={initialUpdatedAt}
        pendingCount={pendingCount}
      />
      <RoutePrefetcher roles={roles} locale={locale} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
