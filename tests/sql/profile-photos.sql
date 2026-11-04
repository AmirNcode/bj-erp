-- FR-82 profile photos: who may set, lock, remove and read a photo, the size/shape guard, the
-- audit rows, and that the table is out of reach of API roles.
-- Run ONLY in a disposable test database, as the image superuser (supabase_admin):
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d <clone> -q ) \
--     < tests/sql/profile-photos.sql
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table ph_fx(k text primary key, id uuid not null);
create temp table ph_seen(version text primary key);
grant select on ph_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from ph_fx where k = p_key;
$$;
create function pg_temp.login(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.fx(p_key), 'role', 'authenticated')::text, true);
end; $$;
create function pg_temp.as_scalar(p_key text, p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  begin execute p_sql into v_result;
  exception when others then v_result := 'ERROR ' || sqlstate || ' ' || sqlerrm; end;
  execute 'reset role';
  return v_result;
end; $$;
create function pg_temp.expect(p_label text, p_actual text, p_expected text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual; end if;
  raise notice 'PASS %', p_label;
end; $$;
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result, 6) = 'ERROR ' then split_part(p_result, ' ', 2) else 'ok' end;
$$;
-- A well-formed JPEG data URL (base64 part a multiple of 4), optionally padded to a length.
create function pg_temp.jpeg(p_len int default 2000) returns text language sql immutable as $$
  select 'data:image/jpeg;base64,/9j/' || repeat('A', p_len - 27 - ((p_len - 23) % 4));
$$;
create function pg_temp.set(p_actor text, p_target text, p_data text, p_locked text default 'null')
returns text language sql as $$
  select pg_temp.as_scalar(p_actor, format('select public.app_set_profile_photo(%L, %L, %s)::text',
    pg_temp.fx(p_target), p_data, p_locked));
$$;
create function pg_temp.lock(p_actor text, p_target text, p_locked boolean) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor, format(
    'select public.app_set_profile_photo_lock(%L, %L)::text', pg_temp.fx(p_target), p_locked)));
$$;
create function pg_temp.remove(p_actor text, p_target text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor, format(
    'select public.app_remove_profile_photo(%L)::text', pg_temp.fx(p_target))));
$$;
-- What p_actor reads for p_target: version:locked, or none.
create function pg_temp.read(p_actor text, p_target text) returns text language sql as $$
  select coalesce(pg_temp.as_scalar(p_actor, format(
    'select version || '':'' || locked from public.app_profile_photo(%L)', pg_temp.fx(p_target))), 'none');
$$;
-- The lock flag alone (version numbers are global, so tests do not spell them out).
create function pg_temp.locked(p_actor text, p_target text) returns text language sql as $$
  select split_part(pg_temp.read(p_actor, p_target), ':', 2);
$$;
-- 'new' when a version was never returned before in this run. Any cache key that comes back is the
-- bug: /api/photo/<id>?v=<version> is immutable, so browsers would keep the old image.
create function pg_temp.fresh(p_version text) returns text language plpgsql as $$
begin
  if p_version !~ '^[0-9]+$' then return p_version; end if;
  if exists (select 1 from ph_seen where version = p_version) then return 'repeat ' || p_version; end if;
  insert into ph_seen values (p_version);
  return 'new';
end; $$;
create function pg_temp.audits(p_target text) returns text language sql as $$
  -- One transaction = one now(), so count per action instead of ordering.
  select coalesce(string_agg(action || 'x' || n, ',' order by action), 'none')
    from (select action, count(*) n from public.audit_log
           where entity = 'profile_photos' and entity_id = pg_temp.fx(p_target) group by action) a;
$$;

do $$
declare v_company uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_dept uuid := gen_random_uuid();
        who record;
