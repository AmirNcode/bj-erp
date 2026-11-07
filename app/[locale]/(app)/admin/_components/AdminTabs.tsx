'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', href: '' },
  { key: 'sms', href: '/sms' },
  { key: 'system', href: '/system' },
  { key: 'audit', href: '/audit' },
  { key: 'signIns', href: '/sign-ins' },
  { key: 'viewAs', href: '/view-as' },
] as const;

/** Same segmented control as Settings' tabs. */
export function AdminTabs({ locale }: { locale: string }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const base = `/${locale}/admin`;
  return (
    <nav aria-label={t('title')} className="flex w-fit max-w-full overflow-x-auto rounded-[10px] bg-muted p-[3px]">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const on = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.key}
            href={href}
            data-testid={`admin-tab-${tab.key}`}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'inline-flex h-10 items-center whitespace-nowrap rounded-lg px-4 text-[13px] transition-colors sm:h-[30px]',
              on ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`tabs.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
