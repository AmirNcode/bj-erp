import { describe, it, expect } from 'vitest';
import { manageItemsForRoles, settingsItemForRoles, tabsForRoles } from '@/lib/nav/tabs';
import { fullPerms, type Perms } from '@/lib/permissions/catalog';

const HR: Perms = { people: 'edit', people_create: 'edit', role_manager: 'edit', personal_info: 'edit', clearance: 'edit', departments: 'edit', leave_balances: 'edit', leave_accrual: 'edit', leave_requests: 'read', calendar: 'read', reports: 'read', approval_steps: 'edit' };
const SEC: Perms = { people: 'read', leave_balances: 'read', leave_requests: 'read', calendar: 'read' };

describe('tabsForRoles', () => {
  it('employee: base tabs plus organization, no manage', () => {
    expect(tabsForRoles(['employee'], {}).map((t) => t.key)).toEqual([
      'home',
      'request',
      'calendar',
      'organization',
    ]);
  });
  it('every role reaches the organization chart, on desktop only (FR-44)', () => {
    const cases: [string[], Perms][] = [
      [['employee'], {}],
      [['manager'], {}],
      [['hr'], HR],
      [['admin'], fullPerms()],
      [['security'], SEC],
    ];
    for (const [roles, perms] of cases) {
      const org = tabsForRoles(roles, perms).find((t) => t.key === 'organization');
      expect(org).toMatchObject({ href: '/organization', desktopOnly: true });
    }
  });
  it('manager gets the manage tab', () => {
    expect(tabsForRoles(['employee', 'manager'], {}).map((t) => t.key)).toContain('manage');
  });
  it('admin gets the manage tab', () => {
    expect(tabsForRoles(['admin'], fullPerms()).map((t) => t.key)).toContain('manage');
  });
  it('security preset now reaches the manage tab (FR-55)', () => {
    expect(tabsForRoles(['security'], SEC).map((t) => t.key)).toContain('manage');
  });
  it('security gets no absences tab — the board is on their Home (FR-56)', () => {
    expect(tabsForRoles(['employee', 'security'], SEC).map((t) => t.key)).not.toContain('absences');
  });
  it('finance gets the finance tab (FR-62)', () => {
    expect(tabsForRoles(['employee', 'finance'], {}).find((t) => t.key === 'finance')).toMatchObject({
      href: '/finance',
    });
  });
  it('an admin reaches both from Manage, not as extra tabs', () => {
    const keys = tabsForRoles(['admin', 'security', 'finance'], fullPerms()).map((t) => t.key);
    expect(keys).not.toContain('absences');
    expect(keys).not.toContain('finance');
  });
  it('hr gets the manage tab (FR-35)', () => {
    expect(tabsForRoles(['hr'], HR).map((t) => t.key)).toContain('manage');
  });
  it('hr alongside employee still gets it', () => {
    expect(tabsForRoles(['employee', 'hr'], HR).map((t) => t.key)).toContain('manage');
  });
  it('an unknown role with no permissions grants nothing', () => {
    // Roles arrive from a JWT claim; an unrecognised one must not open /manage.
    expect(tabsForRoles(['hrx'], {}).map((t) => t.key)).not.toContain('manage');
    expect(tabsForRoles(['HR'], {}).map((t) => t.key)).not.toContain('manage');
  });
  it('mobile manage tab opens the manage list page', () => {
    const manage = tabsForRoles(['admin'], fullPerms()).find((t) => t.key === 'manage');
    expect(manage?.href).toBe('/manage');
  });
  it('a holidays-only clerk gets Settings and no Manage', () => {
    expect(settingsItemForRoles(['employee'], { holidays: 'edit' })).not.toBeNull();
    expect(tabsForRoles(['employee'], { holidays: 'edit' }).map((t) => t.key)).not.toContain('manage');
  });
});

describe('manageItemsForRoles', () => {
  const keys = (roles: string[], perms: Perms) => manageItemsForRoles(roles, perms).map((i) => i.key);

  it('employee gets no manage group', () => {
    expect(keys(['employee'], {})).toEqual([]);
  });
  it('security preset now reaches employees and the archive (spec: visible difference)', () => {
    expect(keys(['security'], SEC)).toEqual(['employees', 'requests']);
  });
  it('manager keeps employees + approvals with no perms', () => {
    expect(keys(['employee', 'manager'], {})).toEqual(['employees', 'approvals']);
  });
  it('hr preset: same manage items as before FR-55', () => {
    expect(keys(['hr'], HR)).toEqual([
      'employees',
      'departments',
      'approvals',
      'requests',
      'approvalSteps',
      'reports',
    ]);
  });
  it('admin reaches the whole group', () => {
    expect(keys(['admin'], fullPerms())).toEqual([
      'employees',
      'departments',
      'approvals',
      'requests',
      'approvalSteps',
      'reports',
      'absences',
      'finance',
    ]);
  });
  it('hr does not get the security or finance screens', () => {
    expect(keys(['hr'], HR)).not.toContain('absences');
    expect(keys(['hr'], HR)).not.toContain('finance');
  });
  it('hr with an emptied role keeps only Approvals (identity-based)', () => {
    expect(keys(['hr'], {})).toEqual(['approvals']);
  });
  it('helpdesk (people read + passwords) gets Employees only', () => {
    expect(keys(['employee'], { people: 'read', passwords: 'edit' })).toEqual(['employees']);
  });
  it('the employees hub keeps the nav-manage test id', () => {
    expect(manageItemsForRoles(['manager'], {})[0]).toMatchObject({
      key: 'employees',
      href: '/manage/employees',
      testId: 'nav-manage',
    });
  });
});

describe('settingsItemForRoles', () => {
  it('is admin and hr (FR-59)', () => {
    expect(settingsItemForRoles(['admin'], fullPerms())).toMatchObject({ href: '/settings', testId: 'nav-settings' });
    expect(settingsItemForRoles(['hr'], HR)).toMatchObject({ href: '/settings' });
  });
  it('manager and employee with no perms: no link', () => {
    expect(settingsItemForRoles(['manager'], {})).toBeNull();
    expect(settingsItemForRoles(['employee'], {})).toBeNull();
  });
  it('work_settings read alone opens it', () => {
    expect(settingsItemForRoles(['employee'], { work_settings: 'read' })).not.toBeNull();
  });
});
