-- =============================================================================
-- Migration: 20260818150001_hr_creates_employees.sql
-- Purpose  : Let the `hr` role onboard employees — any department, any reporting
--            line, but ONLY ever as an ordinary employee.
-- Requirement: FR-35 (spec decision D4)
-- Spec     : docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md
-- Depends  : 20260818130001_hr_role_enum.sql
--
-- Two functions gain an HR path. In both, the role list is OVERWRITTEN in the
-- database rather than validated, so it does not matter what the client sends:
-- an HR account cannot create a manager, another HR, a security user, or an
-- admin. Granting authority stays with admins alone.
--
--   app_create_employee        — hr branch placed BEFORE the manager branch, so
--                                someone holding both roles gets the wider HR
--                                scope (any department) rather than being pinned
--                                to their own team.
--   app_bulk_create_employees  — was admin-only. HR is exactly who does bulk
--                                onboarding, so it now admits hr and clamps every
--                                row's `role` column to 'employee'. The CSV is
--                                user-supplied, so clamping beats validating.
--
-- Both bodies were produced by patching `pg_get_functiondef` output rather than
-- retyping them, per docs/MEMORY.md — these are security-critical functions and
-- a transcription slip in an untouched branch would be invisible in review.
--
-- Audit trail distinguishes the paths: `create_employee_impl` records the path
-- label, now 'hr' / 'bulk_hr' alongside the existing 'admin' / 'manager' / 'bulk'.
--
-- Idempotent: create or replace. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles app_role[] DEFAULT ARRAY['employee'::app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_admin  boolean;
  v_hr     boolean;
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
  v_hr := private.has_role(v_caller, 'hr');

  if v_admin then
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := p_roles;
    v_company := p_company_id;
  elsif v_hr then
    -- FR-35 / spec D4. HR onboards into ANY department and sets the reporting
    -- line, which is what makes them useful. But the role list is overwritten
    -- here regardless of what the client sent, so an HR account can never mint a
    -- manager, another HR, security, or an admin. Checked before the manager
    -- branch so someone holding both roles gets the wider HR scope.
    --
    -- The company comes from the caller's own profile rather than the argument,
    -- matching the manager branch: only an admin may name the company.
    select company_id into v_company from public.profiles where id = v_caller;
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := array['employee']::public.app_role[];
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
    v_caller, case when v_admin then 'admin' when v_hr then 'hr' else 'manager' end,
    v_company, v_dept, v_mgr, p_personnel_no, p_full_name, p_password,
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title);

  -- Manager and HR paths: default quotas immediately, no admin round-trip.
  -- (`not v_admin` is both of them.)
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
  v_bulk_hr boolean;
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
  v_bulk_hr := private.has_role(v_caller, 'hr') and not private.is_admin(v_caller);
  if not (private.is_admin(v_caller) or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
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
    -- FR-35 / spec D4: HR may bulk-onboard, but only ordinary employees. The
    -- CSV carries a role column, so it is clamped HERE rather than trusted —
    -- otherwise a spreadsheet could hand an HR account a manager.
    if v_bulk_hr then
      v_role := 'employee';
    end if;
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
      v_caller, case when v_bulk_hr then 'bulk_hr' else 'bulk' end, p_company_id, v_dept, v_mgr,
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
