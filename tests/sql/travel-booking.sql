-- Travel booking for out-of-town daily errands (FR-70, 2026-10-20).
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

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Travel booking synthetic fixture');
  insert into tb_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','TB');
  for who in select * from (values
    ('admin','admin','9990070001'),('mgr','manager','9990070002'),('hr','hr','9990070003'),
    ('hr2','hr','9990070004'),('head','hr','9990070005'),('proc','procurement','9990070006'),
    ('proc2','procurement','9990070007'),('worker','employee','9990070008'),
    ('worker2','employee','9990070009'),('mgr2','manager','9990070010')) t(k,role,code) loop
    insert into tb_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@travel-fixture.invalid');
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
  insert into tb_fx values('mgr_step',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into tb_fx values('hr_step',v_id);
  update public.employee_personal_info set national_id='0012345679',birth_date='1990-01-01',
    mobile='09120000000',gender='male' where employee_id=pg_temp.fx('worker2');
end; $$;

-- ============================================================ tables & catalog (Task 2)
select pg_temp.assert('procurement preset seeded with travel_booking edit',
  exists (select 1 from public.roles r join public.role_permissions p on p.role_id=r.id
    where r.company_id=pg_temp.fx('company') and r.system_key='procurement' and r.kind='preset'
      and r.name='Procurement' and p.permission='travel_booking' and p.level='edit'));
select pg_temp.assert('every company has the procurement preset',
  not exists (select 1 from public.companies c where not exists
    (select 1 from public.roles r where r.company_id=c.id and r.system_key='procurement')));
select pg_temp.assert('travel_booking is edit-only',
  private.permission_allows('travel_booking','edit') and not private.permission_allows('travel_booking','read'));
select pg_temp.assert('procurement holder has travel_booking edit',
  private.has_perm(pg_temp.fx('proc'),'travel_booking','edit'));
select pg_temp.expect('client cannot read travel_bookings',
  left(pg_temp.as_scalar('proc','select count(*)::text from public.travel_bookings'),9),'ERROR 425');
select pg_temp.expect('client cannot read errand_extensions',
  left(pg_temp.as_scalar('hr','select count(*)::text from public.errand_extensions'),9),'ERROR 425');
select pg_temp.expect('traveller fields placeholder',
  private.travel_traveller_fields()::text,'{full_name,national_id,birth_date,mobile,gender}');
-- State derivation on synthetic rows (no request needed: the function reads only its arguments
-- and errand_extensions for the row's request_id).
select pg_temp.expect('state matrix',(select string_agg(private.travel_booking_state(s.st::public.leave_status,
    row(gen_random_uuid(),pg_temp.fx('company'),null,now(),s.opened,null,null,null,null,null,null,s.done,null,null,null,s.settled,now(),null)::public.travel_bookings),',' order by s.n)
  from (values
    (1,'pending',null::timestamptz,null::timestamptz,null::timestamptz),
    (2,'approved',null,null,null),
    (3,'approved',now(),null,null),
    (4,'approved',now(),now(),null),
    (5,'cancelled',now(),null,null),
    (6,'cancelled',now(),now(),now()),
    (7,'cancelled',null,null,null),
    (8,'rejected',now(),null,null)) s(n,st,opened,done,settled)),
  'awaiting_approval,awaiting_approval,to_book,done,cancel_undo,settled,hidden,hidden');

-- ============================================================ tick (Task 3)
insert into tb_fx values('tick_req',pg_temp.daily('worker','2027-03-01','2027-03-03')::uuid);
select pg_temp.expect('hr ticks pending daily errand',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('tick_req')))),'ok');
select pg_temp.expect('pending ticked trip awaits approval',pg_temp.state('tick_req'),'awaiting_approval');
select pg_temp.expect('tick is audited',(select count(*)::text from public.audit_log
  where action='travel_booking.tick' and entity_id=pg_temp.fx('tick_req') and actor_id=pg_temp.fx('hr')),'1');
select pg_temp.expect('manager approves',pg_temp.approve('mgr','tick_req','mgr_step'),'ok');
select pg_temp.expect('still awaiting after the manager',pg_temp.state('tick_req'),'awaiting_approval');
select pg_temp.expect('hr approves',pg_temp.approve('hr','tick_req','hr_step'),'ok');
select pg_temp.expect('booking opens when the chain finishes',pg_temp.state('tick_req'),'to_book');

insert into tb_fx values('hourly_req',pg_temp.hourly('worker','2027-03-05')::uuid);
select pg_temp.expect('tick on hourly errand refused',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('hourly_req')))),'22023');

insert into tb_fx values('w2_req',pg_temp.daily('worker2','2027-03-10','2027-03-12')::uuid);
select pg_temp.expect('manager cannot tick',pg_temp.err(pg_temp.as_scalar('mgr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('w2_req')))),'42501');
select pg_temp.expect('procurement cannot tick',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('w2_req')))),'42501');
insert into tb_fx values('hr2_req',pg_temp.daily('hr2','2027-03-10','2027-03-11')::uuid);
select pg_temp.expect('hr cannot tick own request',pg_temp.err(pg_temp.as_scalar('hr2',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('hr2_req')))),'42501');
select pg_temp.expect('another hr ticks it',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('hr2_req')))),'ok');

