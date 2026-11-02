-- FR-74: Manager is read-only on people (2026-11-02, docs/specs/2026-11-02-manager-read-only-design.md).
-- Managers add and change no one; they see only their direct reports (plus the company calendar)
-- and still approve. Anyone with a direct report, whatever their role, sees that report.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
-- Results arrive as NOTICEs (stderr); hide the empty result sets.
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table mr_fx(k text primary key,id uuid not null);
grant select on mr_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from mr_fx where k=p_key;
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
create function pg_temp.leave(p_actor text,p_start date,p_end date) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.submit_leave_request_v2(%L,%L,%L,''full'',%L,true)',
    pg_temp.fx('annual'),p_start,p_end,pg_temp.sig()));
$$;
create function pg_temp.sign(p_actor text,p_req text,p_steps text[]) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.approve_leave_request_steps(%L,%L::uuid[],%L,true)::text',
    pg_temp.fx(p_req),(select array_agg(pg_temp.fx(k) order by o) from unnest(p_steps) with ordinality as v(k,o)),
    pg_temp.sig())));
$$;
-- How many rows of p_table about p_who the actor can read.
create function pg_temp.sees(p_actor text,p_table text,p_col text,p_who text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format('select count(*)::text from public.%I where %I=%L',p_table,p_col,pg_temp.fx(p_who)));
$$;
-- Rows an UPDATE by the actor changed (RLS hides a row it may not touch: 0).
create function pg_temp.upd(p_actor text,p_set text,p_who text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'with u as (update public.profiles set %s where id=%L returning 1) select count(*)::text from u',p_set,pg_temp.fx(p_who)));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_b uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Manager read-only synthetic fixture');
  insert into mr_fx values('company',v_company),('dept_a',v_a),('dept_b',v_b);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','MRA'),(v_b,v_company,'ب','Fixture B','office','MRB');
  -- boss (Manager, dept A) manages rep (dept B, so not a same-department teammate).
  -- lead holds Employee only and manages sub. peer is nobody's report.
  for who in select * from (values
    ('admin','admin','A','9990074001'),('boss','manager','A','9990074002'),('hrp','hr','A','9990074003'),
    ('lead','employee','A','9990074004'),('rep','employee','B','9990074005'),
    ('peer','employee','B','9990074006'),('sub','employee','B','9990074007')) t(k,role,dept,code) loop
    insert into mr_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@manager-ro-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,case who.dept when 'A' then v_a else v_b end,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id=pg_temp.fx('rep');
  update public.profiles set manager_id=pg_temp.fx('lead') where id=pg_temp.fx('sub');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into mr_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into mr_fx values('mgr',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into mr_fx values('hr',v_id);
  insert into public.leave_ledger(employee_id,leave_type_id,entry_type,delta_minutes,balance_after_minutes,note)
    select pg_temp.fx(k),pg_temp.fx('annual'),'adjustment',960,960,'synthetic opening balance'
      from unnest(array['rep','peer','sub']) k;
end; $$;

-- ── managers add and change no one ───────────────────────────────────────────
select pg_temp.expect('manager may not create an employee',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.app_create_employee(''9990074090'',''FR74 new'',''Temp!2026x'',%L)::text',pg_temp.fx('company')))),'42501');
select pg_temp.expect('… even naming their own department',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.app_create_employee(''9990074091'',''FR74 new'',''Temp!2026x'',%L,%L,%L)::text',
  pg_temp.fx('company'),pg_temp.fx('dept_a'),pg_temp.fx('boss')))),'42501');
