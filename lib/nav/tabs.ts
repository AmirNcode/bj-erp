/**
 * Pure nav model — which bottom-tab entries a user sees, given their roles.
 * Unit-tested; no I/O. `href` is a locale-less path suffix; the nav component
 * prefixes the active locale.
 */

export type TabKey = 'home' | 'request' | 'calendar' | 'profile' | 'manage';
export type Tab = { key: TabKey; href: string; labelKey: string };

// Profile is NOT a tab — it lives in the app header (see AppShell), but stays
// in TabKey so labels/icons remain keyed consistently.
const BASE: Tab[] = [
  { key: 'home', href: '/home', labelKey: 'home' },
  { key: 'request', href: '/request', labelKey: 'request' },
  { key: 'calendar', href: '/calendar', labelKey: 'calendar' },
];

export function tabsForRoles(roles: string[]): Tab[] {
  // `hr` joins admin/manager here (FR-35). What each of them can actually DO
  // inside /manage differs and is enforced per page and by RLS — this only
  // decides who is offered the tab.
  const canManage =
    roles.includes('admin') || roles.includes('manager') || roles.includes('hr');
  return canManage
    ? [...BASE, { key: 'manage', href: '/manage/employees', labelKey: 'manage' }]
    : BASE;
}
