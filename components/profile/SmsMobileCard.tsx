'use client';

/**
 * Profile › Mobile for SMS (FR-96). Everyone sets their own number here; it is
 * employee_personal_info.mobile, the number SMS notifications go to. Blank
 * removes it. Save asks for confirmation, showing the exact number (owner
 * 2026-11-19: no password, but an explicit confirm). Read-only while an admin
 * is viewing as this person.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setMyMobile } from '@/lib/actions/personal-info';
import { normalizeIrMobile } from '@/lib/admin/format';
import { useViewAs } from '@/app/[locale]/(app)/_components/ViewAsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export function SmsMobileCard({ initial }: { initial: string | null }) {
  const t = useTranslations('profile.mobile');
  const router = useRouter();
  const viewing = useViewAs() !== null;
  const [current, setCurrent] = useState(initial);
  const [value, setValue] = useState(initial ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  // The number awaiting confirmation: a normalized 09… value, or '' to remove it; null = no dialog.
  const [confirming, setConfirming] = useState<string | null>(null);

  const trimmed = value.trim();
  const unchanged = (normalizeIrMobile(trimmed) ?? trimmed) === (current ?? '');

  function askToSave() {
    const normalized = normalizeIrMobile(trimmed);
    if (trimmed !== '' && !normalized) {
      setMessage({ kind: 'error', text: t('invalid') });
      return;
    }
    setMessage(null);
    setConfirming(normalized ?? '');
  }

  function save(next: string) {
    setConfirming(null);
    startTransition(async () => {
      const res = await setMyMobile(next);
      if (!res.ok) {
        setMessage({ kind: 'error', text: res.error });
        return;
      }
      setCurrent(res.mobile);
      setValue(res.mobile ?? '');
      setMessage({ kind: 'ok', text: res.mobile ? t('saved') : t('cleared') });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <p className="text-sm" data-testid="sms-mobile-current">
        {current ? (
          <>
            <span className="text-muted-foreground">{t('current')}: </span>
            <span dir="ltr" className="font-mono">
              {current}
            </span>
          </>
        ) : (
          <span className="text-amber-700">{t('none')}</span>
        )}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          askToSave();
        }}
      >
        <label className="min-w-0 flex-1 space-y-1.5">
          <span className="block text-sm font-medium">{t('label')}</span>
          <Input
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="09123456789"
            value={value}
            disabled={viewing || isPending}
            onChange={(e) => {
              setValue(e.target.value);
              setMessage(null);
            }}
            data-testid="sms-mobile-input"
          />
        </label>
        <Button type="submit" disabled={viewing || isPending || unchanged} data-testid="sms-mobile-save">
          {t('save')}
        </Button>
      </form>
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent data-testid="sms-mobile-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? t('confirmTitle') : t('confirmRemoveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{confirming ? t('confirmBody') : t('confirmRemoveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirming && (
            <p dir="ltr" className="text-center font-mono text-lg font-semibold" data-testid="sms-mobile-confirm-number">
              {confirming}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="sms-mobile-confirm-cancel">{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction data-testid="sms-mobile-confirm" onClick={() => confirming !== null && save(confirming)}>
              {confirming ? t('confirm') : t('confirmRemove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {viewing && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'}
          data-testid="sms-mobile-message"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
