/**
 * What the Edit Employee form lets a caller change on one target (FR-51, FR-55
 * D3–D5). Pure.
 *
 * This only mirrors the database: `private.can_act_on`, the profile guard
 * trigger and `app_set_user_role_ids` enforce the same rules
 * (docs/PERMISSIONS.md). Keep the two in step.
 */

import type { RoleRow } from '@/lib/actions/roles-helpers';
import { can, isWithin, levelValue, type PermKey, type Perms } from '@/lib/permissions/catalog';

export type EditCapabilities = {
  /** Name and hire date. */
  profile: boolean;
  /** Department, direct manager, job title, deactivate / reactivate. */
  org: boolean;
  /** Role ids the caller may toggle; the other boxes render disabled. Never the admin role. */
  editableRoleIds: string[];
  resetPassword: boolean;
  /** Balances and accrual policy are shown (leave_balances read). */
  leave: boolean;
  /** …and may be saved (leave_balances edit, on a target the caller may act on). */
  leaveEdit: boolean;
  /**
   * Why the org fields render read-only: the target is the admin, the caller
   * themselves (D3), or holds access the caller lacks (D4, 'above').
   */
  lockedReason: 'admin' | 'self' | 'above' | null;
  /**
   * Personal information (FR-53): read-only without personal_info edit or on a
   * locked target; your own is editable only with personal_info_own (FR-63).
   */
  personalInfo: 'edit' | 'view' | null;
  /**
   * «مرخصی خارج از لیست» (FR-65): grant marriage / bereavement days. Mirrors
   * `private.special_leave_target`: special_leave edit, then for a non-admin not
   * on themself, not on the admin, and `can_act_on` (D4).
   */
  specialLeave: boolean;
};

/**
 * Whether a caller may change their OWN personal information (FR-63): the
 * personal_info_own item, the TS mirror of `private.has_perm(uid,
 * 'personal_info_own', 'edit')` behind the own-row `employee_personal_info_update`
 * policy. On no preset; the admin holds it implicitly (full permissions).
 */
export function canEditOwnPersonalInfo(perms: Perms): boolean {
  return can(perms, 'personal_info_own');
}

/**
 * Identity powers of the target that `can_act_on` guards beyond permission
 * levels. The page reads them through RLS; when it cannot, it passes true.
 */
export type TargetIdentity = {
  /** Named approver on an active approval step. */
  approver: boolean;
  /** Signer on a clearance unit, or on a row of an open clearance form. */
  clearanceSigner: boolean;
};

/** Per-key max over the target's roles: what they could do, active or not (D4). */
function targetPermissions(roles: RoleRow[]): Perms {
  const out: Perms = {};
  for (const role of roles) {
    for (const [key, level] of Object.entries(role.permissions) as [PermKey, Perms[PermKey]][]) {
      if (levelValue(level) > levelValue(out[key])) out[key] = level;
    }
  }
  return out;
}

