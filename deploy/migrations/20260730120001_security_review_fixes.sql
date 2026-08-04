-- =============================================================================
-- Migration: 20260730120001_security_review_fixes.sql
-- Purpose  : Security/correctness fixes from the 2026-07-30 codebase review.
--
--   1. `profiles.active = false` is now an actual access boundary.  Previously
--      a deactivated account could keep reading its own leave data and submit
--      requests with an existing (or newly issued) Auth session.
--   2. `is_manager_of` now requires the caller to still hold the manager role.
--      Removing that role therefore removes the authority immediately.
--   3. Authenticated clients can no longer forge audit rows.  Directly-written
--      configuration/profile tables are audited by database triggers instead.
--   4. Admin password reset validates length + target existence; the new bulk
--      RPC resets every selected password in one transaction.
--   5. Hourly approval overlap uses the same time-aware predicate as submit.
--   6. Replacement reads reuse the shared predicate and reject inactive callers.
--
-- Idempotent. PostgreSQL 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Active membership and role helpers.
-- ---------------------------------------------------------------------------
create or replace function private.is_active(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.profiles
     where id = uid
       and active
  );
$$;

create or replace function private.has_role(uid uuid, r public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active(uid)
     and exists (
       select 1
         from public.user_roles
        where user_id = uid
          and role = r
     );
$$;

create or replace function private.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(uid, 'admin');
$$;

create or replace function private.is_manager_of(uid uuid, target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(uid, 'manager')
     and exists (
       select 1
         from public.profiles caller
         join public.profiles employee
           on employee.id = target
          and employee.company_id = caller.company_id
        where caller.id = uid
          and employee.manager_id = uid
     );
$$;

create or replace function private.same_team(uid uuid, target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active(uid)
     and exists (
       select 1
         from public.profiles caller
         join public.profiles teammate
           on teammate.id = target
          and teammate.company_id = caller.company_id
          and teammate.department_id = caller.department_id
        where caller.id = uid
          and caller.department_id is not null
     );
$$;

create or replace function private.can_read_all(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin(uid)
      or private.has_role(uid, 'manager')
      or private.has_role(uid, 'security');
$$;

revoke execute on function private.is_active(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_active(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS: an inactive caller sees only their own profile row, which lets the
--    app show/deal with the disabled-account state.  All business data and all
--    writes require an active profile.
-- ---------------------------------------------------------------------------
drop policy if exists "companies_select_authenticated" on public.companies;
create policy "companies_select_authenticated"
  on public.companies for select to authenticated
  using (private.is_active((select auth.uid())));

-- v1 has one seeded company and no runtime company-management feature.  The
-- old admin DELETE policy could cascade through every HR table and orphan Auth
-- accounts, so company lifecycle remains a migration/installer operation.
drop policy if exists "companies_insert_admin" on public.companies;
drop policy if exists "companies_update_admin" on public.companies;
drop policy if exists "companies_delete_admin" on public.companies;
revoke insert, update, delete on public.companies from authenticated;

drop policy if exists "departments_select_authenticated" on public.departments;
create policy "departments_select_authenticated"
  on public.departments for select to authenticated
  using (private.is_active((select auth.uid())));

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      private.is_active((select auth.uid()))
      and (
        private.same_team((select auth.uid()), id)
        or private.can_read_all((select auth.uid()))
      )
    )
  );

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update"
  on public.profiles for update to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      private.is_admin((select auth.uid()))
      or private.is_manager_of((select auth.uid()), id)
      or id = (select auth.uid())
    )
  )
  with check (
    private.is_active((select auth.uid()))
    and (
      private.is_admin((select auth.uid()))
      or private.is_manager_of((select auth.uid()), id)
      or id = (select auth.uid())
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_manager_not_self'
  ) then
    alter table public.profiles
      add constraint profiles_manager_not_self
      check (manager_id is null or manager_id <> id);
  end if;
end
$$;

-- Profile creation must go through app_create_employee so Auth + profile +
-- roles are one transaction and the credential is never orphaned.
drop policy if exists "profiles_insert_admin" on public.profiles;
revoke insert on public.profiles from authenticated;

drop policy if exists "user_roles_select" on public.user_roles;
create policy "user_roles_select"
  on public.user_roles for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      user_id = (select auth.uid())
      or private.can_read_all((select auth.uid()))
    )
  );

-- Role replacement must go through app_set_user_roles: it is atomic, audited,
-- and prevents an admin from accidentally stripping their own last admin role.
drop policy if exists "user_roles_insert_admin" on public.user_roles;
drop policy if exists "user_roles_update_admin" on public.user_roles;
drop policy if exists "user_roles_delete_admin" on public.user_roles;
revoke insert, update, delete on public.user_roles from authenticated;

drop policy if exists "work_settings_select" on public.work_settings;
create policy "work_settings_select"
  on public.work_settings for select to authenticated
  using (private.is_active((select auth.uid())));

drop policy if exists "holidays_select" on public.holidays;
create policy "holidays_select"
  on public.holidays for select to authenticated
  using (private.is_active((select auth.uid())));

drop policy if exists "leave_types_select" on public.leave_types;
create policy "leave_types_select"
  on public.leave_types for select to authenticated
  using (private.is_active((select auth.uid())));

drop policy if exists "leave_allocations_select" on public.leave_allocations;
create policy "leave_allocations_select"
  on public.leave_allocations for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or private.is_manager_of((select auth.uid()), employee_id)
      or private.can_read_all((select auth.uid()))
    )
  );

