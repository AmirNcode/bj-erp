-- FR-96 follow-up: app_my_recent_sms returns the caller's own latest texts only, newest first,
-- without skipped / dry_run rows, with password_reset bodies masked; inactive callers and anon refused.
-- Run ONLY in a disposable test database, as the image superuser (supabase_admin):
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d <clone> -q ) \
--     < tests/sql/my-recent-sms.sql
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table rs_fx(k text primary key, id uuid not null);
grant select on rs_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from rs_fx where k = p_key;
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
create function pg_temp.recent(p_key text, p_limit int default null) returns jsonb language plpgsql as $$
declare v text;
begin
  v := pg_temp.as_scalar(p_key, case when p_limit is null then 'select public.app_my_recent_sms()::text'
       else format('select public.app_my_recent_sms(%s)::text', p_limit) end);
  if left(v, 6) = 'ERROR ' then return to_jsonb(v); end if;
  return v::jsonb;
end; $$;

do $$
declare v_company uuid := gen_random_uuid(); v_dept uuid := gen_random_uuid(); who record;
begin
  insert into public.companies(id, name) values (v_company, 'Recent SMS fixture');
  insert into rs_fx values ('company', v_company);
  insert into public.departments(id, company_id, name_fa, name_en, kind, code)
    values (v_dept, v_company, 'الف', 'Fixture A', 'office', 'RSA');
  for who in select * from (values
    ('emp',  '9990096001', true),
    ('emp2', '9990096002', true),
    ('gone', '9990096003', false)) t(k, code, active) loop
    insert into rs_fx values (who.k, gen_random_uuid());
    insert into auth.users(id, email) values (pg_temp.fx(who.k), who.code || '@recent-sms-fixture.invalid');
    insert into public.profiles(id, company_id, department_id, employee_code, personnel_no, full_name,
                                active, must_change_password)
      values (pg_temp.fx(who.k), v_company, v_dept, who.code, who.code, 'Fixture ' || who.k, who.active, false);
    insert into public.user_roles(user_id, role) values (pg_temp.fx(who.k), 'employee');
  end loop;
  -- emp: 5 shown statuses + 2 hidden ones, created a minute apart (m1 oldest … m7 newest).
  insert into public.sms_outbox(company_id, event, recipient_id, to_mobile, body, args, status, skip_reason, created_at)
  values
    (v_company, 'test',             pg_temp.fx('emp'),  '09120000001', 'm1 sent',    '{}', 'sent',    null, now() - interval '7 min'),
    (v_company, 'test',             pg_temp.fx('emp'),  '09120000001', 'm2 failed',  '{}', 'failed',  null, now() - interval '6 min'),
    (v_company, 'test',             pg_temp.fx('emp'),  '09120000001', 'm3 dry',     '{}', 'dry_run', null, now() - interval '5 min'),
    (v_company, 'password_reset',   pg_temp.fx('emp'),  '09120000001', 'm4 pass Secret-123', '{Secret-123}', 'queued', null, now() - interval '4 min'),
    (v_company, 'test',             pg_temp.fx('emp'),  null,          'm5 skipped', '{}', 'skipped', 'no_mobile', now() - interval '3 min'),
    (v_company, 'test',             pg_temp.fx('emp'),  '09120000001', 'm6 sending', '{}', 'sending', null, now() - interval '2 min'),
    (v_company, 'test',             pg_temp.fx('emp2'), '09120000002', 'other person', '{}', 'sent',  null, now() - interval '1 min'),
    (v_company, 'test',             pg_temp.fx('gone'), '09120000003', 'gone person',  '{}', 'sent',  null, now() - interval '1 min');
end; $$;

select pg_temp.expect('default limit is 3, newest first, hidden statuses dropped',
  (select string_agg(e->>'body', ' | ' order by ord) from jsonb_array_elements(pg_temp.recent('emp')) with ordinality t(e, ord)),
  'm6 sending | m4 pass •••• | m2 failed');
select pg_temp.expect('limit 10 shows every visible text',
  (select string_agg(left(e->>'body', 2), ',' order by ord) from jsonb_array_elements(pg_temp.recent('emp', 10)) with ordinality t(e, ord)),
  'm6,m4,m2,m1');
select pg_temp.expect('password never returned',
  (pg_temp.recent('emp', 10)::text like '%Secret-123%')::text, 'false');
select pg_temp.expect('row keys',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.recent('emp', 1)->0) k),
  'body,created_at,event,id,sent_at,status,to_mobile');
select pg_temp.expect('limit clamps to at least 1',
  jsonb_array_length(pg_temp.recent('emp', 0))::text, '1');
select pg_temp.expect('another person sees only their own',
  (select string_agg(e->>'body', ',') from jsonb_array_elements(pg_temp.recent('emp2', 10)) e), 'other person');
select pg_temp.expect('inactive caller refused',
  pg_temp.err(pg_temp.recent('gone') #>> '{}'), '42501');
select pg_temp.expect('anon cannot call it',
  has_function_privilege('anon', 'public.app_my_recent_sms(integer)', 'execute')::text, 'false');
select pg_temp.expect('direct table read still admin-only',
  pg_temp.as_scalar('emp', 'select count(*)::text from public.sms_outbox'), '0');

\o
select 'my-recent-sms.sql: all assertions passed' as result;
rollback;
