-- A "change" to the same password cleared must_change_password while keeping the
-- issued password (found in the 2026-10-06 security review of 20261006120004).
-- Refuse new = current. Body otherwise copied from 20261006120004.
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
  if p_new = p_current then
    raise exception 'new password must differ from the current password' using errcode = '22023';
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
