/**
 * Bulk CSV import — admin-only (managers are bounced to the employees list;
 * the RPC re-checks in-DB regardless). Three stages, all in ImportWizard:
 * template download → upload + validation preview → import + one-time
 * credentials download.
 */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { PageHeader } from '../../../_components/PageHeader';
import { ImportWizard } from './ImportWizard';

type Props = { params: Promise<{ locale: string }> };

export default async function ImportPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}/manage/employees`);

  const t = await getTranslations('manage.import');
  const tc = await getTranslations('manage.import.credentials');
  const supabase = await createClient();

  // Validation context: known department codes + taken personnel numbers.
  const [{ data: departments }, { data: profiles }] = await Promise.all([
    supabase.from('departments').select('name_fa, name_en, code').order('name_fa'),
    supabase.from('profiles').select('personnel_no').not('personnel_no', 'is', null),
  ]);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title={t('title')} />
      <ImportWizard
        departments={departments ?? []}
        existingPersonnelNos={(profiles ?? [])
          .map((p) => p.personnel_no)
          .filter((n): n is string => n !== null)}
        locale={locale}
        labels={{
          intro: t('intro'),
          template: t('template'),
          templateHint: t('templateHint'),
          upload: t('upload'),
          rowsValid: t('rowsValid'),
          rowsInvalid: t('rowsInvalid'),
          line: t('line'),
          problem: t('problem'),
          import: t('import'),
          importing: t('importing'),
          errorLabel: t('error'),
          errors: {
            missingColumn: t('errors.missingColumn'),
            required: t('errors.required'),
            badPersonnelNo: t('errors.badPersonnelNo'),
            dupInFile: t('errors.dupInFile'),
            dupExisting: t('errors.dupExisting'),
            unknownDept: t('errors.unknownDept'),
            unknownManager: t('errors.unknownManager'),
            badDate: t('errors.badDate'),
            badRole: t('errors.badRole'),
            badDays: t('errors.badDays'),
          },
          credentials: {
            title: tc('title'),
            warn: tc('warn'),
            download: tc('download'),
            name: tc('name'),
            code: tc('code'),
            password: tc('password'),
          },
        }}
      />
    </main>
  );
}
