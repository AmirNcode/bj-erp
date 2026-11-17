/** ERP › Sales (FR-94): reports, for `sales_reports` holders. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { listSalesDeadlines, listSalesRecords } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../_components/load';
import { ReportsView } from '../_components/ReportsView';

type Props = { params: Promise<{ locale: string }> };

export default async function SalesReportsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const boot = await loadSalesBootstrap();
  if (!boot.caps.reports) notFound();
  const [rows, deadlines] = await Promise.all([listSalesRecords(), listSalesDeadlines(true)]);
  if (!rows.ok) return <p role="alert" className="text-sm text-destructive">{rows.error}</p>;
  return <ReportsView boot={boot} rows={rows.data} deadlines={deadlines.ok ? deadlines.data : []} />;
}