select pg_temp.expect('admin override approves worker2',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true)::text',pg_temp.fx('w2_req'),pg_temp.sig()))),'ok');
select pg_temp.expect('admin ticks after approval',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('w2_req')))),'ok');
select pg_temp.expect('tick after approval opens at once',pg_temp.state('w2_req'),'to_book');
select pg_temp.expect('ticking twice is harmless',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('w2_req')))),'ok');

insert into tb_fx values('past_req',pg_temp.daily('worker2','2027-04-01','2027-04-02')::uuid);
update public.leave_requests set start_date=current_date-10,end_date=current_date-9 where id=pg_temp.fx('past_req');
select pg_temp.expect('tick after end refused',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('past_req')))),'22023');

select pg_temp.expect('untick before save',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,false)::text',pg_temp.fx('hr2_req')))),'ok');
select pg_temp.expect('unticked booking is gone',pg_temp.state('hr2_req'),'none');
update public.travel_bookings set first_saved_at=now() where request_id=pg_temp.fx('w2_req');
select pg_temp.expect('untick after save refused',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,false)::text',pg_temp.fx('w2_req')))),'22023');
select pg_temp.expect('booking intact after refused untick',pg_temp.state('w2_req'),'to_book');
update public.travel_bookings set first_saved_at=null where request_id=pg_temp.fx('w2_req');

select pg_temp.expect('missing fields listed in order',pg_temp.as_scalar('hr',format(
  'select public.app_travel_missing_fields(%L)::text',pg_temp.fx('tick_req'))),'{national_id,birth_date,mobile,gender}');
select pg_temp.expect('complete traveller has none missing',pg_temp.as_scalar('hr',format(
  'select public.app_travel_missing_fields(%L)::text',pg_temp.fx('w2_req'))),'{}');
select pg_temp.expect('procurement cannot call the missing-field check',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_travel_missing_fields(%L)::text',pg_temp.fx('tick_req')))),'42501');
select pg_temp.assert('anon cannot tick',
  not has_function_privilege('anon','public.app_set_travel_booking(uuid,boolean)','EXECUTE'));

select pg_temp.expect('hr lists ticked bookings with started flag',pg_temp.as_scalar('hr',format(
  'select string_agg(started::text,'','') from public.app_travel_ticks() where request_id in (%L,%L)',
  pg_temp.fx('tick_req'),pg_temp.fx('w2_req'))),'false,false');
select pg_temp.expect('procurement cannot list ticks',pg_temp.err(pg_temp.as_scalar('proc',
  'select count(*)::text from public.app_travel_ticks()')),'42501');

-- ============================================================ procurement (Task 4)
create function pg_temp.save(p_actor text,p_req text,p_transport text,p_flight bigint,p_hotel bigint,p_note text,p_done boolean) returns text
language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.app_save_travel_booking(%L,%L,%s,%s,%L,%L)::text',pg_temp.fx(p_req),p_transport,
    coalesce(p_flight::text,'null'),coalesce(p_hotel::text,'null'),p_note,p_done)));
$$;
insert into tb_fx values('pend_req',pg_temp.daily('worker2','2027-06-01','2027-06-02')::uuid);
select pg_temp.expect('hr ticks a pending trip',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('pend_req')))),'ok');
select pg_temp.expect('procurement list shows approved ticked trips only',pg_temp.as_scalar('proc',format(
  'select string_agg(state,'','' order by start_date) from public.app_travel_bookings() where request_id in (%L,%L,%L,%L)',
  pg_temp.fx('tick_req'),pg_temp.fx('w2_req'),pg_temp.fx('hr2_req'),pg_temp.fx('pend_req'))),'to_book,to_book');
select pg_temp.expect('employee without permission cannot list',pg_temp.err(pg_temp.as_scalar('worker',
  'select count(*)::text from public.app_travel_bookings()')),'42501');

select pg_temp.expect('traveller details read',pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)->''traveller''->>''national_id''',pg_temp.fx('w2_req'))),'0012345679');
select pg_temp.expect('traveller fields exactly the placeholder five',pg_temp.as_scalar('proc',format(
  'select string_agg(k,'','' order by k) from jsonb_object_keys(public.app_travel_booking(%L)->''traveller'') k',
  pg_temp.fx('w2_req'))),'birth_date,full_name,gender,mobile,national_id');
do $$ begin
  perform pg_temp.login('hr');
  update public.employee_personal_info set national_id='0012345687' where employee_id=pg_temp.fx('worker2');
end $$;
select pg_temp.expect('traveller info is live',pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)->''traveller''->>''national_id''',pg_temp.fx('w2_req'))),'0012345687');
select pg_temp.expect('booking detail carries trip fields',pg_temp.as_scalar('proc',format(
  'select (j->>''errand_location'')||''/''||(j->>''description'')||''/''||(j->>''state'') from public.app_travel_booking(%L) j',
  pg_temp.fx('w2_req'))),'Shiraz/Site visit/to_book');
select pg_temp.expect('pending trip detail refused',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)::text',pg_temp.fx('pend_req')))),'22023');
select pg_temp.expect('employee cannot read a booking',pg_temp.err(pg_temp.as_scalar('worker2',format(
  'select public.app_travel_booking(%L)::text',pg_temp.fx('w2_req')))),'42501');

