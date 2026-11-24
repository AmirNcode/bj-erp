'use client';

/**
 * Profile › Mobile for SMS (FR-96). Everyone sets their own number here; it is
 * employee_personal_info.mobile, the number SMS notifications go to. The number
 * shows as text with Edit; editing swaps in an input with Save (enabled once the
 * value changes) and Discard. Blank removes it. Save asks for confirmation,
 * showing the exact number (owner 2026-11-19: no password, but an explicit
 * confirm). Below it, the latest texts sent to this person (app_my_recent_sms).
 * Read-only while an admin is viewing as this person.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { setMyMobile, type MySms } from '@/lib/actions/personal-info';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { STATUS_BADGE_STYLES } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
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

const SMS_STATUS_STYLE: Record<MySms['status'], string> = {
  sent: STATUS_BADGE_STYLES.approved,
  queued: STATUS_BADGE_STYLES.pending,
  sending: STATUS_BADGE_STYLES.pending,
  failed: STATUS_BADGE_STYLES.rejected,
};

export function SmsMobileCard({ initial, history }: { initial: string | null; history: MySms[] }) {
  const t = useTranslations('profile.mobile');
  const locale = useLocale();
  const router = useRouter();
  const viewing = useViewAs() !== null;
  const [current, setCurrent] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  // The number awaiting confirmation: a normalized 09… value, or '' to remove it; null = no dialog.
  const [confirming, setConfirming] = useState<string | null>(null);

  const trimmed = value.trim();
  const unchanged = (normalizeIrMobile(trimmed) ?? trimmed) === (current ?? '');

  function startEditing() {
    setValue(current ?? '');
    setMessage(null);
    setEditing(true);
  }

  function discard() {
    setValue(current ?? '');
    setMessage(null);
    setEditing(false);
  }

  function askToSave() {
    if (unchanged) return;
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
      setEditing(false);
      setMessage({ kind: 'ok', text: res.mobile ? t('saved') : t('cleared') });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="space-y-2">
        {editing ? (
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              askToSave();
            }}
          >
            <label htmlFor="sms-mobile-input" className="block text-sm font-medium">
              {t('label')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="sms-mobile-input"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="09123456789"
                value={value}
                disabled={isPending}
                onChange={(e) => {
                  setValue(e.target.value);
                  setMessage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') discard();
                }}
                className="min-w-0 flex-1 basis-40"
                data-testid="sms-mobile-input"
              />
              <div className="flex gap-2">
                <Button pending={isPending} type="submit" disabled={isPending || unchanged} data-testid="sms-mobile-save">
                  {t('save')}
                </Button>
                <Button type="button" variant="outline" disabled={isPending} onClick={discard} data-testid="sms-mobile-discard">
                  {t('discard')}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={viewing}
              onClick={startEditing}
              data-testid="sms-mobile-edit"
            >
              <Pencil aria-hidden="true" />
              {current ? t('edit') : t('add')}
            </Button>
          </div>
        )}
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

      {/* Latest texts to this person; fills the rest of the card. */}
      <section className="flex-1 space-y-2 border-t pt-4" data-testid="sms-history">
        <h3 className="text-sm font-medium">{t('historyTitle')}</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
        ) : (
          <ul className="divide-y">
            {history.map((sms) => (
              <li key={sms.id} className="space-y-1 py-2 first:pt-0 last:pb-0" data-testid="sms-history-row">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{formatPersianConsentTimestamp(sms.sent_at ?? sms.created_at, locale)}</span>
                  <Badge variant="outline" className={SMS_STATUS_STYLE[sms.status]}>
                    {t(`historyStatus.${sms.status}`)}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-sm" dir="auto">
                  {sms.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
