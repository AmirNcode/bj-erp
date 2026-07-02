-- =============================================================================
-- Migration: 20260702120001_hardening.sql
-- Purpose  : Production-hardening pass over the leave write-path and org tables.
--
--   1) Concurrency: every function that reads-then-writes leave_ledger now takes
--      a per-employee transaction-scoped advisory lock first. Without it, two
--      concurrent writers (e.g. approve + allocate for the same person) could
--      both read the same balance_after and write a stale one (lost update).
--   2) submit_leave_request: rejects ranges longer than 366 days (bounds the
--      per-day loop in compute_requested_days), and rejects ranges that overlap
--      the employee's existing pending/approved requests (an employee cannot be
--      on two leaves for the same day).
--   3) approve_leave_request: re-checks the balance at approval time for
--      balance-affecting types (several pending requests could each pass the
--      submit-time check yet jointly overdraw), and rejects if an overlapping
--      request was approved in the meantime. Re-reads the row AFTER taking the
--      lock so the checks cannot race.
--   4) app_set_user_roles: atomic replace of a user's roles (the app previously
--      did delete-then-insert as two statements — a failed insert lost roles),
--      with a guard so an admin cannot remove their own admin role (lockout).
--   5) app_create_employee: normalizes + validates the employee code before it
--      becomes the synthetic auth email (code@bj-app.internal). Non-latin or
--      whitespace codes previously produced invalid emails that GoTrue cannot
--      sign in. Also pre-checks duplicates for a clean error message.
--   6) Constraints: work_settings one-row-per-company (updateWorkSettings and
--      maybeSingle() readers assume it); holidays unique per (company, date).
--   7) Index: leave_ledger latest-balance lookup (hot path on every submit/
--      approve/cancel/allocation) was a seq scan.
--   8) get_my_team_directory: search_path tightened to '' like every other
--      SECURITY DEFINER function (body was already fully qualified).
--
-- Errcodes: 42501 = permission, 22023 = invalid input/state. Messages are
-- stable English strings; the app maps them to fa/en (lib/errors/db-error.ts).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1+2. submit_leave_request — lock, bound range, block overlaps
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_days numeric; v_affects boolean; v_balance numeric; v_req uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id into v_company from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  -- Serialize all leave writes for this employee (released at commit/rollback).
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  if exists (
    select 1 from public.leave_requests
    where employee_id = v_uid
      and status in ('pending', 'approved')
      and start_date <= p_end
      and end_date >= p_start
  ) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  v_days := public.compute_requested_days(v_company, p_start, p_end, p_day_part);
  if v_days <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = p_leave_type_id and company_id = v_company and active;
  if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    if v_days > v_balance then
      raise exception 'insufficient balance: % day(s) requested, % available', v_days, v_balance using errcode = '22023';
    end if;
  end if;

  insert into public.leave_requests(employee_id, leave_type_id, start_date, end_date, day_part, requested_days, status, reason)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part, v_days, 'pending', p_reason)
  returning id into v_req;
  return v_req;
end; $$;

-- ---------------------------------------------------------------------------
-- 1+3. approve_leave_request — lock, re-read, overlap + balance re-check
-- ---------------------------------------------------------------------------
create or replace function public.approve_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_type    uuid;
  v_days    numeric;
  v_status  public.leave_status;
  v_start   date;
  v_end     date;
  v_affects boolean;
  v_prev    numeric;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_emp from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;

  -- Serialize with other leave writes for this employee, THEN re-read the row
  -- so status/overlap/balance checks cannot race a concurrent writer.
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_days, status, start_date, end_date
    into v_type, v_days, v_status, v_start, v_end
    from public.leave_requests where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.leave_requests
    where employee_id = v_emp and id <> p_id and status = 'approved'
      and start_date <= v_end and end_date >= v_start
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    if v_days > v_prev then
      raise exception 'insufficient balance: % day(s) requested, % available', v_days, v_prev using errcode = '22023';
    end if;
  end if;

  update public.leave_requests
     set status = 'approved', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  if v_affects then
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_days, balance_after, note)
    values (v_emp, v_type, p_id, 'consumption', -v_days, v_prev - v_days, 'consumption on approval');
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'approve_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'days', v_days, 'affects_balance', coalesce(v_affects, false)));
end; $$;

