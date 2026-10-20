/**
 * FR-70 procurement (تدارکات): approved out-of-town trips HR marked «نیاز به رزرو سفر»,
 * grouped by what procurement must do next. travel_booking permission (the
 * Procurement preset; the admin implicitly). Own trips never appear.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { listTravelBookings } from '@/lib/actions/travel';
import { PageHeader } from '../_components/PageHeader';
import { ProcurementList } from './ProcurementList';

type Props = { params: Promise<{ locale: string }> };

export default async function ProcurementPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'travel_booking', 'edit')) redirect(`/${locale}/home`);

  const [t, result] = await Promise.all([getTranslations('travel'), listTravelBookings()]);
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
      <PageHeader title={t('procurementTitle')} />
      <p className="text-sm text-muted-foreground">{t('procurementHint')}</p>
      {result.ok ? (
        <ProcurementList rows={result.rows} locale={locale} />
      ) : (
        <p role="alert" className="text-sm text-destructive" data-testid="procurement-error">{result.error}</p>
      )}
    </div>
  );
}
