-- Admin login codes (owner, 2026-11-02; docs/plans/2026-11-02-manager-ux-batch.md §3).
--
-- 1. private.valid_login_code / private.set_login_code: the login code (profiles.employee_code,
--    and the auth email built from it) may be any text without spaces or @ — the characters an
--    email local part takes unquoted (RFC 5322 atext, dots not leading, trailing or doubled),
--    1–64 long. Unique case-insensitively, because the auth email is lower-cased.
-- 2. app_create_employee gains p_login_code (default null = the personnel number, as before).
--    Only the admin may pass one. The old signature is dropped; callers that omit the new
--    argument (the still-running old app) resolve to the new one.
-- 3. app_admin_set_personnel_no: the admin changes someone's personnel number, and their login
--    code becomes the new number (owner: used for testing).
-- Otherwise app_create_employee is copied unchanged from supabase/schema.sql.

create function private.valid_login_code(p_code text) returns boolean
    language sql immutable
    set search_path to ''
    as $re$
  select p_code is not null
     and char_length(p_code) between 1 and 64
     and p_code ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*$';
$re$;

revoke all on function private.valid_login_code(text) from public;
grant execute on function private.valid_login_code(text) to authenticated;

create function private.set_login_code(p_actor uuid, p_uid uuid, p_code text) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_code  text := btrim(coalesce(p_code, ''));
  v_email text;
  v_old   text;
begin
  if not private.valid_login_code(v_code) then
    raise exception 'invalid login code' using errcode = '22023';
  end if;
  v_email := lower(v_code) || '@bj-app.internal';
  select employee_code into v_old from public.profiles where id = p_uid;
  if v_old is null then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if v_old = v_code then
    return;
  end if;
  if exists (select 1 from public.profiles where lower(employee_code) = lower(v_code) and id <> p_uid)
     or exists (select 1 from auth.users where lower(email) = v_email and id <> p_uid) then
    raise exception 'employee code already exists' using errcode = '23505';
  end if;

  update public.profiles set employee_code = v_code where id = p_uid;
  update auth.users set email = v_email, updated_at = now() where id = p_uid;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_uid and provider = 'email';

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (p_actor, 'set_login_code', 'profiles', p_uid,
          jsonb_build_object('employee_code', v_old), jsonb_build_object('employee_code', v_code));
end; $$;

revoke all on function private.set_login_code(uuid, uuid, text) from public;

drop function public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid, p_manager_id uuid, p_roles public.app_role[], p_hire_date date, p_language_pref text, p_calendar_pref text, p_job_title text, p_role_ids uuid[]);

create function public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles public.app_role[] DEFAULT ARRAY['employee'::public.app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text, p_role_ids uuid[] DEFAULT NULL::uuid[], p_login_code text DEFAULT NULL::text) RETURNS uuid
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
  v_emp_role uuid;
  lt       record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_admin := private.is_admin(v_caller);
  v_hr := private.has_perm(v_caller, 'people_create', 'edit');

  -- D1: no path adds admin, whichever branch below runs.
  -- Owner, 2026-11-02: only the admin picks a login code other than the personnel number.
  if nullif(btrim(coalesce(p_login_code, '')), '') is not null and not v_admin then
    raise exception 'only the admin sets a login code' using errcode = '42501';
  end if;

  if 'admin' = any (coalesce(p_roles, '{}')) then
    raise exception 'admin is moved only by Transfer admin' using errcode = '42501';
  end if;

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
    -- line, which is what makes them useful. But the enum role list is overwritten
    -- here regardless of what the client sent; extra roles come only through
    -- p_role_ids, which D5 checks.
    --
    -- The company comes from the caller's own profile rather than the argument:
    -- only an admin may name the company.
    select company_id into v_company from public.profiles where id = v_caller;
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := array['employee']::public.app_role[];
  else
    raise exception 'admin or hr required' using errcode = '42501';
  end if;

  -- With role ids, the enum list is just Employee; the ids decide the rest below.
  if p_role_ids is not null then
    v_roles := array['employee']::public.app_role[];
  end if;

  v_uid := private.create_employee_impl(
    v_caller, case when v_admin then 'admin' else 'hr' end,
    v_company, v_dept, v_mgr, p_personnel_no, p_full_name, p_password,
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title);

  if nullif(btrim(coalesce(p_login_code, '')), '') is not null then
    perform private.set_login_code(v_caller, v_uid, p_login_code);
  end if;

  -- D5 for non-admins (and D1 for everyone) through the assignment RPC. Skipped
  -- when the ids add nothing beyond Employee.
  select id into v_emp_role from public.roles where company_id = v_company and system_key = 'employee';
  if p_role_ids is not null
     and exists (select 1 from unnest(p_role_ids) x where x is distinct from v_emp_role) then
    perform public.app_set_user_role_ids(v_uid, p_role_ids || v_emp_role);
  end if;

  -- HR path: default quotas immediately, no admin round-trip.
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

revoke all on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[], text) from public, anon;
grant execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[], text) to authenticated;
grant execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[], text) to service_role;

create function public.app_admin_set_personnel_no(p_user uuid, p_personnel_no text) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_caller  uuid := auth.uid();
  v_pno     text := btrim(coalesce(p_personnel_no, ''));
  v_company uuid;
  v_old     text;
begin
  if v_caller is null or not private.is_admin(v_caller) then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if v_pno !~ '^[0-9]{1,10}$' then
    raise exception 'invalid personnel number (1-10 digits)' using errcode = '22023';
  end if;
  select company_id, personnel_no into v_company, v_old
    from public.profiles where id = p_user for update;
  if v_company is null
     or v_company is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles
              where company_id = v_company and personnel_no = v_pno and id <> p_user) then
    raise exception 'personnel number already exists' using errcode = '23505';
  end if;

  if v_old is distinct from v_pno then
    update public.profiles set personnel_no = v_pno where id = p_user;
    insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
    values (v_caller, 'set_personnel_no', 'profiles', p_user,
            jsonb_build_object('personnel_no', v_old), jsonb_build_object('personnel_no', v_pno));
  end if;
  -- The login code follows the number (owner, 2026-11-02).
  perform private.set_login_code(v_caller, p_user, v_pno);
end; $$;

revoke all on function public.app_admin_set_personnel_no(uuid, text) from public, anon;
grant execute on function public.app_admin_set_personnel_no(uuid, text) to authenticated;
