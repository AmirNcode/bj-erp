'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkSmsCredit, sendSmsTest, type SmsTestTemplate } from '@/lib/actions/admin';
import { normalizeIrMobile } from '@/lib/admin/format';
import { nativeSelectClass } from '@/lib/native-select';
import { FIELD_W } from '@/lib/ui/fieldWidths';
import { cn } from '@/lib/utils';

function Note({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p role={message.ok ? 'status' : 'alert'} className={cn('text-sm', message.ok ? 'text-success' : 'text-destructive')}>
      {message.text}
    </p>
  );
}

const TEST_TEMPLATES: SmsTestTemplate[] = ['approver_new', 'employee_decision', 'password_reset'];

/** One test text to a typed mobile, through the current mode and the saved How to send. */
export function SmsTestForm({ disabled, pattern }: { disabled: boolean; pattern: boolean }) {
  const t = useTranslations('admin.sms');
  const tErr = useTranslations('dbErrors');
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [template, setTemplate] = useState<SmsTestTemplate>('approver_new');
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
      const result = await sendSmsTest(mobile, pattern ? template : null);
      setMessage(result.ok ? { ok: true, text: t('testQueued') } : { ok: false, text: result.error });
      if (result.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="sms-test-form">
      {pattern && (
        <>
          <Label htmlFor="sms-test-template">{t('testTemplate')}</Label>
          <select id="sms-test-template" data-testid="sms-test-template" value={template}
            onChange={(e) => setTemplate(e.target.value as SmsTestTemplate)} className={cn(nativeSelectClass, FIELD_W.shortSelect)}>
            {TEST_TEMPLATES.map((k) => <option key={k} value={k}>{t(`testTemplates.${k}`)}</option>)}
          </select>
        </>
      )}
      <Label htmlFor="sms-test-mobile">{t('mobile')}</Label>
      <div className="flex gap-2">
        <Input id="sms-test-mobile" dir="ltr" inputMode="tel" placeholder="09…" value={mobile}
          onChange={(e) => setMobile(e.target.value)} className={FIELD_W.shortSelect} />
        <Button type="submit" variant="outline" disabled={pending || disabled}>{t('send')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('testHint')} {t(pattern ? 'testHintPattern' : 'testHintLine')}
      </p>
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
