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

-- Like try_as, but returns the first column of the first row as text, or
-- '<sqlstate>: <message>' on error, so a scenario can assert a value or a message.
create function pg_temp.val_as(p_actor text, p_sql text) returns text
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
    v_res := sqlstate || ': ' || sqlerrm;
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
select pg_temp.expect('hr preset has 17 permissions',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key = 'hr'), '17');
select pg_temp.expect('security preset has 5, finance 2',
  (select string_agg(n::text, ',' order by k) from (
     select r.system_key::text k, count(*) n from public.role_permissions rp join public.roles r on r.id = rp.role_id
      where r.company_id = (select id from fx where k = 'company') and r.system_key in ('security','finance') group by 1) s), '2,5');
-- R2 (2026-10-12 owner presets): HR += work_settings, holidays edit; Security +=
-- absences read; Finance += finance read; personal_info_own on no preset.
-- R5 (2026-10-13): HR += special_leave edit (main's FR-65) and, by owner ruling
-- (a), absences read + finance read, so HR covers the Security and Finance presets.
select pg_temp.expect('hr preset contents',
  (select string_agg(rp.permission || '=' || rp.level, ',' order by rp.permission)
     from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key = 'hr'),
  'absences=read,approval_steps=edit,calendar=read,clearance=edit,departments=edit,finance=read,holidays=edit,'
  || 'leave_accrual=edit,leave_balances=edit,leave_requests=read,people=edit,people_create=edit,personal_info=edit,'
  || 'reports=read,role_manager=edit,special_leave=edit,work_settings=edit');
select pg_temp.expect('security preset contents',
  (select string_agg(rp.permission || '=' || rp.level, ',' order by rp.permission)
     from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key = 'security'),
  'absences=read,calendar=read,leave_balances=read,leave_requests=read,people=read');
select pg_temp.expect('finance preset contents',
  (select string_agg(rp.permission || '=' || rp.level, ',' order by rp.permission)
     from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key = 'finance'),
  'clearance=read,finance=read');
select pg_temp.expect('personal_info_own is on no preset of any company',
  (select count(*)::text from public.role_permissions where permission = 'personal_info_own'), '0');
select pg_temp.expect('catalog: 20 keys incl. absences, finance, personal_info_own, special_leave',
  (select count(*)::text || ':' || count(*) filter (where k in ('absences','finance','personal_info_own','special_leave'))::text
     from private.permission_keys() k),
  '20:4');
select pg_temp.expect('catalog shape: special_leave is edit-only (an action)',
  (select coalesce(private.permission_allows('special_leave','edit'), false)::text
       || coalesce(private.permission_allows('special_leave','read'), false)::text), 'truefalse');
select pg_temp.expect('catalog deps: special_leave needs people and leave_balances read',
  (select string_agg(key_level || ':' || needs, ',' order by needs) from private.permission_deps() where key = 'special_leave'),
  'read:leave_balances,read:people');
select pg_temp.expect('hr preset covers the security and finance presets (owner ruling a)',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key in ('security', 'finance')
      and (case rp.level when 'edit' then 2 else 1 end)
          > coalesce((select max(case h.level when 'edit' then 2 else 1 end) from public.role_permissions h
                       join public.roles hr on hr.id = h.role_id
                      where hr.company_id = r.company_id and hr.system_key = 'hr' and h.permission = rp.permission), 0)),
  '0');
select pg_temp.expect('catalog shapes: absences R, finance R, personal_info_own E',
  (select private.permission_allows('absences','read')::text || private.permission_allows('absences','edit')::text
       || private.permission_allows('finance','read')::text || private.permission_allows('finance','edit')::text
       || private.permission_allows('personal_info_own','edit')::text || private.permission_allows('personal_info_own','read')::text),
  'truefalsetruefalsetruefalse');
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

-- ── Task 1 follow-ups (guards added in 20261013200002) ──────────────────────
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
      ('leaver',   'company',       '9990000975'),
      ('rowsigner','company',       '9990000976'),
      ('oldsigner','company',       '9990000977'),
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
  -- An open form naming rowsigner on a row, and a cancelled one naming oldsigner.
  insert into public.separations (company_id, employee_id, reason, last_working_day, status)
  values ((select id from fx where k='company'), (select id from fx where k='leaver'), 'resignation', current_date + 30, 'in_progress');
  insert into public.separation_signoffs (separation_id, name_fa, name_en, signer_id, sort_order)
  values ((select id from public.separations where employee_id = (select id from fx where k='leaver') and status = 'in_progress'),
          'آزمون', 'FR55 row', (select id from fx where k='rowsigner'), 1);
  insert into public.separations (company_id, employee_id, reason, last_working_day, status, cancelled_at)
  values ((select id from fx where k='company'), (select id from fx where k='leaver'), 'resignation', current_date + 30, 'cancelled', now());
  insert into public.separation_signoffs (separation_id, name_fa, name_en, signer_id, sort_order)
  values ((select id from public.separations where employee_id = (select id from fx where k='leaver') and status = 'cancelled'),
          'آزمون', 'FR55 row', (select id from fx where k='oldsigner'), 1);
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
-- R2: main's four keys answer from the catalog too.
select pg_temp.expect('legacy settings.edit: hr yes (work_settings + holidays edit), security no, admin yes',
  (select private.has_permission((select id from fx where k='hr'),'settings.edit')::text
       || private.has_permission((select id from fx where k='sec'),'settings.edit')::text
       || private.has_permission((select id from fx where k='admin'),'settings.edit')::text), 'truefalsetrue');
select pg_temp.expect('legacy absences.view: security yes, hr yes (owner ruling a), admin yes',
  (select private.has_permission((select id from fx where k='sec'),'absences.view')::text
       || private.has_permission((select id from fx where k='hr'),'absences.view')::text
       || private.has_permission((select id from fx where k='admin'),'absences.view')::text), 'truetruetrue');
select pg_temp.expect('legacy finance.view: finance yes, hr yes (owner ruling a), admin yes',
  (select private.has_permission((select id from fx where k='fin'),'finance.view')::text
       || private.has_permission((select id from fx where k='hr'),'finance.view')::text
       || private.has_permission((select id from fx where k='admin'),'finance.view')::text), 'truetruetrue');
-- R5: main's FR-65 key answers from the special_leave item.
select pg_temp.expect('legacy special_leave.grant: hr and admin yes; security, finance, employee, inactive hr no',
  (select private.has_permission((select id from fx where k='hr'),'special_leave.grant')::text
       || private.has_permission((select id from fx where k='admin'),'special_leave.grant')::text
       || private.has_permission((select id from fx where k='sec'),'special_leave.grant')::text
       || private.has_permission((select id from fx where k='fin'),'special_leave.grant')::text
       || private.has_permission((select id from fx where k='emp'),'special_leave.grant')::text
       || private.has_permission((select id from fx where k='hr_off'),'special_leave.grant')::text),
  'truetruefalsefalsefalsefalse');
-- R5: every key main's latest has_permission (20261013130001) answers is still
-- handled; the admin holds every item, so a key that fell to `else false` shows.
select pg_temp.expect('legacy keys: every key of main''s has_permission CASE list is handled',
  (select coalesce(string_agg(k, ',' order by k), 'all handled')
     from unnest(array['employees.edit','departments.edit','accruals.run','roles.manager',
                       'personal_info.view','personal_info.edit','personal_info.edit_own',
                       'special_leave.grant','separations.manage','separations.view',
                       'settings.edit','absences.view','finance.view']) k
    where not private.has_permission((select id from fx where k='admin'), k)),
  'all handled');
select pg_temp.expect('legacy personal_info.edit_own: admin yes, hr no, employee no',
  (select private.has_permission((select id from fx where k='admin'),'personal_info.edit_own')::text
       || private.has_permission((select id from fx where k='hr'),'personal_info.edit_own')::text
       || private.has_permission((select id from fx where k='emp'),'personal_info.edit_own')::text), 'truefalsefalse');
select pg_temp.expect('legacy keys: an inactive holder and an unknown key answer false',
  (select private.has_permission((select id from fx where k='hr_off'),'settings.edit')::text
       || private.has_permission((select id from fx where k='admin'),'no.such.key')::text), 'falsefalse');
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
-- R5, owner ruling (a): the HR preset holds absences and finance read, so hr acts
-- on Security and Finance holders again (main: hr edits any non-admin).
select pg_temp.expect('hr acts on security and finance holders (owner ruling a)',
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
select pg_temp.expect('open-form row signer: helpdesk refused, hr allowed',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='rowsigner'))::text
       || private.can_act_on((select id from fx where k='hr'), (select id from fx where k='rowsigner'))::text), 'falsetrue');
