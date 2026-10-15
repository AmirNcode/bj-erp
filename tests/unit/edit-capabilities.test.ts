import { describe, expect, it } from 'vitest';
import { employeeEditCapabilities, canEditOwnPersonalInfo, editFormView } from '@/lib/employees/editCapabilities';
import type { RoleRow } from '@/lib/actions/roles-helpers';
import { can, fullPerms, type Perms } from '@/lib/permissions/catalog';

const ME = 'caller';
const THEM = 'target';

// The presets as seeded (migration 20261013200001): pin the FR-51 behaviour.
const HR: Perms = {
  people: 'edit',
  people_create: 'edit',
  role_manager: 'edit',
  personal_info: 'edit',
  clearance: 'edit',
  departments: 'edit',
  leave_balances: 'edit',
  leave_accrual: 'edit',
  special_leave: 'edit',
  leave_requests: 'read',
  calendar: 'read',
  absences: 'read',
  reports: 'read',
  finance: 'read',
  approval_steps: 'edit',
  work_settings: 'edit',
  holidays: 'edit',
};
const SECURITY: Perms = { people: 'read', leave_balances: 'read', leave_requests: 'read', calendar: 'read', absences: 'read' };
const FINANCE: Perms = { clearance: 'read', finance: 'read' };

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
// A custom role hr does not cover (hr reads leave requests only). It held `passwords` until
// password resets became admin-only (20261013200007).
const HELPDESK = role('r-helpdesk', null, 'custom', 'Helpdesk', { people: 'read', leave_requests: 'edit' });
const ALL = [ADMIN_ROLE, MANAGER_ROLE, EMP_ROLE, HR_ROLE, SEC_ROLE, FIN_ROLE, HELPDESK];

const idOf = (slug: string) => ALL.find((r) => r.systemKey === slug || r.name === slug)!.id;

const NO_IDENTITY = { approver: false, clearanceSigner: false };