export function employeeEditCapabilities({
  callerId,
  callerRoles,
  callerPerms,
  targetId,
  targetRoleIds,
  allRoles,
  targetIsDepartmentManager,
  targetIdentity,
}: {
  callerId: string;
  callerRoles: string[];
  callerPerms: Perms;
  targetId: string;
  targetRoleIds: string[];
  allRoles: RoleRow[];
  targetIsDepartmentManager: boolean;
  targetIdentity: TargetIdentity;
}): EditCapabilities {
  // D1: the admin box is never a checkbox anyone toggles; Transfer admin moves it.
  const assignable = allRoles.filter((r) => r.systemKey !== 'admin');

  if (callerRoles.includes('admin')) {
    return {
      profile: true,
      org: true,
      editableRoleIds: assignable.map((r) => r.id),
      resetPassword: true,
      leave: true,
      leaveEdit: true,
      lockedReason: null,
      personalInfo: 'edit',
      specialLeave: true,
    };
  }

  const targetRoles = allRoles.filter((r) => targetRoleIds.includes(r.id));
  const holds = (key: string) => targetRoles.some((r) => r.systemKey === key);
  const self = targetId === callerId;

  // D4 mirror of private.can_act_on, including its identity clauses: whoever
  // could reset this person's password could sign in as them and sign their
  // approval steps or clearance boxes. An hr holder signs both (approval steps,
  // the clearance HR rows); security signs no step since 20261012120003.
  const above =
    !isWithin(targetPermissions(targetRoles), callerPerms) ||
    (holds('manager') && !can(callerPerms, 'role_manager')) ||
    (targetIsDepartmentManager && !can(callerPerms, 'departments')) ||
    ((holds('hr') || targetIdentity.approver) && !can(callerPerms, 'approval_steps')) ||
    ((holds('hr') || holds('finance') || targetIdentity.clearanceSigner) && !can(callerPerms, 'clearance'));

  const lockedReason = self ? 'self' : holds('admin') ? 'admin' : above ? 'above' : null;
  const actor = lockedReason === null;

  // D5, plus the identity mirror of app_set_user_role_ids: hr signs approval
  // steps and the clearance HR rows, finance signs the clearance finance box.
  const mayToggle = (r: RoleRow) => {
    if (r.systemKey === 'manager') return can(callerPerms, 'role_manager');
    if (!can(callerPerms, 'role_assign') || !isWithin(r.permissions, callerPerms)) return false;
    if (r.systemKey === 'hr') return can(callerPerms, 'approval_steps') && can(callerPerms, 'clearance');
    if (r.systemKey === 'finance') return can(callerPerms, 'clearance');
    return true;
  };

  return {
    // A manager's name/hire-date power is the reporting relationship, not D4;
    // RLS narrows it to their own reports.
    profile: (actor && can(callerPerms, 'people')) || (callerRoles.includes('manager') && !self),
    org: actor && can(callerPerms, 'people'),
    editableRoleIds: actor ? assignable.filter(mayToggle).map((r) => r.id) : [],
    resetPassword: actor && can(callerPerms, 'passwords'),
    leave: can(callerPerms, 'leave_balances', 'read'),
    leaveEdit: actor && can(callerPerms, 'leave_balances'),
    lockedReason,
    // FR-63: your own personal information is view only unless you hold
    // personal_info_own (the admin, returned above, holds it implicitly).
    personalInfo: !can(callerPerms, 'personal_info', 'read')
      ? null
      : (actor && can(callerPerms, 'personal_info')) || (self && canEditOwnPersonalInfo(callerPerms))
        ? 'edit'
        : 'view',
    // FR-65: special_leave edit on a target the caller may act on (not self,
    // not the admin, not above them), as private.special_leave_target checks.
    specialLeave: actor && can(callerPerms, 'special_leave'),
  };
}

export type EditFormView = {
  /** The scope note above the form; null = none. */
  note: 'lockedAdmin' | 'lockedSelf' | 'lockedAbove' | 'manager' | 'readOnly' | null;
  /** Job title, department and manager (editable with caps.org, else read-only). */
  orgBlock: boolean;
  rolesBlock: boolean;
  /** Anything on the form the Save button can write. */
  saveable: boolean;
};

/**
 * How the Edit Employee form presents `caps`. `showOrg` = the caller holds
 * people read. Without it the caller is a manager on the relationship path and
 * keeps the pre-FR-55 view: the manager note, name and hire date only, never a
 * lock note (their name/hire-date power does not depend on D4).
 */
export function editFormView(caps: EditCapabilities, { showOrg }: { showOrg: boolean }): EditFormView {
  const saveable = caps.profile || caps.org || caps.editableRoleIds.length > 0 || caps.leaveEdit;
  const lockNote =
    caps.lockedReason === 'admin'
      ? 'lockedAdmin'
      : caps.lockedReason === 'self'
        ? 'lockedSelf'
        : caps.lockedReason === 'above'
          ? 'lockedAbove'
          : null;
  const note: EditFormView['note'] = !showOrg
    ? 'manager'
    : lockNote
      ? lockNote
      : caps.org
        ? null
        : caps.profile
          ? 'manager' // name and hire date through the reporting line only
          : saveable
            ? null
            : 'readOnly';
  const orgBlock = showOrg && (caps.org || caps.lockedReason !== null);
  return { note, orgBlock, rolesBlock: orgBlock || caps.editableRoleIds.length > 0, saveable };
}
