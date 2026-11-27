/** ERP › Sales (FR-94 §16.7): one customer — figures, years, records. Guarded by the module layout. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getCustomerHistory, getSalesCustomer, getSalesMetrics, listSalesRecordsPage } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { parseCustomerFilters, persianYearStarts } from '@/lib/sales/customers';
import { RECORD_SORTS } from '@/lib/sales/recordSort';
import type { RecordSort } from '@/lib/sales/types';
import { loadSalesBootstrap } from '../../_components/load';
import { CustomerView } from '../../_components/CustomerView';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SalesCustomerPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const filters = parseCustomerFilters(sp, { kind: false });
  const sort = one(sp.sort) as RecordSort;
  const { yearStart, prevYearStart } = persianYearStarts(todayInAppTz());
  const tab = one(sp.tab) === 'history' ? 'history' as const : 'profile' as const;
  const [boot, detail, page, metrics, history] = await Promise.all([
    loadSalesBootstrap(),
    getSalesCustomer(id),
    listSalesRecordsPage({
      state: 'all', buyer: id, from: filters.from, to: filters.to, result: filters.result, owner: filters.owner,
      ...(RECORD_SORTS.includes(sort) ? { sort, dir: one(sp.dir) === 'desc' ? 'desc' as const : 'asc' as const } : {}),
    }),
    getSalesMetrics(id, yearStart, prevYearStart, filters),
    tab === 'history' ? getCustomerHistory(id) : Promise.resolve(null),
  ]);
  if (!detail.ok) notFound();
  if (!page.ok) return <p role="alert" className="text-sm text-destructive">{page.error}</p>;
  return <CustomerView boot={boot} detail={detail.data} page={page.data} metrics={metrics.ok ? metrics.data : null} filters={filters} tab={tab} history={history?.ok ? history.data : null} />;
}