describe('sensitive role assignment', () => {
  it('HR cannot assign custom roles even with role_assign from another role', () => {
    const reader = role('r-reader', null, 'custom', 'Reader', { people: 'read' });
    const result = employeeEditCapabilities({
      callerId: ME, callerRoles: ['hr', 'employee'], callerPerms: fullPerms(),
      targetId: THEM, targetRoleIds: [EMP_ROLE.id], allRoles: [...ALL, reader],
      targetIsDepartmentManager: false, targetIdentity: NO_IDENTITY,
    });
    expect(result.editableRoleIds).toEqual([MANAGER_ROLE.id, EMP_ROLE.id]);
    expect(result.profile).toBe(true);
    expect(result.leaveEdit).toBe(true);
  });
});

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
const HELPDESK_CALLER = { roles: ['employee'], perms: { people: 'read', leave_requests: 'edit' } as Perms };

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

  it('own personal information follows personal_info_own: the admin implicitly, no preset (FR-63)', () => {
    expect(canEditOwnPersonalInfo(fullPerms())).toBe(true);
    expect(canEditOwnPersonalInfo(HR)).toBe(false);
    expect(canEditOwnPersonalInfo(SECURITY)).toBe(false);
    expect(canEditOwnPersonalInfo({})).toBe(false);
    expect(canEditOwnPersonalInfo({ personal_info_own: 'edit' })).toBe(true);
  });

  it('a role holding personal_info_own edits its own personal information', () => {
    const selfEditor = { roles: ['hr'], perms: { ...HR, personal_info_own: 'edit' } as Perms };
    expect(caps(selfEditor, ['hr'], { targetId: ME })).toMatchObject({ lockedReason: 'self', personalInfo: 'edit' });
    // Never someone else's through it: that is personal_info edit on a target they may act on.
    const ownOnly = { roles: ['employee'], perms: { people: 'read', personal_info: 'read', personal_info_own: 'edit' } as Perms };
    expect(caps(ownOnly, ['employee']).personalInfo).toBe('view');
    expect(caps(ownOnly, ['employee'], { targetId: ME }).personalInfo).toBe('edit');
  });

  // ── FR-65 special leave: special_leave edit on a target the caller may act on ──

  it('special leave: hr preset on an employee, never on themself, the admin or a target above them', () => {
    expect(caps(hr(), ['employee']).specialLeave).toBe(true);
    expect(caps(hr(), ['employee'], { targetId: ME }).specialLeave).toBe(false);
    expect(caps(hr(), ['admin']).specialLeave).toBe(false);
    // D4 'above': the Helpdesk holder carries leave_requests edit, which hr lacks.
    expect(caps(hr(), ['employee', 'Helpdesk']).lockedReason).toBe('above');
    expect(caps(hr(), ['employee', 'Helpdesk']).specialLeave).toBe(false);
  });

  it('special leave follows the permission, not the hr role', () => {
    expect(caps({ roles: ['hr'], perms: { ...HR, special_leave: undefined } }, ['employee']).specialLeave).toBe(false);
    const granter = { roles: ['employee'], perms: { people: 'read', leave_balances: 'read', special_leave: 'edit' } as Perms };
    expect(caps(granter, ['employee']).specialLeave).toBe(true);
    expect(caps(HELPDESK_CALLER, ['employee']).specialLeave).toBe(false);
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

  it('a custom role with people read: nothing on a plain employee, and no password reset', () => {
    expect(caps(HELPDESK_CALLER, ['employee'])).toMatchObject({
      profile: false,
      org: false,
      resetPassword: false,
      editableRoleIds: [],
      lockedReason: null,
    });
  });

  it('password resets are the admin alone (20261013200007), even with a stale passwords grant', () => {
    const stale = { people: 'edit', passwords: 'edit' } as unknown as Perms;
    expect(caps({ roles: ['employee'], perms: stale }, ['employee']).resetPassword).toBe(false);
    expect(caps(hr(), ['employee']).resetPassword).toBe(false);
    expect(caps({ roles: ['employee'], perms: { ...fullPerms() } }, ['employee']).resetPassword).toBe(false);
    expect(caps(ADMIN, ['employee']).resetPassword).toBe(true);
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
        callerPerms: { people: 'read', leave_requests: 'edit' },
        targetIsDepartmentManager: true,
      }).lockedReason
    ).toBe('above');
    expect(
      employeeEditCapabilities({ ...base, callerPerms: HR, targetIsDepartmentManager: true }).lockedReason
    ).toBeNull();
  });

  // I1: personal_info_own is self-only; on someone else personal_info edit covers it.
  const SELF_SERVICE = role('r-self', null, 'custom', 'SelfService', { personal_info_own: 'edit' });
  const WITH_SELF = [...ALL, SELF_SERVICE];
  const onSelfService = (perms: Perms, roleIds = [EMP_ROLE.id, SELF_SERVICE.id]) =>
    employeeEditCapabilities({ ...base, callerPerms: perms, targetRoleIds: roleIds, allRoles: WITH_SELF });

  it('hr acts on a self-service holder (personal_info edit covers personal_info_own); helpdesk does not', () => {
    expect(onSelfService(HR)).toMatchObject({ lockedReason: null, org: true, personalInfo: 'edit' });
    expect(onSelfService(HELPDESK_CALLER.perms)).toMatchObject({ lockedReason: 'above', resetPassword: false });
  });

  it('non-admin role assigners cannot toggle sensitive self-service roles', () => {
    const assigner = { people: 'edit', role_assign: 'edit', personal_info: 'edit' } as Perms;
    const helpAssign = { people: 'read', leave_requests: 'edit', role_assign: 'edit' } as Perms;
    expect(onSelfService(assigner, [EMP_ROLE.id]).editableRoleIds).not.toContain(SELF_SERVICE.id);
    expect(onSelfService(helpAssign, [EMP_ROLE.id]).editableRoleIds).not.toContain(SELF_SERVICE.id);
  });

  it('a target holding a custom role the caller does not cover is above the caller', () => {
    expect(caps(hr(), ['employee', 'Helpdesk']).lockedReason).toBe('above'); // hr reads leave requests only
  });

  // ── Identity clauses (approval signers, clearance signers) ───────────────

  const WIDE: Perms = {
    people: 'edit', leave_balances: 'read', leave_requests: 'read', calendar: 'read',
    clearance: 'read', absences: 'read', finance: 'read',
  };
  // An hr role stripped of every item, so only the identity clause can lock its holders.
  const HR_BARE = role('r-hr', 'hr', 'preset', 'HR', {});
  const ALL_BARE_HR = ALL.map((r) => (r.systemKey === 'hr' ? HR_BARE : r));
  const onBareHr = (perms: Perms) =>
    employeeEditCapabilities({ ...base, callerPerms: perms, targetRoleIds: [EMP_ROLE.id, HR_BARE.id], allRoles: ALL_BARE_HR });

  it('hr holders need approval_steps AND clearance edit: they sign steps and the clearance HR rows', () => {
    expect(onBareHr(WIDE).lockedReason).toBe('above');
    expect(onBareHr({ ...WIDE, approval_steps: 'edit' }).lockedReason).toBe('above');
    expect(onBareHr({ ...WIDE, clearance: 'edit' }).lockedReason).toBe('above');
    expect(onBareHr({ ...WIDE, approval_steps: 'edit', clearance: 'edit' }).lockedReason).toBeNull();
  });

  it('security holders sign no step since 20261012120003: covering their levels is enough', () => {
    expect(caps({ roles: ['employee'], perms: WIDE }, ['employee', 'security']).lockedReason).toBeNull();
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

  it('role_assign cannot toggle sensitive roles even within its own set', () => {
    const r = caps({ roles: ['employee'], perms: { people: 'edit', role_assign: 'edit', leave_requests: 'edit' } }, ['employee']);
    expect(r.editableRoleIds).not.toContain(HELPDESK.id);
    expect(r.editableRoleIds).toContain(EMP_ROLE.id); // no permissions
    expect(r.editableRoleIds).not.toContain(HR_ROLE.id); // hr ⊄ caller
    expect(r.editableRoleIds).not.toContain(ADMIN_ROLE.id);
    expect(r.editableRoleIds).not.toContain(MANAGER_ROLE.id); // needs role_manager
  });

  it('HR and Finance identity roles stay admin-only regardless of caller permissions', () => {
    const covered: Perms = { ...WIDE, role_assign: 'edit' };
    const toggles = (perms: Perms) =>
      employeeEditCapabilities({ ...base, callerPerms: perms, allRoles: ALL_BARE_HR }).editableRoleIds;
    expect(toggles(covered)).toContain(SEC_ROLE.id);
    expect(toggles(covered)).not.toContain(FIN_ROLE.id);
    expect(toggles(covered)).not.toContain(HR_BARE.id);
    expect(toggles({ ...covered, approval_steps: 'edit' })).not.toContain(HR_BARE.id);
    expect(toggles({ ...covered, clearance: 'edit' })).not.toContain(FIN_ROLE.id);
    expect(toggles({ ...covered, clearance: 'edit' })).not.toContain(HR_BARE.id);
    expect(toggles({ ...covered, approval_steps: 'edit', clearance: 'edit' })).not.toContain(HR_BARE.id);
  });

  it('no role is toggleable on a locked target', () => {
    const r = caps({ roles: ['employee'], perms: { people: 'edit', role_assign: 'edit', leave_requests: 'edit' } }, ['employee', 'hr']);
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

describe('editFormView', () => {
  const MANAGER_ONLY = { roles: ['manager', 'employee'], perms: {} as Perms };
  const view = (caller: { roles: string[]; perms: Perms }, targetSlugs: string[], opts: { targetId?: string } = {}) =>
    editFormView(caps(caller, targetSlugs, opts), { showOrg: can(caller.perms, 'people', 'read') });

  it('a manager-only caller keeps the pre-FR-55 view: manager note, no org or roles, no lock note', () => {
    for (const target of [['employee'], ['employee', 'manager'], ['employee', 'hr']]) {
      expect(view(MANAGER_ONLY, target)).toEqual({ note: 'manager', orgBlock: false, rolesBlock: false, saveable: true });
    }
    // Their own record: profile is false, still the manager note and no blocks.
    expect(view(MANAGER_ONLY, ['manager', 'employee'], { targetId: ME })).toEqual({
      note: 'manager',
      orgBlock: false,
      rolesBlock: false,
      saveable: false,
    });
  });

  it('a manager on a department-manager report keeps the manager note (no lock note)', () => {
    const c = employeeEditCapabilities({ ...base, callerRoles: ['manager'], callerPerms: {}, targetIsDepartmentManager: true });
    expect(c.lockedReason).toBe('above');
    expect(editFormView(c, { showOrg: false }).note).toBe('manager');
  });

  it('people readers with no edit power get the neutral read-only note and nothing to save', () => {
    expect(view({ roles: ['employee'], perms: SECURITY }, ['employee'])).toEqual({
      note: 'readOnly',
      orgBlock: false,
      rolesBlock: false,
      saveable: false,
    });
    expect(view(HELPDESK_CALLER, ['employee']).note).toBe('readOnly');
  });

  it('people readers see the lock reason with the org and roles blocks read-only', () => {
    expect(view(HELPDESK_CALLER, ['employee', 'hr'])).toEqual({ note: 'lockedAbove', orgBlock: true, rolesBlock: true, saveable: false });
    expect(view(hr(), ['admin'])).toMatchObject({ note: 'lockedAdmin', orgBlock: true, rolesBlock: true });
    expect(view(hr('employee'), ['hr', 'employee'], { targetId: ME })).toMatchObject({ note: 'lockedSelf', orgBlock: true });
  });

  it('hr editing an employee: no note, org and roles blocks, saveable', () => {
    expect(view(hr(), ['employee'])).toEqual({ note: null, orgBlock: true, rolesBlock: true, saveable: true });
  });

  it('a role assigner with people read only gets the roles block and can save', () => {
    const assigner = { roles: ['employee'], perms: { people: 'read', role_assign: 'edit' } as Perms };
    expect(view(assigner, ['employee'])).toEqual({ note: null, orgBlock: false, rolesBlock: true, saveable: true });
  });

  it('leave_balances edit alone makes the form saveable, with no read-only note', () => {
    expect(view({ roles: ['employee'], perms: { people: 'read', leave_balances: 'edit' } }, ['employee'])).toMatchObject({
      note: null,
      saveable: true,
    });
  });
});
