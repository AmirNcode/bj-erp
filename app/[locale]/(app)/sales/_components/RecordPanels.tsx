'use client';

/**
 * FR-94: the record's Documents (who prepares what — no files are stored),
 * Guarantees & payments (finance), and Deadlines tabs.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import {
  deleteSalesBond, deleteSalesDeadline, deleteSalesDocument, deleteSalesPayment, saveSalesBond, saveSalesDeadline,
  saveSalesDocument, saveSalesPayment, setSalesDeadlineDone,
} from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import type {
  Bond, BondForm, BondKind, BondStatus, Bootstrap, Deadline, DocumentRow, Payment, RecordRow,
} from '@/lib/sales/types';
import { ConfirmDialog, DateInput, DEADLINE_TONE, Field, NumberInput, PersonPick, Select, Tag, useRun, useSalesFormat } from './parts';

// ───────────────────────────────────────────────────────────── documents

const DOC_STATUS = ['todo', 'in_progress', 'ready'] as const;

export function DocumentsPanel({ boot, record, documents }: { boot: Bootstrap; record: RecordRow; documents: DocumentRow[] }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const canEdit = boot.caps.edit && (record.stage_kind === 'open' || boot.caps.decide);
  const [name, setName] = useState('');
  const [assigning, setAssigning] = useState<DocumentRow | null>(null);
  const [removing, setRemoving] = useState<DocumentRow | null>(null);
  const ready = documents.filter((d) => d.status === 'ready').length;

  return (
    <div className="flex flex-col gap-3" data-testid="sales-documents">
      <p className="text-xs text-muted-foreground">{t('documents.hint')}</p>
      {documents.length > 0 ? <p className="text-sm">{t('documents.progress', { ready, total: documents.length })}</p> : null}
      {documents.length === 0 ? <EmptyState message={t('documents.empty')} /> : (
        <div className="overflow-x-auto border-b border-border">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">{t('documents.name')}</th>
                <th className="text-start">{t('documents.assignee')}</th>
                <th className="text-start">{t('documents.status')}</th>
                <th className="text-start">{t('documents.where')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {documents.map((d) => (
                <tr key={d.id} className="whitespace-nowrap">
                  <td className="font-medium">{d.name}</td>
                  <td>{d.assignee_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td>
                    {canEdit ? (
                      <Select value={d.status} className="w-36" ariaLabel={t('documents.status')} disabled={pending}
                        onChange={(v) => void run(() => saveSalesDocument(record.id, d.id, { status: v }))}>
                        {DOC_STATUS.map((s) => <option key={s} value={s}>{t(`documents.state.${s}`)}</option>)}
                      </Select>
                    ) : <Tag tone={d.status === 'ready' ? 'good' : d.status === 'in_progress' ? 'warn' : 'neutral'}>{t(`documents.state.${d.status}`)}</Tag>}
                  </td>
                  <td className="max-w-72 truncate">{d.note ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-end">
                    {canEdit ? (
                      <>
                        <Button size="xs" variant="ghost" onClick={() => setAssigning(d)}>{t('action.edit')}</Button>
                        <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving(d)}>{t('remove')}</Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveSalesDocument(record.id, null, { name }), () => setName(''));
        }}>
          <Input className="sm:w-80" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={t('documents.addPlaceholder')} aria-label={t('documents.addPlaceholder')} data-testid="sales-document-name" />
          <Button type="submit" variant="outline" className="max-sm:h-11" disabled={pending || !name.trim()}><Plus aria-hidden="true" /> {t('documents.add')}</Button>
        </form>
      ) : null}
      {assigning ? <DocumentDialog boot={boot} record={record} doc={assigning} onClose={() => setAssigning(null)} /> : null}
      {removing ? (
        <ConfirmDialog title={t('documents.removeTitle')} body={removing.name} confirmLabel={t('remove')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setRemoving(null)} onConfirm={() => void run(() => deleteSalesDocument(removing.id), () => setRemoving(null))} />
      ) : null}
    </div>
  );
}

function DocumentDialog({ boot, record, doc, onClose }: { boot: Bootstrap; record: RecordRow; doc: DocumentRow; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [name, setName] = useState(doc.name);
  const [assignee, setAssignee] = useState<string | null>(doc.assignee_id);
  const [note, setNote] = useState(doc.note ?? '');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('documents.editTitle')}</DialogTitle>
          <DialogDescription>{t('documents.hint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('documents.name')}><Input maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('documents.assignee')}><PersonPick people={boot.people} value={assignee} onChange={setAssignee} testId="sales-document-assignee" /></Field>
          <Field label={t('documents.where')} hint={t('documents.whereHint')}><Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending || !name.trim()} onClick={() => void run(() => saveSalesDocument(record.id, doc.id, { name, assignee_id: assignee, note }), onClose)}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────── guarantees and payments

const BOND_KINDS: BondKind[] = ['bid', 'performance', 'advance_payment'];
const BOND_STATUS: BondStatus[] = ['needed', 'requested', 'issued', 'delivered', 'released', 'expired', 'void'];
const BOND_FORMS: BondForm[] = ['bank', 'safteh', 'cheque'];
const bondTone = (s: BondStatus) => (s === 'needed' || s === 'requested' ? 'warn' : s === 'void' || s === 'expired' ? 'bad' : 'good');

export function FinancePanel({ boot, record, bonds, payments, show = 'both' }: {
  boot: Bootstrap; record: RecordRow; bonds: Bond[]; payments: Payment[] | undefined;
  /** Stage pages show guarantees, payments or both. */
  show?: 'bonds' | 'payments' | 'both';
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<Bond | 'new' | null>(null);
  const [paying, setPaying] = useState<Payment | 'new' | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'bond' | 'payment'; id: string; label: string } | null>(null);
  const kindLabel = (b: Bond) => `${t(`bond.kind.${b.kind}`)}${b.kind === 'advance_payment' ? ` ${f.number(b.seq)}` : ''}`;

  // Without the guarantees permission: that a guarantee exists and where it stands, nothing else.
  if (!boot.caps.bonds) {
    return (
      <div className="flex max-w-xl flex-col gap-2" data-testid="sales-finance-summary">
        <p className="text-xs text-muted-foreground">{t('bond.summaryHint')}</p>
        {bonds.length === 0 ? <EmptyState message={t('bond.empty')} /> : (
          <ul className="divide-y divide-border border-y border-border">
            {bonds.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>{kindLabel(b)}</span>
                <Tag tone={bondTone(b.status)}>{t(`bond.status.${b.status}`)}</Tag>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const paid = (payments ?? []).reduce((n, p) => n + (p.amount ?? 0), 0);
  return (
    <div className="flex flex-col gap-8" data-testid="sales-finance">
      {show !== 'payments' ? <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('bond.title')}</h3>
          {boot.caps.bonds_edit ? <Button size="sm" variant="outline" onClick={() => setEditing('new')} data-testid="sales-bond-add"><Plus aria-hidden="true" /> {t('bond.add')}</Button> : null}
        </div>
        {bonds.length === 0 ? <EmptyState message={t('bond.empty')} /> : (
          <div className="overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">{t('bond.kindLabel')}</th>
                  <th className="text-start">{t('bond.statusLabel')}</th>
                  <th className="text-start">{t('bond.form')}</th>
                  <th className="text-end tabular-nums">{t('bond.percent')}</th>
                  <th className="text-end tabular-nums">{t('bond.amount')}</th>
                  <th className="text-start">{t('bond.bank')}</th>
                  <th className="text-start">{t('bond.issuedOn')}</th>
                  <th className="text-start">{t('bond.expiresOn')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bonds.map((b) => (
                  <tr key={b.id} className="whitespace-nowrap">
                    <td className="font-medium">{kindLabel(b)}</td>
                    <td><Tag tone={bondTone(b.status)}>{t(`bond.status.${b.status}`)}</Tag></td>
                    <td>{b.form ? t(`bond.formKind.${b.form}`) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-end tabular-nums">{f.percent(b.percent)}</td>
                    <td className="text-end tabular-nums">{f.money(b.amount, b.currency)}</td>
                    <td>{[b.bank, b.number].filter(Boolean).join(' · ') || <span className="text-muted-foreground">—</span>}</td>
                    <td>{f.date(b.issued_on)}</td>
                    <td>
                      {b.expires_on ? f.date(b.expires_on)
                        : b.status === 'issued' || b.status === 'delivered' ? <span className="font-semibold text-warning">{t('bond.noExpiry')}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="text-end">
                      {boot.caps.bonds_edit ? (
                        <>
                          <Button size="xs" variant="ghost" onClick={() => setEditing(b)}>{t('action.edit')}</Button>
                          <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving({ kind: 'bond', id: b.id, label: kindLabel(b) })}>{t('remove')}</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section> : null}

      {show !== 'bonds' ? <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('payment.title')}</h3>
          {boot.caps.bonds_edit ? <Button size="sm" variant="outline" onClick={() => setPaying('new')} data-testid="sales-payment-add"><Plus aria-hidden="true" /> {t('payment.add')}</Button> : null}
        </div>
        {(payments ?? []).length === 0 ? <EmptyState message={t('payment.empty')} /> : (
          <div className="max-w-2xl overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">{t('payment.no')}</th>
                  <th className="text-end tabular-nums">{t('payment.amount')}</th>
                  <th className="text-start">{t('payment.paidOn')}</th>
                  <th className="text-start">{t('payment.note')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(payments ?? []).map((p) => (
                  <tr key={p.id} className="whitespace-nowrap">
                    <td>{f.number(p.seq)}</td>
                    <td className="text-end tabular-nums">{f.money(p.amount, record.currency)}</td>
                    <td>{f.date(p.paid_on)}</td>
                    <td className="max-w-60 truncate">{p.note ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-end">
                      {boot.caps.bonds_edit ? (
                        <>
                          <Button size="xs" variant="ghost" onClick={() => setPaying(p)}>{t('action.edit')}</Button>
                          <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving({ kind: 'payment', id: p.id, label: `${t('payment.title')} ${f.number(p.seq)}` })}>{t('remove')}</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(payments ?? []).length > 0 ? <p className="text-sm">{t('payment.total')}: <span className="font-semibold tabular-nums">{f.money(paid, record.currency)}</span></p> : null}
      </section> : null}

      {editing ? <BondDialog record={record} bond={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {paying ? <PaymentDialog record={record} payment={paying === 'new' ? null : paying} onClose={() => setPaying(null)} /> : null}
      {removing ? (
        <ConfirmDialog title={t('removeTitle')} body={removing.label} confirmLabel={t('remove')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setRemoving(null)}
          onConfirm={() => void run(() => (removing.kind === 'bond' ? deleteSalesBond(removing.id) : deleteSalesPayment(removing.id)), () => setRemoving(null))} />
      ) : null}
    </div>
  );
}

function BondDialog({ record, bond, onClose }: { record: RecordRow; bond: Bond | null; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [kind, setKind] = useState<BondKind>(bond?.kind ?? (record.flow_kind === 'bid' ? 'bid' : 'performance'));
  const [seq, setSeq] = useState<number | null>(bond?.seq ?? 1);
  const [status, setStatus] = useState<BondStatus>(bond?.status ?? 'needed');
  const [form, setForm] = useState<string>(bond?.form ?? '');
  const [percent, setPercent] = useState<number | null>(typeof bond?.percent === 'number' ? Math.round(bond.percent * 10000) / 100 : null);
  const [amount, setAmount] = useState<number | null>(bond?.amount ?? null);
  const [bank, setBank] = useState(bond?.bank ?? '');
  const [number, setNumber] = useState(bond?.number ?? '');
  const [issuedOn, setIssuedOn] = useState<string | null>(bond?.issued_on ?? null);
  const [expiresOn, setExpiresOn] = useState<string | null>(bond?.expires_on ?? null);
  const [note, setNote] = useState(bond?.note ?? '');
  const patch = {
    kind, seq: seq ?? 1, status, form: form || null, percent: percent === null ? null : percent / 100, amount,
    bank: bank || null, number: number || null, issued_on: issuedOn, expires_on: expiresOn, note: note || null,
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{bond ? t('bond.editTitle') : t('bond.add')}</DialogTitle>
          <DialogDescription>{t('bond.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('bond.kindLabel')}>
            <Select value={kind} onChange={(v) => setKind(v as BondKind)}>
              {BOND_KINDS.map((k) => <option key={k} value={k}>{t(`bond.kind.${k}`)}</option>)}
            </Select>
          </Field>
          {kind === 'advance_payment' ? <Field label={t('bond.seq')}><NumberInput value={seq} onChange={setSeq} /></Field> : <span className="hidden sm:block" />}
          <Field label={t('bond.statusLabel')}>
            <Select value={status} onChange={(v) => setStatus(v as BondStatus)} testId="sales-bond-status">
              {BOND_STATUS.map((s) => <option key={s} value={s}>{t(`bond.status.${s}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('bond.form')}>
            <Select value={form} onChange={setForm}>
              <option value="">—</option>
              {BOND_FORMS.map((k) => <option key={k} value={k}>{t(`bond.formKind.${k}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('bond.percent')} hint={t('bond.percentHint')}><NumberInput value={percent} onChange={setPercent} /></Field>
          <Field label={t('bond.amount')} hint={record.currency ? t(`currency.${record.currency}`) : undefined}><NumberInput value={amount} onChange={setAmount} /></Field>
          <Field label={t('bond.bank')}><Input maxLength={200} value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
          <Field label={t('bond.number')}><Input dir="ltr" maxLength={200} value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
          <Field label={t('bond.issuedOn')}><DateInput value={issuedOn} onChange={setIssuedOn} /></Field>
          <Field label={t('bond.expiresOn')} hint={t('bond.expiresHint')}><DateInput value={expiresOn} onChange={setExpiresOn} testId="sales-bond-expires" /></Field>
          <Field label={t('bond.note')} className="sm:col-span-2"><Input maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending} onClick={() => void run(() => saveSalesBond(record.id, bond?.id ?? null, patch), onClose)} data-testid="sales-bond-save">{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ record, payment, onClose }: { record: RecordRow; payment: Payment | null; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [amount, setAmount] = useState<number | null>(payment?.amount ?? null);
  const [paidOn, setPaidOn] = useState<string | null>(payment?.paid_on ?? null);
  const [note, setNote] = useState(payment?.note ?? '');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{payment ? t('payment.editTitle') : t('payment.add')}</DialogTitle>
          <DialogDescription>{t('payment.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('payment.amount')} hint={record.currency ? t(`currency.${record.currency}`) : undefined}><NumberInput value={amount} onChange={setAmount} /></Field>
          <Field label={t('payment.paidOn')}><DateInput value={paidOn} onChange={setPaidOn} /></Field>
          <Field label={t('payment.note')} className="sm:col-span-2"><Input maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending || amount === null} onClick={() => void run(() => saveSalesPayment(record.id, payment?.id ?? null, { amount, paid_on: paidOn, note: note || null }), onClose)}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────── deadlines

export function DeadlinesPanel({ boot, record, deadlines }: { boot: Bootstrap; record: RecordRow; deadlines: Deadline[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const today = todayInAppTz();
  // A closed record is read-only except for the decider (the database enforces it).
  const canEdit = boot.caps.edit && (record.stage_kind === 'open' || boot.caps.decide);
  const [adding, setAdding] = useState<Deadline | 'new' | null>(null);
  const [removing, setRemoving] = useState<Deadline | null>(null);
  const name = (d: Deadline) => (d.kind === 'other' ? d.label ?? t('deadline.kind.other') : t(`deadline.kind.${d.kind}`));

  return (
    <div className="flex flex-col gap-3" data-testid="sales-deadlines">
      <p className="text-xs text-muted-foreground">{t('deadline.recordHint')}</p>
      {deadlines.length === 0 ? <EmptyState message={t('deadline.empty')} /> : (
        <div className="overflow-x-auto border-b border-border">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">{t('deadline.what')}</th>
                <th className="text-start">{t('deadline.dueOn')}</th>
                <th className="text-start">{t('deadline.left')}</th>
                <th className="text-start">{t('deadline.responsible')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deadlines.map((d) => (
                <tr key={d.id} className="whitespace-nowrap">
                  <td className="font-medium">{name(d)}</td>
                  <td>{f.date(d.due_on)}</td>
                  <td>
                    {d.done_at ? <Tag tone="good">{t('deadline.done')}</Tag>
                      : <span className={DEADLINE_TONE[deadlineState(d.due_on, today, boot.settings.warn_days)]}>{f.daysText(daysLeft(d.due_on, today))}</span>}
                  </td>
                  <td>{d.responsible_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-end">
                    {canEdit ? (
                      <>
                        <Button size="xs" variant="ghost" disabled={pending} onClick={() => void run(() => setSalesDeadlineDone(d.id, !d.done_at))}>
                          {d.done_at ? t('deadline.reopen') : t('deadline.markDone')}
                        </Button>
                        {!d.auto ? (
                          <>
                            <Button size="xs" variant="ghost" onClick={() => setAdding(d)}>{t('action.edit')}</Button>
                            <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving(d)}>{t('remove')}</Button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <div><Button size="sm" variant="outline" onClick={() => setAdding('new')} data-testid="sales-deadline-add"><Plus aria-hidden="true" /> {t('deadline.add')}</Button></div>
      ) : null}
      {adding ? <DeadlineDialog boot={boot} record={record} deadline={adding === 'new' ? null : adding} onClose={() => setAdding(null)} /> : null}
      {removing ? (
        <ConfirmDialog title={t('removeTitle')} body={name(removing)} confirmLabel={t('remove')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setRemoving(null)} onConfirm={() => void run(() => deleteSalesDeadline(removing.id), () => setRemoving(null))} />
      ) : null}
    </div>
  );
}

function DeadlineDialog({ boot, record, deadline, onClose }: { boot: Bootstrap; record: RecordRow; deadline: Deadline | null; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [label, setLabel] = useState(deadline?.label ?? '');
  const [dueOn, setDueOn] = useState<string | null>(deadline?.due_on ?? null);
  const [who, setWho] = useState<string | null>(deadline ? deadline.responsible_id : record.owner_id);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{deadline ? t('deadline.editTitle') : t('deadline.add')}</DialogTitle>
          <DialogDescription>{t('deadline.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('deadline.what')}><Input maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="sales-deadline-label" /></Field>
          <Field label={t('deadline.dueOn')}><DateInput value={dueOn} onChange={setDueOn} testId="sales-deadline-due" /></Field>
          <Field label={t('deadline.responsible')}><PersonPick people={boot.people} value={who} onChange={setWho} testId="sales-deadline-who" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending || !label.trim() || !dueOn} onClick={() => void run(() => saveSalesDeadline(record.id, deadline?.id ?? null, { label, due_on: dueOn, responsible_id: who }), onClose)}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
