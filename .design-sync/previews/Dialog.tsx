import {
  Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Input, Label,
} from 'bj-erp';

export const EditForm = () => (
  <Dialog defaultOpen>
    <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>ویرایش شماره همراه</DialogTitle>
        <DialogDescription>شماره جدید پس از تأیید منابع انسانی ثبت می‌شود.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="dlg-mobile">شماره همراه</Label>
        <Input id="dlg-mobile" dir="ltr" defaultValue="0917 123 4567" />
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">انصراف</Button></DialogClose>
        <Button>ذخیره</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
