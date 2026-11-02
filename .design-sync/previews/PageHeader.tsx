import { Button, Icons, PageHeader } from 'bj-erp';

export const WithAction = () => (
  <div className="w-[560px]">
    <PageHeader title="درخواست‌های من" action={<Button><Icons.Plus /> درخواست جدید</Button>} />
  </div>
);

export const TitleOnly = () => (
  <div className="w-[560px]">
    <PageHeader title="تقویم کاری" />
  </div>
);
