-- Stranded requests and past-dated requests (2026-10-31).
-- A request whose last open step was deactivated after the others signed has nothing left to
-- sign: the admin override must still approve or reject it. Requests dated in the past can be
-- submitted (time off taken without a request) and decided after their dates.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table sr_fx(k text primary key,id uuid not null);
grant select on sr_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from sr_fx where k=p_key;
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
-- Full-day leave by p_actor from p_start to p_end; returns the request id (or the error).
create function pg_temp.leave(p_actor text,p_start date,p_end date) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)',
    pg_temp.fx('annual'),p_start,p_end,pg_temp.sig()));
$$;
create function pg_temp.sign(p_actor text,p_req text,p_steps text[]) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_steps(%L,%L::uuid[],%L,true)::text',
    pg_temp.fx(p_req),(select array_agg(pg_temp.fx(k) order by o) from unnest(p_steps) with ordinality as v(k,o)),
    pg_temp.sig())));
$$;
-- The admin override, as approveRequest sends it when no step ids are left.
create function pg_temp.override(p_actor text,p_req text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_v2(%L,null,%L,true,true)::text',pg_temp.fx(p_req),pg_temp.sig())));
$$;
create function pg_temp.reject(p_actor text,p_req text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.reject_leave_request_v2(%L,null,''No longer needed'')::text',pg_temp.fx(p_req))));
$$;
create function pg_temp.status(p_req text) returns text language sql as $$
  select status::text from public.leave_requests where id=pg_temp.fx(p_req);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Stranded request synthetic fixture');
  insert into sr_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','SR');
  for who in select * from (values
    ('admin','admin','9990031001'),('boss','manager','9990031002'),('hrp','hr','9990031003'),
    ('guard','employee','9990031004'),('worker','employee','9990031005')) t(k,role,code) loop
    insert into sr_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@stranded-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id=pg_temp.fx('worker');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into sr_fx values('annual',v_id);
  -- Like the Liara chain on 1405-0001 (direct manager, HR, then a security step that was later
  -- deactivated); security steps may no longer be active, so the third is a named approver.
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into sr_fx values('mgr',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into sr_fx values('hr',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to,approver_id)
    values(v_company,'employee',3,'{leave,errand}',pg_temp.fx('guard')) returning id into v_id;
  insert into sr_fx values('sec',v_id);
end; $$;

-- ── past dates: submit and decide after the dates ────────────────────────────
insert into sr_fx values('past',(pg_temp.leave('worker',current_date-40,current_date-38))::uuid);
select pg_temp.expect('leave dated 40 days ago submitted',pg_temp.status('past'),'pending');
insert into sr_fx values('past_errand',(pg_temp.as_scalar('worker',format(
  'select public.submit_daily_errand_request_v2(%L,%L,''Fixture location'',%L,true)',
  current_date-10,current_date-9,pg_temp.sig())))::uuid);
select pg_temp.expect('daily errand dated in the past submitted',pg_temp.status('past_errand'),'pending');
insert into sr_fx values('past_hourly',(pg_temp.as_scalar('worker',format(
  'select public.submit_errand_request_v2(%L,''08:00'',''09:00'',''Fixture location'',%L,true)',
  current_date-3,pg_temp.sig())))::uuid);
select pg_temp.expect('hourly errand dated in the past submitted',pg_temp.status('past_hourly'),'pending');
select pg_temp.expect('manager signs a past request',pg_temp.sign('boss','past',array['mgr']),'ok');
select pg_temp.expect('HR signs a past request',pg_temp.sign('hrp','past',array['hr']),'ok');
select pg_temp.expect('named approver finishes a past request',pg_temp.sign('guard','past',array['sec']),'ok');
select pg_temp.expect('past request approved',pg_temp.status('past'),'approved');
select pg_temp.expect('past errand rejected after its dates',pg_temp.reject('boss','past_errand'),'ok');
select pg_temp.expect('past errand now rejected',pg_temp.status('past_errand'),'rejected');

-- ── stranded: last step deactivated after the others signed ──────────────────
insert into sr_fx values('s1',(pg_temp.leave('worker',current_date-30,current_date-30))::uuid);
insert into sr_fx values('s2',(pg_temp.leave('worker',current_date-20,current_date-20))::uuid);
insert into sr_fx values('s3',(pg_temp.leave('worker',current_date-15,current_date-15))::uuid);
select pg_temp.expect('s1 manager',pg_temp.sign('boss','s1',array['mgr']),'ok');
select pg_temp.expect('s1 HR',pg_temp.sign('hrp','s1',array['hr']),'ok');
select pg_temp.expect('s2 manager',pg_temp.sign('boss','s2',array['mgr']),'ok');
select pg_temp.expect('s2 HR',pg_temp.sign('hrp','s2',array['hr']),'ok');
select pg_temp.expect('s3 manager',pg_temp.sign('boss','s3',array['mgr']),'ok');
select pg_temp.expect('s3 HR',pg_temp.sign('hrp','s3',array['hr']),'ok');
select pg_temp.login('admin');
update public.approval_steps set active=false where id=pg_temp.fx('sec');
select pg_temp.expect('s1 still pending with nothing left to sign',pg_temp.status('s1'),'pending');
select pg_temp.expect('no open step in the progress',pg_temp.as_scalar('admin',format(
  'select count(*)::text from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''decision'' is null',
  pg_temp.fx('s1'))),'0');
select pg_temp.expect('manager cannot override',pg_temp.override('boss','s1'),'42501');
select pg_temp.expect('HR cannot reject a stranded request',pg_temp.reject('hrp','s1'),'42501');
select pg_temp.expect('admin approves the stranded request',pg_temp.override('admin','s1'),'ok');
select pg_temp.expect('s1 approved by the admin',
  (select status::text||'/'||(decided_by=pg_temp.fx('admin'))::text||'/'||(approver_signature_data is not null)::text
     from public.leave_requests where id=pg_temp.fx('s1')),'approved/true/true');
select pg_temp.expect('no extra approval row written',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('s1')),'2');
select pg_temp.expect('stranded approval audited',
  (select count(*)::text from public.audit_log where entity_id=pg_temp.fx('s1')
     and action='approve_leave_step' and (after->>'stranded')::boolean),'1');
select pg_temp.expect('approving again refused',pg_temp.override('admin','s1'),'22023');
select pg_temp.expect('admin rejects a stranded request',pg_temp.reject('admin','s2'),'ok');
select pg_temp.expect('s2 rejected with the note',
  (select status::text||'/'||decision_note from public.leave_requests where id=pg_temp.fx('s2')),
  'rejected/No longer needed');
select pg_temp.expect('stranded rejection audited',
  (select count(*)::text from public.audit_log where entity_id=pg_temp.fx('s2')
     and action='reject_leave_request' and (after->>'stranded')::boolean),'1');
select pg_temp.expect('per diem refused on a stranded leave',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true,100)::text',pg_temp.fx('s3'),pg_temp.sig()))),'22023');
select pg_temp.expect('s3 untouched after the refusal',pg_temp.status('s3'),'pending');

-- ── a reactivated step is open again: the normal path, not the stranded one ──
update public.approval_steps set active=true where id=pg_temp.fx('sec');
select pg_temp.expect('named step open again on s3',pg_temp.as_scalar('admin',format(
  'select count(*)::text from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''decision'' is null',
  pg_temp.fx('s3'))),'1');
select pg_temp.expect('named approver signs s3',pg_temp.sign('guard','s3',array['sec']),'ok');
select pg_temp.expect('s3 approved through its chain',pg_temp.status('s3'),'approved');

rollback;
