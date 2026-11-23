/** Settings tabs: role authoring remains admin-only; delegates get their own panel. */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { can } from '@/lib/permissions/catalog';
import { tabClass, tabListClass } from '@/lib/ui/tabs';

export async function SettingsTabs({
  locale,
  active,
}: {
  locale: string;
  active: 'workingTimes' | 'holidays' | 'roles';
}) {
  const t = await getTranslations('rolesAdmin.tabs');
  const tNav = await getTranslations('nav');
  const user = await getCachedUser();
  if (!user) return null;
  const [perms, capabilities] = await Promise.all([getCachedPermissions(user.id), getApprovalCapabilities()]);
  const tabs = [
    { key: 'workingTimes', href: `/${locale}/settings`, label: t('workingTimes'), visible: capabilities.isAdmin || can(perms, 'work_settings', 'read') },
    { key: 'holidays', href: `/${locale}/settings?tab=holidays`, label: t('holidays'), visible: capabilities.isAdmin || can(perms, 'holidays', 'read') },
    { key: 'roles', href: `/${locale}/settings/roles`, label: capabilities.isAdmin ? t('roles') : t('myDelegate'), visible: capabilities.isAdmin || capabilities.canDelegate },
  ].filter((tab) => tab.visible);
  return (
    <nav aria-label={tNav('settings')} className={tabListClass}>
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            data-testid={`settings-tab-${tab.key}`}
            aria-current={on ? 'page' : undefined}
            className={tabClass(on)}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
