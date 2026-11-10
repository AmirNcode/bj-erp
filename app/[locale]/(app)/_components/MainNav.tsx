'use client';
import { Suspense, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  manageItemsForRoles,
  settingsItemForRoles,
  adminItemForRoles,
  tabsForRoles,
  type NavItem,
} from '@/lib/nav/tabs';
import type { Perms } from '@/lib/permissions/catalog';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/i18n/format';
import { HELP_ICON, NAV_ICONS, NAV_ITEM_ICONS } from './nav-icons';
import { PageRefreshButton } from './PageRefreshButton';
import { LanguageSwitch } from './LanguageSwitch';
import { PersonAvatar } from '@/components/PersonAvatar';

type Props = {
  roles: string[];
  perms: Perms;
  canApprove?: boolean;
  canDelegate?: boolean;
  hasReports?: boolean;
  absencesPage?: boolean;
  /** FR-76: live; false hides the Request tab. */
  timeOff?: boolean;
  locale: string;
  appName?: string;
  /** Side-panel footer: the caller's name and "{role} ، profile" line. */
  profile?: { id?: string; name: string; subtitle: string };
  initialUpdatedAt?: string;
  /** Pending approvals for the Approvals badge; streamed so it never blocks the shell. */
  pendingCount?: Promise<number>;
};

// Blueprint. Side panel (desktop, on --sidebar): white text, the active item
// gets a faint fill and a 3px white rule on the panel's start edge. Bottom bar
// (mobile, on white): the active tab is primary with a 3px rule on top.
const sideActive =
  'bg-white/12 font-semibold text-white before:absolute before:inset-y-0 before:-start-3 before:w-[3px] before:bg-white before:content-[""]';
const activeItem = sideActive;
// Literal classes: Tailwind cannot see built strings.
const inactiveItem =
  'text-muted-foreground hover:text-foreground md:text-white/75 md:hover:bg-white/8 md:hover:text-white';
const tabActive =
  'font-semibold text-primary before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-primary before:content-[""] ' +
  'md:bg-white/12 md:text-white md:before:inset-x-auto md:before:inset-y-0 md:before:-start-3 md:before:h-auto md:before:w-[3px] md:before:bg-white';
const sideItem =
  'relative flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-[9px] text-sm transition-colors';

function ApprovalsBadge({ count, locale }: { count: Promise<number>; locale: string }) {
  const n = use(count);
  if (n <= 0) return null;
  return (
    <span
      data-testid="nav-approvals-count"
      className="ms-auto rounded-sm bg-white px-1.5 text-[11.5px] font-semibold leading-5 text-sidebar"
    >
      {formatNumber(n, locale)}
    </span>
  );
}

