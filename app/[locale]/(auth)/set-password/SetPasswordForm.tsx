'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { setInitialPassword } from '@/lib/actions/profile';
import { toLatinPassword, validateNewPassword } from '@/lib/auth/passwordPolicy';
import { isAppLocale, withLocalePrefix } from '@/lib/i18n/locale';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function SetPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations('setPassword');
  const tPassword = useTranslations('profile.password');
  const tLogin = useTranslations('login');
  const router = useRouter();

  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const v = validateNewPassword(next, confirm);
    if (!v.ok) {
      setError(
        v.reason === 'too_short'
          ? tPassword('tooShort')
          : v.reason === 'too_long'
            ? tPassword('tooLong')
            : tPassword('mismatch')
      );
      return;
    }
    startTransition(async () => {
      const res = await setInitialPassword(next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace(isAppLocale(locale) ? withLocalePrefix('/home', locale) : `/${locale}/home`);
    });
  };

  // Latin + LTR, same rule as the login field: a password that cannot be typed
  // on the login page must not be settable here.
  const inputProps = {
    type: show ? 'text' : 'password',
    autoComplete: 'new-password',
    dir: 'ltr',
    lang: 'en',
    autoCapitalize: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    maxLength: 72,
    disabled: isPending,
  } as const;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate data-testid="set-password-form">
      <div className="space-y-1.5">
        <Label htmlFor="new-password">{t('new')}</Label>
        <div className="relative" dir="ltr">
          <Input
            id="new-password"
            data-testid="set-password-new"
            className="pe-10"
            value={next}
            onChange={(e) => setNext(toLatinPassword(e.target.value))}
            {...inputProps}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? tLogin('hidePassword') : tLogin('showPassword')}
            aria-pressed={show}
            className="absolute inset-y-0 end-0 flex items-center rounded-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {show ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">{t('confirm')}</Label>
        <Input
          id="confirm-password"
          data-testid="set-password-confirm"
          value={confirm}
          onChange={(e) => setConfirm(toLatinPassword(e.target.value))}
          {...inputProps}
        />
      </div>

      {error && (
        <p role="alert" data-testid="set-password-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full" data-testid="set-password-submit">
        {isPending ? '...' : t('submit')}
      </Button>
    </form>
  );
}
