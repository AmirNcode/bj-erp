import { Badge } from '@/components/ui/badge';
import { STATUS_BADGE_STYLES } from '@/components/StatusBadge';
import type { SeparationStatus } from '@/lib/clearance/model';

/** Status pill for a clearance form, in the request status colours. */
const STYLE: Record<SeparationStatus, string> = {
  in_progress: STATUS_BADGE_STYLES.pending,
  awaiting_finance: STATUS_BADGE_STYLES.pending,
  completed: STATUS_BADGE_STYLES.approved,
  cancelled: STATUS_BADGE_STYLES.cancelled,
};

export function ClearanceStatus({ status, label }: { status: SeparationStatus; label: string }) {
  return (
    <Badge variant="outline" className={STYLE[status]} data-testid="clearance-status" data-status={status}>
      {label}
    </Badge>
  );
}
