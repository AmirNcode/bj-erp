'use client';

/**
 * FR-94 §16.7: one customer — the Customers-tab figures as tiles, inquiries per
 * year, where it is the end user, what it asks for most, and its records.
 * `sales_settings` holders can rename it or merge it into another company.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { mergeSalesCustomers, renameSalesCustomer } from '@/lib/actions/sales';
import { barPercent, persianYearOf } from '@/lib/sales/customers';
import { DEFAULT_RECORD_SORT } from '@/lib/sales/recordSort';
import type { Bootstrap, CustomerDetail, CustomerFilters, CustomerRef, RecordPage, RecordSort, SalesMetrics } from '@/lib/sales/types';
import { CustomerCombo } from './CustomerCombo';
import { Sums } from './CustomersList';
import { FilterBar } from './FilterBar';
import { MetricsStrip } from './MetricsStrip';
import { RecordSortSelect, RecordsTable } from './RecordsTable';
import { Tag, useRun, useSalesFormat } from './parts';

export function CustomerView({ boot, detail, page, metrics, filters }: {
  boot: Bootstrap; detail: CustomerDetail; page: RecordPage; metrics: SalesMetrics | null; filters: CustomerFilters;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sort = (params.get('sort') as RecordSort | null) ?? DEFAULT_RECORD_SORT.sort;
  const dir = params.get('dir') === 'desc' ? 'desc' : params.get('sort') ? 'asc' : DEFAULT_RECORD_SORT.dir;
  const sortHref = (next: { sort: RecordSort; dir: 'asc' | 'desc' }) => {
    const qs = new URLSearchParams(params.toString());
    qs.set('sort', next.sort);
    qs.set('dir', next.dir);
    return `${pathname}?${qs}`;
  };
  const { run, pending } = useRun();
  const c = detail.customer;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.name);
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState<CustomerRef | null>(null);

  const targets = useMemo(() => boot.customers.filter((x) => x.id !== c.id), [boot.customers, c.id]);
  const years = useMemo(() => [...detail.per_year].sort((a, b) => b.year - a.year).slice(0, 10), [detail.per_year]);
  const maxYear = Math.max(0, ...years.map((y) => y.total));
  const yearLabel = (y: number) => f.number(persianYearOf(y)).replace(/[,٬]/g, '');
  const moving = c.records + c.as_client;

  const tile = (label: string, value: React.ReactNode, tone = 'border-primary') => (
    <div key={label} className={`border-s-[3px] ps-3 ${tone}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
  const dash = <span className="text-muted-foreground">—</span>;

  async function rename() {
    const next = name.trim();
    if (!next) return;
    await run(() => renameSalesCustomer(c.id, next), () => setRenaming(false));
  }
  async function merge() {
    if (!target) return;
    const out = await mergeSalesCustomers(c.id, target.id);
    if (!out.ok) { toast.error(out.error); return; }
    toast.success(t('customers.merged'));
    router.push(`/${f.locale}/sales/customers/${target.id}`);
  }

  return (
    <div className="flex flex-col gap-8" data-testid="sales-customer">
      <div className="flex flex-col gap-3">
        <Link href={`/${f.locale}/sales/customers`} className="inline-flex w-fit items-center gap-1 text-sm text-primary">
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" /> {t('customers.back')}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold"><bdi>{c.name}</bdi></h2>
            {c.kind ? <Tag>{t(`customerKind.${c.kind}`)}</Tag> : null}
          </div>
          {boot.caps.settings ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="max-sm:h-11" onClick={() => { setName(c.name); setRenaming(true); }} data-testid="sales-customer-rename">{t('customers.rename')}</Button>
              <Button variant="outline" className="max-sm:h-11" onClick={() => { setTarget(null); setMerging(true); }} data-testid="sales-customer-merge">{t('customers.merge')}</Button>
            </div>
          ) : null}
        </div>
      </div>

      <FilterBar filters={filters} owners={detail.owners.length > 1 ? detail.owners : []} withKind={false} />
      {metrics ? <MetricsStrip metrics={metrics} /> : null}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6" data-testid="sales-customer-tiles">
        {tile(t('customers.records'), f.number(c.records))}
        {tile(t('customers.asClient'), f.number(c.as_client))}
        {tile(t('customers.open'), f.number(c.open))}
        {tile(t('customers.won'), f.number(c.won), 'border-success')}
        {tile(t('customers.lost'), f.number(c.lost), 'border-destructive')}
        {tile(t('customers.noBid'), f.number(c.no_bid), 'border-warning')}
        {tile(t('customers.archived'), f.number(c.archived), 'border-border')}
        {boot.caps.prices ? tile(t('customers.quoted'), <span className="text-base"><Sums value={c.quoted} /></span>) : null}
        {tile(t('customers.firstInquiry'), <span className="text-base">{f.date(c.first_inquiry)}</span>)}
        {tile(t('customers.lastInquiry'), <span className="text-base">{f.date(c.last_inquiry)}</span>)}
        {tile(t('customers.nextDeadline'), <span className="text-base">{f.date(c.next_deadline)}</span>)}
        {tile(t('customers.mainContact'), <span className="text-base">{c.main_owner_name ?? dash}</span>)}
      </dl>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3" data-testid="sales-customer-years">
          <h3 className="text-sm font-semibold">{t('customers.perYear')}</h3>
          {years.length === 0 ? <EmptyState message={t('customers.empty')} /> : (
            <>
              <ul className="flex flex-col gap-2">
                {years.map((y) => {
                  const w = barPercent(y.total, maxYear);
                  const won = y.total > 0 ? (y.won / y.total) * w : 0;
                  const lost = y.total > 0 ? (y.lost / y.total) * w : 0;
                  return (
                    <li key={y.year} className="flex items-center gap-3 text-sm">
                      <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{yearLabel(y.year)}</span>
                      <span className="flex h-3 min-w-0 flex-1" aria-hidden="true">
                        <span className="h-full bg-success" style={{ width: `${won}%` }} />
                        <span className="h-full bg-destructive" style={{ width: `${lost}%` }} />
                        <span className="h-full bg-primary/40" style={{ width: `${Math.max(0, w - won - lost)}%` }} />
                      </span>
                      <span className="w-44 shrink-0 text-end text-xs whitespace-nowrap tabular-nums">
                        {f.number(y.total)} · {t('customers.won')} {f.number(y.won)} · {t('customers.lost')} {f.number(y.lost)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <div className="flex flex-col gap-8">
          {detail.client_of.length > 0 ? (
            <section className="flex flex-col gap-3" data-testid="sales-customer-client-of">
              <h3 className="text-sm font-semibold">{t('customers.clientOf')}</h3>
              <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
                {detail.client_of.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/${f.locale}/sales/customers/${o.id}`} className="text-primary"><bdi>{o.name}</bdi></Link>
                    <span className="tabular-nums text-muted-foreground">{f.number(o.count)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {detail.top_words.length > 0 ? (
            <section className="flex flex-col gap-3" data-testid="sales-customer-words">
              <h3 className="text-sm font-semibold">{t('customers.topItems')}</h3>
              <ul className="flex flex-wrap gap-2">
                {detail.top_words.map((w) => (
                  <li key={w.word}><Tag><bdi>{w.word}</bdi> · {f.number(w.count)}</Tag></li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <section className="flex flex-col gap-3" data-testid="sales-customer-records">
        <h3 className="text-sm font-semibold">{t('customers.theirRecords')}</h3>
        {page.truncated ? (
          <p className="text-xs text-muted-foreground">{t('list.truncated', { shown: page.rows.length, total: page.total })}</p>
        ) : null}
        {page.rows.length === 0 ? <EmptyState message={t('list.empty')} /> : (
          <>
            <RecordSortSelect boot={boot} sort={sort} dir={dir} onChange={(next) => router.replace(sortHref(next), { scroll: false })} />
            <RecordsTable boot={boot} rows={page.rows} sort={sort} dir={dir} hrefFor={sortHref} showBuyer={false} testId="sales-customer-records-table" />
          </>
        )}
      </section>

      <Dialog open={renaming} onOpenChange={(o) => { if (!o) setRenaming(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('customers.renameTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{t('customers.renameTitle')}</DialogDescription>
          </DialogHeader>
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-label={t('customers.renameTitle')} data-testid="sales-customer-name" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)} disabled={pending}>{t('cancel')}</Button>
            <Button onClick={rename} disabled={pending || name.trim() === '' || name.trim() === c.name} data-testid="sales-customer-rename-save">{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={merging} onOpenChange={(o) => { if (!o) setMerging(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('customers.mergeTitle', { name: c.name })}</DialogTitle>
            <DialogDescription>{target ? t('customers.mergeBody', { count: moving, name: c.name }) : t('customers.mergeTarget')}</DialogDescription>
          </DialogHeader>
          <CustomerCombo customers={targets} value={target} onChange={setTarget} ariaLabel={t('customers.mergeTarget')} testId="sales-customer-merge-target" allowCreate={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerging(false)}>{t('cancel')}</Button>
            <Button variant="outline" className="text-destructive" onClick={merge} disabled={!target} data-testid="sales-customer-merge-confirm">{t('customers.mergeConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
