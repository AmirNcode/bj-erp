-- Security-only staff have no time off (FR-76, owner 2026-11-03): someone with Security and
-- without Employee may not file a request (any kind) and earns no accrual; Security + Employee may.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table so_fx(k text primary key,id uuid not null);
grant select on so_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from so_fx where k=p_key;
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
create function pg_temp.leave(p_actor text,p_day int) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)::text',
    pg_temp.fx('annual'),current_date+p_day,current_date+p_day,pg_temp.sig())));
$$;
create function pg_temp.hourly(p_actor text,p_day int) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_hourly_leave_request_v2(%L,%L,''08:00'',''09:00'',%L,true)::text',
    pg_temp.fx('annual'),current_date+p_day,pg_temp.sig())));
$$;
create function pg_temp.errand(p_actor text,p_day int) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.submit_daily_errand_request_v2(%L,%L,''Fixture site'',%L,true)::text',
    current_date+p_day,current_date+p_day,pg_temp.sig())));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Security-only synthetic fixture');
  insert into so_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','SOA');
  for who in select * from (values
    ('admin',array['admin'],'9990078001'),('boss',array['manager','employee'],'9990078002'),
    ('guard',array['security'],'9990078003'),('both',array['security','employee'],'9990078004'),
    ('emp',array['employee'],'9990078005')) t(k,roles,code) loop
    insert into so_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@secure-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id in (pg_temp.fx('guard'),pg_temp.fx('both'),pg_temp.fx('emp'));
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into so_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to) values(v_company,'manager',1,'{leave,errand}');
end; $$;

select pg_temp.expect('helper: guard yes, both no, emp no',
  private.is_security_only(pg_temp.fx('guard'))::text || private.is_security_only(pg_temp.fx('both'))::text
  || private.is_security_only(pg_temp.fx('emp'))::text,'truefalsefalse');

select pg_temp.expect('security-only: daily leave refused',pg_temp.leave('guard',10),'42501');
select pg_temp.expect('security-only: hourly leave refused',pg_temp.hourly('guard',11),'42501');
select pg_temp.expect('security-only: daily errand refused',pg_temp.errand('guard',12),'42501');
select pg_temp.expect('… with the FR-76 message',
  pg_temp.as_scalar('guard',format('select public.submit_daily_errand_request_v2(%L,%L,''x'',%L,true)::text',
    current_date+13,current_date+13,pg_temp.sig())),'ERROR 42501 no time off for this account');
select pg_temp.expect('a direct insert is refused too (trigger)',
  pg_temp.err(pg_temp.as_scalar('admin',format($q$insert into public.leave_requests(employee_id,company_id,kind,errand_location,
    start_date,end_date,requested_minutes,status,serial_year,serial_seq)
    values(%L,%L,'errand','x',current_date+14,current_date+14,480,'pending',1,979001) returning 'x'$q$,
    pg_temp.fx('guard'),pg_temp.fx('company')))),'42501');
select pg_temp.expect('security + employee: daily leave allowed',pg_temp.leave('both',10),'ok');
select pg_temp.expect('security + employee: hourly leave allowed',pg_temp.hourly('both',11),'ok');
select pg_temp.expect('security + employee: daily errand allowed',pg_temp.errand('both',12),'ok');
select pg_temp.expect('plain employee unaffected',pg_temp.leave('emp',10),'ok');

-- Accrual: a policy that has earned several months posts for both, nothing for guard.
insert into public.employee_leave_policies(employee_id,leave_type_id,accrual_minutes_per_month,accrual_start_month)
select pg_temp.fx(k),pg_temp.fx('annual'),600,
       (select gregorian_start from public.jalali_months
         where (now() at time zone 'Asia/Tehran')::date - 70 between gregorian_start and gregorian_end)
  from unnest(array['guard','both']) k;
select public.accrue_leave(pg_temp.fx('guard'),pg_temp.fx('annual'));
select public.accrue_leave(pg_temp.fx('both'),pg_temp.fx('annual'));
select pg_temp.expect('accrual: none for security-only',
  (select count(*)::text from public.leave_ledger where employee_id=pg_temp.fx('guard') and period_month is not null),'0');
select pg_temp.expect('accrual: posted for security + employee',
  (select (count(*)>0)::text from public.leave_ledger where employee_id=pg_temp.fx('both') and period_month is not null),'true');

rollback;
