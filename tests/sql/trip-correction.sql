-- HR corrects dates and per diem on an approved daily work trip (FR-84, 2026-11-05).
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
-- Daily errand as p_actor; returns the request id or 'ERROR <sqlstate> …'.
create function pg_temp.daily(p_actor text,p_start date,p_end date,p_per_diem bigint default null) returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Shiraz'',%L,true,''Site visit'',false,null,false,%s)',
    p_start,p_end,pg_temp.sig(),coalesce(p_per_diem::text,'null')));
$$;
create function pg_temp.hourly(p_actor text,p_date date) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_errand_request_v2(%L,''08:00'',''09:00'',''Fixture location'',%L,true)',p_date,pg_temp.sig()));
$$;
-- Approve as p_actor on step p_step (null = admin override when p_override).
create function pg_temp.approve(p_actor text,p_req text,p_step text,p_override boolean default false,p_per_diem bigint default null) returns text
language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_v2(%L,%L,%L,true,%L,%s)::text',
    pg_temp.fx(p_req),pg_temp.fx(p_step),pg_temp.sig(),p_override,coalesce(p_per_diem::text,'null'))));
$$;
-- Superuser view of a request's booking state.
create function pg_temp.state(p_req text) returns text language sql as $$
  select coalesce((select private.travel_booking_state(r.status,b) from public.leave_requests r
    join public.travel_bookings b on b.request_id=r.id where r.id=pg_temp.fx(p_req)),'none');
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Trip correction synthetic fixture');
  insert into tc_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','TB');
  for who in select * from (values
    ('admin','admin','9990071001'),('mgr','manager','9990071002'),('hr','hr','9990071003'),
    ('hr2','hr','9990071004'),('head','hr','9990071005'),('proc','procurement','9990071006'),
    ('proc2','procurement','9990071007'),('worker','employee','9990071008'),
    ('worker2','employee','9990071009'),('mgr2','manager','9990071010')) t(k,role,code) loop
    insert into tc_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@correction-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('mgr')
    where id in (pg_temp.fx('worker'),pg_temp.fx('worker2'),pg_temp.fx('hr2'),pg_temp.fx('head'),
                 pg_temp.fx('proc'),pg_temp.fx('proc2'),pg_temp.fx('hr'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into tc_fx values('mgr_step',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into tc_fx values('hr_step',v_id);
  update public.employee_personal_info set national_id='0012345679',birth_date='1990-01-01',
    mobile='09120000000',gender='male' where employee_id=pg_temp.fx('worker2');
end; $$;


insert into tc_fx(k,id) select 'none',gen_random_uuid();
create function pg_temp.correct(p_actor text,p_req text,p_start text,p_end text,p_per_diem text,p_reason text,
  p_sig text default null,p_auth boolean default true) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.app_correct_trip(%L,%s,%s,%s,%L,%L,%L)::text',pg_temp.fx(p_req),
    coalesce(quote_literal(p_start)||'::date','null'),coalesce(quote_literal(p_end)||'::date','null'),
    coalesce(p_per_diem,'null'),p_reason,coalesce(p_sig,pg_temp.sig()),p_auth));
$$;
-- An approved daily trip for p_actor, with optional booking; superuser shortcuts past the chain.
create function pg_temp.trip(p_key text,p_actor text,p_start date,p_end date,p_booked boolean default false,p_hr text default 'hr') returns void
language plpgsql as $$
begin
  insert into tc_fx values(p_key,pg_temp.daily(p_actor,p_start,p_end)::uuid);
  if p_booked then
    perform pg_temp.as_scalar('hr',format('select public.app_set_travel_booking(%L,true)::text',pg_temp.fx(p_key)));
  end if;
  perform pg_temp.approve('mgr',p_key,'mgr_step');
  perform pg_temp.approve(p_hr,p_key,'hr_step');
  if (select status from public.leave_requests where id=pg_temp.fx(p_key))<>'approved' then
    raise exception 'fixture: % not approved',p_key; end if;
  if p_booked then
    update public.travel_bookings set done_at=now(),first_done_at=now(),done_by=pg_temp.fx('proc') where request_id=pg_temp.fx(p_key);
  end if;
end; $$;
create function pg_temp.row_of(p_req text) returns text language sql as $$
  select start_date||'/'||end_date||'/'||requested_minutes||'/'||coalesce(per_diem_rials::text,'null')
    from public.leave_requests where id=pg_temp.fx(p_req);
$$;
create function pg_temp.history(p_req text) returns text language sql as $$
  select count(*)::text from public.request_corrections where request_id=pg_temp.fx(p_req);
$$;

-- ============================================================ the correction
select pg_temp.trip('booked','worker2','2027-03-01','2027-03-03',true);
select pg_temp.expect('fixture booked trip is done',pg_temp.state('booked'),'done');
select pg_temp.expect('hr moves the end later',pg_temp.err(pg_temp.correct('hr','booked',null,'2027-03-05',null,'  wrong end date ')),'ok');
select pg_temp.expect('dates and minutes move',pg_temp.row_of('booked'),'2027-03-01/2027-03-05/2400/null');
select pg_temp.expect('booking goes back to procurement',pg_temp.state('booked'),'corrected');
select pg_temp.expect('done cleared',(select (done_at is null and done_by is null)::text from public.travel_bookings where request_id=pg_temp.fx('booked')),'true');
select pg_temp.expect('history keeps all six values',
  (select old_start_date||'/'||new_start_date||'/'||old_end_date||'/'||new_end_date||'/'||coalesce(per_diem_before::text,'null')||'/'||coalesce(per_diem_after::text,'null')||'/'||reason
     from public.request_corrections where request_id=pg_temp.fx('booked')),
  '2027-03-01/2027-03-01/2027-03-03/2027-03-05/null/null/wrong end date');
select pg_temp.expect('who and the signature are stored',
  (select (corrected_by=pg_temp.fx('hr'))::text||'/'||(signature_data is not null)::text||'/'||(signature_consent_at is not null)::text
     from public.request_corrections where request_id=pg_temp.fx('booked')),'true/true/true');
select pg_temp.expect('audit has before and after, no signature',
  (select count(*)::text from public.audit_log where action='trip.correct' and entity_id=pg_temp.fx('booked')
     and before->>'end_date'='2027-03-03' and after->>'end_date'='2027-03-05' and (after::text||before::text) not like '%base64%'),'1');
select pg_temp.expect('start moves earlier',pg_temp.err(pg_temp.correct('hr','booked','2027-02-27',null,null,'r')),'ok');
select pg_temp.expect('start moved',pg_temp.row_of('booked'),'2027-02-27/2027-03-05/3360/null');
select pg_temp.expect('both shorter',pg_temp.err(pg_temp.correct('hr','booked','2027-03-01','2027-03-02',null,'r')),'ok');
select pg_temp.expect('shortened',pg_temp.row_of('booked'),'2027-03-01/2027-03-02/960/null');
select pg_temp.expect('three rows of history',pg_temp.history('booked'),'3');

-- Per diem alone leaves the booking alone.
select pg_temp.trip('perdiem','worker2','2027-05-01','2027-05-01',true);
select pg_temp.expect('per diem added',pg_temp.err(pg_temp.correct('hr','perdiem',null,null,'2500000','forgot it')),'ok');
select pg_temp.expect('per diem stored',pg_temp.row_of('perdiem'),'2027-05-01/2027-05-01/480/2500000');
select pg_temp.expect('booking stays done',pg_temp.state('perdiem'),'done');
select pg_temp.expect('per diem can go to 0',pg_temp.err(pg_temp.correct('hr','perdiem',null,null,'0','no per diem after all')),'ok');
select pg_temp.expect('history records the money',
  (select string_agg(coalesce(per_diem_before::text,'null')||'>'||coalesce(per_diem_after::text,'null'),',' order by corrected_at)
     from public.request_corrections where request_id=pg_temp.fx('perdiem')),'null>2500000,2500000>0');

-- The Head of HR's own amount is replaced by a correction.
select pg_temp.trip('own_pd','worker','2027-05-10','2027-05-10');
update public.leave_requests set per_diem_rials=100,per_diem_by_requester=true where id=pg_temp.fx('own_pd');
select pg_temp.expect('a correction clears the requester marker',pg_temp.err(pg_temp.correct('hr','own_pd',null,null,'200','r')),'ok');
select pg_temp.expect('marker cleared',(select per_diem_by_requester::text from public.leave_requests where id=pg_temp.fx('own_pd')),'false');

-- No booking and ended trips are fine.
select pg_temp.trip('plain','worker','2027-06-01','2027-06-02');
select pg_temp.expect('trip with no booking',pg_temp.err(pg_temp.correct('hr','plain',null,'2027-06-03',null,'r')),'ok');
update public.leave_requests set start_date='2026-01-01',end_date='2026-01-02' where id=pg_temp.fx('plain');
select pg_temp.expect('an ended trip',pg_temp.err(pg_temp.correct('hr','plain',null,'2026-01-03',null,'r')),'ok');
select pg_temp.expect('admin on another trip',pg_temp.err(pg_temp.correct('admin','plain',null,'2026-01-04',null,'r')),'ok');

-- ============================================================ who
select pg_temp.trip('hrs_own','hr','2027-07-01','2027-07-01',false,'hr2');
select pg_temp.expect('hr refused on own trip',pg_temp.err(pg_temp.correct('hr','hrs_own',null,'2027-07-02',null,'r')),'42501');
select pg_temp.expect('another hr holder may',pg_temp.err(pg_temp.correct('hr2','hrs_own',null,'2027-07-02',null,'r')),'ok');
select pg_temp.expect('the traveller refused',pg_temp.err(pg_temp.correct('worker','plain',null,'2026-01-05',null,'r')),'42501');
select pg_temp.expect('the manager refused',pg_temp.err(pg_temp.correct('mgr','plain',null,'2026-01-05',null,'r')),'42501');
select pg_temp.expect('procurement refused',pg_temp.err(pg_temp.correct('proc','plain',null,'2026-01-05',null,'r')),'42501');

-- An hr holder's delegate acts as HR, but never on that hr holder's own trip.
do $$
begin
  perform pg_temp.login('admin');
  insert into public.role_permissions(role_id,permission,level)
    select id,'approval_delegate','edit' from public.roles
     where company_id=pg_temp.fx('company') and system_key='hr'
    on conflict do nothing;
  insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,configured_by)
    values(pg_temp.fx('company'),pg_temp.fx('hr'),pg_temp.fx('mgr'),'Fixture hr','Fixture mgr',pg_temp.fx('admin'));
