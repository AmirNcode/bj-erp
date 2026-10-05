/**
 * Settings (FR-24): weekly days off with working hours, and official holidays.
 * Company configuration — admin only; everyone else is sent home. Writes go
 * through lib/actions/settings under the admin-only RLS policies on
 * work_settings / holidays. Departments, approval steps and accrual live under
 * Manage.
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { getCompanyHolidays } from '@/lib/actions/settings';
import { WorkSettingsForm } from './WorkSettingsForm';
import { HolidayEditor } from './HolidayEditor';

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}/home`);

  const [tNav, t, tImport] = await Promise.all([
    getTranslations('nav'),
    getTranslations('manage.settings'),
    getTranslations('manage.settings.holidayImport'),
  ]);
  const data = await getCompanyHolidays();
  const weekendDays = data.ok ? data.weekendDays : [5];
  const biweeklyWeekendDays = data.ok ? data.biweeklyWeekendDays : [];
  const biweeklyAnchor = data.ok ? data.biweeklyAnchor : null;
  const workStart = data.ok ? data.workStart : '07:00';
  const workEnd = data.ok ? data.workEnd : '15:00';
  const hourlyCapMinutes = data.ok ? data.maxHourlyMinutesPerDay : 240;
  const holidays = data.ok ? data.holidays : [];
  const updatedAt = data.ok ? data.updatedAt : null;

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
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight">{tNav('settings')}</h1>

      <WorkSettingsForm
        initial={weekendDays}
        initialBiweekly={biweeklyWeekendDays}
        initialAnchor={biweeklyAnchor}
        initialUpdatedAt={updatedAt}
        locale={locale}
        initialWorkStart={workStart}
        initialWorkEnd={workEnd}
        initialHourlyCapMinutes={hourlyCapMinutes}
        labels={{
          weekendTitle: t('weekendTitle'),
          weekendHint: t('weekendHint'),
          hoursTitle: t('hoursTitle'),
          hoursHint: t('hoursHint'),
          workStart: t('workStart'),
          workEnd: t('workEnd'),
          hourlyCap: t('hourlyCap'),
          save: t('save'),
          // .raw(): the form substitutes {date} itself after each save.
          lastSaved: t.raw('lastSaved'),
          saved: t('saved'),
          errorLabel: t('error'),
          days,
          frequencyWorking: t('frequencyWorking'),
          frequencyWeekly: t('frequencyWeekly'),
          frequencyBiweekly: t('frequencyBiweekly'),
          anchorLabel: t('anchorLabel'),
          anchorHint: t('anchorHint'),
        }}
      />

      <HolidayEditor
        initial={holidays}
        locale={locale}
        labels={{
          holidaysTitle: t('holidaysTitle'),
          // .raw(): the editor substitutes {count} as rows come and go.
          holidaysCount: t.raw('holidaysCount'),
          addHoliday: t('addHoliday'),
          dateLabel: t('dateLabel'),
          nameFaLabel: t('nameFaLabel'),
          nameEnLabel: t('nameEnLabel'),
          recurringLabel: t('recurringLabel'),
          recurringHint: t('recurringHint'),
          delete: t('delete'),
          noHolidays: t('noHolidays'),
          errorLabel: t('error'),
          // FR-40 bulk upload. Built as one object so a new label is added
          // in one place rather than threaded through two components.
          holidayImport: {
            button: tImport('button'),
            title: tImport('title'),
            intro: tImport('intro'),
            template: tImport('template'),
            templateHint: tImport('templateHint'),
            upload: tImport('upload'),
            recurringWarning: tImport('recurringWarning'),
            previewTitle: tImport('previewTitle'),
            // .raw() on purpose for the three strings carrying {count} /
            // {added} / {updated}: the dialog substitutes them itself once a
            // file has been parsed. Calling tImport('willAdd') with no value
            // only "works" via a production-only fast path in use-intl that
            // skips compilation — under `next dev` it renders the dotted key
            // path instead of a sentence. Same trap, same fix, as the
            // password-regen dialog in manage/employees/page.tsx.
            willAdd: tImport.raw('willAdd'),
            willUpdate: tImport.raw('willUpdate'),
            problemsTitle: tImport('problemsTitle'),
            line: tImport('line'),
            problem: tImport('problem'),
            confirm: tImport('confirm'),
            importing: tImport('importing'),
            done: tImport.raw('done'),
            cancel: tImport('cancel'),
            columnDate: tImport('columnDate'),
            columnNameFa: tImport('columnNameFa'),
            columnNameEn: tImport('columnNameEn'),
            columnRecurring: tImport('columnRecurring'),
            yes: tImport('yes'),
            no: tImport('no'),
            // Explicit map rather than tImport(`errors.${key}`): a dynamic
            // message key has already caused a production-only failure in
            // this codebase (docs/MEMORY.md).
            errors: {
              missingColumn: tImport('errors.missingColumn'),
              required: tImport('errors.required'),
              badDate: tImport('errors.badDate'),
              badRecurring: tImport('errors.badRecurring'),
              nameTooLong: tImport('errors.nameTooLong'),
              dupInFile: tImport('errors.dupInFile'),
              noRows: tImport('errors.noRows'),
            },
          },
        }}
      />
    </div>
  );
}
