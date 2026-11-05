-- FR-83 first and last names: the split rule, the sync trigger, who may change a name, the old app's
-- write paths during deploy, Persian order and the ID sort key. All names here are invented.
-- Run ONLY in a disposable test database, as the image superuser (supabase_admin):
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d <clone> -q ) \
--     < tests/sql/employee-names.sql
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table nm_fx(k text primary key, id uuid not null);
grant select on nm_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from nm_fx where k = p_key;
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
-- '42501'-style code, or 'ok'.
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result, 6) = 'ERROR ' then split_part(p_result, ' ', 2) else 'ok' end;
$$;
-- An update as p_actor on p_target; returns ok, the error code, or 'norow' when RLS hid the row.
create function pg_temp.upd(p_actor text, p_target text, p_set text) returns text language plpgsql as $$
declare v text;
begin
  v := pg_temp.as_scalar(p_actor, format(
    'with u as (update public.profiles set %s where id = %L returning 1) select count(*)::text from u',
    p_set, pg_temp.fx(p_target)));
  if left(v, 6) = 'ERROR ' then return pg_temp.err(v); end if;
  return case when v = '0' then 'norow' else 'ok' end;
end; $$;
-- first|last|full, with «-» for a blank last name.
create function pg_temp.names(p_key text) returns text language sql as $$
  select first_name || '|' || coalesce(last_name, '-') || '|' || full_name
    from public.profiles where id = pg_temp.fx(p_key);
$$;
create function pg_temp.add(p_key text, p_company uuid, p_code text, p_name text, p_roles text[] default '{employee}',
                            p_dept uuid default null) returns void language plpgsql as $$
begin
  insert into nm_fx values (p_key, gen_random_uuid());
  insert into auth.users(id, email) values (pg_temp.fx(p_key), p_code || '@name-fixture.invalid');
  -- full_name only: what every existing fixture and the old app send.
  insert into public.profiles(id, company_id, department_id, employee_code, personnel_no, full_name, must_change_password)
    values (pg_temp.fx(p_key), p_company, p_dept, p_code, p_code, p_name, false);
  insert into public.user_roles(user_id, role)
    select pg_temp.fx(p_key), r::public.app_role from unnest(p_roles) r;
end; $$;

-- ── The split rule ─────────────────────────────────────────────────────────
select pg_temp.expect('one word', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('رضا')), 'رضا|-');
select pg_temp.expect('two words', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('رضا کریمی')), 'رضا|کریمی');
select pg_temp.expect('two words, extra spaces', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('  رضا    کریمی ')), 'رضا|کریمی');
select pg_temp.expect('three words stay whole', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('رضا کریم زاده')), 'رضا کریم زاده|-');
select pg_temp.expect('four words stay whole', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('سید رضا کریم زاده')), 'سید رضا کریم زاده|-');
select pg_temp.expect('five words stay whole', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('الف ب پ ت ث')), 'الف ب پ ت ث|-');
select pg_temp.expect('ZWNJ does not split', (select first_name || '|' || coalesce(last_name, '-') from private.split_full_name('رضا کریم‌زاده')), 'رضا|کریم‌زاده');

do $$
declare v_co uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_dept uuid := gen_random_uuid();
begin
  insert into public.companies(id, name) values (v_co, 'Name fixture'), (v_other, 'Name other co');
  insert into nm_fx values ('company', v_co), ('dept', v_dept);
  insert into public.departments(id, company_id, name_fa, name_en, kind, code)
    values (v_dept, v_co, 'الف', 'Fixture A', 'office', 'NMA');
  perform pg_temp.add('admin', v_co, '9990083001', 'مدیر سامانه', '{admin}', v_dept);
  perform pg_temp.add('hr', v_co, '9990083002', 'رها نیکو', '{hr,employee}', v_dept);
  perform pg_temp.add('mgr', v_co, '9990083003', 'سارا امینی', '{manager,employee}', v_dept);
  perform pg_temp.add('emp', v_co, '9990083004', 'رضا کریمی', '{employee}', v_dept);
  perform pg_temp.add('long', v_co, '9990083005', 'علی رضا کریم زاده', '{employee}', v_dept);
  perform pg_temp.add('one', v_co, '9990083006', 'تارا', '{employee}', v_dept);
  perform pg_temp.add('outsider', v_other, '9990083007', 'بیگانه بیرونی', '{hr,employee}');
end; $$;

