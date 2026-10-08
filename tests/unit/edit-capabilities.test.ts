import { describe, expect, it } from 'vitest';
import { employeeEditCapabilities, canEditOwnPersonalInfo } from '@/lib/employees/editCapabilities';
import type { RoleRow } from '@/lib/actions/roles-helpers';
import { fullPerms, type Perms } from '@/lib/permissions/catalog';

const ME = 'caller';
const THEM = 'target';

// The HR preset as seeded (spec "Preset seeds"): pins the FR-51 behaviour.
const HR: Perms = {
  people: 'edit',
  people_create: 'edit',
  role_manager: 'edit',
  personal_info: 'edit',
  clearance: 'edit',
  departments: 'edit',
  leave_balances: 'edit',
  leave_accrual: 'edit',
  leave_requests: 'read',
  calendar: 'read',
  reports: 'read',
  approval_steps: 'edit',
};
const SECURITY: Perms = { people: 'read', leave_balances: 'read', leave_requests: 'read', calendar: 'read' };
const FINANCE: Perms = { clearance: 'read' };

const role = (id: string, systemKey: string | null, kind: RoleRow['kind'], name: string, permissions: Perms): RoleRow => ({
  id,
  systemKey,
  kind,
  name,
  holders: 0,
  permissions,
});

const ADMIN_ROLE = role('r-admin', 'admin', 'system', 'Admin', {});
const MANAGER_ROLE = role('r-manager', 'manager', 'system', 'Manager', {});
const EMP_ROLE = role('r-employee', 'employee', 'system', 'Employee', {});
const HR_ROLE = role('r-hr', 'hr', 'preset', 'HR', HR);
const SEC_ROLE = role('r-security', 'security', 'preset', 'Security', SECURITY);
const FIN_ROLE = role('r-finance', 'finance', 'preset', 'Finance', FINANCE);
const HELPDESK = role('r-helpdesk', null, 'custom', 'Helpdesk', { people: 'read', passwords: 'edit' });
const ALL = [ADMIN_ROLE, MANAGER_ROLE, EMP_ROLE, HR_ROLE, SEC_ROLE, FIN_ROLE, HELPDESK];

const idOf = (slug: string) => ALL.find((r) => r.systemKey === slug || r.name === slug)!.id;

const NO_IDENTITY = { approver: false, clearanceSigner: false };

const base = {
  callerId: ME,
  callerRoles: ['employee'],
  callerPerms: {} as Perms,
  targetId: THEM,
  targetRoleIds: [EMP_ROLE.id],
  allRoles: ALL,
  targetIsDepartmentManager: false,
  targetIdentity: NO_IDENTITY,
};

const caps = (
  caller: { roles: string[]; perms: Perms },
  targetSlugs: string[],
  opts: { targetId?: string; identity?: Partial<typeof NO_IDENTITY> } = {}
) =>
  employeeEditCapabilities({
    ...base,
    callerRoles: caller.roles,
    callerPerms: caller.perms,
    targetId: opts.targetId ?? THEM,
    targetRoleIds: targetSlugs.map(idOf),
    targetIdentity: { ...NO_IDENTITY, ...opts.identity },
  });

const ADMIN = { roles: ['admin'], perms: fullPerms() };
const hr = (...extra: string[]) => ({ roles: ['hr', ...extra], perms: HR });
const HELPDESK_CALLER = { roles: ['employee'], perms: { people: 'read', passwords: 'edit' } as Perms };

