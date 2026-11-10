-- FR-90: a replacement (جانشین) never gains approval authority (2026-11-10).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table rp_fx(k text primary key,id uuid not null);
grant select on rp_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from rp_fx where k=p_key;
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
-- Daily leave by p_actor on current_date+p_day naming p_cover (or none); returns the id.
create function pg_temp.leave(p_actor text,p_day int,p_cover text,p_part public.day_part default 'full',
  p_temp_ceo boolean default false,p_preview text default null) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,%L,%L,true,''private reason'',%s,false,%s,%L)',
    pg_temp.fx('annual'),current_date+p_day,current_date+p_day,p_part,pg_temp.sig(),
    case when p_cover is null then 'null' else quote_literal(pg_temp.fx(p_cover)) end,
    case when p_preview is null then 'null' else quote_literal(p_preview)||'::jsonb' end,p_temp_ceo));
$$;
-- Override approval by the admin (the requester has no approver above them).
create function pg_temp.override(p_req text) returns text language sql as $$
  select pg_temp.as_scalar('admin',format(
    'select public.approve_leave_request_v2(%L,null,%L,true,true)::text',pg_temp.fx(p_req),pg_temp.sig()));
$$;
-- Sign every open step of p_req as p_actor.
create function pg_temp.sign(p_actor text,p_req text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_steps(%L,array[%L]::uuid[],%L,true)::text',
    pg_temp.fx(p_req),pg_temp.fx('mstep'),pg_temp.sig())));
$$;
create function pg_temp.status(p_req text) returns text language sql as $$
  select status::text from public.leave_requests where id=pg_temp.fx(p_req);
$$;
create function pg_temp.grants(p_req text) returns text language sql as $$
  select count(*)::text from public.approval_delegations where source_request_id=pg_temp.fx(p_req);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_b uuid:=gen_random_uuid(); v_id uuid; who record;
  v_role uuid;
begin
  insert into public.companies(id,name) values(v_company,'Replacement paper-only synthetic fixture');
  insert into rp_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','PPA'),(v_b,v_company,'ب','Fixture B','office','PPB');
  for who in select * from (values
    ('admin',array['admin'],'9990090001',1),('ceo',array['manager','employee'],'9990090002',1),
    ('m',array['manager','employee'],'9990090003',1),('r',array['manager','employee'],'9990090004',2),
    ('s',array['manager','employee'],'9990090005',1),('e',array['employee'],'9990090006',1),
    ('e2',array['employee'],'9990090007',1)) t(k,roles,code,dept) loop
    insert into rp_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@paper-only-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,case who.dept when 1 then v_a else v_b end,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('m') where id in (pg_temp.fx('e'),pg_temp.fx('e2'));
  update public.profiles set manager_id=pg_temp.fx('ceo') where id in (pg_temp.fx('m'),pg_temp.fx('s'),pg_temp.fx('r'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into rp_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to) values(v_company,'manager',1,'{leave,errand}')
    returning id into v_id;
  insert into rp_fx values('mstep',v_id);
  insert into private.sms_settings(company_id) values(v_company);
  insert into public.approval_executive_settings(company_id,ceo_id) values(v_company,pg_temp.fx('ceo'));
  -- m and the CEO hold the delegation permission (this is what used to make a replacement a temporary delegate).
  v_role:=public.app_save_role(null,'Paper-only fixture delegation','{"approval_delegate":"edit"}'::jsonb);
  perform public.app_set_user_role_ids(pg_temp.fx('m'),array[
    (select id from public.roles where company_id=v_company and system_key='manager'),
    (select id from public.roles where company_id=v_company and system_key='employee'),v_role]);
  perform public.app_set_user_role_ids(pg_temp.fx('ceo'),array[
    (select id from public.roles where company_id=v_company and system_key='manager'),
    (select id from public.roles where company_id=v_company and system_key='employee'),v_role]);
  -- s is the saved delegate of m (source_request_id null: the kind that keeps working).
  insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,configured_by)
    values(v_company,pg_temp.fx('m'),pg_temp.fx('s'),'Fixture m','Fixture s',pg_temp.fx('m'));
end; $$;

-- ── naming a replacement creates no approval grant ───────────────────────────
-- m is absent today: the leave is filed naming r (an eligible approver) and approved.
select pg_temp.expect('m files leave naming an eligible replacement',
  left(pg_temp.err(pg_temp.leave('m',0,'r'))||'',2),'ok');
insert into rp_fx select 'm1',id from public.leave_requests where employee_id=pg_temp.fx('m') order by created_at desc limit 1;
select pg_temp.expect('pending: no temporary grant',pg_temp.grants('m1'),'0');
select pg_temp.expect('admin approves m''s leave',pg_temp.err(pg_temp.override('m1')),'ok');
select pg_temp.expect('approved: no temporary grant',pg_temp.grants('m1'),'0');
select pg_temp.expect('approved status',pg_temp.status('m1'),'approved');