begin
  insert into public.companies(id, name) values (v_company, 'Photo fixture'), (v_other, 'Photo other co');
  insert into ph_fx values ('company', v_company);
  insert into public.departments(id, company_id, name_fa, name_en, kind, code)
    values (v_dept, v_company, 'الف', 'Fixture A', 'office', 'PHA');
  for who in select * from (values
    ('admin',   array['admin'],               '9990082001', true,  v_company),
    ('hr',      array['hr','employee'],       '9990082002', true,  v_company),
    ('mgr',     array['manager','employee'],  '9990082003', true,  v_company),
    ('emp',     array['employee'],            '9990082004', true,  v_company),
    ('emp2',    array['employee'],            '9990082005', true,  v_company),
    ('gone',    array['employee'],            '9990082006', false, v_company),
    ('outsider',array['hr','employee'],       '9990082007', true,  v_other)) t(k, roles, code, active, co) loop
    insert into ph_fx values (who.k, gen_random_uuid());
    insert into auth.users(id, email) values (pg_temp.fx(who.k), who.code || '@photo-fixture.invalid');
    insert into public.profiles(id, company_id, department_id, employee_code, personnel_no, full_name,
                                active, must_change_password)
      values (pg_temp.fx(who.k), who.co, case when who.co = v_company then v_dept end, who.code, who.code,
              'Fixture ' || who.k, who.active, false);
    insert into public.user_roles(user_id, role)
      select pg_temp.fx(who.k), r::public.app_role from unnest(who.roles) r;
  end loop;
end; $$;

-- ── table out of reach ──
select pg_temp.expect('authenticated cannot read the table',
  pg_temp.err(pg_temp.as_scalar('admin', 'select count(*)::text from private.profile_photos')), '42501');
select pg_temp.expect('authenticated cannot touch the version sequence',
  has_sequence_privilege('authenticated', 'private.profile_photo_version_seq', 'usage')::text, 'false');
select pg_temp.expect('anon cannot call the read function',
  has_function_privilege('anon', 'public.app_profile_photo(uuid)', 'execute')::text, 'false');

-- ── self ──
select pg_temp.expect('self: first upload', pg_temp.fresh(pg_temp.set('emp', 'emp', pg_temp.jpeg())), 'new');
select pg_temp.expect('self: lock argument ignored',
  pg_temp.fresh(pg_temp.set('emp', 'emp', pg_temp.jpeg(3000), 'true')), 'new');
select pg_temp.expect('self: still unlocked', pg_temp.locked('emp', 'emp'), 'false');
select pg_temp.expect('self: cannot lock', pg_temp.lock('emp', 'emp', true), '42501');
select pg_temp.expect('self: remove', pg_temp.remove('emp', 'emp'), 'ok');
select pg_temp.expect('self: gone after remove', pg_temp.read('emp', 'emp'), 'none');
select pg_temp.expect('self: remove twice is a no-op', pg_temp.remove('emp', 'emp'), 'ok');

-- ── data guard ──
select pg_temp.expect('PNG refused',
  pg_temp.err(pg_temp.set('emp', 'emp', 'data:image/png;base64,iVBORw0KGgo' || repeat('A', 1999))), '22023');
select pg_temp.expect('over 80 000 characters refused',
  pg_temp.err(pg_temp.set('emp', 'emp', pg_temp.jpeg(80004))), '22023');
select pg_temp.expect('just under the cap accepted, new cache key after the remove',
  pg_temp.fresh(pg_temp.set('emp', 'emp', pg_temp.jpeg(79999))), 'new');
select pg_temp.expect('junk characters refused',
  pg_temp.err(pg_temp.set('emp', 'emp', pg_temp.jpeg() || '<script>')), '22023');
select pg_temp.expect('null refused', pg_temp.err(pg_temp.set('emp', 'emp', null)), '22023');
select pg_temp.expect('error does not echo the row',
  (position('AAAA' in pg_temp.set('emp', 'emp', pg_temp.jpeg(80004))) = 0)::text, 'true');

-- ── HR and lock ──
select pg_temp.expect('hr sets and locks', pg_temp.fresh(pg_temp.set('hr', 'emp', pg_temp.jpeg(), 'true')), 'new');
select pg_temp.expect('locked: self cannot replace',
  pg_temp.err(pg_temp.set('emp', 'emp', pg_temp.jpeg())), '42501');
select pg_temp.expect('locked: self cannot remove', pg_temp.remove('emp', 'emp'), '42501');
select pg_temp.expect('hr replace keeps the lock', pg_temp.fresh(pg_temp.set('hr', 'emp', pg_temp.jpeg(2400))), 'new');
select pg_temp.expect('still locked', pg_temp.locked('emp', 'emp'), 'true');
select pg_temp.expect('hr unlocks', pg_temp.lock('hr', 'emp', false), 'ok');
select pg_temp.expect('unlocked', pg_temp.locked('emp', 'emp'), 'false');
select pg_temp.expect('unlock changes the cache key',
  pg_temp.fresh(split_part(pg_temp.read('emp', 'emp'), ':', 1)), 'new');
