-- FR-51 scenarios: what an hr user may and may not change.
--
-- Runs in ONE transaction and rolls back, so it is safe on a database that holds
-- real data. Fixture users are created inside the transaction, which needs the
-- image superuser (`postgres` cannot write auth.users). Local stack, from the repo root:
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q ) \
--     < tests/sql/fr51-hr-employee-admin.sql
-- Every line prints PASS or FAIL; a FAIL means the guards drifted from
-- docs/PERMISSIONS.md.
\set ON_ERROR_STOP on
-- Results arrive as NOTICEs (stderr); hide the empty result sets.
\o /dev/null
begin;

create temp table fx (k text primary key, id uuid not null);
grant select on fx to authenticated;

-- Runs p_sql as `authenticated` with auth.uid() = p_actor. Returns 'ok:<rows>'
-- or '<sqlstate>' so a scenario can assert either outcome.
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

create function pg_temp.expect(p_name text, p_got text, p_want text) returns void
language plpgsql as $f$
begin
  raise notice '% %: got %, want %',
    case when p_got = p_want then 'PASS' else 'FAIL' end, p_name, p_got, p_want;
end $f$;

create function pg_temp.id(p_k text) returns text
language sql as $f$ select quote_literal((select id from fx where k = p_k)::text) $f$;

-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  v_company uuid := (select company_id from public.profiles where employee_code = 'admin');
  v_dept    uuid := (select id from public.departments where company_id = v_company order by code limit 1);
  r record;
begin
  for r in
    select * from (values
      ('hr',      'hr',      true,  '9990000901'),
      ('mgr',     'manager', true,  '9990000903'),
      ('emp',     'employee',true,  '9990000902'),
      ('adm2',    'admin',   true,  '9990000904'),
      ('adm_off', 'admin',   false, '9990000905')
    ) as t(k, role, active, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email) values ((select id from fx where k = r.k), r.code || '@fixture.invalid');
    -- emp reports to mgr (inserted first): set at insert, since an UPDATE without
    -- an auth context is refused by the profile guard.
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id, active, personnel_no, must_change_password)
    values ((select id from fx where k = r.k), v_company, r.code, 'FR51 ' || r.k, v_dept,
            case when r.k = 'emp' then (select id from fx where k = 'mgr') end,
            r.active, r.code, false);
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), r.role::public.app_role);
    if r.role <> 'employee' then
      insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    end if;
  end loop;
  insert into fx values ('dept', v_dept);
  insert into fx values ('dept2', (select id from public.departments where company_id = v_company and id <> v_dept order by code limit 1));
  insert into fx values ('company', v_company);
end $$;

