-- Editing approved requests of all four types: five permissions, one RPC (FR-91, 2026-11-10).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table tc_fx(k text primary key,id uuid not null);
grant select on tc_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from tc_fx where k=p_key;
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
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;
create function pg_temp.approve(p_actor text,p_req text,p_step text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_v2(%L,%L,%L,true,false,null)::text',
    pg_temp.fx(p_req),pg_temp.fx(p_step),pg_temp.sig())));
$$;
-- Daily and hourly errands as p_actor; return the request id or 'ERROR <sqlstate> …'.
create function pg_temp.daily(p_actor text,p_start date,p_end date) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Shiraz'',%L,true,''Site visit'',false,null,false,null)',
    p_start,p_end,pg_temp.sig()));
$$;
create function pg_temp.hourly(p_actor text,p_date date) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_errand_request_v2(%L,''08:00'',''09:00'',''Fixture location'',%L,true)',p_date,pg_temp.sig()));
$$;
-- Files a request and walks it through the manager and HR steps; stores its id under p_key.
create function pg_temp.fin(p_key text,p_hr text default 'hr') returns void language plpgsql as $$
begin
  perform pg_temp.approve('mgr',p_key,'mgr_step');
  perform pg_temp.approve(p_hr,p_key,'hr_step');
  if (select status from public.leave_requests where id=pg_temp.fx(p_key))<>'approved' then
    raise exception 'fixture: % not approved',p_key; end if;
end; $$;
create function pg_temp.mk(p_key text,p_emp text,p_type text,p_start date,p_end date,p_part text default 'full') returns void
language plpgsql as $$
begin
  insert into tc_fx values(p_key,pg_temp.as_scalar(p_emp,format(
    'select public.submit_leave_request_v2(%L,%L,%L,%L,%L,true)',
    pg_temp.fx(p_type),p_start,p_end,p_part,pg_temp.sig()))::uuid);
  perform pg_temp.fin(p_key);
end; $$;
create function pg_temp.mkh(p_key text,p_emp text,p_type text,p_date date,p_from text,p_to text) returns void
language plpgsql as $$
begin
  insert into tc_fx values(p_key,pg_temp.as_scalar(p_emp,format(
    'select public.submit_hourly_leave_request_v2(%L,%L,%L,%L,%L,true)',
    pg_temp.fx(p_type),p_date,p_from,p_to,pg_temp.sig()))::uuid);
  perform pg_temp.fin(p_key);
end; $$;
create function pg_temp.mktrip(p_key text,p_emp text,p_start date,p_end date,p_booked boolean default false,p_hr text default 'hr') returns void
language plpgsql as $$
begin
  insert into tc_fx values(p_key,pg_temp.daily(p_emp,p_start,p_end)::uuid);
  if p_booked then
    perform pg_temp.as_scalar('hr',format('select public.app_set_travel_booking(%L,true)::text',pg_temp.fx(p_key)));
  end if;
  perform pg_temp.fin(p_key,p_hr);
  if p_booked then
    update public.travel_bookings set done_at=now(),first_done_at=now(),done_by=pg_temp.fx('hr'),first_saved_at=now()
     where request_id=pg_temp.fx(p_key);
  end if;
end; $$;
-- app_edit_request as p_actor. NULL arguments are passed as SQL null.
create function pg_temp.edit(p_actor text,p_req text,p_unit text,p_start text,p_end text,p_part text,
  p_st text,p_et text,p_pd text,p_reason text default 'r',p_sig text default null,p_auth boolean default true) returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.app_edit_request(%L,%L,%L,%L,%L,%L,%L,%s,%L,%L,%L)::text',
    pg_temp.fx(p_req),p_unit,p_start,p_end,p_part,p_st,p_et,coalesce(p_pd,'null'),
    p_reason,coalesce(p_sig,pg_temp.sig()),p_auth));
$$;
create function pg_temp.correct(p_actor text,p_req text,p_start text,p_end text,p_per_diem text,p_reason text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.app_correct_trip(%L,%s,%s,%s,%L,%L,true)::text',pg_temp.fx(p_req),
    coalesce(quote_literal(p_start)||'::date','null'),coalesce(quote_literal(p_end)||'::date','null'),
    coalesce(p_per_diem,'null'),p_reason,pg_temp.sig()));
$$;
create function pg_temp.row_of(p_req text) returns text language sql as $$
  select unit||'/'||start_date||'/'||end_date||'/'||day_part||'/'||coalesce(start_time::text,'-')||'/'
         ||coalesce(end_time::text,'-')||'/'||requested_minutes||'/'||unpaid_minutes||'/'||coalesce(per_diem_rials::text,'null')
    from public.leave_requests where id=pg_temp.fx(p_req);
$$;
create function pg_temp.ledger(p_req text) returns text language sql as $$
  select coalesce(string_agg(entry_type||':'||delta_minutes,',' order by seq),'none')
    from public.leave_ledger where request_id=pg_temp.fx(p_req);
$$;
create function pg_temp.bal(p_emp text,p_type text) returns text language sql as $$
  select public.current_leave_balance(pg_temp.fx(p_emp),pg_temp.fx(p_type))::text;
$$;
create function pg_temp.history(p_req text) returns text language sql as $$
  select count(*)::text from public.request_corrections where request_id=pg_temp.fx(p_req);
