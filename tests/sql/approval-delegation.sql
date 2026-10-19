-- Approval delegation regression scenarios. Run ONLY in the disposable synthetic test database.
-- The lead owns database orchestration. This file starts and rolls back its own transaction.
-- Use the image superuser (supabase_admin). No real identities, credentials or calendar jobs run.
-- Deliberately fail on any incorrect assertion. Concurrent-session checks are separate lead-run checks.
-- The CEO's delegate's own requests get the CEO step approved at submission (no timers).
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table delegation_fx(k text primary key,id uuid not null);
grant select on delegation_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from delegation_fx where k=p_key;
$$;
create function pg_temp.login(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
end; $$;
create function pg_temp.as_scalar(p_key text,p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin execute p_sql into v_result;
  exception when others then v_result:='ERROR '||sqlstate||' '||sqlerrm; end;
  execute 'reset role'; return v_result;
end; $$;
create function pg_temp.as_call(p_key text,p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin execute p_sql;
  exception when others then execute 'reset role';return sqlstate; end;
  execute 'reset role'; return 'ok';
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
create function pg_temp.submit(p_actor text,p_date date,p_auto boolean default false,p_replacement text default null,
  p_part public.day_part default 'full',p_temp_ceo boolean default false) returns uuid language plpgsql as $$
declare v_preview text; v_id text;
begin
  v_preview:=pg_temp.as_scalar(p_actor,format('select public.app_request_delegation_preview(%L,%L,%L,%L,null,null,%L)',
    p_date,p_date,'day',p_part,pg_temp.fx(p_replacement)));
  if left(v_preview,6)='ERROR ' then raise exception 'preview failed: %',v_preview; end if;
  v_id:=pg_temp.as_scalar(p_actor,format('select public.submit_leave_request_v2(%L,%L,%L,%L,%L,true,null,%L,%L,%L::jsonb,%L)',
    pg_temp.fx('leave_type'),p_date,p_date,p_part,pg_temp.sig(),pg_temp.fx(p_replacement),p_auto,v_preview,p_temp_ceo));
  if left(v_id,6)='ERROR ' then raise exception 'submission failed for %: %',p_actor,v_id; end if;
  return v_id::uuid;
end; $$;
-- Synthetic company avoids changing the configured identities/steps of any existing deployment.
do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_other_dept uuid:=gen_random_uuid();
  v_outside uuid:=gen_random_uuid(); who record;
begin
  insert into public.companies(id,name) values(v_company,'Delegation synthetic fixture'),(v_outside,'Delegation foreign fixture');
  insert into delegation_fx values('company',v_company),('outside_company',v_outside),('dept',v_dept),('other_dept',v_other_dept);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_dept,v_company,'آزمایش','Fixture HQ','office','DQ'),
    (v_other_dept,v_company,'آزمایش دیگر','Fixture other','team','DO');
  for who in select * from (values
    ('admin','admin','9990018001'),('ceo','manager','9990018002'),('a','employee','9990018003'),
    ('b','manager','9990018004'),('hr','hr','9990018005'),('employee','employee','9990018006'),
    ('ordinary','employee','9990018007'),('unrelated','employee','9990018008'),('outsider','manager','9990018009')) t(k,role,code) loop
    insert into delegation_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@delegation-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),case when who.k='outsider' then v_outside else v_company end,
        case when who.k='outsider' then null when who.k in ('a','b','unrelated') then v_other_dept else v_dept end,
        who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx('admin'),'role','authenticated')::text,true);
  update public.profiles set manager_id=pg_temp.fx('ceo') where id in (pg_temp.fx('a'),pg_temp.fx('b'),pg_temp.fx('hr'),pg_temp.fx('employee'),pg_temp.fx('ordinary'));
  update public.profiles set manager_id=pg_temp.fx('b') where id=pg_temp.fx('unrelated');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',true);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'آزمایش مرخصی','Fixture paid',true,true,true,true) returning id into v_dept;
  insert into delegation_fx values('leave_type',v_dept);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',1,'{leave,errand}') returning id into v_dept;
  insert into delegation_fx values('hr_step',v_dept);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',2,'{leave,errand}') returning id into v_dept;
  insert into delegation_fx values('ceo_step',v_dept);
  -- A is a natural named approver, with no Manager role or broad personnel permission.
  insert into public.approval_steps(company_id,role,approver_id,step_order,applies_to)
    values(v_company,'employee',pg_temp.fx('a'),3,'{errand}') returning id into v_dept;
  insert into delegation_fx values('named_step',v_dept);
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(pg_temp.fx('a'),pg_temp.fx('leave_type'),'adjustment',4800,4800,'synthetic opening balance');
end; $$;

select pg_temp.assert('new delegation permission allows exactly edit',private.permission_allows('approval_delegate','edit') and not private.permission_allows('approval_delegate','read'));
select pg_temp.assert('nonadmin presets default to No',not exists(select 1 from public.role_permissions where permission='approval_delegate'));
insert into delegation_fx values('delegation_role',pg_temp.as_scalar('admin',
  'select public.app_save_role(null,''Delegation fixture'',''{"approval_delegate":"edit"}''::jsonb)')::uuid);
select pg_temp.expect('locked Manager stays locked',pg_temp.as_call('admin',format(
  'select public.app_save_role(%L,''Manager'',''{"approval_delegate":"edit"}''::jsonb)',
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='manager'))),'22023');
select pg_temp.expect('read level cannot be submitted directly',pg_temp.as_call('admin',
  'select public.app_save_role(null,''Invalid delegation fixture'',''{"approval_delegate":"read"}''::jsonb)'),'22023');
select pg_temp.expect('principal without Yes cannot appoint even through admin',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('a'))),'42501');
select pg_temp.expect('admin assigns supplementary role',pg_temp.as_call('admin',format(
  'select public.app_set_user_role_ids(%L,array[%L,%L,%L]::uuid[])',pg_temp.fx('ceo'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='manager'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='employee'),pg_temp.fx('delegation_role'))),'ok');
select pg_temp.expect('HR cannot assign delegation role',pg_temp.as_call('hr',format(
  'select public.app_set_user_role_ids(%L,array[%L,%L]::uuid[])',pg_temp.fx('ordinary'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='employee'),pg_temp.fx('delegation_role'))),'42501');
select pg_temp.expect('D4 HR cannot edit more privileged principal',pg_temp.as_call('hr',format(
  'update public.profiles set job_title=''blocked'' where id=%L',pg_temp.fx('ceo'))),'42501');
select pg_temp.expect('admin designates executive identities and exact HR step',pg_temp.as_call('admin',format(
  'select public.app_set_executive_settings(%L,%L,array[%L]::uuid[])',pg_temp.fx('ceo'),pg_temp.fx('hr'),pg_temp.fx('hr_step'))),'ok');
