-- Built-in test roles (FR-95, owner 2026-11-18): a test-emp holder sees the Employee screens with
-- their own data only — org chart = own chain + self + direct reports, no teammates, nobody in the
-- replacement picker — and cannot send a request of any kind, whatever other role they hold.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table te_fx(k text primary key,id uuid not null);
grant select on te_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from te_fx where k=p_key;
$$;
create function pg_temp.login(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
end; $$;
create function pg_temp.as_scalar(p_key text,p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  begin execute p_sql into v_result;
  exception when others then v_result:='ERROR '||sqlstate||' '||sqlerrm; end;
  execute 'reset role'; return v_result;
end; $$;
create function pg_temp.expect(p_label text,p_actual text,p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %',p_label,p_expected,p_actual; end if;
  raise notice 'PASS %',p_label;
end; $$;
create function pg_temp.sig() returns text language sql immutable as $$
  select 'data:image/png;base64,iVBORw0KGgo'||repeat('A',89);
$$;
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;
create function pg_temp.leave(p_actor text,p_day int) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)::text',
    pg_temp.fx('annual'),current_date+p_day,current_date+p_day,pg_temp.sig())));
$$;
create function pg_temp.hourly(p_actor text,p_day int) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_hourly_leave_request_v2(%L,%L,''08:00'',''09:00'',%L,true)::text',
    pg_temp.fx('annual'),current_date+p_day,pg_temp.sig())));
$$;
create function pg_temp.errand(p_actor text,p_day int) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Fixture site'',%L,true)::text',
    current_date+p_day,current_date+p_day,pg_temp.sig())));
$$;
-- Runs p_sql as the superuser (triggers still fire): 'ok' or the SQLSTATE.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end;
$$;
create function pg_temp.leave_with(p_actor text,p_day int,p_repl text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true,null,%L)::text',
    pg_temp.fx('annual'),current_date+p_day,current_date+p_day,pg_temp.sig(),pg_temp.fx(p_repl))));
