-- ERP › Sales customers tab + report aggregate (FR-94 section 16.7, 2026-11-17).
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
create function pg_temp.cust(p_user text,p_key text) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.as_json(p_user,'select public.app_sales_customers()')) x
   where x->>'id'=pg_temp.fx(p_key)::text;
$$;
create function pg_temp.page(p_user text,p_key text,p_part text) returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format('select public.app_sales_customer(%L)->%L',pg_temp.fx(p_key),p_part));
$$;
create function pg_temp.report(p_user text,p_part text) returns jsonb language sql as $$
  select pg_temp.as_json(p_user,format('select public.app_sales_report()->%L',p_part));
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid();
  v_dept2 uuid:=gen_random_uuid(); v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Customers synthetic fixture'),(v_other,'Customers other fixture');
  insert into sl_fx values('company',v_company),('other_company',v_other);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','CU'),(v_dept2,v_other,'دیگر','Other HQ','office','CO');
  for who in select * from (values
    ('admin','admin','9990960001',v_company,v_dept),('ceo','employee','9990960002',v_company,v_dept),
    ('viewer','employee','9990960003',v_company,v_dept),('reporter','employee','9990960004',v_company,v_dept),
    ('seller','employee','9990960005',v_company,v_dept),('nobody','employee','9990960006',v_company,v_dept),
    ('other_ceo','employee','9990960007',v_other,v_dept2)
    ) t(k,role,code,company,dept) loop
    insert into sl_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@customers-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),who.company,who.dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
  end loop;
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CuCeo') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_prices','edit'),
    (v_role,'sales_reports','read'),(v_role,'sales_settings','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ceo'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CuViewer') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('viewer'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CuReporter') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read'),(v_role,'sales_reports','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('reporter'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','CuSeller') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_prices','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('seller'),v_role);
  insert into public.roles(company_id,kind,name) values(v_other,'custom','CuOther') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_settings','edit'),(v_role,'sales_reports','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('other_ceo'),v_role);
  perform private.sales_ensure(v_company);
  perform private.sales_ensure(v_other);

  insert into sl_fx values('A',gen_random_uuid()),('B',gen_random_uuid()),('C',gen_random_uuid()),
    ('M1',gen_random_uuid()),('M2',gen_random_uuid()),('D',gen_random_uuid()),('X',gen_random_uuid());
  insert into public.sales_customers(id,company_id,name,name_key,kind) values
    (pg_temp.fx('A'),v_company,'Alpha Test Co',private.sales_name_key('Alpha Test Co'),'government'),
    (pg_temp.fx('B'),v_company,'Beta Test Co',private.sales_name_key('Beta Test Co'),'contractor'),
    (pg_temp.fx('C'),v_company,'Gamma End User',private.sales_name_key('Gamma End User'),null),
    (pg_temp.fx('M1'),v_company,'Merge Source',private.sales_name_key('Merge Source'),'contractor'),
    (pg_temp.fx('M2'),v_company,'Merge Target',private.sales_name_key('Merge Target'),null),
    (pg_temp.fx('D'),v_company,'Delta Empty',private.sales_name_key('Delta Empty'),null),
    (pg_temp.fx('X'),v_other,'Other Company Cust',private.sales_name_key('Other Company Cust'),null);
  -- Alpha: two open (one bid, one contract), lost, no bid, archived, cancelled
  perform pg_temp.mk(900001,'bid','submitted','A','C','Wellhead valve for the plant','2026-01-10','bid',null,'EUR',100,null,'ceo',null);
  perform pg_temp.mk(900002,'bid','lost','A',null,'valve repair','2025-05-01','bid','lost','IRR',50,null,null,'Text Person');
  perform pg_temp.mk(900003,'contract','new','A','C','Valve spares','2026-02-01','bid','won','EUR',900,1000,'ceo',null);
  perform pg_temp.mk(900004,'bid','no_bid','A',null,'Spares list','2024-03-03','no_bid',null,null,null,null,null,null);
  perform pg_temp.mk(900005,'bid','archived','A',null,'Misc item','2023-03-03','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900006,'bid','cancelled','A',null,'Misc item','2023-06-06','bid','cancelled',null,null,null,null,null);
  perform pg_temp.mk(900007,'bid','received','B','C','Gamma things','2026-03-01','pending',null,null,null,null,null,null);
  -- an imported bid result: counts for the customer, not for the Reports decided list
  perform pg_temp.mk(900014,'bid','lost','B',null,'Imported lost','2020-01-01','bid','lost','IRR',5,null,null,'Text Person');
  update public.sales_rfps set import_batches=array[gen_random_uuid()] where record_no=900014 and company_id=v_company;
  perform pg_temp.mk(900010,'bid','received','M1',null,'Merge one','2026-04-01','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900011,'bid','received','M2','M1','Merge two','2026-04-02','pending',null,null,null,null,null,null);
  perform pg_temp.mk(900012,'bid','received','M1','M1','Merge three','2026-04-03','pending',null,null,null,null,null,null);
  insert into public.sales_deadlines(company_id,rfp_id,kind,due_on,done_at) values
    (v_company,(select id from public.sales_rfps where company_id=v_company and record_no=900001),'proposal_due','2026-12-01',null),
    (v_company,(select id from public.sales_rfps where company_id=v_company and record_no=900001),'quote_due','2026-11-20',null),
    (v_company,(select id from public.sales_rfps where company_id=v_company and record_no=900001),'bond_due','2026-01-01',now()),
    (v_company,(select id from public.sales_rfps where company_id=v_company and record_no=900005),'proposal_due','2026-01-02',null);
end; $$;

-- ============================================================ customers table
select pg_temp.expect('Alpha: counts per result and stage kind',
  concat_ws(':',pg_temp.cust('ceo','A')->>'records',pg_temp.cust('ceo','A')->>'as_client',pg_temp.cust('ceo','A')->>'open',
    pg_temp.cust('ceo','A')->>'won',pg_temp.cust('ceo','A')->>'lost',pg_temp.cust('ceo','A')->>'no_bid',
    pg_temp.cust('ceo','A')->>'archived',pg_temp.cust('ceo','A')->>'cancelled',pg_temp.cust('ceo','A')->>'decided'),
  '6:0:2:1:1:1:1:1:2');
select pg_temp.expect('Alpha: win rate won / (won + lost)',(pg_temp.cust('ceo','A')->>'win_rate')::numeric::text,'0.5000');
select pg_temp.expect('Alpha: first and last inquiry',
  (pg_temp.cust('ceo','A')->>'first_inquiry')||'/'||(pg_temp.cust('ceo','A')->>'last_inquiry'),'2023-03-03/2026-02-01');
select pg_temp.expect('Alpha: next deadline = earliest open one on an open record',pg_temp.cust('ceo','A')->>'next_deadline','2026-11-20');
select pg_temp.expect('Alpha: main contact = most frequent owner name',pg_temp.cust('ceo','A')->>'main_owner_name','Fixture ceo');
select pg_temp.expect('Alpha: contract value per currency (contract-flow records only)',
  (pg_temp.cust('ceo','A')->'contract_value'->>'EUR')||'/'||(select count(*)::text from jsonb_object_keys(pg_temp.cust('ceo','A')->'contract_value')),'1000.00/1');
select pg_temp.expect('Alpha: quoted per currency over every record with our price',
  (pg_temp.cust('ceo','A')->'quoted'->>'EUR')||'/'||(pg_temp.cust('ceo','A')->'quoted'->>'IRR'),'1000.00/50.00');
select pg_temp.expect('Beta: the text in-charge counts when no owner is set; imported lost counts',
  (pg_temp.cust('ceo','B')->>'main_owner_name')||'/'||(pg_temp.cust('ceo','B')->>'lost')||'/'||(pg_temp.cust('ceo','B')->>'records'),'Text Person/1/2');
select pg_temp.expect('Beta: win rate with only a loss is 0',(pg_temp.cust('ceo','B')->>'win_rate')::numeric::text,'0.0000');
select pg_temp.expect('Gamma (client only): no buyer records, three client rows, no win rate, no contact',
  concat_ws(':',pg_temp.cust('ceo','C')->>'records',pg_temp.cust('ceo','C')->>'as_client',
    coalesce(pg_temp.cust('ceo','C')->>'win_rate','null'),coalesce(pg_temp.cust('ceo','C')->>'main_owner_name','null')),'0:3:null:null');
select pg_temp.expect('a customer with nothing still has a row',
  concat_ws(':',pg_temp.cust('ceo','D')->>'records',pg_temp.cust('ceo','D')->>'open',pg_temp.cust('ceo','D')->>'decided'),'0:0:0');
select pg_temp.expect('another company is not listed',
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo','select public.app_sales_customers()')) x
    where x->>'id'=pg_temp.fx('X')::text),'0');
select pg_temp.expect('a read-only viewer gets no price keys',
  ((pg_temp.cust('viewer','A') ? 'contract_value')::text)||((pg_temp.cust('viewer','A') ? 'quoted')::text),'falsefalse');
select pg_temp.expect('a sales_prices reader gets them',((pg_temp.cust('seller','A') ? 'contract_value')::text),'true');
select pg_temp.expect('nobody is refused',pg_temp.msg(pg_temp.as_scalar('nobody',$q$select public.app_sales_customers()::text$q$)),'sales: not allowed');

-- ============================================================ customer page
select pg_temp.expect('page: per-year rows, newest first, undated records left out',
  (select string_agg((y->>'year')||'='||(y->>'total')||'/'||(y->>'won')||'/'||(y->>'lost'),',' order by (y->>'year')::int desc)
     from jsonb_array_elements(pg_temp.page('ceo','A','per_year')) y),'2026=2/1/0,2025=1/0/1,2024=1/0/0,2023=2/0/0');
select pg_temp.expect('page: top words, most frequent first, stop words and short words out',
  (select string_agg((w->>'word')||'='||(w->>'count'),',' order by (w->>'count')::int desc,w->>'word')
     from (select w from jsonb_array_elements(pg_temp.page('ceo','A','top_words')) w limit 3) t),'valve=3,item=2,misc=2');
select pg_temp.expect('page: stop words never appear',
  (select count(*)::text from jsonb_array_elements(pg_temp.page('ceo','A','top_words')) w
    where w->>'word' in ('for','the','and','of','with')),'0');
select pg_temp.expect('page: client-of lists the buyers it is the end user for',
  (select string_agg((c->>'name')||'='||(c->>'count'),',' order by c->>'name')
     from jsonb_array_elements(pg_temp.page('ceo','C','client_of')) c),'Alpha Test Co=2,Beta Test Co=1');
select pg_temp.expect('page: same row as the table',(pg_temp.page('ceo','A','customer')=pg_temp.cust('ceo','A'))::text,'true');
select pg_temp.expect('page: no price keys without sales_prices',(pg_temp.page('viewer','A','customer') ? 'quoted')::text,'false');
select pg_temp.expect('page: unknown id is not found',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_customer(gen_random_uuid())::text$q$)),'sales: not found');
select pg_temp.expect('page: another company''s customer is not found',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_customer(%L)::text$q$,pg_temp.fx('X')))),'sales: not found');

