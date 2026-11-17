'use client';

/**
 * Sales stage pages: the stage bar. Every open stage of the record's flow is a button
 * that opens its page; the record's own stage is filled, passed stages are marked,
 * stages not reached yet are muted. A closed stage shows (and opens) as a tag.
 */

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { Stage } from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { useSalesFormat } from './parts';

export function StageNav({ stages, current, selectedId, unsavedIds, onSelect }: {
  stages: Stage[]; current: Stage | undefined; selectedId: string;
  /** Stages with typed changes not yet submitted: marked with a dot. */
  unsavedIds: string[];
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const open = stages.filter((s) => s.kind === 'open');
  const closed = current && current.kind !== 'open' ? current : null;
  return (
    <nav aria-label={t('stagePage.label')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="sales-stage-bar">
      <ol className="flex items-center gap-1 text-xs whitespace-nowrap">
        {open.map((s, i) => {
          const here = s.id === current?.id;
          const past = current?.kind === 'open' ? s.position < current.position : true;
          const selected = s.id === selectedId;
          return (
            <li key={s.id} className="flex items-center gap-1">
              {i > 0 ? <span aria-hidden="true" className="text-border">—</span> : null}
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={here ? 'step' : undefined}
                aria-pressed={selected}
                data-testid={`sales-stage-${s.code ?? s.id}`}
                className={cn(
                  'flex items-center gap-1 rounded-sm px-2 py-1 outline-offset-2 transition-colors max-sm:py-2',
                  here ? 'bg-primary font-semibold text-primary-foreground'
                    : past ? 'bg-secondary text-secondary-foreground hover:bg-secondary/70'
                    : 'text-muted-foreground hover:bg-muted',
                  selected && !here && 'ring-2 ring-primary',
                  selected && here && 'ring-2 ring-primary ring-offset-2',
                )}
              >
                {past && !here ? <Check aria-hidden="true" className="size-3" /> : null}
                {f.stageName(s)}
                {unsavedIds.includes(s.id) ? (
                  <span className="size-1.5 rounded-full bg-warning" title={t('stagePage.unsaved')} data-testid="sales-stage-unsaved">
                    <span className="sr-only">{t('stagePage.unsaved')}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {closed ? (
          <li className="ms-2">
            <button
              type="button"
              onClick={() => onSelect(closed.id)}
              aria-current="step"
              aria-pressed={closed.id === selectedId}
              data-testid={`sales-stage-${closed.code ?? closed.id}`}
              className={cn('rounded-sm px-2 py-1 font-semibold max-sm:py-2',
                closed.kind === 'done' ? 'bg-success-foreground text-success' : 'bg-destructive/10 text-destructive',
                closed.id === selectedId && 'ring-2 ring-primary')}
            >
              {f.stageName(closed)}
            </button>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
