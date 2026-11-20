-- Sales currencies (2026-11-20, CEO feedback task 3): company-managed currency list, validated on write.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table sl_fx(k text primary key,id uuid not null);
grant select on sl_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from sl_fx where k=p_key;
$$;
create function pg_temp.login(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
end; $$;
-- Run p_sql as p_key; the scalar result as text, or 'ERROR <sqlstate> <message>'.
create function pg_temp.as_scalar(p_key text,p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  begin execute p_sql into v_result;
  exception when others then v_result:='ERROR '||sqlstate||' '||sqlerrm; end;
  execute 'reset role'; return v_result;
end; $$;
create function pg_temp.as_json(p_key text,p_sql text) returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  execute p_sql into v_result;
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
-- The message of an 'ERROR …' result, or 'ok'.
create function pg_temp.msg(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then substr(p_result,13) else 'ok' end;
$$;
create function pg_temp.stage(p_flow text,p_code text) returns uuid language sql as $$
  select s.id from public.sales_stages s join public.sales_flows f on f.id=s.flow_id
   where f.company_id=pg_temp.fx('company') and f.kind=p_flow and s.code=p_code;
$$;
create function pg_temp.stage_of_no(p_no integer) returns text language sql as $$
  select s.code from public.sales_rfps r join public.sales_stages s on s.id=r.stage_id
   where r.company_id=pg_temp.fx('company') and r.record_no=p_no;
$$;
create function pg_temp.stage_of(p_rec text) returns text language sql as $$
  select s.code from public.sales_rfps r join public.sales_stages s on s.id=r.stage_id where r.id=pg_temp.fx(p_rec);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid();
  v_dept2 uuid:=gen_random_uuid(); v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Sales synthetic fixture'),(v_other,'Sales other fixture');
  insert into sl_fx values('company',v_company),('other_company',v_other);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','SL'),(v_dept2,v_other,'دیگر','Other HQ','office','SO');
  for who in select * from (values
    ('admin','admin','9990940001',v_company,v_dept),('ceo','employee','9990940002',v_company,v_dept),
    ('viewer','employee','9990940003',v_company,v_dept),('eng','employee','9990940004',v_company,v_dept),
    ('fin','employee','9990940005',v_company,v_dept),('seller','employee','9990940006',v_company,v_dept),
    ('nobody','employee','9990940007',v_company,v_dept),('other_admin','admin','9990940008',v_other,v_dept2)
    ) t(k,role,code,company,dept) loop
    insert into sl_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@sales-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),who.company,who.dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
  end loop;
  -- Custom roles: the CEO holds everything; the others one slice each.
  insert into public.roles(company_id,kind,name) values(v_company,'custom','SlCeo') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_prices','edit'),
    (v_role,'sales_bonds','edit'),(v_role,'sales_decide','edit'),(v_role,'sales_reports','read'),
    (v_role,'sales_settings','edit'),(v_role,'project_items','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ceo'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','SlViewer') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('viewer'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','SlEng') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read'),(v_role,'project_items','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('eng'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','SlFin') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read'),(v_role,'sales_bonds','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('fin'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','SlSeller') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('seller'),v_role);
end; $$;

-- ============================================================ currencies
select pg_temp.expect('seeded five codes',(select string_agg(code,',' order by position) from public.sales_currencies where company_id=pg_temp.fx('company')),'IRR,EUR,USD,AED,CNY');
select pg_temp.expect('settings holder adds Toman',pg_temp.msg(pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_currency('TMN','{"name_fa":"تومان","name_en":"Toman","decimals":0,"symbol":null,"position":6}')::text$q$)),'ok');
select pg_temp.expect('Toman stored',(select name_en||'|'||decimals||'|'||active from public.sales_currencies where company_id=pg_temp.fx('company') and code='TMN'),'Toman|0|true');
select pg_temp.expect('plain sales user refused',pg_temp.as_scalar('seller',
  $q$select public.app_sales_save_currency('ABC','{"name_fa":"الف","name_en":"Abc"}')::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('bad code refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_currency('A-B','{"name_fa":"الف","name_en":"Abc"}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('decimals above 2 refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_currency('TMN','{"decimals":3}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('update keeps the code, changes the name',pg_temp.msg(pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_currency('TMN','{"name_en":"Toman (IRT)"}')::text$q$)),'ok');
select pg_temp.expect('name changed',(select name_en from public.sales_currencies where company_id=pg_temp.fx('company') and code='TMN'),'Toman (IRT)');
select pg_temp.as_scalar('ceo',$q$select public.app_sales_save_currency('TMN','{"name_en":"Toman"}')::text$q$);

insert into sl_fx select 'rec',(pg_temp.as_scalar('seller',$q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"Currency record"}')::text$q$))::uuid;
select pg_temp.expect('record with TMN saves',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"currency":"TMN"}')::text$q$,pg_temp.fx('rec')))),'ok');
select pg_temp.expect('record currency stored',(select currency from public.sales_rfps where id=pg_temp.fx('rec')),'TMN');
select pg_temp.expect('record with unknown code refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"currency":"XYZ"}')::text$q$,pg_temp.fx('rec'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('record keeps TMN after refusal',(select currency from public.sales_rfps where id=pg_temp.fx('rec')),'TMN');
select pg_temp.expect('new record with unknown code refused',pg_temp.as_scalar('seller',
  $q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"X","currency":"XYZ"}')::text$q$),'ERROR 22023 sales: invalid input');

select pg_temp.expect('bond with TMN saves',pg_temp.msg(pg_temp.as_scalar('fin',
  format($q$select public.app_sales_save_bond(%L,null,'{"kind":"bid","amount":10,"currency":"TMN"}')::text$q$,pg_temp.fx('rec')))),'ok');
select pg_temp.expect('bond currency stored',(select currency from public.sales_bonds where rfp_id=pg_temp.fx('rec')),'TMN');
select pg_temp.expect('bond with unknown code refused',pg_temp.as_scalar('fin',
  format($q$select public.app_sales_save_bond(%L,null,'{"kind":"performance","currency":"XYZ"}')::text$q$,pg_temp.fx('rec'))),'ERROR 22023 sales: invalid input');

select pg_temp.expect('delete refused while used',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_delete_currency('TMN')::text$q$),'ERROR 22023 sales: in use');

select pg_temp.expect('deactivate Toman',pg_temp.msg(pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_currency('TMN','{"active":false}')::text$q$)),'ok');
select pg_temp.expect('old record saves again with its inactive code',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"currency":"TMN","description":"again"}')::text$q$,pg_temp.fx('rec')))),'ok');
select pg_temp.expect('old record saves without touching currency',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"description":"third"}')::text$q$,pg_temp.fx('rec')))),'ok');
select pg_temp.expect('new record with inactive code refused',pg_temp.as_scalar('seller',
  $q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"Y","currency":"TMN"}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('switching to an active code works',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"currency":"USD"}')::text$q$,pg_temp.fx('rec')))),'ok');
select pg_temp.expect('...and not back to it',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"currency":"TMN"}')::text$q$,pg_temp.fx('rec'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('bond keeps its inactive code on edit',pg_temp.msg(pg_temp.as_scalar('fin',
  format($q$select public.app_sales_save_bond(%L,%L,'{"currency":"TMN","amount":11}')::text$q$,pg_temp.fx('rec'),
    (select id from public.sales_bonds where rfp_id=pg_temp.fx('rec') limit 1)))),'ok');

select pg_temp.expect('bootstrap lists the inactive code',(pg_temp.as_json('seller',$q$select public.app_sales_bootstrap()$q$)
  ->'currencies'->5->>'code')||'|'||(pg_temp.as_json('seller',$q$select public.app_sales_bootstrap()$q$)->'currencies'->5->>'active'),'TMN|false');
select pg_temp.expect('bootstrap has no company_id on currencies',(pg_temp.as_json('seller',$q$select public.app_sales_bootstrap()$q$)->'currencies'->0 ? 'company_id')::text,'false');

-- A currency used by nothing can be deleted; another company's is invisible to it.
select pg_temp.as_scalar('ceo',$q$select public.app_sales_save_currency('GBP','{"name_fa":"پوند","name_en":"Pound","decimals":2}')::text$q$);
select pg_temp.expect('unused code deleted',pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_delete_currency('GBP')::text$q$)),'ok');
select pg_temp.expect('deleted code gone',(select count(*)::text from public.sales_currencies where code='GBP'),'0');
select pg_temp.expect('delete of unknown code is not found',pg_temp.as_scalar('ceo',$q$select public.app_sales_delete_currency('GBP')::text$q$),'ERROR P0002 sales: not found');
select pg_temp.expect('other company untouched by company 1 edits',(select count(*)::text from public.sales_currencies where company_id=pg_temp.fx('other_company') and code='TMN'),'0');
select pg_temp.expect('other company seeded too',(select count(*)::text from public.sales_currencies where company_id=pg_temp.fx('other_company')),'5');
select pg_temp.expect('tables carry no client grants',(select count(*)::text from information_schema.role_table_grants where table_name='sales_currencies' and grantee in ('anon','authenticated')),'0');

rollback;
