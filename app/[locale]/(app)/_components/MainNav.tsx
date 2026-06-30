'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { tabsForRoles, type TabKey } from '@/lib/nav/tabs';
import { cn } from '@/lib/utils';
import { NAV_ICONS } from './nav-icons';

type Props = { roles: string[]; locale: string; labels: Record<TabKey, string> };

export function MainNav({ roles, locale, labels }: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const tabs = tabsForRoles(roles);
  const isActive = (href: string) => {
    const full = `/${locale}${href}`;
    const matches = (candidate: string) =>
      href === '/home' ? candidate === pathname : pathname === candidate || pathname.startsWith(`${candidate}/`);
    return matches(full) || matches(href);
  };
  return (
    <nav
      aria-label={t('primary')}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-[0_-8px_24px_rgba(15,23,42,0.08)]', // mobile bottom bar
        'md:inset-y-0 md:end-auto md:start-0 md:w-60 md:border-t-0 md:border-e md:pt-4 md:shadow-none' // desktop side rail (logical: start/end)
      )}
    >
      <ul className="mx-auto flex max-w-2xl justify-around md:mx-0 md:max-w-none md:flex-col md:gap-1 md:px-3">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.key} className="flex-1 md:flex-none">
              <Link
                href={`/${locale}${tab.href}`}
                data-testid={`nav-${tab.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                  'md:min-h-0 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm',
                  active
                    ? 'bg-primary/10 font-semibold text-primary before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-primary before:content-[""] md:before:inset-x-auto md:before:inset-y-2 md:before:start-0 md:before:h-auto md:before:w-1'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'rounded-full p-1 transition-colors md:p-0',
                    active
                      ? 'bg-primary text-primary-foreground md:bg-transparent md:text-current'
                      : 'text-current'
                  )}
                >
                  {NAV_ICONS[tab.key]}
                </span>
                <span>{labels[tab.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
