/**
 * Pure nav model — which navigation entries a user sees, given their roles.
 * Unit-tested; no I/O. `href` is a locale-less path suffix; the nav component
 * prefixes the active locale.
 *
 * Two surfaces read it:
 * - the desktop side panel: `tabsForRoles` minus the mobile-only Manage tab,
 *   then the labelled Manage group (`manageItemsForRoles`), then Settings
 *   (`settingsItemForRoles`) on its own.
 * - the mobile bottom bar: `tabsForRoles` minus `desktopOnly` tabs. Its Manage
 *   tab opens /manage, a list page holding the same grouped items.
 *   Organization is desktop-only: on mobile it is a link on the Profile screen,
 *   keeping the bar at 4/5 items (owner decision 2026-10-05, FR-44).
 *
 * Who is OFFERED a link is decided here. What each role can actually do behind
 * it is still enforced per page (manage/layout.tsx + per-page guards) and by RLS.
 */

export type TabKey = 'home' | 'request' | 'calendar' | 'organization' | 'profile' | 'manage';
export type Tab = { key: TabKey; href: string; labelKey: string; desktopOnly?: boolean };

export type ManageKey =
  | 'employees'
  | 'departments'
  | 'approvals'
  | 'requests'
  | 'approvalSteps'
  | 'reports';
export type NavItemKey = ManageKey | 'settings';
export type NavItem = { key: NavItemKey; href: string; labelKey: string; testId: string };

const BASE: Tab[] = [
  { key: 'home', href: '/home', labelKey: 'home' },
  { key: 'request', href: '/request', labelKey: 'request' },
  { key: 'calendar', href: '/calendar', labelKey: 'calendar' },
  // FR-44: every role. Desktop side panel only; mobile opens it from Profile.
  { key: 'organization', href: '/organization', labelKey: 'organization', desktopOnly: true },
];

function canManage(roles: string[]) {
  // `hr` joins admin/manager here (FR-35).
  return roles.includes('admin') || roles.includes('manager') || roles.includes('hr');
}

/** Bottom-bar tabs (mobile). Profile is reached from the bar's own profile tab. */
export function tabsForRoles(roles: string[]): Tab[] {
  return canManage(roles)
    ? [...BASE, { key: 'manage', href: '/manage', labelKey: 'manage' }]
    : BASE;
}

type ManageEntry = NavItem & { allowed: (roles: string[]) => boolean };

const isAdmin = (roles: string[]) => roles.includes('admin');
const isAdminOrHr = (roles: string[]) => roles.includes('admin') || roles.includes('hr');

// Order is the side panel's order. Test ids are the ones the old Manage header
// links carried (nav-requests, nav-reports), so existing tests keep finding them.
const MANAGE: ManageEntry[] = [
  // `nav-manage` stays the entry point into Manage on desktop: it is the first
  // item of the group and lands on the employees hub, as the old tab did.
  { key: 'employees', href: '/manage/employees', labelKey: 'employees', testId: 'nav-manage', allowed: canManage },
  { key: 'departments', href: '/manage/departments', labelKey: 'departments', testId: 'nav-departments', allowed: isAdmin },
  { key: 'approvals', href: '/manage/approvals', labelKey: 'approvals', testId: 'nav-approvals', allowed: canManage },
  // FR-38 review screen: hr + admin only.
  { key: 'requests', href: '/manage/requests', labelKey: 'requests', testId: 'nav-requests', allowed: isAdminOrHr },
  // FR-42: HR configures the approval chain too.
  { key: 'approvalSteps', href: '/manage/approval-steps', labelKey: 'approvalSteps', testId: 'nav-approval-steps', allowed: isAdminOrHr },
  // FR-37 reports: same audience as the review screen.
  { key: 'reports', href: '/manage/reports', labelKey: 'reports', testId: 'nav-reports', allowed: isAdminOrHr },
];

/** The labelled Manage group, filtered to what this caller can reach. */
export function manageItemsForRoles(roles: string[]): NavItem[] {
  if (!canManage(roles)) return [];
  return MANAGE.filter((item) => item.allowed(roles)).map(({ key, href, labelKey, testId }) => ({
    key,
    href,
    labelKey,
    testId,
  }));
}

/** Settings (weekly days off, official holidays) — company config, admin only. */
export function settingsItemForRoles(roles: string[]): NavItem | null {
  return isAdmin(roles)
    ? { key: 'settings', href: '/settings', labelKey: 'settings', testId: 'nav-settings' }
    : null;
}
