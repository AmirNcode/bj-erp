-- FR-55 scenarios: configurable roles, permissions, exactly one admin.
--
-- Runs in ONE transaction and rolls back, so it is safe on a database that holds
-- real data. Fixture users are created inside the transaction, which needs the
-- image superuser (`postgres` cannot write auth.users). Local stack, from the repo root:
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q ) \
--     < tests/sql/fr55-roles-permissions.sql
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
select pg_temp.expect('the created employee holds the company Employee role by role_id',
  (select count(*)::text from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where p.employee_code = '9990000962'
      and ur.role_id = (select id from public.roles
                         where company_id = (select id from fx where k = 'company') and system_key = 'employee')), '1');

-- ── Task 1 follow-ups (guards added in 20261007160002) ──────────────────────
-- Runs p_sql as the superuser with no JWT, in a subtransaction. Returns
-- 'ok:<rows>' or '<sqlstate>'.
create function pg_temp.try_su(p_sql text) returns text
language plpgsql as $f$
declare
  v_rows int;
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    return 'ok:' || v_rows;
  exception when others then
    return sqlstate;
  end;
end $f$;

create function pg_temp.role_id(p_company text, p_key text) returns text
language sql as $f$
  select quote_literal((select id from public.roles
                         where company_id = (select id from fx where k = p_company)
                           and system_key = p_key::public.app_role)::text)
$f$;

select pg_temp.expect('role_id-only insert of a built-in',
  pg_temp.try_su(format('insert into public.user_roles (user_id, role_id) values (%s, %s)',
    pg_temp.id('emp2'), pg_temp.role_id('company', 'manager'))), 'ok:1');
select pg_temp.expect('… fills the enum column from the role',
  (select ur.role::text from public.user_roles ur
    where ur.user_id = (select id from fx where k = 'emp2')
      and ur.role_id = (select id from public.roles where company_id = (select id from fx where k = 'company') and system_key = 'manager')),
  'manager');
select pg_temp.expect('(cleanup) emp2 loses the manager row',
  pg_temp.try_su(format('delete from public.user_roles where user_id = %s and role = %L', pg_temp.id('emp2'), 'manager')), 'ok:1');
select pg_temp.expect('second admin by role_id hits the one-admin index',
  pg_temp.try_su(format('insert into public.user_roles (user_id, role_id) values (%s, %s)',
    pg_temp.id('emp2'), pg_temp.role_id('company', 'admin'))), '23505');
select pg_temp.expect('a role of another company is refused',
  pg_temp.try_su(format('insert into public.user_roles (user_id, role_id) values (%s, %s)',
    pg_temp.id('emp2'), pg_temp.role_id('other_company', 'finance'))), '42501');
select pg_temp.expect('changing role without role_id is refused',
  pg_temp.try_su(format('update public.user_roles set role = %L where user_id = %s', 'hr', pg_temp.id('emp2'))), '22023');
select pg_temp.expect('changing role_id moves the enum with it',
  pg_temp.try_su(format('update public.user_roles set role_id = %s where user_id = %s', pg_temp.role_id('company', 'finance'), pg_temp.id('emp2'))), 'ok:1');
select pg_temp.expect('… to finance',
  (select role::text from public.user_roles where user_id = (select id from fx where k = 'emp2')), 'finance');
select pg_temp.expect('(cleanup) emp2 back to employee',
  pg_temp.try_su(format('update public.user_roles set role_id = %s where user_id = %s', pg_temp.role_id('company', 'employee'), pg_temp.id('emp2'))), 'ok:1');
select pg_temp.expect('a member reads their own company''s roles',
  pg_temp.try_as('emp', format('select 1 from public.roles where company_id = %s', pg_temp.id('company'))), 'ok:6');
select pg_temp.expect('nobody reads another company''s roles (not even the admin)',
  pg_temp.try_as('admin', format('select 1 from public.roles where company_id = %s', pg_temp.id('other_company'))), 'ok:0');
select pg_temp.expect('nobody reads another company''s role permissions',
  pg_temp.try_as('admin', format('select 1 from public.role_permissions where role_id = %s', pg_temp.role_id('other_company', 'hr'))), 'ok:0');
select pg_temp.expect('clients cannot insert role permissions (even the admin)',
  pg_temp.try_as('admin', format('insert into public.role_permissions values (%s, %L, %L)', pg_temp.role_id('company', 'hr'), 'passwords', 'edit')), '42501');
select pg_temp.expect('clients cannot update role permissions',
  pg_temp.try_as('admin', format('update public.role_permissions set level = %L where role_id = %s', 'read', pg_temp.role_id('company', 'hr'))), '42501');
select pg_temp.expect('clients cannot delete role permissions',
  pg_temp.try_as('admin', format('delete from public.role_permissions where role_id = %s', pg_temp.role_id('company', 'hr'))), '42501');
