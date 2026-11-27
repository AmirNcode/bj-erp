-- ERP › Sales change history (FR-99, 2026-11-27): coverage of every Sales function, product / settings /
-- import / Name matching logs, deadline done event, Activity gate + filters + paging, append-only,
-- privacy strip, bootstrap cap.
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
-- The newest audit row of the fixture company (optionally of one action).
create function pg_temp.last_audit(p_action text default null) returns public.sales_audit language sql as $$
  select * from public.sales_audit where company_id=pg_temp.fx('company') and (p_action is null or action=p_action)
   order by at desc, id desc limit 1;
$$;
-- Activity page as p_user.
create function pg_temp.act(p_user text,p jsonb) returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format('select public.app_sales_activity(%L::jsonb)',p::text));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Sales history fixture');
  insert into sl_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','SH');
  for who in select * from (values
    ('admin','admin','9990990001'),('s1','employee','9990990002'),('r1','employee','9990990003'),
    ('act','employee','9990990004'),('pager','employee','9990990005')
    ) t(k,role,code) loop
    insert into sl_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@history-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
  end loop;
  -- s1: records + settings (no customers, no activity)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','ShEdit') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_settings','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('s1'),v_role);
  -- r1: read only
  insert into public.roles(company_id,kind,name) values(v_company,'custom','ShRead') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('r1'),v_role);
  -- act: read + Activity page (no sales_customers: sees no private values)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','ShAct') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read'),(v_role,'sales_activity','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('act'),v_role);
  -- pager: records only (actor of the paging rows)
  insert into public.roles(company_id,kind,name) values(v_company,'custom','ShPager') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('pager'),v_role);
  perform private.sales_ensure(v_company);
end $$;

-- ================================================================ 1. catalog
select pg_temp.expect('catalog has 38 keys',(select count(*)::text from private.permission_keys()),'38');
select pg_temp.assert('sales_activity is read only and needs sales',
  private.permission_allows('sales_activity','read') and not private.permission_allows('sales_activity','edit')
  and exists (select 1 from private.permission_deps() where key='sales_activity' and key_level='read' and needs='sales'));
select pg_temp.expect('no role is granted sales_activity by the migration',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where rp.permission='sales_activity' and r.company_id<>pg_temp.fx('company')),'0');

-- ================================================================ 2. coverage
-- Every public app_sales_* / app_project_* function is in exactly one list. A new Sales write
-- function must log (private.sales_log, or sales_touch / a sales_events row for records) and be
-- added to `logs`; a reader goes to `readonly` (and must be stable).
create temp table hist_lists(list text not null,name text not null);
insert into hist_lists select 'logs',unnest(array[
  'app_project_delete_node','app_project_save_node','app_project_set_columns',
  'app_sales_add_customer','app_sales_archive','app_sales_comment','app_sales_customer_import',
  'app_sales_decide','app_sales_delete_bond','app_sales_delete_currency','app_sales_delete_deadline',
  'app_sales_delete_document','app_sales_delete_payment','app_sales_delete_product','app_sales_delete_record',
  'app_sales_file_commit','app_sales_file_delete','app_sales_import','app_sales_import_inquiries',
  'app_sales_match_person','app_sales_merge_customers','app_sales_move_stage','app_sales_order_stages',
  'app_sales_remove_alias','app_sales_remove_batch','app_sales_remove_customer_batch','app_sales_rename_customer',
  'app_sales_restore_record','app_sales_result','app_sales_save_bond','app_sales_save_category',
  'app_sales_save_city','app_sales_save_currency','app_sales_save_customer','app_sales_save_deadline',
  'app_sales_save_document','app_sales_save_field','app_sales_save_payment','app_sales_save_product',
  'app_sales_save_record','app_sales_save_settings','app_sales_save_stage','app_sales_save_title',
  'app_sales_set_deadline_done','app_sales_set_item_price']);
