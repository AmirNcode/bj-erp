export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { can } from '@/lib/permissions/catalog';
import { settingsItemForRoles } from '@/lib/nav/tabs';
import { getCompanyHolidays } from '@/lib/actions/settings';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { WorkSettingsForm } from './WorkSettingsForm';
import { HolidayEditor } from './HolidayEditor';
import { SettingsTabs } from './_components/SettingsTabs';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> };

export default async function SettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const [roles, perms] = await Promise.all([getCachedRoles(user.id), getCachedPermissions(user.id)]);
  const capabilities = await getApprovalCapabilities();
  const settingsItem = settingsItemForRoles(roles, perms, capabilities.canDelegate);
  if (!settingsItem) redirect(`/${locale}/home`);
  if (settingsItem.href !== '/settings') redirect(`/${locale}${settingsItem.href}`);
  const canEditWork = can(perms, 'work_settings');
  const canEditHolidays = can(perms, 'holidays');

  const canReadWork = capabilities.isAdmin || can(perms, 'work_settings', 'read');
  const canReadHolidays = capabilities.isAdmin || can(perms, 'holidays', 'read');
  const { tab } = await searchParams;
  const showHolidays = canReadHolidays && (tab === 'holidays' || !canReadWork);
  const data = await getCompanyHolidays();
  const { weekendDays, biweeklyWeekendDays, biweeklyAnchor, workStart, workEnd, maxHourlyMinutesPerDay: hourlyCapMinutes, lunchStart, lunchMinutes } =
    data.ok ? data : WORK_SETTINGS_FALLBACK;
  const holidays = data.ok ? data.holidays : [];
  const updatedAt = data.ok ? data.updatedAt : null;

  return (
    <div data-wide className="flex w-full flex-col gap-5">
      <SettingsTabs locale={locale} active={showHolidays ? 'holidays' : 'workingTimes'} />
      {showHolidays ? (
        <HolidayEditor initial={holidays} readOnly={!canEditHolidays} locale={locale} />
      ) : (
        <WorkSettingsForm
          initial={weekendDays}
          initialBiweekly={biweeklyWeekendDays}
          initialAnchor={biweeklyAnchor}
          initialUpdatedAt={updatedAt}
          locale={locale}
          initialWorkStart={workStart}
          initialWorkEnd={workEnd}
          initialHourlyCapMinutes={hourlyCapMinutes}
          initialLunchStart={lunchStart}
          initialLunchMinutes={lunchMinutes}
          readOnly={!canEditWork}
        />
      )}
    </div>
  );
}
