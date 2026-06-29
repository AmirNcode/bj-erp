/**
 * Manage section layout — server guard.
 * Only users with 'admin' or 'manager' role may enter.
 * Everyone else is redirected to /home.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function ManageLayout({ children, params }: Props) {
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

  const roles = (rolesData ?? []).map((r) => r.role);
  const canAccess = roles.includes('admin') || roles.includes('manager');

  if (!canAccess) {
    redirect(`/${locale}/home`);
  }

  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
