-- FR-88: the replacement (جانشین) signs or declines a leave request in the app (2026-11-09).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table rs_fx(k text primary key,id uuid not null);
grant select on rs_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from rs_fx where k=p_key;
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
create function pg_temp.leave(p_actor text,p_day int,p_cover text) returns uuid language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true,''private reason'',%s)',
    pg_temp.fx('annual'),current_date+p_day,current_date+p_day,pg_temp.sig(),
    case when p_cover is null then 'null' else quote_literal(pg_temp.fx(p_cover)) end))::uuid;
$$;
create function pg_temp.sign(p_actor text,p_req text,p_sig text default null,p_auth boolean default true) returns text
language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.app_replacement_sign(%L,%L,%L)::text',pg_temp.fx(p_req),coalesce(p_sig,pg_temp.sig()),p_auth)));
$$;
create function pg_temp.decline(p_actor text,p_req text,p_note text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.app_replacement_decline(%L,%L)::text',pg_temp.fx(p_req),p_note)));
$$;
create function pg_temp.approve(p_actor text,p_req text,p_override boolean default false) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_v2(%L,null,%L,true,%L)::text',pg_temp.fx(p_req),pg_temp.sig(),p_override));
$$;
create function pg_temp.signoff(p_req text) returns text language sql as $$
  select coalesce((select status from public.leave_request_replacement_signoffs where request_id=pg_temp.fx(p_req)),'none');
$$;
create function pg_temp.status(p_req text) returns text language sql as $$
  select status::text from public.leave_requests where id=pg_temp.fx(p_req);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_b uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Replacement sign-off synthetic fixture');
  insert into rs_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','RSA'),(v_b,v_company,'ب','Fixture B','office','RSB');
  for who in select * from (values
    ('admin',array['admin'],'9990088001',1),('boss',array['manager','employee'],'9990088002',1),
    ('worker',array['employee'],'9990088003',1),('cover',array['employee'],'9990088004',1),
    ('other',array['employee'],'9990088005',1),('outsider',array['employee'],'9990088006',2),
    ('stranger',array['employee'],'9990088007',2)) t(k,roles,code,dept) loop
    insert into rs_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@replacement-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,case who.dept when 1 then v_a else v_b end,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss')
   where id in (pg_temp.fx('worker'),pg_temp.fx('cover'),pg_temp.fx('other'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into rs_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to) values(v_company,'manager',1,'{leave,errand}');
  insert into private.sms_settings(company_id) values(v_company); -- dry run: texts are queued, never sent
end; $$;

-- ── a request naming a replacement waits for them ────────────────────────────
insert into rs_fx values('r1',pg_temp.leave('worker',10,'cover'));
select pg_temp.expect('sign-off row created pending',pg_temp.signoff('r1'),'pending');
insert into rs_fx values('r0',pg_temp.leave('worker',11,null));
select pg_temp.expect('no replacement, no sign-off row',pg_temp.signoff('r0'),'none');

-- ── what the replacement reads (RLS / explicit columns) ──────────────────────
select pg_temp.expect('replacement lists the request, pending',pg_temp.as_scalar('cover',
  'select string_agg(employee_name||''/''||status||''/''||signoff_status,'','') from public.my_replacement_requests()'),
  'Fixture worker/pending/pending');
select pg_temp.expect('the list has no reason column',
  (select count(*)::text from pg_proc p, unnest(p.proargnames) a where p.proname='my_replacement_requests' and a='reason'),'0');
select pg_temp.expect('a colleague lists nothing',pg_temp.as_scalar('other',
  'select count(*)::text from public.my_replacement_requests()'),'0');
select pg_temp.expect('replacement gets no base row (reason stays private)',pg_temp.as_scalar('cover',format(
  'select count(*)::text from public.leave_requests where id=%L',pg_temp.fx('r1'))),'0');
select pg_temp.expect('replacement reads own sign-off row',pg_temp.as_scalar('cover',
  'select count(*)::text from public.leave_request_replacement_signoffs'),'1');
select pg_temp.expect('a colleague reads no sign-off row',pg_temp.as_scalar('other',
  'select count(*)::text from public.leave_request_replacement_signoffs'),'0');
select pg_temp.expect('the manager reads it with the request',pg_temp.as_scalar('boss',format(
  'select count(*)::text from public.leave_request_replacement_signoffs where request_id=%L',pg_temp.fx('r1'))),'1');
select pg_temp.expect('replacement cannot write the row directly',pg_temp.err(pg_temp.as_scalar('cover',format(
  'update public.leave_request_replacement_signoffs set status=''signed'' where request_id=%L returning ''x''',
  pg_temp.fx('r1')))),'42501');
select pg_temp.expect('replacement cannot open the signatures',pg_temp.err(pg_temp.as_scalar('cover',format(
  'select public.get_leave_request_signatures(%L)::text',pg_temp.fx('r1')))),'P0002');
select pg_temp.expect('replacement reads no balances',pg_temp.as_scalar('cover',format(
  'select count(*)::text from public.leave_ledger where employee_id=%L',pg_temp.fx('worker'))),'0');

-- Calendar: a replacement outside the department sees the request; their colleague does not.
select pg_temp.login('admin');
update public.leave_requests set replacement_id=pg_temp.fx('outsider') where id=pg_temp.fx('r1');
select pg_temp.expect('changing the replacement resets the row to them',
  (select replacement_id::text||'/'||status from public.leave_request_replacement_signoffs where request_id=pg_temp.fx('r1')),
  pg_temp.fx('outsider')::text||'/pending');
select pg_temp.expect('outside replacement sees it on the calendar',pg_temp.as_scalar('outsider',format(
  'select count(*)::text from public.team_leave_calendar where id=%L',pg_temp.fx('r1'))),'1');
select pg_temp.expect('their colleague does not',pg_temp.as_scalar('stranger',format(
  'select count(*)::text from public.team_leave_calendar where id=%L',pg_temp.fx('r1'))),'0');
select pg_temp.expect('the old replacement no longer lists it',pg_temp.as_scalar('cover',
  'select count(*)::text from public.my_replacement_requests()'),'0');
select pg_temp.login('admin');
update public.leave_requests set replacement_id=pg_temp.fx('cover') where id=pg_temp.fx('r1');

-- ── approval never waits for the replacement ────────────────────────────────
select pg_temp.expect('approval context reports pending',pg_temp.as_scalar('boss',format(
  'select public.app_request_approval_context(%L)->>''replacement_signoff_status''',pg_temp.fx('r1'))),'pending');
select pg_temp.expect('manager approves before the replacement signs',pg_temp.err(pg_temp.approve('boss','r1')),'ok');
select pg_temp.expect('request approved',pg_temp.status('r1'),'approved');
select pg_temp.expect('sign-off still pending after approval',pg_temp.signoff('r1'),'pending');

-- ── signing, at any moment ───────────────────────────────────────────────────
select pg_temp.expect('consent box required',pg_temp.sign('cover','r1',null,false),'22023');
select pg_temp.expect('a bad image refused',pg_temp.sign('cover','r1','data:image/png;base64,xyz'),'22023');
select pg_temp.expect('someone else cannot sign',pg_temp.sign('other','r1'),'P0002');
select pg_temp.expect('the requester cannot sign as replacement',pg_temp.sign('worker','r1'),'P0002');
select pg_temp.expect('replacement signs the approved request',pg_temp.sign('cover','r1'),'ok');
select pg_temp.expect('signed with image and consent time',
  (select status||'/'||(signature_data=pg_temp.sig())::text||'/'||(signature_consent_at is not null)::text
     from public.leave_request_replacement_signoffs where request_id=pg_temp.fx('r1')),'signed/true/true');
select pg_temp.expect('audit row without the image',
  (select count(*)::text from public.audit_log where action='replacement_sign' and entity_id=pg_temp.fx('r1')
     and actor_id=pg_temp.fx('cover') and not (after::text like '%iVBOR%')),'1');
select pg_temp.expect('signing twice refused',pg_temp.sign('cover','r1'),'22023');
select pg_temp.expect('declining after signing refused',pg_temp.decline('cover','r1','no'),'22023');
select pg_temp.expect('print data carries the replacement signature',pg_temp.as_scalar('boss',format(
  'select (p->''signatures''->>''replacement_status'')||''/''||((p->''signatures''->>''replacement_signature_data'')=%L)::text||''/''||(p->''signatures''->>''replacement_signature_consent_at'' is not null)::text||''/''||(p->''context''->>''replacement_signoff_status'') from public.app_request_print(%L) p',
  pg_temp.sig(),pg_temp.fx('r1'))),'signed/true/true/signed');
select pg_temp.expect('the context never carries the image',pg_temp.as_scalar('boss',format(
  'select (public.app_request_approval_context(%L)::text like ''%%iVBOR%%'')::text',pg_temp.fx('r1'))),'false');
select pg_temp.expect('replacement still lists it, signed',pg_temp.as_scalar('cover',format(
  'select status||''/''||signoff_status||''/''||(signed_at is not null)::text from public.my_replacement_requests() where request_id=%L',
  pg_temp.fx('r1'))),'approved/signed/true');

insert into rs_fx values('r1b',pg_temp.leave('worker',15,'cover'));
select pg_temp.expect('replacement signs while still pending',pg_temp.sign('cover','r1b'),'ok');
select pg_temp.expect('request still pending, approvers decide on their own',pg_temp.status('r1b'),'pending');

-- ── declining goes back to the requester ─────────────────────────────────────
insert into rs_fx values('r2',pg_temp.leave('worker',20,'cover'));
select pg_temp.expect('a note over 500 characters refused',pg_temp.decline('cover','r2',repeat('x',501)),'22023');
select pg_temp.expect('someone else cannot decline',pg_temp.decline('other','r2','no'),'P0002');
select pg_temp.expect('requester cannot change before a decline',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_change_replacement(%L,%L)::text',pg_temp.fx('r2'),pg_temp.fx('other')))),'22023');
set constraints all immediate; -- the SMS triggers are deferred to commit
select pg_temp.expect('replacement declines',pg_temp.decline('cover','r2','  I am away that day  '),'ok');
select pg_temp.expect('request untouched: still pending, no decision',
  (select status::text||'/'||coalesce(decided_by::text,'-')||'/'||coalesce(decision_note,'-')||'/'||(replacement_id=pg_temp.fx('cover'))::text
     from public.leave_requests where id=pg_temp.fx('r2')),'pending/-/-/true');
select pg_temp.expect('sign-off declined with the note',
  (select status||'/'||note from public.leave_request_replacement_signoffs where request_id=pg_temp.fx('r2')),'declined/I am away that day');
select pg_temp.expect('no decision text to the requester',
  (select count(*)::text from public.sms_outbox where request_id=pg_temp.fx('r2') and event='employee_decision'),'0');
select pg_temp.expect('the requester reads the decline and note',pg_temp.as_scalar('worker',format(
  'select status||''/''||note from public.leave_request_replacement_signoffs where request_id=%L',pg_temp.fx('r2'))),
  'declined/I am away that day');
select pg_temp.expect('declining twice refused',pg_temp.decline('cover','r2','again'),'22023');
select pg_temp.expect('signing after declining refused',pg_temp.sign('cover','r2'),'22023');
select pg_temp.expect('a declined request stays on the calendar',pg_temp.as_scalar('cover',format(
  'select count(*)::text from public.team_leave_calendar where id=%L',pg_temp.fx('r2'))),'1');
select pg_temp.expect('the manager may still approve',pg_temp.err(pg_temp.approve('boss','r2')),'ok');
select pg_temp.expect('someone else cannot change it',pg_temp.err(pg_temp.as_scalar('other',format(
  'select public.app_change_replacement(%L,%L)::text',pg_temp.fx('r2'),pg_temp.fx('other')))),'P0002');
select pg_temp.expect('same person again refused',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_change_replacement(%L,%L)::text',pg_temp.fx('r2'),pg_temp.fx('cover')))),'22023');
select pg_temp.expect('someone outside the department refused',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_change_replacement(%L,%L)::text',pg_temp.fx('r2'),pg_temp.fx('outsider')))),'22023');
select pg_temp.expect('requester names someone else',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_change_replacement(%L,%L)::text',pg_temp.fx('r2'),pg_temp.fx('other')))),'ok');
select pg_temp.expect('a fresh sign-off for the new replacement',
  (select (replacement_id=pg_temp.fx('other'))::text||'/'||status from public.leave_request_replacement_signoffs where request_id=pg_temp.fx('r2')),
  'true/pending');
select pg_temp.expect('approval signatures kept',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('r2') and decision='approved'),'1');
select pg_temp.expect('the new replacement lists it',pg_temp.as_scalar('other',
  'select count(*)::text from public.my_replacement_requests()'),'1');
select pg_temp.expect('the one who declined no longer does',pg_temp.as_scalar('cover',format(
  'select count(*)::text from public.my_replacement_requests() where request_id=%L',pg_temp.fx('r2'))),'0');
select pg_temp.expect('the new replacement declines too',pg_temp.decline('other','r2',null),'ok');
select pg_temp.expect('requester marks no replacement',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.app_change_replacement(%L,null)::text',pg_temp.fx('r2')))),'ok');
select pg_temp.expect('no replacement, no sign-off',
  (select coalesce(replacement_id::text,'none') from public.leave_requests where id=pg_temp.fx('r2'))||'/'||pg_temp.signoff('r2'),'none/none');
select pg_temp.expect('changes are audited',
  (select count(*)::text from public.audit_log where action='replacement_change' and entity_id=pg_temp.fx('r2')),'2');

-- ── cancelled, older requests ────────────────────────────────────────────────
insert into rs_fx values('r3',pg_temp.leave('worker',30,'cover'));
select pg_temp.expect('requester cancels',pg_temp.err(pg_temp.as_scalar('worker',format(
  'select public.cancel_leave_request(%L)::text',pg_temp.fx('r3')))),'ok');
select pg_temp.expect('a cancelled request cannot be signed',pg_temp.sign('cover','r3'),'22023');
select pg_temp.expect('nor declined',pg_temp.decline('cover','r3','x'),'22023');

insert into rs_fx values('r5',pg_temp.leave('worker',50,'cover'));
delete from public.leave_request_replacement_signoffs where request_id=pg_temp.fx('r5');
select pg_temp.expect('a request filed before FR-88 (no row) cannot be signed',pg_temp.sign('cover','r5'),'P0002');
select pg_temp.expect('… print status null (blank box)',pg_temp.as_scalar('boss',format(
  'select coalesce(public.app_request_print(%L)->''signatures''->>''replacement_status'',''null'')',pg_temp.fx('r5'))),'null');
insert into rs_fx values('r6',pg_temp.leave('worker',60,'cover'));
select pg_temp.login('admin');
update public.profiles set active=false where id=pg_temp.fx('cover');
select pg_temp.expect('inactive replacement refused',pg_temp.sign('cover','r6'),'42501');
select pg_temp.expect('inactive replacement lists nothing',pg_temp.as_scalar('cover',
  'select count(*)::text from public.my_replacement_requests()'),'0');

rollback;
