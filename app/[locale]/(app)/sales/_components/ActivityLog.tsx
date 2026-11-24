'use client';

/**
 * FR-94 Sales record: the activity ledger — notes, stage moves, decisions, and each
 * stage-page Submit with its changes as "Field: old → new". Price fields only say
 * "changed" (the log is readable by every Sales reader).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addSalesComment } from '@/lib/actions/sales';
import type { Bootstrap, EventRow, RecordRow } from '@/lib/sales/types';
import { useRun, useSalesFormat } from './parts';
import { FieldText, labelKey } from './StageFields';

type Change = { field: string; from?: unknown; to?: unknown; hidden?: boolean };

export function ActivityLog({ boot, record, events }: { boot: Bootstrap; record: RecordRow; events: EventRow[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [text, setText] = useState('');
  const stageName = (id: unknown) => f.stageName(boot.stages.find((s) => s.id === id));
  const when = (iso: string) => `${f.date(iso)} ${new Intl.DateTimeFormat(f.locale === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(new Date(iso))}`;

  function label(field: string) {
    if (field.startsWith('custom.')) {
      const def = boot.fields.find((d) => d.entity === 'rfp' && d.key === field.slice(7));
      return def ? f.fieldLabel(def) : field.slice(7);
    }
    return t.has(`field.${labelKey(field)}`) ? t(`field.${labelKey(field)}` as 'field.title') : field;
  }

  function line(e: EventRow): React.ReactNode {
    const b = e.body;
    switch (e.kind) {
      case 'created': return t('event.created');
      case 'import': return t('event.import');
      case 'archived': return <>{t('event.archived')}{b.from_stage ? <span className="text-muted-foreground"> · {stageName(b.from_stage)}</span> : null}</>;
      case 'deleted': return t('event.deleted');
      case 'restored': return t('event.restored');
      case 'comment': return <span className="whitespace-pre-wrap">{String(b.text ?? '')}</span>;
      case 'stage': return <>{t('event.stage', { from: stageName(b.from), to: stageName(b.to) })}{b.note ? <span className="text-muted-foreground"> · {String(b.note)}</span> : null}</>;
      case 'decision': return <>{b.bid ? t('event.decisionBid') : t('event.decisionNoBid')}{b.reason ? <span className="text-muted-foreground"> · {String(b.reason)}</span> : null}</>;
      case 'result': return <>{t('event.result', { result: t(`result.${String(b.result) as 'won' | 'lost' | 'cancelled'}`) })}{b.reason ? <span className="text-muted-foreground"> · {String(b.reason)}</span> : null}</>;
      case 'items':
        if (b.action === 'product') return t('event.item_product', { code: String(b.code ?? ''), product: String(b.product ?? '') });
        return b.action === 'columns' ? t('event.itemColumns') : t(`event.item_${String(b.action) as 'added' | 'changed' | 'removed'}`, { code: String(b.code ?? '') });
      case 'file': {
        const stage = boot.stages.find((s) => s.code === b.stage && s.flow_id === record.flow_id) ?? boot.stages.find((s) => s.code === b.stage);
        const key = b.action === 'delete' ? 'event.file_delete' : 'event.file_add';
        return <>{t.rich(key, { name: String(b.name ?? ''), n: (chunks) => <bdi className="font-medium">{chunks}</bdi> })}{stage ? <span className="text-muted-foreground"> · {f.stageName(stage)}</span> : null}</>;
      }
      case 'finance': return t(`event.finance_${String(b.what) as 'guarantee' | 'payment'}_${String(b.action) as 'added' | 'changed' | 'removed'}`);
      default: {
        const changes = Array.isArray(b.changes) ? (b.changes as Change[]) : null;
        const side = Array.isArray(b.side) ? (b.side as string[]) : [];
        if (!changes) return t('event.edit', { count: Array.isArray(b.fields) ? b.fields.length : 1 });
        return (
          <div className="flex flex-col gap-1">
            <span>
              {t('event.edit', { count: changes.length })}
              {b.stage ? <span className="text-muted-foreground"> · {t('stagePage.on', { stage: stageName(b.stage) })}</span> : null}
            </span>
            <ul className="flex flex-col gap-0.5 text-xs" data-testid="sales-event-changes">
              {changes.map((c) => (
                <li key={c.field}>
                  <span className="text-muted-foreground">{label(c.field)}: </span>
                  {c.hidden ? t('stagePage.changedHidden') : (
                    <>
                      <bdi><FieldText fieldKey={c.field} boot={boot} record={record} value={c.from} /></bdi>
                      <span aria-hidden="true"> {f.locale === 'fa' ? '←' : '→'} </span>
                      <bdi className="font-medium"><FieldText fieldKey={c.field} boot={boot} record={record} value={c.to} /></bdi>
                    </>
                  )}
                </li>
              ))}
              {side.includes('bid_bond_opened') ? <li className="text-muted-foreground">{t('stagePage.bidBondOpened')}</li> : null}
            </ul>
          </div>
        );
      }
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
          <Button pending={pending} type="submit" variant="outline" className="max-sm:h-11" disabled={pending || !text.trim()}>{t('activity.add')}</Button>
        </form>
      ) : null}
      <ol className="divide-y divide-border border-y border-border">
        {events.map((e) => (
          <li key={e.id} className="flex flex-col gap-0.5 py-2.5 text-sm" data-testid={`sales-event-${e.kind}`}>
            <div>{line(e)}</div>
            <span className="text-xs text-muted-foreground">{e.actor_name ?? '—'} · {when(e.at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
