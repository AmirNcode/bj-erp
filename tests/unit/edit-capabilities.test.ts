import { describe, expect, it } from 'vitest';
import { employeeEditCapabilities } from '@/lib/employees/editCapabilities';

const ME = 'caller';
const THEM = 'target';
const caps = (callerRoles: string[], targetRoles: string[], targetId = THEM) =>
  employeeEditCapabilities({ callerId: ME, callerRoles, targetId, targetRoles });

describe('employeeEditCapabilities', () => {
  it('admin may do everything, on anyone', () => {
    expect(caps(['admin'], ['admin'])).toEqual({
      profile: true,
      org: true,
      editableRoles: ['admin', 'manager', 'employee', 'security', 'hr'],
      resetPassword: true,
      leave: true,
      lockedReason: null,
    });
  });

  it('hr edits an employee: profile and org fields, the manager role only', () => {
    expect(caps(['hr', 'employee'], ['employee'])).toEqual({
      profile: true,
      org: true,
      editableRoles: ['manager'],
      resetPassword: false,
      leave: true,
      lockedReason: null,
    });
  });

  it('hr edits a manager or another hr the same way', () => {
    expect(caps(['hr'], ['manager', 'employee']).org).toBe(true);
    expect(caps(['hr'], ['hr', 'employee']).org).toBe(true);
  });

  it('hr is locked out of an admin record', () => {
    expect(caps(['hr'], ['admin', 'employee'])).toMatchObject({
      profile: false,
      org: false,
      editableRoles: [],
      lockedReason: 'admin',
    });
  });

  it('hr is locked out of the org fields on their own record', () => {
    expect(caps(['hr', 'employee'], ['hr', 'employee'], ME)).toMatchObject({
      profile: false,
      org: false,
      editableRoles: [],
      lockedReason: 'self',
    });
  });

  it('a manager keeps the name and hire date of their reports only', () => {
    expect(caps(['manager', 'employee'], ['employee'])).toEqual({
      profile: true,
      org: false,
      editableRoles: [],
      resetPassword: false,
      leave: false,
      lockedReason: null,
    });
  });

  it('hr who also manages the admin keeps the manager subset', () => {
    expect(caps(['hr', 'manager'], ['admin'])).toMatchObject({ profile: true, org: false });
  });
});
