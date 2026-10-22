-- FR-71 sign once for several steps, FR-72 remove a rejected request from Home (2026-10-21).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table once_fx(k text primary key,id uuid not null);
grant select on once_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from once_fx where k=p_key;
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
-- Hourly errand by p_actor; returns the request id.
create function pg_temp.errand(p_actor text,p_date date) returns uuid language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_errand_request_v2(%L,''08:00'',''09:00'',''Fixture location'',%L,true,null,false,null,false,null)',
    p_date,pg_temp.sig()))::uuid;
$$;
-- One-day daily errand by p_actor (per diem is daily-only since 2026-10-22).
create function pg_temp.daily(p_actor text,p_date date) returns uuid language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Fixture location'',%L,true,null,false,null,false,null)',
    p_date,p_date,pg_temp.sig()))::uuid;
$$;
-- Sign a list of step keys for request key p_req as p_actor.
create function pg_temp.sign(p_actor text,p_req text,p_steps text[],p_per_diem bigint default null) returns text
language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_steps(%L,%L::uuid[],%L,true,%s)::text',
    pg_temp.fx(p_req),(select array_agg(pg_temp.fx(k) order by o) from unnest(p_steps) with ordinality as v(k,o)),
    pg_temp.sig(),coalesce(p_per_diem::text,'null'))));
$$;
-- The caller's view of the open steps: "<key>:<is_mine>/<can_approve>" in step order.
create function pg_temp.mine(p_actor text,p_req text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select string_agg(coalesce((select k from once_fx where id=(item->>''step_id'')::uuid),''?'')||'':''||(item->>''is_mine'')||''/''||(item->>''can_approve''),'','' order by (item->>''step_order'')::int)
       from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''decision'' is null',
    pg_temp.fx(p_req)));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Sign once synthetic fixture');
  insert into once_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','SO');
  for who in select * from (values
    ('admin','admin','9990021001'),('boss','hr','9990021002'),('proc','employee','9990021003'),
    ('worker','employee','9990021004'),('other','employee','9990021005')) t(k,role,code) loop
    insert into once_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@once-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  -- boss is the Head of HR and the worker's manager (the owner's production case).
  insert into public.user_roles(user_id,role) values(pg_temp.fx('boss'),'manager');
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id in (pg_temp.fx('worker'),pg_temp.fx('other'),pg_temp.fx('proc'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into once_fx values('mgr',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into once_fx values('hr',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to,approver_id)
    values(v_company,'employee',3,'{leave,errand}',pg_temp.fx('proc')) returning id into v_id;
  insert into once_fx values('named',v_id);
end; $$;

-- ── FR-71: order not enforced ────────────────────────────────────────────────
insert into once_fx values('r1',pg_temp.daily('worker','2027-03-01'));
select pg_temp.expect('boss holds manager and HR steps',pg_temp.mine('boss','r1'),'mgr:true/true,hr:true/true,named:false/false');
select pg_temp.expect('per diem allowed on the HR step',pg_temp.as_scalar('boss',format(
  'select item->>''per_diem_allowed'' from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''step_id''=%L',
  pg_temp.fx('r1'),pg_temp.fx('hr'))),'true');
select pg_temp.expect('one call signs both steps',pg_temp.sign('boss','r1',array['hr','mgr'],500),'ok');
select pg_temp.expect('two approval rows with the same signature',
  (select count(*)::text||'/'||count(distinct signature_data)::text from public.leave_request_approvals
    where request_id=pg_temp.fx('r1') and approver_id=pg_temp.fx('boss') and decision='approved'),'2/1');
select pg_temp.expect('per diem saved, still waiting on the named step',
  (select per_diem_rials::text||'/'||status::text from public.leave_requests where id=pg_temp.fx('r1')),'500/pending');
select pg_temp.expect('signing again refused',pg_temp.sign('boss','r1',array['mgr']),'22023');
select pg_temp.expect('named approver finishes',pg_temp.sign('proc','r1',array['named']),'ok');
select pg_temp.expect('request approved',(select status::text from public.leave_requests where id=pg_temp.fx('r1')),'approved');

-- ── errors ───────────────────────────────────────────────────────────────────
insert into once_fx values('r2',pg_temp.errand('worker','2027-03-02'));
insert into once_fx values('stranger',gen_random_uuid());
select pg_temp.expect('empty list refused',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.approve_leave_request_steps(%L,''{}''::uuid[],%L,true)::text',pg_temp.fx('r2'),pg_temp.sig()))),'22023');
select pg_temp.expect('duplicate steps refused',pg_temp.sign('boss','r2',array['mgr','mgr']),'22023');
select pg_temp.expect('unknown step refused',pg_temp.sign('boss','r2',array['mgr','stranger']),'42501');
select pg_temp.expect('per diem without the HR step refused',pg_temp.sign('boss','r2',array['mgr'],100),'22023');
select pg_temp.expect('someone else''s step in the list refused',pg_temp.sign('boss','r2',array['mgr','named']),'42501');
select pg_temp.expect('no per diem on an hourly errand''s HR step',pg_temp.as_scalar('boss',format(
  'select item->>''per_diem_allowed'' from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''step_id''=%L',
  pg_temp.fx('r2'),pg_temp.fx('hr'))),'false');
select pg_temp.expect('per diem on an hourly errand refused',pg_temp.sign('boss','r2',array['mgr','hr'],100),'22023');
select pg_temp.expect('a refused call saves nothing',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('r2')),'0');
select pg_temp.expect('worker cannot sign',pg_temp.sign('worker','r2',array['mgr']),'42501');

-- ── order enforced, someone else in between ──────────────────────────────────
select pg_temp.login('admin');
update public.work_settings set approval_order_enforced=true where company_id=pg_temp.fx('company');
update public.approval_steps set step_order=3 where id=pg_temp.fx('hr');
update public.approval_steps set step_order=2 where id=pg_temp.fx('named');
insert into once_fx values('r3',pg_temp.errand('worker','2027-03-03'));
select pg_temp.expect('boss: manager now, HR mine but blocked',pg_temp.mine('boss','r3'),'mgr:true/true,named:false/false,hr:true/false');
select pg_temp.expect('bundle across another person''s step refused',pg_temp.sign('boss','r3',array['mgr','hr']),'22023');
select pg_temp.expect('nothing saved after the refused bundle',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('r3')),'0');
select pg_temp.expect('manager step alone ok',pg_temp.sign('boss','r3',array['mgr']),'ok');
select pg_temp.expect('named step ok',pg_temp.sign('proc','r3',array['named']),'ok');
select pg_temp.expect('HR step ok, approved',pg_temp.sign('boss','r3',array['hr']),'ok');
select pg_temp.expect('r3 approved',(select status::text from public.leave_requests where id=pg_temp.fx('r3')),'approved');

-- order enforced, own steps adjacent: one call in order
select pg_temp.login('admin');
update public.approval_steps set step_order=2 where id=pg_temp.fx('hr');
update public.approval_steps set step_order=3 where id=pg_temp.fx('named');
insert into once_fx values('r4',pg_temp.errand('worker','2027-03-04'));
select pg_temp.expect('boss: HR blocked only by own manager step',pg_temp.mine('boss','r4'),'mgr:true/true,hr:true/false,named:false/false');
select pg_temp.expect('adjacent own steps signed in one call',pg_temp.sign('boss','r4',array['hr','mgr']),'ok');

-- ── delegated step signed together with own steps ────────────────────────────
insert into once_fx values('delegation_role',pg_temp.as_scalar('admin',
  'select public.app_save_role(null,''Sign once delegation fixture'',''{"approval_delegate":"edit"}''::jsonb)')::uuid);
select pg_temp.expect('admin gives proc the delegation role',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.app_set_user_role_ids(%L,array[%L,%L]::uuid[])::text',pg_temp.fx('proc'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='employee'),
  pg_temp.fx('delegation_role')))),'ok');
