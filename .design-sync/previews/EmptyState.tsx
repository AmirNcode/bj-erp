import { Card, CardContent, CardHeader, CardTitle, EmptyState } from 'bj-erp';

export const Default = () => (
  <div className="w-96">
    <EmptyState message="درخواستی برای نمایش وجود ندارد." />
  </div>
);

export const InsideCard = () => (
  <Card className="w-96">
    <CardHeader>
      <CardTitle>درخواست‌های در انتظار تأیید</CardTitle>
    </CardHeader>
    <CardContent>
      <EmptyState message="همه درخواست‌ها بررسی شده‌اند." />
    </CardContent>
  </Card>
);
