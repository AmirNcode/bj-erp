-- FR-83: first and last name are stored separately (spec docs/specs/2026-11-04-employee-name-fields-design.md).
--
-- 1. profiles.first_name / last_name, Persian collation so PostgREST sorts them correctly.
-- 2. Existing people: two words split; any other count keeps the whole name in first_name and leaves
--    last_name NULL. A NULL last_name is the only marker that a name still needs fixing. full_name
--    is not touched.
-- 3. profiles_sync_names keeps full_name = first + last. A write of full_name alone (the old app
--    during deploy) is split by the same rule.
-- 4. enforce_profile_update_scope covers the new columns and closes self-rename: only a people edit
--    holder or the admin may change their own name.
-- 5. public.personnel_sort_key: numeric sort key for the Employees ID column, a PostgREST computed
--    field. Not a stored generated column: those are NULL inside BEFORE triggers, which would break
--    the whole-row comparison enforce_profile_update_scope uses for the separation job.
-- 6. create_employee_impl and app_create_employee take the parts as trailing arguments; the app must
--    send both. p_full_name and full_name bulk rows stay for the old app during deploy (follow-up
--    in docs/TASKS.md removes them). No overload: positional calls would become ambiguous.
-- 7. app_export_personal_info returns the parts as well.
-- All other function text is copied unchanged from supabase/schema.sql.

alter table public.profiles
  add column first_name text collate "fa-IR-x-icu",
  add column last_name  text collate "fa-IR-x-icu";

create function private.split_full_name(p_name text, out first_name text, out last_name text)
    language sql immutable
    set search_path to ''
    as $$
  select case when cardinality(x.w) = 2 then x.w[1] else x.t end,
         case when cardinality(x.w) = 2 then x.w[2] end
    from (select a.t, regexp_split_to_array(a.t, '\s+') as w
            from (select regexp_replace(p_name, '^\s+|\s+$', '', 'g') as t) a) x;
$$;

revoke all on function private.split_full_name(text) from public, anon, authenticated;

-- The scope trigger refuses a write with no signed-in user, and this one must not depend on any.
alter table public.profiles disable trigger profiles_enforce_update_scope;

update public.profiles
   set first_name = (private.split_full_name(full_name)).first_name,
       last_name  = (private.split_full_name(full_name)).last_name;

alter table public.profiles enable trigger profiles_enforce_update_scope;

alter table public.profiles
  alter column first_name set not null,
  add constraint profiles_first_name_format check (first_name <> '' and first_name = btrim(first_name)),
  add constraint profiles_last_name_format check (last_name is null or (last_name <> '' and last_name = btrim(last_name)));

comment on column public.profiles.last_name is
  'NULL = not split yet (the name was not exactly two words) or a one-word name; first_name then holds the whole name.';

create function private.sync_profile_names() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_parts record;
begin
  new.first_name := nullif(regexp_replace(new.first_name, '^\s+|\s+$', '', 'g'), '');
  new.last_name  := nullif(regexp_replace(new.last_name, '^\s+|\s+$', '', 'g'), '');

  if tg_op = 'UPDATE'
     and new.first_name is not distinct from old.first_name
     and new.last_name  is not distinct from old.last_name then
    if new.full_name is not distinct from old.full_name then
      return new;
    end if;
    select * into v_parts from private.split_full_name(new.full_name);
    new.first_name := v_parts.first_name;
    new.last_name  := v_parts.last_name;
  elsif tg_op = 'INSERT' and new.first_name is null then
    select * into v_parts from private.split_full_name(new.full_name);
    new.first_name := v_parts.first_name;
    new.last_name  := v_parts.last_name;
  else
    new.full_name := concat_ws(' ', new.first_name, new.last_name);
  end if;
  return new;
end; $$;

revoke all on function private.sync_profile_names() from public, anon, authenticated;

-- Fires after profiles_enforce_update_scope (BEFORE triggers run in name order), so the scope check
-- sees what the caller actually sent.
create trigger profiles_sync_names before insert or update on public.profiles
  for each row execute function private.sync_profile_names();

