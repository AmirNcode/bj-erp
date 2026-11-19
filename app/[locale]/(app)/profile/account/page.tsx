/**
 * Profile › Account tab (FR-23, FR-96): language, password, then Logout.
 * One column, half the page wide on desktop (matches the Profile tab tiles).
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguageSwitch } from '../../_components/LanguageSwitch';
import { ChangePasswordForm } from '../ChangePasswordForm';
import { LogoutButton } from '../LogoutButton';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tp] = await Promise.all([getTranslations('profile'), getTranslations('profile.password')]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>{t('preferences')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('language')}</p>
              <LanguageSwitch locale={locale} testIdPrefix="settings-language" className="max-w-xs" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>{tp('title')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <LogoutButton locale={locale} />
      </div>
    </div>
  );
}