insert into tb_fx values('proc_req',pg_temp.daily('proc','2027-05-01','2027-05-02')::uuid);
select pg_temp.expect('hr ticks the procurement holder''s own trip',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('proc_req')))),'ok');
select pg_temp.expect('admin approves it',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true)::text',pg_temp.fx('proc_req'),pg_temp.sig()))),'ok');
select pg_temp.expect('no self-booking: own trip not listed',pg_temp.as_scalar('proc',format(
  'select count(*)::text from public.app_travel_bookings() where request_id=%L',pg_temp.fx('proc_req'))),'0');
select pg_temp.expect('no self-booking: own traveller details refused',pg_temp.err(pg_temp.as_scalar('proc',format(
  'select public.app_travel_booking(%L)::text',pg_temp.fx('proc_req')))),'42501');
select pg_temp.expect('no self-booking: own save refused',pg_temp.save('proc','proc_req','flight',1,1,null,true),'42501');
select pg_temp.expect('another procurement holder books it',pg_temp.save('proc2','proc_req','flight',5000000,3000000,'IR452 08:00',true),'ok');

select pg_temp.expect('done needs transport',pg_temp.save('proc','w2_req',null,0,0,null,true),'22023');
select pg_temp.expect('done needs both costs',pg_temp.save('proc','w2_req','company_car',null,2000000,null,true),'22023');
select pg_temp.expect('negative cost refused',pg_temp.save('proc','w2_req','flight',-1,0,null,false),'22023');
select pg_temp.expect('unknown transport refused',pg_temp.save('proc','w2_req','bus',0,0,null,false),'22023');
select pg_temp.expect('note over 500 refused',pg_temp.save('proc','w2_req','flight',0,0,repeat('x',501),false),'22023');
select pg_temp.expect('company car with 0 flight cost is done',
  pg_temp.save('proc','w2_req','company_car',0,2000000,'Hotel Zand, 2 nights',true),'ok');
select pg_temp.expect('state done',pg_temp.state('w2_req'),'done');
select pg_temp.expect('save is audited',(select count(*)::text from public.audit_log
  where action='travel_booking.save' and entity_id=pg_temp.fx('w2_req')),'1');
select pg_temp.expect('done booking cannot be saved as not done',pg_temp.save('proc','w2_req','company_car',0,2000000,null,false),'22023');
select pg_temp.expect('done booking may be edited',pg_temp.save('proc','w2_req','company_car',0,2500000,'Hotel Zand, 3 nights',true),'ok');

select pg_temp.expect('partial save keeps to_book',pg_temp.save('proc','tick_req','flight',null,null,null,false),'ok');
select pg_temp.expect('partial save state',pg_temp.state('tick_req'),'to_book');
select pg_temp.expect('untick after procurement saved refused',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,false)::text',pg_temp.fx('tick_req')))),'22023');

select pg_temp.expect('traveller sees transport and note',pg_temp.as_scalar('worker2',format(
  'select transport||''/''||traveller_note from public.my_travel_bookings() where request_id=%L',pg_temp.fx('w2_req'))),
  'company_car/Hotel Zand, 3 nights');
select pg_temp.assert('traveller view has no cost columns',not exists (
  select 1 from pg_proc p where p.proname='my_travel_bookings' and 'hotel_cost_rials'=any(coalesce(p.proargnames,'{}'))));
select pg_temp.expect('traveller does not see an unfinished booking',pg_temp.as_scalar('worker',
  'select count(*)::text from public.my_travel_bookings()'),'0');

update public.leave_requests set start_date=current_date-5,end_date=current_date-4 where id=pg_temp.fx('w2_req');
select pg_temp.expect('done trip after end is read-only',pg_temp.save('proc','w2_req','company_car',0,1,null,true),'22023');
select pg_temp.expect('done trip after end hides traveller, keeps costs',pg_temp.as_scalar('proc',format(
  'select (j ? ''traveller'')::text||''/''||(j->>''hotel_cost_rials'') from public.app_travel_booking(%L) j',
  pg_temp.fx('w2_req'))),'false/2500000');
update public.leave_requests set start_date='2027-03-10',end_date='2027-03-12' where id=pg_temp.fx('w2_req');

-- ============================================================ extension (Task 5)
create function pg_temp.ext(p_actor text,p_req text,p_new date,p_reason text default 'More inspections needed') returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format('select public.app_request_errand_extension(%L,%L,%L)::text',
    pg_temp.fx(p_req),p_new,p_reason));
$$;
create function pg_temp.decide(p_actor text,p_ext text,p_approve boolean,p_sig text,p_per_diem bigint default null,p_note text default null) returns text
language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.app_decide_errand_extension(%L,%L,%L,true,%s,%L)::text',
    pg_temp.fx(p_ext),p_approve,p_sig,coalesce(p_per_diem::text,'null'),p_note)));
$$;
create function pg_temp.ext_status(p_ext text) returns text language sql as $$
  select status||coalesce('/'||evidence,'') from public.errand_extensions where id=pg_temp.fx(p_ext);