end; $$;
select pg_temp.assert('the delegate acts as HR',private.acts_as_travel_hr(pg_temp.fx('mgr'),pg_temp.fx('company')));
select pg_temp.expect('the delegate may correct someone else''s trip',
  pg_temp.err(pg_temp.correct('mgr','plain',null,'2026-01-06',null,'r')),'ok');
select pg_temp.expect('the delegate refused on the principal''s own trip',
  pg_temp.err(pg_temp.correct('mgr','hrs_own',null,'2027-07-03',null,'r')),'42501');
select pg_temp.expect('that refusal wrote nothing',
  (select end_date::text from public.leave_requests where id=pg_temp.fx('hrs_own')),'2027-07-02');
do $$ begin
  perform pg_temp.login('admin');
  delete from public.approval_delegations where principal_id=pg_temp.fx('hr');
end; $$;

-- ============================================================ what can be corrected
insert into tc_fx values('pending',pg_temp.daily('worker','2027-08-01','2027-08-01')::uuid);
select pg_temp.expect('pending refused',pg_temp.err(pg_temp.correct('hr','pending',null,'2027-08-02',null,'r')),'22023');
select pg_temp.as_scalar('worker',format('select public.cancel_leave_request(%L)::text',pg_temp.fx('pending')));
select pg_temp.expect('cancelled refused',pg_temp.err(pg_temp.correct('hr','pending',null,'2027-08-02',null,'r')),'22023');
insert into tc_fx values('hourly',pg_temp.hourly('worker','2027-08-05')::uuid);
select pg_temp.approve('mgr','hourly','mgr_step');
select pg_temp.approve('hr','hourly','hr_step');
select pg_temp.expect('hourly errand refused',(pg_temp.correct('hr','hourly',null,'2027-08-06',null,'r') like 'ERROR 22023%only an approved daily trip%')::text,'true');

