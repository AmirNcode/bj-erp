-- ERP › Sales name matching, aliases, table sort, filters and metrics (FR-94 sections 16.8, 16.9).
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

create function pg_temp.rfp_id(p_no integer) returns uuid language sql as $$
  select id from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=p_no;
$$;
create function pg_temp.flow_of(p_no integer) returns text language sql as $$
  select f.kind from public.sales_rfps r join public.sales_flows f on f.id=r.flow_id
   where r.company_id=pg_temp.fx('company') and r.record_no=p_no;
$$;
create function pg_temp.mk(p_no integer,p_flow text,p_code text,p_buyer text,p_client text,p_title text,p_received date,
    p_decision text,p_result text,p_cur text,p_price numeric,p_total numeric,p_owner text,p_incharge text) returns uuid
  language plpgsql as $$
declare v_id uuid:=gen_random_uuid();
begin
  insert into public.sales_rfps(id,company_id,record_no,title,buyer_id,client_id,flow_id,stage_id,received_on,
      bid_decision,bid_result,result_at,currency,our_price,total_value,owner_id,in_charge_text)
    select v_id,pg_temp.fx('company'),p_no,p_title,pg_temp.fx(p_buyer),pg_temp.fx(p_client),f.id,pg_temp.stage(p_flow,p_code),
           p_received,p_decision,p_result,case when p_result is not null then p_received+30 end,p_cur,p_price,p_total,
           pg_temp.fx(p_owner),p_incharge
      from public.sales_flows f where f.company_id=pg_temp.fx('company') and f.kind=p_flow;
  return v_id;
end; $$;
create function pg_temp.lst(p_user text,p_json text) returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format($q$select public.app_sales_list_page(%L::jsonb)$q$,p_json));
$$;
-- Record numbers of a list page, in order.
create function pg_temp.nos(p_user text,p_json text) returns text language sql as $$
  select string_agg(r->>'record_no',',' order by o) from jsonb_array_elements(pg_temp.lst(p_user,p_json)->'rows') with ordinality t(r,o);
$$;
create function pg_temp.first_n(p_user text,p_json text,p_n integer) returns text language sql as $$
  select string_agg(r->>'record_no',',' order by o) from jsonb_array_elements(pg_temp.lst(p_user,p_json)->'rows') with ordinality t(r,o) where o<=p_n;
$$;
create function pg_temp.last_no(p_user text,p_json text) returns text language sql as $$
  select (pg_temp.lst(p_user,p_json)->'rows'->-1)->>'record_no';
$$;
create function pg_temp.custs(p_user text,p_json text) returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format($q$select public.app_sales_customers(%L::jsonb)$q$,p_json));
$$;
create function pg_temp.crow(p_user text,p_key text,p_json text) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.custs(p_user,p_json)) x where x->>'id'=pg_temp.fx(p_key)::text;
$$;
create function pg_temp.met(p_user text,p_cust text,p_json text default '{}') returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format($q$select public.app_sales_metrics(%L,'2026-01-01','2025-01-01',%L::jsonb)$q$,
    case when p_cust is null then null else pg_temp.fx(p_cust)::text end,p_json));
$$;
create function pg_temp.imp(p_user text,p_rows text,p_people text default '{}') returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format($q$select public.app_sales_import_inquiries(null,'reg.csv',%L::jsonb,%L::jsonb,'2026-06-01',true)$q$,p_rows,p_people));
$$;
create function pg_temp.rec(p_no integer) returns public.sales_rfps language sql as $$
  select r from public.sales_rfps r where r.company_id=pg_temp.fx('company') and r.record_no=p_no;
$$;
create function pg_temp.ncust() returns integer language sql as $$
  select count(*)::integer from public.sales_customers where company_id=pg_temp.fx('company');
$$;
create function pg_temp.nalias() returns integer language sql as $$
  select count(*)::integer from public.sales_name_aliases where company_id=pg_temp.fx('company');
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid();
  v_dept2 uuid:=gen_random_uuid(); v_role uuid; who record; v_r uuid;
