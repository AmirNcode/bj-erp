/**
 * Request-type selector for the four request screens (daily leave, hourly leave,
 * daily work errand, hourly work errand). Each type is its own route, so the
 * choices are plain links rather than client tab state.
 *
 * Two presentations, one breakpoint:
 *   ≥ sm — a tab strip. The active tab drops its bottom border and takes the card
 *          background so it merges into the form card rendered directly below.
 *   < sm — four tabs cannot fit across a phone without horizontal scrolling, so
 *          the strip becomes a native <select> (RequestTypeSelect) plus a header
 *          naming the chosen form, so nobody has to read the closed dropdown to
 *          know which form they are filling in.
 *
 * Either way this component supplies the card's top corners, so the form card
 * must carry `rounded-t-none` at every width.
 */

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { RequestTypeSelect } from './RequestTypeSelect';

export type RequestTypeKey = 'daily' | 'hourly' | 'dailyErrand' | 'errand';

const TABS: { key: RequestTypeKey; href: string }[] = [
  { key: 'daily', href: '/request' },
  { key: 'hourly', href: '/request/hourly' },
  { key: 'dailyErrand', href: '/request/daily-errand' },
  { key: 'errand', href: '/request/errand' },
];

export async function RequestTypeTabs({ active }: { active: RequestTypeKey }) {
  const t = await getTranslations('request.tabs');
  const activeHref = TABS.find((tab) => tab.key === active)?.href ?? TABS[0].href;

  return (
    <>
      {/* Mobile: dropdown, then the chosen form's name as the card's own header. */}
      <div className="sm:hidden">
        <RequestTypeSelect
          label={t('label')}
          value={activeHref}
          options={TABS.map(({ key, href }) => ({ value: href, label: t(key) }))}
        />
        <div
          data-testid="request-type-heading"
          className="relative z-10 -mb-px mt-4 rounded-t-xl border border-b-0 border-border bg-card px-6 pt-4"
        >
          <h2 className="text-base font-semibold">{t(active)}</h2>
        </div>
      </div>

      {/* Desktop: the tab strip, unchanged. */}
      <nav
        aria-label={t('label')}
        data-testid="request-type-tabs"
        className="relative z-10 -mb-px hidden items-stretch gap-1 sm:flex"
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
                'min-w-0 flex-1 rounded-t-lg border px-3 py-2.5 text-center text-sm font-medium transition-colors',
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
    </>
  );
}
