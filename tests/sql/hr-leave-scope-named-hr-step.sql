-- HR leave scope without D4, and a named HR step taking the per diem (2026-11-11).
-- Migration 20261111120000_hr_leave_scope_and_named_hr_step.sql.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table hs_fx(k text primary key,id uuid not null);
grant select on hs_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from hs_fx where k=p_key;
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
-- 'ok' or the SQLSTATE of an ERROR result.
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;
create function pg_temp.msg(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then substr(p_result,length(split_part(p_result,' ',2))+8) else 'ok' end;
$$;
-- The five leave-administration RPCs, each as p_actor on p_target; returns the five outcomes.
create function pg_temp.leave_ops(p_actor text,p_target text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.set_leave_balance(%L,%L,480)::text',
           pg_temp.fx(p_target),pg_temp.fx('annual'))))
   ||' '||pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.app_add_leave_balance(%L,%L,60,''fixture'')::text',
           pg_temp.fx(p_target),pg_temp.fx('annual'))))
   ||' '||pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.allocate_leave(%L,%L,%L,%L,480)::text',
           pg_temp.fx(p_target),pg_temp.fx('annual'),current_date,current_date+30)))
   ||' '||pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.set_employee_leave_policy(%L,%L,120,null,0,%L)::text',
           pg_temp.fx(p_target),pg_temp.fx('annual'),
           (select max(gregorian_start) from public.jalali_months where gregorian_start<=current_date))))
   ||' '||pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.app_grant_special_leave(%L,''bereavement'',''fixture note'')::text',
           pg_temp.fx(p_target))));
$$;
create function pg_temp.daily(p_actor text,p_start date,p_end date) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Shiraz'',%L,true,''Site visit'',false,null,false,null)',
    p_start,p_end,pg_temp.sig()));
$$;
create function pg_temp.progress(p_actor text,p_req text,p_step text,p_key text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select (select item->>%L from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''step_id''=%L)',
    p_key,pg_temp.fx(p_req),pg_temp.fx(p_step)::text));
