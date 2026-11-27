'use client';

/**
 * FR-94 §16.9: the filter bar of the Customers tab and a customer page. The values live in the URL
 * (`from`, `to`, `result`, `owner`, `kind`); the server page reads them and filters the figures.
 */

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { RESULTS } from '@/lib/sales/customers';
import type { CustomerFilters, Person } from '@/lib/sales/types';
import { DateInput, Select } from './parts';

const FILTER_KEYS = ['from', 'to', 'result', 'owner', 'kind', 'incomplete'] as const;

export function FilterBar({ filters, owners, withKind }: {
  filters: CustomerFilters;
  /** Choices for the person in charge; none = the select is not shown. */
  owners: Pick<Person, 'id' | 'name'>[];
  withKind: boolean;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, start] = useTransition();

  const set = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string | null>>) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) qs.set(k, v); else qs.delete(k);
    }
    start(() => router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const any = FILTER_KEYS.some((k) => (k === 'kind' || k === 'incomplete' ? withKind && filters[k] : filters[k]));
  const dateField = (label: string, key: 'from' | 'to') => (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <DateInput value={filters[key] ?? null} onChange={(iso) => set({ [key]: iso })} testId={`sales-filter-${key}`} />
    </label>
  );

  return (
    <div
      role="group"
      aria-label={t('filters.label')}
      aria-busy={loading}
      className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-6"
      data-testid="sales-filters"
    >
      {dateField(t('filters.from'), 'from')}
      {dateField(t('filters.to'), 'to')}
      <Select value={filters.result ?? ''} onChange={(v) => set({ result: v })} ariaLabel={t('filters.result')} testId="sales-filter-result">
        <option value="">{t('filters.resultAll')}</option>
        {RESULTS.map((r) => <option key={r} value={r}>{t(`import.inquiry.result.${r}`)}</option>)}
      </Select>
      {owners.length > 0 ? (
        <Select value={filters.owner ?? ''} onChange={(v) => set({ owner: v })} ariaLabel={t('filters.owner')} testId="sales-filter-owner">
          <option value="">{t('filters.ownerAll')}</option>
          {owners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      ) : null}
      {withKind ? (
        <Select value={filters.kind ?? ''} onChange={(v) => set({ kind: v })} ariaLabel={t('filters.kind')} testId="sales-filter-kind">
          <option value="">{t('filters.kindAll')}</option>
          <option value="government">{t('customerKind.government')}</option>
          <option value="contractor">{t('customerKind.contractor')}</option>
          <option value="private">{t('customerKind.private')}</option>
        </Select>
      ) : null}
      {withKind ? (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={filters.incomplete === '1'}
            onChange={(e) => set({ incomplete: e.target.checked ? '1' : null })}
            data-testid="sales-customers-incomplete-filter"
          />
          {t('customerProfile.filterIncomplete')}
        </label>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="h-9 max-sm:w-full"
        disabled={!any}
        onClick={() => set({ from: null, to: null, result: null, owner: null, kind: null, incomplete: null })}
        data-testid="sales-filter-clear"
      >
        {t('filters.clear')}
      </Button>
    </div>
  );
}
