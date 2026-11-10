-- Admin "View as" (FR-86, 2026-11-07): session table, PostgREST pre-request hook and RPCs.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table va_fx(k text primary key,id uuid not null);
grant select on va_fx to authenticated, anon;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from va_fx where k=p_key;
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
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;

-- Runs the hook the way PostgREST does (claims, headers, role, then the hook), then p_sql, and
-- always rolls the block back so neither the hook's set_config nor p_sql's effects leak.
-- p_key null = anon (no sub). The claims carry app_roles/app_perms like a real token.
create function pg_temp.hooked(p_key text,p_header text,p_sql text) returns text language plpgsql as $$
declare v_result text; v_done boolean:=false;
begin
  perform set_config('request.jwt.claims',case when p_key is null then '{"role":"anon"}'
    else jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated',
      'app_roles',jsonb_build_array('admin'),'app_perms',jsonb_build_object('people','edit'))::text end,true);
  perform set_config('request.headers',case when p_header is null then '{}'
    else jsonb_build_object('x-view-as',p_header)::text end,true);
  begin
    execute format('set local role %I',case when p_key is null then 'anon' else 'authenticated' end);
    perform private.view_as_pre_request();
    execute p_sql into v_result;
    v_done:=true;
    raise exception 'hooked rollback' using errcode='P0001';
  exception when others then
    if not v_done then v_result:='ERROR '||sqlstate||' '||sqlerrm; end if;
  end;
  perform set_config('request.headers','',true);
  return v_result;
end; $$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid();
        v_other uuid:=gen_random_uuid(); v_odept uuid:=gen_random_uuid(); who record;
begin
  insert into public.companies(id,name) values(v_company,'View as synthetic fixture'),(v_other,'View as other company');
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','VA'),(v_odept,v_other,'دیگر','Other HQ','office','VO');
  for who in select * from (values
    ('admin','admin','9990019201',true,v_company,v_dept),
    ('emp','employee','9990019202',true,v_company,v_dept),
    ('other_admin','admin','9990019203',true,v_company,v_dept),
    ('inactive','employee','9990019204',false,v_company,v_dept),
    ('foreign','employee','9990019205',true,v_other,v_odept)) t(k,role,code,active,company,dept) loop
    insert into va_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@view-as-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password,active)
      values(pg_temp.fx(who.k),who.company,who.dept,who.code,who.code,'Fixture '||who.k,false,who.active);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
end; $$;

create function pg_temp.start(p_actor text,p_target text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format('select session_id::text from public.app_view_as_start(%L)',pg_temp.fx(p_target)));
$$;
-- A session row written directly, for the states start never leaves behind.
create function pg_temp.session_row(p_key text,p_admin text,p_target text,p_expires timestamptz,p_ended timestamptz)
returns void language sql as $$
  with s as (insert into private.view_as_sessions(admin_id,target_id,expires_at,ended_at)
             values(pg_temp.fx(p_admin),pg_temp.fx(p_target),p_expires,p_ended) returning id)
  insert into va_fx select p_key,id from s;
$$;
create function pg_temp.session_count(p_caller text,p_session text) returns text language sql as $$
  select pg_temp.as_scalar(p_caller,format('select count(*)::text from public.app_view_as_session(%L)',pg_temp.fx(p_session)));
$$;
create function pg_temp.refused(p_label text,p_caller text,p_header text) returns void language sql as $$
  select pg_temp.expect('hook refused (PT403): '||p_label,
    pg_temp.hooked(p_caller,p_header,'select auth.uid()::text'),'ERROR PT403 view-as refused');
$$;

