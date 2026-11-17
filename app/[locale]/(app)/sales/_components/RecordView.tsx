'use client';

/**
 * FR-94: one Sales record — where it stands, who holds it, its deadlines, and
 * tabs for the details. Actions follow the caller's caps (the database checks
 * them again).
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { addSalesComment, decideSalesBid, moveSalesStage, setSalesResult } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import { defaultNextStage, defaultOwner, flowStages } from '@/lib/sales/stages';
import type { Bootstrap, EventRow, RecordDetail, RecordRow, Stage } from '@/lib/sales/types';
import { tabClass, tabListClass } from '@/lib/ui/tabs';
import { cn } from '@/lib/utils';
import { DateInput, DEADLINE_TONE, Field, NumberInput, PersonPick, Select, Tag, useRun, useSalesFormat } from './parts';
import { RecordForm } from './RecordForm';
import { ItemsTab } from './ItemsTab';
import { DeadlinesPanel, DocumentsPanel, FinancePanel } from './RecordPanels';

type TabKey = 'overview' | 'items' | 'documents' | 'finance' | 'deadlines' | 'activity';
type DialogKey = 'edit' | 'move' | 'decide' | 'result' | null;

export function RecordView({ boot, detail }: { boot: Bootstrap; detail: RecordDetail }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const params = useSearchParams();
  const focusNode = params.get('node');
  const r = detail.record;
  const today = todayInAppTz();
  const [tab, setTab] = useState<TabKey>(focusNode ? 'items' : 'overview');
  const [dialog, setDialog] = useState<DialogKey>(null);

  const stages = flowStages(boot.stages, r.flow_id);
  const current = boot.stages.find((s) => s.id === r.stage_id);
  const closed = r.stage_kind !== 'open';
  const bid = r.flow_kind === 'bid';
  const canEdit = boot.caps.edit && (!closed || boot.caps.decide);
  const canMove = boot.caps.edit && (!closed || boot.caps.decide) && stages.some((s) => s.id !== r.stage_id);
  const openDeadlines = detail.deadlines.filter((d) => !d.done_at);
  const pricedByItems = detail.nodes.some((n) => typeof n.unit_price === 'number');

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview', label: t('recordTabs.overview') },
    ...(boot.caps.items ? [{ key: 'items' as const, label: t('recordTabs.items'), count: detail.nodes.length }] : []),
    ...(bid || detail.documents.length > 0 ? [{ key: 'documents' as const, label: t('recordTabs.documents'), count: detail.documents.length }] : []),
    { key: 'finance', label: t('recordTabs.finance'), count: detail.bonds.length },
    { key: 'deadlines', label: t('recordTabs.deadlines'), count: openDeadlines.length },
    { key: 'activity', label: t('recordTabs.activity') },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="sales-record">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {t(`flow.${r.flow_kind}`)} · {t('field.record_no')}{' '}
              <bdi dir="ltr" className="font-semibold tabular-nums text-foreground" data-testid="sales-record-no">{f.recordNo(r.record_no)}</bdi>
              {r.revision > 0 ? <> · {t('field.revision')} {f.number(r.revision)}</> : null}
            </p>
            <h2 dir="auto" className="mt-1 text-lg font-bold leading-snug">{r.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {[r.buyer_name, r.client_name && r.client_name !== r.buyer_name ? r.client_name : null].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canMove ? <Button className="max-sm:h-11 max-sm:flex-1" onClick={() => setDialog('move')} data-testid="sales-move">{t('action.move')}</Button> : null}
            {boot.caps.decide && bid && (current?.action === 'decide' || r.stage_kind === 'no_bid' || (r.bid_decision === 'pending' && !closed)) ? (
              <Button variant="outline" className="max-sm:h-11 max-sm:flex-1" onClick={() => setDialog('decide')} data-testid="sales-decide">{t('action.decide')}</Button>
            ) : null}
            {boot.caps.decide && bid && !closed && r.bid_decision === 'bid' ? (
              <Button variant="outline" className="max-sm:h-11 max-sm:flex-1" onClick={() => setDialog('result')} data-testid="sales-result">{t('action.result')}</Button>
            ) : null}
            {canEdit ? <Button variant="outline" className="max-sm:h-11 max-sm:flex-1" onClick={() => setDialog('edit')} data-testid="sales-edit">{t('action.edit')}</Button> : null}
          </div>
        </div>

        <StageBar stages={stages} current={current} />

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label={t('field.stage')} value={f.stageName(current)} />
          <Figure label={t('field.owner')} value={r.owner_name ?? r.in_charge_text ?? '—'} />
          {boot.caps.prices ? <Figure label={bid ? t('field.our_price') : t('field.total_value')} value={f.money(bid ? r.our_price : r.total_value ?? r.our_price, r.currency)} /> : null}
          <Figure
            label={t('field.next_deadline')}
            value={openDeadlines.length === 0 ? '—' : (
              <span className={DEADLINE_TONE[deadlineState(openDeadlines[0].due_on, today, boot.settings.warn_days)]}>
                {f.date(openDeadlines[0].due_on)} · {f.daysText(daysLeft(openDeadlines[0].due_on, today))}
              </span>
            )}
          />
        </dl>
      </header>

      <nav className={tabListClass} aria-label={t('recordTabs.label')}>
        {tabs.map((x) => (
          <button key={x.key} type="button" className={tabClass(tab === x.key)} aria-current={tab === x.key ? 'page' : undefined}
            onClick={() => setTab(x.key)} data-testid={`sales-record-tab-${x.key}`}>
            {x.label}
            {x.count ? <span className="text-xs text-muted-foreground tabular-nums">{f.number(x.count)}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <Overview boot={boot} r={r} /> : null}
      {tab === 'items' ? <ItemsTab boot={boot} record={r} nodes={detail.nodes} focusNode={focusNode} /> : null}
      {tab === 'documents' ? <DocumentsPanel boot={boot} record={r} documents={detail.documents} /> : null}
      {tab === 'finance' ? <FinancePanel boot={boot} record={r} bonds={detail.bonds} payments={detail.payments} /> : null}
      {tab === 'deadlines' ? <DeadlinesPanel boot={boot} record={r} deadlines={detail.deadlines} /> : null}
      {tab === 'activity' ? <Activity boot={boot} record={r} events={detail.events} /> : null}

      <Dialog open={dialog === 'edit'} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t('action.edit')}</DialogTitle>
            <DialogDescription>{t('form.editIntro')}</DialogDescription>
          </DialogHeader>
          {dialog === 'edit' ? (
            <RecordForm boot={boot} record={r} flowKind={r.flow_kind} pricedByItems={pricedByItems} onCancel={() => setDialog(null)} onDone={() => setDialog(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
      {dialog === 'move' ? <MoveDialog boot={boot} r={r} stages={stages} onClose={() => setDialog(null)} /> : null}
      {dialog === 'decide' ? <DecideDialog r={r} onClose={() => setDialog(null)} /> : null}
      {dialog === 'result' ? <ResultDialog boot={boot} r={r} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-s-[3px] border-primary ps-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}

/** The flow's open stages in order, the current one marked; a closed stage shows as a tag. */
function StageBar({ stages, current }: { stages: Stage[]; current: Stage | undefined }) {
  const f = useSalesFormat();
  const open = stages.filter((s) => s.kind === 'open');
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs" data-testid="sales-stage-bar">
      {open.map((s, i) => {
        const here = s.id === current?.id;
        const past = current?.kind === 'open' ? s.position < current.position : true;
        return (
          <span key={s.id} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden="true" className="text-border">—</span> : null}
            <span
              aria-current={here ? 'step' : undefined}
              className={cn('rounded-sm px-2 py-1 whitespace-nowrap',
                here ? 'bg-primary font-semibold text-primary-foreground' : past ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground')}
            >
              {f.stageName(s)}
            </span>
          </span>
        );
      })}
      {current && current.kind !== 'open' ? (
        <span className="ms-2"><Tag tone={current.kind === 'done' ? 'good' : 'bad'}>{f.stageName(current)}</Tag></span>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children ?? '—'}</dd>
    </div>
  );
}

function Overview({ boot, r }: { boot: Bootstrap; r: RecordRow }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const yn = (v: boolean | null) => (v === null ? '—' : v ? t('yes') : t('no'));
  const fields = boot.fields.filter((d) => d.entity === 'rfp' && (d.active || r.custom[d.key] !== undefined));
  const delivery = r.delivery_amount !== null && r.delivery_unit
    ? `${f.number(r.delivery_amount)} ${t(`unit.${r.delivery_unit}`)}`
    : r.delivery_text ? `${r.delivery_text}${r.delivery_unit ? ` ${t(`unit.${r.delivery_unit}`)}` : ''}` : '—';
  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
      <dl className="divide-y divide-border">
        <Row label={t('field.buyer')}>
          {r.buyer_name ?? '—'}{r.buyer_kind ? <> <Tag>{t(`customerKind.${r.buyer_kind}`)}</Tag></> : null}
        </Row>
        <Row label={t('field.client')}>{r.client_name ?? '—'}</Row>
        <Row label={t('field.customer_ref')}><bdi dir="ltr">{r.customer_ref ?? '—'}</bdi></Row>
        <Row label={t('field.project_site')}>{r.project_site ?? '—'}</Row>
        <Row label={t('field.description')}><span className="whitespace-pre-wrap">{r.description ?? '—'}</span></Row>
        <Row label={t('field.owner')}>{r.owner_name ?? r.in_charge_text ?? '—'}</Row>
        <Row label={t('field.currency')}>{r.currency ? t(`currency.${r.currency}`) : '—'}</Row>
        {fields.map((d) => <Row key={d.key} label={f.fieldLabel(d)}>{f.custom(d, r.custom[d.key])}</Row>)}
      </dl>
      <dl className="divide-y divide-border">
        {r.flow_kind === 'bid' || r.received_on || r.proposal_due || r.submitted_on ? (
          <>
            <Row label={t('field.source')}>{r.source ? t(`source.${r.source}`) : '—'}</Row>
            <Row label={t('field.received_on')}>{f.date(r.received_on)}</Row>
            <Row label={t('field.bid_decision')}>
              {t(`decision.${r.bid_decision}`)}{r.decision_reason ? <span className="text-muted-foreground"> · {r.decision_reason}</span> : null}
            </Row>
            <Row label={t('field.proposal_due')}>{f.date(r.proposal_due)}</Row>
            <Row label={t('field.needs_quote')}>{r.needs_quote ? `${t('yes')}${r.quote_due ? ` · ${f.date(r.quote_due)}` : ''}` : t('no')}</Row>
            <Row label={t('field.needs_bond')}>{r.needs_bond ? `${t('yes')}${r.bond_due ? ` · ${f.date(r.bond_due)}` : ''}` : t('no')}</Row>
            <Row label={t('field.submitted_on')}>
              {r.submitted_on ? `${f.date(r.submitted_on)}${r.delivery_method ? ` · ${t(`delivery.${r.delivery_method}`)}` : ''}${r.received_by ? ` · ${r.received_by}` : ''}` : '—'}
            </Row>
            <Row label={t('field.validity_days')}>{r.validity_days ? t('daysCount', { days: r.validity_days }) : '—'}</Row>
            {r.flow_kind === 'bid' || r.bid_decision === 'bid' ? (
              <Row label={t('field.bid_result')}>
                {r.bid_result ? t(`result.${r.bid_result}`) : '—'}{r.result_reason ? <span className="text-muted-foreground"> · {r.result_reason}</span> : null}
              </Row>
            ) : null}
            {boot.caps.prices ? (
              <>
                <Row label={t('field.our_price')}>{f.money(r.our_price, r.currency)}</Row>
                <Row label={t('field.winning_bid')}>{f.money(r.winning_bid, r.currency)}{r.winner_name ? ` · ${r.winner_name}` : ''}</Row>
              </>
            ) : null}
          </>
        ) : null}
        {r.flow_kind === 'contract' ? (
          <>
            {boot.caps.prices ? <Row label={t('field.total_value')}>{f.money(r.total_value, r.currency)}</Row> : null}
            <Row label={t('field.order_date')}>{f.date(r.order_date)}</Row>
            <Row label={t('field.contract_start')}>{f.date(r.contract_start)}</Row>
            <Row label={t('field.delivery_duration')}>{delivery}</Row>
            <Row label={t('field.delivery_date')}>{f.date(r.delivery_date)}</Row>
            <Row label={t('field.prepayment')}>{yn(r.prepayment)}{r.prepayment_date ? ` · ${f.date(r.prepayment_date)}` : ''}</Row>
            <Row label={t('field.addendum')}>{yn(r.addendum)}</Row>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function Activity({ boot, record, events }: { boot: Bootstrap; record: RecordRow; events: EventRow[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [text, setText] = useState('');
  const stageName = (id: unknown) => f.stageName(boot.stages.find((s) => s.id === id));
  const when = (iso: string) => `${f.date(iso)} ${new Intl.DateTimeFormat(f.locale === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(iso))}`;

  function line(e: EventRow): React.ReactNode {
    const b = e.body;
    switch (e.kind) {
      case 'created': return t('event.created');
      case 'import': return t('event.import');
      case 'comment': return <span className="whitespace-pre-wrap">{String(b.text ?? '')}</span>;
      case 'stage': return <>{t('event.stage', { from: stageName(b.from), to: stageName(b.to) })}{b.note ? <span className="text-muted-foreground"> · {String(b.note)}</span> : null}</>;
      case 'decision': return <>{b.bid ? t('event.decisionBid') : t('event.decisionNoBid')}{b.reason ? <span className="text-muted-foreground"> · {String(b.reason)}</span> : null}</>;
      case 'result': return <>{t('event.result', { result: t(`result.${String(b.result) as 'won' | 'lost' | 'cancelled'}`) })}{b.reason ? <span className="text-muted-foreground"> · {String(b.reason)}</span> : null}</>;
      case 'items': return b.action === 'columns' ? t('event.itemColumns') : t(`event.item_${String(b.action) as 'added' | 'changed' | 'removed'}`, { code: String(b.code ?? '') });
      case 'finance': return t(`event.finance_${String(b.what) as 'guarantee' | 'payment'}_${String(b.action) as 'added' | 'changed' | 'removed'}`);
      default: return t('event.edit', { count: Array.isArray(b.fields) ? b.fields.length : 1 });
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {boot.caps.edit && (record.stage_kind === 'open' || boot.caps.decide) ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); void run(() => addSalesComment(record.id, text), () => setText('')); }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t('activity.placeholder')} aria-label={t('activity.placeholder')} data-testid="sales-comment" />
          <Button type="submit" variant="outline" className="max-sm:h-11" disabled={pending || !text.trim()}>{t('activity.add')}</Button>
        </form>
      ) : null}
      <ol className="divide-y divide-border border-y border-border">
        {events.map((e) => (
          <li key={e.id} className="flex flex-col gap-0.5 py-2.5 text-sm">
            <span>{line(e)}</span>
            <span className="text-xs text-muted-foreground">{e.actor_name ?? '—'} · {when(e.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MoveDialog({ boot, r, stages, onClose }: { boot: Bootstrap; r: RecordRow; stages: Stage[]; onClose: () => void }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  // A bid closes through the decision or the result, never by a plain move.
  const targets = stages.filter((s) => s.id !== r.stage_id && (r.flow_kind === 'contract' ? s.kind === 'open' || boot.caps.decide : s.kind === 'open'));
  const suggested = defaultNextStage(boot.stages, r.stage_id, r.needs_quote) ?? targets[0] ?? null;
  const [stageId, setStageId] = useState(suggested?.id ?? '');
  const target = stages.find((s) => s.id === stageId) ?? null;
  const [owner, setOwner] = useState<string | null>(defaultOwner(suggested, boot.people) ?? r.owner_id);
  const [note, setNote] = useState('');
  const [submittedOn, setSubmittedOn] = useState<string | null>(r.submitted_on ?? todayInAppTz());
  const [method, setMethod] = useState<string>(r.delivery_method ?? 'hand');
  const [receivedBy, setReceivedBy] = useState(r.received_by ?? '');
  const [validity, setValidity] = useState<number | null>(r.validity_days ?? boot.settings.validity_days);
  const submit = target?.action === 'submit';

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('action.move')}</DialogTitle>
          <DialogDescription>{t('move.intro')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('move.to')}>
            <Select value={stageId} testId="sales-move-stage" onChange={(v) => {
              setStageId(v);
              const next = stages.find((s) => s.id === v) ?? null;
              setOwner(defaultOwner(next, boot.people) ?? owner);
            }}>
              {targets.map((s) => <option key={s.id} value={s.id}>{f.stageName(s)}</option>)}
            </Select>
          </Field>
          <Field label={t('move.owner')} hint={t('move.ownerHint')}>
            <PersonPick people={boot.people} value={owner} onChange={setOwner} testId="sales-move-owner" />
          </Field>
          {submit ? (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <Field label={t('field.submitted_on')}><DateInput value={submittedOn} onChange={setSubmittedOn} /></Field>
              <Field label={t('field.delivery_method')}>
                <Select value={method} onChange={setMethod}>
                  <option value="hand">{t('delivery.hand')}</option>
                  <option value="courier">{t('delivery.courier')}</option>
                </Select>
              </Field>
              <Field label={t('field.received_by')}><Input maxLength={200} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} /></Field>
              <Field label={t('field.validity_days')} hint={t('move.validityHint')}><NumberInput value={validity} onChange={setValidity} /></Field>
            </div>
          ) : null}
          <Field label={t('move.note')}>
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button
            disabled={pending || !stageId}
            data-testid="sales-move-confirm"
            onClick={() => void run(() => moveSalesStage(r.id, stageId, owner, note,
              submit ? { submitted_on: submittedOn, delivery_method: method, received_by: receivedBy, validity_days: validity } : null), onClose)}
          >
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ r, onClose }: { r: RecordRow; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('action.decide')}</DialogTitle>
          <DialogDescription>{t('decide.intro')}</DialogDescription>
        </DialogHeader>
        <Field label={t('decide.reason')}>
          <Textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="sales-decide-reason" />
        </Field>
        <DialogFooter>
          <Button variant="outline" className="text-destructive" disabled={pending} data-testid="sales-decide-no"
            onClick={() => void run(() => decideSalesBid(r.id, false, reason), onClose)}>{t('decide.noBid')}</Button>
          <Button disabled={pending} data-testid="sales-decide-yes"
            onClick={() => void run(() => decideSalesBid(r.id, true, reason), onClose)}>{t('decide.bid')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultDialog({ boot, r, onClose }: { boot: Bootstrap; r: RecordRow; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [result, setResult] = useState<'won' | 'lost' | 'cancelled'>('won');
  const [winningBid, setWinningBid] = useState<number | null>(null);
  const [winner, setWinner] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('action.result')}</DialogTitle>
          <DialogDescription>{t('resultDialog.intro')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('field.bid_result')}>
            <Select value={result} onChange={(v) => setResult(v as typeof result)} testId="sales-result-kind">
              <option value="won">{t('result.won')}</option>
              <option value="lost">{t('result.lost')}</option>
              <option value="cancelled">{t('result.cancelled')}</option>
            </Select>
          </Field>
          {result !== 'cancelled' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('field.winning_bid')} hint={r.currency ? t(`currency.${r.currency}`) : undefined}>
                <NumberInput value={winningBid} onChange={setWinningBid} />
              </Field>
              {result === 'lost' ? (
                <Field label={t('field.winner_name')}><Input maxLength={200} value={winner} onChange={(e) => setWinner(e.target.value)} /></Field>
              ) : null}
            </div>
          ) : null}
          <Field label={t('resultDialog.reason')}>
            <Textarea rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {result === 'won' ? <p className="text-xs text-muted-foreground">{t('resultDialog.wonHint')}</p> : null}
          {!boot.caps.prices ? <p className="text-xs text-muted-foreground">{t('resultDialog.pricesHidden')}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending} data-testid="sales-result-confirm"
            onClick={() => void run(() => setSalesResult(r.id, result, { winning_bid: winningBid, winner_name: winner, reason }), onClose)}>
            {t('resultDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
