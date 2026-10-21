-- Structured travel itinerary (FR-73, 2026-10-21).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table tb_fx(k text primary key,id uuid not null);
grant select on tb_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from tb_fx where k=p_key;
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

-- Itinerary save as p_actor (v2); returns 'ok' or the SQLSTATE.
create function pg_temp.save2(p_actor text,p_req text,p_transport text,p_flight bigint,p_hotel bigint,p_it jsonb,p_done boolean) returns text
language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.app_save_travel_booking_v2(%L,%L,%s,%s,%L::jsonb,null,%L)::text',pg_temp.fx(p_req),p_transport,
    coalesce(p_flight::text,'null'),coalesce(p_hotel::text,'null'),p_it,p_done)));
$$;
-- Same, but the raw error message (to check which rule fired).
create function pg_temp.save2_msg(p_actor text,p_req text,p_transport text,p_hotel bigint,p_it jsonb,p_done boolean) returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.app_save_travel_booking_v2(%L,%L,0,%s,%L::jsonb,null,%L)::text',pg_temp.fx(p_req),p_transport,
    coalesce(p_hotel::text,'null'),p_it,p_done));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Travel itinerary synthetic fixture');
  insert into tb_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','TI');
  for who in select * from (values
    ('admin','admin','9990073001'),('mgr','manager','9990073002'),('hr','hr','9990073003'),
    ('proc','procurement','9990073004'),('worker','employee','9990073005')) t(k,role,code) loop
    insert into tb_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@itinerary-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('mgr')
    where id in (pg_temp.fx('worker'),pg_temp.fx('hr'),pg_temp.fx('proc'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into tb_fx values('mgr_step',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into tb_fx values('hr_step',v_id);
end; $$;

-- An approved, ticked trip 2027-03-01 … 2027-03-03.
insert into tb_fx values('trip',pg_temp.daily('worker','2027-03-01','2027-03-03')::uuid);
select pg_temp.expect('hr ticks',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('trip')))),'ok');
select pg_temp.expect('manager approves',pg_temp.approve('mgr','trip','mgr_step'),'ok');
select pg_temp.expect('hr approves',pg_temp.approve('hr','trip','hr_step'),'ok');
select pg_temp.expect('to book',pg_temp.state('trip'),'to_book');

-- ============================================================ drafts and shape
select pg_temp.expect('draft with partial legs',pg_temp.save2('proc','trip','flight',null,null,
  '{"flights":[{"leg":"outbound","airline":"Iran Air"}],"stays":[{"name":"Homa"}]}',false),'ok');
select pg_temp.expect('itinerary stored',(select itinerary->'flights'->0->>'airline' from public.travel_bookings
  where request_id=pg_temp.fx('trip')),'Iran Air');
select pg_temp.expect('not procurement',pg_temp.save2('worker','trip','flight',null,null,'{}',false),'42501');
select pg_temp.expect('unknown top key',pg_temp.save2('proc','trip','flight',null,null,'{"x":1}',false),'22023');
select pg_temp.expect('unknown leg key',pg_temp.save2('proc','trip','flight',null,null,
  '{"flights":[{"leg":"outbound","seat":"1A"}]}',false),'22023');
select pg_temp.expect('non-string field',pg_temp.save2('proc','trip','flight',null,null,
  '{"flights":[{"leg":"outbound","flight_no":99}]}',false),'22023');
select pg_temp.expect('duplicate leg',pg_temp.save2('proc','trip','flight',null,null,
  '{"flights":[{"leg":"outbound"},{"leg":"outbound"}]}',false),'22023');
select pg_temp.expect('return leg on one way',pg_temp.save2('proc','trip','flight',null,null,
  '{"one_way":true,"flights":[{"leg":"return","flight_no":"A1"}]}',false),'22023');
select pg_temp.expect('flights need flight transport',pg_temp.save2('proc','trip','company_car',null,null,
  '{"flights":[{"leg":"outbound"}]}',false),'22023');