select pg_temp.expect('CEO self nomination denied',pg_temp.as_call('ceo',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('ceo'))),'22023');
select pg_temp.expect('ordinary operational cover is not a delegate',pg_temp.as_call('ceo',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('ordinary'))),'22023');
select pg_temp.expect('cross company delegate denied',pg_temp.as_call('ceo',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('outsider'))),'22023');
select pg_temp.expect('CEO self service saves named natural approver',pg_temp.as_call('ceo',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('a'))),'ok');
select pg_temp.expect('permission holder cannot change another principal',pg_temp.as_call('ceo',format(
  'select public.app_set_approval_delegate(%L,%L,false)',pg_temp.fx('b'),pg_temp.fx('a'))),'42501');
select pg_temp.expect('delegate cannot onward delegate borrowed authority',pg_temp.as_call('a',format(
  'select public.app_set_approval_delegate(%L,%L,false)',pg_temp.fx('a'),pg_temp.fx('b'))),'42501');
select pg_temp.expect('direct appointment insert is denied',pg_temp.as_call('a',format(
  'insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,configured_by) values(%L,%L,%L,''x'',''y'',%L)',
  pg_temp.fx('company'),pg_temp.fx('ceo'),pg_temp.fx('a'),pg_temp.fx('a'))),'42501');
select pg_temp.expect('CEO settings identity safe projection for own panel',pg_temp.as_scalar('ceo',
  'select public.app_delegation_context()->''executive_settings''->>''ceo_id'''),pg_temp.fx('ceo')::text);
select pg_temp.expect('saved delegate visible without roles editing access',pg_temp.as_scalar('ceo',
  'select public.app_delegation_context()->''saved''->>''delegate_name'''),'Fixture a');

-- Wall-clock evidence must not inherit this long-running fixture transaction's
-- start time. These requests and decisions are rolled back before later cases.
savepoint delegation_clock_regressions;
do $$
declare v_before timestamptz; v_request uuid;
begin
  v_before:=clock_timestamp();
  v_request:=pg_temp.submit('a','2026-12-01',true);
  perform pg_temp.assert('automatic CEO evidence uses the actual submission clock',exists(
    select 1 from public.leave_requests r join public.leave_request_approvals a on a.request_id=r.id
      where r.id=v_request and r.created_at>=v_before and a.evidence_kind='automatic'
        and a.created_at>=r.created_at and (a.evidence->>'processed_at')::timestamptz=a.created_at
        and (a.evidence->>'submitted_at')::timestamptz=r.created_at));
  perform pg_temp.assert('requester consent is recorded after actual request creation',exists(
    select 1 from public.leave_requests where id=v_request and signature_consent_at>=created_at));
  v_before:=clock_timestamp();
  perform pg_temp.expect('clock fixture HR approval succeeds',pg_temp.as_call('hr',format(
    'select public.approve_leave_request_v2(%L,%L,%L,true)',v_request,pg_temp.fx('hr_step'),pg_temp.sig())),'ok');
  perform pg_temp.assert('manual signature evidence uses execution clock',exists(
    select 1 from public.leave_request_approvals where request_id=v_request and step_id=pg_temp.fx('hr_step')
      and created_at>=v_before and signature_consent_at=created_at));
end; $$;
rollback to savepoint delegation_clock_regressions;
release savepoint delegation_clock_regressions;

-- Simulate an authority transition immediately after the company lock returns.
-- This rollback-only helper tests authorization placement deterministically;
-- actual competing-session lock waits remain a separate lead-run requirement.
savepoint delegation_post_lock_regressions;
create or replace function private.approval_lock(p_company uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare v_hook text; v_actor uuid:=auth.uid(); v_claims text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('approval:'||p_company::text,0));
  v_hook:=nullif(current_setting('bj.test.after_approval_lock',true),'');
  if v_hook is null then return; end if;
  perform set_config('bj.test.after_approval_lock','',true);
  v_claims:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx('admin'),'role','authenticated')::text,true);
  if v_hook='revoke_admin' then
    delete from public.user_roles where user_id=v_actor and role='admin';
  elsif v_hook='deactivate_caller' then
    update public.profiles set active=false where id=v_actor;
  elsif v_hook='revoke_leave_requests' then
    delete from public.role_permissions where permission='leave_requests'
      and role_id in (select role_id from public.user_roles where user_id=v_actor);
  else raise exception 'unknown approval-lock fixture hook';
  end if;
  perform set_config('request.jwt.claims',v_claims,true);
end; $$;
select set_config('bj.test.after_approval_lock','revoke_admin',true);
select pg_temp.expect('former admin cannot change executive settings after lock wait',pg_temp.as_call('admin',format(
  'select public.app_set_executive_settings(%L,%L,array[%L]::uuid[])',pg_temp.fx('ceo'),pg_temp.fx('hr'),pg_temp.fx('hr_step'))),'42501');
select set_config('bj.test.after_approval_lock','revoke_admin',true);
select pg_temp.expect('former admin cannot configure another principal after lock wait',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('a'))),'42501');
select set_config('bj.test.after_approval_lock','',true);
insert into delegation_fx values('post_lock_cancel',pg_temp.submit('ordinary','2026-12-02'));
select set_config('bj.test.after_approval_lock','deactivate_caller',true);
select pg_temp.expect('deactivated requester cannot cancel after lock wait',pg_temp.as_call('ordinary',format(
  'select public.cancel_leave_request(%L)',pg_temp.fx('post_lock_cancel'))),'42501');
select set_config('bj.test.after_approval_lock','',true);
select pg_temp.login('admin');
-- HR defaults to read; establish edit so this case reaches the lock and revocation.
update public.role_permissions set level='edit' where permission='leave_requests'
  and role_id=(select id from public.roles where company_id=pg_temp.fx('company') and system_key='hr');
select pg_temp.assert('post-lock cancellation fixture has edit authority before revocation',
  private.has_perm(pg_temp.fx('hr'),'leave_requests','edit'));
select set_config('bj.test.after_approval_lock','revoke_leave_requests',true);
select pg_temp.expect('revoked leave editor cannot cancel after lock wait',pg_temp.as_call('hr',format(
  'select public.cancel_leave_request(%L)',pg_temp.fx('post_lock_cancel'))),'42501');
select set_config('bj.test.after_approval_lock','deactivate_caller',true);
select pg_temp.expect('deactivated approver cannot reject after lock wait',pg_temp.as_call('hr',format(
  'select public.reject_leave_request_v2(%L,%L,''Fixture rejection'')',pg_temp.fx('post_lock_cancel'),pg_temp.fx('hr_step'))),'42501');
select set_config('bj.test.after_approval_lock','deactivate_caller',true);
select pg_temp.expect('deactivated requester cannot submit after lock wait',pg_temp.as_call('ordinary',format(
  'select public.submit_leave_request_v2(%L,''2026-12-03'',''2026-12-03'',''full'',%L,true)',pg_temp.fx('leave_type'),pg_temp.sig())),'42501');
