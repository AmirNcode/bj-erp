/**
 * What the Edit Employee form lets a caller change on one target (FR-51). Pure.
 *
 * This only mirrors the database: the profile guard trigger, the profiles and
 * departments policies and `app_set_user_roles` enforce the same rules
 * (docs/PERMISSIONS.md). Keep the two in step.
 */

// Rendered as raw slugs. The e2e `createEmployee` helper picks these checkboxes
// by their exact label text, so translating them is a separate, deliberate
// change (docs/TASKS.md).
export const ROLES = ['admin', 'manager', 'employee', 'security', 'hr', 'finance'] as const;
export type Role = (typeof ROLES)[number];

export type EditCapabilities = {
  /** Name and hire date. */
  profile: boolean;
  /** Department, direct manager, job title, deactivate / reactivate. */
  org: boolean;
  /** Role checkboxes the caller may toggle; the rest render disabled. */
  editableRoles: Role[];
  resetPassword: boolean;
  /** Balances and accrual policy (FR-43). */
  leave: boolean;
  /** Why an hr caller sees the org fields read-only. */
  lockedReason: 'admin' | 'self' | null;
  /** Personal information (FR-53): hr reads an admin's but may not change it. */
  personalInfo: 'edit' | 'view' | null;
};

export function employeeEditCapabilities({
  callerId,
  callerRoles,
  targetId,
  targetRoles,
}: {
  callerId: string;
  callerRoles: string[];
  targetId: string;
  targetRoles: string[];
}): EditCapabilities {
  if (callerRoles.includes('admin')) {
    return {
      profile: true,
      org: true,
      editableRoles: [...ROLES],
      resetPassword: true,
      leave: true,
      lockedReason: null,
      personalInfo: 'edit',
    };
  }

  const isHr = callerRoles.includes('hr');
  // RLS narrows a manager to their own reports; the page cannot tell, so the
  // form offers the subset and the database refuses anything else.
  const managerSubset = callerRoles.includes('manager');
  const lockedReason = !isHr
    ? null
    : targetId === callerId
      ? 'self'
      : targetRoles.includes('admin')
        ? 'admin'
        : null;
  const hrEditor = isHr && lockedReason === null;

  return {
    profile: hrEditor || (managerSubset && targetId !== callerId),
    org: hrEditor,
    editableRoles: hrEditor ? ['manager'] : [],
    resetPassword: false,
    leave: isHr,
    lockedReason,
    personalInfo: !isHr ? null : lockedReason === 'admin' ? 'view' : 'edit',
  };
}