select pg_temp.expect('a signer on a cancelled form only: helpdesk allowed',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='oldsigner'))::text), 'true');
select pg_temp.expect('helpdesk not on security or finance holders',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='sec'))::text
       || private.can_act_on((select id from fx where k='help'), (select id from fx where k='fin'))::text), 'falsefalse');
select pg_temp.expect('nosign acts on a plain employee',
  (select private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='emp2'))::text), 'true');
select pg_temp.expect('nosign not on hr, finance, approver, signer (identity clauses alone)',
  (select private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='hr'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='fin'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='appr'))::text
       || private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='signer'))::text),
  'falsefalsefalsefalse');
-- R2: security is no longer an approval-step role (main's CHECK), so holding it is
-- no identity power; nosign covers every Security permission.
select pg_temp.expect('nosign acts on a security holder (security dropped from the identity clause)',
  (select private.can_act_on((select id from fx where k='nosign'), (select id from fx where k='sec'))::text), 'true');
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
-- R2: HR edits work settings and holidays (owner, 2026-10-12), through main's
-- *_editor policies now keyed on the catalog items.
select pg_temp.expect('work settings: Everything and hr edit; helpdesk does not',
  pg_temp.try_as('super', format('update public.work_settings set hours_per_day = hours_per_day where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('hr', format('update public.work_settings set weekend_days = weekend_days where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('help', format('update public.work_settings set weekend_days = weekend_days where company_id = %s', pg_temp.id('company'))),
  (select 'ok:' || count(*) from public.work_settings where company_id = (select id from fx where k='company'))
  || ' ' || (select 'ok:' || count(*) from public.work_settings where company_id = (select id from fx where k='company')) || ' ok:0');
-- R5 (FR-66 in FR-55 terms): the approval-order switch follows approval_steps edit,
-- which hr holds; hours per day stays admin-only (main's trigger).
select pg_temp.expect('work settings: hr flips the approval order; hours per day stays admin-only (main''s trigger)',
  pg_temp.try_as('hr', format('update public.work_settings set approval_order_enforced = not approval_order_enforced where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('hr', format('update public.work_settings set approval_order_enforced = not approval_order_enforced where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('hr', format('update public.work_settings set hours_per_day = 7 where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('super', format('update public.work_settings set hours_per_day = 7 where company_id = %s', pg_temp.id('company'))),
  'ok:1 ok:1 42501 42501');
select pg_temp.expect('work settings: delete stays admin-only (work_settings_delete_admin)',
  pg_temp.try_as('hr', format('delete from public.work_settings where company_id = %s', pg_temp.id('company')))
  || ' ' || pg_temp.try_as('super', format('delete from public.work_settings where company_id = %s', pg_temp.id('company'))), 'ok:0 ok:0');
select pg_temp.expect('holidays: Everything and hr add and delete; helpdesk may not',
  pg_temp.try_as('super', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2099-03-21', 'آزمون')) || ' '
  || pg_temp.try_as('hr', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2099-03-22', 'آزمون')) || ' '
  || pg_temp.try_as('hr', format('delete from public.holidays where company_id = %s and holiday_date = %L', pg_temp.id('company'), '2099-03-21')) || ' '
  || pg_temp.try_as('super', format('delete from public.holidays where company_id = %s and holiday_date = %L', pg_temp.id('company'), '2099-03-22')) || ' '
  || pg_temp.try_as('help', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2099-03-23', 'آزمون')),
  'ok:1 ok:1 ok:1 ok:1 42501');
select pg_temp.expect('settings policies are main''s *_editor names keyed on the catalog items',
  (select string_agg(policyname || '=' || (case when coalesce(qual, '') || coalesce(with_check, '') ~ 'has_perm\(' then 'perm'
                                                when coalesce(qual, '') like '%is_admin%' then 'admin' else '?' end), ','
                     order by policyname)
     from pg_policies where schemaname = 'public' and tablename in ('holidays', 'work_settings') and cmd <> 'SELECT'),
  'holidays_delete_editor=perm,holidays_insert_editor=perm,holidays_update_editor=perm,'
  || 'work_settings_delete_admin=admin,work_settings_insert_editor=perm,work_settings_update_editor=perm');

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
            -> 'claims' -> 'app_perms'))::text), '20');
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

-- ── rpcs (Task 3) ───────────────────────────────────────────────────────────
-- Task 2 carry-overs fixed in 20261013200004.
select pg_temp.expect('has_perm: an unknown level is false, edit still true',
  (select coalesce(private.has_perm((select id from fx where k='admin'),'people','Edit')::text, 'null')
       || coalesce(private.has_perm((select id from fx where k='admin'),'people',null)::text, 'null')
       || private.has_perm((select id from fx where k='admin'),'people','edit')::text), 'falsefalsetrue');
select pg_temp.expect('the outsider has a personal-info row (profile trigger)',
  (select count(*)::text from public.employee_personal_info
    where employee_id = (select id from fx where k='outsider') and company_id = (select id from fx where k='other_company')), '1');
-- No WHERE and a constant SET: only the UPDATE policy filters the rows (the SELECT
-- policy, which already pins the company, is not consulted). Rolled back with the rest.
select pg_temp.expect('personal info: an unfiltered admin update touches only the admin''s company',
  pg_temp.try_as('admin', $q$update public.employee_personal_info set father_name = 'FR55X'$q$),
  (select 'ok:' || count(*) from public.employee_personal_info where company_id = (select id from fx where k='company')));
select pg_temp.expect('… the other company''s row is untouched',
  (select count(*)::text from public.employee_personal_info
    where father_name = 'FR55X' and company_id = (select id from fx where k='other_company')), '0');

-- role editor (D2, D6, D11)
select pg_temp.expect('admin creates a role',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Clerk', '{"people":"read","holidays":"edit"}')$q$), 'ok:1');
select pg_temp.expect('… a custom role with its permissions and a role.create audit row',
  (select r.kind || ':' || (select count(*) from public.role_permissions rp where rp.role_id = r.id)::text || ':'
          || (select count(*) from public.audit_log a where a.entity_id = r.id and a.action = 'role.create' and a.before is null)::text
     from public.roles r where r.company_id = (select id from fx where k='company') and r.name = 'Clerk'), 'custom:2:1');
select pg_temp.expect('Everything may not create a role (D2)',
  pg_temp.try_as('super', $q$select public.app_save_role(null, 'Clerk2', '{}')$q$), '42501');
select pg_temp.expect('dependency rule: reports without people refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"reports":"read"}')$q$), '22023');
select pg_temp.expect('dependency rule: clearance edit without people refused, clearance read alone allowed',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"clearance":"edit"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Box', '{"clearance":"read"}')$q$), '22023 ok:1');
select pg_temp.expect('unknown key refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"nope":"edit"}')$q$), '22023');
select pg_temp.expect('invalid level refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"calendar":"edit"}')$q$), '22023');
select pg_temp.expect('null, numeric and non-object permissions refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"people":null}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"people":1}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '["people"]')$q$), '22023 22023 22023');
select pg_temp.expect('non-latin name refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'منشی', '{}')$q$), '22023');
select pg_temp.expect('duplicate name (case-insensitive) refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'helpdesk', '{}')$q$), '22023');
select pg_temp.expect('a custom role may be renamed',
  pg_temp.try_as('admin', format($q$select public.app_save_role(%s, 'Clerk B', '{"people":"read"}')$q$,
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and name='Clerk')))), 'ok:1');
select pg_temp.expect('… an edit writes role.update with the before permissions',
  (select (a.before = '{"people":"read","holidays":"edit"}'::jsonb)::text || ':' || (a.after->>'name')
               from public.audit_log a
              where a.action = 'role.update'
                and a.entity_id = (select id from public.roles where company_id=(select id from fx where k='company') and name='Clerk B')),
  'true:Clerk B');
select pg_temp.expect('preset rename ignored, permissions saved',
  pg_temp.try_as('admin', format($q$select public.app_save_role(%s, 'Renamed', '{"people":"read","calendar":"read"}')$q$,
    pg_temp.role_id('company', 'security'))), 'ok:1');
select pg_temp.expect('security preset kept its name',
  (select name from public.roles where company_id=(select id from fx where k='company') and system_key='security'), 'Security');
select pg_temp.expect('… and holds exactly the new permissions',
  (select string_agg(permission || '=' || level, ',' order by permission) from public.role_permissions
    where role_id = (select id from public.roles where company_id=(select id from fx where k='company') and system_key='security')),
  'calendar=read,people=read');
-- Put the seeded Security preset back, so later scenarios (D5 on Security, owner
-- ruling a) see the real preset.
select pg_temp.expect('(setup) the Security preset is back to its seed',
  pg_temp.try_su(format($q$insert into public.role_permissions select %s::uuid, p, 'read'
    from unnest(array['absences','calendar','leave_balances','leave_requests','people']) p on conflict do nothing$q$,
    pg_temp.role_id('company', 'security'))), 'ok:3');
select pg_temp.expect('system role not editable',
  pg_temp.try_as('admin', format($q$select public.app_save_role(%s, 'Manager', '{}')$q$, pg_temp.role_id('company', 'manager'))), '22023');
select pg_temp.expect('another company''s role is not found',
  pg_temp.try_as('admin', format($q$select public.app_save_role(%s, 'Clerk', '{}')$q$, pg_temp.id('r_other_clerk'))), '22023');
select pg_temp.expect('list roles: any active member sees their company''s roles; inactive sees none',
  pg_temp.try_as('emp', 'select * from public.app_list_roles()') || ' ' || pg_temp.try_as('hr_off', 'select * from public.app_list_roles()'),
  (select 'ok:' || count(*) from public.roles where company_id = (select id from fx where k='company')) || ' ok:0');
select pg_temp.expect('list roles: Helpdesk counts its holder and lists its permissions',
  pg_temp.try_as('emp', format($q$do $d$ begin if not exists (select 1 from public.app_list_roles() where id = %s and kind = 'custom'
      and holders = 1 and permissions = '{"people":"read","passwords":"edit"}'::jsonb) then raise exception 'x' using errcode = 'P0001'; end if; end $d$$q$,
    pg_temp.id('r_help'))), 'ok:0');
select pg_temp.expect('role holders: admin yes, hr no',
  pg_temp.try_as('admin', format('select * from public.app_role_holders(%s)', pg_temp.id('r_help'))) || ' '
  || pg_temp.try_as('hr', format('select * from public.app_role_holders(%s)', pg_temp.id('r_help'))), 'ok:1 42501');

-- assignment (D1, D3, D4, D5)
select pg_temp.expect('hr gives manager',
  pg_temp.try_as('hr', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp2'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'manager'))), 'ok:1');
select pg_temp.expect('… emp2 holds Employee and Manager; set_roles audit names them',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = (select id from fx where k='emp2'))
  || ' ' || (select (a.after->'roles')::text from public.audit_log a
              where a.action = 'set_roles' and a.entity_id = (select id from fx where k='emp2') and a.actor_id = (select id from fx where k='hr')),
  'Employee,Manager ["Employee", "Manager"]');
select pg_temp.expect('hr may not give Helpdesk (outside hr)',
  pg_temp.try_as('hr', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'), pg_temp.id('r_help'))), '42501');
select pg_temp.expect('hr may not take Helpdesk away (D4: helpdesk is above hr)',
  pg_temp.try_as('hr', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('help'),
    pg_temp.role_id('company', 'employee'))), '42501');
select pg_temp.expect('Everything gives Helpdesk',
  pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('appr_off'),
    pg_temp.role_id('company', 'employee'), pg_temp.id('r_help'))), 'ok:1');
select pg_temp.expect('nobody sets their own roles but the admin (D3)',
  pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('super'),
    pg_temp.role_id('company', 'employee'), pg_temp.id('r_super'))), '42501');
select pg_temp.expect('a caller without role_assign or role_manager is refused, even for no change',
  pg_temp.try_as('help', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('oldsigner'),
    pg_temp.role_id('company', 'employee'))), '42501');
select pg_temp.expect('unknown, NULL and another company''s role ids refused',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s, %L]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'), gen_random_uuid())) || ' '
  || pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s, null]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'))) || ' '
  || pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'), pg_temp.id('r_other_clerk'))), '22023 22023 22023');
