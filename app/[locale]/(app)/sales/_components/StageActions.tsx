'use client';

/**
 * Sales stage pages: the closing actions of the record's current stage — Next stage,
 * the bid decision, the result, reopening, and the contract's finish / hold / cancel.
 * Shown only on the current stage's page; the database checks every move again.
 */

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { decideSalesBid, moveSalesStage, setSalesResult } from '@/lib/actions/sales';
import { defaultOwner } from '@/lib/sales/stages';
import type { NextGate, PageKind } from '@/lib/sales/stagePages';
import type { Bootstrap, RecordRow, Stage } from '@/lib/sales/types';
import { Field, ModalContent, NumberInput, PersonPick, Select, useRun, useSalesFormat } from './parts';
import { labelKey } from './StageFields';

type Move = { title: string; choices: Stage[]; intro: string };

export function StageActions({ boot, record, kind, stages, gate, decisionReason }: {
  boot: Bootstrap; record: RecordRow; kind: PageKind; stages: Stage[]; gate: NextGate;
  /** The decision page's reason as typed (not yet submitted): it goes with Bid / No bid. */
  decisionReason: string | null;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [move, setMove] = useState<Move | null>(null);
  const [result, setResult] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // After a move the page follows the record: drop the pinned `?stage=` so it opens the new stage.
  const toCurrent = () => {
    const q = new URLSearchParams(window.location.search);
    q.delete('stage');
    q.delete('node');
    router.push(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const byCode = (code: string) => stages.find((s) => s.code === code && s.active);
  const moveTo = (s: Stage | undefined, title: string) => (s ? setMove({ title, choices: [s], intro: t('stagePage.confirmMove', { stage: f.stageName(s) }) }) : undefined);
  const note = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;

  let body: React.ReactNode = null;
  if (kind === 'decision') {
    body = boot.caps.decide ? (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="text-destructive max-sm:h-11 max-sm:flex-1" disabled={pending} data-testid="sales-decide-no"
          onClick={() => void run(() => decideSalesBid(record.id, false, decisionReason ?? ''), toCurrent)}>{t('decide.noBid')}</Button>
        <Button className="max-sm:h-11 max-sm:flex-1" disabled={pending} data-testid="sales-decide-yes"
          onClick={() => void run(() => decideSalesBid(record.id, true, decisionReason ?? ''), toCurrent)}>{t('decide.bid')}</Button>
      </div>
    ) : note(t('stagePage.decideOnly'));
  } else if (kind === 'submitted') {
    body = boot.caps.decide
      ? <Button className="max-sm:h-11 max-sm:w-full" onClick={() => setResult(true)} data-testid="sales-result">{t('action.result')}</Button>
      : note(t('stagePage.resultOnly'));
  } else if (kind === 'closed') {
    const open = stages.filter((s) => s.active && s.kind === 'open');
    body = boot.caps.decide && open.length > 0 ? (
      <Button variant="outline" className="max-sm:h-11 max-sm:w-full" data-testid="sales-reopen"
        onClick={() => setMove({ title: t('stagePage.reopen'), choices: open, intro: t('stagePage.reopenIntro') })}>{t('stagePage.reopen')}</Button>
    ) : null;
  } else if (kind === 'contract_current' || kind === 'contract_hold') {
    body = (
      <div className="flex flex-wrap gap-2">
        {kind === 'contract_current' ? (
          <Button variant="outline" className="max-sm:h-11 max-sm:flex-1" disabled={!boot.caps.edit || !byCode('hold')}
            onClick={() => moveTo(byCode('hold'), t('stagePage.hold'))} data-testid="sales-hold">{t('stagePage.hold')}</Button>
        ) : (
          <Button variant="outline" className="max-sm:h-11 max-sm:flex-1" disabled={!boot.caps.edit || !byCode('current')}
            onClick={() => moveTo(byCode('current'), t('stagePage.resume'))} data-testid="sales-resume">{t('stagePage.resume')}</Button>
        )}
        {boot.caps.decide && kind === 'contract_hold' ? (
          <Button variant="outline" className="text-destructive max-sm:h-11 max-sm:flex-1" disabled={!byCode('cancel')}
            onClick={() => moveTo(byCode('cancel'), t('stagePage.cancelContract'))} data-testid="sales-cancel-contract">{t('stagePage.cancelContract')}</Button>
        ) : null}
        {boot.caps.decide ? (
          <Button className="max-sm:h-11 max-sm:flex-1" disabled={!byCode('finish')}
            onClick={() => moveTo(byCode('finish'), t('stagePage.finish'))} data-testid="sales-finish">{t('stagePage.finish')}</Button>
        ) : null}
      </div>
    );
  } else if (gate.blocked !== 'end') {
    const reason = gate.blocked === 'required'
      ? t('stagePage.blocked.required', { fields: gate.missing.map((k) => fieldName(k)).join(f.locale === 'fa' ? '، ' : ', ') })
      : gate.blocked ? t(`stagePage.blocked.${gate.blocked}`) : null;
    body = (
      <div className="flex flex-col items-stretch gap-1 sm:items-end">
        <Button className="max-sm:h-11 max-sm:w-full" disabled={gate.blocked !== null || !gate.target} data-testid="sales-stage-next"
          onClick={() => gate.target && setMove({ title: t('stagePage.next'), choices: [gate.target], intro: t('stagePage.nextIntro', { stage: f.stageName(gate.target) }) })}>
          {gate.target ? t('stagePage.nextTo', { stage: f.stageName(gate.target) }) : t('stagePage.next')}
        </Button>
        {reason ? <p className="text-xs text-muted-foreground" data-testid="sales-next-blocked">{reason}</p> : null}
      </div>
    );
  }

  function fieldName(k: string) {
    const def = boot.fields.find((d) => d.entity === 'rfp' && d.key === k);
    return def ? f.fieldLabel(def) : t(`field.${labelKey(k)}` as 'field.title');
  }

  return (
    <>
      {body}
      {move ? <MoveDialog boot={boot} record={record} move={move} onClose={() => setMove(null)} onMoved={() => { setMove(null); toCurrent(); }} /> : null}
      {result ? <ResultDialog boot={boot} record={record} onClose={() => setResult(false)} onMoved={() => { setResult(false); toCurrent(); }} /> : null}
    </>
  );
}

function MoveDialog({ boot, record, move, onClose, onMoved }: { boot: Bootstrap; record: RecordRow; move: Move; onClose: () => void; onMoved: () => void }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [stageId, setStageId] = useState(move.choices[0]?.id ?? '');
  const target = move.choices.find((s) => s.id === stageId) ?? null;
  const [owner, setOwner] = useState<string | null>(defaultOwner(target, boot.people) ?? record.owner_id);
  const [text, setText] = useState('');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <ModalContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{move.title}</DialogTitle>
          <DialogDescription>{move.intro}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {move.choices.length > 1 ? (
            <Field label={t('move.to')}>
              <Select value={stageId} testId="sales-move-stage" onChange={(v) => {
                setStageId(v);
                setOwner(defaultOwner(move.choices.find((s) => s.id === v) ?? null, boot.people) ?? owner);
              }}>
                {move.choices.map((s) => <option key={s.id} value={s.id}>{f.stageName(s)}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label={t('move.owner')} hint={t('move.ownerHint')}>
            <PersonPick people={boot.people} value={owner} onChange={setOwner} testId="sales-move-owner" />
          </Field>
          <Field label={t('move.note')}>
            <Textarea rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending || !stageId} data-testid="sales-move-confirm"
            onClick={() => void run(() => moveSalesStage(record.id, stageId, owner, text, null), onMoved)}>
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </ModalContent>
    </Dialog>
  );
}

function ResultDialog({ boot, record, onClose, onMoved }: { boot: Bootstrap; record: RecordRow; onClose: () => void; onMoved: () => void }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [result, setResult] = useState<'won' | 'lost' | 'cancelled'>('won');
  const [winningBid, setWinningBid] = useState<number | null>(null);
  const [winner, setWinner] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <ModalContent className="sm:max-w-lg">
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
              <Field label={t('field.winning_bid')} hint={record.currency ? f.currencyLabel(record.currency) : undefined}>
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
            onClick={() => void run(() => setSalesResult(record.id, result, { winning_bid: winningBid, winner_name: winner, reason }), onMoved)}>
            {t('resultDialog.confirm')}
          </Button>
        </DialogFooter>
      </ModalContent>
    </Dialog>
  );
}
