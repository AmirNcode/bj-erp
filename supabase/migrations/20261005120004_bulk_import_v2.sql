-- =============================================================================
-- Migration: 20261005120004_bulk_import_v2.sql
-- Purpose  : Bulk employee import v2 — the client's personnel list as-is:
--            supervisor + manager, departments created on the fly, signed
--            opening balances in days + hours as of a date the uploader picks.
-- Requirement: FR-45 (spec docs/specs/2026-10-05-org-chart-and-personnel-import-design.md §2)
-- Depends  : 20260818150001_hr_creates_employees.sql (create_employee_impl, the v1 import)
--            20261005120001_department_codes_upper.sql (code format)
--            20260729130005_leave_policy.sql (employee_leave_policies)
--
-- Signature change: (p_company_id, p_rows) → (p_company_id, p_rows,
-- p_departments, p_balance_as_of). The 2-argument v1 is dropped; its only caller
-- (lib/actions/employees.ts bulkCreateEmployees) moves in the same change.
--
-- p_rows — ordered by the caller so every in-file manager precedes their reports
-- (lib/csv/import-rows.ts sorts); each:
--   {full_name, personnel_no, job_title, role, department_code,
--    supervisor_personnel_no, manager_personnel_no, hire_date,
--    balance_minutes, password}
-- p_departments — every department the rows use:
--   {code, name_fa, name_en, create, manager_personnel_no}
--
-- What it does, in ONE transaction (the first bad row rolls back everything):
--   1. creates the departments flagged `create` (admin only);
--   2. creates each employee; manager_id = supervisor if given, else manager
--      (owner decision D7) — resolved against existing profiles and rows already
--      created in this call;
--   3. a non-zero balance becomes ONE signed `adjustment` ledger row noted
--      'opening balance as of <date>' — negative allowed (FR-48). No
--      leave_allocations row: that retires v1's Gregorian Jan–Dec period;
--   4. each employee gets the Annual Leave type's default accrual policy, with
--      accrual starting the Jalali month AFTER the one containing the balance
--      date — accrue_leave posts a month at any day inside it, so the balance
--      date's own month is taken as already counted;
--   5. sets departments.manager_id where given and the department has none.
--
-- HR may bulk-onboard plain employees (FR-35 D4, roles clamped below) but may
-- not create departments or assign department managers — department
-- configuration stays admin-only, as on the Departments page.
--
-- Idempotent: drop-if-exists + create or replace.
-- =============================================================================

drop function if exists public.app_bulk_create_employees(uuid, jsonb);

create or replace function public.app_bulk_create_employees(
  p_company_id    uuid,
  p_rows          jsonb,
  p_departments   jsonb,
  p_balance_as_of date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_bulk_hr := private.has_role(v_caller, 'hr') and not private.is_admin(v_caller);
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
      nullif(v_row->>'hire_date', '')::date, 'fa', 'jalali', v_row->>'job_title');

    v_minutes := coalesce(nullif(v_row->>'balance_minutes', ''), '0')::int;
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
$$;

revoke all on function public.app_bulk_create_employees(uuid, jsonb, jsonb, date) from public, anon;
grant execute on function public.app_bulk_create_employees(uuid, jsonb, jsonb, date) to authenticated;