select set_config('bj.test.after_approval_lock','revoke_admin',true);
select pg_temp.expect('bulk import refreshes admin authority under company lock',pg_temp.as_call('admin',format(
  'select public.app_bulk_import_employees(%L,''update'',%L::jsonb,''[]''::jsonb,current_date,false,''{}''::uuid[],''[]''::jsonb,''{}''::text[])',
  pg_temp.fx('company'),(select jsonb_build_array(jsonb_build_object('personnel_no',p.personnel_no,
    'full_name',p.full_name,'department_code','DQ','manager_personnel_no',c.personnel_no,'role','employee'))::text
    from public.profiles p,public.profiles c where p.id=pg_temp.fx('ordinary') and c.id=pg_temp.fx('ceo')))),'42501');
select set_config('bj.test.after_approval_lock','',true);
rollback to savepoint delegation_post_lock_regressions;
release savepoint delegation_post_lock_regressions;

-- Operational cover and temporary approval authority remain separate.
select pg_temp.expect('cross department eligible approver is a replacement candidate',pg_temp.as_scalar('ceo',format(
  'select count(*) from public.get_replacement_candidates(''2026-11-02'',''2026-11-02'') where profile_id=%L',pg_temp.fx('a'))),'1');
select pg_temp.expect('ordinary department colleague remains operational replacement',pg_temp.as_scalar('ceo',format(
  'select count(*) from public.get_replacement_candidates(''2026-11-02'',''2026-11-02'') where profile_id=%L',pg_temp.fx('ordinary'))),'1');
select pg_temp.expect('No Replacement retains saved approval delegate',pg_temp.as_scalar('ceo',
  'select public.app_request_delegation_preview(''2026-11-02'',''2026-11-02'')->''saved''->>''delegate_name'''),'Fixture a');
select pg_temp.expect('ordinary cover produces no temporary signing authority',pg_temp.as_scalar('ceo',format(
  'select public.app_request_delegation_preview(''2026-11-02'',''2026-11-02'',''day'',''full'',null,null,%L)->>''temporary_eligible''',pg_temp.fx('ordinary'))),'false');
select pg_temp.expect('AM preview snapshots first half of configured workday',pg_temp.as_scalar('ceo',
  'select (public.app_request_delegation_preview(''2026-11-02'',''2026-11-02'',''day'',''am'')->''bounds''->>''starts_at'')::timestamptz at time zone ''Asia/Tehran'''),'2026-11-02 07:00:00');
select pg_temp.expect('AM end is exclusive workday midpoint',pg_temp.as_scalar('ceo',
  'select (public.app_request_delegation_preview(''2026-11-02'',''2026-11-02'',''day'',''am'')->''bounds''->>''ends_at'')::timestamptz at time zone ''Asia/Tehran'''),'2026-11-02 11:00:00');
select pg_temp.expect('PM starts at workday midpoint',pg_temp.as_scalar('ceo',
  'select (public.app_request_delegation_preview(''2026-11-02'',''2026-11-02'',''day'',''pm'')->''bounds''->>''starts_at'')::timestamptz at time zone ''Asia/Tehran'''),'2026-11-02 11:00:00');
select pg_temp.expect('PM ends at configured workday end',pg_temp.as_scalar('ceo',
  'select (public.app_request_delegation_preview(''2026-11-02'',''2026-11-02'',''day'',''pm'')->''bounds''->>''ends_at'')::timestamptz at time zone ''Asia/Tehran'''),'2026-11-02 15:00:00');

-- Stale-preview rejection and immutable half-day bounds.
do $$
declare v_preview text; v_request uuid;
begin
  v_preview:=pg_temp.as_scalar('ceo',format('select public.app_request_delegation_preview(''2026-11-03'',''2026-11-03'',''day'',''am'',null,null,%L)',pg_temp.fx('b')));
  perform pg_temp.login('admin');
  update public.work_settings set work_start='08:00',work_end='16:00' where company_id=pg_temp.fx('company');
  perform pg_temp.expect('stale half-day preview is rejected',pg_temp.as_call('ceo',format(
    'select public.submit_leave_request_v2(%L,''2026-11-03'',''2026-11-03'',''am'',%L,true,null,%L,false,%L,true)',
    pg_temp.fx('leave_type'),pg_temp.sig(),pg_temp.fx('b'),v_preview)),'22023');
  v_request:=pg_temp.submit('ceo','2026-11-03',false,'b','am',true);
  insert into delegation_fx values('half_day',v_request);
  perform pg_temp.login('admin');
  update public.work_settings set work_start='07:00',work_end='15:00' where company_id=pg_temp.fx('company');
  perform pg_temp.expect('saved AM window survives work-settings edits',
    (select (starts_at at time zone 'Asia/Tehran')::text from public.approval_request_policy where request_id=v_request),'2026-11-03 08:00:00');
  perform pg_temp.expect('saved AM end survives work-settings edits',
    (select (ends_at at time zone 'Asia/Tehran')::text from public.approval_request_policy where request_id=v_request),'2026-11-03 12:00:00');
  perform pg_temp.assert('pending source absence cannot activate its own temporary delegate',
    not exists(select 1 from private.effective_approval_delegate(pg_temp.fx('ceo')) where source_request_id=v_request));
  perform pg_temp.expect('prospective replacement cannot approve source through that grant',pg_temp.as_call('b',format(
    'select public.approve_leave_request_v2(%L,%L,%L,true)',v_request,pg_temp.fx('ceo_step'),pg_temp.sig())),'42501');
  perform pg_temp.expect('CEO temporary delegation requires distinct explicit attestation',pg_temp.as_call('ceo',format(
    'select public.submit_leave_request_v2(%L,''2026-11-04'',''2026-11-04'',''full'',%L,true,null,%L,false,null,false)',
    pg_temp.fx('leave_type'),pg_temp.sig(),pg_temp.fx('b'))),'22023');
end; $$;

-- Scoped approval-only read and actual delegated signer evidence.
insert into delegation_fx values('incoming',pg_temp.submit('employee','2026-11-05'));
insert into delegation_fx values('unrelated_request',pg_temp.submit('unrelated','2026-11-06'));
select pg_temp.expect('named approver delegate reaches inbox without Manager role',pg_temp.as_scalar('a',
  'select public.app_approval_capabilities()->>''can_approve'''),'true');
select pg_temp.expect('delegate reads only the authorized request context',pg_temp.as_scalar('a',format(
  'select public.app_request_approval_context(%L)->>''employee_name''',pg_temp.fx('incoming'))),'Fixture employee');
select pg_temp.expect('unrelated request context stays hidden',pg_temp.as_call('a',format(
  'select public.app_request_approval_context(%L)',pg_temp.fx('unrelated_request'))),'P0002');
