-- =============================================================================
-- Migration: 20260818180002_approval_chain_person_engine.sql
-- Purpose  : Teach the approval engine about steps reserved for a NAMED PERSON.
-- Requirement: FR-42 (extends FR-36)
-- Spec     : docs/specs/2026-08-18-holidays-weekends-approvers-design.md Part 4
-- Depends  : 20260818180001_approval_steps_person.sql
--
-- Bodies dumped from `pg_get_functiondef` on the LIVE database and patched by a
-- script whose every anchor had to match exactly once, per docs/MEMORY.md. These
-- are security-critical and the migration history holds several versions; a
-- transcription slip in an untouched branch would be invisible in review.
--
-- ── Three changes, and the second is the subtle one ─────────────────────────
--
-- 1. ENTITLEMENT. A step with `approver_id` set is fillable only by that person,
--    and only while their account is active — so a deactivated named approver
--    BLOCKS the step rather than silently falling back to their role. There is
--    deliberately NO admin override on a named step: FR-36's override exists so
--    a company whose admin has no manager above them is not stuck, whereas
--    naming a person means that signature specifically is required. The remedy
--    for a departed approver is to edit the configuration — which 180001 just
--    put in reach of HR as well as admin — not to sign past them.
--
-- 2. STEP IDENTITY. Every "has this step been decided?" test now keys on the
--    STEP (`a.step_id = s.id`), falling back to the role only for rows written
--    before FR-42 (`a.step_id is null and a.step_role = s.role`). Several named
--    people may share one role, and the old role-only test would have let the
--    first of them to sign complete a step the others never filled. This affects
--    four separate queries: step selection, the already-signed message, order
--    enforcement, and the remaining-step count.
--
-- 3. The evidence row records `step_id`.
--
-- Unchanged: `leave_status` still flips only when no step remains, the advisory
-- lock is still taken before the step is chosen, rejection is still unilateral
-- and unsigned, and nobody but an admin signs their own request.
--
-- Idempotent: create or replace with unchanged signatures. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.approve_leave_request(p_id uuid, p_signature_data text, p_signature_authorized boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_step_id    uuid;
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
    select s.role, s.step_order, s.id into v_step_role, v_step_order, v_step_id
      from public.approval_steps s
     where s.company_id = v_company
       and s.active
       and v_kind = any(s.applies_to)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id
                and (a.step_id = s.id
                     or (a.step_id is null and a.step_role = s.role)))
       and (
             -- FR-42: a step reserved for one NAMED person is fillable only by
             -- that person, and only while their account is active. There is no
             -- admin override here, unlike a role step: naming someone means
             -- their signature specifically is required, and an admin who could
             -- sign in their place would make the naming advisory. A departed
             -- approver is fixed by editing the configuration (admin or hr),
             -- not by signing past them.
             case when s.approver_id is not null then
                    s.approver_id = v_uid and private.is_active(v_uid)
                  else
                    v_is_admin
                    or (s.role = 'manager' and v_is_mgr)
                    or (s.role <> 'manager' and private.has_role(v_uid, s.role))
             end
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
                or exists (
                     select 1 from public.approval_steps s
                      where s.company_id = v_company and s.active
                        and v_kind = any(s.applies_to)
                        and (a.step_id = s.id
                             or (a.step_id is null and a.step_role = s.role))
                        and case when s.approver_id is not null
                                 then s.approver_id = v_uid
                                 else (s.role = 'manager' and v_is_mgr)
                                      or (s.role <> 'manager'
                                          and private.has_role(v_uid, s.role))
                            end))
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
                  where a.request_id = p_id
                    and (a.step_id = s.id
                         or (a.step_id is null and a.step_role = s.role))
                    and a.decision = 'approved')
      ) then
        raise exception 'an earlier approval is still required' using errcode = '22023';
      end if;
    end if;
  end if;

  -- The unique (request_id, step_id) index is what actually stops double-signing;
  -- rows predating FR-42 are covered by the sibling index on (request_id, step_role).
  insert into public.leave_request_approvals (
    request_id, step_id, step_role, approver_id, decision, signature_data, signature_consent_at
  ) values (
    p_id, v_step_id, v_step_role, v_uid, 'approved', p_signature_data, v_consent_at
  );

  select count(*) into v_remaining
    from public.approval_steps s
   where s.company_id = v_company and s.active
     and v_kind = any(s.applies_to)
     and not exists (
           select 1 from public.leave_request_approvals a
            where a.request_id = p_id
              and (a.step_id = s.id
                   or (a.step_id is null and a.step_role = s.role))
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
$function$;

CREATE OR REPLACE FUNCTION public.reject_leave_request(p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_step_id   uuid;
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
    select s.role, s.id into v_step_role, v_step_id
      from public.approval_steps s
     where s.company_id = v_company and s.active
       and v_kind = any(s.applies_to)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id
                and (a.step_id = s.id
                     or (a.step_id is null and a.step_role = s.role)))
       and (
             -- FR-42: a step reserved for one NAMED person is fillable only by
             -- that person, and only while their account is active. There is no
             -- admin override here, unlike a role step: naming someone means
             -- their signature specifically is required, and an admin who could
             -- sign in their place would make the naming advisory. A departed
             -- approver is fixed by editing the configuration (admin or hr),
             -- not by signing past them.
             case when s.approver_id is not null then
                    s.approver_id = v_uid and private.is_active(v_uid)
                  else
                    v_is_admin
                    or (s.role = 'manager' and v_is_mgr)
                    or (s.role <> 'manager' and private.has_role(v_uid, s.role))
             end
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
    request_id, step_id, step_role, approver_id, decision, note
  ) values (
    p_id, v_step_id, v_step_role, v_uid, 'rejected', v_note
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
$function$;
