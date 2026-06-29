import { Toaster } from '@/components/ui/sonner';
import { MainNav } from './MainNav';
import type { TabKey } from '@/lib/nav/tabs';

type Props = { roles: string[]; locale: string; labels: Record<TabKey, string>; appName: string; children: React.ReactNode };

export function AppShell({ roles, locale, labels, appName, children }: Props) {
  return (
    <div className="min-h-dvh md:ps-60">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/90 px-4 backdrop-blur">
        <span className="font-bold text-primary">{appName}</span>
        <div className="size-8 rounded-full bg-secondary" aria-hidden />
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-5 pb-24 md:max-w-4xl md:pb-8">{children}</main>
      <MainNav roles={roles} locale={locale} labels={labels} />
      <Toaster position="top-center" richColors />
    </div>
  );
}
