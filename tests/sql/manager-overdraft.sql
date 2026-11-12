-- Manager overdraft + pending-aware strict balance (FR-92, 2026-11-12).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table mo_fx(k text primary key,id uuid not null);
grant select on mo_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from mo_fx where k=p_key;
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
create function pg_temp.d(p_off int) returns date language sql as $$
  select date '2027-04-01'+p_off;
$$;
-- One day is 480 minutes in the fixture company (07:00-15:00, no weekend, no holidays).
-- Submit n days starting p_off days after 2027-04-01 as p_emp; returns the request id or 'ERROR …'.
create function pg_temp.sub(p_emp text,p_type text,p_off int,p_days int) returns text language sql as $$
  select pg_temp.as_scalar(p_emp,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)',
    pg_temp.fx(p_type),pg_temp.d(p_off),pg_temp.d(p_off+p_days-1),pg_temp.sig()));
$$;
create function pg_temp.mk(p_key text,p_emp text,p_type text,p_off int,p_days int) returns void language plpgsql as $$
declare v text:=pg_temp.sub(p_emp,p_type,p_off,p_days);
begin
  if left(v,6)='ERROR ' then raise exception 'fixture: % failed: %',p_key,v; end if;
  insert into mo_fx values(p_key,v::uuid);
end; $$;
create function pg_temp.approve(p_key text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar('admin',format(
    'select public.approve_leave_request_v2(%L,null,%L,true,true,null)::text',pg_temp.fx(p_key),pg_temp.sig())));
$$;
create function pg_temp.setbal(p_emp text,p_type text,p_minutes int) returns void language plpgsql as $$
declare v_cur int:=public.current_leave_balance(pg_temp.fx(p_emp),pg_temp.fx(p_type));
begin
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(pg_temp.fx(p_emp),pg_temp.fx(p_type),'adjustment',p_minutes-v_cur,p_minutes,'fixture balance');
end; $$;
create function pg_temp.bal(p_emp text,p_type text) returns text language sql as $$
  select public.current_leave_balance(pg_temp.fx(p_emp),pg_temp.fx(p_type))::text;
$$;
create function pg_temp.unpaid(p_key text) returns text language sql as $$
  select unpaid_minutes::text from public.leave_requests where id=pg_temp.fx(p_key);
$$;
create function pg_temp.ledger(p_key text) returns text language sql as $$
  select coalesce(string_agg(entry_type||':'||delta_minutes,',' order by seq),'none')
    from public.leave_ledger where request_id=pg_temp.fx(p_key);
$$;
create function pg_temp.rule(p_emp text,p_type text) returns text language sql as $$
  select private.balance_rule(pg_temp.fx(p_emp),pg_temp.fx(p_type));
$$;
create function pg_temp.edit(p_actor text,p_req text,p_off int,p_days int) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.app_edit_request(%L,''day'',%L,%L,''full'',null,null,null,''r'',%L,true)::text',
    pg_temp.fx(p_req),pg_temp.d(p_off),pg_temp.d(p_off+p_days-1),pg_temp.sig()));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Manager overdraft synthetic fixture');
  insert into mo_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','MO');
  for who in select * from (values
    ('admin','admin','9990092001'),('hr','hr','9990092002'),('mgr','manager','9990092003'),
    ('mgr2','manager','9990092004'),('mgr3','manager','9990092005'),
    ('emp','employee','9990092006'),('emp2','employee','9990092007'),('emp3','employee','9990092008'),
    ('emp4','employee','9990092009'),('emp5','employee','9990092010'),('ed','employee','9990092011')) t(k,role,code) loop
    insert into mo_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@overdraft-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  -- A request editor: the daily-leave key only.
  insert into public.roles(company_id,kind,name) values(v_company,'custom','MoEditor') returning id into v_role;
  insert into public.role_permissions values(v_role,'edit_leave_daily','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ed'),v_role);
  perform pg_temp.login('admin');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  -- Annual (overdraft allowed), sick (balance but no overdraft), unpaid (no balance).
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'سالانه','Fixture annual',true,true,true) returning id into v_id;
  insert into mo_fx values('annual',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'استعلاجی','Fixture sick',true,true,false) returning id into v_id;
  insert into mo_fx values('sick',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'بدون حقوق','Fixture unpaid',false,false,false) returning id into v_id;
  insert into mo_fx values('unpaid',v_id);