select pg_temp.expect('nobody acts on another company''s employee, not even the admin',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('outsider'),
    pg_temp.role_id('other_company', 'employee'))), '42501');
select pg_temp.expect('nobody gives admin through assignment, not even the admin',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'admin'))), '42501');
select pg_temp.expect('the admin may not drop their own admin row',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('admin'),
    pg_temp.role_id('company', 'employee'))), '42501');
select pg_temp.expect('the admin changes their own other roles (admin kept)',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, (select array_agg(role_id) from public.user_roles where user_id = %s) || %s::uuid)',
    pg_temp.id('admin'), pg_temp.id('admin'), pg_temp.id('r_help'))), 'ok:1');
select pg_temp.expect('the admin gives a custom role to anyone',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('oldsigner'),
    pg_temp.role_id('company', 'employee'),
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and name='Clerk B')))), 'ok:1');
select pg_temp.expect('old enum signature cannot add admin',
  pg_temp.try_as('admin', format($q$select public.app_set_user_roles(%s, array['employee','admin']::public.app_role[])$q$, pg_temp.id('emp'))), '42501');
-- Call and check in separate statements: a subquery in the calling statement
-- reads the snapshot taken before the call.
select pg_temp.expect('old enum signature keeps custom roles',
  pg_temp.try_as('admin', format($q$select public.app_set_user_roles(%s, array['employee']::public.app_role[])$q$, pg_temp.id('help'))), 'ok:1');
select pg_temp.expect('… help still holds Helpdesk',
  (select exists (select 1 from public.user_roles where user_id=(select id from fx where k='help') and role_id=(select id from fx where k='r_help'))::text), 'true');
select pg_temp.expect('old enum signature, hr: adds manager beside a custom role and keeps it',
  pg_temp.try_as('hr', format($q$select public.app_set_user_roles(%s, array['employee','manager']::public.app_role[])$q$, pg_temp.id('oldsigner'))), 'ok:1');
select pg_temp.expect('… oldsigner holds Clerk B, Employee, Manager',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
              where ur.user_id = (select id from fx where k='oldsigner')), 'Clerk B,Employee,Manager');
select pg_temp.expect('old enum signature, hr: refused on a Helpdesk holder (D4), roles untouched',
  pg_temp.try_as('hr', format($q$select public.app_set_user_roles(%s, array['employee','manager']::public.app_role[])$q$, pg_temp.id('appr_off'))), '42501');
select pg_temp.expect('… appr_off still holds Employee, Helpdesk',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
              where ur.user_id = (select id from fx where k='appr_off')), 'Employee,Helpdesk');
select pg_temp.expect('old enum signature, helpdesk (no role permissions) refused',
  pg_temp.try_as('help', format($q$select public.app_set_user_roles(%s, array['employee']::public.app_role[])$q$, pg_temp.id('emp'))), '42501');

-- create employee
select pg_temp.expect('helpdesk may not create employees',
  pg_temp.try_as('help', $q$select public.app_create_employee('9990000980','x','Temp!2026x',(select id from fx where k='company'))$q$), '42501');