insert into hist_lists select 'readonly',unnest(array[
  'app_sales_activity','app_sales_activity_people','app_sales_aliases','app_sales_bootstrap','app_sales_customer','app_sales_customer_batches',
  'app_sales_customer_history',
  'app_sales_customer_import_preview','app_sales_customer_lists','app_sales_customers','app_sales_deadlines',
  'app_sales_file_get','app_sales_find_node','app_sales_list','app_sales_list_page','app_sales_metrics',
  'app_sales_people_to_match','app_sales_price_history','app_sales_product_history','app_sales_products',
  'app_sales_record','app_sales_record_numbers','app_sales_report','app_sales_similar_customers']);
-- Pending upload rows: no user-visible change until app_sales_file_commit (which logs).
insert into hist_lists select 'exempt',unnest(array['app_sales_file_begin','app_sales_file_abort']);
select pg_temp.expect('coverage: every Sales function is listed',
  (select coalesce(string_agg(p.proname,',' order by p.proname),'') from pg_proc p
    where p.pronamespace='public'::regnamespace
      and (p.proname like 'app\_sales\_%' or p.proname like 'app\_project\_%')
      and p.proname not in (select name from hist_lists)),'');
select pg_temp.expect('coverage: every listed name exists',
  (select coalesce(string_agg(h.name,',' order by h.name),'') from hist_lists h
    where not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=h.name)),'');
select pg_temp.expect('coverage: a name is in one list only',
  (select (count(*)-count(distinct name))::text from hist_lists),'0');
select pg_temp.expect('coverage: read-only functions are stable, the others volatile',
  (select coalesce(string_agg(h.name,',' order by h.name),'') from hist_lists h
     join pg_proc p on p.pronamespace='public'::regnamespace and p.proname=h.name
    where (h.list='readonly') <> (p.provolatile='s')),'');

-- ================================================================ 3. helpers
select pg_temp.assert('diff: changed keys only, private marked, <name>_id dropped next to {id,name}',
  private.sales_diff('{"a":1,"b":2,"category_id":"x","category":{"id":"x","name":"n"}}',
                     '{"a":5,"b":2,"category_id":"y","category":{"id":"y","name":"m"},"c":true}','{a}')
  = '[{"field":"a","from":1,"to":5,"private":true},{"field":"c","from":null,"to":true},
      {"field":"category","from":{"id":"x","name":"n"},"to":{"id":"y","name":"m"}}]'::jsonb);
select pg_temp.expect('diff: nothing changed = []',private.sales_diff('{"a":1}','{"a":1}')::text,'[]');
-- strip (Review Focus 1): no private value survives for a caller without sales_customers
select pg_temp.assert('strip: values gone, private_changed set',
  (select position('"1"' in s::text)=0 and position('"2"' in s::text)=0 and position('"x"' in s::text)=0
          and s->>'private_changed'='true' and s->'changes'->0 = '{"field":"ceo_phone","private":true}'::jsonb
          and s->'merged' = '{"private_changed":true}'::jsonb
     from (select private.sales_strip_private(
       '{"changes":[{"field":"ceo_phone","from":"1","to":"2","private":true}],"merged":{"ceo_name":"x"}}',false) s) t));
select pg_temp.assert('strip: a holder sees the body unchanged',
  private.sales_strip_private('{"changes":[{"field":"ceo_phone","from":"1","to":"2","private":true}],"merged":{"ceo_name":"x"}}',true)
  = '{"changes":[{"field":"ceo_phone","from":"1","to":"2","private":true}],"merged":{"ceo_name":"x"}}'::jsonb);