$$;
create function pg_temp.end_of(p_req text) returns text language sql as $$
  select end_date::text from public.leave_requests where id=pg_temp.fx(p_req);
$$;

select pg_temp.expect('worker cancels the earlier hourly errand on 03-05',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.cancel_leave_request(%L)::text',pg_temp.fx('hourly_req')))),'ok');
insert into tb_fx values('ext1',pg_temp.ext('mgr','tick_req','2027-03-05')::uuid);
select pg_temp.expect('manager requests extension',pg_temp.ext_status('ext1'),'pending');
select pg_temp.expect('pending extension leaves the trip unchanged',pg_temp.end_of('tick_req')||'/'||pg_temp.state('tick_req'),'2027-03-03/to_book');
select pg_temp.expect('extension request is audited',(select count(*)::text from public.audit_log
  where action='errand_extension.request' and entity_id=pg_temp.fx('tick_req')),'1');
select pg_temp.expect('employee cannot extend own trip',pg_temp.err(pg_temp.ext('worker','tick_req','2027-03-06')),'42501');
select pg_temp.expect('another manager cannot extend',pg_temp.err(pg_temp.ext('mgr2','tick_req','2027-03-06')),'42501');
select pg_temp.expect('second pending extension refused',pg_temp.err(pg_temp.ext('mgr','tick_req','2027-03-06')),'22023');
select pg_temp.expect('new end must be later',pg_temp.err(pg_temp.ext('mgr','w2_req','2027-03-12')),'22023');
select pg_temp.expect('reason required',pg_temp.err(pg_temp.ext('mgr','w2_req','2027-03-13','  ')),'22023');
insert into tb_fx values('plain_req',pg_temp.daily('worker2','2027-07-01','2027-07-02')::uuid);
select pg_temp.expect('admin approves an unticked trip',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true)::text',pg_temp.fx('plain_req'),pg_temp.sig()))),'ok');
select pg_temp.expect('trip without travel booking cannot be extended',pg_temp.err(pg_temp.ext('mgr','plain_req','2027-07-03')),'22023');
update public.leave_requests set start_date=current_date-5,end_date=current_date-4 where id=pg_temp.fx('w2_req');
select pg_temp.expect('ended trip cannot be extended',pg_temp.err(pg_temp.ext('mgr','w2_req',current_date+1)),'22023');
update public.leave_requests set start_date='2027-03-10',end_date='2027-03-12' where id=pg_temp.fx('w2_req');
insert into tb_fx values('w2_hourly',pg_temp.hourly('worker2','2027-03-14')::uuid);
select pg_temp.expect('extension request overlap refused',pg_temp.err(pg_temp.ext('mgr','w2_req','2027-03-15')),'22023');
select pg_temp.expect('mgr lists extendable trips',pg_temp.as_scalar('mgr',format(
  'select string_agg(pending_extension::text,'','' order by start_date) from public.app_extendable_trips() where request_id in (%L,%L,%L)',
  pg_temp.fx('tick_req'),pg_temp.fx('w2_req'),pg_temp.fx('plain_req'))),'true,false');
select pg_temp.expect('a non-manager has no extendable trips',pg_temp.as_scalar('worker',
  'select count(*)::text from public.app_extendable_trips()'),'0');

insert into tb_fx values('w_hourly',pg_temp.hourly('worker','2027-03-04')::uuid);
select pg_temp.expect('extension approve rechecks conflicts',pg_temp.decide('hr','ext1',true,pg_temp.sig()),'22023');
select pg_temp.expect('refused approval leaves extension pending',pg_temp.ext_status('ext1')||'/'||pg_temp.end_of('tick_req'),'pending/2027-03-03');
select pg_temp.expect('worker cancels the conflicting errand',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.cancel_leave_request(%L)::text',pg_temp.fx('w_hourly')))),'ok');
select pg_temp.expect('procurement cannot decide',pg_temp.decide('proc','ext1',true,pg_temp.sig()),'42501');
select pg_temp.expect('manager cannot decide',pg_temp.decide('mgr','ext1',true,pg_temp.sig()),'42501');
select pg_temp.expect('approve without signature refused',pg_temp.decide('hr','ext1',true,null),'22023');
select pg_temp.expect('hr lists the pending extension',pg_temp.as_scalar('hr',format(
  'select old_end_date||''>''||new_end_date||''/''||reason from public.app_pending_errand_extensions() where extension_id=%L',
  pg_temp.fx('ext1'))),'2027-03-03>2027-03-05/More inspections needed');
select pg_temp.expect('calendar shows pending extension days',pg_temp.as_scalar('admin',format(
  'select start_date||''>''||end_date||''/''||status from public.team_leave_calendar where id=%L',pg_temp.fx('ext1'))),
  '2027-03-04>2027-03-05/pending');
select pg_temp.expect('hr approves with per diem',pg_temp.decide('hr','ext1',true,pg_temp.sig(),900000),'ok');
select pg_temp.expect('approved extension moves the end date',
  (select end_date||'/'||requested_minutes||'/'||per_diem_rials||'/'||per_diem_by_requester from public.leave_requests where id=pg_temp.fx('tick_req')),
  '2027-03-05/2400/900000/false');
select pg_temp.expect('original signed end date kept',(select old_end_date::text||'/'||status||'/'||evidence
  from public.errand_extensions where id=pg_temp.fx('ext1')),'2027-03-03/approved/manual');
select pg_temp.expect('booking returns to procurement as extension',pg_temp.state('tick_req'),'extension');
select pg_temp.expect('calendar no longer shows the pending row',pg_temp.as_scalar('admin',format(
  'select count(*)::text from public.team_leave_calendar where id=%L',pg_temp.fx('ext1'))),'0');
select pg_temp.expect('decision is audited',(select count(*)::text from public.audit_log
  where action='errand_extension.approve' and entity_id=pg_temp.fx('tick_req')),'1');
select pg_temp.expect('procurement re-books the extension',pg_temp.save('proc','tick_req','flight',6000000,4000000,'Return 03-05',true),'ok');
select pg_temp.expect('state done again',pg_temp.state('tick_req'),'done');
select pg_temp.expect('requester sees extension history',pg_temp.as_scalar('worker',format(
  'select string_agg(status||'':''||new_end_date,'','') from public.request_errand_extensions(%L)',pg_temp.fx('tick_req'))),
  'approved:2027-03-05');
select pg_temp.expect('unrelated employee cannot read extension history',pg_temp.err(pg_temp.as_scalar('worker2',format(
  'select count(*)::text from public.request_errand_extensions(%L)',pg_temp.fx('tick_req')))),'P0002');

insert into tb_fx values('ext2',pg_temp.ext('mgr','w2_req','2027-03-13')::uuid);
select pg_temp.expect('hr rejects',pg_temp.decide('hr','ext2',false,null,null,'Not justified'),'ok');
select pg_temp.expect('rejected extension changes nothing',pg_temp.ext_status('ext2')||'/'||pg_temp.end_of('w2_req')||'/'||pg_temp.state('w2_req'),
  'rejected/2027-03-12/done');
insert into tb_fx values('ext3',pg_temp.ext('mgr','w2_req','2027-03-13','Client asked for another day')::uuid);
insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,source_request_id,starts_at,ends_at,configured_by)
  values(pg_temp.fx('company'),pg_temp.fx('worker2'),pg_temp.fx('worker'),'Fixture worker2','Fixture worker',pg_temp.fx('w2_req'),
         '2027-03-10','2027-03-13',pg_temp.fx('admin'));
select pg_temp.expect('delegation tied to the trip is flagged',pg_temp.as_scalar('hr',format(
  'select delegation_uncovered::text from public.app_pending_errand_extensions() where extension_id=%L',pg_temp.fx('ext3'))),'true');

select pg_temp.expect('admin designates the HR head with the exempt HR step',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.app_set_executive_settings(null,%L,array[%L]::uuid[])::text',pg_temp.fx('head'),pg_temp.fx('hr_step')))),'ok');
insert into tb_fx values('head_req',pg_temp.daily('head','2027-08-01','2027-08-02',500000)::uuid);
select pg_temp.expect('manager approves the HR head trip',pg_temp.approve('mgr','head_req','mgr_step'),'ok');
select pg_temp.expect('HR head trip approved without an HR signature',(select status::text from public.leave_requests where id=pg_temp.fx('head_req')),'approved');
select pg_temp.expect('another hr ticks it after approval',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('head_req')))),'ok');
insert into tb_fx values('ext_head',pg_temp.ext('mgr','head_req','2027-08-04')::uuid);
select pg_temp.expect('head of hr trip extension is exempt',pg_temp.ext_status('ext_head'),'approved/exempt');
select pg_temp.expect('exempt extension keeps the HR head per diem',
  (select end_date||'/'||per_diem_rials||'/'||per_diem_by_requester from public.leave_requests where id=pg_temp.fx('head_req')),
  '2027-08-04/500000/true');
