/**
 * Profile › Preferences tab (FR-96): language and text size. Annotated sections.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { FormSection } from '@/components/FormSection';
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
    <div>
      <FormSection title={t('language')}>
        <Card className="p-4">
          <LanguageSwitch locale={locale} testIdPrefix="settings-language" className="max-w-xs" />
        </Card>
      </FormSection>

      <FormSection title={t('textSize.title')} description={t('textSize.description')}>
        <Card className="p-4">
          <TextSizeControl initialStep={fontStep} locale={locale === 'en' ? 'en' : 'fa'} />
        </Card>
      </FormSection>
    </div>
  );
}
