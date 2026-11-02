import { TriStateToggle } from 'bj-erp';

const labels = {
  edit: 'مجاز',
  read: 'فقط مشاهده',
  none: 'غیرمجاز',
  noRead: 'این مورد سطح «فقط مشاهده» ندارد',
  noEdit: 'این مورد فقط قابل مشاهده است',
};
const noop = () => {};

export const PermissionRows = () => (
  <div className="w-96 divide-y rounded-xl border bg-card">
    {[
      { name: 'درخواست‌های مرخصی', shape: 'RE', value: 'edit' },
      { name: 'گزارش‌ها', shape: 'R', value: 'read' },
      { name: 'تأیید درخواست', shape: 'E', value: 'none' },
    ].map((r) => (
      <div key={r.name} className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-medium">{r.name}</span>
        <TriStateToggle name={r.name} shape={r.shape as 'RE'} value={r.value as 'edit'} onChange={noop} labels={labels} />
      </div>
    ))}
  </div>
);

export const Values = () => (
  <div className="flex items-center gap-4">
    <TriStateToggle name="مجاز" shape="RE" value="edit" onChange={noop} labels={labels} />
    <TriStateToggle name="فقط مشاهده" shape="RE" value="read" onChange={noop} labels={labels} />
    <TriStateToggle name="غیرمجاز" shape="RE" value="none" onChange={noop} labels={labels} />
  </div>
);
