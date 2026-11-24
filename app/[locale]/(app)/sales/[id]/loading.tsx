// One Sales record while the server reads it.
import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-10 w-full" />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={3} />
    </div>
  );
}
