-- FR-55 review fix (2026-10-14, Medium 2): one rule for "may this caller reset this
-- person's password", used by both reset RPCs and by the Employees list, so the
-- bulk selection offers only people the database will accept.
--   * private.can_reset_password(caller, target): the admin (any target, the
--     single reset also covers their own password), or passwords edit +
--     can_act_on (D4: never yourself, never the admin, nobody who holds more).
--     The FR-55 account-control decision (review Medium 1) changes this one
--     function.
--   * public.app_password_reset_eligible(ids): which of these people the caller
--     may bulk-reset (yourself excluded, as the bulk RPC refuses it). The UI
--     filters the selection with it; the RPCs below stay authoritative.
--   * app_bulk_set_employee_passwords: the per-target refusal names the employee
--     code when there is no personnel number (the bootstrap admin printed
--     "<NULL>"). Otherwise the bodies are those of 20261013200003.

create function private.can_reset_password(p_caller uuid, p_target uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select coalesce(private.is_admin(p_caller)
     or (private.has_perm(p_caller, 'passwords', 'edit')
         and private.can_act_on(p_caller, p_target)), false);
$$;
revoke all on function private.can_reset_password(uuid, uuid) from public, anon;
grant execute on function private.can_reset_password(uuid, uuid) to authenticated;

create function public.app_password_reset_eligible(p_ids uuid[]) returns setof uuid
    language sql stable security definer set search_path to '' as $$
  select distinct x
    from unnest(coalesce(p_ids, '{}'::uuid[])) x
   where x is distinct from auth.uid()
     and private.can_reset_password(auth.uid(), x);
$$;
revoke all on function public.app_password_reset_eligible(uuid[]) from public, anon;
grant execute on function public.app_password_reset_eligible(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION public.app_set_employee_password(p_user_id uuid, p_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_rows int;
begin
  if not private.can_reset_password(auth.uid(), p_user_id) then
    raise exception 'not allowed to reset this password' using errcode = '42501';
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
  -- A non-admin caller passes the profile guard only with this flag (FR-55).
  perform set_config('bj.password_flag_write', 'on', true);
  update public.profiles
     set must_change_password = (p_user_id <> auth.uid())
   where id = p_user_id;
  perform set_config('bj.password_flag_write', '', true);

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_password', 'auth.users', p_user_id);
end;
$$;

CREATE OR REPLACE FUNCTION public.app_bulk_set_employee_passwords(p_resets jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_row   record;
  v_count int;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'passwords', 'edit')) then
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
    -- FR-55 D4: every target, before the first credential changes.
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

    -- A non-admin caller passes the profile guard only with this flag (FR-55).
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
