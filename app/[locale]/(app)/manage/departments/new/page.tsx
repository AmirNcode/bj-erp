/**
 * Create new department page — admin only. The manage layout already keeps
 * employees out; managers are bounced here because departments are a
 * company-wide setting (RLS: departments_insert_admin).
 *
 * A department must exist before an employee can be assigned to it: its `code`
 * is the latin prefix of every login code issued in it (prod → prod-1042).
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { PageHeader } from '../../../_components/PageHeader';
import { NewDepartmentForm } from './NewDepartmentForm';
import { FormSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function NewDepartmentData({ locale }: { locale: string }) {
  const t = await getTranslations('manage.departments');
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('departments')
    .select('id, name_fa, name_en, code')
    .order('name_fa');

  return (
    <NewDepartmentForm
      existing={existing ?? []}
      locale={locale}
      labels={{
        nameFa: t('nameFa'),
        nameEn: t('nameEn'),
        code: t('code'),
        codeHint: t('codeHint'),
        kind: t('kind'),
        kindTeam: t('kindTeam'),
        kindOffice: t('kindOffice'),
        kindSecurity: t('kindSecurity'),
        create: t('create'),
        cancel: t('cancel'),
        existingTitle: t('existingTitle'),
        createdTitle: t('createdTitle'),
        createdHint: t('createdHint'),
        addEmployee: t('addEmployee'),
        backToList: t('backToList'),
        invalid: t('invalid'),
        nameRequired: t('nameRequired'),
        errorLabel: t('error'),
      }}
    />
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function NewDepartmentPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const roles = await getCachedRoles(user.id);
  if (!roles.includes('admin')) redirect(`/${locale}/manage/employees`);

  const t = await getTranslations('manage.departments');

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <PageHeader title={t('newTitle')} />
      <Suspense fallback={<FormSkeleton />}>
        <NewDepartmentData locale={locale} />
      </Suspense>
    </main>
  );
}
