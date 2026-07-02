/**
 * Admin work-settings + holiday editor (FR-24). Admin-only (managers are bounced
 * to /home). Writes go through lib/actions/settings via the existing admin RLS
 * policies on work_settings / holidays.
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedProfile } from '@/lib/auth/context';
import { getCompanyHolidays } from '@/lib/actions/settings';
import { PageHeader } from '../../_components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { WorkSettingsForm } from './WorkSettingsForm';
import { HolidayEditor } from './HolidayEditor';

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  const [roles, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedProfile(user.id),
  ]);
  const isAdmin = roles.includes('admin');
  if (!isAdmin) redirect(`/${locale}/home`);

  const t = await getTranslations('manage.settings');
  const data = await getCompanyHolidays();
  const weekendDays = data.ok ? data.weekendDays : [5];
  const holidays = data.ok ? data.holidays : [];

  const days = {
    sat: t('days.sat'),
    sun: t('days.sun'),
    mon: t('days.mon'),
    tue: t('days.tue'),
    wed: t('days.wed'),
    thu: t('days.thu'),
    fri: t('days.fri'),
  };

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader title={t('title')} />

      <Card>
        <CardContent>
          <WorkSettingsForm
            initial={weekendDays}
            labels={{
              weekendTitle: t('weekendTitle'),
              weekendHint: t('weekendHint'),
              save: t('save'),
              saved: t('saved'),
              errorLabel: t('error'),
              days,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <HolidayEditor
            initial={holidays}
            calendarPref={profile?.calendar_pref ?? 'jalali'}
            labels={{
              holidaysTitle: t('holidaysTitle'),
              addHoliday: t('addHoliday'),
              dateLabel: t('dateLabel'),
              nameFaLabel: t('nameFaLabel'),
              nameEnLabel: t('nameEnLabel'),
              recurringLabel: t('recurringLabel'),
              delete: t('delete'),
              noHolidays: t('noHolidays'),
              errorLabel: t('error'),
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