do $$
declare v_type uuid; v_id uuid;
begin
  perform pg_temp.login('admin');
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid)
    values(pg_temp.fx('company'),'سالانه','Fixture annual',false,true) returning id into v_type;
  insert into tc_fx values('annual',v_type);
end; $$;
insert into tc_fx values('leave',pg_temp.as_scalar('worker',format(
  'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)',pg_temp.fx('annual'),'2027-08-10','2027-08-11',pg_temp.sig()))::uuid);
select pg_temp.approve('mgr','leave','mgr_step');
select pg_temp.approve('hr','leave','hr_step');
select pg_temp.expect('regular leave refused',(pg_temp.correct('hr','leave',null,'2027-08-12',null,'r') like 'ERROR 22023%only an approved daily trip%')::text,'true');

select pg_temp.trip('ext','worker2','2027-09-01','2027-09-02',true);
select pg_temp.expect('extension requested',pg_temp.err(pg_temp.as_scalar('mgr',format(
  'select public.app_request_errand_extension(%L,''2027-09-04'',''more work'')::text',pg_temp.fx('ext')))),'ok');
select pg_temp.expect('refused while an extension waits',(pg_temp.correct('hr','ext',null,'2027-09-03',null,'r') like 'ERROR 22023%extension is waiting%')::text,'true');
select pg_temp.expect('nothing written',pg_temp.history('ext'),'0');

