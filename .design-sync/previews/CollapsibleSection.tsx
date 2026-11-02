import { CollapsibleSection, Input, Label } from 'bj-erp';

export const Open = () => (
  <div className="w-96">
    <CollapsibleSection title="اطلاعات تماس" defaultOpen testId="contact">
      <div className="grid gap-2 rounded-xl border bg-card p-4">
        <Label htmlFor="phone">شماره همراه</Label>
        <Input id="phone" dir="ltr" defaultValue="0917 123 4567" />
      </div>
    </CollapsibleSection>
  </div>
);

export const Closed = () => (
  <div className="w-96 space-y-3">
    <CollapsibleSection title="اطلاعات بانکی" testId="bank">
      <p>شماره شبا</p>
    </CollapsibleSection>
    <CollapsibleSection title="سوابق تحصیلی" testId="education">
      <p>مدرک</p>
    </CollapsibleSection>
  </div>
);
