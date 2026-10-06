-- =============================================================================
-- Migration: 20261006120002_create_employee_tenant_binding.sql
-- Purpose  : Bind app_create_employee's ADMIN branch to the caller's own company.
-- Depends  : 20261006120001_bulk_import_modes.sql (same check on the bulk functions)
--
-- Until now the admin branch used the caller-supplied p_company_id as-is, so an
-- admin of one company could create employees in another. The hr and manager
-- branches already ignore the argument and read the company from the caller's
-- profile. The admin branch now refuses any p_company_id other than the caller's
-- own (42501 'not allowed to create employees in another company', mapped to
-- dbErrors.notAllowed by the generic /not allowed to/ rule in lib/errors/db-error.ts).
-- The app (lib/actions/employees.ts) always passes the caller's company, so no
-- legitimate call changes behaviour.
--
-- Signature, defaults, grants and every other line of the body are unchanged
-- (copied from supabase/schema.sql). Idempotent: create or replace.
--
-- compute_requested_minutes(p_company_id, ...) is deliberately NOT bound: it is a
-- pure calculation helper granted only to postgres/service_role (not
-- authenticated/anon), so no client can call it with a foreign company; its only
-- caller (private.submit_leave_impl) passes the company it read from the caller's
-- profile.
-- =============================================================================

create or replace function public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles public.app_role[] DEFAULT ARRAY['employee'::public.app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    -- Tenant binding: an admin names the company, but only their own.
    if p_company_id is distinct from
       (select company_id from public.profiles where id = v_caller) then
      raise exception 'not allowed to create employees in another company'
        using errcode = '42501';
    end if;
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
end; $$;
