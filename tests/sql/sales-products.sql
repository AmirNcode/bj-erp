-- Sales products (2026-11-20, CEO feedback task 4): products catalog + item pre-fill.
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

-- ============================================================ products
select pg_temp.expect('plain sales user cannot save a product',pg_temp.as_scalar('seller',
  $q$select public.app_sales_save_product(null,'{"name_fa":"شیر","name_en":"Valve"}')::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('user without sales cannot list',pg_temp.msg(pg_temp.as_scalar('nobody',
  $q$select public.app_sales_products()::text$q$)),'sales: not allowed');
select pg_temp.as_scalar('ceo',$q$select public.app_sales_save_field(null,'{"entity":"item","label_en":"Body material","label_fa":"جنس بدنه","type":"select","options":["WCB","CF8M"]}')::text$q$);
select pg_temp.expect('library column key',(select key from public.sales_field_defs where company_id=pg_temp.fx('company') and entity='item' and label_en='Body material'),'x_body_material');

select pg_temp.expect('default outside the options refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"name_fa":"شیر","name_en":"Gate valve","fields":[{"field":"x_body_material","default":"ZZZ"}]}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('unknown column refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"name_fa":"شیر","name_en":"Gate valve","fields":[{"field":"x_nope","default":"a"}]}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('negative quantity default refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"name_fa":"شیر","name_en":"Gate valve","fields":[{"field":"qty","default":-1}]}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('no name refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"fields":[]}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('nothing saved by the refusals',(select count(*)::text from public.sales_products where company_id=pg_temp.fx('company')),'0');

insert into sl_fx select 'gate',(pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"code":"GV","name_fa":"شیر دروازه‌ای","name_en":"Gate valve","position":1,"fields":[{"field":"size","default":"12in"},{"field":"x_body_material","default":"WCB"}]}')::text$q$))::uuid;
select pg_temp.expect('gate saved with two columns',(select count(*)::text from public.sales_product_fields where product_id=pg_temp.fx('gate')),'2');
insert into sl_fx select 'pump',(pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"name_fa":"پمپ","name_en":"Pump","position":2,"fields":[{"field":"qty","default":5},{"field":"unit","default":"pcs"}]}')::text$q$))::uuid;
select pg_temp.expect('duplicate code refused',pg_temp.as_scalar('ceo',
  $q$select public.app_sales_save_product(null,'{"code":"GV","name_fa":"x","name_en":"x"}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('a reader lists products with fields',(pg_temp.as_json('viewer',$q$select public.app_sales_products()$q$)->0->>'name_en')||'|'||jsonb_array_length(pg_temp.as_json('viewer',$q$select public.app_sales_products()$q$)->0->'fields'),'Gate valve|2');
select pg_temp.expect('list carries used_count 0',(pg_temp.as_json('viewer',$q$select public.app_sales_products()$q$)->0->>'used_count'),'0');
select pg_temp.expect('list has no company_id',(pg_temp.as_json('viewer',$q$select public.app_sales_products()$q$)->0 ? 'company_id')::text,'false');

-- ------------------------------------------------------------ picking on a row
insert into sl_fx select 'rec',(pg_temp.as_scalar('seller',$q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"Products record"}')::text$q$))::uuid;
select pg_temp.expect('record starts with no column override',(select (item_columns is null)::text from public.sales_rfps where id=pg_temp.fx('rec')),'true');
insert into sl_fx select 'n1',((pg_temp.as_json('ceo',format($q$select public.app_project_save_node(%L,null,null,'{"size":"6in","description":"typed"}')$q$,pg_temp.fx('rec'))))->>'id')::uuid;
select pg_temp.expect('pick gate: ok',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),pg_temp.fx('gate')))),'ok');
select pg_temp.expect('typed size stays',(select size from public.project_nodes where id=pg_temp.fx('n1')),'6in');
select pg_temp.expect('empty custom column gets the default',(select custom->>'x_body_material' from public.project_nodes where id=pg_temp.fx('n1')),'WCB');
select pg_temp.expect('product_type is the product name',(select product_type from public.project_nodes where id=pg_temp.fx('n1')),'Gate valve');
select pg_temp.expect('product_id stored',(select (product_id=pg_temp.fx('gate'))::text from public.project_nodes where id=pg_temp.fx('n1')),'true');
select pg_temp.expect('item_columns starts from the effective list plus the product column',
  (select (item_columns->'1' = '["product_type","size","rating","qty","unit","x_body_material"]'::jsonb)::text from public.sales_rfps where id=pg_temp.fx('rec')),'true');
select pg_temp.expect('one product event',(select count(*)::text from public.sales_events where rfp_id=pg_temp.fx('rec') and kind='items' and body->>'action'='product'),'1');
select pg_temp.expect('event names product and code',(select (body->>'product')||'|'||(body->>'code') from public.sales_events where rfp_id=pg_temp.fx('rec') and kind='items' and body->>'action'='product'),
  'Gate valve|'||(select code from public.project_nodes where id=pg_temp.fx('n1')));
select pg_temp.expect('used_count is 1',(pg_temp.as_json('viewer',$q$select public.app_sales_products()$q$)->0->>'used_count'),'1');

-- the same pick again changes nothing and logs nothing new
select pg_temp.as_scalar('ceo',format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),pg_temp.fx('gate')));
select pg_temp.expect('re-sending the same product is a plain edit',(select count(*)::text from public.sales_events where rfp_id=pg_temp.fx('rec') and kind='items' and body->>'action'='product'),'1');

