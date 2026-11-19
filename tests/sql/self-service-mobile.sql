-- FR-96 self-service SMS mobile: any active user sets only their own employee_personal_info.mobile
-- through app_set_my_mobile (normalizing, clearing, refusing bad input, audit field names only).
-- Run ONLY in a disposable test database, as the image superuser (supabase_admin):
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d <clone> -q ) \
--     < tests/sql/self-service-mobile.sql
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table mb_fx(k text primary key, id uuid not null);
grant select on mb_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from mb_fx where k = p_key;
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
create function pg_temp.set(p_actor text, p_value text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor, format('select public.app_set_my_mobile(%L)', p_value));
$$;
create function pg_temp.mobile(p_key text) returns text language sql as $$
  select coalesce((select coalesce(mobile, 'null') from public.employee_personal_info
                    where employee_id = pg_temp.fx(p_key)), 'no row');
$$;

do $$
declare v_company uuid := gen_random_uuid(); v_dept uuid := gen_random_uuid(); who record;
begin
  insert into public.companies(id, name) values (v_company, 'Mobile fixture');
  insert into mb_fx values ('company', v_company);
  insert into public.departments(id, company_id, name_fa, name_en, kind, code)
    values (v_dept, v_company, 'الف', 'Fixture A', 'office', 'MBA');
  for who in select * from (values
    ('emp',  '9990095001', true),
    ('emp2', '9990095002', true),
    ('gone', '9990095003', false)) t(k, code, active) loop
    insert into mb_fx values (who.k, gen_random_uuid());
    insert into auth.users(id, email) values (pg_temp.fx(who.k), who.code || '@mobile-fixture.invalid');
    insert into public.profiles(id, company_id, department_id, employee_code, personnel_no, full_name,
                                active, must_change_password)
      values (pg_temp.fx(who.k), v_company, v_dept, who.code, who.code, 'Fixture ' || who.k, who.active, false);
    insert into public.user_roles(user_id, role) values (pg_temp.fx(who.k), 'employee');
  end loop;
  update public.employee_personal_info set father_name = 'Father', home_phone = '07112345678'
   where employee_id = pg_temp.fx('emp');
  delete from public.employee_personal_info where employee_id = pg_temp.fx('emp2');
end; $$;

select pg_temp.expect('fixture: employee lacks personal_info_own',
  private.has_perm(pg_temp.fx('emp'), 'personal_info_own', 'edit')::text, 'false');
select pg_temp.expect('fixture: RLS update of own row is refused',
  pg_temp.as_scalar('emp', $q$with u as (update public.employee_personal_info set mobile = '09120000000'
    where employee_id = auth.uid() returning 1) select count(*)::text from u$q$), '0');

-- ── normalizing ──
select pg_temp.expect('Persian digits and spaces', pg_temp.set('emp', '۰۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789');
select pg_temp.expect('stored', pg_temp.mobile('emp'), '09123456789');
select pg_temp.expect('+98 prefix', pg_temp.set('emp', '+98 912 345 6780'), '09123456780');
select pg_temp.expect('stored after +98', pg_temp.mobile('emp'), '09123456780');
select pg_temp.expect('other columns untouched',
  (select father_name || '/' || home_phone from public.employee_personal_info
    where employee_id = pg_temp.fx('emp')), 'Father/07112345678');

-- ── refusing ──
select pg_temp.expect('too short refused', pg_temp.err(pg_temp.set('emp', '12345')), '22023');
select pg_temp.expect('landline refused', pg_temp.err(pg_temp.set('emp', '07112345678')), '22023');
select pg_temp.expect('refused value left the number alone', pg_temp.mobile('emp'), '09123456780');
select pg_temp.expect('inactive caller refused', pg_temp.err(pg_temp.set('gone', '09121111111')), '42501');
select pg_temp.expect('inactive caller row unchanged', pg_temp.mobile('gone'), 'null');
select pg_temp.expect('anon cannot call it',
  has_function_privilege('anon', 'public.app_set_my_mobile(text)', 'execute')::text, 'false');

-- ── clearing ──
select pg_temp.expect('blank clears', coalesce(pg_temp.set('emp', '  '), 'null'), 'null');
select pg_temp.expect('cleared', pg_temp.mobile('emp'), 'null');
select pg_temp.expect('null clears too', coalesce(pg_temp.set('emp', null), 'null'), 'null');

-- ── missing row ──
select pg_temp.expect('fixture: emp2 has no row', pg_temp.mobile('emp2'), 'no row');
select pg_temp.expect('missing row created', pg_temp.set('emp2', '09351234567'), '09351234567');
select pg_temp.expect('created row company',
  (select (company_id = pg_temp.fx('company'))::text from public.employee_personal_info
    where employee_id = pg_temp.fx('emp2')), 'true');

-- ── audit: field names only, never the number ──
select pg_temp.expect('update audited with field names',
  (select count(*)::text from public.audit_log where action = 'personal_info.update'
     and entity_id = pg_temp.fx('emp') and after = '{"fields": ["mobile"]}'::jsonb), '3');
select pg_temp.expect('insert audited with field names',
  (select count(*)::text from public.audit_log where action = 'personal_info.update'
     and entity_id = pg_temp.fx('emp2') and after = '{"fields": ["mobile"]}'::jsonb), '1');
select pg_temp.expect('no audit row carries a number',
  (select count(*)::text from public.audit_log where entity_id in (pg_temp.fx('emp'), pg_temp.fx('emp2'))
     and after::text ~ '09[0-9]{9}'), '0');

\o
select 'self-service-mobile.sql: all assertions passed' as result;
rollback;
