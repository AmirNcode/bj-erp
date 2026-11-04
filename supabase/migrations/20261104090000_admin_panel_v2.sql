-- Admin panel v2 (owner, 2026-11-03/04; spec docs/specs/2026-11-03-admin-panel-v2-design.md).
--   FR-79  sign-ins tab and force sign-out (by the admin, on password reset, on deactivation)
--   FR-80  password rule: 8-72 characters, at least one digit and one special character
--   FR-77  changes: audit log by person (p_target), off-server copy status, cron-history purge
-- Ships in the same release as 20261103140000/…01, so app_audit_log can change signature.

-- ── helpers ────────────────────────────────────────────────────────────────────
create or replace function private.try_uuid(p text) returns uuid
    language sql immutable
    set search_path to ''
    as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;
revoke all on function private.try_uuid(text) from public;

-- ── FR-80 password rule ────────────────────────────────────────────────────────
-- One place for the rule; lib/auth/passwordPolicy.ts mirrors it for the forms.
-- Special = printable ASCII punctuation (a space is allowed but does not count).
create or replace function private.assert_password_ok(p text) returns void
    language plpgsql immutable
    set search_path to ''
    as $$
begin
  if length(coalesce(p, '')) < 8 then
    raise exception 'new password must be at least 8 characters' using errcode = '22023';
  end if;
  if octet_length(p) > 72 then
    raise exception 'new password must be at most 72 ASCII characters' using errcode = '22023';
  end if;
  if translate(p, '0123456789', '') = p then
    raise exception 'new password must contain a digit' using errcode = '22023';
  end if;
  if translate(p, '!"#$%&''()*+,-./:;<=>?@[\]^_`{|}~', '') = p then
    raise exception 'new password must contain a special character' using errcode = '22023';
  end if;
end $$;
revoke all on function private.assert_password_ok(text) from public;

-- ── FR-79 sessions ─────────────────────────────────────────────────────────────
-- Deleting auth.sessions takes the refresh tokens with it (FK cascade), as GoTrue's logout does.
-- An access token already issued stays valid until it expires (GOTRUE_JWT_EXP, 60 min): accepted.
-- Never signs out the caller. Takes no 'leave:' lock, so the CLAUDE.md lock order is unchanged.
create or replace function private.revoke_sessions(p_user uuid, p_reason text) returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_actor uuid := auth.uid();
  v_n integer;
begin
  if p_user is null or p_user = v_actor then return 0; end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_n = row_count;
  if v_n > 0 or p_reason = 'admin' then
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_actor, 'sessions.revoke', 'auth.users', p_user,
            jsonb_build_object('sessions', v_n, 'reason', p_reason));
  end if;
  return v_n;
end $$;
revoke all on function private.revoke_sessions(uuid, text) from public;

create or replace function public.app_revoke_sessions(p_user uuid) returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
begin
  if p_user = auth.uid() then
    raise exception 'cannot sign yourself out here' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and company_id = v_company) then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  return private.revoke_sessions(p_user, 'admin');
end $$;
revoke all on function public.app_revoke_sessions(uuid) from public, anon;
grant execute on function public.app_revoke_sessions(uuid) to authenticated;

create or replace function public.app_revoke_all_sessions() returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  v_n integer;
  v_people integer;
begin
  with gone as (
    delete from auth.sessions s
     using public.profiles p
     where p.id = s.user_id and p.company_id = v_company and s.user_id <> auth.uid()
    returning s.user_id)
  select count(*), count(distinct user_id) into v_n, v_people from gone;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'sessions.revoke_all', 'auth.users', null,
          jsonb_build_object('sessions', v_n, 'people', v_people, 'reason', 'admin'));
  return v_n;
end $$;
revoke all on function public.app_revoke_all_sessions() from public, anon;
grant execute on function public.app_revoke_all_sessions() to authenticated;

-- Recent password sign-ins (auth.audit_log_entries 'login'; GoTrue leaves ip_address empty, so no
-- address) and everyone holding a session now.
create or replace function public.app_admin_sign_ins(p_limit integer default 100) returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_result jsonb;
begin
  select jsonb_build_object(
    'logins', (select coalesce(jsonb_agg(jsonb_build_object('at', l.created_at, 'user_id', l.user_id,
          'full_name', l.full_name, 'employee_code', l.employee_code) order by l.created_at desc), '[]')
      from (select e.created_at, p.id as user_id, p.full_name, p.employee_code
              from auth.audit_log_entries e
              join public.profiles p on p.id = private.try_uuid(e.payload->>'actor_id')
             where e.payload->>'action' = 'login' and p.company_id = v_company
             order by e.created_at desc
             limit v_limit) l),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id,
          'full_name', x.full_name, 'employee_code', x.employee_code, 'active', x.active,
          'devices', x.devices, 'last_active', x.last_active) order by x.last_active desc nulls last), '[]')
      from (select p.id as user_id, p.full_name, p.employee_code, p.active, count(*) as devices,
                   max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC', s.created_at)) as last_active
              from auth.sessions s
              join public.profiles p on p.id = s.user_id
             where p.company_id = v_company
             group by p.id) x)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.app_admin_sign_ins(integer) from public, anon;
