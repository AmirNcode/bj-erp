-- The designated Head of HR enters their own per diem on the errand form (2026-10-19).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table perdiem_fx(k text primary key,id uuid not null);
grant select on perdiem_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from perdiem_fx where k=p_key;
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
create function pg_temp.assert(p_label text,p_condition boolean) returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %',p_label; end if;
  raise notice 'PASS %',p_label;
end; $$;
create function pg_temp.sig() returns text language sql immutable as $$
  select 'data:image/png;base64,iVBORw0KGgo'||repeat('A',89);
$$;
-- One-day daily errand as p_actor; returns the request id or 'ERROR <sqlstate> …'.
-- Per diem belongs to daily errands only (2026-10-22); pg_temp.hourly checks the refusal.
create function pg_temp.errand(p_actor text,p_date date,p_per_diem bigint,p_auto boolean default false) returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Fixture location'',%L,true,null,%L,null,false,%s)',
    p_date,p_date,pg_temp.sig(),p_auto,coalesce(p_per_diem::text,'null')));
$$;
create function pg_temp.hourly(p_actor text,p_date date,p_per_diem bigint) returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_errand_request_v2(%L,''08:00'',''09:00'',''Fixture location'',%L,true,null,false,null,false,%s)',
    p_date,pg_temp.sig(),coalesce(p_per_diem::text,'null')));
