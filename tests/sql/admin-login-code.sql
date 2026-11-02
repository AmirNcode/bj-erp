-- Admin login codes (owner, 2026-11-02): the admin may give a new employee any login code
-- (no spaces or @), and changing someone's personnel number makes it their login code.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table lc_fx(k text primary key,id uuid not null);
grant select on lc_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from lc_fx where k=p_key;
$$;
create function pg_temp.as_scalar(p_key text,p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
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
-- Create an employee as p_actor with personnel number p_pno and login code p_code.
create function pg_temp.create(p_actor text,p_pno text,p_code text) returns text language sql as $$
  select pg_temp.as_scalar(p_actor,format(
    'select public.app_create_employee(p_personnel_no=>%L,p_full_name=>''Fixture new'',p_password=>''Fixture!2026'',p_company_id=>%L,p_department_id=>%L,p_login_code=>%L)::text',
    p_pno,pg_temp.fx('company'),pg_temp.fx('dept'),p_code));
$$;
create function pg_temp.set_pno(p_actor text,p_who uuid,p_pno text) returns text language sql as $$
  select pg_temp.err(pg_temp.as_scalar(p_actor,format('select public.app_admin_set_personnel_no(%L,%L)::text',p_who,p_pno)));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); who record;
begin
  insert into public.companies(id,name) values(v_company,'Login code synthetic fixture');
  insert into lc_fx values('company',v_company),('dept',v_dept);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_dept,v_company,'الف','Fixture A','office','LCA');
  for who in select * from (values
    ('admin','admin','9990075001'),('hrp','hr','9990075002'),('emp','employee','9990075003')) t(k,role,code) loop
    insert into lc_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@bj-app.internal');
    insert into auth.identities(provider_id,user_id,identity_data,provider)
      values(pg_temp.fx(who.k)::text,pg_temp.fx(who.k),jsonb_build_object('sub',pg_temp.fx(who.k)::text,'email',who.code||'@bj-app.internal'),'email');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
end $$;

-- Validation (pure).
select pg_temp.expect('symbols are a valid code',private.valid_login_code('Ali.R-1!#$%&''*+/=?^_`{|}~')::text,'true');
select pg_temp.expect('space rejected',private.valid_login_code('a b')::text,'false');
select pg_temp.expect('@ rejected',private.valid_login_code('a@b')::text,'false');
select pg_temp.expect('leading dot rejected',private.valid_login_code('.ab')::text,'false');
select pg_temp.expect('double dot rejected',private.valid_login_code('a..b')::text,'false');
select pg_temp.expect('non-ASCII rejected',private.valid_login_code('علی')::text,'false');
select pg_temp.expect('65 chars rejected',private.valid_login_code(repeat('a',65))::text,'false');

-- Create with a custom code.
do $$ begin
  insert into lc_fx values('new1',pg_temp.create('admin','9990075010','Test.User!1')::uuid);
  insert into lc_fx values('new2',pg_temp.create('admin','9990075011',null)::uuid);
  -- A login code that looks like a personnel number nobody holds.
  insert into lc_fx values('new3',pg_temp.create('admin','9990075041','9990075040')::uuid);
end $$;
select pg_temp.expect('custom code stored',(select employee_code from public.profiles where id=pg_temp.fx('new1')),'Test.User!1');
select pg_temp.expect('personnel number kept',(select personnel_no from public.profiles where id=pg_temp.fx('new1')),'9990075010');
select pg_temp.expect('auth email lower-cased',(select email from auth.users where id=pg_temp.fx('new1')),'test.user!1@bj-app.internal');
select pg_temp.expect('identity email follows',(select identity_data->>'email' from auth.identities where user_id=pg_temp.fx('new1')),'test.user!1@bj-app.internal');
select pg_temp.expect('no code = personnel number',(select employee_code from public.profiles where id=pg_temp.fx('new2')),'9990075011');
select pg_temp.expect('duplicate code, other case',pg_temp.err(pg_temp.create('admin','9990075012','TEST.user!1')),'23505');
select pg_temp.expect('invalid code refused',pg_temp.err(pg_temp.create('admin','9990075013','a b')),'22023');
select pg_temp.expect('HR may not pick a code',pg_temp.err(pg_temp.create('hrp','9990075014','hr-pick')),'42501');
select pg_temp.expect('HR still creates without one',pg_temp.err(pg_temp.create('hrp','9990075015',null)),'ok');
select pg_temp.expect('a refused create leaves no account',
  (select count(*)::text from public.profiles where personnel_no in ('9990075012','9990075013','9990075014')),'0');

-- Personnel number change.
select pg_temp.expect('HR may not change a personnel number',pg_temp.set_pno('hrp',pg_temp.fx('emp'),'9990075020'),'42501');
select pg_temp.expect('employee may not either',pg_temp.set_pno('emp',pg_temp.fx('emp'),'9990075020'),'42501');
select pg_temp.expect('digits only',pg_temp.set_pno('admin',pg_temp.fx('emp'),'12a'),'22023');
select pg_temp.expect('taken number refused',pg_temp.set_pno('admin',pg_temp.fx('emp'),'9990075002'),'23505');
select pg_temp.expect('admin changes it',pg_temp.set_pno('admin',pg_temp.fx('emp'),'9990075020'),'ok');
select pg_temp.expect('number changed',(select personnel_no from public.profiles where id=pg_temp.fx('emp')),'9990075020');
select pg_temp.expect('code follows',(select employee_code from public.profiles where id=pg_temp.fx('emp')),'9990075020');
select pg_temp.expect('auth email follows',(select email from auth.users where id=pg_temp.fx('emp')),'9990075020@bj-app.internal');
select pg_temp.expect('custom code replaced by the new number',pg_temp.set_pno('admin',pg_temp.fx('new1'),'9990075021'),'ok');
select pg_temp.expect('new1 code',(select employee_code from public.profiles where id=pg_temp.fx('new1')),'9990075021');
select pg_temp.expect('a number equal to someone''s custom code is refused',
  pg_temp.set_pno('admin',pg_temp.fx('emp'),'9990075040'),'23505');
select pg_temp.expect('another company is not found',
  pg_temp.set_pno('admin',(select id from public.profiles where company_id<>pg_temp.fx('company') limit 1),'9990075030'),'P0002');
select pg_temp.expect('audited',(select count(*)::text from public.audit_log
  where entity_id=pg_temp.fx('emp') and action in ('set_personnel_no','set_login_code')),'2');

rollback;
