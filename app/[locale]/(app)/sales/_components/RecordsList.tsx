'use client';

/**
 * FR-94: the Sales records list — where each project stands and who holds it.
 * Desktop: a wide table. Phone: one card per record.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { todayInAppTz } from '@/lib/appDate';
import { toAsciiDigits } from '@/lib/employees/code';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import type { Bootstrap, FlowKind, RecordRow } from '@/lib/sales/types';
import { DEADLINE_TONE, Select, Tag, useSalesFormat } from './parts';
import { RecordForm } from './RecordForm';

type StateFilter = 'open' | 'closed' | 'all';

export function RecordsList({ boot, rows }: { boot: Bootstrap; rows: RecordRow[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const today = todayInAppTz();
  const [query, setQuery] = useState('');
  const [flow, setFlow] = useState<'' | FlowKind>('');
  const [stage, setStage] = useState('');
  const [state, setState] = useState<StateFilter>('open');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState<FlowKind | null>(null);

  const stages = useMemo(() => new Map(boot.stages.map((s) => [s.id, s])), [boot.stages]);
  const flows = useMemo(() => new Map(boot.flows.map((x) => [x.id, x])), [boot.flows]);
  const listFields = boot.fields.filter((x) => x.entity === 'rfp' && x.active && x.show_in_list);
  const owners = useMemo(
    () => [...new Map(rows.filter((r) => r.owner_id).map((r) => [r.owner_id!, r.owner_name ?? ''])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'fa')),
    [rows]
  );
  const stageOptions = boot.stages.filter((s) => s.active && (!flow || flows.get(s.flow_id)?.kind === flow));

  const shown = useMemo(() => {
    const q = toAsciiDigits(query).trim().toLowerCase();
    return rows.filter((r) => {
      if (flow && r.flow_kind !== flow) return false;
      if (stage && r.stage_id !== stage) return false;
      if (state === 'open' && r.stage_kind !== 'open') return false;
      if (state === 'closed' && r.stage_kind === 'open') return false;
      if (owner && r.owner_id !== owner) return false;
      if (!q) return true;
      return [String(r.record_no), r.title, r.buyer_name, r.client_name, r.customer_ref, r.project_site, r.description,
        r.owner_name, r.in_charge_text].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [rows, query, flow, stage, state, owner]);

  const deadline = (r: RecordRow) => {
    if (!r.next_deadline) return <span className="text-muted-foreground">—</span>;
    const tone = DEADLINE_TONE[deadlineState(r.next_deadline, today, boot.settings.warn_days)];
    return <span className={tone}>{f.date(r.next_deadline)} · {f.daysText(daysLeft(r.next_deadline, today))}</span>;
  };
  const who = (r: RecordRow) => r.owner_name ?? r.in_charge_text ?? '—';
  const value = (r: RecordRow) => f.money(r.total_value ?? r.our_price, r.currency);
  const stageTag = (r: RecordRow) => (
    <Tag tone={r.stage_kind === 'open' ? 'neutral' : r.stage_kind === 'done' ? 'good' : 'bad'}>{f.stageName(stages.get(r.stage_id))}</Tag>
  );

  return (
    <div className="flex flex-col gap-4">
      {boot.caps.edit ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button className="max-sm:h-11" onClick={() => setCreating('bid')} data-testid="sales-new-rfp">{t('list.newRfp')}</Button>
          <Button variant="outline" className="max-sm:h-11" onClick={() => setCreating('contract')} data-testid="sales-new-contract">{t('list.newContract')}</Button>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} data-testid="sales-list-search" />
        <Select value={state} onChange={(v) => setState(v as StateFilter)} ariaLabel={t('list.state')}>
          <option value="open">{t('list.stateOpen')}</option>
          <option value="closed">{t('list.stateClosed')}</option>
          <option value="all">{t('list.stateAll')}</option>
        </Select>
        <Select value={flow} onChange={(v) => { setFlow(v as '' | FlowKind); setStage(''); }} ariaLabel={t('list.flow')}>
          <option value="">{t('list.flowAll')}</option>
          <option value="bid">{t('flow.bid')}</option>
          <option value="contract">{t('flow.contract')}</option>
        </Select>
        <Select value={stage} onChange={setStage} ariaLabel={t('list.stage')}>
          <option value="">{t('list.stageAll')}</option>
          {stageOptions.map((s) => <option key={s.id} value={s.id}>{f.stageName(s)}</option>)}
        </Select>
        <Select value={owner} onChange={setOwner} ariaLabel={t('list.owner')}>
          <option value="">{t('list.ownerAll')}</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="sales-list-count">{t('list.count', { shown: shown.length, total: rows.length })}</p>

      {shown.length === 0 ? (
        <EmptyState message={rows.length === 0 ? t('list.empty') : t('list.noMatch')} />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
            {shown.map((r) => (
              <li key={r.id}>
                <Link href={`/${f.locale}/sales/${r.id}`} className="flex flex-col gap-1 py-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold"><bdi dir="ltr" className="tabular-nums">{f.recordNo(r.record_no)}</bdi> · {r.buyer_name ?? '—'}</span>
                    {stageTag(r)}
                  </span>
                  <span dir="auto" className="text-sm">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{t('field.owner')}: {who(r)}</span>
                  <span className="text-xs">{deadline(r)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border-b border-border md:block">
            <table className="data-table w-full text-sm" data-testid="sales-list-table">
              <thead>
                <tr>
                  <th className="text-start">{t('field.record_no')}</th>
                  <th className="text-start">{t('field.buyer')}</th>
                  <th className="text-start">{t('field.client')}</th>
                  <th className="text-start">{t('field.title')}</th>
                  <th className="text-start">{t('field.stage')}</th>
                  <th className="text-start">{t('field.owner')}</th>
                  <th className="text-start">{t('field.next_deadline')}</th>
                  {boot.caps.prices ? <th className="text-end tabular-nums">{t('field.value')}</th> : null}
                  {listFields.map((def) => <th key={def.key} className="text-start">{f.fieldLabel(def)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <tr key={r.id} className="cursor-pointer whitespace-nowrap" onClick={() => router.push(`/${f.locale}/sales/${r.id}`)}>
                    <td><Link href={`/${f.locale}/sales/${r.id}`} className="font-semibold tabular-nums text-primary" dir="ltr" onClick={(e) => e.stopPropagation()}>{f.recordNo(r.record_no)}</Link></td>
                    <td>{r.buyer_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td>{r.client_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-72 truncate"><bdi>{r.title}</bdi></td>
                    <td>{stageTag(r)}</td>
                    <td>{who(r)}</td>
                    <td>{deadline(r)}</td>
                    {boot.caps.prices ? <td className="text-end tabular-nums">{value(r)}</td> : null}
                    {listFields.map((def) => <td key={def.key}>{f.custom(def, r.custom[def.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
