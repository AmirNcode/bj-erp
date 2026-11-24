-- Own text size (profiles.font_step, 0..4): the person themself or the admin changes it; a people-edit
-- holder editing someone else may not; the CHECK bounds the range.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table fs_fx(k text primary key,id uuid not null);
grant select on fs_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from fs_fx where k=p_key;
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
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); who record;
begin
  insert into public.companies(id,name) values(v_company,'Font step synthetic fixture');
  insert into fs_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','FSA');
  for who in select * from (values
    ('admin','admin','9990078001'),('e1','employee','9990078002'),('e2','employee','9990078003'),
    ('p','hr','9990078004')) t(k,role,code) loop
    insert into fs_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@fontstep-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  -- p must hold people edit whatever the hr preset says.
  insert into public.role_permissions(role_id,permission,level)
    select id,'people','edit' from public.roles where company_id=v_company and system_key='hr'
    on conflict (role_id,permission) do update set level='edit';
end; $$;
\o

select pg_temp.expect('default step is 0',(select font_step::text from public.profiles where id=pg_temp.fx('e1')),'0');
select pg_temp.expect('own update to 3 succeeds',pg_temp.err(pg_temp.as_scalar('e1',
  format($$update public.profiles set font_step=3 where id=%L returning 'x'$$,pg_temp.fx('e1')))),'ok');
select pg_temp.expect('own step reads back 3',(select font_step::text from public.profiles where id=pg_temp.fx('e1')),'3');
select pg_temp.expect('own step 5 is refused by the range check',pg_temp.err(pg_temp.as_scalar('e1',
  format($$update public.profiles set font_step=5 where id=%L returning 'x'$$,pg_temp.fx('e1')))),'23514');
select pg_temp.expect('people-edit holder cannot set another person''s step',pg_temp.err(pg_temp.as_scalar('p',
  format($$update public.profiles set font_step=2 where id=%L returning 'x'$$,pg_temp.fx('e2')))),'42501');
select pg_temp.as_scalar('e1',format($$update public.profiles set font_step=4 where id=%L returning 'x'$$,pg_temp.fx('e2')));
select pg_temp.expect('employee cannot change a colleague step',(select font_step::text from public.profiles where id=pg_temp.fx('e2')),'0');
select pg_temp.expect('admin sets another person step',pg_temp.err(pg_temp.as_scalar('admin',
  format($$update public.profiles set font_step=1 where id=%L returning 'x'$$,pg_temp.fx('e2')))),'ok');
select pg_temp.expect('admin change reads back 1',(select font_step::text from public.profiles where id=pg_temp.fx('e2')),'1');
select pg_temp.expect('own language_pref still updates',pg_temp.err(pg_temp.as_scalar('e1',
  format($$update public.profiles set language_pref='en' where id=%L returning 'x'$$,pg_temp.fx('e1')))),'ok');
rollback;