end; $$;

-- ============================================================ the migration's own data
select pg_temp.assert('manager_overdraft defaults to false',
  (select column_default='false' and is_nullable='NO' from information_schema.columns
    where table_schema='public' and table_name='leave_types' and column_name='manager_overdraft'));
select pg_temp.assert('only Annual Leave rows with a balance are switched on by the migration',
  not exists (select 1 from public.leave_types where manager_overdraft and name_en<>'Annual Leave'
              and company_id<>pg_temp.fx('company'))
  and not exists (select 1 from public.leave_types where manager_overdraft and not affects_balance));

-- ============================================================ rule
select pg_temp.expect('rule mgr annual',pg_temp.rule('mgr','annual'),'overdraft');
select pg_temp.expect('rule emp annual',pg_temp.rule('emp','annual'),'strict');
select pg_temp.expect('rule emp sick',pg_temp.rule('emp','sick'),'split');
select pg_temp.expect('rule mgr sick',pg_temp.rule('mgr','sick'),'split');
select pg_temp.expect('rule emp unpaid',pg_temp.rule('emp','unpaid'),'none');
select pg_temp.expect('rule with no type',private.balance_rule(pg_temp.fx('mgr'),null),'none');
select pg_temp.expect('admin is not special-cased',pg_temp.rule('admin','annual'),'strict');

-- ============================================================ strict: pending counts
select pg_temp.setbal('emp','annual',5*480);
select pg_temp.mk('p1','emp','annual',0,3);
select pg_temp.expect('pending counts: first 3 of 5 days ok',pg_temp.unpaid('p1'),'0');
select pg_temp.expect('pending counts: another 3 days refused',
  pg_temp.as_scalar('emp',format('select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)',
    pg_temp.fx('annual'),pg_temp.d(10),pg_temp.d(12),pg_temp.sig())),
  'ERROR 22023 request exceeds available balance');
select pg_temp.expect('pending counts: 2 days ok',pg_temp.err(pg_temp.sub('emp','annual',20,2)),'ok');
select pg_temp.expect('pending counts: one more minute-day refused',pg_temp.err(pg_temp.sub('emp','annual',30,1)),'22023');
select pg_temp.expect('pending_leave_minutes sums pending only',
  private.pending_leave_minutes(pg_temp.fx('emp'),pg_temp.fx('annual'))::text,'2400');
select pg_temp.expect('pending_leave_minutes can exclude a request',
  private.pending_leave_minutes(pg_temp.fx('emp'),pg_temp.fx('annual'),pg_temp.fx('p1'))::text,'960');
select pg_temp.expect('cancelling a pending request frees the pending sum',
  pg_temp.as_scalar('emp',format('select public.cancel_leave_request(%L)::text',pg_temp.fx('p1'))),'');
select pg_temp.expect('pending counts: after cancelling, 3 days fit again',pg_temp.err(pg_temp.sub('emp','annual',40,3)),'ok');

-- ============================================================ strict: exact and negative opening
select pg_temp.setbal('emp2','annual',2*480);
select pg_temp.mk('x1','emp2','annual',0,2);
select pg_temp.expect('strict exact: equal to available has no unpaid part',pg_temp.unpaid('x1'),'0');
select pg_temp.setbal('emp3','annual',-480);
select pg_temp.expect('negative opening: 1 annual day refused',pg_temp.err(pg_temp.sub('emp3','annual',0,1)),'22023');
select pg_temp.mk('u1','emp3','unpaid',0,1);
select pg_temp.expect('negative opening: unpaid type still submits, all unpaid',pg_temp.unpaid('u1'),'480');

