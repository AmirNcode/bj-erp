-- Manager overdraft backfill (FR-92, 2026-11-12): private.manager_overdraft_backfill().
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

create function pg_temp.d(p_off int) returns date language sql as $$
  select date '2027-04-01'+p_off;
$$;
-- Insert a leave request row directly; p_status is the final status. Returns the id.
create function pg_temp.req(p_key text,p_emp text,p_type text,p_off int,p_req int,p_unpaid int,p_status text,p_seq int)
returns void language plpgsql as $$
declare v_id uuid:=gen_random_uuid();
begin
  insert into public.leave_requests(id,employee_id,leave_type_id,start_date,end_date,day_part,unit,
      requested_minutes,unpaid_minutes,status,company_id,serial_year,serial_seq,kind,created_at)
    values(v_id,pg_temp.fx(p_emp),pg_temp.fx(p_type),pg_temp.d(p_off),pg_temp.d(p_off),'full','day',
      p_req,p_unpaid,'pending',pg_temp.fx('company'),2027,p_seq,'leave',now()+make_interval(secs=>p_seq));
  insert into mo_fx values(p_key,v_id);
  if p_status<>'pending' then
    update public.leave_requests set status=p_status::public.leave_status where id=v_id;
  end if;
end; $$;
create function pg_temp.unpaid(p_key text) returns text language sql as $$
  select unpaid_minutes::text from public.leave_requests where id=pg_temp.fx(p_key);
$$;
create function pg_temp.nledger(p_key text) returns text language sql as $$
  select count(*)::text from public.leave_ledger where request_id=pg_temp.fx(p_key);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Manager overdraft backfill fixture');
  insert into mo_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','MB');
  for who in select * from (values
    ('admin','admin','9990093001'),('mgr','manager','9990093002'),('emp','employee','9990093003')) t(k,role,code) loop
    insert into mo_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@overdraft-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'سالانه','Fixture annual',true,true,true) returning id into v_id;
  insert into mo_fx values('annual',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'استعلاجی','Fixture sick',true,true,false) returning id into v_id;
  insert into mo_fx values('sick',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft)
    values(v_company,'بدون حقوق','Fixture unpaid',false,false,false) returning id into v_id;
  insert into mo_fx values('unpaid',v_id);
  -- opening balances
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(pg_temp.fx('mgr'),pg_temp.fx('annual'),'adjustment',480,480,'fixture opening');
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(pg_temp.fx('mgr'),pg_temp.fx('sick'),'adjustment',100,100,'fixture opening');
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(pg_temp.fx('emp'),pg_temp.fx('annual'),'adjustment',480,480,'fixture opening');
end; $$;

-- a. Manager M
select pg_temp.req('a1','mgr','annual',0,480,240,'approved',1);
select pg_temp.req('a2','mgr','annual',2,480,120,'approved',2);
select pg_temp.req('ap','mgr','annual',4,480,60,'pending',3);
select pg_temp.req('au','mgr','unpaid',6,480,480,'approved',4);
select pg_temp.req('as','mgr','sick',8,480,200,'approved',5);
-- b. Employee E
select pg_temp.req('b1','emp','annual',0,480,240,'approved',6);

create temp table mo_before as
  select (select count(*) from public.leave_ledger where request_id=pg_temp.fx('au')) au_l,
         (select count(*) from public.leave_ledger where request_id=pg_temp.fx('as')) as_l,
         (select count(*) from public.leave_ledger where request_id=pg_temp.fx('b1')) b1_l;
create temp table mo_n as select private.manager_overdraft_backfill() n;

-- c. results
select pg_temp.assert('backfill changed at least the three fixture requests',(select n>=3 from mo_n));
select pg_temp.expect('a1 unpaid moved',pg_temp.unpaid('a1'),'0');
select pg_temp.expect('a2 unpaid moved',pg_temp.unpaid('a2'),'0');
select pg_temp.expect('a1 exactly one consumption row',
  (select count(*)::text from public.leave_ledger where request_id=pg_temp.fx('a1') and entry_type='consumption'),'1');
select pg_temp.expect('a2 exactly one consumption row',
  (select count(*)::text from public.leave_ledger where request_id=pg_temp.fx('a2') and entry_type='consumption'),'1');
select pg_temp.expect('a1 delta is minus the old unpaid part',
  (select delta_minutes::text from public.leave_ledger where request_id=pg_temp.fx('a1')),'-240');
select pg_temp.expect('a2 delta is minus the old unpaid part',
  (select delta_minutes::text from public.leave_ledger where request_id=pg_temp.fx('a2')),'-120');
select pg_temp.assert('balance chain continuous in seq order',
  (select bool_and(balance_after_minutes=prev+delta_minutes)
     from (select balance_after_minutes,delta_minutes,
                  lag(balance_after_minutes) over (order by seq) prev
             from public.leave_ledger
            where employee_id=pg_temp.fx('mgr') and leave_type_id=pg_temp.fx('annual')) x
    where prev is not null));
select pg_temp.expect('balance ends at 480-240-120',
  (select balance_after_minutes::text from public.leave_ledger
    where employee_id=pg_temp.fx('mgr') and leave_type_id=pg_temp.fx('annual') order by seq desc limit 1),'120');
select pg_temp.expect('pending unpaid cleared',pg_temp.unpaid('ap'),'0');
select pg_temp.expect('pending has no ledger row',pg_temp.nledger('ap'),'0');
select pg_temp.expect('unpaid-type request untouched',pg_temp.unpaid('au'),'480');
select pg_temp.assert('unpaid-type ledger untouched',pg_temp.nledger('au')::int=(select au_l from mo_before));
select pg_temp.expect('sick request untouched',pg_temp.unpaid('as'),'200');
select pg_temp.assert('sick ledger untouched',pg_temp.nledger('as')::int=(select as_l from mo_before));
-- b.
select pg_temp.expect('employee request untouched',pg_temp.unpaid('b1'),'240');
select pg_temp.assert('employee ledger untouched',pg_temp.nledger('b1')::int=(select b1_l from mo_before));
select pg_temp.expect('three audit rows for the manager requests',
  (select count(*)::text from public.audit_log where action='leave_request.overdraft_backfill'
      and entity_id in (pg_temp.fx('a1'),pg_temp.fx('a2'),pg_temp.fx('ap'))),'3');
select pg_temp.expect('no audit rows for untouched requests',
  (select count(*)::text from public.audit_log where action='leave_request.overdraft_backfill'
      and entity_id in (pg_temp.fx('au'),pg_temp.fx('as'),pg_temp.fx('b1'))),'0');

-- d. idempotent
create temp table mo_n2 as select private.manager_overdraft_backfill() n;
select pg_temp.expect('second run returns 0',(select n::text from mo_n2),'0');
select pg_temp.expect('second run adds no ledger rows for a1/a2',
  (select count(*)::text from public.leave_ledger where request_id in (pg_temp.fx('a1'),pg_temp.fx('a2'))),'2');
select pg_temp.expect('second run adds no audit rows',
  (select count(*)::text from public.audit_log where action='leave_request.overdraft_backfill'
      and entity_id in (pg_temp.fx('a1'),pg_temp.fx('a2'),pg_temp.fx('ap'))),'3');

-- e. privileges
select pg_temp.assert('authenticated cannot execute the backfill',
  not has_function_privilege('authenticated','private.manager_overdraft_backfill()','EXECUTE')
  and not has_function_privilege('anon','private.manager_overdraft_backfill()','EXECUTE'));

rollback;
