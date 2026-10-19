import { cache } from 'react';
import { requireCaller } from '@/lib/auth/context';
import type { ApprovalCapabilities } from '@/lib/leave/delegation';

/** Live database authority, deduplicated for this server request only. Fail closed. */
export const getApprovalCapabilities = cache(async (): Promise<ApprovalCapabilities> => {
  const c = await requireCaller();
  const denied = { canApprove: false, canDelegate: false, isAdmin: false };
  if (!c.ok) return denied;
  const { data, error } = await c.supabase.rpc('app_approval_capabilities');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return denied;
  return {
    canApprove: data.can_approve === true,
    canDelegate: data.can_delegate === true,
    isAdmin: data.is_admin === true,
  };
});
