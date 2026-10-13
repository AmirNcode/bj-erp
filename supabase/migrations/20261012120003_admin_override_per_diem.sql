-- FR-56 / FR-58 / FR-61 (2026-10-12, spec
-- docs/specs/2026-10-12-client-feedback-approvals-settings-design.md §1, §3, §6).
--
-- 1. Security and admin are no longer approval steps. Existing steps with those
--    roles are deactivated (their recorded signatures stay), and the role CHECK
--    admits them only on an inactive row, so nobody can switch one back on.
-- 2. Admin override: an admin who approves fills EVERY outstanding step with one
--    signature — named-person steps included (amends FR-42) — and the request
--    completes in the same transaction. An admin who holds a natural step on
--    the request (named approver, direct/department manager, or the step's
--    role, e.g. hr) signs just that step unless p_override is true.
-- 3. Per diem (فوق‌العاده ماموریت): an optional Rial amount recorded when the
--    approval being signed fills an `hr` step on an errand.
--
-- approve_leave_request changes signature (two defaulted parameters). The old
-- three-argument form is dropped; three-argument calls from the still-running
-- old app resolve to the new function through the defaults.

-- ── per diem column ─────────────────────────────────────────────────────────
alter table public.leave_requests
  add column per_diem_rials bigint,
  add constraint leave_requests_per_diem_shape
    check (per_diem_rials is null or (per_diem_rials >= 0 and kind = 'errand'));

comment on column public.leave_requests.per_diem_rials is
  'FR-61: per diem in Rials, entered on the hr approval step of an errand. Read by finance through finance_approved_requests().';

-- ── security / admin steps retired ──────────────────────────────────────────
update public.approval_steps
   set active = false, updated_at = now()
 where role in ('security', 'admin') and active;

alter table public.approval_steps
  drop constraint approval_steps_role_allowed,
  add constraint approval_steps_role_allowed check (
    role in ('manager', 'hr', 'employee')
    or (role in ('security', 'admin') and not active)
  );

-- ── approve ────────────────────────────────────────────────────────────────
drop function public.approve_leave_request(uuid, text, boolean);

