-- Admin panel v2 (FR-79 sign-ins + force sign-out, FR-80 password rule, FR-77 v2: audit by person,
-- off-server copies). Owner 2026-11-03/04; spec docs/specs/2026-11-03-admin-panel-v2-design.md.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table v2_fx(k text primary key,id uuid not null);
grant select on v2_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from v2_fx where k=p_key;
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
  insert into public.companies(id,name) values(v_company,'Admin panel v2 synthetic fixture');
  insert into v2_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture V2','office','V2A');
  for who in select * from (values
    ('admin',array['admin'],'9990081001'),
    ('hr',array['hr','employee'],'9990081002'),
    ('emp',array['employee'],'9990081003'),
    ('emp2',array['employee'],'9990081004')) t(k,roles,code) loop
    insert into v2_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@v2-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,active)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,true);
    insert into public.user_roles(user_id,role) select pg_temp.fx(who.k),r::public.app_role from unnest(who.roles) r;
  end loop;
  insert into public.work_settings(company_id,weekend_days,work_start,work_end) values(v_company,'{}','07:00','15:00');
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_type;
  insert into v2_fx values('req',gen_random_uuid());
  insert into public.leave_requests(id,employee_id,company_id,leave_type_id,kind,errand_location,start_date,end_date,requested_minutes,status,serial_year,serial_seq)
    values(pg_temp.fx('req'),pg_temp.fx('emp'),v_company,v_type,'leave',null,current_date+40,current_date+40,480,'pending',1,981001);
  -- Audit rows about emp: by entity_id, by a JSON key, by request; one unrelated row.
  insert into public.audit_log(actor_id,action,entity,entity_id,before,after) values
    (pg_temp.fx('hr'),'v2_fixture','profiles',pg_temp.fx('emp'),null,jsonb_build_object('full_name','x')),
    (pg_temp.fx('hr'),'v2_fixture','leave_ledger',gen_random_uuid(),null,jsonb_build_object('employee_id',pg_temp.fx('emp'))),
    (pg_temp.fx('admin'),'v2_fixture','leave_requests',pg_temp.fx('req'),null,jsonb_build_object('status','pending')),
    (pg_temp.fx('admin'),'v2_fixture','departments',v_a,null,jsonb_build_object('name_en','Fixture V2'));
end; $$;

create function pg_temp.sessions(p_key text,p_n int) returns void language sql as $$
  insert into auth.sessions(id,user_id,created_at,updated_at)
  select gen_random_uuid(),pg_temp.fx(p_key),now()-interval '1 hour',now() from generate_series(1,p_n);
$$;
create function pg_temp.count_sessions(p_key text) returns text language sql as $$
  select count(*)::text from auth.sessions where user_id=pg_temp.fx(p_key);
$$;

create function pg_temp.pw(p text) returns text language plpgsql as $$
begin perform private.assert_password_ok(p); return 'ok';
exception when others then return sqlerrm; end; $$;

