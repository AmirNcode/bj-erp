/**
 * FR-77 admin panel: the single admin only. Everyone else goes Home; every database function
 * behind these pages refuses non-admins as well.
 */
export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireAdminPage } from '@/lib/auth/adminGuard';
import { PageHeader } from '../_components/PageHeader';
import { AdminTabs } from './_components/AdminTabs';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, '/home');
  const t = await getTranslations('admin');
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5" data-testid="admin-panel">
      <PageHeader title={t('title')} />
      <AdminTabs locale={locale} />
      {children}
    </div>
  );
}
