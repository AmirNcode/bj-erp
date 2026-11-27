-- ERP › Sales customer registry (FR-98, 2026-11-26): fold parity, catalog, lists, save / completeness,
-- one name namespace, gates, privacy, record buyer ids, word search, merge, batch removal, customer import.
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
-- The HINT of the error p_sql raises as p_key (null when it does not fail).
create function pg_temp.hint(p_key text,p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  begin execute p_sql;
  exception when others then get stacked diagnostics v_hint=pg_exception_hint; end;
  execute 'reset role'; return v_hint;
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
-- save_customer as p_user: text result / jsonb result.
create function pg_temp.sv(p_user text,p_id uuid,p jsonb) returns text language sql as $$
  select pg_temp.as_scalar(p_user,format('select public.app_sales_save_customer(%L,%L::jsonb)::text',p_id,p::text));
$$;
create function pg_temp.svj(p_user text,p_id uuid,p jsonb) returns jsonb language sql as $$
  select pg_temp.sv(p_user,p_id,p)::jsonb;
$$;
create function pg_temp.city(p_prov text) returns uuid language sql as $$
  select id from public.sales_cities where company_id=pg_temp.fx('company') and province_code=p_prov order by name_fa limit 1;
$$;
create function pg_temp.city_name(p_prov text) returns text language sql as $$
  select name_fa from public.sales_cities where company_id=pg_temp.fx('company') and province_code=p_prov order by name_fa limit 1;
$$;
create function pg_temp.cat(p_name text) returns uuid language sql as $$
  select id from public.sales_contractor_categories where company_id=pg_temp.fx('company') and name_fa=p_name;
$$;
create function pg_temp.keys(p jsonb) returns text language sql as $$
  select string_agg(k,',' order by k) from jsonb_object_keys(p) k;
$$;
create function pg_temp.ncust(p_name text) returns bigint language sql as $$
  select count(*) from public.sales_customers where company_id=pg_temp.fx('company') and name=p_name;
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Customer registry fixture');
  insert into sl_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','CR');
  for who in select * from (values
    ('cust','9990980001'),('setm','9990980002'),('viewer','9990980003'),('imp','9990980004'),('seller','9990980005')
    ) t(k,code) loop
    insert into sl_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@registry-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee');
  end loop;
  -- cust: customers editor, no settings, no import
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CrCust') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_customers','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('cust'),v_role);
  -- setm: settings only (merge / rename / remove batch / edit lists)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CrSet') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_settings','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('setm'),v_role);
  -- viewer: read only
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CrView') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('viewer'),v_role);
  -- imp: customers + import
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CrImp') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_customers','edit'),
    (v_role,'sales_customers_import','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('imp'),v_role);
  -- seller: records only, no customers permission
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CrSeller') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('seller'),v_role);
  perform private.sales_ensure(v_company);
end $$;

-- ================================================================ 1. fold parity (tests/unit/sales-customer-search.test.ts)
select pg_temp.expect('fold tatweel', private.sales_word_key('شـرکـت'), 'شرکت');
select pg_temp.expect('fold 1', private.sales_word_key('شرکت‌ نفتِ «فلات» ABC-12 ـ ۱۲'), 'شرکتنفتفلاتabc1212');
select pg_temp.expect('fold 2', private.sales_word_key('ملي مناطق نفت‌خيز جنوب'), 'ملیمناطقنفتخیزجنوب');
select pg_temp.expect('fold 3', private.sales_word_key('NISOC (Co.)'), 'nisocco');
select pg_temp.expect('fold 4', private.sales_word_key('  Ahvaz  ٣٤ '), 'ahvaz34');
select pg_temp.expect('fold 5', private.sales_word_key('پتروپارس، ایران؛ ٪'), 'پتروپارسایران');
select pg_temp.expect('fold 6', private.sales_word_key('كيش'), 'کیش');
select pg_temp.expect('fold 7', private.sales_word_key('آب و فاضلاب'), 'آبوفاضلاب');
select pg_temp.expect('fold 8', private.sales_word_key('x_y/z.w'), 'xyzw');

-- ================================================================ 2. permission catalog
select pg_temp.expect('catalog has 38 keys',(select count(*)::text from private.permission_keys()),'38');
select pg_temp.expect('sales_customers edit allowed',private.permission_allows('sales_customers','edit')::text,'true');
select pg_temp.expect('sales_customers read not allowed',private.permission_allows('sales_customers','read')::text,'false');
select pg_temp.expect('import needs sales_customers',
  (select count(*)::text from private.permission_deps()
    where key='sales_customers_import' and key_level='read' and needs='sales_customers'),'1');

-- ================================================================ 3. seeded lists
select pg_temp.expect('new company gets 9 categories',
  (select count(*)::text from public.sales_contractor_categories where company_id=pg_temp.fx('company')),'9');
select pg_temp.assert('new company gets at least 300 cities',
  (select count(*) from public.sales_cities where company_id=pg_temp.fx('company'))>=300);
create temp table sl_n(k text primary key,n bigint not null);
insert into sl_n select 'cities',count(*) from public.sales_cities where company_id=pg_temp.fx('company');
update public.sales_contractor_categories set name_fa='نیروی تغییر' where company_id=pg_temp.fx('company') and name_fa='نیرو';
select private.sales_ensure(pg_temp.fx('company'));
select pg_temp.expect('ensure again keeps 9 categories',
  (select count(*)::text from public.sales_contractor_categories where company_id=pg_temp.fx('company')),'9');
select pg_temp.expect('ensure again does not re-add the renamed category',
  (select count(*)::text from public.sales_contractor_categories where company_id=pg_temp.fx('company') and name_fa='نیرو'),'0');
select pg_temp.expect('ensure again adds no city',
  (select count(*)::text from public.sales_cities where company_id=pg_temp.fx('company')),(select n::text from sl_n where k='cities'));

-- ================================================================ 4. save_customer
create temp table sl_j(k text primary key,j jsonb not null);
grant select on sl_j to authenticated;
insert into sl_j select 'F',pg_temp.svj('cust',null,jsonb_build_object('name','شرکت الف','name_en','Alef Co','kind','contractor',
  'ceo_name','مدیر الف','province_code','KZ','city_id',pg_temp.city('KZ'),'address','خیابان اول','rank','۲',
  'category_id',pg_temp.cat('ساختمان'),
  'people',jsonb_build_array(jsonb_build_object('name','علی','title_id',(select id from public.sales_contact_titles
     where company_id=pg_temp.fx('company') and name_en='Technical manager'),
     'phones',jsonb_build_array(jsonb_build_object('label','office','phone','۰۶۱-۳۳۴۴ ۵۵۶۶'))))));
insert into sl_fx select 'F',(j->>'id')::uuid from sl_j where k='F';
select pg_temp.expect('full contractor: nothing missing',(select jsonb_array_length(j->'missing')::text from sl_j where k='F'),'0');
select pg_temp.expect('rank typed in Persian digits is stored as 2',(select j->>'rank' from sl_j where k='F'),'2');
select pg_temp.expect('phone with Persian digits and dashes is normalized',(select j->'people'->0->'phones'->0->>'phone' from sl_j where k='F'),'06133445566');
insert into sl_j select 'D',pg_temp.svj('cust',null,jsonb_build_object('name','شرکت ب'));
insert into sl_fx select 'D',(j->>'id')::uuid from sl_j where k='D';
select pg_temp.expect('name-only draft lists every missing field in form order',
  (select string_agg(x,',' order by o) from sl_j, jsonb_array_elements_text(j->'missing') with ordinality t(x,o) where k='D'),
  'name_en,kind,ceo_name,province,city,address,phones,grade_or_activity');
insert into sl_j select 'G',pg_temp.svj('cust',null,jsonb_build_object('name','شرکت دولتی','kind','government','rank','3'));
insert into sl_fx select 'G',(j->>'id')::uuid from sl_j where k='G';
select pg_temp.expect('government with a rank: rank stored null',
  (select coalesce(rank::text,'null') from public.sales_customers where id=pg_temp.fx('G')),'null');
select pg_temp.expect('city of another province is refused',
  pg_temp.msg(pg_temp.sv('cust',null,jsonb_build_object('name','خطا','province_code','KZ','city_id',pg_temp.city('TE')))),'sales: invalid input');
select pg_temp.expect('a phone-book number in a bad format is refused',
  pg_temp.msg(pg_temp.sv('cust',null,jsonb_build_object('name','خطا دو','people',jsonb_build_array(jsonb_build_object('name','x',
    'phones',jsonb_build_array(jsonb_build_object('phone','0912-abc','label','mobile'))))))),
  'sales: invalid input');
select pg_temp.expect('more than 50 phone-book entries is refused',
  pg_temp.msg(pg_temp.sv('cust',null,jsonb_build_object('name','خطا سه','people',
    (select jsonb_agg(jsonb_build_object('name','p'||n,'phones',jsonb_build_array(jsonb_build_object('label','office','phone','0912'||lpad(n::text,7,'0'))))) from generate_series(1,51) n)))),
  'sales: invalid input');

-- ================================================================ 5. missing is kept by triggers
update public.sales_customers set updated_at='2020-01-01',updated_by=null where id=pg_temp.fx('F');
delete from public.sales_customer_contacts where customer_id=pg_temp.fx('F');
select pg_temp.expect('deleting the last phone-book entry puts phones back in missing',
  (select ('phones'=any(missing))::text from public.sales_customers where id=pg_temp.fx('F')),'true');
insert into public.sales_customer_contacts(company_id,customer_id,person,position)
  values(pg_temp.fx('company'),pg_temp.fx('F'),'علی',1);
insert into public.sales_customer_phones(company_id,contact_id,label,phone,position)
  select pg_temp.fx('company'),id,'office','06133445566',1 from public.sales_customer_contacts where customer_id=pg_temp.fx('F');
select pg_temp.expect('adding a number removes phones from missing',
  (select ('phones'=any(missing))::text from public.sales_customers where id=pg_temp.fx('F')),'false');
select pg_temp.expect('the phone-book triggers leave updated_by / updated_at alone',
  (select (updated_by is null and updated_at='2020-01-01')::text from public.sales_customers where id=pg_temp.fx('F')),'true');
update public.sales_customers set updated_at=now(),updated_by=pg_temp.fx('cust') where id=pg_temp.fx('F');

-- ================================================================ 6. one name namespace
select pg_temp.expect('English name equal to another Farsi name: duplicate name',
  pg_temp.msg(pg_temp.sv('cust',null,jsonb_build_object('name','شرکت ج','name_en','شرکت ب'))),'sales: duplicate name');
select pg_temp.expect('... and the hint names that customer',
  (pg_temp.hint('cust',format('select public.app_sales_save_customer(null,%L::jsonb)',jsonb_build_object('name','شرکت ج','name_en','شرکت ب')::text))::jsonb)->>'id',
  pg_temp.fx('D')::text);
select pg_temp.expect('English name equal to another English name: duplicate name',
  pg_temp.msg(pg_temp.sv('cust',null,jsonb_build_object('name','شرکت چ','name_en','ALEF CO'))),'sales: duplicate name');
select pg_temp.expect('... and the hint names that customer (English)',
  (pg_temp.hint('cust',format('select public.app_sales_save_customer(null,%L::jsonb)',jsonb_build_object('name','شرکت چ','name_en','ALEF CO')::text))::jsonb)->>'id',
  pg_temp.fx('F')::text);
select pg_temp.expect('Farsi name equal to another English name: duplicate name',
  pg_temp.msg(pg_temp.sv('cust',null,jsonb_build_object('name','alef co'))),'sales: duplicate name');
select pg_temp.expect('rename onto another English key: customer exists',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_rename_customer(%L,%L)::text',pg_temp.fx('D'),'Alef Co'))),'sales: customer exists');

-- ================================================================ 7. gates
select pg_temp.expect('read-only user cannot save a customer',
  pg_temp.sv('viewer',null,jsonb_build_object('name','ممنوع')),'ERROR 42501 sales: not allowed');
select pg_temp.expect('read-only user cannot create a category',
  pg_temp.as_scalar('viewer',$q$select public.app_sales_save_category('{"name_fa":"دسته ممنوع"}'::jsonb)::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('read-only user cannot create a city',
  pg_temp.as_scalar('viewer',$q$select public.app_sales_save_city('{"province_code":"KZ","name_fa":"شهر ممنوع"}'::jsonb)::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('read-only user cannot preview an import',
  pg_temp.as_scalar('viewer',$q$select public.app_sales_customer_import_preview('[{"row":1,"name":"x"}]'::jsonb)::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('read-only user cannot import',
  pg_temp.as_scalar('viewer',$q$select public.app_sales_customer_import('{"rows":[{"row":1,"name":"x"}]}'::jsonb)::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('customers editor without import cannot preview',
  pg_temp.as_scalar('cust',$q$select public.app_sales_customer_import_preview('[{"row":1,"name":"x"}]'::jsonb)::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('customers editor cannot edit an existing category',
  pg_temp.as_scalar('cust',format($q$select public.app_sales_save_category(%L::jsonb)::text$q$,jsonb_build_object('id',pg_temp.cat('ساختمان'),'name_fa','ساختمان نو')::text)),
  'ERROR 42501 sales: not allowed');
select pg_temp.expect('customers editor cannot edit an existing city',
  pg_temp.as_scalar('cust',format($q$select public.app_sales_save_city(%L::jsonb)::text$q$,jsonb_build_object('id',pg_temp.city('KZ'),'name_fa','شهر نو')::text)),
  'ERROR 42501 sales: not allowed');
select pg_temp.expect('customers editor can create a category',
  pg_temp.msg(pg_temp.as_scalar('cust',$q$select public.app_sales_save_category('{"name_fa":"دسته مشتری"}'::jsonb)::text$q$)),'ok');
select pg_temp.expect('customers editor can create a city',
  pg_temp.msg(pg_temp.as_scalar('cust',$q$select public.app_sales_save_city('{"province_code":"KZ","name_fa":"شهر مشتری"}'::jsonb)::text$q$)),'ok');
select pg_temp.expect('settings holder can edit an existing category',
  pg_temp.msg(pg_temp.as_scalar('setm',format($q$select public.app_sales_save_category(%L::jsonb)::text$q$,jsonb_build_object('id',pg_temp.cat('دسته مشتری'),'name_fa','دسته مشتری ۲')::text))),'ok');

-- ================================================================ 8. privacy
select pg_temp.assert('read-only profile has no ceo_name, ceo_phone, address or people',
  (select not (p ? 'ceo_name') and not (p ? 'ceo_phone') and not (p ? 'address') and not (p ? 'people') and not (p ? 'contacts')
     from (select pg_temp.as_json('viewer',format('select public.app_sales_customer(%L)->%L',pg_temp.fx('F'),'profile')) p) x));
select pg_temp.assert('customers holder profile has ceo_name, ceo_phone, address and people',
  (select p ? 'ceo_name' and p ? 'ceo_phone' and p ? 'address' and p ? 'people'
     from (select pg_temp.as_json('cust',format('select public.app_sales_customer(%L)->%L',pg_temp.fx('F'),'profile')) p) x));
select pg_temp.assert('bootstrap customers list is not empty',
  jsonb_array_length(pg_temp.as_json('viewer','select public.app_sales_bootstrap()->''customers'''))>=3);
select pg_temp.assert('bootstrap customers carry exactly id, incomplete, kind, name, name_en',
  (select bool_and(pg_temp.keys(e)='id,incomplete,kind,name,name_en')
     from jsonb_array_elements(pg_temp.as_json('viewer','select public.app_sales_bootstrap()->''customers''')) e));
select pg_temp.assert('customers list rows have no ceo_name, ceo_phone, address or people (even for a holder)',
  (select bool_and(not (e ? 'ceo_name') and not (e ? 'ceo_phone') and not (e ? 'address') and not (e ? 'people'))
     from jsonb_array_elements(pg_temp.as_json('cust','select public.app_sales_customers(''{}''::jsonb)')) e));
select pg_temp.assert('customers list for a read-only user has rows',
  jsonb_array_length(pg_temp.as_json('viewer','select public.app_sales_customers(''{}''::jsonb)'))>=1);

-- ================================================================ 9. record save: buyer by id / text
insert into sl_fx select 'rec1',pg_temp.as_scalar('cust',format($q$select public.app_sales_save_record(null,jsonb_build_object('title','T1','buyer_id',%L))::text$q$,pg_temp.fx('D')))::uuid;
select pg_temp.expect('buyer_id sets the buyer',(select buyer_id::text from public.sales_rfps where id=pg_temp.fx('rec1')),pg_temp.fx('D')::text);
select pg_temp.expect('unknown buyer_id is refused',
  pg_temp.msg(pg_temp.as_scalar('cust',format($q$select public.app_sales_save_record(null,jsonb_build_object('title','T2','buyer_id',%L))::text$q$,gen_random_uuid()))),
  'sales: invalid input');
select pg_temp.expect('text buyer unknown, caller without sales_customers: unknown customer',
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_save_record(null,jsonb_build_object('title','T3','buyer','شرکت ناشناس'))::text$q$)),
  'sales: unknown customer');
select pg_temp.expect('... and nothing was created',pg_temp.ncust('شرکت ناشناس')::text,'0');
select pg_temp.expect('text buyer unknown, caller with sales_customers: created (old app)',
  pg_temp.msg(pg_temp.as_scalar('cust',$q$select public.app_sales_save_record(null,jsonb_build_object('title','T3','buyer','شرکت ناشناس'))::text$q$)),'ok');
select pg_temp.expect('... one new customer',pg_temp.ncust('شرکت ناشناس')::text,'1');

-- ================================================================ 10. records search by words
insert into sl_fx select 'R1',pg_temp.as_scalar('cust',format($q$select public.app_sales_save_record(null,jsonb_build_object('title','پمپ گریز از مرکز','buyer_id',%L))::text$q$,pg_temp.fx('F')))::uuid;
insert into sl_fx select 'R2',pg_temp.as_scalar('cust',format($q$select public.app_sales_save_record(null,jsonb_build_object('title','شیر کنترل','buyer_id',%L))::text$q$,pg_temp.fx('F')))::uuid;
select pg_temp.expect('title words in any order find one record',
  pg_temp.as_json('cust',$q$select public.app_sales_list_page('{"q":"مرکز پمپ","state":"all"}'::jsonb)$q$)->>'total','1');
select pg_temp.expect('the customer English name finds both records',
  pg_temp.as_json('cust',$q$select public.app_sales_list_page('{"q":"Alef Co","state":"all"}'::jsonb)$q$)->>'total','2');
select pg_temp.expect('words from two different records find none',
  pg_temp.as_json('cust',$q$select public.app_sales_list_page('{"q":"پمپ کنترل","state":"all"}'::jsonb)$q$)->>'total','0');

-- 9c. text path by English name resolves to the existing customer
insert into sl_n select 'customers',count(*) from public.sales_customers where company_id=pg_temp.fx('company');
insert into sl_fx select 'rec4',pg_temp.as_scalar('cust',$q$select public.app_sales_save_record(null,jsonb_build_object('title','T4','buyer','ALEF CO'))::text$q$)::uuid;
select pg_temp.expect('text buyer matching an English name resolves to that customer',
  (select buyer_id::text from public.sales_rfps where id=pg_temp.fx('rec4')),pg_temp.fx('F')::text);
select pg_temp.expect('... and creates no new customer',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company')),(select n::text from sl_n where k='customers'));

-- ================================================================ 11. merge keeps the profile
insert into sl_j select 'M1',pg_temp.svj('cust',null,jsonb_build_object('name','مبدا','name_en','Source Co','ceo_name','رئیس مبدا',
  'people',jsonb_build_array(jsonb_build_object('name','رضا','phones',jsonb_build_array(jsonb_build_object('label','mobile','phone','09120000001'))))));
insert into sl_fx select 'M1',(j->>'id')::uuid from sl_j where k='M1';
insert into sl_j select 'M2',pg_temp.svj('cust',null,jsonb_build_object('name','مقصد'));
insert into sl_fx select 'M2',(j->>'id')::uuid from sl_j where k='M2';
select pg_temp.expect('merge runs',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_merge_customers(%L,%L)::text',pg_temp.fx('M1'),pg_temp.fx('M2')))),'ok');
select pg_temp.expect('target got the English name, the CEO and the phone-book entry',
  (select name_en||'/'||ceo_name||'/'||(select count(*) from public.sales_customer_contacts k where k.customer_id=c.id)
     from public.sales_customers c where c.id=pg_temp.fx('M2')),'Source Co/رئیس مبدا/1');
select pg_temp.expect('alias exists for the source Farsi key',
  (select target_id::text from public.sales_name_aliases where company_id=pg_temp.fx('company') and kind='customer'
     and alias_key=private.sales_name_key('مبدا')),pg_temp.fx('M2')::text);
select pg_temp.expect('the source English name finds the target',
  private.sales_customer_find(pg_temp.fx('company'),'Source Co')::text,pg_temp.fx('M2')::text);
insert into sl_j select 'M3',pg_temp.svj('cust',null,jsonb_build_object('name','هدف','name_en','Target Co'));
insert into sl_fx select 'M3',(j->>'id')::uuid from sl_j where k='M3';
insert into sl_j select 'M4',pg_temp.svj('cust',null,jsonb_build_object('name','منبع','name_en','Source Two'));
insert into sl_fx select 'M4',(j->>'id')::uuid from sl_j where k='M4';
select pg_temp.expect('second merge runs',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_merge_customers(%L,%L)::text',pg_temp.fx('M4'),pg_temp.fx('M3')))),'ok');
select pg_temp.expect('aliases exist for the source Farsi and English keys',
  (select count(*)::text from public.sales_name_aliases where company_id=pg_temp.fx('company') and kind='customer'
     and target_id=pg_temp.fx('M3') and alias_key in (private.sales_name_key('منبع'),private.sales_name_key('Source Two'))),'2');
select pg_temp.expect('target keeps its own English name',
  (select name_en from public.sales_customers where id=pg_temp.fx('M3')),'Target Co');

-- ================================================================ 12. remove_batch spares registered customers
insert into sl_fx values('ledger',gen_random_uuid());
insert into public.sales_import_batches(id,company_id,file_name,kind,created_at)
  values(pg_temp.fx('ledger'),pg_temp.fx('company'),'old.xlsx','ledger',now()-interval '1 day');
insert into sl_j select 'D1',pg_temp.svj('cust',null,jsonb_build_object('name','ثبت دستی'));
insert into sl_fx select 'D1',(j->>'id')::uuid from sl_j where k='D1';
insert into sl_fx select 'bare',private.sales_customer(pg_temp.fx('company'),'ورودی ساده');
select pg_temp.expect('bare customer exists before removal',pg_temp.ncust('ورودی ساده')::text,'1');
select pg_temp.expect('remove_batch runs',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_remove_batch(%L)::text',pg_temp.fx('ledger')))),'ok');
select pg_temp.expect('the bare import customer is deleted',pg_temp.ncust('ورودی ساده')::text,'0');
select pg_temp.expect('the hand-registered draft is kept',pg_temp.ncust('ثبت دستی')::text,'1');
insert into sl_fx values('cbatch',gen_random_uuid());
insert into public.sales_import_batches(id,company_id,file_name,kind) values(pg_temp.fx('cbatch'),pg_temp.fx('company'),'c.xlsx','customers');
select pg_temp.expect('remove_batch refuses a customers batch',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_remove_batch(%L)::text',pg_temp.fx('cbatch')))),'sales: not found');
delete from public.sales_import_batches where id=pg_temp.fx('cbatch');

-- ================================================================ 13. customer import
create function pg_temp.prev(p_rows jsonb) returns jsonb language sql as $$
  select pg_temp.as_json('imp',format('select public.app_sales_customer_import_preview(%L::jsonb)',p_rows::text));
$$;
create function pg_temp.imp(p jsonb) returns jsonb language sql as $$
  select pg_temp.as_json('imp',format('select public.app_sales_customer_import(%L::jsonb)',p::text));
$$;
insert into sl_j select 'P',pg_temp.svj('cust',null,jsonb_build_object('name','شرکت پ','name_en','Pars Co','kind','government','ceo_name','قدیمی'));
insert into sl_fx select 'P',(j->>'id')::uuid from sl_j where k='P';
insert into sl_j select 'rows',jsonb_build_array(
  jsonb_build_object('row',1,'name','ایمپورت یک','name_en','Import One','kind','پیمانکار','ceo_name','ج','province','KZ',
    'city',pg_temp.city_name('KZ'),'address','a','rank','۳','category','ساختمان','contact_person','p','phone','09121234567'),
  jsonb_build_object('row',2,'name','','ceo_name','x'),
  jsonb_build_object('row',3,'name','ایکس','name_en','pars co','ceo_name','جدید','address','آدرس جدید'),
  jsonb_build_object('row',4,'name','ایمپورت چهار','kind','پیمانکار','rank','1','category','دسته جدید'));
select pg_temp.expect('preview counts: 2 new, 1 match, 1 error',
  (select (r->'counts'->>'new')||'/'||(r->'counts'->>'match')||'/'||(r->'counts'->>'error') from (select pg_temp.prev(j) r from sl_j where k='rows') x),'2/1/1');
select pg_temp.expect('preview: the nameless row is no_name, the English match is the match row',
  (select (r->'rows'->1->>'error')||'/'||(r->'rows'->2->>'status')||'/'||(r->'rows'->2->'match'->>'id')
     from (select pg_temp.prev(j) r from sl_j where k='rows') x),'no_name/match/'||pg_temp.fx('P')::text);
select pg_temp.expect('preview lists the unknown category once',
  (select jsonb_array_length(r->'unknown'->'categories')::text||'/'||(r->'unknown'->'categories'->0->>'value')
     from (select pg_temp.prev(j) r from sl_j where k='rows') x),'1/دسته جدید');
-- skip
insert into sl_j select 'imp1',pg_temp.imp(jsonb_build_object('file_name','c1.xlsx','rows',(select j from sl_j where k='rows'),'default_action','skip'));
select pg_temp.expect('import (skip): 2 created, 2 skipped',
  (select (j->>'created')||'/'||(j->>'skipped')||'/'||(j->>'updated') from sl_j where k='imp1'),'2/2/0');
select pg_temp.expect('skip leaves the matched customer unchanged',
  (select ceo_name||'/'||coalesce(address,'-') from public.sales_customers where id=pg_temp.fx('P')),'قدیمی/-');
-- update
select pg_temp.expect('import (update): 1 updated',
  (select (j->>'updated') from (select pg_temp.imp(jsonb_build_object('file_name','c2.xlsx','rows',jsonb_build_array((select j->2 from sl_j where k='rows')),'default_action','update')) j) x),'1');
select pg_temp.expect('update fills only the empty fields',
  (select ceo_name||'/'||coalesce(address,'-') from public.sales_customers where id=pg_temp.fx('P')),'قدیمی/آدرس جدید');
-- overwrite
select pg_temp.expect('import (overwrite): 1 updated',
  (select (j->>'updated') from (select pg_temp.imp(jsonb_build_object('file_name','c3.xlsx','rows',jsonb_build_array((select j->2 from sl_j where k='rows')),'default_action','overwrite')) j) x),'1');
select pg_temp.expect('overwrite replaces values but never the name',
  (select name||'/'||ceo_name from public.sales_customers where id=pg_temp.fx('P')),'شرکت پ/جدید');
-- category decision create
select pg_temp.expect('import with a create decision runs',
  (select (j->>'created') from (select pg_temp.imp(jsonb_build_object('file_name','c4.xlsx','default_action','skip',
     'rows',jsonb_build_array(jsonb_build_object('row',1,'name','ایمپورت پنج','kind','پیمانکار','rank','2','category','دسته نو')),
     'categories',jsonb_build_object(private.sales_word_key('دسته نو'),jsonb_build_object('action','create')))) j) x),'1');
select pg_temp.expect('the unknown category was created',
  (select count(*)::text from public.sales_contractor_categories where company_id=pg_temp.fx('company') and name_fa='دسته نو'),'1');
select pg_temp.expect('the new customer uses it',
  (select (category_id=pg_temp.cat('دسته نو'))::text from public.sales_customers where company_id=pg_temp.fx('company') and name='ایمپورت پنج'),'true');
-- batches + removal
select pg_temp.expect('batches list shows the first import with its counts',
  (select (x->>'created_count')||'/'||(x->>'remaining')
     from jsonb_array_elements(pg_temp.as_json('imp','select public.app_sales_customer_batches()')) x
    where x->>'id'=(select j->>'batch_id' from sl_j where k='imp1')),'2/2');
insert into sl_fx select 'I1',id from public.sales_customers where company_id=pg_temp.fx('company') and name='ایمپورت یک';
select pg_temp.expect('a record uses one imported customer',
  pg_temp.msg(pg_temp.as_scalar('cust',format($q$select public.app_sales_save_record(null,jsonb_build_object('title','T5','buyer_id',%L))::text$q$,pg_temp.fx('I1')))),'ok');
select pg_temp.expect('removing the batch removes the unused customer and keeps the used one',
  (select (j->>'removed')||'/'||(j->>'kept')
     from (select pg_temp.as_json('imp',format('select public.app_sales_remove_customer_batch(%L)',(select j->>'batch_id' from sl_j where k='imp1'))) j) x),'1/1');
select pg_temp.expect('the used customer survives, the other is gone',
  pg_temp.ncust('ایمپورت یک')::text||'/'||pg_temp.ncust('ایمپورت چهار')::text,'1/0');
select pg_temp.expect('remove_customer_batch refuses a ledger batch',
  pg_temp.msg(pg_temp.as_scalar('imp',format('select public.app_sales_remove_customer_batch(%L)::text',pg_temp.fx('ledger')))),'sales: not found');

-- ================================================================ 14. old app's add_customer shape
select pg_temp.expect('add_customer still returns id, existed, name, kind',
  pg_temp.keys(pg_temp.as_json('cust',$q$select public.app_sales_add_customer('{"name":"مشتری قدیمی","kind":"government"}'::jsonb)$q$)),
  'existed,id,kind,name');
select pg_temp.expect('add_customer finds an existing customer by name',
  pg_temp.as_json('cust',$q$select public.app_sales_add_customer('{"name":"شرکت الف"}'::jsonb)$q$)->>'existed','true');

-- ============================================================ review fixes (PR #35)
insert into public.sales_name_aliases(company_id,kind,alias_key,alias,target_id)
  values(pg_temp.fx('company'),'customer',private.sales_name_key('Old Spelling Co'),'Old Spelling Co',pg_temp.fx('D'));
select pg_temp.expect('rename onto another customer''s alias: customer exists',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_rename_customer(%L,%L)::text',
    (select id from public.sales_customers where company_id=pg_temp.fx('company') and id<>pg_temp.fx('D') order by created_at limit 1),
    'Old Spelling Co'))),'sales: customer exists');
select pg_temp.expect('an import that writes nothing keeps no batch',
  (select (j->>'batch_id') is null and (j->>'created')='0' and (j->>'updated')='0'
     from (select pg_temp.as_json('imp',$q$select public.app_sales_customer_import('{"file_name":"empty.xlsx","default_action":"skip","rows":[{"row":2}]}'::jsonb)$q$) j) t)::text,'true');

-- ============================================================ several rank / category pairs (2026-11-26 CEO)
create function pg_temp.cat_en(p_name text) returns uuid language sql as $$
  select id from public.sales_contractor_categories where company_id=pg_temp.fx('company') and name_en=p_name;
$$;
insert into sl_j select 'MP1',pg_temp.svj('cust',null,jsonb_build_object('name','پیمانکار چند رتبه','kind','contractor',
  'rank','1','category_id',pg_temp.cat_en('Building'),
  'grades',jsonb_build_array(
    jsonb_build_object('rank','۳','category_id',pg_temp.cat_en('Oil and gas')),
    jsonb_build_object('rank',1,'category_id',pg_temp.cat_en('Building')),
    jsonb_build_object('rank',3,'category_id',pg_temp.cat_en('Oil and gas')),
    jsonb_build_object('rank',2,'category_id',pg_temp.cat_en('Water')))));
insert into sl_fx select 'MP1',(j->>'id')::uuid from sl_j where k='MP1';
select pg_temp.expect('further pairs saved in order, first-pair and repeated pairs dropped',
  (select string_agg((g->>'rank')||':'||(g->>'category_en'),',' order by o) from sl_j, jsonb_array_elements(j->'grades') with ordinality t(g,o) where k='MP1'),
  '3:Oil and gas,2:Water');
select pg_temp.expect('first pair stays on the customer',(select j->>'rank'||':'||(j->>'category_en') from sl_j where k='MP1'),'1:Building');
select pg_temp.expect('half-filled further pair is refused',
  pg_temp.msg(pg_temp.sv('cust',pg_temp.fx('MP1'),jsonb_build_object('name','پیمانکار چند رتبه','kind','contractor',
    'grades',jsonb_build_array(jsonb_build_object('rank',2))))),'sales: invalid input');
select pg_temp.expect('rank 6 in a further pair is refused',
  pg_temp.msg(pg_temp.sv('cust',pg_temp.fx('MP1'),jsonb_build_object('name','پیمانکار چند رتبه','kind','contractor',
    'grades',jsonb_build_array(jsonb_build_object('rank',6,'category_id',pg_temp.cat_en('Water')))))),'sales: invalid input');
select pg_temp.expect('more than 9 further pairs is refused',
  pg_temp.msg(pg_temp.sv('cust',pg_temp.fx('MP1'),jsonb_build_object('name','پیمانکار چند رتبه','kind','contractor',
    'grades',(select jsonb_agg(jsonb_build_object('rank',1+(n%5),'category_id',pg_temp.cat_en('Water'))) from generate_series(1,10) n)))),
  'sales: invalid input');
select pg_temp.expect('refused saves kept the stored pairs',
  (select count(*)::text from public.sales_customer_grades where customer_id=pg_temp.fx('MP1')),'2');
select pg_temp.expect('a save without grades keeps them (old app)',
  (select jsonb_array_length(pg_temp.svj('cust',pg_temp.fx('MP1'),jsonb_build_object('name','پیمانکار چند رتبه','kind','contractor',
     'rank',1,'category_id',pg_temp.cat_en('Building')))->'grades')::text),'2');
select pg_temp.expect('the client cannot read the grades table',
  (pg_temp.as_scalar('cust','select count(*)::text from public.sales_customer_grades') like 'ERROR 42501%')::text,'true');
select pg_temp.expect('the client cannot call the grades helper',
  (pg_temp.as_scalar('cust',format('select private.sales_customer_set_grades(%L,%L,%L)::text',
     pg_temp.fx('company'),pg_temp.fx('MP1'),'[]')) like 'ERROR 42501%')::text,'true');
select pg_temp.expect('viewer sees the pairs on the profile',
  (select jsonb_array_length(pg_temp.as_json('viewer',format('select public.app_sales_customer(%L)',pg_temp.fx('MP1')))->'profile'->'grades')::text),'2');
update public.sales_customers set rank=3,category_id=pg_temp.cat_en('Oil and gas') where id=pg_temp.fx('MP1');
select pg_temp.expect('a further pair that becomes the first pair is dropped',
  (select string_agg(rank||':'||category_id,',') from public.sales_customer_grades where customer_id=pg_temp.fx('MP1')),
  '2:'||pg_temp.cat_en('Water'));
-- merge: the source's pairs join the target's further pairs
insert into sl_j select 'MP2',pg_temp.svj('cust',null,jsonb_build_object('name','پیمانکار مبدا','kind','contractor',
  'rank',4,'category_id',pg_temp.cat_en('Power'),
  'grades',jsonb_build_array(jsonb_build_object('rank',2,'category_id',pg_temp.cat_en('Water')),
                             jsonb_build_object('rank',5,'category_id',pg_temp.cat_en('Agriculture')))));
insert into sl_fx select 'MP2',(j->>'id')::uuid from sl_j where k='MP2';
select pg_temp.expect('merge with pairs runs',
  pg_temp.msg(pg_temp.as_scalar('setm',format('select public.app_sales_merge_customers(%L,%L)::text',pg_temp.fx('MP2'),pg_temp.fx('MP1')))),'ok');
select pg_temp.expect('target: own first pair, own further pair, then the source''s pairs without repeats',
  (select rank||':'||(select name_en from public.sales_contractor_categories where id=category_id) from public.sales_customers where id=pg_temp.fx('MP1'))
  ||' | '||(select string_agg(g.rank||':'||c.name_en,',' order by g.position) from public.sales_customer_grades g
              join public.sales_contractor_categories c on c.id=g.category_id where g.customer_id=pg_temp.fx('MP1')),
  '3:Oil and gas | 2:Water,4:Power,5:Agriculture');
update public.sales_customers set kind='government',rank=null,category_id=null where id=pg_temp.fx('MP1');
select pg_temp.expect('a customer that stops being a contractor loses its further pairs',
  (select count(*)::text from public.sales_customer_grades where customer_id=pg_temp.fx('MP1')),'0');

rollback;