begin
  insert into public.companies(id,name) values(v_company,'Matching synthetic fixture'),(v_other,'Matching other fixture');
  insert into sl_fx values('company',v_company),('other_company',v_other);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','NM'),(v_dept2,v_other,'دیگر','Other HQ','office','NO');
  for who in select * from (values
    ('admin','admin','9990970001',v_company,v_dept),('ceo','employee','9990970002',v_company,v_dept),
    ('viewer','employee','9990970003',v_company,v_dept),('seller','employee','9990970004',v_company,v_dept),
    ('nobody','employee','9990970005',v_company,v_dept),('emp1','employee','9990970006',v_company,v_dept),
    ('emp2','employee','9990970007',v_company,v_dept),('other_ceo','employee','9990970008',v_other,v_dept2)
    ) t(k,role,code,company,dept) loop
    insert into sl_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@matching-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),who.company,who.dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
  end loop;
  insert into public.roles(company_id,kind,name) values(v_company,'custom','NmCeo') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_prices','edit'),
    (v_role,'sales_reports','read'),(v_role,'sales_settings','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ceo'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','NmViewer') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('viewer'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','NmSeller') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_prices','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('seller'),v_role);
  insert into public.roles(company_id,kind,name) values(v_other,'custom','NmOther') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_settings','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('other_ceo'),v_role);
  perform private.sales_ensure(v_company);
  perform private.sales_ensure(v_other);

  insert into sl_fx values('A',gen_random_uuid()),('B',gen_random_uuid()),('C',gen_random_uuid()),
    ('M1',gen_random_uuid()),('M2',gen_random_uuid()),('D',gen_random_uuid());
  insert into public.sales_customers(id,company_id,name,name_key,kind) values
    (pg_temp.fx('A'),v_company,'Alpha Test Co',private.sales_name_key('Alpha Test Co'),'government'),
    (pg_temp.fx('B'),v_company,'Beta Test Co',private.sales_name_key('Beta Test Co'),'contractor'),
    (pg_temp.fx('C'),v_company,'Gamma End User',private.sales_name_key('Gamma End User'),null),
    (pg_temp.fx('M1'),v_company,'Merge Source',private.sales_name_key('Merge Source'),'contractor'),
    (pg_temp.fx('M2'),v_company,'Merge Target',private.sales_name_key('Merge Target'),null),
    (pg_temp.fx('D'),v_company,'Delta Empty',private.sales_name_key('Delta Empty'),null);
  perform pg_temp.mk(900001,'bid','submitted','A','C','Wellhead valve','2026-01-10','bid',null,'EUR',100,null,'ceo',null);
  perform pg_temp.mk(900002,'bid','lost','A',null,'Valve repair','2025-05-01','bid','lost','IRR',50,null,null,'Text Person');
  perform pg_temp.mk(900003,'contract','new','A','C','Valve spares','2026-02-01','bid','won','EUR',900,1000,'ceo',null);
  perform pg_temp.mk(900004,'bid','no_bid','A',null,'Spares list','2024-03-03','no_bid',null,null,null,null,null,null);
  perform pg_temp.mk(900005,'bid','archived','A',null,'Misc item','2023-03-03','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900006,'bid','cancelled','A',null,'Misc cancelled','2023-06-06','bid','cancelled',null,null,null,null,null);
  perform pg_temp.mk(900007,'bid','received','B','C','Gamma things','2026-03-01','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900008,'contract','new','B',null,'Beta contract','2025-06-01','bid','won','IRR',null,5000,null,null);
  perform pg_temp.mk(900009,'contract','new','A',null,'Alpha contract','2026-05-01','bid','won','IRR',200,null,null,null);
  update public.sales_rfps set order_date='2025-12-15' where company_id=v_company and record_no=900009;
  perform pg_temp.mk(900010,'bid','received','M1',null,'Merge one','2026-04-01','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900011,'bid','received','M2','M1','Merge two','2026-04-02','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900012,'bid','received',null,null,'No date',null,'pending',null,null,null,null,null,null);
  perform pg_temp.mk(900013,'bid','received',null,null,'Text only','2026-06-15','pending',null,null,null,null,null,'Text Person');
  v_r:=pg_temp.rfp_id(900001);
  insert into public.sales_deadlines(company_id,rfp_id,kind,due_on,done_at) values
    (v_company,v_r,'proposal_due','2026-12-01',null),(v_company,v_r,'quote_due','2026-11-20',null),
    (v_company,v_r,'bond_due','2026-01-01',now()),
    (v_company,pg_temp.rfp_id(900005),'proposal_due','2026-01-02',null);
end; $$;

-- ============================================================ records: sort
select pg_temp.expect('sort: default is record number, newest first',pg_temp.first_n('ceo','{"state":"all"}',2),'900013,900012');
select pg_temp.expect('sort: record_no asc',pg_temp.first_n('ceo','{"state":"all","sort":"record_no","dir":"asc"}',2),'900001,900002');
select pg_temp.expect('sort: received_on asc, empty date last',
  pg_temp.first_n('ceo','{"state":"all","sort":"received_on","dir":"asc"}',1)||'/'||pg_temp.last_no('ceo','{"state":"all","sort":"received_on","dir":"asc"}'),'900005/900012');
select pg_temp.expect('sort: received_on desc (default), empty date still last',
  pg_temp.first_n('ceo','{"state":"all","sort":"received_on"}',2)||'/'||pg_temp.last_no('ceo','{"state":"all","sort":"received_on"}'),'900013,900009/900012');
select pg_temp.expect('sort: buyer asc (default), no buyer last by number',
  pg_temp.first_n('ceo','{"state":"all","sort":"buyer"}',2)||'/'||pg_temp.last_no('ceo','{"state":"all","sort":"buyer"}'),'900001,900002/900013');
select pg_temp.expect('sort: buyer desc, no buyer still last',
  pg_temp.first_n('ceo','{"state":"all","sort":"buyer","dir":"desc"}',1)||'/'||pg_temp.last_no('ceo','{"state":"all","sort":"buyer","dir":"desc"}'),'900011/900012');
select pg_temp.expect('sort: title asc and desc',
  pg_temp.first_n('ceo','{"state":"all","sort":"title"}',1)||'/'||pg_temp.first_n('ceo','{"state":"all","sort":"title","dir":"desc"}',1),'900009/900001');
select pg_temp.expect('sort: stage = position, then flow kind',
  pg_temp.nos('ceo','{"state":"all","sort":"stage"}'),
  (select string_agg(r.record_no::text,',' order by s.position*10+(case f.kind when 'bid' then 0 else 1 end),r.record_no)
     from public.sales_rfps r join public.sales_stages s on s.id=r.stage_id join public.sales_flows f on f.id=r.flow_id
    where r.company_id=pg_temp.fx('company')));
select pg_temp.expect('sort: owner asc = owner name else in-charge text, none last',
  pg_temp.first_n('ceo','{"state":"all","sort":"owner"}',4)||'/'||pg_temp.last_no('ceo','{"state":"all","sort":"owner"}'),'900001,900003,900002,900013/900012');
select pg_temp.expect('sort: owner desc',pg_temp.first_n('ceo','{"state":"all","sort":"owner","dir":"desc"}',4),'900013,900002,900003,900001');
select pg_temp.expect('sort: deadline asc = next open deadline, none last',
  pg_temp.first_n('ceo','{"state":"all","sort":"deadline"}',3),'900005,900001,900002');
select pg_temp.expect('sort: deadline desc',pg_temp.first_n('ceo','{"state":"all","sort":"deadline","dir":"desc"}',2),'900001,900005');
select pg_temp.expect('sort: value desc (default) = total value else our price, empty last',
  pg_temp.first_n('ceo','{"state":"all","sort":"value"}',5),'900008,900003,900009,900001,900002');
select pg_temp.expect('sort: value asc, empty values last by number',
  pg_temp.first_n('ceo','{"state":"all","sort":"value","dir":"asc"}',6),'900002,900001,900009,900003,900008,900004');
select pg_temp.expect('sort: without sales_prices a value sort falls back to the number',
  pg_temp.first_n('viewer','{"state":"all","sort":"value","dir":"asc"}',2),'900001,900002');
select pg_temp.expect('sort: unknown sort is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_list_page('{"sort":"price"}')::text$q$)),'sales: invalid input');
select pg_temp.expect('sort: unknown direction is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_list_page('{"dir":"up"}')::text$q$)),'sales: invalid input');
select pg_temp.expect('sort: total and truncated are kept',
  (pg_temp.lst('ceo','{"state":"all","limit":3,"sort":"title"}')->>'total')||'/'||
  (pg_temp.lst('ceo','{"state":"all","limit":3,"sort":"title"}')->>'truncated')||'/'||
  jsonb_array_length(pg_temp.lst('ceo','{"state":"all","limit":3,"sort":"title"}')->'rows'),'13/true/3');

-- ============================================================ filters (16.9)
select pg_temp.expect('list: from',(pg_temp.lst('ceo','{"state":"all","from":"2026-01-01"}')->>'total'),'7');
select pg_temp.expect('list: from + to, inclusive',(pg_temp.lst('ceo','{"state":"all","from":"2025-01-01","to":"2025-12-31"}')->>'total'),'2');
select pg_temp.expect('list: result won',(pg_temp.lst('ceo','{"state":"all","result":"won"}')->>'total'),'3');
select pg_temp.expect('list: result no_bid',pg_temp.nos('ceo','{"state":"all","result":"no_bid"}'),'900004');
select pg_temp.expect('list: result cancelled = stage kind',pg_temp.nos('ceo','{"state":"all","result":"cancelled"}'),'900006');
select pg_temp.expect('list: an empty filter value is ignored',(pg_temp.lst('ceo','{"state":"all","from":"","result":""}')->>'total'),'13');
select pg_temp.expect('list: bad date refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_list_page('{"from":"2026-13-45"}')::text$q$)),'sales: invalid input');
select pg_temp.expect('list: bad result refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_list_page('{"result":"maybe"}')::text$q$)),'sales: invalid input');

select pg_temp.expect('customers: from',pg_temp.crow('ceo','A','{"from":"2026-01-01"}')->>'records','3');
select pg_temp.expect('customers: from + to',pg_temp.crow('ceo','A','{"from":"2026-01-01","to":"2026-01-31"}')->>'records','1');
select pg_temp.expect('customers: to only',pg_temp.crow('ceo','A','{"to":"2024-12-31"}')->>'records','3');
select pg_temp.expect('customers: result won / lost / no_bid',
  concat_ws('/',pg_temp.crow('ceo','A','{"result":"won"}')->>'records',pg_temp.crow('ceo','A','{"result":"lost"}')->>'records',
    pg_temp.crow('ceo','A','{"result":"no_bid"}')->>'records'),'2/1/1');
select pg_temp.expect('customers: result open / archived / cancelled',
  concat_ws('/',pg_temp.crow('ceo','A','{"result":"open"}')->>'records',pg_temp.crow('ceo','A','{"result":"archived"}')->>'records',
    pg_temp.crow('ceo','A','{"result":"cancelled"}')->>'records'),'3/1/1');
select pg_temp.expect('customers: owner keeps only customers with a matching record',
  (select string_agg(x->>'name',',') from jsonb_array_elements(pg_temp.custs('ceo',format('{"owner":"%s"}',pg_temp.fx('ceo')))) x),'Alpha Test Co');
select pg_temp.expect('customers: kind contractor',
  (select string_agg(x->>'name',',' order by x->>'name') from jsonb_array_elements(pg_temp.custs('ceo','{"kind":"contractor"}')) x),'Beta Test Co,Merge Source');
select pg_temp.expect('customers: no filter lists the empty and client-only customers',
  (pg_temp.crow('ceo','D','{}') is not null)::text||(pg_temp.crow('ceo','C','{}') is not null)::text,'truetrue');
select pg_temp.expect('customers: any filter hides them',
  (pg_temp.crow('ceo','D','{"from":"2020-01-01"}') is null)::text||(pg_temp.crow('ceo','C','{"from":"2020-01-01"}') is null)::text,'truetrue');
select pg_temp.expect('customers: bad values refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_customers('{"owner":"abc"}')::text$q$))||'/'||
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_customers('{"kind":"x"}')::text$q$))||'/'||
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_customers('{"to":"soon"}')::text$q$))||'/'||
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_customers('[]')::text$q$)),
  'sales: invalid input/sales: invalid input/sales: invalid input/sales: invalid input');