select pg_temp.expect('proc appoints boss as delegate',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_set_approval_delegate(%L,%L,false)::text',pg_temp.fx('proc'),pg_temp.fx('boss')))),'ok');
insert into once_fx values('r5',pg_temp.errand('worker','2027-03-05'));
select pg_temp.expect('boss holds all three steps',pg_temp.mine('boss','r5'),'mgr:true/true,hr:true/false,named:true/false');
select pg_temp.expect('own and delegated steps in one call',pg_temp.sign('boss','r5',array['mgr','hr','named']),'ok');
select pg_temp.expect('r5 approved, named row delegated',
  (select r.status::text||'/'||a.evidence_kind::text from public.leave_requests r join public.leave_request_approvals a
     on a.request_id=r.id and a.step_id=pg_temp.fx('named') where r.id=pg_temp.fx('r5')),'approved/delegated');

-- ── FR-72: remove a rejected request from Home ───────────────────────────────
insert into once_fx values('r6',pg_temp.errand('worker','2027-03-06'));
select pg_temp.expect('pending request cannot be removed',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_dismiss_home_request(%L)::text',pg_temp.fx('r6')))),'22023');
select pg_temp.expect('boss rejects r6',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.reject_leave_request_v2(%L,%L,''no'')::text',pg_temp.fx('r6'),pg_temp.fx('mgr')))),'ok');
select pg_temp.expect('someone else cannot remove it',pg_temp.err(pg_temp.as_scalar('other',format(
  'select public.app_dismiss_home_request(%L)::text',pg_temp.fx('r6')))),'P0002');
select pg_temp.expect('requester removes it',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_dismiss_home_request(%L)::text',pg_temp.fx('r6')))),'ok');
select pg_temp.expect('removing twice is a no-op',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_dismiss_home_request(%L)::text',pg_temp.fx('r6')))),'ok');
select pg_temp.expect('requester reads own removal',pg_temp.as_scalar('worker',
  'select count(*)::text from public.home_dismissed_requests'),'1');
select pg_temp.expect('others read nothing',pg_temp.as_scalar('boss',
  'select count(*)::text from public.home_dismissed_requests'),'0');
select pg_temp.expect('no direct insert',pg_temp.err(pg_temp.as_scalar('worker',format(
  'insert into public.home_dismissed_requests(request_id,employee_id) values(%L,%L) returning ''x''',
  pg_temp.fx('r2'),pg_temp.fx('worker')))),'42501');
delete from public.leave_request_approvals where request_id=pg_temp.fx('r6');
delete from public.leave_requests where id=pg_temp.fx('r6');
select pg_temp.expect('deleting the request removes the row',
  (select count(*)::text from public.home_dismissed_requests where request_id=pg_temp.fx('r6')),'0');

rollback;
