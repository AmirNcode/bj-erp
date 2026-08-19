-- =============================================================================
-- Migration: 20260818160003_approval_chain_engine.sql
-- Purpose  : Make approval a chain. `approve_leave_request` now fills ONE step
--            and only finalises the request — ledger and all — once every
--            active step for that request's kind has approved.
-- Requirement: FR-36 (amends FR-14)
-- Depends  : 20260818160001 (schema) · 20260818160002 (backfill)
--
-- The public signature is unchanged, so no caller changes shape.
--
-- ── Concurrency, and why the advisory lock moved earlier ────────────────────
--
-- Two approvers can sign DIFFERENT steps at the same instant. Each would count
-- the outstanding steps, each would see zero left, and each would finalise —
-- debiting the ledger twice for one request. So the per-employee advisory lock
-- is now taken BEFORE the step is chosen and the row inserted, not just before
-- the ledger write. It serialises the whole decide-and-count sequence.
--
-- ── Self-approval ───────────────────────────────────────────────────────────
--
-- A non-admin may never sign a step on their OWN request — otherwise the first
-- HR officer to request leave could sign their own HR step. Admins keep the
-- pre-existing ability to approve their own request, deliberately: in a company
-- whose admin has no manager above them, removing it would leave their leave
-- permanently undecidable.
--
-- ── If an admin deactivates every step ──────────────────────────────────────
--
-- The chain degrades to exactly today's behaviour — a single direct-manager or
-- admin decision, recorded as the `manager` step — rather than making approval
-- impossible. Configuration should not be able to wedge the app.
--
-- Idempotent: create or replace. Safe to re-run.
-- =============================================================================

create or replace function public.approve_leave_request(
  p_id uuid,
  p_signature_data text,
  p_signature_authorized boolean
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_emp        uuid;
  v_company    uuid;
  v_kind       public.request_kind;
  v_type       uuid;
  v_minutes    int;
  v_status     public.leave_status;
  v_start      date;
  v_end        date;
  v_unit       public.leave_unit;
  v_st         time;
  v_et         time;
  v_repl       uuid;
  v_affects    boolean;
  v_is_paid    boolean;
  v_prev       int := 0;
  v_paid       int := 0;
  v_unpaid     int := 0;
  v_rows       int;
  v_consent_at timestamptz := now();
  v_is_admin   boolean;
  v_is_mgr     boolean;
  v_step_role  public.app_role;
  v_step_order int;
  v_total      int;
  v_remaining  int;
  v_enforce    boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_signature_authorized is not true then
    raise exception 'signature authorization is required' using errcode = '22023';
  end if;
  if p_signature_data is null or p_signature_data = '' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if length(p_signature_data) not between 100 and 350000
     or mod(length(p_signature_data), 4) <> 2
     or p_signature_data !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
  then
    raise exception 'signature data is invalid' using errcode = '22023';
  end if;

  select employee_id, company_id, kind into v_emp, v_company, v_kind
    from public.leave_requests where id = p_id;
  if v_emp is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  v_is_admin := private.is_admin(v_uid);
  v_is_mgr := private.is_manager_of(v_uid, v_emp);

  -- Serialise the whole sequence per employee, not just the ledger write.
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date,
         unit, start_time, end_time, replacement_id
    into v_type, v_minutes, v_status, v_start, v_end,
         v_unit, v_st, v_et, v_repl
    from public.leave_requests
   where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.approval_steps s
   where s.company_id = v_company and s.active and v_kind = any(s.applies_to);

  if v_total = 0 then
    -- No chain configured: behave exactly as before this migration.
    if not (v_is_mgr or v_is_admin) then
      raise exception 'not allowed to decide this request' using errcode = '42501';
    end if;
    v_step_role := 'manager';
    v_step_order := 1;
  else
    -- The lowest-ordered outstanding step this caller is entitled to fill.
    select s.role, s.step_order into v_step_role, v_step_order
      from public.approval_steps s
     where s.company_id = v_company
       and s.active
       and v_kind = any(s.applies_to)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id and a.step_role = s.role)
       and (
             v_is_admin
             or (s.role = 'manager' and v_is_mgr)
             or (s.role <> 'manager' and private.has_role(v_uid, s.role))
           )
       -- Nobody but an admin signs their own request.
       and (v_is_admin or v_emp <> v_uid)
     order by s.step_order, s.role
     limit 1;

    if v_step_role is null then
      -- Distinguish "already signed by you" from "not your step", because the
      -- two need different things from the person reading the message.
      if exists (
        select 1 from public.leave_request_approvals a
         where a.request_id = p_id
           and (a.approver_id = v_uid
                or a.step_role in (
                     select s.role from public.approval_steps s
                      where s.company_id = v_company and s.active
                        and v_kind = any(s.applies_to)
                        and ((s.role = 'manager' and v_is_mgr)
                             or (s.role <> 'manager' and private.has_role(v_uid, s.role)))))
      ) then
        raise exception 'you have already signed this request' using errcode = '22023';
      end if;
      raise exception 'not allowed to decide this request' using errcode = '42501';
    end if;

    select coalesce(approval_order_enforced, false) into v_enforce
      from public.work_settings where company_id = v_company limit 1;

    if coalesce(v_enforce, false) then
      if exists (
        select 1 from public.approval_steps s
         where s.company_id = v_company and s.active
           and v_kind = any(s.applies_to)
           and s.step_order < v_step_order
           and not exists (
                 select 1 from public.leave_request_approvals a
                  where a.request_id = p_id and a.step_role = s.role
                    and a.decision = 'approved')
      ) then
        raise exception 'an earlier approval is still required' using errcode = '22023';
      end if;
    end if;
  end if;

  -- The unique (request_id, step_role) key is what actually stops double-signing.
  insert into public.leave_request_approvals (
    request_id, step_role, approver_id, decision, signature_data, signature_consent_at
  ) values (
    p_id, v_step_role, v_uid, 'approved', p_signature_data, v_consent_at
  );

  select count(*) into v_remaining
    from public.approval_steps s
   where s.company_id = v_company and s.active
     and v_kind = any(s.applies_to)
     and not exists (
           select 1 from public.leave_request_approvals a
            where a.request_id = p_id and a.step_role = s.role
              and a.decision = 'approved');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'approve_leave_step', 'leave_requests', p_id,
    jsonb_build_object(
      'employee_id', v_emp,
      'step_role', v_step_role,
      'steps_remaining', v_remaining,
      'digital_signature_authorized', true,
      'signature_consent_at', v_consent_at
    )
  );

  -- Still waiting on someone else: the request stays pending and the ledger is
  -- untouched. This early return is the whole point of the chain.
  if v_remaining > 0 then
    return;
  end if;

  -- ── final step: everything FR-14 used to do on the single decision ────────
  if exists (
    select 1 from public.leave_requests r
     where r.employee_id = v_emp
       and r.id <> p_id
       and r.status = 'approved'
       and r.start_date <= v_end
       and r.end_date >= v_start
       and (
         r.unit = 'day' or v_unit = 'day'
         or (r.start_time < v_et and r.end_time > v_st)
       )
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  if v_repl is not null
     and private.replacement_is_away(v_repl, v_start, v_end, v_unit, v_st, v_et)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  select affects_balance, is_paid into v_affects, v_is_paid
    from public.leave_types where id = v_type;

  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    v_paid := least(v_minutes, greatest(v_prev, 0));
    v_unpaid := v_minutes - v_paid;
  elsif v_type is not null and not coalesce(v_is_paid, false) then
    v_unpaid := v_minutes;
  end if;

  update public.leave_requests
     set status = 'approved',
         unpaid_minutes = v_unpaid,
         decided_by = v_uid,
         decided_at = v_consent_at,
         -- Legacy columns keep the pre-chain readers working (the existing
         -- approver-signature viewer, the calendar metadata query). They record
         -- whoever COMPLETED the chain; the per-step evidence lives in
         -- leave_request_approvals.
         approver_signature_data = p_signature_data,
         approver_signature_consent_at = v_consent_at
   where id = p_id
     and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  if v_affects and v_paid > 0 then
    insert into public.leave_ledger(
      employee_id, leave_type_id, request_id, entry_type,
      delta_minutes, balance_after_minutes, note
    ) values (
      v_emp, v_type, p_id, 'consumption',
      -v_paid, v_prev - v_paid, 'paid portion consumed on approval'
    );
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'approve_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'employee_id', v_emp,
      'requested_minutes', v_minutes,
      'paid_minutes', v_paid,
      'unpaid_minutes', v_unpaid,
      'affects_balance', coalesce(v_affects, false),
      'replacement_id', v_repl,
      'completed_by_step', v_step_role,
      'digital_signature_authorized', true,
      'signature_consent_at', v_consent_at
    )
  );