-- start
select pg_temp.expect('start: emp returns a session, expires_at about now()+30 min',
  pg_temp.as_scalar('admin',format(
    'select (session_id is not null and abs(extract(epoch from expires_at-(now()+interval ''30 minutes'')))<60)::text
       from public.app_view_as_start(%L)',pg_temp.fx('emp'))),'true');
insert into va_fx select 's1',id from private.view_as_sessions where admin_id=pg_temp.fx('admin');
select pg_temp.expect('start: row holds admin, target, live',
  (select (target_id=pg_temp.fx('emp') and ended_at is null)::text from private.view_as_sessions where id=pg_temp.fx('s1')),'true');
select pg_temp.expect('start: audit row view_as.start, actor admin, entity profiles, entity_id emp',
  (select count(*)::text from public.audit_log where action='view_as.start' and actor_id=pg_temp.fx('admin')
      and entity='profiles' and entity_id=pg_temp.fx('emp')),'1');

select pg_temp.expect('start refused: non-admin caller',pg_temp.err(pg_temp.start('emp','admin')),'42501');
select pg_temp.expect('start refused: self',pg_temp.err(pg_temp.start('admin','admin')),'22023');
select pg_temp.expect('start refused: inactive target',pg_temp.err(pg_temp.start('admin','inactive')),'22023');
select pg_temp.expect('start refused: foreign target',pg_temp.err(pg_temp.start('admin','foreign')),'22023');
select pg_temp.expect('start refused: unknown target',
  pg_temp.err(pg_temp.as_scalar('admin',format('select session_id::text from public.app_view_as_start(%L)',gen_random_uuid()))),'22023');
select pg_temp.expect('start refused: only one session row so far',
  (select count(*)::text from private.view_as_sessions where admin_id=pg_temp.fx('admin')),'1');

select pg_temp.session_row('old_ended','admin','emp',now()+interval '10 minutes',now()-interval '1 hour');
select pg_temp.session_row('old_expired','admin','emp',now()-interval '1 minute',null);
select pg_temp.expect('start twice: second start succeeds',pg_temp.err(pg_temp.start('admin','emp')),'ok');
insert into va_fx select 's2',id from private.view_as_sessions
  where admin_id=pg_temp.fx('admin') and ended_at is null and expires_at>now();
select pg_temp.expect('start twice: first session ended_at set, exactly one live row for admin',
  (select (s1.ended_at is not null)::text||'/'||(select count(*) from private.view_as_sessions
      where admin_id=pg_temp.fx('admin') and ended_at is null)
     from private.view_as_sessions s1 where s1.id=pg_temp.fx('s1')),'true/1');
select pg_temp.expect('start twice: the replaced session gets a view_as.end audit row',
  (select count(*)::text from public.audit_log where action='view_as.end' and actor_id=pg_temp.fx('admin')
      and entity='profiles' and entity_id=pg_temp.fx('emp') and after->>'session_id'=pg_temp.fx('s1')::text),'1');
select pg_temp.expect('start deletes the admin''s older ended and expired rows',
  (select count(*)::text from private.view_as_sessions where id in (pg_temp.fx('old_ended'),pg_temp.fx('old_expired'))),'0');

-- end
select pg_temp.expect('end: runs',pg_temp.as_scalar('admin','select public.app_view_as_end()::text'),'');
select pg_temp.expect('end: ended_at set, audit row view_as.end',
  (select (ended_at is not null)::text from private.view_as_sessions where id=pg_temp.fx('s2'))||'/'||
  (select count(*) from public.audit_log where action='view_as.end' and actor_id=pg_temp.fx('admin')
      and entity='profiles' and entity_id=pg_temp.fx('emp') and after->>'session_id'=pg_temp.fx('s2')::text),'true/1');
select pg_temp.expect('end: nothing live left, a second end writes no audit row',
  pg_temp.as_scalar('admin','select public.app_view_as_end()::text')||'/'||
  (select count(*) from public.audit_log where action='view_as.end' and actor_id=pg_temp.fx('admin')),'/2');

-- session
select pg_temp.expect('start live session',pg_temp.err(pg_temp.start('admin','emp')),'ok');
insert into va_fx select 'live',id from private.view_as_sessions
  where admin_id=pg_temp.fx('admin') and ended_at is null and expires_at>now();
select pg_temp.expect('session: live returns emp + name + personnel_no + expires_at',
  pg_temp.as_scalar('admin',format('select target_id||''|''||target_name||''|''||personnel_no||''|''||expires_at
     from public.app_view_as_session(%L)',pg_temp.fx('live'))),
  (select pg_temp.fx('emp')||'|Fixture emp|9990019202|'||expires_at from private.view_as_sessions where id=pg_temp.fx('live')));
select pg_temp.session_row('oa','other_admin','emp',now()+interval '30 minutes',null);
select pg_temp.session_row('expired','admin','emp',now()-interval '1 minute',null);
select pg_temp.session_row('inact','admin','inactive',now()+interval '30 minutes',null);
select pg_temp.expect('session empty: other admin''s session',pg_temp.session_count('admin','oa'),'0');
select pg_temp.expect('session empty: ended',pg_temp.session_count('admin','s2'),'0');
select pg_temp.expect('session empty: expired',pg_temp.session_count('admin','expired'),'0');
select pg_temp.expect('session empty: target now inactive',pg_temp.session_count('admin','inact'),'0');
select pg_temp.expect('session empty: emp as caller',pg_temp.session_count('emp','live'),'0');

-- hook
select pg_temp.expect('hook no header: auth.uid() stays admin, transaction_read_only off',
  pg_temp.hooked('admin',null,'select auth.uid()||''/''||current_setting(''transaction_read_only'')'),
  pg_temp.fx('admin')||'/off');
select pg_temp.expect('hook swap: select auth.uid() = emp',
  pg_temp.hooked('admin',pg_temp.fx('live')::text,format('select (auth.uid()=%L)::text',pg_temp.fx('emp'))),'true');
select pg_temp.expect('hook claims: request.jwt.claims has no app_roles and no app_perms',
  pg_temp.hooked('admin',pg_temp.fx('live')::text,
    'select (current_setting(''request.jwt.claims'')::jsonb ?| array[''app_roles'',''app_perms''])::text
       ||''/''||(current_setting(''request.jwt.claims'')::jsonb->>''role'')'),'false/authenticated');
select pg_temp.expect('hook claims: without the header they stay',
  pg_temp.hooked('admin',null,'select (current_setting(''request.jwt.claims'')::jsonb ?& array[''app_roles'',''app_perms''])::text'),'true');
select pg_temp.expect('hook read-only: probe returns (emp, on)',
  pg_temp.hooked('admin',pg_temp.fx('live')::text,'select uid||''/''||read_only from public.app_view_as_probe()'),
  pg_temp.fx('emp')||'/on');
select pg_temp.assert('probe is volatile, so PostgREST runs it read-write unless the hook locked it',
  (select provolatile='v' and prosecdef from pg_proc where oid='public.app_view_as_probe()'::regprocedure));
select pg_temp.expect('probe as admin outside the hook, fresh transaction state: (admin, off)',
  pg_temp.as_scalar('admin','select uid||''/''||read_only from public.app_view_as_probe()'),
  pg_temp.fx('admin')||'/off');
select pg_temp.expect('probe without the header: (admin, off)',
  pg_temp.hooked('admin',null,'select uid||''/''||read_only from public.app_view_as_probe()'),
  pg_temp.fx('admin')||'/off');
select pg_temp.expect('hook write: update public.profiles -> ERROR 25006',
  pg_temp.err(pg_temp.hooked('admin',pg_temp.fx('live')::text,
    format('update public.profiles set language_pref=''en'' where id=%L returning id::text',pg_temp.fx('emp')))),'25006');
create function pg_temp.photo_sql() returns text language sql as $$
  select format('select public.app_set_profile_photo(%L,%L)::text',pg_temp.fx('emp'),
    'data:image/jpeg;base64,/9j/'||repeat('A',996));
$$;
select pg_temp.expect('control: emp''s own photo write works without the header',
  pg_temp.err(pg_temp.hooked('emp',null,pg_temp.photo_sql())),'ok');
select pg_temp.expect('hook write: a volatile RPC that writes -> ERROR 25006',
  pg_temp.err(pg_temp.hooked('admin',pg_temp.fx('live')::text,pg_temp.photo_sql())),'25006');
select set_config('request.jwt.claim.sub',pg_temp.fx('admin')::text,true);
select pg_temp.expect('hook legacy claim: a pre-set request.jwt.claim.sub = admin still yields auth.uid() = target',
  pg_temp.hooked('admin',pg_temp.fx('live')::text,
    format('select (auth.uid()=%L)::text||''/''||current_setting(''request.jwt.claim.sub'')',pg_temp.fx('emp'))),
  'true/'||pg_temp.fx('emp'));
select set_config('request.jwt.claim.sub','',true);

select pg_temp.refused('garbage id','admin','not-a-uuid');
select pg_temp.refused('uuid with trailing text','admin',pg_temp.fx('live')::text||'x');
select pg_temp.refused('empty header','admin','');
select pg_temp.refused('unknown id','admin',gen_random_uuid()::text);
select pg_temp.refused('expired','admin',pg_temp.fx('expired')::text);
select pg_temp.refused('ended','admin',pg_temp.fx('s2')::text);
select pg_temp.refused('inactive target','admin',pg_temp.fx('inact')::text);
select pg_temp.refused('caller emp with the live id','emp',pg_temp.fx('live')::text);
select pg_temp.refused('other admin with admin''s live id','other_admin',pg_temp.fx('live')::text);
select pg_temp.expect('control: other admin''s own session swaps while they hold admin',
  pg_temp.hooked('other_admin',pg_temp.fx('oa')::text,format('select (auth.uid()=%L)::text',pg_temp.fx('emp'))),'true');
select pg_temp.session_row('as_admin','admin','other_admin',now()+interval '30 minutes',null);
select pg_temp.expect('control: viewing as another admin swaps',
  pg_temp.hooked('admin',pg_temp.fx('as_admin')::text,format('select (auth.uid()=%L)::text',pg_temp.fx('other_admin'))),'true');
select pg_temp.assert('nested: viewing as another admin, app_view_as_start -> refused',
  pg_temp.err(pg_temp.hooked('admin',pg_temp.fx('as_admin')::text,
    format('select session_id::text from public.app_view_as_start(%L)',pg_temp.fx('emp')))) in ('25006','42501'));
delete from public.user_roles where user_id=pg_temp.fx('other_admin') and role='admin';
select pg_temp.refused('caller who lost the admin role','other_admin',pg_temp.fx('oa')::text);

select pg_temp.expect('hook anon: no sub in claims, header present -> no error, auth.uid() null',
  pg_temp.hooked(null,pg_temp.fx('live')::text,'select coalesce(auth.uid()::text,''null'')'),'null');
select pg_temp.expect('hook anon: garbage header also ignored',
  pg_temp.hooked(null,'not-a-uuid','select coalesce(auth.uid()::text,''null'')'),'null');
select pg_temp.expect('nested: through the hook, app_view_as_start -> refused (identity is emp)',
  pg_temp.err(pg_temp.hooked('admin',pg_temp.fx('live')::text,
    format('select session_id::text from public.app_view_as_start(%L)',pg_temp.fx('other_admin')))),'42501');
select pg_temp.expect('hook leaves nothing behind: claims and read-only back to admin',
  pg_temp.as_scalar('admin','select auth.uid()||''/''||current_setting(''transaction_read_only'')'),
  pg_temp.fx('admin')||'/off');

-- grants
select pg_temp.assert('grants: hook runs for anon, authenticated, service_role, not public',
  has_function_privilege('anon','private.view_as_pre_request()','EXECUTE')
  and has_function_privilege('authenticated','private.view_as_pre_request()','EXECUTE')
  and has_function_privilege('service_role','private.view_as_pre_request()','EXECUTE')
  and has_schema_privilege('anon','private','USAGE') and has_schema_privilege('service_role','private','USAGE')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid='private.view_as_pre_request()'::regprocedure and a.grantee=0));
select pg_temp.assert('grants: session RPCs for authenticated only',
  has_function_privilege('authenticated','public.app_view_as_start(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.app_view_as_end()','EXECUTE')
  and has_function_privilege('authenticated','public.app_view_as_session(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.app_view_as_start(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.app_view_as_end()','EXECUTE')
  and not has_function_privilege('anon','public.app_view_as_session(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.app_view_as_probe()','EXECUTE'));
select pg_temp.assert('grants: the session table is closed to API roles, RLS on',
  not has_table_privilege('anon','private.view_as_sessions','SELECT')
  and not has_table_privilege('authenticated','private.view_as_sessions','SELECT')
  and not has_table_privilege('authenticated','private.view_as_sessions','INSERT')
  and not has_table_privilege('service_role','private.view_as_sessions','SELECT')
  and (select relrowsecurity from pg_class where oid='private.view_as_sessions'::regclass));
rollback;
