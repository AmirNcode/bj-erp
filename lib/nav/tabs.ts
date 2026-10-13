import { can, type Perms } from '@/lib/permissions/catalog';

/**
 * Pure nav model — which navigation entries a user sees, given their roles and
 * FR-55 permissions.
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
 * Who is OFFERED a link is decided here: it follows FR-55 permissions; identity
 * roles only for approvals (and the manager's Employees link). What a caller can
 * actually do behind it is still enforced per page (manage/layout.tsx + per-page
 * guards), by server actions and by RLS.
 */

export type TabKey =
  | 'home'
  | 'request'
  | 'calendar'
  | 'organization'
  | 'profile'
  | 'manage'
  | 'absences'
  | 'finance';
export type Tab = { key: TabKey; href: string; labelKey: string; desktopOnly?: boolean };

export type ManageKey =
  | 'employees'
  | 'departments'
  | 'approvals'
  | 'requests'
  | 'approvalSteps'
  | 'reports'
  | 'absences'
  | 'finance';
export type NavItemKey = ManageKey | 'settings';
export type NavItem = { key: NavItemKey; href: string; labelKey: string; testId: string };

const BASE: Tab[] = [
  { key: 'home', href: '/home', labelKey: 'home' },
  { key: 'request', href: '/request', labelKey: 'request' },
  { key: 'calendar', href: '/calendar', labelKey: 'calendar' },
  // FR-44: every role. Desktop side panel only; mobile opens it from Profile.
  { key: 'organization', href: '/organization', labelKey: 'organization', desktopOnly: true },
];

type ManageEntry = NavItem & { allowed: (roles: string[], perms: Perms) => boolean };

// Approvals are identity-based (the approval chain routes to a person), not a permission.
const isApprover = (roles: string[]) => ['admin', 'manager', 'hr'].some((r) => roles.includes(r));

const isAdmin = (roles: string[]) => roles.includes('admin');

// FR-62: finance's list of completed approvals (finance read). Whoever already
// has a Manage group finds it there (admin, the hr preset under ruling a); for
// anyone else (the finance preset) it is a tab, so the mobile bar stays at five
// items. The approved-absences board (absences read) is never a tab: an admin
// opens it from Manage, every other holder sees it on Home (FR-56).
const FINANCE_TAB: Tab = { key: 'finance', href: '/finance', labelKey: 'finance' };

// Order is the side panel's order. Test ids are the ones the old Manage header
// links carried (nav-requests, nav-reports), so existing tests keep finding them.
const MANAGE: ManageEntry[] = [
  // `nav-manage` stays the entry point into Manage on desktop: it is the first
  // item of the group and lands on the employees hub, as the old tab did.
  { key: 'employees', href: '/manage/employees', labelKey: 'employees', testId: 'nav-manage', allowed: (roles, perms) => roles.includes('manager') || can(perms, 'people', 'read') },
  // FR-51: departments permission (read lists, edit creates/renames/sets managers).
  { key: 'departments', href: '/manage/departments', labelKey: 'departments', testId: 'nav-departments', allowed: (_roles, perms) => can(perms, 'departments', 'read') },
  { key: 'approvals', href: '/manage/approvals', labelKey: 'approvals', testId: 'nav-approvals', allowed: (roles) => isApprover(roles) },
  // FR-38 review screen: leave_requests read.
  { key: 'requests', href: '/manage/requests', labelKey: 'requests', testId: 'nav-requests', allowed: (_roles, perms) => can(perms, 'leave_requests', 'read') },
  // FR-42: approval_steps permission.
  { key: 'approvalSteps', href: '/manage/approval-steps', labelKey: 'approvalSteps', testId: 'nav-approval-steps', allowed: (_roles, perms) => can(perms, 'approval_steps', 'read') },
  // FR-37 reports: reports permission.
  { key: 'reports', href: '/manage/reports', labelKey: 'reports', testId: 'nav-reports', allowed: (_roles, perms) => can(perms, 'reports', 'read') },
  // FR-56: the admin's way to the approved-absences board (absences read is
  // implicit for the admin); other holders see it on Home (homeAbsencesBoard).
  { key: 'absences', href: '/absences', labelKey: 'absences', testId: 'nav-absences', allowed: isAdmin },
  // FR-62: inside Manage only for someone who has a Manage group anyway.
  { key: 'finance', href: '/finance', labelKey: 'finance', testId: 'nav-finance', allowed: (roles, perms) => can(perms, 'finance', 'read') && hasManageGroup(roles, perms) },
];

/** True when the caller reaches a Manage page other than Finance (which follows the group). */
function hasManageGroup(roles: string[], perms: Perms) {
  return MANAGE.some((i) => i.key !== 'finance' && i.allowed(roles, perms));
}

/** Bottom-bar tabs (mobile). Profile is reached from the bar's own profile tab. */
export function tabsForRoles(roles: string[], perms: Perms): Tab[] {
  const tabs = [...BASE];
  const manage = hasManageGroup(roles, perms);
  if (can(perms, 'finance', 'read') && !manage) tabs.push(FINANCE_TAB);
  if (manage) tabs.push({ key: 'manage', href: '/manage', labelKey: 'manage' });
  return tabs;
}

/** The labelled Manage group, filtered to what this caller can reach. */
export function manageItemsForRoles(roles: string[], perms: Perms): NavItem[] {
  return MANAGE.filter((item) => item.allowed(roles, perms)).map(({ key, href, labelKey, testId }) => ({
    key,
    href,
    labelKey,
    testId,
  }));
}

/**
 * Settings (work hours, weekly days off, official holidays): the admin, or either
 * settings permission at read (FR-55). Main's FR-59 "admin and hr" is the HR
 * preset holding work_settings and holidays edit.
 */
export function settingsItemForRoles(roles: string[], perms: Perms): NavItem | null {
  return isAdmin(roles) || can(perms, 'work_settings', 'read') || can(perms, 'holidays', 'read')
    ? { key: 'settings', href: '/settings', labelKey: 'settings', testId: 'nav-settings' }
    : null;
}

/**
 * FR-56: the approved-absences board on Home, for every holder of absences read
 * except the admin, who opens it from Manage › Absences instead.
 */
export function homeAbsencesBoard(roles: string[], perms: Perms): boolean {
  return !isAdmin(roles) && can(perms, 'absences', 'read');
}
