-- Unpaid conversions, Employees totals, negatives list, pending counts, payroll rows (FR-92, 2026-11-12).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table uc_fx(k text primary key,id uuid not null);
grant select on uc_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from uc_fx where k=p_key;
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
  insert into uc_fx values(p_key,v::uuid);
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
declare v_company uuid:=gen_random_uuid(); v_c2 uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'uc_fx synthetic fixture'),(v_c2,'uc_fx other company');
  insert into uc_fx values('company',v_company),('company2',v_c2);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','UC');
  insert into uc_fx values('dept',v_dept);
  for who in select * from (values
    ('admin','admin','9990093001',1),('hr','hr','9990093002',1),('clerk','employee','9990093003',1),
    ('emp1','employee','9990093004',1),('emp2','employee','9990093005',1),('emp3','employee','9990093006',1),
    ('other','employee','9990093007',2)) t(k,role,code,co) loop
    insert into uc_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@uc-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),case when who.co=1 then v_company else v_c2 end,
             case when who.co=1 then v_dept end,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  -- A people-read-only clerk.
  insert into public.roles(company_id,kind,name) values(v_company,'custom','UcClerk') returning id into v_role;
  insert into public.role_permissions values(v_role,'people','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('clerk'),v_role);
  perform pg_temp.login('admin');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'سالانه','Fixture annual',true,true,true) returning id into v_id;
  insert into uc_fx values('annual',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'استعلاجی','Fixture sick',true,true,false) returning id into v_id;
  insert into uc_fx values('sick',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'بدون حقوق','Fixture unpaid',false,false,false) returning id into v_id;
  insert into uc_fx values('unpaid',v_id);
  -- Other company: an annual type and a negative balance that hr must never touch.
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_c2,'سالانه','Other annual',true,true,true) returning id into v_id;
  insert into uc_fx values('annual2',v_id);
end; $$;

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Tehran')::date; $$;
create function pg_temp.ys() returns date language sql as $$ select private.jalali_year_start(pg_temp.today()); $$;
create function pg_temp.bal(p_emp text) returns text language sql as $$
  select public.current_leave_balance(pg_temp.fx(p_emp),pg_temp.fx('annual'))::text;
$$;
-- Direct approved-request history row; serial 2027 + n.
create function pg_temp.hist(p_emp text,p_type text,p_start date,p_days int,p_unpaid int,p_n int,p_status text default 'approved') returns void language plpgsql as $$
begin
  insert into public.leave_requests(employee_id,leave_type_id,start_date,end_date,status,requested_minutes,unpaid_minutes,
                                    company_id,serial_year,serial_seq,kind)
    values(pg_temp.fx(p_emp),pg_temp.fx(p_type),p_start,p_start+p_days-1,p_status::public.leave_status,p_days*480,p_unpaid,
           pg_temp.fx('company'),9000+p_n,p_n,'leave');