$$;
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Per diem synthetic fixture');
  insert into perdiem_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','PD');
  for who in select * from (values
    ('admin','admin','9990019001'),('ceo','manager','9990019002'),('head','hr','9990019003'),
    ('hr2','hr','9990019004'),('worker','employee','9990019005')) t(k,role,code) loop
    insert into perdiem_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@perdiem-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('ceo')
    where id in (pg_temp.fx('head'),pg_temp.fx('hr2'),pg_temp.fx('worker'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',1,'{leave,errand}') returning id into v_id;
  insert into perdiem_fx values('hr_step',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',2,'{leave,errand}') returning id into v_id;
  insert into perdiem_fx values('ceo_step',v_id);
end; $$;

select pg_temp.expect('admin designates CEO, HR head and the exempt HR step',pg_temp.as_scalar('admin',format(
  'select public.app_set_executive_settings(%L,%L,array[%L]::uuid[])::text',
  pg_temp.fx('ceo'),pg_temp.fx('head'),pg_temp.fx('hr_step'))),'');

-- HR head, CEO signs by hand: per diem stored at submission, marked as requester-entered.
insert into perdiem_fx values('head_errand',pg_temp.errand('head','2027-02-01',1500000)::uuid);
select pg_temp.expect('HR head per diem stored',
  (select per_diem_rials::text||'/'||per_diem_by_requester::text||'/'||status::text
     from public.leave_requests where id=pg_temp.fx('head_errand')),'1500000/true/pending');
select pg_temp.expect('HR step exempt, so only the CEO step waits',pg_temp.as_scalar('head',format(
  'select string_agg(item->>''evidence_kind'','','' order by (item->>''step_order'')::int) from jsonb_array_elements(public.app_request_approval_progress(%L)) item',
  pg_temp.fx('head_errand'))),'hr_exempt,pending');
select pg_temp.expect('audit log records the self-entered amount',
  (select count(*)::text from public.audit_log where action='set_own_per_diem' and entity_id=pg_temp.fx('head_errand')
     and actor_id=pg_temp.fx('head') and after->>'per_diem_rials'='1500000'),'1');

insert into perdiem_fx values('head_daily',pg_temp.as_scalar('head',format(
  'select public.submit_daily_errand_request_v2(''2027-02-02'',''2027-02-03'',''Fixture location'',%L,true,null,false,null,false,0)',
  pg_temp.sig()))::uuid);
select pg_temp.expect('daily errand accepts 0 Rials',
  (select per_diem_rials::text||'/'||per_diem_by_requester::text from public.leave_requests where id=pg_temp.fx('head_daily')),'0/true');

insert into perdiem_fx values('head_blank',pg_temp.errand('head','2027-02-04',null)::uuid);
select pg_temp.expect('blank per diem stays empty',
  (select coalesce(per_diem_rials::text,'null')||'/'||per_diem_by_requester::text from public.leave_requests where id=pg_temp.fx('head_blank')),'null/false');

select pg_temp.expect('negative per diem refused',pg_temp.err(pg_temp.errand('head','2027-02-05',-1)),'22023');
select pg_temp.expect('ordinary employee cannot enter own per diem',pg_temp.err(pg_temp.errand('worker','2027-02-05',100)),'42501');
select pg_temp.expect('other hr user cannot enter own per diem',pg_temp.err(pg_temp.errand('hr2','2027-02-05',100)),'42501');
select pg_temp.expect('HR head hourly errand refuses a per diem',pg_temp.err(pg_temp.hourly('head','2027-02-05',100)),'22023');
select pg_temp.expect('HR head hourly errand refuses even 0 Rials',pg_temp.err(pg_temp.hourly('head','2027-02-05',0)),'22023');
select pg_temp.expect('refused submissions leave no request behind',
  (select count(*)::text from public.leave_requests where start_date='2027-02-05'),'0');
select pg_temp.expect('v1 errand wrapper still works without per diem',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.submit_errand_request(''2027-02-06'',''08:00'',''09:00'',''Fixture location'',%L,true)',pg_temp.sig()))),'ok');

insert into perdiem_fx values('head_hourly',pg_temp.hourly('head','2027-02-07',null)::uuid);
select pg_temp.expect('HR head hourly errand without per diem ok',
  (select coalesce(per_diem_rials::text,'null')||'/'||unit::text from public.leave_requests where id=pg_temp.fx('head_hourly')),'null/hour');

-- Finance sees the marker once approved (admin override signs the remaining CEO step).
select pg_temp.expect('admin approves the HR head errand',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true)::text',pg_temp.fx('head_errand'),pg_temp.sig()))),'ok');
select pg_temp.expect('approval keeps the requester amount and marker',
  (select per_diem_rials::text||'/'||per_diem_by_requester::text||'/'||status::text
     from public.leave_requests where id=pg_temp.fx('head_errand')),'1500000/true/approved');
select pg_temp.expect('finance list carries the marker',pg_temp.as_scalar('admin',format(
  'select per_diem_rials::text||''/''||per_diem_by_requester::text from public.finance_approved_requests(''2027-02-01'',''2027-02-01'') where id=%L',
  pg_temp.fx('head_errand'))),'1500000/true');

-- When the HR head's step is NOT exempt, another HR signer may still enter per diem; theirs wins.
select pg_temp.expect('admin removes the HR-step exemption',pg_temp.as_scalar('admin',format(
  'select public.app_set_executive_settings(%L,%L,''{}''::uuid[])::text',pg_temp.fx('ceo'),pg_temp.fx('head'))),'');
insert into perdiem_fx values('head_signed',pg_temp.errand('head','2027-02-08',700)::uuid);
select pg_temp.expect('HR signer replaces the amount',pg_temp.err(pg_temp.as_scalar('hr2',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true,false,900)::text',pg_temp.fx('head_signed'),pg_temp.fx('hr_step'),pg_temp.sig()))),'ok');
select pg_temp.expect('HR signer amount clears the requester marker',
  (select per_diem_rials::text||'/'||per_diem_by_requester::text from public.leave_requests where id=pg_temp.fx('head_signed')),'900/false');

-- HR head as the CEO's delegate: approved at submission, per diem still stored.
select pg_temp.expect('admin restores the exemption',pg_temp.as_scalar('admin',format(
  'select public.app_set_executive_settings(%L,%L,array[%L]::uuid[])::text',
  pg_temp.fx('ceo'),pg_temp.fx('head'),pg_temp.fx('hr_step'))),'');
insert into perdiem_fx values('delegation_role',pg_temp.as_scalar('admin',
  'select public.app_save_role(null,''Per diem delegation fixture'',''{"approval_delegate":"edit"}''::jsonb)')::uuid);
select pg_temp.expect('admin gives the CEO the delegation role',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.app_set_user_role_ids(%L,array[%L,%L,%L]::uuid[])::text',pg_temp.fx('ceo'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='manager'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='employee'),
  pg_temp.fx('delegation_role')))),'ok');
select pg_temp.expect('CEO appoints the HR head as automatic delegate',pg_temp.err(pg_temp.as_scalar('ceo',format(
  'select public.app_set_approval_delegate(%L,%L,true)::text',pg_temp.fx('ceo'),pg_temp.fx('head')))),'ok');
insert into perdiem_fx values('head_auto',pg_temp.errand('head','2027-02-10',2500000,true)::uuid);
select pg_temp.expect('auto-approved errand keeps the HR head per diem',
  (select per_diem_rials::text||'/'||per_diem_by_requester::text||'/'||status::text
     from public.leave_requests where id=pg_temp.fx('head_auto')),'2500000/true/approved');

select pg_temp.assert('anon and authenticated cannot call the private setter',
  not has_function_privilege('anon','private.set_requester_per_diem(uuid,bigint)','EXECUTE')
  and not has_function_privilege('authenticated','private.set_requester_per_diem(uuid,bigint)','EXECUTE'));
select pg_temp.assert('anon cannot submit errands or read finance',
  not has_function_privilege('anon','public.submit_errand_request_v2(date,time,time,text,text,boolean,text,boolean,jsonb,boolean,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.submit_daily_errand_request_v2(date,date,text,text,boolean,text,boolean,jsonb,boolean,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.finance_approved_requests(date,date)','EXECUTE'));
select pg_temp.assert('authenticated can submit errands and read finance (function guards finance)',
  has_function_privilege('authenticated','public.submit_errand_request_v2(date,time,time,text,text,boolean,text,boolean,jsonb,boolean,bigint)','EXECUTE')
  and has_function_privilege('authenticated','public.finance_approved_requests(date,date)','EXECUTE'));
rollback;
