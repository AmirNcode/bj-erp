-- ERP › Sales customer phone book + customer history (FR-99, 2026-11-27): titles list, phone book save,
-- completeness (phones, grade_or_activity, Private), deploy-swap keys, people diff, privacy of history
-- bodies, import with titles / CEO phone / activity, merge of phone books, creation source, batch undo.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
begin;
drop index public.user_roles_one_admin;
create temp table pb_fx(k text primary key,id uuid not null);
grant select on pb_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from pb_fx where k=p_key;
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
create function pg_temp.sv(p_user text,p_id uuid,p jsonb) returns text language sql as $$
  select pg_temp.as_scalar(p_user,format('select public.app_sales_save_customer(%L,%L::jsonb)::text',p_id,p::text));
$$;
create function pg_temp.svj(p_user text,p_id uuid,p jsonb) returns jsonb language sql as $$
  select pg_temp.sv(p_user,p_id,p)::jsonb;
$$;
create function pg_temp.title(p_name text) returns uuid language sql as $$
  select id from public.sales_contact_titles where company_id=pg_temp.fx('company') and name_fa=p_name;
$$;
create function pg_temp.cat(p_en text) returns uuid language sql as $$
  select id from public.sales_contractor_categories where company_id=pg_temp.fx('company') and name_en=p_en;
$$;
create function pg_temp.city(p_prov text) returns uuid language sql as $$
  select id from public.sales_cities where company_id=pg_temp.fx('company') and province_code=p_prov order by name_fa limit 1;
$$;
create function pg_temp.city_name(p_prov text) returns text language sql as $$
  select name_fa from public.sales_cities where company_id=pg_temp.fx('company') and province_code=p_prov order by name_fa limit 1;
$$;
-- A customer's audit actions, oldest first.
create function pg_temp.acts(p_id uuid) returns text language sql as $$
  select string_agg(action,',' order by at,id) from public.sales_audit where entity='customer' and entity_id=p_id;
$$;
create function pg_temp.missing(p_id uuid) returns text language sql as $$
  select coalesce(array_to_string(missing,','),'') from public.sales_customers where id=p_id;
