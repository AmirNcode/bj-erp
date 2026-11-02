import { Input, Label } from 'bj-erp';

export const Default = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="mobile">شماره همراه</Label>
    <Input id="mobile" type="tel" dir="ltr" placeholder="09xx xxx xxxx" />
  </div>
);

export const Filled = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="full-name">نام و نام خانوادگی</Label>
    <Input id="full-name" defaultValue="مریم رضایی" />
  </div>
);

export const Invalid = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="national-id">کد ملی</Label>
    <Input id="national-id" dir="ltr" defaultValue="12345" aria-invalid />
    <p className="text-xs text-destructive">کد ملی باید ۱۰ رقم باشد.</p>
  </div>
);

export const Disabled = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="personnel-no">شماره پرسنلی</Label>
    <Input id="personnel-no" defaultValue="۱۲۴" disabled />
  </div>
);
