-- ERP › Sales module (FR-94, 2026-11-16).
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
    (v_role,'sales_settings','edit'),(v_role,'project_items','edit'),
    (v_role,'sales_customers','edit');  -- FR-98: holders of sales=edit got it in the migration
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
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_customers','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('seller'),v_role);
end; $$;

-- ============================================================ catalog and seed
select pg_temp.expect('catalog: 38 keys',(select count(*)::text from private.permission_keys()),'38');
select pg_temp.assert('shapes: sales RE, decide and settings edit-only, reports read-only',
  private.permission_allows('sales','read') and private.permission_allows('sales','edit')
  and private.permission_allows('sales_prices','read') and private.permission_allows('project_items','edit')
  and private.permission_allows('sales_decide','edit') and not private.permission_allows('sales_decide','read')
  and private.permission_allows('sales_settings','edit') and not private.permission_allows('sales_settings','read')
  and private.permission_allows('sales_reports','read') and not private.permission_allows('sales_reports','edit'));
select pg_temp.expect('eight keys depend on sales (FR-98: + sales_customers; FR-99: + sales_activity)',
  (select count(*)::text from private.permission_deps() where needs='sales' and key_level='read'),'8');
select pg_temp.expect('no preset or system role holds a new key',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where r.kind<>'custom' and (rp.permission like 'sales%' or rp.permission='project_items')),'0');
select pg_temp.expect('a new company is seeded on insert: 2 flows, 16 stages (incl. both Archived), settings',
  (select (select count(*) from public.sales_flows where company_id=pg_temp.fx('company'))||':'||
          (select count(*) from public.sales_stages where company_id=pg_temp.fx('company'))||':'||
          (select count(*) from public.sales_settings where company_id=pg_temp.fx('company'))),'2:16:1');
select pg_temp.assert('every table has RLS on and no client grant',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and (c.relname like 'sales\_%' or c.relname='project_nodes') and c.relkind='r'
      and (not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'select')
           or has_table_privilege('anon',c.oid,'select'))));

-- ============================================================ no permission, no module
select pg_temp.expect('nobody: bootstrap',pg_temp.msg(pg_temp.as_scalar('nobody','select public.app_sales_bootstrap()::text')),'sales: not allowed');
select pg_temp.expect('nobody: list',pg_temp.msg(pg_temp.as_scalar('nobody','select public.app_sales_list()::text')),'sales: not allowed');
select pg_temp.expect('nobody: deadlines',pg_temp.msg(pg_temp.as_scalar('nobody','select public.app_sales_deadlines()::text')),'sales: not allowed');
select pg_temp.expect('nobody: find',pg_temp.msg(pg_temp.as_scalar('nobody',$q$select public.app_sales_find_node('1')::text$q$)),'sales: not allowed');
select pg_temp.expect('nobody: create',pg_temp.msg(pg_temp.as_scalar('nobody',$q$select public.app_sales_save_record(null,'{"title":"x"}')::text$q$)),'sales: not allowed');
select pg_temp.expect('nobody: direct table read is refused',
  left(pg_temp.as_scalar('nobody','select count(*)::text from public.sales_rfps'),11),'ERROR 42501');
select pg_temp.expect('viewer cannot create',pg_temp.msg(pg_temp.as_scalar('viewer',$q$select public.app_sales_save_record(null,'{"title":"x"}')::text$q$)),'sales: not allowed');
select pg_temp.assert('admin holds every cap',
  (select bool_and(value::boolean) from jsonb_each_text(pg_temp.as_json('admin','select public.app_sales_bootstrap()')->'caps')));
select pg_temp.expect('viewer caps: nothing but reading',
  (select string_agg(key,',' order by key) from jsonb_each_text(pg_temp.as_json('viewer','select public.app_sales_bootstrap()')->'caps') where value::boolean),null);

-- ============================================================ create a bid record
update public.sales_settings set next_record_no=9001 where company_id=pg_temp.fx('company');
insert into sl_fx select 'bid',pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,
  '{"title":"12 wellheads","buyer":"Ahwaz  Kala","buyer_kind":"government","client":"NISOC","customer_ref":"REQ-1",
    "currency":"EUR","proposal_due":"2026-12-01","needs_quote":true,"quote_due":"2026-12-01","needs_bond":true,
    "bond_due":"2026-11-25","our_price":1000,"source":"email"}')::text$q$)::uuid;
