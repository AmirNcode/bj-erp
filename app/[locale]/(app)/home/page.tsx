/**
 * Authenticated home page.
 * Fetches the current user's profile row (RLS allows self-read)
 * and greets by full_name.
 * Admin/manager users also see a "Manage Employees" link.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tTeam = await getTranslations('team');
  const tRequest = await getTranslations('request');
  const tAllocations = await getTranslations('allocations');
  const supabase = await createClient();

  // Get the authenticated user (already verified by layout auth guard).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch profile to get full_name.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user!.id)
    .single();

  const fullName = profile?.full_name ?? user!.email ?? '';

  // Check if user has admin or manager role to show manage link
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user!.id);

  const roles = (rolesData ?? []).map((r) => r.role);
  const canManage = roles.includes('admin') || roles.includes('manager');
  const isManager = roles.includes('manager');

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">
        {t('greeting', { name: fullName })}
      </h1>

      {/* Leave request — all signed-in users */}
      <Link
        href={`/${locale}/request`}
        className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
      >
        {tRequest('navLink')}
      </Link>

      {canManage && (
        <Link
          href={`/${locale}/manage/employees`}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          {t('manageLink')}
        </Link>
      )}
      {canManage && (
        <Link
          href={`/${locale}/manage/allocations`}
          className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
        >
          {tAllocations('navLink')}
        </Link>
      )}
      {isManager && (
        <Link
          href={`/${locale}/team`}
          className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
        >
          {tTeam('navLink')}
        </Link>
      )}
    </main>
  );
}
