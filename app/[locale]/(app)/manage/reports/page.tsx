/**
 * HR reports (FR-37) — needs the reports permission (FR-55).
 *
 * The period is a URL parameter rather than client state, so a report can be
 * linked, bookmarked and reloaded, and so changing it re-queries the server
 * instead of filtering a snapshot in the browser.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions, getCachedRoles } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getReportData, getReportMonths } from '@/lib/actions/reports';
import { getTodayPulse } from '@/lib/actions/home';
import { createClient } from '@/lib/supabase/server';
import { todayInAppTz } from '@/lib/appDate';
import { localizedLeaveTypeName } from '@/lib/i18n/format';
import { buildCapacity } from '@/lib/reports/reports';
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
  companyWidePulse,
}: {
  locale: string;
  from?: string;
  to?: string;
  /** Admin or hr: getTodayPulse is company-wide only for them (FR-55 M10). */
  companyWidePulse: boolean;
}) {
  const t = await getTranslations('reports');

  const supabase = await createClient();
  const [months, pulseRes, { data: departments }] = await Promise.all([
    getReportMonths(),
    // hr/admin: company-wide, which is what this screen is for. For anyone else the
    // pulse is team-scoped, which would mislabel a company report: no card at all.
    companyWidePulse ? getTodayPulse() : null,
    supabase.from('departments').select('id, name_fa, name_en'),
  ]);

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

  const deptNames = new Map(
    (departments ?? []).map((d) => [d.id, localizedLeaveTypeName(d, locale)])
  );
  const capacity = !pulseRes
    ? null
    : pulseRes.ok
      ? buildCapacity({
          headcountByDepartment: pulseRes.pulse.headcountByDepartment,
          absentByDepartment: pulseRes.pulse.absentByDepartment,
          departmentName: (id) => deptNames.get(id) ?? t('noDepartment'),
        })
      : [];
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
      capacity={capacity}
      locale={locale}
    />
  );
}

export default async function ReportsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  // Narrower than the /manage layout, which also admits managers.
  const [perms, roles] = await Promise.all([getCachedPermissions(user.id), getCachedRoles(user.id)]);
  if (!can(perms, 'reports', 'read')) {
    redirect(`/${locale}/home`);
  }

  const { from, to } = await searchParams;

  return (
    <Suspense fallback={<ListSkeleton count={4} />}>
      <ReportsData
        locale={locale}
        from={from}
        to={to}
        companyWidePulse={roles.includes('admin') || roles.includes('hr')}
      />
    </Suspense>
  );
}
