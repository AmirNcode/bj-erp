/**
 * Profile (FR-23, FR-96): four tabs — Profile, Personal information, Preferences, Account security.
 * On phones the page title is left to the top bar (MobileTopBar), and the links
 * the side panel carries on desktop (Organization, Help) sit above the tabs in
 * one row with the refresh button. Settings is under the Manage tab; Logout is
 * on the Account security tab.
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { PageHeader } from '../_components/PageHeader';
import { PageRefreshButton } from '../_components/PageRefreshButton';
import { ProfileTabs } from './_components/ProfileTabs';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

const linkClass =
  'inline-flex h-9 min-w-0 items-center justify-center truncate rounded-sm border border-border bg-card px-2 text-xs font-semibold transition-colors hover:border-primary/40 hover:bg-primary/5';

export default async function ProfileLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getCachedUser();
  if (!user) return null;

  const [t, tNav] = await Promise.all([getTranslations('profile'), getTranslations('nav')]);

  return (
    <div data-wide className="flex w-full flex-col gap-4">
      <PageHeader section title={t('title')} />

      {/* Phones have no side panel: refresh + its links (FR-44 org chart, Help), equal width in one row. */}
      <div className="grid auto-cols-fr grid-flow-col gap-2 md:hidden" data-testid="profile-mobile-links">
        <PageRefreshButton className="h-9 w-full min-w-0 gap-1 self-auto px-1.5 max-[400px]:px-1 max-[400px]:[&_svg]:hidden" />
        <Link href={`/${locale}/organization`} data-testid="profile-org-link" className={linkClass}>
          {tNav('organization')}
        </Link>
        <Link href={`/${locale}/help`} data-testid="profile-help-link" className={linkClass}>
          {tNav('help')}
        </Link>
      </div>

      <ProfileTabs locale={locale} />
      {children}
    </div>
  );
}
