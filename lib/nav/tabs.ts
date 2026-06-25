/**
 * Pure nav model — which bottom-tab entries a user sees, given their roles.
 * Unit-tested; no I/O. `href` is a locale-less path suffix; the nav component
 * prefixes the active locale.
 */

export type TabKey = 'home' | 'request' | 'calendar' | 'profile' | 'manage';
export type Tab = { key: TabKey; href: string; labelKey: string };

const BASE: Tab[] = [
  { key: 'home', href: '/home', labelKey: 'home' },
  { key: 'request', href: '/request', labelKey: 'request' },
  { key: 'calendar', href: '/calendar', labelKey: 'calendar' },
  { key: 'profile', href: '/profile', labelKey: 'profile' },
];

export function tabsForRoles(roles: string[]): Tab[] {
  const canManage = roles.includes('admin') || roles.includes('manager');
  return canManage
    ? [...BASE, { key: 'manage', href: '/manage/employees', labelKey: 'manage' }]
    : BASE;
}
