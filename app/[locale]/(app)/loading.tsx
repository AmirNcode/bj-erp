/**
 * Instant route-loading skeleton for every (app) page.
 *
 * Shown immediately on navigation while the target page's Server Component
 * renders (auth + data). Without this, a tap waits on the full server render
 * before anything paints — the "renders then shows" lag. A neutral page-shaped
 * skeleton gives instant feedback; the real content streams in to replace it.
 */

import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5" aria-hidden>
      <Skeleton className="h-8 w-44" />
      <div className="space-y-4">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={2} />
      </div>
    </div>
  );
}
