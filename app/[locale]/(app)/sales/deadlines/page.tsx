/** ERP › Sales (FR-94): open deadlines across all records. Guarded by the module layout. */

export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { listSalesDeadlines } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../_components/load';
import { DeadlinesList } from '../_components/DeadlinesList';

type Props = { params: Promise<{ locale: string }> };

export default async function SalesDeadlinesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [boot, rows] = await Promise.all([loadSalesBootstrap(), listSalesDeadlines(false)]);
  if (!rows.ok) return <p role="alert" className="text-sm text-destructive">{rows.error}</p>;
  return <DeadlinesList boot={boot} rows={rows.data} />;
}
