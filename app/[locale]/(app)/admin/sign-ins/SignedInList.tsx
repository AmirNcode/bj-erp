'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { revokeAllSessions, revokeSessions } from '@/lib/actions/admin';
import type { SignedInPerson } from '@/lib/admin/types';
import { toAsciiDigits } from '@/lib/employees/code';
import { cn } from '@/lib/utils';

type Row = SignedInPerson & { lastActiveLabel: string };

/** A sign-out button behind a confirm dialog. */
function ConfirmSignOut({
  trigger,
  question,
  onConfirm,
  disabled,
  testId,
}: {
  trigger: string;
  question: string;
  onConfirm: () => void;
  disabled: boolean;
  testId: string;
}) {
  const t = useTranslations('admin.signIns');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} data-testid={testId}>{trigger}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm" lang="en">
        {/* Portaled to <body>, outside the panel's LTR wrapper (admin is English only). The
            direction goes on this inner box: on the content itself it would fight the rtl:
            centering variants that <html dir="rtl"> still triggers. */}
        <div dir="ltr" className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>{trigger}</AlertDialogTitle>
            <AlertDialogDescription>{question}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirm} data-testid={`${testId}-confirm`}>
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Everyone holding a session now; the admin can sign one person, or everyone else, out. */
export function SignedInList({ people, me }: { people: Row[]; me: string }) {
  const t = useTranslations('admin.signIns');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = useMemo(() => {
    const q = toAsciiDigits(query).trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.full_name.toLowerCase().includes(q) || p.employee_code.toLowerCase().includes(q));
  }, [people, query]);
  const others = people.some((p) => p.user_id !== me);

  function run(action: () => Promise<{ ok: true; count: number } | { ok: false; error: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? { ok: true, text: t('done', { count: result.count }) } : { ok: false, text: result.error });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')}
          aria-label={t('search')} className="max-w-72" data-testid="signed-in-search" />
        <div className="ms-auto">
          <ConfirmSignOut trigger={t('signOutAll')} question={t('confirmAll')} disabled={pending || !others}
            onConfirm={() => run(revokeAllSessions)} testId="sign-out-everyone" />
        </div>
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={cn('text-sm', message.ok ? 'text-success' : 'text-destructive')}>
          {message.text}
        </p>
      )}
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noMatch')}</p>
      ) : (
        <ul className="divide-y divide-muted">
          {shown.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-testid="signed-in-row">
              <span className="font-medium">{p.full_name}</span>
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">{p.employee_code}</span>
              {p.user_id === me && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{t('you')}</span>}
              {!p.active && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{t('inactive')}</span>}
              <span className="text-xs text-muted-foreground">
                {t('devices', { count: p.devices })} · {t('lastActive', { time: p.lastActiveLabel })}
              </span>
              <div className="ms-auto">
                <ConfirmSignOut trigger={t('signOut')} question={t('confirmOne', { name: p.full_name })}
                  disabled={pending || p.user_id === me} onConfirm={() => run(() => revokeSessions(p.user_id))}
                  testId={`sign-out-${p.employee_code}`} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('openPagesNote')}</p>
    </div>
  );
}