-- ── FR-80 password rule ──
select pg_temp.expect('rule: too short',pg_temp.pw('a1!'),'new password must be at least 8 characters');
select pg_temp.expect('rule: too long',pg_temp.pw(repeat('a1!',25)),'new password must be at most 72 ASCII characters');
select pg_temp.expect('rule: needs a digit',pg_temp.pw('abcdefg!'),'new password must contain a digit');
select pg_temp.expect('rule: needs a special character',pg_temp.pw('abcdefg1'),'new password must contain a special character');
select pg_temp.expect('rule: a space is not special',pg_temp.pw('abcdef 1'),'new password must contain a special character');
select pg_temp.expect('rule: backslash, quote and backtick count',
  pg_temp.pw('abcdef1\')||'/'||pg_temp.pw('abcdef1''')||'/'||pg_temp.pw('abcdef1`'),'ok/ok/ok');
select pg_temp.expect('rule: 8 chars with digit and symbol',pg_temp.pw('Temp!2026x'),'ok');
select pg_temp.expect('reset refuses a password without a symbol',pg_temp.as_scalar('admin',format(
  'select public.app_set_employee_password(%L,%L)::text',pg_temp.fx('emp2'),'Temp2026xx')),
  'ERROR 22023 new password must contain a special character');

-- ── audit log by person (before any sign-out rows exist) ──
select pg_temp.expect('audit about emp: entity id, JSON key, own request; not the department',
  pg_temp.as_scalar('admin',format($q$select (l->>'total')||'/'||(select string_agg(r->>'entity',',' order by r->>'entity')
      from jsonb_array_elements(l->'rows') r)||'/'||(l->'rows'->0->>'about_name')
    from public.app_audit_log(null,null,null,null,'v2_fixture',50,0,%L) l$q$,pg_temp.fx('emp'))),
  '3/leave_ledger,leave_requests,profiles/Fixture emp');
select pg_temp.expect('audit: actor and target together',pg_temp.as_scalar('admin',format($q$select l->>'total'
    from public.app_audit_log(null,null,%L,null,'v2_fixture',50,0,%L) l$q$,pg_temp.fx('hr'),pg_temp.fx('emp'))),'2');
select pg_temp.expect('audit: department row is about nobody',pg_temp.as_scalar('admin',$q$select coalesce(r->>'about_id','none')
    from jsonb_array_elements((public.app_audit_log(null,null,null,'departments','v2_fixture'))->'rows') r$q$),'none');
select pg_temp.expect('audit: non-admin refused',pg_temp.err(pg_temp.as_scalar('hr','select public.app_audit_log()::text')),'42501');

-- ── FR-79 sign-ins and sign-out ──
select pg_temp.sessions('emp',2); select pg_temp.sessions('hr',1); select pg_temp.sessions('admin',1);
insert into auth.audit_log_entries(id,payload,created_at) values
  (gen_random_uuid(),json_build_object('action','login','actor_id',pg_temp.fx('emp')),now()-interval '5 minutes'),
  (gen_random_uuid(),json_build_object('action','token_refreshed','actor_id',pg_temp.fx('emp')),now()-interval '4 minutes');
select pg_temp.expect('sign-ins: non-admin refused',pg_temp.err(pg_temp.as_scalar('hr','select public.app_admin_sign_ins()::text')),'42501');
select pg_temp.expect('sign-ins: logins only, devices per person',pg_temp.as_scalar('admin',$q$select
    (select string_agg(x->>'full_name',',') from jsonb_array_elements(s->'logins') x where x->>'full_name' like 'Fixture %')||'/'||
    (select string_agg((x->>'full_name')||'='||(x->>'devices'),',' order by x->>'full_name')
       from jsonb_array_elements(s->'sessions') x where x->>'full_name' like 'Fixture %')
    from public.app_admin_sign_ins() s$q$),'Fixture emp/Fixture admin=1,Fixture emp=2,Fixture hr=1');
select pg_temp.expect('revoke: non-admin refused',pg_temp.err(pg_temp.as_scalar('hr',format(
  'select public.app_revoke_sessions(%L)::text',pg_temp.fx('emp')))),'42501');
select pg_temp.expect('revoke: not yourself',pg_temp.err(pg_temp.as_scalar('admin',format(
  'select public.app_revoke_sessions(%L)::text',pg_temp.fx('admin')))),'22023');
select pg_temp.expect('revoke: removes both devices',pg_temp.as_scalar('admin',format(
  'select public.app_revoke_sessions(%L)::text',pg_temp.fx('emp')))||'/'||pg_temp.count_sessions('emp'),'2/0');
select pg_temp.expect('revoke: audited',(select (after->>'sessions')||'/'||(after->>'reason') from public.audit_log
  where action='sessions.revoke' and entity_id=pg_temp.fx('emp')),'2/admin');
select pg_temp.expect('revoke: another company''s person not found',pg_temp.err(pg_temp.as_scalar('admin',
  'select public.app_revoke_sessions(gen_random_uuid())::text')),'P0002');

select pg_temp.sessions('emp2',1);
select pg_temp.expect('password reset signs out',pg_temp.as_scalar('admin',format(
  'select public.app_set_employee_password(%L,%L)::text',pg_temp.fx('emp2'),'Temp!2026x'))||'/'||pg_temp.count_sessions('emp2'),'/0');
select pg_temp.expect('password reset: reason recorded',(select after->>'reason' from public.audit_log
  where action='sessions.revoke' and entity_id=pg_temp.fx('emp2')),'password_reset');

select pg_temp.sessions('emp2',1);
select pg_temp.expect('bulk reset signs out',pg_temp.as_scalar('admin',format(
  'select public.app_bulk_set_employee_passwords(%L)::text',
  jsonb_build_array(jsonb_build_object('user_id',pg_temp.fx('emp2'),'password','Bulk!2026x'))))||'/'||pg_temp.count_sessions('emp2'),'/0');
select pg_temp.expect('bulk reset refuses a password without a digit',pg_temp.as_scalar('admin',format(
  'select public.app_bulk_set_employee_passwords(%L)::text',
  jsonb_build_array(jsonb_build_object('user_id',pg_temp.fx('emp2'),'password','Bulk!abcd')))),
  'ERROR 22023 new password must contain a digit');

select pg_temp.login('admin');
update public.profiles set active=false where id=pg_temp.fx('hr');
select pg_temp.expect('deactivation signs out',pg_temp.count_sessions('hr')||'/'||(select after->>'reason' from public.audit_log
  where action='sessions.revoke' and entity_id=pg_temp.fx('hr')),'0/deactivated');
update public.profiles set active=true where id=pg_temp.fx('hr');

select pg_temp.sessions('emp',1); select pg_temp.sessions('hr',2);
select pg_temp.expect('sign out everyone: fixture people gone, admin kept',(select pg_temp.as_scalar('admin',
  'select public.app_revoke_all_sessions()::text') is not null)::text||'/'||pg_temp.count_sessions('emp')||'/'||
  pg_temp.count_sessions('hr')||'/'||pg_temp.count_sessions('admin'),'true/0/0/1');
select pg_temp.expect('sign out everyone: non-admin refused',pg_temp.err(pg_temp.as_scalar('hr',
  'select public.app_revoke_all_sessions()::text')),'42501');

-- ── off-server copies ──
select private.record_backup('daily-20261101T020000Z.dump',100,repeat('a',64));
select private.record_backup('daily-20261102T020000Z.dump',100,repeat('b',64));
select private.record_backup('daily-20261103T020000Z.dump',100,repeat('c',64));
update private.backup_runs set finished_at=now()-interval '3 days' where file_name='daily-20261101T020000Z.dump';
update private.backup_runs set finished_at=now()-interval '2 days' where file_name='daily-20261102T020000Z.dump';
select pg_temp.expect('offsite: recorder is not callable by the app',pg_temp.err(pg_temp.as_scalar('admin',
  $q$select private.record_offsite_copies(array['x'])::text$q$)),'42501');
create function pg_temp.offsite(p text[]) returns text language plpgsql as $$
begin return private.record_offsite_copies(p)::text; exception when others then return 'ERROR '||sqlstate; end; $$;
select pg_temp.expect('offsite: bad entry refused',pg_temp.offsite(array['../etc/passwd:'||repeat('a',64)]),'ERROR 22023');
select pg_temp.expect('offsite: one copy, one wrong hash',pg_temp.offsite(array[
  'daily-20261101T020000Z.dump:'||repeat('a',64),'daily-20261102T020000Z.dump:'||repeat('f',64)]),'2');
select pg_temp.expect('system: offsite last report, missing and mismatched',pg_temp.as_scalar('admin',$q$select
    ((o->>'last_report') is not null)::text||'/'||(o->>'newest_file')||'/'||(o->'missing')::text||'/'||(o->'mismatched')::text
    from (select public.app_admin_system()->'offsite' o) x$q$),
  'true/daily-20261102T020000Z.dump/[]/["daily-20261102T020000Z.dump"]');
select pg_temp.expect('offsite: a re-report keeps one row per file',pg_temp.offsite(array[
  'daily-20261101T020000Z.dump:'||repeat('a',64)])||'/'||(select count(*) from private.offsite_copies
  where file_name='daily-20261101T020000Z.dump')::text,'1/1');
delete from private.offsite_copies where file_name='daily-20261101T020000Z.dump';
select pg_temp.expect('system: a dump older than 36 h that never arrived is missing',(pg_temp.as_scalar('admin',$q$select
    (public.app_admin_system()->'offsite'->'missing')::text$q$) like '%daily-20261101T020000Z.dump%')::text,'true');

\o
select 'admin-panel-v2.sql: all assertions passed' as result;
rollback;