-- ── Sync trigger ───────────────────────────────────────────────────────────
select pg_temp.expect('insert two words', pg_temp.names('emp'), 'رضا|کریمی|رضا کریمی');
select pg_temp.expect('insert four words', pg_temp.names('long'), 'علی رضا کریم زاده|-|علی رضا کریم زاده');
select pg_temp.expect('insert one word', pg_temp.names('one'), 'تارا|-|تارا');

select pg_temp.expect('hr fixes a blank', pg_temp.upd('hr', 'long', $$first_name = 'علی رضا', last_name = 'کریم زاده'$$), 'ok');
select pg_temp.expect('parts rebuild full_name', pg_temp.names('long'), 'علی رضا|کریم زاده|علی رضا کریم زاده');
select pg_temp.expect('parts are trimmed', pg_temp.upd('hr', 'one', $$first_name = '  تارا ', last_name = ' سپهری '$$), 'ok');
select pg_temp.expect('trimmed result', pg_temp.names('one'), 'تارا|سپهری|تارا سپهری');
select pg_temp.expect('last name cleared', pg_temp.upd('hr', 'one', $$last_name = '   '$$), 'ok');
select pg_temp.expect('blank last leaves first alone', pg_temp.names('one'), 'تارا|-|تارا');
select pg_temp.expect('blank first name refused', pg_temp.upd('hr', 'one', $$first_name = '  '$$), '23502');
select pg_temp.expect('other columns leave names', pg_temp.upd('hr', 'long', $$job_title = 'تست'$$), 'ok');
select pg_temp.expect('names unchanged', pg_temp.names('long'), 'علی رضا|کریم زاده|علی رضا کریم زاده');

-- The old app writes full_name alone during deploy.
select pg_temp.expect('old app, two words', pg_temp.upd('admin', 'one', $$full_name = 'تارا سپهری'$$), 'ok');
select pg_temp.expect('old app write splits', pg_temp.names('one'), 'تارا|سپهری|تارا سپهری');
select pg_temp.expect('old app, three words', pg_temp.upd('admin', 'one', $$full_name = 'تارا سپهر نیا'$$), 'ok');
select pg_temp.expect('old app write goes blank', pg_temp.names('one'), 'تارا سپهر نیا|-|تارا سپهر نیا');
select pg_temp.expect('old app, same name', pg_temp.upd('admin', 'long', $$full_name = 'علی رضا کریم زاده'$$), 'ok');
select pg_temp.expect('same full_name keeps the fix', pg_temp.names('long'), 'علی رضا|کریم زاده|علی رضا کریم زاده');

-- ── Who may change a name ──────────────────────────────────────────────────
select pg_temp.expect('employee cannot change own first', pg_temp.upd('emp', 'emp', $$first_name = 'تغییر'$$), '42501');
select pg_temp.expect('employee cannot change own last', pg_temp.upd('emp', 'emp', $$last_name = 'تغییر'$$), '42501');
select pg_temp.expect('employee cannot change own full_name', pg_temp.upd('emp', 'emp', $$full_name = 'تغییر کرد'$$), '42501');
select pg_temp.expect('manager cannot change own name', pg_temp.upd('mgr', 'mgr', $$last_name = 'تغییر'$$), '42501');
select pg_temp.expect('employee keeps language', pg_temp.upd('emp', 'emp', $$language_pref = 'en'$$), 'ok');
select pg_temp.expect('employee cannot touch another', pg_temp.upd('emp', 'mgr', $$last_name = 'تغییر'$$), 'norow');
select pg_temp.expect('manager cannot touch a report', pg_temp.upd('mgr', 'emp', $$last_name = 'تغییر'$$), 'norow');
select pg_temp.expect('hr changes own name', pg_temp.upd('hr', 'hr', $$last_name = 'نیکونام'$$), 'ok');
select pg_temp.expect('hr own full_name follows', pg_temp.names('hr'), 'رها|نیکونام|رها نیکونام');
select pg_temp.expect('hr still cannot change own hire date', pg_temp.upd('hr', 'hr', $$hire_date = '2020-01-01'$$), '42501');
select pg_temp.expect('hr cannot rename the admin', pg_temp.upd('hr', 'admin', $$last_name = 'تغییر'$$), '42501');
select pg_temp.expect('admin changes own name', pg_temp.upd('admin', 'admin', $$last_name = 'ارشد'$$), 'ok');
select pg_temp.expect('admin renames anyone', pg_temp.upd('admin', 'emp', $$last_name = 'کریمیان'$$), 'ok');
select pg_temp.expect('other company refused', pg_temp.upd('outsider', 'emp', $$last_name = 'تغییر'$$), '42501');
select pg_temp.expect('nothing leaked', pg_temp.names('emp'), 'رضا|کریمیان|رضا کریمیان');