create or replace function private.enforce_profile_update_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if coalesce(current_setting('bj.separation_apply', true), '') = 'on'
     and old.active and not new.active
     and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active')
  then
    return new;
  end if;

  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    -- FR-83: a name is no longer the person's own to change; only a people edit holder keeps it.
    v_allowed := array['language_pref', 'calendar_pref'];
    if private.has_perm(v_uid, 'people', 'edit') then
      v_allowed := v_allowed || array['full_name', 'first_name', 'last_name'];
    end if;
  elsif private.has_perm(v_uid, 'people', 'edit')
        -- FR-55 D4: same company, never an admin (even a deactivated one, so an
        -- editor cannot reactivate one), and nothing the editor does not hold.
        and private.can_act_on(v_uid, old.id)
  then
    v_allowed := array['full_name', 'first_name', 'last_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  else
    -- Password resets are the admin's alone (20261013200007).
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.personnel_no  is distinct from old.personnel_no)
     or (new.created_at    is distinct from old.created_at)
     or (new.must_change_password is distinct from old.must_change_password
         and coalesce(current_setting('bj.password_flag_write', true), '') <> 'on')
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.first_name    is distinct from old.first_name    and not ('first_name'    = any (v_allowed)))
     or (new.last_name     is distinct from old.last_name     and not ('last_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.department_id is distinct from old.department_id and not ('department_id' = any (v_allowed)))
     or (new.manager_id    is distinct from old.manager_id    and not ('manager_id'    = any (v_allowed)))
     or (new.job_title     is distinct from old.job_title     and not ('job_title'     = any (v_allowed)))
     or (new.active        is distinct from old.active        and not ('active'        = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;

create function public.personnel_sort_key(p public.profiles) returns numeric
    language sql immutable
    set search_path to ''
    as $$
  select case when x.d ~ '^[0-9]+$' then x.d::numeric end
    from (select translate(p.personnel_no, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') as d) x;
$$;

revoke all on function public.personnel_sort_key(public.profiles) from public, anon;
grant execute on function public.personnel_sort_key(public.profiles) to authenticated, service_role;

drop function private.create_employee_impl(uuid, text, uuid, uuid, uuid, text, text, text, public.app_role[], date, text, text, text);

create function private.create_employee_impl(p_actor uuid, p_path text, p_company_id uuid, p_department_id uuid, p_manager_id uuid, p_personnel_no text, p_full_name text, p_password text, p_roles public.app_role[], p_hire_date date, p_language_pref text, p_calendar_pref text, p_job_title text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid       uuid := gen_random_uuid();
  v_pno       text := btrim(coalesce(p_personnel_no, ''));
  v_dept_code text;
  v_code      text;
  v_email     text;
  v_role      public.app_role;
  v_first     text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last      text := nullif(btrim(coalesce(p_last_name, '')), '');
  -- FR-83: the parts decide; a caller that still sends only a full name is split by the trigger.
  v_full      text := coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), concat_ws(' ', v_first, v_last));
begin
  if not private.valid_personnel_no(v_pno, p_path = 'admin') then
    if p_path = 'admin' then
      raise exception 'invalid personnel number (1-64 characters)' using errcode = '22023';
    end if;
    raise exception 'invalid personnel number (1-10 digits)' using errcode = '22023';
  end if;
  perform private.assert_password_ok(p_password);  -- FR-80
  if coalesce(v_full, '') = '' then
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

  insert into public.profiles (id, company_id, employee_code, full_name, first_name, last_name,
                               department_id, manager_id, hire_date, language_pref, calendar_pref, personnel_no, job_title)
  values (v_uid, p_company_id, v_code, v_full, v_first, v_last, p_department_id, p_manager_id,
          p_hire_date, coalesce(p_language_pref, 'fa'), coalesce(p_calendar_pref, 'jalali'),
          v_pno, nullif(btrim(coalesce(p_job_title, '')), ''));

  foreach v_role in array p_roles loop
    insert into public.user_roles (user_id, role) values (v_uid, v_role) on conflict do nothing;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'create_employee', 'profiles', v_uid,
          jsonb_build_object('employee_code', v_code, 'personnel_no', v_pno,
                             'full_name', v_full, 'roles', to_jsonb(p_roles), 'path', p_path));

  return v_uid;
end; $$;

revoke all on function private.create_employee_impl(uuid, text, uuid, uuid, uuid, text, text, text, public.app_role[], date, text, text, text, text, text) from public;

drop function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[], text);

create function public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles public.app_role[] DEFAULT ARRAY['employee'::public.app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text, p_role_ids uuid[] DEFAULT NULL::uuid[], p_login_code text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text) RETURNS uuid
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

  -- FR-83: the app sends the parts, and a new person always has both. The old app sends only
  -- p_full_name during deploy.
  if (p_first_name is not null or p_last_name is not null)
     and (coalesce(btrim(p_first_name), '') = '' or coalesce(btrim(p_last_name), '') = '') then
    raise exception 'first and last name are required' using errcode = '22023';
  end if;

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
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title, p_first_name, p_last_name);

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

revoke all on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[], text, text, text) from public, anon;
grant execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[], text, text, text) to authenticated, service_role;

