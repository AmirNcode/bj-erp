'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkSmsCredit, sendSmsTest } from '@/lib/actions/admin';
import { normalizeIrMobile } from '@/lib/admin/format';
import { cn } from '@/lib/utils';

function Note({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p role={message.ok ? 'status' : 'alert'} className={cn('text-sm', message.ok ? 'text-success' : 'text-destructive')}>
      {message.text}
    </p>
  );
}

/** One test text to a typed mobile, through the current mode. */
export function SmsTestForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations('admin.sms');
  const tErr = useTranslations('dbErrors');
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!normalizeIrMobile(mobile)) {
      setMessage({ ok: false, text: tErr('smsInvalidMobile') });
      return;
    }
    startTransition(async () => {
      const result = await sendSmsTest(mobile);
      setMessage(result.ok ? { ok: true, text: t('testQueued') } : { ok: false, text: result.error });
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="sms-test-form">
      <Label htmlFor="sms-test-mobile">{t('mobile')}</Label>
      <div className="flex gap-2">
        <Input id="sms-test-mobile" dir="ltr" inputMode="tel" placeholder="09…" value={mobile}
          onChange={(e) => setMobile(e.target.value)} className="max-w-56" />
        <Button type="submit" variant="outline" disabled={pending || disabled}>{t('send')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('testHint')}</p>
      <Note message={message} />
    </form>
  );
}

/** Asks Melipayamak for the balance; the database stores the answer on its next run. */
export function SmsCreditButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations('admin.sms');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" className="w-fit" disabled={pending || disabled}
        onClick={() => startTransition(async () => {
          const result = await checkSmsCredit();
          setMessage(result.ok ? { ok: true, text: t('creditPending') } : { ok: false, text: result.error });
          if (result.ok) router.refresh();
        })}>
        {t('checkCredit')}
      </Button>
      <Note message={message} />
    </div>
  );
}
