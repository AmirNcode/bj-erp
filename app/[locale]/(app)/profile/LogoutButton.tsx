'use client';

import { useTransition } from 'react';
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
  labels: {
    trigger: string;
    title: string;
    body: string;
    cancel: string;
    confirm: string;
  };
};

/**
 * Page-bottom logout with confirmation (prevents accidental sign-out).
 * Keeps the `settings-logout` testid contract; the confirm action is
 * `logout-confirm`.
 */
export function LogoutButton({ locale, labels }: Props) {
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
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="logout-cancel">{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="logout-confirm"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => startTransition(async () => { await signOut(locale); })}
          >
            {labels.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
