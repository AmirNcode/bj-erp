'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveSmsSettings, type SmsSettingsInput } from '@/lib/actions/admin';
import type { SmsMode, SmsSettings } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

const MODES: SmsMode[] = ['off', 'dry_run', 'live'];
const MODE_KEYS = { off: 'modeOff', dry_run: 'modeDry', live: 'modeLive' } as const;
const MODE_HINTS = { off: 'modeOffHint', dry_run: 'modeDryHint', live: 'modeLiveHint' } as const;

type EventKey = 'ApproverNew' | 'EmployeeDecision' | 'PasswordReset';
const EVENTS: { key: EventKey; label: 'approverNew' | 'employeeDecision' | 'passwordReset' }[] = [
  { key: 'ApproverNew', label: 'approverNew' },
  { key: 'EmployeeDecision', label: 'employeeDecision' },
  { key: 'PasswordReset', label: 'passwordReset' },
];

const str = (n: number | null) => (n === null || n === undefined ? '' : String(n));

/** FR-78 settings. The API key box is always empty: a saved key is never sent back here. */
export function SmsSettingsForm({ initial }: { initial: SmsSettings }) {
  const t = useTranslations('admin.sms');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<SmsSettingsInput>({
    mode: initial.mode,
    username: initial.username ?? '',
    senderLine: initial.sender_line ?? '',
    sendMethod: initial.send_method,
    bodyApproverNew: str(initial.body_approver_new),
    bodyEmployeeDecision: str(initial.body_employee_decision),
    bodyPasswordReset: str(initial.body_password_reset),
    notifyApproverNew: initial.notify_approver_new,
    notifyEmployeeDecision: initial.notify_employee_decision,
    notifyPasswordReset: initial.notify_password_reset,
    siteLabel: initial.site_label,
    apiKey: '',
    clearApiKey: false,
  });
  const set = <K extends keyof SmsSettingsInput>(key: K, value: SmsSettingsInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const keyAfterSave = !form.clearApiKey && (initial.has_api_key || form.apiKey.trim() !== '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (form.mode === 'live' && !keyAfterSave) {
      setMessage({ ok: false, text: t('liveNeedsKey') });
      return;
    }
    startTransition(async () => {
      const result = await saveSmsSettings(form);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: t('saved') });
      setForm((f) => ({ ...f, apiKey: '', clearApiKey: false }));
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" data-testid="sms-settings-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t('mode')}</legend>
        <div className="flex w-fit flex-wrap gap-1 rounded-[10px] bg-muted p-[3px]" role="radiogroup">
          {MODES.map((m) => (
            <label
              key={m}
              className={cn(
                'inline-flex h-9 cursor-pointer items-center rounded-lg px-4 text-[13px] transition-colors',
                form.mode === m ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <input type="radio" name="sms-mode" value={m} checked={form.mode === m} onChange={() => set('mode', m)}
                className="sr-only" data-testid={`sms-mode-${m}`} />
              {t(MODE_KEYS[m])}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(MODE_HINTS[form.mode])}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="sms-api-key">{t('apiKey')}</Label>
          <Input id="sms-api-key" type="password" autoComplete="off" dir="ltr" value={form.apiKey}
            onChange={(e) => set('apiKey', e.target.value)} disabled={form.clearApiKey} data-testid="sms-api-key"
            placeholder={initial.has_api_key ? '••••••••' : ''} />
          <p className="text-xs text-muted-foreground">
            {initial.has_api_key ? t('apiKeySaved', { hint: initial.api_key_hint ?? '' }) : t('apiKeyNone')} {t('apiKeyHint')}
          </p>
          {initial.has_api_key && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.clearApiKey} onChange={(e) => set('clearApiKey', e.target.checked)}
                className="size-4 accent-primary" />
              {t('clearKey')}
            </label>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sms-username">{t('username')}</Label>
          <Input id="sms-username" dir="ltr" value={form.username} onChange={(e) => set('username', e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('usernameHint')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sms-line">{t('senderLine')}</Label>
          <Input id="sms-line" dir="ltr" inputMode="numeric" value={form.senderLine}
            onChange={(e) => set('senderLine', e.target.value)} data-testid="sms-sender-line" />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">{t('senderLineHint')}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t('sendMethod')}</legend>
        {(['line', 'pattern'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input type="radio" name="sms-method" checked={form.sendMethod === m} onChange={() => set('sendMethod', m)}
              className="size-4 accent-primary" data-testid={`sms-method-${m}`} />
            {t(m === 'line' ? 'methodLine' : 'methodPattern')}
          </label>
        ))}
        {form.sendMethod === 'pattern' && <p className="text-xs text-muted-foreground">{t('patternHint')}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{t('events')}</legend>
        {EVENTS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form[`notify${key}`]} onChange={(e) => set(`notify${key}`, e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary" data-testid={`sms-notify-${label}`} />
              <span>
                {t(label)}
                {form.sendMethod === 'pattern' && <span className="block text-xs text-muted-foreground">{t(`${label}Vars`)}</span>}
              </span>
            </label>
            {form.sendMethod === 'pattern' && (
              <Input aria-label={`${t('bodyId')} — ${t(label)}`} placeholder="bodyId" dir="ltr" inputMode="numeric"
                className="sm:w-32" value={form[`body${key}`]} onChange={(e) => set(`body${key}`, e.target.value)} />
            )}
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="sms-site">{t('siteLabel')}</Label>
        <Input id="sms-site" dir="ltr" value={form.siteLabel} onChange={(e) => set('siteLabel', e.target.value)} />
      </div>

      {message && (
        <p role={message.ok ? 'status' : 'alert'}
          className={cn('rounded-lg px-4 py-3 text-sm', message.ok ? 'bg-success-foreground text-success' : 'bg-destructive/10 text-destructive')}>
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-fit" data-testid="sms-save">
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
