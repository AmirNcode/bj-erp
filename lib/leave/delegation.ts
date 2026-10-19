/** Narrow, server-authorized delegation views. No profile-table access is implied. */
export type ApprovalCapabilities = { canApprove: boolean; canDelegate: boolean; isAdmin: boolean };
export type DelegateCandidate = { profile_id: string; full_name: string; employee_code: string | null };
export type DelegationGrant = {
  grant_id: string;
  delegate_id: string;
  delegate_name: string;
  ceo_authorized: boolean;
  source_request_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};
export type ExecutiveSettings = { ceo_id: string | null; hr_head_id: string | null; hr_step_ids: string[] };
export type DelegationContext = {
  principal_id: string;
  principal_name: string;
  is_admin: boolean;
  can_delegate: boolean;
  can_approve: boolean;
  saved: DelegationGrant | null;
  effective: DelegationGrant | null;
  executive_settings: ExecutiveSettings;
  principals: DelegateCandidate[];
  hr_steps: { step_id: string; step_role: string; step_order: number; expected_name: string | null }[];
};

export type DelegationPreviewQuery = {
  start: string;
  end: string;
  unit?: 'day' | 'hour';
  dayPart?: 'full' | 'am' | 'pm';
  startTime?: string | null;
  endTime?: string | null;
  replacementId?: string | null;
};

/** Keep the complete RPC object: submission validates the server preview token. */
export type RequestDelegationPreview = {
  bounds: { starts_at: string; ends_at: string };
  saved: DelegationGrant | null;
  effective: DelegationGrant | null;
  temporary: { delegate_id: string; delegate_name: string; starts_at: string; ends_at: string } | null;
  temporary_eligible: boolean;
  temporary_delegate_name: string | null;
  can_approve: boolean;
  can_delegate: boolean;
  is_ceo: boolean;
  auto_approval_eligible: boolean;
  authority_id: string | null;
  preview_token: string;
};

export type DelegationSubmissionInput = {
  delegationPreview: import('@/lib/supabase/types').Json | null;
  autoApprovalConsent: boolean;
  temporaryCeoAuthorized: boolean;
};