grant execute on function public.app_admin_sign_ins(integer) to authenticated;

create or replace function private.profiles_revoke_on_deactivate() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  perform private.revoke_sessions(new.id, 'deactivated');
  return null;
end $$;
revoke all on function private.profiles_revoke_on_deactivate() from public;
create trigger profiles_revoke_sessions_on_deactivate
  after update of active on public.profiles
  for each row when (old.active and not new.active)
  execute function private.profiles_revoke_on_deactivate();

-- ── off-server copies (FR-77 v2) ───────────────────────────────────────────────
-- deploy/liara/pull-backups-to-mac.sh reports, after each run, every dump it holds that is still on
-- the VM, with the sha256 of its own copy. One row per file; last_seen moves on each report.
create table private.offsite_copies (
    file_name text primary key,
    sha256 text,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now()
);
comment on table private.offsite_copies is
  'FR-77 v2: dumps the owner''s Mac holds, reported by deploy/liara/pull-backups-to-mac.sh via private.record_offsite_copies.';

create or replace function private.record_offsite_copies(p_copies text[]) returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_item text;
  v_n integer := 0;
begin
  foreach v_item in array coalesce(p_copies, '{}') loop
    if v_item !~ '^daily-[0-9]{8}T[0-9]{6}Z\.dump:[0-9a-f]{64}$' then
      raise exception 'invalid offsite copy entry' using errcode = '22023';
    end if;
    insert into private.offsite_copies (file_name, sha256)
    values (split_part(v_item, ':', 1), split_part(v_item, ':', 2))
    on conflict (file_name) do update set sha256 = excluded.sha256, last_seen = now();
    v_n := v_n + 1;
  end loop;
  delete from private.offsite_copies where last_seen < now() - interval '90 days';
  return v_n;
end $$;
revoke all on function private.record_offsite_copies(text[]) from public;

-- ── password setters (FR-80) and resets that sign out (FR-79) ──────────────────
CREATE OR REPLACE FUNCTION private.create_employee_impl(p_actor uuid, p_path text, p_company_id uuid, p_department_id uuid, p_manager_id uuid, p_personnel_no text, p_full_name text, p_password text, p_roles public.app_role[], p_hire_date date, p_language_pref text, p_calendar_pref text, p_job_title text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid       uuid := gen_random_uuid();
  v_pno       text := btrim(coalesce(p_personnel_no, ''));
  v_dept_code text;
  v_code      text;
  v_email     text;
  v_role      public.app_role;
begin
  if not private.valid_personnel_no(v_pno, p_path = 'admin') then
    if p_path = 'admin' then
      raise exception 'invalid personnel number (1-64 characters)' using errcode = '22023';
    end if;
    raise exception 'invalid personnel number (1-10 digits)' using errcode = '22023';
  end if;
  perform private.assert_password_ok(p_password);  -- FR-80
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
  if exists (select 1 from public.profiles where lower(employee_code) = lower(v_code)) then
    raise exception 'employee code already exists' using errcode = '23505';
  end if;

  -- Lower-cased like private.set_login_code: an admin's personnel number may hold letters.
  v_email := lower(v_code) || '@bj-app.internal';

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

CREATE OR REPLACE FUNCTION public.app_change_my_password(p_current text, p_new text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  perform private.assert_password_ok(p_new);  -- FR-80
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

CREATE OR REPLACE FUNCTION public.app_set_initial_password(p_new text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  perform private.assert_password_ok(p_new);  -- FR-80

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
  perform private.assert_password_ok(p_password);  -- FR-80

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
  -- FR-79: a reset password signs the person out everywhere (never the caller).
  perform private.revoke_sessions(p_user_id, 'password_reset');
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
    perform private.assert_password_ok(v_row.password);  -- FR-80
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
    perform private.revoke_sessions(v_row.user_id, 'password_reset');  -- FR-79
  end loop;
end;
$$;


-- ── System tab: off-server copies ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_admin_system() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_company uuid := private.require_admin();
  v_migrations jsonb := '[]';
  v_migration_count bigint := 0;
  v_jobs jsonb := '[]';
  v_result jsonb;
begin
  if to_regclass('bj_deploy.schema_migrations') is not null then
    execute $q$select coalesce(jsonb_agg(to_jsonb(m) order by m.filename desc), '[]')
                 from (select * from bj_deploy.schema_migrations order by filename desc limit 10) m$q$
      into v_migrations;
    execute 'select count(*) from bj_deploy.schema_migrations' into v_migration_count;
  end if;
  if to_regclass('cron.job') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('jobname', j.jobname,
                   'schedule', j.schedule, 'active', j.active,
                   'last_status', d.status, 'last_start', d.start_time, 'last_end', d.end_time,
                   'last_message', left(d.return_message, 300),
                   'failures_24h', (select count(*) from cron.job_run_details f where f.jobid = j.jobid
                     and f.status = 'failed' and f.start_time > now() - interval '24 hours'))
                   order by j.jobname), '[]')
                 from cron.job j
                 left join lateral (select * from cron.job_run_details x where x.jobid = j.jobid
                   order by x.start_time desc limit 1) d on true$q$
      into v_jobs;
  end if;

  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'postgres_version', current_setting('server_version'),
    'tables', (select coalesce(jsonb_agg(t order by (t->>'bytes')::bigint desc), '[]') from (
        select jsonb_build_object('name', n.nspname || '.' || c.relname,
                 'rows', greatest(c.reltuples, 0)::bigint,
                 'bytes', pg_total_relation_size(c.oid)) as t
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth')
         order by pg_total_relation_size(c.oid) desc limit 10) x),
    'migrations', v_migrations,
    'migration_count', v_migration_count,
    'jobs', v_jobs,
    'backups', (select coalesce(jsonb_agg(jsonb_build_object('file_name', file_name,
        'size_bytes', size_bytes, 'finished_at', finished_at) order by finished_at desc), '[]')
      from (select * from private.backup_runs order by finished_at desc limit 5) b),
    -- FR-77 v2: what the owner's Mac reported holding (deploy/liara/pull-backups-to-mac.sh).
    'offsite', jsonb_build_object(
      'last_report', (select max(last_seen) from private.offsite_copies),
      'newest_file', (select file_name from private.offsite_copies order by file_name desc limit 1),
      'missing', (select coalesce(jsonb_agg(b.file_name order by b.file_name desc), '[]')
          from private.backup_runs b
         where b.finished_at > now() - interval '7 days' and b.finished_at < now() - interval '36 hours'
           and not exists (select 1 from private.offsite_copies o where o.file_name = b.file_name)),
      'mismatched', (select coalesce(jsonb_agg(b.file_name order by b.file_name desc), '[]')
          from private.backup_runs b join private.offsite_copies o on o.file_name = b.file_name
         where b.sha256 is not null and o.sha256 is distinct from b.sha256))
  ) into v_result;
  return v_result;