end; $$;
create function pg_temp.cnt(p_sql text) returns text language plpgsql as $$
declare v text; begin execute p_sql into v; return v; end; $$;
create function pg_temp.rows(p_key text,p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  begin execute 'select coalesce(string_agg(t::text, '';'' order by t::text), ''none'') from ('||p_sql||') t' into v;
  exception when others then v:='ERROR '||sqlstate||' '||sqlerrm; end;
  execute 'reset role'; return v;
end; $$;

-- ============================================================ bulk converts
select pg_temp.setbal('emp1','annual',-2*480);
select pg_temp.setbal('emp2','annual',-480);
select pg_temp.setbal('emp3','annual',480);
select pg_temp.expect('bulk converts: two people converted',
  pg_temp.as_scalar('hr',format('select public.app_convert_negatives(array[%L,%L,%L]::uuid[])::text',
    pg_temp.fx('emp3'),pg_temp.fx('emp1'),pg_temp.fx('emp2'))),'2');
select pg_temp.expect('bulk converts: balances 0,0,480',
  pg_temp.bal('emp1')||','||pg_temp.bal('emp2')||','||pg_temp.bal('emp3'),'0,0,480');
select pg_temp.expect('bulk converts: two conversion rows',
  (select count(*)::text from public.leave_unpaid_conversions where company_id=pg_temp.fx('company')),'2');
select pg_temp.expect('bulk converts: conversion minutes 960 and 480',
  (select string_agg(minutes::text,',' order by minutes desc) from public.leave_unpaid_conversions),'960,480');
select pg_temp.expect('bulk converts: two adjustment ledger rows with the default note',
  (select count(*)::text from public.leave_ledger where note='converted to unpaid' and entry_type='adjustment' and delta_minutes>0
     and created_by=pg_temp.fx('hr')),'2');
select pg_temp.expect('bulk converts: ledger row linked from the conversion',
  (select count(*)::text from public.leave_unpaid_conversions c join public.leave_ledger l on l.id=c.ledger_id
    where l.delta_minutes=c.minutes and l.employee_id=c.employee_id),'2');
select pg_temp.expect('bulk converts: two audit rows',
  (select count(*)::text from public.audit_log where action='leave_balance.convert_unpaid' and actor_id=pg_temp.fx('hr')),'2');

-- ============================================================ bulk skips non-negative
select pg_temp.expect('bulk skips non-negative: second call converts nobody',
  pg_temp.as_scalar('hr',format('select public.app_convert_negatives(array[%L,%L,%L]::uuid[])::text',
    pg_temp.fx('emp1'),pg_temp.fx('emp2'),pg_temp.fx('emp3'))),'0');
select pg_temp.expect('bulk skips non-negative: no new rows',
  (select count(*)::text from public.leave_unpaid_conversions),'2');

-- ============================================================ partial
select pg_temp.setbal('emp1','annual',-3*480);
select pg_temp.expect('partial: 1 day of 3 returns 480',
  pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,480,''x'')::text',pg_temp.fx('emp1'))),'480');
select pg_temp.expect('partial: balance -2 days',pg_temp.bal('emp1'),(-960)::text);
select pg_temp.expect('partial: note kept',
  (select note from public.leave_unpaid_conversions where employee_id=pg_temp.fx('emp1') and minutes=480),'x');
select pg_temp.expect('partial: 5 days exceeds',
  pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,2400,null)::text',pg_temp.fx('emp1'))),
  'ERROR 22023 amount exceeds the negative balance');
select pg_temp.expect('partial: zero refused',
  pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,0,null)::text',pg_temp.fx('emp1'))),
  'ERROR 22023 amount must be more than 0');
select pg_temp.expect('partial: non-negative person',
  pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,null,null)::text',pg_temp.fx('emp3'))),
  'ERROR 22023 balance is not negative');
select pg_temp.expect('partial: null amount converts the rest',
  pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,null,null)::text',pg_temp.fx('emp1'))),'960');
select pg_temp.expect('partial: balance 0',pg_temp.bal('emp1'),'0');

-- ============================================================ gates
select pg_temp.setbal('emp2','annual',-480);
select pg_temp.setbal('other','annual2',-480);
select pg_temp.expect('gates: clerk cannot bulk convert',
  pg_temp.err(pg_temp.as_scalar('clerk',format('select public.app_convert_negatives(array[%L]::uuid[])::text',pg_temp.fx('emp2')))),'42501');
select pg_temp.expect('gates: clerk cannot convert one',
  pg_temp.err(pg_temp.as_scalar('clerk',format('select public.app_convert_negative(%L,null,null)::text',pg_temp.fx('emp2')))),'42501');
select pg_temp.expect('gates: employee cannot bulk convert',
  pg_temp.err(pg_temp.as_scalar('emp2',format('select public.app_convert_negatives(array[%L]::uuid[])::text',pg_temp.fx('emp2')))),'42501');
select pg_temp.setbal('hr','annual',-480);
select pg_temp.expect('gates: hr bulk skips self',
  pg_temp.as_scalar('hr',format('select public.app_convert_negatives(array[%L]::uuid[])::text',pg_temp.fx('hr'))),'0');