$$;
create function pg_temp.approve(p_actor text,p_req text,p_step text,p_per_diem text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_steps(%L,array[%L]::uuid[],%L,true,%s)::text',
    pg_temp.fx(p_req),pg_temp.fx(p_step),pg_temp.sig(),coalesce(p_per_diem,'null')));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'HR leave scope synthetic fixture');
  insert into hs_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','HS');
  for who in select * from (values
    ('admin','admin','9990091001'),('hr','hr','9990091002'),('hr_t','hr','9990091003'),
    ('proc','procurement','9990091004'),('plain','employee','9990091005'),('mgr','manager','9990091006'),
    ('emp','employee','9990091007'),('named_hr','hr','9990091008'),('named_no','employee','9990091009'),
    ('role_hr','hr','9990091010')) t(k,role,code) loop
    insert into hs_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@hs-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role_id)
      select pg_temp.fx(who.k),r.id from public.roles r where r.company_id=v_company and r.system_key=who.role::public.app_role;
    if who.role<>'employee' then
      insert into public.user_roles(user_id,role_id)
        select pg_temp.fx(who.k),r.id from public.roles r where r.company_id=v_company and r.system_key='employee'; end if;
  end loop;
  -- A person from another company, to see that the company boundary still holds.
  v_id:=gen_random_uuid();
  insert into public.companies(id,name) values(v_id,'HR leave scope other company');
  insert into hs_fx values('other_company',v_id);
  insert into hs_fx values('outsider',gen_random_uuid());
  insert into auth.users(id,email) values(pg_temp.fx('outsider'),'9990091099@hs-fixture.invalid');
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(gen_random_uuid(),v_id,'آزمایش','Other HQ','office','HO');
  insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
    values(pg_temp.fx('outsider'),v_id,(select id from public.departments where company_id=v_id),'9990091099','9990091099','Fixture outsider',false);
  insert into public.user_roles(user_id,role_id)
    select pg_temp.fx('outsider'),r.id from public.roles r where r.company_id=v_id and r.system_key='employee';

  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('mgr')
    where id in (select id from hs_fx where k in ('emp','plain','proc','hr_t'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,allow_hourly)
    values(v_company,'سالانه','Annual Leave',true,true,true) returning id into v_id;
  insert into hs_fx values('annual',v_id);
  -- Errand-only chain steps. Each person may sit on one step; activate one at a time.
  insert into public.approval_steps(company_id,role,approver_id,step_order,applies_to,active)
    values(v_company,'employee',pg_temp.fx('named_hr'),1,'{errand}',false) returning id into v_id;
  insert into hs_fx values('step_named_hr',v_id);
  insert into public.approval_steps(company_id,role,approver_id,step_order,applies_to,active)
    values(v_company,'employee',pg_temp.fx('named_no'),1,'{errand}',false) returning id into v_id;
  insert into hs_fx values('step_named_no',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to,active)
    values(v_company,'hr',1,'{errand}',false) returning id into v_id;
  insert into hs_fx values('step_role_hr',v_id);
end; $$;

-- ============================================================ (a) leave scope
select pg_temp.expect('can_manage_leave_of: hr on procurement, hr, plain yes; self, admin, outsider no',
  (select string_agg(private.can_manage_leave_of(pg_temp.fx('hr'),pg_temp.fx(t))::text,',' order by o)
     from unnest(array['proc','hr_t','plain','hr','admin','outsider']) with ordinality as v(t,o)),
  'true,true,true,false,false,false');
select pg_temp.expect('hr: balance, add, allocate, policy and special leave all work on a procurement holder',
  pg_temp.leave_ops('hr','proc'),'ok ok ok ok ok');
select pg_temp.expect('hr: the same on another hr holder',
  pg_temp.leave_ops('hr','hr_t'),'ok ok ok ok ok');
select pg_temp.expect('hr: and on a plain employee (parity)',
  pg_temp.leave_ops('hr','plain'),'ok ok ok ok ok');
select pg_temp.expect('hr: refused on themselves, every operation',
  pg_temp.leave_ops('hr','hr'),'42501 42501 42501 42501 42501');
select pg_temp.expect('hr: refused on the admin, every operation',
  pg_temp.leave_ops('hr','admin'),'42501 42501 42501 42501 42501');
select pg_temp.expect('hr: refused on another company''s employee',
  pg_temp.err(pg_temp.as_scalar('hr',format('select public.set_leave_balance(%L,%L,480)::text',
    pg_temp.fx('outsider'),pg_temp.fx('annual')))),'42501');
select pg_temp.expect('a caller without leave_balances edit is still refused (plain employee, manager)',
  pg_temp.leave_ops('plain','emp')||' | '||pg_temp.leave_ops('mgr','emp'),
  '42501 42501 42501 42501 42501 | 42501 42501 42501 42501 42501');
select pg_temp.expect('the writes landed on the procurement holder: ledger rows, a policy and a grant; none on the admin or hr itself',
  (select count(*)>0 from public.leave_ledger where employee_id=pg_temp.fx('proc'))::text||' '
  ||(select count(*) from public.employee_leave_policies where employee_id=pg_temp.fx('proc'))::text||' '
  ||(select count(*) from public.special_leave_grants where employee_id=pg_temp.fx('proc'))::text||' '
  ||(select count(*) from public.leave_ledger where employee_id in (pg_temp.fx('admin'),pg_temp.fx('hr')))::text,
  'true 1 1 0');
select pg_temp.expect('revoking a special leave grant works on an hr holder too',
  pg_temp.err(pg_temp.as_scalar('hr',format('select public.app_revoke_special_leave(%L)::text',
    (select id from public.special_leave_grants where employee_id=pg_temp.fx('hr_t'))))),'ok');

-- ============================================================ (b) named HR step
do $$ begin
  perform pg_temp.login('admin');
  update public.approval_steps set active=true where id=pg_temp.fx('step_named_hr');
end $$;
select pg_temp.expect('is_hr_step: named step with an hr holder yes; role hr yes; named step without hr no; unknown no',
  private.is_hr_step(pg_temp.fx('step_named_hr'))::text||','||private.is_hr_step(pg_temp.fx('step_role_hr'))::text||','
  ||private.is_hr_step(pg_temp.fx('step_named_no'))::text||','||private.is_hr_step(gen_random_uuid())::text,
  'true,true,false,false');

insert into hs_fx values('trip1',(pg_temp.daily('emp',current_date+10,current_date+12))::uuid);
select pg_temp.expect('named hr step: per_diem_allowed and hr_step for the hr holder on a daily errand',
  pg_temp.progress('named_hr','trip1','step_named_hr','per_diem_allowed')||','||pg_temp.progress('named_hr','trip1','step_named_hr','hr_step'),
  'true,true');
select pg_temp.expect('named hr step: the step is the caller''s (is_mine, can_approve)',
  pg_temp.progress('named_hr','trip1','step_named_hr','is_mine')||','||pg_temp.progress('named_hr','trip1','step_named_hr','can_approve'),
  'true,true');
select pg_temp.expect('named hr step: someone else sees hr_step but no per_diem_allowed',
  pg_temp.progress('admin','trip1','step_named_hr','hr_step')||','||pg_temp.progress('mgr','trip1','step_named_hr','per_diem_allowed'),
  'true,false');
create temp table hs_res(k text primary key,v text);
insert into hs_res values('trip1',pg_temp.err(pg_temp.approve('named_hr','trip1','step_named_hr','4500000')));
select pg_temp.expect('named hr step: approving with a per diem succeeds and stores it',
  (select v from hs_res where k='trip1')||' '
  ||(select status::text||' '||coalesce(per_diem_rials::text,'null') from public.leave_requests where id=pg_temp.fx('trip1')),
  'ok approved 4500000');

-- An hourly errand never takes a per diem, even on the named hr step.
insert into hs_fx values('hourly1',pg_temp.as_scalar('emp',format(
  'select public.submit_errand_request_v2(%L,''08:00'',''09:00'',''Fixture location'',%L,true)',current_date+14,pg_temp.sig()))::uuid);
select pg_temp.expect('named hr step: no per_diem_allowed on an hourly errand, but hr_step still true',
  pg_temp.progress('named_hr','hourly1','step_named_hr','per_diem_allowed')||','||pg_temp.progress('named_hr','hourly1','step_named_hr','hr_step'),
  'false,true');
insert into hs_res values('hourly1',pg_temp.err(pg_temp.approve('named_hr','hourly1','step_named_hr','100000')));
select pg_temp.expect('named hr step: a per diem on an hourly errand is refused (22023) and nothing is stored',
  (select v from hs_res where k='hourly1')||' '||(select status::text||' '||coalesce(per_diem_rials::text,'null')
    from public.leave_requests where id=pg_temp.fx('hourly1')),
  '22023 pending null');

-- A named step whose person does not hold hr.
do $$ begin
  perform pg_temp.login('admin');
  update public.approval_steps set active=false where id=pg_temp.fx('step_named_hr');
  update public.approval_steps set active=true where id=pg_temp.fx('step_named_no');
end $$;
insert into hs_fx values('trip2',(pg_temp.daily('emp',current_date+20,current_date+22))::uuid);
select pg_temp.expect('named non-hr step: per_diem_allowed and hr_step are false',
  pg_temp.progress('named_no','trip2','step_named_no','per_diem_allowed')||','||pg_temp.progress('named_no','trip2','step_named_no','hr_step'),
  'false,false');
select pg_temp.expect('named non-hr step: a per diem is refused',
  pg_temp.msg(pg_temp.approve('named_no','trip2','step_named_no','4500000')),
  'per diem can only be set on the hr step of an errand');
select pg_temp.expect('named non-hr step: the refusal changed nothing',
  (select status::text||' '||coalesce(per_diem_rials::text,'null') from public.leave_requests where id=pg_temp.fx('trip2')),
  'pending null');
insert into hs_res values('trip2',pg_temp.err(pg_temp.approve('named_no','trip2','step_named_no',null)));
select pg_temp.expect('named non-hr step: approving without a per diem works',
  (select v from hs_res where k='trip2')||' '
  ||(select status::text||' '||coalesce(per_diem_rials::text,'null') from public.leave_requests where id=pg_temp.fx('trip2')),
  'ok approved null');

-- A role 'hr' step behaves as before.
do $$ begin
  perform pg_temp.login('admin');
  update public.approval_steps set active=false where id=pg_temp.fx('step_named_no');
  update public.approval_steps set active=true where id=pg_temp.fx('step_role_hr');
end $$;
insert into hs_fx values('trip3',(pg_temp.daily('emp',current_date+30,current_date+31))::uuid);
select pg_temp.expect('role hr step: per_diem_allowed and hr_step for an hr holder',
  pg_temp.progress('role_hr','trip3','step_role_hr','per_diem_allowed')||','||pg_temp.progress('role_hr','trip3','step_role_hr','hr_step'),'true,true');
insert into hs_res values('trip3',pg_temp.err(pg_temp.approve('role_hr','trip3','step_role_hr','2000000')));
select pg_temp.expect('role hr step: the per diem is stored on approval',
  (select v from hs_res where k='trip3')||' '||(select status::text||' '||per_diem_rials from public.leave_requests where id=pg_temp.fx('trip3')),
  'ok approved 2000000');

-- ============================================================ (c) one per diem step per request
-- A named HR step (order 1) and a role 'hr' step (order 2) in one chain: only the first takes
-- the per diem and the travel box; the second can no longer overwrite it (20261111150000).
do $$ begin
  perform pg_temp.login('admin');
  update public.approval_steps set step_order=2 where id=pg_temp.fx('step_role_hr');
  update public.approval_steps set active=true where id=pg_temp.fx('step_named_hr');
end $$;
insert into hs_fx values('trip4',(pg_temp.daily('emp',current_date+40,current_date+42))::uuid);
select pg_temp.expect('two HR steps: request_per_diem_step is the first one',
  (private.request_per_diem_step(pg_temp.fx('trip4'))=pg_temp.fx('step_named_hr'))::text,'true');
select pg_temp.expect('two HR steps: the first has per_diem_allowed and hr_step, the second neither',
  pg_temp.progress('named_hr','trip4','step_named_hr','per_diem_allowed')||','||pg_temp.progress('named_hr','trip4','step_named_hr','hr_step')
  ||','||pg_temp.progress('role_hr','trip4','step_role_hr','per_diem_allowed')||','||pg_temp.progress('role_hr','trip4','step_role_hr','hr_step'),
  'true,true,false,false');
insert into hs_res values('trip4a',pg_temp.err(pg_temp.approve('named_hr','trip4','step_named_hr','4500000')));
select pg_temp.expect('two HR steps: once signed, the first stays the per diem step',
  (private.request_per_diem_step(pg_temp.fx('trip4'))=pg_temp.fx('step_named_hr'))::text,'true');
select pg_temp.expect('two HR steps: a per diem on the second HR step is refused and the first one''s stays',
  pg_temp.msg(pg_temp.approve('role_hr','trip4','step_role_hr','3000000'))||' | '
  ||(select status::text||' '||per_diem_rials from public.leave_requests where id=pg_temp.fx('trip4')),
  'per diem can only be set on the hr step of an errand | pending 4500000');
insert into hs_res values('trip4b',pg_temp.err(pg_temp.approve('role_hr','trip4','step_role_hr',null)));
select pg_temp.expect('two HR steps: both sign; the first per diem is the one stored',
  (select v from hs_res where k='trip4a')||' '||(select v from hs_res where k='trip4b')||' '
  ||(select status::text||' '||per_diem_rials from public.leave_requests where id=pg_temp.fx('trip4')),
  'ok ok approved 4500000');

-- The admin override: once the per diem step is signed, an override may not set a per diem.
insert into hs_fx values('trip5',(pg_temp.daily('emp',current_date+50,current_date+52))::uuid);
insert into hs_res values('trip5a',pg_temp.err(pg_temp.approve('named_hr','trip5','step_named_hr',null)));
select pg_temp.expect('override: the open second HR step has no hr_step, so no per diem override in the app',
  (select v from hs_res where k='trip5a')||' '||pg_temp.progress('admin','trip5','step_role_hr','hr_step'),'ok false');
select pg_temp.expect('override: a per diem through the admin override is refused (22023)',
  pg_temp.err(pg_temp.as_scalar('admin',format('select public.approve_leave_request_v2(%L,null,%L,true,true,1000)::text',
    pg_temp.fx('trip5'),pg_temp.sig()))),'22023');

rollback;
