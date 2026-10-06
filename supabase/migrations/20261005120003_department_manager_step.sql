-- =============================================================================
-- Migration: 20261005120003_department_manager_step.sql
-- Purpose  : A request is signed by the employee's supervisor AND their
--            department's manager (owner decision D1, 2026-10-05).
-- Requirement: FR-47 (spec docs/specs/2026-10-05-org-chart-and-personnel-import-design.md §4)
-- Depends  : 20260818180002_approval_chain_person_engine.sql (current engine)
--            20260818180001_approval_steps_person.sql (approval_steps.approver_id)
--
-- ── Model ───────────────────────────────────────────────────────────────────
--
-- `profiles.manager_id` is the employee's DIRECT line: their supervisor if they
-- have one, else their manager (D7). The existing `manager` step already means
-- exactly that, through private.is_manager_of.
--
-- The second signer is the manager of the employee's DEPARTMENT,
-- `departments.manager_id` — a column that has existed since the first schema and
-- that nothing used. Checked against the client's personnel list, it yields the
-- signers the list intends for all 142 people.
--
-- ── New step kind ───────────────────────────────────────────────────────────
--
-- approval_steps.manager_scope: 'direct' (every existing row) | 'department'.
-- Only a `manager` step without a named approver may be 'department'.
--
-- The department step APPLIES to one request only when the requester's
-- department has an ACTIVE manager who is neither the requester nor the
-- requester's direct manager. Otherwise it is simply not required for that
-- request: a department manager's own request is signed by their own manager; an
-- employee reporting straight to the department manager needs one signature; an
-- inactive department manager must not block a request forever.
--
-- Applicability is evaluated live at each signature, like the direct step.
--
-- ── Engine patch ────────────────────────────────────────────────────────────
--
-- approve_leave_request and reject_leave_request are the live definitions from
-- supabase/schema.sql with exactly two textual substitutions, each asserted to
-- match before writing this file:
--   1. every `v_kind = any(s.applies_to)` gains
--      `and private.step_applies(s.manager_scope, v_emp)` — step selection, the
--      "already signed" message, order enforcement, the remaining-step count and
--      the configured-step count all ignore a department step that does not apply;
--   2. every `(s.role = 'manager' and v_is_mgr)` becomes "direct step → direct
--      manager, department step → department manager".
-- An admin may still fill any role step (FR-36); nobody signs their own request.
-- lib/leave/approvals.ts mirrors all of it and must stay in lockstep.
--
-- ── Rollout safety ──────────────────────────────────────────────────────────
--
-- The department step is inserted INACTIVE, right after each company's direct
-- manager step (later steps shift down one). Deploying changes no in-flight
-- request; admin or hr activates it on Manage → Approval steps.
--
-- Idempotent: guarded DDL, create or replace, the seed runs once per company.
-- =============================================================================

alter table public.approval_steps
  add column if not exists manager_scope text not null default 'direct';

alter table public.approval_steps drop constraint if exists approval_steps_manager_scope_valid;
alter table public.approval_steps add constraint approval_steps_manager_scope_valid
  check (
    manager_scope in ('direct', 'department')
    and (manager_scope = 'direct' or (role = 'manager' and approver_id is null))
  );

-- One role step per (role, scope): the direct and department manager steps
-- coexist, two direct manager steps still cannot.
drop index if exists public.approval_steps_company_role_uniq;
create unique index if not exists approval_steps_company_role_scope_uniq
  on public.approval_steps (company_id, role, manager_scope) where approver_id is null;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function private.department_manager_for(p_emp uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select d.manager_id
    from public.profiles p
    join public.departments d on d.id = p.department_id
    join public.profiles m on m.id = d.manager_id and m.active
   where p.id = p_emp;
$$;

create or replace function private.department_step_applies(p_emp uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select x.dm is not null
     and x.dm <> p_emp
     and x.dm is distinct from (select manager_id from public.profiles where id = p_emp)
    from (select private.department_manager_for(p_emp) as dm) x;
$$;

create or replace function private.step_applies(p_scope text, p_emp uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_scope is distinct from 'department' or private.department_step_applies(p_emp);
$$;

create or replace function private.is_department_manager_of(p_uid uuid, p_emp uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_uid is not null
     and private.is_active(p_uid)
     and private.department_manager_for(p_emp) = p_uid;
$$;

revoke all on function private.department_manager_for(uuid) from public;
revoke all on function private.department_step_applies(uuid) from public;
revoke all on function private.step_applies(text, uuid) from public;
revoke all on function private.is_department_manager_of(uuid, uuid) from public;

-- ── Seed: one inactive department step per company ──────────────────────────

do $$
declare
  c       record;
  v_after int;
begin
  for c in select id from public.companies loop
    if exists (
      select 1 from public.approval_steps
       where company_id = c.id and role = 'manager' and manager_scope = 'department'
    ) then
      continue;
    end if;

    select step_order into v_after
      from public.approval_steps
     where company_id = c.id and role = 'manager' and manager_scope = 'direct' and approver_id is null
     order by step_order
     limit 1;
    v_after := coalesce(v_after, 0);

    update public.approval_steps
       set step_order = step_order + 1
     where company_id = c.id and step_order > v_after;

    insert into public.approval_steps (company_id, role, manager_scope, applies_to, step_order, active)
    values (c.id, 'manager', 'department', '{leave,errand}', v_after + 1, false);
  end loop;
end $$;

-- ── Engine ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_leave_request(p_id uuid, p_signature_data text, p_signature_authorized boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
   where s.company_id = v_company and s.active and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp);

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
       and v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)
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
                    or ((s.role = 'manager' and s.manager_scope = 'direct' and v_is_mgr) or (s.role = 'manager' and s.manager_scope = 'department' and private.is_department_manager_of(v_uid, v_emp)))
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
$_$;


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
                    or ((s.role = 'manager' and s.manager_scope = 'direct' and v_is_mgr) or (s.role = 'manager' and s.manager_scope = 'department' and private.is_department_manager_of(v_uid, v_emp)))
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

