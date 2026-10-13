'use client';

/**
 * «مرخصی خارج از لیست» (FR-65) at the bottom of Edit Employee: hr or admin
 * grants 3 extra days of annual leave for a first marriage (a checkbox, offered
 * only while personal info says single) or for each death of a close relative
 * (a button, with the grants listed). Unticking / removing reverses a grant
 * made by mistake. The database enforces every rule; this only reflects them.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { grantSpecialLeave, revokeSpecialLeave, type SpecialLeaveGrant } from '@/lib/actions/specialLeave';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  employeeId: string;
  grants: SpecialLeaveGrant[];
  /** From personal info: 'single' | 'married' | null. */
  maritalStatus: string | null;
};

export function SpecialLeaveCard({ employeeId, grants, maritalStatus }: Props) {
  const t = useTranslations('specialLeave');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const marriage = grants.find((g) => g.kind === 'marriage') ?? null;
  const deaths = grants.filter((g) => g.kind === 'bereavement');
  const marriageAllowed = !!marriage || maritalStatus === 'single';
  const date = (iso: string) => formatCalendarDate(iso.slice(0, 10), locale);

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    startTransition(async () => {
      setError('');
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });

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
              disabled={isPending || !marriageAllowed}
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
              : marriageAllowed
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => run(() => grantSpecialLeave(employeeId, 'bereavement'), t('granted'))}
              data-testid="special-leave-bereavement-add"
            >
              {t('add')}
            </Button>
          </div>
          {deaths.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm" data-testid="special-leave-bereavement-list">
              {deaths.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{t('grantedOn', { date: date(g.grantedAt) })}</span>
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
