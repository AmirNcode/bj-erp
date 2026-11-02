import { Input, Label, Textarea } from 'bj-erp';

export const WithInput = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="destination">مقصد مأموریت</Label>
    <Input id="destination" placeholder="مثلاً بندر عباس" />
  </div>
);

export const WithCheckbox = () => (
  <Label className="w-80">
    <input type="checkbox" defaultChecked className="size-4 accent-primary" />
    نیاز به رزرو هتل دارم
  </Label>
);

export const WithTextarea = () => (
  <div className="grid w-80 gap-2">
    <Label htmlFor="reason">توضیحات</Label>
    <Textarea id="reason" placeholder="دلیل درخواست را بنویسید" />
  </div>
);
