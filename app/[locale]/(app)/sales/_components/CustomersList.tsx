'use client';

/**
 * FR-94 §16.7: the Customers tab — one row per company with its figures.
 * Desktop: sortable wide table. Phone: one card per company.
 */

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/ui/input';
import { presentCurrencies, searchCustomers, sortCustomers, type CustomerSortKey } from '@/lib/sales/customers';
import { customerLabel } from '@/lib/sales/customerLabel';
import type { Bootstrap, CustomerFilters, CustomerMissingKey, CustomerSummary, SalesMetrics } from '@/lib/sales/types';
import { CustomerForm } from './CustomerForm';
import { FilterBar } from './FilterBar';
import { MetricsStrip } from './MetricsStrip';
import { Select, Tag, useSalesFormat } from './parts';
import { SortTh, TD } from './SortTh';
import { DetailRow, ExpandCell, ExpandTh, type DetailItem } from './ExpandParts';
import { customerColumns, type CustomerColumn } from '@/lib/sales/columns';
import { cn } from '@/lib/utils';
import { useViewAs } from '../../_components/ViewAsContext';

/** Sums per currency, stacked one under the other. */
export function Sums({ value }: { value: Record<string, number> | undefined }) {
  const f = useSalesFormat();
  const entries = Object.entries(value ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end">
      {entries.map(([currency, amount]) => <span key={currency}>{f.money(amount, currency)}</span>)}
    </span>
  );
}

/** "Missing: Province, City" — the labels of the fields a customer still lacks. */
export function useIncompleteHint(): (missing: CustomerMissingKey[]) => string {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  return (missing) => t('customerProfile.incompleteHint', {
    fields: missing.map((k) => t(`customerMissing.${k}`)).join(f.locale === 'fa' ? '، ' : ', '),
  });
}

