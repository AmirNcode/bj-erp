'use client';
import { Suspense, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  manageItemsForRoles,
  settingsItemForRoles,
  tabsForRoles,
  type NavItem,
  type NavItemKey,
  type TabKey,
} from '@/lib/nav/tabs';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/i18n/format';
import { NAV_ICONS, NAV_ITEM_ICONS } from './nav-icons';
import { PageRefreshButton } from './PageRefreshButton';
import { LanguageSwitch } from './LanguageSwitch';

export type NavLabels = Record<TabKey, string> &
  Record<NavItemKey, string> & {
    manageGroup: string;
    language: string;
    langFa: string;
    langEn: string;
  };

type Props = {
  roles: string[];
  locale: string;
  labels: NavLabels;
  appName?: string;
  /** Side-panel footer: the caller's name and "{role} ، profile" line. */
  profile?: { name: string; subtitle: string };
  initialUpdatedAt?: string;
  /** Pending approvals for the Approvals badge; streamed so it never blocks the shell. */
  pendingCount?: Promise<number>;
};

// Active = existing style: tint, primary text, a 4px bar on the start edge.
const activeItem =
  'bg-primary/10 font-semibold text-primary before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-primary before:content-[""]';
const inactiveItem = 'text-muted-foreground hover:bg-muted/50 hover:text-foreground';
const sideItem =
  'relative flex items-center gap-3 whitespace-nowrap rounded-[10px] px-3 py-[9px] text-sm transition-colors';

function ApprovalsBadge({ count, locale }: { count: Promise<number>; locale: string }) {
  const n = use(count);
  if (n <= 0) return null;
  return (
    <span
      data-testid="nav-approvals-count"
      className="ms-auto rounded-full bg-primary px-2 text-[11.5px] font-semibold leading-5 text-primary-foreground"
    >
      {formatNumber(n, locale)}
    </span>
  );
}

export function MainNav({
  roles,
  locale,
  labels,
  appName,
  profile,
  initialUpdatedAt,
  pendingCount,
}: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const tabs = tabsForRoles(roles);
  const manageItems = manageItemsForRoles(roles);
  const settings = settingsItemForRoles(roles);

  const isActive = (href: string) => {
    const full = `/${locale}${href}`;
    const matches = (candidate: string) =>
      href === '/home' || href === '/manage'
        ? candidate === pathname
        : pathname === candidate || pathname.startsWith(`${candidate}/`);
    return matches(full) || matches(href);
  };
  // The mobile Manage tab covers every page inside the group.
  const inManage =
    manageItems.some((item) => isActive(item.href)) ||
    (settings ? isActive(settings.href) : false) ||
    isActive('/manage');

  const sideLink = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <li key={item.key}>
        <Link
          href={`/${locale}${item.href}`}
          data-testid={item.testId}
          aria-current={active ? 'page' : undefined}
          className={cn(sideItem, active ? activeItem : inactiveItem)}
        >
          <span aria-hidden="true" className="shrink-0">
            {NAV_ITEM_ICONS[item.key]}
          </span>
          <span>{labels[item.key]}</span>
          {item.key === 'approvals' && pendingCount && (
            <Suspense fallback={null}>
              <ApprovalsBadge count={pendingCount} locale={locale} />
            </Suspense>
          )}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label={t('primary')}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-[0_-8px_24px_rgba(15,23,42,0.08)]', // mobile bottom bar
        'md:inset-y-0 md:end-auto md:start-0 md:flex md:w-60 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-t-0 md:border-e md:px-3 md:pt-4 md:shadow-none' // desktop side panel (logical: start/end)
      )}
    >
      {/* Logo only, centred; the app name is its alt text. */}
      <div className="hidden justify-center px-2 pt-1 pb-[18px] md:flex">
        <Image
          src="/bj-logo.png"
          alt={appName ?? ''}
          width={112}
          height={56}
          priority
          className="h-[38px] w-auto object-contain"
        />
      </div>

      <ul className="mx-auto flex max-w-2xl justify-around md:mx-0 md:max-w-none md:flex-col md:gap-0.5">
        {tabs.map((tab) => {
          const mobileOnly = tab.key === 'manage';
          const active = mobileOnly ? inManage : isActive(tab.href);
          return (
            <li key={tab.key} className={cn('flex-1 md:flex-none', mobileOnly && 'md:hidden')}>
              <Link
                href={`/${locale}${tab.href}`}
                // The desktop Employees item owns `nav-manage`; the mobile tab
                // needs its own id so the two never match one locator together.
                data-testid={mobileOnly ? 'nav-manage-tab' : `nav-${tab.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap py-2 text-xs transition-colors',
                  'md:min-h-0 md:flex-row md:justify-start md:gap-3 md:rounded-[10px] md:px-3 md:py-[9px] md:text-sm',
                  active
                    ? 'bg-primary/10 font-semibold text-primary before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-primary before:content-[""] md:before:inset-x-auto md:before:inset-y-2 md:before:start-0 md:before:h-auto md:before:w-1'
                    : inactiveItem
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
        {/* Mobile has no side panel footer, so the bar carries Profile. */}
        <li className="flex-1 md:hidden">
          <Link
            href={`/${locale}/profile`}
            data-testid="nav-profile-tab"
            aria-current={isActive('/profile') ? 'page' : undefined}
            className={cn(
              'relative flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap py-2 text-xs transition-colors',
              isActive('/profile')
                ? 'bg-primary/10 font-semibold text-primary before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-primary before:content-[""]'
                : inactiveItem
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'rounded-full p-1',
                isActive('/profile') ? 'bg-primary text-primary-foreground' : 'text-current'
              )}
            >
              {NAV_ICONS.profile}
            </span>
            <span>{labels.profile}</span>
          </Link>
        </li>
      </ul>

      {manageItems.length > 0 && (
        <div className="hidden md:block">
          <p className="px-3 pt-4 pb-1 text-[11.5px] font-semibold text-muted-foreground">
            {labels.manageGroup}
          </p>
          <ul className="flex flex-col gap-0.5">{manageItems.map(sideLink)}</ul>
        </div>
      )}

      {settings && (
        <div className="hidden md:block">
          <div className="mx-1 my-3 h-px bg-muted" />
          <ul className="flex flex-col gap-0.5">{sideLink(settings)}</ul>
        </div>
      )}

      {/* Footer: refresh, profile, language — pinned to the bottom. */}
      <div className="mt-auto hidden flex-col gap-2.5 border-t border-muted pt-4 pb-4 md:flex">
        <PageRefreshButton initialUpdatedAt={initialUpdatedAt} />
        <Link
          href={`/${locale}/profile`}
          data-testid="nav-profile"
          aria-label={labels.profile}
          aria-current={isActive('/profile') ? 'page' : undefined}
          className="flex items-center gap-2.5 rounded-[10px] p-1 transition-colors hover:bg-muted/50"
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground [&_svg]:size-5"
          >
            {NAV_ICONS.profile}
          </span>
          {profile && (
            <span className="min-w-0">
              <span className="block truncate whitespace-nowrap text-[13.5px] font-semibold text-foreground">
                <bdi>{profile.name}</bdi>
              </span>
              <span className="block truncate whitespace-nowrap text-xs text-muted-foreground">
                {profile.subtitle}
              </span>
            </span>
          )}
        </Link>
        <LanguageSwitch
          locale={locale}
          labels={{ label: labels.language, fa: labels.langFa, en: labels.langEn }}
        />
      </div>
    </nav>
  );
}
