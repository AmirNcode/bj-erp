import { Badge } from '@/components/ui/badge';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';
type Labels = Record<Status, string>;

const STYLES: Record<Status, string> = {
  pending: 'bg-warning-foreground text-warning border-warning/20',
  approved: 'bg-success-foreground text-success border-success/20',
  rejected: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelled: 'bg-muted text-muted-foreground border-border',
};

export function StatusBadge({ status, labels }: { status: Status; labels: Labels }) {
  return (
    <Badge variant="outline" className={STYLES[status]}>
      {labels[status]}
    </Badge>
  );
}
