/**
 * Profile › Account security tab (FR-23, FR-96): password, then Logout.
 * One column, sized for the password form.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from '../ChangePasswordForm';
import { LogoutButton } from '../LogoutButton';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function SecurityPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tp = await getTranslations('profile.password');

  return (
    <div className="w-full max-w-md">
      <div className="space-y-4">
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