select pg_temp.expect('request RLS grants authorized delegate request',pg_temp.as_scalar('a',format(
  'select count(*) from public.leave_requests where id=%L',pg_temp.fx('incoming'))),'1');
select pg_temp.expect('unrelated request RLS stays hidden',pg_temp.as_scalar('a',format(
  'select count(*) from public.leave_requests where id=%L',pg_temp.fx('unrelated_request'))),'0');
select pg_temp.expect('delegation does not broaden personnel management',pg_temp.as_scalar('a',format(
  'with changed as(update public.profiles set job_title=''unauthorized'' where id=%L returning id) select count(*) from changed',pg_temp.fx('employee'))),'0');
select pg_temp.expect('manual delegated step respects earlier HR order',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('incoming'),pg_temp.fx('ceo_step'),pg_temp.sig())),'22023');
select pg_temp.expect('HR signs its real step',pg_temp.as_call('hr',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('incoming'),pg_temp.fx('hr_step'),pg_temp.sig())),'ok');
select pg_temp.expect('delegate uses own actual PNG for CEO step',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('incoming'),pg_temp.fx('ceo_step'),pg_temp.sig())),'ok');
select pg_temp.assert('delegated evidence records both actor and principal',exists(select 1 from public.leave_request_approvals
  where request_id=pg_temp.fx('incoming') and step_id=pg_temp.fx('ceo_step') and evidence_kind='delegated'
    and approver_id=pg_temp.fx('a') and principal_id=pg_temp.fx('ceo') and signature_data=pg_temp.sig()));
insert into delegation_fx values('own_auto',pg_temp.submit('a','2026-11-07',true));
select pg_temp.expect('delegate cannot sign another step of their own request',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('own_auto'),pg_temp.fx('hr_step'),pg_temp.sig())),'42501');
select pg_temp.expect('delegate cannot sign the CEO step of their own request',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('own_auto'),pg_temp.fx('ceo_step'),pg_temp.sig())),'42501');
select pg_temp.expect('own request already carries the automatic CEO step',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('own_auto') and evidence_kind='automatic'),'1');

-- Consent required on every old client; all four v2 forms approve the CEO step at submission.
select pg_temp.expect('legacy eligible submission demands responsibility consent',pg_temp.as_call('a',format(
  'select public.submit_leave_request(%L,''2026-11-08'',''2026-11-08'',''full'',%L,true)',pg_temp.fx('leave_type'),pg_temp.sig())),'22023');
insert into delegation_fx values('auto_leave',pg_temp.submit('a','2026-11-09',true));
insert into delegation_fx values('auto_hourly',pg_temp.as_scalar('a',format(
  'select public.submit_hourly_leave_request_v2(%L,''2026-11-10'',''08:00'',''09:00'',%L,true,null,null,true,null,false)',
  pg_temp.fx('leave_type'),pg_temp.sig()))::uuid);
insert into delegation_fx values('auto_errand',pg_temp.as_scalar('a',format(
  'select public.submit_errand_request_v2(''2026-11-11'',''08:00'',''09:00'',''Fixture location'',%L,true,null,true,null,false)',pg_temp.sig()))::uuid);
insert into delegation_fx values('auto_daily_errand',pg_temp.as_scalar('a',format(
  'select public.submit_daily_errand_request_v2(''2026-11-12'',''2026-11-12'',''Fixture location'',%L,true,null,true,null,false)',pg_temp.sig()))::uuid);
select pg_temp.expect('all four v2 kinds approve the CEO step at submission',
  (select count(*)::text from public.leave_request_approvals where step_id=pg_temp.fx('ceo_step') and evidence_kind='automatic'
    and request_id in (pg_temp.fx('auto_leave'),pg_temp.fx('auto_hourly'),pg_temp.fx('auto_errand'),pg_temp.fx('auto_daily_errand'))),'4');
select pg_temp.assert('automatic evidence records requester consent and submission time',not exists(select 1 from public.leave_request_approvals a
  join public.leave_requests r on r.id=a.request_id where a.evidence_kind='automatic' and r.company_id=pg_temp.fx('company')
    and ((a.evidence->>'consent_at')::timestamptz is distinct from r.signature_consent_at
      or (a.evidence->>'submitted_at')::timestamptz is distinct from r.created_at or r.signature_data is null)));

-- Owner example: the HR head as the CEO's delegate. Their own request needs no HR signature
-- (mapped exemption) and the CEO step is automatic, so it is approved at submission.
savepoint hr_head_delegate;
select pg_temp.expect('admin appoints the HR head as CEO delegate',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('hr'))),'ok');
insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
  values(pg_temp.fx('hr'),pg_temp.fx('leave_type'),'adjustment',4800,4800,'fixture balance');
insert into delegation_fx values('hr_head_auto',pg_temp.submit('hr','2027-01-08',true));
select pg_temp.expect('HR head delegate request approved at submission',
  (select status::text from public.leave_requests where id=pg_temp.fx('hr_head_auto')),'approved');
select pg_temp.expect('one automatic CEO row and no fabricated HR signature',
  (select string_agg(evidence_kind,',' order by evidence_kind) from public.leave_request_approvals where request_id=pg_temp.fx('hr_head_auto')),'automatic');
select pg_temp.expect('approval at submission consumes leave once',
  (select count(*)::text from public.leave_ledger where request_id=pg_temp.fx('hr_head_auto') and entry_type='consumption'),'1');
select pg_temp.expect('former delegate A is no longer offered automatic approval',pg_temp.as_scalar('a',
  'select public.app_request_delegation_preview(''2027-01-09'',''2027-01-09'')->>''auto_approval_eligible'''),'false');
rollback to savepoint hr_head_delegate;

-- PR #7 review fixes. Rolled back so later cases see the original state.
savepoint review_fixes;
select pg_temp.assert('anon executes no delegation RPC',not exists(select 1 from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname in('app_can_read_approval_request','app_approval_capabilities',
    'app_delegation_context','app_search_delegates','app_set_approval_delegate','app_set_executive_settings',
    'app_request_delegation_preview','submit_leave_request_v2','submit_hourly_leave_request_v2','submit_errand_request_v2',
    'submit_daily_errand_request_v2','approve_leave_request_v2','reject_leave_request_v2','app_request_approval_progress',
    'app_request_approval_context','app_approval_queue','get_leave_request_signatures')
    and has_function_privilege('anon',p.oid,'EXECUTE')));
select pg_temp.assert('step_delegation uses the delegate index',exists(select 1 from pg_indexes
  where schemaname='public' and indexname='approval_delegations_delegate_live'));

-- The CEO cannot sign a CEO step already approved automatically; other steps still apply.
select pg_temp.expect('CEO cannot re-sign an automatically approved CEO step',pg_temp.as_call('ceo',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('auto_errand'),pg_temp.fx('ceo_step'),pg_temp.sig())),'22023');
select pg_temp.expect('HR signs the auto-approved errand',pg_temp.as_call('hr',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('auto_errand'),pg_temp.fx('hr_step'),pg_temp.sig())),'ok');
select pg_temp.expect('errand still waits for its named step',
  (select status::text from public.leave_requests where id=pg_temp.fx('auto_errand')),'pending');

