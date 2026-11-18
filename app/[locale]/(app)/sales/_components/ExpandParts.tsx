'use client';

/** Expand button cell + detail row shared by the Sales tables (see lib/sales/columns.ts). */

import { Fragment, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The chevron cell at the row end; the cell itself hides once every column fits. */
export function ExpandCell({ id, open, hideClass, onToggle, testId }: {
  id: string; open: boolean; hideClass: string; onToggle: () => void; testId?: string;
}) {
  const t = useTranslations('sales.list');
  return (
    <td className={cn('w-12 px-2 py-2.5 text-end', hideClass)} onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-expanded={open}
        aria-controls={`${id}-details`}
        aria-label={open ? t('hideDetails') : t('showDetails')}
        data-testid={testId}
        onClick={onToggle}
      >
        <ChevronDown aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
      </Button>
    </td>
  );
}

export type DetailItem = { key: string; label: string; value: ReactNode; hideClass: string };

/** The row below an open record: label / value pairs, each shown only while its column is hidden. */
export function DetailRow({ id, colSpan, hideClass, items, testId }: {
  id: string; colSpan: number; hideClass: string; items: DetailItem[]; testId?: string;
}) {
  return (
    <tr id={`${id}-details`} className={cn('bg-muted/30', hideClass)} data-testid={testId}>
      <td colSpan={colSpan} className="px-3 py-3">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
          {items.map((d) => (
            <Fragment key={d.key}>
              <dt className={cn('text-muted-foreground', d.hideClass)}>{d.label}</dt>
              <dd className={cn('min-w-0 font-medium', d.hideClass)}>{d.value}</dd>
            </Fragment>
          ))}
        </dl>
      </td>
    </tr>
  );
}

/** Empty header cell above the chevrons. */
export function ExpandTh({ hideClass }: { hideClass: string }) {
  return <th className={cn('w-12 px-2 py-2.5', hideClass)}><span className="sr-only">…</span></th>;
}
