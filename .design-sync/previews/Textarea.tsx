import { Label, Textarea } from 'bj-erp';

export const Empty = () => (
  <div className="grid w-96 gap-2">
    <Label htmlFor="note">توضیحات درخواست</Label>
    <Textarea id="note" placeholder="در صورت نیاز توضیح دهید…" />
  </div>
);

export const Filled = () => (
  <div className="grid w-96 gap-2">
    <Label htmlFor="note-filled">توضیحات درخواست</Label>
    <Textarea
      id="note-filled"
      defaultValue="به دلیل مراجعه به پزشک متخصص در شیراز، دو روز مرخصی استعلاجی نیاز دارم. گواهی پزشک پس از بازگشت تحویل داده می‌شود."
    />
  </div>
);

export const Disabled = () => (
  <div className="grid w-96 gap-2">
    <Label htmlFor="note-disabled">نظر مدیر</Label>
    <Textarea id="note-disabled" defaultValue="تأیید شد." disabled />
  </div>
);
