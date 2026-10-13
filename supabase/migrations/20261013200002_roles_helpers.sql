-- FR-55 (2/4): permission helpers, the subset rule, the legacy alias, the token claim.
-- Spec: docs/specs/2026-10-07-configurable-roles-design.md (D1-D7, "Helpers", "Token hook").
-- Also closes two gaps found reviewing 20261013200001: permission rows on system
-- roles, and a silent overwrite of user_roles.role on UPDATE.

-- ── Task 1 follow-ups ───────────────────────────────────────────────────────
-- Permission rows belong on preset and custom roles only. A row on Employee would
-- grant it to everyone; one on Admin or Manager would mean nothing but mislead.
create function private.role_permissions_guard() returns trigger
    language plpgsql security definer set search_path to '' as $$
begin
  if (select kind from public.roles where id = new.role_id) = 'system' then
    raise exception 'permission rows belong on preset and custom roles only' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.role_permissions_guard() from public, anon, authenticated;
create trigger role_permissions_guard before insert or update on public.role_permissions
  for each row execute function private.role_permissions_guard();

-- role_id is the source of truth: an UPDATE that changes only the enum would be
-- overwritten from role_id, so refuse it instead of pretending it worked.
create or replace function private.user_roles_sync() returns trigger
    language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := (select company_id from public.profiles where id = new.user_id);
  v_role_company uuid;
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role
     and new.role_id is not distinct from old.role_id then
    raise exception 'change role_id, not role' using errcode = '22023';
  end if;
  if new.role_id is null then
    if new.role is null then
      raise exception 'role or role_id required' using errcode = '23502';
    end if;
    select id into new.role_id from public.roles
     where company_id = v_company and system_key = new.role;
    if new.role_id is null then
      raise exception 'no % role for this company', new.role using errcode = '23503';
    end if;
  else
    select system_key, company_id into new.role, v_role_company from public.roles where id = new.role_id;
    if v_role_company is distinct from v_company then
      raise exception 'role belongs to another company' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ── levels ──────────────────────────────────────────────────────────────────
create function private.perm_level(uid uuid, p_key text) returns int
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
       where ur.user_id = uid and rp.permission = p_key), 0)
  end;
$$;

create function private.has_perm(uid uuid, p_key text, p_level text default 'edit') returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.is_active(uid)
     and private.perm_level(uid, p_key) >= case p_level when 'edit' then 2 else 1 end;
$$;