select pg_temp.expect('non-boolean one_way',pg_temp.save2('proc','trip','flight',null,null,'{"one_way":"yes"}',false),'22023');
select pg_temp.assert('text cap',pg_temp.save2_msg('proc','trip','flight',null,
  jsonb_build_object('stays',jsonb_build_array(jsonb_build_object('name',repeat('x',101)))),false) like '%text is too long%');
select pg_temp.expect('address allows 200',pg_temp.save2('proc','trip','flight',null,null,
  jsonb_build_object('stays',jsonb_build_array(jsonb_build_object('address',repeat('x',200)))),false),'ok');
select pg_temp.assert('bad date',pg_temp.save2_msg('proc','trip','flight',null,
  '{"flights":[{"leg":"outbound","date":"2027-02-30"}]}',false) like '%invalid itinerary date%');
select pg_temp.assert('date outside the trip window',pg_temp.save2_msg('proc','trip','flight',null,
  '{"flights":[{"leg":"outbound","date":"2027-02-21"}]}',false) like '%outside the trip%');
select pg_temp.expect('a week early is fine',pg_temp.save2('proc','trip','flight',null,null,
  '{"flights":[{"leg":"outbound","date":"2027-02-22"}]}',false),'ok');
select pg_temp.assert('bad time',pg_temp.save2_msg('proc','trip','flight',null,
  '{"flights":[{"leg":"outbound","departs":"9:00"}]}',false) like '%invalid itinerary time%');
select pg_temp.assert('check-out after check-in',pg_temp.save2_msg('proc','trip','flight',null,
  '{"stays":[{"check_in":"2027-03-02","check_out":"2027-03-02"}]}',false) like '%check-out must be after%');
select pg_temp.assert('at most 10 stays',pg_temp.save2_msg('proc','trip','flight',null,
  (select jsonb_build_object('stays',jsonb_agg(jsonb_build_object('name','H'||g))) from generate_series(1,11) g),false)
  like '%too many hotel stays%');
select pg_temp.expect('stays with no_hotel',pg_temp.save2('proc','trip','flight',null,null,
  '{"no_hotel":true,"stays":[{"name":"H"}]}',false),'22023');

-- ============================================================ «رزرو شد»
select pg_temp.assert('done needs both legs',pg_temp.save2_msg('proc','trip','flight',10,
  '{"flights":[{"leg":"outbound","flight_no":"AC99","date":"2027-03-01","departs":"09:00"}],"no_hotel":true}',true)
  like '%flight details are required%');
select pg_temp.assert('done needs a complete stay',pg_temp.save2_msg('proc','trip','flight',10,
  '{"one_way":true,"flights":[{"leg":"outbound","flight_no":"AC99","date":"2027-03-01","departs":"09:00"}],"stays":[{"name":"Homa","check_in":"2027-03-01"}]}',true)
  like '%hotel details are required%');
select pg_temp.assert('no hotel needs cost 0',pg_temp.save2_msg('proc','trip','flight',10,
  '{"one_way":true,"flights":[{"leg":"outbound","flight_no":"AC99","date":"2027-03-01","departs":"09:00"}],"no_hotel":true}',true)
  like '%hotel cost of 0%');
select pg_temp.assert('traveller sees nothing before done',(select count(*) from public.travel_bookings b
  where b.request_id=pg_temp.fx('trip') and b.first_done_at is not null)=0);
-- Stay costs (FR-73 amendment, migration …05).
select pg_temp.assert('booked needs a cost on every stay',pg_temp.save2_msg('proc','trip','flight',500,
  '{"one_way":true,"flights":[{"leg":"outbound","flight_no":"AC99","date":"2027-03-01","departs":"09:00"}],"stays":[{"name":"Homa","check_in":"2027-03-01","check_out":"2027-03-02","cost_rials":500},{"name":"Parsian","check_in":"2027-03-02","check_out":"2027-03-03"}]}',true)
  like '%each hotel stay needs a cost%');