-- Read scope: delegate reads pending work and requests they decided, not decided history.
insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
  values(pg_temp.fx('employee'),pg_temp.fx('leave_type'),'adjustment',4800,4800,'review-fix balance');
insert into delegation_fx values('history',pg_temp.submit('employee','2027-01-06'));
select pg_temp.expect('delegate reads a pending request they can act on',pg_temp.as_scalar('a',format(
  'select count(*) from public.leave_requests where id=%L',pg_temp.fx('history'))),'1');
select pg_temp.expect('HR signs history request',pg_temp.as_call('hr',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('history'),pg_temp.fx('hr_step'),pg_temp.sig())),'ok');

-- One hop only: A's own delegate B cannot sign the CEO step A holds by delegation.
select pg_temp.expect('A gains delegation permission',pg_temp.as_call('admin',format(
  'select public.app_set_user_role_ids(%L,array[%L,%L]::uuid[])',pg_temp.fx('a'),
  (select id from public.roles where company_id=pg_temp.fx('company') and system_key='employee'),pg_temp.fx('delegation_role'))),'ok');
select pg_temp.expect('admin sets B as A''s saved delegate',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,false)',pg_temp.fx('a'),pg_temp.fx('b'))),'ok');
select pg_temp.expect('delegate of a delegate cannot sign the principal''s step',pg_temp.as_call('b',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('history'),pg_temp.fx('ceo_step'),pg_temp.sig())),'42501');

select pg_temp.expect('CEO signs history request',pg_temp.as_call('ceo',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('history'),pg_temp.fx('ceo_step'),pg_temp.sig())),'ok');
select pg_temp.expect('history request approved',(select status::text from public.leave_requests where id=pg_temp.fx('history')),'approved');
select pg_temp.expect('delegate no longer reads a decided request they did not sign',pg_temp.as_scalar('a',format(
  'select count(*) from public.leave_requests where id=%L',pg_temp.fx('history'))),'0');
select pg_temp.expect('delegate no longer reads its decision rows',pg_temp.as_scalar('a',format(
  'select count(*) from public.leave_request_approvals where request_id=%L',pg_temp.fx('history'))),'0');
select pg_temp.expect('requester still reads own decided request',pg_temp.as_scalar('employee',format(
  'select count(*) from public.leave_requests where id=%L',pg_temp.fx('history'))),'1');
select pg_temp.expect('delegate who signed keeps reading that request',pg_temp.as_scalar('a',format(
  'select count(*) from public.leave_requests where id=%L',pg_temp.fx('incoming'))),'1');

-- Re-designating a former CEO does not revive the earlier attestation.
select pg_temp.assert('CEO saved grant is CEO-authorized before the change',exists(select 1 from public.approval_delegations
  where principal_id=pg_temp.fx('ceo') and source_request_id is null and revoked_at is null and ceo_authorized));
select pg_temp.expect('admin designates another CEO',pg_temp.as_call('admin',format(
  'select public.app_set_executive_settings(%L,%L,%L::uuid[])',pg_temp.fx('b'),
  (select hr_head_id from public.approval_executive_settings where company_id=pg_temp.fx('company')),
  (select hr_step_ids::text from public.approval_executive_settings where company_id=pg_temp.fx('company')))),'ok');
select pg_temp.expect('admin restores the former CEO',pg_temp.as_call('admin',format(
  'select public.app_set_executive_settings(%L,%L,%L::uuid[])',pg_temp.fx('ceo'),
  (select hr_head_id from public.approval_executive_settings where company_id=pg_temp.fx('company')),
  (select hr_step_ids::text from public.approval_executive_settings where company_id=pg_temp.fx('company')))),'ok');
select pg_temp.assert('former CEO''s attestation is not revived',not exists(select 1 from public.approval_delegations
  where principal_id=pg_temp.fx('ceo') and revoked_at is null and ceo_authorized));
select pg_temp.expect('delegate is no longer offered automatic approval',pg_temp.as_scalar('a',
  'select public.app_request_delegation_preview(''2027-01-07'',''2027-01-07'')->>''auto_approval_eligible'''),'false');

-- e2e cleanup no longer trips over delegation history (all fixture codes match its junk pattern).
-- Requests are removed first: a junk approver plus the junk requester they signed for hits a
-- pre-existing cascade-order FK error on leave_request_approvals (same FKs on main; see TASKS).
delete from public.leave_requests where company_id=pg_temp.fx('company');
-- The fixture admin's own code matches the junk pattern; keep the caller out of the deletion.
set local session_replication_role=replica;
update public.profiles set employee_code='fixture-admin' where id=pg_temp.fx('admin');
set local session_replication_role=origin;
select pg_temp.assert('saved delegation and executive rows still reference fixture accounts',
  exists(select 1 from public.approval_delegations where company_id=pg_temp.fx('company') and revoked_at is null)
  and exists(select 1 from public.approval_executive_settings where company_id=pg_temp.fx('company') and ceo_id is not null));
select pg_temp.expect('e2e cleanup succeeds with delegation rows present',
  left(pg_temp.as_call('admin','select public.app_cleanup_e2e_users()'),2),'ok');
select pg_temp.assert('cleanup removed delegation rows of throwaway accounts',not exists(select 1 from public.approval_delegations
  where company_id=pg_temp.fx('company')) and (select ceo_id is null and hr_head_id is null
  from public.approval_executive_settings where company_id=pg_temp.fx('company')));
rollback to savepoint review_fixes;
select pg_temp.assert('automatic CEO evidence has null human signer and PNG',exists(select 1 from public.leave_request_approvals
  where request_id=pg_temp.fx('auto_leave') and step_id=pg_temp.fx('ceo_step') and evidence_kind='automatic'
    and approver_id is null and signature_data is null and signature_consent_at is null
    and principal_id=pg_temp.fx('ceo') and authority_id is not null and evidence->>'statement' is not null));
select pg_temp.expect('automatic CEO step bypasses earlier unfinished HR',
  (select status::text from public.leave_requests where id=pg_temp.fx('auto_leave')),'pending');
select pg_temp.expect('partial CEO completion has no leave consumption',
  (select count(*)::text from public.leave_ledger where request_id=pg_temp.fx('auto_leave')),'0');
select pg_temp.expect('non-HR CEO delegate still has required HR review',pg_temp.as_scalar('a',format(
  'select count(*) from jsonb_array_elements(public.app_request_approval_progress(%L)) p where p->>''step_id''=%L and p->>''evidence_kind''=''pending''',
  pg_temp.fx('auto_leave'),pg_temp.fx('hr_step'))),'1');