-- ============================================================ rename
select pg_temp.expect('rename needs sales_settings',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_rename_customer(%L,'New Name')::text$q$,pg_temp.fx('D')))),'sales: not allowed');
select pg_temp.expect('rename to the key of another customer is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'  ALPHA test co ')::text$q$,pg_temp.fx('D')))),'sales: customer exists');
select pg_temp.expect('rename to an empty name is invalid',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'   ')::text$q$,pg_temp.fx('D')))),'sales: invalid input');
select pg_temp.expect('rename another company''s customer is not found',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'Hijack')::text$q$,pg_temp.fx('X')))),'sales: not found');
select pg_temp.expect('rename succeeds',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'Delta  Renamed Co')::text$q$,pg_temp.fx('D')))),'ok');
select pg_temp.expect('rename updates name (spaces folded) and key',
  (select name||'/'||(name_key=private.sales_name_key('Delta Renamed Co'))::text from public.sales_customers where id=pg_temp.fx('D')),'Delta Renamed Co/true');
select pg_temp.expect('a case-only rename of itself is allowed',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_rename_customer(%L,'delta renamed CO')::text$q$,pg_temp.fx('D')))),'ok');

-- ============================================================ merge
select pg_temp.expect('merge needs sales_settings',
  pg_temp.msg(pg_temp.as_scalar('seller',format($q$select public.app_sales_merge_customers(%L,%L)::text$q$,pg_temp.fx('M1'),pg_temp.fx('M2')))),'sales: not allowed');