select pg_temp.expect('no permission rows on the Employee role (everyone holds it)',
  pg_temp.try_su(format('insert into public.role_permissions values (%s, %L, %L)', pg_temp.role_id('company', 'employee'), 'people', 'read')), '22023');
select pg_temp.expect('no permission rows on the Admin role',
  pg_temp.try_su(format('insert into public.role_permissions values (%s, %L, %L)', pg_temp.role_id('company', 'admin'), 'people', 'read')), '22023');
select pg_temp.expect('no moving a permission row onto the Manager role',
  pg_temp.try_su(format('update public.role_permissions set role_id = %s where role_id = %s', pg_temp.role_id('company', 'manager'), pg_temp.role_id('company', 'finance'))), '22023');
select pg_temp.expect('preset rows stay writable for the definer code',
  pg_temp.try_su(format('update public.role_permissions set level = %L where role_id = %s and permission = %L', 'read', pg_temp.role_id('company', 'finance'), 'clearance')), 'ok:1');

-- ── helpers + gates (Task 2) ────────────────────────────────────────────────
do $$
declare v_role uuid;
begin
  insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'Helpdesk') returning id into v_role;
  insert into public.role_permissions values (v_role, 'people', 'read'), (v_role, 'passwords', 'edit');
  insert into fx values ('r_help', v_role);
  insert into public.user_roles (user_id, role_id) values ((select id from fx where k='help'), v_role);
  -- 'super': every catalog item at its highest level (D2 checks)
  insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'Everything') returning id into v_role;
  insert into public.role_permissions select v_role, k, case when private.permission_allows(k,'edit') then 'edit' else 'read' end from private.permission_keys() k;
  insert into fx values ('r_super', v_role);
  insert into public.user_roles (user_id, role_id) values ((select id from fx where k='super'), v_role);
  update public.departments set manager_id = (select id from fx where k='deptmgr') where id = (select id from fx where k='dept');
  -- 'nosign': every catalog item except approval_steps and clearance, so only the
  -- identity clauses of can_act_on can refuse it.
  insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'NoSign') returning id into v_role;
  insert into public.role_permissions select v_role, k, case when private.permission_allows(k,'edit') then 'edit' else 'read' end
    from private.permission_keys() k where k not in ('approval_steps', 'clearance');
  insert into fx values ('r_nosign', v_role);
  -- A custom role of the other company with no permission rows (role_within fail-open check).
  insert into public.roles (company_id, kind, name) values ((select id from fx where k='other_company'), 'custom', 'Clerk') returning id into v_role;
  insert into fx values ('r_other_clerk', v_role);
end $$;

-- More fixtures: identity holders, an outsider in the other company, the nosign caller.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('appr',     'company',       '9990000971'),
      ('appr_off', 'company',       '9990000972'),
      ('signer',   'company',       '9990000973'),
      ('nosign',   'company',       '9990000974'),
      ('outsider', 'other_company', '9990000970')
    ) as t(k, co, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email, encrypted_password)
      values ((select id from fx where k = r.k), r.code || '@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, active, personnel_no, must_change_password)
    values ((select id from fx where k = r.k), (select id from fx where k = r.co), r.code, 'FR55 ' || r.k,
            case when r.co = 'company' then (select id from fx where k = 'dept') end, true, r.code, false);
    -- Enum-only: the sync trigger resolves the employee role of the profile's own company.
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
  end loop;
  insert into public.user_roles (user_id, role_id) values ((select id from fx where k='nosign'), (select id from fx where k='r_nosign'));
  insert into public.approval_steps (company_id, role, approver_id, step_order, active) values
    ((select id from fx where k='company'), 'employee', (select id from fx where k='appr'), 91, true),
    ((select id from fx where k='company'), 'employee', (select id from fx where k='appr_off'), 92, false);
  insert into public.separation_units (company_id, kind, name_fa, name_en, signer_id)
  values ((select id from fx where k='company'), 'person', 'آزمون', 'FR55 signer', (select id from fx where k='signer'));
end $$;
select pg_temp.expect('the outsider holds the other company''s Employee role',
  (select count(*)::text from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = (select id from fx where k='outsider')
      and r.company_id = (select id from fx where k='other_company') and r.system_key = 'employee'), '1');

select pg_temp.expect('perm_level: hr people edit, help passwords edit, emp none',
  (select private.perm_level((select id from fx where k='hr'),'people')::text
       || private.perm_level((select id from fx where k='help'),'passwords')::text
       || private.perm_level((select id from fx where k='emp'),'people')::text), '220');
select pg_temp.expect('admin perm_level is max per key',
  (select private.perm_level((select id from fx where k='admin'),'calendar')::text
       || private.perm_level((select id from fx where k='admin'),'people')::text), '12');
select pg_temp.expect('has_perm: an inactive holder has nothing',
  (select private.has_perm((select id from fx where k='hr_off'),'people','read')::text), 'false');
select pg_temp.expect('has_perm: read is enough for read, not for edit',
  (select private.has_perm((select id from fx where k='help'),'people','read')::text
       || private.has_perm((select id from fx where k='help'),'people','edit')::text), 'truefalse');
select pg_temp.expect('legacy key alias still answers',
  (select private.has_permission((select id from fx where k='hr'),'employees.edit')::text
       || private.has_permission((select id from fx where k='fin'),'separations.view')::text
       || private.has_permission((select id from fx where k='sec'),'employees.edit')::text), 'truetruefalse');
-- subset rule (D4)
select pg_temp.expect('helpdesk acts on a plain employee',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='emp2'))::text), 'true');
select pg_temp.expect('helpdesk not on a manager (relationship power)',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='mgr'))::text), 'false');
select pg_temp.expect('helpdesk not on a department manager',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='deptmgr'))::text), 'false');
select pg_temp.expect('helpdesk not on hr (more permissions)',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='hr'))::text), 'false');
select pg_temp.expect('helpdesk may not reactivate a deactivated hr',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='hr_off'))::text), 'false');
select pg_temp.expect('nobody acts on the admin, not even Everything',
  (select private.can_act_on((select id from fx where k='super'), (select id from fx where k='admin'))::text), 'false');
