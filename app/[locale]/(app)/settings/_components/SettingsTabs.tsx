/**
 * Settings › General | Roles (FR-55). Admin only: the Roles tab is the role
 * editor, which no permission can grant (D2). Two links styled as the
 * employees toolbar's segmented filter.
 */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

export async function SettingsTabs({
  locale,
  active,
}: {
  locale: string;
  active: 'general' | 'roles';
}) {
  const t = await getTranslations('rolesAdmin.tabs');
  const tNav = await getTranslations('nav');
  const tabs = [
    { key: 'general' as const, href: `/${locale}/settings`, label: t('general') },
    { key: 'roles' as const, href: `/${locale}/settings/roles`, label: t('roles') },
  ];
  return (
    <nav aria-label={tNav('settings')} className="flex w-fit max-w-full rounded-[10px] bg-muted p-[3px]">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            data-testid={`settings-tab-${tab.key}`}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'inline-flex h-10 items-center whitespace-nowrap rounded-lg px-4 text-[13px] transition-colors sm:h-[30px]',
              on ? 'bg-card font-semibold text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