select pg_temp.expect('create with admin role refused (role ids and enum list)',
  pg_temp.try_as('admin', format($q$select public.app_create_employee('9990000981','x','Temp!2026x',%s, %s, p_role_ids => array[%s]::uuid[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'), pg_temp.role_id('company', 'admin'))) || ' '
  || pg_temp.try_as('admin', format($q$select public.app_create_employee('9990000981','x','Temp!2026x',%s, %s, p_roles => array['employee','admin']::public.app_role[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'))) || ' '
  || pg_temp.try_as('hr', format($q$select public.app_create_employee('9990000981','x','Temp!2026x',%s, %s, p_roles => array['employee','admin']::public.app_role[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'))), '42501 42501 42501');
select pg_temp.expect('admin creates with a custom role',
  pg_temp.try_as('admin', format($q$select public.app_create_employee('9990000982','FR55 c1','Temp!2026x',%s, %s, p_role_ids => array[%s]::uuid[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'), pg_temp.id('r_help'))), 'ok:1');
select pg_temp.expect('… the new employee holds Employee and Helpdesk',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
              join public.profiles p on p.id = ur.user_id where p.personnel_no = '9990000982'), 'Employee,Helpdesk');
select pg_temp.expect('hr creates a manager through role ids (D5)',
  pg_temp.try_as('hr', format($q$select public.app_create_employee('9990000983','FR55 c2','Temp!2026x',%s, %s, p_role_ids => array[%s]::uuid[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'), pg_temp.role_id('company', 'manager'))), 'ok:1');
select pg_temp.expect('… the new employee holds Employee and Manager',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
              join public.profiles p on p.id = ur.user_id where p.personnel_no = '9990000983'), 'Employee,Manager');
select pg_temp.expect('hr may not create with Helpdesk (D5)',
  pg_temp.try_as('hr', format($q$select public.app_create_employee('9990000984','FR55 c3','Temp!2026x',%s, %s, p_role_ids => array[%s]::uuid[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'), pg_temp.id('r_help'))), '42501');
select pg_temp.expect('… and no profile was created',
  (select count(*)::text from public.profiles where personnel_no = '9990000984'), '0');
select pg_temp.expect('hr without role ids still gets a plain employee (enum list clamped)',
  pg_temp.try_as('hr', format($q$select public.app_create_employee('9990000985','FR55 c4','Temp!2026x',%s, %s, p_roles => array['employee','manager']::public.app_role[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'))), 'ok:1');
select pg_temp.expect('… the new employee holds Employee only',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
              join public.profiles p on p.id = ur.user_id where p.personnel_no = '9990000985'), 'Employee');
select pg_temp.expect('a manager still creates into their team, with empty role ids',
  pg_temp.try_as('mgr', format($q$select public.app_create_employee('9990000986','FR55 c5','Temp!2026x',%s, p_role_ids => '{}'::uuid[])$q$,
    pg_temp.id('company'))), 'ok:1');

-- delete (D12)
select pg_temp.expect('hr may not delete a role',
  pg_temp.try_as('hr', format('select * from public.app_delete_role(%s)', pg_temp.id('r_help'))), '42501');
select pg_temp.expect('delete returns holders',
  pg_temp.try_as('admin', format('select * from public.app_delete_role(%s)', pg_temp.id('r_help'))),
  'ok:4');
select pg_temp.expect('… the role and its assignments are gone; role.delete audit lists the holders',
  (select count(*)::text from public.roles where id = (select id from fx where k='r_help')) || ':'
  || (select count(*)::text from public.user_roles where role_id = (select id from fx where k='r_help')) || ':'
  || (select jsonb_array_length(a.before->'holders')::text from public.audit_log a
       where a.action = 'role.delete' and a.entity_id = (select id from fx where k='r_help')), '0:0:4');
select pg_temp.expect('presets cannot be deleted',
  pg_temp.try_as('admin', format('select * from public.app_delete_role(%s)', pg_temp.role_id('company', 'hr'))), '22023');
select pg_temp.expect('system roles cannot be deleted',
  pg_temp.try_as('admin', format('select * from public.app_delete_role(%s)', pg_temp.role_id('company', 'employee'))), '22023');

-- fix round 1: identity presets (approval-step and clearance signers) need the
-- matching edit permission to give or take away, on top of D5.
select pg_temp.expect('nosign (role_assign, no approval_steps) may reset emp''s password',
  pg_temp.try_as('nosign', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('emp'), 'Temp!2026x')), 'ok:1');
-- R2: security never signs an approval step any more (main's CHECK), so giving
-- Security is plain D5: nosign holds every Security permission.
select pg_temp.expect('… and may give emp Security and take it away (security is no identity preset now)',
  pg_temp.try_as('nosign', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'security'))) || ' '
  || pg_temp.try_as('nosign', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'))), 'ok:1 ok:1');
select pg_temp.expect('… and create an employee who holds Security',
  pg_temp.try_as('nosign', format($q$select public.app_create_employee('9990000987','FR55 c6','Temp!2026x',%s, %s, p_role_ids => array[%s]::uuid[])$q$,
    pg_temp.id('company'), pg_temp.id('dept'), pg_temp.role_id('company', 'security'))), 'ok:1');
-- D5 on Security: role_assign alone is not enough, the caller must hold every
-- Security permission. nosign without absences is refused, with it allowed (above).
-- (hr is refused too, but only because the HR preset lacks role_assign.)
delete from public.role_permissions where role_id = (select id from fx where k='r_nosign') and permission = 'absences';
select pg_temp.expect('… without absences read nosign may not give Security (D5); hr (no role_assign) may not either',
  pg_temp.try_as('nosign', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'security'))) || ' '
  || (select private.role_within((select id from public.roles where company_id = (select id from fx where k='company') and system_key = 'security'),
                                 (select id from fx where k='nosign'))::text) || ' '
  || pg_temp.try_as('hr', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'security'))) || ' '
  || private.has_perm((select id from fx where k='hr'), 'role_assign', 'edit')::text, '42501 false 42501 false');
insert into public.role_permissions values ((select id from fx where k='r_nosign'), 'absences', 'read');
-- clearance read makes Finance's permissions a subset of nosign's, so only the identity rule refuses.
insert into public.role_permissions values ((select id from fx where k='r_nosign'), 'clearance', 'read');
-- A fresh plain target (created by hr above), so the Security scenarios cannot leak in.
insert into fx select 'c4', id from public.profiles where personnel_no = '9990000985';
select pg_temp.expect('nosign with clearance read may not give Finance to a plain employee (would sign the finance box)',
  pg_temp.try_as('nosign', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('c4'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'finance'))), '42501');
select pg_temp.expect('… the target still holds Employee only',
  (select string_agg(r.name, ',' order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = (select id from fx where k='c4')), 'Employee');
select pg_temp.expect('Everything gives Security and Finance',
  pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s, %s, %s]::uuid[])', pg_temp.id('c4'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'security'), pg_temp.role_id('company', 'finance'))), 'ok:1');
select pg_temp.expect('… and takes them away again; nosign may not take them away',
  pg_temp.try_as('nosign', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('c4'),
    pg_temp.role_id('company', 'employee'))) || ' '
  || pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('c4'),
    pg_temp.role_id('company', 'employee'))), '42501 ok:1');

-- fix round 1: role_manager depends on leave_balances and calendar (D6 amendment):
-- a Manager reads every profile, balance and the calendar.
select pg_temp.expect('role_manager without leave_balances and calendar refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'RM1', '{"people":"read","role_manager":"edit"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'RM1b', '{"people":"read","role_manager":"edit","leave_balances":"read"}')$q$), '22023 22023');
select pg_temp.expect('role_manager with people, leave_balances and calendar read allowed',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'RM2', '{"people":"read","role_manager":"edit","leave_balances":"read","calendar":"read"}')$q$), 'ok:1');
select pg_temp.expect('no seeded preset (any company) breaks the dependency map',
  (select count(*)::text from public.roles r cross join private.permission_deps() d
     join public.role_permissions rp on rp.role_id = r.id and rp.permission = d.key
    where r.kind = 'preset'
      and (d.key_level = 'read' or rp.level = 'edit')
      and not exists (select 1 from public.role_permissions n where n.role_id = r.id and n.permission = d.needs)), '0');

-- fix round 1: the admin row survives assignment. The D1 check refuses a call
-- that omits the admin role id; the delete guard behind it only matters in a
-- race (see the task-3 report), so its presence is asserted on the definition.
select pg_temp.expect('the admin''s call omitting their admin role id is refused; the admin row survives',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('admin'),
    pg_temp.role_id('company', 'employee'))) || ' '
  || (select count(*)::text from public.user_roles where role = 'admin'), '42501 1');
select pg_temp.expect('the role delete in app_set_user_role_ids never matches the admin row',
  (select (pg_get_functiondef('public.app_set_user_role_ids(uuid, uuid[])'::regprocedure)
           ~ 'role_id <> all \(v_after\)\s+and role is distinct from ''admin''')::text), 'true');

-- grants
select pg_temp.expect('anon may execute none of the new RPCs',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_list_roles','app_role_holders','app_save_role','app_delete_role',
                        'app_set_user_role_ids','app_set_user_roles','app_transfer_admin','app_create_employee')
      and has_function_privilege('anon', p.oid, 'execute')), '0');

-- company scope (Task 3b): the delegable config writes (holidays, work_settings,
-- approval_steps) never reach another company's rows, not even for the admin.
-- Setup runs as the superuser (policies do not apply), so the other company owns one
-- row per table. The SELECT policies are company-blind, so those rows ARE visible to
-- the admin and only the write policies' company condition can stop the writes.
do $$
declare v_other uuid := (select id from fx where k = 'other_company');
begin
  insert into public.holidays (company_id, holiday_date, name_fa) values (v_other, '2099-05-01', 'FR55 other');
  insert into public.approval_steps (company_id, role, step_order) values (v_other, 'hr', 81);
  insert into public.work_settings (company_id) values (v_other) on conflict (company_id) do nothing;
end $$;
select pg_temp.expect('company scope: the other company''s rows exist and the admin can read them',
  pg_temp.try_as('admin', format('select 1 from public.holidays where company_id = %s', pg_temp.id('other_company'))) || ' '
  || pg_temp.try_as('admin', format('select 1 from public.approval_steps where company_id = %s', pg_temp.id('other_company'))) || ' '
  || pg_temp.try_as('admin', format('select 1 from public.work_settings where company_id = %s', pg_temp.id('other_company'))),
  'ok:1 ok:1 ok:1');

select pg_temp.expect('company scope holidays: admin update/delete of another company''s holiday touch nothing',
  pg_temp.try_as('admin', format('update public.holidays set name_fa = %L where company_id = %s', 'x', pg_temp.id('other_company'))) || ' '
  || pg_temp.try_as('admin', format('delete from public.holidays where company_id = %s', pg_temp.id('other_company'))),
  'ok:0 ok:0');
select pg_temp.expect('company scope holidays: admin insert into another company refused',
  pg_temp.try_as('admin', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)',
    pg_temp.id('other_company'), '2099-05-02', 'x')), '42501');
select pg_temp.expect('company scope holidays: a row cannot be moved to another company',
  pg_temp.try_as('admin', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)',
    pg_temp.id('company'), '2099-05-03', 'FR55 mine')) || ' '
  || pg_temp.try_as('admin', format('update public.holidays set company_id = %s where holiday_date = %L', pg_temp.id('other_company'), '2099-05-03')),
  'ok:1 42501');
select pg_temp.expect('company scope holidays: own company still works for the admin',
  pg_temp.try_as('admin', format('update public.holidays set name_fa = %L where company_id = %s and holiday_date = %L', 'FR55 mine 2', pg_temp.id('company'), '2099-05-03')) || ' '
  || pg_temp.try_as('admin', format('delete from public.holidays where company_id = %s and holiday_date = %L', pg_temp.id('company'), '2099-05-03')),
  'ok:1 ok:1');
select pg_temp.expect('company scope holidays: the other company''s row is untouched',
  (select count(*)::text || ':' || min(name_fa) from public.holidays where company_id = (select id from fx where k='other_company') and holiday_date = '2099-05-01'),
  '1:FR55 other');

select pg_temp.expect('company scope approval_steps: admin update/delete of another company''s step touch nothing',
  pg_temp.try_as('admin', format('update public.approval_steps set step_order = 82 where company_id = %s', pg_temp.id('other_company'))) || ' '
  || pg_temp.try_as('admin', format('delete from public.approval_steps where company_id = %s', pg_temp.id('other_company'))),
  'ok:0 ok:0');
select pg_temp.expect('company scope approval_steps: admin insert into another company refused',
  pg_temp.try_as('admin', format('insert into public.approval_steps (company_id, role, manager_scope, step_order) values (%s, %L, %L, 83)',
    pg_temp.id('other_company'), 'manager', 'department')), '42501');
select pg_temp.expect('company scope approval_steps: a step cannot be moved to another company',
  pg_temp.try_as('hr', format('update public.approval_steps set company_id = %s where approver_id = %s', pg_temp.id('other_company'), pg_temp.id('appr'))), '42501');
select pg_temp.expect('company scope approval_steps: hr edits and the admin deletes in the own company',
  pg_temp.try_as('hr', format('update public.approval_steps set step_order = 95 where approver_id = %s', pg_temp.id('appr'))) || ' '
  || pg_temp.try_as('hr', format('insert into public.approval_steps (company_id, role, manager_scope, step_order) values (%s, %L, %L, 84)', pg_temp.id('company'), 'manager', 'department')) || ' '
  || pg_temp.try_as('admin', format('delete from public.approval_steps where company_id = %s and step_order = 84', pg_temp.id('company'))),
  'ok:1 ok:1 ok:1');
select pg_temp.expect('company scope approval_steps: hr (a non-admin delegate) cannot reach the other company either',
  pg_temp.try_as('hr', format('update public.approval_steps set step_order = 85 where company_id = %s', pg_temp.id('other_company'))) || ' '
  || pg_temp.try_as('hr', format('insert into public.approval_steps (company_id, role, manager_scope, step_order) values (%s, %L, %L, 86)', pg_temp.id('other_company'), 'manager', 'department')),
  'ok:0 42501');
select pg_temp.expect('company scope approval_steps: the other company''s step is untouched',
  (select count(*)::text || ':' || min(step_order)::text from public.approval_steps where company_id = (select id from fx where k='other_company')), '1:81');

select pg_temp.expect('company scope work_settings: admin update/delete of another company''s settings touch nothing',
  pg_temp.try_as('admin', format('update public.work_settings set hours_per_day = 7 where company_id = %s', pg_temp.id('other_company'))) || ' '
  || pg_temp.try_as('admin', format('delete from public.work_settings where company_id = %s', pg_temp.id('other_company'))),
  'ok:0 ok:0');
-- The other company already has its row: without the policy this would be 23505.
select pg_temp.expect('company scope work_settings: admin insert for another company refused by the policy',
  pg_temp.try_as('admin', format('insert into public.work_settings (company_id) values (%s)', pg_temp.id('other_company'))), '42501');
-- Without the WITH CHECK, the clash with the other company's row would be 23505.
select pg_temp.expect('company scope work_settings: settings cannot be moved to another company',
  pg_temp.try_as('admin', format('update public.work_settings set company_id = %s where company_id = %s', pg_temp.id('other_company'), pg_temp.id('company'))), '42501');
select pg_temp.expect('company scope work_settings: own company still works for the admin',
  pg_temp.try_as('admin', format('update public.work_settings set hours_per_day = hours_per_day where company_id = %s', pg_temp.id('company'))),
  (select 'ok:' || count(*) from public.work_settings where company_id = (select id from fx where k='company')));
select pg_temp.expect('company scope work_settings: the other company''s settings are untouched',
  (select count(*)::text || ':' || min(hours_per_day)::text from public.work_settings where company_id = (select id from fx where k='other_company')), '1:8');

-- ── R2: main's client-feedback features (FR-56..FR-64) under the catalog ────
-- Custom roles built straight from the new items, each on its own user.
do $$
declare
  r record;
  v_role uuid;
begin
  for r in
    select * from (values
      ('payroll', 'Payroll',  '{"finance":"read"}'::jsonb,                                          '9990000990'),
      ('selfie',  'SelfInfo', '{"personal_info_own":"edit"}'::jsonb,                                '9990000991'),
      ('board',   'Board',    '{"absences":"read","people":"read","leave_requests":"read"}'::jsonb, '9990000992'),
      ('wsonly',  'WorkOnly', '{"work_settings":"edit"}'::jsonb,                                    '9990000993'),
      ('reqs',    'ReqsOnly', '{"people":"read","leave_requests":"read"}'::jsonb,                     '9990000994')
    ) as t(k, rname, perms, code)
  loop
    insert into public.roles (company_id, kind, name)
      values ((select id from fx where k = 'company'), 'custom', r.rname) returning id into v_role;
    insert into public.role_permissions select v_role, key, value #>> '{}' from jsonb_each(r.perms);
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email, encrypted_password)
      values ((select id from fx where k = r.k), r.code || '@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, active, personnel_no, must_change_password)
      values ((select id from fx where k = r.k), (select id from fx where k = 'company'), r.code, 'FR55 ' || r.k,
              (select id from fx where k = 'dept'), true, r.code, false);
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    insert into public.user_roles (user_id, role_id) values ((select id from fx where k = r.k), v_role);
  end loop;
end $$;

-- role editor: the new items' shapes and dependencies (D6: the absences board
-- reads leave_requests and profiles through RLS).
select pg_temp.expect('R2 editor: absences needs people and leave_requests',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'AbsBad', '{"absences":"read"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'AbsBad', '{"absences":"read","people":"read"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'AbsOk', '{"absences":"read","people":"read","leave_requests":"read"}')$q$),
  '22023 22023 ok:1');
select pg_temp.expect('R2 editor: finance read and personal_info_own edit stand alone; wrong levels refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'FinOk', '{"finance":"read"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'OwnOk', '{"personal_info_own":"edit"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"finance":"edit"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"absences":"edit","people":"read","leave_requests":"read"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"personal_info_own":"read"}')$q$),
  'ok:1 ok:1 22023 22023 22023');

-- legacy aliases for custom roles
select pg_temp.expect('R2 legacy keys from custom roles: finance.view, absences.view, personal_info.edit_own yes; personal_info.edit no',
  (select private.has_permission((select id from fx where k='payroll'),'finance.view')::text
       || private.has_permission((select id from fx where k='board'),'absences.view')::text
       || private.has_permission((select id from fx where k='selfie'),'personal_info.edit_own')::text
       || private.has_permission((select id from fx where k='selfie'),'personal_info.edit')::text), 'truetruetruefalse');
select pg_temp.expect('R2 settings.edit needs work_settings AND holidays edit',
  (select private.has_permission((select id from fx where k='wsonly'),'settings.edit')::text), 'false');
select pg_temp.expect('R2 work_settings edit alone: edits work settings, not holidays',
  pg_temp.try_as('wsonly', format('update public.work_settings set weekend_days = weekend_days where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('wsonly', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2099-03-24', 'آزمون')),
  (select 'ok:' || count(*) from public.work_settings where company_id = (select id from fx where k='company')) || ' 42501');

-- personal_info_own (FR-63 switch): own row only with the item; admin implicit.
select pg_temp.expect('R2 own personal info: employee and hr refused, admin allowed',
  pg_temp.try_as('emp', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55own', pg_temp.id('emp'))) || ' '
  || pg_temp.try_as('hr', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55own', pg_temp.id('hr'))) || ' '
  || pg_temp.try_as('admin', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55own', pg_temp.id('admin'))),
  'ok:0 ok:0 ok:1');
select pg_temp.expect('R2 own personal info: a custom role with personal_info_own edits its own row only',
  pg_temp.try_as('selfie', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55own', pg_temp.id('selfie'))) || ' '
  || pg_temp.try_as('selfie', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55own', pg_temp.id('emp2'))),
  'ok:1 ok:0');
select pg_temp.expect('R2 own personal info: hr still edits an employee''s row',
  pg_temp.try_as('hr', format('update public.employee_personal_info set father_name = %L where employee_id = %s', 'FR55hr', pg_temp.id('emp2'))), 'ok:1');
select pg_temp.expect('R2 own personal info import: hr refused on its own row (FR-63), Everything (holds personal_info_own) allowed',
  pg_temp.try_as('hr', format('select public.app_import_personal_info(%L)', json_build_array(json_build_object('personnel_no', '9990000951', 'father_name', 'FR55'))::text)) || ' '
  || pg_temp.try_as('super', format('select public.app_import_personal_info(%L)', json_build_array(json_build_object('personnel_no', '9990000960', 'father_name', 'FR55'))::text)),
  '42501 ok:1');
select pg_temp.expect('R2 own personal info: the employee still reads their own row',
  pg_temp.try_as('emp', format('select 1 from public.employee_personal_info where employee_id = %s', pg_temp.id('emp'))), 'ok:1');

-- finance: finance_approved_requests follows finance read.
select pg_temp.expect('R2 finance list: Finance preset, a custom finance role and hr (owner ruling a) yes; helpdesk, board no',
  pg_temp.try_as('fin', 'select count(*) from public.finance_approved_requests(current_date - 30, current_date + 30)') || ' '
  || pg_temp.try_as('payroll', 'select count(*) from public.finance_approved_requests(current_date - 30, current_date + 30)') || ' '
  || pg_temp.try_as('hr', 'select count(*) from public.finance_approved_requests(current_date - 30, current_date + 30)') || ' '
  || pg_temp.try_as('help', 'select count(*) from public.finance_approved_requests(current_date - 30, current_date + 30)') || ' '
  || pg_temp.try_as('board', 'select count(*) from public.finance_approved_requests(current_date - 30, current_date + 30)'),
  'ok:1 ok:1 ok:1 42501 42501');

-- absences: the board's gate is the absences item (legacy absences.view and the
-- app_perms claim); its rows come through leave_requests_select (leave_requests
-- read, a dependency). 'reqs' holds the dependencies without the item.
select pg_temp.expect('R2 absences board: the gate is absences read (alias + claims), not its dependencies',
  (select private.has_permission((select id from fx where k='board'),'absences.view')::text
       || private.has_permission((select id from fx where k='reqs'),'absences.view')::text
       || private.has_permission((select id from fx where k='help'),'absences.view')::text) || ' '
  || pg_temp.val_as('board', 'select coalesce(public.app_my_permissions()->>''absences'', ''-'')') || ' '
  || pg_temp.val_as('reqs', 'select coalesce(public.app_my_permissions()->>''absences'', ''-'')'),
  'truefalsefalse read -');
select pg_temp.expect('R2 absences board: an absences holder reads every approved request; helpdesk none',
  pg_temp.try_as('board', 'select 1 from public.leave_requests where status = ''approved''') || ' '
  || pg_temp.try_as('help', 'select 1 from public.leave_requests where status = ''approved'''),
  (select 'ok:' || count(*) from public.leave_requests where status = 'approved') || ' ok:0');

-- request_approval_progress mirrors leave_requests_select (leave_requests read).
select pg_temp.expect('R2 approval progress: hr and a leave_requests-read role yes; helpdesk not found',
  pg_temp.try_as('hr', format('select count(*) from public.request_approval_progress(%s)',
    quote_literal((select id from public.leave_requests where serial_year = 1 and serial_seq = 955002)))) || ' '
  || pg_temp.try_as('board', format('select count(*) from public.request_approval_progress(%s)',
    quote_literal((select id from public.leave_requests where serial_year = 1 and serial_seq = 955002)))) || ' '
  || pg_temp.try_as('help', format('select count(*) from public.request_approval_progress(%s)',
    quote_literal((select id from public.leave_requests where serial_year = 1 and serial_seq = 955002)))),
  'ok:1 ok:1 P0002');

-- main's approval-chain rules are untouched by FR-55.
select pg_temp.expect('R2 approval_steps_role_allowed CHECK is main''s',
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'approval_steps_role_allowed'),
  'CHECK (((role = ANY (ARRAY[''manager''::app_role, ''hr''::app_role, ''employee''::app_role])) OR ((role = ANY (ARRAY[''security''::app_role, ''admin''::app_role])) AND (NOT active))))');
select pg_temp.expect('R2 hr may not add an active security step (CHECK)',
  pg_temp.try_as('hr', format('insert into public.approval_steps (company_id, role, step_order) values (%s, %L, 87)', pg_temp.id('company'), 'security')), '23514');
select pg_temp.expect('R2 approve_leave_request: one overload, 5 args, no permission gate; reject has none either',
  (select count(*)::text || ':' || min(pronargs)::text from pg_proc where proname = 'approve_leave_request') || ' '
  || (pg_get_functiondef('public.approve_leave_request(uuid, text, boolean, boolean, bigint)'::regprocedure) ~ 'has_perm')::text || ' '
  || (pg_get_functiondef('public.reject_leave_request(uuid, text)'::regprocedure) ~ 'has_perm')::text,
  '1:5 false false');

-- ── R5: main's FR-65 / FR-66 under the catalog, owner ruling (a), hr identity ──
-- Fixtures: a plain target and custom roles built for each rule.
do $$
declare
  r record;
  v_role uuid;
begin
  for r in
    select * from (values
      ('plain',     null,        null::jsonb,                                                                '9990000941'),
      ('granter',   'Granter',   '{"special_leave":"edit","people":"read","leave_balances":"read"}'::jsonb,   '9990000942'),
      ('stepsonly', 'StepsOnly', '{"approval_steps":"edit","people":"read"}'::jsonb,                          '9990000943'),
      ('hrlite',    'HRLite',    (select jsonb_object_agg(rp.permission, rp.level) from public.role_permissions rp
                                   join public.roles hr on hr.id = rp.role_id
                                  where hr.company_id = (select id from fx where k = 'company') and hr.system_key = 'hr'
                                    and rp.permission not in ('absences', 'finance')),                       '9990000944'),
      ('stepper',   'Stepper',   (select jsonb_object_agg(k, case when private.permission_allows(k, 'edit') then 'edit' else 'read' end)
                                   from private.permission_keys() k where k <> 'clearance'),                 '9990000945')
    ) as t(k, rname, perms, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email, encrypted_password)
      values ((select id from fx where k = r.k), r.code || '@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, active, personnel_no, must_change_password)
      values ((select id from fx where k = r.k), (select id from fx where k = 'company'), r.code, 'FR55 ' || r.k,
              (select id from fx where k = 'dept'), true, r.code, false);
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    if r.rname is not null then
      insert into public.roles (company_id, kind, name)
        values ((select id from fx where k = 'company'), 'custom', r.rname) returning id into v_role;
      insert into public.role_permissions select v_role, key, value #>> '{}' from jsonb_each(r.perms);
      insert into public.user_roles (user_id, role_id) values ((select id from fx where k = r.k), v_role);
      insert into fx values ('r_' || r.k, v_role);
    end if;
  end loop;
end $$;

-- special_leave: catalog item and editor dependencies.
select pg_temp.expect('R5 editor: special_leave needs people and leave_balances; read is refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'SlBad', '{"special_leave":"edit"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'SlBad', '{"special_leave":"edit","people":"read"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'SlBad', '{"special_leave":"read","people":"read","leave_balances":"read"}')$q$) || ' '
  || pg_temp.try_as('admin', $q$select public.app_save_role(null, 'SlOk', '{"special_leave":"edit","people":"read","leave_balances":"read"}')$q$),
  '22023 22023 22023 ok:1');
select pg_temp.expect('R5 legacy special_leave.grant: a custom role with the item yes; StepsOnly no',
  (select private.has_permission((select id from fx where k='granter'),'special_leave.grant')::text
       || private.has_permission((select id from fx where k='stepsonly'),'special_leave.grant')::text), 'truefalse');

-- special leave grants: private.special_leave_target keys on has_perm + D4.
select pg_temp.expect('R5 special leave: hr grants bereavement (with a note) to a plain employee',
  pg_temp.try_as('hr', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('plain'), 'bereavement', 'R5 uncle')), 'ok:1');
select pg_temp.expect('… the grant carries the note and hr as granter',
  (select coalesce(string_agg(note, ','), '-') from public.special_leave_grants
    where employee_id = (select id from fx where k='plain') and granted_by = (select id from fx where k='hr')), 'R5 uncle');
select pg_temp.expect('R5 special leave: a custom role with special_leave edit grants to a plain employee',
  pg_temp.try_as('granter', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('plain'), 'bereavement', 'R5 aunt')), 'ok:1');
select pg_temp.expect('R5 special leave: … not to an hr holder (D4)',
  pg_temp.val_as('granter', format('select public.app_grant_special_leave(%s, %L, %L)::text', pg_temp.id('hr'), 'bereavement', 'x')),
  '42501: not allowed to grant special leave to this employee');
select pg_temp.expect('R5 special leave: … not to the admin (main''s message)',
  pg_temp.val_as('granter', format('select public.app_grant_special_leave(%s, %L, %L)::text', pg_temp.id('admin'), 'bereavement', 'x')),
  '42501: not allowed to grant special leave to an admin');
select pg_temp.expect('R5 special leave: … not to themself (main''s message)',
  pg_temp.val_as('granter', format('select public.app_grant_special_leave(%s, %L, %L)::text', pg_temp.id('granter'), 'bereavement', 'x')),
  '42501: you cannot change your own leave balance');
select pg_temp.expect('R5 special leave: … not across companies',
  pg_temp.val_as('granter', format('select public.app_grant_special_leave(%s, %L, %L)::text', pg_temp.id('outsider'), 'bereavement', 'x')),
  'P0002: employee not found');
select pg_temp.expect('R5 special leave: a role without the item, an employee and an inactive hr are refused',
  pg_temp.val_as('help', format('select public.app_grant_special_leave(%s, %L, %L)::text', pg_temp.id('plain'), 'bereavement', 'x')) || ' | '
  || pg_temp.try_as('emp', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('plain'), 'bereavement', 'x')) || ' '
  || pg_temp.try_as('hr_off', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('plain'), 'bereavement', 'x')),
  '42501: not allowed to grant special leave | 42501 42501');
select pg_temp.expect('R5 special leave: the admin still grants to themself (main''s rule)',
  pg_temp.try_as('admin', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('admin'), 'bereavement', 'R5 admin')), 'ok:1');
-- (a): hr acts on a Security holder; a role without absences read does not.
select pg_temp.expect('R5 special leave: hr grants to a security holder (ruling a); HRLite (no absences) may not',
  pg_temp.try_as('hr', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('sec'), 'bereavement', 'R5 sec')) || ' '
  || pg_temp.try_as('hrlite', format('select public.app_grant_special_leave(%s, %L, %L)', pg_temp.id('sec'), 'bereavement', 'x')),
  'ok:1 42501');
-- revoke runs the same guard
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where k = 'admin'), 'role', 'authenticated')::text, true);
  insert into fx values ('g_hr', public.app_grant_special_leave((select id from fx where k='hr'), 'bereavement', 'R5 hr'));
  perform set_config('request.jwt.claims', '', true);
end $$;
select pg_temp.expect('R5 special leave revoke: the granter revokes on a plain employee, not on an hr holder; helpdesk never',
  pg_temp.try_as('help', format('select public.app_revoke_special_leave(%L)',
    (select id from public.special_leave_grants where employee_id = (select id from fx where k='plain') and note = 'R5 uncle'))) || ' '
  || pg_temp.try_as('granter', format('select public.app_revoke_special_leave(%L)',
    (select id from public.special_leave_grants where employee_id = (select id from fx where k='plain') and note = 'R5 uncle'))) || ' '
  || pg_temp.val_as('granter', format('select public.app_revoke_special_leave(%L)::text', (select id from fx where k='g_hr'))),
  '42501 ok:1 42501: not allowed to grant special leave to this employee');
select pg_temp.expect('R5 special leave grants: special_leave holders read the company''s grants; others only their own',
  pg_temp.val_as('granter', 'select count(*) from public.special_leave_grants where kind = ''bereavement'' and note like ''R5 %''') || ' '
  || pg_temp.val_as('help', 'select count(*) from public.special_leave_grants') || ' '
  || pg_temp.val_as('plain', 'select count(*) from public.special_leave_grants'),
  '5 0 2');
select pg_temp.expect('R5 special_leave_grants_select keys on has_perm, special_leave_target on has_perm + can_act_on',
  (select (qual ~ 'has_perm\(' and qual !~ 'has_permission')::text from pg_policies
    where schemaname = 'public' and tablename = 'special_leave_grants' and policyname = 'special_leave_grants_select') || ' '
  || (select (d ~ 'has_perm\(p_actor, ''special_leave'', ''edit''\)' and d ~ 'can_act_on\(p_actor, p_employee\)'
              and d !~ 'has_permission')::text
        from pg_get_functiondef('private.special_leave_target(uuid, uuid)'::regprocedure) d),
  'true true');

-- (a): HR covers the Security and Finance presets; a role without those items does not.
select pg_temp.expect('R5 (a): HRLite (hr minus absences / finance) not on security or finance holders; on a plain employee yes',
  (select private.can_act_on((select id from fx where k='hrlite'), (select id from fx where k='sec'))::text
       || private.can_act_on((select id from fx where k='hrlite'), (select id from fx where k='fin'))::text
       || private.can_act_on((select id from fx where k='hrlite'), (select id from fx where k='plain'))::text), 'falsefalsetrue');

-- hr identity: hr holders sign approval steps AND clearance HR rows by role, so
-- acting on them (or giving / taking hr) needs approval_steps edit and clearance
-- edit. HR's preset is stripped of clearance for this block, so only the
-- identity rule can refuse Stepper (every item but clearance).
delete from public.role_permissions where role_id = (select id from public.roles
  where company_id = (select id from fx where k='company') and system_key = 'hr') and permission = 'clearance';
select pg_temp.expect('R5 identity: an hr holder needs clearance edit too (Stepper refused, Everything allowed)',
  (select private.can_act_on((select id from fx where k='stepper'), (select id from fx where k='hr'))::text
       || private.can_act_on((select id from fx where k='super'), (select id from fx where k='hr'))::text
       || private.can_act_on((select id from fx where k='stepper'), (select id from fx where k='plain'))::text), 'falsetruetrue');
select pg_temp.expect('R5 identity mirror: giving or taking HR needs approval_steps and clearance edit',
  pg_temp.try_as('stepper', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('plain'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'hr'))) || ' '
  || pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('plain'),
    pg_temp.role_id('company', 'employee'), pg_temp.role_id('company', 'hr'))) || ' '
  || pg_temp.try_as('stepper', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('plain'),
    pg_temp.role_id('company', 'employee'))) || ' '
  || pg_temp.try_as('super', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('plain'),
    pg_temp.role_id('company', 'employee'))),
  '42501 ok:1 42501 ok:1');
