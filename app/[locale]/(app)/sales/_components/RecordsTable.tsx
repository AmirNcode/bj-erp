'use client';

/**
 * FR-94 §16.8: the records table shared by the Records list and a customer page.
 * Desktop: the Employees-style sortable table (sort lives in the URL, the database sorts).
 * Phone: stacked rows.
 */

import { Fragment, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { labelOf } from '@/lib/sales/customerLabel';
import { todayInAppTz } from '@/lib/appDate';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import type { Bootstrap, RecordRow, RecordSort } from '@/lib/sales/types';
import { DEADLINE_TONE, Select, Tag, useSalesFormat } from './parts';
import { SortTh, TD } from './SortTh';
import { DetailRow, ExpandCell, ExpandTh, type DetailItem } from './ExpandParts';
import { recordColumns } from '@/lib/sales/columns';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { LinkPending, pendingSpinnerClass } from '@/components/LinkPending';
import { nextRecordSort, RECORD_SORTS } from '@/lib/sales/recordSort';

const SORT_LABEL: Record<RecordSort, string> = {
  record_no: 'field.record_no', received_on: 'field.received_on', buyer: 'field.buyer', title: 'field.title',
  stage: 'field.stage', owner: 'field.owner', deadline: 'field.next_deadline', value: 'field.value',
};

type Props = {
  boot: Bootstrap;
  rows: RecordRow[];
  sort: RecordSort;
  dir: 'asc' | 'desc';
  /** The URL that sorts by `key` / `dir`. */
  hrefFor: (next: { sort: RecordSort; dir: 'asc' | 'desc' }) => string;
  /** The customer page leaves the company column out. */
  showBuyer?: boolean;
  testId?: string;
};

/** Phone toolbar: the headers cannot be clicked there, so a Select offers the same sorts. */
export function RecordSortSelect({ boot, sort, dir, onChange }: {
  boot: Bootstrap; sort: RecordSort; dir: 'asc' | 'desc'; onChange: (next: { sort: RecordSort; dir: 'asc' | 'desc' }) => void;
}) {
  const t = useTranslations('sales');
  return (
    <Select
      className="md:hidden"
      value={`${sort}_${dir}`}
      ariaLabel={t('list.sort')}
      testId="sales-sort-select"
      onChange={(v) => { const i = v.lastIndexOf('_'); onChange({ sort: v.slice(0, i) as RecordSort, dir: v.slice(i + 1) as 'asc' | 'desc' }); }}
    >
      {RECORD_SORTS.filter((k) => k !== 'value' || boot.caps.prices).flatMap((k) =>
        (['asc', 'desc'] as const).map((d) => (
          <option key={`${k}_${d}`} value={`${k}_${d}`}>{t(SORT_LABEL[k])} {d === 'asc' ? '↑' : '↓'}</option>
        )),
      )}
    </Select>
  );
}

export function RecordsTable({ boot, rows, sort, dir, hrefFor, showBuyer = true, testId }: Props) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  // Tap feedback while a record opens: the tapped row dims and shows a spinner.
  const [opening, startOpening] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const today = todayInAppTz();
  const stages = new Map(boot.stages.map((s) => [s.id, s]));
  const listFields = boot.fields.filter((x) => x.entity === 'rfp' && x.active && x.show_in_list);
  const { show: SHOW, detail: DET, expandHide: RECORD_EXPAND_HIDE } = recordColumns(listFields.length);
  const colCount = 10 + listFields.length;
  const dash = <span className="text-muted-foreground">—</span>;

  const deadline = (r: RecordRow) => {
    if (r.deleted_at) return <span className="text-destructive">{t('list.deletedOn', { date: f.date(r.deleted_at), name: r.deleted_by_name ?? '—' })}</span>;
    if (!r.next_deadline) return dash;
    const tone = DEADLINE_TONE[deadlineState(r.next_deadline, today, boot.settings.warn_days)];
    return <span className={tone}>{f.date(r.next_deadline)} · {f.daysText(daysLeft(r.next_deadline, today))}</span>;
  };
  const who = (r: RecordRow) => r.owner_name ?? r.in_charge_text ?? '—';
  const stageTag = (r: RecordRow) => (
    <Tag tone={r.stage_kind === 'open' ? 'neutral' : r.stage_kind === 'done' ? 'good' : 'bad'}>{f.stageName(stages.get(r.stage_id))}</Tag>
  );
  const th = (key: RecordSort, align: 'start' | 'end' = 'start', className?: string) => (
    <SortTh
      key={key}
      label={t(SORT_LABEL[key])}
      active={sort === key}
      dir={dir}
      align={align}
      className={className}
      href={hrefFor(nextRecordSort({ sort, dir }, key))}
      testId={`sales-sort-${key}`}
    />
  );
  const plain = (label: string, key: string, className?: string) => <th key={key} className={cn('px-3 py-2.5 text-start', className)}>{label}</th>;

  return (
    <>
      <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/${f.locale}/sales/${r.id}`} className="flex flex-col gap-1 py-3">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold"><bdi dir="ltr" className="tabular-nums">{f.recordNo(r.record_no)}</bdi>{showBuyer ? <> · {labelOf(r.buyer_name, r.buyer_name_en, f.locale) || '—'}</> : null}</span>
                {stageTag(r)}
              </span>
              <span dir="auto" className="text-sm">{r.title}</span>
              <span className="text-xs text-muted-foreground">{t('field.owner')}: {who(r)}</span>
              <span className="text-xs">{deadline(r)}</span>
              {boot.caps.prices && (r.total_value ?? r.our_price) !== null ? (
                <span className="text-xs tabular-nums">{t('field.value')}: {f.money(r.total_value ?? r.our_price, r.currency)}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="@container hidden border-b border-border md:block">
        <table className="data-table w-full text-sm" data-testid={testId}>
          <thead>
            <tr>
              {th('record_no')}
              {th('title')}
              {showBuyer ? th('buyer', 'start', SHOW.buyer) : null}
              {th('stage', 'start', SHOW.stage)}
              {th('owner', 'start', SHOW.owner)}
              {th('deadline', 'start', SHOW.deadline)}
              {th('received_on', 'start', SHOW.received)}
              {boot.caps.prices ? th('value', 'end', SHOW.value) : null}
              {plain(t('field.client'), 'client', SHOW.client)}
              {listFields.map((def) => plain(f.fieldLabel(def), def.key, SHOW.client))}
              <ExpandTh hideClass={RECORD_EXPAND_HIDE} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const isOpen = open.has(r.id);
              const price = f.money(r.total_value ?? r.our_price, r.currency);
              const items: DetailItem[] = [
                ...(showBuyer ? [{ key: 'buyer', label: t('field.buyer'), value: labelOf(r.buyer_name, r.buyer_name_en, f.locale) || dash, hideClass: DET.buyer }] : []),
                { key: 'stage', label: t('field.stage'), value: stageTag(r), hideClass: DET.stage },
                { key: 'owner', label: t('field.owner'), value: who(r), hideClass: DET.owner },
                { key: 'deadline', label: t('field.next_deadline'), value: deadline(r), hideClass: DET.deadline },
                { key: 'received', label: t('field.received_on'), value: f.date(r.received_on), hideClass: DET.received },
                ...(boot.caps.prices ? [{ key: 'value', label: t('field.value'), value: price, hideClass: DET.value }] : []),
                { key: 'client', label: t('field.client'), value: labelOf(r.client_name, r.client_name_en, f.locale) || dash, hideClass: DET.client },
                ...listFields.map((def) => ({ key: def.key, label: f.fieldLabel(def), value: f.custom(def, r.custom[def.key]), hideClass: DET.client })),
              ];
              return (
                <Fragment key={r.id}>
                  <tr
                    className={cn('cursor-pointer active:bg-muted', opening && openingId === r.id && 'opacity-60')}
                    data-pending={opening && openingId === r.id ? '' : undefined}
                    onClick={() => { setOpeningId(r.id); startOpening(() => router.push(`/${f.locale}/sales/${r.id}`)); }}
                  >
                    <td className={TD}>
                      <Link href={`/${f.locale}/sales/${r.id}`} className="relative inline-flex items-center gap-1.5 pe-5 font-semibold tabular-nums text-primary" dir="ltr" onClick={(e) => e.stopPropagation()}>
                        {f.recordNo(r.record_no)}
                        {opening && openingId === r.id ? (
                          <Loader2 aria-hidden className={cn(pendingSpinnerClass, 'absolute end-0')} />
                        ) : (
                          <LinkPending className="end-0" />
                        )}
                      </Link>
                    </td>
                    <td className={`${TD} max-w-[22ch] truncate`} title={r.title}><bdi>{r.title}</bdi></td>
                    {showBuyer ? <td className={cn(TD, 'max-w-[16ch] truncate', SHOW.buyer)} title={labelOf(r.buyer_name, r.buyer_name_en, f.locale) || undefined}>{labelOf(r.buyer_name, r.buyer_name_en, f.locale) || dash}</td> : null}
                    <td className={cn(TD, SHOW.stage)}>{stageTag(r)}</td>
                    <td className={cn(TD, 'max-w-[14ch] truncate', SHOW.owner)} title={who(r)}>{who(r)}</td>
                    <td className={cn(TD, SHOW.deadline)}>{deadline(r)}</td>
                    <td className={cn(TD, SHOW.received)}>{f.date(r.received_on)}</td>
                    {boot.caps.prices ? <td className={cn(TD, 'text-end tabular-nums', SHOW.value)}>{price}</td> : null}
                    <td className={cn(TD, 'max-w-[16ch] truncate', SHOW.client)} title={labelOf(r.client_name, r.client_name_en, f.locale) || undefined}>{labelOf(r.client_name, r.client_name_en, f.locale) || dash}</td>
                    {listFields.map((def) => <td key={def.key} className={cn(TD, SHOW.client)}>{f.custom(def, r.custom[def.key])}</td>)}
                    <ExpandCell id={`rec-${r.id}`} open={isOpen} hideClass={RECORD_EXPAND_HIDE} onToggle={() => toggleOpen(r.id)} testId={`sales-rexpand-${r.id}`} />
                  </tr>
                  {isOpen ? <DetailRow id={`rec-${r.id}`} colSpan={colCount} hideClass={RECORD_EXPAND_HIDE} items={items} testId={`sales-rdetails-${r.id}`} /> : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
