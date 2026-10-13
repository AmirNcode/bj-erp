-- FR-56..FR-62 scenarios (client feedback 2026-10-12, spec
-- docs/specs/2026-10-12-client-feedback-approvals-settings-design.md).
--
-- Runs in ONE transaction and rolls back, so it is safe on a database that holds
-- real data. Fixture users are created inside the transaction, which needs the
-- image superuser (`postgres` cannot write auth.users). Local stack, from the repo root:
--   ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"
--     docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q ) \
--     < tests/sql/client-feedback-2026-10-12.sql
-- Every line prints PASS or FAIL.
\set ON_ERROR_STOP on
\o /dev/null
begin;

create temp table fx (k text primary key, id uuid not null);
grant select on fx to authenticated;

-- Runs p_sql as `authenticated` with auth.uid() = p_actor. Returns 'ok:<rows>'
-- or '<sqlstate>'.
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

-- Runs a scalar query as p_actor and returns its value (or 'ERR:<sqlstate>').
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
    v_res := 'ERR:' || sqlstate;
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

create function pg_temp.expect(p_name text, p_got boolean, p_want text) returns void
language sql as $f$ select pg_temp.expect(p_name, p_got::text, p_want) $f$;

create function pg_temp.id(p_k text) returns text
language sql as $f$ select quote_literal((select id from fx where k = p_k)::text) $f$;

create function pg_temp.sig() returns text
language sql as $f$ select quote_literal('data:image/png;base64,iVBORw0KGgo' || repeat('A', 89)) $f$;

create function pg_temp.status(p_k text) returns text
language sql as $f$ select status::text from public.leave_requests where id = (select id from fx where k = p_k) $f$;

-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  v_company uuid := (select company_id from public.profiles where employee_code = 'admin');
  v_dept    uuid := (select id from public.departments where company_id = v_company order by code limit 1);
  r record;
begin
  for r in
    select * from (values
      ('mgr',   'manager',  '9990001003'),
      ('emp',   'employee', '9990001002'),
      ('hr',    'hr',       '9990001001'),
      ('adm',   'admin',    '9990001004'),
      ('sec',   'security', '9990001005'),
      ('fin',   'finance',  '9990001006'),
      ('named', 'employee', '9990001007')
    ) as t(k, role, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email) values ((select id from fx where k = r.k), r.code || '@fixture.invalid');
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id, active, personnel_no, must_change_password)
    values ((select id from fx where k = r.k), v_company, r.code, 'CF ' || r.k, v_dept,
            case when r.k = 'emp' then (select id from fx where k = 'mgr') end,
            true, r.code, false);
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), r.role::public.app_role);
    if r.role <> 'employee' then
      insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    end if;
  end loop;
  insert into fx values ('company', v_company);
  insert into fx values ('hourly_type',
    (select id from public.leave_types where company_id = v_company and active and allow_hourly order by name_en limit 1));
  insert into fx values ('daily_type',
    (select id from public.leave_types where company_id = v_company and active and affects_balance order by name_en limit 1));

  -- A known chain: direct manager (1), hr (2), both kinds. The department
  -- step would skip anyway (the department has no manager in the fixture).
  delete from public.approval_steps where company_id = v_company;
  insert into public.approval_steps (company_id, role, step_order, applies_to)
  values (v_company, 'manager', 1, '{leave,errand}'), (v_company, 'hr', 2, '{leave,errand}');
  update public.work_settings set approval_order_enforced = false, max_hourly_minutes_per_day = 240,
         work_start = '07:00', work_end = '15:00'
   where company_id = v_company;
end $$;

-- ── FR-57: one hourly leave per day, cap ≤ 4h ───────────────────────────────
insert into fx values ('h1', (pg_temp.val_as('emp', format(
  'select public.submit_hourly_leave_request(%s, %L, %L, %L, %s, true)',
  pg_temp.id('hourly_type'), '2026-11-02', '08:00', '09:00', pg_temp.sig())))::uuid);
select pg_temp.expect('first hourly leave of the day is accepted',
  pg_temp.status('h1'), 'pending');
select pg_temp.expect('second hourly leave on the same day is refused',
  pg_temp.val_as('emp', format(
    'select public.submit_hourly_leave_request(%s, %L, %L, %L, %s, true)',
    pg_temp.id('hourly_type'), '2026-11-02', '11:00', '12:00', pg_temp.sig())), 'ERR:22023');
