/**
 * Leave request page — server component.
 * Fetches leave types, work settings, and the caller's existing requests server-side.
 * Renders the client-side form + My Requests list.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getActiveLeaveTypes, getWorkSettings } from '@/lib/actions/leave/reference';
import { getMyLeaveRequests } from '@/lib/actions/leave/requests';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { LeaveRequestForm } from './LeaveRequestForm';
import { MyRequestsList } from './MyRequestsList';
import { RequestTypeTabs } from './_components/RequestTypeTabs';
import { ListSkeleton } from '@/components/Skeletons';
import { CollapsibleSection } from '@/components/CollapsibleSection';

// Two section headers: both sections load closed.
function RequestPageSkeleton() {
  return <ListSkeleton count={2} />;
}

type Props = {
  params: Promise<{ locale: string }>;
  /** `form=1` opens the new-request section; `all=1` opens My Requests with every request. */
  searchParams: Promise<{ form?: string; all?: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function RequestPageData({
  locale,
  openForm,
  showAll,
}: {
  locale: string;
  openForm: boolean;
  showAll: boolean;
}) {
  const t = await getTranslations('request');
  // Get the authenticated user
  const user = await getCachedUser();

  if (!user) return null;

  // Fetch everything in parallel
  const [leaveTypesResult, requestsResult, workSettingsResult] = await Promise.all([
    getActiveLeaveTypes(),
    getMyLeaveRequests(),
    getWorkSettings(),
  ]);

  const leaveTypes = leaveTypesResult.ok ? leaveTypesResult.types : [];
  const requests = requestsResult.ok ? requestsResult.requests : [];
  const workSettings = workSettingsResult.ok
    ? workSettingsResult.settings
    : WORK_SETTINGS_FALLBACK;

  return (
    <div className="space-y-4">
      {/* Both sections start closed (My Requests opens itself when something is
          pending). The tabs live inside: the other request types are pages. */}
      <CollapsibleSection title={t('newRequestSection')} defaultOpen={openForm} testId="new-request">
        <RequestTypeTabs active="daily" />
        <LeaveRequestForm
          leaveTypes={leaveTypes}
          workSettings={workSettings}
          locale={locale}
        />
      </CollapsibleSection>

      <MyRequestsList
        // A new `?all=1` must re-run the list's opening defaults.
        key={showAll ? 'all' : 'default'}
        requests={requests}
        locale={locale}
        hoursPerDay={workSettings.hoursPerDay}
        showAll={showAll}
      />
    </div>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function RequestPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { form, all } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('request');

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <Suspense fallback={<RequestPageSkeleton />}>
        <RequestPageData locale={locale} openForm={form === '1'} showAll={all === '1'} />
      </Suspense>
    </main>
  );
}
