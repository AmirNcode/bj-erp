-- =============================================================================
-- Migration: 20260729130004_leave_minutes_allocation_impl.sql
-- Purpose  : Finish the days -> minutes conversion for the ALLOCATION path,
--            which …130003 missed.
--
-- Why this exists: the contract migration ported the definer functions as they
-- stood in 20260702120001_hardening.sql, but 20260713120001_employee_onboarding.sql
-- had since extracted the real allocation body into private.allocate_leave_impl
-- and pointed two large functions at it — public.app_create_employee (manager
-- path, default quotas) and public.app_bulk_create_employees (CSV import). Those
-- kept writing allocated_days / delta_days / balance_after, so after …130003
-- dropped those columns BOTH employee-creation paths failed with
--   column "allocated_days" of relation "leave_allocations" does not exist
-- caught by tests/e2e/manager-create-employee.spec.ts and bulk-import.spec.ts.
--
-- Found authoritatively by querying pg_proc.prosrc for the old column names
-- rather than by grepping migrations, since a later migration can silently
-- redefine an earlier function.
--
-- Design: allocate_leave_impl becomes minutes-native and public.allocate_leave
-- delegates to it again (…130003 had duplicated its body). The two callers stay
-- day-denominated — leave_types.default_annual_quota_days and the CSV
-- annual_days/sick_days columns are days by nature — and convert at the call
-- site via private.company_minutes_per_day.
--
-- The two big function bodies below were taken from pg_get_functiondef on the
-- live database and patched programmatically at the allocation call sites only;
-- nothing else in them was retyped or altered.
--
-- Idempotent. Target is Postgres 15.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. How many minutes one day of leave is worth, for a company.
-- ---------------------------------------------------------------------------
create or replace function private.company_minutes_per_day(p_company_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select round(coalesce((
    select hours_per_day from public.work_settings where company_id = p_company_id limit 1
  ), 8) * 60)::int;
$$;

revoke all on function private.company_minutes_per_day(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. allocate_leave_impl — minutes-native. No auth check: callers are SECURITY
--    DEFINER functions that have already authorized the actor.
-- ---------------------------------------------------------------------------
drop function if exists private.allocate_leave_impl(uuid, uuid, uuid, date, date, numeric);
drop function if exists private.allocate_leave_impl(uuid, uuid, uuid, date, date, int);

create function private.allocate_leave_impl(
  p_actor uuid, p_employee_id uuid, p_leave_type_id uuid,
  p_period_start date, p_period_end date, p_minutes int
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev int; v_alloc uuid;
begin
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'allocation days must be greater than 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  insert into public.leave_allocations(employee_id, leave_type_id, period_start, period_end, allocated_minutes, created_by)
  values (p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_minutes, p_actor)
  returning id into v_alloc;

  v_prev := public.current_leave_balance(p_employee_id, p_leave_type_id);
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'allocation', p_minutes, v_prev + p_minutes, 'allocation');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (p_actor, 'allocate_leave', 'leave_allocations', v_alloc,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id, 'minutes', p_minutes));
  return v_alloc;
end; $$;

revoke all on function private.allocate_leave_impl(uuid, uuid, uuid, date, date, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.allocate_leave — admin guard + delegate (restores the …130713
--    architecture that …130003 accidentally bypassed by inlining the body).
-- ---------------------------------------------------------------------------
drop function if exists public.allocate_leave(uuid, uuid, date, date, int);

create function public.allocate_leave(
  p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes int
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can allocate leave' using errcode = '42501';
  end if;
  return private.allocate_leave_impl(auth.uid(), p_employee_id, p_leave_type_id,
                                     p_period_start, p_period_end, p_minutes);
end; $$;

revoke execute on function public.allocate_leave(uuid, uuid, date, date, int) from public, anon;
grant  execute on function public.allocate_leave(uuid, uuid, date, date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app_create_employee — live definition, allocation call site converted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles app_role[] DEFAULT ARRAY['employee'::app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_admin  boolean;
  v_dept   uuid;
  v_mgr    uuid;
  v_roles  public.app_role[];
  v_company uuid;
  v_uid    uuid;
  lt       record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_admin := private.is_admin(v_caller);

  if v_admin then
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := p_roles;
    v_company := p_company_id;
  elsif private.has_role(v_caller, 'manager') then
    -- Managers onboard into their own team only; every privileged input is
    -- overwritten here regardless of what the client sent.
    select department_id, company_id into v_dept, v_company
      from public.profiles where id = v_caller;
    if v_dept is null then
      raise exception 'manager has no department' using errcode = '22023';
    end if;
    v_mgr := v_caller;
    v_roles := array['employee']::public.app_role[];
  else
    raise exception 'admin or manager role required' using errcode = '42501';
  end if;

  v_uid := private.create_employee_impl(
    v_caller, case when v_admin then 'admin' else 'manager' end,
    v_company, v_dept, v_mgr, p_personnel_no, p_full_name, p_password,
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title);

  -- Manager path: default quotas immediately, no admin round-trip.
  if not v_admin then
    for lt in
      select id, default_annual_quota_days
        from public.leave_types
       where company_id = v_company and active and affects_balance
         and coalesce(default_annual_quota_days, 0) > 0
    loop
      perform private.allocate_leave_impl(
        v_caller, v_uid, lt.id,
        date_trunc('year', current_date)::date,
        (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
        round(lt.default_annual_quota_days * private.company_minutes_per_day(v_company))::int);
    end loop;
  end if;

  return v_uid;
end; $function$;

revoke execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text) from public, anon;
grant  execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app_bulk_create_employees — live definition, both call sites converted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_bulk_create_employees(p_company_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller  uuid := auth.uid();
  v_row     jsonb;
  v_i       integer := 0;
  v_dept    uuid;
  v_mgr     uuid;
  v_role    text;
  v_uid     uuid;
  v_code    text;
  v_annual  numeric;
  v_sick    numeric;
  v_annual_type uuid;
  v_sick_type   uuid;
  v_result  jsonb := '[]'::jsonb;
  v_ystart  date := date_trunc('year', current_date)::date;
  v_yend    date := (date_trunc('year', current_date) + interval '1 year - 1 day')::date;
begin
  if not private.is_admin(v_caller) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;

  select id into v_annual_type from public.leave_types
   where company_id = p_company_id and name_en = 'Annual Leave' and affects_balance;
  select id into v_sick_type from public.leave_types
   where company_id = p_company_id and name_en = 'Sick Leave' and affects_balance;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;

    v_role := coalesce(v_row->>'role', 'employee');
    if v_role not in ('manager', 'employee') then
      raise exception 'row %: role must be manager or employee', v_i using errcode = '22023';
    end if;

    select id into v_dept from public.departments
     where company_id = p_company_id and code = v_row->>'department_code';
    if v_dept is null then
      raise exception 'row %: unknown department code "%"', v_i, v_row->>'department_code' using errcode = '22023';
    end if;

    v_mgr := null;
    if coalesce(v_row->>'manager_personnel_no', '') <> '' then
      -- Resolves against existing employees AND rows created earlier in this
      -- same call (they are already in profiles inside this transaction).
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = v_row->>'manager_personnel_no';
      if v_mgr is null then
        raise exception 'row %: manager with personnel number % not found (list managers before their team)',
          v_i, v_row->>'manager_personnel_no' using errcode = '22023';
      end if;
    end if;

    v_uid := private.create_employee_impl(
      v_caller, 'bulk', p_company_id, v_dept, v_mgr,
      v_row->>'personnel_no', v_row->>'full_name', v_row->>'password',
      (case when v_role = 'manager' then array['manager','employee'] else array['employee'] end)::public.app_role[],
      nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title');

    v_annual := coalesce(nullif(v_row->>'annual_days', ''), '0')::numeric;
    v_sick   := coalesce(nullif(v_row->>'sick_days',   ''), '0')::numeric;
    if v_annual > 0 then
      if v_annual_type is null then
        raise exception 'row %: leave type "Annual Leave" not found', v_i using errcode = '22023';
      end if;
      perform private.allocate_leave_impl(v_caller, v_uid, v_annual_type, v_ystart, v_yend,
        round(v_annual * private.company_minutes_per_day(p_company_id))::int);
    end if;
    if v_sick > 0 then
      if v_sick_type is null then
        raise exception 'row %: leave type "Sick Leave" not found', v_i using errcode = '22023';
      end if;
      perform private.allocate_leave_impl(v_caller, v_uid, v_sick_type, v_ystart, v_yend,
        round(v_sick * private.company_minutes_per_day(p_company_id))::int);
    end if;

    select employee_code into v_code from public.profiles where id = v_uid;
    v_result := v_result || jsonb_build_object(
      'personnel_no', v_row->>'personnel_no', 'employee_code', v_code, 'user_id', v_uid);
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_caller, 'bulk_create_employees', 'profiles', null,
          jsonb_build_object('count', jsonb_array_length(p_rows)));

  return v_result;
end; $function$;

revoke execute on function public.app_bulk_create_employees(uuid, jsonb) from public, anon;
grant  execute on function public.app_bulk_create_employees(uuid, jsonb) to authenticated;