select pg_temp.expect('HR can complete after automatic CEO decision',pg_temp.as_call('hr',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('auto_leave'),pg_temp.fx('hr_step'),pg_temp.sig())),'ok');
select pg_temp.expect('shared finalizer approves only after HR',
  (select status::text from public.leave_requests where id=pg_temp.fx('auto_leave')),'approved');
select pg_temp.expect('shared finalizer consumes leave once',
  (select count(*)::text from public.leave_ledger where request_id=pg_temp.fx('auto_leave') and entry_type='consumption'),'1');
select pg_temp.assert('automatic errand step never assigns per diem',
  (select per_diem_rials is null from public.leave_requests where id=pg_temp.fx('auto_errand')));

-- Rejection and cancellation still work after the automatic CEO step.
insert into delegation_fx values('rejected_auto',pg_temp.submit('a','2026-11-14',true));
select pg_temp.expect('HR may still reject after automatic CEO approval',pg_temp.as_call('hr',format(
  'select public.reject_leave_request_v2(%L,%L,''Fixture rejection'')',pg_temp.fx('rejected_auto'),pg_temp.fx('hr_step'))),'ok');
insert into delegation_fx values('cancelled_auto',pg_temp.submit('a','2026-11-15',true));
select pg_temp.expect('requester cancels after automatic CEO approval',pg_temp.as_call('a',format(
  'select public.cancel_leave_request(%L)',pg_temp.fx('cancelled_auto'))),'ok');
select pg_temp.expect('rejected and cancelled requests consume nothing',
  (select count(*)::text from public.leave_ledger where request_id in (pg_temp.fx('rejected_auto'),pg_temp.fx('cancelled_auto')) and entry_type='consumption'),'0');

-- HR head exemption is exact and independent of CEO delegate identity.
insert into delegation_fx values('hr_own',pg_temp.submit('hr','2026-11-16'));
select pg_temp.expect('designated HR head snapshots mapped exemption',
  (select cardinality(hr_exempt_step_ids)::text from public.approval_request_policy where request_id=pg_temp.fx('hr_own')),'1');
select pg_temp.expect('HR exemption is not fabricated approval evidence',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('hr_own') and step_id=pg_temp.fx('hr_step')),'0');
select pg_temp.expect('HR-head exemption visible in progress',pg_temp.as_scalar('hr',format(
  'select count(*) from jsonb_array_elements(public.app_request_approval_progress(%L)) p where p->>''evidence_kind''=''hr_exempt''',pg_temp.fx('hr_own'))),'1');
select pg_temp.expect('HR head gets no automatic CEO approval when someone else is CEO delegate',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('hr_own') and evidence_kind='automatic'),'0');

-- Authority is checked at submission: switching the CEO's delegate moves the entitlement.
select pg_temp.expect('admin switches saved authority to B',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('b'))),'ok');
select pg_temp.expect('former delegate''s consent is refused',pg_temp.as_call('a',format(
  'select public.submit_leave_request_v2(%L,''2026-11-17'',''2026-11-17'',''full'',%L,true,null,null,true,null,false)',
  pg_temp.fx('leave_type'),pg_temp.sig())),'22023');
insert into delegation_fx values('aba',pg_temp.submit('a','2026-11-17'));
select pg_temp.expect('former delegate''s request waits for the CEO',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('aba')),'0');
insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
  values(pg_temp.fx('b'),pg_temp.fx('leave_type'),'adjustment',4800,4800,'fixture balance');
insert into delegation_fx values('b_auto',pg_temp.submit('b','2026-11-18',true));
select pg_temp.expect('new delegate''s own request gets the CEO step at once',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('b_auto') and evidence_kind='automatic'),'1');
select pg_temp.expect('admin switches saved authority back to A',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('a'))),'ok');
select pg_temp.expect('admin removes principal delegation permission',pg_temp.as_call('admin',format(
  'select public.app_save_role(%L,''Delegation fixture'',''{}''::jsonb)',pg_temp.fx('delegation_role'))),'ok');
select pg_temp.expect('no automatic approval while the CEO lacks delegation permission',pg_temp.as_scalar('a',
  'select public.app_request_delegation_preview(''2026-11-19'',''2026-11-19'')->>''auto_approval_eligible'''),'false');
select pg_temp.expect('admin restores principal delegation permission',pg_temp.as_call('admin',format(
  'select public.app_save_role(%L,''Delegation fixture'',''{"approval_delegate":"edit"}''::jsonb)',pg_temp.fx('delegation_role'))),'ok');
select pg_temp.expect('restored permission makes A eligible again',pg_temp.as_scalar('a',
  'select public.app_request_delegation_preview(''2026-11-19'',''2026-11-19'')->>''auto_approval_eligible'''),'true');

insert into delegation_fx values('step_change',pg_temp.submit('employee','2026-11-21'));
select pg_temp.login('admin');
update public.approval_steps set approver_id=pg_temp.fx('b') where id=pg_temp.fx('ceo_step');
update public.approval_steps set approver_id=null where id=pg_temp.fx('ceo_step');
select pg_temp.assert('pending configuration changes are surfaced',
  (select configuration_changed from public.approval_request_policy where request_id=pg_temp.fx('step_change')));
select pg_temp.login('admin');
update public.approval_steps set active=false where id=pg_temp.fx('ceo_step');
select pg_temp.expect('CEO auto authority requires natural steps for every request kind',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('a'))),'22023');
select pg_temp.login('admin');
update public.approval_steps set active=true where id=pg_temp.fx('ceo_step');

