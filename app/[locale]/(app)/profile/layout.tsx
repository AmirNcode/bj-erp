/**
 * Profile (FR-23, FR-96): three tabs — Profile, Personal information, Account.
 * On phones the page title is left to the top bar (MobileTopBar), and the links
 * the side panel carries on desktop (Organization, Help, Settings) sit above the
 * tabs with Logout.
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions, getCachedRoles } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { settingsItemForRoles } from '@/lib/nav/tabs';
import { PageHeader } from '../_components/PageHeader';
import { PageRefreshButton } from '../_components/PageRefreshButton';
import { LogoutButton } from './LogoutButton';
import { ProfileTabs } from './_components/ProfileTabs';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

const linkClass =
  'inline-flex h-9 min-w-0 flex-auto items-center justify-center truncate rounded-md border border-border bg-card px-2 text-[13px] font-medium transition-colors hover:border-primary/40 hover:bg-primary/5';

export default async function ProfileLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getCachedUser();
  if (!user) return null;

  const [t, tNav, roles, perms, capabilities] = await Promise.all([
    getTranslations('profile'),
    getTranslations('nav'),
    getCachedRoles(user.id),
    getCachedPermissions(user.id),
    getApprovalCapabilities(),
  ]);
  const settingsItem = settingsItemForRoles(roles, perms, capabilities.canDelegate);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        section
        title={t('title')}
        action={
          <div className="md:hidden">
            <PageRefreshButton />
          </div>
        }
      />

      {/* Phones have no side panel: its links (FR-44 org chart, Help, FR-55 Settings) and Logout live here. */}
      <div className="flex flex-wrap items-center gap-2 md:hidden" data-testid="profile-mobile-links">
        <Link href={`/${locale}/organization`} data-testid="profile-org-link" className={linkClass}>
          {tNav('organization')}
        </Link>
        <Link href={`/${locale}/help`} data-testid="profile-help-link" className={linkClass}>
          {tNav('help')}
        </Link>
        {settingsItem && (
          <Link href={`/${locale}${settingsItem.href}`} data-testid="profile-settings-link" className={linkClass}>
            {tNav('settings')}
          </Link>
        )}
        <div className="shrink-0">
          <LogoutButton locale={locale} className="h-9 px-3 text-[13px]" testId="profile-mobile-logout" />
        </div>
      </div>

      <ProfileTabs locale={locale} />
      {children}
    </div>
  );
}