insert into public.role_permissions select id, 'clearance', 'edit' from public.roles
  where company_id = (select id from fx where k='company') and system_key = 'hr';

-- FR-66: the approval-order switch follows approval_steps edit; hours per day
-- stays admin-only; other columns need work_settings edit.
select pg_temp.try_su(format('update public.work_settings set approval_order_enforced = false where company_id = %s', pg_temp.id('company')));
select pg_temp.expect('R5 order RPC: hr switches it on',
  pg_temp.try_as('hr', 'select public.app_set_approval_order_enforced(true)'), 'ok:1');
select pg_temp.expect('… the switch is on; one work_settings.approval_order audit row with before/after',
  (select approval_order_enforced::text from public.work_settings where company_id = (select id from fx where k='company')) || ' '
  || (select count(*)::text || ':' || min(before->>'approval_order_enforced') || '>' || min(after->>'approval_order_enforced')
        from public.audit_log where action = 'work_settings.approval_order' and actor_id = (select id from fx where k='hr')),
  'true 1:false>true');
select pg_temp.expect('R5 order RPC: StepsOnly (approval_steps edit, no work_settings) switches it; a direct update finds no row',
  pg_temp.try_as('stepsonly', 'select public.app_set_approval_order_enforced(false)') || ' '
  || pg_temp.try_as('stepsonly', format('update public.work_settings set approval_order_enforced = true where company_id = %s', pg_temp.id('company'))),
  'ok:1 ok:0');