select pg_temp.expect('gates: hr single refuses self',
  pg_temp.err(pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,null,null)::text',pg_temp.fx('hr')))),'42501');
select pg_temp.expect('gates: hr balance untouched',pg_temp.bal('hr'),'-480');
select pg_temp.expect('gates: other company refused',
  pg_temp.err(pg_temp.as_scalar('hr',format('select public.app_convert_negatives(array[%L]::uuid[])::text',pg_temp.fx('other')))),'42501');
select pg_temp.expect('gates: other company balance untouched',
  public.current_leave_balance(pg_temp.fx('other'),pg_temp.fx('annual2'))::text,'-480');
select pg_temp.expect('gates: admin may convert',
  pg_temp.as_scalar('admin',format('select public.app_convert_negatives(array[%L,%L]::uuid[])::text',pg_temp.fx('emp2'),pg_temp.fx('emp3'))),'1');

-- ============================================================ negatives list
select pg_temp.setbal('emp1','annual',-960);
select pg_temp.setbal('emp2','annual',-480);
select pg_temp.expect('negatives list: hr sees exactly the negative people of the company',
  pg_temp.as_scalar('hr','select string_agg(full_name||'':''||balance_minutes,'','' order by full_name) from public.app_negative_balances()'),
  'Fixture emp1:-960,Fixture emp2:-480,Fixture hr:-480');
select pg_temp.expect('negatives list: department names come through',
  pg_temp.as_scalar('hr','select min(department_name_en) from public.app_negative_balances()'),'Fixture HQ');
select pg_temp.expect('negatives list: clerk refused',
  pg_temp.err(pg_temp.as_scalar('clerk','select count(*)::text from public.app_negative_balances()')),'42501');

-- ============================================================ totals
select pg_temp.setbal('emp1','annual',10*480);
-- last Jalali year (excluded), this year past (counts), future approved (excluded), pending (excluded)
select pg_temp.hist('emp1','annual',pg_temp.ys()-10,2,0,1);
select pg_temp.hist('emp1','annual',pg_temp.ys(),2,0,2);
select pg_temp.hist('emp1','annual',pg_temp.today()+10,3,0,3);
select pg_temp.hist('emp1','annual',pg_temp.today(),1,0,4,'pending');
-- unpaid type this year (1 day), unpaid part of a sick request (half day), one split annual request (3 days, 1 unpaid)
select pg_temp.hist('emp1','unpaid',pg_temp.ys()+1,1,480,5);
select pg_temp.hist('emp1','sick',pg_temp.ys()+2,1,240,6);
select pg_temp.hist('emp1','annual',pg_temp.ys()+3,3,480,7);
select pg_temp.setbal('emp1','annual',-480);
select pg_temp.expect('totals: setup conversion today',
  pg_temp.as_scalar('hr',format('select public.app_convert_negative(%L,240,null)::text',pg_temp.fx('emp1'))),'240');
-- balance now -240; used = (2*480 - 0) + (3*480 - 480) = 1920;
-- unpaid = 480 + 240 + 480 (requests) + 960+480+960+240 (four conversions today) = 3840
select pg_temp.expect('totals: clerk (people read) sees balance, used, unpaid',
  pg_temp.rows('clerk',format('select balance_minutes,used_minutes,unpaid_minutes from public.app_employee_leave_totals(array[%L]::uuid[])',pg_temp.fx('emp1'))),
  '(-240,1920,3840)');
select pg_temp.expect('totals: other company id is ignored',
  pg_temp.rows('clerk',format('select employee_id from public.app_employee_leave_totals(array[%L]::uuid[])',pg_temp.fx('other'))),'none');
select pg_temp.expect('totals: person without a ledger row has a null balance',
  pg_temp.as_scalar('clerk',format('select balance_minutes is null and used_minutes=0 and unpaid_minutes=0 from public.app_employee_leave_totals(array[%L]::uuid[])',pg_temp.fx('clerk'))),'true');
select pg_temp.expect('totals: plain employee refused',
  pg_temp.err(pg_temp.as_scalar('emp3',format('select count(*)::text from public.app_employee_leave_totals(array[%L]::uuid[])',pg_temp.fx('emp1')))),'42501');

-- ============================================================ pending counts
select pg_temp.hist('emp2','annual',pg_temp.today()+20,1,0,11,'pending');
select pg_temp.hist('emp2','annual',pg_temp.today()+22,2,0,12,'pending');
select pg_temp.expect('pending counts: two pending annual requests',
  pg_temp.rows('hr',format('select pending_count,pending_minutes from public.app_pending_leave_counts(%L)',pg_temp.fx('emp2'))),'(2,1440)');
select pg_temp.expect('pending counts: none for someone else',
  pg_temp.rows('hr',format('select * from public.app_pending_leave_counts(%L)',pg_temp.fx('emp3'))),'none');
select pg_temp.expect('pending counts: clerk refused',
  pg_temp.err(pg_temp.as_scalar('clerk',format('select count(*)::text from public.app_pending_leave_counts(%L)',pg_temp.fx('emp2')))),'42501');

-- ============================================================ payroll rows
select pg_temp.expect('payroll rows: hr sees the three sources for emp1',
  pg_temp.rows('hr',format('select source,ref,unpaid_minutes from public.app_payroll_unpaid(%L,%L) where employee_id=%L and source<>''conversion''',
    pg_temp.ys(),pg_temp.today(),pg_temp.fx('emp1'))),
  '(unpaid_part,9006-0006,240);(unpaid_part,9007-0007,480);(unpaid_type,9005-0005,480)');
select pg_temp.expect('payroll rows: four conversions with no ref, dated today, annual type name',
  pg_temp.rows('hr',format('select count(*),sum(unpaid_minutes),min(on_date)=max(on_date) and min(on_date)=%L,min(leave_type_name_en),count(ref) from public.app_payroll_unpaid(%L,%L) where employee_id=%L and source=''conversion''',
    pg_temp.today(),pg_temp.ys(),pg_temp.today(),pg_temp.fx('emp1'))),
  '(4,2640,t,"Fixture annual",0)');
select pg_temp.expect('payroll rows: only the caller''s company',
  pg_temp.as_scalar('hr',format('select count(*)::text from public.app_payroll_unpaid(%L,%L) where employee_id=%L',pg_temp.ys(),pg_temp.today(),pg_temp.fx('other'))),'0');
select pg_temp.expect('payroll rows: date filter excludes everything before',
  pg_temp.as_scalar('hr',format('select count(*)::text from public.app_payroll_unpaid(%L,%L) where employee_id=%L',pg_temp.ys()-30,pg_temp.ys()-1,pg_temp.fx('emp1'))),'0');
select pg_temp.expect('payroll rows: clerk refused',
  pg_temp.err(pg_temp.as_scalar('clerk',format('select count(*)::text from public.app_payroll_unpaid(%L,%L)',pg_temp.ys(),pg_temp.today()))),'42501');

-- ============================================================ rls
select pg_temp.expect('rls: employee sees only own conversion rows',
  pg_temp.as_scalar('emp2','select count(*)::text from public.leave_unpaid_conversions where employee_id<>auth.uid()'),'0');
select pg_temp.expect('rls: employee sees own rows',
  pg_temp.as_scalar('emp2','select (count(*)>0)::text from public.leave_unpaid_conversions'),'true');
select pg_temp.expect('rls: clerk sees none',
  pg_temp.as_scalar('clerk','select count(*)::text from public.leave_unpaid_conversions'),'0');
select pg_temp.expect('rls: hr sees the company rows',
  pg_temp.as_scalar('hr','select (count(*)>=4)::text from public.leave_unpaid_conversions'),'true');
select pg_temp.expect('rls: nobody can write directly',
  pg_temp.err(pg_temp.as_scalar('hr',format('insert into public.leave_unpaid_conversions(company_id,employee_id,leave_type_id,minutes,ledger_id) select company_id,employee_id,leave_type_id,1,ledger_id from public.leave_unpaid_conversions limit 1 returning id::text'))),'42501');
select pg_temp.assert('anon cannot run the RPCs',
  not has_function_privilege('anon','public.app_convert_negatives(uuid[])','EXECUTE')
  and not has_function_privilege('anon','public.app_payroll_unpaid(date,date)','EXECUTE')
  and has_function_privilege('authenticated','public.app_payroll_unpaid(date,date)','EXECUTE'));
rollback;
