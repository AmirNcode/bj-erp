-- =============================================================================
-- Migration: 20260626120002_self_password_change.sql
-- Purpose  : FR-7 — self-service password change for the signed-in user.
--            Verifies the caller's CURRENT password in-DB (crypt) before updating
--            auth.users. Mirrors app_set_employee_password (admin reset) but
--            self-guarded by auth.uid(). No service_role secret (NFR-4).
-- Note     : Advisor lint 0029 (exposed SECURITY DEFINER fn) accepted by design —
--            the in-function auth.uid() + current-password check is the gate.
--            See docs/PERMISSIONS.md.
-- Depends  : pgcrypto in `extensions` schema (used by app_set_employee_password).
-- =============================================================================

create or replace function public.app_change_my_password(p_current text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;

  select (encrypted_password = extensions.crypt(p_current, encrypted_password))
    into v_ok from auth.users where id = v_uid;
  if not coalesce(v_ok, false) then
    raise exception 'current password is incorrect' using errcode = '42501';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_uid;

  insert into public.audit_log(actor_id, action, entity, entity_id)
  values (v_uid, 'change_own_password', 'auth.users', v_uid);
end; $$;

revoke execute on function public.app_change_my_password(text, text) from public, anon;
grant  execute on function public.app_change_my_password(text, text) to authenticated;
