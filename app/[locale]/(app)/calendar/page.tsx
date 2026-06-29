/**
 * Calendar page (FR-22) — viewer-scoped time-off for the current month.
 * Data comes from the reason-less team_leave_calendar view via getCalendarEntries,
 * which scopes rows by the viewer (employee = own + team; manager/security/admin =
 * everyone). No `reason` is ever fetched or shown here.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCalendarEntries } from '@/lib/actions/leave';
import { CalendarView } from './CalendarView';
import { PageHeader } from '../_components/PageHeader';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function CalendarPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('calendar');
  const tLeave = await getTranslations('leave');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('calendar_pref')
    .eq('id', user.id)
    .single();
  const calendarPref = profile?.calendar_pref ?? 'jalali';

  // Current Gregorian month range (UTC-safe).
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const rangeStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const rangeEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

  const result = await getCalendarEntries(rangeStart, rangeEnd);
  const entries = result.ok ? result.entries : [];
  const loadError = result.ok ? null : result.error;

  const labels = {
    empty: t('empty'),
    statusPending: tLeave('status.pending'),
    statusApproved: tLeave('status.approved'),
  };

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <PageHeader title={t('title')} />

      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 mb-4">
          <strong>{t('error')}:</strong> {loadError}
        </div>
      )}

      <CalendarView entries={entries} locale={locale} calendarPref={calendarPref} labels={labels} />
    </main>
  );
}