select pg_temp.expect('manager may not rename a direct report',pg_temp.upd('boss','full_name=''Renamed''','rep'),'0');
select pg_temp.expect('manager may not change a report''s hire date',pg_temp.upd('boss','hire_date=''2020-01-01''','rep'),'0');
select pg_temp.expect('report''s name unchanged',(select full_name from public.profiles where id=pg_temp.fx('rep')),'Fixture rep');
select pg_temp.expect('manager may not set a balance',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.set_leave_balance(%L,%L,4800)::text',pg_temp.fx('rep'),pg_temp.fx('annual')))),'42501');
select pg_temp.expect('manager still edits their own name',pg_temp.upd('boss','full_name=''Fixture boss 2''','boss'),'1');

-- ── managers see their direct reports, not the whole company ────────────────
select pg_temp.expect('manager sees a direct report in another department',pg_temp.sees('boss','profiles','id','rep'),'1');
select pg_temp.expect('manager no longer sees a non-report in another department',pg_temp.sees('boss','profiles','id','peer'),'0');
select pg_temp.expect('manager sees a report''s roles',pg_temp.sees('boss','user_roles','user_id','rep'),'1');
select pg_temp.expect('manager no longer sees a non-report''s roles',pg_temp.sees('boss','user_roles','user_id','peer'),'0');
select pg_temp.expect('manager sees a report''s balance',pg_temp.sees('boss','leave_ledger','employee_id','rep'),'1');
select pg_temp.expect('manager no longer sees a non-report''s balance',pg_temp.sees('boss','leave_ledger','employee_id','peer'),'0');
select pg_temp.expect('manager refreshes a report''s accrual',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.accrue_employee_leave(%L)::text',pg_temp.fx('rep')))),'ok');
select pg_temp.expect('… but not a non-report''s',pg_temp.err(pg_temp.as_scalar('boss',format(
  'select public.accrue_employee_leave(%L)::text',pg_temp.fx('peer')))),'42501');

-- ── company calendar stays, approvals stay ───────────────────────────────────
insert into mr_fx values('peer_req',(pg_temp.leave('peer',current_date+10,current_date+10))::uuid);
insert into mr_fx values('rep_req',(pg_temp.leave('rep',current_date+12,current_date+12))::uuid);
insert into mr_fx values('sub_req',(pg_temp.leave('sub',current_date+14,current_date+14))::uuid);
select pg_temp.expect('manager still sees a non-report on the company calendar',
  pg_temp.sees('boss','team_leave_calendar','employee_id','peer'),'1');
select pg_temp.expect('manager reads a report''s request',pg_temp.sees('boss','leave_requests','employee_id','rep'),'1');
select pg_temp.expect('manager does not read a non-report''s request',pg_temp.sees('boss','leave_requests','employee_id','peer'),'0');
select pg_temp.expect('manager signs a report''s request',pg_temp.sign('boss','rep_req',array['mgr']),'ok');
select pg_temp.expect('HR co-signs',pg_temp.sign('hrp','rep_req',array['hr']),'ok');
select pg_temp.expect('report''s request approved',
  (select status::text from public.leave_requests where id=pg_temp.fx('rep_req')),'approved');

-- ── a direct manager without the Manager role: sees, never acts ─────────────
select pg_temp.expect('employee-role lead sees their report',pg_temp.sees('lead','profiles','id','sub'),'1');
select pg_temp.expect('… the report''s roles',pg_temp.sees('lead','user_roles','user_id','sub'),'1');
select pg_temp.expect('… the report''s balance',pg_temp.sees('lead','leave_ledger','employee_id','sub'),'1');
select pg_temp.expect('… the report''s request',pg_temp.sees('lead','leave_requests','employee_id','sub'),'1');
select pg_temp.expect('lead does not see a non-report',pg_temp.sees('lead','profiles','id','peer'),'0');
select pg_temp.expect('lead may not sign the manager step',(pg_temp.sign('lead','sub_req',array['mgr'])<>'ok')::text,'true');
select pg_temp.expect('lead may not rename the report',pg_temp.upd('lead','full_name=''Renamed''','sub'),'0');

-- ── HR still adds and changes employees ──────────────────────────────────────
select pg_temp.expect('HR creates an employee',pg_temp.err(pg_temp.as_scalar('hrp',format(
  'select public.app_create_employee(''9990074092'',''FR74 hire'',''Temp!2026x'',%L,%L)::text',
  pg_temp.fx('company'),pg_temp.fx('dept_b')))),'ok');
select pg_temp.expect('HR renames an employee',pg_temp.upd('hrp','full_name=''Fixture rep 2''','rep'),'1');
select pg_temp.expect('HR still reads everyone',pg_temp.sees('hrp','profiles','id','peer'),'1');

rollback;
