-- FR-52 / FR-53 scenarios: saved signature and personal information access.
--
-- Runs in ONE transaction and rolls back, so it is safe on a database that holds
-- real data. Needs the image superuser (fixture users go into auth.users). Local
-- stack, from the repo root:
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q ) \
--     < tests/sql/fr52-53-signature-personal-info.sql
-- Dry-run before the migration is applied: prepend `begin;` + the migration file and
-- drop this file's own `begin;` line (see docs/AGENT-LOG.md 2026-10-07).
-- Every line prints PASS or FAIL.
\set ON_ERROR_STOP on
\o /dev/null
begin;

create temp table fx (k text primary key, id uuid not null);
grant select on fx to authenticated;

create function pg_temp.try_as(p_actor text, p_sql text) returns text
language plpgsql as $f$
declare
  v_rows int;
  v_res  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where k = p_actor), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_res := 'ok:' || v_rows;
  exception when others then
    v_res := sqlstate;
  end;
  execute 'reset role';
  return v_res;
end $f$;

-- Like try_as, but returns the first column of the first row as text.
create function pg_temp.value_as(p_actor text, p_sql text) returns text
language plpgsql as $f$
declare
  v_res text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where k = p_actor), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v_res;
  exception when others then
    v_res := sqlstate;
  end;
  execute 'reset role';
  return coalesce(v_res, '<null>');
end $f$;

create function pg_temp.expect(p_name text, p_got text, p_want text) returns void
language plpgsql as $f$
begin
  raise notice '% %: got %, want %',
    case when p_got = p_want then 'PASS' else 'FAIL' end, p_name, p_got, p_want;
end $f$;

create function pg_temp.id(p_k text) returns text
language sql as $f$ select quote_literal((select id from fx where k = p_k)::text) $f$;

-- A valid 1×1 PNG data URL long enough for the shape check.
create function pg_temp.png() returns text
language sql as $f$
  select 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwQG8QAAAABJRU5ErkJggg=='
$f$;

-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  v_company uuid := (select company_id from public.profiles where employee_code = 'admin');
  r record;
begin
  for r in
    select * from (values
      ('hr',   'hr',       '9990000951'),
      ('mgr',  'manager',  '9990000952'),
      ('emp',  'employee', '9990000953'),
      ('peer', 'employee', '9990000954'),
      ('adm',  'admin',    '9990000955'),
      ('sec',  'security', '9990000956')
    ) as t(k, role, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email) values ((select id from fx where k = r.k), r.code || '@fixture.invalid');
    insert into public.profiles (id, company_id, employee_code, full_name, manager_id, active, personnel_no, must_change_password)
    values ((select id from fx where k = r.k), v_company, r.code, 'FR53 ' || r.k,
            case when r.k = 'emp' then (select id from fx where k = 'mgr') end,
            true, r.code, false);
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), r.role::public.app_role);
    if r.role <> 'employee' then
      insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    end if;
  end loop;

  insert into public.companies (name) values ('FR53 Other Co') returning id into v_company;
  insert into fx values ('outsider', gen_random_uuid());
  insert into auth.users (id, email) values ((select id from fx where k = 'outsider'), '9990000957@fixture.invalid');
  insert into public.profiles (id, company_id, employee_code, full_name, active, personnel_no, must_change_password)
  values ((select id from fx where k = 'outsider'), v_company, '9990000957', 'FR53 outsider', true, '9990000957', false);
  insert into public.user_roles (user_id, role) values ((select id from fx where k = 'outsider'), 'hr');
end $$;

-- ── validators ──────────────────────────────────────────────────────────────
select pg_temp.expect('national id valid',   private.is_valid_national_id('0012345679')::text, 'true');
select pg_temp.expect('national id bad digit', private.is_valid_national_id('0012345678')::text, 'false');
select pg_temp.expect('national id same digits', private.is_valid_national_id('1111111111')::text, 'false');
select pg_temp.expect('sheba valid',   private.is_valid_sheba('IR820540102680020817909002')::text, 'true');
select pg_temp.expect('sheba bad',     private.is_valid_sheba('IR820540102680020817909003')::text, 'false');
select pg_temp.expect('card valid',    private.is_valid_card_no('6037991234567893')::text, 'true');
select pg_temp.expect('card bad',      private.is_valid_card_no('6037991234567890')::text, 'false');

-- ── the profile trigger created a row for each fixture ──────────────────────
select pg_temp.expect('personal info row created with the profile',
  (select count(*) from public.employee_personal_info
    where employee_id in (select id from fx where k in ('hr','mgr','emp','peer','adm','sec','outsider')))::text, '7');

