'use client';

/**
 * FR-94: the reports management used to ask for as PDF / Excel — where the
 * records stand, bid results, what was quoted before, and how deadlines are met.
 * Every table downloads as CSV.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { labelOf } from '@/lib/sales/customerLabel';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { getPriceHistory } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { downloadCsv, fileDateStamp } from '@/lib/csv/download';
import { deadlinePerformance, pipeline, results } from '@/lib/sales/reports';
import type { Bootstrap, DeadlineRow, PriceHistoryRow, SalesReport } from '@/lib/sales/types';
import { subTabClass, subTabListClass } from '@/lib/ui/tabs';
import { Tag, useSalesFormat } from './parts';

function Csv({ rows, name, label }: { rows: () => string[][]; name: string; label: string }) {
  return (
    <Button size="sm" variant="outline" onClick={() => downloadCsv(rows(), `${name}-${fileDateStamp()}.csv`)}>
      <Download aria-hidden="true" /> {label}
    </Button>
  );
}

export function ReportsView({ boot, report, deadlines }: { boot: Bootstrap; report: SalesReport; deadlines: DeadlineRow[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const today = todayInAppTz();
  const [by, setBy] = useState<'customer' | 'year'>('customer');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<PriceHistoryRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const stages = useMemo(() => [...boot.stages].sort((a, b) => a.flow_id.localeCompare(b.flow_id) || a.position - b.position), [boot.stages]);
  const flowKind = (flowId: string) => boot.flows.find((x) => x.id === flowId)?.kind ?? 'bid';
  const pipe = useMemo(() => pipeline(report.pipeline, stages), [report.pipeline, stages]);
  const res = useMemo(() => results(report.decided, by, f.locale), [report.decided, by, f.locale]);
  const perf = useMemo(() => deadlinePerformance(deadlines, today), [deadlines, today]);
  const stageOf = (id: string) => stages.find((s) => s.id === id);
  const values = (value: Record<string, number>) =>
    Object.entries(value).map(([currency, amount]) => f.money(amount, currency)).join(' · ') || '—';
  const rate = (n: number | null) => (n === null ? '—' : f.percent(n));

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setHistoryError(null);
    const out = await getPriceHistory(query);
    setSearching(false);
    if (out.ok) setHistory(out.data);
    else setHistoryError(out.error);
  }

  return (
    <div className="flex flex-col gap-10" data-testid="sales-reports">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('reports.pipeline')}</h3>
          <Csv name="sales-pipeline" label={t('reports.csv')} rows={() => [
            [t('flow.label'), t('field.stage'), t('reports.count'), ...(boot.caps.prices ? [t('field.value')] : [])],
            ...pipe.map((p) => [t(`flow.${flowKind(stageOf(p.stageId)!.flow_id)}`), f.stageName(stageOf(p.stageId)), String(p.count),
              ...(boot.caps.prices ? [Object.entries(p.value).map(([c, a]) => `${a} ${c}`).join(' | ')] : [])]),
          ]} />
        </div>
        {pipe.length === 0 ? <EmptyState message={t('list.empty')} /> : (
          <div className="max-w-4xl overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">{t('flow.label')}</th>
                  <th className="text-start">{t('field.stage')}</th>
                  <th className="text-end tabular-nums">{t('reports.count')}</th>
                  {boot.caps.prices ? <th className="text-end tabular-nums">{t('field.value')}</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pipe.map((p) => {
                  const s = stageOf(p.stageId)!;
                  return (
                    <tr key={p.stageId} className="whitespace-nowrap">
                      <td>{t(`flow.${flowKind(s.flow_id)}`)}</td>
                      <td><Tag tone={s.kind === 'open' ? 'neutral' : s.kind === 'done' ? 'good' : 'bad'}>{f.stageName(s)}</Tag></td>
                      <td className="text-end tabular-nums">{f.number(p.count)}</td>
                      {boot.caps.prices ? <td className="text-end tabular-nums">{values(p.value)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('reports.results')}</h3>
          <div className="flex items-center gap-3">
            <div className={subTabListClass}>
              <button type="button" className={subTabClass(by === 'customer')} onClick={() => setBy('customer')}>{t('reports.byCustomer')}</button>
              <button type="button" className={subTabClass(by === 'year')} onClick={() => setBy('year')}>{t('reports.byYear')}</button>
            </div>
            <Csv name="sales-results" label={t('reports.csv')} rows={() => [
              [by === 'customer' ? t('field.buyer') : t('reports.year'), t('reports.decided'), t('result.won'), t('result.lost'), t('result.cancelled'), t('reports.winRate')],
              ...res.map((r) => [r.key, String(r.decided), String(r.won), String(r.lost), String(r.cancelled), r.winRate === null ? '' : String(Math.round(r.winRate * 1000) / 10)]),
            ]} />
          </div>
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">{t('reports.resultsHint')}</p>
        {res.length === 0 ? <EmptyState message={t('reports.noResults')} /> : (
          <div className="max-w-4xl overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">{by === 'customer' ? t('field.buyer') : t('reports.year')}</th>
                  <th className="text-end tabular-nums">{t('reports.decided')}</th>
                  <th className="text-end tabular-nums">{t('result.won')}</th>
                  <th className="text-end tabular-nums">{t('result.lost')}</th>
                  <th className="text-end tabular-nums">{t('result.cancelled')}</th>
                  <th className="text-end tabular-nums">{t('reports.winRate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {res.map((r) => (
                  <tr key={r.key} className="whitespace-nowrap">
                    <td className="font-medium">{by === 'year' && /^\d+$/.test(r.key) ? f.number(Number(r.key)).replace(/[,٬]/g, '') : r.key}</td>
                    <td className="text-end tabular-nums">{f.number(r.decided)}</td>
                    <td className="text-end tabular-nums">{f.number(r.won)}</td>
                    <td className="text-end tabular-nums">{f.number(r.lost)}</td>
                    <td className="text-end tabular-nums">{f.number(r.cancelled)}</td>
                    <td className="text-end tabular-nums">{rate(r.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {boot.caps.prices ? (
        <section className="flex flex-col gap-3" data-testid="sales-price-history">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t('reports.priceHistory')}</h3>
            {history && history.length > 0 ? (
              <Csv name="sales-price-history" label={t('reports.csv')} rows={() => [
                [t('reports.quotedOn'), t('field.record_no'), t('items.col.no'), t('field.buyer'), t('items.col.product_type'), t('items.col.size'), t('items.col.rating'),
                  t('items.col.description'), t('items.col.qty'), t('items.unitPrice'), t('field.currency'), t('field.bid_result'), t('field.winning_bid')],
                ...history.map((h) => [h.quoted_on, String(h.record_no), h.code, labelOf(h.buyer_name, h.buyer_name_en, f.locale), h.product_type ?? '', h.size ?? '', h.rating ?? '',
                  h.description ?? '', h.qty === null ? '' : String(h.qty), String(h.unit_price), h.currency ? f.currencyLabel(h.currency) : '', h.bid_result ?? '', h.winning_bid === null ? '' : String(h.winning_bid)]),
              ]} />
            ) : null}
          </div>
          <p className="max-w-3xl text-xs text-muted-foreground">{t('reports.priceHistoryHint')}</p>
          <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
            <Input className="sm:w-96" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('reports.priceSearch')} aria-label={t('reports.priceSearch')} data-testid="sales-price-query" />
            <Button type="submit" variant="outline" className="max-sm:h-11" disabled={searching}>{t('reports.search')}</Button>
          </form>
          {historyError ? <p role="alert" className="text-sm text-destructive">{historyError}</p> : null}
          {history === null ? null : history.length === 0 ? <EmptyState message={t('reports.noQuotes')} /> : (
            <div className="overflow-x-auto border-b border-border">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start">{t('reports.quotedOn')}</th>
                    <th className="text-start">{t('items.col.no')}</th>
                    <th className="text-start">{t('field.buyer')}</th>
                    <th className="text-start">{t('items.col.product_type')}</th>
                    <th className="text-start">{t('items.col.size')}</th>
                    <th className="text-start">{t('items.col.rating')}</th>
                    <th className="text-start">{t('items.col.description')}</th>
                    <th className="text-end tabular-nums">{t('items.col.qty')}</th>
                    <th className="text-end tabular-nums">{t('items.unitPrice')}</th>
                    <th className="text-start">{t('field.bid_result')}</th>
                    <th className="text-end tabular-nums">{t('field.winning_bid')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((h) => (
                    <tr key={`${h.rfp_id}-${h.revision}-${h.code}`} className="whitespace-nowrap">
                      <td>{f.date(h.quoted_on)}</td>
                      <td><Link href={`/${f.locale}/sales/${h.rfp_id}`} className="font-semibold tabular-nums text-primary" dir="ltr">{h.code}</Link></td>
                      <td>{labelOf(h.buyer_name, h.buyer_name_en, f.locale) || '—'}</td>
                      <td>{h.product_type ?? '—'}</td>
                      <td><bdi dir="ltr">{h.size ?? '—'}</bdi></td>
                      <td><bdi dir="ltr">{h.rating ?? '—'}</bdi></td>
                      <td className="max-w-72 truncate">{h.description ?? '—'}</td>
                      <td className="text-end tabular-nums">{f.number(h.qty)}</td>
                      <td className="text-end tabular-nums">{f.money(h.unit_price, h.currency)}</td>
                      <td>{h.bid_result ? <Tag tone={h.bid_result === 'won' ? 'good' : 'bad'}>{t(`result.${h.bid_result}`)}</Tag> : <span className="text-muted-foreground">{t('reports.pending')}</span>}</td>
                      <td className="text-end tabular-nums">{f.money(h.winning_bid, h.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t('reports.deadlines')}</h3>
        <p className="max-w-3xl text-xs text-muted-foreground">{t('reports.deadlinesHint')}</p>
        <dl className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="border-s-[3px] border-success ps-3"><dt className="text-xs text-muted-foreground">{t('reports.onTime')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(perf.onTime)}</dd></div>
          <div className="border-s-[3px] border-warning ps-3"><dt className="text-xs text-muted-foreground">{t('reports.late')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(perf.late)}</dd></div>
          <div className="border-s-[3px] border-destructive ps-3"><dt className="text-xs text-muted-foreground">{t('deadline.overdue')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(perf.openOverdue)}</dd></div>
          <div className="border-s-[3px] border-primary ps-3"><dt className="text-xs text-muted-foreground">{t('deadline.allOpen')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(perf.open)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
