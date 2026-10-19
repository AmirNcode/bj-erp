-- Forward correction for the frozen approval-delegation migration.
-- Recheck callers after authority locks, preserve company -> employee lock order,
-- and timestamp submission/decision evidence after waits. CREATE OR REPLACE keeps
-- existing function identities, signatures, owners and EXECUTE grants intact.

CREATE OR REPLACE FUNCTION public.app_set_approval_delegate(p_principal_id uuid, p_delegate_id uuid DEFAULT NULL::uuid, p_ceo_authorized boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid; v_ceo uuid; v_id uuid; v_old uuid;
begin
  select p.company_id into v_company from public.profiles p join public.profiles c
    on c.company_id=p.company_id and c.id=auth.uid() where p.id=p_principal_id;
  if v_company is null or not private.is_active(auth.uid()) or
      not (auth.uid()=p_principal_id or private.is_admin(auth.uid())) then
    raise exception 'not permitted to select a delegate' using errcode='42501'; end if;
  perform private.approval_lock(v_company);
  -- A waiting former admin or deactivated caller cannot keep pre-lock authority.
  if not private.is_active(auth.uid()) or not exists (
      select 1 from public.profiles p join public.profiles c
        on c.id=auth.uid() and c.company_id=p.company_id
      where p.id=p_principal_id and p.company_id=v_company)
      or not (auth.uid()=p_principal_id or private.is_admin(auth.uid())) then
    raise exception 'not permitted to select a delegate' using errcode='42501'; end if;
  if not private.has_perm(p_principal_id,'approval_delegate','edit')
    or not private.natural_approver(p_principal_id) then
    raise exception 'principal needs approval delegation permission and natural approval duties' using errcode='42501'; end if;
  select ceo_id into v_ceo from public.approval_executive_settings where company_id=v_company;
  if p_delegate_id is not null and not private.delegate_eligible(p_principal_id,p_delegate_id) then
    raise exception 'delegate must be an active eligible approver; CEO delegates must be direct reports' using errcode='22023'; end if;
  if coalesce(p_ceo_authorized,false) and (v_ceo is distinct from p_principal_id or p_delegate_id is null) then
    raise exception 'automatic approval authorization requires the designated CEO appointment' using errcode='22023'; end if;
  if coalesce(p_ceo_authorized,false) and not private.ceo_delegate_configuration_ready(p_principal_id,p_delegate_id) then
    raise exception 'CEO must naturally own applicable approval steps for leave and errand before automatic authority is authorized' using errcode='22023'; end if;
  select id into v_old from public.approval_delegations where principal_id=p_principal_id
    and source_request_id is null and revoked_at is null;
  update public.approval_delegations set revoked_at=clock_timestamp() where id=v_old;
  if p_delegate_id is not null then
    insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,
      configured_by,ceo_authorized)
    select v_company,p_principal_id,p_delegate_id,p.full_name,d.full_name,auth.uid(),coalesce(p_ceo_authorized,false)
      from public.profiles p,public.profiles d where p.id=p_principal_id and d.id=p_delegate_id returning id into v_id;
  end if;
  perform private.reconcile_approval_timers(v_company);
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (auth.uid(),'set_approval_delegate','approval_delegations',v_id,
      jsonb_build_object('principal_id',p_principal_id,'delegate_id',p_delegate_id,
        'previous_grant_id',v_old,'ceo_authorized',coalesce(p_ceo_authorized,false)));
end; $$;

