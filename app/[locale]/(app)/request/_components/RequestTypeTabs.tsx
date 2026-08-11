/**
 * Request-type selector for the four request screens (daily leave, hourly leave,
 * daily work errand, hourly work errand). Each type is its own route, so the "tabs" are plain
 * links — the active one drops its bottom border and takes the card background so
 * it merges into the form card rendered directly below it.
 *
 * The form card must therefore carry `rounded-t-none`; the strip supplies the top
 * corners.
 */

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type RequestTypeKey = 'daily' | 'hourly' | 'dailyErrand' | 'errand';

const TABS: { key: RequestTypeKey; href: string }[] = [
  { key: 'daily', href: '/request' },
  { key: 'hourly', href: '/request/hourly' },
  { key: 'dailyErrand', href: '/request/daily-errand' },
  { key: 'errand', href: '/request/errand' },
];

export async function RequestTypeTabs({ active }: { active: RequestTypeKey }) {
  const t = await getTranslations('request.tabs');

  return (
    <nav
      aria-label={t('label')}
      data-testid="request-type-tabs"
      className="relative z-10 -mb-px flex items-stretch gap-1 overflow-x-auto"
    >
      {TABS.map(({ key, href }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`request-tab-${key}`}
            className={cn(
              'min-w-36 flex-none rounded-t-lg border px-3 py-2.5 text-center text-sm font-medium transition-colors sm:min-w-0 sm:flex-1',
              isActive
                ? 'border-border border-b-card bg-card text-foreground'
                : 'border-transparent border-b-border bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