select pg_temp.expect('hourly leave over 4h is refused',
  pg_temp.val_as('emp', format(
    'select public.submit_hourly_leave_request(%s, %L, %L, %L, %s, true)',
    pg_temp.id('hourly_type'), '2026-11-03', '08:00', '12:30', pg_temp.sig())), 'ERR:22023');
select pg_temp.expect('an hourly errand on that day is still allowed',
  left(pg_temp.val_as('emp', format(
    'select public.submit_errand_request(%L, %L, %L, %L, %s, true)',
    '2026-11-02', '12:00', '13:00', 'Bandar', pg_temp.sig())), 4) <> 'ERR:', 'true');
-- Cancelling frees the day.
select pg_temp.expect('employee cancels the hourly leave',
  pg_temp.try_as('emp', format('select public.cancel_leave_request(%s)', pg_temp.id('h1'))), 'ok:1');
select pg_temp.expect('after cancelling, a new hourly leave that day is accepted',
  left(pg_temp.val_as('emp', format(
    'select public.submit_hourly_leave_request(%s, %L, %L, %L, %s, true)',
    pg_temp.id('hourly_type'), '2026-11-02', '09:00', '10:00', pg_temp.sig())), 4) <> 'ERR:', 'true');
select pg_temp.expect('hourly cap cannot be set above 4h',
  pg_temp.try_as('adm', format('update public.work_settings set max_hourly_minutes_per_day = 300 where company_id = %s', pg_temp.id('company'))), '23514');

-- ── FR-61: per diem on HR's step of an errand ───────────────────────────────
insert into fx values ('e1', (pg_temp.val_as('emp', format(
  'select public.submit_daily_errand_request(%L, %L, %L, %s, true)',
  '2026-11-09', '2026-11-10', 'Tehran', pg_temp.sig())))::uuid);
select pg_temp.expect('manager may not set a per diem',
  pg_temp.try_as('mgr', format('select public.approve_leave_request(%s, %s, true, false, 500000)', pg_temp.id('e1'), pg_temp.sig())), '22023');
