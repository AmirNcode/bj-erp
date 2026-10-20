'use client';

import { useTranslations } from 'next-intl';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { signatureLabelsFrom } from '@/lib/leave/signatureLabels';

/** Copy shared by the daily leave form and My Requests on the Request page. */
export function useRequestLabels() {
  const t = useTranslations('request');
  const tLeave = useTranslations('leave');
  const tRepl = useTranslations('replacement');
  const tErrand = useTranslations('errand');
  const tSignature = useTranslations('signature');
  return {
    title: t('title'),
    leaveType: t('leaveType'),
    selectType: t('selectType'),
    dateRange: t('dateRange'),
    startDate: t('startDate'),
    endDate: t('endDate'),
    dayPart: t('dayPart'),
    dayPartFull: t('dayPartFull'),
    dayPartAm: t('dayPartAm'),
    dayPartPm: t('dayPartPm'),
    reason: t('reason'),
    submit: t('submit'),
    preview: t('preview'),
    workingDaysLabel: t('workingDaysLabel'),
    requestingLabel: t('requestingLabel'),
    remainingBalanceLabel: t('remainingBalanceLabel'),
    unpaidTimeOffLabel: t('unpaidTimeOffLabel'),
    noBalance: t('noBalance'),
    success: t('success'),
    errorLabel: t('error'),
    myRequests: t('myRequests'),
    noRequests: t('noRequests'),
    cancel: t('cancel'),
    cancelConfirm: t('cancelConfirm'),
    cancelApprovedConfirm: t('cancelApprovedConfirm'),
    cancelSuccess: t('cancelSuccess'),
    from: t('from'),
    to: t('to'),
    rejectedReason: t('rejectedReason'),
    validationSelectType: t('validationSelectType'),
    validationSelectDate: t('validationSelectDate'),
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
    statusRejected: tLeave('status.rejected'),
    statusCancelled: tLeave('status.cancelled'),
    dayPartLabels: {
      full: tLeave('dayPart.full'),
      am: tLeave('dayPart.am'),
      pm: tLeave('dayPart.pm'),
    },
    replacementTitle: tRepl('title'),
    replacementHint: tRepl('hint'),
    replacementSelect: tRepl('select'),
    replacementNoReplacement: tRepl('noReplacement'),
    replacementOnLeave: tRepl('onLeave'),
    replacementLoading: tRepl('loading'),
    replacementEmpty: tRepl('empty'),
    coverLabel: tRepl('coverLabel'),
    trackingNo: tLeave('trackingNo'),
    errandBadge: tErrand('badge'),
    errandLocation: tErrand('location'),
    requesterSignature: signatureLabelsFrom(tSignature, 'requesterTitle'),
    approverSignature: signatureLabelsFrom(tSignature, 'approverTitle'),
    signature: signatureLabelsFrom(tSignature),
    ...durationLabelsFrom(tLeave), // days/hours/minutes/and
  };
}
