-- FR-54 scenarios: the clearance form (فرم تسویه حساب).
--
-- Runs in ONE transaction and rolls back, so it is safe on a database that holds
-- real data. Fixture users are created inside the transaction, which needs the
-- image superuser. Local stack, from the repo root:
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q ) \
--     < tests/sql/fr54-clearance.sql
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

-- Runs p_sql as p_actor and returns its single value, or 'ERR:<sqlstate>'.
create function pg_temp.val_as(p_actor text, p_sql text) returns text
language plpgsql as $f$
declare
  v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where k = p_actor), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return v;
end $f$;

create function pg_temp.expect(p_name text, p_got text, p_want text) returns void
language plpgsql as $f$
begin
  raise notice '% %: got %, want %',
    case when p_got is not distinct from p_want then 'PASS' else 'FAIL' end, p_name, p_got, p_want;
end $f$;

create function pg_temp.id(p_k text) returns text
language sql as $f$ select quote_literal((select id from fx where k = p_k)::text) $f$;

create function pg_temp.sig() returns text
language sql as $f$
  select quote_literal('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwQG8QAAAABJRU5ErkJggg==')
$f$;

create function pg_temp.today() returns date
language sql as $f$ select (now() at time zone 'Asia/Tehran')::date $f$;

-- Files a form as p_actor; stores its id under p_key.
create function pg_temp.file(p_key text, p_actor text, p_emp text, p_last date, p_rows jsonb,
                             p_father text default null, p_cert text default null) returns text
language plpgsql as $f$
declare
  v text;
begin
  v := pg_temp.val_as(p_actor, format(
    'select public.app_create_separation(%s, %L, %L, %L, %L, null, %L)::text',
    pg_temp.id(p_emp), 'resignation', p_last, p_father, p_cert, p_rows::text));
  if v !~ '^ERR' then
    insert into fx values (p_key, v::uuid);
  end if;
  return v;
end $f$;

create function pg_temp.row_id(p_form text, p_where text) returns text
language plpgsql as $f$
declare
  v uuid;
begin
  execute format('select id from public.separation_signoffs where separation_id = %s and %s',
                 pg_temp.id(p_form), p_where) into v;
  return quote_literal(v::text);
end $f$;

-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  v_company uuid := (select company_id from public.profiles where employee_code = 'admin');
  v_dept    uuid := (select id from public.departments where company_id = v_company order by code limit 1);
  v_zq      uuid := gen_random_uuid();
  r record;
begin
  insert into fx values ('company', v_company), ('zq', v_zq);
  for r in
    select * from (values
      ('adm',    '{admin}',        '9990005401', false),
      ('hr',     '{hr}',           '9990005402', false),
      ('hr2',    '{hr,finance}',   '9990005403', false),
      ('fin',    '{finance}',      '9990005404', false),
      ('mgr',    '{manager}',      '9990005405', false),
      ('itp',    '{employee}',     '9990005406', false),
      ('other',  '{employee}',     '9990005407', false),
      ('worker', '{employee}',     '9990005408', true),
      ('w3',     '{employee}',     '9990005409', true),
      ('w4',     '{employee}',     '9990005410', true),
      ('w5',     '{employee}',     '9990005411', true),
      ('w6',     '{employee}',     '9990005412', true)
    ) as t(k, roles, code, in_zq)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email) values ((select id from fx where k = r.k), r.code || '@fixture.invalid');
    if r.in_zq and not exists (select 1 from public.departments where id = v_zq) then
      insert into public.departments (id, company_id, name_fa, name_en, kind, manager_id, code)
      values (v_zq, v_company, 'FR54 dept', 'FR54 dept', 'team', (select id from fx where k = 'mgr'), 'ZQ9');
    end if;
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, active, personnel_no, must_change_password, hire_date)
    values ((select id from fx where k = r.k), v_company, r.code, 'FR54 ' || r.k,
            case when r.in_zq then v_zq else v_dept end, true, r.code, false, date '2020-03-01');
    insert into public.user_roles (user_id, role)
    select (select id from fx where k = r.k), unnest(r.roles::public.app_role[] || '{employee}'::public.app_role[])
    on conflict do nothing;
  end loop;

  update public.employee_personal_info set father_name = 'Existing', birth_cert_no = '123'
   where employee_id = (select id from fx where k = 'w3');

  -- w4: one pending and one approved errand, for the apply scenario.
  insert into public.leave_requests (employee_id, company_id, kind, errand_location, start_date, end_date,
                                     requested_minutes, status, serial_year, serial_seq)
  values ((select id from fx where k = 'w4'), v_company, 'errand', 'FR54', current_date + 5, current_date + 5,
          480, 'pending', 1, 954001),
         ((select id from fx where k = 'w4'), v_company, 'errand', 'FR54', current_date + 6, current_date + 6,
          480, 'approved', 1, 954002);