select pg_temp.assert('anon cannot request or decide extensions',
  not has_function_privilege('anon','public.app_request_errand_extension(uuid,date,text)','EXECUTE')
  and not has_function_privilege('anon','public.app_decide_errand_extension(uuid,boolean,text,boolean,bigint,text)','EXECUTE'));

-- ============================================================ cancel, settle, finance (Task 6)
create function pg_temp.cancel(p_actor text,p_req text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.cancel_leave_request(%L)::text',pg_temp.fx(p_req))));
$$;
create function pg_temp.settle(p_actor text,p_req text,p_lost bigint,p_note text default null) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.app_settle_travel_booking(%L,%s,%L)::text',
    pg_temp.fx(p_req),coalesce(p_lost::text,'null'),p_note)));
$$;
create function pg_temp.fin(p_req text) returns text language sql as $$
  select pg_temp.as_scalar('admin',format(
    'select concat_ws(''/'',status,coalesce(travel_state,''-''),coalesce(transport,''-''),coalesce(per_diem_rials::text,''-''),'
    'coalesce(flight_cost_rials::text,''-''),coalesce(hotel_cost_rials::text,''-''),coalesce(lost_rials::text,''-'')) '
    'from public.finance_approved_requests(''2027-03-01'',''2027-09-30'') where id=%L',pg_temp.fx(p_req)));
$$;