select pg_temp.expect('never on yourself',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='hr'))::text), 'false');
select pg_temp.expect('hr acts on security and finance (parity)',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='sec'))::text
       || private.can_act_on((select id from fx where k='hr'), (select id from fx where k='fin'))::text), 'truetrue');
select pg_temp.expect('hr acts on a manager and a department manager (parity)',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='mgr'))::text
       || private.can_act_on((select id from fx where k='hr'), (select id from fx where k='deptmgr'))::text), 'truetrue');
select pg_temp.expect('hr not on helpdesk (passwords hr lacks)',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='help'))::text), 'false');
select pg_temp.expect('nobody acts across companies (Everything, hr, the admin)',
  (select private.can_act_on((select id from fx where k='super'), (select id from fx where k='outsider'))::text
       || private.can_act_on((select id from fx where k='hr'), (select id from fx where k='outsider'))::text
       || private.can_act_on((select id from fx where k='admin'), (select id from fx where k='outsider'))::text), 'falsefalsefalse');
-- identity powers (approval steps, clearance boxes)
select pg_temp.expect('helpdesk acts on the holder of an inactive approval step',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='appr_off'))::text), 'true');
select pg_temp.expect('helpdesk not on a named approver',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='appr'))::text), 'false');
select pg_temp.expect('helpdesk not on a separation person signer',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='signer'))::text), 'false');
select pg_temp.expect('helpdesk not on security or finance holders',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='sec'))::text
       || private.can_act_on((select id from fx where k='help'), (select id from fx where k='fin'))::text), 'falsefalse');
select pg_temp.expect('nosign acts on a plain employee',
  (select private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='emp2'))::text), 'true');
select pg_temp.expect('nosign not on hr, security, finance, approver, signer (identity clauses alone)',
  (select private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='hr'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='sec'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='fin'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='appr'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='signer'))::text),
  'falsefalsefalsefalsefalse');
select pg_temp.expect('hr acts on a named approver and a signer (parity)',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='appr'))::text
       || private.can_act_on((select id from fx where k='hr'), (select id from fx where k='signer'))::text), 'truetrue');
select pg_temp.expect('helpdesk may not reset a named approver''s password',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('appr'), 'Temp!2026x')), '42501');
select pg_temp.expect('an inactive caller acts on nobody',
  (select private.can_act_on((select id from fx where k='hr_off'), (select id from fx where k='emp2'))::text), 'false');
-- role_within (D5)
select pg_temp.expect('role_within: hr gives Manager, not Helpdesk, never Admin',
  (select private.role_within((select id from public.roles where company_id = (select id from fx where k='company') and system_key='manager'), (select id from fx where k='hr'))::text
       || private.role_within((select id from fx where k='r_help'), (select id from fx where k='hr'))::text
       || private.role_within((select id from public.roles where company_id = (select id from fx where k='company') and system_key='admin'), (select id from fx where k='super'))::text), 'truefalsefalse');
select pg_temp.expect('role_within: Everything gives Helpdesk and HR',
  (select private.role_within((select id from fx where k='r_help'), (select id from fx where k='super'))::text
       || private.role_within((select id from public.roles where company_id = (select id from fx where k='company') and system_key='hr'), (select id from fx where k='super'))::text), 'truetrue');
select pg_temp.expect('role_within: the admin (every permission) gives a custom role of its company',
  (select private.role_within((select id from fx where k='r_help'), (select id from fx where k='admin'))::text), 'true');
