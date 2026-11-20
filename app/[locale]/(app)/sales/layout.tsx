/**
 * ERP › Sales (FR-94) — server guard and module shell.
 *
 * The whole module is hidden: without the `sales` permission this answers 404
 * (not a redirect that would confirm the module exists), and the module's
 * strings are sent to the browser only from here (the root layout leaves the
 * `sales` namespace out of everyone's page).
 */

export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';
import { PageHeader } from '../_components/PageHeader';
import { loadSalesBootstrap } from './_components/load';
import { SalesCurrenciesProvider } from './_components/parts';
import { SalesTabs } from './_components/SalesTabs';
import { NodeSearch } from './_components/NodeSearch';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export default async function SalesLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const boot = await loadSalesBootstrap();
  if (!boot) notFound();
  const [messages, t] = await Promise.all([getMessages(), getTranslations('sales')]);

  return (
    <NextIntlClientProvider messages={messages}>
      <div data-wide className="flex w-full flex-col gap-4">
        <PageHeader section title={t('title')} action={<NodeSearch />} />
        <SalesTabs reports={boot.caps.reports} settings={boot.caps.settings} />
        <SalesCurrenciesProvider currencies={boot.currencies}>{children}</SalesCurrenciesProvider>
      </div>
    </NextIntlClientProvider>
  );
}
