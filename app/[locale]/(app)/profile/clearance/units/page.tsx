/**
 * Profile › Clearance forms › Default rows (FR-54 D3): the sign-off rows every new
 * form starts with. Admin and hr only; the HR row may only be renamed.
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClearanceSetup } from '@/lib/actions/clearance';
import { PageHeader } from '../../../_components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { UnitsEditor } from './UnitsEditor';

type Props = { params: Promise<{ locale: string }> };

export default async function ClearanceUnitsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('clearance');
  const setup = await getClearanceSetup();

  return (
    <main className="p-4 max-w-2xl mx-auto space-y-4">
      <PageHeader title={t('units.title')} />
      <Link href={`/${locale}/profile/clearance`} className="block text-sm text-primary hover:underline">
        {t('backToList')}
      </Link>
      <p className="text-sm text-muted-foreground">{t('units.intro')}</p>
      <Card>
        <CardContent className="pt-6">
          {setup.ok ? (
            <UnitsEditor
              locale={locale}
              initial={setup.units}
              people={setup.people}
              departments={setup.departments}
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
