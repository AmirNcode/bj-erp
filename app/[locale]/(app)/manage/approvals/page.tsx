/**
 * Approvals queue — the approval chain routes to people, so access is identity
 * based (admin, manager, hr), not a permission (FR-55; lib/nav/tabs.ts). Read
 * scope comes from RLS + getPendingApprovals. The /manage layout admits anyone
 * with a Manage item, so this page guards itself.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { PageHeader } from '../../_components/PageHeader';
import { ApprovalQueue } from './ApprovalQueue';
import { TripExtensions } from './TripExtensions';
import { listExtendableTrips, listPendingExtensions } from '@/lib/actions/travel';
import { NewRequestsBanner } from '../../_components/NewRequestsBanner';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function ApprovalsData({ locale }: { locale: string }) {
  const t = await getTranslations('approvals');

  // Durations are stored in minutes; rendering them as days and hours needs the
  // company day length.
  const [result, workSettingsRes, extendableTrips, pendingExtensions] = await Promise.all([
    getPendingApprovals(),
    getWorkSettings(),
    listExtendableTrips(),
    listPendingExtensions(),
  ]);
  const requests = result.ok ? result.requests : [];
  const loadError = result.ok ? null : result.error;
  const hoursPerDay = workSettingsRes.ok
    ? workSettingsRes.settings.hoursPerDay
    : WORK_SETTINGS_FALLBACK.hoursPerDay;

  return (
    <>
      <NewRequestsBanner currentIds={requests.map((r) => r.id)} />
      {loadError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
          <strong>{t('error')}:</strong> {loadError}
        </div>
      )}
      <ApprovalQueue
        requests={requests}
        locale={locale}
        hoursPerDay={hoursPerDay}
      />
      <TripExtensions trips={extendableTrips} pending={pendingExtensions} locale={locale} />
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function ApprovalsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const capabilities = await getApprovalCapabilities();
  if (!capabilities.canApprove) redirect(`/${locale}/home`);

  const t = await getTranslations('approvals');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />
      <Suspense fallback={<ListSkeleton count={3} />}>
        <ApprovalsData locale={locale} />
      </Suspense>
    </main>
  );
}
