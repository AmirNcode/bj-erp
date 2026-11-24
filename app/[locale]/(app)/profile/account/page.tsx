/** Old Account tab: language moved to Preferences, password + logout to Account security. */

export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function AccountRedirect({ params }: Props) {
  const { locale } = await params;
  redirect(`/${locale}/profile/preferences`);
}
