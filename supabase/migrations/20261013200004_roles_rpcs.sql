-- FR-55 (4/4): role editor RPCs, role assignment by id, admin transfer, create
-- employee with role ids. Spec: docs/specs/2026-10-07-configurable-roles-design.md
-- (D1, D2, D5, D6, D11, D12, "RPCs"). Also a follow-up from reviewing
-- 20261013200002/200003: has_perm with an unknown level. (The admin branch of the
-- personal-info update policy, once fixed here, now lives in 20261013200003 with
-- main's FR-63 own-row rule.) Review fixes: identity presets need the
-- matching edit power to assign, role_manager depends on leave_balances and
-- calendar (D6), and assignment and transfer lock the same profile rows.

-- ── Task 2 follow-ups ───────────────────────────────────────────────────────
-- An unknown or NULL level is false, never "read". coalesce: a NULL here would
-- make `if not private.has_perm(...)` skip its raise.
create or replace function private.has_perm(uid uuid, p_key text, p_level text default 'edit') returns boolean
    language sql stable security definer set search_path to '' as $$
  select coalesce(private.is_active(uid)
     and private.perm_level(uid, p_key) >= case p_level when 'edit' then 2 when 'read' then 1 end, false);
$$;

-- D6 amendment: a Manager reads every profile, balance and the calendar
-- (private.reads_*), so whoever can make someone a Manager must already read them.
-- Same signature, volatility and grants as 20261013200001; two rows added. (The
-- absences rows are in both: main's board reads leave_requests and profiles
-- through RLS.)
create or replace function private.permission_deps() returns table (key text, key_level text, needs text)
    language sql immutable set search_path to '' as $$
  values
    ('people_create','read','people'), ('passwords','read','people'),
    ('role_manager','read','people'), ('role_manager','read','leave_balances'),
    ('role_manager','read','calendar'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('absences','read','people'), ('absences','read','leave_requests');
$$;

-- ── helpers ─────────────────────────────────────────────────────────────────
create function private.caller_company() returns uuid
    language sql stable security definer set search_path to '' as $$
  select company_id from public.profiles where id = auth.uid() and active;
$$;
revoke all on function private.caller_company() from public, anon;
grant execute on function private.caller_company() to authenticated;

-- ── role editor (D2: admin only; D6, D11, D12) ──────────────────────────────
-- Readable by any active member: the employee forms render the role checkboxes.
create function public.app_list_roles()
returns table (id uuid, system_key text, kind text, name text, holders int, permissions jsonb)
    language sql stable security definer set search_path to '' as $$
  select r.id, r.system_key::text, r.kind, r.name,
         (select count(*)::int from public.user_roles ur join public.profiles p on p.id = ur.user_id
           where ur.role_id = r.id and p.active),
         coalesce((select jsonb_object_agg(rp.permission, rp.level) from public.role_permissions rp
                    where rp.role_id = r.id), '{}'::jsonb)
    from public.roles r
   where r.company_id = private.caller_company()
   order by case r.kind when 'system' then 0 when 'preset' then 1 else 2 end,
            array_position(array['admin','manager','employee','hr','security','finance'], r.system_key::text),
            lower(r.name);
$$;

create function public.app_role_holders(p_role_id uuid)
returns table (user_id uuid, full_name text, personnel_no text)
    language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only the admin can list role holders' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.personnel_no
      from public.user_roles ur join public.profiles p on p.id = ur.user_id
      join public.roles r on r.id = ur.role_id
     where ur.role_id = p_role_id and r.company_id = private.caller_company()
     order by p.personnel_no;
end $$;

create function public.app_save_role(p_id uuid, p_name text, p_permissions jsonb)
returns uuid
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.caller_company();
  v_perms   jsonb := coalesce(p_permissions, '{}'::jsonb);
  v_kind    text;
  v_before  jsonb;
  v_id      uuid := p_id;
  v_name    text := btrim(coalesce(p_name, ''));
  kv        record;
  d         record;
begin
  if not private.is_admin(v_uid) then
    raise exception 'only the admin can edit roles' using errcode = '42501';
  end if;
  if jsonb_typeof(v_perms) <> 'object' then
    raise exception 'permissions must be an object' using errcode = '22023';
  end if;
  for kv in select key, value from jsonb_each(v_perms) loop
    if jsonb_typeof(kv.value) <> 'string'
       or not coalesce(private.permission_allows(kv.key, kv.value #>> '{}'), false) then
      raise exception 'invalid permission % = %', kv.key, kv.value using errcode = '22023';
    end if;
  end loop;
  for d in select * from private.permission_deps() loop
    if v_perms ? d.key
       and (d.key_level = 'read' or v_perms->>d.key = 'edit')
       and not v_perms ? d.needs then
      raise exception '% needs %', d.key, d.needs using errcode = '22023';
    end if;
  end loop;

  if v_id is null then
    if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$' then
      raise exception 'invalid role name' using errcode = '22023';
    end if;
    if exists (select 1 from public.roles where company_id = v_company and lower(name) = lower(v_name)) then
      raise exception 'role name already used' using errcode = '22023';
    end if;
    insert into public.roles (company_id, kind, name) values (v_company, 'custom', v_name)
      returning id into v_id;
    v_before := null;
  else
    select kind into v_kind from public.roles where id = v_id and company_id = v_company for update;
    if v_kind is null then raise exception 'role not found' using errcode = '22023'; end if;
    if v_kind = 'system' then raise exception 'built-in role cannot be edited' using errcode = '22023'; end if;
    if v_kind = 'custom' then
      if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$' then
        raise exception 'invalid role name' using errcode = '22023';
      end if;
      if exists (select 1 from public.roles where company_id = v_company and lower(name) = lower(v_name) and id <> v_id) then
        raise exception 'role name already used' using errcode = '22023';
      end if;
      update public.roles set name = v_name, updated_at = now() where id = v_id;
    else
      -- Presets keep their name (D9); the argument is ignored.
      update public.roles set updated_at = now() where id = v_id;
    end if;
    select coalesce(jsonb_object_agg(permission, level), '{}'::jsonb) into v_before
      from public.role_permissions where role_id = v_id;
    delete from public.role_permissions where role_id = v_id;
  end if;

  insert into public.role_permissions (role_id, permission, level)
    select v_id, key, value #>> '{}' from jsonb_each(v_perms);

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, case when v_before is null then 'role.create' else 'role.update' end, 'roles', v_id,
          v_before, jsonb_build_object('name', (select name from public.roles where id = v_id),
                                       'permissions', v_perms));
  return v_id;
end $$;

create function public.app_delete_role(p_id uuid)
returns table (full_name text, personnel_no text)
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_holders jsonb;
begin
  if not private.is_admin(v_uid) then
    raise exception 'only the admin can delete roles' using errcode = '42501';
  end if;
  select kind into v_kind from public.roles where id = p_id and company_id = private.caller_company() for update;
  if v_kind is null then raise exception 'role not found' using errcode = '22023'; end if;
  if v_kind <> 'custom' then raise exception 'built-in roles cannot be deleted' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'personnel_no', p.personnel_no)
                            order by p.personnel_no), '[]'::jsonb)
    into v_holders
    from public.user_roles ur join public.profiles p on p.id = ur.user_id where ur.role_id = p_id;

  delete from public.user_roles where role_id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'role.delete', 'roles', p_id,
          jsonb_build_object('name', (select name from public.roles where id = p_id), 'holders', v_holders), null);
  delete from public.roles where id = p_id;

  return query select h->>'full_name', h->>'personnel_no' from jsonb_array_elements(v_holders) h;
