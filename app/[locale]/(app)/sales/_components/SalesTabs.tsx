'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { tabClass, tabListClass } from '@/lib/ui/tabs';
import { LinkPending } from '@/components/LinkPending';

/** Records · Customers · Products · Deadlines · Reports · Settings · Activity. The last three only for their holders. */
export function SalesTabs({ reports, settings, activity }: { reports: boolean; settings: boolean; activity: boolean }) {
  const t = useTranslations('sales.tabs');
  const locale = useLocale();
  const pathname = usePathname();
  // Farsi URLs carry no locale prefix.
  const path = pathname.startsWith(`/${locale}/`) ? pathname.slice(locale.length + 1) : pathname;
  const tabs = [
    { href: '/sales', key: 'records', on: path === '/sales' || /^\/sales\/[0-9a-f]{8}-[0-9a-f-]{27}/.test(path) },
    { href: '/sales/customers', key: 'customers', on: path.startsWith('/sales/customers') },
    { href: '/sales/products', key: 'products', on: path.startsWith('/sales/products') },
    { href: '/sales/deadlines', key: 'deadlines', on: path.startsWith('/sales/deadlines') },
    ...(reports ? [{ href: '/sales/reports', key: 'reports', on: path.startsWith('/sales/reports') }] : []),
    ...(settings ? [{ href: '/sales/settings', key: 'settings', on: path.startsWith('/sales/settings') }] : []),
    ...(activity ? [{ href: '/sales/activity', key: 'activity', on: path.startsWith('/sales/activity') }] : []),
  ] as const;
  return (
    <nav className={tabListClass} aria-label={t('label')}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}${tab.href}`}
          aria-current={tab.on ? 'page' : undefined}
          className={tabClass(tab.on)}
          data-testid={`sales-tab-${tab.key}`}
        >
          {t(tab.key)}
          <LinkPending className="hidden" />
        </Link>
      ))}
    </nav>
  );
}
