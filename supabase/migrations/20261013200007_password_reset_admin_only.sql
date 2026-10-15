-- FR-55 review decision (Amir, 2026-10-14, Medium 1): password resets stay
-- admin-only for now. A delegated reset let one person sign in as an equal peer
-- and act on their own record through them (D3), and a reciprocal check did not
-- close the alternate paths (inactive peers, reset-then-promote, one's own
-- approver). The account-control policy (D13 / Tier 2 in the review) is deferred.
-- Impersonation through credentials a non-admin issues when CREATING an employee
-- is NOT closed by this migration: every creator still chooses the initial
-- password (TASKS, FR-55 follow-ups).
--
--   * The catalog loses the `passwords` item: permission_keys, permission_allows
--     (so the role_permissions CHECK and app_save_role refuse it) and
--     permission_deps. Stored grants are deleted. Neither the token hook nor
--     app_my_permissions reports it any more (both read permission_keys).
--   * private.can_reset_password (20261013200006) becomes the admin alone, so
--     app_set_employee_password and app_password_reset_eligible follow; the bulk
--     RPC's entry gate is admin-only as well.
--   * private.enforce_profile_update_scope drops the `passwords` branch: no
--     non-admin may flip must_change_password, whatever role rows say.
--   * perm_level and role_within read only rows the catalog allows, so a
--     `passwords` row that survived somehow (a restore, a hand-made row) counts
--     for nothing anywhere, and no reset path consults it.

-- ── catalog: 19 items ───────────────────────────────────────────────────────
create or replace function private.permission_keys() returns setof text
    language sql immutable set search_path to '' as $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','absences','approval_steps','work_settings',
    'holidays','finance']);
$$;

create or replace function private.permission_allows(p_key text, p_level text) returns boolean
    language sql immutable set search_path to '' as $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
                   'personal_info_own','special_leave')
      then p_level = 'edit'
    when p_key in ('calendar','reports','absences','finance') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
                   'leave_requests','approval_steps','work_settings','holidays')
      then p_level in ('read','edit')
    else false
  end;
$$;

-- 20261013200004's list without ('passwords','read','people').
create or replace function private.permission_deps() returns table (key text, key_level text, needs text)
    language sql immutable set search_path to '' as $$
  values
    ('people_create','read','people'),
    ('role_manager','read','people'), ('role_manager','read','leave_balances'),
    ('role_manager','read','calendar'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('absences','read','people'), ('absences','read','leave_requests'),
    ('special_leave','read','people'), ('special_leave','read','leave_balances');
$$;

-- Stored grants go (none on a deploy that never ran the FR-55 editor; a restore
-- would otherwise trip the CHECK above). Audited like a role edit.
insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
select null, 'role.update', 'roles', rp.role_id,
       jsonb_build_object('permissions', jsonb_build_object('passwords', rp.level)),
       jsonb_build_object('note', 'passwords removed: password resets are admin-only (20261013200007)')
  from public.role_permissions rp
 where rp.permission = 'passwords';
delete from public.role_permissions where permission = 'passwords';

-- A role_permissions row the current catalog does not allow (a stored
-- `passwords` grant that survived, or any future retired item) counts for
-- nothing: perm_level reads catalog-valid rows only, so has_perm, can_act_on,
-- the claims and app_my_permissions ignore it, and role_within skips it.
-- Bodies of 20261013200002 apart from the permission_allows filter.
create or replace function private.perm_level(uid uuid, p_key text) returns int
    language sql stable security definer set search_path to '' as $$
  -- Ignores `active` on purpose: a deactivated holder keeps their latent levels,
  -- so someone weaker cannot reactivate them (D4). Callers add is_active.
  select case
    when exists (select 1 from public.user_roles where user_id = uid and role = 'admin') then
      case when private.permission_allows(p_key, 'edit') then 2
           when private.permission_allows(p_key, 'read') then 1 else 0 end
    else coalesce((
      select max(case rp.level when 'edit' then 2 else 1 end)
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = uid and rp.permission = p_key
         and private.permission_allows(rp.permission, rp.level)), 0)
  end;
$$;

create or replace function private.role_within(p_role_id uuid, p_uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select coalesce((
    select case r.system_key
      when 'admin' then false
      when 'manager' then private.has_perm(p_uid, 'role_manager', 'edit')
      else private.has_perm(p_uid, 'role_assign', 'edit')
           and not exists (
             select 1 from public.role_permissions rp
              where rp.role_id = r.id
                and private.permission_allows(rp.permission, rp.level)
                and case rp.level when 'edit' then 2 else 1 end > private.perm_level(p_uid, rp.permission)
                -- As in can_act_on: personal_info edit covers the self-only personal_info_own.
                and not (rp.permission = 'personal_info_own'
                         and private.perm_level(p_uid, 'personal_info') >= 2))
    end
      from public.roles r
      join public.profiles u on u.id = p_uid and u.company_id = r.company_id
     where r.id = p_role_id), false);
$$;

-- ── resets: the admin only ──────────────────────────────────────────────────
-- Same signature and grants as 20261013200006. p_target is kept so the
-- account-control decision can widen this again in one place.
create or replace function private.can_reset_password(p_caller uuid, p_target uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select coalesce(private.is_admin(p_caller), false);
$$;

-- Body of 20261013200006 with an admin-only entry gate.
CREATE OR REPLACE FUNCTION public.app_bulk_set_employee_passwords(p_resets jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_row   record;
  v_count int;
begin
  if not private.is_admin(v_uid) then
    raise exception 'not allowed to reset passwords' using errcode = '42501';
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
    if not private.can_reset_password(v_uid, v_row.user_id) then
      raise exception 'not allowed on %',
        (select coalesce(personnel_no, employee_code) from public.profiles where id = v_row.user_id)
        using errcode = '42501';
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

    perform set_config('bj.password_flag_write', 'on', true);
    update public.profiles
       set must_change_password = true
     where id = v_row.user_id;
    perform set_config('bj.password_flag_write', '', true);

    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'reset_password', 'auth.users', v_row.user_id);
  end loop;
end;
$$;

-- Body of 20261013200003 without the `passwords` branch.
CREATE OR REPLACE FUNCTION private.enforce_profile_update_scope() RETURNS trigger
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
    v_allowed := array['full_name', 'language_pref', 'calendar_pref'];
  elsif private.has_perm(v_uid, 'people', 'edit')
        -- FR-55 D4: same company, never an admin (even a deactivated one, so an
        -- editor cannot reactivate one), and nothing the editor does not hold.
        and private.can_act_on(v_uid, old.id)
  then
    v_allowed := array['full_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  elsif private.is_manager_of(v_uid, new.id) then
    v_allowed := array['full_name', 'hire_date'];
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
