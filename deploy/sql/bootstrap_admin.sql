-- =============================================================================
-- deploy/sql/bootstrap_admin.sql — create the first admin account.
--
-- Every other account is created from inside the app (app_create_employee,
-- which requires an admin caller) — so the very first admin must be seeded
-- directly. This mirrors app_create_employee's insert exactly (auth.users +
-- auth.identities + profile + role) so GoTrue accepts the password login.
--
-- Run via install.sh. The password arrives in the short-lived psql process
-- environment, not a command argument or log; \getenv copies it into a psql
-- variable. (psql vars do not reach DO bodies — bridged via set_config.)
-- Idempotent: no-op when the admin user already exists.
-- =============================================================================

\getenv admin_password BJ_ADMIN_PASSWORD
-- \gset swallows the SELECT output — the password must not echo to the terminal.
select set_config('bj.admin_password', :'admin_password', false) as _pw_set \gset

do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_email text := 'admin@bj-app.internal';
  v_pass  text := current_setting('bj.admin_password');
begin
  if length(v_pass) < 8 then
    raise exception 'admin password must be at least 8 characters';
  end if;

  if exists (select 1 from auth.users where email = v_email) then
    raise notice 'admin already exists — skipping';
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(v_pass, extensions.gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into public.profiles (id, company_id, employee_code, full_name)
  values (v_uid, '00000000-0000-0000-0000-0000000000c0', 'admin', 'مدیر سیستم');

  insert into public.user_roles (user_id, role) values (v_uid, 'admin');

  raise notice 'admin created (code: admin)';
end $$;