select pg_temp.expect('customer page: owners with counts',
  (select string_agg((o->>'name')||'='||(o->>'count'),',') from jsonb_array_elements(
     pg_temp.as_json('ceo',format($q$select public.app_sales_customer(%L)->'owners'$q$,pg_temp.fx('A')))) o),'Fixture ceo=2');

-- ============================================================ customer rows: sales
select pg_temp.expect('rows: sales = won records, contract value else our price, per currency',
  (pg_temp.crow('ceo','A','{}')->'sales'->>'EUR')||'/'||(pg_temp.crow('ceo','A','{}')->'sales'->>'IRR')||'/'||
  (select count(*)::text from jsonb_object_keys(pg_temp.crow('ceo','A','{}')->'sales')),'1000.00/200.00/2');
select pg_temp.expect('rows: Beta sales',(pg_temp.crow('ceo','B','{}')->'sales'->>'IRR'),'5000.00');
select pg_temp.expect('rows: no sales key without sales_prices',(pg_temp.crow('viewer','A','{}') ? 'sales')::text,'false');
select pg_temp.expect('rows: a customer without wins has an empty sales object',(pg_temp.crow('ceo','D','{}')->'sales')::text,'{}');

-- ============================================================ metrics
select pg_temp.expect('metrics all: counts',
  concat_ws('/',pg_temp.met('ceo',null)->>'projects',pg_temp.met('ceo',null)->>'active',pg_temp.met('ceo',null)->>'won',
    pg_temp.met('ceo',null)->>'lost',pg_temp.met('ceo',null)->>'decided',(pg_temp.met('ceo',null)->>'win_rate')::numeric),'13/9/3/1/4/0.7500');
