// Manage list while the server reads it.
import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div data-wide className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-8 w-48" />
      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