$$;
create function pg_temp.msg(p_state text,p_text text) returns text language sql immutable as $$
  select 'ERROR '||p_state||' '||p_text;
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_odept uuid:=gen_random_uuid(); v_id uuid; v_role uuid; who record; kk text;
begin
  insert into public.companies(id,name) values(v_company,'Request edit synthetic fixture');
  insert into public.companies(id,name) values(v_other,'Request edit other company');
  insert into tc_fx values('company',v_company),('other',v_other);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','RE'),(v_odept,v_other,'آزمایش','Other HQ','office','RO');
  for who in select * from (values
    ('admin','admin','9990081001'),('mgr','manager','9990081002'),('hr','hr','9990081003'),
    ('hr2','hr','9990081004'),('ed_all','employee','9990081006'),
    ('ed_daily','employee','9990081007'),('ed_own','employee','9990081008'),('tw','employee','9990081009'),
    ('e','employee','9990081010'),('e2','employee','9990081011'),('e3','employee','9990081012'),
    ('e4','employee','9990081013'),('e5','employee','9990081014'),('e6','employee','9990081015'),
    ('e7','employee','9990081016'),('ownonly','employee','9990081017')) t(k,role,code) loop
    insert into tc_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@edit-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  -- An editor of the other company, holding all four type keys there.
  insert into tc_fx values('xed',gen_random_uuid());
  insert into auth.users(id,email) values(pg_temp.fx('xed'),'9990081099@edit-fixture.invalid');
  insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
    values(pg_temp.fx('xed'),v_other,v_odept,'9990081099','9990081099','Fixture xed',false);
  insert into public.user_roles(user_id,role) values(pg_temp.fx('xed'),'employee');
  -- Custom roles: all four type keys; the daily-leave key only; all four plus "own".
  insert into public.roles(company_id,kind,name) values(v_company,'custom','EdAll') returning id into v_role;
  insert into public.role_permissions select v_role,x,'edit' from unnest(array['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly']) x;
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ed_all'),v_role);
  insert into tc_fx values('role_all',v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','EdDaily') returning id into v_role;
  insert into public.role_permissions values(v_role,'edit_leave_daily','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ed_daily'),v_role);
  insert into tc_fx values('role_daily',v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','EdOwn') returning id into v_role;
  insert into public.role_permissions select v_role,x,'edit' from unnest(array['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own']) x;
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ed_own'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','OwnOnly') returning id into v_role;
  insert into public.role_permissions values(v_role,'edit_requests_own','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ownonly'),v_role);
  insert into public.roles(company_id,kind,name) values(v_other,'custom','EdAllOther') returning id into v_role;
  insert into public.role_permissions select v_role,x,'edit' from unnest(array['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly']) x;
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('xed'),v_role);

  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('mgr')
    where id in (select id from tc_fx where k not in ('company','other','mgr','xed','mgr_step','hr_step') and k !~ '^(role_|type_)');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into tc_fx values('mgr_step',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into tc_fx values('hr_step',v_id);
  update public.employee_personal_info set national_id='0012345679',birth_date='1990-01-01',
    mobile='09120000000',gender='male' where employee_id=pg_temp.fx('tw');

  -- Leave types: balance-bound annual, free "gen", unpaid, and one that cannot be taken hourly.
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,allow_hourly)
    values(v_company,'سالانه','Fixture annual',true,true,true) returning id into v_id;
  insert into tc_fx values('annual',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,allow_hourly)
    values(v_company,'آزاد','Fixture gen',false,true,true) returning id into v_id;
  insert into tc_fx values('gen',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,allow_hourly)
    values(v_company,'بدون حقوق','Fixture unpaid',false,false,true) returning id into v_id;
  insert into tc_fx values('unpaid',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,allow_hourly)
    values(v_company,'ساعتی نه','Fixture nohourly',false,true,false) returning id into v_id;
  insert into tc_fx values('nohourly',v_id);
  -- Five days (2400 minutes) of annual balance for the people who use it.
  foreach kk in array array['e2','e3','e5'] loop
    insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
      values(pg_temp.fx(kk),pg_temp.fx('annual'),'allocation',2400,2400,'fixture allocation');
  end loop;
end; $$;

-- ============================================================ catalog
select pg_temp.assert('the four type keys and the own key are in the catalog',
  (select count(*)=5 from private.permission_keys() k where k in
    ('edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own')));
select pg_temp.expect('26 keys',(select count(*)::text from private.permission_keys()),'26');
select pg_temp.expect('each is an action: edit only',
  (select string_agg(private.permission_allows(k,'edit')::text||private.permission_allows(k,'read')::text,',' order by k)
     from unnest(array['edit_errand_daily','edit_errand_hourly','edit_leave_daily','edit_leave_hourly','edit_requests_own']) k),
  'truefalse,truefalse,truefalse,truefalse,truefalse');