select pg_temp.expect('record number from the setting, setting moved on',
  (select r.record_no||':'||s.next_record_no from public.sales_rfps r, public.sales_settings s
    where r.id=pg_temp.fx('bid') and s.company_id=pg_temp.fx('company')),'9001:9002');
select pg_temp.expect('first stage, template documents, one created event, deadlines, bid bond',
  (select pg_temp.stage_of('bid')||':'||(select count(*) from public.sales_documents where rfp_id=pg_temp.fx('bid'))
     ||':'||(select count(*) from public.sales_events where rfp_id=pg_temp.fx('bid') and kind='created')
     ||':'||(select count(*) from public.sales_deadlines where rfp_id=pg_temp.fx('bid') and auto and done_at is null)
     ||':'||(select count(*) from public.sales_bonds where rfp_id=pg_temp.fx('bid') and kind='bid' and status='needed')),
  'received:5:1:3:1');
select pg_temp.expect('customer names are matched without case or extra spaces',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,'{"title":"second","buyer":"ahwaz kala"}')::text$q$)),'ok');
select pg_temp.expect('… so there is still one Ahwaz Kala',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company') and name_key='ahwaz kala'),'1');
select pg_temp.expect('a taken number is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,'{"title":"dup","record_no":9001}')::text$q$)),'sales: record number taken');
select pg_temp.expect('a title is required',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,'{"title":"  "}')::text$q$)),'sales: title required');