create or replace function public.app_bulk_create_employees(p_company_id uuid, p_rows jsonb, p_departments jsonb, p_balance_as_of date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_caller        uuid := auth.uid();
  v_bulk_hr       boolean;
  v_today         date := (now() at time zone 'Asia/Tehran')::date;
  v_dep           jsonb;
  v_row           jsonb;
  v_i             integer := 0;
  v_dept          uuid;
  v_mgr_pno       text;
  v_mgr           uuid;
  v_role          text;
  v_uid           uuid;
  v_code          text;
  v_minutes       int;
  v_prev          int;
  v_ledger        uuid;
  v_annual_type   uuid;
  v_rate          int;
  v_cap           int;
  v_carry         int;
  v_accrual_start date;
  v_dm            uuid;
  v_result        jsonb := '[]'::jsonb;
begin
  -- FR-55: the non-admin branch keys on people_create; its clamps are unchanged.
  v_bulk_hr := private.has_perm(v_caller, 'people_create', 'edit') and not private.is_admin(v_caller);
  if not (private.is_admin(v_caller) or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;
  -- Tenant binding: the company comes from the request, so it must be the
  -- caller's own. Without this an admin of one company could import into another.
  if p_company_id is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'not allowed to import into another company' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if p_departments is null or jsonb_typeof(p_departments) <> 'array' then
    raise exception 'departments must be an array' using errcode = '22023';
  end if;
  if p_balance_as_of is null then
    raise exception 'balance date is required' using errcode = '22023';
  end if;
  if p_balance_as_of > v_today then
    raise exception 'balance date cannot be in the future' using errcode = '22023';
  end if;

  -- First Jalali month after the one containing the balance date. Raises
  -- through the join if the date is outside the seeded calendar.
  select n.gregorian_start into v_accrual_start
    from public.jalali_months m
    join public.jalali_months n on n.gregorian_start = m.gregorian_end + 1
   where p_balance_as_of between m.gregorian_start and m.gregorian_end;
  if v_accrual_start is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  select id, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes
    into v_annual_type, v_rate, v_cap, v_carry
    from public.leave_types
   where company_id = p_company_id and name_en = 'Annual Leave' and affects_balance;

  -- 1. Departments.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    v_code := upper(btrim(coalesce(v_dep->>'code', '')));
    if v_code !~ '^[A-Z0-9]{2,4}$' then
      raise exception 'invalid department code "%"', v_code using errcode = '22023';
    end if;
    if coalesce((v_dep->>'create')::boolean, false) then
      if v_bulk_hr then
        raise exception 'only admins can create departments' using errcode = '42501';
      end if;
      if exists (select 1 from public.departments where company_id = p_company_id and code = v_code) then
        raise exception 'department code "%" already exists', v_code using errcode = '23505';
      end if;
      if coalesce(btrim(v_dep->>'name_fa'), '') = '' or coalesce(btrim(v_dep->>'name_en'), '') = '' then
        raise exception 'department "%" needs a Farsi and an English name', v_code using errcode = '22023';
      end if;
      insert into public.departments (company_id, name_fa, name_en, kind, code)
      values (p_company_id, btrim(v_dep->>'name_fa'), btrim(v_dep->>'name_en'), 'team', v_code);
    end if;
  end loop;

  -- 2–4. Employees, opening balances, accrual policies.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;

    -- FR-83: rows from the new template need both names. The old app still sends full_name.
    if v_row ? 'first_name'
       and (coalesce(btrim(v_row->>'first_name'), '') = '' or coalesce(btrim(v_row->>'last_name'), '') = '') then
      raise exception 'row %: first and last name are required', v_i using errcode = '22023';
    end if;

    v_role := coalesce(v_row->>'role', 'employee');
    -- FR-35 / spec D4: HR may bulk-onboard, but only ordinary employees.
    if v_bulk_hr then
      v_role := 'employee';
    end if;
    if v_role not in ('manager', 'employee') then
      raise exception 'row %: role must be manager or employee', v_i using errcode = '22023';
    end if;

    select id into v_dept from public.departments
     where company_id = p_company_id and code = upper(btrim(coalesce(v_row->>'department_code', '')));
    if v_dept is null then
      raise exception 'row %: unknown department code "%"', v_i, v_row->>'department_code' using errcode = '22023';
    end if;

    v_mgr := null;
    v_mgr_pno := coalesce(nullif(btrim(coalesce(v_row->>'supervisor_personnel_no', '')), ''),
                          nullif(btrim(coalesce(v_row->>'manager_personnel_no', '')), ''));
    if v_mgr_pno is not null then
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = v_mgr_pno;
      if v_mgr is null then
        raise exception 'row %: manager with personnel number % not found (list managers before their team)',
          v_i, v_mgr_pno using errcode = '22023';
      end if;
    end if;

    v_uid := private.create_employee_impl(
      v_caller, case when v_bulk_hr then 'bulk_hr' else 'bulk' end, p_company_id, v_dept, v_mgr,
      v_row->>'personnel_no', v_row->>'full_name', v_row->>'password',
      (case when v_role = 'manager' then array['manager','employee'] else array['employee'] end)::public.app_role[],
      nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title',
      v_row->>'first_name', v_row->>'last_name');

    v_minutes := coalesce(nullif(v_row->>'balance_minutes', ''), '0')::int;
    -- FR-55: an opening balance is leave_balances edit, as on the Add Employee form.
    if v_bulk_hr and v_minutes <> 0 and not private.has_perm(v_caller, 'leave_balances', 'edit') then
      raise exception 'not allowed to set opening balances' using errcode = '42501';
    end if;
    if v_minutes < -366 * private.company_minutes_per_day(p_company_id)
       or v_minutes > 366 * private.company_minutes_per_day(p_company_id) then
      raise exception 'row %: opening balance is out of range', v_i using errcode = '22023';
    end if;
    if v_minutes <> 0 then
      if v_annual_type is null then
        raise exception 'row %: leave type "Annual Leave" not found', v_i using errcode = '22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));
      v_prev := public.current_leave_balance(v_uid, v_annual_type);
      insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
      values (v_uid, v_annual_type, 'adjustment', v_minutes, v_prev + v_minutes,
              'opening balance as of ' || p_balance_as_of::text)
      returning id into v_ledger;
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'opening_balance', 'leave_ledger', v_ledger,
              jsonb_build_object('employee_id', v_uid, 'leave_type_id', v_annual_type,
                                 'minutes', v_minutes, 'as_of', p_balance_as_of));
    end if;

    if v_annual_type is not null and coalesce(v_rate, 0) > 0 then
      insert into public.employee_leave_policies (
        employee_id, leave_type_id, accrual_minutes_per_month,
        annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
      ) values (
        v_uid, v_annual_type, v_rate, v_cap, coalesce(v_carry, 4320), v_accrual_start, v_caller
      )
      on conflict (employee_id, leave_type_id) do nothing;
    end if;

    select employee_code into v_code from public.profiles where id = v_uid;
    v_result := v_result || jsonb_build_object(
      'personnel_no', v_row->>'personnel_no', 'employee_code', v_code, 'user_id', v_uid);
  end loop;

  -- 5. Department managers — only where the department has none yet.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    if coalesce(btrim(v_dep->>'manager_personnel_no'), '') = '' then
      continue;
    end if;
    if v_bulk_hr then
      raise exception 'only admins can assign department managers' using errcode = '42501';
    end if;
    select id into v_dm from public.profiles
     where company_id = p_company_id and personnel_no = btrim(v_dep->>'manager_personnel_no');
    if v_dm is null then
      raise exception 'department manager with personnel number % not found',
        v_dep->>'manager_personnel_no' using errcode = '22023';
    end if;
    update public.departments
       set manager_id = v_dm
     where company_id = p_company_id
       and code = upper(btrim(v_dep->>'code'))
       and manager_id is null;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_caller, 'bulk_create_employees', 'profiles', null,
          jsonb_build_object('count', jsonb_array_length(p_rows),
                             'departments_created',
                             (select count(*) from jsonb_array_elements(p_departments) d
                               where coalesce((d->>'create')::boolean, false)),
                             'balance_as_of', p_balance_as_of));

  return v_result;