end $$;

-- ── who may file ────────────────────────────────────────────────────────────
select pg_temp.expect('employee may not file',
  pg_temp.try_as('other', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('worker'), 'resignation', pg_temp.today() + 30, '[]')), '42501');
select pg_temp.expect('manager may not file',
  pg_temp.try_as('mgr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('worker'), 'resignation', pg_temp.today() + 30, '[]')), '42501');
select pg_temp.expect('hr may not file for themselves',
  pg_temp.try_as('hr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('hr'), 'resignation', pg_temp.today() + 30, '[]')), '42501');
select pg_temp.expect('hr may not file for an admin',
  pg_temp.try_as('hr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('adm'), 'resignation', pg_temp.today() + 30, '[]')), '42501');
select pg_temp.expect('an unknown reason is refused',
  pg_temp.try_as('hr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('worker'), 'holiday', pg_temp.today() + 30, '[]')), '22023');
select pg_temp.expect('the leaver may not be named as a signer',
  pg_temp.try_as('hr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('worker'), 'resignation', pg_temp.today() + 30,
    json_build_array(json_build_object('name_fa', 'x', 'name_en', 'x', 'signer_id', (select id from fx where k = 'worker'))))), '22023');

select pg_temp.expect('hr files a form',
  (pg_temp.file('F1', 'hr', 'worker', pg_temp.today() + 30, json_build_array(
    json_build_object('name_fa', 'انبار', 'name_en', 'Warehouse', 'signer_id', (select id from fx where k = 'itp')),
    json_build_object('name_fa', 'واحد', 'name_en', 'Unit', 'department_id', (select id from fx where k = 'zq')),
    json_build_object('name_fa', 'بی‌نام', 'name_en', 'Unassigned'),
    json_build_object('name_fa', 'منابع انسانی', 'name_en', 'HR')
  )::jsonb, 'Karim', '4321') ~ '^[0-9a-f-]{36}$')::text, 'true');

select pg_temp.expect('exactly one HR row, added by the function',
  (select count(*)::text from public.separation_signoffs where separation_id = (select id from fx where k = 'F1') and is_hr), '1');
select pg_temp.expect('rows = HR + the four given',
  (select count(*)::text from public.separation_signoffs where separation_id = (select id from fx where k = 'F1')), '5');
select pg_temp.expect('a department row is signed by its manager',
  (select (signer_id = (select id from fx where k = 'mgr'))::text from public.separation_signoffs
    where separation_id = (select id from fx where k = 'F1') and name_en = 'Unit'), 'true');
select pg_temp.expect('a row with no signer starts unassigned',
  (select (signer_id is null)::text from public.separation_signoffs
    where separation_id = (select id from fx where k = 'F1') and name_en = 'Unassigned'), 'true');
select pg_temp.expect('hire date copied from the profile',
  (select hire_date::text from public.separations where id = (select id from fx where k = 'F1')), '2020-03-01');
select pg_temp.expect('typed father''s name is written back to empty personal info',
  (select father_name || '/' || birth_cert_no from public.employee_personal_info where employee_id = (select id from fx where k = 'worker')), 'Karim/4321');

select pg_temp.expect('personal info wins over typed values',
  (pg_temp.file('F3', 'hr', 'w3', pg_temp.today() + 30, '[]', 'Other', '999') ~ '^[0-9a-f-]{36}$')::text, 'true');
select pg_temp.expect('form copies the personal-info values',
  (select father_name || '/' || birth_cert_no from public.separations where id = (select id from fx where k = 'F3')), 'Existing/123');
select pg_temp.expect('personal info left unchanged',
  (select father_name from public.employee_personal_info where employee_id = (select id from fx where k = 'w3')), 'Existing');

select pg_temp.expect('a second live form is refused',
  pg_temp.try_as('hr', format('select public.app_create_separation(%s, %L, %L, null, null, null, %L)',
    pg_temp.id('worker'), 'dismissal', pg_temp.today() + 30, '[]')), '23505');

-- ── visibility ──────────────────────────────────────────────────────────────
select pg_temp.expect('an unrelated employee sees nothing',
  pg_temp.try_as('other', format('select * from public.separations where id = %s', pg_temp.id('F1'))), 'ok:0');
select pg_temp.expect('the leaver reads their own form',
  pg_temp.try_as('worker', format('select * from public.separations where id = %s', pg_temp.id('F1'))), 'ok:1');
select pg_temp.expect('a signer reads the form',
  pg_temp.try_as('itp', format('select * from public.separations where id = %s', pg_temp.id('F1'))), 'ok:1');
select pg_temp.expect('a signer reads every row',
  pg_temp.try_as('itp', format('select * from public.separation_signoffs where separation_id = %s', pg_temp.id('F1'))), 'ok:5');
select pg_temp.expect('finance reads every form',
  pg_temp.try_as('fin', format('select * from public.separations where id = %s', pg_temp.id('F1'))), 'ok:1');
select pg_temp.expect('nobody writes the tables directly',
  pg_temp.try_as('hr', format('update public.separations set note = %L where id = %s', 'x', pg_temp.id('F1'))), '42501');
select pg_temp.expect('finance reads the leaver''s balances',
  left(pg_temp.try_as('fin', format('select * from public.app_separation_balances(%s)', pg_temp.id('F1'))), 3), 'ok:');
select pg_temp.expect('an outsider may not read balances',
  pg_temp.try_as('other', format('select * from public.app_separation_balances(%s)', pg_temp.id('F1'))), 'P0002');
select pg_temp.expect('a signer outside the team still gets the leaver''s name',
  pg_temp.val_as('itp', format('select public.app_get_separation(%s)->%L->>%L', pg_temp.id('F1'), 'employee', 'name')), 'FR54 worker');
select pg_temp.expect('… and the signers'' names',
  pg_temp.val_as('itp', format('select string_agg(coalesce(r->>%L, %L), %L) from jsonb_array_elements(public.app_get_separation(%s)->%L) r',
    'signer_name', '-', ',', pg_temp.id('F1'), 'rows')), '-,FR54 itp,FR54 mgr,-,-');
select pg_temp.expect('an outsider may not read the form',
  pg_temp.try_as('other', format('select public.app_get_separation(%s)', pg_temp.id('F1'))), 'P0002');
select pg_temp.expect('the form waits on its signer',
  pg_temp.val_as('itp', format('select awaiting_me::text from public.app_list_separations() where id = %s', pg_temp.id('F1'))), 'true');
select pg_temp.expect('the leaver sees it but is never awaited',
  pg_temp.val_as('worker', format('select awaiting_me::text from public.app_list_separations() where id = %s', pg_temp.id('F1'))), 'false');
select pg_temp.expect('an outsider lists nothing',
  pg_temp.val_as('other', format('select count(*)::text from public.app_list_separations() where id = %s', pg_temp.id('F1'))), '0');

-- ── signing rows ────────────────────────────────────────────────────────────
select pg_temp.expect('someone else may not sign a row',
  pg_temp.try_as('other', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F1', 'name_en = ''Warehouse'''), pg_temp.sig())), '42501');
select pg_temp.expect('signing needs consent',
  pg_temp.try_as('itp', format('select public.app_sign_separation_row(%s, %s, false, null)',
    pg_temp.row_id('F1', 'name_en = ''Warehouse'''), pg_temp.sig())), '22023');
select pg_temp.expect('the named signer signs with a remark',
  pg_temp.try_as('itp', format('select public.app_sign_separation_row(%s, %s, true, %L)',
    pg_temp.row_id('F1', 'name_en = ''Warehouse'''), pg_temp.sig(), 'returned 2 drills')), 'ok:1');
select pg_temp.expect('a row signs once',
  pg_temp.try_as('itp', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F1', 'name_en = ''Warehouse'''), pg_temp.sig())), '22023');
select pg_temp.expect('after signing, the form no longer waits on them',
  pg_temp.val_as('itp', format('select awaiting_me::text from public.app_list_separations() where id = %s', pg_temp.id('F1'))), 'false');
select pg_temp.expect('an unassigned row cannot be signed',
  pg_temp.try_as('hr', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F1', 'name_en = ''Unassigned'''), pg_temp.sig())), '22023');
select pg_temp.expect('an admin signs the HR row',
  pg_temp.try_as('adm', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F1', 'is_hr'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('finance may not sign before every row has',
  pg_temp.try_as('fin', format('select public.app_sign_separation_finance(%s, %s, true, null, null)',
    pg_temp.id('F1'), pg_temp.sig())), '22023');

-- ── editing rows ────────────────────────────────────────────────────────────
select pg_temp.expect('a signed row cannot be dropped',
  pg_temp.try_as('hr', format('select public.app_set_separation_signoffs(%s, %L)', pg_temp.id('F1'),
    json_build_array(json_build_object('id', (select id from public.separation_signoffs where separation_id = (select id from fx where k = 'F1') and name_en = 'Unit'),
                                       'name_fa', 'واحد', 'name_en', 'Unit', 'department_id', (select id from fx where k = 'zq')))::text)), '22023');
select pg_temp.expect('an employee may not edit rows',
  pg_temp.try_as('itp', format('select public.app_set_separation_signoffs(%s, %L)', pg_temp.id('F1'), '[]')), '42501');
select pg_temp.expect('hr drops the unassigned and the duplicate HR-named rows',
  pg_temp.try_as('hr', format('select public.app_set_separation_signoffs(%s, %L)', pg_temp.id('F1'),
    json_build_array(
      json_build_object('id', (select id from public.separation_signoffs where separation_id = (select id from fx where k = 'F1') and name_en = 'Warehouse'),
                        'name_fa', 'انبار', 'name_en', 'Warehouse'),
      json_build_object('id', (select id from public.separation_signoffs where separation_id = (select id from fx where k = 'F1') and name_en = 'Unit'),
                        'name_fa', 'واحد', 'name_en', 'Unit', 'department_id', (select id from fx where k = 'zq')))::text)), 'ok:1');
select pg_temp.expect('the HR row survives a row edit',
  (select count(*)::text from public.separation_signoffs where separation_id = (select id from fx where k = 'F1') and is_hr), '1');
select pg_temp.expect('still in progress while a row is unsigned',
  (select status from public.separations where id = (select id from fx where k = 'F1')), 'in_progress');
select pg_temp.expect('the department manager signs',
  pg_temp.try_as('mgr', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F1', 'name_en = ''Unit'''), pg_temp.sig())), 'ok:1');
select pg_temp.expect('last row signed → awaiting finance',
  (select status from public.separations where id = (select id from fx where k = 'F1')), 'awaiting_finance');
select pg_temp.expect('now it waits on finance',
  pg_temp.val_as('fin', format('select awaiting_me::text from public.app_list_separations() where id = %s', pg_temp.id('F1'))), 'true');

-- ── finance ─────────────────────────────────────────────────────────────────
select pg_temp.expect('hr may not sign as finance',
  pg_temp.try_as('hr', format('select public.app_sign_separation_finance(%s, %s, true, null, null)',
    pg_temp.id('F1'), pg_temp.sig())), '42501');
select pg_temp.expect('finance signs',
  pg_temp.try_as('fin', format('select public.app_sign_separation_finance(%s, %s, true, %L, %L)',
    pg_temp.id('F1'), pg_temp.sig(), 'no claims', pg_temp.today())), 'ok:1');
select pg_temp.expect('finance signature → completed with a settlement date',
  (select status || '/' || (settlement_date = pg_temp.today())::text from public.separations where id = (select id from fx where k = 'F1')), 'completed/true');
select pg_temp.expect('a future last day does not deactivate',
  (select active::text from public.profiles where id = (select id from fx where k = 'worker')), 'true');

-- A leaver who holds hr and finance signs neither box on their own form.
select pg_temp.expect('hr files for another hr holder',
  (pg_temp.file('F2', 'hr', 'hr2', pg_temp.today() + 30, '[]') ~ '^[0-9a-f-]{36}$')::text, 'true');
select pg_temp.expect('the leaver may not sign their own HR row',
  pg_temp.try_as('hr2', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F2', 'is_hr'), pg_temp.sig())), '42501');
select pg_temp.expect('hr signs the HR row (the only row)',
  pg_temp.try_as('hr', format('select public.app_sign_separation_row(%s, %s, true, null)',
    pg_temp.row_id('F2', 'is_hr'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('… → awaiting finance',
  (select status from public.separations where id = (select id from fx where k = 'F2')), 'awaiting_finance');
select pg_temp.expect('the leaver may not sign their own finance box',
  pg_temp.try_as('hr2', format('select public.app_sign_separation_finance(%s, %s, true, null, null)',
    pg_temp.id('F2'), pg_temp.sig())), '42501');

-- ── deactivation ────────────────────────────────────────────────────────────
select pg_temp.expect('warnings count the pending request',
  pg_temp.val_as('hr', format('select (public.app_separation_warnings(%s)->>%L)', pg_temp.id('w4'), 'pending_requests')), '1');
select pg_temp.expect('a last day of yesterday files and deactivates at once',
  (pg_temp.file('F4', 'hr', 'w4', pg_temp.today() - 1, '[]') ~ '^[0-9a-f-]{36}$')::text, 'true');
select pg_temp.expect('… account off, form marked applied',
  (select p.active::text || '/' || (s.deactivated_at is not null)::text
     from public.separations s join public.profiles p on p.id = s.employee_id
    where s.id = (select id from fx where k = 'F4')), 'false/true');
select pg_temp.expect('… pending request cancelled, approved one kept',
  (select string_agg(status::text, ',' order by serial_seq) from public.leave_requests
    where employee_id = (select id from fx where k = 'w4')), 'cancelled,approved');
select pg_temp.expect('an applied form cannot be cancelled',
  pg_temp.try_as('hr', format('select public.app_cancel_separation(%s)', pg_temp.id('F4'))), '22023');
select pg_temp.expect('an applied form cannot be edited',
  pg_temp.try_as('hr', format('select public.app_update_separation(%s, %L, %L, null)', pg_temp.id('F4'), 'dismissal', pg_temp.today() + 3)), '22023');

select pg_temp.expect('hr files with a last day of today',
  (pg_temp.file('F5', 'hr', 'w5', pg_temp.today(), '[]') ~ '^[0-9a-f-]{36}$')::text, 'true');
select pg_temp.expect('… which does not deactivate yet',
  (select active::text from public.profiles where id = (select id from fx where k = 'w5')), 'true');

-- The night passes: the date is now behind us and the job runs with no user.
update public.separations set last_working_day = pg_temp.today() - 1 where id = (select id from fx where k = 'F5');
select set_config('request.jwt.claims', '', true);
select pg_temp.expect('the nightly job (no user) applies the due form',
  (select (private.apply_due_separations() >= 1)::text), 'true');
select pg_temp.expect('… and the account is off',
  (select active::text from public.profiles where id = (select id from fx where k = 'w5')), 'false');
select pg_temp.expect('admin reactivates the leaver',
  pg_temp.try_as('adm', format('update public.profiles set active = true where id = %s', pg_temp.id('w5'))), 'ok:1');
select set_config('request.jwt.claims', '', true);
select private.apply_due_separations();
select pg_temp.expect('the next run leaves a reactivated person alone',
  (select active::text from public.profiles where id = (select id from fx where k = 'w5')), 'true');
select pg_temp.expect('the apply flag does not outlive the job',
  coalesce(current_setting('bj.separation_apply', true), ''), 'off');
select set_config('bj.separation_apply', 'on', true);
select pg_temp.expect('the flag admits nothing but switching off',
  pg_temp.try_as('itp', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('itp'))), '42501');
select set_config('bj.separation_apply', 'off', true);

select pg_temp.expect('hr files with a future date',
  (pg_temp.file('F6', 'hr', 'w6', pg_temp.today() + 10, '[]') ~ '^[0-9a-f-]{36}$')::text, 'true');
select pg_temp.expect('hr moves the date into the past',
  pg_temp.try_as('hr', format('select public.app_update_separation(%s, %L, %L, null)', pg_temp.id('F6'), 'dismissal', pg_temp.today() - 2)), 'ok:1');
select pg_temp.expect('… which applies at once',
  (select active::text from public.profiles where id = (select id from fx where k = 'w6')), 'false');

-- ── cancel ──────────────────────────────────────────────────────────────────
select pg_temp.expect('an employee may not cancel',
  pg_temp.try_as('itp', format('select public.app_cancel_separation(%s)', pg_temp.id('F3'))), '42501');
select pg_temp.expect('hr cancels before the date',
  pg_temp.try_as('hr', format('select public.app_cancel_separation(%s)', pg_temp.id('F3'))), 'ok:1');
select pg_temp.expect('after a cancel a new form may be filed',
  (pg_temp.file('F3b', 'hr', 'w3', pg_temp.today() + 30, '[]') ~ '^[0-9a-f-]{36}$')::text, 'true');

-- ── default rows ────────────────────────────────────────────────────────────
select pg_temp.expect('an employee may not edit default rows',
  pg_temp.try_as('itp', format('select public.app_save_separation_units(%L)', '[]')), '42501');
select pg_temp.expect('hr replaces the default rows',
  pg_temp.try_as('hr', format('select public.app_save_separation_units(%L)', json_build_array(
    json_build_object('kind', 'hr', 'name_fa', 'منابع انسانی', 'name_en', 'HR'),
    json_build_object('kind', 'department', 'name_fa', 'واحد', 'name_en', 'Unit', 'department_id', (select id from fx where k = 'zq')),
    json_build_object('kind', 'person', 'name_fa', 'آی‌تی', 'name_en', 'IT', 'signer_id', (select id from fx where k = 'itp'))
  )::text)), 'ok:1');
select pg_temp.expect('… HR row renamed, two others kept',
  (select string_agg(kind || ':' || name_en, ',' order by sort_order) from public.separation_units
    where company_id = (select id from fx where k = 'company')), 'hr:HR,department:Unit,person:IT');
select pg_temp.expect('hr saves an empty list',
  pg_temp.try_as('hr', format('select public.app_save_separation_units(%L)', '[]')), 'ok:1');
select pg_temp.expect('… the HR row survives',
  (select string_agg(kind, ',') from public.separation_units where company_id = (select id from fx where k = 'company')), 'hr');
select pg_temp.expect('a department row needs a department',
  pg_temp.try_as('hr', format('select public.app_save_separation_units(%L)',
    json_build_array(json_build_object('kind', 'department', 'name_fa', 'x', 'name_en', 'x'))::text)), '22023');

rollback;
