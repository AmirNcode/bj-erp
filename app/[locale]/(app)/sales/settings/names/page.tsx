/** ERP › Sales (FR-94 §16.8): match imported names to people and companies. `sales_settings` holders only. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { listSalesAliases, listSalesCustomers, listSalesPeopleToMatch } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../../_components/load';
import { NameMatching } from '../../_components/NameMatching';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ batch?: string | string[] }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SalesNamesPage({ params, searchParams }: Props) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const boot = await loadSalesBootstrap();
  if (!boot.caps.settings) notFound();
  const raw = Array.isArray(sp.batch) ? sp.batch[0] : sp.batch;
  const batch = raw && UUID.test(raw) ? raw.toLowerCase() : null;
  const [people, aliases, customers] = await Promise.all([listSalesPeopleToMatch(batch), listSalesAliases(), listSalesCustomers()]);
  if (!people.ok) return <p role="alert" className="text-sm text-destructive">{people.error}</p>;
  if (!aliases.ok) return <p role="alert" className="text-sm text-destructive">{aliases.error}</p>;
  if (!customers.ok) return <p role="alert" className="text-sm text-destructive">{customers.error}</p>;
  return <NameMatching boot={boot} batch={batch} people={people.data} aliases={aliases.data} customers={customers.data} />;
}