-- ---------------------------------------------------------------------------
-- 1. allocate_leave — lock before the balance read/write
-- ---------------------------------------------------------------------------
create or replace function public.allocate_leave(
  p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_days numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev numeric; v_alloc uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can allocate leave' using errcode = '42501';
  end if;
  if p_days is null or p_days <= 0 then
    raise exception 'allocation days must be greater than 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  insert into public.leave_allocations(employee_id, leave_type_id, period_start, period_end, allocated_days, created_by)
  values (p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_days, auth.uid())
  returning id into v_alloc;

  v_prev := public.current_leave_balance(p_employee_id, p_leave_type_id);
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_days, balance_after, note)
  values (p_employee_id, p_leave_type_id, 'allocation', p_days, v_prev + p_days, 'allocation');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'allocate_leave', 'leave_allocations', v_alloc,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id, 'days', p_days));
  return v_alloc;
end; $$;

-- ---------------------------------------------------------------------------
-- 1. cancel_leave_request — lock before the reversal read/write
-- ---------------------------------------------------------------------------
create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_days    numeric;
  v_affects boolean;
  v_prev    numeric;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_days
    into v_status, v_start, v_type, v_days
    from public.leave_requests where id = p_id;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > current_date then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_days, balance_after, note)
      values (v_owner, v_type, p_id, 'reversal', v_days, v_prev + v_days, 'reversal on cancel');
    end if;

  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled' using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'cancel_leave_request', 'leave_requests', p_id,
          jsonb_build_object('status_before', v_status, 'days', v_days,
                             'reversed', (v_status = 'approved')));
end; $$;

-- ---------------------------------------------------------------------------
-- 1. set_leave_balance — lock before the adjustment read/write
-- ---------------------------------------------------------------------------
create or replace function public.set_leave_balance(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_target numeric
) returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_current numeric;
  v_ledger uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can set leave balance' using errcode = '42501';
  end if;

  if p_target is null or p_target < 0 then
    raise exception 'target balance must be >= 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target then
    return p_target;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_days, balance_after, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target - v_current, p_target, 'admin balance set')
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous', v_current, 'target', p_target));

  return p_target;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. app_set_user_roles — atomic role replacement with self-lockout guard
-- ---------------------------------------------------------------------------
create or replace function public.app_set_user_roles(
  p_user_id uuid,
  p_roles public.app_role[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_before public.app_role[];
begin
  if not private.is_admin(v_uid) then
    raise exception 'only admins can set roles' using errcode = '42501';
  end if;
  if p_user_id = v_uid and not ('admin' = any (coalesce(p_roles, '{}'))) then
    raise exception 'cannot remove your own admin role' using errcode = '22023';
  end if;

  select coalesce(array_agg(role order by role), '{}') into v_before
    from public.user_roles where user_id = p_user_id;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role)
    select p_user_id, unnest(p_roles)
    on conflict do nothing;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'set_roles', 'user_roles', p_user_id,
          jsonb_build_object('roles', to_jsonb(v_before)),
          jsonb_build_object('roles', to_jsonb(coalesce(p_roles, '{}'))));
end; $$;