select pg_temp.expect('metrics all: customers with a record, new this year',
  (pg_temp.met('ceo',null)->>'customers')||'/'||(pg_temp.met('ceo',null)->>'new_customers'),'4/2');
select pg_temp.expect('metrics all: sales all time',
  (pg_temp.met('ceo',null)->'sales_all'->>'EUR')||'/'||(pg_temp.met('ceo',null)->'sales_all'->>'IRR'),'1000.00/5200.00');
select pg_temp.expect('metrics all: sales this year (sale date = order date, result date, ...)',
  (pg_temp.met('ceo',null)->'sales_ytd')::text,'{"EUR": 1000.00}');
select pg_temp.expect('metrics all: sales the year before (the order date moved one into it)',
  (pg_temp.met('ceo',null)->'sales_prev_year')::text,'{"IRR": 5200.00}');
select pg_temp.expect('metrics all: pipeline = our price of open bids only',(pg_temp.met('ceo',null)->'pipeline')::text,'{"EUR": 100.00}');
select pg_temp.expect('metrics all: no customer keys',((pg_temp.met('ceo',null) ? 'share')::text)||((pg_temp.met('ceo',null) ? 'last_sale_on')::text),'falsefalse');
select pg_temp.expect('metrics customer: counts',
  concat_ws('/',pg_temp.met('ceo','A')->>'projects',pg_temp.met('ceo','A')->>'active',pg_temp.met('ceo','A')->>'won',
    pg_temp.met('ceo','A')->>'lost',pg_temp.met('ceo','A')->>'decided',(pg_temp.met('ceo','A')->>'win_rate')::numeric),'7/3/2/1/3/0.6667');
