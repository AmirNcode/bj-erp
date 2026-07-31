/**
 * Approvals queue — manager (own reports) + admin (all). Read scope comes from
 * RLS + getPendingApprovals; the /manage layout already gates admin|manager.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPendingApprovals, getWorkSettings } from '@/lib/actions/leave';
import { PageHeader } from '../../_components/PageHeader';
import { ApprovalQueue } from './ApprovalQueue';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function ApprovalsData({ locale }: { locale: string }) {
  const t = await getTranslations('approvals');
  const tLeave = await getTranslations('leave');
  const tRepl = await getTranslations('replacement');
  const tErrand = await getTranslations('errand');

  // Durations are stored in minutes; rendering them as days and hours needs the
  // company day length.
  const [result, workSettingsRes] = await Promise.all([
    getPendingApprovals(),
    getWorkSettings(),
  ]);
  const requests = result.ok ? result.requests : [];
  const loadError = result.ok ? null : result.error;
  const hoursPerDay = workSettingsRes.ok ? workSettingsRes.settings.hoursPerDay : 8;

  const labels = {
    empty: t('empty'),
    reason: t('reason'),
    approve: t('approve'),
    reject: t('reject'),
    approveConfirm: t('approveConfirm'),
    rejectConfirm: t('rejectConfirm'),
    rejectReasonLabel: t('rejectReasonLabel'),
    rejectReasonPlaceholder: t('rejectReasonPlaceholder'),
    errorLabel: t('error'),
    approveSuccess: t('approveSuccess'),
    rejectSuccess: t('rejectSuccess'),
    coverLabel: tRepl('coverLabel'),
    coverConflict: tRepl('coverConflict'),
    trackingNo: tLeave('trackingNo'),
    errandBadge: tErrand('badge'),
    errandLocation: tErrand('location'),
    ...durationLabelsFrom(tLeave), // days/hours/minutes/and
    dayPartLabels: {
      full: tLeave('dayPart.full'),
      am: tLeave('dayPart.am'),
      pm: tLeave('dayPart.pm'),
    },
  };

  return (
    <>
      {loadError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
          <strong>{labels.errorLabel}:</strong> {loadError}
        </div>
      )}
      <ApprovalQueue
        requests={requests}
        labels={labels}
        locale={locale}
        hoursPerDay={hoursPerDay}
      />
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function ApprovalsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

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
