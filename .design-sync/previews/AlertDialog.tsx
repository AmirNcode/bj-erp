import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, Icons,
} from 'bj-erp';

export const ConfirmCancel = () => (
  <AlertDialog defaultOpen>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogMedia className="bg-destructive/10 text-destructive"><Icons.TriangleAlert /></AlertDialogMedia>
        <AlertDialogTitle>لغو درخواست مرخصی؟</AlertDialogTitle>
        <AlertDialogDescription>
          درخواست مرخصی ۱۲ تا ۱۴ آبان لغو می‌شود و مانده مرخصی شما بازمی‌گردد. این کار قابل بازگشت نیست.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>منصرف شدم</AlertDialogCancel>
        <AlertDialogAction variant="destructive">لغو درخواست</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