drop policy if exists "leave_requests_select" on public.leave_requests;
create policy "leave_requests_select"
  on public.leave_requests for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or private.is_manager_of((select auth.uid()), employee_id)
      or private.has_role((select auth.uid()), 'security')
      or private.is_admin((select auth.uid()))
    )
  );

drop policy if exists "leave_ledger_select" on public.leave_ledger;
create policy "leave_ledger_select"
  on public.leave_ledger for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or private.is_manager_of((select auth.uid()), employee_id)
      or private.can_read_all((select auth.uid()))
    )
  );

drop policy if exists "employee_leave_policies_select" on public.employee_leave_policies;
create policy "employee_leave_policies_select"
  on public.employee_leave_policies for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or private.is_manager_of((select auth.uid()), employee_id)
      or private.can_read_all((select auth.uid()))
    )
  );

drop policy if exists "jalali_months_select" on public.jalali_months;
create policy "jalali_months_select"
  on public.jalali_months for select to authenticated
  using (private.is_active((select auth.uid())));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leave_requests_reason_len'
  ) then
    alter table public.leave_requests
      add constraint leave_requests_reason_len
      check (reason is null or length(reason) <= 500);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Audit integrity.  Only owner-run functions/triggers may append audit rows.
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log_insert_self" on public.audit_log;
revoke insert on public.audit_log from authenticated;

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_id     uuid;
begin
  -- Migrations/seed run without an end-user identity and have their own change
  -- history. Avoid filling the runtime audit trail with actor-less replays.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_id := coalesce(
    nullif(v_after->>'id', '')::uuid,
    nullif(v_before->>'id', '')::uuid
  );

  insert into public.audit_log(actor_id, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    lower(tg_op) || '_' || tg_table_name,
    tg_table_name,
    v_id,
    v_before,
    v_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_row_change() from public, anon, authenticated;

drop trigger if exists profiles_audit_update on public.profiles;
create trigger profiles_audit_update
  after update on public.profiles
  for each row execute function private.audit_row_change();

create or replace function private.preserve_active_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.active
     and not new.active
     and exists (
       select 1 from public.user_roles
        where user_id = old.id and role = 'admin'
     )
     and not exists (
       select 1
         from public.profiles p
         join public.user_roles r on r.user_id = p.id and r.role = 'admin'
        where p.active
          and p.id <> old.id
     )
  then
    raise exception 'cannot deactivate the last active admin' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.preserve_active_admin() from public, anon, authenticated;
drop trigger if exists profiles_preserve_active_admin on public.profiles;
create trigger profiles_preserve_active_admin
  before update of active on public.profiles
  for each row execute function private.preserve_active_admin();

drop trigger if exists departments_audit_change on public.departments;
create trigger departments_audit_change
  after insert or update or delete on public.departments
  for each row execute function private.audit_row_change();

drop trigger if exists work_settings_audit_change on public.work_settings;
create trigger work_settings_audit_change
  after insert or update or delete on public.work_settings
  for each row execute function private.audit_row_change();

drop trigger if exists holidays_audit_change on public.holidays;
create trigger holidays_audit_change
  after insert or update or delete on public.holidays
  for each row execute function private.audit_row_change();

drop trigger if exists companies_audit_change on public.companies;
create trigger companies_audit_change
  after insert or update or delete on public.companies
  for each row execute function private.audit_row_change();

drop trigger if exists leave_types_audit_change on public.leave_types;
create trigger leave_types_audit_change
  after insert or update or delete on public.leave_types
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- 4. Password resets: validate in the authority layer and make bulk atomic.
-- ---------------------------------------------------------------------------
create or replace function public.app_set_employee_password(
  p_user_id uuid,
  p_password text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can reset passwords' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_password, '')) > 72 then
    raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_password', 'auth.users', p_user_id);
end;
$$;

create or replace function public.app_bulk_set_employee_passwords(p_resets jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_row   record;
  v_count int;
begin
  if not private.is_admin(v_uid) then
    raise exception 'only admins can reset passwords' using errcode = '42501';
  end if;
  if jsonb_typeof(p_resets) <> 'array' then
    raise exception 'password resets must be an array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_resets);
  if v_count < 1 or v_count > 100 then
    raise exception 'select between 1 and 100 employees' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct item->>'user_id')
      from jsonb_array_elements(p_resets) item
  ) then
    raise exception 'duplicate employee in password reset' using errcode = '22023';
  end if;

  -- Validate the complete payload before changing the first credential.
  for v_row in
    select (item->>'user_id')::uuid as user_id, item->>'password' as password
      from jsonb_array_elements(p_resets) item
  loop
    if v_row.user_id = v_uid then
      raise exception 'cannot bulk-reset your own password' using errcode = '22023';
    end if;
    if length(coalesce(v_row.password, '')) < 8 then
      raise exception 'new password must be at least 8 characters' using errcode = '22023';
    end if;
    if octet_length(coalesce(v_row.password, '')) > 72 then
      raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
    end if;
    if not exists (
      select 1
        from auth.users u
        join public.profiles p on p.id = u.id
       where u.id = v_row.user_id
    ) then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
  end loop;

  for v_row in
    select (item->>'user_id')::uuid as user_id, item->>'password' as password
      from jsonb_array_elements(p_resets) item
  loop
    update auth.users
       set encrypted_password = extensions.crypt(v_row.password, extensions.gen_salt('bf')),
           updated_at = now()
     where id = v_row.user_id;

    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'reset_password', 'auth.users', v_row.user_id);
  end loop;
