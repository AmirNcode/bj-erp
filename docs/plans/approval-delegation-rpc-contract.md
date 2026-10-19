# Approval delegation RPC contract

Implementation contract for the coordinated application/database work. All RPCs use the live
caller and company; IDs never substitute for authorization. The worker is installed inactive.

- `app_approval_capabilities()` -> JSON `{can_approve,can_delegate,is_admin}`.
- `app_delegation_context(p_principal_id uuid default null)` -> JSON with `principal_id`,
  `principal_name`, capabilities, `saved`, `effective`, `executive_settings`, `principals`, `hr_steps`.
  Grant objects contain `grant_id`, `delegate_id`, `delegate_name`, `ceo_authorized`,
  `source_request_id`, `starts_at`, `ends_at`. Lists for selecting principals/settings are admin only.
- `app_search_delegates(p_principal_id uuid,p_search text default '')` -> rows
  `(profile_id uuid,full_name text,employee_code text)`; active natural approvers only, CEO reports only.
- `app_set_approval_delegate(p_principal_id uuid,p_delegate_id uuid default null,
  p_ceo_authorized boolean default false)` -> void. Null revokes saved appointment; true explicitly
  records CEO own-request automatic-approval authorization. Permission remains necessary for principal.
- `app_set_executive_settings(p_ceo_id uuid,p_hr_head_id uuid,p_hr_step_ids uuid[])` -> void (admin).
- `app_request_delegation_preview(p_start date,p_end date,p_unit leave_unit default 'day',
  p_day_part day_part default 'full',p_start_time time default null,p_end_time time default null,
  p_replacement_id uuid default null)` -> JSON. Includes `bounds` (`starts_at`,`ends_at`), `saved`,
  `effective`, `temporary`, `can_approve`, `can_delegate`, `auto_approval_eligible`, `authority_id`,
  `preview_token`, `is_ceo`, `temporary_eligible`, `temporary_delegate_name`,
  `authority_expires_before_deadline`. Submit passes the complete JSON as `p_delegation_preview`. A settings change
  requires refreshing the preview. Errands pass null replacement.
- Existing four submission names gain `_v2` suffix with all current parameters in the current order,
  then `p_auto_approval_consent boolean default false,p_delegation_preview jsonb default null,
  p_temporary_ceo_authorized boolean default false`. The last flag is a distinct explicit CEO
  attestation when appointing an eligible temporary CEO delegate; a generic requester PNG is insufficient.
  Existing parameter defaults remain. They return request UUID; old endpoints cannot silently enroll.
- `approve_leave_request_v2(p_id uuid,p_step_id uuid,p_signature_data text,
  p_signature_authorized boolean,p_override boolean default false,p_per_diem_rials bigint default null)`
  -> void. Exact step is required except legacy/no-chain or explicit admin override.
- `reject_leave_request_v2(p_id uuid,p_step_id uuid,p_reason text default null)` -> void.
- `app_approval_queue(p_status leave_status default 'pending')` -> JSON array. Scoped queue records
  include request fields plus `employee_name`, `employee_code`, `department_name`, `leave_type_name_fa`,
  `leave_type_name_en`, `progress`; no PNG payloads.
- `app_request_approval_context(p_id uuid)` -> JSON authorized request fields, employee/department/type
  names and `progress`. Request signature data is included only by `get_leave_request_signatures`.
- `app_request_approval_progress(p_id uuid)` -> JSON array with exact `step_id`, role, order, manager
  scope, expected/signer/principal names, decision, `evidence_kind` (`manual`, `delegated`, `automatic`,
  `hr_exempt`, `legacy`, or `pending`), timestamps, grant ID, `can_approve`, `can_reject`. Automatic
  rows carry the responsibility/authorization statement and null human signer.
- `get_leave_request_signatures(p_id uuid)` -> JSON `{requester_signature_data,requester_consent_at,
  approvals:[{step_id,signature_data,signature_consent_at,evidence_kind,...progress}]}`.
- `app_approval_worker_health()` -> JSON `{job,last_run,overdue,blocked}`. Admin gets same-company
  aggregate counts and job ID/schedule/active plus last-run start/end timestamps. Active designated
  CEO gets own-principal counts only, `job:{active}` and `last_run:{finished_at}`. Others are denied.

HR exemptions and CEO coverage are exact per-request step snapshots. Permission/role/profile/
configuration transitions invalidate affected pending timers permanently; timed temporary precedence
interruptions are checked even if they start and finish while the worker is offline.

Closed request progress uses immutable decisions/exemptions; live chain edits cannot add pending
rows to a completed form. Pending changed HR mappings include `configuration_changed` and nested
`historical_hr_exemption` snapshot on the affected current step. Context includes
`legacy_reconciliation_required` when one old role-only signature ambiguously matches multiple
current exact steps. Actual approval readiness (`can_approve`) respects normal manual ordering;
`can_reject` retains authorized rejection regardless of earlier pending steps.

Authorization of saved/temporary CEO automatic policy fails unless the CEO naturally owns a real,
non-exempt step for the selected delegate for both supported request kinds. The private worker
limits batches, prioritizes new due requests and backs off blocked retries (maximum 60 attempts).
No configuration identity or appointment is seeded; runtime activation remains a separate operation.
