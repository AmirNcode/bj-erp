/**
 * Locale root — redirects to /home if authenticated, else to /login.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getCachedUser } from '@/lib/auth/context';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function RootPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();

  if (user) {
    redirect(`/${locale}/home`);
  } else {
    redirect(`/${locale}/login`);
  }
}
