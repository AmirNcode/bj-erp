/**
 * HR reports (FR-37) — `hr` and `admin` only.
 *
 * The period is a URL parameter rather than client state, so a report can be
 * linked, bookmarked and reloaded, and so changing it re-queries the server
 * instead of filtering a snapshot in the browser.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getReportData, getReportMonths } from '@/lib/actions/reports';
import { todayInAppTz } from '@/lib/appDate';
import { PageHeader } from '../../_components/PageHeader';
import { ListSkeleton } from '@/components/Skeletons';
import { ReportsDashboard } from './ReportsDashboard';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function ReportsData({
  locale,
  from,
  to,
}: {
  locale: string;
  from?: string;
  to?: string;
}) {
  const t = await getTranslations('reports');
  const tLeave = await getTranslations('leave');
  const tReview = await getTranslations('review');
  const tSteps = await getTranslations('approvals.steps');

  const months = await getReportMonths();

  // Default to the CURRENT Jalali year, Farvardin through the month we are in —
  // the range HR asks for most, and the one that makes the annual cap and the
  // carryover boundary legible.
  //
  // Anchor on the month containing today and take its year. An earlier version
  // searched for "month 1 whose end is on or after today", which never matches
  // (Farvardin always ends months before a mid-year today) and silently fell
  // back to the FIRST month on offer — the previous Jalali year.
  const today = todayInAppTz();
  const currentMonth = months.find((m) => m.gregorianStart <= today && m.gregorianEnd >= today);
  const defaultFrom =
    months.find((m) => m.jalaliYear === currentMonth?.jalaliYear && m.jalaliMonth === 1)
      ?.gregorianStart ??
    months[0]?.gregorianStart ??
    today;
  const defaultTo = currentMonth?.gregorianEnd ?? today;

  // Only accept a well-formed date from the URL; anything else falls back rather
  // than reaching the query.
  const rangeStart = from && ISO.test(from) ? from : defaultFrom;
  const rangeEnd = to && ISO.test(to) ? to : defaultTo;

  const result = await getReportData(rangeStart, rangeEnd);
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="reports-error">
        {result.error}
      </p>
    );
  }

  return (
    <ReportsDashboard
      data={result.data}
      months={months}
      locale={locale}
      labels={{
        from: t('from'),
        to: t('to'),
        apply: t('apply'),
        download: t('download'),
        empty: t('empty'),
        months: {
          m1: t('months.m1'), m2: t('months.m2'), m3: t('months.m3'), m4: t('months.m4'),
          m5: t('months.m5'), m6: t('months.m6'), m7: t('months.m7'), m8: t('months.m8'),
          m9: t('months.m9'), m10: t('months.m10'), m11: t('months.m11'), m12: t('months.m12'),
        },
        balances: {
          title: t('balances.title'),
          name: t('balances.name'),
          code: t('balances.code'),
          department: t('balances.department'),
          manager: t('balances.manager'),
        },
        requests: {
          title: t('requests.title'),
          kind: t('requests.kind'),
          status: t('requests.status'),
          count: t('requests.count'),
          days: t('requests.days'),
          unpaidDays: t('requests.unpaidDays'),
        },
        absence: {
          title: t('absence.title'),
          department: t('absence.department'),
          people: t('absence.people'),
          requests: t('absence.requests'),
          days: t('absence.days'),
        },
        ageing: {
          title: t('ageing.title'),
          name: t('ageing.name'),
          department: t('ageing.department'),
          submitted: t('ageing.submitted'),
          waitingDays: t('ageing.waitingDays'),
          days: t('ageing.days'),
          waitingOn: t('ageing.waitingOn'),
        },
        headcount: {
          title: t('headcount.title'),
          department: t('headcount.department'),
          headcount: t('headcount.headcount'),
          joiners: t('headcount.joiners'),
        },
        kindLeave: tReview('kindLeave'),
        kindErrand: tReview('kindErrand'),
        statuses: {
          pending: tLeave('status.pending'),
          approved: tLeave('status.approved'),
          rejected: tLeave('status.rejected'),
          cancelled: tLeave('status.cancelled'),
        },
        stepLabels: {
          manager: tSteps('manager'),
          hr: tSteps('hr'),
          security: tSteps('security'),
          admin: tSteps('admin'),
        },
      }}
    />
  );
}

export default async function ReportsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  // Narrower than the /manage layout, which also admits managers.
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('hr') && !roles.includes('admin')) {
    redirect(`/${locale}/home`);
  }

  const { from, to } = await searchParams;
  const t = await getTranslations('reports');

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title={t('title')} />
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <Suspense fallback={<ListSkeleton count={4} />}>
        <ReportsData locale={locale} from={from} to={to} />
      </Suspense>
    </main>
  );
}
