/**
 * Pure approval-queue filtering. No Supabase / no I/O — unit-tested.
 *
 * The pending-approvals read action fetches every pending request the caller is
 * allowed to *read* (RLS lets managers read company-wide). For the approval
 * *queue* we narrow to what the caller may *act on*: an admin sees all; a
 * manager sees only requests whose employee reports directly to them. The SQL
 * function (approve/reject) is the real authority and re-checks is_manager_of;
 * this just keeps the queue UI honest.
 */
export function filterApprovable<T extends { employee_manager_id: string | null }>(
  rows: T[],
  myProfileId: string,
  isAdmin: boolean,
): T[] {
  if (isAdmin) return rows;
  return rows.filter((r) => r.employee_manager_id === myProfileId);
}
