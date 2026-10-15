import { describe, expect, it } from 'vitest';
import { subtitleRole } from '@/lib/auth/roleSubtitle';

describe('subtitleRole (the side-panel subtitle)', () => {
  it('shows the most senior built-in role held', () => {
    expect(subtitleRole(['employee', 'manager', 'hr'], [])).toEqual({ builtIn: 'hr' });
    expect(subtitleRole(['admin', 'employee'], [{ name: 'Helpdesk', permissions: { people_create: 'edit' } }])).toEqual({
      builtIn: 'admin',
    });
  });

  it('a built-in role beats a custom one, Employee excepted', () => {
    expect(subtitleRole(['employee', 'security'], [{ name: 'Helpdesk', permissions: { people_create: 'edit' } }])).toEqual({
      builtIn: 'security',
    });
  });

  it('falls back to the custom role with the most access when only Employee is built in', () => {
    expect(
      subtitleRole(['employee'], [
        { name: 'Helpdesk', permissions: { people: 'read', people_create: 'edit' } },
        { name: 'Payroll', permissions: { people: 'read', leave_balances: 'edit', reports: 'read' } },
      ])
    ).toEqual({ custom: 'Payroll' });
  });

  it('breaks a tie by name, and shows Employee with no role at all', () => {
    expect(
      subtitleRole(['employee'], [
        { name: 'Zeta', permissions: { people: 'read' } },
        { name: 'Alpha', permissions: { calendar: 'read' } },
      ])
    ).toEqual({ custom: 'Alpha' });
    expect(subtitleRole(['employee'], [])).toEqual({ builtIn: 'employee' });
    expect(subtitleRole([], [])).toEqual({ builtIn: 'employee' });
  });
});
