import Image from 'next/image';
import { Toaster } from '@/components/ui/sonner';
import { MainNav } from './MainNav';
import { RoutePrefetcher } from './RoutePrefetcher';
import type { TabKey } from '@/lib/nav/tabs';

type Props = { roles: string[]; locale: string; labels: Record<TabKey, string>; appName: string; children: React.ReactNode };

export function AppShell({ roles, locale, labels, appName, children }: Props) {
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
          <span className="font-bold text-primary">{appName}</span>
        </div>
        <div className="size-8 rounded-full bg-secondary" aria-hidden />
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-5 pb-24 md:max-w-4xl md:pb-8">{children}</main>
      <MainNav roles={roles} locale={locale} labels={labels} />
      <RoutePrefetcher roles={roles} locale={locale} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