select pg_temp.expect('role_within: false for a random id, NULL, and the other company''s roles',
  (select private.role_within(gen_random_uuid(), (select id from fx where k='admin'))::text
       || private.role_within(null, (select id from fx where k='admin'))::text
       || private.role_within((select id from fx where k='r_other_clerk'), (select id from fx where k='admin'))::text
       || private.role_within((select id from public.roles where company_id = (select id from fx where k='other_company') and system_key='employee'), (select id from fx where k='admin'))::text
       || private.role_within((select id from public.roles where company_id = (select id from fx where k='other_company') and system_key='manager'), (select id from fx where k='admin'))::text),
  'falsefalsefalsefalsefalse');

-- gates: passwords
select pg_temp.expect('helpdesk resets an employee password',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('emp2'), 'Temp!2026x')), 'ok:1');
select pg_temp.expect('… and the employee must change it',
  (select must_change_password::text from public.profiles where id = (select id from fx where k='emp2')), 'true');
select pg_temp.expect('helpdesk may not reset a manager',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('mgr'), 'Temp!2026x')), '42501');
select pg_temp.expect('helpdesk may not reset a department manager',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('deptmgr'), 'Temp!2026x')), '42501');
select pg_temp.expect('helpdesk may not reset hr',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('hr'), 'Temp!2026x')), '42501');
select pg_temp.expect('helpdesk may not reset the admin',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('admin'), 'Temp!2026x')), '42501');
select pg_temp.expect('helpdesk may not reset itself',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('help'), 'Temp!2026x')), '42501');
select pg_temp.expect('hr may not reset passwords (parity)',
  pg_temp.try_as('hr', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('emp2'), 'Temp!2026x')), '42501');
select pg_temp.expect('helpdesk bulk-resets an employee',
  pg_temp.try_as('help', format('select public.app_bulk_set_employee_passwords(%L)',
    json_build_array(json_build_object('user_id', (select id from fx where k='emp2'), 'password', 'Temp!2026y'))::text)), 'ok:1');
select pg_temp.expect('helpdesk bulk reset including a manager is refused whole',
  pg_temp.try_as('help', format('select public.app_bulk_set_employee_passwords(%L)',
    json_build_array(json_build_object('user_id', (select id from fx where k='emp2'), 'password', 'Temp!2026y'),
                     json_build_object('user_id', (select id from fx where k='mgr'), 'password', 'Temp!2026y'))::text)), '42501');
select pg_temp.expect('hr may not bulk-reset (parity)',
  pg_temp.try_as('hr', format('select public.app_bulk_set_employee_passwords(%L)',
    json_build_array(json_build_object('user_id', (select id from fx where k='emp2'), 'password', 'Temp!2026y'))::text)), '42501');
select pg_temp.expect('admin still bulk-resets',
  pg_temp.try_as('admin', format('select public.app_bulk_set_employee_passwords(%L)',
    json_build_array(json_build_object('user_id', (select id from fx where k='mgr'), 'password', 'Temp!2026y'))::text)), 'ok:1');

-- gates: profiles
select pg_temp.expect('helpdesk may not edit a profile (people read only)',
  pg_temp.try_as('help', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('emp2'))), 'ok:0');
select pg_temp.expect('Everything edits a profile',
  pg_temp.try_as('super', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('emp2'))), 'ok:1');
select pg_temp.expect('hr may not edit the helpdesk (subset)',
  pg_temp.try_as('hr', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('help'))), '42501');
select pg_temp.expect('a password holder may not edit other fields',
  pg_temp.try_as('help', format('update public.profiles set must_change_password = false where id = %s', pg_temp.id('emp2'))), 'ok:0');
select pg_temp.expect('security reads profiles company-wide (parity)',
  pg_temp.try_as('sec', 'select 1 from public.profiles where full_name like ''FR55 %'''),
  (select 'ok:' || count(*) from public.profiles where full_name like 'FR55 %'));
select pg_temp.expect('finance does not read profiles company-wide (parity)',
  pg_temp.try_as('fin', format('select 1 from public.profiles where department_id is distinct from %s', pg_temp.id('dept'))), 'ok:0');
select pg_temp.expect('helpdesk (people read) reads profiles company-wide',
  pg_temp.try_as('help', format('select 1 from public.profiles where department_id is distinct from %s and company_id = %s', pg_temp.id('dept'), pg_temp.id('company'))),
  (select 'ok:' || count(*) from public.profiles where department_id is distinct from (select id from fx where k='dept') and company_id = (select id from fx where k='company')));
select pg_temp.expect('helpdesk reads someone''s roles; finance does not',
  pg_temp.try_as('help', format('select 1 from public.user_roles where user_id = %s', pg_temp.id('hr')))
    || pg_temp.try_as('fin', format('select 1 from public.user_roles where user_id = %s', pg_temp.id('hr'))), 'ok:2ok:0');

