/** ERP › Sales (FR-94 §16.7–16.9): the Customers tab. Guarded by the module layout. */

export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { getSalesMetrics, listSalesCustomers } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { parseCustomerFilters, persianYearStarts } from '@/lib/sales/customers';
import { loadSalesBootstrap } from '../_components/load';
import { CustomersList } from '../_components/CustomersList';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SalesCustomersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const filters = parseCustomerFilters(await searchParams, { kind: true });
  const { yearStart, prevYearStart } = persianYearStarts(todayInAppTz());
  const [boot, rows, metrics] = await Promise.all([
    loadSalesBootstrap(),
    listSalesCustomers(filters),
    getSalesMetrics(null, yearStart, prevYearStart, filters),
  ]);
  if (!rows.ok) return <p role="alert" className="text-sm text-destructive">{rows.error}</p>;
  return (
    <CustomersList
      rows={rows.data}
      prices={boot.caps.prices}
      metrics={metrics.ok ? metrics.data : null}
      filters={filters}
      people={boot.people}
    />
  );
}
