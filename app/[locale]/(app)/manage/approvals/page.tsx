/**
 * Approvals queue — manager (own reports) + admin (all). Read scope comes from
 * RLS + getPendingApprovals; the /manage layout already gates admin|manager.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPendingApprovals } from '@/lib/actions/leave';
import { ApprovalQueue } from './ApprovalQueue';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApprovalsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('approvals');
  const tLeave = await getTranslations('leave');

  const result = await getPendingApprovals();
  const requests = result.ok ? result.requests : [];
  const loadError = result.ok ? null : result.error;

  const labels = {
    empty: t('empty'),
    reason: t('reason'),
    approve: t('approve'),
    reject: t('reject'),
    approveConfirm: t('approveConfirm'),
    rejectConfirm: t('rejectConfirm'),
    errorLabel: t('error'),
    days: tLeave('days'),
    dayPartLabels: {
      full: tLeave('dayPart.full'),
      am: tLeave('dayPart.am'),
      pm: tLeave('dayPart.pm'),
    },
  };

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 mb-4">
          <strong>{labels.errorLabel}:</strong> {loadError}
        </div>
      )}

      <ApprovalQueue requests={requests} labels={labels} locale={locale} />
    </main>
  );
}
