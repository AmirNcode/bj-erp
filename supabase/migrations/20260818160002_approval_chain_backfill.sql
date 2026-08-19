-- =============================================================================
-- Migration: 20260818160002_approval_chain_backfill.sql
-- Purpose  : Give every already-decided request the approval row the new chain
--            expects, so history reads correctly instead of looking unsigned.
-- Requirement: FR-36
-- Depends  : 20260818160001_approval_chain_schema.sql
--
-- Without this, a request approved last week would render on the review and
-- print screens as "manager: not yet signed" — the decision is on
-- `leave_requests` but not in `leave_request_approvals`. Nothing would break
-- functionally (a decided request is never re-decided), but every historical
-- sheet would print an empty تصویب کننده box that a human already signed.
--
-- ── Mapping ─────────────────────────────────────────────────────────────────
--
-- Every historical decision becomes a `manager` step row, whoever made it.
-- Before today there was exactly one approval concept — the direct manager's,
-- with an admin able to override — and on all three paper forms that is the
-- تصویب کننده box. Attributing an admin override to the `hr` step instead would
-- claim HR signed something they never saw.
--
-- The HR step is deliberately left EMPTY on historical rows. Those requests are
-- already approved and the engine never revisits a decided request, so the gap
-- is inert; it is also honest, because HR genuinely did not sign them here.
--
-- Pre-FR-14 approvals (before 2026-08-05) carry no approver signature. They are
-- backfilled unsigned — see the constraint note in the schema migration.
--
-- Idempotent: `on conflict (request_id, step_role) do nothing`, so re-running
-- adds nothing and never overwrites a real signature. Safe to re-run.
-- =============================================================================

insert into public.leave_request_approvals (
  request_id, step_role, approver_id, decision,
  signature_data, signature_consent_at, note, created_at
)
select
  r.id,
  'manager'::public.app_role,
  r.decided_by,
  r.status,
  r.approver_signature_data,
  r.approver_signature_consent_at,
  -- The decider's note belongs to the decision, and on a rejection it is the
  -- only explanation the employee ever gets.
  r.decision_note,
  coalesce(r.decided_at, r.created_at)
from public.leave_requests r
where r.status in ('approved', 'rejected')
on conflict (request_id, step_role) do nothing;

-- A rejection must be unsigned, but a historical rejected row could in principle
-- carry an approver signature if it had been approved and then... it cannot, but
-- assert rather than assume: a violation here means the mapping above is wrong
-- and the whole migration should stop rather than write misleading evidence.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.leave_request_approvals
   where decision = 'rejected' and signature_data is not null;
  if v_bad > 0 then
    raise exception 'backfill produced % signed rejection(s); mapping is wrong', v_bad;
  end if;
end $$;

-- Report what happened, so the deploy log shows it rather than passing silently.
do $$
declare
  v_rows int;
  v_reqs int;
begin
  select count(*) into v_rows from public.leave_request_approvals;
  select count(*) into v_reqs from public.leave_requests where status in ('approved','rejected');
  raise notice 'approval backfill: % approval row(s) now exist for % decided request(s)', v_rows, v_reqs;
end $$;
