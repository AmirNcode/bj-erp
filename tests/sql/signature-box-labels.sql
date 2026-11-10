-- Signature box labels (spec 2026-11-09-form-signature-boxes-design): approval_steps.box_label is the
-- title of the step's box on the printed form; each decision snapshots it; renaming a box does not
-- flag pending requests as "configuration changed"; the print payload carries labels and the steps.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table sb_fx(k text primary key,id uuid not null);
grant select on sb_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from sb_fx where k=p_key;
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

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_type uuid; v_id uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Signature box synthetic fixture');
  insert into sb_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_dept,v_company,'الف','Fixture A','office','SBA');
  for who in select * from (values
    ('admin','admin','9990088001'),('boss','employee','9990088002'),('rep','employee','9990088003'),
    ('office','employee','9990088004'),('plain','employee','9990088005')) t(k,role,code) loop
    insert into sb_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@sigbox-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  insert into public.user_roles(user_id,role) values(pg_temp.fx('boss'),'manager');
  perform pg_temp.login('admin');
  update public.profiles set manager_id=pg_temp.fx('boss') where id=pg_temp.fx('rep');
  insert into public.approval_steps(id,company_id,role,step_order,box_label)
    values(gen_random_uuid(),v_company,'manager',1,'تصویب کننده') returning id into v_id;
  insert into sb_fx values('step_mgr',v_id);
  insert into public.approval_steps(id,company_id,role,approver_id,step_order,box_label)
    values(gen_random_uuid(),v_company,'employee',pg_temp.fx('office'),2,'امور اداری') returning id into v_id;
  insert into sb_fx values('step_office',v_id);
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_type;
  insert into public.leave_requests(employee_id,company_id,kind,leave_type_id,unit,start_date,end_date,
                                    requested_minutes,status,serial_year,serial_seq)
    values(pg_temp.fx('rep'),v_company,'leave',v_type,'day',date '2027-06-10',date '2027-06-10',480,'pending',1,977001)
    returning id into v_id;
  insert into sb_fx values('req',v_id);
  -- Submission RPCs write this row; a direct fixture insert must add it.
  insert into public.approval_request_policy(request_id,company_id,starts_at,ends_at)
    values(v_id,v_company,timestamptz '2027-06-10 00:00+00',timestamptz '2027-06-11 00:00+00')
    on conflict do nothing;
end; $$;

-- Label shape.
select pg_temp.expect('blank box label rejected',
  pg_temp.err(pg_temp.as_scalar('admin',$q$update public.approval_steps set box_label='  '
    where id=pg_temp.fx('step_office') returning id::text$q$)),'23514');
select pg_temp.expect('61-char box label rejected',
  pg_temp.err(pg_temp.as_scalar('admin',$q$update public.approval_steps set box_label=repeat('x',61)
    where id=pg_temp.fx('step_office') returning id::text$q$)),'23514');
select pg_temp.expect('plain employee cannot rename a box',
  pg_temp.as_scalar('plain',$q$update public.approval_steps set box_label='Hijack'
    where id=pg_temp.fx('step_office') returning id::text$q$),null);

-- Rename only: no "configuration changed" on the pending request.
select pg_temp.expect('pending request has an approval policy row',
  (select count(*)::text from public.approval_request_policy where request_id=pg_temp.fx('req')),'1');
update public.approval_request_policy set configuration_changed=false where request_id=pg_temp.fx('req');
select pg_temp.expect('admin renames the box',
  pg_temp.as_scalar('admin',$q$update public.approval_steps set box_label='Office'
    where id=pg_temp.fx('step_office') returning box_label$q$),'Office');
select pg_temp.expect('rename does not flag pending requests',
  (select configuration_changed::text from public.approval_request_policy where request_id=pg_temp.fx('req')),'false');
select pg_temp.expect('admin reorders the step',
  pg_temp.as_scalar('admin',$q$update public.approval_steps set step_order=3
    where id=pg_temp.fx('step_office') returning step_order::text$q$),'3');
select pg_temp.expect('reorder still flags pending requests',
  (select configuration_changed::text from public.approval_request_policy where request_id=pg_temp.fx('req')),'true');

-- A decision snapshots the label; a later rename leaves the snapshot.
insert into public.leave_request_approvals(request_id,step_role,step_id,approver_id,decision)
  values(pg_temp.fx('req'),'manager',pg_temp.fx('step_mgr'),pg_temp.fx('boss'),'approved');
select pg_temp.expect('decision snapshots the box label',
  (select box_label from public.leave_request_approvals where request_id=pg_temp.fx('req')),'تصویب کننده');
update public.approval_steps set box_label='Renamed' where id=pg_temp.fx('step_mgr');
select pg_temp.expect('snapshot survives a rename',
  (select box_label from public.leave_request_approvals where request_id=pg_temp.fx('req')),'تصویب کننده');

-- Print payload, read as the requester.
select pg_temp.expect('print: signed box keeps its snapshot',
  pg_temp.as_scalar('rep',$q$select x->>'box_label' from jsonb_array_elements(
    (public.app_request_print(pg_temp.fx('req'))->'signatures'->'approvals')) x
    where x->>'step_id'=pg_temp.fx('step_mgr')::text$q$),'تصویب کننده');
select pg_temp.expect('print: pending box shows the live label',
  pg_temp.as_scalar('rep',$q$select x->>'box_label' from jsonb_array_elements(
    (public.app_request_print(pg_temp.fx('req'))->'signatures'->'approvals')) x
    where x->>'step_id'=pg_temp.fx('step_office')::text$q$),'Office');
select pg_temp.expect('print: steps list both active steps in order',
  pg_temp.as_scalar('rep',$q$select string_agg(x->>'box_label',',' order by (x->>'step_order')::int)
    from jsonb_array_elements(public.app_request_print(pg_temp.fx('req'))->'signatures'->'steps') x$q$),
  'Renamed,Office');
update public.approval_steps set active=false where id=pg_temp.fx('step_office');
select pg_temp.expect('print: inactive step leaves the steps list',
  pg_temp.as_scalar('rep',$q$select string_agg(x->>'box_label',',')
    from jsonb_array_elements(public.app_request_print(pg_temp.fx('req'))->'signatures'->'steps') x$q$),
  'Renamed');
select pg_temp.expect('print: stranger cannot read the payload',
  pg_temp.err(pg_temp.as_scalar('plain',$q$select public.app_request_print(pg_temp.fx('req'))::text$q$)),'P0002');

\o
select 'signature-box-labels: all assertions passed' as result;
rollback;