select pg_temp.expect('unlocked: self replaces again', pg_temp.fresh(pg_temp.set('emp', 'emp', pg_temp.jpeg())), 'new');
select pg_temp.expect('lock on no photo', pg_temp.lock('hr', 'emp2', true), 'P0002');
select pg_temp.expect('hr sets an inactive person', pg_temp.fresh(pg_temp.set('hr', 'gone', pg_temp.jpeg())), 'new');
select pg_temp.expect('hr removes', pg_temp.remove('hr', 'gone'), 'ok');
select pg_temp.expect('re-upload after remove never reuses a cache key',
  pg_temp.fresh(pg_temp.set('hr', 'gone', pg_temp.jpeg())), 'new');

-- ── who may not ──
select pg_temp.expect('colleague cannot set', pg_temp.err(pg_temp.set('emp2', 'emp', pg_temp.jpeg())), '42501');
select pg_temp.expect('colleague cannot remove', pg_temp.remove('emp2', 'emp'), '42501');
select pg_temp.expect('manager role is not enough', pg_temp.err(pg_temp.set('mgr', 'emp', pg_temp.jpeg())), '42501');
select pg_temp.expect('hr cannot touch the admin', pg_temp.err(pg_temp.set('hr', 'admin', pg_temp.jpeg())), '42501');
select pg_temp.expect('other company hr refused', pg_temp.err(pg_temp.set('outsider', 'emp', pg_temp.jpeg())), '42501');
select pg_temp.expect('inactive caller refused', pg_temp.err(pg_temp.set('gone', 'gone', pg_temp.jpeg())), '42501');
select pg_temp.expect('admin sets own', pg_temp.fresh(pg_temp.set('admin', 'admin', pg_temp.jpeg())), 'new');
select pg_temp.expect('admin sets anyone', pg_temp.fresh(pg_temp.set('admin', 'emp2', pg_temp.jpeg(), 'true')), 'new');

-- ── reads ──
select pg_temp.expect('colleague reads (photo goes with name)', pg_temp.locked('emp2', 'emp'), 'false');
select pg_temp.expect('other company reads nothing', pg_temp.read('outsider', 'emp'), 'none');
select pg_temp.expect('inactive caller reads nothing', pg_temp.read('gone', 'emp'), 'none');
select pg_temp.expect('versions for a list',
  pg_temp.as_scalar('mgr', format(
    $q$select string_agg(locked::text, ',' order by locked) from public.app_profile_photo_versions(array[%L, %L, %L]::uuid[])$q$,
    pg_temp.fx('emp'), pg_temp.fx('emp2'), pg_temp.fx('hr'))), 'false,true');
select pg_temp.expect('versions: other company gets nothing',
  coalesce(pg_temp.as_scalar('outsider', format(
    'select count(*)::text from public.app_profile_photo_versions(array[%L]::uuid[])', pg_temp.fx('emp'))), 'x'), '0');
select pg_temp.expect('versions: null array is empty',
  pg_temp.as_scalar('emp', 'select count(*)::text from public.app_profile_photo_versions(null)'), '0');

-- ── audit ──
select pg_temp.expect('audit trail for emp', pg_temp.audits('emp'),
  'photo.deletedx1,photo.savedx6,photo.unlockedx1');
select pg_temp.expect('audit never holds the image',
  (select count(*)::text from public.audit_log where entity = 'profile_photos'
      and (coalesce(before::text, '') || coalesce(after::text, '')) like '%base64%'), '0');
select pg_temp.expect('audit actor is hr on the lock change',
  (select (actor_id = pg_temp.fx('hr'))::text from public.audit_log
    where entity = 'profile_photos' and entity_id = pg_temp.fx('emp') and action = 'photo.unlocked'), 'true');

-- ── cascade ──
delete from public.user_roles where user_id = pg_temp.fx('emp2');
delete from public.profiles where id = pg_temp.fx('emp2');
select pg_temp.expect('photo goes with the profile',
  (select count(*)::text from private.profile_photos where employee_id = pg_temp.fx('emp2')), '0');

\o
select 'profile-photos.sql: all assertions passed' as result;
rollback;
