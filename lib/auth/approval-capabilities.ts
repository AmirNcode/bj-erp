import { cache } from 'react';
import { getCachedAbsenceWatch, getCachedTimeOff, requireCaller } from '@/lib/auth/context';
import type { ApprovalCapabilities } from '@/lib/leave/delegation';

/** Live database authority, deduplicated for this server request only. Fail closed. */
export const getApprovalCapabilities = cache(async (): Promise<ApprovalCapabilities> => {
  const c = await requireCaller();
  const denied = {
    canApprove: false, canDelegate: false, isAdmin: false, hasReports: false, absencesPage: false, timeOff: false,
  };
  if (!c.ok) return denied;
  const [{ data, error }, reports, watch, timeOff] = await Promise.all([
    c.supabase.rpc('app_approval_capabilities'),
    // FR-74: RLS lets anyone read their direct reports; a head-only count.
    // Inactive reports count too: the list and the employee page show them.
    c.supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', c.user.id),
    getCachedAbsenceWatch(c.user.id),
    getCachedTimeOff(c.user.id),
  ]);
  const hasReports = (reports.count ?? 0) > 0;
  const absencesPage = watch?.fullPage === true;
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { ...denied, hasReports, absencesPage, timeOff };
  }
  return {
    canApprove: data.can_approve === true,
    canDelegate: data.can_delegate === true,
    isAdmin: data.is_admin === true,
    hasReports,
    absencesPage,
    timeOff,
  };
});