create function public.approve_leave_request(
  p_id uuid,
  p_signature_data text,
  p_signature_authorized boolean,
  p_override boolean default false,
  p_per_diem_rials bigint default null
) returns void
    language plpgsql security definer
    set search_path to ''
    as $_$
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
  v_override   boolean := false;
  v_filled     int := 1;
  v_filled_hr  boolean := false;
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
  if p_per_diem_rials is not null and p_per_diem_rials < 0 then
    raise exception 'per diem must be 0 or more' using errcode = '22023';
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
   where s.company_id = v_company and s.active and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp);

  if v_total = 0 then
    -- No chain configured: behave exactly as before FR-36.
    if not (v_is_mgr or v_is_admin) then
      raise exception 'not allowed to decide this request' using errcode = '42501';
    end if;
    v_step_role := 'manager';
    v_step_order := 1;
  else
    -- The lowest-ordered outstanding step this caller fills IN THEIR OWN RIGHT
    -- (FR-58: holding `admin` no longer entitles anyone to a step; the admin
    -- path is the override below). Nobody signs their own request this way.
    select s.role, s.step_order, s.id into v_step_role, v_step_order, v_step_id
      from public.approval_steps s
     where s.company_id = v_company
       and s.active
       and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id
                and (a.step_id = s.id
                     or (a.step_id is null and a.step_role = s.role)))
       and (
             case when s.approver_id is not null then
                    s.approver_id = v_uid and private.is_active(v_uid)
                  else
                    ((s.role = 'manager' and s.manager_scope = 'direct' and v_is_mgr) or (s.role = 'manager' and s.manager_scope = 'department' and private.is_department_manager_of(v_uid, v_emp)))
                    or (s.role <> 'manager' and private.has_role(v_uid, s.role))
             end
           )
       and v_emp <> v_uid
     order by s.step_order, s.role
     limit 1;

    -- FR-58: an admin overrides on request, or whenever they have no step of
    -- their own to sign.
    v_override := v_is_admin and (coalesce(p_override, false) or v_step_role is null);

    if v_override then
      select coalesce(bool_or(s.role = 'hr'), false) into v_filled_hr
        from public.approval_steps s
       where s.company_id = v_company and s.active
         and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
         and not exists (
               select 1 from public.leave_request_approvals a
                where a.request_id = p_id
                  and (a.step_id = s.id
                       or (a.step_id is null and a.step_role = s.role)));

      -- One signed row per outstanding step, so each box on the printed form
      -- shows who filled it. Order enforcement does not bind the override.
      insert into public.leave_request_approvals (
        request_id, step_id, step_role, approver_id, decision, signature_data, signature_consent_at
      )
      select p_id, s.id, s.role, v_uid, 'approved', p_signature_data, v_consent_at
        from public.approval_steps s
       where s.company_id = v_company and s.active
         and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
         and not exists (
               select 1 from public.leave_request_approvals a
                where a.request_id = p_id
                  and (a.step_id = s.id
                       or (a.step_id is null and a.step_role = s.role)));
      get diagnostics v_filled = row_count;
      v_step_role := 'admin';
      v_step_id := null;
    else
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
                          and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
                          and (a.step_id = s.id
                               or (a.step_id is null and a.step_role = s.role))
                          and case when s.approver_id is not null
                                   then s.approver_id = v_uid
                                   else ((s.role = 'manager' and s.manager_scope = 'direct' and v_is_mgr) or (s.role = 'manager' and s.manager_scope = 'department' and private.is_department_manager_of(v_uid, v_emp)))
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
             and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
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
      v_filled_hr := v_step_role = 'hr';
    end if;
  end if;

  if not v_override then
    -- The unique (request_id, step_id) index is what actually stops double-signing;
    -- rows predating FR-42 are covered by the sibling index on (request_id, step_role).
    insert into public.leave_request_approvals (
      request_id, step_id, step_role, approver_id, decision, signature_data, signature_consent_at
    ) values (
      p_id, v_step_id, v_step_role, v_uid, 'approved', p_signature_data, v_consent_at
    );
  end if;

  -- FR-61: per diem belongs to HR's step on an errand.
  if p_per_diem_rials is not null then
    if v_kind <> 'errand' or not v_filled_hr then
      raise exception 'per diem can only be set on the hr step of an errand' using errcode = '22023';
    end if;
    update public.leave_requests set per_diem_rials = p_per_diem_rials where id = p_id;
  end if;

  select count(*) into v_remaining
    from public.approval_steps s
   where s.company_id = v_company and s.active
     and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
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
      'admin_override', v_override,
      'steps_filled', v_filled,
      'per_diem_rials', p_per_diem_rials,
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
      'admin_override', v_override,
      'digital_signature_authorized', true,
      'signature_consent_at', v_consent_at
    )
  );
end;
$_$;

revoke all on function public.approve_leave_request(uuid, text, boolean, boolean, bigint) from public;
grant all on function public.approve_leave_request(uuid, text, boolean, boolean, bigint) to authenticated;
grant all on function public.approve_leave_request(uuid, text, boolean, boolean, bigint) to service_role;


-- ── reject: admin may reject past a named step too (FR-58) ────────────────
CREATE OR REPLACE FUNCTION public.reject_leave_request(p_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
   where s.company_id = v_company and s.active and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp);

  if v_total = 0 then
    if not (v_is_mgr or v_is_admin) then
      raise exception 'not allowed to decide this request' using errcode = '42501';
    end if;
    v_step_role := 'manager';
  else
    select s.role, s.id into v_step_role, v_step_id
      from public.approval_steps s
     where s.company_id = v_company and s.active
       and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id
                and (a.step_id = s.id
                     or (a.step_id is null and a.step_role = s.role)))
       and (
             -- FR-58: an admin may reject any pending request, a step naming a
             -- person included; everyone else only a step they are entitled to.
             v_is_admin or
             case when s.approver_id is not null then
                    s.approver_id = v_uid and private.is_active(v_uid)
                  else
                    ((s.role = 'manager' and s.manager_scope = 'direct' and v_is_mgr) or (s.role = 'manager' and s.manager_scope = 'department' and private.is_department_manager_of(v_uid, v_emp)))
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
$$;
