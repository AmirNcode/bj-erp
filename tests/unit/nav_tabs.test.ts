import { describe, it, expect } from 'vitest';
import { tabsForRoles } from '@/lib/nav/tabs';

describe('tabsForRoles', () => {
  it('employee: 3 base tabs, no manage (profile lives in the header)', () => {
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
  it('manage tab points at the employees hub', () => {
    const manage = tabsForRoles(['admin']).find((t) => t.key === 'manage');
    expect(manage?.href).toBe('/manage/employees');
  });
});
