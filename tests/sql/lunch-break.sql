-- Lunch break excluded from hourly leave (FR-93, 2026-11-16).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table lb_fx(k text primary key,id uuid not null);
grant select on lb_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from lb_fx where k=p_key;
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
-- Fixture company: 08:00-17:00, lunch 13:00/60, cap 240, Friday weekend, holiday on d(10).
-- 2027-04-01 is a Thursday, so d(1) is a Friday.
create function pg_temp.subt(p_emp text,p_off int,p_from text,p_to text) returns text language sql as $$
  select pg_temp.as_scalar(p_emp,format(
    'select public.submit_hourly_leave_request_v2(%L,%L,%L,%L,%L,true)',
    pg_temp.fx('annual'),pg_temp.d(p_off),p_from::time,p_to::time,pg_temp.sig()));
$$;
create function pg_temp.mins(p_id text) returns text language sql as $$
  select case when left(p_id,6)='ERROR ' then p_id
    else (select requested_minutes::text from public.leave_requests where id=p_id::uuid) end;
$$;
create function pg_temp.mk(p_key text,p_emp text,p_off int,p_from text,p_to text) returns void language plpgsql as $$
declare v text:=pg_temp.subt(p_emp,p_off,p_from,p_to);
begin
  if left(v,6)='ERROR ' then raise exception 'fixture: % failed: %',p_key,v; end if;
  insert into lb_fx values(p_key,v::uuid);
end; $$;
create function pg_temp.approve(p_key text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar('admin',format(
    'select public.approve_leave_request_v2(%L,null,%L,true,true,null)::text',pg_temp.fx(p_key),pg_temp.sig())));
$$;
create function pg_temp.setbal(p_emp text,p_minutes int) returns void language plpgsql as $$
declare v_cur int:=public.current_leave_balance(pg_temp.fx(p_emp),pg_temp.fx('annual'));
begin
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(pg_temp.fx(p_emp),pg_temp.fx('annual'),'adjustment',p_minutes-v_cur,p_minutes,'fixture balance');
end; $$;
create function pg_temp.bal(p_emp text) returns text language sql as $$
  select public.current_leave_balance(pg_temp.fx(p_emp),pg_temp.fx('annual'))::text;
$$;
create function pg_temp.ledger(p_key text) returns text language sql as $$
  select coalesce(string_agg(entry_type||':'||delta_minutes,',' order by seq),'none')
    from public.leave_ledger where request_id=pg_temp.fx(p_key);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Lunch break synthetic fixture');
  insert into lb_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','LB');
  for who in select * from (values
    ('admin','admin','9990093001'),('emp','employee','9990093002'),('emp2','employee','9990093003'),
    ('neg','employee','9990093004')) t(k,role,code) loop
    insert into lb_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@lunch-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{5}','08:00','17:00',false);
  insert into public.holidays(company_id,holiday_date,name_fa) values(v_company,pg_temp.d(10),'تعطیل');
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid,manager_overdraft,allow_hourly)
    values(v_company,'سالانه','Fixture annual',true,true,true,true) returning id into v_id;
  insert into lb_fx values('annual',v_id);
end; $$;
select pg_temp.setbal('emp',100000);
select pg_temp.setbal('emp2',100000);
select pg_temp.setbal('neg',-600);

-- ============================================================ settings
select pg_temp.expect('defaults: lunch 13:00 / 60',
  (select lunch_start::text||'/'||lunch_minutes from public.work_settings where company_id=pg_temp.fx('company')),
  '13:00:00/60');
select pg_temp.expect('CHECK: lunch past work_end refused',
  pg_temp.err(pg_temp.as_scalar('admin',format(
    'update public.work_settings set lunch_start=''16:30'' where company_id=%L returning 1',pg_temp.fx('company')))),
  '23514');
select pg_temp.expect('CHECK: lunch before work_start refused',
  pg_temp.err(pg_temp.as_scalar('admin',format(
    'update public.work_settings set lunch_start=''07:00'' where company_id=%L returning 1',pg_temp.fx('company')))),
  '23514');
select pg_temp.expect('CHECK: lunch over 180 minutes refused',
  pg_temp.err(pg_temp.as_scalar('admin',format(
    'update public.work_settings set lunch_minutes=181 where company_id=%L returning 1',pg_temp.fx('company')))),
  '23514');
select pg_temp.expect('CHECK: lunch ending exactly at work_end allowed',
  pg_temp.err(pg_temp.as_scalar('admin',format(
    'update public.work_settings set lunch_start=''16:00'' where company_id=%L returning 1',pg_temp.fx('company')))),
  'ok');
update public.work_settings set lunch_start='13:00' where company_id=pg_temp.fx('company');
select pg_temp.expect('overlap helper: straddle', private.lunch_overlap_minutes(pg_temp.fx('company'),'12:30','13:30')::text,'30');
select pg_temp.expect('overlap helper: touching edges', private.lunch_overlap_minutes(pg_temp.fx('company'),'14:00','15:00')::text,'0');