select pg_temp.assert('strip: nested (import rows), a private field name without the flag, people / contacts keys',
  (select position('Tehran' in s::text)=0 and position('0912' in s::text)=0 and position('Ali' in s::text)=0
          and s->'rows'->0->'changes'->0 = '{"field":"address","private":true}'::jsonb
          and s->'snapshot' = '{"name":"Co","private_changed":true}'::jsonb and s->>'private_changed'='true'
     from (select private.sales_strip_private(
       '{"rows":[{"changes":[{"field":"address","from":"Tehran","to":"Tehran 2"}]}],
         "snapshot":{"name":"Co","people":[{"name":"Ali","phones":["0912"]}],"contacts":[]}}',false) s) t));
select pg_temp.assert('strip: a body without private parts is unchanged',
  private.sales_strip_private('{"op":"created","name":"x","changes":[{"field":"name","from":null,"to":"x"}]}',false)
  = '{"op":"created","name":"x","changes":[{"field":"name","from":null,"to":"x"}]}'::jsonb);

-- ================================================================ 4. products
insert into sl_fx select 'prod',pg_temp.as_scalar('s1',
  $q$select public.app_sales_save_product(null,'{"name_fa":"شیر","name_en":"Valve","code":"V1"}')::text$q$)::uuid;
select pg_temp.expect('product: rename',pg_temp.msg(pg_temp.as_scalar('s1',
  format($q$select public.app_sales_save_product(%L,'{"name_fa":"شیر توپی"}')::text$q$,pg_temp.fx('prod')))),'ok');
select pg_temp.expect('product: a save that changes nothing',pg_temp.msg(pg_temp.as_scalar('s1',
  format($q$select public.app_sales_save_product(%L,'{"name_fa":"شیر توپی"}')::text$q$,pg_temp.fx('prod')))),'ok');
select pg_temp.expect('product: delete',pg_temp.msg(pg_temp.as_scalar('s1',
  format('select public.app_sales_delete_product(%L)::text',pg_temp.fx('prod')))),'ok');
select pg_temp.expect('product: three rows, created / edited / deleted (the empty save logs nothing)',
  (select string_agg(action,',' order by at,id) from public.sales_audit
    where entity='product' and entity_id=pg_temp.fx('prod')),'created,edited,deleted');
select pg_temp.assert('product: edited body = name_fa old → new',
  (select body->'changes' = '[{"field":"name_fa","from":"شیر","to":"شیر توپی"}]'::jsonb
          and actor_id=pg_temp.fx('s1') and entity_label='شیر توپی' and company_id=pg_temp.fx('company')
     from public.sales_audit where entity_id=pg_temp.fx('prod') and action='edited'));
select pg_temp.assert('product: created body lists the snapshot keys',
  (select (select array_agg(c->>'field' order by c->>'field') from jsonb_array_elements(body->'changes') c)
          = array['active','code','fields','name_en','name_fa','position']
     from public.sales_audit where entity_id=pg_temp.fx('prod') and action='created'));
select pg_temp.expect('product: history for a read-only Sales user, newest first, with names',
  (select string_agg((x->>'action')||':'||(x->>'actor_name'),',' order by o)
     from jsonb_array_elements(pg_temp.as_json('r1',
            format('select public.app_sales_product_history(%L)',pg_temp.fx('prod')))) with ordinality t(x,o)),
  'deleted:Fixture s1,edited:Fixture s1,created:Fixture s1');

-- ================================================================ 5. settings
select pg_temp.expect('settings: new currency',pg_temp.msg(pg_temp.as_scalar('s1',
  $q$select public.app_sales_save_currency('TST','{"name_fa":"تست","name_en":"Test"}')::text$q$)),'ok');
select pg_temp.expect('settings: currency created',
  (select action||':'||(body->>'op')||':'||(body->>'code') from pg_temp.last_audit()),'currency:created:TST');
select pg_temp.expect('settings: hide the currency',pg_temp.msg(pg_temp.as_scalar('s1',
  $q$select public.app_sales_save_currency('TST','{"active":false}')::text$q$)),'ok');
select pg_temp.expect('settings: currency hidden',
  (select action||':'||(body->>'op')||':'||(body->'changes')::text from pg_temp.last_audit()),
  'currency:hidden:[{"to": false, "from": true, "field": "active"}]');
select pg_temp.expect('settings: delete the currency',pg_temp.msg(pg_temp.as_scalar('s1',
  $q$select public.app_sales_delete_currency('TST')::text$q$)),'ok');
select pg_temp.expect('settings: currency deleted',
  (select action||':'||(body->>'op') from pg_temp.last_audit()),'currency:deleted');
insert into sl_fx select 'cat',id from public.sales_contractor_categories
 where company_id=pg_temp.fx('company') order by position limit 1;
select pg_temp.expect('settings: rename a category',pg_temp.msg(pg_temp.as_scalar('s1',
  format($q$select public.app_sales_save_category('{"id":"%s","name_fa":"رشته آزمایشی","name_en":"Test category"}')::text$q$,
         pg_temp.fx('cat')))),'ok');
select pg_temp.expect('settings: category edited, by id',
  (select action||':'||(body->>'op')||':'||(body->>'name')||':'||(entity_id=pg_temp.fx('cat'))::text
     ||':'||(select string_agg(c->>'field',',' order by c->>'field') from jsonb_array_elements(body->'changes') c)
     from pg_temp.last_audit()),'category:edited:رشته آزمایشی:true:name_en,name_fa');
insert into sl_fx select 'city',id from public.sales_cities where company_id=pg_temp.fx('company') order by name_fa limit 1;
select pg_temp.expect('settings: hide a city',pg_temp.msg(pg_temp.as_scalar('s1',
  (select format($q$select public.app_sales_save_city(%L::jsonb)::text$q$,
                 jsonb_build_object('id',id,'name_fa',name_fa,'name_en',name_en,'active',false))
     from public.sales_cities where id=pg_temp.fx('city')))),'ok');
select pg_temp.expect('settings: city hidden',
  (select action||':'||(body->>'op')||':'||(body->'changes')::text from pg_temp.last_audit()),
  'city:hidden:[{"to": false, "from": true, "field": "active"}]');
insert into sl_fx select 'flow',id from public.sales_flows where company_id=pg_temp.fx('company') and kind='bid';
select pg_temp.expect('settings: reorder the bid stages (reversed)',pg_temp.msg(pg_temp.as_scalar('s1',
  format('select public.app_sales_order_stages(%L,%L::uuid[])::text',pg_temp.fx('flow'),
    (select array_agg(id order by position desc) from public.sales_stages where flow_id=pg_temp.fx('flow'))))),'ok');
select pg_temp.assert('settings: stage_order row, order = the new order',
  (select action='stage_order' and entity_id=pg_temp.fx('flow')
          and body->'order'->>0 = (select name_fa from public.sales_stages where flow_id=pg_temp.fx('flow') order by position limit 1)
          and body->'from' = (select jsonb_agg(name_fa order by position desc) from public.sales_stages where flow_id=pg_temp.fx('flow'))
     from pg_temp.last_audit()));
select pg_temp.expect('settings: the same order again logs nothing',
  (select pg_temp.msg(pg_temp.as_scalar('s1',format('select public.app_sales_order_stages(%L,%L::uuid[])::text',pg_temp.fx('flow'),
     (select array_agg(id order by position) from public.sales_stages where flow_id=pg_temp.fx('flow')))))
   ||':'||(select count(*) from public.sales_audit where company_id=pg_temp.fx('company') and action='stage_order')),'ok:1');
select pg_temp.expect('settings: rename a stage',pg_temp.msg(pg_temp.as_scalar('s1',
  (select format($q$select public.app_sales_save_stage(%L,null,'{"name_fa":"مرحله آزمایشی"}')::text$q$,id)
     from public.sales_stages where flow_id=pg_temp.fx('flow') order by position limit 1))),'ok');
select pg_temp.expect('settings: stage edited',
  (select action||':'||(body->>'op')||':'||(body->'changes'->0->>'field')||':'||(body->'changes'->0->>'to') from pg_temp.last_audit()),
  'stage:edited:name_fa:مرحله آزمایشی');
select pg_temp.expect('settings: new record field',pg_temp.msg(pg_temp.as_scalar('s1',
  $q$select public.app_sales_save_field(null,'{"entity":"rfp","label_fa":"منطقه","label_en":"Zone"}')::text$q$)),'ok');
select pg_temp.expect('settings: field created',
  (select action||':'||(body->>'op')||':'||(body->>'key') from pg_temp.last_audit()),'field:created:x_zone');
select pg_temp.expect('settings: general settings',pg_temp.msg(pg_temp.as_scalar('s1',
  $q$select public.app_sales_save_settings('{"warn_days":11}')::text$q$)),'ok');
select pg_temp.expect('settings: general row',
  (select action||':'||(body->'changes')::text from pg_temp.last_audit()),
  'general:[{"to": 11, "from": 7, "field": "warn_days"}]');
-- Name matching of an employee, then removing the alias
select pg_temp.expect('name match: add',pg_temp.msg(pg_temp.as_scalar('s1',
  format($q$select public.app_sales_match_person('History Person',%L)::text$q$,pg_temp.fx('pager')))),'ok');
select pg_temp.expect('name match: logged',
  (select action||':'||(body->>'op')||':'||(body->>'name')||':'||(body->>'profile_name')||':'||(entity_id=pg_temp.fx('pager'))::text
     from pg_temp.last_audit()),'name_match:added:History Person:Fixture pager:true');
select pg_temp.expect('name match: remove the alias',pg_temp.msg(pg_temp.as_scalar('s1',
  (select format('select public.app_sales_remove_alias(%L)::text',id) from public.sales_name_aliases
    where company_id=pg_temp.fx('company') and kind='person'))),'ok');
select pg_temp.expect('name match: removal logged',
  (select action||':'||(body->>'op')||':'||(body->>'name') from pg_temp.last_audit()),'name_match:removed:History Person');
-- A customer alias (made here directly; customer functions are tested in the phone book file)
do $$
declare v_c uuid;
begin
  insert into public.sales_customers(company_id,name,name_key) values(pg_temp.fx('company'),'شرکت تاریخچه',
    private.sales_name_key('شرکت تاریخچه')) returning id into v_c;
  insert into sl_fx values('cust',v_c);
  insert into public.sales_name_aliases(company_id,kind,alias_key,alias,target_id)
    values(pg_temp.fx('company'),'customer',private.sales_name_key('تاریخچه قدیم'),'تاریخچه قدیم',v_c);
end $$;
select pg_temp.expect('customer alias: remove',pg_temp.msg(pg_temp.as_scalar('s1',
  (select format('select public.app_sales_remove_alias(%L)::text',id) from public.sales_name_aliases
    where company_id=pg_temp.fx('company') and kind='customer'))),'ok');
select pg_temp.expect('customer alias: logged on the customer',
  (select entity||':'||action||':'||(body->>'name')||':'||entity_label||':'||(entity_id=pg_temp.fx('cust'))::text
     from pg_temp.last_audit()),'customer:alias_removed:تاریخچه قدیم:شرکت تاریخچه:true');

-- ================================================================ 6. imports
select pg_temp.expect('ledger import',
  pg_temp.as_json('s1',$q$select public.app_sales_import('history-ledger.csv','[{"rec":900501,"description":"History ledger","status":"current"}]')$q$)->>'created','1');
select pg_temp.assert('ledger import: one import row with the counts, by batch id',
  (select entity='import' and action='ledger_import' and entity_label='history-ledger.csv'
          and body->>'file'='history-ledger.csv' and (body->>'created')::int=1 and (body->>'updated')::int=0
          and entity_id=(select id from public.sales_import_batches where company_id=pg_temp.fx('company') and file_name='history-ledger.csv')
     from pg_temp.last_audit()));
select pg_temp.expect('ledger import: the creation source is cleared after the call',
  coalesce(current_setting('bj.sales_source',true),''),'');
-- Review fix (20261127120000): an extra column the import turns into a record field is a logged Settings change.
-- In a savepoint: the later Activity counts stay as they were.
savepoint fr99_field;
select pg_temp.expect('ledger import with an extra column',
  pg_temp.as_json('s1',$q$select public.app_sales_import('history-ledger-2.csv',
    '[{"rec":900503,"description":"History ledger 2","status":"current","custom":{"Site manager":"Karimi"}}]',
    '["Site manager"]')$q$)->>'created','1');
select pg_temp.assert('ledger import: the new record field is logged settings/field created (source import), once',
  (select count(*)=1 and bool_and(a.entity_id=d.id and a.body->>'op'='created' and a.body->>'source'='import'
                                  and a.body->>'key'=d.key and a.entity_label='Site manager' and a.actor_id=pg_temp.fx('s1'))
     from public.sales_audit a join public.sales_field_defs d
       on d.company_id=pg_temp.fx('company') and d.entity='rfp' and d.label_en='Site manager'
    where a.company_id=pg_temp.fx('company') and a.entity='settings' and a.action='field' and a.entity_id=d.id));
select pg_temp.expect('ledger import: the same column again creates and logs no second field',
  pg_temp.as_json('s1',$q$select public.app_sales_import('history-ledger-3.csv',
    '[{"rec":900503,"description":"History ledger 2","status":"current","custom":{"Site manager":"Rahimi"}}]',
    '["Site manager"]')$q$)->>'updated'
  ||'/'||(select count(*) from public.sales_audit a where a.company_id=pg_temp.fx('company') and a.entity='settings'
            and a.action='field' and a.entity_label='Site manager'),'1/1');
rollback to savepoint fr99_field;
select pg_temp.expect('inquiry import',
  pg_temp.as_json('s1',$q$select public.app_sales_import_inquiries(null,'history-inquiries.csv','[{"rec":900502,"description":"History inquiry"}]','{}','2026-06-01',true)$q$)->>'created','1');
select pg_temp.assert('inquiry import: one import row with the counts',
  (select entity='import' and action='inquiry_import' and body->>'file'='history-inquiries.csv'
          and (body->>'created')::int=1 and (body->>'last')::boolean and body ? 'by_result'
     from pg_temp.last_audit()));

-- ================================================================ 7. deadline done / reopened (Review Focus 2)
insert into sl_fx select 'rec',pg_temp.as_scalar('s1',
  $q$select public.app_sales_save_record(null,'{"title":"History deadline","proposal_due":"2026-12-01"}')::text$q$)::uuid;
insert into sl_fx select 'dl',id from public.sales_deadlines where rfp_id=pg_temp.fx('rec') and auto and kind='proposal_due';
select pg_temp.expect('deadline: mark done',pg_temp.msg(pg_temp.as_scalar('s1',
  format('select public.app_sales_set_deadline_done(%L,true)::text',pg_temp.fx('dl')))),'ok');
select pg_temp.expect('deadline: un-mark',pg_temp.msg(pg_temp.as_scalar('s1',
  format('select public.app_sales_set_deadline_done(%L,false)::text',pg_temp.fx('dl')))),'ok');
select pg_temp.expect('deadline: un-mark again changes nothing',pg_temp.msg(pg_temp.as_scalar('s1',
  format('select public.app_sales_set_deadline_done(%L,false)::text',pg_temp.fx('dl')))),'ok');
select pg_temp.expect('deadline: the automatic deadline stays open',
  (select (done_at is null)::text from public.sales_deadlines where id=pg_temp.fx('dl')),'true');
select pg_temp.expect('deadline: two events, done then reopened, with the deadline kind',
  (select string_agg((body->>'done')||'/'||(body->'deadline'->>'kind'),',' order by at,id) from public.sales_events
    where rfp_id=pg_temp.fx('rec') and kind='edit' and body ? 'deadline'),'true/proposal_due,false/proposal_due');

-- ================================================================ 8. Activity page
select pg_temp.expect('activity: a read-only Sales user is refused',
  pg_temp.msg(pg_temp.as_scalar('r1',$q$select public.app_sales_activity('{}')::text$q$)),'sales: not allowed');
select pg_temp.expect('activity: an editor without the permission is refused',
  pg_temp.msg(pg_temp.as_scalar('s1',$q$select public.app_sales_activity('{}')::text$q$)),'sales: not allowed');
select pg_temp.assert('activity: act gets audit and record rows',
  (select bool_or(x->>'source'='audit') and bool_or(x->>'source'='record')
     from jsonb_array_elements(pg_temp.act('act','{}')->'rows') x));
select pg_temp.assert('activity: entity product = product rows only',
  (select count(*)=3 and bool_and(x->>'entity'='product' and x->>'entity_label' is not null and not (x->>'exists')::boolean)
     from jsonb_array_elements(pg_temp.act('act','{"entity":"product"}')->'rows') x));
select pg_temp.assert('activity: actor filter',
  (select count(*)>0 and bool_and(x->>'actor_id'=pg_temp.fx('s1')::text and x->>'actor_name'='Fixture s1')
     from jsonb_array_elements(pg_temp.act('act',jsonb_build_object('actor',pg_temp.fx('s1')))->'rows') x));
select pg_temp.assert('activity: record rows carry number · title, exist, and no import events',
  (select count(*)>0 and bool_and(x->>'entity'='record' and x->>'action'<>'import' and (x->>'exists')::boolean)
          and bool_or(x->>'entity_id'=pg_temp.fx('rec')::text and x->>'entity_label' like '% · History deadline')
     from jsonb_array_elements(pg_temp.act('act','{"entity":"record"}')->'rows') x));
select pg_temp.assert('activity: imported records did get an import event (left out above)',
  exists (select 1 from public.sales_events where company_id=pg_temp.fx('company') and kind='import'));
select pg_temp.assert('activity: import rows link their batch',
  (select count(*)=2 and bool_and((x->>'exists')::boolean)
     from jsonb_array_elements(pg_temp.act('act','{"entity":"import"}')->'rows') x));
select pg_temp.expect('activity: today (Tehran) has rows, a past range none',
  (select (jsonb_array_length(pg_temp.act('act',jsonb_build_object('from',d,'to',d))->'rows')>0)::text
          ||':'||jsonb_array_length(pg_temp.act('act','{"from":"2000-01-01","to":"2000-01-31"}')->'rows')
     from (select (now() at time zone 'Asia/Tehran')::date::text d) t),'true:0');
select pg_temp.expect('activity: a bad filter is refused',
  pg_temp.msg(pg_temp.as_scalar('act',$q$select public.app_sales_activity('{"entity":"leave"}')::text$q$)),'sales: invalid input');
-- paging: 60 rows of one actor
insert into public.sales_audit(company_id,actor_id,entity,entity_label,action)
  select pg_temp.fx('company'),pg_temp.fx('pager'),'settings','page '||g,'general' from generate_series(1,60) g;
create temp table hist_pages(n int primary key,j jsonb);
insert into hist_pages select 1,pg_temp.act('act',jsonb_build_object('actor',pg_temp.fx('pager')));
insert into hist_pages select 2,pg_temp.act('act',jsonb_build_object('actor',pg_temp.fx('pager'),'before',j->'next'))
  from hist_pages where n=1;
select pg_temp.expect('activity: page 1 = 50 + next, page 2 = 10, no next',
  (select jsonb_array_length(a.j->'rows')||':'||(a.j->'next' <> 'null'::jsonb)::text||':'
          ||jsonb_array_length(b.j->'rows')||':'||(b.j->'next')::text
     from hist_pages a, hist_pages b where a.n=1 and b.n=2),'50:true:10:null');
select pg_temp.expect('activity: the pages cover all 60 rows once',
  (select count(distinct x->>'id')::text from hist_pages, jsonb_array_elements(j->'rows') x),'60');
-- a soft-deleted record: hidden from act, shown to the admin as gone
select pg_temp.expect('activity: admin removes the record',pg_temp.msg(pg_temp.as_scalar('admin',
  format('select public.app_sales_delete_record(%L)::text',pg_temp.fx('rec')))),'ok');
select pg_temp.expect('activity: act no longer sees its events',
  (select count(*)::text from jsonb_array_elements(pg_temp.act('act','{"entity":"record"}')->'rows') x
    where x->>'entity_id'=pg_temp.fx('rec')::text),'0');
select pg_temp.assert('activity: the admin still does, marked gone',
  (select count(*)>0 and bool_and(not (x->>'exists')::boolean)
     from jsonb_array_elements(pg_temp.act('admin','{"entity":"record"}')->'rows') x
    where x->>'entity_id'=pg_temp.fx('rec')::text));
-- privacy at read time: act has no sales_customers
insert into public.sales_audit(company_id,actor_id,entity,entity_id,entity_label,action,body)
  values(pg_temp.fx('company'),pg_temp.fx('admin'),'customer',pg_temp.fx('cust'),'شرکت تاریخچه','edited',
         '{"changes":[{"field":"ceo_phone","from":"09120000001","to":"09120000002","private":true}]}');
select pg_temp.assert('activity: act sees "private details changed", never the numbers',
  (select position('0912000000' in r::text)=0
          and (select bool_or((x->'body'->>'private_changed')::boolean) from jsonb_array_elements(r->'rows') x)
     from (select pg_temp.act('act','{"entity":"customer"}') r) t));
select pg_temp.assert('activity: the admin (sales_customers) sees them',
  position('09120000002' in pg_temp.act('admin','{"entity":"customer"}')::text)>0);

-- ================================================================ 9. append-only
select pg_temp.expect('append-only: no grant to update',
  left(pg_temp.as_scalar('s1',$q$update public.sales_audit set action='x'$q$),11),'ERROR 42501');
grant update, delete on public.sales_audit to authenticated;
select pg_temp.expect('append-only: even with a grant, update is refused by the trigger',
  pg_temp.msg(pg_temp.as_scalar('s1',$q$update public.sales_audit set action='x'$q$)),'sales: history is read-only');
select pg_temp.expect('append-only: delete too',
  pg_temp.msg(pg_temp.as_scalar('s1',$q$delete from public.sales_audit$q$)),'sales: history is read-only');
revoke update, delete on public.sales_audit from authenticated;
select pg_temp.expect('append-only: nothing changed',
  (select count(*)::text from public.sales_audit where action='x'),'0');

-- ================================================================ 10. bootstrap cap
select pg_temp.expect('bootstrap: caps.activity for act / s1 / admin',
  (pg_temp.as_json('act','select public.app_sales_bootstrap()')->'caps'->>'activity')||':'
  ||(pg_temp.as_json('s1','select public.app_sales_bootstrap()')->'caps'->>'activity')||':'
  ||(pg_temp.as_json('admin','select public.app_sales_bootstrap()')->'caps'->>'activity'),'true:false:true');

-- ================================================================ 11. read-only safe (View as)
set local transaction_read_only = on;
select pg_temp.assert('the history readers work in a read-only transaction',
  jsonb_typeof(pg_temp.act('act','{}')->'rows')='array'
  and jsonb_array_length(pg_temp.as_json('r1',format('select public.app_sales_product_history(%L)',pg_temp.fx('prod'))))=3);

-- The Activity person filter: only people with a Sales permission at edit level (owner, 2026-11-27).
select pg_temp.assert('activity people: an edit holder is listed, read-only holders are not',
  (select bool_or((x->>'id')::uuid=pg_temp.fx('s1')) and not bool_or((x->>'id')::uuid in (pg_temp.fx('r1'),pg_temp.fx('act')))
     from jsonb_array_elements(pg_temp.as_json('act','select public.app_sales_activity_people()')) x));
select pg_temp.assert('activity people needs sales_activity',
  pg_temp.msg(pg_temp.as_scalar('r1','select public.app_sales_activity_people()::text'))='sales: not allowed');

rollback;