select pg_temp.expect('hr cannot cancel a non-travel request',pg_temp.cancel('hr','plain_req'),'42501');
select pg_temp.expect('hr cancels a future travel trip',pg_temp.cancel('hr','w2_req'),'ok');
select pg_temp.expect('cancelled booked trip goes back to procurement',pg_temp.state('w2_req'),'cancel_undo');
select pg_temp.expect('cancel cancels pending extension',pg_temp.ext_status('ext3'),'cancelled');
select pg_temp.expect('requester cancels own booked trip',pg_temp.cancel('worker','tick_req'),'ok');
select pg_temp.expect('requester cancel also returns to procurement',pg_temp.state('tick_req'),'cancel_undo');
select pg_temp.expect('hr cancels a never-approved ticked trip',pg_temp.cancel('hr','pend_req'),'ok');
select pg_temp.expect('never-approved cancelled trip is hidden',pg_temp.state('pend_req'),'hidden');
select pg_temp.expect('procurement list shows the cancellations to undo',pg_temp.as_scalar('proc',format(
  'select string_agg(state,'','' order by start_date) from public.app_travel_bookings() where request_id in (%L,%L,%L)',
  pg_temp.fx('tick_req'),pg_temp.fx('w2_req'),pg_temp.fx('pend_req'))),'cancel_undo,cancel_undo');
update public.leave_requests set start_date=current_date-1 where id=pg_temp.fx('head_req');
select pg_temp.expect('hr cannot cancel a started trip',pg_temp.cancel('hr','head_req'),'22023');
select pg_temp.expect('started trip stays approved',(select status::text from public.leave_requests where id=pg_temp.fx('head_req')),'approved');
update public.leave_requests set start_date='2027-08-01' where id=pg_temp.fx('head_req');

select pg_temp.expect('settle needs a cancelled trip',pg_temp.settle('proc','head_req',0),'22023');
select pg_temp.expect('negative lost refused',pg_temp.settle('proc','w2_req',-1),'22023');
select pg_temp.expect('employee cannot settle',pg_temp.settle('worker','w2_req',0),'42501');
select pg_temp.expect('procurement settles with the amount lost',pg_temp.settle('proc','w2_req',400000,'Hotel kept one night'),'ok');
select pg_temp.expect('settled state',pg_temp.state('w2_req'),'settled');
select pg_temp.expect('settle twice refused',pg_temp.settle('proc','w2_req',0),'22023');
select pg_temp.expect('settle 0 allowed',pg_temp.settle('proc','tick_req',0),'ok');
select pg_temp.expect('settle is audited',(select count(*)::text from public.audit_log
  where action='travel_booking.settle' and entity_id in (pg_temp.fx('w2_req'),pg_temp.fx('tick_req'))),'2');
select pg_temp.expect('admin cancels the procurement holder''s trip',pg_temp.cancel('admin','proc_req'),'ok');
select pg_temp.expect('no self-settling',pg_temp.settle('proc','proc_req',0),'42501');
select pg_temp.expect('another holder settles it',pg_temp.settle('proc2','proc_req',1000000),'ok');

insert into tb_fx values('fin_req',pg_temp.daily('worker','2027-09-01','2027-09-02')::uuid);
select pg_temp.expect('fin: manager approves',pg_temp.approve('mgr','fin_req','mgr_step'),'ok');
select pg_temp.expect('fin: hr approves with per diem',pg_temp.approve('hr','fin_req','hr_step',false,500000),'ok');
select pg_temp.expect('fin: hr ticks',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('fin_req')))),'ok');
select pg_temp.expect('finance excludes a trip still to book',pg_temp.fin('fin_req'),null);
select pg_temp.expect('fin: procurement books',pg_temp.save('proc','fin_req','flight',3000000,2000000,'IR452',true),'ok');
select pg_temp.expect('finance includes done trip with costs',pg_temp.fin('fin_req'),'approved/done/flight/500000/3000000/2000000/-');
select pg_temp.expect('finance includes settled trip with lost only',pg_temp.fin('w2_req'),'cancelled/settled/company_car/-/-/-/400000');
select pg_temp.expect('finance includes settled 0 trip',pg_temp.fin('tick_req'),'cancelled/settled/flight/-/-/-/0');
select pg_temp.expect('finance excludes an extension awaiting re-booking',pg_temp.fin('head_req'),null);
select pg_temp.expect('finance unchanged for non-travel errand',pg_temp.fin('plain_req'),'approved/-/-/-/-/-/-');

-- ============================================================ review fixes
-- F1: an effective approval delegate of an hr holder acts as HR (spec §3).
insert into tb_fx values('dlg_role',pg_temp.as_scalar('admin',
  'select public.app_save_role(null,''Travel delegation fixture'',''{"approval_delegate":"edit"}''::jsonb)')::uuid);
insert into public.user_roles(user_id,role_id) values(pg_temp.fx('hr2'),pg_temp.fx('dlg_role'));
insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,configured_by)
  values(pg_temp.fx('company'),pg_temp.fx('hr2'),pg_temp.fx('mgr2'),'Fixture hr2','Fixture mgr2',pg_temp.fx('admin'));
