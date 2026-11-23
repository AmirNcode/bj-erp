import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Annotated section: title + explanation at the start, the fields card beside it
 * (below it under 1024px). Callers pass a `Card` as children. Stack several with
 * one Save bar after the last (see docs/DESIGN.md › Page layout and forms).
 */
export function FormSection({
  title,
  description,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn('grid gap-4 py-6 border-b last:border-b-0 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-10', className)}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