export function MainNav({
  roles,
  perms,
  canApprove,
  canDelegate,
  hasReports,
  absencesPage,
  timeOff,
  locale,
  appName,
  profile,
  initialUpdatedAt,
  pendingCount,
}: Props) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const tabs = tabsForRoles(roles, perms, canApprove, canDelegate, hasReports, absencesPage, timeOff);
  const manageItems = manageItemsForRoles(roles, perms, canApprove, canDelegate, hasReports, absencesPage);
  const settings = settingsItemForRoles(roles, perms, canDelegate);
  const admin = adminItemForRoles(roles);

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
    (admin ? isActive(admin.href) : false) ||
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
          <span>{t(item.key)}</span>
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
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card print:hidden', // mobile bottom bar
        'md:inset-y-0 md:end-auto md:start-0 md:flex md:w-60 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-t-0 md:bg-sidebar md:px-3 md:pt-4 md:text-sidebar-foreground' // desktop side panel (logical: start/end)
      )}
    >
      {/* Logo only, centred, 80% of the nav items' width (owner, 2026-10-13);
          the app name is its alt text. The PNG's white is transparent, so it
          sits on a white plate, inset 2px so it never shows past the frame's
          antialiased edge, and the frame melts into the panel. */}
      <Link
        href={`/${locale}/home`}
        aria-label={t('home')}
        data-testid="nav-logo-link"
        className="hidden justify-center pt-1 pb-[18px] focus-visible:outline-2 focus-visible:outline-white md:flex"
      >
        <Image
          src="/bj-logo.png"
          alt={appName ?? ''}
          width={1181}
          height={591}
          sizes="173px"
          priority
          className="h-auto w-4/5 object-contain bg-[linear-gradient(white,white)] bg-[length:calc(100%-4px)_calc(100%-4px)] bg-center bg-no-repeat"
          data-testid="nav-logo"
        />
      </Link>

      <ul className="mx-auto flex max-w-2xl justify-around md:mx-0 md:max-w-none md:flex-col md:gap-0.5">
        {tabs.map((tab) => {
          const mobileOnly = tab.key === 'manage';
          const active = mobileOnly ? inManage : isActive(tab.href);
          return (
            <li
              key={tab.key}
              className={cn(
                'flex-1 md:flex-none',
                mobileOnly && 'md:hidden',
                tab.desktopOnly && 'hidden md:block'
              )}
            >
              <Link
                href={`/${locale}${tab.href}`}
                // The desktop Employees item owns `nav-manage`; the mobile tab
                // needs its own id so the two never match one locator together.
                data-testid={mobileOnly ? 'nav-manage-tab' : `nav-${tab.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap py-2 text-xs transition-colors',
                  'md:min-h-0 md:flex-row md:justify-start md:gap-3 md:rounded-md md:px-3 md:py-[9px] md:text-sm',
                  active ? tabActive : inactiveItem
                )}
              >
                <span aria-hidden="true">{NAV_ICONS[tab.key]}</span>
                <span>{t(tab.key)}</span>
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
              isActive('/profile') ? tabActive : inactiveItem
            )}
          >
            <span aria-hidden="true">{NAV_ICONS.profile}</span>
            <span>{t('profile')}</span>
          </Link>
        </li>
      </ul>

      {manageItems.length > 0 && (
        <div className="hidden md:block">
          <p className="px-3 pt-4 pb-1 text-[11.5px] font-semibold text-white/60">
            {t('manage')}
          </p>
          <ul className="flex flex-col gap-0.5">{manageItems.map(sideLink)}</ul>
        </div>
      )}

      {(settings || admin) && (
        <div className="hidden md:block">
          <div className="mx-1 my-3 h-px bg-white/15" />
          <ul className="flex flex-col gap-0.5">
            {settings && sideLink(settings)}
            {admin && sideLink(admin)}
          </ul>
        </div>
      )}

      {/* Help sits just above the footer; mobile reaches it from Profile. */}
      <ul className="mt-auto hidden pb-2 md:block">
        <li>
          <Link
            href={`/${locale}/help`}
            data-testid="nav-help"
            aria-current={isActive('/help') ? 'page' : undefined}
            className={cn(sideItem, isActive('/help') ? activeItem : inactiveItem)}
          >
            <span aria-hidden="true" className="shrink-0">
              {HELP_ICON}
            </span>
            <span>{t('help')}</span>
          </Link>
        </li>
      </ul>

      {/* Footer: refresh, profile, language — pinned to the bottom. */}
      <div className="hidden flex-col gap-2.5 border-t border-white/15 pt-4 pb-4 md:flex">
        <PageRefreshButton initialUpdatedAt={initialUpdatedAt} onDark />
        <Link
          href={`/${locale}/profile`}
          data-testid="nav-profile"
          aria-label={t('profile')}
          aria-current={isActive('/profile') ? 'page' : undefined}
          className="flex items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-white/8"
        >
          {profile?.id ? (
            <PersonAvatar id={profile.id} name={profile.name} className="size-9" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground [&_svg]:size-5"
            >
              {NAV_ICONS.profile}
            </span>
          )}
          {profile && (
            <span className="min-w-0">
              <span className="block truncate whitespace-nowrap text-[13.5px] font-semibold text-white">
                <bdi>{profile.name}</bdi>
              </span>
              <span className="block truncate whitespace-nowrap text-xs text-white/70">
                {profile.subtitle}
              </span>
            </span>
          )}
        </Link>
        <LanguageSwitch locale={locale} onDark />
      </div>
    </nav>
  );
}