end;
$_$;

create or replace function public.app_bulk_import_employees(p_company_id uuid, p_mode text, p_rows jsonb, p_departments jsonb, p_balance_as_of date, p_overwrite_balances boolean, p_deactivate uuid[], p_reassign jsonb, p_delete_departments text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_caller        uuid := auth.uid();
  v_is_admin      boolean;
  v_bulk_hr       boolean;
  v_today         date := (now() at time zone 'Asia/Tehran')::date;
  v_dep           jsonb;
  v_row           jsonb;
  v_i             integer := 0;
  v_dept          uuid;
  v_mgr_pno       text;
  v_mgr           uuid;
  v_role          text;
  v_uid           uuid;
  v_existing      uuid;
  v_code          text;
  v_minutes       int;
  v_prev          int;
  v_ledger        uuid;
  v_annual_type   uuid;
  v_rate          int;
  v_cap           int;
  v_carry         int;
  v_accrual_start date;
  v_dm            uuid;
  v_id            uuid;
  v_created       jsonb := '[]'::jsonb;
  v_updated       int := 0;
  v_deactivated   int := 0;
  v_deleted       text[] := '{}';
  v_not_deleted   text[] := '{}';
  v_mpd           int;
begin
  v_is_admin := private.is_admin(v_caller);
  -- FR-55: the non-admin branch keys on people_create; its clamps are unchanged.
  v_bulk_hr  := private.has_perm(v_caller, 'people_create', 'edit') and not v_is_admin;
  if not (v_is_admin or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;
  -- Tenant binding: the company comes from the request, so it must be the
  -- caller's own. Without this an admin of one company could import into another.
  if p_company_id is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'not allowed to import into another company' using errcode = '42501';
  end if;
  -- Acquire this before any profile row or employee leave lock. The profile
  -- trigger intentionally skips updates that do not change approval authority.
  perform private.approval_lock(p_company_id);
  v_is_admin := private.is_admin(v_caller);
  v_bulk_hr := private.has_perm(v_caller, 'people_create', 'edit') and not v_is_admin;
  if not (v_is_admin or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;
  if p_company_id is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'not allowed to import into another company' using errcode = '42501';
  end if;
  v_today := (clock_timestamp() at time zone 'Asia/Tehran')::date;

  if p_mode is null or p_mode not in ('add', 'update', 'replace') then
    raise exception 'import mode must be add, update or replace' using errcode = '22023';
  end if;
  if p_mode <> 'add' and not v_is_admin then
    raise exception 'only admins can update or replace employees by import' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if p_departments is null or jsonb_typeof(p_departments) <> 'array' then
    raise exception 'departments must be an array' using errcode = '22023';
  end if;
  if p_mode <> 'replace' and (coalesce(cardinality(p_deactivate), 0) > 0
       or coalesce(cardinality(p_delete_departments), 0) > 0
       or coalesce(jsonb_array_length(p_reassign), 0) > 0) then
    raise exception 'deactivation and department deletion need replace mode' using errcode = '22023';
  end if;
  if p_balance_as_of is null then
    raise exception 'balance date is required' using errcode = '22023';
  end if;
  if p_balance_as_of > v_today then
    raise exception 'balance date cannot be in the future' using errcode = '22023';
  end if;

  select n.gregorian_start into v_accrual_start
    from public.jalali_months m
    join public.jalali_months n on n.gregorian_start = m.gregorian_end + 1
   where p_balance_as_of between m.gregorian_start and m.gregorian_end;
  if v_accrual_start is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  select id, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes
    into v_annual_type, v_rate, v_cap, v_carry
    from public.leave_types
   where company_id = p_company_id and name_en = 'Annual Leave' and affects_balance;
  v_mpd := private.company_minutes_per_day(p_company_id);

  -- 1. Departments: create, or (update/replace) take the file's names.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    v_code := upper(btrim(coalesce(v_dep->>'code', '')));
    if v_code !~ '^[A-Z0-9]{2,4}$' then
      raise exception 'invalid department code "%"', v_code using errcode = '22023';
    end if;
    if coalesce((v_dep->>'create')::boolean, false) then
      if v_bulk_hr then
        raise exception 'only admins can create departments' using errcode = '42501';
      end if;
      if exists (select 1 from public.departments where company_id = p_company_id and code = v_code) then
        raise exception 'department code "%" already exists', v_code using errcode = '23505';
      end if;
      if coalesce(btrim(v_dep->>'name_fa'), '') = '' or coalesce(btrim(v_dep->>'name_en'), '') = '' then
        raise exception 'department "%" needs a Farsi and an English name', v_code using errcode = '22023';
      end if;
      insert into public.departments (company_id, name_fa, name_en, kind, code)
      values (p_company_id, btrim(v_dep->>'name_fa'), btrim(v_dep->>'name_en'), 'team', v_code);
    elsif p_mode <> 'add' and coalesce((v_dep->>'rename')::boolean, false) then
      update public.departments
         set name_fa = btrim(v_dep->>'name_fa'), name_en = btrim(v_dep->>'name_en')
       where company_id = p_company_id and code = v_code
         and coalesce(btrim(v_dep->>'name_fa'), '') <> '' and coalesce(btrim(v_dep->>'name_en'), '') <> '';
    end if;
  end loop;

  -- 2. Employees: create or update.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;

    -- FR-83: rows from the new template need both names. The old app still sends full_name.
    if v_row ? 'first_name'
       and (coalesce(btrim(v_row->>'first_name'), '') = '' or coalesce(btrim(v_row->>'last_name'), '') = '') then
      raise exception 'row %: first and last name are required', v_i using errcode = '22023';
    end if;

    v_role := coalesce(v_row->>'role', 'employee');
    if v_bulk_hr then
      v_role := 'employee';
    end if;
    if v_role not in ('manager', 'employee') then
      raise exception 'row %: role must be manager or employee', v_i using errcode = '22023';
    end if;

    select id into v_dept from public.departments
     where company_id = p_company_id and code = upper(btrim(coalesce(v_row->>'department_code', '')));
    if v_dept is null then
      raise exception 'row %: unknown department code "%"', v_i, v_row->>'department_code' using errcode = '22023';
    end if;

    v_mgr := null;
    v_mgr_pno := coalesce(nullif(btrim(coalesce(v_row->>'supervisor_personnel_no', '')), ''),
                          nullif(btrim(coalesce(v_row->>'manager_personnel_no', '')), ''));
    if v_mgr_pno is not null then
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = v_mgr_pno;
      if v_mgr is null then
        raise exception 'row %: manager with personnel number % not found (list managers before their team)',
          v_i, v_mgr_pno using errcode = '22023';
      end if;
    end if;

    v_minutes := coalesce(nullif(v_row->>'balance_minutes', ''), '0')::int;
    -- FR-55: an opening balance is leave_balances edit, as on the Add Employee form
    -- (a non-admin reaches only add mode).
    if v_bulk_hr and v_minutes <> 0 and not private.has_perm(v_caller, 'leave_balances', 'edit') then
      raise exception 'not allowed to set opening balances' using errcode = '42501';
    end if;
    if v_minutes < -366 * v_mpd or v_minutes > 366 * v_mpd then
      raise exception 'row %: opening balance is out of range', v_i using errcode = '22023';
    end if;

    select id into v_existing from public.profiles
     where company_id = p_company_id and personnel_no = btrim(coalesce(v_row->>'personnel_no', ''));

    if v_existing is not null then
      if p_mode = 'add' then
        raise exception 'personnel number already exists' using errcode = '23505';
      end if;
      v_uid := v_existing;

      update public.profiles
         set full_name     = case when v_row ? 'first_name' then full_name else btrim(v_row->>'full_name') end,
             first_name    = case when v_row ? 'first_name' then btrim(v_row->>'first_name') else first_name end,
             last_name     = case when v_row ? 'first_name' then btrim(v_row->>'last_name') else last_name end,
             job_title     = nullif(btrim(coalesce(v_row->>'job_title', '')), ''),
             department_id = v_dept,
             manager_id    = v_mgr,
             hire_date     = coalesce(nullif(v_row->>'hire_date', '')::date, hire_date),
             active        = true
       where id = v_uid;

      -- Only the manager role follows the file; admin/hr/security are untouched.
      if v_role = 'manager' then
        insert into public.user_roles (user_id, role) values (v_uid, 'manager') on conflict do nothing;
      else
        delete from public.user_roles where user_id = v_uid and role = 'manager';
      end if;

      if coalesce(p_overwrite_balances, false) and v_annual_type is not null then
        perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));
        v_prev := public.current_leave_balance(v_uid, v_annual_type);
        if v_prev <> v_minutes then
          insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
          values (v_uid, v_annual_type, 'adjustment', v_minutes - v_prev, v_minutes,
                  'opening balance as of ' || p_balance_as_of::text)
          returning id into v_ledger;
          insert into public.audit_log (actor_id, action, entity, entity_id, after)
          values (v_caller, 'opening_balance', 'leave_ledger', v_ledger,
                  jsonb_build_object('employee_id', v_uid, 'previous_minutes', v_prev,
                                     'minutes', v_minutes, 'as_of', p_balance_as_of));
        end if;
        if coalesce(v_rate, 0) > 0 then
          insert into public.employee_leave_policies (
            employee_id, leave_type_id, accrual_minutes_per_month,
            annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
          ) values (v_uid, v_annual_type, v_rate, v_cap, coalesce(v_carry, 4320), v_accrual_start, v_caller)
          on conflict (employee_id, leave_type_id) do update
             set accrual_start_month = excluded.accrual_start_month;
        end if;
      end if;

      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'bulk_update_employee', 'profiles', v_uid,
              jsonb_build_object('personnel_no', v_row->>'personnel_no', 'mode', p_mode,
                                 'department_code', v_row->>'department_code', 'role', v_role));
      v_updated := v_updated + 1;
    else
      v_uid := private.create_employee_impl(
        v_caller, case when v_bulk_hr then 'bulk_hr' else 'bulk' end, p_company_id, v_dept, v_mgr,
        v_row->>'personnel_no', v_row->>'full_name', v_row->>'password',
        (case when v_role = 'manager' then array['manager','employee'] else array['employee'] end)::public.app_role[],
        nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title',
      v_row->>'first_name', v_row->>'last_name');

      if v_minutes <> 0 then
        if v_annual_type is null then
          raise exception 'row %: leave type "Annual Leave" not found', v_i using errcode = '22023';
        end if;
        perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));
        v_prev := public.current_leave_balance(v_uid, v_annual_type);
        insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
        values (v_uid, v_annual_type, 'adjustment', v_minutes, v_prev + v_minutes,
                'opening balance as of ' || p_balance_as_of::text)
        returning id into v_ledger;
        insert into public.audit_log (actor_id, action, entity, entity_id, after)
        values (v_caller, 'opening_balance', 'leave_ledger', v_ledger,
                jsonb_build_object('employee_id', v_uid, 'leave_type_id', v_annual_type,
                                   'minutes', v_minutes, 'as_of', p_balance_as_of));
      end if;

      if v_annual_type is not null and coalesce(v_rate, 0) > 0 then
        insert into public.employee_leave_policies (
          employee_id, leave_type_id, accrual_minutes_per_month,
          annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
        ) values (v_uid, v_annual_type, v_rate, v_cap, coalesce(v_carry, 4320), v_accrual_start, v_caller)
        on conflict (employee_id, leave_type_id) do nothing;
      end if;

      select employee_code into v_code from public.profiles where id = v_uid;
      v_created := v_created || jsonb_build_object(
        'personnel_no', v_row->>'personnel_no', 'employee_code', v_code, 'user_id', v_uid);
    end if;
  end loop;

  -- 3. Kept people whose manager changes (replace).
  for v_dep in select * from jsonb_array_elements(coalesce(p_reassign, '[]'::jsonb)) loop
    v_id := (v_dep->>'id')::uuid;
    if not exists (select 1 from public.profiles where id = v_id and company_id = p_company_id) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    v_mgr := null;
    if coalesce(btrim(v_dep->>'manager_personnel_no'), '') <> '' then
      select id into v_mgr from public.profiles
       where company_id = p_company_id and personnel_no = btrim(v_dep->>'manager_personnel_no');
      if v_mgr is null then
        raise exception 'manager with personnel number % not found', v_dep->>'manager_personnel_no' using errcode = '22023';
      end if;
    end if;
    update public.profiles set manager_id = v_mgr where id = v_id;
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_caller, 'bulk_reassign_manager', 'profiles', v_id, jsonb_build_object('manager_id', v_mgr));
  end loop;

  -- 4. Deactivations (replace). Never an admin, never the caller.
  foreach v_id in array coalesce(p_deactivate, '{}'::uuid[]) loop
    if not exists (select 1 from public.profiles where id = v_id and company_id = p_company_id) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
    if v_id = v_caller or exists (select 1 from public.user_roles where user_id = v_id and role = 'admin') then
      raise exception 'an import cannot deactivate an admin account' using errcode = '42501';
    end if;
    update public.profiles set active = false where id = v_id and active;
    if found then
      v_deactivated := v_deactivated + 1;
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'bulk_deactivate', 'profiles', v_id, jsonb_build_object('mode', p_mode));
    end if;
  end loop;

  -- 5. Department managers.
  for v_dep in select * from jsonb_array_elements(p_departments) loop
    if coalesce(btrim(v_dep->>'manager_personnel_no'), '') = '' then
      continue;
    end if;
    if v_bulk_hr then
      raise exception 'only admins can assign department managers' using errcode = '42501';
    end if;
    select id into v_dm from public.profiles
     where company_id = p_company_id and personnel_no = btrim(v_dep->>'manager_personnel_no');
    if v_dm is null then
      raise exception 'department manager with personnel number % not found',
        v_dep->>'manager_personnel_no' using errcode = '22023';
    end if;
    update public.departments d
       set manager_id = v_dm
     where d.company_id = p_company_id
       and d.code = upper(btrim(v_dep->>'code'))
       and (p_mode <> 'add'
            or d.manager_id is null
            or not exists (select 1 from public.profiles m where m.id = d.manager_id and m.active));
  end loop;

  -- 6. Unused departments (replace): delete only if nobody, active or not, is in them.
  foreach v_code in array coalesce(p_delete_departments, '{}'::text[]) loop
    select id into v_dept from public.departments where company_id = p_company_id and code = upper(btrim(v_code));
    if v_dept is null then
      continue;
    end if;
    if exists (select 1 from public.profiles where department_id = v_dept) then
      v_not_deleted := v_not_deleted || upper(btrim(v_code));
    else
      delete from public.departments where id = v_dept;
      v_deleted := v_deleted || upper(btrim(v_code));
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_caller, 'bulk_delete_department', 'departments', v_dept, jsonb_build_object('code', upper(btrim(v_code))));
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_caller, 'bulk_import', 'profiles', null,
          jsonb_build_object('mode', p_mode, 'rows', jsonb_array_length(p_rows),
                             'created', jsonb_array_length(v_created), 'updated', v_updated,
                             'deactivated', v_deactivated, 'departments_deleted', to_jsonb(v_deleted),
                             'overwrite_balances', coalesce(p_overwrite_balances, false),
                             'balance_as_of', p_balance_as_of));

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'deactivated', v_deactivated,
    'deleted_departments', to_jsonb(v_deleted),
    'not_deleted_departments', to_jsonb(v_not_deleted)
  );