-- ============================================================ who sees prices and guarantees
select pg_temp.assert('ceo list carries prices',
  (select (x->>'our_price')::numeric=1000 from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_list()')) x where x->>'record_no'='9001'));
select pg_temp.assert('viewer list has no price key at all',
  not exists (select 1 from jsonb_array_elements(pg_temp.as_json('viewer','select public.app_sales_list()')) x
    where x ?| array['our_price','winning_bid','winner_name','total_value']));
select pg_temp.expect('a seller without sales_prices saves other fields',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"our_price":5,"total_value":7,"customer_ref":"REQ-2"}')::text$q$,pg_temp.fx('bid')))),'ok');
select pg_temp.assert('… but the price keys in the request are ignored',
  (select our_price=1000 and total_value is null and customer_ref='REQ-2' from public.sales_rfps where id=pg_temp.fx('bid')));
select pg_temp.assert('a bad value is refused without echoing the row (no price in the error)',
  (select r='ERROR 22023 sales: invalid input' from (select pg_temp.as_scalar('seller',
     format($q$select public.app_sales_save_record(%L,'{"source":"fax"}')::text$q$,pg_temp.fx('bid'))) r) t));
select pg_temp.assert('… and a bad date likewise',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"proposal_due":"soon"}')::text$q$,pg_temp.fx('bid'))))='sales: invalid input');

-- ============================================================ items, numbers, prices
insert into sl_fx select 'n1',(pg_temp.as_json('eng',format($q$select public.app_project_save_node(%L,null,null,'{"description":"Wellhead","qty":2,"product_type":"WH"}')$q$,pg_temp.fx('bid')))->>'id')::uuid;
insert into sl_fx select 'n2',(pg_temp.as_json('eng',format($q$select public.app_project_save_node(%L,null,null,'{"description":"Gate valve","qty":3}')$q$,pg_temp.fx('bid')))->>'id')::uuid;
insert into sl_fx select 'n11',(pg_temp.as_json('eng',format($q$select public.app_project_save_node(%L,null,%L,'{"description":"Body"}')$q$,pg_temp.fx('bid'),pg_temp.fx('n1')))->>'id')::uuid;
select pg_temp.expect('codes follow the tree',
  (select string_agg(code,',' order by code) from public.project_nodes where rfp_id=pg_temp.fx('bid')),'9001-1,9001-1-1,9001-2');
select pg_temp.expect('eng deletes 9001-2','ok',pg_temp.msg(pg_temp.as_scalar('eng',format('select public.app_project_delete_node(%L)::text',pg_temp.fx('n2')))));
select pg_temp.expect('the next item is 9001-3: a number is never reused',
  pg_temp.as_json('eng',format($q$select public.app_project_save_node(%L,null,null,'{"description":"Choke"}')$q$,pg_temp.fx('bid')))->>'code','9001-3');
select pg_temp.expect('a parent from another record is refused',
  pg_temp.msg(pg_temp.as_scalar('eng',format($q$select public.app_project_save_node(%L,null,%L,'{"description":"x"}')::text$q$,
    (select id from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=9002),pg_temp.fx('n1')))),'sales: not found');
select pg_temp.expect('viewer cannot add items',
  pg_temp.msg(pg_temp.as_scalar('viewer',format($q$select public.app_project_save_node(%L,null,null,'{"description":"x"}')::text$q$,pg_temp.fx('bid')))),'sales: not allowed');
select pg_temp.expect('eng cannot price',
  pg_temp.msg(pg_temp.as_scalar('eng',format('select public.app_sales_set_item_price(%L,10)::text',pg_temp.fx('n1')))),'sales: not allowed');
select pg_temp.expect('ceo prices the wellhead','ok',pg_temp.msg(pg_temp.as_scalar('ceo',format('select public.app_sales_set_item_price(%L,400)::text',pg_temp.fx('n1')))));
select pg_temp.expect('our price becomes qty × unit price',(select our_price::text from public.sales_rfps where id=pg_temp.fx('bid')),'800.00');
select pg_temp.assert('viewer record: no unit price, no price keys, guarantees reduced, no payments',
  (select not (j->'record' ?| array['our_price','winning_bid','total_value'])
      and jsonb_array_length(j->'nodes')=0
      and not exists (select 1 from jsonb_array_elements(j->'bonds') b where b ?| array['amount','percent','bank','number','note'])
      and jsonb_array_length(j->'bonds')=1 and not j ? 'payments' and not j ? 'quote_revisions'
     from (select pg_temp.as_json('viewer',format('select public.app_sales_record(%L)',pg_temp.fx('bid'))) j) t));
select pg_temp.assert('ceo record: unit price and payments present',
  (select exists (select 1 from jsonb_array_elements(j->'nodes') n where (n->>'unit_price')::numeric=400) and j ? 'payments'
     from (select pg_temp.as_json('ceo',format('select public.app_sales_record(%L)',pg_temp.fx('bid'))) j) t));
select pg_temp.assert('the activity log holds no price or guarantee value',
  not exists (select 1 from public.sales_events where rfp_id=pg_temp.fx('bid') and body::text ~ '(400|800|1000)'));
select pg_temp.expect('find by number: padded, with BJ',
  pg_temp.as_json('eng',$q$select public.app_sales_find_node(' bj 9001-01-001 ')$q$)->>'node_id',pg_temp.fx('n11')::text);
select pg_temp.assert('find a bare record number',
  (pg_temp.as_json('viewer',$q$select public.app_sales_find_node('9001')$q$)->>'rfp_id')::uuid=pg_temp.fx('bid'));
select pg_temp.assert('item rows are for project_items readers: viewer gets none, eng gets them',
  jsonb_array_length(pg_temp.as_json('viewer',format('select public.app_sales_record(%L)',pg_temp.fx('bid')))->'nodes')=0
  and jsonb_array_length(pg_temp.as_json('eng',format('select public.app_sales_record(%L)',pg_temp.fx('bid')))->'nodes')=3);
select pg_temp.assert('… and an item number resolves only for them',
  pg_temp.as_json('viewer',$q$select public.app_sales_find_node('9001-1')$q$) is null
  and pg_temp.as_json('eng',$q$select public.app_sales_find_node('9001-1')$q$)->>'node_id' is not null);
select pg_temp.expect('eng adds an item column','ok',
  pg_temp.msg(pg_temp.as_scalar('eng',$q$select public.app_sales_save_field(null,'{"entity":"item","label_en":"Body material","label_fa":"جنس بدنه"}')::text$q$)));
select pg_temp.expect('… its key is made from the label',
  (select key from public.sales_field_defs where company_id=pg_temp.fx('company') and entity='item'),'x_body_material');
select pg_temp.expect('eng cannot add a record field',
  pg_temp.msg(pg_temp.as_scalar('eng',$q$select public.app_sales_save_field(null,'{"entity":"rfp","label_en":"Region"}')::text$q$)),'sales: not allowed');
select pg_temp.expect('columns: known keys only',
  pg_temp.msg(pg_temp.as_scalar('eng',format($q$select public.app_project_set_columns(%L,'{"1":["qty","x_nope"]}')::text$q$,pg_temp.fx('bid')))),'sales: invalid input');
select pg_temp.expect('columns: saved','ok',
  pg_temp.msg(pg_temp.as_scalar('eng',format($q$select public.app_project_set_columns(%L,'{"1":["qty","x_body_material"],"2":["unit"]}')::text$q$,pg_temp.fx('bid')))));

-- ============================================================ stages, decision, submission
select pg_temp.expect('past the decision without deciding',
  pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('bid'),pg_temp.stage('bid','technical')))),'sales: decision required');