-- ── hr on an ordinary employee ──────────────────────────────────────────────
select pg_temp.expect('hr edits name, hire date, department, manager, title',
  pg_temp.try_as('hr', format(
    'update public.profiles set full_name = %s, hire_date = %s, department_id = %s, manager_id = %s, job_title = %s where id = %s',
    quote_literal('FR51 renamed'), quote_literal('2020-01-01'), pg_temp.id('dept2'), pg_temp.id('mgr'),
    quote_literal('Welder'), pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('hr deactivates an employee',
  pg_temp.try_as('hr', format('update public.profiles set active = false where id = %s', pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('hr reactivates an employee',
  pg_temp.try_as('hr', format('update public.profiles set active = true where id = %s', pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('hr may not change a personnel number',
  pg_temp.try_as('hr', format('update public.profiles set personnel_no = %s where id = %s', quote_literal('9990000999'), pg_temp.id('emp'))), '42501');
select pg_temp.expect('hr may not change a login code',
  pg_temp.try_as('hr', format('update public.profiles set employee_code = %s where id = %s', quote_literal('9990000999'), pg_temp.id('emp'))), '42501');
select pg_temp.expect('hr edits a manager''s record',
  pg_temp.try_as('hr', format('update public.profiles set job_title = %s where id = %s', quote_literal('Lead'), pg_temp.id('mgr'))), 'ok:1');

-- ── hr on admins and on self ────────────────────────────────────────────────
select pg_temp.expect('hr may not edit an admin',
  pg_temp.try_as('hr', format('update public.profiles set job_title = %s where id = %s', quote_literal('x'), pg_temp.id('adm2'))), '42501');
select pg_temp.expect('hr may not deactivate an admin',
  pg_temp.try_as('hr', format('update public.profiles set active = false where id = %s', pg_temp.id('adm2'))), '42501');
select pg_temp.expect('hr may not reactivate a deactivated admin',
  pg_temp.try_as('hr', format('update public.profiles set active = true where id = %s', pg_temp.id('adm_off'))), '42501');
select pg_temp.expect('hr may not move themselves',
  pg_temp.try_as('hr', format('update public.profiles set department_id = %s where id = %s', pg_temp.id('dept2'), pg_temp.id('hr'))), '42501');
select pg_temp.expect('hr may not retitle themselves',
  pg_temp.try_as('hr', format('update public.profiles set job_title = %s where id = %s', quote_literal('Boss'), pg_temp.id('hr'))), '42501');
select pg_temp.expect('hr may not deactivate themselves',
  pg_temp.try_as('hr', format('update public.profiles set active = false where id = %s', pg_temp.id('hr'))), '42501');
select pg_temp.expect('hr still edits own name',
  pg_temp.try_as('hr', format('update public.profiles set full_name = %s where id = %s', quote_literal('FR51 hr2'), pg_temp.id('hr'))), 'ok:1');

-- ── the job_title / personnel_no gap, closed for everyone else ──────────────
select pg_temp.expect('employee may not retitle themselves',
  pg_temp.try_as('emp', format('update public.profiles set job_title = %s where id = %s', quote_literal('CEO'), pg_temp.id('emp'))), '42501');
select pg_temp.expect('employee may not change own personnel number',
  pg_temp.try_as('emp', format('update public.profiles set personnel_no = %s where id = %s', quote_literal('9990000998'), pg_temp.id('emp'))), '42501');
select pg_temp.expect('manager may not retitle a report',
  pg_temp.try_as('mgr', format('update public.profiles set job_title = %s where id = %s', quote_literal('x'), pg_temp.id('emp'))), '42501');
select pg_temp.expect('manager still edits a report''s name',
  pg_temp.try_as('mgr', format('update public.profiles set full_name = %s where id = %s', quote_literal('FR51 emp3'), pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('employee may not move a colleague',
  pg_temp.try_as('emp', format('update public.profiles set department_id = %s where id = %s', pg_temp.id('dept'), pg_temp.id('mgr'))), 'ok:0');

-- ── departments ─────────────────────────────────────────────────────────────
select pg_temp.expect('hr creates a department',
  pg_temp.try_as('hr', format(
    'insert into public.departments (company_id, name_fa, name_en, kind, code) values (%s, %s, %s, %s, %s)',
    pg_temp.id('company'), quote_literal('آزمون'), quote_literal('FR51 Test'),
    quote_literal((select kind::text from public.departments limit 1)), quote_literal('ZZ9'))), 'ok:1');
select pg_temp.expect('hr renames a department and sets its manager',
  pg_temp.try_as('hr', format(
    'update public.departments set name_fa = %s, name_en = %s, manager_id = %s where code = %s',
    quote_literal('آزمون ۲'), quote_literal('FR51 Test 2'), pg_temp.id('mgr'), quote_literal('ZZ9'))), 'ok:1');
select pg_temp.expect('hr may not change a department code',
  pg_temp.try_as('hr', format('update public.departments set code = %s where code = %s', quote_literal('ZZ8'), quote_literal('ZZ9'))), '42501');
select pg_temp.expect('hr may not delete a department',
  pg_temp.try_as('hr', format('delete from public.departments where code = %s', quote_literal('ZZ9'))), 'ok:0');
select pg_temp.expect('employee may not rename a department',
  pg_temp.try_as('emp', format('update public.departments set name_en = %s where code = %s', quote_literal('x'), quote_literal('ZZ9'))), 'ok:0');

-- ── roles: hr may add or remove `manager` only ──────────────────────────────
select pg_temp.expect('hr gives the manager role',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('emp'), quote_literal('{employee,manager}'))), 'ok:1');
select pg_temp.expect('hr removes the manager role',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('emp'), quote_literal('{employee}'))), 'ok:1');
select pg_temp.expect('hr may not give security',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('emp'), quote_literal('{employee,security}'))), '42501');
select pg_temp.expect('hr may not give hr',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('emp'), quote_literal('{employee,hr}'))), '42501');
select pg_temp.expect('hr may not remove employee',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('mgr'), quote_literal('{manager}'))), '42501');
select pg_temp.expect('hr may not change an admin''s roles',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('adm2'), quote_literal('{admin,employee,manager}'))), '42501');
select pg_temp.expect('hr may not make themselves a manager',
  pg_temp.try_as('hr', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('hr'), quote_literal('{employee,hr,manager}'))), '42501');
select pg_temp.expect('employee may not set roles',
  pg_temp.try_as('emp', format('select public.app_set_user_roles(%s, %s)', pg_temp.id('mgr'), quote_literal('{employee}'))), '42501');

-- ── monthly accrual ─────────────────────────────────────────────────────────
select pg_temp.expect('hr posts monthly accruals',
  pg_temp.try_as('hr', 'select public.accrue_all_leave()'), 'ok:1');
select pg_temp.expect('employee may not post accruals',
  pg_temp.try_as('emp', 'select public.accrue_all_leave()'), '42501');

-- ── admin unchanged ─────────────────────────────────────────────────────────
select pg_temp.expect('admin still changes a personnel number',
  pg_temp.try_as('adm2', format('update public.profiles set personnel_no = %s where id = %s', quote_literal('9990000997'), pg_temp.id('emp'))), 'ok:1');
select pg_temp.expect('admin still changes a department code',
  pg_temp.try_as('adm2', format('update public.departments set code = %s where code = %s', quote_literal('ZZ7'), quote_literal('ZZ9'))), 'ok:1');

rollback;
