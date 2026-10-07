/**
 * First-login password (FR-50). The (app) layout sends every flagged account
 * here; nothing else in the app renders until the person picks a password of
 * their own. Outside the (app) group so the layout's redirect cannot loop.
 */

export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import { signOut } from '@/lib/actions/profile';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SetPasswordForm } from './SetPasswordForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function SetPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const profile = await getCachedProfile(user.id);
  if (!profile?.active) redirect(`/${locale}/login`);
  if (!profile.must_change_password) redirect(`/${locale}/home`);

  const [t, tLogin] = await Promise.all([
    getTranslations('setPassword'),
    getTranslations('login'),
  ]);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <Image
            src="/bj-logo.png"
            alt={tLogin('brand')}
            width={160}
            height={80}
            priority
            className="h-16 w-auto object-contain"
          />
          <p className="text-center text-xl font-bold text-primary">{tLogin('brand')}</p>
        </div>

        <Card>
          <CardHeader className="space-y-2">
            <h1 className="text-center text-2xl font-semibold">{t('title')}</h1>
            <p className="text-center text-sm text-muted-foreground">
              {profile.full_name}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{t('intro')}</p>
            <SetPasswordForm locale={locale} />
          </CardContent>
        </Card>

        <form action={signOut.bind(null, locale)} className="text-center">
          <Button type="submit" variant="ghost" size="sm" data-testid="set-password-signout">
            {t('signOut')}
          </Button>
        </form>
      </div>
    </main>
  );
}