-- 0 counts as filled; a new row picks defaults when empty
insert into sl_fx select 'n2',((pg_temp.as_json('ceo',format($q$select public.app_project_save_node(%L,null,null,'{"qty":0}')$q$,pg_temp.fx('rec'))))->>'id')::uuid;
select pg_temp.as_scalar('ceo',format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n2'),pg_temp.fx('pump')));
select pg_temp.expect('qty 0 is kept',(select qty::text from public.project_nodes where id=pg_temp.fx('n2')),'0');
select pg_temp.expect('empty unit gets the default',(select unit from public.project_nodes where id=pg_temp.fx('n2')),'pcs');
insert into sl_fx select 'n3',((pg_temp.as_json('ceo',format($q$select public.app_project_save_node(%L,null,null,jsonb_build_object('product_id',%L))$q$,pg_temp.fx('rec'),pg_temp.fx('pump'))))->>'id')::uuid;
select pg_temp.expect('new row with a product gets qty default',(select qty::text from public.project_nodes where id=pg_temp.fx('n3')),'5');

-- typed product_type and product in one save: the product name wins
select pg_temp.expect('product replaces a typed product_type',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_type','Custom','product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n3'),pg_temp.fx('gate')))),'ok');
select pg_temp.expect('...name set',(select product_type from public.project_nodes where id=pg_temp.fx('n3')),'Gate valve');

-- clearing keeps the values
select pg_temp.expect('clear product',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,'{"product_id":null}')::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1')))),'ok');
select pg_temp.expect('product_id cleared',(select (product_id is null)::text from public.project_nodes where id=pg_temp.fx('n1')),'true');
select pg_temp.expect('values stay after clearing',(select (custom->>'x_body_material')||'|'||size||'|'||product_type from public.project_nodes where id=pg_temp.fx('n1')),'WCB|6in|Gate valve');

-- editing a product never touches rows already filled
select pg_temp.expect('edit gate default',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_save_product(%L,'{"fields":[{"field":"x_body_material","default":"CF8M"}]}')::text$q$,pg_temp.fx('gate')))),'ok');
select pg_temp.expect('fields replaced',(select string_agg(field||'='||("default" #>> '{}'),',' order by position) from public.sales_product_fields where product_id=pg_temp.fx('gate')),'x_body_material=CF8M');
select pg_temp.expect('existing row still WCB',(select custom->>'x_body_material' from public.project_nodes where id=pg_temp.fx('n3')),'WCB');
select pg_temp.expect('name kept when patch omits it',(select name_en from public.sales_products where id=pg_temp.fx('gate')),'Gate valve');

-- rejects
select pg_temp.expect('inactive product refused',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_save_product(%L,'{"active":false}')::text$q$,pg_temp.fx('pump')))),'ok');
select pg_temp.expect('pick of an inactive product refused',pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),pg_temp.fx('pump'))),'ERROR 22023 sales: invalid input');
insert into sl_fx select 'foreign',gen_random_uuid();
insert into public.sales_products(id,company_id,name_fa,name_en) select id,pg_temp.fx('other_company'),'بیگانه','Foreign' from sl_fx where k='foreign';
select pg_temp.expect('product of another company refused',pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),pg_temp.fx('foreign'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('foreign product not editable from this company',pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_save_product(%L,'{"name_en":"Hijack"}')::text$q$,pg_temp.fx('foreign'))),'ERROR P0002 sales: not found');
select pg_temp.expect('random product id refused',pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),gen_random_uuid())),'ERROR 22023 sales: invalid input');
select pg_temp.expect('a project_items-only user cannot save a product',pg_temp.as_scalar('eng',
  format($q$select public.app_sales_save_product(%L,'{"name_en":"Hijack"}')::text$q$,pg_temp.fx('gate'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('but can pick one',pg_temp.msg(pg_temp.as_scalar('eng',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),pg_temp.fx('gate')))),'ok');

-- delete
select pg_temp.expect('delete refused while used',pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_delete_product(%L)::text$q$,pg_temp.fx('gate'))),'ERROR 22023 sales: in use');
update public.project_nodes set product_id=null where product_id=(select id from sl_fx where k='pump');
select pg_temp.expect('unused product deleted',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_delete_product(%L)::text$q$,pg_temp.fx('pump')))),'ok');
select pg_temp.expect('its columns are gone',(select count(*)::text from public.sales_product_fields where product_id=pg_temp.fx('pump')),'0');
select pg_temp.expect('delete of an unknown product is not found',pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_delete_product(%L)::text$q$,pg_temp.fx('pump'))),'ERROR P0002 sales: not found');
select pg_temp.expect('another company product is not found',pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_delete_product(%L)::text$q$,pg_temp.fx('foreign'))),'ERROR P0002 sales: not found');

-- a closed record follows the existing item rule (items stay open)
update public.sales_rfps set stage_id=pg_temp.stage('bid','lost') where id=pg_temp.fx('rec');
select pg_temp.expect('record is closed',pg_temp.stage_of('rec'),'lost');
select pg_temp.expect('closed record: plain item edit works',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,'{"description":"after close"}')::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1')))),'ok');
select pg_temp.expect('closed record: product pick works the same',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_project_save_node(%L,%L,null,jsonb_build_object('product_id',%L))::text$q$,pg_temp.fx('rec'),pg_temp.fx('n1'),pg_temp.fx('gate')))),'ok');

select pg_temp.expect('tables carry no client grants',(select count(*)::text from information_schema.role_table_grants where table_name in ('sales_products','sales_product_fields') and grantee in ('anon','authenticated')),'0');

rollback;
