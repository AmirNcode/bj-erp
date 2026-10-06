-- =============================================================================
-- Migration: 20261006120001_bulk_import_modes.sql
-- Purpose  : Bulk import modes — Add new only · Add & update · Replace.
-- Requirement: FR-49 (spec docs/specs/2026-10-06-bulk-import-modes-design.md)
-- Depends  : 20261005120004_bulk_import_v2.sql (v2 import, kept unchanged)
--            20261005120003_department_manager_step.sql (departments.manager_id meaning)
--
-- One SECURITY DEFINER function executes the plan the wizard built and showed
-- (lib/csv/import-plan.ts), in ONE transaction, re-checking every invariant:
--
--   p_mode            'add' | 'update' | 'replace'. update/replace are ADMIN-only.
--   p_rows            manager-first, as v2, each with `rename`-free fields; a row
--                     whose personnel number exists is an UPDATE outside 'add'
--                     (error in 'add').
--   p_departments     {code, name_fa, name_en, create, rename, manager_personnel_no}
--   p_balance_as_of   as v2 — opening balances and accrual restart.
--   p_overwrite_balances  updated people's balance is SET to the file's value.
--   p_deactivate      profile ids ('replace' only). Never an admin, never the caller.
--   p_reassign        [{id, manager_personnel_no|null}] for kept people ('replace').
--   p_delete_departments  codes ('replace' only); deleted ONLY if no profile, active
--                     or not, is in them — others are reported back as not deleted.
--
-- Updating an existing employee (spec §2): name, job title, department,
-- manager_id (supervisor else manager), hire date when the file has one, and the
-- `manager` role granted/removed to match the file. admin / hr / security roles
-- are never touched; login code and password never change. An inactive employee
-- in the file is reactivated (O1).
--
-- Deactivated department manager (spec §5): in 'add' a department manager is
-- assigned where there is none OR the current one is inactive; in update/replace
-- the file's manager always wins.
--
-- app_bulk_create_employees (v2) is left in place unchanged; the app no longer
-- calls it.
--
-- Idempotent: create or replace.
-- =============================================================================

create or replace function public.app_bulk_import_employees(
  p_company_id         uuid,
  p_mode               text,
  p_rows               jsonb,
  p_departments        jsonb,
  p_balance_as_of      date,
  p_overwrite_balances boolean,
  p_deactivate         uuid[],
  p_reassign           jsonb,
  p_delete_departments text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_bulk_hr  := private.has_role(v_caller, 'hr') and not v_is_admin;
  if not (v_is_admin or v_bulk_hr) then
    raise exception 'admin or hr role required' using errcode = '42501';
  end if;
  -- Tenant binding: the company comes from the request, so it must be the
  -- caller's own. Without this an admin of one company could import into another.
  if p_company_id is distinct from (select company_id from public.profiles where id = v_caller) then
    raise exception 'not allowed to import into another company' using errcode = '42501';
  end if;
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
         set full_name     = btrim(v_row->>'full_name'),
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
        nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title');

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
$$;

revoke all on function public.app_bulk_import_employees(uuid, text, jsonb, jsonb, date, boolean, uuid[], jsonb, text[]) from public, anon;
grant execute on function public.app_bulk_import_employees(uuid, text, jsonb, jsonb, date, boolean, uuid[], jsonb, text[]) to authenticated;
