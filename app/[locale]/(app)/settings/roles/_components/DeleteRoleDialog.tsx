'use client';

/**
 * D12: deleting a custom role. Opening the dialog loads who holds the role, so
 * the admin sees each name and personnel number and can copy the numbers (one
 * per line) to re-assign them later. Confirming removes the role from everyone
 * and deletes it; the database audits the holder list.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { deleteRole, getRoleHolders } from '@/lib/actions/roles';

type Holder = { fullName: string; personnelNo: string };

export function DeleteRoleDialog({ roleId, roleName }: { roleId: string; roleName: string }) {
  const t = useTranslations('rolesAdmin');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [error, setError] = useState('');
  const [loading, startLoading] = useTransition();
  const [deleting, startDeleting] = useTransition();

  const onOpenChange = (next: boolean) => {
    if (deleting) return;
    setOpen(next);
    setError('');
    if (!next) return;
    setHolders(null);
    startLoading(async () => {
      const r = await getRoleHolders(roleId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setHolders(r.holders);
    });
  };

  const copy = async () => {
    const text = (holders ?? []).map((h) => h.personnelNo).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('delete.copied'));
    } catch {
      toast.error(t('delete.copyFailed'));
    }
  };

  const confirm = () => {
    setError('');
    startDeleting(async () => {
      const r = await deleteRole(roleId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(t('delete.deleted'));
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 text-destructive hover:text-destructive"
          data-testid={`role-delete-${roleId}`}
        >
          {t('actions.delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('delete.title', { name: roleName })}</AlertDialogTitle>
          <AlertDialogDescription data-testid="delete-body">
            {holders ? t('delete.body', { count: holders.length }) : loading ? t('delete.loading') : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {holders && holders.length > 0 && (
          <div className="flex flex-col gap-2">
            <ul
              className="max-h-60 divide-y overflow-auto rounded-lg border text-sm"
              data-testid="delete-holders"
            >
              {holders.map((h) => (
                <li key={`${h.personnelNo}-${h.fullName}`} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">{h.fullName}</span>
                  <bdi className="shrink-0 font-mono tabular-nums text-muted-foreground">{h.personnelNo}</bdi>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="h-10 self-start"
              onClick={copy}
              data-testid="copy-personnel-nos"
            >
              {t('delete.copy')}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="delete-error">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel className="h-10" disabled={deleting}>
            {t('delete.cancel')}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: the dialog stays open to show a refusal. */}
          <Button
            variant="destructive"
            className="h-10"
            disabled={deleting || loading || holders === null}
            onClick={confirm}
            data-testid="delete-confirm"
          >
            {deleting ? t('delete.deleting') : t('delete.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