select pg_temp.expect('each depends on leave_requests read',
  (select string_agg(key||':'||key_level||':'||needs,',' order by key) from private.permission_deps()
    where key like 'edit\_%' escape '\'),
  'edit_errand_daily:read:leave_requests,edit_errand_hourly:read:leave_requests,edit_leave_daily:read:leave_requests,'
  ||'edit_leave_hourly:read:leave_requests,edit_requests_own:read:leave_requests');
do $$ begin
  begin
    insert into public.role_permissions values(pg_temp.fx('role_all'),'edit_leave_daily','read');
    raise exception 'FAIL a read level was accepted';
  exception when check_violation then raise notice 'PASS read level refused'; end;
end $$;
select pg_temp.expect('the hr preset has the four type keys and not the own key',
  (select string_agg(rp.permission,',' order by rp.permission) from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where r.company_id=pg_temp.fx('company') and r.system_key='hr' and rp.permission like 'edit\_%' escape '\'),
  'edit_errand_daily,edit_errand_hourly,edit_leave_daily,edit_leave_hourly');
select pg_temp.expect('no other preset has any',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where r.company_id=pg_temp.fx('company') and r.system_key is not null and r.system_key<>'hr'
      and rp.permission like 'edit\_%' escape '\'),'0');
-- The migration's backfill for roles that already exist.
do $$ begin
  delete from public.role_permissions where permission like 'edit\_%' escape '\' and role_id in
    (select id from public.roles where system_key='hr' and company_id=pg_temp.fx('company'));
  insert into public.role_permissions(role_id,permission,level)
  select r.id,k,'edit' from public.roles r
    cross join unnest(array['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly']) k
   where r.system_key='hr' on conflict do nothing;
end $$;
select pg_temp.expect('the backfill statement restores them',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where r.company_id=pg_temp.fx('company') and r.system_key='hr' and rp.permission like 'edit\_%' escape '\'),'4');
select pg_temp.expect('a company created later gets the same four',
  (select string_agg(rp.permission,',' order by rp.permission) from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where r.company_id=pg_temp.fx('other') and r.system_key='hr' and rp.permission like 'edit\_%' escape '\'),
  'edit_errand_daily,edit_errand_hourly,edit_leave_daily,edit_leave_hourly');
select pg_temp.expect('my edit types: the daily-leave editor',pg_temp.as_scalar('ed_daily','select public.app_my_request_edit_types()::text'),'{edit_leave_daily}');
select pg_temp.expect('my edit types: the admin holds all five',
  pg_temp.as_scalar('admin','select (select string_agg(x,'','' order by x) from unnest(public.app_my_request_edit_types()) x)'),
  'edit_errand_daily,edit_errand_hourly,edit_leave_daily,edit_leave_hourly,edit_requests_own');
select pg_temp.expect('my edit types: a plain employee holds none',pg_temp.as_scalar('e','select public.app_my_request_edit_types()::text'),'{}');
select pg_temp.expect('my edit types: the hr preset holder',
  pg_temp.as_scalar('hr','select (select string_agg(x,'','' order by x) from unnest(public.app_my_request_edit_types()) x)'),
  'edit_errand_daily,edit_errand_hourly,edit_leave_daily,edit_leave_hourly');
select pg_temp.assert('anon cannot edit or list its types',
  not has_function_privilege('anon','public.app_edit_request(uuid,public.leave_unit,date,date,public.day_part,time,time,bigint,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.app_my_request_edit_types()','EXECUTE')
  and has_function_privilege('authenticated','public.app_edit_request(uuid,public.leave_unit,date,date,public.day_part,time,time,bigint,text,text,boolean)','EXECUTE'));
select pg_temp.assert('the gate and the impl are not client callable',
  not has_function_privilege('authenticated','private.can_edit_request(uuid,uuid,public.leave_unit)','EXECUTE')
  and not has_function_privilege('authenticated','private.edit_request_impl(uuid,uuid,public.leave_unit,date,date,public.day_part,time,time,bigint,text,text,boolean)','EXECUTE'));

-- ============================================================ gate
select pg_temp.mk('g1','e','gen','2027-03-01','2027-03-03');
select pg_temp.expect('fixture g1 row',pg_temp.row_of('g1'),'day/2027-03-01/2027-03-03/full/-/-/1440/0/null');
select pg_temp.expect('a manager without a toggle is refused',
  pg_temp.edit('mgr','g1','day','2027-03-01','2027-03-02','full',null,null,null),pg_temp.msg('42501','not allowed to edit this request'));
select pg_temp.expect('the requester without a toggle is refused',
  pg_temp.err(pg_temp.edit('e','g1','day','2027-03-01','2027-03-02','full',null,null,null)),'42501');
select pg_temp.expect('an editor of another company is refused',
  pg_temp.err(pg_temp.edit('xed','g1','day','2027-03-01','2027-03-02','full',null,null,null)),'42501');
select pg_temp.expect('daily-leave editor: daily to hourly needs both toggles',
  pg_temp.edit('ed_daily','g1','hour','2027-03-01','2027-03-01','full','09:00','10:00',null),pg_temp.msg('42501','not allowed to edit this request'));
select pg_temp.expect('that refusal wrote nothing',pg_temp.row_of('g1'),'day/2027-03-01/2027-03-03/full/-/-/1440/0/null');
select pg_temp.expect('daily-leave editor moves the dates',
  pg_temp.err(pg_temp.edit('ed_daily','g1','day','2027-03-01','2027-03-02','full',null,null,null)),'ok');
select pg_temp.expect('dates moved',pg_temp.row_of('g1'),'day/2027-03-01/2027-03-02/full/-/-/960/0/null');
-- Own requests.
select pg_temp.mk('o1','ed_all','gen','2027-03-10','2027-03-10');
select pg_temp.mk('o2','ed_own','gen','2027-03-12','2027-03-12');
select pg_temp.mk('o3','admin','gen','2027-03-14','2027-03-14');
select pg_temp.expect('all four keys but no own key: own request refused',
  pg_temp.edit('ed_all','o1','day','2027-03-10','2027-03-11','full',null,null,null),pg_temp.msg('42501','not allowed to edit this request'));
select pg_temp.expect('with the own key: allowed',
  pg_temp.err(pg_temp.edit('ed_own','o2','day','2027-03-12','2027-03-13','full',null,null,null)),'ok');
select pg_temp.expect('the admin edits their own',
  pg_temp.err(pg_temp.edit('admin','o3','day','2027-03-14','2027-03-15','full',null,null,null)),'ok');
select pg_temp.expect('an editor with the own key still edits other people''s requests',
  pg_temp.err(pg_temp.edit('ed_own','o1','day','2027-03-10','2027-03-11','full',null,null,null)),'ok');
select pg_temp.mk('oo','ownonly','gen','2027-03-20','2027-03-20');
select pg_temp.expect('the own key alone edits nothing',
  pg_temp.edit('ownonly','oo','day','2027-03-20','2027-03-21','full',null,null,null),pg_temp.msg('42501','not allowed to edit this request'));
-- Status.
insert into tc_fx values('p1',pg_temp.as_scalar('e',format(
  'select public.submit_leave_request_v2(%L,''2027-04-01'',''2027-04-01'',''full'',%L,true)',pg_temp.fx('gen'),pg_temp.sig()))::uuid);
insert into tc_fx values('p2',pg_temp.as_scalar('e',format(
  'select public.submit_leave_request_v2(%L,''2027-04-05'',''2027-04-05'',''full'',%L,true)',pg_temp.fx('gen'),pg_temp.sig()))::uuid);
insert into tc_fx values('p3',pg_temp.as_scalar('e',format(
  'select public.submit_leave_request_v2(%L,''2027-04-10'',''2027-04-10'',''full'',%L,true)',pg_temp.fx('gen'),pg_temp.sig()))::uuid);
select pg_temp.expect('pending refused',
  pg_temp.edit('ed_all','p1','day','2027-04-01','2027-04-02','full',null,null,null),pg_temp.msg('22023','only an approved request can be edited'));
select pg_temp.as_scalar('mgr',format('select public.reject_leave_request_v2(%L,%L,''no'')::text',pg_temp.fx('p2'),pg_temp.fx('mgr_step')));
select pg_temp.expect('rejected refused',
  pg_temp.edit('ed_all','p2','day','2027-04-05','2027-04-06','full',null,null,null),pg_temp.msg('22023','only an approved request can be edited'));
select pg_temp.as_scalar('e',format('select public.cancel_leave_request(%L)::text',pg_temp.fx('p3')));
select pg_temp.expect('cancelled refused',
  pg_temp.edit('ed_all','p3','day','2027-04-10','2027-04-11','full',null,null,null),pg_temp.msg('22023','only an approved request can be edited'));
select pg_temp.expect('an unknown request is not found',
  pg_temp.as_scalar('ed_all','select public.app_edit_request(gen_random_uuid(),''day'',''2027-04-10'',''2027-04-11'',''full'',null,null,null,''r'','''||pg_temp.sig()||''',true)::text'),
  pg_temp.msg('P0002','request not found'));

-- ============================================================ the old path
select pg_temp.mktrip('t1','tw','2027-05-01','2027-05-02');
do $$ begin
  perform pg_temp.login('admin');
  insert into public.role_permissions(role_id,permission,level)
    select id,'approval_delegate','edit' from public.roles
     where company_id=pg_temp.fx('company') and system_key='hr' on conflict do nothing;
  insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,configured_by)
    values(pg_temp.fx('company'),pg_temp.fx('hr'),pg_temp.fx('mgr'),'Fixture hr','Fixture mgr',pg_temp.fx('admin'));
end $$;
select pg_temp.assert('the delegate acts as HR (the old gate would have let them)',
  private.acts_as_travel_hr(pg_temp.fx('mgr'),pg_temp.fx('company')));
select pg_temp.expect('the delegate of an hr holder, with no toggle, is refused by app_correct_trip',
  pg_temp.err(pg_temp.correct('mgr','t1',null,'2027-05-03',null,'r')),'42501');
select pg_temp.expect('and by app_edit_request',
  pg_temp.err(pg_temp.edit('mgr','t1','day','2027-05-01','2027-05-03','full',null,null,null)),'42501');
select pg_temp.expect('the hr preset holder still corrects through the old RPC',
  pg_temp.err(pg_temp.correct('hr','t1',null,'2027-05-03',null,'r')),'ok');
select pg_temp.expect('trip dates moved',pg_temp.row_of('t1'),'day/2027-05-01/2027-05-03/full/-/-/1440/0/null');
select pg_temp.expect('app_correct_trip with nothing changed',
  pg_temp.correct('hr','t1',null,null,null,'r'),pg_temp.msg('22023','nothing to edit'));
select pg_temp.expect('a role with only the leave keys cannot correct a trip',
  pg_temp.err(pg_temp.correct('ed_daily','t1',null,'2027-05-04',null,'r')),'42501');
select pg_temp.mktrip('hr_own','hr','2027-05-20','2027-05-20',false,'hr2');
select pg_temp.expect('hr refused on their own trip',
  pg_temp.err(pg_temp.correct('hr','hr_own',null,'2027-05-21',null,'r')),'42501');
select pg_temp.expect('another hr holder may',pg_temp.err(pg_temp.correct('hr2','hr_own',null,'2027-05-21',null,'r')),'ok');
insert into tc_fx values('h1',pg_temp.hourly('tw','2027-05-10')::uuid);
select pg_temp.fin('h1');
select pg_temp.expect('app_correct_trip on an hourly errand keeps its refusal',
  pg_temp.correct('hr','h1',null,'2027-05-11',null,'r'),pg_temp.msg('22023','only an approved daily trip can be corrected'));

-- ============================================================ daily leave: shrink, grow, balance
select pg_temp.mk('s1','e2','annual','2027-06-01','2027-06-03');
select pg_temp.expect('fixture: three days consumed',pg_temp.ledger('s1')||'/'||pg_temp.bal('e2','annual'),'consumption:-1440/960');
select pg_temp.expect('shrink to two days',
  pg_temp.err(pg_temp.edit('ed_all','s1','day','2027-06-01','2027-06-02','full',null,null,null)),'ok');
select pg_temp.expect('minutes follow',pg_temp.row_of('s1'),'day/2027-06-01/2027-06-02/full/-/-/960/0/null');
select pg_temp.expect('one adjustment returns a day',pg_temp.ledger('s1'),'consumption:-1440,adjustment:480');
select pg_temp.expect('balance up by 480',pg_temp.bal('e2','annual'),'1440');
select pg_temp.expect('the ledger row carries the balance after',
  (select balance_after_minutes::text from public.leave_ledger where request_id=pg_temp.fx('s1') and entry_type='adjustment'),'1440');
select pg_temp.expect('the history row has both minutes and the unit',
  (select minutes_before||'/'||minutes_after||'/'||old_unit||'/'||new_unit||'/'||old_day_part||'/'||new_day_part
     from public.request_corrections where request_id=pg_temp.fx('s1')),'1440/960/day/day/full/full');
select pg_temp.expect('the history row has the dates and who',
  (select old_start_date||'/'||new_end_date||'/'||old_end_date||'/'||(corrected_by=pg_temp.fx('ed_all'))::text||'/'||(signature_data is not null)::text
     from public.request_corrections where request_id=pg_temp.fx('s1')),'2027-06-01/2027-06-02/2027-06-03/true/true');
select pg_temp.expect('grow back within the balance',
  pg_temp.err(pg_temp.edit('ed_all','s1','day','2027-06-01','2027-06-03','full',null,null,null)),'ok');
select pg_temp.expect('ledger takes it again',pg_temp.ledger('s1'),'consumption:-1440,adjustment:480,adjustment:-480');
select pg_temp.expect('balance back to 960',pg_temp.bal('e2','annual'),'960');
select pg_temp.expect('grow past the balance is refused',
  pg_temp.edit('ed_all','s1','day','2027-06-01','2027-06-06','full',null,null,null),pg_temp.msg('22023','an edit cannot make leave unpaid'));
select pg_temp.expect('that wrote nothing',
  pg_temp.row_of('s1')||'/'||pg_temp.bal('e2','annual')||'/'||pg_temp.history('s1'),'day/2027-06-01/2027-06-03/full/-/-/1440/0/null/960/2');
select pg_temp.expect('growing up to exactly the balance is fine',
  pg_temp.err(pg_temp.edit('ed_all','s1','day','2027-06-01','2027-06-05','full',null,null,null)),'ok');
select pg_temp.expect('now fully used',pg_temp.bal('e2','annual')||'/'||(select unpaid_minutes::text from public.leave_requests where id=pg_temp.fx('s1')),'0/0');

-- A request filed past the balance has an unpaid part.
select pg_temp.mk('u1','e3','annual','2027-07-01','2027-07-07');
select pg_temp.expect('fixture: paid 2400, unpaid 960',
  (select requested_minutes||'/'||unpaid_minutes from public.leave_requests where id=pg_temp.fx('u1'))||'/'||pg_temp.ledger('u1')||'/'||pg_temp.bal('e3','annual'),
  '3360/960/consumption:-2400/0');
select pg_temp.expect('shrink by a day: the unpaid part shrinks, nothing returns',
  pg_temp.err(pg_temp.edit('ed_all','u1','day','2027-07-01','2027-07-06','full',null,null,null)),'ok');
select pg_temp.expect('unpaid 480, no new ledger row',pg_temp.row_of('u1')||'/'||pg_temp.ledger('u1')||'/'||pg_temp.bal('e3','annual'),
  'day/2027-07-01/2027-07-06/full/-/-/2880/480/null/consumption:-2400/0');
select pg_temp.expect('growing the unpaid part is refused',
  pg_temp.edit('ed_all','u1','day','2027-07-01','2027-07-07','full',null,null,null),pg_temp.msg('22023','an edit cannot make leave unpaid'));
select pg_temp.expect('shrink into the paid part returns the surplus',
  pg_temp.err(pg_temp.edit('ed_all','u1','day','2027-07-01','2027-07-04','full',null,null,null)),'ok');
select pg_temp.expect('unpaid 0, 480 returned',pg_temp.row_of('u1')||'/'||pg_temp.ledger('u1')||'/'||pg_temp.bal('e3','annual'),
  'day/2027-07-01/2027-07-04/full/-/-/1920/0/null/consumption:-2400,adjustment:480/480');
select pg_temp.assert('no positive ledger row exceeds what the request consumed',
  (select coalesce(sum(delta_minutes) filter (where delta_minutes>0),0) <= 2400 from public.leave_ledger where request_id=pg_temp.fx('u1')));

-- A leave type that does not touch the balance.
select pg_temp.mk('np','e4','unpaid','2027-08-01','2027-08-03');
select pg_temp.expect('fixture: all unpaid',pg_temp.row_of('np'),'day/2027-08-01/2027-08-03/full/-/-/1440/1440/null');
select pg_temp.expect('shorten an unpaid leave',pg_temp.err(pg_temp.edit('ed_all','np','day','2027-08-01','2027-08-02','full',null,null,null)),'ok');
select pg_temp.expect('unpaid follows the minutes, no ledger row',pg_temp.row_of('np')||'/'||pg_temp.ledger('np'),
  'day/2027-08-01/2027-08-02/full/-/-/960/960/null/none');
select pg_temp.expect('half a day: unit and day part are one shape',
  pg_temp.err(pg_temp.edit('ed_all','np','day','2027-08-01','2027-08-01','am',null,null,null)),'ok');
select pg_temp.expect('half a day stored',pg_temp.row_of('np'),'day/2027-08-01/2027-08-01/am/-/-/240/240/null');

-- ============================================================ daily <-> hourly leave
select pg_temp.mk('dh','e5','annual','2027-09-01','2027-09-01');
create temp table dh_before as
  select r.replacement_id,r.signature_data,r.signature_consent_at,r.approver_signature_data,r.approver_signature_consent_at,
         r.decided_by,r.decided_at,r.status,r.leave_type_id,r.reason,r.created_at,
         (select string_agg(a.id::text||a.created_at::text,',' order by a.id) from public.leave_request_approvals a where a.request_id=r.id) approvals
    from public.leave_requests r where r.id=pg_temp.fx('dh');
select pg_temp.assert('fixture: the request has approval rows',(select approvals is not null from dh_before));
select pg_temp.expect('daily to hourly',
  pg_temp.err(pg_temp.edit('ed_all','dh','hour','2027-09-01','2027-09-01','full','09:00','11:00',null)),'ok');
select pg_temp.expect('an hourly shape',pg_temp.row_of('dh'),'hour/2027-09-01/2027-09-01/full/09:00:00/11:00:00/120/0/null');
select pg_temp.expect('360 minutes return',pg_temp.ledger('dh')||'/'||pg_temp.bal('e5','annual'),'consumption:-480,adjustment:360/2280');
select pg_temp.assert('replacement, signatures, decision and approvals are untouched',
  exists (select 1 from dh_before b join public.leave_requests r on r.id=pg_temp.fx('dh')
    where b.replacement_id is not distinct from r.replacement_id and b.signature_data=r.signature_data
      and b.signature_consent_at=r.signature_consent_at
      and b.approver_signature_data is not distinct from r.approver_signature_data
      and b.approver_signature_consent_at is not distinct from r.approver_signature_consent_at
      and b.decided_by is not distinct from r.decided_by and b.decided_at is not distinct from r.decided_at
      and b.status=r.status and b.leave_type_id=r.leave_type_id and b.reason is not distinct from r.reason
      and b.created_at=r.created_at
      and b.approvals is not distinct from (select string_agg(a.id::text||a.created_at::text,',' order by a.id)
            from public.leave_request_approvals a where a.request_id=r.id)));
select pg_temp.expect('the history row records the type change',
  (select old_unit||'>'||new_unit||'/'||coalesce(new_start_time::text,'-')||'-'||coalesce(new_end_time::text,'-')||'/'||coalesce(old_start_time::text,'-')
     ||'/'||minutes_before||'>'||minutes_after from public.request_corrections where request_id=pg_temp.fx('dh')),
  'day>hour/09:00:00-11:00:00/-/480>120');
select pg_temp.expect('hourly to a daily leave that would be unpaid is refused',
  pg_temp.edit('ed_all','dh','day','2027-09-01','2027-09-06','full',null,null,null),pg_temp.msg('22023','an edit cannot make leave unpaid'));
select pg_temp.expect('hourly to two days',
  pg_temp.err(pg_temp.edit('ed_all','dh','day','2027-09-01','2027-09-02','full',null,null,null)),'ok');
select pg_temp.expect('a daily shape again',pg_temp.row_of('dh'),'day/2027-09-01/2027-09-02/full/-/-/960/0/null');
select pg_temp.expect('840 more are consumed',pg_temp.ledger('dh')||'/'||pg_temp.bal('e5','annual'),
  'consumption:-480,adjustment:360,adjustment:-840/1440');
select pg_temp.mk('nh','e6','nohourly','2027-10-01','2027-10-01');
select pg_temp.expect('a leave type that cannot be taken hourly',
  pg_temp.edit('ed_all','nh','hour','2027-10-01','2027-10-01','full','09:00','10:00',null),
  pg_temp.msg('22023','this leave type cannot be taken hourly'));

-- ============================================================ hourly rules and overlap
select pg_temp.mk('hl','e7','gen','2027-11-01','2027-11-01');
select pg_temp.expect('five hours is over the daily limit',
  pg_temp.edit('ed_all','hl','hour','2027-11-01','2027-11-01','full','08:00','13:00',null),pg_temp.msg('22023','hourly leave exceeds the daily limit'));
select pg_temp.expect('outside working hours',
  pg_temp.edit('ed_all','hl','hour','2027-11-01','2027-11-01','full','06:00','08:00',null),pg_temp.msg('22023','times must fall within working hours'));
select pg_temp.expect('end before start',
  pg_temp.edit('ed_all','hl','hour','2027-11-01','2027-11-01','full','10:00','09:00',null),pg_temp.msg('22023','end time must be after start time'));
select pg_temp.expect('an hourly request is one day',
  pg_temp.edit('ed_all','hl','hour','2027-11-01','2027-11-02','full','09:00','10:00',null),pg_temp.msg('22023','end time must be after start time'));
select pg_temp.mkh('hx','e7','gen','2027-11-02','09:00','10:00');
select pg_temp.expect('another hourly leave that day',
  pg_temp.edit('ed_all','hl','hour','2027-11-02','2027-11-02','full','12:00','13:00',null),pg_temp.msg('22023','only one hourly leave per day'));
select pg_temp.expect('the request''s own hourly leave does not count against itself',
  pg_temp.err(pg_temp.edit('ed_all','hx','hour','2027-11-02','2027-11-02','full','10:00','12:00',null)),'ok');
select pg_temp.expect('hourly leave edited',pg_temp.row_of('hx'),'hour/2027-11-02/2027-11-02/full/10:00:00/12:00:00/120/0/null');
select pg_temp.mk('ov','e7','gen','2027-12-01','2027-12-01');
insert into tc_fx values('ov2',pg_temp.as_scalar('e7',format(
  'select public.submit_leave_request_v2(%L,''2027-12-10'',''2027-12-11'',''full'',%L,true)',pg_temp.fx('gen'),pg_temp.sig()))::uuid);
select pg_temp.expect('touching another pending request',
  pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-10','full',null,null,null),pg_temp.msg('22023','overlapping leave request exists'));
select pg_temp.expect('touching another approved request',
  pg_temp.edit('ed_all','ov','day','2027-11-02','2027-12-01','full',null,null,null),pg_temp.msg('22023','overlapping leave request exists'));
select pg_temp.expect('hourly on top of a daily request',
  pg_temp.edit('ed_all','hx','hour','2027-12-01','2027-12-01','full','10:00','11:00',null),pg_temp.msg('22023','overlapping leave request exists'));
select pg_temp.expect('a request''s own old range does not count',
  pg_temp.err(pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-02','full',null,null,null)),'ok');
select pg_temp.expect('overlap wrote nothing',pg_temp.row_of('ov'),'day/2027-12-01/2027-12-02/full/-/-/960/0/null');

-- ============================================================ trips and errands
-- trip -> hourly errand
select pg_temp.mktrip('t2','tw','2028-01-10','2028-01-12');
update public.leave_requests set per_diem_rials=1000000,per_diem_by_requester=true where id=pg_temp.fx('t2');
select pg_temp.expect('trip to an hourly errand',
  pg_temp.err(pg_temp.edit('ed_all','t2','hour','2028-01-10','2028-01-10','full','09:00','11:00',null)),'ok');
select pg_temp.expect('hourly errand: 120 minutes, no per diem, marker cleared',
  pg_temp.row_of('t2')||'/'||(select per_diem_by_requester::text from public.leave_requests where id=pg_temp.fx('t2')),
  'hour/2028-01-10/2028-01-10/full/09:00:00/11:00:00/120/0/null/false');
select pg_temp.expect('the cleared per diem is in the history',
  (select coalesce(per_diem_before::text,'null')||'>'||coalesce(per_diem_after::text,'null')||'/'||old_unit||'>'||new_unit
     from public.request_corrections where request_id=pg_temp.fx('t2')),'1000000>null/day>hour');
select pg_temp.expect('an errand has no ledger rows',pg_temp.ledger('t2'),'none');
-- booking started
select pg_temp.mktrip('t3','tw','2028-02-01','2028-02-02',true);
select pg_temp.expect('procurement has finished: refused',
  pg_temp.edit('ed_all','t3','hour','2028-02-01','2028-02-01','full','09:00','10:00',null),pg_temp.msg('22023','procurement has started booking this trip'));
select pg_temp.mktrip('t4','tw','2028-02-05','2028-02-06',true);
update public.travel_bookings set done_at=null,done_by=null where request_id=pg_temp.fx('t4');
select pg_temp.expect('first saved, not done: refused',
  pg_temp.edit('ed_all','t4','hour','2028-02-05','2028-02-05','full','09:00','10:00',null),pg_temp.msg('22023','procurement has started booking this trip'));
select pg_temp.expect('that wrote nothing',pg_temp.row_of('t4')||'/'||pg_temp.history('t4'),'day/2028-02-05/2028-02-06/full/-/-/960/0/null/0');
select pg_temp.mktrip('t6','tw','2028-03-01','2028-03-02',true);
update public.travel_bookings set done_at=null,done_by=null,first_saved_at=null,first_done_at=null where request_id=pg_temp.fx('t6');
select pg_temp.assert('fixture: a ticked, opened, not started booking',
  exists(select 1 from public.travel_bookings where request_id=pg_temp.fx('t6') and opened_at is not null));
select pg_temp.expect('a ticked but not started booking does not block',
  pg_temp.err(pg_temp.edit('ed_all','t6','hour','2028-03-01','2028-03-01','full','09:00','10:00',null)),'ok');
select pg_temp.expect('and it is deleted',(select count(*)::text from public.travel_bookings where request_id=pg_temp.fx('t6')),'0');
-- pending extension
select pg_temp.mktrip('t5','tw','2028-04-01','2028-04-02',true);
select pg_temp.expect('extension requested',pg_temp.err(pg_temp.as_scalar('mgr',format(
  'select public.app_request_errand_extension(%L,''2028-04-04'',''more work'')::text',pg_temp.fx('t5')))),'ok');
select pg_temp.expect('refused while an extension waits (to hourly)',
  pg_temp.edit('ed_all','t5','hour','2028-04-01','2028-04-01','full','09:00','10:00',null),pg_temp.msg('22023','an extension is waiting for HR'));
select pg_temp.expect('refused while an extension waits (dates)',
  pg_temp.edit('ed_all','t5','day','2028-04-01','2028-04-03','full',null,null,null),pg_temp.msg('22023','an extension is waiting for HR'));
-- hourly errand -> trip
insert into tc_fx values('h2',pg_temp.hourly('tw','2028-05-10')::uuid);
select pg_temp.fin('h2');
select pg_temp.expect('hourly errand to a trip with a per diem',
  pg_temp.err(pg_temp.edit('ed_all','h2','day','2028-05-10','2028-05-11','full',null,null,'500000')),'ok');
select pg_temp.expect('a daily trip with 500000',pg_temp.row_of('h2'),'day/2028-05-10/2028-05-11/full/-/-/960/0/500000');
select pg_temp.expect('no ledger row',pg_temp.ledger('h2'),'none');
select pg_temp.expect('and no booking was created',(select count(*)::text from public.travel_bookings where request_id=pg_temp.fx('h2')),'0');
-- trip dates through app_edit_request
select pg_temp.mktrip('t7','tw','2028-06-01','2028-06-03',true);
update public.travel_bookings set done_at=now(),done_by=pg_temp.fx('hr') where request_id=pg_temp.fx('t7');
select pg_temp.expect('trip dates through app_edit_request',
  pg_temp.err(pg_temp.edit('ed_all','t7','day','2028-06-01','2028-06-05','full',null,null,null)),'ok');
select pg_temp.expect('booking goes back to procurement',
  (select (done_at is null and done_by is null)::text from public.travel_bookings where request_id=pg_temp.fx('t7')),'true');
select pg_temp.expect('minutes of a five day trip',pg_temp.row_of('t7'),'day/2028-06-01/2028-06-05/full/-/-/2400/0/null');
select pg_temp.expect('per diem alone: null leaves it, a number sets it',
  pg_temp.err(pg_temp.edit('ed_all','t7','day','2028-06-01','2028-06-05','full',null,null,'750000')),'ok');
select pg_temp.expect('per diem stored',pg_temp.row_of('t7'),'day/2028-06-01/2028-06-05/full/-/-/2400/0/750000');
select pg_temp.expect('null keeps it',
  pg_temp.err(pg_temp.edit('ed_all','t7','day','2028-06-01','2028-06-06','full',null,null,null)),'ok');
select pg_temp.expect('per diem kept',pg_temp.row_of('t7'),'day/2028-06-01/2028-06-06/full/-/-/2880/0/750000');
select pg_temp.expect('an errand edit needs the errand keys of the family',
  pg_temp.err(pg_temp.edit('ed_daily','t7','day','2028-06-01','2028-06-07','full',null,null,null)),'42501');
select pg_temp.expect('a hourly errand overlapping a trip',
  pg_temp.edit('ed_all','h1','hour','2028-06-02','2028-06-02','full','09:00','10:00',null),pg_temp.msg('22023','overlapping leave request exists'));
select pg_temp.expect('a trip overlapping another trip',
  pg_temp.edit('ed_all','t7','day','2028-05-10','2028-06-06','full',null,null,null),pg_temp.msg('22023','overlapping leave request exists'));

-- ============================================================ input
select pg_temp.expect('the same values are nothing to edit',
  pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-02','full',null,null,null),pg_temp.msg('22023','nothing to edit'));
select pg_temp.expect('a reason of spaces',
  pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-03','full',null,null,null,'   '),pg_temp.msg('22023','a reason is required'));
select pg_temp.expect('a reason that is too long',
  pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-03','full',null,null,null,repeat('x',1001)),pg_temp.msg('22023','reason is too long'));
select pg_temp.expect('1000 characters are fine',
  pg_temp.err(pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-03','full',null,null,null,repeat('x',1000))),'ok');
select pg_temp.expect('no signature',
  pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-04','full',null,null,null,'r','not-a-png'),pg_temp.msg('22023','signature is required'));
select pg_temp.expect('signature not authorized',
  pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-04','full',null,null,null,'r',null,false),pg_temp.msg('22023','signature is required'));
select pg_temp.expect('negative per diem',
  pg_temp.edit('ed_all','t7','day','2028-06-01','2028-06-06','full',null,null,'-1'),pg_temp.msg('22023','per diem must be 0 or more'));
select pg_temp.expect('end before start',
  pg_temp.edit('ed_all','ov','day','2027-12-05','2027-12-04','full',null,null,null),pg_temp.msg('22023','start date must not be after end date'));
select pg_temp.expect('missing dates',
  pg_temp.err(pg_temp.edit('ed_all','ov',null,null,null,'full',null,null,null)),'22023');
select pg_temp.expect('a daily request takes no times',
  pg_temp.err(pg_temp.edit('ed_all','ov','day','2027-12-01','2027-12-04','full','09:00','10:00',null)),'22023');
select pg_temp.expect('those wrote nothing',pg_temp.row_of('ov'),'day/2027-12-01/2027-12-03/full/-/-/1440/0/null');
select pg_temp.assert('the audit rows hold values and no signature bytes',
  (select count(*)>=10 and bool_and((coalesce(before::text,'')||coalesce(after::text,'')) not like '%data:image%')
     from public.audit_log where action='request.edit'));
select pg_temp.expect('the audit row names the request and both values',
  (select (after->>'unit')||'/'||(before->>'unit')||'/'||(after->>'requested_minutes')||'/'||(before->>'requested_minutes')
     from public.audit_log where action='request.edit' and entity_id=pg_temp.fx('dh') and after->>'unit'='hour'),'hour/day/120/480');
select pg_temp.assert('no signature in the history read',
  pg_get_function_result('public.request_trip_corrections(uuid)'::regprocedure) not like '%signature%');
select pg_temp.expect('the history read has the new columns',
  (select string_agg(a.attname,',' order by a.attnum) from pg_proc p, unnest(p.proargnames) with ordinality a(attname,attnum)
    where p.oid='public.request_trip_corrections(uuid)'::regprocedure and a.attnum>10),
  'old_unit,new_unit,old_day_part,new_day_part,old_start_time,new_start_time,old_end_time,new_end_time,minutes_before,minutes_after');
select pg_temp.expect('the requester reads their request''s edits',pg_temp.as_scalar('e7',format(
  'select count(*)::text from public.request_trip_corrections(%L)',pg_temp.fx('ov'))),'2');
select pg_temp.expect('the reader sees the new fields',pg_temp.as_scalar('e2',format(
  'select string_agg(minutes_before||''>''||minutes_after,'','' order by corrected_at) from public.request_trip_corrections(%L)',pg_temp.fx('s1'))),
  '1440>960,960>1440,1440>2400');
select pg_temp.expect('a stranger gets not found',pg_temp.err(pg_temp.as_scalar('e2',format(
  'select count(*)::text from public.request_trip_corrections(%L)',pg_temp.fx('ov')))),'P0002');
select pg_temp.expect('the print aggregate still compiles and carries the new fields',pg_temp.as_scalar('e7',format(
  'select (public.app_request_print(%L)->''corrections''->0->>''minutes_after'')',pg_temp.fx('ov'))),'960');
rollback;