$$;
-- Sorted fixture keys of the profile ids a query returns, as the caller.
create function pg_temp.keys(p_actor text,p_sql text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select coalesce(string_agg(f.k,'','' order by f.k),'''') from (%s) q(id) join te_fx f on f.id=q.id',p_sql));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_b uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Test-emp synthetic fixture');
  insert into te_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','TEA'),(v_b,v_company,'ب','Fixture B','office','TEB');
  for who in select * from (values
    ('admin',array['admin'],'9990095001',null),('boss',array['manager','employee'],'9990095002','a'),
    ('emp',array['employee'],'9990095003','a'),('tester',array['test-emp'],'9990095004','a'),
    ('both',array['test-emp','employee'],'9990095005','a'),('report',array['employee'],'9990095006','b'),
    ('outsider',array['employee'],'9990095007','b')) t(k,roles,code,dept) loop
    insert into te_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@test-emp-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,case who.dept when 'a' then v_a when 'b' then v_b end,
             who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss')
   where id in (pg_temp.fx('emp'),pg_temp.fx('tester'),pg_temp.fx('both'));
  update public.profiles set manager_id=pg_temp.fx('tester') where id=pg_temp.fx('report');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into te_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to) values(v_company,'manager',1,'{leave,errand}');
end; $$;

-- The role row.
select pg_temp.expect('new company: test-emp seeded as a fixed built-in role',
  (select kind||'/'||name from public.roles where company_id=pg_temp.fx('company') and system_key='test-emp'),
  'system/test-emp');
select pg_temp.expect('every company has the test-emp role',
  (select count(*)::text from public.companies c
    where not exists (select 1 from public.roles r where r.company_id=c.id and r.system_key='test-emp')),'0');
select pg_temp.expect('built-in: its permissions cannot be edited',
  pg_temp.err(pg_temp.as_scalar('admin',format('select public.app_save_role(%L,%L,''{}''::jsonb)::text',
    (select id from public.roles where company_id=pg_temp.fx('company') and system_key='test-emp'),'test-emp'))),'22023');
select pg_temp.expect('helper: tester yes, both yes, emp no',
  private.is_test_account(pg_temp.fx('tester'))::text||private.is_test_account(pg_temp.fx('both'))::text
  ||private.is_test_account(pg_temp.fx('emp'))::text,'truetruefalse');

-- Requests: refused for test-emp, even with Employee too.
select pg_temp.expect('test-emp: daily leave refused',pg_temp.leave('tester',10),'42501');
select pg_temp.expect('test-emp: hourly leave refused',pg_temp.hourly('tester',11),'42501');
select pg_temp.expect('test-emp: daily errand refused',pg_temp.errand('tester',12),'42501');
select pg_temp.expect('test-emp + employee: still refused',pg_temp.leave('both',10),'42501');
select pg_temp.expect('… with the FR-95 message',
  pg_temp.as_scalar('tester',format('select public.submit_daily_errand_request_v2(%L,%L,''x'',%L,true)::text',
    current_date+13,current_date+13,pg_temp.sig())),'ERROR 42501 test accounts cannot send requests');
select pg_temp.expect('a direct insert is refused too (trigger)',
  pg_temp.err(pg_temp.as_scalar('admin',format($q$insert into public.leave_requests(employee_id,company_id,kind,errand_location,
    start_date,end_date,requested_minutes,status,serial_year,serial_seq)
    values(%L,%L,'errand','x',current_date+14,current_date+14,480,'pending',1,995001) returning 'x'$q$,
    pg_temp.fx('tester'),pg_temp.fx('company')))),'42501');
select pg_temp.expect('plain employee unaffected',pg_temp.leave('emp',10),'ok');

-- Org chart.
select pg_temp.expect('org chart: test-emp sees chain + self + reports only',
  pg_temp.keys('tester','select profile_id from public.get_org_chart()'),'boss,report,tester');
select pg_temp.expect('org chart: an employee still sees everyone',
  pg_temp.keys('emp','select profile_id from public.get_org_chart()'),'admin,boss,both,emp,outsider,report,tester');

-- No teammates.
select pg_temp.expect('calendar: test-emp does not see a teammate''s leave',
  pg_temp.as_scalar('tester',format('select count(*)::text from public.team_leave_calendar where employee_id=%L',pg_temp.fx('emp'))),'0');
select pg_temp.expect('calendar: the teammate employee still sees it',
  pg_temp.as_scalar('boss',format('select count(*)::text from public.team_leave_calendar where employee_id=%L',pg_temp.fx('emp'))),'1');
select pg_temp.expect('profiles: test-emp reads self and own reports, not teammates',
  pg_temp.keys('tester','select id from public.profiles'),'report,tester');
select pg_temp.expect('team page: test-emp sees only their manager',
  pg_temp.keys('tester','select profile_id from public.get_my_team_directory()'),'boss');
select pg_temp.expect('team page: an employee is unaffected',
  pg_temp.keys('emp','select profile_id from public.get_my_team_directory()'),'boss,both,tester');

-- Replacement picker.
select pg_temp.expect('replacement picker: empty for test-emp',
  pg_temp.as_scalar('tester',format('select count(*)::text from public.get_replacement_candidates(%L,%L)',current_date+20,current_date+20)),'0');
select pg_temp.expect('replacement picker: never offers a test account',
  pg_temp.keys('emp',format('select profile_id from public.get_replacement_candidates(%L,%L)',current_date+20,current_date+20)),'boss');

-- Replacement write paths (security review): a test account can never be named, however called.
select pg_temp.expect('submit: naming a test account as replacement is refused',
  pg_temp.err(pg_temp.as_scalar('emp',format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true,null,%L)::text',
    pg_temp.fx('annual'),current_date+30,current_date+30,pg_temp.sig(),pg_temp.fx('tester')))),'42501');
select pg_temp.expect('direct insert with a test-account replacement is refused (trigger)',
  pg_temp.err(pg_temp.as_scalar('admin',format($q$insert into public.leave_requests(employee_id,company_id,kind,leave_type_id,
    start_date,end_date,requested_minutes,status,serial_year,serial_seq,replacement_id)
    values(%L,%L,'leave',%L,current_date+31,current_date+31,480,'pending',1,995002,%L) returning 'x'$q$,
    pg_temp.fx('emp'),pg_temp.fx('company'),pg_temp.fx('annual'),pg_temp.fx('both')))),'42501');
select pg_temp.expect('… with its own message',
  split_part(pg_temp.as_scalar('admin',format($q$insert into public.leave_requests(employee_id,company_id,kind,leave_type_id,
    start_date,end_date,requested_minutes,status,serial_year,serial_seq,replacement_id)
    values(%L,%L,'leave',%L,current_date+32,current_date+32,480,'pending',1,995003,%L) returning 'x'$q$,
    pg_temp.fx('emp'),pg_temp.fx('company'),pg_temp.fx('annual'),pg_temp.fx('tester'))),' ',3),'a');
select pg_temp.expect('changing the replacement to a test account is refused',
  pg_temp.try(format('update public.leave_requests set replacement_id=%L where employee_id=%L',
    pg_temp.fx('tester'),pg_temp.fx('emp'))),'42501');
select pg_temp.expect('a direct sign-off row for a test account is refused',
  pg_temp.try(format($q$insert into public.leave_request_replacement_signoffs(request_id,replacement_id)
    select id,%L from public.leave_requests where employee_id=%L limit 1$q$,
    pg_temp.fx('tester'),pg_temp.fx('emp'))),'42501');
select pg_temp.expect('a real colleague can still be named',
  pg_temp.leave_with('emp',33,'boss'),'ok');

\o
select 'test-emp: all assertions passed' as result;
rollback;
