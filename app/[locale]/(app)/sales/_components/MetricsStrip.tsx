'use client';

/** FR-94 §16.8: the figure strip of the Customers tab (all) or one customer page. Money keys only with sales_prices. */

import { useTranslations } from 'next-intl';
import type { SalesMetrics } from '@/lib/sales/types';
import { useSalesFormat } from './parts';

export function MetricsStrip({ metrics }: { metrics: SalesMetrics }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const dash = <span className="text-muted-foreground">—</span>;

  const figure = (key: string, label: string, value: React.ReactNode) => (
    <div key={key} className="border-s-[3px] border-primary ps-3" data-testid={`sales-metric-${key}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
  const money = (key: string, label: string, sums: Record<string, number> | undefined) => {
    if (sums === undefined) return null;
    const entries = Object.entries(sums);
    return figure(key, label, entries.length === 0 ? dash : (
      <span className="flex flex-col">
        {entries.map(([cur, amount]) => <span key={cur} className="whitespace-nowrap">{f.money(amount, cur)}</span>)}
      </span>
    ));
  };

  const figures = [
    money('salesAll', t('metrics.salesAll'), metrics.sales_all),
    money('salesYtd', t('metrics.salesYtd'), metrics.sales_ytd),
    money('salesPrevYear', t('metrics.salesPrevYear'), metrics.sales_prev_year),
    metrics.share === undefined ? null : figure('share', t('metrics.share'), Object.keys(metrics.share).length === 0 ? dash : (
      <span className="flex flex-col">
        {Object.entries(metrics.share).map(([cur, v]) => <span key={cur} className="whitespace-nowrap">{f.percent(v)} {cur}</span>)}
      </span>
    )),
    metrics.last_sale_on === undefined ? null : figure('lastSale', t('metrics.lastSale'), f.date(metrics.last_sale_on)),
    figure('projects', t('metrics.projects'), f.number(metrics.projects)),
    figure('active', t('metrics.active'), f.number(metrics.active)),
    figure('winRate', t('metrics.winRate'), metrics.win_rate === null ? dash : (
      <>{f.percent(metrics.win_rate)} <span className="block text-xs font-normal text-muted-foreground">{t('metrics.basis', { n: f.number(metrics.decided) })}</span></>
    )),
    money('pipeline', t('metrics.pipeline'), metrics.pipeline),
    metrics.customers === undefined ? null : figure('customers', t('metrics.customers'), f.number(metrics.customers)),
    metrics.new_customers === undefined ? null : figure('newCustomers', t('metrics.newCustomers'), f.number(metrics.new_customers)),
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="sales-metrics">{figures}</dl>
  );
}
