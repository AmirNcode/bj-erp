/**
 * My Team page — lists the current manager's direct reports.
 * Only users with the 'manager' role should navigate here (guarded via nav).
 * The auth layout already requires a session; this page adds a role check.
 */

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '../_components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ListSkeleton } from '@/components/Skeletons';

type Props = {
  params: Promise<{ locale: string }>;
};

// ── async child that owns all data fetching ────────────────────────────────
async function TeamData({ locale }: { locale: string }) {
  const t = await getTranslations('team');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  // Check manager role
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const roles = (rolesData ?? []).map((r) => r.role);
  const isManager = roles.includes('manager');
  const isAdmin = roles.includes('admin');

  // Redirect non-managers back home
  if (!isManager && !isAdmin) {
    redirect(`/${locale}/home`);
  }

  // Fetch direct reports (profiles where manager_id = current user)
  const { data: reports } = await supabase
    .from('profiles')
    .select(
      `
      id,
      employee_code,
      full_name,
      department_id,
      departments!profiles_department_id_fkey (name_fa, name_en)
    `
    )
    .eq('manager_id', user.id)
    .order('full_name');

  return (
    <>
      {t('managerNote') && (
        <p className="bg-secondary text-secondary-foreground border border-border px-4 py-3 rounded-lg text-sm mb-5">
          {t('managerNote')}
        </p>
      )}

      {/* Desktop table */}
      <Card className="hidden md:block overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('code')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('name')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('department')}
                </th>
                <th className="text-start px-4 py-3 font-semibold text-foreground/80">
                  {t('edit')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(reports ?? []).map((emp) => (
                <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm">{emp.employee_code}</td>
                  <td className="px-4 py-3">{emp.full_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {emp.departments
                      ? locale === 'fa'
                        ? (emp.departments as { name_fa: string }).name_fa
                        : (emp.departments as { name_en: string }).name_en
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                      <Link href={`/${locale}/manage/employees/${emp.id}`}>{t('edit')}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {(reports ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {t('noReports')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {(reports ?? []).length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t('noReports')}
            </CardContent>
          </Card>
        )}
        {(reports ?? []).map((emp) => (
          <Card key={emp.id}>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{emp.full_name}</p>
                  <p className="font-mono text-sm text-muted-foreground">{emp.employee_code}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {emp.departments
                    ? locale === 'fa'
                      ? (emp.departments as { name_fa: string }).name_fa
                      : (emp.departments as { name_en: string }).name_en
                    : '—'}
                </p>
                <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                  <Link href={`/${locale}/manage/employees/${emp.id}`}>{t('edit')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

// ── page shell ─────────────────────────────────────────────────────────────
export default async function MyTeamPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('team');

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <PageHeader title={t('title')} />
      <p className="text-muted-foreground text-sm mb-6">{t('subtitle')}</p>
      <Suspense fallback={<ListSkeleton count={4} />}>
        <TeamData locale={locale} />
      </Suspense>
    </main>
  );
}
