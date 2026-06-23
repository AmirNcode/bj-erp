/**
 * Authenticated home page.
 * Fetches the current user's profile row (RLS allows self-read)
 * and greets by full_name.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
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

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <h1 className="text-3xl font-semibold">
        {t('greeting', { name: fullName })}
      </h1>
    </main>
  );
}
