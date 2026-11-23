'use client';

/**
 * FR-94: one Sales record. The stage bar is the navigation: each stage opens its own
 * page (`?stage=<id>`, default the record's stage) with that stage's fields, lists and,
 * on the current stage, its closing actions. Deadlines and Activity sit under every
 * page. Typed changes are kept per stage until Submit (switching stages, Back / Forward
 * and refreshes keep them); leaving the record with unsaved changes asks first.
 * Design: docs/specs/2026-11-17-sales-stage-pages-design.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { restoreSalesRecord } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { daysLeft, deadlineState } from '@/lib/sales/deadlines';
import { isDirty, pageKind } from '@/lib/sales/stagePages';
import { flowStages } from '@/lib/sales/stages';
import type { Bootstrap, RecordDetail } from '@/lib/sales/types';
import { tabClass, tabListClass } from '@/lib/ui/tabs';
import { useViewAs } from '../../_components/ViewAsContext';
import { DEADLINE_TONE, useRun, useSalesFormat } from './parts';
import { ActivityLog } from './ActivityLog';
import { FilesTab } from './FilesTab';
import { DeadlinesPanel } from './RecordPanels';
import { RemoveRecordDialog } from './RemoveRecordDialog';
import { StageBody, type DraftEntry } from './StageBody';
import { StageNav } from './StageNav';

type TabKey = 'deadlines' | 'files' | 'activity';

export function RecordView({ boot: liveBoot, detail }: { boot: Bootstrap; detail: RecordDetail }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const focusNode = params.get('node');
  const viewAs = useViewAs();
  const { run, pending: restoring } = useRun();
  const [removing, setRemoving] = useState(false);
  const r = detail.record;
  // A deleted record (admin only) reads like View as: every edit right is off, the database refuses writes anyway.
  const boot: Bootstrap = r.deleted_at
    ? { ...liveBoot, caps: { ...liveBoot.caps, edit: false, decide: false, items_edit: false, prices_edit: false, bonds_edit: false } }
    : liveBoot;
  const canRemove = liveBoot.caps.remove_records && !viewAs && !r.deleted_at;
  const today = todayInAppTz();
  const [tab, setTab] = useState<TabKey>('activity');

  // Every active stage of the flow, plus the record's own stage if it was retired since.
  const stages = flowStages(boot.stages, r.flow_id);
  const current = boot.stages.find((s) => s.id === r.stage_id);
  if (current && !stages.some((s) => s.id === current.id)) stages.push(current);
  const asked = params.get('stage');
  const selected = stages.find((s) => s.id === asked)
    ?? (focusNode ? stages.find((s) => pageKind(s) === 'technical') : undefined)
    ?? current ?? stages[0];

  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const onEntry = useCallback((stageId: string, entry: DraftEntry) => setDrafts((prev) => ({ ...prev, [stageId]: entry })), []);
  const dirtyIds = Object.keys(drafts).filter((id) => isDirty(drafts[id].base, drafts[id].draft));
  const anyDirty = useRef(false);
  const hasUnsaved = dirtyIds.length > 0;
  useEffect(() => { anyDirty.current = hasUnsaved; }, [hasUnsaved]);

  // Leaving the record with unsaved changes asks first: reloads and closing the tab
  // (beforeunload) and in-app links (a click guard that runs before Next's router).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (anyDirty.current) e.preventDefault(); };
    const guard = (e: MouseEvent) => {
      if (!anyDirty.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      if (window.confirm(t('stagePage.discard'))) { anyDirty.current = false; return; }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guard, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', guard, true);
    };
  }, [t]);

  function selectStage(id: string) {
    if (id === selected?.id) return;
    const next = new URLSearchParams(params.toString());
    next.set('stage', id);
    next.delete('node');
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const openDeadlines = detail.deadlines.filter((d) => !d.done_at);
  const bid = r.flow_kind === 'bid';
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'activity', label: t('recordTabs.activity') },
    { key: 'deadlines', label: t('recordTabs.deadlines'), count: openDeadlines.length },
    { key: 'files', label: t('recordTabs.files'), count: detail.files.length },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="sales-record">
      {r.deleted_at ? (
        <div className="flex flex-col gap-2 border border-destructive bg-destructive/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="status" data-testid="sales-deleted-banner">
          <p className="font-semibold text-destructive">{t('remove.banner', { date: f.date(r.deleted_at), name: r.deleted_by_name ?? '—' })}</p>
          {liveBoot.caps.remove_records && !viewAs ? (
            <Button variant="outline" className="max-sm:h-11" disabled={restoring} data-testid="sales-restore"
              onClick={() => void run(() => restoreSalesRecord(r.id), () => toast.success(t('remove.restoredToast')))}>
              {t('remove.restore')}
            </Button>
          ) : null}
        </div>
      ) : null}
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
        {canRemove ? (
          <Button variant="outline" className="shrink-0 border-destructive text-destructive hover:text-destructive max-sm:h-11 max-sm:w-full" onClick={() => setRemoving(true)} data-testid="sales-remove-open">
            {t('remove.button')}
          </Button>
        ) : null}
        </div>

        {selected ? <StageNav stages={stages} current={current} selectedId={selected.id} unsavedIds={dirtyIds} onSelect={selectStage} /> : null}

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

      {selected ? (
        <StageBody key={selected.id} boot={boot} detail={detail} stage={selected} stages={stages}
          focusNode={focusNode} onOpenFiles={() => setTab('files')} entry={drafts[selected.id]} onEntry={(e) => onEntry(selected.id, e)} />
      ) : null}

      <nav className={tabListClass} aria-label={t('recordTabs.label')}>
        {tabs.map((x) => (
          <button key={x.key} type="button" className={tabClass(tab === x.key)} aria-current={tab === x.key ? 'page' : undefined}
            onClick={() => setTab(x.key)} data-testid={`sales-record-tab-${x.key}`}>
            {x.label}
            {x.count ? <span className="text-xs text-muted-foreground tabular-nums">{f.number(x.count)}</span> : null}
          </button>
        ))}
      </nav>
      {tab === 'deadlines' ? <DeadlinesPanel boot={boot} record={r} deadlines={detail.deadlines} /> : null}
      {tab === 'files' ? <FilesTab boot={boot} detail={detail} /> : null}
      {tab === 'activity' ? <ActivityLog boot={boot} record={r} events={detail.events} /> : null}
      {removing ? <RemoveRecordDialog detail={detail} onClose={() => setRemoving(false)} /> : null}
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
