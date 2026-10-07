-- First-login password change (FR-50, docs/specs/2026-10-06-first-login-password-design.md).
--
-- An admin-issued password is known to whoever printed it. Until its owner
-- replaces it, the account is flagged and the app shows only the set-password
-- screen. The flag is a UI gate, not an RLS boundary: business access is still
-- governed by roles and private.is_active.

-- 1. The flag. Added with default false so existing accounts are not affected,
--    then defaulted to true so every profile created from now on — single create,
--    bulk import, the installer's admin — starts flagged without each insert
--    path having to remember it.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
alter table public.profiles
  alter column must_change_password set default true;
comment on column public.profiles.must_change_password is
  'True while the account still uses an admin-issued password. Set on creation and by admin resets; cleared only by app_set_initial_password / app_change_my_password.';

-- 2. A user must not be able to clear their own flag with a direct PATCH. Only the
--    two password RPCs may, and they mark the transaction with a setting that
--    clients cannot reach (PostgREST sets only request.* settings).
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
  elsif private.is_manager_of(v_uid, new.id) then
    v_allowed := array['full_name', 'hire_date'];
  else
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.created_at    is distinct from old.created_at)
     or (new.department_id is distinct from old.department_id)
     or (new.manager_id    is distinct from old.manager_id)
     or (new.active        is distinct from old.active)
     or (new.must_change_password is distinct from old.must_change_password
         and coalesce(current_setting('bj.password_flag_write', true), '') <> 'on')
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;

-- 3. Admin resets flag the account again.
create or replace function public.app_set_employee_password(p_user_id uuid, p_password text) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
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

  -- An admin resetting their own password chose it themselves.
  update public.profiles
     set must_change_password = (p_user_id <> auth.uid())
   where id = p_user_id;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_password', 'auth.users', p_user_id);
end;
$$;

create or replace function public.app_bulk_set_employee_passwords(p_resets jsonb) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
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

    update public.profiles
       set must_change_password = true
     where id = v_row.user_id;

    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'reset_password', 'auth.users', v_row.user_id);
  end loop;
end;
$$;

-- 4. A voluntary change from the profile page also clears the flag.
create or replace function public.app_change_my_password(p_current text, p_new text) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
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

  perform set_config('bj.password_flag_write', 'on', true);
  update public.profiles
     set must_change_password = false
   where id = v_uid and must_change_password;
  perform set_config('bj.password_flag_write', '', true);

  insert into public.audit_log(actor_id, action, entity, entity_id)
  values (v_uid, 'change_own_password', 'auth.users', v_uid);
end;
$$;

-- 5. The first-login screen. The person typed the issued password seconds ago
--    to get here, so only the new one is asked for; it must differ from the
--    issued one, which someone else has seen.
create or replace function public.app_set_initial_password(p_new text) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid  uuid := auth.uid();
  v_same boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_uid and must_change_password
  ) then
    raise exception 'password change is not required' using errcode = '22023';
  end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_new, '')) > 72 then
    raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
  end if;

  select encrypted_password = extensions.crypt(p_new, encrypted_password)
    into v_same
    from auth.users
   where id = v_uid;
  if coalesce(v_same, false) then
    raise exception 'new password must differ from the issued password' using errcode = '22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;

  perform set_config('bj.password_flag_write', 'on', true);
  update public.profiles
     set must_change_password = false
   where id = v_uid;
  perform set_config('bj.password_flag_write', '', true);

  insert into public.audit_log(actor_id, action, entity, entity_id)
  values (v_uid, 'set_initial_password', 'auth.users', v_uid);
end;
$$;

revoke execute on function public.app_set_initial_password(text) from public, anon;
grant  execute on function public.app_set_initial_password(text) to authenticated;
