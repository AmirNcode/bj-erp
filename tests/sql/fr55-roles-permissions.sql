-- FR-55 scenarios: configurable roles, permissions, exactly one admin.
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
  insert into fx values ('company', v_company), ('dept', v_dept);
  insert into fx values ('admin', (select id from public.profiles where employee_code = 'admin'));
  for r in
    select * from (values
      ('hr',      'hr',       true,  '9990000951'),
      ('hr_off',  'hr',       false, '9990000952'),
      ('mgr',     'manager',  true,  '9990000953'),
      ('emp',     'employee', true,  '9990000954'),
      ('emp2',    'employee', true,  '9990000955'),
      ('help',    'employee', true,  '9990000956'),
      ('deptmgr', 'employee', true,  '9990000957'),
      ('sec',     'security', true,  '9990000958'),
      ('fin',     'finance',  true,  '9990000959'),
      ('super',   'employee', true,  '9990000960')
    ) as t(k, role, active, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email, encrypted_password)
      values ((select id from fx where k = r.k), r.code || '@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id, active, personnel_no, must_change_password)
    values ((select id from fx where k = r.k), v_company, r.code, 'FR55 ' || r.k, v_dept,
            case when r.k = 'emp' then (select id from fx where k = 'mgr') end,
            r.active, r.code, false);
    -- Enum-only insert, as the old app and older SQL do: the sync trigger fills role_id.
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), r.role::public.app_role);
    if r.role <> 'employee' then
      insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    end if;
  end loop;
end $$;

-- ── tables (Task 1) ─────────────────────────────────────────────────────────
select pg_temp.expect('six roles seeded for the company',
  (select count(*)::text from public.roles where company_id = (select id from fx where k = 'company')), '6');
select pg_temp.expect('enum-only insert gets role_id',
  (select count(*)::text from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = (select id from fx where k = 'hr') and r.system_key = 'hr'), '1');
select pg_temp.expect('hr preset has 12 permissions',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key = 'hr'), '12');
select pg_temp.expect('security preset has 4, finance 1',
  (select string_agg(n::text, ',' order by k) from (
     select r.system_key::text k, count(*) n from public.role_permissions rp join public.roles r on r.id = rp.role_id
      where r.company_id = (select id from fx where k = 'company') and r.system_key in ('security','finance') group by 1) s), '1,4');
do $$
declare v_new uuid;
begin
  insert into public.companies (name) values ('FR55 Other Co') returning id into v_new;
  insert into fx values ('other_company', v_new);
end $$;
select pg_temp.expect('a new company gets its six roles',
  (select count(*)::text from public.roles where company_id = (select id from fx where k = 'other_company')), '6');
do $$
begin
  begin
    insert into public.user_roles (user_id, role) values ((select id from fx where k = 'emp2'), 'admin');
    raise notice 'FAIL second admin insert: got ok, want 23505';
  exception when unique_violation then
    raise notice 'PASS second admin insert: got 23505, want 23505';
  end;
end $$;
select pg_temp.expect('clients cannot insert roles directly (even the admin)',
  pg_temp.try_as('admin', $q$insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'),'custom','Clerk')$q$),
  '42501');
do $$
begin
  begin
    insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'حسابداری');
    raise notice 'FAIL non-latin role name: got ok, want 23514';
  exception when check_violation then
    raise notice 'PASS non-latin role name: got 23514, want 23514';
  end;
end $$;
select pg_temp.expect('permission catalog check',
  (select private.permission_allows('calendar','edit')::text || private.permission_allows('people','read')::text), 'falsetrue');
-- Old SQL that inserts enum-only rows (app_create_employee -> create_employee_impl) still works.
select pg_temp.expect('admin creates an employee through the enum path',
  pg_temp.try_as('admin', $q$select public.app_create_employee('9990000962','FR55 created','Temp!2026x', (select id from fx where k='company'), (select id from fx where k='dept'))$q$),
  'ok:1');
select pg_temp.expect('every role row of the created employee has role_id',
  (select count(*)::text || '/' || count(ur.role_id)::text
     from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where p.employee_code = '9990000962'), '1/1');

rollback;