-- ============================================================ counting
select pg_temp.expect('12:00-15:00 deducts 2h', pg_temp.mins(pg_temp.subt('emp',0,'12:00','15:00')),'120');
select pg_temp.expect('13:30-15:00 deducts 1h (30 min inside lunch)', pg_temp.mins(pg_temp.subt('emp',2,'13:30','15:00')),'60');
select pg_temp.expect('08:00-12:00 deducts 4h', pg_temp.mins(pg_temp.subt('emp',3,'08:00','12:00')),'240');
select pg_temp.expect('14:00-16:00 deducts 2h', pg_temp.mins(pg_temp.subt('emp',4,'14:00','16:00')),'120');

-- ============================================================ cap on net
select pg_temp.expect('11:00-16:00 (net 4h) is within the 4h cap', pg_temp.mins(pg_temp.subt('emp',5,'11:00','16:00')),'240');
select pg_temp.expect('10:00-16:00 (net 5h) exceeds the cap',
  pg_temp.subt('emp',6,'10:00','16:00'),'ERROR 22023 hourly leave exceeds the daily limit');

-- ============================================================ lunch-only request
select pg_temp.mk('lunch','emp2',7,'13:00','14:00');
select pg_temp.expect('lunch-only request deducts 0', pg_temp.mins(pg_temp.fx('lunch')::text),'0');
select pg_temp.expect('lunch-only: later hourly leave the same day still allowed',
  pg_temp.mins(pg_temp.subt('emp2',7,'15:00','17:00')),'120');
select pg_temp.expect('two non-zero hourly leaves the same day still refused',
  pg_temp.subt('emp2',7,'08:00','09:00'),'ERROR 22023 only one hourly leave per day');
select pg_temp.expect('lunch-only: approval ok', pg_temp.approve('lunch'),'ok');
select pg_temp.expect('lunch-only: approved', (select status::text from public.leave_requests where id=pg_temp.fx('lunch')),'approved');
select pg_temp.expect('lunch-only: no ledger row', pg_temp.ledger('lunch'),'none');
select pg_temp.expect('lunch-only: balance unchanged', pg_temp.bal('emp2'),'100000');
select pg_temp.expect('negative available balance can still log a lunch exit',
  pg_temp.mins(pg_temp.subt('neg',16,'13:00','14:00')),'0');
select pg_temp.expect('negative available balance: real hourly leave still refused',
  pg_temp.subt('neg',17,'09:00','10:00'),'ERROR 22023 request exceeds available balance');

-- ============================================================ non-working days still refused
select pg_temp.expect('lunch-only on a weekend refused', pg_temp.subt('emp',1,'13:00','14:00'),
  'ERROR 22023 requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)');
select pg_temp.expect('lunch-only on a holiday refused', pg_temp.subt('emp',10,'13:00','14:00'),
  'ERROR 22023 requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)');
select pg_temp.expect('weekend hourly leave refused', pg_temp.subt('emp',1,'09:00','11:00'),
  'ERROR 22023 requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)');

-- ============================================================ errands unchanged
select pg_temp.expect('hourly errand 12:00-15:00 counts 3h',
  pg_temp.mins(pg_temp.as_scalar('emp',format(
    'select public.submit_errand_request_v2(%L,%L,%L,''Site'',%L,true)',
    pg_temp.d(11),'12:00'::time,'15:00'::time,pg_temp.sig()))),'180');

-- ============================================================ edit recounts with lunch
select pg_temp.mk('ed','emp',12,'08:00','10:00');
select pg_temp.expect('edit fixture approved', pg_temp.approve('ed'),'ok');
select pg_temp.expect('edit to 12:00-15:00 recounts net 2h',
  pg_temp.err(pg_temp.as_scalar('admin',format(
    'select public.app_edit_request(%L,''hour'',%L,%L,''full'',''12:00'',''15:00'',null,''r'',%L,true)::text',
    pg_temp.fx('ed'),pg_temp.d(12),pg_temp.d(12),pg_temp.sig()))),'ok');
select pg_temp.expect('edited minutes', pg_temp.mins(pg_temp.fx('ed')::text),'120');
select pg_temp.expect('edit to 13:00-14:00 allowed (0 minutes)',
  pg_temp.err(pg_temp.as_scalar('admin',format(
    'select public.app_edit_request(%L,''hour'',%L,%L,''full'',''13:00'',''14:00'',null,''r'',%L,true)::text',
    pg_temp.fx('ed'),pg_temp.d(12),pg_temp.d(12),pg_temp.sig()))),'ok');
select pg_temp.expect('edited to 0', pg_temp.mins(pg_temp.fx('ed')::text),'0');
select pg_temp.expect('edited to 0: ledger nets to zero', (select sum(delta_minutes)::text from public.leave_ledger where request_id=pg_temp.fx('ed')),'0');

-- ============================================================ no lunch break
update public.work_settings set lunch_minutes=0 where company_id=pg_temp.fx('company');
select pg_temp.expect('lunch_minutes 0: 12:00-15:00 counts 3h', pg_temp.mins(pg_temp.subt('emp',13,'12:00','15:00')),'180');
select pg_temp.expect('lunch_minutes 0: 13:00-14:00 counts 1h', pg_temp.mins(pg_temp.subt('emp',14,'13:00','14:00')),'60');

rollback;
