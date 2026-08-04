-- =============================================================================
-- 20260713120001_employee_onboarding.sql — generated employee codes,
-- manager-scoped creation, bulk import.
--
-- Spec: docs/specs/2026-07-13-employee-onboarding-design.md
--
--  1) departments.code            latin prefix for generated login codes
--  2) profiles.personnel_no       client HR number (digits, unique/company)
--     profiles.job_title          display-only free text
--  3) private.allocate_leave_impl extracted from allocate_leave (no auth check)
--  4) private.create_employee_impl shared by single + bulk creation
--  5) app_create_employee v2      admin (free) OR manager (forced own dept/team,
--                                 employee role only, default quotas applied)
--  6) app_bulk_create_employees   admin-only, jsonb rows, all-or-nothing
--  7) app_cleanup_e2e_users       extended pattern for generated-style codes
--                                 (personnel numbers 999####### are test-reserved)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. departments.code
-- ---------------------------------------------------------------------------
alter table public.departments add column if not exists code text;

-- Known seed departments get their agreed codes.
update public.departments set code = c.v
from (values ('Production Line A','prod'),
             ('Quality Control','qc'),
             ('Maintenance','mant'),
             ('Security','sec')) as c(n,v)
where name_en = c.n and code is null;

-- Generic fallback for any other pre-existing department.
with slugged as (
  select id,
         coalesce(nullif(substring(lower(regexp_replace(name_en, '[^a-zA-Z0-9]', '', 'g')) from 1 for 4), ''), 'dept') as base
  from public.departments
  where code is null
),
numbered as (
  select id, base, row_number() over (partition by base order by id) as rn
  from slugged
)
update public.departments d
set code = case when n.rn = 1 then n.base
                else substring(n.base from 1 for 4) || n.rn::text end
from numbered n
where d.id = n.id;

alter table public.departments alter column code set not null;
alter table public.departments drop constraint if exists departments_code_format;
alter table public.departments add constraint departments_code_format
  check (code ~ '^[a-z0-9]{2,6}$');
create unique index if not exists departments_company_code_key
  on public.departments (company_id, code);

-- ---------------------------------------------------------------------------
-- 2. profiles: personnel_no + job_title
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists personnel_no text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles drop constraint if exists profiles_personnel_no_format;
alter table public.profiles add constraint profiles_personnel_no_format
  check (personnel_no is null or personnel_no ~ '^[0-9]{1,10}$');
create unique index if not exists profiles_company_personnel_no_key
  on public.profiles (company_id, personnel_no) where personnel_no is not null;

-- ---------------------------------------------------------------------------
-- 3. private.allocate_leave_impl — lock + allocation + ledger + audit.
--    No auth check: callers are SECURITY DEFINER functions that have already
--    authorized the actor. public.allocate_leave keeps the admin guard.
-- ---------------------------------------------------------------------------
create or replace function private.allocate_leave_impl(
  p_actor uuid, p_employee_id uuid, p_leave_type_id uuid,
  p_period_start date, p_period_end date, p_days numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev numeric; v_alloc uuid;
begin
  if p_days is null or p_days <= 0 then
    raise exception 'allocation days must be greater than 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  insert into public.leave_allocations(employee_id, leave_type_id, period_start, period_end, allocated_days, created_by)
  values (p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_days, p_actor)
  returning id into v_alloc;

  v_prev := public.current_leave_balance(p_employee_id, p_leave_type_id);
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_days, balance_after, note)
  values (p_employee_id, p_leave_type_id, 'allocation', p_days, v_prev + p_days, 'allocation');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (p_actor, 'allocate_leave', 'leave_allocations', v_alloc,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id, 'days', p_days));
  return v_alloc;
end; $$;

revoke all on function private.allocate_leave_impl(uuid, uuid, uuid, date, date, numeric) from public, anon, authenticated;

