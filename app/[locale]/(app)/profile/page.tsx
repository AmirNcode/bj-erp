/**
 * Profile / Settings (FR-23) — calendar + language toggles, logout.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { SettingsForm } from './SettingsForm';

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

  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      <div className="mb-6 rounded-xl border border-gray-200 p-4 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-500">{t('name')}</span>
          <span className="font-medium">{profile?.full_name ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">{t('code')}</span>
          <span className="font-mono">{profile?.employee_code ?? '—'}</span>
        </div>
      </div>

      <SettingsForm
        current={{
          calendarPref: profile?.calendar_pref ?? 'jalali',
          languagePref: profile?.language_pref ?? 'fa',
        }}
        locale={locale}
        labels={formLabels}
      />
    </main>
  );
}
