/**
 * Composable skeleton shapes for Suspense fallbacks.
 * Built from the Skeleton primitive — no external dependencies.
 */

import { Skeleton } from '@/components/ui/skeleton';

/** A card-shaped skeleton with a header row and a few content lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <Skeleton className="h-5 w-1/3" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A list of card-shaped skeletons (default 3 items). */
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} lines={2} />
      ))}
    </div>
  );
}

/** Two-column grid of cards (used on the home board). */
export function BoardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
        <div className="md:col-span-2">
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}

/** Single-card form skeleton (for pages with a single form card). */
export function FormSkeleton() {
  return (
    <div className="space-y-6">
      <CardSkeleton lines={5} />
    </div>
  );
}
