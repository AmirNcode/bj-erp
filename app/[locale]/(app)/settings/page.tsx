/**
 * Settings (FR-24): weekly days off with working hours, and official holidays.
 * Company configuration — the admin, or a caller with work_settings / holidays
 * permission (FR-55; main's FR-59 hr access is the HR preset holding both at
 * edit). Everyone else is sent home. Each card is read-only without its item's
 * edit level. Writes go through lib/actions/settings under the `_editor` RLS
 * policies on work_settings / holidays. The form never offers hours per day
 * (admin-only, main's trigger) or the approval-order switch (approval_steps
 * edit, on Manage › Approval steps). Departments, approval steps and accrual
 * live under Manage. The admin also sees the General | Roles tabs (FR-55).
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { can } from '@/lib/permissions/catalog';
import { settingsItemForRoles } from '@/lib/nav/tabs';
import { getCompanyHolidays } from '@/lib/actions/settings';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { WorkSettingsForm } from './WorkSettingsForm';
import { HolidayEditor } from './HolidayEditor';
import { SettingsTabs } from './_components/SettingsTabs';

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
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

  const tNav = await getTranslations('nav');
  const data = await getCompanyHolidays();
  const { weekendDays, biweeklyWeekendDays, biweeklyAnchor, workStart, workEnd, maxHourlyMinutesPerDay: hourlyCapMinutes } =
    data.ok ? data : WORK_SETTINGS_FALLBACK;
  const holidays = data.ok ? data.holidays : [];
  const updatedAt = data.ok ? data.updatedAt : null;

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      {/* FR-55: General | Roles, for the admin only (the role editor is admin-only, D2). */}
      {(capabilities.isAdmin || capabilities.canDelegate) && <SettingsTabs locale={locale} active="general" />}
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
        readOnly={!canEditWork}
      />

      <HolidayEditor initial={holidays} readOnly={!canEditHolidays} locale={locale} />
    </div>
  );
}
