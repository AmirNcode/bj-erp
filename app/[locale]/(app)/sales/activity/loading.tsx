// Sales activity while the first page loads.
import { CardSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
      <CardSkeleton lines={2} />
      <CardSkeleton lines={2} />
      <CardSkeleton lines={6} className="md:col-span-2" />
    </div>
  );
}
