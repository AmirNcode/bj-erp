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
    return href === '/home' ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
  };
  return (
    <nav
      aria-label={t('primary')}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card', // mobile bottom bar
        'md:inset-y-0 md:end-auto md:start-0 md:w-60 md:border-t-0 md:border-e md:pt-4' // desktop side rail (logical: start/end)
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
                  'flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                  'md:min-h-0 md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm',
                  active ? 'text-primary md:bg-secondary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span aria-hidden="true">{NAV_ICONS[tab.key]}</span>
                <span>{labels[tab.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
