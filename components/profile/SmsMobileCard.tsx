'use client';

/**
 * Profile › Mobile for SMS (FR-95). Everyone sets their own number here; it is
 * employee_personal_info.mobile, the number SMS notifications go to. Blank
 * removes it. Read-only while an admin is viewing as this person.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setMyMobile } from '@/lib/actions/personal-info';
import { normalizeIrMobile } from '@/lib/admin/format';
import { useViewAs } from '@/app/[locale]/(app)/_components/ViewAsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SmsMobileCard({ initial }: { initial: string | null }) {
  const t = useTranslations('profile.mobile');
  const router = useRouter();
  const viewing = useViewAs() !== null;
  const [current, setCurrent] = useState(initial);
  const [value, setValue] = useState(initial ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = value.trim();
  const unchanged = (normalizeIrMobile(trimmed) ?? trimmed) === (current ?? '');

  function save() {
    if (trimmed !== '' && !normalizeIrMobile(trimmed)) {
      setMessage({ kind: 'error', text: t('invalid') });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await setMyMobile(trimmed);
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
          save();
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