-- ============================================================ manager overdraft
select pg_temp.setbal('mgr','annual',2*480);
select pg_temp.mk('m1','mgr','annual',0,5);
select pg_temp.expect('mgr over: submits 5 days on 2, unpaid 0',pg_temp.unpaid('m1'),'0');
select pg_temp.expect('mgr over: approval ok',pg_temp.approve('m1'),'ok');
select pg_temp.expect('mgr over: consumption of the full 5 days',pg_temp.ledger('m1'),'consumption:-2400');
select pg_temp.expect('mgr over: balance is -3 days',pg_temp.bal('mgr','annual'),(-3*480)::text);
select pg_temp.expect('mgr over: request unpaid stays 0',pg_temp.unpaid('m1'),'0');
select pg_temp.expect('mgr over: ledger note names the overdraft',
  (select note from public.leave_ledger where request_id=pg_temp.fx('m1')),'consumed on approval (manager overdraft)');
select pg_temp.expect('mgr may keep going while negative',pg_temp.err(pg_temp.sub('mgr','annual',20,1)),'ok');

-- cancel overdraft
select pg_temp.expect('cancel overdraft: the approved future request cancels',
  pg_temp.as_scalar('mgr',format('select public.cancel_leave_request(%L)::text',pg_temp.fx('m1'))),'');
select pg_temp.expect('cancel overdraft: a +5 day reversal',pg_temp.ledger('m1'),'consumption:-2400,reversal:2400');
select pg_temp.expect('cancel overdraft: balance back to 2 days',pg_temp.bal('mgr','annual'),(2*480)::text);

-- ============================================================ role changes between submit and approve
select pg_temp.setbal('mgr2','annual',480);
select pg_temp.mk('rl','mgr2','annual',0,3);
select pg_temp.expect('role lost: submitted as manager, unpaid 0',pg_temp.unpaid('rl'),'0');
delete from public.user_roles where user_id=pg_temp.fx('mgr2') and role='manager';
select pg_temp.expect('role lost: approval ok',pg_temp.approve('rl'),'ok');
select pg_temp.expect('role lost: unpaid is 2 days',pg_temp.unpaid('rl'),(2*480)::text);
select pg_temp.expect('role lost: consumption is 1 day',pg_temp.ledger('rl'),'consumption:-480');
select pg_temp.expect('role lost: balance 0',pg_temp.bal('mgr2','annual'),'0');

select pg_temp.setbal('emp4','annual',3*480);
select pg_temp.mk('rg','emp4','annual',0,3);
select pg_temp.setbal('emp4','annual',480);
insert into public.user_roles(user_id,role) values(pg_temp.fx('emp4'),'manager');
select pg_temp.expect('role gained: approval ok',pg_temp.approve('rg'),'ok');
select pg_temp.expect('role gained: consumption is the full 3 days',pg_temp.ledger('rg'),'consumption:-1440');
select pg_temp.expect('role gained: balance -2 days',pg_temp.bal('emp4','annual'),(-2*480)::text);
select pg_temp.expect('role gained: unpaid 0',pg_temp.unpaid('rg'),'0');

-- employee split at approval (spec 9)
select pg_temp.setbal('emp5','annual',3*480);
select pg_temp.mk('es','emp5','annual',0,3);
select pg_temp.setbal('emp5','annual',480);
select pg_temp.expect('employee split: approval ok',pg_temp.approve('es'),'ok');
select pg_temp.expect('employee split: unpaid 2 days',pg_temp.unpaid('es'),(2*480)::text);
select pg_temp.expect('employee split: balance 0',pg_temp.bal('emp5','annual'),'0');
select pg_temp.expect('employee split: consumption is the paid day',pg_temp.ledger('es'),'consumption:-480');