select pg_temp.expect('a bid cannot be moved into Lost by hand',
  pg_temp.msg(pg_temp.as_scalar('ceo',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('bid'),pg_temp.stage('bid','lost')))),'sales: stage not available');
select pg_temp.expect('seller moves to the decision stage','ok',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_move_stage(%L,%L,%L,'please decide')::text$q$,pg_temp.fx('bid'),pg_temp.stage('bid','decision'),pg_temp.fx('ceo')))));
select pg_temp.expect('the next owner is recorded',(select owner_id::text from public.sales_rfps where id=pg_temp.fx('bid')),pg_temp.fx('ceo')::text);
select pg_temp.expect('seller cannot decide',
  pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_decide(%L,true)::text',pg_temp.fx('bid')))),'sales: not allowed');
select pg_temp.expect('ceo decides to bid','ok',pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_decide(%L,true,'good fit')::text$q$,pg_temp.fx('bid')))));
select pg_temp.expect('… and the record moves on one stage',pg_temp.stage_of('bid'),'technical');
update public.sales_stages set required='{customer_ref,x_region}' where id=pg_temp.stage('bid','technical');
select pg_temp.expect('required fields block the move forward',
  pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('bid'),pg_temp.stage('bid','ready')))),'sales: required fields missing');
update public.sales_stages set required='{customer_ref}' where id=pg_temp.stage('bid','technical');
select pg_temp.expect('submitted, with delivery details','ok',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_move_stage(%L,%L,null,null,'{"submitted_on":"2026-11-20","delivery_method":"courier","validity_days":90}')::text$q$,
    pg_temp.fx('bid'),pg_temp.stage('bid','submitted')))));
select pg_temp.expect('proposal and quote deadlines close; offer validity = submitted + 90',
  (select string_agg(kind||'='||due_on||case when done_at is null then ':open' else ':done' end,',' order by kind)
     from public.sales_deadlines where rfp_id=pg_temp.fx('bid') and kind in ('proposal_due','quote_due','offer_valid_until')),
  'offer_valid_until=2027-02-18:open,proposal_due=2026-12-01:done,quote_due=2026-12-01:done');
select pg_temp.expect('the quote is snapshotted at submission',
  (select count(*)||':'||max(unit_price)||':'||max(quoted_on) from public.sales_quote_lines where rfp_id=pg_temp.fx('bid')),'1:400.00:2026-11-20');
select pg_temp.expect('fin issues the bid bond',pg_temp.msg(pg_temp.as_scalar('fin',format(
  $q$select public.app_sales_save_bond(%L,%L,'{"status":"issued","amount":50,"bank":"Melli","expires_on":"2027-03-01"}')::text$q$,
  pg_temp.fx('bid'),(select id from public.sales_bonds where rfp_id=pg_temp.fx('bid') and kind='bid')))),'ok');
select pg_temp.expect('bond due closes; an expiry deadline opens',
  (select string_agg(kind||case when done_at is null then ':open' else ':done' end,',' order by kind)
     from public.sales_deadlines where rfp_id=pg_temp.fx('bid') and kind in ('bond_due','bond_expires')),'bond_due:done,bond_expires:open');
select pg_temp.assert('no deadline label carries a guarantee detail',
  not exists (select 1 from public.sales_deadlines where rfp_id=pg_temp.fx('bid') and auto and label is not null));
