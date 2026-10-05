/**
 * The old My Team page. It is now the "my direct reports" filter of
 * Manage › Employees; old links and bookmarks land there.
 */

import { redirect } from 'next/navigation';

type Props = { params: Promise<{ locale: string }> };

export default async function MyTeamPage({ params }: Props) {
  const { locale } = await params;
  redirect(`/${locale}/manage/employees?filter=reports`);
}