end;
$_$;

drop function public.app_export_personal_info();

create function public.app_export_personal_info() RETURNS TABLE(personnel_no text, employee_code text, full_name text, first_name text, last_name text, active boolean, national_id text, birth_cert_no text, father_name text, birth_date date, birth_place text, gender text, marital_status text, bank_name text, bank_account_no text, sheba text, card_no text, mobile text, home_phone text, address text, postal_code text, emergency_name text, emergency_phone text, insurance_no text, education text, military_status text, children_count smallint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_count   int;
begin
  if not private.has_perm(v_uid, 'personal_info', 'read') then
    raise exception 'not permitted to export personal info' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;

  select count(*) into v_count from public.employee_personal_info where company_id = v_company;
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'personal_info.export', 'employee_personal_info', null,
          jsonb_build_object('rows', v_count));

  return query
    select p.personnel_no, p.employee_code, p.full_name, p.first_name, p.last_name, p.active,
           i.national_id, i.birth_cert_no, i.father_name, i.birth_date, i.birth_place,
           i.gender, i.marital_status, i.bank_name, i.bank_account_no, i.sheba,
           i.card_no, i.mobile, i.home_phone, i.address, i.postal_code,
           i.emergency_name, i.emergency_phone, i.insurance_no, i.education,
           i.military_status, i.children_count
      from public.employee_personal_info i
      join public.profiles p on p.id = i.employee_id
     where i.company_id = v_company
     order by p.active desc, p.personnel_no nulls last, p.full_name;
end; $$;

revoke all on function public.app_export_personal_info() from public, anon;
grant execute on function public.app_export_personal_info() to authenticated, service_role;

notify pgrst, 'reload schema';