select pg_temp.expect('merge into itself is invalid',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_merge_customers(%L,%L)::text$q$,pg_temp.fx('M1'),pg_temp.fx('M1')))),'sales: invalid input');
select pg_temp.expect('merge into another company''s customer is not found',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_merge_customers(%L,%L)::text$q$,pg_temp.fx('M1'),pg_temp.fx('X')))),'sales: not found');
select pg_temp.expect('merge moves three records (buyer and client sides)',
  pg_temp.as_json('ceo',format($q$select public.app_sales_merge_customers(%L,%L)$q$,pg_temp.fx('M1'),pg_temp.fx('M2')))->>'moved','3');
select pg_temp.expect('the source customer is gone',(select count(*)::text from public.sales_customers where id=pg_temp.fx('M1')),'0');
select pg_temp.expect('buyers and clients moved to the target',
  (select count(*)::text||':'||count(*) filter (where buyer_id=pg_temp.fx('M2'))||':'||count(*) filter (where client_id=pg_temp.fx('M2'))
     from public.sales_rfps where company_id=pg_temp.fx('company') and record_no between 900010 and 900012),'3:3:2');
select pg_temp.expect('target keeps its name; kind falls back to the source kind',
  (select name||'/'||kind from public.sales_customers where id=pg_temp.fx('M2')),'Merge Target/contractor');
