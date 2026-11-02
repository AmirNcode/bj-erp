import { StatusBadge } from 'bj-erp';

const labels = {
  pending: 'در انتظار تأیید',
  approved: 'تأیید شده',
  rejected: 'رد شده',
  cancelled: 'لغو شده',
  awaitingTravel: 'در انتظار رزرو سفر',
};

export const AllStatuses = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge status="pending" labels={labels} />
    <StatusBadge status="approved" labels={labels} />
    <StatusBadge status="rejected" labels={labels} />
    <StatusBadge status="cancelled" labels={labels} />
    <StatusBadge status="awaitingTravel" labels={labels} />
  </div>
);

export const InARequestRow = () => (
  <div className="flex w-80 items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm">
    <div className="space-y-0.5">
      <p className="text-sm font-semibold">مرخصی استحقاقی</p>
      <p className="text-xs text-muted-foreground"><bdi>۱۴۰۵/۰۸/۱۲</bdi> تا <bdi>۱۴۰۵/۰۸/۱۴</bdi> · ۳ روز</p>
    </div>
    <StatusBadge status="pending" labels={labels} />
  </div>
);
