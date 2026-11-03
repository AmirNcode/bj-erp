'use client';

/**
 * Manage › Approval steps › Absence notifications (FR-75): who sees fully approved absences, of
 * which request types, on the Home tile and/or the full Absences page. Replaces the old
 * `absences` role permission (owner, 2026-11-02): the HR clerk who keeps the attendance
 * (fingerprint) system is named here, person by person.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { removeAbsenceWatcher, type AbsenceWatcherRow } from '@/lib/actions/absence-watchers';
import { ABSENCE_TYPES, ABSENCE_VIEWS } from '@/lib/absences/watch';
import type { PersonSearchOption } from '@/components/PersonSearch';
import { AbsenceWatcherDialog } from './AbsenceWatcherDialog';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { displayPersonnelNo } from '@/lib/employees/code';
import { formatNumber } from '@/lib/i18n/format';

type Props = {
  watchers: AbsenceWatcherRow[];
  /** Active colleagues for the person search; empty without approval_steps edit. */
  people: PersonSearchOption[];
  canEdit: boolean;
};

export function AbsenceWatchersCard({ watchers, people, canEdit }: Props) {
  const t = useTranslations('manage.settings.absenceWatchers');
  const locale = useLocale();
  const router = useRouter();
  // The dialog mounts only while open, so its state starts from the row being edited.
  const [dialog, setDialog] = useState<{ editing: AbsenceWatcherRow | null } | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const open = (editing: AbsenceWatcherRow | null) => setDialog({ editing });

  const remove = (w: AbsenceWatcherRow) => {
    setError('');
    startTransition(async () => {
      const result = await removeAbsenceWatcher(w.userId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t('removed'));
      router.refresh();
    });
  };

  return (
    <Card data-testid="absence-watchers-card">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('hint')}</p>

        {watchers.length === 0 ? (
          <EmptyState message={t('empty')} />
        ) : (
          <ul className="divide-y divide-border" data-testid="absence-watchers-list">
            {watchers.map((w) => (
              <li key={w.userId} className="flex flex-wrap items-center gap-3 py-3" data-testid={`absence-watcher-${w.userId}`}>
                <div className="min-w-40 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                    <bdi>{w.fullName}</bdi>
                    {w.personnelNo && (
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        {displayPersonnelNo(w.personnelNo, (n) => formatNumber(n, locale, { useGrouping: false }))}
                      </span>
                    )}
                    {!w.active && (
                      <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                        {t('inactive')}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ABSENCE_TYPES.filter((k) => w.watch[k]).map((k) => (
                      <Badge key={k} variant="secondary">
                        {t(`types.${k}`)}
                      </Badge>
                    ))}
                    {ABSENCE_VIEWS.filter((k) => w.watch[k]).map((k) => (
                      <Badge key={k} variant="outline">
                        {t(`views.${k}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={isPending}
                      onClick={() => open(w)}
                      data-testid={`absence-watcher-edit-${w.userId}`}
                    >
                      {t('edit')}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="xs"
                          disabled={isPending}
                          data-testid={`absence-watcher-remove-${w.userId}`}
                        >
                          {t('remove')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('remove')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('removeConfirm', { name: w.fullName })}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => remove(w)}
                            data-testid={`absence-watcher-remove-confirm-${w.userId}`}
                          >
                            {t('remove')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => open(null)} data-testid="absence-watcher-add">
            {t('add')}
          </Button>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {dialog && (
          <AbsenceWatcherDialog
            open
            onOpenChange={(next) => !next && setDialog(null)}
            editing={dialog.editing}
            people={people}
            listedIds={watchers.map((w) => w.userId)}
            onSaved={() => router.refresh()}
          />
        )}
      </CardContent>
    </Card>
  );
}