-- ── The separation job's whole-row check still passes ──────────────────────
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('bj.separation_apply', 'on', true);
  update public.profiles set active = false where id = pg_temp.fx('one');
  perform set_config('bj.separation_apply', '', true);
end; $$;
select pg_temp.expect('separation job deactivates', (select active::text from public.profiles where id = pg_temp.fx('one')), 'false');

-- ── Create paths ───────────────────────────────────────────────────────────
select pg_temp.expect('new signature needs last name', split_part(pg_temp.as_scalar('admin', format(
  $$select public.app_create_employee(p_personnel_no => '9990083011', p_full_name => null, p_first_name => 'رضا', p_last_name => ' ',
      p_password => 'Fixture!2026', p_company_id => %L, p_department_id => %L)::text$$,
  pg_temp.fx('company'), pg_temp.fx('dept'))), ' ', 2), '22023');
select pg_temp.expect('new signature needs first name', split_part(pg_temp.as_scalar('admin', format(
  $$select public.app_create_employee(p_personnel_no => '9990083011', p_full_name => null, p_first_name => '', p_last_name => 'کریمی',
      p_password => 'Fixture!2026', p_company_id => %L, p_department_id => %L)::text$$,
  pg_temp.fx('company'), pg_temp.fx('dept'))), ' ', 2), '22023');
insert into nm_fx
  select 'created', pg_temp.as_scalar('admin', format(
    $$select public.app_create_employee(p_personnel_no => '9990083011', p_full_name => null, p_first_name => 'محمد علی', p_last_name => 'کریم زاده',
        p_password => 'Fixture!2026', p_company_id => %L, p_department_id => %L)::text$$,
    pg_temp.fx('company'), pg_temp.fx('dept')))::uuid;
select pg_temp.expect('create keeps the given parts', pg_temp.names('created'), 'محمد علی|کریم زاده|محمد علی کریم زاده');
insert into nm_fx
  select 'created_old', pg_temp.as_scalar('admin', format(
    $$select public.app_create_employee(p_personnel_no => '9990083012', p_full_name => 'نیما رها زاد',
        p_password => 'Fixture!2026', p_company_id => %L, p_department_id => %L)::text$$,
    pg_temp.fx('company'), pg_temp.fx('dept')))::uuid;
select pg_temp.expect('old named call still works', pg_temp.names('created_old'), 'نیما رها زاد|-|نیما رها زاد');
insert into nm_fx
  select 'created_pos', pg_temp.as_scalar('admin', format(
    $$select public.app_create_employee('9990083013', 'سحر رادمنش', 'Fixture!2026', %L, %L)::text$$,
    pg_temp.fx('company'), pg_temp.fx('dept')))::uuid;