export function CustomersList({ rows, boot, metrics, filters, importSlot }: {
  rows: CustomerSummary[];
  boot: Bootstrap;
  metrics: SalesMetrics | null;
  filters: CustomerFilters;
  /** Extra header action (the import button), rendered before Add. */
  importSlot?: React.ReactNode;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const viewAs = useViewAs();
  const hint = useIncompleteHint();
  const [adding, setAdding] = useState(false);
  const prices = boot.caps.prices;
  const people = boot.people;
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [sort, setSort] = useState<{ key: CustomerSortKey; dir: 'asc' | 'desc' }>({ key: 'records', dir: 'desc' });

  const shown = useMemo(() => sortCustomers(searchCustomers(rows, query), sort.key, sort.dir), [rows, query, sort]);
  const salesCur = useMemo(() => (prices ? presentCurrencies(rows, 'sales', f.currencies) : []), [rows, prices, f.currencies]);
  const quotedCur = useMemo(() => (prices ? presentCurrencies(rows, 'quoted', f.currencies) : []), [rows, prices, f.currencies]);
  const owners = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name, 'fa')), [people]);
  const href = (id: string) => `/${f.locale}/sales/customers/${id}`;
  const dash = <span className="text-muted-foreground">—</span>;
  const rate = (r: CustomerSummary) =>
    r.win_rate === null ? dash : (
      <>{f.percent(r.win_rate)} <span className="text-xs font-normal text-muted-foreground">({f.number(r.decided)})</span></>
    );
  const label = (r: CustomerSummary) => customerLabel(r, f.locale);
  const incomplete = (r: CustomerSummary) => (r.missing.length > 0 ? (
    <span title={hint(r.missing)} data-testid="sales-customer-incomplete"><Tag tone="warn">{t('customerProfile.incomplete')}</Tag></span>
  ) : null);
  const kind = (r: CustomerSummary) => (r.kind ? <Tag>{t(`customerKind.${r.kind}`)}</Tag> : null);
  const asc = (key: CustomerSortKey) => key === 'name' || key === 'main_owner_name';
  const click = (key: CustomerSortKey) =>
    setSort({ key, dir: sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : asc(key) ? 'asc' : 'desc' });
  const head = (key: CustomerSortKey, label: string, end = false, col?: CustomerColumn) => (
    <SortTh key={key} label={label} active={sort.key === key} dir={sort.dir} align={end ? 'end' : 'start'} className={col ? SHOW[col] : undefined} onClick={() => click(key)} testId={`sales-csort-${key}`} />
  );
  const { show: SHOW, detail: DET, expandHide: CUSTOMER_EXPAND_HIDE } = useMemo(() => customerColumns(salesCur.length, quotedCur.length), [salesCur.length, quotedCur.length]);
  const colCount = 14 + salesCur.length + quotedCur.length;
  const num = (n: number) => (n === 0 ? <span className="text-muted-foreground">0</span> : f.number(n));
  const money = (sums: Record<string, number> | undefined, cur: string) => {
    const v = sums?.[cur];
    return v === undefined ? dash : f.number(v);
  };
  const sortOptions: { key: CustomerSortKey; label: string }[] = [
    { key: 'name', label: t('field.buyer') },
    { key: 'records', label: t('customers.records') },
    { key: 'won', label: t('customers.won') },
    { key: 'win_rate', label: t('customers.winRate') },
    { key: 'last_inquiry', label: t('customers.lastInquiry') },
    ...salesCur.map((c) => ({ key: `sales:${c}` as CustomerSortKey, label: t('customers.salesCur', { currency: f.currencyLabel(c) }) })),
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="sales-customers">
      {boot.caps.customers && viewAs === null ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {importSlot}
          <Button className="max-sm:h-11" onClick={() => setAdding(true)} data-testid="sales-customers-add">{t('customerProfile.add')}</Button>
        </div>
      ) : null}
      <FilterBar filters={filters} owners={owners} withKind />
      {metrics ? <MetricsStrip metrics={metrics} /> : null}
      <div className="grid gap-2 sm:grid-cols-2 sm:max-w-xl">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('customers.search')}
          aria-label={t('customers.search')}
          data-testid="sales-customers-search"
        />
        <Select
          className="md:hidden"
          value={`${sort.key}|${sort.dir}`}
          ariaLabel={t('list.sort')}
          testId="sales-customers-sort-select"
          onChange={(v) => { const [key, dir] = v.split('|'); setSort({ key: key as CustomerSortKey, dir: dir as 'asc' | 'desc' }); }}
        >
          {sortOptions.flatMap((o) => (['asc', 'desc'] as const).map((d) => (
            <option key={`${o.key}|${d}`} value={`${o.key}|${d}`}>{o.label} {d === 'asc' ? '↑' : '↓'}</option>
          )))}
        </Select>
      </div>
      {rows.length === 0 ? <EmptyState message={t('customers.empty')} /> : shown.length === 0 ? <EmptyState message={t('list.noMatch')} /> : (
        <>
          <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
            {shown.map((r) => (
              <li key={r.id}>
                <Link href={href(r.id)} className="flex flex-col gap-1 py-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-semibold"><bdi>{label(r)}</bdi>{incomplete(r)}</span>
                    {kind(r)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('customers.records')} {f.number(r.records)} · {t('customers.open')} {f.number(r.open)} · {t('customers.won')} {f.number(r.won)} · {t('customers.lost')} {f.number(r.lost)}
                  </span>
                  <span className="text-xs">{t('customers.winRate')}: {rate(r)}</span>
                  {salesCur.filter((c) => r.sales?.[c] !== undefined).map((c) => (
                    <span key={c} className="text-xs tabular-nums">{t('customers.salesCur', { currency: f.currencyLabel(c) })}: {f.number(r.sales?.[c])}</span>
                  ))}
                </Link>
              </li>
            ))}
          </ul>
          <div className="@container hidden border-b border-border md:block">
            <table className="data-table w-full text-sm" data-testid="sales-customers-table">
              <thead>
                <tr>
                  {head('name', t('field.buyer'))}
                  {head('records', t('customers.records'), true, 'records')}
                  {salesCur.map((c) => head(`sales:${c}`, t('customers.salesCur', { currency: f.currencyLabel(c) }), true, 'sales'))}
                  {head('won', t('customers.won'), true, 'won')}
                  {head('win_rate', t('customers.winRate'), true, 'winRate')}
                  {head('open', t('customers.open'), true, 'open')}
                  {head('lost', t('customers.lost'), true, 'lost')}
                  {head('last_inquiry', t('customers.lastInquiry'), false, 'lastInquiry')}
                  {head('main_owner_name', t('customers.mainContact'), false, 'owner')}
                  {quotedCur.map((c) => head(`quoted:${c}`, t('customers.quotedCur', { currency: f.currencyLabel(c) }), true, 'quoted'))}
                  {head('no_bid', t('customers.noBid'), true, 'noBid')}
                  {head('archived', t('customers.archived'), true, 'archived')}
                  {head('first_inquiry', t('customers.firstInquiry'), false, 'firstInquiry')}
                  {head('next_deadline', t('customers.nextDeadline'), false, 'nextDeadline')}
                  <th className={cn('px-3 py-2.5 text-start', SHOW.kind)}>{t('customers.kind')}</th>
                  <ExpandTh hideClass={CUSTOMER_EXPAND_HIDE} />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => {
                  const isOpen = open.has(r.id);
                  const items: DetailItem[] = [
                    { key: 'records', label: t('customers.records'), value: f.number(r.records), hideClass: DET.records },
                    ...salesCur.map((c) => ({ key: `sales:${c}`, label: t('customers.salesCur', { currency: f.currencyLabel(c) }), value: money(r.sales, c), hideClass: DET.sales })),
                    { key: 'won', label: t('customers.won'), value: num(r.won), hideClass: DET.won },
                    { key: 'winRate', label: t('customers.winRate'), value: rate(r), hideClass: DET.winRate },
                    { key: 'open', label: t('customers.open'), value: num(r.open), hideClass: DET.open },
                    { key: 'lost', label: t('customers.lost'), value: num(r.lost), hideClass: DET.lost },
                    { key: 'lastInquiry', label: t('customers.lastInquiry'), value: f.date(r.last_inquiry), hideClass: DET.lastInquiry },
                    { key: 'owner', label: t('customers.mainContact'), value: r.main_owner_name ?? dash, hideClass: DET.owner },
                    ...quotedCur.map((c) => ({ key: `quoted:${c}`, label: t('customers.quotedCur', { currency: f.currencyLabel(c) }), value: money(r.quoted, c), hideClass: DET.quoted })),
                    { key: 'noBid', label: t('customers.noBid'), value: num(r.no_bid), hideClass: DET.noBid },
                    { key: 'archived', label: t('customers.archived'), value: num(r.archived), hideClass: DET.archived },
                    { key: 'firstInquiry', label: t('customers.firstInquiry'), value: f.date(r.first_inquiry), hideClass: DET.firstInquiry },
                    { key: 'nextDeadline', label: t('customers.nextDeadline'), value: f.date(r.next_deadline), hideClass: DET.nextDeadline },
                    { key: 'kind', label: t('customers.kind'), value: kind(r) ?? dash, hideClass: DET.kind },
                  ];
                  return (
                    <Fragment key={r.id}>
                      <tr className="cursor-pointer" onClick={() => router.push(href(r.id))}>
                        <td className={TD} title={label(r)}>
                          <Link href={href(r.id)} className="inline-block max-w-[22ch] truncate align-bottom font-semibold text-primary" onClick={(e) => e.stopPropagation()}><bdi>{label(r)}</bdi></Link>
                          {r.missing.length > 0 ? <> {incomplete(r)}</> : null}
                        </td>
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.records)}>
                          {f.number(r.records)}
                          {r.as_client > 0 ? <span className="block text-xs text-muted-foreground">+{f.number(r.as_client)} {t('customers.asClient')}</span> : null}
                        </td>
                        {salesCur.map((c) => <td key={c} className={cn(TD, 'text-end tabular-nums', SHOW.sales)}>{money(r.sales, c)}</td>)}
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.won)}>{num(r.won)}</td>
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.winRate)}>{rate(r)}</td>
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.open)}>{num(r.open)}</td>
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.lost)}>{num(r.lost)}</td>
                        <td className={cn(TD, SHOW.lastInquiry)}>{f.date(r.last_inquiry)}</td>
                        <td className={cn(TD, 'max-w-[18ch] truncate', SHOW.owner)} title={r.main_owner_name ?? undefined}>{r.main_owner_name ?? dash}</td>
                        {quotedCur.map((c) => <td key={c} className={cn(TD, 'text-end tabular-nums', SHOW.quoted)}>{money(r.quoted, c)}</td>)}
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.noBid)}>{num(r.no_bid)}</td>
                        <td className={cn(TD, 'text-end tabular-nums', SHOW.archived)}>{num(r.archived)}</td>
                        <td className={cn(TD, SHOW.firstInquiry)}>{f.date(r.first_inquiry)}</td>
                        <td className={cn(TD, SHOW.nextDeadline)}>{f.date(r.next_deadline)}</td>
                        <td className={cn(TD, SHOW.kind)}>{kind(r)}</td>
                        <ExpandCell id={`cust-${r.id}`} open={isOpen} hideClass={CUSTOMER_EXPAND_HIDE} onToggle={() => toggleOpen(r.id)} testId={`sales-cexpand-${r.id}`} />
                      </tr>
                      {isOpen ? (
                        <DetailRow id={`cust-${r.id}`} colSpan={colCount} hideClass={CUSTOMER_EXPAND_HIDE} items={items} testId={`sales-cdetails-${r.id}`} />
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {adding ? (
        <CustomerForm
          customerId={null}
          customers={boot.customers}
          onSaved={(p) => router.push(`/${f.locale}/sales/customers/${p.id}`)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