-- ── during m's absence, only m and the saved delegate approve ────────────────
insert into rp_fx values('e1',pg_temp.as_scalar('e',format(
  'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true,null)',
  pg_temp.fx('annual'),current_date+3,current_date+3,pg_temp.sig()))::uuid);
select pg_temp.expect('the replacement cannot approve',pg_temp.sign('r','e1'),'42501');
select pg_temp.expect('still pending after the replacement tried',pg_temp.status('e1'),'pending');
select pg_temp.expect('the manager still approves while away',pg_temp.sign('m','e1'),'ok');
select pg_temp.expect('manager approval finalised the request',pg_temp.status('e1'),'approved');
insert into rp_fx values('e2r',pg_temp.as_scalar('e2',format(
  'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true,null)',
  pg_temp.fx('annual'),current_date+4,current_date+4,pg_temp.sig()))::uuid);
select pg_temp.expect('the saved delegate still approves',pg_temp.sign('s','e2r'),'ok');
select pg_temp.expect('approved by the saved delegate',pg_temp.status('e2r'),'approved');

-- ── preview: temporary is gone ───────────────────────────────────────────────
select pg_temp.expect('preview: temporary_eligible false',pg_temp.as_scalar('m',format(
  'select (public.app_request_delegation_preview(%L,%L,''day'',''full'',null,null,%L)->>''temporary_eligible'')',
  current_date+10,current_date+10,pg_temp.fx('r'))),'false');
select pg_temp.expect('preview: temporary is null',pg_temp.as_scalar('m',format(
  'select (public.app_request_delegation_preview(%L,%L,''day'',''full'',null,null,%L)->''temporary'')::text',
  current_date+10,current_date+10,pg_temp.fx('r'))),'null');
select pg_temp.expect('preview: no temporary delegate name',pg_temp.as_scalar('m',format(
  'select coalesce(public.app_request_delegation_preview(%L,%L,''day'',''full'',null,null,%L)->>''temporary_delegate_name'',''none'')',
  current_date+10,current_date+10,pg_temp.fx('r'))),'none');

-- ── CEO: no attestation needed ───────────────────────────────────────────────
select pg_temp.expect('CEO files leave naming a replacement without the attestation',
  pg_temp.err(pg_temp.leave('ceo',12,'m','full',false)),'ok');
insert into rp_fx select 'c1',id from public.leave_requests where employee_id=pg_temp.fx('ceo') order by created_at desc limit 1;
select pg_temp.expect('CEO: no temporary grant',pg_temp.grants('c1'),'0');

-- ── half day with no preview ─────────────────────────────────────────────────
select pg_temp.expect('half-day leave naming a replacement needs no preview',
  pg_temp.err(pg_temp.leave('m',20,'r','am',false,null)),'ok');

-- ── a declined replacement can be changed ────────────────────────────────────
insert into rp_fx values('d1',pg_temp.leave('e',30,'e2')::uuid);
select pg_temp.expect('replacement declines',pg_temp.err(pg_temp.as_scalar('e2',format(
  'select public.app_replacement_decline(%L,null)::text',pg_temp.fx('d1')))),'ok');
select pg_temp.expect('requester names another eligible approver',pg_temp.err(pg_temp.as_scalar('e',format(
  'select public.app_change_replacement(%L,%L)::text',pg_temp.fx('d1'),pg_temp.fx('s')))),'ok');

-- ── grants made before the migration are revoked by it ───────────────────────
insert into rp_fx values('old',pg_temp.leave('m',40,'r')::uuid);
select pg_temp.expect('the old request is approved (temporary grants only count on approved requests)',
  pg_temp.err(pg_temp.override('old')),'ok');
insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,
    source_request_id,starts_at,ends_at,configured_by)
  values(pg_temp.fx('company'),pg_temp.fx('m'),pg_temp.fx('r'),'Fixture m','Fixture r',pg_temp.fx('old'),
    now()-interval '1 hour',now()+interval '1 day',pg_temp.fx('m'));
select pg_temp.expect('a leftover temporary grant is live before the revoke',
  (select count(*)::text from private.effective_approval_delegate(pg_temp.fx('m')) g where g.source_request_id is not null),'1');
update public.approval_delegations set revoked_at=now() where source_request_id is not null and revoked_at is null;
select pg_temp.expect('after the revoke statement no temporary grant is effective',
  (select count(*)::text from private.effective_approval_delegate(pg_temp.fx('m')) g where g.source_request_id is not null),'0');

rollback;