-- Exact half-day boundaries and fallback to the current saved appointment.
select pg_temp.expect('admin approves future half-day source',pg_temp.as_call('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true)',pg_temp.fx('half_day'),pg_temp.sig())),'ok');
select pg_temp.expect('AM delegate starts exactly at saved 08:00',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'),'2026-11-03 08:00 Asia/Tehran')),pg_temp.fx('b')::text);
select pg_temp.expect('saved delegate handles instant before AM starts',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'),'2026-11-03 07:59:59.999999 Asia/Tehran')),pg_temp.fx('a')::text);
select pg_temp.expect('AM end is exclusive and saved delegate resumes at noon',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'),'2026-11-03 12:00 Asia/Tehran')),pg_temp.fx('a')::text);

-- A temporary interval that has fully ended leaves the saved delegate effective.
select pg_temp.login('admin');
update public.approval_delegations set starts_at=clock_timestamp()-interval '70 minutes',
  ends_at=clock_timestamp()-interval '30 minutes',activated_at=clock_timestamp()-interval '90 minutes'
  where source_request_id=pg_temp.fx('half_day');
select pg_temp.expect('saved A currently effective after whole temporary interval',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'))),pg_temp.fx('a')::text);

-- Retain the interval as history, but end that fixture before nominating another same-day source.
select pg_temp.login('admin');
update public.approval_delegations set revoked_at=clock_timestamp() where source_request_id=pg_temp.fx('half_day');

-- An approved current absence activates temporary B; late activation has no retrospective authority.
insert into delegation_fx values('temporary_now',pg_temp.submit('ceo',(clock_timestamp() at time zone 'Asia/Tehran')::date,false,'b','full',true));
select pg_temp.expect('source still pending retains saved A',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'))),pg_temp.fx('a')::text);
select pg_temp.expect('admin fully approves current source',pg_temp.as_call('admin',format(
  'select public.approve_leave_request_v2(%L,null,%L,true,true)',pg_temp.fx('temporary_now'),pg_temp.sig())),'ok');
select pg_temp.expect('approved current absence activates B',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'))),pg_temp.fx('b')::text);
select pg_temp.assert('late approval records activation timestamp',exists(select 1 from public.approval_delegations
  where source_request_id=pg_temp.fx('temporary_now') and activated_at>=created_at));
select pg_temp.expect('CEO default may be edited during temporary absence',pg_temp.as_call('admin',format(
  'select public.app_set_approval_delegate(%L,%L,true)',pg_temp.fx('ceo'),pg_temp.fx('a'))),'ok');
select pg_temp.expect('editing saved fallback leaves active temporary B in place',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'))),pg_temp.fx('b')::text);
insert into delegation_fx values('temporary_auto',pg_temp.submit('b','2026-11-23',true));
select pg_temp.expect('effective temporary CEO delegate gets the CEO step at once',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('temporary_auto') and evidence_kind='automatic'),'1');
select pg_temp.login('admin');
update public.approval_delegations set ends_at=clock_timestamp()-interval '1 second'
  where source_request_id=pg_temp.fx('temporary_now');
select pg_temp.expect('expired temporary delegate is no longer offered automatic approval',pg_temp.as_scalar('b',
  'select public.app_request_delegation_preview(''2026-11-24'',''2026-11-24'')->>''auto_approval_eligible'''),'false');
select pg_temp.expect('saved A resumes after temporary expiry',
  (select delegate_id::text from private.effective_approval_delegate(pg_temp.fx('ceo'))),pg_temp.fx('a')::text);
-- Internal lifecycle fixture: cancellation revokes the historical source grant immediately.
-- The ordinary cancellation RPC continues its existing not-yet-started rule for approved leave.
update public.leave_requests set status='cancelled' where id=pg_temp.fx('temporary_now');
select pg_temp.assert('source cancellation durably revokes temporary grant',exists(select 1 from public.approval_delegations
  where source_request_id=pg_temp.fx('temporary_now') and revoked_at is not null));

-- Direct and department manager steps share a role but have distinct identities/evidence.
select pg_temp.login('admin');
update public.departments set manager_id=pg_temp.fx('b') where id=pg_temp.fx('dept');
insert into public.approval_steps(company_id,role,manager_scope,step_order,applies_to)
  values(pg_temp.fx('company'),'manager','department',3,'{leave,errand}') returning id as department_step \gset
insert into delegation_fx values('department_step',:'department_step');
insert into delegation_fx values('two_manager_steps',pg_temp.submit('employee','2026-11-24'));
select pg_temp.expect('HR signs two-manager request',pg_temp.as_call('hr',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('two_manager_steps'),pg_temp.fx('hr_step'),pg_temp.sig())),'ok');
select pg_temp.expect('delegated CEO direct step uses exact ID',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('two_manager_steps'),pg_temp.fx('ceo_step'),pg_temp.sig())),'ok');
select pg_temp.expect('department step still pending after same role signed',
  (select status::text from public.leave_requests where id=pg_temp.fx('two_manager_steps')),'pending');
select pg_temp.expect('department manager signs its distinct step',pg_temp.as_call('b',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('two_manager_steps'),pg_temp.fx('department_step'),pg_temp.sig())),'ok');
select pg_temp.expect('two manager-role rows remain distinct',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('two_manager_steps') and step_role='manager'),'2');
select pg_temp.expect('duplicate exact-step decision is rejected',pg_temp.as_call('b',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('two_manager_steps'),pg_temp.fx('department_step'),pg_temp.sig())),'22023');

-- One legacy manager row must not satisfy two exact current manager identities.
insert into delegation_fx values('ambiguous_legacy',pg_temp.submit('employee','2026-11-29'));
insert into public.leave_request_approvals(request_id,step_role,approver_id,decision,signature_data,signature_consent_at)
  values(pg_temp.fx('ambiguous_legacy'),'manager',pg_temp.fx('ceo'),'approved',pg_temp.sig(),clock_timestamp());
select pg_temp.expect('legacy manager row leaves both distinct manager steps outstanding',pg_temp.as_scalar('admin',format(
  'select count(*) from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''step_role''=''manager'' and item->>''evidence_kind''=''pending''',
  pg_temp.fx('ambiguous_legacy'))),'2');
select pg_temp.expect('ambiguous legacy mapping is surfaced for reconciliation',pg_temp.as_scalar('admin',format(
  'select public.app_request_approval_context(%L)->>''legacy_reconciliation_required''',pg_temp.fx('ambiguous_legacy'))),'true');
select pg_temp.expect('HR signature does not finalize through ambiguous legacy role',pg_temp.as_call('hr',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('ambiguous_legacy'),pg_temp.fx('hr_step'),pg_temp.sig())),'ok');
select pg_temp.expect('ambiguous legacy manager signature cannot complete chain',
  (select status::text from public.leave_requests where id=pg_temp.fx('ambiguous_legacy')),'pending');
select pg_temp.expect('explicit direct manager step can be reconciled',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('ambiguous_legacy'),pg_temp.fx('ceo_step'),pg_temp.sig())),'ok');
select pg_temp.expect('department step still requires its own exact decision',
  (select status::text from public.leave_requests where id=pg_temp.fx('ambiguous_legacy')),'pending');
select pg_temp.expect('explicit department manager step completes reconciliation',pg_temp.as_call('b',format(
  'select public.approve_leave_request_v2(%L,%L,%L,true)',pg_temp.fx('ambiguous_legacy'),pg_temp.fx('department_step'),pg_temp.sig())),'ok');
select pg_temp.expect('exact manager decisions complete reconciled chain',
  (select status::text from public.leave_requests where id=pg_temp.fx('ambiguous_legacy')),'approved');

-- Named display-as-HR is not an HR exemption unless explicitly mapped by the admin.
select pg_temp.login('admin');
-- A person can own only one named step; reuse that person's existing fixture row.
update public.approval_steps set role='hr',step_order=4,applies_to='{leave,errand}' where id=pg_temp.fx('named_step');
insert into delegation_fx values('extra_hr_step',pg_temp.fx('named_step'));
insert into delegation_fx values('hr_named_distinction',pg_temp.submit('hr','2026-11-25'));
select pg_temp.expect('unmapped named HR display remains required',pg_temp.as_scalar('hr',format(
  'select count(*) from jsonb_array_elements(public.app_request_approval_progress(%L)) p where p->>''step_id''=%L and p->>''evidence_kind''=''pending''',
  pg_temp.fx('hr_named_distinction'),pg_temp.fx('extra_hr_step'))),'1');
