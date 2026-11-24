/**
 * Profile › Account security tab (FR-23, FR-97): password, then Logout.
 * Annotated section, then Logout in the end column.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { FormSection, FORM_SECTION_END_COL } from '@/components/FormSection';
import { FIELD_W } from '@/lib/ui/fieldWidths';
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
    <div>
      <FormSection title={tp('title')}>
        <Card className="p-4">
          <ChangePasswordForm />
        </Card>
      </FormSection>

      <div className={`pt-4 ${FORM_SECTION_END_COL}`}>
        <LogoutButton locale={locale} className={FIELD_W.shortSelect} />
      </div>
    </div>
  );
}
