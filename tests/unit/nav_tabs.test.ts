import { describe, it, expect } from 'vitest';
import { manageItemsForRoles, settingsItemForRoles, tabsForRoles } from '@/lib/nav/tabs';

describe('tabsForRoles', () => {
  it('employee: 3 base tabs, no manage', () => {
    expect(tabsForRoles(['employee']).map((t) => t.key)).toEqual([
      'home',
      'request',
      'calendar',
    ]);
  });
  it('manager gets the manage tab', () => {
    expect(tabsForRoles(['employee', 'manager']).map((t) => t.key)).toContain('manage');
  });
  it('admin gets the manage tab', () => {
    expect(tabsForRoles(['admin']).map((t) => t.key)).toContain('manage');
  });
  it('security (no manage)', () => {
    expect(tabsForRoles(['security']).map((t) => t.key)).not.toContain('manage');
  });
  it('hr gets the manage tab (FR-35)', () => {
    expect(tabsForRoles(['hr']).map((t) => t.key)).toContain('manage');
  });
  it('hr alongside employee still gets it', () => {
    expect(tabsForRoles(['employee', 'hr']).map((t) => t.key)).toContain('manage');
  });
  it('an unknown role grants nothing', () => {
    // Roles arrive from a JWT claim; an unrecognised one must not open /manage.
    expect(tabsForRoles(['hrx']).map((t) => t.key)).not.toContain('manage');
    expect(tabsForRoles(['HR']).map((t) => t.key)).not.toContain('manage');
  });
  it('mobile manage tab opens the manage list page', () => {
    const manage = tabsForRoles(['admin']).find((t) => t.key === 'manage');
    expect(manage?.href).toBe('/manage');
  });
});

describe('manageItemsForRoles', () => {
  const keys = (roles: string[]) => manageItemsForRoles(roles).map((i) => i.key);

  it('employee and security get no manage group', () => {
    expect(keys(['employee'])).toEqual([]);
    expect(keys(['security'])).toEqual([]);
  });
  it('manager: employees and approvals only', () => {
    expect(keys(['employee', 'manager'])).toEqual(['employees', 'approvals']);
  });
  it('hr also reaches the request archive and reports', () => {
    expect(keys(['hr'])).toEqual(['employees', 'approvals', 'requests', 'reports']);
  });
  it('admin reaches the whole group', () => {
    expect(keys(['admin'])).toEqual(['employees', 'approvals', 'requests', 'reports']);
  });
  it('the employees hub keeps the nav-manage test id', () => {
    expect(manageItemsForRoles(['manager'])[0]).toMatchObject({
      key: 'employees',
      href: '/manage/employees',
      testId: 'nav-manage',
    });
  });
});

describe('settingsItemForRoles', () => {
  it('is admin only', () => {
    expect(settingsItemForRoles(['admin'])?.testId).toBe('nav-settings');
    expect(settingsItemForRoles(['hr'])).toBeNull();
    expect(settingsItemForRoles(['manager'])).toBeNull();
    expect(settingsItemForRoles(['employee'])).toBeNull();
  });
});
