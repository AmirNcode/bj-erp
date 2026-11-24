/** ERP › Sales (FR-94): the records list. Guarded by the module layout. */

export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { listSalesRecordsPage } from '@/lib/actions/sales';
import type { RecordFilters, RecordSort } from '@/lib/sales/types';
import { RECORD_SORTS as SORTS } from '@/lib/sales/recordSort';
import { loadSalesBootstrap } from '../_components/load';
import { RecordsList } from '../_components/RecordsList';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function SalesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const state = one(sp.state);
  const flow = one(sp.flow);
  const filters: RecordFilters = {
    state: state === 'closed' || state === 'all' || state === 'deleted' ? state : 'open',
    flow: flow === 'bid' || flow === 'contract' ? flow : '',
    stage: one(sp.stage),
    owner: one(sp.owner),
    q: one(sp.q).slice(0, 200),
    ...(SORTS.includes(one(sp.sort) as RecordSort) ? { sort: one(sp.sort) as RecordSort, dir: one(sp.dir) === 'desc' ? 'desc' as const : 'asc' as const } : {}),
  };
  const [boot, page] = await Promise.all([loadSalesBootstrap(), listSalesRecordsPage(filters)]);
  if (!page.ok) return <p role="alert" className="text-sm text-destructive">{page.error}</p>;
  return (
    // data-wide: the records table is one of the few pages that runs edge to edge; `contents` keeps the layout's flex gap.
    <div data-wide className="contents">
      <RecordsList boot={boot} page={page.data} filters={filters} />
    </div>
  );
}
