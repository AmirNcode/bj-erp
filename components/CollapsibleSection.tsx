'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  defaultOpen?: boolean;
  /** Prefix for `${testId}-toggle` / `${testId}-content`. */
  testId: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * A page section with a full-width tappable header. Closed content stays
 * mounted (only hidden), so a half-filled form survives collapsing.
 */
export function CollapsibleSection({ title, defaultOpen = false, testId, className, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className={className}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((o) => !o)}
          data-testid={`${testId}-toggle`}
          className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 text-start text-lg font-semibold shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {title}
          <ChevronDown
            className={cn('size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div id={contentId} hidden={!open} className="mt-3" data-testid={`${testId}-content`}>
        {children}
      </div>
    </section>
  );
}