create function private.reads_people(uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.has_role(uid, 'manager') or private.has_perm(uid, 'people', 'read');
$$;
create function private.reads_balances(uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.has_role(uid, 'manager') or private.has_perm(uid, 'leave_balances', 'read');
$$;
create function private.reads_calendar(uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.has_role(uid, 'manager') or private.has_perm(uid, 'calendar', 'read');
$$;

-- ── D4: the subset rule ─────────────────────────────────────────────────────
-- Admin callers never reach this: every call site checks is_admin first.
create function private.can_act_on(p_caller uuid, p_target uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select p_caller is distinct from p_target
     and private.is_active(p_caller)
     and exists (select 1 from public.profiles t
                   join public.profiles c on c.id = p_caller and c.company_id = t.company_id
                  where t.id = p_target)
     and not exists (select 1 from public.user_roles where user_id = p_target and role = 'admin')
     and not exists (select 1 from private.permission_keys() k
                      where private.perm_level(p_target, k) > private.perm_level(p_caller, k))
     and (not exists (select 1 from public.user_roles where user_id = p_target and role = 'manager')
          or private.has_perm(p_caller, 'role_manager', 'edit'))
     and (not exists (select 1 from public.departments where manager_id = p_target)
          or private.has_perm(p_caller, 'departments', 'edit'))
     -- Identity powers: whoever could reset this person's password could sign in
     -- as them and fill their approval steps or clearance boxes. Role rows are
     -- checked active or not, like the admin row above. Security is not here:
     -- since 20261012120003 an approval step may name manager, hr or a person only.
     and (not (exists (select 1 from public.user_roles
                        where user_id = p_target and role = 'hr')
               or exists (select 1 from public.approval_steps
                           where approver_id = p_target and active))
          or private.has_perm(p_caller, 'approval_steps', 'edit'))
     and (not (exists (select 1 from public.user_roles where user_id = p_target and role = 'finance')
               or exists (select 1 from public.separation_units where signer_id = p_target)
               or exists (select 1 from public.separation_signoffs o
                            join public.separations s on s.id = o.separation_id
                           where o.signer_id = p_target
                             and s.status in ('in_progress', 'awaiting_finance')))
          or private.has_perm(p_caller, 'clearance', 'edit'));
$$;

-- ── D5: may p_uid add or remove this role? ──────────────────────────────────
-- False for an unknown or NULL role id and for a role of another company.
create function private.role_within(p_role_id uuid, p_uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select coalesce((
    select case r.system_key
      when 'admin' then false
      when 'manager' then private.has_perm(p_uid, 'role_manager', 'edit')
      else private.has_perm(p_uid, 'role_assign', 'edit')
           and not exists (
             select 1 from public.role_permissions rp
              where rp.role_id = r.id
                and case rp.level when 'edit' then 2 else 1 end > private.perm_level(p_uid, rp.permission))
    end
      from public.roles r
      join public.profiles u on u.id = p_uid and u.company_id = r.company_id
     where r.id = p_role_id), false);
$$;

-- Legacy keys (FR-51..54 and FR-56..63 call sites), kept for the deploy window;
-- dropped next release. Replaces main's body (20261012130001): its four keys
-- answer from the catalog too. settings.edit is main's one switch for work hours,
-- days off, hourly cap and holidays, so it needs both items.
create or replace function private.has_permission(uid uuid, p_permission text) returns boolean
    language sql stable security definer set search_path to '' as $$
  select case p_permission
    when 'employees.edit'     then private.has_perm(uid, 'people', 'edit')
    when 'departments.edit'   then private.has_perm(uid, 'departments', 'edit')
    when 'accruals.run'       then private.has_perm(uid, 'leave_accrual', 'edit')
    when 'roles.manager'      then private.has_perm(uid, 'role_manager', 'edit')
    when 'personal_info.view' then private.has_perm(uid, 'personal_info', 'read')
    when 'personal_info.edit' then private.has_perm(uid, 'personal_info', 'edit')
    when 'personal_info.edit_own' then private.has_perm(uid, 'personal_info_own', 'edit')
    when 'separations.manage' then private.has_perm(uid, 'clearance', 'edit')
    when 'separations.view'   then private.has_perm(uid, 'clearance', 'read')
    when 'settings.edit'      then private.has_perm(uid, 'work_settings', 'edit')
                                   and private.has_perm(uid, 'holidays', 'edit')
    when 'absences.view'      then private.has_perm(uid, 'absences', 'read')
    when 'finance.view'       then private.has_perm(uid, 'finance', 'read')
    else false
  end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.perm_level(uuid, text)', 'private.has_perm(uuid, text, text)',
    'private.reads_people(uuid)', 'private.reads_balances(uuid)', 'private.reads_calendar(uuid)',
    'private.can_act_on(uuid, uuid)', 'private.role_within(uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The token hook runs as supabase_auth_admin.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.perm_level(uuid, text), private.permission_keys(),
  private.permission_allows(text, text) to supabase_auth_admin;
grant select (active) on public.profiles to supabase_auth_admin;

create function public.app_my_permissions() returns jsonb
    language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_object_agg(k, case l when 2 then 'edit' else 'read' end), '{}'::jsonb)
    from (select k, private.perm_level(auth.uid(), k) l from private.permission_keys() k) s
   where l > 0 and private.is_active(auth.uid());
$$;
revoke all on function public.app_my_permissions() from public, anon;
grant execute on function public.app_my_permissions() to authenticated;

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
    language plpgsql stable set search_path to '' as $$
declare
  v_uid    uuid := (event->>'user_id')::uuid;
  v_active boolean;
  claims   jsonb;
  roles    jsonb;
  perms    jsonb;
  locale   text;
begin
  select p.active, p.language_pref into v_active, locale from public.profiles p where p.id = v_uid;
  v_active := coalesce(v_active, false);

  select coalesce(jsonb_agg(role order by role), '[]'::jsonb) into roles
    from public.user_roles where user_id = v_uid and role is not null and v_active;

  select coalesce(jsonb_object_agg(k, case l when 2 then 'edit' else 'read' end), '{}'::jsonb) into perms
    from (select k, private.perm_level(v_uid, k) l from private.permission_keys() k) s
   where l > 0 and v_active;

  claims := jsonb_set(coalesce(event->'claims', '{}'::jsonb), '{app_roles}', roles);
  claims := jsonb_set(claims, '{app_perms}', perms);
  -- Constrain to the locales the app routes (see the previous definition's note).
  claims := jsonb_set(claims, '{app_locale}',
    to_jsonb(case when locale in ('fa', 'en') then locale else 'fa' end));
  return jsonb_set(event, '{claims}', claims);
end;
$$;