select pg_temp.login('admin');
update public.approval_steps set approver_id=pg_temp.fx('b') where id=pg_temp.fx('hr_step');
select pg_temp.assert('editing mapped step meaning does not silently retain live waiver',
  private.request_step_applies(pg_temp.fx('hr_named_distinction'),pg_temp.fx('hr_step')));
select pg_temp.assert('original exemption snapshot retained for history',
  (select pg_temp.fx('hr_step')=any(hr_exempt_step_ids) from public.approval_request_policy where request_id=pg_temp.fx('hr_named_distinction')));

-- Immutable manual expected/signer evidence survives later names and step deletion.
select pg_temp.login('admin');
update public.profiles set full_name='Renamed fixture a' where id=pg_temp.fx('a');
select pg_temp.expect('historical actual signer name remains snapshotted',pg_temp.as_scalar('admin',format(
  'select p->>''signer_name'' from jsonb_array_elements(public.app_request_approval_progress(%L)) p where p->>''step_id''=%L',
  pg_temp.fx('incoming'),pg_temp.fx('ceo_step'))),'Fixture a');
delete from public.approval_steps where id=pg_temp.fx('ceo_step');
select pg_temp.expect('historical exact step survives configuration deletion',pg_temp.as_scalar('admin',format(
  'select count(*) from jsonb_array_elements(public.app_request_approval_progress(%L)) p where p->>''step_id''=%L and p->>''evidence_kind''=''delegated''',
  pg_temp.fx('incoming'),pg_temp.fx('ceo_step'))),'1');
select pg_temp.expect('signature RPC retains actual PNG separately from progress',pg_temp.as_scalar('admin',format(
  'select p->>''signature_data'' from jsonb_array_elements(public.get_leave_request_signatures(%L)->''approvals'') p where p->>''step_id''=%L',
  pg_temp.fx('incoming'),pg_temp.fx('ceo_step'))),pg_temp.sig());
select pg_temp.expect('queue never includes requester PNG',pg_temp.as_scalar('admin',
  'select count(*) from jsonb_array_elements(public.app_approval_queue()) row where row ? ''signature_data'' or row ? ''approver_signature_data'''),'0');
-- No applicable leave chain: existing approval-only manager delegation is discoverable and usable.
-- The named errand step stays active, preserving A's natural approver eligibility.
select pg_temp.login('admin');
update public.approval_steps set active=false where company_id=pg_temp.fx('company') and 'leave'=any(applies_to);
update public.approval_steps set active=true,applies_to='{errand}' where id=pg_temp.fx('named_step');
insert into delegation_fx values('no_chain',pg_temp.submit('employee','2026-11-27'));
select pg_temp.expect('no-chain delegate can read scoped request context',pg_temp.as_scalar('a',format(
  'select public.app_request_approval_context(%L)->>''employee_name''',pg_temp.fx('no_chain'))),'Fixture employee');
select pg_temp.expect('no-chain delegated request appears in queue',pg_temp.as_scalar('a',format(
  'select count(*) from jsonb_array_elements(public.app_approval_queue()) item where item->>''id''=%L',pg_temp.fx('no_chain'))),'1');
select pg_temp.expect('no-chain progress exposes delegated fallback action',pg_temp.as_scalar('a',format(
  'select public.app_request_approval_progress(%L)->0->>''can_approve''',pg_temp.fx('no_chain'))),'true');
select pg_temp.expect('no-chain delegate signs through existing fallback',pg_temp.as_call('a',format(
  'select public.approve_leave_request_v2(%L,null,%L,true)',pg_temp.fx('no_chain'),pg_temp.sig())),'ok');
select pg_temp.expect('no-chain fallback finalizes request',
  (select status::text from public.leave_requests where id=pg_temp.fx('no_chain')),'approved');

-- A chain composed entirely of the HR head's mapped exemption completes at submission.
-- It records the exemption and shared accounting without manufacturing a human approval.
select pg_temp.login('admin');
update public.approval_steps set active=true,approver_id=null where id=pg_temp.fx('hr_step');
insert into delegation_fx values('all_hr_exempt',pg_temp.submit('hr','2026-11-28'));
select pg_temp.expect('all-HR-exempt configured chain is not stuck',
  (select status::text from public.leave_requests where id=pg_temp.fx('all_hr_exempt')),'approved');
select pg_temp.expect('all-HR-exempt chain has no fabricated human decision',
  (select count(*)::text from public.leave_request_approvals where request_id=pg_temp.fx('all_hr_exempt')),'0');
select pg_temp.expect('all-HR-exempt evidence remains explicit',pg_temp.as_scalar('hr',format(
  'select public.app_request_approval_progress(%L)->0->>''evidence_kind''',pg_temp.fx('all_hr_exempt'))),'hr_exempt');

select pg_temp.login('admin');
update public.approval_steps set approver_id=pg_temp.fx('b') where id=pg_temp.fx('hr_step');
select pg_temp.expect('completed HR exemption survives same-ID step edit',pg_temp.as_scalar('hr',format(
  'select public.app_request_approval_progress(%L)->0->>''evidence_kind''',pg_temp.fx('all_hr_exempt'))),'hr_exempt');
select pg_temp.expect('completed exemption keeps original step meaning',pg_temp.as_scalar('hr',format(
  'select public.app_request_approval_progress(%L)->0->>''step_role''',pg_temp.fx('all_hr_exempt'))),'hr');
select pg_temp.expect('pending changed exemption exposes immutable historical evidence',pg_temp.as_scalar('hr',format(
  'select count(*) from jsonb_array_elements(public.app_request_approval_progress(%L)) item where item->>''step_id''=%L and item->''historical_hr_exemption'' is not null and item->''historical_hr_exemption''<>''null''::jsonb',
  pg_temp.fx('hr_named_distinction'),pg_temp.fx('hr_step'))),'1');

select pg_temp.assert('all new tables have RLS',not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in('approval_executive_settings','approval_delegations','approval_request_policy') and not c.relrowsecurity));
select pg_temp.assert('reusable authority helpers have no authenticated execute',not exists(select 1 from pg_proc p
  where p.pronamespace='private'::regnamespace and p.proname in('decide_approval_request','effective_approval_delegate','enroll_request_delegation','step_delegation')
    and has_function_privilege('authenticated',p.oid,'EXECUTE')));
select pg_temp.assert('no timer or worker objects remain',to_regclass('public.approval_auto_requests') is null
  and to_regclass('public.approval_worker_runs') is null
  and not exists(select 1 from pg_proc where proname in('process_approval_auto_requests','app_approval_worker_health','app_set_auto_approval_window')));
rollback;
