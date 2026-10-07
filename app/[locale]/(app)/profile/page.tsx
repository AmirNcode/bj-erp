/**
 * Profile / Settings (FR-23) — language, saved signature (FR-52), link to
 * personal information (FR-53), password, logout.
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import { PageHeader } from '../_components/PageHeader';
import { PageRefreshButton } from '../_components/PageRefreshButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguageSwitch } from '../_components/LanguageSwitch';
import { ChangePasswordForm } from './ChangePasswordForm';
import { LogoutButton } from './LogoutButton';
import { SavedSignatureCard } from './SavedSignatureCard';
import { getMySavedSignature } from '@/lib/actions/signature';
import { createClient } from '@/lib/supabase/server';
import { getClearanceSummary } from '@/lib/actions/clearance';
import { formatNumber } from '@/lib/i18n/format';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('profile');
  const tOrg = await getTranslations('org');
  const user = await getCachedUser();
  if (!user) return null;

  const supabase = await createClient();
  const [profile, savedRes, { data: personalInfo }, clearance] = await Promise.all([
    getCachedProfile(user.id),
    getMySavedSignature(),
    supabase.from('employee_personal_info').select('complete').eq('employee_id', user.id).maybeSingle(),
    getClearanceSummary(),
  ]);
  const tClr = await getTranslations('clearance');
  const tSig = await getTranslations('profile.signature');
  const tPi = await getTranslations('personalInfo');

  const formLabels = {
    language: t('language'),
    langFa: t('langFa'),
    langEn: t('langEn'),
  };

  const tl = await getTranslations('profile.logoutConfirm');
  const logoutLabels = {
    trigger: tl('trigger'),
    title: tl('title'),
    body: tl('body'),
    cancel: tl('cancel'),
    confirm: tl('confirm'),
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
    tooLong: tp('tooLong'),
    mismatch: tp('mismatch'),
    emptyCurrent: tp('emptyCurrent'),
    errorLabel: t('error'),
  };

  return (
    <main className="p-4 max-w-lg mx-auto space-y-4">
      {/* Mobile has no side panel, so its refresh control lives here. */}
      <PageHeader
        title={t('title')}
        action={
          <div className="md:hidden">
            <PageRefreshButton />
          </div>
        }
      />

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

      {/* FR-44: on mobile the org chart is reached from here — the bottom bar
          stays at 4/5 tabs. Desktop has it in the side panel. */}
      <Link
        href={`/${locale}/organization`}
        data-testid="profile-org-link"
        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 md:hidden"
      >
        <span>
          <span className="block text-sm font-semibold">{tOrg('openFromProfile')}</span>
          <span className="block text-xs text-muted-foreground">{tOrg('openFromProfileHint')}</span>
        </span>
        <span aria-hidden className="text-muted-foreground rtl:rotate-180">
          ›
        </span>
      </Link>

      {/* FR-53: personal information lives on its own page; it is a long form. */}
      <Link
        href={`/${locale}/profile/personal-info`}
        data-testid="profile-personal-info-link"
        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
      >
        <span>
          <span className="block text-sm font-semibold">{tPi('title')}</span>
          <span className="block text-xs text-muted-foreground">
            {personalInfo?.complete ? tPi('completeHint') : tPi('incompleteHint')}
          </span>
        </span>
        <span aria-hidden className="text-muted-foreground rtl:rotate-180">
          ›
        </span>
      </Link>

      {/* FR-54: clearance forms live under Profile for now (spec D9). Shown to
          admin, hr and finance, and to anyone a form names (signer or leaver). */}
      {clearance.visible && (
        <Link
          href={`/${locale}/profile/clearance`}
          data-testid="profile-clearance-link"
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span>
            <span className="block text-sm font-semibold">{tClr('cardTitle')}</span>
            <span className="block text-xs text-muted-foreground">
              {clearance.awaiting > 0
                ? tClr('awaitingCount', { count: formatNumber(clearance.awaiting, locale) })
                : tClr('cardHint')}
            </span>
          </span>
          <span aria-hidden className="text-muted-foreground rtl:rotate-180">
            ›
          </span>
        </Link>
      )}

      {/* FR-52: saved signature */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{tSig('title')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <SavedSignatureCard initial={savedRes.ok ? savedRes.signature : null} />
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('preferences')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{formLabels.language}</p>
            <LanguageSwitch
              locale={locale}
              labels={{ label: formLabels.language, fa: formLabels.langFa, en: formLabels.langEn }}
              testIdPrefix="settings-language"
              className="max-w-xs"
            />
          </div>
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

      {/* Logout — deliberately outside any card, at the very bottom */}
      <LogoutButton locale={locale} labels={logoutLabels} />
    </main>
  );
}
