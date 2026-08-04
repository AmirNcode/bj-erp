import Image from 'next/image';
import Link from 'next/link';
import { Toaster } from '@/components/ui/sonner';
import { MainNav } from './MainNav';
import { PageRefreshButton } from './PageRefreshButton';
import { RoutePrefetcher } from './RoutePrefetcher';
import { NAV_ICONS } from './nav-icons';
import type { TabKey } from '@/lib/nav/tabs';

type Props = { roles: string[]; locale: string; labels: Record<TabKey, string>; appName: string; children: React.ReactNode };

export function AppShell({ roles, locale, labels, appName, children }: Props) {
  const initialUpdatedAt = new Date().toISOString();

  return (
    <div className="min-h-dvh md:ps-60">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Image
            src="/bj-logo.png"
            alt={appName}
            width={112}
            height={56}
            priority
            className="h-8 w-auto object-contain"
          />
          <span className="hidden font-bold text-primary sm:inline">{appName}</span>
        </div>
        <div
          className="flex items-center gap-2"
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
        >
          <PageRefreshButton initialUpdatedAt={initialUpdatedAt} />
          <Link
            href={`/${locale}/profile`}
            data-testid="nav-profile"
            aria-label={labels.profile}
            className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <span aria-hidden="true">{NAV_ICONS.profile}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-5 pb-24 md:max-w-4xl md:pb-8">{children}</main>
      <MainNav roles={roles} locale={locale} labels={labels} />
      <RoutePrefetcher roles={roles} locale={locale} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
