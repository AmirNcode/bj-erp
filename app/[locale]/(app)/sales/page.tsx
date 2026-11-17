/** ERP › Sales (FR-94): the records list. Guarded by the module layout. */

export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { listSalesRecords } from '@/lib/actions/sales';
import { loadSalesBootstrap } from './_components/load';
import { RecordsList } from './_components/RecordsList';

type Props = { params: Promise<{ locale: string }> };

export default async function SalesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [boot, list] = await Promise.all([loadSalesBootstrap(), listSalesRecords()]);
  if (!list.ok) return <p role="alert" className="text-sm text-destructive">{list.error}</p>;
  return <RecordsList boot={boot} rows={list.data} />;
}
