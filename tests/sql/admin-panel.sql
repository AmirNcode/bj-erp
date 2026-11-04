-- Admin panel (FR-77, owner 2026-11-03): only the admin reads the overview, system and audit
-- functions; the numbers add up on a small synthetic company; secrets stay out of the audit view.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table ap_fx(k text primary key,id uuid not null);
grant select on ap_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from ap_fx where k=p_key;
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
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_type uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Admin panel synthetic fixture');
  insert into ap_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','APA');
  for who in select * from (values
    ('admin',array['admin'],'9990080001',true,now()),
    ('hr',array['hr','employee'],'9990080002',true,now() - interval '2 days'),
    ('emp',array['employee'],'9990080003',true,null::timestamptz),
    ('old',array['employee'],'9990080004',false,now() - interval '20 days')) t(k,roles,code,active,signed_in) loop
    insert into ap_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email,last_sign_in_at) values(pg_temp.fx(who.k),who.code||'@admin-fixture.invalid',who.signed_in);
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password,active)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,who.k='emp',who.active);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
  end loop;
  insert into public.work_settings(company_id,weekend_days,work_start,work_end) values(v_company,'{}','07:00','15:00');
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_type;
  -- Two decided requests (2 h and 10 h), one pending for 5 days.
  insert into public.leave_requests(employee_id,company_id,leave_type_id,kind,errand_location,start_date,end_date,requested_minutes,status,
      serial_year,serial_seq,created_at,decided_at)
  values (pg_temp.fx('emp'),v_company,v_type,'leave',null,current_date+40,current_date+40,480,'approved',1,980001,now()-interval '1 hour',now()+interval '1 hour'),
         (pg_temp.fx('hr'),v_company,v_type,'leave',null,current_date+41,current_date+41,480,'rejected',1,980002,now()-interval '1 hour',now()+interval '9 hours'),
         (pg_temp.fx('emp'),v_company,null,'errand','Fixture site',current_date+42,current_date+42,480,'pending',1,980003,now()-interval '5 days',null);
  insert into public.audit_log(actor_id,action,entity,entity_id,before,after) values
    (pg_temp.fx('admin'),'fixture_action','profiles',pg_temp.fx('emp'),
     jsonb_build_object('full_name','A'),
     jsonb_build_object('full_name','B','signature_data','data:image/png;base64,AAAA','new_password','hunter22','note',repeat('x',600),
       'api_key_changed',true));
end; $$;

-- ── admin only ──
select pg_temp.expect('non-admin: overview refused',pg_temp.err(pg_temp.as_scalar('hr',
  'select public.app_admin_overview(current_date-30,current_date)::text')),'42501');
select pg_temp.expect('non-admin: system refused',pg_temp.err(pg_temp.as_scalar('hr','select public.app_admin_system()::text')),'42501');
select pg_temp.expect('non-admin: audit refused',pg_temp.err(pg_temp.as_scalar('emp','select public.app_audit_log()::text')),'42501');
select pg_temp.expect('backup recorder is not callable by the app',
  pg_temp.err(pg_temp.as_scalar('admin','select private.record_backup(''x'',1,null)::text')),'42501');
select pg_temp.expect('health is open to anon',(select public.app_health()::text),'true');

-- ── overview ──
select pg_temp.expect('people: active, inactive, never signed in, issued password, 7/30 days',
  pg_temp.as_scalar('admin',$q$select string_agg(v,'/' order by k) from jsonb_each_text(
    (public.app_admin_overview(current_date-30,current_date))->'people') e(k,v)$q$),
  '2/1/1/1/1/1');
select pg_temp.expect('requests by kind/status',pg_temp.as_scalar('admin',$q$select string_agg(x->>'kind'||'-'||(x->>'status')||'='||(x->>'count'),',')
    from jsonb_array_elements((public.app_admin_overview(current_date-30,current_date))->'requests') x$q$),
  'leave-approved=1,leave-rejected=1,errand-pending=1');
select pg_temp.expect('speed: median 6 h, p90 9.2 h over 2 decisions',pg_temp.as_scalar('admin',$q$select s->>'decided'||'/'||(s->>'median_hours')||'/'||(s->>'p90_hours')
    from (select (public.app_admin_overview(current_date-30,current_date))->'speed' s) x$q$),'2/6.0/9.2');
select pg_temp.expect('stuck: the 5-day pending errand',pg_temp.as_scalar('admin',$q$select string_agg((x->>'serial_seq')||'/'||(x->>'days_waiting'),',')
    from jsonb_array_elements((public.app_admin_overview(current_date-30,current_date))->'stuck') x
   where x->>'employee_name' like 'Fixture %'$q$),'980003/5');
select pg_temp.expect('leave by department: approved leave only',pg_temp.as_scalar('admin',$q$select string_agg((x->>'name_en')||'='||(x->>'minutes'),',')
    from jsonb_array_elements((public.app_admin_overview(current_date-30,current_date))->'leave_by_department') x$q$),
  'Fixture A=480');
select pg_temp.expect('bad range refused',pg_temp.err(pg_temp.as_scalar('admin',
  'select public.app_admin_overview(current_date,current_date-1)::text')),'22023');

-- ── system ──
select private.record_backup('daily-20261103T020000Z.dump',123456,'abc');
select pg_temp.expect('system: size, tables, backups',pg_temp.as_scalar('admin',$q$select ((s->>'database_bytes')::bigint>0)::text||'/'
    ||(jsonb_array_length(s->'tables')>0)::text||'/'||(s->'backups'->0->>'file_name')||'/'||(s ? 'migrations')::text||'/'||(s ? 'jobs')::text
    from public.app_admin_system() s$q$),'true/true/daily-20261103T020000Z.dump/true/true');

-- ── audit ──
select pg_temp.expect('audit: redacts signatures and passwords, trims long text',pg_temp.as_scalar('admin',$q$select
    (r->'after'->>'signature_data')||'/'||(r->'after'->>'new_password')||'/'||length(r->'after'->>'note')::text||'/'
    ||(r->'after'->>'api_key_changed')||'/'
    ||(r->>'actor_name')||'/'||(r->>'entity_label')
    from jsonb_array_elements((public.app_audit_log(null,null,null,null,'fixture_action'))->'rows') r$q$),
  '[hidden]/[hidden]/121/true/Fixture admin/Fixture emp');
select pg_temp.expect('audit: filters by actor and paginates',pg_temp.as_scalar('admin',format($q$select (l->>'total')||'/'||jsonb_array_length(l->'rows')
    from public.app_audit_log(null,null,%L,null,null,1,0) l$q$,pg_temp.fx('admin'))),'1/1');

\o
select 'admin-panel.sql: all assertions passed' as result;
rollback;
