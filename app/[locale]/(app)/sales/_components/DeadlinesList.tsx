'use client';

/** FR-94: every open deadline across the Sales records, soonest first. */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { labelOf } from '@/lib/sales/customerLabel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { setSalesDeadlineDone } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import type { Bootstrap, DeadlineKind, DeadlineRow } from '@/lib/sales/types';
import { subTabClass, subTabListClass } from '@/lib/ui/tabs';
import { DEADLINE_TONE, Select, useRun, useSalesFormat } from './parts';

const KINDS: DeadlineKind[] = ['proposal_due', 'quote_due', 'bond_due', 'offer_valid_until', 'bond_expires', 'delivery_due', 'other'];

export function DeadlinesList({ boot, rows }: { boot: Bootstrap; rows: DeadlineRow[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const today = todayInAppTz();
  const [mine, setMine] = useState(false);
  const [kind, setKind] = useState('');
  const [window, setWindow] = useState<'all' | 'attention'>('all');
  const name = (d: DeadlineRow) => (d.kind === 'other' ? d.label ?? t('deadline.kind.other') : t(`deadline.kind.${d.kind}`));
  const stages = useMemo(() => new Map(boot.stages.map((s) => [s.id, s])), [boot.stages]);

  const shown = rows.filter((d) =>
    (!mine || d.responsible_id === boot.me) && (!kind || d.kind === kind)
    && (window === 'all' || deadlineState(d.due_on, today, boot.settings.warn_days) !== 'ok'));
  const overdue = rows.filter((d) => daysLeft(d.due_on, today) < 0).length;
  const soon = rows.filter((d) => deadlineState(d.due_on, today, boot.settings.warn_days) === 'soon').length;

  return (
    <div className="flex flex-col gap-4" data-testid="sales-deadlines-page">
      <dl className="grid max-w-xl grid-cols-3 gap-4">
        <div className="border-s-[3px] border-destructive ps-3"><dt className="text-xs text-muted-foreground">{t('deadline.overdue')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(overdue)}</dd></div>
        <div className="border-s-[3px] border-warning ps-3"><dt className="text-xs text-muted-foreground">{t('deadline.soon', { days: boot.settings.warn_days })}</dt><dd className="text-lg font-bold tabular-nums">{f.number(soon)}</dd></div>
        <div className="border-s-[3px] border-primary ps-3"><dt className="text-xs text-muted-foreground">{t('deadline.allOpen')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(rows.length)}</dd></div>
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className={subTabListClass}>
          <button type="button" className={subTabClass(!mine)} onClick={() => setMine(false)}>{t('deadline.everyone')}</button>
          <button type="button" className={subTabClass(mine)} onClick={() => setMine(true)} data-testid="sales-deadlines-mine">{t('deadline.mine')}</button>
        </div>
        <Select value={window} onChange={(v) => setWindow(v as 'all' | 'attention')} ariaLabel={t('deadline.window')} className="sm:w-56">
          <option value="all">{t('deadline.windowAll')}</option>
          <option value="attention">{t('deadline.windowAttention')}</option>
        </Select>
        <Select value={kind} onChange={setKind} ariaLabel={t('deadline.what')} className="sm:w-56">
          <option value="">{t('deadline.kindAll')}</option>
          {KINDS.map((k) => <option key={k} value={k}>{t(`deadline.kind.${k}`)}</option>)}
        </Select>
      </div>
      {shown.length === 0 ? <EmptyState message={rows.length === 0 ? t('deadline.emptyAll') : t('list.noMatch')} /> : (
        <>
          <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
            {shown.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-3 text-sm">
                <Link href={`/${f.locale}/sales/${d.rfp_id}`} className="font-semibold">
                  <bdi dir="ltr" className="tabular-nums">{f.recordNo(d.record_no)}</bdi> · {name(d)}
                </Link>
                <span className="text-muted-foreground">{d.title}</span>
                <span className={DEADLINE_TONE[deadlineState(d.due_on, today, boot.settings.warn_days)]}>{f.date(d.due_on)} · {f.daysText(daysLeft(d.due_on, today))}</span>
                <span className="text-xs text-muted-foreground">{d.responsible_name ?? '—'}</span>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border-b border-border md:block">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">{t('deadline.dueOn')}</th>
                  <th className="text-start">{t('deadline.left')}</th>
                  <th className="text-start">{t('deadline.what')}</th>
                  <th className="text-start">{t('field.record_no')}</th>
                  <th className="text-start">{t('field.title')}</th>
                  <th className="text-start">{t('field.buyer')}</th>
                  <th className="text-start">{t('field.stage')}</th>
                  <th className="text-start">{t('deadline.responsible')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((d) => (
                  <tr key={d.id} className="whitespace-nowrap">
                    <td>{f.date(d.due_on)}</td>
                    <td className={DEADLINE_TONE[deadlineState(d.due_on, today, boot.settings.warn_days)]}>{f.daysText(daysLeft(d.due_on, today))}</td>
                    <td className="font-medium">{name(d)}</td>
                    <td><Link href={`/${f.locale}/sales/${d.rfp_id}`} className="font-semibold tabular-nums text-primary" dir="ltr">{f.recordNo(d.record_no)}</Link></td>
                    <td className="max-w-72 truncate"><bdi>{d.title}</bdi></td>
                    <td>{labelOf(d.buyer_name, d.buyer_name_en, f.locale) || <span className="text-muted-foreground">—</span>}</td>
                    <td>{f.stageName(stages.get(d.stage_id))}</td>
                    <td>{d.responsible_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-end">
                      {boot.caps.edit ? <Button size="xs" variant="ghost" disabled={pending} onClick={() => void run(() => setSalesDeadlineDone(d.id, true))}>{t('deadline.markDone')}</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
