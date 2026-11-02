-- Admin-entered personnel numbers may be any text (owner, 2026-11-02).
--
-- Security staff are a subcontractor: no company personnel number. Only the admin may give
-- someone a personnel number that is not 1–10 digits — any text, 1–64 characters after trimming.
-- HR, bulk import and the personal-info CSV keep the 1–10-digit rule (private.valid_personnel_no
-- with p_admin = false).
--
-- 1. profiles_personnel_no_format: 1–64 characters, no leading or trailing whitespace.
-- 2. create_employee_impl: the admin path accepts any such number; the auth email is lower-cased
--    (as private.set_login_code does) and the employee-code check is case-insensitive.
-- 3. app_create_employee: when the number cannot be a login code (spaces, @, non-ASCII) the admin
--    must enter a login code ('login code required').
-- 4. app_admin_set_personnel_no: accepts any such number; the login code follows it only when the
--    number is a valid login code.
-- Otherwise the three functions are copied unchanged from supabase/schema.sql.

create function private.valid_personnel_no(p_pno text, p_admin boolean) returns boolean
    language sql immutable
    set search_path to ''
    as $$
  select p_pno is not null
     and case when p_admin
              then char_length(p_pno) between 1 and 64 and p_pno = btrim(p_pno)
              else p_pno ~ '^[0-9]{1,10}$'
         end;
$$;

revoke all on function private.valid_personnel_no(text, boolean) from public;

alter table public.profiles drop constraint profiles_personnel_no_format;
alter table public.profiles add constraint profiles_personnel_no_format
  check (personnel_no is null or (char_length(personnel_no) between 1 and 64 and personnel_no = btrim(personnel_no)));

CREATE OR REPLACE FUNCTION private.create_employee_impl(p_actor uuid, p_path text, p_company_id uuid, p_department_id uuid, p_manager_id uuid, p_personnel_no text, p_full_name text, p_password text, p_roles public.app_role[], p_hire_date date, p_language_pref text, p_calendar_pref text, p_job_title text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid       uuid := gen_random_uuid();
  v_pno       text := btrim(coalesce(p_personnel_no, ''));
  v_dept_code text;
  v_code      text;
  v_email     text;
  v_role      public.app_role;
begin
  if not private.valid_personnel_no(v_pno, p_path = 'admin') then
    if p_path = 'admin' then
      raise exception 'invalid personnel number (1-64 characters)' using errcode = '22023';
    end if;
    raise exception 'invalid personnel number (1-10 digits)' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'full name is required' using errcode = '22023';
  end if;
  if p_department_id is null then
    raise exception 'department is required' using errcode = '22023';
  end if;

  -- The department no longer feeds the code, but it must still exist and
  -- belong to this company: it scopes the team and defaults the manager.
  select code into v_dept_code
    from public.departments
   where id = p_department_id and company_id = p_company_id;
  if v_dept_code is null then
    raise exception 'department not found' using errcode = '22023';
  end if;

  v_code := v_pno;
  if exists (select 1 from public.profiles where company_id = p_company_id and personnel_no = v_pno) then
    raise exception 'personnel number already exists' using errcode = '23505';
  end if;
  -- employee_code uniqueness is GLOBAL, not per company. With bare numbers a
  -- second tenant's 1042 would collide; see the spec §6 for the multi-tenant
  -- cost this knowingly takes on.
  if exists (select 1 from public.profiles where lower(employee_code) = lower(v_code)) then
    raise exception 'employee code already exists' using errcode = '23505';
  end if;

  -- Lower-cased like private.set_login_code: an admin's personnel number may hold letters.
  v_email := lower(v_code) || '@bj-app.internal';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id,
                               hire_date, language_pref, calendar_pref, personnel_no, job_title)
  values (v_uid, p_company_id, v_code, btrim(p_full_name), p_department_id, p_manager_id,
          p_hire_date, coalesce(p_language_pref, 'fa'), coalesce(p_calendar_pref, 'jalali'),
          v_pno, nullif(btrim(coalesce(p_job_title, '')), ''));

  foreach v_role in array p_roles loop
    insert into public.user_roles (user_id, role) values (v_uid, v_role) on conflict do nothing;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'create_employee', 'profiles', v_uid,
          jsonb_build_object('employee_code', v_code, 'personnel_no', v_pno,
                             'full_name', p_full_name, 'roles', to_jsonb(p_roles), 'path', p_path));

  return v_uid;
end; $_$;

CREATE OR REPLACE FUNCTION public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles public.app_role[] DEFAULT ARRAY['employee'::public.app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text, p_role_ids uuid[] DEFAULT NULL::uuid[], p_login_code text DEFAULT NULL::text) RETURNS uuid
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

  -- The login code defaults to the personnel number, so a number that cannot be one
  -- (spaces, @, Persian letters; admin only) needs an explicit code.
  if v_admin and nullif(btrim(coalesce(p_login_code, '')), '') is null
     and not private.valid_login_code(btrim(coalesce(p_personnel_no, ''))) then
    raise exception 'login code required' using errcode = '22023';
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

CREATE OR REPLACE FUNCTION public.app_admin_set_personnel_no(p_user uuid, p_personnel_no text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_caller  uuid := auth.uid();
  v_pno     text := btrim(coalesce(p_personnel_no, ''));
  v_company uuid;
  v_old     text;
begin
  if v_caller is null or not private.is_admin(v_caller) then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if not private.valid_personnel_no(v_pno, true) then
    raise exception 'invalid personnel number (1-64 characters)' using errcode = '22023';
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
  -- The login code follows the number (owner, 2026-11-02) when the number can be one;
  -- a number with spaces, @ or Persian letters leaves the login code as it is.
  if private.valid_login_code(v_pno) then
    perform private.set_login_code(v_caller, p_user, v_pno);
  end if;
end; $_$;