end;
$$;

create or replace function public.app_change_my_password(p_current text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_new, '')) > 72 then
    raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
  end if;

  select encrypted_password = extensions.crypt(p_current, encrypted_password)
    into v_ok
    from auth.users
   where id = v_uid;
  if not coalesce(v_ok, false) then
    raise exception 'current password is incorrect' using errcode = '42501';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;

  insert into public.audit_log(actor_id, action, entity, entity_id)
  values (v_uid, 'change_own_password', 'auth.users', v_uid);
end;
$$;

revoke execute on function public.app_set_employee_password(uuid, text) from public, anon;
grant execute on function public.app_set_employee_password(uuid, text) to authenticated;
revoke execute on function public.app_bulk_set_employee_passwords(jsonb) from public, anon;
grant execute on function public.app_bulk_set_employee_passwords(jsonb) to authenticated;
revoke execute on function public.app_change_my_password(text, text) from public, anon;
grant execute on function public.app_change_my_password(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Inactive users cannot call employee-facing definer functions.
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid,
  p_start date,
  p_end date,
  p_day_part public.day_part,
  p_reason text default null,
  p_replacement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  return private.submit_leave_impl(
    p_leave_type_id, p_start, p_end, p_day_part, p_reason,
    'day', null, null, p_replacement_id
  );
end;
$$;

create or replace function public.submit_hourly_leave_request(
  p_leave_type_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_reason text default null,
  p_replacement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  return private.submit_leave_impl(
    p_leave_type_id, p_date, p_date, 'full', p_reason,
    'hour', p_start_time, p_end_time, p_replacement_id
  );
end;
$$;

create or replace function public.accrue_my_leave()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_type uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  for v_type in
    select leave_type_id
      from public.employee_leave_policies
     where employee_id = v_uid
  loop
    perform public.accrue_leave(v_uid, v_type);
  end loop;
end;
$$;

create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_minutes int;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
  v_today   date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then raise exception 'account is inactive' using errcode = '42501'; end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes
    into v_status, v_start, v_type, v_minutes
    from public.leave_requests where id = p_id;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > v_today then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      )
      values (
        v_owner, v_type, p_id, 'reversal',
        v_minutes, v_prev + v_minutes, 'reversal on cancel'
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
      'minutes', v_minutes,
      'reversed', (v_status = 'approved')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Shared time-aware replacement predicate on reads.
-- ---------------------------------------------------------------------------
create or replace function public.get_replacement_candidates(
  p_start date,
  p_end date,
  p_unit public.leave_unit default 'day',
  p_start_time time default null,
  p_end_time time default null
) returns table (
  profile_id uuid,
  full_name text,
  employee_code text,
  unavailable boolean,
  unavailable_reason text
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select id, company_id, department_id
      from public.profiles
     where id = auth.uid()
       and active
  )
  select
    p.id,
    p.full_name,
    p.employee_code,
    private.replacement_is_away(
      p.id, p_start, p_end, p_unit, p_start_time, p_end_time
    ) as unavailable,
    case
      when private.replacement_is_away(
        p.id, p_start, p_end, p_unit, p_start_time, p_end_time
      ) then 'on leave'
      else null
    end as unavailable_reason
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
   and p.id <> me.id
   and me.department_id is not null
   and p.department_id = me.department_id
  order by p.full_name;
$$;

create or replace function public.get_my_cover_conflicts(p_start date, p_end date)
returns table (
  request_id uuid,
  employee_name text,
  start_date date,
  end_date date,
  unit public.leave_unit,
  start_time time,
  end_time time
)
language sql stable security definer set search_path = '' as $$
  select r.id, p.full_name, r.start_date, r.end_date, r.unit, r.start_time, r.end_time
    from public.leave_requests r
    join public.profiles p on p.id = r.employee_id
   where private.is_active(auth.uid())
     and r.replacement_id = auth.uid()
     and r.status in ('pending', 'approved')
     and r.start_date <= p_end
     and r.end_date >= p_start
   order by r.start_date;
$$;

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
language sql stable security definer set search_path = '' as $$
  with me as (
    select id, company_id, department_id, manager_id
      from public.profiles
     where id = auth.uid()
       and active
  )
  select
    p.id,
    p.full_name,
    p.employee_code,
    case when p.id = me.manager_id then 'manager' else 'teammate' end,
    coalesce(
      array_agg(ur.role order by ur.role) filter (where ur.role is not null),
      array[]::public.app_role[]
    ),
    d.name_fa,
    d.name_en,
    mgr.full_name
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
   and p.id <> me.id
   and (
     p.id = me.manager_id
     or (me.department_id is not null and p.department_id = me.department_id)
   )
  left join public.user_roles ur on ur.user_id = p.id
  left join public.departments d on d.id = p.department_id
  left join public.profiles mgr on mgr.id = p.manager_id
  group by p.id, p.full_name, p.employee_code, me.manager_id,
           d.name_fa, d.name_en, mgr.full_name
  order by case when p.id = me.manager_id then 0 else 1 end, p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- 7. Hourly-aware approval overlap and active manager enforcement (via the
--    hardened is_manager_of/is_admin helpers above).
-- ---------------------------------------------------------------------------
create or replace function public.approve_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_type    uuid;
  v_minutes int;
  v_status  public.leave_status;
  v_start   date;
  v_end     date;
  v_unit    public.leave_unit;
  v_st      time;
  v_et      time;
  v_repl    uuid;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_emp from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date,
         unit, start_time, end_time, replacement_id
    into v_type, v_minutes, v_status, v_start, v_end, v_unit, v_st, v_et, v_repl
    from public.leave_requests where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.leave_requests r
     where r.employee_id = v_emp
       and r.id <> p_id
       and r.status = 'approved'
       and r.start_date <= v_end
       and r.end_date >= v_start
       and (
         r.unit = 'day'
         or v_unit = 'day'
         or (r.start_time < v_et and r.end_time > v_st)
       )
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  if v_repl is not null
     and private.replacement_is_away(v_repl, v_start, v_end, v_unit, v_st, v_et)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    if v_minutes > v_prev then
      raise exception 'insufficient balance: % minute(s) requested, % available',
        v_minutes, v_prev using errcode = '22023';
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
    insert into public.leave_ledger(
      employee_id, leave_type_id, request_id, entry_type,
      delta_minutes, balance_after_minutes, note
    )
    values (
      v_emp, v_type, p_id, 'consumption',
      -v_minutes, v_prev - v_minutes, 'consumption on approval'
    );
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'approve_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'employee_id', v_emp,
      'minutes', v_minutes,
      'affects_balance', coalesce(v_affects, false),
      'replacement_id', v_repl
    )
  );
