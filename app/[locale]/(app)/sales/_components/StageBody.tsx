'use client';

/**
 * Sales stage pages: one stage's page — its fields (a draft until Submit), the lists
 * that belong to it (saved row by row), and, on the record's current stage, its
 * closing actions. The draft lives in RecordView (per stage), so switching stages,
 * Back / Forward and refreshes keep what was typed; when the stored record changes,
 * untouched fields follow it (rebaseDraft).
 */

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { saveSalesStagePage } from '@/lib/actions/sales';
import { canEditKey, draftFrom, draftPatch, nextGate, pageFields, pageKind, pageMode, rebaseDraft, toRecordPatch } from '@/lib/sales/stagePages';
import type { Bootstrap, RecordDetail, Stage } from '@/lib/sales/types';
import { useRun, useSalesFormat } from './parts';
import { ItemsTab } from './ItemsTab';
import { DocumentsPanel, FinancePanel } from './RecordPanels';
import { StageActions } from './StageActions';
import { StageFieldGrid, type Draft } from './StageFields';

export type DraftEntry = { base: Draft; draft: Draft };

export function StageBody({ boot, detail, stage, stages, focusNode, entry, onEntry, onOpenFiles }: {
  boot: Bootstrap; detail: RecordDetail; stage: Stage; stages: Stage[]; focusNode: string | null;
  /** This stage's draft and the stored values it started from; undefined = untouched. */
  entry: DraftEntry | undefined;
  onEntry: (entry: DraftEntry) => void;
  /** Switches the record to its Files tab (the Received page points there). */
  onOpenFiles?: () => void;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const r = detail.record;
  const kind = pageKind(stage);
  const keys = useMemo(() => pageFields(stage, stages, boot.fields), [stage, stages, boot.fields]);
  const original = useMemo(() => draftFrom(r, keys), [r, keys]);
  const originalJson = JSON.stringify(original);
  const base = entry?.base ?? original;
  const draft = entry?.draft ?? original;
  const setDraft = (next: Draft) => onEntry({ base, draft: next });
  // The stored record moved on (Submit, a list row, someone else): follow it where untouched.
  useEffect(() => {
    if (entry && JSON.stringify(entry.base) !== originalJson) {
      onEntry({ base: original, draft: rebaseDraft(entry.base, original, entry.draft) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the stored values change
  }, [originalJson]);
  const patch = toRecordPatch(draftPatch(base, draft));
  const dirty = Object.keys(patch).length > 0;

  const mode = pageMode(stage, r, stages, boot.caps);
  const current = stages.find((s) => s.id === r.stage_id);
  const isCurrent = stage.id === r.stage_id;
  const future = !isCurrent && stage.kind === 'open' && current?.kind === 'open' && stage.position > current.position;
  const gate = nextGate(r, stages, boot.caps, dirty);
  const pricedByItems = detail.nodes.some((n) => typeof n.unit_price === 'number');
  // A stage not reached yet: its documents are read-only. Items, prices and guarantees keep
  // their own rights (engineering and finance work them at any stage).
  const listBoot: Bootstrap = future ? { ...boot, caps: { ...boot.caps, edit: false } } : boot;
  const editableKeys = keys.filter((k) => canEditKey(k, boot.caps, r, pricedByItems));
  const showSubmit = mode === 'edit' && editableKeys.length > 0;
  const notice = !boot.caps.edit ? t('stagePage.readOnly')
    : future ? t('stagePage.viewOnly')
    : r.stage_kind !== 'open' && !boot.caps.decide ? t('stagePage.closedOnly') : null;

  return (
    <section className="flex flex-col gap-5" data-testid={`sales-stage-page-${stage.code ?? stage.id}`}>
      <h3 className="text-base font-semibold">{f.stageName(stage)}</h3>
      {notice ? <p className="text-sm text-muted-foreground" data-testid="sales-stage-notice">{notice}</p> : null}
      {kind === 'generic' ? <p className="text-sm text-muted-foreground">{t('stagePage.noPage')}</p> : null}

      {kind === 'contract_new' && (r.received_on || r.submitted_on) ? (
        <dl className="grid gap-x-6 gap-y-2 border-s-[3px] border-border ps-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">{t('field.received_on')}</dt><dd>{f.date(r.received_on)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('field.submitted_on')}</dt><dd>{f.date(r.submitted_on)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('field.bid_result')}</dt><dd>{r.bid_result ? t(`result.${r.bid_result}`) : '—'}</dd></div>
        </dl>
      ) : null}

      {kind === 'decision' || (kind === 'closed' && r.flow_kind === 'bid') ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t('field.bid_decision')}: </span>
          <span className="font-semibold" data-testid="sales-decision-value">{t(`decision.${r.bid_decision}`)}</span>
          {kind === 'closed' && r.bid_result ? <> · <span className="text-muted-foreground">{t('field.bid_result')}: </span><span className="font-semibold">{t(`result.${r.bid_result}`)}</span></> : null}
        </p>
      ) : null}

      {kind === 'received' && onOpenFiles ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="sales-received-files-hint">
          {t('files.receivedHint')}
          <Button type="button" size="xs" variant="outline" onClick={onOpenFiles}>{t('files.receivedOpen')}</Button>
        </p>
      ) : null}

      <datalist id="sales-customers">
        {boot.customers.map((c) => <option key={c.id} value={c.name} />)}
      </datalist>
      <StageFieldGrid keys={keys} boot={boot} record={r} draft={draft} onChange={setDraft} editable={mode === 'edit'} pricedByItems={pricedByItems} />
      {keys.length === 0 && !['technical', 'pricing', 'ready', 'contract_current', 'contract_hold', 'closed', 'decision'].includes(kind) ? (
        <p className="text-sm text-muted-foreground">{t('stagePage.noFields')}</p>
      ) : null}

      {['technical', 'pricing', 'ready', 'contract_new', 'contract_current'].includes(kind) ? (
        <div className="flex flex-col gap-6 border-t border-border pt-5">
          {mode === 'edit' && keys.length > 0 ? <p className="text-xs text-muted-foreground">{t('stagePage.listsSaveAsYouGo')}</p> : null}
          {(kind === 'technical' || kind === 'pricing') && boot.caps.items ? (
            <ItemsTab boot={listBoot} record={r} nodes={detail.nodes} focusNode={focusNode} showPrices={kind === 'pricing'} />
          ) : null}
          {kind === 'technical' || kind === 'ready' ? <DocumentsPanel boot={listBoot} record={r} documents={detail.documents} /> : null}
          {kind === 'ready' || kind === 'contract_new' ? <FinancePanel boot={listBoot} record={r} bonds={detail.bonds} payments={detail.payments} show="bonds" /> : null}
          {kind === 'contract_current' ? <FinancePanel boot={listBoot} record={r} bonds={detail.bonds} payments={detail.payments} show="both" /> : null}
        </div>
      ) : null}

      {showSubmit || isCurrent ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {showSubmit && kind !== 'decision' ? (
              <Button pending={pending} className="max-sm:h-11 max-sm:w-full" disabled={pending || !dirty} data-testid="sales-stage-submit"
                onClick={() => void run(() => saveSalesStagePage(r.id, stage.id, patch))}>
                {t('stagePage.submit')}
              </Button>
            ) : null}
            {showSubmit && kind === 'decision' && r.bid_decision !== 'pending' ? (
              <Button pending={pending} variant="outline" className="max-sm:h-11 max-sm:w-full" disabled={pending || !dirty} data-testid="sales-stage-submit"
                onClick={() => void run(() => saveSalesStagePage(r.id, stage.id, patch))}>
                {t('stagePage.submit')}
              </Button>
            ) : null}
          </div>
          {isCurrent ? (
            <StageActions boot={boot} record={r} kind={kind} stages={stages} gate={gate}
              decisionReason={typeof draft.decision_reason === 'string' ? draft.decision_reason : null} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