select pg_temp.expect('one edit event per moved record, naming both sides',
  (select count(*)::text||':'||min(e.body->>'side')||':'||min(e.body->>'from')||':'||min(e.body->>'into')
     from public.sales_events e join public.sales_rfps r on r.id=e.rfp_id
    where r.company_id=pg_temp.fx('company') and r.record_no between 900010 and 900012 and e.kind='edit'),
  '3:customer_merge:Merge Source:Merge Target');
select pg_temp.expect('a merge does not mark the records as edited after import',
  (select count(*) filter (where edited_after_import)::text from public.sales_rfps
    where company_id=pg_temp.fx('company') and record_no between 900010 and 900012),'0');
select pg_temp.expect('merged figures add up',(pg_temp.cust('ceo','M2')->>'records')||':'||(pg_temp.cust('ceo','M2')->>'as_client'),'3:2');
select pg_temp.expect('merging a vanished customer is not found',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_merge_customers(%L,%L)::text$q$,pg_temp.fx('M1'),pg_temp.fx('M2')))),'sales: not found');

-- ============================================================ report
select pg_temp.expect('report needs sales_reports',
  pg_temp.msg(pg_temp.as_scalar('viewer',$q$select public.app_sales_report()::text$q$)),'sales: not allowed');
select pg_temp.expect('report: submitted stage count and value',
  (select (p->>'count')||'/'||(p->'value'->>'EUR') from jsonb_array_elements(pg_temp.report('ceo','pipeline')) p
    where p->>'stage_id'=pg_temp.stage('bid','submitted')::text),'1/100.00');
select pg_temp.expect('report: contract value beats our price',
  (select p->'value'->>'EUR' from jsonb_array_elements(pg_temp.report('ceo','pipeline')) p
    where p->>'stage_id'=pg_temp.stage('contract','new')::text),'1000.00');
select pg_temp.expect('report: only stages with records',
  (select string_agg(s.code,',' order by s.position)
     from jsonb_array_elements(pg_temp.report('ceo','pipeline')) p join public.sales_stages s on s.id=(p->>'stage_id')::uuid
    where s.flow_id=(select id from public.sales_flows where company_id=pg_temp.fx('company') and kind='bid')),
  'received,submitted,lost,no_bid,archived,cancelled');
select pg_temp.expect('report: decided = bids decided in the app, the imported one left out',
  (select count(*)::text||':'||string_agg(d->>'bid_result',',' order by d->>'bid_result') from jsonb_array_elements(pg_temp.report('ceo','decided')) d),
  '3:cancelled,lost,won');
select pg_temp.expect('report: a decided row has exactly buyer id + names (fa, en), result time, result (FR-98)',
  (select (d ? 'buyer_name')::text||(d ? 'result_at')::text||(select count(*)::text from jsonb_object_keys(d))
     from jsonb_array_elements(pg_temp.report('ceo','decided')) d limit 1),'truetrue5');
select pg_temp.expect('report: no value keys without sales_prices',
  (select count(*)::text from jsonb_array_elements(pg_temp.report('reporter','pipeline')) p where p ? 'value'),'0');
select pg_temp.expect('report: the other company sees none of it',
  (select count(*)::text from jsonb_array_elements(pg_temp.report('other_ceo','decided')) d),'0');

-- ============================================================ read-only safe (View as)
set local transaction_read_only = on;
select pg_temp.assert('the reads work in a read-only transaction',
  pg_temp.as_json('ceo','select public.app_sales_customers()') is not null
  and pg_temp.as_json('ceo',format($q$select public.app_sales_customer(%L)$q$,pg_temp.fx('A'))) is not null
  and pg_temp.as_json('ceo','select public.app_sales_report()') is not null);

rollback;
