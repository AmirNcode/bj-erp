'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { cancelRequest } from '@/lib/actions/leave/requests';
import { todayInAppTz } from '@/lib/appDate';
import { isCancellable } from '@/lib/leave/cancellable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

type Props = {
  requestId: string;
  status: string;
  startDate: string;
  onCancelled?: () => void;
  onError?: (message: string) => void;
  /** A full-size outline button instead of the small text one (approval cards). */
  buttonClassName?: string;
};

/** Shared cancellation control for My Requests and the Home recent-request card. */
export function RequestCancelButton({
  requestId,
  status,
  startDate,
  onCancelled,
  onError,
  buttonClassName,
}: Props) {
  const t = useTranslations('request');
  const tc = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (!isCancellable(status, startDate, todayInAppTz())) return null;

  const cancelPrompt =
    status === 'approved' ? t('cancelApprovedConfirm') : t('cancelConfirm');

  const handleCancel = () => {
    onError?.('');
    startTransition(async () => {
      const result = await cancelRequest(requestId);
      if (!result.ok) {
        onError?.(result.error);
        toast.error(result.error);
        return;
      }

      onCancelled?.();
      toast.success(t('cancelSuccess'));
      router.refresh();
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={buttonClassName ? 'outline' : 'ghost'}
          size="sm"
          disabled={isPending}
          className={buttonClassName ? `${buttonClassName} text-destructive hover:text-destructive` : 'h-auto px-2 py-0.5 text-xs text-destructive'}
          data-testid={`cancel-btn-${requestId}`}
        >
          {t('cancel')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('cancel')}</AlertDialogTitle>
          <AlertDialogDescription>{cancelPrompt}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleCancel}
            data-testid={`cancel-confirm-${requestId}`}
          >
            {t('cancel')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
