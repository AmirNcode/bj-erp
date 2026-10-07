-- FR-51: hr administers employees and departments.
--
-- hr may now, on anyone except an admin and never on their own record: edit name,
-- hire date, department, direct manager and job title; deactivate and reactivate;
-- add or remove the `manager` role. hr may also create departments, rename them,
-- set their manager, and post monthly accruals. Spec:
-- docs/specs/2026-10-07-hr-employee-admin-design.md.
--
-- Every new grant goes through private.has_permission so the planned
-- admin-configurable roles (docs/TASKS.md) can replace its body with a table
-- lookup instead of rewriting each policy.
--
-- Also closes a gap: the profile guard never checked job_title or personnel_no,
-- so an employee could change their own (and a manager a report's) through
-- PostgREST.
--
-- Only widens access; the app version still running during the deploy keeps working.

-- ── the permission seam ─────────────────────────────────────────────────────
create or replace function private.has_permission(uid uuid, p_permission text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select case p_permission
    when 'employees.edit'   then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'departments.edit' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'accruals.run'     then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'roles.manager'    then private.is_admin(uid) or private.has_role(uid, 'hr')
    else false
  end;
$$;

revoke all on function private.has_permission(uuid, text) from public, anon;
grant execute on function private.has_permission(uuid, text) to authenticated;

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (
    private.is_active((select auth.uid()))
    and (private.is_admin((select auth.uid()))
         or private.has_permission((select auth.uid()), 'employees.edit')
         or private.is_manager_of((select auth.uid()), id)
         or id = (select auth.uid()))
  )
  with check (
    private.is_active((select auth.uid()))
    and (private.is_admin((select auth.uid()))
         or private.has_permission((select auth.uid()), 'employees.edit')
         or private.is_manager_of((select auth.uid()), id)
         or id = (select auth.uid()))
  );

-- Column scope (RLS is row-level only). Branch order matters: self first, so an
-- editor on their own record gets only the self subset.
create or replace function private.enforce_profile_update_scope() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    v_allowed := array['full_name', 'language_pref', 'calendar_pref'];
  elsif private.has_permission(v_uid, 'employees.edit')
        and old.company_id = (select company_id from public.profiles where id = v_uid)
        -- An admin's record is admin-only, even while that admin is deactivated
        -- (so an editor cannot reactivate one): check the role row, not is_admin.
        and not exists (select 1 from public.user_roles where user_id = old.id and role = 'admin')
  then
    v_allowed := array['full_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  elsif private.is_manager_of(v_uid, new.id) then
    v_allowed := array['full_name', 'hire_date'];
  else
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

-- ── departments ─────────────────────────────────────────────────────────────
drop policy departments_insert_admin on public.departments;
create policy departments_insert_editor on public.departments for insert to authenticated
  with check (private.has_permission((select auth.uid()), 'departments.edit'));

drop policy departments_update_admin on public.departments;
create policy departments_update_editor on public.departments for update to authenticated
  using (private.has_permission((select auth.uid()), 'departments.edit'))
  with check (private.has_permission((select auth.uid()), 'departments.edit'));

-- Non-admin editors change names and the manager only. `code` is the bulk-import
-- key and stays admin-only after creation; delete stays admin-only (policy unchanged).
create or replace function private.enforce_department_update_scope() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  if private.is_admin(auth.uid()) then
    return new;
  end if;
  if (new.id         is distinct from old.id)
     or (new.company_id is distinct from old.company_id)
     or (new.code       is distinct from old.code)
     or (new.kind       is distinct from old.kind)
     or (new.created_at is distinct from old.created_at)
  then
    raise exception 'not permitted to modify restricted department fields' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger departments_enforce_update_scope
  before update on public.departments
  for each row execute function private.enforce_department_update_scope();

-- ── roles ───────────────────────────────────────────────────────────────────
-- Admin path unchanged. A `roles.manager` holder may only add or remove `manager`,
-- on a same-company non-admin who is not themselves.
create or replace function public.app_set_user_roles(p_user_id uuid, p_roles public.app_role[]) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid    uuid := auth.uid();
  v_before public.app_role[];
  v_after  public.app_role[] := coalesce(p_roles, '{}');
begin
  select coalesce(array_agg(role order by role), '{}') into v_before
    from public.user_roles where user_id = p_user_id;

  if private.is_admin(v_uid) then
    if p_user_id = v_uid and not ('admin' = any (v_after)) then
      raise exception 'cannot remove your own admin role' using errcode = '22023';
    end if;
  elsif private.has_permission(v_uid, 'roles.manager') then
    if p_user_id = v_uid then
      raise exception 'you cannot change your own roles' using errcode = '42501';
    end if;
    if not exists (
      select 1
        from public.profiles t
        join public.profiles c on c.id = v_uid and c.company_id = t.company_id
       where t.id = p_user_id
    ) then
      raise exception 'employee not found' using errcode = '42501';
    end if;
    if 'admin' = any (v_before) then
      raise exception 'only admins can change an admin''s roles' using errcode = '42501';
    end if;
    if exists (
      (select r from unnest(v_before) r except select r from unnest(v_after) r)
      union
      (select r from unnest(v_after) r except select r from unnest(v_before) r)
      except select 'manager'::public.app_role
    ) then
      raise exception 'only the manager role may be added or removed' using errcode = '42501';
    end if;
  else
    raise exception 'only admins can set roles' using errcode = '42501';
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role)
    select p_user_id, unnest(v_after)
    on conflict do nothing;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'set_roles', 'user_roles', p_user_id,
          jsonb_build_object('roles', to_jsonb(v_before)),
          jsonb_build_object('roles', to_jsonb(v_after)));
end; $$;

-- ── monthly accrual ─────────────────────────────────────────────────────────
-- Body copied from schema.sql; only the guard changed.
create or replace function public.accrue_all_leave() returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_p            record;
  v_employees    int := 0;
  v_rows_before  int;
  v_rows_after   int;
  v_last_emp     uuid;
begin
  if not private.has_permission(auth.uid(), 'accruals.run') then
    raise exception 'not allowed to post accruals' using errcode = '42501';
  end if;

  select count(*) into v_rows_before from public.leave_ledger where period_month is not null;

  for v_p in
    select p.employee_id, p.leave_type_id
      from public.employee_leave_policies p
      join public.profiles pr on pr.id = p.employee_id
     where pr.active
       and p.accrual_minutes_per_month > 0
     order by p.employee_id
  loop
    perform public.accrue_leave(v_p.employee_id, v_p.leave_type_id);
    if v_last_emp is null or v_last_emp <> v_p.employee_id then
      v_employees := v_employees + 1;
      v_last_emp := v_p.employee_id;
    end if;
  end loop;

  select count(*) into v_rows_after from public.leave_ledger where period_month is not null;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'accrue_all_leave', 'leave_ledger', null,
          jsonb_build_object('employees', v_employees, 'rows_posted', v_rows_after - v_rows_before));

  return jsonb_build_object('employees', v_employees, 'rows_posted', v_rows_after - v_rows_before);
end; $$;
