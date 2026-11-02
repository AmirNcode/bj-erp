import {
  Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from 'bj-erp';

export const LeaveBalance = () => (
  <Card className="w-96">
    <CardHeader>
      <CardTitle>مانده مرخصی</CardTitle>
      <CardDescription>سال ۱۴۰۵ — به‌روز شده تا امروز</CardDescription>
      <CardAction><Badge variant="secondary">استحقاقی</Badge></CardAction>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">باقی‌مانده</span>
        <span className="text-2xl font-bold text-primary">۱۸ روز و ۴ ساعت</span>
      </div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">استفاده شده</span>
        <span className="font-medium">۸ روز</span>
      </div>
    </CardContent>
    <CardFooter className="gap-2">
      <Button className="flex-1">درخواست مرخصی</Button>
      <Button variant="outline">سوابق</Button>
    </CardFooter>
  </Card>
);

export const Simple = () => (
  <Card className="w-96">
    <CardHeader>
      <CardTitle>اطلاعیه منابع انسانی</CardTitle>
      <CardDescription>تعطیلی رسمی پنجشنبه ۱۵ آبان</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm leading-relaxed">
        به اطلاع همکاران می‌رساند به مناسبت تعطیلی رسمی، کارخانه روز پنجشنبه تعطیل است.
        درخواست‌های مرخصی این روز به‌صورت خودکار محاسبه نمی‌شوند.
      </p>
    </CardContent>
  </Card>
);