select pg_temp.expect('manager signs the errand',
  pg_temp.try_as('mgr', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('e1'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('negative per diem is refused',
  pg_temp.try_as('hr', format('select public.approve_leave_request(%s, %s, true, false, -1)', pg_temp.id('e1'), pg_temp.sig())), '22023');
select pg_temp.expect('hr signs the errand with a per diem',
  pg_temp.try_as('hr', format('select public.approve_leave_request(%s, %s, true, false, 1500000)', pg_temp.id('e1'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('errand is approved', pg_temp.status('e1'), 'approved');
select pg_temp.expect('per diem stored',
  (select per_diem_rials::text from public.leave_requests where id = (select id from fx where k = 'e1')), '1500000');

insert into fx values ('l1', (pg_temp.val_as('emp', format(
  'select public.submit_leave_request(%s, %L, %L, %L, %s, true)',
  pg_temp.id('daily_type'), '2026-11-16', '2026-11-16', 'full', pg_temp.sig())))::uuid);
select pg_temp.expect('hr may not set a per diem on leave',
  pg_temp.try_as('hr', format('select public.approve_leave_request(%s, %s, true, false, 1000)', pg_temp.id('l1'), pg_temp.sig())), '22023');

-- ── FR-58: admin is not a step; admin override ──────────────────────────────
select pg_temp.expect('admin with no step of their own overrides the whole chain',
  pg_temp.try_as('adm', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('l1'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('overridden leave is approved', pg_temp.status('l1'), 'approved');
select pg_temp.expect('override wrote one signed row per step',
  (select count(*)::text from public.leave_request_approvals
    where request_id = (select id from fx where k = 'l1') and signature_data is not null), '2');

-- An admin who also holds hr signs only the hr step unless they ask to override.
insert into public.user_roles (user_id, role) values ((select id from fx where k = 'adm'), 'hr');
insert into fx values ('l2', (pg_temp.val_as('emp', format(
  'select public.submit_leave_request(%s, %L, %L, %L, %s, true)',
  pg_temp.id('daily_type'), '2026-11-23', '2026-11-23', 'full', pg_temp.sig())))::uuid);
select pg_temp.expect('admin+hr signs their natural hr step',
  pg_temp.try_as('adm', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('l2'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('request still waits for the manager', pg_temp.status('l2'), 'pending');
select pg_temp.expect('admin then overrides the rest',
  pg_temp.try_as('adm', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('l2'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('request is approved after the override', pg_temp.status('l2'), 'approved');

-- Override with p_override from the start, and past a named-person step.
insert into public.approval_steps (company_id, role, step_order, applies_to, approver_id)
values ((select id from fx where k = 'company'), 'employee', 3, '{leave,errand}', (select id from fx where k = 'named'));
insert into fx values ('l3', (pg_temp.val_as('emp', format(
  'select public.submit_leave_request(%s, %L, %L, %L, %s, true)',
  pg_temp.id('daily_type'), '2026-11-30', '2026-11-30', 'full', pg_temp.sig())))::uuid);
select pg_temp.expect('explicit override fills a named step too',
  pg_temp.try_as('adm', format('select public.approve_leave_request(%s, %s, true, true)', pg_temp.id('l3'), pg_temp.sig())), 'ok:1');
select pg_temp.expect('explicitly overridden request is approved', pg_temp.status('l3'), 'approved');

insert into fx values ('l4', (pg_temp.val_as('emp', format(
  'select public.submit_leave_request(%s, %L, %L, %L, %s, true)',
  pg_temp.id('daily_type'), '2026-12-07', '2026-12-07', 'full', pg_temp.sig())))::uuid);
select pg_temp.expect('manager and hr sign, named step outstanding',
  pg_temp.try_as('mgr', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('l4'), pg_temp.sig()))
  || pg_temp.try_as('hr', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('l4'), pg_temp.sig())), 'ok:1ok:1');
select pg_temp.expect('admin may reject past a named step',
  pg_temp.try_as('adm', format('select public.reject_leave_request(%s)', pg_temp.id('l4'))), 'ok:1');

-- ── FR-56: security / admin steps retired ───────────────────────────────────
select pg_temp.expect('an active security step is refused',
  pg_temp.try_as('adm', format('insert into public.approval_steps (company_id, role, step_order) values (%s, %L, 4)', pg_temp.id('company'), 'security')), '23514');
select pg_temp.expect('an active admin step is refused',
  pg_temp.try_as('adm', format('insert into public.approval_steps (company_id, role, step_order) values (%s, %L, 4)', pg_temp.id('company'), 'admin')), '23514');
insert into fx values ('l5', (pg_temp.val_as('emp', format(
  'select public.submit_leave_request(%s, %L, %L, %L, %s, true)',
  pg_temp.id('daily_type'), '2026-12-14', '2026-12-14', 'full', pg_temp.sig())))::uuid);
select pg_temp.expect('p_override is ignored for a non-admin (hr signs only its step)',
  pg_temp.try_as('hr', format('select public.approve_leave_request(%s, %s, true, true)', pg_temp.id('l5'), pg_temp.sig()))
  || pg_temp.status('l5'), 'ok:1pending');
select pg_temp.expect('security may not approve',
  pg_temp.try_as('sec', format('select public.approve_leave_request(%s, %s, true)', pg_temp.id('l5'), pg_temp.sig())), '42501');
select pg_temp.expect('security reads approved requests company-wide',
  (pg_temp.val_as('sec', 'select count(*) from public.leave_requests where status = ''approved''')::int >= 3)::text, 'true');

-- ── FR-59: hr edits work settings and holidays ──────────────────────────────
select pg_temp.expect('hr changes working hours',
  pg_temp.try_as('hr', format('update public.work_settings set work_start = %L where company_id = %s', '07:30', pg_temp.id('company'))), 'ok:1');
select pg_temp.expect('hr changes weekly days off',
  pg_temp.try_as('hr', format('update public.work_settings set weekend_days = %L where company_id = %s', '{4,5}', pg_temp.id('company'))), 'ok:1');
select pg_temp.expect('hr may not change approval order',
  pg_temp.try_as('hr', format('update public.work_settings set approval_order_enforced = true where company_id = %s', pg_temp.id('company'))), '42501');
select pg_temp.expect('hr may not change hours per day',
  pg_temp.try_as('hr', format('update public.work_settings set hours_per_day = 9 where company_id = %s', pg_temp.id('company'))), '42501');
select pg_temp.expect('admin still changes approval order',
  pg_temp.try_as('adm', format('update public.work_settings set approval_order_enforced = false where company_id = %s', pg_temp.id('company'))), 'ok:1');
select pg_temp.expect('hr adds a holiday',
  pg_temp.try_as('hr', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2026-12-21', 'تست')), 'ok:1');
select pg_temp.expect('hr deletes a holiday',
  pg_temp.try_as('hr', format('delete from public.holidays where company_id = %s and holiday_date = %L', pg_temp.id('company'), '2026-12-21')), 'ok:1');
select pg_temp.expect('employee may not add a holiday',
  pg_temp.try_as('emp', format('insert into public.holidays (company_id, holiday_date, name_fa) values (%s, %L, %L)', pg_temp.id('company'), '2026-12-22', 'x')), '42501');
select pg_temp.expect('employee may not change working hours',
  pg_temp.try_as('emp', format('update public.work_settings set work_start = %L where company_id = %s', '06:00', pg_temp.id('company'))), 'ok:0');

-- ── FR-62: finance reads completed approvals ────────────────────────────────
select pg_temp.expect('finance lists approved requests (approved only)',
  pg_temp.val_as('fin', $q$select count(*) filter (where per_diem_rials = 1500000)::text || '/' || count(*) filter (where kind = 'errand')::text
                            from public.finance_approved_requests('2026-11-01', '2026-12-31') f
                           where f.employee_name = 'CF emp'$q$), '1/1');
select pg_temp.expect('finance list excludes pending and rejected',
  pg_temp.val_as('fin', $q$select count(*)::text from public.finance_approved_requests('2026-11-01', '2026-12-31') f
                           where f.employee_name = 'CF emp' and f.kind = 'leave'$q$), '3');
select pg_temp.expect('admin may read the finance list',
  left(pg_temp.val_as('adm', $q$select count(*)::text from public.finance_approved_requests('2026-11-01', '2026-12-31')$q$), 4) <> 'ERR:', 'true');
select pg_temp.expect('hr may not read the finance list',
  pg_temp.val_as('hr', $q$select count(*)::text from public.finance_approved_requests('2026-11-01', '2026-12-31')$q$), 'ERR:42501');
select pg_temp.expect('employee may not read the finance list',
  pg_temp.val_as('emp', $q$select count(*)::text from public.finance_approved_requests('2026-11-01', '2026-12-31')$q$), 'ERR:42501');

-- ── FR-60: no carryover forfeit ─────────────────────────────────────────────
select pg_temp.expect('accrue_leave no longer forfeits carryover',
  (select (prosrc not like '%carryover_forfeit%')::text from pg_proc where proname = 'accrue_leave'), 'true');

-- Behaviour, not just source: a fresh employee accruing 1 day a month since
-- Esfand 1403 crosses Farvardin 1404 AND Farvardin 1405 with a carryover cap of
-- only 1 day. Before FR-60 both Nowruz boundaries clamped the balance to 1 day;
-- now every accrued minute survives.
insert into fx values ('carrier', gen_random_uuid());
insert into auth.users (id, email) values ((select id from fx where k = 'carrier'), '9990001008@fixture.invalid');
insert into public.profiles (id, company_id, employee_code, full_name, active, personnel_no, must_change_password, hire_date)
values ((select id from fx where k = 'carrier'), (select id from fx where k = 'company'), '9990001008', 'CF carrier', true, '9990001008', false, '2025-01-01');
insert into public.employee_leave_policies (employee_id, leave_type_id, accrual_minutes_per_month, annual_cap_minutes, carryover_cap_minutes, accrual_start_month)
values ((select id from fx where k = 'carrier'), (select id from fx where k = 'daily_type'), 480, null, 480, '2025-02-19');
select public.accrue_leave((select id from fx where k = 'carrier'), (select id from fx where k = 'daily_type'));
select pg_temp.expect('two Nowruz boundaries crossed, nothing forfeited',
  (select count(*)::text from public.leave_ledger
    where employee_id = (select id from fx where k = 'carrier') and entry_type = 'carryover_forfeit'), '0');
select pg_temp.expect('balance = every month accrued (Esfand 1403 .. this month), cap ignored',
  (select (public.current_leave_balance((select id from fx where k = 'carrier'), (select id from fx where k = 'daily_type'))
           = 480 * (select count(*) from public.jalali_months
                     where gregorian_start >= '2025-02-19'
                       and gregorian_start <= (now() at time zone 'Asia/Tehran')::date))::text), 'true');

rollback;