-- ── saved signature: owner only ─────────────────────────────────────────────
select pg_temp.expect('owner saves a signature',
  pg_temp.try_as('emp', format('insert into public.user_signatures (user_id, signature_data, source) values (%s, %L, %L)',
    pg_temp.id('emp'), pg_temp.png(), 'drawn')), 'ok:1');
select pg_temp.expect('owner reads own signature',
  pg_temp.value_as('emp', format('select source from public.user_signatures where user_id = %s', pg_temp.id('emp'))), 'drawn');
select pg_temp.expect('owner replaces own signature',
  pg_temp.try_as('emp', format('update public.user_signatures set source = %L where user_id = %s', 'upload', pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('admin cannot read someone''s signature',
  pg_temp.value_as('adm', format('select count(*) from public.user_signatures where user_id = %s', pg_temp.id('emp'))), '0');
select pg_temp.expect('hr cannot read someone''s signature',
  pg_temp.value_as('hr', format('select count(*) from public.user_signatures where user_id = %s', pg_temp.id('emp'))), '0');
select pg_temp.expect('manager cannot read a report''s signature',
  pg_temp.value_as('mgr', format('select count(*) from public.user_signatures where user_id = %s', pg_temp.id('emp'))), '0');
select pg_temp.expect('nobody saves a signature for someone else',
  pg_temp.try_as('adm', format('insert into public.user_signatures (user_id, signature_data, source) values (%s, %L, %L)',
    pg_temp.id('emp'), pg_temp.png(), 'drawn')), '42501');
select pg_temp.expect('non-PNG signature rejected',
  pg_temp.try_as('peer', format('insert into public.user_signatures (user_id, signature_data, source) values (%s, %L, %L)',
    pg_temp.id('peer'), replace(pg_temp.png(), 'image/png', 'image/svg+xml'), 'drawn')), '23514');
select pg_temp.expect('signature audit carries no image',
  (select count(*) from public.audit_log
    where entity = 'user_signatures' and entity_id = (select id from fx where k = 'emp')
      and after ? 'source' and not after ? 'signature_data')::text, '2');
select pg_temp.expect('owner deletes own signature',
  pg_temp.try_as('emp', format('delete from public.user_signatures where user_id = %s', pg_temp.id('emp'))), 'ok:1');

-- ── personal info: self ─────────────────────────────────────────────────────
select pg_temp.expect('employee edits own personal info',
  pg_temp.try_as('emp', format(
    'update public.employee_personal_info set national_id = %L, father_name = %L, birth_date = %L, sheba = %L, mobile = %L where employee_id = %s',
    '0012345679', 'Ali', '1990-03-21', 'IR820540102680020817909002', '09121234567', pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('complete flag set when the core five are filled',
  (select complete::text from public.employee_personal_info where employee_id = (select id from fx where k = 'emp')), 'true');
select pg_temp.expect('updated_by stamped',
  (select (updated_by = (select id from fx where k = 'emp'))::text from public.employee_personal_info
    where employee_id = (select id from fx where k = 'emp')), 'true');
select pg_temp.expect('bad national id rejected',
  pg_temp.try_as('emp', format('update public.employee_personal_info set national_id = %L where employee_id = %s',
    '0012345678', pg_temp.id('emp'))), '23514');
select pg_temp.expect('bad card number rejected',
  pg_temp.try_as('emp', format('update public.employee_personal_info set card_no = %L where employee_id = %s',
    '6037991234567890', pg_temp.id('emp'))), '23514');
select pg_temp.expect('bad mobile rejected',
  pg_temp.try_as('emp', format('update public.employee_personal_info set mobile = %L where employee_id = %s',
    '9121234567', pg_temp.id('emp'))), '23514');
select pg_temp.expect('employee cannot move their row to another employee',
  pg_temp.try_as('emp', format('update public.employee_personal_info set employee_id = %s where employee_id = %s',
    pg_temp.id('peer'), pg_temp.id('emp'))), '42501');
select pg_temp.expect('employee cannot insert rows',
  pg_temp.try_as('emp', format('insert into public.employee_personal_info (employee_id, company_id) values (gen_random_uuid(), (select company_id from public.profiles where id = %s))',
    pg_temp.id('emp'))), '42501');
select pg_temp.expect('employee cannot delete rows',
  pg_temp.try_as('emp', format('delete from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), '42501');
select pg_temp.expect('audit records field names, not values',
  (select (after->'fields' ? 'national_id' and after::text not like '%0012345679%')::text
     from public.audit_log
    where entity = 'employee_personal_info' and entity_id = (select id from fx where k = 'emp')
    order by created_at desc limit 1), 'true');

-- ── personal info: who else may read and write ──────────────────────────────
select pg_temp.expect('peer cannot read a colleague''s personal info',
  pg_temp.value_as('peer', format('select count(*) from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), '0');
select pg_temp.expect('manager cannot read a report''s personal info',
  pg_temp.value_as('mgr', format('select count(*) from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), '0');
select pg_temp.expect('security cannot read personal info',
  pg_temp.value_as('sec', format('select count(*) from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), '0');
select pg_temp.expect('peer cannot update a colleague',
  pg_temp.try_as('peer', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'x', pg_temp.id('emp'))), 'ok:0');
select pg_temp.expect('hr reads an employee''s personal info',
  pg_temp.value_as('hr', format('select national_id from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), '0012345679');
select pg_temp.expect('hr corrects an employee''s personal info',
  pg_temp.try_as('hr', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'Reza', pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('hr reads an admin''s personal info',
  pg_temp.value_as('hr', format('select count(*) from public.employee_personal_info where employee_id = %s', pg_temp.id('adm'))), '1');
select pg_temp.expect('hr cannot edit an admin''s personal info',
  pg_temp.try_as('hr', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'x', pg_temp.id('adm'))), 'ok:0');
select pg_temp.expect('admin edits an employee''s personal info',
  pg_temp.try_as('adm', format('update public.employee_personal_info set bank_name = %L where employee_id = %s', 'Melli', pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('hr of another company sees nothing',
  pg_temp.value_as('outsider', format('select count(*) from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), '0');

-- ── export / import ─────────────────────────────────────────────────────────
select pg_temp.expect('hr exports',
  pg_temp.value_as('hr', format('select national_id from public.app_export_personal_info() where personnel_no = %L', '9990000953')), '0012345679');
select pg_temp.expect('export is audit-logged',
  (select count(*) from public.audit_log where action = 'personal_info.export'
     and actor_id = (select id from fx where k = 'hr'))::text, '1');
select pg_temp.expect('employee cannot export',
  pg_temp.try_as('emp', 'select * from public.app_export_personal_info()'), '42501');
select pg_temp.expect('manager cannot export',
  pg_temp.try_as('mgr', 'select * from public.app_export_personal_info()'), '42501');
select pg_temp.expect('hr imports; empty cells keep stored values',
  pg_temp.value_as('hr', format('select public.app_import_personal_info(%L::jsonb)->>%L',
    '[{"personnel_no":"9990000954","mobile":"09351234567","children_count":"2"},{"personnel_no":"9990000953","postal_code":"1234567890"}]', 'updated')), '2');
select pg_temp.expect('import kept the untouched national id',
  (select national_id || '/' || postal_code from public.employee_personal_info
    where employee_id = (select id from fx where k = 'emp')), '0012345679/1234567890');
select pg_temp.expect('import rejects an unknown personnel number',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000999","mobile":"09351234567"}]')), '22023');
select pg_temp.expect('import rejects another company''s personnel number',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000957","mobile":"09351234567"}]')), '22023');
select pg_temp.expect('import rejects duplicates',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L::jsonb)',
    '[{"personnel_no":"9990000954","mobile":"09351234567"},{"personnel_no":"9990000954","mobile":"09351234568"}]')), '22023');
select pg_temp.expect('import rejects an unknown field',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000954","salary":"1"}]')), '22023');
select pg_temp.expect('import rejects a bad value',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000954","sheba":"IR000"}]')), '23514');
select pg_temp.expect('hr cannot import onto an admin',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000955","mobile":"09351234567"}]')), '42501');
select pg_temp.expect('admin can import onto an admin',
  pg_temp.try_as('adm', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000955","mobile":"09351234567"}]')), 'ok:1');
select pg_temp.expect('employee cannot import',
  pg_temp.try_as('emp', format('select public.app_import_personal_info(%L::jsonb)', '[{"personnel_no":"9990000953","mobile":"09351234567"}]')), '42501');

-- ── cascade ─────────────────────────────────────────────────────────────────
delete from public.profiles where id = (select id from fx where k = 'peer');
select pg_temp.expect('personal info deleted with the profile',
  (select count(*) from public.employee_personal_info where employee_id = (select id from fx where k = 'peer'))::text, '0');

rollback;
