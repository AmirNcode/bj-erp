'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { toLatinCode } from '@/lib/employees/code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Challenge = { request_id: string; hint: string };

export default function ForgotPasswordPage() {
  const t = useTranslations('recovery');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = String(new FormData(event.currentTarget).get('value') ?? '');
    setBusy(true);
    setFailed(false);
    try {
      const client = createClient();
      if (challenge) {
        const { error } = await client.rpc('app_confirm_password_recovery', {
          p_request: challenge.request_id, p_mobile: value,
        });
        if (error) throw error;
        setDone(true);
      } else {
        const { data, error } = await client.rpc('app_start_password_recovery', { p_code: toLatinCode(value) }).single();
        if (error || !data) throw new Error('Recovery unavailable');
        setChallenge(data);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {done ? <p role="status">{t('done')}</p> : (
            <form key={challenge?.request_id ?? 'start'} onSubmit={submit} className="space-y-4">
              {challenge && <p>{t('hint')} <bdi dir="ltr" className="font-mono">{challenge.hint}</bdi></p>}
              <Label htmlFor="recovery-input">{t(challenge ? 'phone' : 'code')}</Label>
              <Input id="recovery-input" name="value" type={challenge ? 'tel' : 'text'} dir="ltr"
                autoComplete={challenge ? 'tel' : 'username'} maxLength={64} required />
              {failed && <p role="alert">{t('error')}</p>}
              <Button type="submit" disabled={busy} className="w-full">{t(challenge ? 'send' : 'next')}</Button>
            </form>
          )}
          <p className="text-sm text-muted-foreground">{t('help')}</p>
          {challenge && <Button variant="outline" disabled={busy} onClick={() => {
            setChallenge(null);
            setDone(false);
            setFailed(false);
          }}>{t('restart')}</Button>}
          <Link href="/login" className="block text-sm text-primary underline">{t('login')}</Link>
        </CardContent>
      </Card>
    </main>
  );
}