select pg_temp.expect('old positional call still works', pg_temp.names('created_pos'), 'سحر|رادمنش|سحر رادمنش');
select pg_temp.expect('only one app_create_employee',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_create_employee'), '1');

-- ── Bulk import ────────────────────────────────────────────────────────────
create function pg_temp.bulk(p_mode text, p_rows jsonb) returns text language sql as $$
  select pg_temp.as_scalar('admin', format(
    $q$select public.app_bulk_import_employees(%L, %L, %L::jsonb, '[]'::jsonb, current_date, false, '{}'::uuid[], '[]'::jsonb, '{}'::text[])::text$q$,
    pg_temp.fx('company'), p_mode, p_rows));
$$;
create function pg_temp.row(p_pno text, p_extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('personnel_no', p_pno, 'role', 'employee', 'department_code', 'NMA',
                            'job_title', '', 'hire_date', '', 'balance_minutes', 0, 'password', 'Fixture!2026') || p_extra;
$$;
select pg_temp.expect('import row needs last name', pg_temp.err(pg_temp.bulk('update',
  jsonb_build_array(pg_temp.row('9990083005', '{"first_name":"علی","last_name":""}')))), '22023');
select pg_temp.expect('import row needs first name', pg_temp.err(pg_temp.bulk('add',
  jsonb_build_array(pg_temp.row('9990083021', '{"first_name":" ","last_name":"کریمی"}')))), '22023');
select pg_temp.expect('import adds with parts', pg_temp.err(pg_temp.bulk('add',
  jsonb_build_array(pg_temp.row('9990083021', '{"first_name":"حسن علی","last_name":"کریم نژاد"}')))), 'ok');
insert into nm_fx select 'imported', id from public.profiles where personnel_no = '9990083021';
select pg_temp.expect('import add keeps parts', pg_temp.names('imported'), 'حسن علی|کریم نژاد|حسن علی کریم نژاد');
select pg_temp.expect('import updates with parts', pg_temp.err(pg_temp.bulk('update',
  jsonb_build_array(pg_temp.row('9990083021', '{"first_name":"حسن","last_name":"علی کریم نژاد"}')))), 'ok');
select pg_temp.expect('import update keeps parts', pg_temp.names('imported'), 'حسن|علی کریم نژاد|حسن علی کریم نژاد');
select pg_temp.expect('old app row, same name', pg_temp.err(pg_temp.bulk('update',
  jsonb_build_array(pg_temp.row('9990083021', '{"full_name":"حسن علی کریم نژاد"}')))), 'ok');
select pg_temp.expect('old app row keeps the fix', pg_temp.names('imported'), 'حسن|علی کریم نژاد|حسن علی کریم نژاد');
select pg_temp.expect('old app row, new name', pg_temp.err(pg_temp.bulk('update',
  jsonb_build_array(pg_temp.row('9990083021', '{"full_name":"حسن کریمی"}')))), 'ok');
select pg_temp.expect('old app row splits', pg_temp.names('imported'), 'حسن|کریمی|حسن کریمی');

-- ── Export ─────────────────────────────────────────────────────────────────
select pg_temp.expect('export has the parts', pg_temp.as_scalar('admin',
  $$select first_name || '|' || last_name || '|' || full_name from public.app_export_personal_info() where personnel_no = '9990083021'$$),
  'حسن|کریمی|حسن کریمی');

-- ── Every fixture holds the invariant ──────────────────────────────────────
select pg_temp.expect('full_name = first + last',
  (select count(*)::text from public.profiles
    where company_id = pg_temp.fx('company') and full_name <> concat_ws(' ', first_name, last_name)), '0');

-- ── Persian order (column collation, what PostgREST sorts by) ──────────────
do $$
declare v_co uuid := gen_random_uuid(); r record; v_i int := 0;
begin
  insert into public.companies(id, name) values (v_co, 'Order fixture');
  insert into nm_fx values ('order_co', v_co);
  for r in select * from unnest(array['یاسر','وفا','هادی','نادر','گیتی','کاوه','ژاله','چنگیز','پویا','بابک','آرش']) as n loop
    v_i := v_i + 1;
    perform pg_temp.add('order' || v_i, v_co, '99900831' || lpad(v_i::text, 2, '0'), r.n || ' فیکس');
  end loop;
end; $$;
select pg_temp.expect('Persian alphabetical order',
  (select string_agg(left(first_name, 1), '' order by first_name) from public.profiles where company_id = pg_temp.fx('order_co')),
  'آبپچژکگنوهی');

-- ── ID sort key ────────────────────────────────────────────────────────────
do $$
declare v_co uuid := gen_random_uuid(); r record; v_i int := 0;
begin
  insert into public.companies(id, name) values (v_co, 'ID fixture');
  insert into nm_fx values ('id_co', v_co);
  for r in select * from unnest(array['9','10','۱۱','SUB-1','007']) as p loop
    v_i := v_i + 1;
    perform pg_temp.add('id' || v_i, v_co, '99900832' || lpad(v_i::text, 2, '0'), 'شناسه فیکس');
    update public.profiles set personnel_no = r.p where id = pg_temp.fx('id' || v_i);
  end loop;
  perform pg_temp.add('id_none', v_co, '9990083299', 'شناسه خالی');
  update public.profiles set personnel_no = null where id = pg_temp.fx('id_none');
end; $$;
select pg_temp.expect('ID low to high',
  (select string_agg(coalesce(personnel_no, '—'), ' ' order by public.personnel_sort_key(p) asc nulls last, personnel_no asc nulls last)
     from public.profiles p where company_id = pg_temp.fx('id_co')), '007 9 10 ۱۱ SUB-1 —');
select pg_temp.expect('ID high to low',
  (select string_agg(coalesce(personnel_no, '—'), ' ' order by public.personnel_sort_key(p) desc nulls last, personnel_no desc nulls last)
     from public.profiles p where company_id = pg_temp.fx('id_co')), '۱۱ 10 9 007 SUB-1 —');
select pg_temp.expect('anon cannot run the key',
  has_function_privilege('anon', 'public.personnel_sort_key(public.profiles)', 'execute')::text, 'false');
select pg_temp.expect('authenticated runs the key',
  has_function_privilege('authenticated', 'public.personnel_sort_key(public.profiles)', 'execute')::text, 'true');

\o
\echo employee-names.sql: all assertions passed
rollback;