describe('employeeEditCapabilities', () => {
  it('admin may do everything, on anyone; every role but admin is toggleable', () => {
    expect(caps(ADMIN, ['admin'])).toEqual({
      profile: true,
      org: true,
      editableRoleIds: ALL.filter((r) => r.systemKey !== 'admin').map((r) => r.id),
      resetPassword: true,
      leave: true,
      leaveEdit: true,
      lockedReason: null,
      personalInfo: 'edit',
      specialLeave: true,
    });
  });

  // ── FR-51 behaviour, now through the HR preset's permissions ──────────────

  it('hr edits an employee: profile and org fields, the manager role only', () => {
    expect(caps(hr('employee'), ['employee'])).toEqual({
      profile: true,
      org: true,
      editableRoleIds: [MANAGER_ROLE.id],
      resetPassword: false,
      leave: true,
      leaveEdit: true,
      lockedReason: null,
      personalInfo: 'edit',
      specialLeave: true,
    });
  });

  it('hr edits a manager or another hr the same way', () => {
    expect(caps(hr(), ['manager', 'employee']).org).toBe(true);
    expect(caps(hr(), ['hr', 'employee']).org).toBe(true);
  });

  it('hr is locked out of an admin record', () => {
    expect(caps(hr(), ['admin', 'employee'])).toMatchObject({
      profile: false,
      org: false,
      editableRoleIds: [],
      leave: true,
      leaveEdit: false,
      lockedReason: 'admin',
      personalInfo: 'view',
      specialLeave: false,
    });
  });

  it('hr is locked out of the org fields on their own record', () => {
    expect(caps(hr('employee'), ['hr', 'employee'], { targetId: ME })).toMatchObject({
      profile: false,
      org: false,
      editableRoleIds: [],
      lockedReason: 'self',
      // FR-63: own personal information is read-only.
      personalInfo: 'view',
      // FR-65: nobody but an admin grants themself extra leave.
      specialLeave: false,
    });
  });

  it('only an admin edits their own personal information (FR-63)', () => {
    expect(canEditOwnPersonalInfo(['admin'])).toBe(true);
    expect(canEditOwnPersonalInfo(['hr', 'employee'])).toBe(false);
    expect(canEditOwnPersonalInfo(['employee'])).toBe(false);
  });

  it('a manager keeps the name and hire date of their reports only', () => {
    expect(caps({ roles: ['manager', 'employee'], perms: {} }, ['employee'])).toEqual({
      profile: true,
      org: false,
      editableRoleIds: [],
      resetPassword: false,
      leave: false,
      leaveEdit: false,
      lockedReason: null,
      personalInfo: null,
      specialLeave: false,
    });
  });

  it('hr who also manages the admin keeps the manager subset', () => {
    expect(caps(hr('manager'), ['admin'])).toMatchObject({ profile: true, org: false });
  });

  // ── D4 subset rule ───────────────────────────────────────────────────────

  it('helpdesk: reset password on a plain employee, nothing else', () => {
    expect(caps(HELPDESK_CALLER, ['employee'])).toMatchObject({
      profile: false,
      org: false,
      resetPassword: true,
      editableRoleIds: [],
      lockedReason: null,
    });
  });

  it('helpdesk is locked on a manager (relationship power) and on hr (above)', () => {
    expect(caps(HELPDESK_CALLER, ['employee', 'manager']).lockedReason).toBe('above');
    expect(caps(HELPDESK_CALLER, ['employee', 'hr']).lockedReason).toBe('above');
    expect(caps(HELPDESK_CALLER, ['employee', 'hr']).resetPassword).toBe(false);
  });

  it('locked on a department manager without departments edit', () => {
    expect(
      employeeEditCapabilities({
        ...base,
        callerPerms: { people: 'read', passwords: 'edit' },
        targetIsDepartmentManager: true,
      }).lockedReason
    ).toBe('above');
    expect(
      employeeEditCapabilities({ ...base, callerPerms: HR, targetIsDepartmentManager: true }).lockedReason
    ).toBeNull();
  });

  it('a target holding a custom role the caller does not cover is above the caller', () => {
    expect(caps(hr(), ['employee', 'Helpdesk']).lockedReason).toBe('above'); // hr lacks passwords
  });

  // ── Identity clauses (approval signers, clearance signers) ───────────────

  const WIDE: Perms = { people: 'edit', passwords: 'edit', leave_balances: 'read', leave_requests: 'read', calendar: 'read', clearance: 'read' };

  it('hr or security holders need approval_steps edit, even when their levels are covered', () => {
    const wide = { roles: ['employee'], perms: WIDE };
    expect(caps(wide, ['employee', 'security']).lockedReason).toBe('above');
    expect(caps({ roles: ['employee'], perms: { ...WIDE, approval_steps: 'edit' } }, ['employee', 'security']).lockedReason).toBeNull();
  });

  it('a named approver on an active step needs approval_steps edit', () => {
    expect(caps(HELPDESK_CALLER, ['employee'], { identity: { approver: true } }).lockedReason).toBe('above');
    expect(
      caps({ roles: ['employee'], perms: { ...HELPDESK_CALLER.perms, approval_steps: 'edit' } }, ['employee'], {
        identity: { approver: true },
      }).lockedReason
    ).toBeNull();
  });

  it('finance holders and clearance signers need clearance edit', () => {
    const wide = { roles: ['employee'], perms: WIDE };
    expect(caps(wide, ['employee', 'finance']).lockedReason).toBe('above');
    expect(caps(HELPDESK_CALLER, ['employee'], { identity: { clearanceSigner: true } }).lockedReason).toBe('above');
    const clr = { roles: ['employee'], perms: { ...WIDE, clearance: 'edit' } as Perms };
    expect(caps(clr, ['employee', 'finance']).lockedReason).toBeNull();
    expect(caps(clr, ['employee'], { identity: { clearanceSigner: true } }).lockedReason).toBeNull();
  });

  it('the identity clauses never lock the admin out', () => {
    expect(caps(ADMIN, ['employee', 'finance'], { identity: { approver: true, clearanceSigner: true } }).lockedReason).toBeNull();
  });

  // ── D5 assignment ────────────────────────────────────────────────────────

  it('role_assign may toggle roles within its own set only', () => {
    const r = caps({ roles: ['employee'], perms: { people: 'edit', role_assign: 'edit', passwords: 'edit' } }, ['employee']);
    expect(r.editableRoleIds).toContain(HELPDESK.id); // {people:read, passwords:edit} ⊆ caller
    expect(r.editableRoleIds).toContain(EMP_ROLE.id); // no permissions
    expect(r.editableRoleIds).not.toContain(HR_ROLE.id); // hr ⊄ caller
    expect(r.editableRoleIds).not.toContain(ADMIN_ROLE.id);
    expect(r.editableRoleIds).not.toContain(MANAGER_ROLE.id); // needs role_manager
  });

  it('security and finance boxes also need the power that edits their signers', () => {
    const covered: Perms = { ...WIDE, role_assign: 'edit' };
    const r = caps({ roles: ['employee'], perms: covered }, ['employee']);
    expect(r.editableRoleIds).not.toContain(SEC_ROLE.id);
    expect(r.editableRoleIds).not.toContain(FIN_ROLE.id);
    const r2 = caps({ roles: ['employee'], perms: { ...covered, approval_steps: 'edit', clearance: 'edit' } }, ['employee']);
    expect(r2.editableRoleIds).toContain(SEC_ROLE.id);
    expect(r2.editableRoleIds).toContain(FIN_ROLE.id);
  });

  it('no role is toggleable on a locked target', () => {
    const r = caps({ roles: ['employee'], perms: { people: 'edit', role_assign: 'edit', passwords: 'edit' } }, ['employee', 'hr']);
    expect(r.lockedReason).toBe('above');
    expect(r.editableRoleIds).toEqual([]);
  });

  it('the admin box is never editable, even for the admin', () => {
    expect(caps(ADMIN, ['employee']).editableRoleIds).not.toContain(ADMIN_ROLE.id);
  });

  // ── personal info and leave ──────────────────────────────────────────────

  it('personal_info read only views; leave_balances read shows balances without editing', () => {
    const viewer = { roles: ['employee'], perms: { people: 'read', personal_info: 'read', leave_balances: 'read' } as Perms };
    expect(caps(viewer, ['employee'])).toMatchObject({ personalInfo: 'view', leave: true, leaveEdit: false });
  });
});