select pg_temp.assert('fixture: mgr2 is hr2''s effective delegate',
  exists (select 1 from private.effective_approval_delegate(pg_temp.fx('hr2')) d where d.delegate_id=pg_temp.fx('mgr2')));
insert into tb_fx values('dlg_req',pg_temp.daily('worker2','2027-10-01','2027-10-02')::uuid);
select pg_temp.expect('hr delegate ticks',pg_temp.err(pg_temp.as_scalar('mgr2',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('dlg_req')))),'ok');
select pg_temp.expect('hr delegate lists ticks',pg_temp.err(pg_temp.as_scalar('mgr2',
  'select count(*)::text from public.app_travel_ticks()')),'ok');
select pg_temp.expect('hr delegate sees missing fields',pg_temp.err(pg_temp.as_scalar('mgr2',format(
  'select public.app_travel_missing_fields(%L)::text',pg_temp.fx('dlg_req')))),'ok');
select pg_temp.expect('hr delegate lists pending extensions',pg_temp.err(pg_temp.as_scalar('mgr2',
  'select count(*)::text from public.app_pending_errand_extensions()')),'ok');
select pg_temp.expect('a plain manager still cannot tick',pg_temp.err(pg_temp.as_scalar('mgr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('dlg_req')))),'42501');

-- F3: the manager's extendable-trips list carries the delegation warning too.
insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,source_request_id,starts_at,ends_at,configured_by)
  values(pg_temp.fx('company'),pg_temp.fx('worker'),pg_temp.fx('worker2'),'Fixture worker','Fixture worker2',pg_temp.fx('fin_req'),
         '2027-09-01','2027-09-03',pg_temp.fx('admin'));
select pg_temp.expect('extendable trip flags an uncovered delegation',pg_temp.as_scalar('mgr',format(
  'select delegation_uncovered::text from public.app_extendable_trips() where request_id=%L',pg_temp.fx('fin_req'))),'true');

-- F4: the traveller keeps procurement's note while an approved extension is re-booked.
insert into tb_fx values('ext_fin',pg_temp.ext('mgr','fin_req','2027-09-03')::uuid);
select pg_temp.expect('hr approves fin extension',pg_temp.decide('hr','ext_fin',true,pg_temp.sig()),'ok');
select pg_temp.expect('fin trip awaits re-booking',pg_temp.state('fin_req'),'extension');
select pg_temp.expect('traveller still sees the note during re-booking',pg_temp.as_scalar('worker',format(
  'select traveller_note from public.my_travel_bookings() where request_id=%L',pg_temp.fx('fin_req'))),'IR452');
select pg_temp.expect('a never-finished draft stays hidden from the traveller',pg_temp.as_scalar('worker2',format(
  'select count(*)::text from public.my_travel_bookings() where request_id=%L',pg_temp.fx('dlg_req'))),'0');

-- ============================================================ owner review: finance pending + approved (…07)
create function pg_temp.fin2(p_actor text,p_req text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select concat_ws(''/'',status,coalesce(travel_state,''-''),coalesce(transport,''-''),coalesce(per_diem_rials::text,''-''),'
    'coalesce(flight_cost_rials::text,''-''),coalesce(hotel_cost_rials::text,''-''),coalesce(lost_rials::text,''-''),'
    'coalesce(waiting_step,''-'')) from public.finance_requests(''2027-03-01'',''2027-12-31'') where id=%L',pg_temp.fx(p_req)));
$$;
insert into tb_fx values('fr_pend',pg_temp.daily('worker','2027-04-10','2027-04-11')::uuid);
select pg_temp.expect('finance2: pending request waits on the manager',pg_temp.fin2('admin','fr_pend'),'pending/-/-/-/-/-/-/manager');
select pg_temp.expect('old finance function still hides pending',pg_temp.fin('fr_pend'),null);
select pg_temp.expect('fr: manager approves',pg_temp.approve('mgr','fr_pend','mgr_step'),'ok');
select pg_temp.expect('finance2: then waits on HR',pg_temp.fin2('admin','fr_pend'),'pending/-/-/-/-/-/-/hr');
select pg_temp.expect('fr: hr approves with per diem',pg_temp.approve('hr','fr_pend','hr_step',false,200000),'ok');
select pg_temp.expect('fr: hr ticks',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('fr_pend')))),'ok');
select pg_temp.expect('finance2: unbooked approved trip shows as approved',pg_temp.fin2('admin','fr_pend'),'approved/to_book/-/200000/-/-/-/-');
select pg_temp.expect('old finance function still hides the unbooked trip',pg_temp.fin('fr_pend'),null);
select pg_temp.expect('fr: procurement saves a draft',pg_temp.save('proc','fr_pend','flight',1000000,null,null,false),'ok');
select pg_temp.expect('finance2: draft costs show before the booking is finished',pg_temp.fin2('admin','fr_pend'),'approved/to_book/flight/200000/1000000/-/-/-');
select pg_temp.expect('finance2: trip awaiting re-booking after an extension shows',pg_temp.fin2('admin','head_req'),'approved/extension/-/500000/-/-/-/-');
select pg_temp.expect('finance2: non-travel approved errand',pg_temp.fin2('admin','plain_req'),'approved/-/-/-/-/-/-/-');
select pg_temp.expect('finance2: settled cancelled trip shows lost only',pg_temp.fin2('admin','w2_req'),'cancelled/settled/company_car/-/-/-/400000/-');
select pg_temp.expect('finance2: unsettled or never-approved cancelled trip stays hidden',pg_temp.fin2('admin','pend_req'),null);
select pg_temp.expect('finance2: employee refused',left(pg_temp.as_scalar('worker',
  'select count(*)::text from public.finance_requests(''2027-03-01'',''2027-12-31'')'),11),'ERROR 42501');
