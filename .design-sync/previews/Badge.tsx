import { Badge, Icons } from 'bj-erp';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>جدید</Badge>
    <Badge variant="secondary">استحقاقی</Badge>
    <Badge variant="destructive">فوری</Badge>
    <Badge variant="outline">ساعتی</Badge>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="secondary"><Icons.Clock /> ۴ ساعت</Badge>
    <Badge variant="outline"><Icons.Plane /> مأموریت</Badge>
    <Badge><Icons.Check /> امضا شده</Badge>
  </div>
);

export const Count = () => (
  <div className="flex items-center gap-2 text-sm font-medium">
    درخواست‌های در انتظار
    <Badge className="tabular-nums">۷</Badge>
  </div>
);
