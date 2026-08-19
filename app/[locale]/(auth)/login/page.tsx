'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { useState, FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { signInWithCode } from '@/lib/auth/usernameEmail';
import { toLatinPassword } from '@/lib/auth/passwordPolicy';
import { toLatinCode } from '@/lib/employees/code';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isAppLocale,
  withLocalePrefix,
} from '@/lib/i18n/locale';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'fa';

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: authError, inactive, languagePref } = await signInWithCode(code, password);
      if (authError) {
        setError(t('invalidCredentials'));
      } else if (inactive) {
        setError(t('inactiveAccount'));
      } else {
        // FR-34: land on the language this person chose, not the one the login
        // URL happened to carry. Signing in is the moment the preference is
        // knowable again after a new device, a cleared browser, or a reinstalled
        // PWA — all cases where the cookie is gone but the database still knows.
        const target = isAppLocale(languagePref) ? languagePref : locale;
        if (isAppLocale(target)) {
          // Not httpOnly on purpose: this is a UI preference, not a credential,
          // and the client writes it here while the server writes it from
          // updateMyPrefs. The middleware reads whichever exists.
          document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
        }
        // withLocalePrefix keeps Farsi bare, so a Farsi user is not bounced
        // through /fa/home on to /home on every single login.
        router.push(isAppLocale(target) ? withLocalePrefix('/home', target) : `/${locale}/home`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand wordmark */}
        <div className="flex flex-col items-center gap-2">
          <Image
            src="/bj-logo.png"
            alt={t('brand')}
            width={160}
            height={80}
            priority
            className="h-16 w-auto object-contain"
          />
          <p className="text-center text-xl font-bold text-primary">{t('brand')}</p>
        </div>

        <Card>
          <CardHeader>
            <h1 className="text-center text-2xl font-semibold">{t('title')}</h1>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">{t('codeLabel')}</Label>
                {/* The code becomes the auth email — latin only, LTR even in fa. */}
                <Input
                  id="code"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={64}
                  dir="ltr"
                  lang="en"
                  placeholder={t('codePlaceholder')}
                  value={code}
                  onChange={(e) => setCode(toLatinCode(e.target.value))}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                {/* dir="ltr" on the wrapper too, so the reveal button stays at the
                    visual end of the field in the Farsi RTL layout. */}
                <div className="relative" dir="ltr">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={72}
                    dir="ltr"
                    lang="en"
                    className="pe-10"
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(toLatinPassword(e.target.value))}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    aria-pressed={showPassword}
                    data-testid="password-toggle"
                    className="absolute inset-y-0 end-0 flex items-center rounded-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" className="size-4" />
                    ) : (
                      <Eye aria-hidden="true" className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
              >
                {loading ? '...' : t('submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