-- sick unchanged: even a manager gets the split
select pg_temp.setbal('mgr3','sick',480);
select pg_temp.mk('sk','mgr3','sick',0,3);
select pg_temp.expect('sick unchanged: submit unpaid part is 2 days',pg_temp.unpaid('sk'),(2*480)::text);
select pg_temp.expect('sick unchanged: approval ok',pg_temp.approve('sk'),'ok');
select pg_temp.expect('sick unchanged: unpaid 2 days',pg_temp.unpaid('sk'),(2*480)::text);
select pg_temp.expect('sick unchanged: balance 0',pg_temp.bal('mgr3','sick'),'0');

-- ============================================================ edits of approved requests
-- mgr is a Manager with 2 days; file and approve a 1-day request, then lengthen it.
select pg_temp.mk('ed1','mgr','annual',50,1);
select pg_temp.expect('edit mgr: approved',pg_temp.approve('ed1'),'ok');
select pg_temp.expect('edit mgr: balance after 1 day',pg_temp.bal('mgr','annual'),(480)::text);
select pg_temp.expect('edit mgr negative: longer than the balance is allowed',
  pg_temp.err(pg_temp.edit('ed','ed1',50,4)),'ok');
select pg_temp.expect('edit mgr negative: balance more negative',pg_temp.bal('mgr','annual'),(-2*480)::text);
select pg_temp.expect('edit mgr negative: unpaid stays 0',pg_temp.unpaid('ed1'),'0');
select pg_temp.expect('edit mgr negative: ledger carries the extra 3 days',pg_temp.ledger('ed1'),'consumption:-480,consumption:-1440');

-- an employee: 2 days balance, 1-day approved request, edit to 4 days is refused.
select pg_temp.setbal('emp2','annual',3*480);
select pg_temp.mk('ed2','emp2','annual',60,1);
select pg_temp.expect('edit emp: approved',pg_temp.approve('ed2'),'ok');
select pg_temp.expect('edit emp unpaid refused',
  pg_temp.as_scalar('ed',format('select public.app_edit_request(%L,''day'',%L,%L,''full'',null,null,null,''r'',%L,true)::text',
    pg_temp.fx('ed2'),pg_temp.d(60),pg_temp.d(63),pg_temp.sig())),
  'ERROR 22023 an edit cannot make leave unpaid');

-- ============================================================ availability RPC
select pg_temp.setbal('emp','annual',4*480);
select pg_temp.expect('availability rpc: emp strict',
  pg_temp.as_scalar('emp',format('select public.app_my_leave_availability(%L)::text',pg_temp.fx('annual')))::jsonb::text,
  jsonb_build_object('rule','strict','balance_minutes',4*480,
    'pending_minutes',private.pending_leave_minutes(pg_temp.fx('emp'),pg_temp.fx('annual')))::text);
select pg_temp.expect('availability rpc: mgr overdraft',
  pg_temp.as_scalar('mgr',format('select public.app_my_leave_availability(%L)::jsonb->>''rule''',pg_temp.fx('annual'))),'overdraft');
select pg_temp.expect('availability rpc: balance_minutes null with no ledger row',
  pg_temp.as_scalar('hr',format('select (public.app_my_leave_availability(%L)->''balance_minutes'')::text',pg_temp.fx('annual'))),'null');
select pg_temp.expect('availability rpc: no-balance type is rule none',
  pg_temp.as_scalar('emp',format('select public.app_my_leave_availability(%L)->>''rule''',pg_temp.fx('unpaid'))),'none');
do $$ begin
  perform set_config('request.jwt.claims','',true);
  begin perform public.app_my_leave_availability(pg_temp.fx('annual'));
    raise exception 'FAIL availability rpc accepted a caller with no login';
  exception when insufficient_privilege then raise notice 'PASS availability rpc refuses a caller with no login'; end;