select pg_temp.expect('metrics customer: sales, ytd, previous year',
  concat_ws('/',(pg_temp.met('ceo','A')->'sales_all')::text,(pg_temp.met('ceo','A')->'sales_ytd')::text,(pg_temp.met('ceo','A')->'sales_prev_year')::text),
  '{"EUR": 1000.00, "IRR": 200.00}/{"EUR": 1000.00}/{"IRR": 200.00}');
select pg_temp.expect('metrics customer: share of all sales per currency',
  (pg_temp.met('ceo','A')->'share'->>'EUR')::numeric||'/'||(pg_temp.met('ceo','A')->'share'->>'IRR')::numeric,'1.0000/0.0385');
select pg_temp.expect('metrics customer: last sale date; no customer counts',
  (pg_temp.met('ceo','A')->>'last_sale_on')||'/'||((pg_temp.met('ceo','A') ? 'customers')::text),'2026-03-03/false');
select pg_temp.expect('metrics customer: none yet = no last sale',coalesce(pg_temp.met('ceo','D')->>'last_sale_on','null'),'null');
select pg_temp.expect('metrics: no money keys without sales_prices',
  (select string_agg(k,',' order by k) from jsonb_object_keys(pg_temp.met('viewer','A')) k),'active,decided,last_sale_on,lost,projects,win_rate,won');
select pg_temp.expect('metrics: no money keys for the all view either',
  (select string_agg(k,',' order by k) from jsonb_object_keys(pg_temp.met('viewer',null)) k),'active,customers,decided,lost,new_customers,projects,win_rate,won');
select pg_temp.expect('metrics: filter result won',
  concat_ws('/',pg_temp.met('ceo',null,'{"result":"won"}')->>'projects',pg_temp.met('ceo',null,'{"result":"won"}')->>'lost',
    (pg_temp.met('ceo',null,'{"result":"won"}')->>'win_rate')::numeric),'3/0/1.0000');
select pg_temp.expect('metrics: filter from',pg_temp.met('ceo',null,'{"from":"2026-01-01"}')->>'projects','7');
select pg_temp.expect('metrics: filter kind applies to the buyer',pg_temp.met('ceo',null,'{"kind":"government"}')->>'projects','7');
select pg_temp.expect('metrics: filter owner',pg_temp.met('ceo',null,format('{"owner":"%s"}',pg_temp.fx('ceo')))->>'projects','2');
select pg_temp.expect('metrics: a customer with a filter',pg_temp.met('ceo','A','{"result":"won"}')->>'projects','2');
select pg_temp.expect('metrics: bad dates refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_metrics(null,'2025-01-01','2026-01-01')::text$q$))||'/'||
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_metrics(null,null,'2026-01-01')::text$q$)),
  'sales: invalid input/sales: invalid input');
select pg_temp.expect('metrics: bad filter refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_metrics(null,'2026-01-01','2025-01-01','{"result":"x"}')::text$q$)),'sales: invalid input');
select pg_temp.expect('metrics: unknown customer',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_metrics(%L,'2026-01-01','2025-01-01')::text$q$,gen_random_uuid()))),'sales: not found');
select pg_temp.expect('metrics: nobody refused',
  pg_temp.msg(pg_temp.as_scalar('nobody',$q$select public.app_sales_metrics(null,'2026-01-01','2025-01-01')::text$q$)),'sales: not allowed');

-- ============================================================ customer aliases
select pg_temp.expect('merge: moved count',pg_temp.as_json('ceo',format($q$select public.app_sales_merge_customers(%L,%L)$q$,pg_temp.fx('M1'),pg_temp.fx('M2')))->>'moved','2');
select pg_temp.expect('merge: the source name is saved as an alias of the target',
  (select a.alias||'>'||c.name from public.sales_name_aliases a join public.sales_customers c on c.id=a.target_id
    where a.company_id=pg_temp.fx('company') and a.kind='customer'),'Merge Source>Merge Target');