select pg_temp.trip('blocker','worker','2027-10-05','2027-10-05');
select pg_temp.trip('o','worker','2027-10-01','2027-10-02');
select pg_temp.expect('overlap refused',(pg_temp.correct('hr','o',null,'2027-10-05',null,'r') like 'ERROR 22023%overlapping%')::text,'true');
select pg_temp.expect('overlap wrote nothing',pg_temp.row_of('o'),'2027-10-01/2027-10-02/960/null');

-- ============================================================ input
select pg_temp.expect('reason of spaces',(pg_temp.correct('hr','o',null,'2027-10-03',null,'   ') like 'ERROR 22023%reason%')::text,'true');
select pg_temp.expect('reason too long',pg_temp.err(pg_temp.correct('hr','o',null,'2027-10-03',null,repeat('x',1001))),'22023');
select pg_temp.expect('1000 characters allowed',pg_temp.err(pg_temp.correct('hr','o',null,'2027-10-03',null,repeat('x',1000))),'ok');
select pg_temp.expect('nothing to correct',(pg_temp.correct('hr','o',null,null,null,'r') like 'ERROR 22023%nothing to correct%')::text,'true');
select pg_temp.expect('same values are nothing',(pg_temp.correct('hr','o','2027-10-01','2027-10-03',null,'r') like 'ERROR 22023%nothing to correct%')::text,'true');
select pg_temp.expect('start alone past the end',(pg_temp.correct('hr','o','2027-10-04',null,null,'r') like 'ERROR 22023%start date must not be after end date%')::text,'true');
select pg_temp.expect('negative per diem',(pg_temp.correct('hr','o',null,null,'-1','r') like 'ERROR 22023%per diem must be 0 or more%')::text,'true');
select pg_temp.expect('no signature',pg_temp.err(pg_temp.correct('hr','o',null,'2027-10-04',null,'r','not-a-png')),'22023');
select pg_temp.expect('not authorized',pg_temp.err(pg_temp.correct('hr','o',null,'2027-10-04',null,'r',null,false)),'22023');
select pg_temp.expect('those wrote nothing',pg_temp.row_of('o'),'2027-10-01/2027-10-03/1440/null');

-- ============================================================ booking state order
select pg_temp.trip('order1','worker2','2027-11-01','2027-11-02',true);
select pg_temp.expect('correct first',pg_temp.err(pg_temp.correct('hr','order1',null,'2027-11-03',null,'r')),'ok');
select pg_temp.expect('then corrected',pg_temp.state('order1'),'corrected');
select pg_temp.expect('extension requested after',pg_temp.err(pg_temp.as_scalar('mgr',format(
  'select public.app_request_errand_extension(%L,''2027-11-05'',''more'')::text',pg_temp.fx('order1')))),'ok');
create function pg_temp.decide(p_req text) returns text language plpgsql as $$
declare v_ext uuid; begin
  select id into v_ext from public.errand_extensions where request_id=pg_temp.fx(p_req) and status='pending';
  return pg_temp.err(pg_temp.as_scalar('hr',format(
    'select public.app_decide_errand_extension(%L,true,%L,true,null,null)::text',v_ext,pg_temp.sig())));