end $$;

-- ── assignment (D1, D3, D4, D5) ─────────────────────────────────────────────
-- Named apart from app_set_user_roles: a uuid[] overload of it would break
-- PostgREST's resolution by argument names.
create function public.app_set_user_role_ids(p_user_id uuid, p_role_ids uuid[])
returns void
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_is_admin boolean;
  v_admin_id uuid;
  v_before   uuid[];
  v_after    uuid[] := coalesce(p_role_ids, '{}');
  v_changed  uuid;
  v_key      public.app_role;
begin
  -- Serialise with app_transfer_admin, which locks the same profile rows in the
  -- same (id) order: the admin check and v_before below then see a committed
  -- transfer instead of racing it.
  perform 1 from public.profiles where id in (v_uid, p_user_id) order by id for no key update;
  v_company := private.caller_company();
  v_is_admin := private.is_admin(v_uid);

  -- Only role holders reach the per-role checks below; anyone else is refused even
  -- for a call that changes nothing.
  if not v_is_admin
     and not private.has_perm(v_uid, 'role_assign', 'edit')
     and not private.has_perm(v_uid, 'role_manager', 'edit') then
    raise exception 'not allowed to set roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and company_id = v_company) then
    raise exception 'employee not found' using errcode = '42501';
  end if;
  -- Validated here, not left to role_within: the admin skips role_within.
  if exists (select 1 from unnest(v_after) x left join public.roles r on r.id = x
              where r.id is null or r.company_id <> v_company) then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  select id into v_admin_id from public.roles where company_id = v_company and system_key = 'admin';
  select coalesce(array_agg(role_id order by role_id), '{}') into v_before
    from public.user_roles where user_id = p_user_id;

  -- D1: admin moves only by transfer, for everyone, the admin included.
  if (v_admin_id = any (v_before)) <> (v_admin_id = any (v_after)) then
    raise exception 'admin is moved only by Transfer admin' using errcode = '42501';
  end if;

  if not v_is_admin then
    -- D3 + D4 (can_act_on is false on yourself), then D5 per added or removed role.
    if not private.can_act_on(v_uid, p_user_id) then
      raise exception 'not allowed on this employee' using errcode = '42501';
    end if;
    for v_changed in
      (select x from unnest(v_before) x except select x from unnest(v_after) x)
      union
      (select x from unnest(v_after) x except select x from unnest(v_before) x)
    loop
      -- Identity presets: their holders sign approval steps (hr) or the clearance
      -- finance box, so giving one to someone whose password you can reset is
      -- signing as them. It takes the power that edits those signers. Security
      -- signs no step since 20261012120003 (main's approval_steps_role_allowed).
      v_key := (select system_key from public.roles where id = v_changed);
      if not private.role_within(v_changed, v_uid)
         or (v_key = 'hr' and not private.has_perm(v_uid, 'approval_steps', 'edit'))
         or (v_key = 'finance' and not private.has_perm(v_uid, 'clearance', 'edit')) then
        raise exception 'not allowed to give or remove role %', (select name from public.roles where id = v_changed)
          using errcode = '42501';
      end if;
    end loop;
  end if;

  -- Never the admin row, whatever v_before said (D1; belt and braces to the lock).
  delete from public.user_roles where user_id = p_user_id and role_id <> all (v_after)
     and role is distinct from 'admin';
  insert into public.user_roles (user_id, role_id)
    select distinct p_user_id, x from unnest(v_after) x on conflict (user_id, role_id) do nothing;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'set_roles', 'user_roles', p_user_id,
    jsonb_build_object('roles', (select coalesce(jsonb_agg(name order by name), '[]') from public.roles where id = any (v_before))),
    jsonb_build_object('roles', (select coalesce(jsonb_agg(name order by name), '[]') from public.roles where id = any (v_after))));
