/** Legacy archive links now open the unified Approvals page, whose guard preserves access. */
import { redirect } from 'next/navigation';
export default async function RequestsReviewPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
  }
  redirect(`/${locale}/manage/approvals${query.size ? `?${query}` : ''}`);
}
