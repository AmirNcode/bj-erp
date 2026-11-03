/** Small server-renderable pieces shared by the admin tabs. */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Section({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A labelled number. `tone` flags a value that needs attention. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone === 'warning' ? 'text-warning' : 'text-foreground')}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Segmented links that set one search param (ranges, filters). */
export function PillLinks({
  items,
  label,
}: {
  items: { key: string; href: string; label: string; active: boolean }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex w-fit max-w-full flex-wrap gap-1 rounded-[10px] bg-muted p-[3px]">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'inline-flex h-9 items-center whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors sm:h-[30px]',
            item.active ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** "Newer / Page x of y / Older" for the logs. Hidden when there is one page. */
export function Pager({
  page,
  pages,
  hrefFor,
  labels,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  labels: { newer: string; older: string; page: string };
}) {
  if (pages <= 1) return null;
  const link = 'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted';
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link className={link} href={hrefFor(page - 1)}>{labels.newer}</Link> : <span />}
      <span className="text-muted-foreground">{labels.page}</span>
      {page < pages ? <Link className={link} href={hrefFor(page + 1)}>{labels.older}</Link> : <span />}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </p>
  );
}
