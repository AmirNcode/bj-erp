import { Button, Icons } from 'bj-erp';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>ثبت درخواست</Button>
    <Button variant="secondary">پیش‌نویس</Button>
    <Button variant="outline">انصراف</Button>
    <Button variant="ghost">جزئیات</Button>
    <Button variant="destructive">رد درخواست</Button>
    <Button variant="link">مشاهده همه</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="xs">خیلی کوچک</Button>
    <Button size="sm">کوچک</Button>
    <Button>معمولی</Button>
    <Button size="lg">بزرگ</Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button><Icons.Plus /> درخواست جدید</Button>
    <Button variant="outline">ارسال برای تأیید <Icons.ArrowLeft /></Button>
    <Button variant="destructive" size="icon" aria-label="حذف"><Icons.Trash2 /></Button>
    <Button variant="outline" size="icon-sm" aria-label="بارگذاری مجدد"><Icons.RefreshCw /></Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>ثبت درخواست</Button>
    <Button variant="outline" disabled>انصراف</Button>
  </div>
);