-- gates: balances, calendar, requests (broad reads)
select pg_temp.expect('security reads every ledger row; helpdesk none',
  pg_temp.try_as('sec', 'select 1 from public.leave_ledger') || ' ' || pg_temp.try_as('help', 'select 1 from public.leave_ledger'),
  (select 'ok:' || count(*) from public.leave_ledger) || ' ok:0');
select pg_temp.expect('security reads every allocation; helpdesk none',
  pg_temp.try_as('sec', 'select 1 from public.leave_allocations') || ' ' || pg_temp.try_as('help', 'select 1 from public.leave_allocations'),
  (select 'ok:' || count(*) from public.leave_allocations) || ' ok:0');
select pg_temp.expect('security reads every leave policy; helpdesk none',
  pg_temp.try_as('sec', 'select 1 from public.employee_leave_policies') || ' ' || pg_temp.try_as('help', 'select 1 from public.employee_leave_policies'),
  (select 'ok:' || count(*) from public.employee_leave_policies) || ' ok:0');
select pg_temp.expect('security sees the whole calendar; finance only its team',
  pg_temp.try_as('sec', 'select 1 from public.team_leave_calendar') || ' '
    || pg_temp.try_as('fin', format('select 1 from public.team_leave_calendar where department_id is distinct from %s', pg_temp.id('dept'))),
  (select 'ok:' || count(*) from public.leave_requests lr join public.profiles p on p.id = lr.employee_id
    where lr.status in ('pending', 'approved')) || ' ok:0');
select pg_temp.expect('hr reads leave_requests base rows (parity)',
  pg_temp.try_as('hr', 'select 1 from public.leave_requests limit 1'), (select case when exists (select 1 from public.leave_requests) then 'ok:1' else 'ok:0' end));
select pg_temp.expect('security reads every request and approval; helpdesk none',
  pg_temp.try_as('sec', 'select 1 from public.leave_requests') || ' ' || pg_temp.try_as('sec', 'select 1 from public.leave_request_approvals') || ' '
    || pg_temp.try_as('help', 'select 1 from public.leave_requests') || ' ' || pg_temp.try_as('help', 'select 1 from public.leave_request_approvals'),
  (select 'ok:' || count(*) from public.leave_requests) || ' ' || (select 'ok:' || count(*) from public.leave_request_approvals) || ' ok:0 ok:0');

-- gates: departments (D7)
select pg_temp.expect('D7: hr may not appoint themselves department manager',
  pg_temp.try_as('hr', format('update public.departments set manager_id = %s where id <> %s and company_id = %s',
    pg_temp.id('hr'), pg_temp.id('dept'), pg_temp.id('company'))), '42501');
select pg_temp.expect('D7: nor create a department they manage',
  pg_temp.try_as('hr', format('insert into public.departments (company_id, name_fa, name_en, kind, code, manager_id) values (%s, %L, %L, %L, %L, %s)',
    pg_temp.id('company'), 'آزمون', 'FR55 Test', (select kind::text from public.departments limit 1), 'ZZ5', pg_temp.id('hr'))), '42501');
select pg_temp.expect('hr creates a department managed by someone else',
  pg_temp.try_as('hr', format('insert into public.departments (company_id, name_fa, name_en, kind, code, manager_id) values (%s, %L, %L, %L, %L, %s)',
    pg_temp.id('company'), 'آزمون', 'FR55 Test', (select kind::text from public.departments limit 1), 'ZZ5', pg_temp.id('mgr'))), 'ok:1');
select pg_temp.expect('helpdesk may not create a department',
  pg_temp.try_as('help', format('insert into public.departments (company_id, name_fa, name_en, kind, code) values (%s, %L, %L, %L, %L)',
    pg_temp.id('company'), 'آزمون', 'FR55 Test 2', (select kind::text from public.departments limit 1), 'ZZ4')), '42501');
select pg_temp.expect('admin may appoint themselves',
  pg_temp.try_as('admin', format('update public.departments set manager_id = %s where code = %L', pg_temp.id('admin'), 'ZZ5')), 'ok:1');

