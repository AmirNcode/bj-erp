'use client';

/**
 * FR-99: a list of history rows in the ActivityLog look — one line per change, "Field: old → new"
 * underneath, actor · Tehran date-time. Used by the customer / product History tabs
 * (`entityKind` customer | product) and by Sales › Activity (`entityKind` mixed + `showEntity`).
 * Private values arrive already stripped (the database does it); this only renders what it gets.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  changeList, formatChangeValue, hasCreationRow, historyLine, historyOp, historySource, isPrivateChanged, isStrippedChange,
  personText, tehranDay,
} from '@/lib/sales/history';
import type { HistoryChange, HistoryRow } from '@/lib/sales/types';
import { useSalesFormat } from './parts';

type Tr = (key: string, values?: Record<string, unknown>) => string;

/** Row pieces shared by HistoryList and the Activity page table. */
export function useHistoryParts() {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const tr = t as unknown as Tr;
  const rich = t.rich as unknown as (key: string, values: Record<string, unknown>) => React.ReactNode;
  const arrow = f.locale === 'fa' ? '←' : '→';
  const when = (iso: string) =>
    `${f.date(tehranDay(iso))} ${new Intl.DateTimeFormat(f.locale === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(iso))}`;
  const has = (key: string) => t.has(key as never);

  function line(row: HistoryRow): React.ReactNode {
    const { key, values } = historyLine(row);
    const v: Record<string, unknown> = { ...values, n: (chunks: React.ReactNode) => <bdi className="font-medium">{chunks}</bdi> };
    if (key === 'event.result') v.result = has(`result.${values.result}`) ? tr(`result.${values.result}`) : values.result;
    if ((key === 'event.deadlineDone' || key === 'event.deadlineUndone') && !values.name) {
      v.name = has(`deadline.kind.${values.kind}`) ? tr(`deadline.kind.${values.kind}`) : values.kind;
    }
    if (!has(key)) return tr('history.recordOther');
    const op = historyOp(row);
    const source = row.action === 'created' ? historySource(row) : null;
    return (
      <>
        {rich(key, v)}
        {op && has(`history.op.${op}`) ? <span className="text-muted-foreground"> · {tr(`history.op.${op}`)}</span> : null}
        {source && has(`history.source.${source}`) ? <span className="text-muted-foreground"> · {tr(`history.source.${source}`)}</span> : null}
      </>
    );
  }

  function fieldLabel(field: string) {
    return has(`history.field.${field}`) ? tr(`history.field.${field}`) : field;
  }

  function value(field: string, v: unknown): string {
    if (field === 'kind' && typeof v === 'string' && has(`customerKind.${v}`)) return tr(`customerKind.${v}`);
    return formatChangeValue(v, { yes: t('yes'), no: t('no') });
  }

  function change(c: HistoryChange) {
    // Holders: the phone-book change keeps its entries (it is always flagged private); readers get it stripped.
    if (c.field === 'people' && !isStrippedChange(c)) {
      const from = Array.isArray(c.from) ? c.from.map(personText) : [];
      const to = Array.isArray(c.to) ? c.to.map(personText) : [];
      return (
        <li key={c.field} data-testid="sales-history-people">
          <span className="text-muted-foreground">{fieldLabel(c.field)}: </span>
          {tr('history.peopleChanged', { added: c.added ?? 0, changed: c.changed ?? 0, removed: c.removed ?? 0 })}
          {from.length > 0 ? <div className="text-muted-foreground"><bdi>{from.join('، ')}</bdi></div> : null}
          {to.length > 0 ? <div><bdi className="font-medium">{to.join('، ')}</bdi></div> : null}
        </li>
      );
    }
    return (
      <li key={c.field}>
        <span className="text-muted-foreground">{fieldLabel(c.field)}: </span>
        {isStrippedChange(c) ? tr('history.privateChanged')
          : c.hidden ? tr('stagePage.changedHidden')
            : (
              <>
                <bdi>{value(c.field, c.from)}</bdi>
                <span aria-hidden="true"> {arrow} </span>
                <bdi className="font-medium">{value(c.field, c.to)}</bdi>
              </>
            )}
      </li>
    );
  }

  function itemOf(row: HistoryRow) {
    const label = row.entity_label ?? '—';
    const base = `/${f.locale}/sales`;
    const href = row.exists && row.entity_id
      ? row.entity === 'record' ? `${base}/${row.entity_id}`
        : row.entity === 'customer' ? `${base}/customers/${row.entity_id}`
          : row.entity === 'product' ? `${base}/products/${row.entity_id}` : null
      : null;
    if (href) return <Link href={href} className="font-medium text-primary"><bdi>{label}</bdi></Link>;
    const gone = row.exists === false && (row.entity === 'record' || row.entity === 'customer' || row.entity === 'product');
    return <span className="text-muted-foreground"><bdi>{label}</bdi>{gone ? <> {tr('activityPage.gone')}</> : null}</span>;
  }

  /** The change list under a row's line, or null. */
  function changes(row: HistoryRow): React.ReactNode {
    const list = row.source === 'record' || row.entity === 'record' ? [] : changeList(row);
    const privateOnly = isPrivateChanged(row) && !list.some((c) => c.private);
    if (list.length === 0 && !privateOnly) return null;
    return (
      <ul className="flex flex-col gap-0.5 text-xs" data-testid="sales-history-changes">
        {list.map(change)}
        {privateOnly ? <li>{tr('history.privateChanged')}</li> : null}
      </ul>
    );
  }

  return { t, f, tr, when, line, changes, itemOf };
}

export function HistoryList({ rows, entityKind, createdAt, entityId, showEntity = false }: {
  rows: HistoryRow[];
  entityKind: 'customer' | 'product' | 'mixed';
  /** Customer pages: when the customer was registered (shown as "before history began" when no creation row). */
  createdAt?: string;
  /** Customer pages: the customer's own id (rows of customers merged into it do not count as its creation). */
  entityId?: string;
  showEntity?: boolean;
}) {
  const { t, f, tr, when, line, changes, itemOf } = useHistoryParts();
  // A merged customer's history carries other ids: then each row says whose it was.
  const multi = new Set(rows.map((r) => r.entity_id)).size > 1;
  const showLabel = showEntity || (entityKind === 'customer' && multi);
  const beforeHistory = entityKind === 'customer' && !!createdAt && !hasCreationRow(rows, entityId);


  if (rows.length === 0 && !beforeHistory) {
    return <p className="text-sm text-muted-foreground" data-testid="sales-history-empty">{t('history.empty')}</p>;
  }

  return (
    <ol className="flex max-w-3xl flex-col divide-y divide-border border-y border-border" data-testid="sales-history-list">
      {rows.map((row) => (
        <li key={`${row.source ?? 'x'}-${row.id}`} className="flex flex-col gap-0.5 py-2.5 text-sm" data-testid={`sales-history-row-${row.action}`}>
          {showLabel ? <div className="text-xs">{itemOf(row)}</div> : null}
          <div>{line(row)}</div>
          {changes(row)}
          <span className="text-xs text-muted-foreground">{row.actor_name ?? '—'} · {when(row.at)}</span>
        </li>
      ))}
      {beforeHistory ? (
        <li className="py-2.5 text-sm text-muted-foreground" data-testid="sales-history-before">
          {tr('history.beforeHistory', { date: f.date(createdAt ? tehranDay(createdAt) : createdAt) })}
        </li>
      ) : null}
    </ol>
  );
}
