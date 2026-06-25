-- =============================================================================
-- Migration: 20260624090001_leave_approval_fns.sql
-- Purpose  : Approval write-path. leave_requests / leave_ledger have NO client
--            write policies (see 20260623120005_leave.sql); these SECURITY
--            DEFINER functions are the ONLY way to approve/reject a request and
--            to write the consumption ledger row. They enforce the guard first.
-- Guard    : private.is_manager_of(approver, employee) OR private.is_admin(approver).
--            (admin arm = the FR-14 "admin can override any decision".)
-- Depends  : 20260623120005_leave.sql      (leave_requests, leave_ledger, leave_types)
--            20260623120006_leave_fns.sql   (current_leave_balance)
--            20260623120002_rls_helpers.sql (private.is_manager_of, private.is_admin)
-- Note     : Advisor lint 0029 (exposed SECURITY DEFINER fn) is accepted by
--            design — the in-function manager/admin check is the intended gate,
--            same rationale as the admin RPCs (see docs/PERMISSIONS.md).
-- =============================================================================

-- approve_leave_request: manager-of(employee) or admin sets a pending request to
-- 'approved' and, for balance-affecting leave types, writes a 'consumption'
-- ledger row of -requested_days. The status predicate on the UPDATE makes the
-- transition atomic so a concurrent double-approve cannot double-debit.
create or replace function public.approve_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_type    uuid;
  v_days    numeric;
  v_status  public.leave_status;
  v_affects boolean;
  v_prev    numeric;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id, leave_type_id, requested_days, status
    into v_emp, v_type, v_days, v_status
    from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  -- Atomic state transition; the status predicate guards against a concurrent
  -- double-approve so the consumption ledger is written at most once.
  update public.leave_requests
     set status = 'approved', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_days, balance_after, note)
    values (v_emp, v_type, p_id, 'consumption', -v_days, v_prev - v_days, 'consumption on approval');
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'approve_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'days', v_days, 'affects_balance', coalesce(v_affects, false)));
end; $$;

-- reject_leave_request: manager-of(employee) or admin sets a pending request to
-- 'rejected'. No ledger change (a pending request never consumed balance). The
-- optional rejection note is recorded in audit_log only (there is no decision-
-- note column on leave_requests; `reason` belongs to the requester).
create or replace function public.reject_leave_request(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_emp    uuid;
  v_status public.leave_status;
  v_rows   int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id, status into v_emp, v_status from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending requests can be rejected' using errcode = '22023';
  end if;

  update public.leave_requests
     set status = 'rejected', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'reject_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'reason', p_reason));
end; $$;

-- Grants: callable by authenticated (self-guarded); anon + implicit PUBLIC revoked.
revoke execute on function public.approve_leave_request(uuid)      from public, anon;
grant  execute on function public.approve_leave_request(uuid)      to authenticated;
revoke execute on function public.reject_leave_request(uuid, text) from public, anon;
grant  execute on function public.reject_leave_request(uuid, text) to authenticated;
