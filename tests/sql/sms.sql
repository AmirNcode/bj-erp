-- SMS notifications (FR-78, owner 2026-11-03): who gets texted when, masking, modes, the pg_net
-- reply handling, and that only the admin reaches the settings and the log.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
-- The queueing triggers are deferred to commit; pg_temp.flush() fires them mid-transaction.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table sm_fx(k text primary key,id uuid not null);
grant select on sm_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from sm_fx where k=p_key;
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
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;
create function pg_temp.sig() returns text language sql immutable as $$
  select 'data:image/png;base64,iVBORw0KGgo'||repeat('A',89);
$$;
create function pg_temp.flush() returns void language plpgsql as $$
begin set constraints all immediate; set constraints all deferred; end; $$;
-- Files a daily leave for p_actor p_day days ahead and remembers it as p_key.
create function pg_temp.file(p_key text,p_actor text,p_day int) returns text language plpgsql as $$
declare v text;
begin
  v:=pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)::text',
    pg_temp.fx('annual'),current_date+p_day,current_date+p_day,pg_temp.sig()));
  if left(v,6)='ERROR ' then return v; end if;
  insert into sm_fx values(p_key,v::uuid);
  perform pg_temp.flush();
  return 'ok';
end; $$;
create function pg_temp.approve(p_actor text,p_req text,p_step text) returns text language plpgsql as $$
declare v text;
begin
  v:=pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_steps(%L,%L::uuid[],%L,true)::text',
    pg_temp.fx(p_req),'{'||pg_temp.fx(p_step)||'}',pg_temp.sig())));
  perform pg_temp.flush();
  return v;
end; $$;
create function pg_temp.texts(p_req text,p_event text) returns text language sql as $$
  select coalesce(string_agg(coalesce(k.k,'?')||':'||o.status||coalesce('/'||o.skip_reason,''),',' order by k.k),'none')
    from public.sms_outbox o left join sm_fx k on k.id=o.recipient_id and k.k not in ('company')
   where o.request_id=pg_temp.fx(p_req) and o.event=p_event;
