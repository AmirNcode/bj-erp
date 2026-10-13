/**
 * Profile › Personal information (FR-53): the caller's own identity, bank,
 * contact and employment details. Read-only since FR-63 (2026-10-12) unless the
 * caller may edit their own (admin today); hr/admin edit other people's from
 * Manage › Employees › Edit.
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { canEditOwnPersonalInfo } from '@/lib/employees/editCapabilities';
import { getPersonalInfo } from '@/lib/actions/personal-info';
import { PageHeader } from '../../_components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
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

  const [res, roles] = await Promise.all([getPersonalInfo(user.id), getCachedRoles(user.id)]);
  const readOnly = !canEditOwnPersonalInfo(roles);

  return (
    <main className="p-4 max-w-2xl mx-auto space-y-4">
      <PageHeader title={t('title')} />
      <Link href={`/${locale}/profile`} className="block text-sm text-primary hover:underline" data-testid="personal-info-back">
        {t('back')}
      </Link>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <Card>
        <CardContent className="pt-6">
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
        </CardContent>
      </Card>
    </main>
  );
}
