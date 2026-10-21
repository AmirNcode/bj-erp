import { Badge } from '@/components/ui/badge';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type Labels = Record<Status, string>;
/** FR-70: approved, but procurement has not finished the travel booking. */
type BadgeStatus = Status | 'awaitingTravel';

/** Status colours, exported for other pills that borrow them (e.g. a pending count). */
export const STATUS_BADGE_STYLES: Record<Status, string> = {
  pending: 'bg-warning-foreground text-warning border-warning/20',
  approved: 'bg-success-foreground text-success border-success/20',
  rejected: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

export function StatusBadge({
  status,
  labels,
}: {
  status: BadgeStatus;
  labels: Labels & { awaitingTravel?: string };
}) {
  const style = status === 'awaitingTravel' ? STATUS_BADGE_STYLES.pending : STATUS_BADGE_STYLES[status];
  const label = status === 'awaitingTravel' ? labels.awaitingTravel ?? labels.approved : labels[status];
  return (
    <Badge variant="outline" className={style}>
      {label}
    </Badge>
  );
}
