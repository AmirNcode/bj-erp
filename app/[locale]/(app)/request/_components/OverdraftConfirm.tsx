'use client';

/**
 * FR-92: a Manager may request more leave than their available balance. This
 * dialog states by how much before the request is sent.
 */

import { useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Bidi isolates (the string form of <bdi>) keep a negative value's minus sign in place in RTL.
const isolate = (text: string) => `\u2068${text}\u2069`;

export function OverdraftConfirm({
  open,
  onOpenChange,
  onConfirm,
  overLabel,
  availableLabel,
  afterLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  overLabel: string;
  availableLabel: string;
  afterLabel: string;
}) {
  const t = useTranslations('leaveBalance');
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="overdraft-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('confirmBody', {
              over: isolate(overLabel),
              available: isolate(availableLabel),
              after: isolate(afterLabel),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="overdraft-confirm-back" onClick={() => onOpenChange(false)}>
            {t('confirmBack')}
          </AlertDialogCancel>
          <AlertDialogAction data-testid="overdraft-confirm-send" onClick={onConfirm}>
            {t('confirmSend')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