select pg_temp.expect('… the switch is off again',
  (select approval_order_enforced::text from public.work_settings where company_id = (select id from fx where k='company')), 'false');
select pg_temp.expect('R5 order: WorkOnly (work_settings edit, no approval_steps) edits days off, not the order switch',
  pg_temp.try_as('wsonly', format('update public.work_settings set weekend_days = weekend_days where company_id = %s', pg_temp.id('company'))) || ' '
  || pg_temp.val_as('wsonly', format('update public.work_settings set approval_order_enforced = true where company_id = %s returning 1', pg_temp.id('company'))) || ' | '
  || pg_temp.try_as('wsonly', 'select public.app_set_approval_order_enforced(true)'),
  'ok:1 42501: not allowed to change the approval order setting | 42501');
select pg_temp.expect('R5 order: hours per day stays admin-only for hr (main''s message); the admin may',
  pg_temp.val_as('hr', format('update public.work_settings set hours_per_day = 9 where company_id = %s returning 1', pg_temp.id('company'))) || ' | '
  || pg_temp.try_as('admin', format('update public.work_settings set hours_per_day = hours_per_day where company_id = %s', pg_temp.id('company'))),
  '42501: only an admin may change the hours per day | ok:1');
select pg_temp.expect('R5 order RPC: employee and inactive hr refused, NULL invalid',
  pg_temp.val_as('emp', 'select public.app_set_approval_order_enforced(true)::text') || ' | '
  || pg_temp.try_as('hr_off', 'select public.app_set_approval_order_enforced(true)') || ' '
  || pg_temp.try_as('hr', 'select public.app_set_approval_order_enforced(null)'),
  '42501: not allowed to change the approval order setting | 42501 22023');
