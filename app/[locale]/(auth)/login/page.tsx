'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { useState, FormEvent } from 'react';
import { signInWithCode } from '@/lib/auth/usernameEmail';
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await signInWithCode(code, password);
      if (authError) {
        setError(t('invalidCredentials'));
      } else {
        router.push(`/${locale}/home`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand wordmark */}
        <p className="text-center text-xl font-bold text-primary">{t('brand')}</p>

        <Card>
          <CardHeader>
            <h1 className="text-center text-2xl font-semibold">{t('title')}</h1>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">{t('codeLabel')}</Label>
                <Input
                  id="code"
                  type="text"
                  autoComplete="username"
                  placeholder={t('codePlaceholder')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
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
