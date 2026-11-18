/** ERP › Sales (FR-94): reports, for `sales_reports` holders. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getSalesReport, listSalesDeadlines } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../_components/load';
import { ReportsView } from '../_components/ReportsView';

type Props = { params: Promise<{ locale: string }> };

export default async function SalesReportsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const boot = await loadSalesBootstrap();
  if (!boot.caps.reports) notFound();
  const [report, deadlines] = await Promise.all([getSalesReport(), listSalesDeadlines(true)]);
  if (!report.ok) return <p role="alert" className="text-sm text-destructive">{report.error}</p>;
  return <ReportsView boot={boot} report={report.data} deadlines={deadlines.ok ? deadlines.data : []} />;
}
