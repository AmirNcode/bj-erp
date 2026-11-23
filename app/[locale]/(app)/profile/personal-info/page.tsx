/**
 * Profile › Personal information (FR-53): the caller's own identity, bank,
 * contact and employment details. Read-only since FR-63 (2026-10-12) unless the
 * caller holds personal_info_own (the admin implicitly; on no preset); people
 * with personal_info edit change other people's from Manage › Employees › Edit.
 * Since FR-96 it is the second Profile tab (profile/layout.tsx); the mobile here
 * is the same number the Profile tab sets.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { canEditOwnPersonalInfo } from '@/lib/employees/editCapabilities';
import { getPersonalInfo } from '@/lib/actions/personal-info';
import { PersonalInfoForm } from '@/components/personal-info/PersonalInfoForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PersonalInfoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('personalInfo');
  const user = await getCachedUser();
  if (!user) return null;

  const [res, perms] = await Promise.all([getPersonalInfo(user.id), getCachedPermissions(user.id)]);
  const readOnly = !canEditOwnPersonalInfo(perms);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {res.ok ? (
        <PersonalInfoForm
          employeeId={user.id}
          initial={res.info}
          readOnly={readOnly}
          readOnlyReason="self"
        />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {res.error}
        </p>
      )}
    </div>
  );
}
