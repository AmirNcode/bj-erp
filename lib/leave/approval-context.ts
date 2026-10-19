import type { StepLabel, StepRole } from './approvals';

/** Request-scoped projections from the database, never complete personnel rows. */
export type ApprovalEvidenceKind = 'manual' | 'delegated' | 'automatic' | 'hr_exempt' | 'legacy' | 'pending';
export type ApprovalProgressRow = {
  step_id: string | null;
  step_role: StepRole;
  step_order: number;
  manager_scope: 'direct' | 'department';
  named: boolean;
  expected_name: string | null;
  signer_name: string | null;
  principal_name: string | null;
  signed_at: string | null;
  decision: 'approved' | 'rejected' | null;
  evidence_kind: ApprovalEvidenceKind;
  grant_id: string | null;
  can_approve: boolean;
  can_reject: boolean;
  is_delegated?: boolean;
  per_diem_allowed?: boolean;
  authority_statement?: string | null;
  /** Immutable decision statement and snapshot returned by the scoped RPC. */
  statement?: string | null;
  evidence?: Record<string, unknown> | null;
  authority_ref?: string | null;
  historical_hr_exemption?: Record<string, unknown> | null;
  signature_data?: string | null;
  signature_consent_at?: string | null;
};

export type ApprovalContextRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  personnel_no: string | null;
  job_title: string | null;
  employee_manager_id: string | null;
  employee_department_manager_id: string | null;
  department_id: string | null;
  department_name_fa: string | null;
  department_name_en: string | null;
  kind: 'leave' | 'errand';
  unit: 'day' | 'hour';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  leave_type_id: string | null;
  leave_type_name_fa: string | null;
  leave_type_name_en: string | null;
  affects_balance: boolean;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  day_part: 'full' | 'am' | 'pm';
  requested_minutes: number;
  unpaid_minutes: number;
  serial_year: number;
  serial_seq: number;
  created_at: string;
  reason: string | null;
  errand_location: string | null;
  /** FR-61 whole Rials; errands only. */
  per_diem_rials?: number | null;
  /** The Head of HR entered it on their own errand at submission. */
  per_diem_by_requester?: boolean;
  decision_note: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  replacement_name: string | null;
  replacement_conflict: boolean;
  signature_consent_at: string | null;
  approver_signature_consent_at: string | null;
  configuration_changed?: boolean;
  legacy_reconciliation_required?: boolean;
  progress: ApprovalProgressRow[];
  can_override: boolean;
  can_approve: boolean;
  can_reject: boolean;
};

export type ApprovalSignatures = {
  requester_signature_data: string | null;
  requester_consent_at: string | null;
  approver_signature_data?: string | null;
  approver_signature_consent_at?: string | null;
  approvals: ApprovalProgressRow[];
};

export type ApprovalChoice = {
  stepId: string | null;
  label: StepLabel;
  name: string | null;
  principalName: string | null;
  delegated: boolean;
  perDiem: boolean;
};

export function progressLabel(step: ApprovalProgressRow): StepLabel {
  return step.step_role === 'manager' && step.manager_scope === 'department' && !step.named
    ? 'departmentManager'
    : step.step_role;
}

/** Keep same-role steps distinct: only the server can decide live entitlement. */
export function approvalChoices(progress: ApprovalProgressRow[], action: 'approve' | 'reject'): ApprovalChoice[] {
  return progress
    .filter((step) => step.evidence_kind !== 'hr_exempt' && !step.decision &&
      (action === 'approve' ? step.can_approve : step.can_reject) === true)
    .map((step) => ({
      stepId: step.step_id,
      label: progressLabel(step),
      name: step.named ? step.expected_name : null,
      principalName: step.principal_name,
      delegated: step.is_delegated === true,
      perDiem: step.per_diem_allowed === true,
    }));
}
