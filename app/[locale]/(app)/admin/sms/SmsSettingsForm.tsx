'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { FormSection, FORM_SECTION_END_COL } from '@/components/FormSection';
import { FIELD_W } from '@/lib/ui/fieldWidths';
import { saveSmsSettings, type SmsSettingsInput } from '@/lib/actions/admin';
import type { SmsConnection, SmsMode, SmsSettings } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

const MODES: SmsMode[] = ['off', 'dry_run', 'live'];
const MODE_KEYS = { off: 'modeOff', dry_run: 'modeDry', live: 'modeLive' } as const;
const MODE_HINTS = { off: 'modeOffHint', dry_run: 'modeDryHint', live: 'modeLiveHint' } as const;
const CONNECTIONS: { value: SmsConnection; label: 'connWebservice' | 'connConsole'; hint: 'connWebserviceHint' | 'connConsoleHint' }[] = [
  { value: 'webservice', label: 'connWebservice', hint: 'connWebserviceHint' },
  { value: 'console', label: 'connConsole', hint: 'connConsoleHint' },
];

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
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<SmsSettingsInput>({
    mode: initial.mode,
    connection: initial.connection ?? 'webservice',
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
    headerLabel: initial.header_label ?? '',
    apiKey: '',
    clearApiKey: false,
  });
  const set = <K extends keyof SmsSettingsInput>(key: K, value: SmsSettingsInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const keyAfterSave = !form.clearApiKey && (initial.has_api_key || form.apiKey.trim() !== '');
  const webservice = form.connection === 'webservice';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (form.mode === 'live' && !keyAfterSave) {
      setMessage({ ok: false, text: t('liveNeedsKey') });
      return;
    }
    if (form.mode === 'live' && webservice && form.username.trim() === '') {
      setMessage({ ok: false, text: t('liveNeedsUsername') });
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
      setShowKey(false);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} data-testid="sms-settings-form">
      <FormSection title={t('mode')} description={t(MODE_HINTS[form.mode])}>
        <Card>
          <CardContent>
            <fieldset>
              <legend className="sr-only">{t('mode')}</legend>
              <div className="flex w-fit flex-wrap gap-1 rounded-md bg-muted p-[3px]" role="radiogroup">
                {MODES.map((m) => (
                  <label
                    key={m}
                    className={cn(
                      'inline-flex h-9 cursor-pointer items-center rounded-lg px-4 text-13 transition-colors',
                      form.mode === m ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <input type="radio" name="sms-mode" value={m} checked={form.mode === m} onChange={() => set('mode', m)}
                      className="sr-only" data-testid={`sms-mode-${m}`} />
                    {t(MODE_KEYS[m])}
                  </label>
                ))}
              </div>
            </fieldset>
          </CardContent>
        </Card>
      </FormSection>

      <FormSection title={t('connection')} description={t(webservice ? 'connWebserviceHint' : 'connConsoleHint')}>
        <Card>
          <CardContent className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t('connection')}</legend>
              {CONNECTIONS.map((c) => (
                <label key={c.value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="sms-connection" checked={form.connection === c.value}
                    onChange={() => set('connection', c.value)} className="size-4 accent-primary"
                    data-testid={`sms-connection-${c.value}`} />
                  {t(c.label)}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sms-api-key">{t('apiKey')}</Label>
              <div className={cn('relative', FIELD_W.name)}>
                <Input id="sms-api-key" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                  dir="ltr" value={form.apiKey} className="pe-10"
                  onChange={(e) => set('apiKey', e.target.value)} disabled={form.clearApiKey} data-testid="sms-api-key"
                  placeholder={initial.has_api_key ? '••••••••' : ''} />
                <button type="button" onClick={() => setShowKey((v) => !v)} disabled={form.clearApiKey}
                  aria-label={showKey ? t('hideKey') : t('showKey')} aria-pressed={showKey} data-testid="sms-api-key-toggle"
                  className="absolute inset-y-0 end-0 flex items-center rounded-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50">
                  {showKey ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {initial.has_api_key ? t('apiKeySaved', { hint: initial.api_key_hint ?? '' }) : t('apiKeyNone')}{' '}
                {t(webservice ? 'apiKeyHintWebservice' : 'apiKeyHint')}
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
              <Input id="sms-username" dir="ltr" autoComplete="off" value={form.username} className={FIELD_W.name}
                onChange={(e) => set('username', e.target.value)} data-testid="sms-username" />
              <p className="text-xs text-muted-foreground">{t(webservice ? 'usernameHintWebservice' : 'usernameHint')}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sms-line">{t('senderLine')}</Label>
              <Input id="sms-line" dir="ltr" inputMode="numeric" value={form.senderLine} className={FIELD_W.name}
                onChange={(e) => set('senderLine', e.target.value)} data-testid="sms-sender-line" />
              <p className="text-xs text-muted-foreground">{t('senderLineHint')}</p>
            </div>
          </CardContent>
        </Card>
      </FormSection>

      <FormSection title={t('sendMethod')} description={form.sendMethod === 'pattern' ? t('patternHint') : undefined}>
        <Card>
          <CardContent>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t('sendMethod')}</legend>
              {(['line', 'pattern'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="sms-method" checked={form.sendMethod === m} onChange={() => set('sendMethod', m)}
                    className="size-4 accent-primary" data-testid={`sms-method-${m}`} />
                  {t(m === 'line' ? 'methodLine' : 'methodPattern')}
                </label>
              ))}
            </fieldset>
          </CardContent>
        </Card>
      </FormSection>

      <FormSection title={t('events')}>
        <Card>
          <CardContent>
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">{t('events')}</legend>
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
                      className={FIELD_W.shortSelect} value={form[`body${key}`]} onChange={(e) => set(`body${key}`, e.target.value)} />
                  )}
                </div>
              ))}
            </fieldset>
          </CardContent>
        </Card>
      </FormSection>

      <FormSection title={t('headerLabel')} description={t('headerLabelHint')}>
        <Card>
          <CardContent>
            <Input id="sms-header" aria-label={t('headerLabel')} dir="auto" value={form.headerLabel} maxLength={60} className={FIELD_W.name}
              onChange={(e) => set('headerLabel', e.target.value)} data-testid="sms-header-label" />
          </CardContent>
        </Card>
      </FormSection>

      <FormSection title={t('siteLabel')} description={t('siteLabelHint')}>
        <Card>
          <CardContent>
            <Input id="sms-site" aria-label={t('siteLabel')} dir="auto" value={form.siteLabel} maxLength={60} className={FIELD_W.name}
              onChange={(e) => set('siteLabel', e.target.value)} data-testid="sms-site-label" />
          </CardContent>
        </Card>
      </FormSection>

      {message && (
        <p role={message.ok ? 'status' : 'alert'}
          className={cn('rounded-lg px-4 py-3 text-sm', FORM_SECTION_END_COL, message.ok ? 'bg-success-foreground text-success' : 'bg-destructive/10 text-destructive')}>
          {message.text}
        </p>
      )}
      <div className={`flex items-center justify-end gap-3 pt-4 ${FORM_SECTION_END_COL}`}>
        <Button type="submit" disabled={pending} data-testid="sms-save">
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
