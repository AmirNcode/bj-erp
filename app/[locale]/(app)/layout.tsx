/**
 * Auth guard layout for all (app) routes.
 * Reads the session via the server client; redirects to /login if absent.
 */

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { BottomNav } from './_components/BottomNav';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function AppLayout({ children, params }: Props) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);
  const roles = (rolesData ?? []).map((r) => r.role as string);

  const t = await getTranslations({ locale, namespace: 'nav' });
  const labels = {
    home: t('home'),
    request: t('request'),
    calendar: t('calendar'),
    profile: t('profile'),
    manage: t('manage'),
  };

  return (
    <div className="min-h-dvh pb-20">
      {children}
      <BottomNav roles={roles} locale={locale} labels={labels} />
    </div>
  );
}