end; $$;
select pg_temp.expect('extension decided',pg_temp.decide('order1'),'ok');
select pg_temp.expect('the newer extension wins',pg_temp.state('order1'),'extension');
select pg_temp.expect('a later correction wins again',pg_temp.err(pg_temp.correct('hr','order1',null,'2027-11-06',null,'r')),'ok');
select pg_temp.expect('corrected again',pg_temp.state('order1'),'corrected');
select pg_temp.assert('corrected stays open for traveller details',
  private.travel_booking_open_for_details('corrected','2027-11-06'));
select pg_temp.expect('the traveller sees it as pending booking',pg_temp.as_scalar('worker2',format(
  'select count(*)::text from public.my_travel_pending() p where p=%L',pg_temp.fx('order1'))),'1');

select pg_temp.expect('an extension''s per diem change is readable for the print form',
  pg_temp.as_scalar('worker2',format(
    'select count(*)::text from public.request_errand_extensions(%L) where per_diem_after is not distinct from per_diem_before and status=''approved''',
    pg_temp.fx('order1'))),'1');
select pg_temp.expect('procurement re-saves a corrected booking',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_save_travel_booking(%L,''company_car'',0,0,''note'',true)::text',pg_temp.fx('order1')))),'ok');
select pg_temp.expect('and it is done again',pg_temp.state('order1'),'done');

-- ============================================================ reads
select pg_temp.expect('procurement reads the latest correction',pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)->''last_correction''->>''new_end_date''',pg_temp.fx('order1'))),'2027-11-06');
select pg_temp.expect('the keys it gets',pg_temp.as_scalar('proc',format(
  'select string_agg(k,'','' order by k) from jsonb_object_keys(public.app_travel_booking(%L)->''last_correction'') k',pg_temp.fx('order1'))),
  'new_end_date,new_start_date,old_end_date,old_start_date,reason');
select pg_temp.expect('no correction reads null',pg_temp.as_scalar('proc',format(
  'select coalesce(public.app_travel_booking(%L)->>''last_correction'',''none'')',pg_temp.fx('perdiem'))),'none');
select pg_temp.expect('the traveller reads their history',pg_temp.as_scalar('worker2',format(
  'select count(*)::text from public.request_trip_corrections(%L)',pg_temp.fx('order1'))),'2');
select pg_temp.expect('with the corrector''s name',pg_temp.as_scalar('worker2',format(
  'select max(corrected_by_name) from public.request_trip_corrections(%L)',pg_temp.fx('order1'))),'Fixture hr');
select pg_temp.expect('an unrelated person gets not found',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select count(*)::text from public.request_trip_corrections(%L)',pg_temp.fx('order1')))),'P0002');
select pg_temp.assert('no signature column in the read',
  pg_get_function_result('public.request_trip_corrections(uuid)'::regprocedure) not like '%signature%');
select pg_temp.expect('client cannot read the table',
  left(pg_temp.as_scalar('hr','select count(*)::text from public.request_corrections'),9),'ERROR 425');
select pg_temp.expect('client cannot write the table',
  left(pg_temp.as_scalar('hr',format('insert into public.request_corrections(request_id) values(%L) returning 1',pg_temp.fx('order1'))),9),'ERROR 425');
select pg_temp.expect('finance sees the date of the correction',pg_temp.as_scalar('admin',format(
  'select (corrected_at is not null)::text from public.finance_requests(''2027-01-01'',''2027-12-31'') where id=%L',pg_temp.fx('perdiem'))),'true');
select pg_temp.expect('an untouched trip has none',pg_temp.as_scalar('admin',format(
  'select (corrected_at is null)::text from public.finance_requests(''2027-01-01'',''2027-12-31'') where id=%L',pg_temp.fx('blocker'))),'true');
select pg_temp.assert('anon cannot correct',
  not has_function_privilege('anon','public.app_correct_trip(uuid,date,date,bigint,text,text,boolean)','EXECUTE'));
select pg_temp.assert('anon cannot read history',
  not has_function_privilege('anon','public.request_trip_corrections(uuid)','EXECUTE'));
rollback;