end $_$;

-- ── Audit log by person ────────────────────────────────────────────────────────
drop function public.app_audit_log(date, date, uuid, text, text, integer, integer);
CREATE FUNCTION public.app_audit_log(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_actor uuid DEFAULT NULL::uuid, p_entity text DEFAULT NULL::text, p_action text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_target uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.require_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  with base as (
    -- FR-77 v2: the one person a row is about, when it names one.
    select a.*, coalesce(
        case when a.entity in ('profiles', 'auth.users', 'user_roles', 'employee_personal_info', 'user_signatures')
          then a.entity_id end,
        case when a.entity = 'leave_requests'
          then (select r.employee_id from public.leave_requests r where r.id = a.entity_id) end,
        private.try_uuid(coalesce(a.after->>'employee_id', a.before->>'employee_id',
                                  a.after->>'user_id', a.before->>'user_id'))) as about_id
      from public.audit_log a
  ), scoped as (
    select a.*
      from base a
      left join public.profiles ap on ap.id = a.actor_id
     where (ap.company_id = v_company or a.actor_id is null)
       and (p_target is null or a.about_id = p_target)
       and (p_from is null or (a.created_at at time zone 'Asia/Tehran')::date >= p_from)
       and (p_to is null or (a.created_at at time zone 'Asia/Tehran')::date <= p_to)
       and (p_actor is null or a.actor_id = p_actor)
       and (p_entity is null or a.entity = p_entity)
       and (p_action is null or a.action = p_action)
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at,
        'actor_id', s.actor_id, 'actor_name', p.full_name, 'action', s.action, 'entity', s.entity,
        'entity_id', s.entity_id, 'entity_label', case
          when s.entity = 'profiles' then (select full_name from public.profiles where id = s.entity_id)
          when s.entity = 'leave_requests' then (select r.serial_year || '-' || lpad(r.serial_seq::text, 4, '0')
            from public.leave_requests r where r.id = s.entity_id) end,
        'about_id', s.about_id, 'about_name', ab.full_name,
        'before', private.audit_redact(s.before), 'after', private.audit_redact(s.after))
        order by s.created_at desc, s.id), '[]')
      from (select * from scoped order by created_at desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) s
      left join public.profiles p on p.id = s.actor_id
      left join public.profiles ab on ab.id = s.about_id),
    'entities', (select coalesce(jsonb_agg(distinct a.entity), '[]') from public.audit_log a),
    'actions', (select coalesce(jsonb_agg(distinct a.action), '[]') from public.audit_log a)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.app_audit_log(date, date, uuid, text, text, integer, integer, uuid) from public, anon;
grant execute on function public.app_audit_log(date, date, uuid, text, text, integer, integer, uuid) to authenticated;

-- ── pg_cron history purge ──────────────────────────────────────────────────────
-- pg_cron never deletes cron.job_run_details; bj-sms-dispatch alone adds ~2,880 rows a day.
-- The System tab needs only each job's newest run. 21:00 UTC = 00:30 Asia/Tehran.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bj-purge-cron-history', '0 21 * * *',
      $q$delete from cron.job_run_details where end_time < now() - interval '7 days'$q$);
  end if;
end $$;
