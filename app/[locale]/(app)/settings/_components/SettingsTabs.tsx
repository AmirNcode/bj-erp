/** Settings tabs: role authoring remains admin-only; delegates get their own panel. */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCachedUser, getCachedRoles, getCachedPermissions } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { can } from '@/lib/permissions/catalog';
import { tabClass, tabListClass } from '@/lib/ui/tabs';

export async function SettingsTabs({
  locale,
  active,
}: {
  locale: string;
  active: 'general' | 'roles';
}) {
  const t = await getTranslations('rolesAdmin.tabs');
  const tNav = await getTranslations('nav');
  const user = await getCachedUser();
  if (!user) return null;
  const [roles, perms, capabilities] = await Promise.all([getCachedRoles(user.id), getCachedPermissions(user.id), getApprovalCapabilities()]);
  const general = roles.includes('admin') || can(perms, 'work_settings', 'read') || can(perms, 'holidays', 'read');
  const tabs = [
    { key: 'general' as const, href: `/${locale}/settings`, label: t('general') },
    { key: 'roles' as const, href: `/${locale}/settings/roles`, label: capabilities.isAdmin ? t('roles') : t('myDelegate') },
  ].filter((tab) => tab.key === 'general' ? general : capabilities.isAdmin || capabilities.canDelegate);
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