CREATE OR REPLACE FUNCTION public.app_set_executive_settings(p_ceo_id uuid, p_hr_head_id uuid, p_hr_step_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid;
begin
  if not private.is_admin(auth.uid()) then raise exception 'admin required' using errcode='42501'; end if;
  select company_id into v_company from public.profiles where id=auth.uid();
  perform private.approval_lock(v_company);
  if not private.is_admin(auth.uid()) or not exists (
      select 1 from public.profiles where id=auth.uid() and company_id=v_company) then
    raise exception 'admin required' using errcode='42501'; end if;
  if exists (select 1 from unnest(array[p_ceo_id,p_hr_head_id]) id where id is not null
      and not exists (select 1 from public.profiles p where p.id=id and p.company_id=v_company and p.active)) then
    raise exception 'executive must be active in your company' using errcode='22023'; end if;
  if exists (select 1 from unnest(coalesce(p_hr_step_ids,'{}')) id where not exists
      (select 1 from public.approval_steps s where s.id=id and s.company_id=v_company and s.active)) then
    raise exception 'HR review step must be an active company approval step' using errcode='22023'; end if;
  insert into public.approval_executive_settings(company_id,ceo_id,hr_head_id,hr_step_ids,configured_by)
    values(v_company,p_ceo_id,p_hr_head_id,coalesce(p_hr_step_ids,'{}'),auth.uid())
    on conflict(company_id) do update set ceo_id=excluded.ceo_id,hr_head_id=excluded.hr_head_id,
      hr_step_ids=excluded.hr_step_ids,configured_by=excluded.configured_by,
      configured_at=clock_timestamp(),version=public.approval_executive_settings.version+1;
  perform private.reconcile_approval_timers(v_company);
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (auth.uid(),'set_approval_executives','approval_executive_settings',v_company,
      jsonb_build_object('ceo_id',p_ceo_id,'hr_head_id',p_hr_head_id,'hr_step_ids',p_hr_step_ids));
end; $$;

CREATE OR REPLACE FUNCTION public.app_bulk_import_employees(p_company_id uuid, p_mode text, p_rows jsonb, p_departments jsonb, p_balance_as_of date, p_overwrite_balances boolean, p_deactivate uuid[], p_reassign jsonb, p_delete_departments text[]) RETURNS jsonb
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
$_$;

CREATE OR REPLACE FUNCTION private.submit_leave_impl(p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text, p_unit public.leave_unit, p_start_time time without time zone, p_end_time time without time zone, p_replacement_id uuid, p_kind public.request_kind, p_location text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_dept uuid;
  v_minutes int;
  v_affects boolean;
  v_is_paid boolean;
  v_allow_hourly boolean;
  v_balance int;
  v_unpaid int := 0;
  v_req uuid;
  v_win_start time;
  v_win_end time;
  v_cap int;
  v_day_used int;
  v_jyear int;
  v_seq int;
  v_location text := nullif(btrim(p_location), '');
  v_replacement uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id, department_id into v_company, v_dept
    from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;
  perform private.approval_lock(v_company);
  -- Authentication in the public wrapper happened before this possible wait.
  -- Refresh both caller activity/company and the department used for cover rules.
  select department_id into v_dept from public.profiles
    where id=v_uid and company_id=v_company and active;
  if not found then
    raise exception 'not allowed to submit this request' using errcode='42501';
  end if;

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'end date must not be before start date' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  if p_kind = 'errand' then
    if v_location is null then
      raise exception 'errand location is required' using errcode = '22023';
    end if;
    if length(v_location) > 200 then
      raise exception 'errand location is too long' using errcode = '22023';
    end if;
    if p_unit = 'hour' then
      if p_start <> p_end
         or p_start_time is null
         or p_end_time is null
         or p_end_time <= p_start_time
      then
        raise exception 'end time must be after start time' using errcode = '22023';
      end if;
    elsif p_unit = 'day' then
      if p_start_time is not null or p_end_time is not null or p_day_part <> 'full' then
        raise exception 'daily errands require full dates without times' using errcode = '22023';
      end if;
    end if;
    v_replacement := null;
  else
    if p_leave_type_id is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
    v_location := null;
    v_replacement := p_replacement_id;
  end if;

  if p_kind = 'leave' then
    select affects_balance, is_paid, allow_hourly
      into v_affects, v_is_paid, v_allow_hourly
      from public.leave_types
     where id = p_leave_type_id and company_id = v_company and active;
    if v_affects is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
  end if;

  if p_kind = 'leave' and p_unit = 'hour' then
    if not coalesce(v_allow_hourly, false) then
      raise exception 'this leave type cannot be taken hourly' using errcode = '22023';
    end if;
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'end time must be after start time' using errcode = '22023';
    end if;

    select work_start, work_end, max_hourly_minutes_per_day
      into v_win_start, v_win_end, v_cap
      from public.work_settings where company_id = v_company limit 1;
    v_win_start := coalesce(v_win_start, '07:00'::time);
    v_win_end := coalesce(v_win_end, '15:00'::time);
    v_cap := coalesce(v_cap, 240);

    if p_start_time < v_win_start or p_end_time > v_win_end then
      raise exception 'times must fall within working hours' using errcode = '22023';
    end if;
    if (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  if v_replacement is not null then
    if not exists (
      select 1 from public.profiles p
       where p.id = v_replacement
         and p.active
         and p.company_id = v_company
         and ((v_dept is not null and p.department_id = v_dept)
              or private.delegate_eligible(v_uid,p.id))
         and p.id <> v_uid
    ) then
      raise exception 'replacement must be an active colleague in your department'
        using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  if p_kind = 'leave' and p_unit = 'hour' then
    -- FR-57: one hourly leave per person per day. Rejected and cancelled
    -- requests free the day again.
    if exists (
      select 1 from public.leave_requests r
       where r.employee_id = v_uid
         and r.kind = 'leave'
         and r.unit = 'hour'
         and r.start_date = p_start
         and r.status in ('pending', 'approved')
    ) then
      raise exception 'only one hourly leave per day' using errcode = '22023';
    end if;

    select coalesce(sum(r.requested_minutes), 0) into v_day_used
      from public.leave_requests r
     where r.employee_id = v_uid
       and r.kind = 'leave'
       and r.unit = 'hour'
       and r.start_date = p_start
       and r.status in ('pending', 'approved');

    if v_day_used + (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.leave_requests r
     where r.employee_id = v_uid
       and r.status in ('pending', 'approved')
       and r.start_date <= p_end
       and r.end_date >= p_start
       and (
         r.unit = 'day' or p_unit = 'day'
         or (r.start_time < p_end_time and r.end_time > p_start_time)
       )
  ) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  if v_replacement is not null
     and private.replacement_is_away(
       v_replacement, p_start, p_end, p_unit, p_start_time, p_end_time
     )
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(
    v_company, p_start, p_end, p_day_part, p_unit, p_start_time, p_end_time, p_kind
  );
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)'
      using errcode = '22023';
  end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    v_unpaid := greatest(v_minutes - greatest(v_balance, 0), 0);
  elsif p_kind = 'leave' and not coalesce(v_is_paid, false) then
    v_unpaid := v_minutes;
  end if;

  select jm.jalali_year into v_jyear
    from public.jalali_months jm
   where p_start between jm.gregorian_start and jm.gregorian_end;
  if v_jyear is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  insert into public.leave_request_serials(company_id, jalali_year, kind, last_seq)
  values (v_company, v_jyear, p_kind, 1)
  on conflict (company_id, jalali_year, kind) do update
     set last_seq = public.leave_request_serials.last_seq + 1
  returning last_seq into v_seq;

  insert into public.leave_requests(
    employee_id, leave_type_id, start_date, end_date, day_part,
    unit, start_time, end_time, requested_minutes, unpaid_minutes, status, reason,
    replacement_id, company_id, serial_year, serial_seq, kind, errand_location, created_at
  )
  values (
    v_uid, p_leave_type_id, p_start, p_end, p_day_part,
    p_unit, p_start_time, p_end_time, v_minutes, v_unpaid, 'pending', p_reason,
    v_replacement, v_company, v_jyear, v_seq, p_kind, v_location, clock_timestamp()
  )
  returning id into v_req;

  return v_req;
end;
$$;

CREATE OR REPLACE FUNCTION private.attach_request_signature(p_request_id uuid, p_signature_data text, p_signature_authorized boolean) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
begin
  if p_signature_authorized is not true then
    raise exception 'signature authorization is required' using errcode = '22023';
  end if;
  if p_signature_data is null or p_signature_data = '' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if length(p_signature_data) not between 100 and 350000
     or mod(length(p_signature_data), 4) <> 2
     or p_signature_data !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
  then
    raise exception 'signature data is invalid' using errcode = '22023';
  end if;

  update public.leave_requests
     set signature_data = p_signature_data,
         signature_consent_at = clock_timestamp()
   where id = p_request_id
     and signature_data is null
     and signature_consent_at is null;

  if not found then
    raise exception 'request signature could not be attached' using errcode = '55000';
  end if;
end;
$_$;

CREATE OR REPLACE FUNCTION private.enroll_request_delegation(p_request uuid, p_auto_consent boolean, p_preview jsonb, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; x public.approval_executive_settings%rowtype;
  d public.approval_delegations%rowtype; v_preview jsonb; v_bounds jsonb; v_steps uuid[];
  v_now timestamptz; v_temp uuid;
begin
  select * into r from public.leave_requests where id=p_request;
  perform private.approval_lock(r.company_id);
  select * into r from public.leave_requests where id=p_request;
  v_now:=clock_timestamp();
  v_preview:=public.app_request_delegation_preview(r.start_date,r.end_date,r.unit,r.day_part,
    r.start_time,r.end_time,r.replacement_id);
  if p_preview is not null and p_preview->>'preview_token' is distinct from v_preview->>'preview_token' then
    raise exception 'delegation preview changed; refresh the request preview' using errcode='22023'; end if;
  if r.day_part<>'full' and private.has_perm(r.employee_id,'approval_delegate','edit')
      and r.replacement_id is not null and private.delegate_eligible(r.employee_id,r.replacement_id)
      and p_preview is null then
    raise exception 'delegation preview required; refresh the request preview' using errcode='22023'; end if;
  v_bounds:=v_preview->'bounds';
  select * into x from public.approval_executive_settings where company_id=r.company_id;
  insert into public.approval_request_policy(request_id,company_id,starts_at,ends_at,hr_head_id,
    hr_exempt_step_ids,step_snapshot)
  values(r.id,r.company_id,(v_bounds->>'starts_at')::timestamptz,(v_bounds->>'ends_at')::timestamptz,
    x.hr_head_id,case when r.employee_id=x.hr_head_id then coalesce((select array_agg(s.id)
      from public.approval_steps s where s.company_id=r.company_id and s.active
        and s.id=any(x.hr_step_ids) and r.kind=any(s.applies_to)
        and private.step_applies(s.manager_scope,r.employee_id)),'{}') else '{}'::uuid[] end,
    private.approval_step_snapshot(r.id));
  if r.replacement_id is not null and private.delegate_eligible(r.employee_id,r.replacement_id) then
    if r.employee_id=x.ceo_id and p_temporary_ceo_authorized is not true then
      raise exception 'temporary CEO delegation authorization required' using errcode='22023'; end if;
    if r.employee_id=x.ceo_id and not private.ceo_delegate_configuration_ready(r.employee_id,r.replacement_id) then
      raise exception 'CEO must naturally own applicable approval steps for leave and errand before automatic authority is authorized' using errcode='22023'; end if;
    if exists (select 1 from public.approval_delegations g join public.leave_requests lr on lr.id=g.source_request_id
      where g.principal_id=r.employee_id and g.revoked_at is null and lr.status in ('pending','approved')
        and g.starts_at<(v_bounds->>'ends_at')::timestamptz and g.ends_at>(v_bounds->>'starts_at')::timestamptz) then
      raise exception 'overlapping temporary approval delegation' using errcode='22023'; end if;
    insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,
      delegate_name,source_request_id,starts_at,ends_at,ceo_authorized,configured_by)
    select r.company_id,r.employee_id,r.replacement_id,p.full_name,q.full_name,r.id,
      (v_bounds->>'starts_at')::timestamptz,(v_bounds->>'ends_at')::timestamptz,
      -- Separate explicit attestation; the generic requester PNG does not authorize this policy.
      r.employee_id=x.ceo_id and p_temporary_ceo_authorized is true,r.employee_id from public.profiles p,public.profiles q
      where p.id=r.employee_id and q.id=r.replacement_id returning id into v_temp;
  end if;
  select g.* into d from private.effective_approval_delegate(x.ceo_id) g
    where g.delegate_id=r.employee_id and g.ceo_authorized;
  if d.id is not null then
    if p_auto_consent is not true or r.signature_data is null or r.signature_consent_at is null then
      raise exception 'CEO automatic approval responsibility consent required; refresh the request form' using errcode='22023'; end if;
    select array_agg(s.id order by s.step_order,s.id) into v_steps from public.approval_steps s
      where private.request_step_applies(r.id,s.id) and private.natural_step_authority(x.ceo_id,r.id,s.id);
    if cardinality(coalesce(v_steps,'{}'))=0 then
      raise exception 'CEO has no natural applicable approval step; correct executive approval configuration' using errcode='22023'; end if;
    insert into public.approval_auto_requests(request_id,company_id,authority_id,principal_id,delegate_id,
      principal_name,delegate_name,settings_version,step_ids,step_snapshot,consent_at,submitted_at,due_at)
    values(r.id,r.company_id,d.id,x.ceo_id,r.employee_id,d.principal_name,d.delegate_name,x.version,
      v_steps,private.approval_step_snapshot(r.id,v_steps),v_now,r.created_at,r.created_at+interval '120 minutes');
  elsif p_auto_consent then
    raise exception 'CEO automatic approval authority changed; refresh the request preview' using errcode='22023';
  end if;
end; $$;

CREATE OR REPLACE FUNCTION private.decide_approval_request(p_id uuid, p_step_id uuid, p_actor uuid, p_decision public.leave_status, p_signature_data text, p_signature_authorized boolean, p_override boolean, p_per_diem_rials bigint, p_reason text, p_auto_authority uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; s public.approval_steps%rowtype;
  d public.approval_delegations%rowtype; a public.approval_auto_requests%rowtype;
  v_steps uuid[]; v_step uuid; v_total integer; v_admin boolean:=false; v_override boolean:=false;
  v_kind text; v_principal uuid; v_principal_name text; v_actor_name text; v_evidence jsonb;
  v_now timestamptz; v_filled_hr boolean:=false; v_note text:=nullif(btrim(p_reason),'');
begin
  select * into r from public.leave_requests where id=p_id;
  if r.id is null then raise exception 'request not found' using errcode='P0002'; end if;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:'||r.employee_id::text,0));
  select * into r from public.leave_requests where id=p_id for update;
  v_now:=clock_timestamp();
  if r.status<>'pending' then raise exception 'only pending requests can be decided' using errcode='22023'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
  if length(v_note)>500 then raise exception 'rejection note is too long (max 500 characters)' using errcode='22023'; end if;
  if p_auto_authority is null then
    if not private.is_active(p_actor) or not exists (select 1 from public.profiles where id=p_actor and company_id=r.company_id) then
      raise exception 'not allowed to decide this request' using errcode='42501'; end if;
    v_admin:=private.is_admin(p_actor);
    select full_name into v_actor_name from public.profiles where id=p_actor;
    if p_decision='approved' then perform private.separation_check_signature(p_signature_data,p_signature_authorized); end if;
  else
    select * into a from public.approval_auto_requests where request_id=p_id;
    if p_actor is not null or p_decision<>'approved' or a.authority_id is distinct from p_auto_authority
      or a.state not in ('pending','blocked') or a.due_at>v_now
      or private.approval_timer_invalid_reason(p_id) is not null
      or not (p_step_id=any(a.step_ids)) then
      raise exception 'automatic CEO authority is no longer valid' using errcode='42501'; end if;
    if p_signature_data is not null or p_per_diem_rials is not null then
      raise exception 'automatic decisions cannot carry human signatures or per diem' using errcode='22023'; end if;
  end if;
  if p_per_diem_rials<0 then raise exception 'per diem must be 0 or more' using errcode='22023'; end if;
  select count(*) into v_total from public.approval_steps st where private.request_step_applies(p_id,st.id);
  if p_auto_authority is not null then v_steps:=array[p_step_id];
  elsif v_total=0 and not exists (select 1 from public.approval_steps st
    where st.company_id=r.company_id and st.active and r.kind=any(st.applies_to)
      and private.step_applies(st.manager_scope,r.employee_id)) then
    -- Legacy no-chain fallback; delegation remains approval-only and cannot sign own requests.
    if not (v_admin or private.is_manager_of(p_actor,r.employee_id)) then
      select g.* into d from public.profiles emp
        cross join lateral private.effective_approval_delegate(emp.manager_id) g
        where emp.id=r.employee_id and g.delegate_id=p_actor and r.employee_id<>p_actor
          and g.source_request_id is distinct from p_id and private.is_manager_of(g.principal_id,r.employee_id);
      if d.id is null then raise exception 'not allowed to decide this request' using errcode='42501'; end if;
    end if;
    v_steps:=array[null::uuid];
  else
    if p_step_id is not null then
      if not private.request_step_applies(p_id,p_step_id) then
        raise exception 'approval step is no longer applicable' using errcode='22023'; end if;
      if not private.can_approve_step(p_actor,p_id,p_step_id) and not v_admin then
        raise exception 'not allowed to decide this request' using errcode='42501'; end if;
      v_step:=p_step_id;
    else
      select st.id into v_step from public.approval_steps st
      where private.can_approve_step(p_actor,p_id,st.id) and not private.request_step_decided(p_id,st.id)
        order by st.step_order,st.id limit 1;
    end if;
    v_override:=v_admin and (coalesce(p_override,false) or v_step is null
      or not private.can_approve_step(p_actor,p_id,v_step));
    if v_override then
      select array_agg(st.id order by st.step_order,st.id) into v_steps from public.approval_steps st
        where private.request_step_applies(p_id,st.id) and not private.request_step_decided(p_id,st.id);
    elsif v_step is not null then v_steps:=array[v_step];
    else raise exception 'not allowed to decide this request' using errcode='42501'; end if;
  end if;
  if cardinality(coalesce(v_steps,'{}'))=0 then raise exception 'you have already signed this request' using errcode='22023'; end if;
  foreach v_step in array v_steps loop
    s:=null;
    if v_step is not null then select * into s from public.approval_steps where id=v_step;
      if private.request_step_decided(p_id,s.id) then
        raise exception 'you have already signed this request' using errcode='22023'; end if;
      if p_auto_authority is null and not v_override and p_decision='approved'
        and exists (select 1 from public.work_settings w where w.company_id=r.company_id and w.approval_order_enforced)
        and exists (select 1 from public.approval_steps prev where private.request_step_applies(p_id,prev.id)
          and prev.step_order<s.step_order and not private.request_step_decided(p_id,prev.id,'approved')) then
        raise exception 'an earlier approval is still required' using errcode='22023'; end if;
    end if;
    v_evidence:='{}';
    if p_auto_authority is not null then
      v_kind:='automatic'; v_principal:=a.principal_id; v_principal_name:=a.principal_name;
      v_evidence:=jsonb_build_object('authority_id',a.authority_id,'principal_name',a.principal_name,
        'delegate_id',a.delegate_id,'delegate_name',a.delegate_name,'consent_at',a.consent_at,
        'submitted_at',a.submitted_at,'due_at',a.due_at,'processed_at',v_now,'statement',
        'Automatically approved under delegated CEO authority. The CEO review period elapsed without a CEO decision. The appointed delegate accepted responsibility under the recorded authorization.');
    else
      if v_step is not null then
        d:=null;
        if not v_override and not private.natural_step_authority(p_actor,p_id,v_step) then
          select g.* into d from private.step_delegation(p_actor,p_id,v_step) g;
        end if;
      end if;
      if d.id is not null then v_kind:='delegated';v_principal:=d.principal_id;v_principal_name:=d.principal_name;
      else v_kind:='manual';v_principal:=p_actor;v_principal_name:=v_actor_name; end if;
      v_evidence:=jsonb_build_object('admin_override',v_override,'actor_id',p_actor,
        'principal_id',v_principal,'principal_name',v_principal_name,'signer_name',v_actor_name);
    end if;
    v_filled_hr:=v_filled_hr or coalesce(s.role='hr',false);
    insert into public.leave_request_approvals(request_id,step_id,step_role,approver_id,decision,
      signature_data,signature_consent_at,note,evidence_kind,principal_id,principal_name,signer_name_snapshot,authority_id,evidence,created_at)
    values(p_id,v_step,coalesce(s.role,'manager'),p_actor,p_decision,
      case when p_decision='approved' then p_signature_data end,
      case when p_decision='approved' and p_signature_data is not null then v_now end,
      v_note,v_kind,v_principal,v_principal_name,v_actor_name,
      case when p_auto_authority is not null then p_auto_authority else d.id end,
      v_evidence||jsonb_build_object('step_id',v_step,'step_role',coalesce(s.role,'manager'),
        'step_order',coalesce(s.step_order,1),'manager_scope',coalesce(s.manager_scope,'direct'),
        'named',s.approver_id is not null,'approver_id',s.approver_id,
        'expected_name',case when s.approver_id is not null then
          (select full_name from public.profiles where id=s.approver_id) else v_principal_name end),v_now);
    if p_decision='rejected' then exit; end if;
  end loop;
  if p_decision='rejected' then
    update public.leave_requests set status='rejected',decided_by=p_actor,decided_at=v_now,decision_note=v_note where id=p_id and status='pending';
  else
    if p_per_diem_rials is not null then
      if r.kind<>'errand' or not v_filled_hr then
        raise exception 'per diem can only be set on the hr step of an errand' using errcode='22023'; end if;
      update public.leave_requests set per_diem_rials=p_per_diem_rials where id=p_id;
    end if;
    perform private.finalize_approval_request(p_id,p_actor,p_signature_data,v_now,
      case when p_auto_authority is not null then 'automatic' else v_kind end);
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (p_actor,case when p_decision='approved' then 'approve_leave_step' else 'reject_leave_request' end,
     'leave_requests',p_id,jsonb_build_object('step_ids',v_steps,'evidence_kind',v_kind,'admin_override',v_override,
       'authority_id',p_auto_authority,'per_diem_rials',p_per_diem_rials));
end; $$;

CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_company uuid;
  v_now timestamptz;
  v_status public.leave_status;
  v_start date;
  v_type uuid;
  v_kind public.request_kind;
  v_minutes int;
  v_unpaid int;
  v_paid int;
  v_affects boolean;
  v_prev int;
  v_rows int;
  v_today date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  select employee_id, company_id into v_owner, v_company from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (v_owner = v_uid
          or private.is_admin(v_uid)
          -- FR-55 D8: leave_requests at Allowed covers the company, apart from the admin.
          or (private.has_perm(v_uid, 'leave_requests', 'edit')
              and exists (select 1 from public.profiles o
                            join public.profiles c on c.company_id = o.company_id and c.id = v_uid
                           where o.id = v_owner)
              and not exists (select 1 from public.user_roles where user_id = v_owner and role = 'admin'))) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform private.approval_lock(v_company);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes, unpaid_minutes, kind
    into v_status, v_start, v_type, v_minutes, v_unpaid, v_kind
    from public.leave_requests where id = p_id for update;
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Asia/Tehran')::date;
  if not private.is_active(v_uid) or not exists (
      select 1 from public.profiles where id=v_uid and company_id=v_company) then
    raise exception 'not allowed to cancel this request' using errcode='42501';
  end if;
  if not (v_owner = v_uid
          or private.is_admin(v_uid)
          or (private.has_perm(v_uid, 'leave_requests', 'edit')
              and exists (select 1 from public.profiles o
                            join public.profiles c on c.company_id=o.company_id and c.id=v_uid
                           where o.id=v_owner)
              and not exists (select 1 from public.user_roles where user_id=v_owner and role='admin'))) then
    raise exception 'not allowed to cancel this request' using errcode='42501';
  end if;
  v_paid := greatest(v_minutes - coalesce(v_unpaid, 0), 0);

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = v_now
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;
  elsif v_status = 'approved'
        and (v_start > v_today or (v_kind = 'errand' and v_start >= v_today))
  then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = v_now
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects and v_paid > 0 then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      ) values (
        v_owner, v_type, p_id, 'reversal',
        v_paid, v_prev + v_paid, 'paid portion reversed on cancel'
      );
    end if;
  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled'
      using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'cancel_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'status_before', v_status,
      'requested_minutes', v_minutes,
      'paid_minutes_reversed', case when v_status = 'approved' then v_paid else 0 end,
      'unpaid_minutes', v_unpaid,
      'kind', v_kind,
      'reversed', (
        v_status = 'approved' and coalesce(v_affects, false) and v_paid > 0
      )
    )
  );
end;
$$;

notify pgrst,'reload schema';