end $$;

-- Old signature, kept for the deploy window: built-in rows only, custom rows kept,
-- every check delegated to app_set_user_role_ids.
create or replace function public.app_set_user_roles(p_user_id uuid, p_roles public.app_role[])
returns void
    language plpgsql security definer set search_path to '' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(r.id), '{}') into v_ids
    from public.roles r join public.profiles p on p.company_id = r.company_id and p.id = p_user_id
   where r.system_key = any (coalesce(p_roles, '{}'));
  select v_ids || coalesce(array_agg(ur.role_id), '{}') into v_ids
    from public.user_roles ur where ur.user_id = p_user_id and ur.role is null;
  perform public.app_set_user_role_ids(p_user_id, v_ids);
end $$;

-- ── admin transfer (D1) ─────────────────────────────────────────────────────
create function public.app_transfer_admin(p_target uuid, p_personnel_no text, p_password text)
returns void
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Same lock order as app_set_user_role_ids (profile rows, by id).
  perform 1 from public.profiles where id in (v_uid, p_target) order by id for no key update;
  if not private.is_admin(v_uid) then
    raise exception 'only the admin can transfer admin' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users
                  where id = v_uid
                    and encrypted_password = extensions.crypt(coalesce(p_password, ''), encrypted_password)) then
    raise exception 'wrong password' using errcode = '42501';
  end if;
  if p_target = v_uid then
    raise exception 'you already hold admin' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles t join public.profiles c on c.id = v_uid and c.company_id = t.company_id
                  where t.id = p_target and t.active and t.personnel_no = btrim(coalesce(p_personnel_no, ''))) then
    raise exception 'personnel number does not match an active employee' using errcode = '22023';
  end if;

  delete from public.user_roles where user_id = v_uid and role = 'admin';
  insert into public.user_roles (user_id, role) values (p_target, 'admin');
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'admin.transfer', 'user_roles', p_target,
          jsonb_build_object('admin', v_uid), jsonb_build_object('admin', p_target));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.app_list_roles()', 'public.app_role_holders(uuid)',
    'public.app_save_role(uuid, text, jsonb)', 'public.app_delete_role(uuid)',
    'public.app_set_user_role_ids(uuid, uuid[])', 'public.app_set_user_roles(uuid, public.app_role[])',
    'public.app_transfer_admin(uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── create employee with role ids (D1, D5) ──────────────────────────────────