select pg_temp.expect('R5 order RPC: definer, empty search_path, authenticated only',
  (select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') || ' '
          || has_function_privilege('anon', p.oid, 'execute')::text || ' '
          || has_function_privilege('authenticated', p.oid, 'execute')::text
     from pg_proc p where p.oid = 'public.app_set_approval_order_enforced(boolean)'::regprocedure),
  'true search_path="" false true');
-- Missing row: the RPC creates it with column defaults; a direct insert by a
-- work_settings-only role may not switch the order on (INSERT branch).
create temp table ws_saved as select * from public.work_settings where company_id = (select id from fx where k='company');
select pg_temp.try_su(format('delete from public.work_settings where company_id = %s', pg_temp.id('company')));
select pg_temp.expect('R5 order: with no settings row, WorkOnly may not insert one with the order on, may insert defaults',
  pg_temp.try_as('wsonly', format('insert into public.work_settings (company_id, approval_order_enforced) values (%s, true)', pg_temp.id('company'))) || ' '
  || pg_temp.try_as('wsonly', format('insert into public.work_settings (company_id) values (%s)', pg_temp.id('company'))),
  '42501 ok:1');
select pg_temp.try_su(format('delete from public.work_settings where company_id = %s', pg_temp.id('company')));
select pg_temp.expect('R5 order RPC: with no settings row, StepsOnly creates it',
  pg_temp.try_as('stepsonly', 'select public.app_set_approval_order_enforced(true)'), 'ok:1');
