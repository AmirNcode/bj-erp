/**
 * Organization (FR-44): the org chart, for every signed-in user. Desktop
 * reaches it from the sidebar; mobile from the Profile screen (the bottom bar
 * stays at 4/5 tabs, owner decision 2026-10-05).
 */
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { getOrgChart } from '@/lib/actions/org';
import { PageHeader } from '../_components/PageHeader';
import { OrgChart } from './OrgChart';

type Props = { params: Promise<{ locale: string }> };

export default async function OrganizationPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);

  const [tNav, t] = await Promise.all([getTranslations('nav'), getTranslations('org')]);
  const chart = await getOrgChart();

  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <PageHeader title={tNav('organization')} />
      {chart.ok ? (
        // useSearchParams in the client chart needs a Suspense boundary.
        <Suspense fallback={null}>
          <OrgChart
            people={chart.people}
            myId={chart.myId}
            locale={locale}
            labels={{
              searchPlaceholder: t('searchPlaceholder'),
              noResults: t('noResults'),
              top: t('top'),
              topTitle: t('topTitle'),
              you: t('you'),
              departmentManager: t('departmentManager'),
              reportsTo: t('reportsTo'),
              directReports: t.raw('directReports') as string,
              noReports: t('noReports'),
              people: t.raw('people') as string,
              backToMe: t('backToMe'),
              empty: t('empty'),
            }}
          />
        </Suspense>
      ) : (
        <p role="alert" className="text-sm text-destructive" data-testid="org-error">
          {t('error')}: {chart.error}
        </p>
      )}
    </main>
  );
}
