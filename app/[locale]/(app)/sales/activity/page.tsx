/** ERP › Sales (FR-99): the Activity page — who changed what, newest first. Needs `sales_activity`. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { listSalesActivity } from '@/lib/actions/sales';
import type { ActivityFilters } from '@/lib/sales/types';
import { loadSalesBootstrap } from '../_components/load';
import { ActivityView } from '../_components/ActivityView';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ENTITIES = ['record', 'customer', 'product', 'settings', 'import'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SalesActivityPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const boot = await loadSalesBootstrap();
  if (!boot.caps.activity) notFound();
  const sp = await searchParams;
  const actor = one(sp.actor);
  const from = one(sp.from);
  const to = one(sp.to);
  const entity = one(sp.entity);
  const filters: ActivityFilters = {
    ...(actor && UUID.test(actor) ? { actor } : {}),
    ...(from && DAY.test(from) ? { from } : {}),
    ...(to && DAY.test(to) ? { to } : {}),
    ...(entity && (ENTITIES as readonly string[]).includes(entity) ? { entity: entity as ActivityFilters['entity'] } : {}),
  };
  const page = await listSalesActivity(filters);
  if (!page.ok) return <p role="alert" className="text-sm text-destructive">{page.error}</p>;
  return (
    <ActivityView
      // A new filter set remounts the view, so the appended pages restart from the first one.
      key={JSON.stringify(filters)}
      filters={filters}
      people={boot.people.map((p) => ({ id: p.id, name: p.name }))}
      initial={page.data}
    />
  );
}
