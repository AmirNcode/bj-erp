-- HR adds time to a leave balance with a reason (FR-85, 2026-11-05).
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table ba_fx(k text primary key,id uuid not null);
grant select on ba_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from ba_fx where k=p_key;
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

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Balance add synthetic fixture');
  insert into ba_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','BA');
  for who in select * from (values
    ('admin','admin','9990019101'),('hr','hr','9990019102'),('worker','employee','9990019103')) t(k,role,code) loop
    insert into ba_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@balance-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid)
    values(v_company,'سالانه','Fixture annual',true,true) returning id into v_id;
  insert into ba_fx values('annual',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,affects_balance,is_paid)
    values(v_company,'بدون حقوق','Fixture unpaid',false,false) returning id into v_id;
  insert into ba_fx values('unpaid',v_id);
end; $$;

create function pg_temp.add(p_actor text,p_employee text,p_type text,p_minutes int,p_reason text) returns text
language sql as $$
  select pg_temp.as_scalar(p_actor,format('select public.app_add_leave_balance(%L,%L,%s,%L)::text',
    pg_temp.fx(p_employee),pg_temp.fx(p_type),p_minutes,p_reason));
$$;
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;

select pg_temp.expect('hr adds a day and gets the new balance',
  pg_temp.add('hr','worker','annual',1440,'  returned early  '),
  (public.current_leave_balance(pg_temp.fx('worker'),pg_temp.fx('annual'))+1440)::text);
select pg_temp.expect('the row is a marked adjustment with the trimmed reason and the actor',
  (select entry_type||'/'||quick_add||'/'||note||'/'||(created_by=pg_temp.fx('hr'))::text||'/'||delta_minutes
     from public.leave_ledger where employee_id=pg_temp.fx('worker') order by seq desc limit 1),
  'adjustment/true/returned early/true/1440');
select pg_temp.expect('audit records the add',
  (select count(*)::text from public.audit_log a join public.leave_ledger l on l.id=a.entity_id
    where a.action='leave_balance.add' and l.employee_id=pg_temp.fx('worker')),'1');
select pg_temp.expect('a second add stacks on the first',
  pg_temp.add('hr','worker','annual',60,'second'),'1500');

select pg_temp.expect('hr refused on own balance',pg_temp.err(pg_temp.add('hr','hr','annual',60,'x')),'42501');
select pg_temp.expect('admin may add to own balance',pg_temp.err(pg_temp.add('admin','admin','annual',60,'x')),'ok');
select pg_temp.expect('a plain employee is refused',pg_temp.err(pg_temp.add('worker','worker','annual',60,'x')),'42501');
select pg_temp.expect('zero refused',pg_temp.err(pg_temp.add('hr','worker','annual',0,'x')),'22023');
select pg_temp.expect('a negative amount refused',pg_temp.err(pg_temp.add('hr','worker','annual',-60,'x')),'22023');
select pg_temp.expect('over one year refused',
  pg_temp.err(pg_temp.add('hr','worker','annual',366*480+1,'x')),'22023');
select pg_temp.expect('exactly one year allowed',
  pg_temp.err(pg_temp.add('hr','worker','annual',366*480,'x')),'ok');
select pg_temp.expect('empty reason refused',pg_temp.err(pg_temp.add('hr','worker','annual',60,'')),'22023');
select pg_temp.expect('reason of spaces refused',pg_temp.err(pg_temp.add('hr','worker','annual',60,'   ')),'22023');
select pg_temp.expect('501 characters refused',pg_temp.err(pg_temp.add('hr','worker','annual',60,repeat('x',501))),'22023');
select pg_temp.expect('500 characters allowed',pg_temp.err(pg_temp.add('hr','worker','annual',60,repeat('x',500))),'ok');
select pg_temp.expect('a type without a balance refused',pg_temp.err(pg_temp.add('hr','worker','unpaid',60,'x')),'22023');

select pg_temp.expect('set_leave_balance records who and stays unmarked',
  pg_temp.as_scalar('hr',format('select public.set_leave_balance(%L,%L,100)::text',pg_temp.fx('worker'),pg_temp.fx('annual'))),'100');
select pg_temp.expect('hand edit row',
  (select quick_add||'/'||(created_by=pg_temp.fx('hr'))::text||'/'||note
     from public.leave_ledger where employee_id=pg_temp.fx('worker') order by seq desc limit 1),
  'false/true/admin balance set');
select pg_temp.assert('anon cannot run it',
  not has_function_privilege('anon','public.app_add_leave_balance(uuid,uuid,integer,text)','EXECUTE'));
rollback;
