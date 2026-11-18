'use client';

/**
 * FR-94: the Sales records list — where each project stands and who holds it.
 * Desktop: a wide table. Phone: one card per record.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import type { Bootstrap, FlowKind, RecordFilters, RecordPage, RecordSort } from '@/lib/sales/types';
import { Select, useSalesFormat } from './parts';
import { DEFAULT_RECORD_SORT, parseRecordSort } from '@/lib/sales/recordSort';
import { RecordSortSelect, RecordsTable } from './RecordsTable';
import { RecordForm } from './RecordForm';

type StateFilter = 'open' | 'closed' | 'all';

export function RecordsList({ boot, page, filters }: { boot: Bootstrap; page: RecordPage; filters: RecordFilters }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, startNav] = useTransition();
  const rows = page.rows;
  const { sort, dir } = parseRecordSort(filters.sort ?? '', filters.dir ?? '');
  const state = (filters.state ?? 'open') as StateFilter;
  const flow = (filters.flow ?? '') as '' | FlowKind;
  const stage = filters.stage ?? '';
  const owner = filters.owner ?? '';
  const [query, setQuery] = useState(filters.q ?? '');
  const [creating, setCreating] = useState<FlowKind | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flows = useMemo(() => new Map(boot.flows.map((x) => [x.id, x])), [boot.flows]);
  const owners = useMemo(() => [...boot.people].sort((a, b) => a.name.localeCompare(b.name, 'fa')), [boot.people]);
  const stageOptions = boot.stages.filter((s) => s.active && (!flow || flows.get(s.flow_id)?.kind === flow));

  // The URL is the filter state; the server returns the matching page.
  const urlFor = (next: Partial<Record<'state' | 'flow' | 'stage' | 'owner' | 'q', string>>, nextSort: { sort: RecordSort; dir: 'asc' | 'desc' }) => {
    const merged = { state, flow, stage, owner, q: query.trim(), ...next };
    const qs = new URLSearchParams();
    if (merged.state && merged.state !== 'open') qs.set('state', merged.state);
    for (const k of ['flow', 'stage', 'owner', 'q'] as const) if (merged[k]) qs.set(k, merged[k]);
    if (nextSort.sort !== DEFAULT_RECORD_SORT.sort || nextSort.dir !== DEFAULT_RECORD_SORT.dir) {
      qs.set('sort', nextSort.sort);
      qs.set('dir', nextSort.dir);
    }
    return qs.size ? `${pathname}?${qs}` : pathname;
  };
  const push = (next: Partial<Record<'state' | 'flow' | 'stage' | 'owner' | 'q', string>>) =>
    startNav(() => router.replace(urlFor(next, { sort, dir })));
  const hrefFor = (nextSort: { sort: RecordSort; dir: 'asc' | 'desc' }) => urlFor({}, nextSort);

  // Search box: wait 300 ms after the last keystroke.
  const searchChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: value.trim() }), 300);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className={cn('flex flex-col gap-4', loading && 'opacity-70')}>
      {boot.caps.edit ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button className="max-sm:h-11" onClick={() => setCreating('bid')} data-testid="sales-new-rfp">{t('list.newRfp')}</Button>
          <Button variant="outline" className="max-sm:h-11" onClick={() => setCreating('contract')} data-testid="sales-new-contract">{t('list.newContract')}</Button>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input value={query} onChange={(e) => searchChange(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} data-testid="sales-list-search" />
        <Select value={state} onChange={(v) => push({ state: v })} ariaLabel={t('list.state')}>
          <option value="open">{t('list.stateOpen')}</option>
          <option value="closed">{t('list.stateClosed')}</option>
          <option value="all">{t('list.stateAll')}</option>
        </Select>
        <Select value={flow} onChange={(v) => push({ flow: v, stage: '' })} ariaLabel={t('list.flow')}>
          <option value="">{t('list.flowAll')}</option>
          <option value="bid">{t('flow.bid')}</option>
          <option value="contract">{t('flow.contract')}</option>
        </Select>
        <Select value={stage} onChange={(v) => push({ stage: v })} ariaLabel={t('list.stage')}>
          <option value="">{t('list.stageAll')}</option>
          {stageOptions.map((s) => <option key={s.id} value={s.id}>{f.stageName(s)}</option>)}
        </Select>
        <Select value={owner} onChange={(v) => push({ owner: v })} ariaLabel={t('list.owner')}>
          <option value="">{t('list.ownerAll')}</option>
          {owners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <RecordSortSelect boot={boot} sort={sort} dir={dir} onChange={(next) => startNav(() => router.replace(urlFor({}, next)))} />
      </div>

      <div className="flex flex-col gap-1" aria-live="polite">
        <p className="text-xs text-muted-foreground" data-testid="sales-list-count">
          {loading ? t('list.loading') : t('list.count', { shown: rows.length, total: page.total })}
        </p>
        {page.truncated && !loading ? (
          <p className="text-xs text-muted-foreground" data-testid="sales-list-truncated">
            {t('list.truncated', { shown: rows.length, total: page.total })}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState message={page.total === 0 && !filters.q && !flow && !stage && !owner && state === 'all' ? t('list.empty') : t('list.noMatch')} />
      ) : (
        <RecordsTable
          boot={boot}
          rows={rows}
          sort={sort}
          dir={dir}
          hrefFor={(next) => hrefFor(next)}
          testId="sales-list-table"
        />
      )}

      <Dialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{creating === 'contract' ? t('list.newContract') : t('list.newRfp')}</DialogTitle>
            <DialogDescription>{creating === 'contract' ? t('form.contractIntro') : t('form.rfpIntro')}</DialogDescription>
          </DialogHeader>
          {creating ? (
            <RecordForm
              boot={boot}
              record={null}
              flowKind={creating}
              onCancel={() => setCreating(null)}
              onDone={(id) => { setCreating(null); if (id) router.push(`/${f.locale}/sales/${id}`); }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