select pg_temp.expect('seller cannot touch guarantees',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_save_bond(%L,null,'{"kind":"performance"}')::text$q$,pg_temp.fx('bid')))),'sales: not allowed');
select pg_temp.expect('price history finds the quoted line (ceo)',
  jsonb_array_length(pg_temp.as_json('ceo',$q$select public.app_sales_price_history('well wh')$q$))::text,'1');
select pg_temp.expect('price history is closed to a reader without prices',
  pg_temp.msg(pg_temp.as_scalar('viewer',$q$select public.app_sales_price_history('')::text$q$)),'sales: not allowed');

-- ============================================================ result → contract
select pg_temp.expect('seller cannot record the result',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_result(%L,'won','{}')::text$q$,pg_temp.fx('bid')))),'sales: not allowed');
select pg_temp.expect('ceo records a win','ok',pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_result(%L,'won','{"winning_bid":800,"winner_name":"us"}')::text$q$,pg_temp.fx('bid')))));
select pg_temp.expect('won: contract flow, first stage, value = our price, offer validity closed',
  (select f.kind||':'||pg_temp.stage_of('bid')||':'||r.bid_result||':'||r.total_value||':'||
      (select (done_at is not null)::text from public.sales_deadlines where rfp_id=r.id and kind='offer_valid_until')
     from public.sales_rfps r join public.sales_flows f on f.id=r.flow_id where r.id=pg_temp.fx('bid')),'contract:new:won:800.00:true');
select pg_temp.expect('finishing a contract needs sales_decide',
  pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('bid'),pg_temp.stage('contract','finish')))),'sales: not allowed');
select pg_temp.expect('a closed record is read-only for a seller',
  (select pg_temp.msg(pg_temp.as_scalar('ceo',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('bid'),pg_temp.stage('contract','finish'))))
     ||'/'||pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"customer_ref":"z"}')::text$q$,pg_temp.fx('bid'))))),'ok/sales: not allowed');
select pg_temp.expect('closed: no notes, documents or deadlines from a seller',
  (select pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_comment(%L,'late note')::text$q$,pg_temp.fx('bid'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_save_document(%L,null,'{"name":"extra"}')::text$q$,pg_temp.fx('bid'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_save_deadline(%L,null,'{"label":"x","due_on":"2027-01-01"}')::text$q$,pg_temp.fx('bid'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_set_deadline_done(%L,true)::text',
            (select id from public.sales_deadlines where rfp_id=pg_temp.fx('bid') limit 1))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_delete_document(%L)::text',
            (select id from public.sales_documents where rfp_id=pg_temp.fx('bid') limit 1))))),
  'sales: not allowed/sales: not allowed/sales: not allowed/sales: not allowed/sales: not allowed');
select pg_temp.expect('closed: the decider still can; items and guarantees stay open to their holders',
  (select pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_comment(%L,'closing note')::text$q$,pg_temp.fx('bid'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('eng',format($q$select public.app_project_save_node(%L,null,null,'{"description":"as built"}')::text$q$,pg_temp.fx('bid'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('fin',format($q$select public.app_sales_save_payment(%L,null,'{"amount":10}')::text$q$,pg_temp.fx('bid'))))),
  'ok/ok/ok');
-- A lost bid, then reopened.
insert into sl_fx select 'lost',(select id from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=9002);
select pg_temp.expect('ceo decides not to bid',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_decide(%L,false,'too far')::text$q$,pg_temp.fx('lost')))),'ok');
select pg_temp.expect('no-bid closes the record',pg_temp.stage_of('lost'),'no_bid');
select pg_temp.expect('ceo reopens it',
  pg_temp.msg(pg_temp.as_scalar('ceo',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('lost'),pg_temp.stage('bid','received')))),'ok');
select pg_temp.expect('reopening clears the decision',(select bid_decision from public.sales_rfps where id=pg_temp.fx('lost')),'pending');

-- ============================================================ settings under live records
select pg_temp.expect('a stage with a record can be retired and renamed','ok',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_stage(%L,null,'{"active":false,"name_en":"Done","name_fa":"تمام"}')::text$q$,pg_temp.stage('contract','finish')))));
select pg_temp.assert('… the record still shows it',
  (pg_temp.as_json('viewer',format('select public.app_sales_record(%L)',pg_temp.fx('bid')))->'record'->>'stage_id')::uuid=pg_temp.stage('contract','finish'));