$$;
create function pg_temp.hist(p_user text,p_id uuid) returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format('select public.app_sales_customer_history(%L)',p_id));
$$;
-- Every complete field for a customer of p_kind (the caller adds the rest).
create function pg_temp.full(p_name text,p_kind text) returns jsonb language sql as $$
  select jsonb_build_object('name',p_name,'name_en',p_name||' EN','kind',p_kind,'ceo_name','مدیرعامل '||p_name,
    'province_code','KZ','city_id',pg_temp.city('KZ'),'address','نشانی '||p_name);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Phone book fixture');
  insert into pb_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','PB');
  for who in select * from (values
    ('h','9990970001'),('r','9990970002'),('st','9990970003'),('act','9990970004'),('imp','9990970005')
    ) t(k,code) loop
    insert into pb_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@phonebook-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee');
  end loop;
  -- h: customers holder (records + customers)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','PbHolder') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_customers','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('h'),v_role);
  -- r: Sales read only
  insert into public.roles(company_id,kind,name) values(v_company,'custom','PbRead') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('r'),v_role);
  -- st: settings (titles, merge, rename, ledger batch removal)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','PbSet') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_settings','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('st'),v_role);
  -- act: Activity page, no sales_customers (sees no private values)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','PbAct') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read'),(v_role,'sales_activity','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('act'),v_role);
  -- imp: customers + import
  insert into public.roles(company_id,kind,name) values(v_company,'custom','PbImp') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_customers','edit'),
    (v_role,'sales_customers_import','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('imp'),v_role);
end $$;

-- ================================================================ 1. titles
select pg_temp.expect('a new company gets the 12 seed titles in order',
  (select string_agg(name_en,'|' order by position) from public.sales_contact_titles where company_id=pg_temp.fx('company')),
  'Chairman of the board|Deputy CEO|Commercial manager|Procurement manager|Purchasing expert|Technical manager|'
  ||'Engineering manager|Project manager|QC manager|Planning manager|Finance manager|Office / secretary');
select private.sales_ensure(pg_temp.fx('company'));
select pg_temp.expect('ensure again adds no title',
  (select count(*)::text from public.sales_contact_titles where company_id=pg_temp.fx('company')),'12');
select pg_temp.expect('a customers holder cannot save a title',
  pg_temp.as_scalar('h',$q$select public.app_sales_save_title('{"name_fa":"سمت ممنوع"}')::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('settings: create a title',
  pg_temp.as_json('st',$q$select public.app_sales_save_title('{"name_fa":"مدیر ارشد فروش","name_en":"Senior sales"}')$q$)->>'position','13');
insert into pb_fx select 'T1',pg_temp.title('مدیر ارشد فروش');
select pg_temp.expect('settings: rename it (name_en absent = kept)',
  pg_temp.as_json('st',format($q$select public.app_sales_save_title('{"id":"%s","name_fa":"مدیر ارشد بازار"}')$q$,pg_temp.fx('T1')))->>'name_en',
  'Senior sales');
select pg_temp.expect('settings: hide it',
  pg_temp.as_json('st',format($q$select public.app_sales_save_title('{"id":"%s","name_fa":"مدیر ارشد بازار","active":false}')$q$,pg_temp.fx('T1')))->>'active',
  'false');
select pg_temp.expect('settings: a taken name is a duplicate',
  pg_temp.msg(pg_temp.as_scalar('st',$q$select public.app_sales_save_title('{"name_fa":"مدير فني"}')::text$q$)),'sales: duplicate name');
select pg_temp.expect('settings: an empty name is invalid',
  pg_temp.msg(pg_temp.as_scalar('st',$q$select public.app_sales_save_title('{"name_fa":"  "}')::text$q$)),'sales: invalid input');
select pg_temp.expect('title saves are logged: created, edited, hidden',
  (select string_agg(body->>'op',',' order by at,id) from public.sales_audit
    where entity='settings' and action='title' and entity_id=pg_temp.fx('T1')),'created,edited,hidden');
select pg_temp.assert('lists: a customers holder gets only active titles',
  (select jsonb_array_length(l->'titles')=12 and not exists (select 1 from jsonb_array_elements(l->'titles') t where t->>'id'=pg_temp.fx('T1')::text)
     from (select pg_temp.as_json('h','select public.app_sales_customer_lists()') l) x));
select pg_temp.assert('lists: a settings holder also gets the hidden one, with active / position',
  (select jsonb_array_length(l->'titles')=13
          and exists (select 1 from jsonb_array_elements(l->'titles') t where t->>'id'=pg_temp.fx('T1')::text and t->>'active'='false')
     from (select pg_temp.as_json('st','select public.app_sales_customer_lists()') l) x));

-- ================================================================ 2. save: phone book
create temp table pb_j(k text primary key,j jsonb not null);
grant select on pb_j to authenticated;
insert into pb_fx select 'T2',(pg_temp.as_json('st',$q$select public.app_sales_save_title('{"name_fa":"سمت آزمایشی"}')$q$)->>'id')::uuid;
insert into pb_j select 'X',pg_temp.svj('h',null,pg_temp.full('شرکت دفترچه','contractor')||jsonb_build_object(
  'rank',2,'category_id',pg_temp.cat('Building'),'ceo_phone','۰۹۱۲-۱۲۳ ۴۵۶۷',
  'people',jsonb_build_array(
    jsonb_build_object('name','رضا','title_id',pg_temp.title('مدیر کنترل کیفیت'),'email','Reza@Example.com',
      'phones',jsonb_build_array(jsonb_build_object('label','office','phone','02112345678'),
                                 jsonb_build_object('label','mobile','phone','09120000011'))),
    jsonb_build_object('name','سارا','title_id',pg_temp.fx('T2'),'phones','[]'::jsonb),
    jsonb_build_object('name',null,'title_id',null,'phones',jsonb_build_array(jsonb_build_object('label','fax','phone','02112345679'))),
    jsonb_build_object('name','  ','title_id','','email',null,'phones',jsonb_build_array(jsonb_build_object('label','office','phone',''))))));
insert into pb_fx select 'X',(j->>'id')::uuid from pb_j where k='X';
select pg_temp.expect('save: 3 entries kept (the all-empty one dropped), numbers 2/0/1',
  (select string_agg(jsonb_array_length(e->'phones')::text,'/' order by o) from pb_j, jsonb_array_elements(j->'people') with ordinality t(e,o) where k='X'),
  '2/0/1');
select pg_temp.expect('save: CEO phone normalized, email lower-cased, entry title names returned',
  (select (j->>'ceo_phone')||'|'||(j->'people'->0->>'email')||'|'||(j->'people'->0->>'title_en')||'|'||(j->'people'->0->>'title_active')
     from pb_j where k='X'),'09121234567|reza@example.com|QC manager|true');
select pg_temp.expect('save: the company line has no name and no title',
  (select coalesce(j->'people'->2->>'name','-')||coalesce(j->'people'->2->>'title_id','-') from pb_j where k='X'),'--');
select pg_temp.expect('save: complete contractor with a full pair and numbers',(select jsonb_array_length(j->'missing')::text from pb_j where k='X'),'0');
select pg_temp.expect('save: logged once as created, by the holder',
  (select string_agg(action||':'||(actor_id=pg_temp.fx('h'))::text,',') from public.sales_audit where entity_id=pg_temp.fx('X')),'created:true');
select pg_temp.assert('save: the created body lists given values only, people as one change',
  (select (select array_agg(c->>'field' order by c->>'field') from jsonb_array_elements(body->'changes') c)
          = array['address','category','ceo_name','ceo_phone','city','kind','name','name_en','people','province','rank']
          and (select c->>'added' from jsonb_array_elements(body->'changes') c where c->>'field'='people')='3'
     from public.sales_audit where entity_id=pg_temp.fx('X') and action='created'));
select pg_temp.expect('save: 6 numbers in one entry is refused',
  pg_temp.msg(pg_temp.sv('h',null,jsonb_build_object('name','شش شماره','people',jsonb_build_array(jsonb_build_object('name','x',
    'phones',(select jsonb_agg(jsonb_build_object('label','office','phone','0211234560'||n)) from generate_series(1,6) n)))))),
  'sales: invalid input');
select pg_temp.expect('save: a bad number is refused',
  pg_temp.msg(pg_temp.sv('h',null,jsonb_build_object('name','شماره بد','people',jsonb_build_array(jsonb_build_object('name','x',
    'phones',jsonb_build_array(jsonb_build_object('label','office','phone','12'))))))),'sales: invalid input');
select pg_temp.expect('save: an unknown label is refused',
  pg_temp.msg(pg_temp.sv('h',null,jsonb_build_object('name','برچسب بد','people',jsonb_build_array(jsonb_build_object('name','x',
    'phones',jsonb_build_array(jsonb_build_object('label','pager','phone','02112345678'))))))),'sales: invalid input');
select pg_temp.expect('save: more than 50 entries is refused',
  pg_temp.msg(pg_temp.sv('h',null,jsonb_build_object('name','پنجاه و یک',
    'people',(select jsonb_agg(jsonb_build_object('name','p'||n)) from generate_series(1,51) n)))),'sales: invalid input');
select pg_temp.expect('save: a title of another company is refused',
  pg_temp.msg(pg_temp.sv('h',null,jsonb_build_object('name','سمت غریبه','people',jsonb_build_array(jsonb_build_object('name','x',
    'title_id',(select id from public.sales_contact_titles where company_id<>pg_temp.fx('company') limit 1)))))),'sales: invalid input');
select pg_temp.expect('save: nothing was written by the refused saves',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company')),'1');
-- hidden titles: not for new picks, kept where they are
select pg_temp.msg(pg_temp.as_scalar('st',format($q$select public.app_sales_save_title('{"id":"%s","name_fa":"سمت آزمایشی","active":false}')::text$q$,pg_temp.fx('T2'))));
select pg_temp.expect('save: a hidden title on a new customer is refused',
  pg_temp.msg(pg_temp.sv('h',null,jsonb_build_object('name','سمت پنهان','people',jsonb_build_array(jsonb_build_object('name','x','title_id',pg_temp.fx('T2')))))),
  'sales: invalid input');
select pg_temp.expect('save: a hidden title the entry already had is kept',
  (select p->'people'->1->>'title_active'||'/'||(p->'people'->1->>'title_id')
     from (select pg_temp.svj('h',pg_temp.fx('X'),pg_temp.full('شرکت دفترچه','contractor')||jsonb_build_object(
       'rank',2,'category_id',pg_temp.cat('Building'),'ceo_phone','09121234567',
       'people',(select j->'people' from pb_j where k='X'))) p) t),'false/'||pg_temp.fx('T2')::text);
select pg_temp.expect('save: an identical re-save logs nothing',pg_temp.acts(pg_temp.fx('X')),'created');

-- ================================================================ 3. missing (completeness)
create function pg_temp.mk(p_key text,p jsonb) returns void language sql as $$
  insert into pb_fx select p_key,(pg_temp.svj('h',null,p)->>'id')::uuid;
$$;
select pg_temp.mk('G1',pg_temp.full('دولتی کامل','government')||'{"activity":"آبرسانی شهری","ceo_phone":"09121230000"}');
select pg_temp.expect('missing: government with an activity description and only the CEO line is complete',pg_temp.missing(pg_temp.fx('G1')),'');
select pg_temp.mk('G2',pg_temp.full('دولتی بی‌شرح','government')||'{"ceo_phone":"09121230001","rank":3}');
select pg_temp.expect('missing: government without a description lacks grade_or_activity (a rank is never kept)',
  pg_temp.missing(pg_temp.fx('G2'))||'/'||coalesce((select rank::text from public.sales_customers where id=pg_temp.fx('G2')),'null'),
  'grade_or_activity/null');
select pg_temp.mk('C1',pg_temp.full('پیمانکار نیمه','contractor')||'{"ceo_phone":"09121230002","rank":4}');
select pg_temp.expect('missing: contractor with a rank only lacks category and grade_or_activity',pg_temp.missing(pg_temp.fx('C1')),'category,grade_or_activity');
select pg_temp.mk('C3',pg_temp.full('پیمانکار رسته','contractor')||jsonb_build_object('ceo_phone','09121230005','category_id',pg_temp.cat('Water')));
select pg_temp.expect('missing: contractor with a category only lacks rank and grade_or_activity',pg_temp.missing(pg_temp.fx('C3')),'rank,grade_or_activity');
select pg_temp.mk('C2',pg_temp.full('پیمانکار شرح','contractor')||'{"ceo_phone":"09121230003","activity":"نصب تجهیزات"}');
select pg_temp.expect('missing: contractor with a description and no pair is complete',pg_temp.missing(pg_temp.fx('C2')),'');
select pg_temp.mk('N1',pg_temp.full('بی‌شماره','government')||'{"activity":"x"}');
select pg_temp.expect('missing: no number anywhere lacks phones',pg_temp.missing(pg_temp.fx('N1')),'phones');
select pg_temp.mk('P1',pg_temp.full('خصوصی رتبه‌دار','private')||jsonb_build_object('ceo_phone','09121230004','rank',1,
  'category_id',pg_temp.cat('Building'),'grades',jsonb_build_array(jsonb_build_object('rank',2,'category_id',pg_temp.cat('Water')))));
select pg_temp.expect('missing: private with a full pair is complete and keeps its pairs',
  pg_temp.missing(pg_temp.fx('P1'))||'/'||(select rank::text from public.sales_customers where id=pg_temp.fx('P1'))
  ||'/'||(select count(*)::text from public.sales_customer_grades where customer_id=pg_temp.fx('P1')),'/1/1');
select pg_temp.expect('missing: private → government drops rank and pairs',
  (select coalesce(p->>'rank','null')||'/'||jsonb_array_length(p->'grades')||'/'||(p->'missing'->>0)
     from (select pg_temp.svj('h',pg_temp.fx('P1'),pg_temp.full('خصوصی رتبه‌دار','government')||'{"ceo_phone":"09121230004"}') p) t),
  'null/0/grade_or_activity');
-- the triggers: a number added / removed refreshes the customer
delete from public.sales_customer_phones where contact_id in (select id from public.sales_customer_contacts where customer_id=pg_temp.fx('N1'));
insert into public.sales_customer_contacts(company_id,customer_id,person,position) values(pg_temp.fx('company'),pg_temp.fx('N1'),'تلفنچی',1);
select pg_temp.expect('missing: an entry without a number does not count',pg_temp.missing(pg_temp.fx('N1')),'phones');
insert into public.sales_customer_phones(company_id,contact_id,label,phone,position)
  select pg_temp.fx('company'),id,'office','02144445555',1 from public.sales_customer_contacts where customer_id=pg_temp.fx('N1');
select pg_temp.expect('missing: adding a number clears phones',pg_temp.missing(pg_temp.fx('N1')),'');
delete from public.sales_customer_phones where contact_id in (select id from public.sales_customer_contacts where customer_id=pg_temp.fx('N1'));
select pg_temp.expect('missing: removing the last number brings phones back',pg_temp.missing(pg_temp.fx('N1')),'phones');

-- ================================================================ 4. deploy swap: the old app's keys
select pg_temp.expect('swap: a save with only name / kind keeps people, CEO phone and activity',
  (select jsonb_array_length(p->'people')||'/'||(p->>'ceo_phone')||'/'||(p->>'activity')
     from (select pg_temp.svj('h',pg_temp.fx('C2'),'{"name":"پیمانکار شرح","kind":"contractor"}') p) t),
  '0/09121230003/نصب تجهیزات');
select pg_temp.expect('swap: X keeps its 3 entries after an old-app save that sends contacts',
  (select jsonb_array_length(p->'people')::text
     from (select pg_temp.svj('h',pg_temp.fx('X'),pg_temp.full('شرکت دفترچه','contractor')||jsonb_build_object(
       'rank',2,'category_id',pg_temp.cat('Building'),'contacts','[]'::jsonb)) p) t),'3');
select pg_temp.assert('swap: the profile has people and no contacts key',
  (select p ? 'people' and not (p ? 'contacts') from (select pg_temp.as_json('h',format('select public.app_sales_customer(%L)->''profile''',pg_temp.fx('X'))) p) t));

-- ================================================================ 5. diff_people (Review Focus 3)
insert into pb_j select 'Y',pg_temp.svj('h',null,jsonb_build_object('name','بیست نفر',
  'people',(select jsonb_agg(jsonb_build_object('name','نفر '||n,'phones',jsonb_build_array(jsonb_build_object('label','mobile','phone','0912000'||lpad(n::text,4,'0'))))
                      order by n) from generate_series(1,20) n)));
insert into pb_fx select 'Y',(j->>'id')::uuid from pb_j where k='Y';
select pg_temp.expect('diff: one number changed in a 20-entry book',
  pg_temp.msg(pg_temp.sv('h',pg_temp.fx('Y'),jsonb_build_object('name','بیست نفر',
    'people',(select jsonb_agg(jsonb_build_object('name','نفر '||n,'phones',jsonb_build_array(jsonb_build_object('label','mobile',
      'phone',case when n=7 then '09129999999' else '0912000'||lpad(n::text,4,'0') end)))) from generate_series(1,20) n)))),'ok');
select pg_temp.expect('diff: exactly one edited row',pg_temp.acts(pg_temp.fx('Y')),'created,edited');
select pg_temp.assert('diff: one people change: changed 1, added 0, removed 0, entry 7 old → new',
  (select jsonb_array_length(body->'changes')=1 and body->'changes'->0->>'field'='people'
          and body->'changes'->0->>'changed'='1' and body->'changes'->0->>'added'='0' and body->'changes'->0->>'removed'='0'
          and body->'changes'->0->'from'->0->>'position'='7' and body->'changes'->0->'to'->0->'phones'->0->>'phone'='09129999999'
          and (body->'changes'->0->>'private')::boolean
     from public.sales_audit where entity_id=pg_temp.fx('Y') and action='edited'));

-- ================================================================ 6. rename / alias
select pg_temp.expect('rename runs',pg_temp.msg(pg_temp.as_scalar('st',format('select public.app_sales_rename_customer(%L,%L)::text',pg_temp.fx('Y'),'بیست و یک نفر'))),'ok');
select pg_temp.assert('rename: renamed {from, to} + alias_added {name}',
  (select string_agg(action,',' order by at,id)='renamed,alias_added'
          and bool_or(action='renamed' and body->>'from'='بیست نفر' and body->>'to'='بیست و یک نفر')
          and bool_or(action='alias_added' and body->>'name'='بیست نفر')
     from public.sales_audit where entity_id=pg_temp.fx('Y') and action in ('renamed','alias_added')));
select pg_temp.expect('save with a new name runs',
  pg_temp.msg(pg_temp.sv('h',pg_temp.fx('G1'),pg_temp.full('دولتی نو','government')||'{"activity":"آبرسانی شهری","ceo_phone":"09121230000"}')),'ok');
select pg_temp.expect('save with a new name: edited + alias_added',pg_temp.acts(pg_temp.fx('G1')),'created,edited,alias_added');

-- ================================================================ 7. record text path (old app): creation source
insert into pb_fx select 'rec',pg_temp.as_scalar('h',$q$select public.app_sales_save_record(null,jsonb_build_object('title','پرونده متنی','buyer','خریدار متنی','buyer_kind','private'))::text$q$)::uuid;
insert into pb_fx select 'B',id from public.sales_customers where company_id=pg_temp.fx('company') and name='خریدار متنی';
select pg_temp.expect('record text path: created_by = caller, kind private',
  (select (created_by=pg_temp.fx('h'))::text||'/'||kind from public.sales_customers where id=pg_temp.fx('B')),'true/private');
select pg_temp.assert('record text path: customer/created with source record',
  (select count(*)=1 and bool_and(body->>'source'='record' and actor_id=pg_temp.fx('h'))
     from public.sales_audit where entity_id=pg_temp.fx('B') and action='created'));
insert into pb_j select 'add',pg_temp.as_json('h',$q$select public.app_sales_add_customer('{"name":"افزوده از فرم","kind":"private"}')$q$);
select pg_temp.expect('add_customer: created with source record, created_by set',
  (select (j->>'existed')||'/'||(select (created_by=pg_temp.fx('h'))::text from public.sales_customers where id=(j->>'id')::uuid)
          ||'/'||(select body->>'source' from public.sales_audit where entity_id=(j->>'id')::uuid and action='created')
     from pb_j where k='add'),
  'false/true/record');

-- ================================================================ 8. import: Private, CEO phone, activity, titles
create function pg_temp.prev(p_rows jsonb) returns jsonb language sql as $$
  select pg_temp.as_json('imp',format('select public.app_sales_customer_import_preview(%L::jsonb)',p_rows::text));
$$;
create function pg_temp.imp(p jsonb) returns jsonb language sql as $$
  select pg_temp.as_json('imp',format('select public.app_sales_customer_import(%L::jsonb)',p::text));
$$;
insert into pb_j select 'rows',jsonb_build_array(
  jsonb_build_object('row',1,'name','واردات خصوصی','name_en','Import Private','kind','خصوصی','ceo_name','مدیر یک',
    'ceo_phone','۰۹۱۲۱۱۱۲۲۲۲','activity','تولید لوله','province','KZ','city',pg_temp.city_name('KZ'),'address','a',
    'contact_person','مهدی','contact_title','مدیر ارشد','contact_label','موبایل','phone','09123334444'),
  jsonb_build_object('row',2,'name','واردات دو','kind','Private','contact_person','نوید','contact_title','QC Manager'),
  jsonb_build_object('row',3,'name','واردات سه','ceo_phone','12','contact_title','مدیر ارشد'));
select pg_temp.assert('preview: values carry kind private, the CEO phone and the activity',
  (select r->'rows'->0->'values'->>'kind'='private' and r->'rows'->0->'values'->>'ceo_phone'='09121112222'
          and r->'rows'->0->'values'->>'activity'='تولید لوله' and r->'rows'->1->'values'->>'kind'='private'
     from (select pg_temp.prev(j) r from pb_j where k='rows') x));
select pg_temp.assert('preview: the unknown title is listed once with its row count, never matched',
  (select jsonb_array_length(r->'unknown'->'titles')=1 and r->'unknown'->'titles'->0->>'value'='مدیر ارشد'
          and r->'unknown'->'titles'->0->>'rows'='2' and r->'rows'->0->'contact'->>'title_id' is null
          and r->'rows'->0->'unknown'->0->>'field'='title'
     from (select pg_temp.prev(j) r from pb_j where k='rows') x));
select pg_temp.assert('preview: entry shape {name, title_id, email, phones}; a known English title is matched',
  (select r->'rows'->0->'contact'->'phones' = '[{"label":"mobile","phone":"09123334444"}]'::jsonb
          and r->'rows'->1->'contact'->>'title_id'=pg_temp.title('مدیر کنترل کیفیت')::text
          and r->'rows'->1->'contact'->'phones' = '[]'::jsonb and r->'rows'->1->'contact'->>'name'='نوید'
     from (select pg_temp.prev(j) r from pb_j where k='rows') x));
select pg_temp.assert('preview: a bad CEO phone is dropped; a title-only entry is none until the title is known',
  (select r->'rows'->2->'dropped' @> '[{"field":"ceo_phone","reason":"invalid"}]'::jsonb and r->'rows'->2->'contact' = 'null'::jsonb
     from (select pg_temp.prev(j) r from pb_j where k='rows') x));
select pg_temp.expect('import: a title decision create is refused',
  pg_temp.msg(pg_temp.as_scalar('imp',format('select public.app_sales_customer_import(%L::jsonb)::text',
    jsonb_build_object('file_name','t.xlsx','rows',(select j from pb_j where k='rows'),
      'titles',jsonb_build_object(private.sales_word_key('مدیر ارشد'),jsonb_build_object('action','create')))::text))),
  'sales: invalid input');
select pg_temp.expect('import: a hidden title is refused as use',
  pg_temp.msg(pg_temp.as_scalar('imp',format('select public.app_sales_customer_import(%L::jsonb)::text',
    jsonb_build_object('file_name','t.xlsx','rows',(select j from pb_j where k='rows'),
      'titles',jsonb_build_object(private.sales_word_key('مدیر ارشد'),jsonb_build_object('action','use','id',pg_temp.fx('T1'))))::text))),
  'sales: invalid input');
insert into pb_j select 'imp1',pg_temp.imp(jsonb_build_object('file_name','phonebook.xlsx','rows',(select j from pb_j where k='rows'),'titles','{}'::jsonb));
select pg_temp.expect('import (no title decision): 3 created',(select j->>'created' from pb_j where k='imp1'),'3');
insert into pb_fx select 'I1',id from public.sales_customers where company_id=pg_temp.fx('company') and name='واردات خصوصی';
insert into pb_fx select 'I2',id from public.sales_customers where company_id=pg_temp.fx('company') and name='واردات دو';
select pg_temp.expect('import: the first customer: private, CEO phone, activity, one entry without title with its number',
  (select c.kind||'/'||c.ceo_phone||'/'||c.activity||'/'||coalesce(k.title_id::text,'null')||'/'||k.person||'/'||ph.label||':'||ph.phone
          ||'/'||(c.created_by=pg_temp.fx('imp'))::text
     from public.sales_customers c join public.sales_customer_contacts k on k.customer_id=c.id
     join public.sales_customer_phones ph on ph.contact_id=k.id where c.id=pg_temp.fx('I1')),
  'private/09121112222/تولید لوله/null/مهدی/mobile:09123334444/true');
select pg_temp.expect('import: the third row got no entry (title left empty, nothing else)',
  (select count(*)::text from public.sales_customer_contacts k join public.sales_customers c on c.id=k.customer_id
    where c.company_id=pg_temp.fx('company') and c.name='واردات سه'),'0');
select pg_temp.assert('import: one import/customer_import row + imported_created per customer',
  (select count(*) filter (where entity='import' and action='customer_import' and entity_id=(select (j->>'batch_id')::uuid from pb_j where k='imp1')
                                and body->>'created'='3')=1
          and count(*) filter (where entity='customer' and action='imported_created'
                                and body->>'batch_id'=(select j->>'batch_id' from pb_j where k='imp1'))=3
     from public.sales_audit where company_id=pg_temp.fx('company')));
insert into pb_j select 'imp2',pg_temp.imp(jsonb_build_object('file_name','again.xlsx','default_action','update',
  'rows',(select jsonb_build_array(j->0,j->1) from pb_j where k='rows')));
select pg_temp.expect('import again (update): the same numbers and the phone-less named entry are not duplicated',
  (select (j->>'updated')||'/'||(j->>'skipped')||'/'
          ||(select count(*) from public.sales_customer_contacts where customer_id=pg_temp.fx('I1'))||'/'
          ||(select count(*) from public.sales_customer_contacts where customer_id=pg_temp.fx('I2'))
     from pb_j where k='imp2'),'0/2/1/1');
insert into pb_j select 'imp3',pg_temp.imp(jsonb_build_object('file_name','mapped.xlsx',
  'rows',jsonb_build_array(jsonb_build_object('row',1,'name','واردات چهار','contact_title','مدیر ارشد','phone','02166667777')),
  'titles',jsonb_build_object(private.sales_word_key('مدیر ارشد'),
    jsonb_build_object('action','use','id',pg_temp.title('مدیر کنترل کیفیت')))));
select pg_temp.expect('import: the title mapped to QC manager is used',
  (select (j->>'created')||'/'||(select k.title_id::text from public.sales_customer_contacts k join public.sales_customers c on c.id=k.customer_id
                                   where c.company_id=pg_temp.fx('company') and c.name='واردات چهار')
     from pb_j where k='imp3'),
  '1/'||pg_temp.title('مدیر کنترل کیفیت')::text);
insert into pb_j select 'imp4',pg_temp.imp(jsonb_build_object('file_name','over.xlsx','default_action','overwrite',
  'rows',jsonb_build_array(jsonb_build_object('row',1,'name','واردات خصوصی','ceo_phone','09121113333',
    'contact_person','مهدی','phone','02188889999'))));
select pg_temp.expect('import (overwrite): a new number joins the book, the CEO phone is replaced, logged as imported_updated',
  (select (j->>'updated')||'/'||(select ceo_phone from public.sales_customers where id=pg_temp.fx('I1'))||'/'
          ||(select count(*) from public.sales_customer_contacts where customer_id=pg_temp.fx('I1'))||'/'
          ||(select string_agg(c->>'field',',' order by c->>'field') from public.sales_audit a, jsonb_array_elements(a.body->'changes') c
              where a.entity_id=pg_temp.fx('I1') and a.action='imported_updated')
     from pb_j where k='imp4'),'1/09121113333/2/ceo_phone,people');
-- a category created by an import is logged in settings
insert into pb_j select 'imp5',pg_temp.imp(jsonb_build_object('file_name','cat.xlsx',
  'rows',jsonb_build_array(jsonb_build_object('row',1,'name','واردات رسته','kind','private','rank','2','category','رسته نو')),
  'categories',jsonb_build_object(private.sales_word_key('رسته نو'),jsonb_build_object('action','create'))));
select pg_temp.expect('import: a category it creates is logged (settings / category, source import)',
  (select (j->>'created')||'/'||(select body->>'op'||':'||(body->>'source') from public.sales_audit
                                  where entity='settings' and action='category' and entity_label='رسته نو')
     from pb_j where k='imp5'),'1/created:import');

-- ================================================================ 9. merge: phone books (spec §11.4)
select pg_temp.mk('MA',jsonb_build_object('name','مبدا ادغام','kind','private','rank',2,'category_id',pg_temp.cat('Water'),
  'ceo_phone','09125550000','activity','پخش',
  'people',jsonb_build_array(
    jsonb_build_object('name','حسن','phones',jsonb_build_array(jsonb_build_object('label','office','phone','02155556666'))),
    jsonb_build_object('name','علی','title_id',pg_temp.title('مدیر پروژه')),
    jsonb_build_object('name','زهرا','phones',jsonb_build_array(jsonb_build_object('label','mobile','phone','02177778888'))))));
select pg_temp.mk('MB',jsonb_build_object('name','مقصد ادغام',
  'people',jsonb_build_array(
    jsonb_build_object('name','دفتر','phones',jsonb_build_array(jsonb_build_object('label','office','phone','02155556666'))),
    jsonb_build_object('name','علي','title_id',pg_temp.title('مدیر پروژه')))));
select pg_temp.expect('merge runs',
  pg_temp.msg(pg_temp.as_scalar('st',format('select public.app_sales_merge_customers(%L,%L)::text',pg_temp.fx('MA'),pg_temp.fx('MB')))),'ok');
select pg_temp.expect('merge: only the new entry moved (same number / same name + title skipped), after the target''s own',
  (select string_agg(coalesce(person,'-'),',' order by position) from public.sales_customer_contacts where customer_id=pg_temp.fx('MB')),
  'دفتر,علي,زهرا');
select pg_temp.expect('merge: the moved entry keeps its number',
  (select string_agg(ph.phone,',') from public.sales_customer_phones ph join public.sales_customer_contacts k on k.id=ph.contact_id
    where k.customer_id=pg_temp.fx('MB') and k.person='زهرا'),'02177778888');
select pg_temp.expect('merge: CEO phone, activity, kind private and its rank filled from the source',
  (select ceo_phone||'/'||activity||'/'||kind||'/'||rank from public.sales_customers where id=pg_temp.fx('MB')),'09125550000/پخش/private/2');
select pg_temp.assert('merge: merged_into on the removed one (its name, snapshot), merged_from on the kept one',
  (select bool_or(entity_id=pg_temp.fx('MA') and action='merged_into' and entity_label='مبدا ادغام'
                  and body->>'into_id'=pg_temp.fx('MB')::text and body->'snapshot'->>'ceo_phone'='09125550000')
          and bool_or(entity_id=pg_temp.fx('MB') and action='merged_from' and body->>'from_id'=pg_temp.fx('MA')::text
                      and body->>'from_name'='مبدا ادغام')
          and bool_or(entity_id=pg_temp.fx('MB') and action='alias_added' and body->>'name'='مبدا ادغام')
     from public.sales_audit where entity='customer'));
select pg_temp.expect('merge: the kept customer''s history holds the source''s whole history',
  (select string_agg((x->>'action')||'@'||(case when x->>'entity_id'=pg_temp.fx('MA')::text then 'A' else 'B' end),',' order by o desc)
     from jsonb_array_elements(pg_temp.hist('h',pg_temp.fx('MB'))) with ordinality t(x,o)),
  'created@A,created@B,merged_into@A,merged_from@B,alias_added@B');
-- a chain: B merged into C shows A's rows on C too
select pg_temp.mk('MC',jsonb_build_object('name','مقصد دوم'));
select pg_temp.msg(pg_temp.as_scalar('st',format('select public.app_sales_merge_customers(%L,%L)::text',pg_temp.fx('MB'),pg_temp.fx('MC'))));
select pg_temp.assert('merge chain: C''s history includes A''s created row',
  exists (select 1 from jsonb_array_elements(pg_temp.hist('r',pg_temp.fx('MC'))) x
           where x->>'entity_id'=pg_temp.fx('MA')::text and x->>'action'='created'));

-- ================================================================ 10. privacy (Review Focus 1)
select pg_temp.msg(pg_temp.sv('h',pg_temp.fx('X'),pg_temp.full('شرکت دفترچه','contractor')||jsonb_build_object(
  'rank',2,'category_id',pg_temp.cat('Building'),'ceo_phone','09127654321')));
select pg_temp.assert('privacy: the reader''s customer history shows no number, says private_changed',
  (select position('09121234567' in h::text)=0 and position('09127654321' in h::text)=0
          and position('02112345678' in h::text)=0 and position('Reza' in h::text)=0 and position('reza' in h::text)=0
          and position('private_changed' in h::text)>0
          and exists (select 1 from jsonb_array_elements(h) x, jsonb_array_elements(x->'body'->'changes') c
                       where c = '{"field":"ceo_phone","private":true}'::jsonb)
     from (select pg_temp.hist('r',pg_temp.fx('X')) h) t));
select pg_temp.assert('privacy: the holder sees old and new number',
  (select position('09121234567' in h::text)>0 and position('09127654321' in h::text)>0
     from (select pg_temp.hist('h',pg_temp.fx('X')) h) t));
select pg_temp.assert('privacy: the reader''s profile has no ceo_name, ceo_phone, address or people; activity stays',
  (select not (p ? 'ceo_phone') and not (p ? 'people') and not (p ? 'ceo_name') and not (p ? 'address') and p ? 'activity'
          and p ? 'created_by_name'
     from (select pg_temp.as_json('r',format('select public.app_sales_customer(%L)->''profile''',pg_temp.fx('X'))) p) t));
select pg_temp.assert('privacy: merge rows carry no number for the reader',
  (select position('09125550000' in h::text)=0 and position('02177778888' in h::text)=0 and position('حسن' in h::text)=0
          and position('private_changed' in h::text)>0
     from (select pg_temp.hist('r',pg_temp.fx('MC')) h) t));
select pg_temp.assert('privacy: import rows carry no number for the reader',
  (select position('09121112222' in h::text)=0 and position('09123334444' in h::text)=0 and position('09121113333' in h::text)=0
          and position('مهدی' in h::text)=0
     from (select pg_temp.hist('r',pg_temp.fx('I1')) h) t));
select pg_temp.assert('privacy: the Activity page shows no number to act (no sales_customers)',
  (select jsonb_array_length(a->'rows')>0
          and position('09121234567' in a::text)=0 and position('09127654321' in a::text)=0
          and position('09125550000' in a::text)=0 and position('09121112222' in a::text)=0
          and position('02112345678' in a::text)=0 and position('09129999999' in a::text)=0
     from (select pg_temp.as_json('act','select public.app_sales_activity(''{"entity":"customer"}''::jsonb)') a) t));
select pg_temp.expect('privacy: a Sales reader (act) may open a customer history',
  pg_temp.msg(pg_temp.as_scalar('act',format('select public.app_sales_customer_history(%L)::text',pg_temp.fx('X')))),'ok');

-- ================================================================ 11. batch undo
insert into pb_j select 'imp9',pg_temp.imp(jsonb_build_object('file_name','undo.xlsx',
  'rows',jsonb_build_array(jsonb_build_object('row',1,'name','پاک‌شدنی یک','phone','02111112222'),
                           jsonb_build_object('row',2,'name','پاک‌شدنی دو'))));
select pg_temp.expect('undo: removing the customer batch removes both',
  (select (r->>'removed')||'/'||(r->>'kept')
     from (select pg_temp.as_json('imp',format('select public.app_sales_remove_customer_batch(%L)',(select j->>'batch_id' from pb_j where k='imp9'))) r) t),
  '2/0');
select pg_temp.assert('undo: removed_by_import_undo per customer + one import/batch_removed',
  (select count(*) filter (where entity='customer' and action='removed_by_import_undo' and entity_label in ('پاک‌شدنی یک','پاک‌شدنی دو'))=2
          and count(*) filter (where entity='import' and action='batch_removed' and body->>'kind'='customers'
                                and body->>'removed'='2' and body->>'file'='undo.xlsx'
                                and entity_id=(select (j->>'batch_id')::uuid from pb_j where k='imp9'))=1
     from public.sales_audit where company_id=pg_temp.fx('company')));
-- ledger batch removal: the bare customer it made goes, with its row
insert into pb_fx values('ledger',gen_random_uuid());
insert into public.sales_import_batches(id,company_id,file_name,kind,created_at)
  values(pg_temp.fx('ledger'),pg_temp.fx('company'),'ledger.xlsx','ledger',now()-interval '1 day');
select private.sales_customer(pg_temp.fx('company'),'ورودی دفتر');
select pg_temp.expect('ledger undo runs',
  pg_temp.msg(pg_temp.as_scalar('st',format('select public.app_sales_remove_batch(%L)::text',pg_temp.fx('ledger')))),'ok');
select pg_temp.assert('ledger undo: removed_by_import_undo + batch_removed with the kind and the customer count',
  (select count(*) filter (where entity='customer' and action='removed_by_import_undo' and entity_label='ورودی دفتر')=1
          and count(*) filter (where entity='import' and action='batch_removed' and entity_id=pg_temp.fx('ledger')
                                and body->>'kind'='ledger' and body->>'customers_removed'='1')=1
     from public.sales_audit where company_id=pg_temp.fx('company')));

-- ================================================================ 12. no client access to the new tables / helpers
select pg_temp.expect('the client cannot read the phones table',
  (pg_temp.as_scalar('h','select count(*)::text from public.sales_customer_phones') like 'ERROR 42501%')::text,'true');
select pg_temp.expect('the client cannot read the titles table',
  (pg_temp.as_scalar('h','select count(*)::text from public.sales_contact_titles') like 'ERROR 42501%')::text,'true');
select pg_temp.expect('the client cannot call the phone book writer',
  (pg_temp.as_scalar('h',format('select private.sales_customer_set_people(%L,%L,%L)::text',
     pg_temp.fx('company'),pg_temp.fx('X'),'[]')) like 'ERROR 42501%')::text,'true');
select pg_temp.expect('the client cannot call the snapshot',
  (pg_temp.as_scalar('h',format('select private.sales_customer_snapshot(%L)::text',pg_temp.fx('X'))) like 'ERROR 42501%')::text,'true');

rollback;