select pg_temp.assert('total must match the stays',pg_temp.save2_msg('proc','trip','flight',900,
  '{"stays":[{"name":"Homa","cost_rials":500},{"name":"Parsian","cost_rials":485}]}',false)
  like '%total of the stays%');
select pg_temp.assert('cost is a whole number',pg_temp.save2_msg('proc','trip','flight',null,
  '{"stays":[{"name":"Homa","cost_rials":"500"}]}',false) like '%invalid hotel cost%');
select pg_temp.assert('no negative cost',pg_temp.save2_msg('proc','trip','flight',null,
  '{"stays":[{"name":"Homa","cost_rials":-1}]}',false) like '%invalid hotel cost%');
select pg_temp.expect('draft with one costed stay',pg_temp.save2('proc','trip','flight',null,500,
  '{"stays":[{"name":"Homa","cost_rials":500},{"name":"Parsian"}]}',false),'ok');
select pg_temp.expect('done, one way, two stays',pg_temp.save2('proc','trip','flight',750,985,
  '{"one_way":true,"booking_ref":"X7KQ2P","flights":[{"leg":"outbound","flight_no":"AC99","date":"2027-03-01","departs":"09:00"}],"stays":[{"name":"Homa","check_in":"2027-03-01","check_out":"2027-03-02","cost_rials":500},{"name":"Parsian","check_in":"2027-03-02","check_out":"2027-03-03","cost_rials":485}]}',true),'ok');
select pg_temp.expect('finance total stored',(select hotel_cost_rials::text from public.travel_bookings
  where request_id=pg_temp.fx('trip')),'985');
select pg_temp.expect('traveller never sees stay costs',pg_temp.as_scalar('worker',
  'select count(*)::text from public.my_travel_itineraries() i, jsonb_array_elements(i.itinerary->''stays'') x where x ? ''cost_rials'''),'0');
select pg_temp.expect('procurement sees stay costs',pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)->''itinerary''->''stays''->1->>''cost_rials''',pg_temp.fx('trip'))),'485');
select pg_temp.expect('state done',pg_temp.state('trip'),'done');
select pg_temp.expect('audit lists keys only',(select after->>'itinerary_keys' from public.audit_log
  where action='travel_booking.save' and entity_id=pg_temp.fx('trip') and after->>'done'='true'),
  '["booking_ref", "flights", "one_way", "stays"]');
select pg_temp.expect('traveller reads the itinerary',pg_temp.as_scalar('worker',
  'select itinerary->''stays''->1->>''name'' from public.my_travel_itineraries()'),'Parsian');
select pg_temp.expect('others read nothing',pg_temp.as_scalar('mgr',
  'select count(*)::text from public.my_travel_itineraries()'),'0');
select pg_temp.expect('procurement detail has it',pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)->''itinerary''->>''booking_ref''',pg_temp.fx('trip'))),'X7KQ2P');
select pg_temp.expect('company car: transport is enough',pg_temp.save2('proc','trip','company_car',0,0,
  '{"no_hotel":true}',true),'ok');

-- ============================================================ old app during the release
select pg_temp.expect('old save keeps the itinerary',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_save_travel_booking(%L,''company_car'',0,0,''note'',true)::text',pg_temp.fx('trip')))),'ok');
select pg_temp.expect('itinerary untouched',(select itinerary->>'no_hotel' from public.travel_bookings
  where request_id=pg_temp.fx('trip')),'true');
select pg_temp.assert('anon cannot save',
  not has_function_privilege('anon','public.app_save_travel_booking_v2(uuid,text,bigint,bigint,jsonb,text,boolean)','EXECUTE'));
select pg_temp.assert('anon cannot read itineraries',
  not has_function_privilege('anon','public.my_travel_itineraries()','EXECUTE'));

rollback;
