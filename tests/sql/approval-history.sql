-- Approvals history (owner, 2026-11-02): app_approval_history lists the decided requests the
-- caller personally approved or rejected a step of; the admin sees every decided request.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
-- Results arrive as NOTICEs (stderr); hide the empty result sets.
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table ah_fx(k text primary key,id uuid not null);
grant select on ah_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from ah_fx where k=p_key;
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
create function pg_temp.reject(p_actor text,p_req text,p_step text,p_note text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format(
    'select public.reject_leave_request_v2(%L,%L,%L)::text',pg_temp.fx(p_req),pg_temp.fx(p_step),p_note)));
$$;
create function pg_temp.history(p_actor text,p_path text,p_limit int default 20) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format('select (public.app_approval_history(%s,0)#>>%L)',p_limit,p_path));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Approval history synthetic fixture');
  insert into ah_fx values('company',v_company),('dept_a',v_a);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','AHA');
  for who in select * from (values
    ('admin','admin','9990076001'),('boss','manager','9990076002'),('boss2','manager','9990076003'),
    ('hrp','hr','9990076004'),('rep','employee','9990076005'),('peer','employee','9990076006')) t(k,role,code) loop
    insert into ah_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@history-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id=pg_temp.fx('rep');
  update public.profiles set manager_id=pg_temp.fx('boss2') where id=pg_temp.fx('peer');
  insert into public.work_settings(company_id,weekend_days,work_start,work_end,approval_order_enforced)
    values(v_company,'{}','07:00','15:00',false);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_id;
  insert into ah_fx values('annual',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'manager',1,'{leave,errand}') returning id into v_id;
  insert into ah_fx values('mgr',v_id);
  insert into public.approval_steps(company_id,role,step_order,applies_to)
    values(v_company,'hr',2,'{leave,errand}') returning id into v_id;
  insert into ah_fx values('hr',v_id);
end; $$;

insert into ah_fx values('approved',(pg_temp.leave('rep',current_date+10,current_date+10))::uuid);
insert into ah_fx values('rejected',(pg_temp.leave('peer',current_date+11,current_date+11))::uuid);
insert into ah_fx values('pending',(pg_temp.leave('rep',current_date+12,current_date+12))::uuid);
select pg_temp.expect('boss signs',pg_temp.sign('boss','approved',array['mgr']),'ok');
select pg_temp.expect('HR co-signs',pg_temp.sign('hrp','approved',array['hr']),'ok');
select pg_temp.expect('boss2 rejects',pg_temp.reject('boss2','rejected','mgr','Busy week'),'ok');
select pg_temp.expect('boss signs the still-pending one',pg_temp.sign('boss','pending',array['mgr']),'ok');

select pg_temp.expect('boss: only the decided request they signed',pg_temp.history('boss','{total}'),'1');
select pg_temp.expect('… it is the approved one',pg_temp.history('boss','{rows,0,id}'),pg_temp.fx('approved')::text);
select pg_temp.expect('… with their own decision',pg_temp.history('boss','{rows,0,my_decisions,0,decision}'),'approved');
select pg_temp.expect('HR: the request they co-signed',pg_temp.history('hrp','{rows,0,id}'),pg_temp.fx('approved')::text);
select pg_temp.expect('HR total',pg_temp.history('hrp','{total}'),'1');
select pg_temp.expect('boss2: the rejection',pg_temp.history('boss2','{rows,0,status}'),'rejected');
select pg_temp.expect('… with its note',pg_temp.history('boss2','{rows,0,my_decisions,0,note}'),'Busy week');
select pg_temp.expect('boss2 does not see boss''s request',pg_temp.history('boss2','{total}'),'1');
select pg_temp.expect('the requester signed nothing',pg_temp.history('rep','{total}'),'0');
select pg_temp.expect('admin: every decided request, never a pending one',pg_temp.history('admin','{total}'),'2');
select pg_temp.expect('paged',pg_temp.as_scalar('admin','select jsonb_array_length(public.app_approval_history(1,0)->''rows'')::text'),'1');
select pg_temp.expect('anon may not call it',
  has_function_privilege('anon','public.app_approval_history(integer,integer)','execute')::text,'false');

rollback;