select pg_temp.expect('finance2: hr preset reads it',pg_temp.err(pg_temp.as_scalar('hr',
  'select count(*)::text from public.finance_requests(''2027-03-01'',''2027-12-31'')')),'ok');
select pg_temp.expect('finance2: range checked',left(pg_temp.as_scalar('admin',
  'select count(*)::text from public.finance_requests(''2027-03-01'',''2026-03-01'')'),11),'ERROR 22023');
select pg_temp.assert('anon cannot call finance_requests',
  not has_function_privilege('anon','public.finance_requests(date,date)','EXECUTE'));

-- ============================================================ owner review: extensions after rejection, manager's own trip (…08)
-- After a rejection, a new extension may be sent for the same trip (one pending at a time).
insert into tb_fx values('rej1',pg_temp.ext('mgr','fin_req','2027-09-05')::uuid);
select pg_temp.expect('hr rejects the extension',pg_temp.decide('hr','rej1',false,null,null,'Not needed'),'ok');
select pg_temp.expect('rejected',pg_temp.ext_status('rej1'),'rejected');
select pg_temp.expect('extend trip offered again after rejection',pg_temp.as_scalar('mgr',format(
  'select pending_extension::text from public.app_extendable_trips() where request_id=%L',pg_temp.fx('fin_req'))),'false');
insert into tb_fx values('rej2',pg_temp.ext('mgr','fin_req','2027-09-04')::uuid);
select pg_temp.expect('manager sends a new extension after rejection',pg_temp.ext_status('rej2'),'pending');
select pg_temp.expect('end date unchanged while it waits',pg_temp.end_of('fin_req'),'2027-09-03');

-- A Manager-role holder extends their own trip; HR decides.
select pg_temp.login('admin');
update public.profiles set manager_id=pg_temp.fx('mgr') where id=pg_temp.fx('mgr2');
update public.profiles set manager_id=pg_temp.fx('mgr2') where id=pg_temp.fx('proc2');
insert into tb_fx values('mgr2_req',pg_temp.daily('mgr2','2027-11-01','2027-11-02')::uuid);
select pg_temp.expect('own: manager approves',pg_temp.approve('mgr','mgr2_req','mgr_step'),'ok');
select pg_temp.expect('own: hr approves',pg_temp.approve('hr','mgr2_req','hr_step'),'ok');
select pg_temp.expect('own: hr ticks',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_set_travel_booking(%L,true)::text',pg_temp.fx('mgr2_req')))),'ok');
select pg_temp.expect('manager sees own trip as extendable',pg_temp.as_scalar('mgr2',format(
  'select count(*)::text from public.app_extendable_trips() where request_id=%L',pg_temp.fx('mgr2_req'))),'1');
insert into tb_fx values('own1',pg_temp.ext('mgr2','mgr2_req','2027-11-03')::uuid);
select pg_temp.expect('manager requests extension of own trip',pg_temp.ext_status('own1'),'pending');
select pg_temp.expect('manager cannot decide own extension',pg_temp.decide('mgr2','own1',true,pg_temp.sig()),'42501');
select pg_temp.expect('hr rejects own extension',pg_temp.decide('hr','own1',false,null),'ok');
insert into tb_fx values('own2',pg_temp.ext('mgr2','mgr2_req','2027-11-03')::uuid);
select pg_temp.expect('manager re-sends own extension after rejection',pg_temp.ext_status('own2'),'pending');
select pg_temp.expect('hr approves own extension',pg_temp.decide('hr','own2',true,pg_temp.sig()),'ok');
select pg_temp.expect('own trip extended',pg_temp.end_of('mgr2_req'),'2027-11-03');
select pg_temp.expect('non-manager refused on own trip',pg_temp.err(pg_temp.ext('worker','fin_req','2027-09-06')),'42501');
select pg_temp.expect('non-manager does not see own trip as extendable',pg_temp.as_scalar('worker',format(
  'select count(*)::text from public.app_extendable_trips() where request_id=%L',pg_temp.fx('fin_req'))),'0');
select pg_temp.expect('manager''s direct report refused',pg_temp.err(pg_temp.ext('proc2','mgr2_req','2027-11-04')),'42501');
select pg_temp.expect('direct report does not see the manager''s trip',pg_temp.as_scalar('proc2',format(
  'select count(*)::text from public.app_extendable_trips() where request_id=%L',pg_temp.fx('mgr2_req'))),'0');
select pg_temp.expect('the manager''s own manager still may',pg_temp.as_scalar('mgr',format(
  'select count(*)::text from public.app_extendable_trips() where request_id=%L',pg_temp.fx('mgr2_req'))),'1');

-- @@ next section
rollback;