select pg_temp.expect('alias: a later inquiry import resolves the old spelling to the target',
  (select count(*)::text from public.sales_rfps where id=(pg_temp.rec(900101)).id),'0');
select pg_temp.assert('alias: import created the record on the target, no new customer',
  (select (pg_temp.imp('ceo',$j$[{"rec":900101,"buyer":"  merge   SOURCE ","description":"Aliased import","received_on":"2026-07-01","in_charge":"Ali Vaziri"}]$j$)->>'created')::integer=1));
select pg_temp.expect('alias: buyer is the target',(select buyer_id::text from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900101),pg_temp.fx('M2')::text);
select pg_temp.expect('alias: no "Merge Source" customer was created',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company') and name_key='merge source'),'0');
select pg_temp.expect('rename: the old name is an alias of the same customer',
  (pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'Beta Renamed')::text$q$,pg_temp.fx('B')))),'');
select pg_temp.expect('rename: alias saved',
  (select a.alias||'>'||c.name from public.sales_name_aliases a join public.sales_customers c on c.id=a.target_id
    where a.company_id=pg_temp.fx('company') and a.alias_key='beta test co'),'Beta Test Co>Beta Renamed');
select pg_temp.assert('rename: an import with the old name goes to the renamed customer',
  (select (pg_temp.imp('ceo',$j$[{"rec":900102,"buyer":"Beta Test Co","description":"Old spelling","received_on":"2026-07-02"}]$j$)->>'created')::integer=1));
select pg_temp.expect('rename: buyer is B',(select buyer_id::text from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900102),pg_temp.fx('B')::text);
select pg_temp.expect('rename: case-only change saves no alias',
  (select pg_temp.nalias()::text||'/'||pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'GAMMA END USER')::text$q$,pg_temp.fx('C')))||'/'||pg_temp.nalias()::text),'2//2');
select pg_temp.expect('rename: a name used by another customer is still refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'alpha test co')::text$q$,pg_temp.fx('B')))),'sales: customer exists');
select pg_temp.expect('merge again: the source aliases move to the new target, its own name is added',
  pg_temp.as_json('ceo',format($q$select public.app_sales_merge_customers(%L,%L)$q$,pg_temp.fx('M2'),pg_temp.fx('A')))->>'moved','3');
select pg_temp.expect('merge again: three aliases, customer ones pointing at Alpha except Beta',
  (select string_agg(a.alias||'>'||c.name,',' order by a.alias) from public.sales_name_aliases a join public.sales_customers c on c.id=a.target_id
    where a.company_id=pg_temp.fx('company') and a.kind='customer'),'Beta Test Co>Beta Renamed,Merge Source>Alpha Test Co,Merge Target>Alpha Test Co');
select pg_temp.assert('merge again: the old spelling still resolves, through two merges',
  (select (pg_temp.imp('ceo',$j$[{"rec":900103,"buyer":"merge source","description":"Twice merged","received_on":"2026-07-03"}]$j$)->>'created')::integer=1));
select pg_temp.expect('merge again: buyer is Alpha',(select buyer_id::text from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900103),pg_temp.fx('A')::text);
select pg_temp.expect('merge: other company cannot merge ours',
  pg_temp.msg(pg_temp.as_scalar('other_ceo',format($q$select public.app_sales_merge_customers(%L,%L)::text$q$,pg_temp.fx('C'),pg_temp.fx('A')))),'sales: not found');

-- ============================================================ aliases list / remove
select pg_temp.expect('aliases: list shape and order',
  (select string_agg((x->>'kind')||':'||(x->>'alias')||'>'||(x->>'target_name'),',' order by o)
     from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_aliases()')) with ordinality t(x,o)),
  'customer:Beta Test Co>Beta Renamed,customer:Merge Source>Alpha Test Co,customer:Merge Target>Alpha Test Co');
select pg_temp.expect('aliases: a viewer is refused',
  pg_temp.msg(pg_temp.as_scalar('viewer',$q$select public.app_sales_aliases()::text$q$)),'sales: not allowed');
select pg_temp.expect('aliases: other company sees none',
  jsonb_array_length(pg_temp.as_json('other_ceo','select public.app_sales_aliases()'))::text,'0');
select pg_temp.expect('aliases: other company cannot remove ours',
  pg_temp.msg(pg_temp.as_scalar('other_ceo',format($q$select public.app_sales_remove_alias(%L)::text$q$,
    (select id from public.sales_name_aliases where company_id=pg_temp.fx('company') limit 1)))),'sales: not found');
select pg_temp.expect('aliases: remove one, records unchanged',
  pg_temp.as_scalar('ceo',format($q$select public.app_sales_remove_alias(%L)::text$q$,
    (select id from public.sales_name_aliases where company_id=pg_temp.fx('company') and alias_key='merge source')))||'/'||
  (select buyer_id::text from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900103),
  '/'||pg_temp.fx('A')::text);
select pg_temp.expect('aliases: remove an unknown id',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_remove_alias(%L)::text$q$,gen_random_uuid()))),'sales: not found');
select pg_temp.assert('aliases: after removal the old spelling makes a new customer again',
  (select (pg_temp.imp('ceo',$j$[{"rec":900104,"buyer":"Merge Source","description":"New customer","received_on":"2026-07-04"}]$j$)->>'created')::integer=1));