$$;
create function pg_temp.settings(p_mode text,p_method text default 'line',p_key text default null,
    p_clear boolean default false) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar('admin',format(
    'select public.app_set_sms_settings(%L,''9221000000'',''50002710000000'',%L,111,222,null,true,true,true,''bjeng.app'',%L,%L)::text',
    p_mode,p_method,p_key,p_clear)));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'SMS synthetic fixture');
  insert into sm_fx values('company',v_company);
  insert into private.sms_settings(company_id) values(v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','SMA');
  for who in select * from (values
    ('admin',array['admin'],'9990079001',null),
    ('boss',array['manager','employee'],'9990079002','09121110001'),
    ('hr',array['hr','employee'],'9990079003','09121110002'),
    ('emp',array['employee'],'9990079004','09121110003'),
    ('nomobile',array['employee'],'9990079005',null)) t(k,roles,code,mobile) loop
    insert into sm_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@sms-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
    if who.mobile is not null then
      insert into public.employee_personal_info(employee_id,company_id,mobile) values(pg_temp.fx(who.k),v_company,who.mobile)
        on conflict (employee_id) do update set mobile=excluded.mobile;
    end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id in (pg_temp.fx('emp'),pg_temp.fx('nomobile'),pg_temp.fx('hr'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',true);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into sm_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to) values(v_company,'manager',1,'{leave,errand}')
    returning id into v_id;
  insert into sm_fx values('m_step',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to) values(v_company,'hr',2,'{leave,errand}')
    returning id into v_id;
  insert into sm_fx values('h_step',v_id);
end; $$;

-- ── helpers ──
select pg_temp.expect('mobile: Persian digits and spaces',private.normalize_ir_mobile('۰۹۱۲ ۱۱۱ ۰۰۰۱'),'09121110001');
select pg_temp.expect('mobile: +98 prefix',private.normalize_ir_mobile('+98 912-111-0002'),'09121110002');
select pg_temp.expect('mobile: 0098 and bare 9…',private.normalize_ir_mobile('00989121110004')||private.normalize_ir_mobile('9121110005'),
  '0912111000409121110005');
select pg_temp.expect('mobile: landline and junk refused',coalesce(private.normalize_ir_mobile('02188776655'),'null')
  ||coalesce(private.normalize_ir_mobile('abc'),'null')||coalesce(private.normalize_ir_mobile(null),'null'),'nullnullnull');
select pg_temp.expect('jalali text: fa digits, en Latin',
  (private.jalali_text(current_date,'fa') ~ '^[۰-۹]{4}/[۰-۹]{2}/[۰-۹]{2}$')::text
  ||(private.jalali_text(current_date,'en') ~ '^1[34][0-9]{2}/[0-9]{2}/[0-9]{2}$')::text,'truetrue');

-- ── admin only ──
select pg_temp.expect('non-admin: settings refused',pg_temp.err(pg_temp.as_scalar('hr','select public.app_sms_settings()::text')),'42501');
select pg_temp.expect('non-admin: save refused',pg_temp.err(pg_temp.as_scalar('hr',
  'select public.app_set_sms_settings(''live'',null,null,''line'',null,null,null,true,true,true,''x'',''abcdefgh1234'')::text')),'42501');
select pg_temp.expect('non-admin: log refused',pg_temp.err(pg_temp.as_scalar('boss','select public.app_sms_log()::text')),'42501');
select pg_temp.expect('non-admin: test refused',pg_temp.err(pg_temp.as_scalar('emp','select public.app_sms_test(''09121110003'')::text')),'42501');
select pg_temp.expect('non-admin: credit refused',pg_temp.err(pg_temp.as_scalar('emp','select public.app_sms_check_credit()::text')),'42501');
select pg_temp.expect('non-admin: password text refused',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_enqueue_password_sms(%L,''Secret123'')',pg_temp.fx('emp')))),'42501');
select pg_temp.expect('non-admin: outbox rows invisible (RLS)',pg_temp.as_scalar('hr','select count(*)::text from public.sms_outbox'),'0');
select pg_temp.expect('settings table not reachable by the app role',
  pg_temp.err(pg_temp.as_scalar('admin','select count(*)::text from private.sms_settings')),'42501');

-- ── settings: the key is write-only ──
select pg_temp.expect('default: dry run, no key',pg_temp.as_scalar('admin',
  $q$select (s->>'mode')||'/'||(s->>'has_api_key')||'/'||(s ? 'api_key')::text from public.app_sms_settings() s$q$),'dry_run/false/false');
select pg_temp.expect('save with key',pg_temp.settings('dry_run','line','KeyAbc-9876'),'ok');
select pg_temp.expect('key never returned, hint shows last 4',pg_temp.as_scalar('admin',
  $q$select (s->>'has_api_key')||'/'||(s ? 'api_key')::text||'/'||(s->>'api_key_hint')||'/'||(position('KeyAbc' in s::text)>0)::text
     from public.app_sms_settings() s$q$),'true/false/…9876/false');
select pg_temp.expect('null key keeps the saved one',pg_temp.settings('dry_run')||'/'||
  (select (api_key='KeyAbc-9876')::text from private.sms_settings where company_id=pg_temp.fx('company')),'ok/true');
select pg_temp.expect('audit row has no key, only api_key_changed',
  (select count(*)::text||'/'||bool_and(position('KeyAbc' in coalesce(before::text,'')||after::text)=0)::text||'/'
          ||bool_or((after->>'api_key_changed')::boolean)::text
     from public.audit_log where action='update_sms_settings' and entity_id=pg_temp.fx('company')),'2/true/true');
select pg_temp.expect('live without a key refused',pg_temp.settings('live','line',null,true),'23514');
select pg_temp.expect('key in a URL-unsafe form refused',pg_temp.settings('dry_run','line','bad key/../x'),'23514');

-- ── approver: new request (order enforced) ──
select pg_temp.expect('emp files r1',pg_temp.file('r1','emp',10),'ok');
select pg_temp.expect('r1: only the step-1 manager is texted',pg_temp.texts('r1','approver_new'),'boss:queued');
select pg_temp.expect('r1: mobile normalised, Farsi text with name and site',
  (select to_mobile||'/'||(body like 'درخواست مرخصی روزانه Fixture emp (%) منتظر تأیید شماست.%bjeng.app')::text
          ||'/'||array_length(args,1) from public.sms_outbox where request_id=pg_temp.fx('r1') and event='approver_new'),
  '09121110001/true/3');
select pg_temp.expect('boss approves step 1',pg_temp.approve('boss','r1','m_step'),'ok');
select pg_temp.expect('r1: HR is texted once step 2 opens',pg_temp.texts('r1','approver_new'),'boss:queued,hr:queued');
select pg_temp.expect('no decision text while pending',pg_temp.texts('r1','employee_decision'),'none');
select pg_temp.expect('hr approves step 2',pg_temp.approve('hr','r1','h_step'),'ok');
select pg_temp.expect('r1: requester told it was approved',
  pg_temp.texts('r1','employee_decision')||'/'||(select (body like 'درخواست مرخصی روزانه شما (%) تأیید شد.%')::text
    from public.sms_outbox where request_id=pg_temp.fx('r1') and event='employee_decision'),'emp:queued/true');

-- ── order off: every open step at once; one text per person per transaction ──
update public.work_settings set approval_order_enforced=false where company_id=pg_temp.fx('company');
select pg_temp.expect('emp files r2 (order off)',pg_temp.file('r2','emp',12),'ok');
select pg_temp.expect('r2: both steps texted at once',pg_temp.texts('r2','approver_new'),'boss:queued,hr:queued');
insert into public.user_roles(user_id,role) values(pg_temp.fx('boss'),'hr');
select pg_temp.expect('nomobile files r3 (boss holds both steps)',pg_temp.file('r3','nomobile',14),'ok');
select pg_temp.expect('r3: boss texted once, hr once',pg_temp.texts('r3','approver_new'),'boss:queued,hr:queued');
delete from public.user_roles where user_id=pg_temp.fx('boss') and role='hr';

-- ── no mobile: logged as skipped ──
select pg_temp.expect('boss rejects r3',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.reject_leave_request_v2(%L,%L,''no'')::text',pg_temp.fx('r3'),pg_temp.fx('m_step'))))
  ||(pg_temp.flush())::text,'ok');
select pg_temp.expect('r3: rejection to a person without a mobile is skipped',pg_temp.texts('r3','employee_decision'),
  'nomobile:skipped/no_mobile');

-- ── dispatch, dry run ──
select private.sms_dispatch();
select pg_temp.expect('dry run: decided request''s approver texts dropped, others dry_run',
  pg_temp.texts('r1','approver_new')||' '||pg_temp.texts('r1','employee_decision')||' '||pg_temp.texts('r3','approver_new'),
  'boss:skipped/request_decided,hr:skipped/request_decided emp:dry_run boss:skipped/request_decided,hr:skipped/request_decided');
select pg_temp.expect('dry run: pending r2 texts marked dry_run',pg_temp.texts('r2','approver_new'),'boss:dry_run,hr:dry_run');
select pg_temp.expect('nothing left queued',(select count(*)::text from public.sms_outbox
  where company_id=pg_temp.fx('company') and status='queued'),'0');

-- ── mode off: nothing queued ──
select pg_temp.expect('mode off',pg_temp.settings('off'),'ok');
select pg_temp.expect('emp files r4 with SMS off',pg_temp.file('r4','emp',16),'ok');
select pg_temp.expect('r4: no texts at all',pg_temp.texts('r4','approver_new'),'none');
select pg_temp.expect('test refused while off',pg_temp.err(pg_temp.as_scalar('admin','select public.app_sms_test(''09121110003'')::text')),'22023');
select pg_temp.expect('password text off',pg_temp.as_scalar('admin',format(
  'select public.app_enqueue_password_sms(%L,''Secret123'')',pg_temp.fx('emp'))),'off');

-- ── password reset: plaintext never survives the first dispatch ──
select pg_temp.expect('back to dry run',pg_temp.settings('dry_run'),'ok');
select pg_temp.expect('password text queued',pg_temp.as_scalar('admin',format(
  'select public.app_enqueue_password_sms(%L,''Secret123'')',pg_temp.fx('emp'))),'queued');
select pg_temp.expect('log masks a queued password',pg_temp.as_scalar('admin',
  $q$select (position('Secret123' in public.app_sms_log(null,'password_reset')::text)=0)::text$q$),'true');
select private.sms_dispatch();
select pg_temp.expect('after dispatch: masked body, args cleared, login code kept',
  (select status||'/'||(position('Secret123' in body)=0)::text||'/'||(position('••••' in body)>0)::text||'/'
          ||(position('9990079004' in body)>0)::text||'/'||coalesce(array_length(args,1),0)
     from public.sms_outbox where event='password_reset' and recipient_id=pg_temp.fx('emp')),'dry_run/true/true/true/0');

select pg_temp.expect('password to someone without a mobile: skipped',
  pg_temp.as_scalar('admin',format('select public.app_enqueue_password_sms(%L,''Nomob777x'')',pg_temp.fx('nomobile'))),'skipped');
select pg_temp.expect('… and masked at once (never dispatched, so never masked later)',
  (select (position('Nomob777x' in body)=0)::text||'/'||coalesce(array_length(args,1),0)
     from public.sms_outbox where event='password_reset' and recipient_id=pg_temp.fx('nomobile')),'true/0');

-- ── live: request goes to pg_net; the reply decides ──
select pg_temp.expect('live with key',pg_temp.settings('live','line','KeyAbc-9876'),'ok');
do $$ begin perform pg_temp.login('admin');
  insert into sm_fx values('t1',(select public.app_sms_test('09121110003')));
  insert into sm_fx values('t2',(select public.app_sms_test('09121110004')));
  insert into sm_fx values('t3',(select public.app_sms_test('09121110005')));
end $$;
select private.sms_dispatch();
select pg_temp.expect('live: three rows sending with a pg_net request',
  (select count(*)::text from public.sms_outbox where id in (pg_temp.fx('t1'),pg_temp.fx('t2'),pg_temp.fx('t3'))
     and status='sending' and net_request_id is not null and attempts=1),'3');
select pg_temp.expect('live: simple-send URL and JSON body',
  (select (q.url='https://console.melipayamak.com/api/send/simple/KeyAbc-9876')::text||'/'
          ||(convert_from(q.body,'utf8')::jsonb->>'from')||'/'||(convert_from(q.body,'utf8')::jsonb->>'to')
     from net.http_request_queue q join public.sms_outbox o on o.net_request_id=q.id where o.id=pg_temp.fx('t1')),
  'true/50002710000000/09121110003');
insert into net._http_response(id,status_code,content,timed_out)
select o.net_request_id,v.code,v.content,false
  from public.sms_outbox o join (values ('t1',200,'{"recId":"4501234567890","status":""}'),
    ('t2',200,'{"recId":"0","status":"شماره گیرنده نامعتبر است"}'),('t3',502,'bad gateway')) v(k,code,content)
    on o.id=pg_temp.fx(v.k);
select private.sms_dispatch();
select pg_temp.expect('reply: recId → sent',(select status||'/'||provider_ref from public.sms_outbox where id=pg_temp.fx('t1')),
  'sent/4501234567890');
select pg_temp.expect('reply: provider error → failed, no retry',(select status||'/'||error from public.sms_outbox where id=pg_temp.fx('t2')),
  'failed/شماره گیرنده نامعتبر است');
select pg_temp.expect('reply: 5xx → queued again, later',(select status||'/'||(next_attempt_at>now())::text from public.sms_outbox
  where id=pg_temp.fx('t3')),'queued/true');
select pg_temp.expect('pattern without a body id fails clearly',pg_temp.settings('live','pattern'),'ok');
select pg_temp.expect('approver_new under pattern uses its body id (111)',pg_temp.file('r5','emp',18),'ok');
select private.sms_dispatch();
select pg_temp.expect('pattern: shared URL, bodyId and args',
  (select string_agg((q.url like 'https://console.melipayamak.com/api/send/shared/KeyAbc-9876')::text||'/'
          ||(convert_from(q.body,'utf8')::jsonb->>'bodyId')||'/'||jsonb_array_length(convert_from(q.body,'utf8')::jsonb->'args'),',')
     from net.http_request_queue q join public.sms_outbox o on o.net_request_id=q.id where o.request_id=pg_temp.fx('r5')),
  'true/111/3,true/111/3');
do $$ begin perform pg_temp.login('admin');
  perform public.app_enqueue_password_sms(pg_temp.fx('emp'),'Other999x'); end $$;
select private.sms_dispatch();
select pg_temp.expect('pattern: event without a body id fails, password still masked',
  (select status||'/'||(error like 'no pattern body id%')::text||'/'||(position('Other999x' in body)=0)::text
     from public.sms_outbox where event='password_reset' and recipient_id=pg_temp.fx('emp') and status<>'dry_run'),
  'failed/true/true');

-- ── credit ──
select pg_temp.expect('credit asks pg_net',pg_temp.err(pg_temp.as_scalar('admin','select public.app_sms_check_credit()::text')),'ok');
insert into net._http_response(id,status_code,content,timed_out)
  select credit_request_id,200,'{"amount":125000.5,"status":""}',false from private.sms_settings where company_id=pg_temp.fx('company');
select private.sms_dispatch();
select pg_temp.expect('credit stored',pg_temp.as_scalar('admin',
  $q$select (s->>'credit_amount')||'/'||(s->>'credit_pending') from public.app_sms_settings() s$q$),'125000.5/false');

-- ── admin log ──
select pg_temp.expect('admin log: totals and names',pg_temp.as_scalar('admin',
  $q$select ((l->>'total')::int>=10)::text||'/'||(l->'rows'->0 ? 'recipient_name')::text from public.app_sms_log() l$q$),'true/true');

\o
select 'sms.sql: all assertions passed' as result;
rollback;
