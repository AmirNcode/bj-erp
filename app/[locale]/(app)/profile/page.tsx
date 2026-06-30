/**
 * Profile / Settings (FR-23) — calendar + language toggles, logout.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '../_components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsForm } from './SettingsForm';
import { ChangePasswordForm } from './ChangePasswordForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('profile');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, employee_code, calendar_pref, language_pref')
    .eq('id', user.id)
    .single();

  const formLabels = {
    calendar: t('calendar'),
    language: t('language'),
    jalali: t('jalali'),
    gregorian: t('gregorian'),
    langFa: t('langFa'),
    langEn: t('langEn'),
    logout: t('logout'),
    saved: t('saved'),
    errorLabel: t('error'),
  };

  const tp = await getTranslations('profile.password');
  const passwordLabels = {
    title: tp('title'),
    current: tp('current'),
    new: tp('new'),
    confirm: tp('confirm'),
    submit: tp('submit'),
    changed: tp('changed'),
    tooShort: tp('tooShort'),
    mismatch: tp('mismatch'),
    emptyCurrent: tp('emptyCurrent'),
    errorLabel: t('error'),
  };

  return (
    <main className="p-4 max-w-lg mx-auto space-y-4">
      <PageHeader title={t('title')} />

      {/* Employee info */}
      <Card>
        <CardContent className="pt-2 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('name')}</span>
            <span className="font-medium">{profile?.full_name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('code')}</span>
            <span className="font-mono">{profile?.employee_code ?? '—'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('preferences')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <SettingsForm
            current={{
              calendarPref: profile?.calendar_pref ?? 'jalali',
              languagePref: profile?.language_pref ?? 'fa',
            }}
            locale={locale}
            labels={formLabels}
          />
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{tp('title')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <ChangePasswordForm labels={passwordLabels} />
        </CardContent>
      </Card>
    </main>
  );
}
