/**
 * Request-type selector for the three request screens (daily leave, hourly leave,
 * hourly work errand). Each type is its own route (D13), so the "tabs" are plain
 * links — the active one drops its bottom border and takes the card background so
 * it merges into the form card rendered directly below it.
 *
 * The form card must therefore carry `rounded-t-none`; the strip supplies the top
 * corners.
 */

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type RequestTypeKey = 'daily' | 'hourly' | 'errand';

const TABS: { key: RequestTypeKey; href: string }[] = [
  { key: 'daily', href: '/request' },
  { key: 'hourly', href: '/request/hourly' },
  { key: 'errand', href: '/request/errand' },
];

export async function RequestTypeTabs({ active }: { active: RequestTypeKey }) {
  const t = await getTranslations('request.tabs');

  return (
    <nav
      aria-label={t('label')}
      data-testid="request-type-tabs"
      className="relative z-10 -mb-px flex items-stretch gap-1"
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
              'flex-1 rounded-t-lg border px-3 py-2.5 text-center text-sm font-medium transition-colors',
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
