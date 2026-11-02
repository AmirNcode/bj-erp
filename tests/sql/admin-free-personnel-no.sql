-- Admin-entered personnel numbers (owner, 2026-11-02): only the admin may give someone a
-- personnel number that is not 1-10 digits (security staff are a subcontractor, with none).
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
select pg_temp.expect('admin: symbols',private.valid_personnel_no('SEC-001#',true)::text,'true');
select pg_temp.expect('admin: Persian and spaces',private.valid_personnel_no('حراست ۱',true)::text,'true');
select pg_temp.expect('admin: blank',private.valid_personnel_no('',true)::text,'false');
select pg_temp.expect('admin: untrimmed',private.valid_personnel_no(' a',true)::text,'false');
select pg_temp.expect('admin: 65 chars',private.valid_personnel_no(repeat('a',65),true)::text,'false');
select pg_temp.expect('others: digits',private.valid_personnel_no('1042',false)::text,'true');
select pg_temp.expect('others: letters',private.valid_personnel_no('SEC001',false)::text,'false');

-- Create.
do $$ begin
  insert into lc_fx values('sec1',pg_temp.create('admin','SEC001',null)::uuid);
  insert into lc_fx values('sec2',pg_temp.create('admin','حراست ۲','guard2')::uuid);
end $$;
select pg_temp.expect('letters kept',(select personnel_no from public.profiles where id=pg_temp.fx('sec1')),'SEC001');
select pg_temp.expect('code = number',(select employee_code from public.profiles where id=pg_temp.fx('sec1')),'SEC001');
select pg_temp.expect('auth email lower-cased',(select email from auth.users where id=pg_temp.fx('sec1')),'sec001@bj-app.internal');
select pg_temp.expect('identity email lower-cased',(select identity_data->>'email' from auth.identities where user_id=pg_temp.fx('sec1')),'sec001@bj-app.internal');
select pg_temp.expect('Persian number kept',(select personnel_no from public.profiles where id=pg_temp.fx('sec2')),'حراست ۲');
select pg_temp.expect('with its login code',(select employee_code from public.profiles where id=pg_temp.fx('sec2')),'guard2');
select pg_temp.expect('no usable code: refused',pg_temp.as_scalar('admin',format(
  'select public.app_create_employee(p_personnel_no=>%L,p_full_name=>''x'',p_password=>''Fixture!2026'',p_company_id=>%L,p_department_id=>%L)::text',
  'SEC 3',pg_temp.fx('company'),pg_temp.fx('dept'))),'ERROR 22023 login code required');
select pg_temp.expect('code clash in another case',pg_temp.err(pg_temp.create('admin','sec001',null)),'23505');
select pg_temp.expect('HR still digits only',pg_temp.err(pg_temp.create('hrp','SEC004',null)),'22023');
select pg_temp.expect('a refused create leaves no account',
  (select count(*)::text from public.profiles where personnel_no in ('SEC 3','sec001','SEC004')),'0');

-- Personnel number change.
select pg_temp.expect('admin sets letters',pg_temp.set_pno('admin',pg_temp.fx('emp'),'G-7'),'ok');
select pg_temp.expect('code follows a usable number',(select employee_code from public.profiles where id=pg_temp.fx('emp')),'G-7');
select pg_temp.expect('admin sets one with a space',pg_temp.set_pno('admin',pg_temp.fx('emp'),'G 8'),'ok');
select pg_temp.expect('number changed',(select personnel_no from public.profiles where id=pg_temp.fx('emp')),'G 8');
select pg_temp.expect('code kept when the number cannot be one',(select employee_code from public.profiles where id=pg_temp.fx('emp')),'G-7');
select pg_temp.expect('old digits-only check gone',
  (select count(*)::text from pg_constraint where conname='profiles_personnel_no_format'
     and pg_get_constraintdef(oid) like '%[0-9]%'),'0');

rollback;
