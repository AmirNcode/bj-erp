/**
 * Profile › Clearance forms › New (FR-54). Admin and hr file the form once the
 * leaver's written notice (or the dismissal decision) is in hand.
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClearanceSetup } from '@/lib/actions/clearance';
import { PageHeader } from '../../../_components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { NewClearanceForm } from './NewClearanceForm';

type Props = { params: Promise<{ locale: string }> };

export default async function NewClearancePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('clearance');
  const setup = await getClearanceSetup();

  return (
    <main className="p-4 max-w-2xl mx-auto space-y-4">
      <PageHeader title={t('new.title')} />
      <Link href={`/${locale}/profile/clearance`} className="block text-sm text-primary hover:underline">
        {t('backToList')}
      </Link>
      <p className="text-sm text-muted-foreground">{t('new.intro')}</p>
      <Card>
        <CardContent className="pt-6">
          {setup.ok ? (
            <NewClearanceForm
              locale={locale}
              people={setup.people.filter((p) => p.id !== setup.callerId)}
              allPeople={setup.people}
              units={setup.units}
              departmentManagers={setup.departmentManagers}
            />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {setup.error}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