select pg_temp.expect('… one row with the column defaults and the switch on, updated by StepsOnly',
  (select count(*)::text || ':' || bool_and(approval_order_enforced)::text || ':' || min(hours_per_day)::text
             || ':' || (min(updated_by::text) = (select id from fx where k='stepsonly')::text)::text
        from public.work_settings where company_id = (select id from fx where k='company')),
  '1:true:8:true');
select pg_temp.try_su(format('delete from public.work_settings where company_id = %s', pg_temp.id('company')));
select pg_temp.try_su('insert into public.work_settings select * from ws_saved');

-- transfer (D1). Must be the LAST section: it moves the real admin's role row
-- onto a fixture admin whose password the test knows (all rolled back).
do $$
declare v_company uuid := (select id from fx where k = 'company');
begin
  insert into fx values ('adm_t', gen_random_uuid());
  insert into auth.users (id, email, encrypted_password)
    values ((select id from fx where k='adm_t'), '9990000961@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
  insert into public.profiles (id, company_id, employee_code, full_name, active, personnel_no, must_change_password)
    values ((select id from fx where k='adm_t'), v_company, '9990000961', 'FR55 adm_t', true, '9990000961', false);
  insert into public.user_roles (user_id, role) values ((select id from fx where k='adm_t'), 'employee');
  update public.user_roles set user_id = (select id from fx where k='adm_t') where role = 'admin';
end $$;
select pg_temp.expect('transfer: non-admin refused',
  pg_temp.try_as('super', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000955', 'Fixture!2026')), '42501');
select pg_temp.expect('transfer: wrong password',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000955', 'wrong')), '42501');
select pg_temp.expect('transfer: wrong personnel number',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000954', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: inactive target',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('hr_off'), '9990000952', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: another company''s employee',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('outsider'), '9990000970', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: to yourself',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('adm_t'), '9990000961', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: success',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000955', 'Fixture!2026')), 'ok:1');
select pg_temp.expect('after transfer: exactly one admin, held by emp2',
  (select count(*)::text || ':' || bool_and(user_id = (select id from fx where k='emp2'))::text
     from public.user_roles where role = 'admin'), '1:true');
select pg_temp.expect('after transfer: old admin keeps employee',
  (select exists (select 1 from public.user_roles where user_id=(select id from fx where k='adm_t') and role='employee')::text), 'true');
select pg_temp.expect('after transfer: an admin.transfer audit row',
  (select count(*)::text from public.audit_log
    where action = 'admin.transfer' and actor_id = (select id from fx where k='adm_t') and entity_id = (select id from fx where k='emp2')), '1');
select pg_temp.expect('after transfer: old admin refused at once (stale token irrelevant)',
  pg_temp.try_as('adm_t', $q$select public.app_save_role(null, 'Late', '{}')$q$), '42501');
select pg_temp.expect('after transfer: the new admin edits roles',
  pg_temp.try_as('emp2', $q$select public.app_save_role(null, 'Late', '{}')$q$), 'ok:1');

rollback;
