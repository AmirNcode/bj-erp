'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { tabClass, tabListClass } from '@/lib/ui/tabs';

const TABS = [
  { key: 'overview', href: '' },
  { key: 'sms', href: '/sms' },
  { key: 'system', href: '/system' },
  { key: 'audit', href: '/audit' },
  { key: 'signIns', href: '/sign-ins' },
  { key: 'viewAs', href: '/view-as' },
] as const;

/** Same underlined tabs as Settings. */
export function AdminTabs({ locale }: { locale: string }) {
  const t = useTranslations('admin');
  // Farsi (default locale) pathnames carry no prefix; compare without it.
  const raw = usePathname();
  const pathname = raw.startsWith(`/${locale}/`) || raw === `/${locale}` ? raw : `/${locale}${raw}`;
  const base = `/${locale}/admin`;
  return (
    <nav aria-label={t('title')} className={tabListClass}>
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const on = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.key}
            href={href}
            data-testid={`admin-tab-${tab.key}`}
            aria-current={on ? 'page' : undefined}
            className={tabClass(on)}
          >
            {t(`tabs.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
