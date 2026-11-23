'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { tabClass, tabListClass } from '@/lib/ui/tabs';

const TABS = [
  { key: 'profile', href: '' },
  { key: 'personalInfo', href: '/personal-info' },
  { key: 'preferences', href: '/preferences' },
  { key: 'security', href: '/security' },
] as const;

/** FR-96: Profile · Personal information · Preferences · Account security, the same underlined tabs as Admin. */
export function ProfileTabs({ locale }: { locale: string }) {
  const t = useTranslations('profile');
  // Farsi (default locale) pathnames carry no prefix; compare without it.
  const raw = usePathname();
  const pathname = raw.startsWith(`/${locale}/`) || raw === `/${locale}` ? raw : `/${locale}${raw}`;
  const base = `/${locale}/profile`;
  return (
    <nav aria-label={t('title')} className={tabListClass}>
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const on = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.key}
            href={href}
            data-testid={`profile-tab-${tab.key}`}
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