revoke execute on function public.app_set_user_roles(uuid, public.app_role[]) from public, anon;
grant  execute on function public.app_set_user_roles(uuid, public.app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app_create_employee — normalize + validate the code, friendlier duplicate
-- ---------------------------------------------------------------------------
create or replace function public.app_create_employee(
  p_employee_code text,
  p_full_name     text,
  p_password      text,
  p_company_id    uuid,
  p_department_id uuid                 default null,
  p_manager_id    uuid                 default null,
  p_roles         public.app_role[]    default array['employee']::public.app_role[],
  p_hire_date     date                 default null,
  p_language_pref text                 default 'fa',
  p_calendar_pref text                 default 'jalali'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := gen_random_uuid();
  v_code  text := lower(btrim(coalesce(p_employee_code, '')));
  v_email text;
  v_role  public.app_role;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can create employees' using errcode = '42501';
  end if;

  -- The code becomes the auth email local-part; restrict it to characters that
  -- form a valid address (latin letters, digits, dot, dash, underscore).
  if v_code !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
    raise exception 'invalid employee code (latin letters, digits, . _ - only)' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where employee_code = v_code) then
    raise exception 'employee code already exists' using errcode = '23505';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
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

  insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id, hire_date, language_pref, calendar_pref)
  values (v_uid, p_company_id, v_code, p_full_name, p_department_id, p_manager_id, p_hire_date, p_language_pref, p_calendar_pref);

  foreach v_role in array p_roles loop
    insert into public.user_roles (user_id, role) values (v_uid, v_role) on conflict do nothing;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'create_employee', 'profiles', v_uid,
          jsonb_build_object('employee_code', v_code, 'full_name', p_full_name, 'roles', to_jsonb(p_roles)));

  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Constraints (dedupe first so they can be created on live data)
-- ---------------------------------------------------------------------------

-- work_settings: exactly one row per company (keep the most recently updated).
delete from public.work_settings ws
 using public.work_settings newer
 where ws.company_id = newer.company_id
   and (newer.updated_at > ws.updated_at
        or (newer.updated_at = ws.updated_at and newer.id > ws.id));
create unique index if not exists work_settings_company_uniq
  on public.work_settings (company_id);

-- holidays: one row per (company, date) — keep the earliest created.
delete from public.holidays h
 using public.holidays keeper
 where h.company_id = keeper.company_id
   and h.holiday_date = keeper.holiday_date
   and (keeper.created_at < h.created_at
        or (keeper.created_at = h.created_at and keeper.id < h.id));
create unique index if not exists holidays_company_date_uniq
  on public.holidays (company_id, holiday_date);

-- ---------------------------------------------------------------------------
-- 7. Hot-path index: latest ledger row per (employee, leave_type)
-- ---------------------------------------------------------------------------
create index if not exists leave_ledger_emp_type_created_idx
  on public.leave_ledger (employee_id, leave_type_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 8. get_my_team_directory — tighten search_path (body already fully qualified)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_team_directory()
returns table (
  profile_id uuid,
  full_name text,
  employee_code text,
  relation text,
  roles public.app_role[],
  department_name_fa text,
  department_name_en text,
  manager_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select id, company_id, department_id, manager_id
    from public.profiles
    where id = auth.uid()
  )
  select
    p.id as profile_id,
    p.full_name,
    p.employee_code,
    case when p.id = me.manager_id then 'manager' else 'teammate' end as relation,
    coalesce(
      array_agg(ur.role order by ur.role) filter (where ur.role is not null),
      array[]::public.app_role[]
    ) as roles,
    d.name_fa as department_name_fa,
    d.name_en as department_name_en,
    mgr.full_name as manager_name
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active = true
   and p.id <> me.id
   and (
     p.id = me.manager_id
     or (me.department_id is not null and p.department_id = me.department_id)
   )
  left join public.user_roles ur on ur.user_id = p.id
  left join public.departments d on d.id = p.department_id
  left join public.profiles mgr on mgr.id = p.manager_id
  group by
    p.id,
    p.full_name,
    p.employee_code,
    me.manager_id,
    d.name_fa,
    d.name_en,
    mgr.full_name
  order by
    case when p.id = me.manager_id then 0 else 1 end,
    p.full_name;
$$;
