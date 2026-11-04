/**
 * FR-77 admin panel: the single admin only. Everyone else goes Home; every database function
 * behind these pages refuses non-admins as well. English only, LTR, in either app language
 * (owner, 2026-11-04; lib/admin/locale.ts).
 */
export const dynamic = 'force-dynamic';

import { ADMIN_LOCALE } from '@/lib/admin/locale';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { requireAdminPage } from '@/lib/auth/adminGuard';
import { PageHeader } from '../_components/PageHeader';
import { AdminTabs } from './_components/AdminTabs';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, '/home');
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin' });
  // Messages are atomic in a nested provider, so the whole English catalog goes in.
  const messages = await getMessages({ locale: ADMIN_LOCALE });
  return (
    <NextIntlClientProvider locale={ADMIN_LOCALE} messages={messages}>
      <div dir="ltr" lang={ADMIN_LOCALE} className="mx-auto flex w-full max-w-[1000px] flex-col gap-5" data-testid="admin-panel">
        <PageHeader title={t('title')} />
        <AdminTabs locale={locale} />
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
