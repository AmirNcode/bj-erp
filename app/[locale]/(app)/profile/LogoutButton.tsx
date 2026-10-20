'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { signOut } from '@/lib/actions/profile';
import { Button } from '@/components/ui/button';
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

type Props = {
  locale: string;
};

/**
 * Page-bottom logout with confirmation (prevents accidental sign-out).
 * Keeps the `settings-logout` testid contract; the confirm action is
 * `logout-confirm`.
 */
export function LogoutButton({ locale }: Props) {
  const t = useTranslations('profile.logoutConfirm');
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-testid="settings-logout"
          disabled={isPending}
          className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {t('trigger')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="logout-cancel">{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="logout-confirm"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => startTransition(async () => { await signOut(locale); })}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
