-- =============================================================================
-- Migration: 20260623120004_admin_fns.sql
-- Purpose  : Privileged, admin-guarded functions for runtime user management.
-- Why       : Creating an auth user (auth.users + auth.identities + password)
--             requires privileges the `authenticated` role does not have. Rather
--             than ship a service_role secret into the app server, we expose a
--             SECURITY DEFINER RPC that performs the work in-database and guards
--             itself with private.is_admin(auth.uid()). Fully portable to a
--             self-hosted Supabase (no extra secret to manage).
--
-- NOTE: these two functions are intentionally callable by `authenticated` via
--       PostgREST RPC (the admin UI calls them). They self-guard: a non-admin
--       caller gets an exception. The Supabase advisor flags exposed
--       SECURITY DEFINER functions (lint 0029) — accepted here BY DESIGN for
--       these two, because the in-function admin check is the intended gate.
-- =============================================================================

-- Create an employee: auth user (+ identity, hashed password, blank token cols
-- so GoTrue can read the row) + profile + roles + audit. Returns new user id.
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
  v_email text := lower(trim(p_employee_code)) || '@bj-app.internal';
  v_role  public.app_role;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can create employees' using errcode = '42501';
  end if;

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
  values (v_uid, p_company_id, p_employee_code, p_full_name, p_department_id, p_manager_id, p_hire_date, p_language_pref, p_calendar_pref);

  foreach v_role in array p_roles loop
    insert into public.user_roles (user_id, role) values (v_uid, v_role) on conflict do nothing;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'create_employee', 'profiles', v_uid,
          jsonb_build_object('employee_code', p_employee_code, 'full_name', p_full_name, 'roles', to_jsonb(p_roles)));

  return v_uid;
end;
$$;

-- Admin resets an employee's password (no email channel for labourers).
create or replace function public.app_set_employee_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can reset passwords' using errcode = '42501';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_password', 'auth.users', p_user_id);
end;
$$;

-- Only signed-in admins reach these (anon revoked; authenticated allowed, self-guarded).
revoke execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text) from public, anon;
revoke execute on function public.app_set_employee_password(uuid, text) from public, anon;
grant execute on function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text) to authenticated;
grant execute on function public.app_set_employee_password(uuid, text) to authenticated;
