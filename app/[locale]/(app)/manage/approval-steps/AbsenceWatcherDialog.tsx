'use client';

/**
 * Add or edit one absence watcher (FR-75): a person, the request types they follow and where
 * they see them. Owner's mockup (2026-11-02): the search box, four type switches, two view
 * switches — drawn with the app's bordered checkbox rows. Everything starts on.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { saveAbsenceWatcher, type AbsenceWatcherRow } from '@/lib/actions/absence-watchers';
import {
  ABSENCE_TYPES,
  ABSENCE_VIEWS,
  FULL_WATCH,
  isValidWatch,
  type AbsenceType,
  type AbsenceView,
  type AbsenceWatch,
} from '@/lib/absences/watch';
import { PersonSearch, type PersonSearchOption } from '@/components/PersonSearch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null: add. A row: edit that person (the person is fixed). */
  editing: AbsenceWatcherRow | null;
  people: PersonSearchOption[];
  listedIds: string[];
  onSaved: () => void;
};

export function AbsenceWatcherDialog({ open, onOpenChange, editing, people, listedIds, onSaved }: Props) {
  const t = useTranslations('manage.settings.absenceWatchers');
  const [personId, setPersonId] = useState<string | null>(editing?.userId ?? null);
  const [watch, setWatch] = useState<AbsenceWatch>(editing?.watch ?? FULL_WATCH);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const valid = isValidWatch(watch);
  const canSave = !!personId && valid && !isPending;

  const submit = () => {
    if (!personId || !valid) return;
    setError('');
    startTransition(async () => {
      const result = await saveAbsenceWatcher({ userId: personId, watch });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t('saved'));
      onOpenChange(false);
      onSaved();
    });
  };

  const row = (key: AbsenceType | AbsenceView, label: string) => (
    <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 text-sm">
      <input
        type="checkbox"
        checked={watch[key]}
        disabled={isPending}
        className="size-4 accent-primary"
        data-testid={`absence-watcher-${key}`}
        onChange={(e) => setWatch((w) => ({ ...w, [key]: e.target.checked }))}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="absence-watcher-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle', { name: editing.fullName }) : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="absence-watcher-person">{t('person')}</Label>
              <PersonSearch
                id="absence-watcher-person"
                people={people}
                value={personId}
                onChange={setPersonId}
                disabled={isPending}
                testId="absence-watcher-person"
              />
              {personId && listedIds.includes(personId) && (
                <p className="text-xs text-muted-foreground">{t('alreadyListed')}</p>
              )}
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">{t('typesLabel')}</legend>
            {ABSENCE_TYPES.map((k) => row(k, t(`types.${k}`)))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">{t('viewsLabel')}</legend>
            {ABSENCE_VIEWS.map((k) => row(k, t(`views.${k}`)))}
          </fieldset>

          {!valid && <p className="text-xs text-destructive">{t('needsChoice')}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="absence-watcher-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={!canSave} onClick={submit} data-testid="absence-watcher-save">
            {isPending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