-- Body as in 20261007130001 apart from: the HR branch keys on people_create; admin
-- is refused on every branch; p_role_ids (new, optional) decides the extra roles
-- through app_set_user_role_ids, which applies D4/D5 for non-admins. The old app
-- calls without p_role_ids and keeps working by named arguments.
drop function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text);

create function public.app_create_employee(
  p_personnel_no text, p_full_name text, p_password text, p_company_id uuid,
  p_department_id uuid default null, p_manager_id uuid default null,
  p_roles public.app_role[] default array['employee'::public.app_role],
  p_hire_date date default null, p_language_pref text default 'fa',
  p_calendar_pref text default 'jalali', p_job_title text default null,
  p_role_ids uuid[] default null)
returns uuid
    language plpgsql security definer set search_path to '' as $$
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
    -- p_role_ids, which D5 checks. Checked before the manager branch so someone
    -- holding both gets the wider scope.
    --
    -- The company comes from the caller's own profile rather than the argument,
    -- matching the manager branch: only an admin may name the company.
    select company_id into v_company from public.profiles where id = v_caller;
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := array['employee']::public.app_role[];
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

  -- With role ids, the enum list is just Employee; the ids decide the rest below.
  if p_role_ids is not null then
    v_roles := array['employee']::public.app_role[];
  end if;

  v_uid := private.create_employee_impl(
    v_caller, case when v_admin then 'admin' when v_hr then 'hr' else 'manager' end,
    v_company, v_dept, v_mgr, p_personnel_no, p_full_name, p_password,
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title);

  -- D5 for non-admins (and D1 for everyone) through the assignment RPC. Skipped
  -- when the ids add nothing beyond Employee, so a plain manager still onboards.
  select id into v_emp_role from public.roles where company_id = v_company and system_key = 'employee';
  if p_role_ids is not null
     and exists (select 1 from unnest(p_role_ids) x where x is distinct from v_emp_role) then
    perform public.app_set_user_role_ids(v_uid, p_role_ids || v_emp_role);
  end if;

  -- Manager and HR paths: default quotas immediately, no admin round-trip.
  -- (`not v_admin` is both of them.)
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

revoke all on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[]) from public, anon;
grant execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text, uuid[]) to authenticated;
