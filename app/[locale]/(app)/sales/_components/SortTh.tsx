'use client';

/**
 * A sortable table header in the Employees style (docs/DESIGN.md › Tables): the label plus an
 * up / down / both icon and `aria-sort`. Link mode (`href`) keeps the sort in the URL, button
 * mode (`onClick`) sorts rows already in the browser.
 */

import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const TH = 'px-3 py-2.5';
export const TD = 'whitespace-nowrap px-3 py-2.5';

type Props = {
  label: string;
  active: boolean;
  dir?: 'asc' | 'desc';
  /** `end` for numbers and money. */
  align?: 'start' | 'end';
  className?: string;
  testId?: string;
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

export function SortTh({ label, active, dir, align = 'start', className, testId, href, onClick }: Props) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  const inner = (
    <>
      {label}
      <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground/60')} />
    </>
  );
  const cls = 'inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return (
    <th
      className={cn(TH, align === 'end' ? 'text-end tabular-nums' : 'text-start', className)}
      aria-sort={!active ? 'none' : dir === 'asc' ? 'ascending' : 'descending'}
    >
      {href !== undefined ? (
        <Link href={href} replace scroll={false} data-testid={testId} className={cls}>{inner}</Link>
      ) : (
        <button type="button" onClick={onClick} data-testid={testId} className={cls}>{inner}</button>
      )}
    </th>
  );
}