end;
$$;

-- Re-assert exposed-function grants after CREATE OR REPLACE.
revoke execute on function public.submit_leave_request(
  uuid, date, date, public.day_part, text, uuid
) from public, anon;
grant execute on function public.submit_leave_request(
  uuid, date, date, public.day_part, text, uuid
) to authenticated;
revoke execute on function public.submit_hourly_leave_request(
  uuid, date, time, time, text, uuid
) from public, anon;
grant execute on function public.submit_hourly_leave_request(
  uuid, date, time, time, text, uuid
) to authenticated;
revoke execute on function public.accrue_my_leave() from public, anon;
grant execute on function public.accrue_my_leave() to authenticated;
revoke execute on function public.cancel_leave_request(uuid) from public, anon;
grant execute on function public.cancel_leave_request(uuid) to authenticated;
revoke execute on function public.get_replacement_candidates(
  date, date, public.leave_unit, time, time
) from public, anon;
grant execute on function public.get_replacement_candidates(
  date, date, public.leave_unit, time, time
) to authenticated;
revoke execute on function public.get_my_cover_conflicts(date, date) from public, anon;
grant execute on function public.get_my_cover_conflicts(date, date) to authenticated;
revoke execute on function public.get_my_team_directory() from public, anon;
grant execute on function public.get_my_team_directory() to authenticated;
revoke execute on function public.approve_leave_request(uuid) from public, anon;
grant execute on function public.approve_leave_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Reason-less calendar view: active callers only, SELECT grant only.
-- ---------------------------------------------------------------------------
drop view if exists public.team_leave_calendar;

create view public.team_leave_calendar as
  select
    lr.id,
    lr.employee_id,
    p.full_name as employee_name,
    p.department_id,
    lr.leave_type_id,
    lt.name_fa as leave_type_name_fa,
    lt.name_en as leave_type_name_en,
    lt.color as leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.unit,
    lr.start_time,
    lr.end_time,
    lr.requested_minutes,
    lr.status
  from public.leave_requests lr
  join public.profiles p on p.id = lr.employee_id
  join public.leave_types lt on lt.id = lr.leave_type_id
  where private.is_active(auth.uid())
    and lr.status in ('pending', 'approved')
    and (
      lr.employee_id = auth.uid()
      or private.same_team(auth.uid(), lr.employee_id)
      or private.can_read_all(auth.uid())
    );

revoke all on public.team_leave_calendar from public, anon, authenticated;
grant select on public.team_leave_calendar to authenticated;

-- Incidental hardening: these helpers are not client APIs.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.jalali_month_of(date) from public, anon;