create or replace function public.allocate_leave(
  p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_days numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can allocate leave' using errcode = '42501';
  end if;
  return private.allocate_leave_impl(auth.uid(), p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_days);
end; $$;

-- ---------------------------------------------------------------------------
-- 4. private.create_employee_impl — the one place accounts are made.
--    Composes employee_code = departments.code || '-' || personnel_no.
-- ---------------------------------------------------------------------------
create or replace function private.create_employee_impl(
  p_actor         uuid,
  p_path          text,
  p_company_id    uuid,
  p_department_id uuid,
  p_manager_id    uuid,
  p_personnel_no  text,
  p_full_name     text,
  p_password      text,
  p_roles         public.app_role[],
  p_hire_date     date,
  p_language_pref text,
  p_calendar_pref text,
  p_job_title     text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := gen_random_uuid();
  v_pno       text := btrim(coalesce(p_personnel_no, ''));
  v_dept_code text;
  v_code      text;
  v_email     text;
  v_role      public.app_role;
begin
  if v_pno !~ '^[0-9]{1,10}$' then
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

  select code into v_dept_code
    from public.departments
   where id = p_department_id and company_id = p_company_id;
  if v_dept_code is null then
    raise exception 'department not found' using errcode = '22023';
  end if;

  v_code := v_dept_code || '-' || v_pno;
  if exists (select 1 from public.profiles where company_id = p_company_id and personnel_no = v_pno) then
    raise exception 'personnel number already exists' using errcode = '23505';
  end if;
  if exists (select 1 from public.profiles where employee_code = v_code) then
    raise exception 'employee code already exists' using errcode = '23505';
  end if;

  v_email := v_code || '@bj-app.internal';

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
end; $$;

revoke all on function private.create_employee_impl(uuid, text, uuid, uuid, uuid, text, text, text, public.app_role[], date, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app_create_employee v2 — admin OR manager (scoped).
--    The old text-code signature is dropped so PostgREST sees exactly one.
-- ---------------------------------------------------------------------------
drop function if exists public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text);

create function public.app_create_employee(
  p_personnel_no  text,
  p_full_name     text,
  p_password      text,
  p_company_id    uuid,
  p_department_id uuid                 default null,
  p_manager_id    uuid                 default null,
  p_roles         public.app_role[]    default array['employee']::public.app_role[],
  p_hire_date     date                 default null,
  p_language_pref text                 default 'fa',
  p_calendar_pref text                 default 'jalali',
  p_job_title     text                 default null
) returns uuid language plpgsql security definer set search_path = '' as $$
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
        lt.default_annual_quota_days);
    end loop;
  end if;

  return v_uid;
end; $$;

revoke execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text) from public, anon;
grant  execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app_bulk_create_employees — admin-only CSV import. One transaction:
--    the first bad row aborts everything (a half-imported org is worse
--    than a clean retry).
--    p_rows: [{personnel_no, full_name, password, department_code,
--              manager_personnel_no?, role, job_title?, hire_date?,
--              annual_days?, sick_days?}, ...]  (hire_date ISO yyyy-mm-dd)
-- ---------------------------------------------------------------------------
create or replace function public.app_bulk_create_employees(
  p_company_id uuid,
  p_rows       jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
      perform private.allocate_leave_impl(v_caller, v_uid, v_annual_type, v_ystart, v_yend, v_annual);
    end if;
    if v_sick > 0 then
      if v_sick_type is null then
        raise exception 'row %: leave type "Sick Leave" not found', v_i using errcode = '22023';
      end if;
      perform private.allocate_leave_impl(v_caller, v_uid, v_sick_type, v_ystart, v_yend, v_sick);
    end if;

    select employee_code into v_code from public.profiles where id = v_uid;
    v_result := v_result || jsonb_build_object(
      'personnel_no', v_row->>'personnel_no', 'employee_code', v_code, 'user_id', v_uid);
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_caller, 'bulk_create_employees', 'profiles', null,
          jsonb_build_object('count', jsonb_array_length(p_rows)));

  return v_result;
end; $$;

revoke execute on function public.app_bulk_create_employees(uuid, jsonb) from public, anon;
grant  execute on function public.app_bulk_create_employees(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. e2e cleanup — add the generated-code pattern. Personnel numbers starting
--    999 (10 digits total) are reserved for tests; real HR numbers that long
--    would still need the 999 prefix to match.
-- ---------------------------------------------------------------------------
create or replace function public.app_cleanup_e2e_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_admin(v_uid) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  with junk as (
    select id from public.profiles
    where employee_code ~ '^(mgr|emp|cxl|auth|peer|lv|non|ov|e2e|set)[0-9]{13}$'
       or employee_code ~ '^(set|pwd)[0-9]{6}$'
       or employee_code ~ '^[a-z0-9]{2,6}-999[0-9]{7}$'
  ),
  del as (
    delete from auth.users u using junk j where u.id = j.id returning u.id
  )
  select count(*) into v_count from del;

  if v_count > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'cleanup_e2e_users', 'auth.users', null,
            jsonb_build_object('deleted', v_count));
  end if;

  return v_count;
end; $$;

revoke execute on function public.app_cleanup_e2e_users() from public, anon;
grant  execute on function public.app_cleanup_e2e_users() to authenticated;