end;
$$;

-- =============================================================================
-- Rejection stays unilateral and unsigned (FR-14): any required approver may
-- reject, and the request is rejected immediately regardless of who has already
-- approved. Their approval rows are kept as evidence of what happened.
-- =============================================================================

create or replace function public.reject_leave_request(p_id uuid, p_reason text default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_emp       uuid;
  v_company   uuid;
  v_kind      public.request_kind;
  v_status    public.leave_status;
  v_rows      int;
  v_note      text := nullif(btrim(coalesce(p_reason, '')), '');
  v_is_admin  boolean;
  v_is_mgr    boolean;
  v_step_role public.app_role;
  v_total     int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  if length(v_note) > 500 then
    raise exception 'rejection note is too long (max 500 characters)' using errcode = '22023';
  end if;

  select employee_id, company_id, kind, status
    into v_emp, v_company, v_kind, v_status
    from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  v_is_admin := private.is_admin(v_uid);
  v_is_mgr := private.is_manager_of(v_uid, v_emp);

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select count(*) into v_total
    from public.approval_steps s
   where s.company_id = v_company and s.active and v_kind = any(s.applies_to);

  if v_total = 0 then
    if not (v_is_mgr or v_is_admin) then
      raise exception 'not allowed to decide this request' using errcode = '42501';
    end if;
    v_step_role := 'manager';
  else
    select s.role into v_step_role
      from public.approval_steps s
     where s.company_id = v_company and s.active
       and v_kind = any(s.applies_to)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id and a.step_role = s.role)
       and (
             v_is_admin
             or (s.role = 'manager' and v_is_mgr)
             or (s.role <> 'manager' and private.has_role(v_uid, s.role))
           )
       and (v_is_admin or v_emp <> v_uid)
     order by s.step_order, s.role
     limit 1;

    if v_step_role is null then
      raise exception 'not allowed to decide this request' using errcode = '42501';
    end if;
  end if;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be rejected' using errcode = '22023';
  end if;

  insert into public.leave_request_approvals (
    request_id, step_role, approver_id, decision, note
  ) values (
    p_id, v_step_role, v_uid, 'rejected', v_note
  );

  update public.leave_requests
     set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = v_note
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'reject_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'step_role', v_step_role, 'reason', v_note));
end;
$$;
