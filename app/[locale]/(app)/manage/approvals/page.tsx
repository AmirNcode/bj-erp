/**
 * Approvals queue — the approval chain routes to people, so access is identity
 * based (admin, manager, hr), not a permission (FR-55; lib/nav/tabs.ts). Below
 * it, the history of what the caller decided (2026-11-02). Read
 * scope comes from RLS + getPendingApprovals. The /manage layout admits anyone
 * with a Manage item, so this page guards itself.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { can } from '@/lib/permissions/catalog';
import { parseRequestFilters, matchesRequest, type RequestFilters as Filters } from '@/lib/leave/requestFilters';
import { RequestFilters } from './RequestFilters';
import { getCachedPermissions, getCachedUser } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { getPendingApprovals } from '@/lib/actions/leave/approvals';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { PageHeader } from '../../_components/PageHeader';
import { ApprovalQueue } from './ApprovalQueue';
import { TripExtensions } from './TripExtensions';
import { ApprovalHistory } from './ApprovalHistory';
import { getTravelTicks, listExtendableTrips, listPendingExtensions } from '@/lib/actions/travel';
import { getRequestEditKeys } from '@/lib/actions/leave/edit';
import { NewRequestsBanner } from '../../_components/NewRequestsBanner';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function ApprovalsData({ locale, historyPage, filters, viewerId, canReview, canCancel }: { locale: string; historyPage: number; filters: Filters; viewerId: string; canReview: boolean; canCancel: boolean }) {
  const t = await getTranslations('approvals');

  // Durations are stored in minutes; rendering them as days and hours needs the
  // company day length.
  const [result, workSettingsRes, extendableTrips, pendingExtensions, travelTicks, editKeys] = await Promise.all([
    getPendingApprovals(canReview),
    getWorkSettings(),
    listExtendableTrips(),
    listPendingExtensions(),
    getTravelTicks(),
    getRequestEditKeys(),
  ]);
  const requests = result.ok ? result.requests : [];
  const loadError = result.ok ? null : result.error;
  const hoursPerDay = workSettingsRes.ok
    ? workSettingsRes.settings.hoursPerDay
    : WORK_SETTINGS_FALLBACK.hoursPerDay;
  const workSettings = workSettingsRes.ok ? workSettingsRes.settings : WORK_SETTINGS_FALLBACK;
  const workWindow = { start: workSettings.workStart, end: workSettings.workEnd };

  return (
    <>
      <NewRequestsBanner currentIds={requests.filter(r => r.can_override || r.decision_steps?.length).map(r => r.id)} />
      {loadError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
          <strong>{t('error')}:</strong> {loadError}
        </div>
      )}
      <h2 className="mb-3 text-lg font-semibold">{t('pendingTitle')}</h2>
      <ApprovalQueue
        requests={requests.filter(r => matchesRequest({ ...r, status: 'pending' }, filters))}
        locale={locale}
        hoursPerDay={hoursPerDay}
      />
      <TripExtensions trips={extendableTrips} pending={pendingExtensions} locale={locale} />
      <Suspense fallback={<ListSkeleton count={3} />}>
        <ApprovalHistory locale={locale} page={historyPage} hoursPerDay={hoursPerDay} filters={filters} travelTicks={travelTicks} viewerId={viewerId} canReview={canReview} canCancel={canCancel} editKeys={editKeys} workWindow={workWindow} />
      </Suspense>
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function ApprovalsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  const filters = parseRequestFilters(sp);
  const historyPage = Math.max(1, Number.parseInt(typeof sp.history === 'string' ? sp.history : '1', 10) || 1);
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const capabilities = await getApprovalCapabilities();
  const perms = await getCachedPermissions(user.id);
  const canReview = can(perms, 'leave_requests', 'read');
  if (!capabilities.canApprove && !canReview) redirect(`/${locale}/home`);

  const t = await getTranslations('approvals');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader section title={t('title')} />
      <RequestFilters filters={filters} locale={locale} />
      <Suspense fallback={<ListSkeleton count={3} />}>
        <ApprovalsData locale={locale} historyPage={historyPage} filters={filters} viewerId={user.id} canReview={canReview} canCancel={can(perms, 'leave_requests')} />
      </Suspense>
    </main>
  );
}
