// Records list while the server reads it (header + tabs already come from sales/layout).
import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div data-wide className="contents" aria-hidden="true">
      <Skeleton className="h-9 w-full max-w-md" />
      <TableSkeleton rows={10} cols={6} />
    </div>
  );
}
