'use client';

/**
 * «مرخصی خارج از لیست» (FR-65) at the bottom of Edit Employee: a special_leave
 * holder grants 3 extra days of annual leave for a first marriage (a checkbox,
 * offered while personal info says single or the caller cannot read it) or for each death of a close relative
 * (a button, with the grants listed). Unticking / removing reverses a grant
 * made by mistake. The database enforces every rule; this only reflects them.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { grantSpecialLeave, revokeSpecialLeave, type SpecialLeaveGrant } from '@/lib/actions/specialLeave';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { marriageOffer } from '@/lib/employees/specialLeave';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  employeeId: string;
  grants: SpecialLeaveGrant[];
  /**
   * From personal info: 'single' | 'married' | null (not set); undefined when
   * the caller cannot read the target's personal information.
   */
  maritalStatus: string | null | undefined;
};

export function SpecialLeaveCard({ employeeId, grants, maritalStatus }: Props) {
  const t = useTranslations('specialLeave');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  // Bereavement: the note form opens on "Add 3 days"; the note is required.
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');

  const marriage = grants.find((g) => g.kind === 'marriage') ?? null;
  const deaths = grants.filter((g) => g.kind === 'bereavement');
  const offer = marriageOffer({ granted: !!marriage, maritalStatus });
  const date = (iso: string) => formatCalendarDate(iso.slice(0, 10), locale);

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
    onDone?: () => void
  ) =>
    startTransition(async () => {
      setError('');
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(done);
      onDone?.();
      router.refresh();
    });

  const submitBereavement = () => {
    if (!note.trim()) {
      setError(t('noteRequired'));
      return;
    }
    run(() => grantSpecialLeave(employeeId, 'bereavement', note), t('granted'), () => {
      setAdding(false);
      setNote('');
    });
  };

  return (
    <Card data-testid="special-leave">
      <CardHeader className="border-b pb-4">
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4"
              checked={!!marriage}
              disabled={isPending || !offer.enabled}
              onChange={(e) =>
                e.target.checked
                  ? run(() => grantSpecialLeave(employeeId, 'marriage'), t('granted'))
                  : marriage && run(() => revokeSpecialLeave(marriage.id), t('revoked'))
              }
              data-testid="special-leave-marriage"
            />
            {t('marriage')}
          </label>
          <p className="ps-6 text-xs text-muted-foreground" data-testid="special-leave-marriage-hint">
            {marriage
              ? t('grantedOn', { date: date(marriage.grantedAt) })
              : offer.hint === 'marriageHint'
                ? t('marriageHint')
                : t('marriageNotSingle')}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('bereavement')}</p>
              <p className="text-xs text-muted-foreground">{t('bereavementHint')}</p>
            </div>
            {!adding && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  setError('');
                  setAdding(true);
                }}
                data-testid="special-leave-bereavement-add"
              >
                {t('add')}
              </Button>
            )}
          </div>
          {adding && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="special-leave-bereavement-form">
              <Label htmlFor={`bereavement-note-${employeeId}`}>
                {t('note')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id={`bereavement-note-${employeeId}`}
                rows={2}
                maxLength={500}
                required
                aria-required="true"
                placeholder={t('notePlaceholder')}
                value={note}
                disabled={isPending}
                onChange={(e) => setNote(e.target.value)}
                data-testid="special-leave-bereavement-note"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending || !note.trim()}
                  onClick={submitBereavement}
                  data-testid="special-leave-bereavement-confirm"
                >
                  {t('add')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    setAdding(false);
                    setNote('');
                    setError('');
                  }}
                >
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}
          {deaths.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm" data-testid="special-leave-bereavement-list">
              {deaths.map((g) => (
                <li key={g.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block">{t('grantedOn', { date: date(g.grantedAt) })}</span>
                    {g.note && (
                      <span className="block break-words text-xs text-muted-foreground" data-testid={`special-leave-note-${g.id}`}>
                        {g.note}
                      </span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={isPending}
                    onClick={() => run(() => revokeSpecialLeave(g.id), t('revoked'))}
                    data-testid={`special-leave-remove-${g.id}`}
                  >
                    {t('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