update public.sales_stages set active=true where id=pg_temp.stage('contract','finish');
select pg_temp.expect('a flow keeps one open stage',
  (select pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_stage(%L,null,'{"active":false}')::text$q$,pg_temp.stage('contract','new'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_stage(%L,null,'{"active":false}')::text$q$,pg_temp.stage('contract','current'))))
   ||'/'||pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_stage(%L,null,'{"active":false}')::text$q$,pg_temp.stage('contract','hold'))))),
  'ok/ok/sales: flow needs an open stage');
update public.sales_stages set active=true where flow_id=(select flow_id from public.sales_stages where id=pg_temp.stage('contract','new'));
select pg_temp.expect('seller cannot change settings',
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_save_settings('{"warn_days":3}')::text$q$)),'sales: not allowed');
select pg_temp.expect('next number must be above the highest',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_settings('{"next_record_no":9001}')::text$q$)),'sales: record number taken');

-- ============================================================ ledger import
create temp table sl_imp(k text primary key,j jsonb);
grant select on sl_imp to authenticated;
insert into sl_imp values('first',pg_temp.as_json('ceo',$q$select public.app_sales_import('B1.xlsx','[
  {"rec":8030,"buyer":"Hafari Shomal","client":"NISOC","kind":"government","customer_ref":"HNE 1","description":"Manual valve",
   "total_value":551858,"currency":"EUR","status":"Finish","in_charge":"Mostafa J","delivery_date":"2020-01-01","contract_start":"2019-01-01",
   "bonds":[{"kind":"performance","seq":1,"percent":0.1,"form":"bank","amount":55185.8}],"payments":[{"seq":1,"amount":100,"paid_on":"2019-02-01"}],
   "custom":{"Region":"South"}},
  {"rec":"8049","buyer":"Sanaye Mes","description":"Pinch valve","total_value":17700000000,"currency":"IRR","status":"current",
   "delivery_date":"2099-01-01","in_charge":"Fixture seller"},
  {"rec":null,"buyer":"x"},
  {"rec":9001,"buyer":"overwrite attempt","description":"nope"}]','["Region"]',
  jsonb_build_object('Mostafa J',(select id from sl_fx where k='fin')))$q$));
select pg_temp.expect('created 2, skipped 2 (no Rec; a record made in the app)',
  (select (j->>'created')||':'||(j->>'updated')||':'||(j->>'skipped')||':'||
     (select string_agg(x->>'reason',',' order by x->>'reason') from jsonb_array_elements(j->'skipped_rows') x) from sl_imp where k='first'),
  '2:0:2:bad_rec,exists_in_app');
select pg_temp.expect('the app record is untouched',(select title from public.sales_rfps where id=pg_temp.fx('bid')),'12 wellheads');
select pg_temp.expect('status maps to the stage; owner by the preview choice and by name; extra field kept',
  (select string_agg(r.record_no||'='||s.code||'/'||coalesce((select k from sl_fx where id=r.owner_id),'-')||'/'||coalesce(r.custom->>'x_region','-'),',' order by r.record_no)
     from public.sales_rfps r join public.sales_stages s on s.id=r.stage_id where r.company_id=pg_temp.fx('company') and r.record_no in (8030,8049)),
  '8030=finish/fin/South,8049=current/seller/-');
select pg_temp.expect('guarantee and payment rows; imported contracts count as won',
  (select (select count(*) from public.sales_bonds b where b.rfp_id=r.id and b.imported and b.status='issued')||':'||
          (select count(*) from public.sales_payments p where p.rfp_id=r.id)||':'||r.bid_result
     from public.sales_rfps r where r.record_no=8030 and r.company_id=pg_temp.fx('company')),'1:1:won');
select pg_temp.expect('old dates come in done; a future delivery date is open',
  (select string_agg(r.record_no||case when d.done_at is null then ':open' else ':done' end,',' order by r.record_no)
     from public.sales_deadlines d join public.sales_rfps r on r.id=d.rfp_id where d.kind='delivery_due' and r.record_no in (8030,8049)),
  '8030:done,8049:open');