select pg_temp.expect('aliases: ... a customer of that name now exists',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company') and name_key='merge source'),'1');

-- ============================================================ person matching
-- 900101 holds 'Ali Vaziri' (batch 1); add the rest in a second file.
select pg_temp.expect('people: import keeps the name as text',(pg_temp.rec(900101)).in_charge_text,'Ali Vaziri');
select pg_temp.assert('people: second file',
  (select (pg_temp.imp('ceo',$j$[
    {"rec":900111,"buyer":"Alpha Test Co","description":"p1","received_on":"2026-07-05","in_charge":"ali vaziri"},
    {"rec":900112,"buyer":"Alpha Test Co","description":"p2","received_on":"2026-07-05","in_charge":"Ali Vaziri"},
    {"rec":900113,"buyer":"Alpha Test Co","description":"p3","received_on":"2026-07-05","in_charge":"Sara Test"},
    {"rec":900114,"buyer":"Alpha Test Co","description":"p4","received_on":"2026-07-05","in_charge":"Y"},
    {"rec":900115,"buyer":"Alpha Test Co","description":"p5","received_on":"2026-07-05","in_charge":"N"}]$j$)->>'created')::integer=5));
select pg_temp.expect('people: grouped by key, most common spelling, count desc, Y/N out',
  (select string_agg((x->>'name')||'='||(x->>'count'),',' order by o)
     from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_people_to_match(null)')) with ordinality t(x,o)),
  'Ali Vaziri=3,Text Person=2,Sara Test=1');
select pg_temp.expect('people: nothing matched yet',
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_people_to_match(null)')) x where x->>'matched_id' is not null),'0');
select pg_temp.expect('people: only what one batch wrote',
  (select string_agg((x->>'name')||'='||(x->>'count'),',')
     from jsonb_array_elements(pg_temp.as_json('ceo',format($q$select public.app_sales_people_to_match(%L)$q$,
       (select (import_batch_id) from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900101)))) x),'Ali Vaziri=1');
select pg_temp.expect('people: needs sales_settings edit',
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_people_to_match(null)::text$q$)),'sales: not allowed');
-- match
select pg_temp.expect('match: sets the owner on every record with that name key',
  pg_temp.as_json('ceo',format($q$select public.app_sales_match_person('ali  VAZIRI',%L)$q$,pg_temp.fx('emp1')))->>'updated','3');
select pg_temp.expect('match: all three have emp1, text kept, not edited',
  (select count(*)::text from public.sales_rfps where company_id=pg_temp.fx('company') and in_charge_text ilike 'ali vaziri'
     and owner_id=pg_temp.fx('emp1') and not edited_after_import),'3');
select pg_temp.expect('match: one edit event per record, with side person_match',
  (select count(*)::text from public.sales_events e where e.company_id=pg_temp.fx('company') and e.body->>'side'='person_match'),'3');
select pg_temp.expect('match: event names the new person, no price keys',
  (select e.body->>'to'||'/'||(e.body ? 'from')::text||'/'||(select count(*) from jsonb_object_keys(e.body))::text
     from public.sales_events e where e.company_id=pg_temp.fx('company') and e.body->>'side'='person_match' limit 1),'Fixture emp1/true/4');
select pg_temp.expect('match: the people list shows the saved match',
  (select (x->>'matched_id')||'/'||(x->>'matched_name') from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_people_to_match(null)')) x where x->>'name'='Ali Vaziri'),
  pg_temp.fx('emp1')::text||'/Fixture emp1');
select pg_temp.expect('match: the saved alias is listed',
  (select (x->>'alias')||'>'||(x->>'target_name') from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_aliases()')) x where x->>'kind'='person'),'ali VAZIRI>Fixture emp1');
update public.sales_rfps set owner_id=pg_temp.fx('ceo') where company_id=pg_temp.fx('company') and record_no=900112;
select pg_temp.expect('re-match: moves only owners the previous match set',
  pg_temp.as_json('ceo',format($q$select public.app_sales_match_person('Ali Vaziri',%L)$q$,pg_temp.fx('emp2')))->>'updated','2');
select pg_temp.expect('re-match: the hand-set owner stayed',(pg_temp.rec(900112)).owner_id::text,pg_temp.fx('ceo')::text);
select pg_temp.expect('re-match: same person again changes nothing',
  pg_temp.as_json('ceo',format($q$select public.app_sales_match_person('Ali Vaziri',%L)$q$,pg_temp.fx('emp2')))->>'updated','0');
select pg_temp.expect('clear: removes the alias and the owners it set, not the hand-set one',
  pg_temp.as_json('ceo',format($q$select public.app_sales_match_person('Ali Vaziri',null)$q$))->>'updated','2');
select pg_temp.expect('clear: owners',
  (select string_agg(coalesce(owner_id::text,'-'),',' order by record_no) from public.sales_rfps
    where company_id=pg_temp.fx('company') and record_no in (900101,900111,900112)),'-,-,'||pg_temp.fx('ceo')::text);
select pg_temp.expect('clear: no person alias left',
  (select count(*)::text from public.sales_name_aliases where company_id=pg_temp.fx('company') and kind='person'),'0');
select pg_temp.expect('clear again: nothing to do',
  pg_temp.as_json('ceo',format($q$select public.app_sales_match_person('Ali Vaziri',null)$q$))->>'updated','0');
select pg_temp.expect('match: a profile of another company is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_match_person('Sara Test',%L)::text$q$,pg_temp.fx('other_ceo')))),'sales: invalid input');
select pg_temp.expect('match: an empty name is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_match_person('  ',%L)::text$q$,pg_temp.fx('emp1')))),'sales: invalid input');
select pg_temp.expect('match: needs sales_settings edit',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_match_person('Sara Test',%L)::text$q$,pg_temp.fx('emp1')))),'sales: not allowed');
-- the alias is used by the imports
select pg_temp.expect('match Sara',pg_temp.as_json('ceo',format($q$select public.app_sales_match_person('Sara Test',%L)$q$,pg_temp.fx('emp1')))->>'updated','1');
select pg_temp.assert('inquiry import: a saved person alias sets the owner, the text stays',
  (select (pg_temp.imp('ceo',$j$[{"rec":900121,"buyer":"Alpha Test Co","description":"a1","received_on":"2026-07-06","in_charge":"sara  test"}]$j$)->>'created')::integer=1));
select pg_temp.expect('inquiry import: owner + original text',
  (pg_temp.rec(900121)).owner_id::text||'/'||(pg_temp.rec(900121)).in_charge_text,pg_temp.fx('emp1')::text||'/sara test');
select pg_temp.assert('inquiry import: the preview choice beats the alias',
  (select (pg_temp.imp('ceo',$j$[{"rec":900122,"buyer":"Alpha Test Co","description":"a2","received_on":"2026-07-06","in_charge":"Sara Test"}]$j$,
     format('{"Sara Test":"%s"}',pg_temp.fx('emp2')))->>'created')::integer=1));
select pg_temp.expect('inquiry import: choice',(pg_temp.rec(900122)).owner_id::text,pg_temp.fx('emp2')::text);
select pg_temp.assert('ledger import: a saved person alias sets the owner, the text stays',
  (select (pg_temp.as_json('ceo',$q$select public.app_sales_import('l.csv',
      '[{"rec":900131,"buyer":"Beta Test Co","in_charge":"Sara Test","description":"ledger row"}]'::jsonb)$q$)->>'created')::integer=1));
select pg_temp.expect('ledger import: owner, text, and the old customer spelling resolved',
  (pg_temp.rec(900131)).owner_id::text||'/'||(pg_temp.rec(900131)).in_charge_text||'/'||(pg_temp.rec(900131)).buyer_id::text,
  pg_temp.fx('emp1')::text||'/Sara Test/'||pg_temp.fx('B')::text);
select pg_temp.assert('a profile in the exact-name path still works (no alias, no choice)',
  (select (pg_temp.imp('ceo',$j$[{"rec":900123,"buyer":"Alpha Test Co","description":"a3","received_on":"2026-07-06","in_charge":"Fixture emp2"}]$j$)->>'created')::integer=1));
select pg_temp.expect('exact name: owner set, text kept',(pg_temp.rec(900123)).owner_id::text||'/'||(pg_temp.rec(900123)).in_charge_text,pg_temp.fx('emp2')::text||'/Fixture emp2');

-- ============================================================ read-only safe (View as)
set local transaction_read_only = on;
select pg_temp.assert('the reads work in a read-only transaction',
  pg_temp.as_json('ceo','select public.app_sales_people_to_match(null)') is not null
  and pg_temp.as_json('ceo','select public.app_sales_aliases()') is not null
  and pg_temp.as_json('ceo',$q$select public.app_sales_metrics(null,'2026-01-01','2025-01-01')$q$) is not null
  and pg_temp.as_json('ceo','select public.app_sales_customers(''{"result":"won"}'')') is not null
  and pg_temp.lst('ceo','{"state":"all","sort":"deadline"}') is not null);

rollback;
