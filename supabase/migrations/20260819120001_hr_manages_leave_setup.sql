-- =============================================================================
-- Migration: 20260819120001_hr_manages_leave_setup.sql
-- Purpose  : HR can set an employee's opening leave balance and monthly accrual
--            policy, the same as an admin — the fields were hidden from HR on the
--            Add/Edit Employee screens only because these functions refused them.
-- Requirement: FR-43 (extends FR-35)
-- Depends  : 20260713120001_employee_onboarding.sql (allocate_leave_impl)
--            20260729130005_leave_policy.sql (set_employee_leave_policy)
--            20260630120001_set_leave_balance.sql (set_leave_balance)
--
-- Bodies dumped from `pg_get_functiondef` on the LIVE database and patched by a
-- script whose guard anchor had to match exactly once in each, per
-- docs/MEMORY.md. These write the leave ledger; a transcription slip in an
-- untouched branch would be invisible in review.
--
-- ── What this grants ────────────────────────────────────────────────────────
--
-- HR could already create employees (FR-35) but not give them a starting balance
-- or an accrual rule, so a new hire arrived with nothing and an admin had to
-- finish the job. That split was never intended — it fell out of these three
-- functions being admin-only.
--
-- This IS an authority increase: HR can now set any employee's balance to any
-- value, which writes an `adjustment` ledger row. That is the point — HR
-- administers leave — and every write stays audited exactly as it was.
--
-- ── The one thing HR does NOT get ───────────────────────────────────────────
--
-- A non-admin cannot do any of this to THEMSELVES. FR-36 already draws this line
-- for approvals: nobody but an admin signs their own request, because an admin is
-- the owner and an HR officer approving their own leave is a control weakness.
-- The same reasoning applies more sharply to setting your own balance. An admin
-- is deliberately still allowed, so a company whose admin is its only HR person
-- is not stuck.
--
-- Role assignment stays admin-only and is untouched: `app_set_user_roles` and
-- `app_create_employee`'s HR branch still clamp to `{employee}` (FR-35 D4).
--
-- Idempotent: create or replace with unchanged signatures. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.allocate_leave(p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- FR-43: admin OR hr. HR administers leave, so the two screens that set an
  -- opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_role(auth.uid(), 'hr')) then
    raise exception 'only admins or hr can allocate leave' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  return private.allocate_leave_impl(auth.uid(), p_employee_id, p_leave_type_id,
                                     p_period_start, p_period_end, p_minutes);
end; $function$;

CREATE OR REPLACE FUNCTION public.set_employee_leave_policy(p_employee_id uuid, p_leave_type_id uuid, p_accrual_minutes_per_month integer, p_annual_cap_minutes integer, p_carryover_cap_minutes integer, p_accrual_start_month date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  -- FR-43: admin OR hr. HR administers leave, so the two screens that set an
  -- opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_role(auth.uid(), 'hr')) then
    raise exception 'only admins or hr can set a leave policy' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  if p_accrual_minutes_per_month is null or p_accrual_minutes_per_month < 0 then
    raise exception 'accrual per month must be 0 or more' using errcode = '22023';
  end if;
  if p_carryover_cap_minutes is null or p_carryover_cap_minutes < 0 then
    raise exception 'carryover cap must be 0 or more' using errcode = '22023';
  end if;
  if p_annual_cap_minutes is not null and p_annual_cap_minutes < 0 then
    raise exception 'annual cap must be 0 or more' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jalali_months where gregorian_start = p_accrual_start_month) then
    raise exception 'accrual start month must be a jalali month start' using errcode = '22023';
  end if;

  insert into public.employee_leave_policies as elp (
    employee_id, leave_type_id, accrual_minutes_per_month,
    annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
  ) values (
    p_employee_id, p_leave_type_id, p_accrual_minutes_per_month,
    p_annual_cap_minutes, p_carryover_cap_minutes, p_accrual_start_month, auth.uid()
  )
  on conflict (employee_id, leave_type_id) do update
     set accrual_minutes_per_month = excluded.accrual_minutes_per_month,
         annual_cap_minutes        = excluded.annual_cap_minutes,
         carryover_cap_minutes     = excluded.carryover_cap_minutes,
         accrual_start_month       = excluded.accrual_start_month
  returning elp.id into v_id;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_employee_leave_policy', 'employee_leave_policies', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'accrual_minutes_per_month', p_accrual_minutes_per_month,
                             'annual_cap_minutes', p_annual_cap_minutes,
                             'carryover_cap_minutes', p_carryover_cap_minutes,
                             'accrual_start_month', p_accrual_start_month));
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target_minutes integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current int;
  v_ledger uuid;
begin
  -- FR-43: admin OR hr. HR administers leave, so the two screens that set an
  -- opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_role(auth.uid(), 'hr')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;

  if p_target_minutes is null or p_target_minutes < 0 then
    raise exception 'target balance must be >= 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target_minutes then
    return p_target_minutes;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set')
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $function$;

-- ── accrue_employee_leave: hr may trigger the lazy accrual too ──────────────
--
-- Found while testing FR-43, in the dev-server log rather than by reading:
--     [accrual] skipped: not allowed to accrue for this employee
-- HR could set an accrual policy and then read a balance that never advanced,
-- because this refused them. Body patched from `pg_get_functiondef`.
CREATE OR REPLACE FUNCTION public.accrue_employee_leave(p_employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_type uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- FR-43: hr joins manager-of and admin. This posts only months the policy has
  -- ALREADY earned — it credits nothing that was not due — and it runs lazily on
  -- every balance read. Without hr here, the balances HR now reads on the Edit
  -- Employee screen would silently lag behind the accrual policy HR just set.
  if not (private.is_manager_of(v_uid, p_employee_id)
          or private.is_admin(v_uid)
          or private.has_role(v_uid, 'hr')) then
    raise exception 'not allowed to accrue for this employee' using errcode = '42501';
  end if;

  for v_type in
    select leave_type_id from public.employee_leave_policies where employee_id = p_employee_id
  loop
    perform public.accrue_leave(p_employee_id, v_type);
  end loop;
end; $function$;
