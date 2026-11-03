/**
 * FR-76 (owner, 2026-11-03): security staff are a subcontractor. Someone with the Security role
 * and without Employee sends no requests and holds no leave; Security + Employee keeps both.
 * `roles` are the built-in role slugs (the `app_roles` claim). The database enforces the same rule
 * (`private.is_security_only`: a trigger on leave_requests, and accrue_leave). Pure.
 */
export function isSecurityOnly(roles: readonly string[]): boolean {
  return roles.includes('security') && !roles.includes('employee');
}

/** Whether the caller files requests and has leave balances. */
export const hasTimeOff = (roles: readonly string[]): boolean => !isSecurityOnly(roles);
