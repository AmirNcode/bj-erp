'use client';

import { useState, useTransition } from 'react';
import { changeMyPassword } from '@/lib/actions/profile';
import { validatePassword } from '@/lib/auth/passwordPolicy';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

type Labels = {
  title: string;
  current: string;
  new: string;
  confirm: string;
  submit: string;
  changed: string;
  tooShort: string;
  mismatch: string;
  emptyCurrent: string;
  errorLabel: string;
};

export function ChangePasswordForm({ labels }: { labels: Labels }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const reasonMsg = (reason: 'empty_current' | 'too_short' | 'mismatch') =>
    reason === 'empty_current'
      ? labels.emptyCurrent
      : reason === 'too_short'
        ? labels.tooShort
        : labels.mismatch;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOkMsg('');
    setErrMsg('');
    const v = validatePassword(current, next, confirm);
    if (!v.ok) {
      setErrMsg(reasonMsg(v.reason));
      return;
    }
    startTransition(async () => {
      const res = await changeMyPassword(current, next);
      if (res.ok) {
        setOkMsg(labels.changed);
        setCurrent('');
        setNext('');
        setConfirm('');
      } else {
        setErrMsg(res.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="password-form">
      {okMsg && (
        <p
          role="status"
          data-testid="password-success"
          className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800"
        >
          {okMsg}
        </p>
      )}
      {errMsg && (
        <p
          role="alert"
          data-testid="password-error"
          className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800"
        >
          <strong>{labels.errorLabel}:</strong> {errMsg}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="pwd-current">{labels.current}</Label>
        <Input
          id="pwd-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={isPending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pwd-new">{labels.new}</Label>
        <Input
          id="pwd-new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={isPending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pwd-confirm">{labels.confirm}</Label>
        <Input
          id="pwd-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending}
        />
      </div>
      <Button
        type="submit"
        data-testid="password-submit"
        disabled={isPending}
        className="w-full"
      >
        {labels.submit}
      </Button>
    </form>
  );
}