-- gates: balances and accrual
select pg_temp.expect('hr sets an employee''s balance (parity)',
  pg_temp.try_as('hr', format('select public.set_leave_balance(%s, %s, 480)', pg_temp.id('emp2'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')))), 'ok:1');
select pg_temp.expect('hr may not set the helpdesk''s balance (subset)',
  pg_temp.try_as('hr', format('select public.set_leave_balance(%s, %s, 480)', pg_temp.id('help'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')))), '42501');
select pg_temp.expect('hr may not set their own balance',
  pg_temp.try_as('hr', format('select public.set_leave_balance(%s, %s, 480)', pg_temp.id('hr'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')))), '42501');
select pg_temp.expect('security (balances read only) may not set a balance',
  pg_temp.try_as('sec', format('select public.set_leave_balance(%s, %s, 480)', pg_temp.id('emp2'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')))), '42501');
select pg_temp.expect('hr allocates leave; helpdesk may not',
  pg_temp.try_as('hr', format('select public.allocate_leave(%s, %s, %L, %L, 480)', pg_temp.id('emp2'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')),
    current_date, current_date + 30)) || ' '
  || pg_temp.try_as('help', format('select public.allocate_leave(%s, %s, %L, %L, 480)', pg_temp.id('emp2'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')),
    current_date, current_date + 30)), 'ok:1 42501');
select pg_temp.expect('hr may not allocate to the helpdesk (subset)',
  pg_temp.try_as('hr', format('select public.allocate_leave(%s, %s, %L, %L, 480)', pg_temp.id('help'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')),
    current_date, current_date + 30)), '42501');
select pg_temp.expect('hr sets a leave policy; not on the helpdesk',
  pg_temp.try_as('hr', format('select public.set_employee_leave_policy(%s, %s, 120, null, 0, %L)', pg_temp.id('emp2'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')),
    (select max(gregorian_start) from public.jalali_months where gregorian_start <= current_date))) || ' '
  || pg_temp.try_as('hr', format('select public.set_employee_leave_policy(%s, %s, 120, null, 0, %L)', pg_temp.id('help'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')),
    (select max(gregorian_start) from public.jalali_months where gregorian_start <= current_date))), 'ok:1 42501');
select pg_temp.expect('Everything sets a policy on the helpdesk',
  pg_temp.try_as('super', format('select public.set_employee_leave_policy(%s, %s, 120, null, 0, %L)', pg_temp.id('help'),
    quote_literal((select id from public.leave_types where company_id = (select id from fx where k='company') and name_en = 'Annual Leave')),
    (select max(gregorian_start) from public.jalali_months where gregorian_start <= current_date))), 'ok:1');
select pg_temp.expect('accrue one employee: security (balances read) yes, helpdesk no',
  pg_temp.try_as('sec', format('select public.accrue_employee_leave(%s)', pg_temp.id('emp2'))) || ' '
  || pg_temp.try_as('help', format('select public.accrue_employee_leave(%s)', pg_temp.id('emp2'))), 'ok:1 42501');
select pg_temp.expect('accrue everyone: security and helpdesk may not',
  pg_temp.try_as('sec', 'select public.accrue_all_leave()') || ' ' || pg_temp.try_as('help', 'select public.accrue_all_leave()'), '42501 42501');

-- gates: approval steps, work settings, holidays
select pg_temp.expect('Everything adds an approval step; security may not',
  pg_temp.try_as('super', format('insert into public.approval_steps (company_id, role, approver_id, step_order) values (%s, %L, %s, 99)',
    pg_temp.id('company'), 'employee', pg_temp.id('emp'))) || ' '
  || pg_temp.try_as('sec', format('insert into public.approval_steps (company_id, role, approver_id, step_order) values (%s, %L, %s, 98)',
    pg_temp.id('company'), 'employee', pg_temp.id('emp2'))), 'ok:1 42501');
select pg_temp.expect('hr edits approval steps (parity); helpdesk does not',
  pg_temp.try_as('hr', format('update public.approval_steps set step_order = 97 where approver_id = %s', pg_temp.id('emp'))) || ' '
  || pg_temp.try_as('help', format('update public.approval_steps set step_order = 96 where approver_id = %s', pg_temp.id('emp'))) || ' '
  || pg_temp.try_as('help', format('delete from public.approval_steps where approver_id = %s', pg_temp.id('emp'))) || ' '
  || pg_temp.try_as('hr', format('delete from public.approval_steps where approver_id = %s', pg_temp.id('emp'))), 'ok:1 ok:0 ok:0 ok:1');
select pg_temp.expect('approver search: hr yes, helpdesk no',
  pg_temp.try_as('hr', 'select public.search_approver_candidates(''FR55'')') || ' '
  || pg_temp.try_as('help', 'select public.search_approver_candidates(''FR55'')'),
  (select 'ok:' || least(20, count(*)) from public.profiles
    where company_id = (select id from fx where k='company') and active and full_name ilike '%FR55%') || ' 42501');
select pg_temp.expect('work settings: Everything edits, hr does not (parity)',
  pg_temp.try_as('super', format('update public.work_settings set hours_per_day = hours_per_day where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('hr', format('update public.work_settings set hours_per_day = hours_per_day where company_id = %s', pg_temp.id('company'))),
  (select 'ok:' || count(*) from public.work_settings where company_id = (select id from fx where k='company')) || ' ok:0');
select pg_temp.expect('holidays: Everything adds, hr may not (parity)',
  pg_temp.try_as('super', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2099-03-21', 'آزمون')) || ' '
  || pg_temp.try_as('hr', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2099-03-22', 'آزمون')) || ' '
  || pg_temp.try_as('hr', format('delete from public.holidays where company_id = %s and holiday_date = %L', pg_temp.id('company'), '2099-03-21')) || ' '
  || pg_temp.try_as('super', format('delete from public.holidays where company_id = %s and holiday_date = %L', pg_temp.id('company'), '2099-03-21')), 'ok:1 42501 ok:0 ok:1');

-- gates: personal info
select pg_temp.expect('personal info read: Everything yes, helpdesk no',
  pg_temp.try_as('super', format('select 1 from public.employee_personal_info where employee_id = %s', pg_temp.id('emp2'))) || ' '
  || pg_temp.try_as('help', format('select 1 from public.employee_personal_info where employee_id = %s', pg_temp.id('emp2'))), 'ok:1 ok:0');
select pg_temp.expect('personal info edit: hr on an employee yes, on the helpdesk no (subset)',
  pg_temp.try_as('hr', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55', pg_temp.id('emp2'))) || ' '
  || pg_temp.try_as('hr', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55', pg_temp.id('help'))), 'ok:1 ok:0');
select pg_temp.expect('personal info import: hr on an employee yes, on the helpdesk no (subset)',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L)', json_build_array(json_build_object('personnel_no', '9990000955', 'father_name', 'FR55'))::text)) || ' '
  || pg_temp.try_as('hr', format('select public.app_import_personal_info(%L)', json_build_array(json_build_object('personnel_no', '9990000956', 'father_name', 'FR55'))::text)), 'ok:1 42501');
select pg_temp.expect('personal info export: Everything yes, helpdesk no',
  pg_temp.try_as('super', 'select count(*) from public.app_export_personal_info()') || ' '
  || pg_temp.try_as('help', 'select count(*) from public.app_export_personal_info()'), 'ok:1 42501');

-- gates: clearance
select pg_temp.expect('clearance: hr may not file for the helpdesk (subset)',
  pg_temp.try_as('hr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('help'), 'resignation', current_date + 30, '[]')), '42501');
select pg_temp.expect('clearance: finance (read only) may not file',
  pg_temp.try_as('fin', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('emp2'), 'resignation', current_date + 30, '[]')), '42501');
select pg_temp.expect('clearance warnings and default rows: finance may not',
  pg_temp.try_as('fin', format('select public.app_separation_warnings(%s)', pg_temp.id('emp2'))) || ' '
  || pg_temp.try_as('fin', 'select public.app_save_separation_units(''[]'')'), '42501 42501');
select pg_temp.expect('clearance warnings: Everything may',
  pg_temp.try_as('super', format('select public.app_separation_warnings(%s)', pg_temp.id('emp2'))), 'ok:1');

-- gates: bulk onboarding
select pg_temp.expect('bulk add: Everything (people_create) adds an employee; helpdesk may not',
  pg_temp.try_as('super', format('select public.app_bulk_create_employees(%s, %L, %L, %L)', pg_temp.id('company'),
    json_build_array(json_build_object('personnel_no', '9990000963', 'full_name', 'FR55 bulk', 'password', 'Temp!2026x',
      'department_code', (select code from public.departments where id = (select id from fx where k='dept')), 'role', 'manager'))::text,
    '[]', current_date)) || ' '
  || pg_temp.try_as('help', format('select public.app_bulk_create_employees(%s, %L, %L, %L)', pg_temp.id('company'),
    json_build_array(json_build_object('personnel_no', '9990000964', 'full_name', 'FR55 bulk 2', 'password', 'Temp!2026x',
      'department_code', (select code from public.departments where id = (select id from fx where k='dept'))))::text,
    '[]', current_date)), 'ok:1 42501');
select pg_temp.expect('… the non-admin clamp still makes them a plain employee',
  (select string_agg(ur.role::text, ',' order by ur.role) from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where p.personnel_no = '9990000963'), 'employee');
select pg_temp.expect('bulk import add mode: Everything adds; hr still does (parity)',
  pg_temp.try_as('super', format($q$select public.app_bulk_import_employees(%s, 'add', %L, '[]'::jsonb, %L, false, '{}'::uuid[], '[]'::jsonb, '{}'::text[])$q$,
    pg_temp.id('company'), json_build_array(json_build_object('personnel_no', '9990000965', 'full_name', 'FR55 bulk 3', 'password', 'Temp!2026x',
      'department_code', (select code from public.departments where id = (select id from fx where k='dept'))))::text, current_date)) || ' '
  || pg_temp.try_as('hr', format($q$select public.app_bulk_import_employees(%s, 'add', %L, '[]'::jsonb, %L, false, '{}'::uuid[], '[]'::jsonb, '{}'::text[])$q$,
    pg_temp.id('company'), json_build_array(json_build_object('personnel_no', '9990000966', 'full_name', 'FR55 bulk 4', 'password', 'Temp!2026x',
      'department_code', (select code from public.departments where id = (select id from fx where k='dept'))))::text, current_date)), 'ok:1 ok:1');
select pg_temp.expect('D2: Everything may not bulk-import in update mode',
  pg_temp.try_as('super', format($q$select public.app_bulk_import_employees(%s, 'update', '[]'::jsonb, '[]'::jsonb, null, false, '{}'::uuid[], '[]'::jsonb, '{}'::text[])$q$,
    pg_temp.id('company'))), '42501');

-- gates: cancelling someone else's request
do $$
begin
  insert into public.leave_requests (employee_id, company_id, kind, errand_location, start_date, end_date,
                                     requested_minutes, status, serial_year, serial_seq)
  values ((select id from fx where k = 'emp2'), (select id from fx where k = 'company'), 'errand', 'FR55',
          current_date + 5, current_date + 5, 480, 'pending', 1, 955001),
         ((select id from fx where k = 'admin'), (select id from fx where k = 'company'), 'errand', 'FR55',
          current_date + 5, current_date + 5, 480, 'pending', 1, 955002);
end $$;
select pg_temp.expect('cancel: hr (requests read only) may not',
  pg_temp.try_as('hr', format('select public.cancel_leave_request(%s)',
    quote_literal((select id from public.leave_requests where serial_year = 1 and serial_seq = 955001)))), '42501');
select pg_temp.expect('cancel: Everything (requests edit) may not cancel the admin''s',
  pg_temp.try_as('super', format('select public.cancel_leave_request(%s)',
    quote_literal((select id from public.leave_requests where serial_year = 1 and serial_seq = 955002)))), '42501');
select pg_temp.expect('cancel: Everything cancels an employee''s request',
  pg_temp.try_as('super', format('select public.cancel_leave_request(%s)',
    quote_literal((select id from public.leave_requests where serial_year = 1 and serial_seq = 955001)))), 'ok:1');

-- D2 and the admin-only operations
select pg_temp.expect('D2: Everything holds every catalog item yet is not admin (approval override keys on is_admin)',
  (select (private.has_perm((select id from fx where k='super'),'approval_steps','edit')
           and not private.is_admin((select id from fx where k='super')))::text), 'true');
select pg_temp.expect('D2: Everything may not read the audit log',
  pg_temp.try_as('super', 'select 1 from public.audit_log limit 1'), 'ok:0');
-- preset edits take effect immediately (Review Focus 4)
delete from public.role_permissions
 where role_id = (select id from public.roles where company_id = (select id from fx where k='company') and system_key='hr')
   and permission = 'people';
select pg_temp.expect('hr without people is refused at once',
  pg_temp.try_as('hr', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('emp2'))), 'ok:0');
insert into public.role_permissions
  select id, 'people', 'edit' from public.roles where company_id = (select id from fx where k='company') and system_key='hr';
-- app_my_permissions / hook
select pg_temp.expect('app_my_permissions for helpdesk',
  pg_temp.try_as('help', $q$do $d$ begin if public.app_my_permissions() <> '{"people":"read","passwords":"edit"}'::jsonb then raise exception 'x' using errcode='P0001'; end if; end $d$$q$), 'ok:0');
select pg_temp.expect('app_my_permissions: an employee has none',
  pg_temp.try_as('emp', $q$do $d$ begin if public.app_my_permissions() <> '{}'::jsonb then raise exception 'x' using errcode='P0001'; end if; end $d$$q$), 'ok:0');
select pg_temp.expect('token hook emits app_perms',
  (select (public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='help'),'claims','{}'::jsonb))
            -> 'claims' -> 'app_perms')::text), '{"people": "read", "passwords": "edit"}');
select pg_temp.expect('token hook: the admin gets every key',
  (select (select count(*) from jsonb_object_keys(public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='admin'),'claims','{}'::jsonb))
            -> 'claims' -> 'app_perms'))::text), '16');
select pg_temp.expect('token hook: custom roles stay out of app_roles',
  (select (public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='help'),'claims','{}'::jsonb))
            -> 'claims' ->> 'app_roles')), '["employee"]');
select pg_temp.expect('token hook: inactive user gets nothing',
  (select (public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='hr_off'),'claims','{}'::jsonb))
            -> 'claims' ->> 'app_roles')
       || (public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='hr_off'),'claims','{}'::jsonb))
            -> 'claims' ->> 'app_perms')), '[]{}');
select pg_temp.expect('token hook runs as supabase_auth_admin',
  pg_temp.try_su(format($q$do $d$ begin set local role supabase_auth_admin; perform public.custom_access_token_hook(jsonb_build_object('user_id', %s::uuid, 'claims', '{}'::jsonb)); reset role; end $d$$q$, pg_temp.id('hr'))), 'ok:0');

-- D7 positive, last because it makes emp a department manager
select pg_temp.expect('hr appoints someone else as a department manager',
  pg_temp.try_as('hr', format('update public.departments set manager_id = %s where code = %L', pg_temp.id('emp'), 'ZZ5')), 'ok:1');

rollback;
