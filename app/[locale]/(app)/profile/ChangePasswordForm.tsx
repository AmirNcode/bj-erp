'use client';

import { useState, useTransition } from 'react';
import { changeMyPassword } from '@/lib/actions/profile';
import { validatePassword } from '@/lib/auth/passwordPolicy';

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

const INPUT_CLASS =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

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
    <form onSubmit={onSubmit} className="space-y-4 border-t border-gray-200 pt-6" data-testid="password-form">
      <h2 className="text-lg font-semibold">{labels.title}</h2>
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
      <div>
        <label htmlFor="pwd-current" className="block text-sm font-medium mb-1">
          {labels.current}
        </label>
        <input
          id="pwd-current"
          type="password"
          autoComplete="current-password"
          className={INPUT_CLASS}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={isPending}
        />
      </div>
      <div>
        <label htmlFor="pwd-new" className="block text-sm font-medium mb-1">
          {labels.new}
        </label>
        <input
          id="pwd-new"
          type="password"
          autoComplete="new-password"
          className={INPUT_CLASS}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={isPending}
        />
      </div>
      <div>
        <label htmlFor="pwd-confirm" className="block text-sm font-medium mb-1">
          {labels.confirm}
        </label>
        <input
          id="pwd-confirm"
          type="password"
          autoComplete="new-password"
          className={INPUT_CLASS}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending}
        />
      </div>
      <button
        type="submit"
        data-testid="password-submit"
        disabled={isPending}
        className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {labels.submit}
      </button>
    </form>
  );
}
