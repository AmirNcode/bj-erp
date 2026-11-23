/**
 * Profile › Preferences tab (FR-96): language. One column, sized for the controls.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TextSizeControl } from '@/components/profile/TextSizeControl';
import { getOwnFontStep } from '@/lib/prefs/fontStep.server';
import { LanguageSwitch } from '../../_components/LanguageSwitch';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PreferencesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('profile');
  const fontStep = await getOwnFontStep();

  return (
    <div className="w-full max-w-md">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('language')}</p>
              <LanguageSwitch locale={locale} testIdPrefix="settings-language" className="max-w-xs" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('textSize.title')}</CardTitle>
            <CardDescription>{t('textSize.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <TextSizeControl initialStep={fontStep} locale={locale === 'en' ? 'en' : 'fa'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
