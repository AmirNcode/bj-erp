/**
 * Locale root — redirects to /home if authenticated, else to /login.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function RootPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(`/${locale}/home`);
  } else {
    redirect(`/${locale}/login`);
  }
}
