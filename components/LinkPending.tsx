'use client';

import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Spinner classes shared with rows that navigate without a <Link> (router.push in a transition). */
export const pendingSpinnerClass = 'size-3.5 animate-spin';

/**
 * Tap feedback for a <Link> whose page is still loading. Must render inside the
 * <Link> (useLinkStatus reads the nearest one). Always rendered, fixed size,
 * absolutely positioned (the link needs `relative`), only its opacity changes:
 * no layout shift.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-slot="link-pending"
      data-pending={pending ? 'true' : 'false'}
      className={cn(
        'pointer-events-none absolute top-1/2 end-2 -translate-y-1/2 transition-opacity',
        pending ? 'opacity-100 delay-100' : 'opacity-0',
        className
      )}
    >
      <Loader2 className={pendingSpinnerClass} />
    </span>
  );
}
