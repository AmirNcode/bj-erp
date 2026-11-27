'use client';

/**
 * FR-99: Sales › Activity. Filters live in the URL (`actor`, `from`, `to`, `entity`); the server page
 * fetches the first 50 rows, "Load more" fetches the next with the cursor. Desktop shows a table,
 * phones the HistoryList cards. Rows come with private values already stripped by the database.
 */

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { listSalesActivity } from '@/lib/actions/sales';
import type { ActivityFilters, ActivityPage, HistoryRow } from '@/lib/sales/types';
import { HistoryList, useHistoryParts } from './HistoryList';
import { DateInput, Select } from './parts';

const FILTER_KEYS = ['actor', 'from', 'to', 'entity'] as const;
const ENTITIES = ['record', 'customer', 'product', 'settings', 'import'] as const;

export function ActivityView({ filters, people, initial }: {
  filters: ActivityFilters;
  people: { id: string; name: string }[];
  initial: ActivityPage;
}) {
  const t = useTranslations('sales');
  const { when, line, changes, itemOf } = useHistoryParts();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filtering, startFilter] = useTransition();
  const [loading, startMore] = useTransition();
  const [rows, setRows] = useState<HistoryRow[]>(initial.rows);
  const [next, setNext] = useState(initial.next);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string | null>>) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) qs.set(k, v); else qs.delete(k);
    }
    startFilter(() => router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const any = FILTER_KEYS.some((k) => filters[k]);

  function more() {
    if (!next) return;
    setError(null);
    startMore(async () => {
      const res = await listSalesActivity({ ...filters, before: next });
      if (!res.ok) { setError(res.error); return; }
      setRows((prev) => [...prev, ...res.data.rows]);
      setNext(res.data.next);
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="sales-activity">
      <div
        role="group"
        aria-label={t('filters.label')}
        aria-busy={filtering}
        className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-5"
        data-testid="sales-activity-filters"
      >
        <Select value={filters.actor ?? ''} onChange={(v) => set({ actor: v })} ariaLabel={t('activityPage.who')} testId="sales-activity-actor">
          <option value="">{t('activityPage.anyone')}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {t('activityPage.from')}
          <DateInput value={filters.from ?? null} onChange={(iso) => set({ from: iso })} testId="sales-activity-from" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {t('activityPage.to')}
          <DateInput value={filters.to ?? null} onChange={(iso) => set({ to: iso })} testId="sales-activity-to" />
        </label>
        <Select value={filters.entity ?? ''} onChange={(v) => set({ entity: v })} ariaLabel={t('activityPage.item')} testId="sales-activity-entity">
          <option value="">{t('activityPage.anyType')}</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{t(`activityPage.entity.${e}`)}</option>)}
        </Select>
        <Button
          type="button"
          variant="outline"
          className="h-9 max-sm:w-full"
          disabled={!any}
          onClick={() => set({ actor: null, from: null, to: null, entity: null })}
          data-testid="sales-activity-clear"
        >
          {t('filters.clear')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="sales-activity-empty">{t('activityPage.empty')}</p>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="data-table w-full text-sm" data-testid="sales-activity-table">
              <thead>
                <tr>
                  <th className="text-start">{t('activityPage.when')}</th>
                  <th className="text-start">{t('activityPage.who')}</th>
                  <th className="text-start">{t('activityPage.what')}</th>
                  <th className="text-start">{t('activityPage.item')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.source ?? 'x'}-${row.id}`} className="align-top" data-testid="sales-activity-row">
                    <td className="whitespace-nowrap">{when(row.at)}</td>
                    <td>{row.actor_name ?? '—'}</td>
                    <td><div>{line(row)}</div>{changes(row)}</td>
                    <td>{itemOf(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden">
            <HistoryList rows={rows} entityKind="mixed" showEntity />
          </div>
        </>
      )}

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {next ? (
        <div>
          <Button type="button" variant="outline" pending={loading} onClick={more} data-testid="sales-activity-more">
            {t('history.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