select pg_temp.expect('the next number is past the import only when it is higher',
  (select next_record_no::text from public.sales_settings where company_id=pg_temp.fx('company')),'9003');
-- Someone works on 8049 here, then the ledger is imported again with changes.
insert into sl_fx select 'r8049',id from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=8049;
select pg_temp.expect('seller moves 8049 to Hold','ok',
  pg_temp.msg(pg_temp.as_scalar('seller',format('select public.app_sales_move_stage(%L,%L)::text',pg_temp.fx('r8049'),pg_temp.stage('contract','hold')))));
update public.sales_stages set name_en='Completed' where id=pg_temp.stage('contract','finish');
insert into sl_imp values('second',pg_temp.as_json('ceo',$q$select public.app_sales_import('B1.xlsx','[
  {"rec":8030,"description":"Manual valve","total_value":600000,"status":"finish","bonds":[{"kind":"performance","seq":1,"percent":0.12}]},
  {"rec":8049,"status":"current","project_site":"Kerman"}]')$q$));
select pg_temp.expect('re-import updates, no duplicates',
  (select (j->>'created')||':'||(j->>'updated')||':'||(select count(*) from public.sales_rfps where company_id=pg_temp.fx('company') and record_no in (8030,8049))
     from sl_imp where k='second'),'0:2:2');
select pg_temp.expect('new values land; empty cells keep what was there; the stage survives a rename',
  (select r.total_value||':'||c.name||':'||pg_temp.stage_of_no(8030)||':'||(select percent||'/'||form||'/'||amount from public.sales_bonds b where b.rfp_id=r.id)
     from public.sales_rfps r join public.sales_customers c on c.id=r.buyer_id where r.record_no=8030 and r.company_id=pg_temp.fx('company')),
  '600000.00:Hafari Shomal:finish:0.12/bank/55185.80');
select pg_temp.expect('a record worked on here keeps its stage, takes the new site',
  (select pg_temp.stage_of('r8049')||':'||project_site from public.sales_rfps where id=pg_temp.fx('r8049')),'hold:Kerman');
select pg_temp.expect('removing the first batch keeps both: the re-import wrote them too',
  pg_temp.as_json('ceo',format('select public.app_sales_remove_batch(%L)',(select j->>'batch_id' from sl_imp where k='first')))::text,
  '{"kept": 2, "deleted": 0}');
select pg_temp.expect('removing the second deletes the untouched record only',
  pg_temp.as_json('ceo',format('select public.app_sales_remove_batch(%L)',(select j->>'batch_id' from sl_imp where k='second')))::text,
  '{"kept": 1, "deleted": 1}');
select pg_temp.expect('… and customers nobody uses',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company') and name='Hafari Shomal'),'0');
select pg_temp.expect('an importer without prices or guarantees writes neither',
  (select (pg_temp.as_json('admin',$q$select public.app_sales_import('x','[{"rec":7000,"description":"a","total_value":5}]')$q$)->>'created')),'1');

-- ============================================================ read-only and isolation
select pg_temp.expect('other company: record not found',
  pg_temp.msg(pg_temp.as_scalar('other_admin',format('select public.app_sales_record(%L)::text',pg_temp.fx('bid')))),'sales: not found');
select pg_temp.expect('other company: empty list',pg_temp.as_scalar('other_admin','select public.app_sales_list()::text'),'[]');
select pg_temp.expect('other company cannot edit by id',
  pg_temp.msg(pg_temp.as_scalar('other_admin',format($q$select public.app_sales_comment(%L,'hi')::text$q$,pg_temp.fx('bid')))),'sales: not found');
set local transaction_read_only = on;
select pg_temp.assert('every read function works in a read-only transaction (View as)',
  pg_temp.as_json('viewer','select public.app_sales_bootstrap()') is not null
  and pg_temp.as_json('viewer','select public.app_sales_list()') is not null
  and pg_temp.as_json('viewer',format('select public.app_sales_record(%L)',pg_temp.fx('bid'))) is not null
  and pg_temp.as_json('viewer','select public.app_sales_deadlines(true)') is not null
  and pg_temp.as_json('ceo',$q$select public.app_sales_price_history('')$q$) is not null);
rollback;