end $$;
select pg_temp.assert('anon cannot run it',
  not has_function_privilege('anon','public.app_my_leave_availability(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.app_my_leave_availability(uuid)','EXECUTE'));

-- ============================================================ approval context keys
select pg_temp.setbal('emp','annual',20*480);
select pg_temp.mk('cx1','emp','annual',70,1);
select pg_temp.mk('cx2','emp','annual',72,1);
select pg_temp.expect('context keys: balance_minutes',
  pg_temp.as_scalar('admin',format('select public.app_request_approval_context(%L)->>''balance_minutes''',pg_temp.fx('cx1'))),
  pg_temp.bal('emp','annual'));
select pg_temp.expect('context keys: pending_other_minutes excludes the request itself',
  pg_temp.as_scalar('admin',format('select public.app_request_approval_context(%L)->>''pending_other_minutes''',pg_temp.fx('cx1'))),
  (private.pending_leave_minutes(pg_temp.fx('emp'),pg_temp.fx('annual'))-480)::text);
select pg_temp.expect('context keys: balance_rule',
  pg_temp.as_scalar('admin',format('select public.app_request_approval_context(%L)->>''balance_rule''',pg_temp.fx('cx1'))),'strict');
select pg_temp.expect('context keys: unpaid type has a null balance and rule none',
  pg_temp.as_scalar('admin',format('select (public.app_request_approval_context(%L)->''balance_minutes'')::text||''/''||(public.app_request_approval_context(%L)->>''balance_rule'')',
    pg_temp.fx('u1'),pg_temp.fx('u1'))),'null/none');
-- print path (p_print = true) must not carry balance data (finance-only readers reach it)
select pg_temp.login('admin');
select pg_temp.expect('print context: balance keys are null',
  (select (c->'balance_minutes')::text||'/'||(c->'pending_other_minutes')::text||'/'||(c->'balance_rule')::text
     from (select private.request_data_app_request_approval_context(pg_temp.fx('cx1'),true) c) x),'null/null/null');
select pg_temp.expect('non-print context still returns the balance keys',
  (select (c->>'balance_rule') from (select private.request_data_app_request_approval_context(pg_temp.fx('cx1'),false) c) x),'strict');
-- balance figures are for pending requests, the requester, admin and balance readers only (FR-92 security)
select pg_temp.mk('cx3','emp','annual',74,1);
select pg_temp.expect('approved request: approve for the visibility checks',pg_temp.approve('cx3'),'ok');
insert into public.leave_request_approvals(request_id,step_role,approver_id,decision)
  values(pg_temp.fx('cx3'),'finance',pg_temp.fx('mgr3'),'approved');
select pg_temp.expect('past approver, request decided: balance keys are null',
  pg_temp.as_scalar('mgr3',format('select (c->''balance_minutes'')::text||''/''||(c->''pending_other_minutes'')::text||''/''||(c->''balance_rule'')::text from (select public.app_request_approval_context(%L) c) x',pg_temp.fx('cx3'))),'null/null/null');
select pg_temp.expect('requester, request decided: still gets the balance keys',
  pg_temp.as_scalar('emp',format('select (c->>''balance_rule'') from (select public.app_request_approval_context(%L) c) x',pg_temp.fx('cx3'))),'strict');
select pg_temp.assert('requester, request decided: balance_minutes present',
  pg_temp.as_scalar('emp',format('select (public.app_request_approval_context(%L)->''balance_minutes'')::text',pg_temp.fx('cx3')))<>'null');
insert into public.leave_request_approvals(request_id,step_role,approver_id,decision)
  values(pg_temp.fx('cx2'),'finance',pg_temp.fx('mgr3'),'approved'); -- a partial decision; the request stays pending
select pg_temp.expect('pending request: a non-admin approver still gets the balance keys',
  pg_temp.as_scalar('mgr3',format('select (c->>''balance_rule'') from (select public.app_request_approval_context(%L) c) x',pg_temp.fx('cx2'))),'strict');
rollback;
