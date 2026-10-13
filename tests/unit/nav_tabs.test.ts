import { describe, it, expect } from 'vitest';
import { homeAbsencesBoard, manageItemsForRoles, settingsItemForRoles, tabsForRoles } from '@/lib/nav/tabs';
import { fullPerms, type Perms } from '@/lib/permissions/catalog';

// The presets as seeded (migration 20261013200001, seed_company_roles).
const HR: Perms = {
  people: 'edit', people_create: 'edit', role_manager: 'edit', personal_info: 'edit', clearance: 'edit',
  departments: 'edit', leave_balances: 'edit', leave_accrual: 'edit', special_leave: 'edit',
  leave_requests: 'read', calendar: 'read', absences: 'read', reports: 'read', finance: 'read',
  approval_steps: 'edit', work_settings: 'edit', holidays: 'edit',
};
const SEC: Perms = { people: 'read', leave_balances: 'read', leave_requests: 'read', calendar: 'read', absences: 'read' };
const FIN: Perms = { clearance: 'read', finance: 'read' };

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
  it('finance preset gets the finance tab and no Manage (FR-62)', () => {
    const tabs = tabsForRoles(['employee', 'finance'], FIN);
    expect(tabs.find((t) => t.key === 'finance')).toMatchObject({ href: '/finance' });
    expect(tabs.map((t) => t.key)).not.toContain('manage');
  });
  it('a custom role with only finance read gets Finance and nothing else', () => {
    expect(tabsForRoles(['employee'], { finance: 'read' }).map((t) => t.key)).toEqual([
      'home', 'request', 'calendar', 'organization', 'finance',
    ]);
    expect(manageItemsForRoles(['employee'], { finance: 'read' })).toEqual([]);
    expect(settingsItemForRoles(['employee'], { finance: 'read' })).toBeNull();
  });
  it('the finance role without the permission gets no finance tab (permissions decide)', () => {
    expect(tabsForRoles(['employee', 'finance'], { clearance: 'read' }).map((t) => t.key)).not.toContain('finance');
  });
  it('hr preset finds Finance in Manage, not as an extra tab (ruling a)', () => {
    expect(tabsForRoles(['hr'], HR).map((t) => t.key)).not.toContain('finance');
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
  it('hr preset: the manage items before FR-55, plus Finance (ruling a)', () => {
    expect(keys(['hr'], HR)).toEqual([
      'employees',
      'departments',
      'approvals',
      'requests',
      'approvalSteps',
      'reports',
      'finance',
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
  it('hr preset gets Finance in Manage, never Manage › Absences (that board is on Home)', () => {
    expect(keys(['hr'], HR)).toContain('finance');
    expect(keys(['hr'], HR)).not.toContain('absences');
  });
  it('security preset: no absences item, no finance', () => {
    expect(keys(['security'], SEC)).not.toContain('absences');
    expect(keys(['security'], SEC)).not.toContain('finance');
  });
  it('a manager with finance read finds it in Manage', () => {
    expect(keys(['manager'], { finance: 'read' })).toEqual(['employees', 'approvals', 'finance']);
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
  it('admin and the hr preset (FR-59, now through work_settings / holidays)', () => {
    expect(settingsItemForRoles(['admin'], fullPerms())).toMatchObject({ href: '/settings', testId: 'nav-settings' });
    expect(settingsItemForRoles(['admin'], {})).not.toBeNull();
    expect(settingsItemForRoles(['hr'], HR)).toMatchObject({ href: '/settings' });
  });
  it('the hr role with an emptied preset gets no Settings', () => {
    expect(settingsItemForRoles(['hr'], {})).toBeNull();
  });
  it('manager and employee with no perms: no link', () => {
    expect(settingsItemForRoles(['manager'], {})).toBeNull();
    expect(settingsItemForRoles(['employee'], {})).toBeNull();
  });
  it('work_settings read alone opens it', () => {
    expect(settingsItemForRoles(['employee'], { work_settings: 'read' })).not.toBeNull();
  });
});

describe('homeAbsencesBoard', () => {
  it('security preset sees the board on Home', () => {
    expect(homeAbsencesBoard(['security'], SEC)).toBe(true);
  });
  it('the hr preset too (ruling a), and any custom absences holder', () => {
    expect(homeAbsencesBoard(['hr'], HR)).toBe(true);
    expect(homeAbsencesBoard(['employee'], { people: 'read', leave_requests: 'read', absences: 'read' })).toBe(true);
  });
  it('never the admin: they open it from Manage › Absences', () => {
    expect(homeAbsencesBoard(['admin'], fullPerms())).toBe(false);
    expect(homeAbsencesBoard(['admin', 'security'], fullPerms())).toBe(false);
  });
  it('the security role without the permission sees no board', () => {
    expect(homeAbsencesBoard(['security'], { people: 'read', leave_requests: 'read' })).toBe(false);
    expect(homeAbsencesBoard(['employee'], {})).toBe(false);
  });
});
