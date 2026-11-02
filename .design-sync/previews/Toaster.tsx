import { useEffect } from 'react';
import { Toaster, toast } from 'bj-erp';

/** Fires three toasts on mount (they stay open) so the stack is visible. */
export const Stack = () => {
  useEffect(() => {
    toast('پیش‌نویس ذخیره شد', { duration: Infinity });
    toast.error('ارسال ناموفق بود. دوباره تلاش کنید.', { duration: Infinity });
    toast.success('درخواست مرخصی ثبت شد', { description: 'برای تأیید به مدیر مستقیم ارسال شد.', duration: Infinity });
  }, []);
  return <Toaster position="top-center" expand dir="rtl" />;
};
