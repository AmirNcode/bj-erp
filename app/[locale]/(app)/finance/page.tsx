/**
 * Requests for finance (FR-62) — finance read (FR-55: the finance and hr
 * presets; the admin implicitly).
 *
 * Every approved and pending work errand (hourly or daily; finance sees no
 * leave) overlapping a Jalali month range, in two sections with their own
 * totals, with the per diem HR entered and FR-70 travel costs, and a CSV
 * export of both. The range is a URL
 * parameter like the reports screen's, defaulting to the current month and the
 * next one (upcoming trips show at once).
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getFinanceApprovals } from '@/lib/actions/finance';
import { getReportMonths } from '@/lib/actions/reports';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { todayInAppTz } from '@/lib/appDate';
import { validFinanceRange } from '@/lib/finance/list';
import { defaultFinanceRange } from '@/lib/finance/range';
import { PageHeader } from '../_components/PageHeader';
import { FinanceList } from './FinanceList';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function FinancePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'finance', 'read')) redirect(`/${locale}/home`);

  const [t, months, settings] = await Promise.all([
    getTranslations('finance'),
    getReportMonths({ nextYear: true }),
    getWorkSettings(),
  ]);
  const today = todayInAppTz();
  const range = defaultFinanceRange(months, today);
  const { from: rawFrom, to: rawTo } = await searchParams;
  const from = rawFrom ?? range.from;
  const to = rawTo ?? range.to;

  const result = validFinanceRange(from,to) ? await getFinanceApprovals(from, to) : { ok: false as const, error: t('invalidRange') };
  const hoursPerDay = settings.ok ? settings.settings.hoursPerDay : WORK_SETTINGS_FALLBACK.hoursPerDay;

  return (
    <div data-wide className="flex w-full flex-col">
      <PageHeader section title={t('title')} />
      {result.ok ? (
        <FinanceList
          key={`${from}:${to}`}
          rows={result.rows}
          from={from}
          to={to}
          locale={locale}
          hoursPerDay={hoursPerDay}
        />
      ) : (
        <p role="alert" className="text-sm text-destructive" data-testid="finance-error">
          {result.error}
        </p>
      )}
    </div>
  );
}
