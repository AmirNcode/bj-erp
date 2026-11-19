/**
 * Profile (FR-23, FR-96): three tabs — Profile, Personal information, Account.
 * On phones the page title is left to the top bar (MobileTopBar), and the links
 * the side panel carries on desktop (Organization, Help, Settings) sit above the
 * tabs in one row with the refresh button. Logout is on the Account tab.
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions, getCachedRoles } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { settingsItemForRoles } from '@/lib/nav/tabs';
import { PageHeader } from '../_components/PageHeader';
import { PageRefreshButton } from '../_components/PageRefreshButton';
import { ProfileTabs } from './_components/ProfileTabs';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

const linkClass =
  'inline-flex h-9 min-w-0 items-center justify-center truncate rounded-sm border border-border bg-card px-2 text-[12.5px] font-semibold transition-colors hover:border-primary/40 hover:bg-primary/5';

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
      <PageHeader section title={t('title')} />

      {/* Phones have no side panel: refresh + its links (FR-44 org chart, Help, FR-55 Settings), equal width in one row. */}
      <div className="grid auto-cols-fr grid-flow-col gap-2 md:hidden" data-testid="profile-mobile-links">
        <PageRefreshButton className="h-9 w-full min-w-0 self-auto px-2" />
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
      </div>

      <ProfileTabs locale={locale} />
      {children}
    </div>
  );
}
