import { Skeleton } from 'bj-erp';

export const Shapes = () => (
  <div className="flex w-80 items-center gap-4">
    <Skeleton className="size-12 rounded-full" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  </div>
);

export const Lines = () => (
  <div className="w-80 space-y-2">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-9 w-28" />
  </div>
);
