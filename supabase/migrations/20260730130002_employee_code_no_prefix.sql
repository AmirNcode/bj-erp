-- =============================================================================
-- Migration: 20260730130002_employee_code_no_prefix.sql
-- Purpose  : Employee login codes lose the department prefix.
--
-- Spec: docs/specs/2026-07-30-work-errand-and-login-codes-design.md §6.
-- Supersedes the formula from 20260713120001_employee_onboarding.sql:
--
--     employee_code := departments.code || '-' || personnel_no   -- prod-1042
--     employee_code := personnel_no                              -- 1042  (now)
--
-- The synthetic auth email follows it (1042@bj-app.internal).
--
--   1) private.create_employee_impl — same body as 20260713120001 (the live
--      definition; …130004 only calls it, it never redefined it), with the one
--      composition line changed. The department stays REQUIRED and still
--      validated: it drives team scoping, manager defaults and directory reads.
--      It simply stops contributing to the code. Every other validation, error
--      string, errcode, the auth.users / auth.identities inserts, the roles
--      loop and the audit row are preserved verbatim.
--
--   2) public.app_cleanup_e2e_users — the reap pattern is widened. New test
--      accounts in the reserved 999####### personnel range now produce a BARE
--      code, which '^[a-z0-9]{2,6}-999[0-9]{7}$' can never match; without this
--      every future e2e run would leave rows behind on the client's own
--      database, which is where e2e runs. Both patterns are kept so accounts
--      created before this migration still reap. The authoritative definition
--      is the one from 20260713120001 (it supersedes 20260702140000_e2e_
--      cleanup_fn.sql, which is older and lacks the generated-code pattern);
--      that body is recreated here with the extra alternative.
--
-- NO BACKFILL. Existing accounts keep prod-1042 and keep logging in — the login
-- field accepts any latin code. The mixed old/new state is permanent (D11).
--
-- Idempotent. PostgreSQL 15. Apply as supabase_admin. Rollback = restore the
-- previous function bodies; only behaviour changes, no schema is touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. private.create_employee_impl — the one place accounts are made.
--    employee_code = personnel_no (no department prefix).
-- ---------------------------------------------------------------------------
create or replace function private.create_employee_impl(
  p_actor         uuid,
  p_path          text,
  p_company_id    uuid,
  p_department_id uuid,
  p_manager_id    uuid,
  p_personnel_no  text,
  p_full_name     text,
  p_password      text,
  p_roles         public.app_role[],
  p_hire_date     date,
  p_language_pref text,
  p_calendar_pref text,
  p_job_title     text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := gen_random_uuid();
  v_pno       text := btrim(coalesce(p_personnel_no, ''));
  v_dept_code text;
  v_code      text;
  v_email     text;
  v_role      public.app_role;
begin
  if v_pno !~ '^[0-9]{1,10}$' then
    raise exception 'invalid personnel number (1-10 digits)' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'full name is required' using errcode = '22023';
  end if;
  if p_department_id is null then
    raise exception 'department is required' using errcode = '22023';
  end if;

  -- The department no longer feeds the code, but it must still exist and
  -- belong to this company: it scopes the team and defaults the manager.
  select code into v_dept_code
    from public.departments
   where id = p_department_id and company_id = p_company_id;
  if v_dept_code is null then
    raise exception 'department not found' using errcode = '22023';
  end if;

  v_code := v_pno;
  if exists (select 1 from public.profiles where company_id = p_company_id and personnel_no = v_pno) then
    raise exception 'personnel number already exists' using errcode = '23505';
  end if;
  -- employee_code uniqueness is GLOBAL, not per company. With bare numbers a
  -- second tenant's 1042 would collide; see the spec §6 for the multi-tenant
  -- cost this knowingly takes on.
  if exists (select 1 from public.profiles where employee_code = v_code) then
    raise exception 'employee code already exists' using errcode = '23505';
  end if;

  v_email := v_code || '@bj-app.internal';

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

  insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id,
                               hire_date, language_pref, calendar_pref, personnel_no, job_title)
  values (v_uid, p_company_id, v_code, btrim(p_full_name), p_department_id, p_manager_id,
          p_hire_date, coalesce(p_language_pref, 'fa'), coalesce(p_calendar_pref, 'jalali'),
          v_pno, nullif(btrim(coalesce(p_job_title, '')), ''));

  foreach v_role in array p_roles loop
    insert into public.user_roles (user_id, role) values (v_uid, v_role) on conflict do nothing;
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'create_employee', 'profiles', v_uid,
          jsonb_build_object('employee_code', v_code, 'personnel_no', v_pno,
                             'full_name', p_full_name, 'roles', to_jsonb(p_roles), 'path', p_path));

  return v_uid;
end; $$;

revoke all on function private.create_employee_impl(uuid, text, uuid, uuid, uuid, text, text, text, public.app_role[], date, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. e2e cleanup — reap bare 999####### codes as well as the old prefixed
--    ones. Patterns stay HARDCODED so the function can never touch a real
--    account; admin-only via the standard in-DB guard; deletions are audited.
-- ---------------------------------------------------------------------------
create or replace function public.app_cleanup_e2e_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_admin(v_uid) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  with junk as (
    select id from public.profiles
    where employee_code ~ '^(mgr|emp|cxl|auth|peer|lv|non|ov|e2e|set)[0-9]{13}$'
       or employee_code ~ '^(set|pwd)[0-9]{6}$'
       -- Accounts created before 20260730130002 (department prefix).
       or employee_code ~ '^[a-z0-9]{2,6}-999[0-9]{7}$'
       -- Accounts created after it: the code IS the personnel number.
       or employee_code ~ '^999[0-9]{7}$'
  ),
  del as (
    delete from auth.users u using junk j where u.id = j.id returning u.id
  )
  select count(*) into v_count from del;

  if v_count > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'cleanup_e2e_users', 'auth.users', null,
            jsonb_build_object('deleted', v_count));
  end if;

  return v_count;
end; $$;

revoke execute on function public.app_cleanup_e2e_users() from public, anon;
grant  execute on function public.app_cleanup_e2e_users() to authenticated;
