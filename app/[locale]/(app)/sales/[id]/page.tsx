/** ERP › Sales (FR-94): one record. Guarded by the module layout; an unknown id is a 404. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getSalesRecord } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../_components/load';
import { RecordView } from '../_components/RecordView';

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function SalesRecordPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [boot, detail] = await Promise.all([loadSalesBootstrap(), getSalesRecord(id)]);
  if (!detail.ok) notFound();
  return <RecordView key={detail.data.record.id} boot={boot} detail={detail.data} />;
}
