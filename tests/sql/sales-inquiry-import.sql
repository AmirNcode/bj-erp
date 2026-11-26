-- ERP › Sales inquiry register import (FR-94 section 16, 2026-11-17).
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
create temp table sl_imp(k text primary key,j jsonb);
grant select on sl_imp to authenticated;
-- Inquiry import as p_user; rows are a JSON text. Result stored under p_key and returned.
create function pg_temp.imp(p_key text,p_user text,p_rows text,p_batch text default null,p_last boolean default true,
    p_people text default '{}') returns jsonb language plpgsql as $$
declare v jsonb;
begin
  v:=pg_temp.as_json(p_user,format($q$select public.app_sales_import_inquiries(%L::uuid,'reg.csv',%L::jsonb,%L::jsonb,'2026-06-01',%L::boolean)$q$,
    p_batch,p_rows,p_people,p_last));
  insert into sl_imp values(p_key,v) on conflict(k) do update set j=excluded.j;
  return v;
end; $$;

do $$
declare v_company uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid();
  v_dept2 uuid:=gen_random_uuid(); v_role uuid; who record;
begin
  insert into public.companies(id,name) values(v_company,'Inquiry synthetic fixture'),(v_other,'Inquiry other fixture');
  insert into sl_fx values('company',v_company),('other_company',v_other);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code)
    values(v_dept,v_company,'آزمایش','Fixture HQ','office','IQ'),(v_dept2,v_other,'دیگر','Other HQ','office','IO');
  for who in select * from (values
    ('admin','admin','9990950001',v_company,v_dept),('ceo','employee','9990950002',v_company,v_dept),
    ('viewer','employee','9990950003',v_company,v_dept),('setter','employee','9990950004',v_company,v_dept),
    ('seller','employee','9990950005',v_company,v_dept),('nobody','employee','9990950006',v_company,v_dept),
    ('other_admin','admin','9990950007',v_other,v_dept2)
    ) t(k,role,code,company,dept) loop
    insert into sl_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@inquiry-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),who.company,who.dept,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
  end loop;
  insert into public.roles(company_id,kind,name) values(v_company,'custom','IqCeo') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_prices','edit'),
    (v_role,'sales_bonds','edit'),(v_role,'sales_decide','edit'),(v_role,'sales_reports','read'),
    (v_role,'sales_settings','edit'),(v_role,'project_items','edit'),
    (v_role,'sales_customers','edit');  -- FR-98: holders of sales=edit got it in the migration
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('ceo'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','IqViewer') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('viewer'),v_role);
  -- Settings without prices: may import, never writes a price.
  insert into public.roles(company_id,kind,name) values(v_company,'custom','IqSetter') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_settings','edit'),(v_role,'sales_customers','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('setter'),v_role);
  insert into public.roles(company_id,kind,name) values(v_company,'custom','IqSeller') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','edit'),(v_role,'sales_customers','edit');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('seller'),v_role);
end; $$;

-- ============================================================ Archived stage, kinds
select pg_temp.expect('a new company has one Archived stage (kind archived) after No bid',
  (select s.kind||':'||s.position||':'||(select position from public.sales_stages where flow_id=s.flow_id and code='no_bid')
     from public.sales_stages s join public.sales_flows f on f.id=s.flow_id
    where f.company_id=pg_temp.fx('company') and f.kind='bid' and s.code='archived'),'archived:9:8');
select pg_temp.expect('stage positions of the bid flow follow the seed order',
  (select string_agg(code,',' order by position) from public.sales_stages s join public.sales_flows f on f.id=s.flow_id
    where f.company_id=pg_temp.fx('company') and f.kind='bid'),
  'received,decision,technical,pricing,ready,submitted,lost,no_bid,archived,cancelled');
-- A company seeded before this migration has no Archived row; ensure adds it after No bid.
delete from public.sales_stages s using public.sales_flows f where f.id=s.flow_id and f.company_id=pg_temp.fx('company')
  and s.code='archived';
update public.sales_stages s set position=9 from public.sales_flows f
 where f.id=s.flow_id and f.company_id=pg_temp.fx('company') and f.kind='bid' and s.code='cancelled';
select private.sales_ensure(pg_temp.fx('company'));
select pg_temp.expect('an older company gets Archived right after No bid, Cancelled pushed down',
  (select string_agg(code,',' order by position) from public.sales_stages s join public.sales_flows f on f.id=s.flow_id
    where f.company_id=pg_temp.fx('company') and f.kind='bid' and position>=7),'lost,no_bid,archived,cancelled');
select pg_temp.expect('save_stage accepts kind archived',
  pg_temp.msg(pg_temp.as_scalar('setter',format($q$select public.app_sales_save_stage(%L,null,'{"kind":"archived"}')::text$q$,pg_temp.stage('bid','archived')))),'ok');
select pg_temp.expect('save_stage still refuses an unknown kind',
  pg_temp.msg(pg_temp.as_scalar('setter',format($q$select public.app_sales_save_stage(%L,null,'{"kind":"gone"}')::text$q$,pg_temp.stage('bid','archived')))),'sales: invalid input');
select pg_temp.expect('Levenshtein helper','kitten>sitting='||private.sales_levenshtein('kitten','sitting'),'kitten>sitting=3');

-- ============================================================ access
select pg_temp.expect('a caller without sales_settings is refused',
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_import_inquiries(null,'x','[]')::text$q$)),'sales: not allowed');
select pg_temp.expect('record numbers need sales_settings',
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_record_numbers()::text$q$)),'sales: not allowed');
select pg_temp.expect('nobody is refused the list page',
  pg_temp.msg(pg_temp.as_scalar('nobody',$q$select public.app_sales_list_page('{}')::text$q$)),'sales: not allowed');
select pg_temp.expect('more than 2000 rows are refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_import_inquiries(null,'x',(select jsonb_agg(jsonb_build_object('rec',g)) from generate_series(1,2001) g))::text$q$)),'sales: invalid input');
select pg_temp.expect('an empty file makes a batch with nothing in it, closed by p_last',
  (select (pg_temp.imp('empty','ceo','[]',null,true)->>'created')),'0');

-- ============================================================ classification (16.2)
-- cut-off 2026-06-01; "new" = after it, "old" = before it
select pg_temp.expect('first import: ten rows made, none skipped',
  (select (j->>'created')||':'||(j->>'skipped') from (select pg_temp.imp('c1','ceo',$j$[
  {"rec":900001,"buyer":"Karun Test Co","received_on":"2026-09-01","inquiry_no":"I-1","inquiry_type":"tender","description":"Won new wellhead","won_price":5000,"currency":"EUR","in_charge":"Owner One","in_charge_flag":"Y","status_note":"signed"},
  {"rec":900002,"buyer":"Karun Test Co","received_on":"2020-01-01","description":"Won old valve","phrase":"won"},
  {"rec":900003,"buyer":"Beta Oil","received_on":"2020-02-01","description":"Lost by price","lost_price":777,"currency":"IRR","in_charge":"Fixture viewer"},
  {"rec":900004,"buyer":"Beta Oil","received_on":"2026-09-02","description":"Lost by phrase","phrase":"lost","in_charge":"Nobody Known"},
  {"rec":900005,"buyer":"Beta Oil","received_on":"2026-09-03","description":"We do not bid","phrase":"no_bid"},
  {"rec":900006,"buyer":"Beta Oil","received_on":"2026-09-04","description":"Void","phrase":"cancelled"},
  {"rec":900007,"buyer":"Gamma Gas","received_on":"2026-09-05","description":"Fresh request","customer_ref":"REQ-7","inquiry_type":"Project"},
  {"rec":900008,"buyer":"Gamma Gas","received_on":"2020-03-03","description":"Old no result"},
  {"rec":900009,"buyer":"Gamma Gas","received_text":"Urgent","description":"No readable date","offer_text":"soon"},
  {"rec":900010,"buyer":"Gamma Gas","received_on":"2026-09-06","description":"Both prices","won_price":10,"lost_price":20,"currency":"IRR"}]$j$,null,true,
  jsonb_build_object('Owner One',pg_temp.fx('seller'))::text) j) t),'10:0');
select pg_temp.assert('by_result counts',
  (select j->'by_result' from sl_imp where k='c1')='{"won":3,"lost":2,"no_bid":1,"cancelled":1,"open":1,"archived":2}'::jsonb);
select pg_temp.expect('won, received after the cut-off: contract New',
  pg_temp.flow_of(900001)||'/'||pg_temp.stage_of_no(900001)||'/'||(select bid_result||'/'||bid_decision from public.sales_rfps where id=pg_temp.rfp_id(900001)),'contract/new/won/bid');
select pg_temp.expect('won, old: contract Finish',pg_temp.flow_of(900002)||'/'||pg_temp.stage_of_no(900002),'contract/finish');
select pg_temp.expect('loser price: bid Lost, result lost',
  pg_temp.flow_of(900003)||'/'||pg_temp.stage_of_no(900003)||'/'||(select bid_result from public.sales_rfps where id=pg_temp.rfp_id(900003)),'bid/lost/lost');
select pg_temp.expect('lost phrase: bid Lost',pg_temp.stage_of_no(900004),'lost');
select pg_temp.expect('no-bid phrase: No bid stage, decision no_bid',
  pg_temp.stage_of_no(900005)||'/'||(select bid_decision||'/'||coalesce(bid_result,'-') from public.sales_rfps where id=pg_temp.rfp_id(900005)),'no_bid/no_bid/-');
select pg_temp.expect('cancelled phrase: Cancelled stage, result cancelled',
  pg_temp.stage_of_no(900006)||'/'||(select bid_result from public.sales_rfps where id=pg_temp.rfp_id(900006)),'cancelled/cancelled');
select pg_temp.expect('received after the cut-off, no result: first open bid stage',
  pg_temp.flow_of(900007)||'/'||pg_temp.stage_of_no(900007),'bid/received');
select pg_temp.expect('older with no result: Archived; no readable date: Archived',
  pg_temp.stage_of_no(900008)||'/'||pg_temp.stage_of_no(900009),'archived/archived');
select pg_temp.expect('a won price beats a loser price',pg_temp.flow_of(900010)||'/'||pg_temp.stage_of_no(900010),'contract/new');
select pg_temp.expect('archived and closed records create no deadlines',
  (select count(*)::text from public.sales_deadlines d join public.sales_rfps r on r.id=d.rfp_id
    where r.company_id=pg_temp.fx('company') and r.record_no between 900001 and 900010),'0');
select pg_temp.expect('one import event per record, naming the batch',
  (select count(*)::text from public.sales_events e where e.rfp_id=pg_temp.rfp_id(900001) and e.kind='import'
     and e.body->>'batch'=(select j->>'batch_id' from sl_imp where k='c1')),'1');

-- ============================================================ fields, prices, owners, custom fields
select pg_temp.expect('prices and currency are written for a sales_prices holder',
  (select our_price||'/'||currency from public.sales_rfps where id=pg_temp.rfp_id(900001)),'5000.00/EUR');
select pg_temp.expect('the loser price becomes our price too',
  (select our_price||'/'||currency from public.sales_rfps where id=pg_temp.rfp_id(900003)),'777.00/IRR');
select pg_temp.expect('a won price wins over a loser price',
  (select our_price::text from public.sales_rfps where id=pg_temp.rfp_id(900010)),'10.00');
select pg_temp.expect('owner: the preview mapping, an exact name match, else text (the name stays as text, 16.8)',
  (select string_agg(record_no||'='||coalesce((select k from sl_fx where id=owner_id),'-')||'/'||coalesce(in_charge_text,'-'),',' order by record_no)
     from public.sales_rfps where company_id=pg_temp.fx('company') and record_no in (900001,900003,900004)),
  '900001=seller/Owner One,900003=viewer/Fixture viewer,900004=-/Nobody Known');
select pg_temp.expect('customers are matched by name key: three buyers',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company')),'3');
select pg_temp.expect('the six fixed custom fields exist (x_ keys, once)',
  (select string_agg(key,',' order by position) from public.sales_field_defs where company_id=pg_temp.fx('company') and key like 'x\_inq\_%'),
  'x_inq_no,x_inq_type,x_inq_status_note,x_inq_flag,x_inq_date_text,x_inq_offer_text');
select pg_temp.expect('Tender / Project is a select with four options',
  (select array_length(options,1)||':'||type from public.sales_field_defs where company_id=pg_temp.fx('company') and key='x_inq_type'),'4:select');
select pg_temp.expect('custom values: number, normalised type, note, flag',
  (select (custom->>'x_inq_no')||'/'||(custom->>'x_inq_type')||'/'||(custom->>'x_inq_status_note')||'/'||(custom->>'x_inq_flag')
     from public.sales_rfps where id=pg_temp.rfp_id(900001)),'I-1/Tender/signed/Y');
select pg_temp.expect('text-only dates go to their fields, received_on stays empty',
  (select coalesce(received_on::text,'-')||'/'||(custom->>'x_inq_date_text')||'/'||(custom->>'x_inq_offer_text')
     from public.sales_rfps where id=pg_temp.rfp_id(900009)),'-/Urgent/soon');
select pg_temp.expect('title and description come from the Description column',
  (select title||'/'||description from public.sales_rfps where id=pg_temp.rfp_id(900007)),'Fresh request/Fresh request');
select pg_temp.expect('a second import updates the record',
  pg_temp.imp('again','ceo','[{"rec":900007,"description":"Fresh request"}]')->>'updated','1');
select pg_temp.expect('... and does not duplicate the fixed fields',
  (select count(*)::text from public.sales_field_defs where company_id=pg_temp.fx('company') and key like 'x\_inq\_%'),'6');
-- The setter holds no sales_prices.
select pg_temp.expect('without sales_prices: the row is made',
  pg_temp.imp('noprice','setter','[{"rec":900020,"buyer":"Delta","received_on":"2026-09-01","description":"Won, price hidden","won_price":99,"currency":"EUR"}]')->>'created','1');
select pg_temp.expect('... no price, no currency, but the result still follows',
  (select coalesce(our_price::text,'-')||'/'||coalesce(currency,'-')||'/'||bid_result||'/'||pg_temp.flow_of(900020) from public.sales_rfps where id=pg_temp.rfp_id(900020)),
  '-/-/won/contract');
select pg_temp.expect('a reader without sales_prices gets no price key from the list page',
  (select (not exists (select 1 from jsonb_array_elements(pg_temp.as_json('viewer',$q$select public.app_sales_list_page('{"state":"all"}')->'rows'$q$)) x
     where x ?| array['our_price','winning_bid','winner_name','total_value']))::text),'true');

-- ============================================================ merge and re-import (16.3)
select pg_temp.expect('re-import: the record is updated',
  pg_temp.imp('re1','ceo',$j$[{"rec":900007,"buyer":"Gamma Gas","received_on":"2026-09-05","description":"Fresh request v2","customer_ref":"","phrase":"lost","lost_price":55,"currency":"EUR"}]$j$)->>'updated','1');
select pg_temp.expect('latest file wins: new values land, empty cells keep what was there; stage follows the file',
  (select description||'/'||customer_ref||'/'||pg_temp.stage_of_no(900007)||'/'||bid_result||'/'||our_price||'/'||cardinality(import_batches)
            from public.sales_rfps where id=pg_temp.rfp_id(900007)),
  'Fresh request v2/REQ-7/lost/lost/55.00/3');
select pg_temp.expect('the batch that made it stays import_batch_id; the newer one is appended',
  (select (import_batch_id=(select (j->>'batch_id')::uuid from sl_imp where k='c1'))::text||'/'||
          ((select (j->>'batch_id')::uuid from sl_imp where k='re1')=import_batches[3])::text
     from public.sales_rfps where id=pg_temp.rfp_id(900007)),'true/true');
-- Someone works on 900004 here: the stage stops following the file, fields still update.
select pg_temp.expect('a colleague comments on 900004','ok',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_comment(%L,'called them')::text$q$,pg_temp.rfp_id(900004)))));
select pg_temp.expect('edited record: re-imported',
  pg_temp.imp('re2','ceo',$j$[{"rec":900004,"description":"Lost by phrase v2","phrase":"won"}]$j$)->>'updated','1');
select pg_temp.expect('... description updates, stage and result stay',
  (select description||'/'||pg_temp.stage_of_no(900004)||'/'||pg_temp.flow_of(900004)||'/'||bid_result from public.sales_rfps where id=pg_temp.rfp_id(900004)),
  'Lost by phrase v2/lost/bid/lost');
-- Ledger first, then the inquiry row: only empty fields are filled (16.6: a loser price alone is not "lost").
select pg_temp.expect('ledger import makes a contract record',
  pg_temp.as_json('ceo',$q$select public.app_sales_import('B1.xlsx','[{"rec":900030,"buyer":"Ledger Buyer","description":"Ledger desc","status":"current","total_value":1000}]')$q$)->>'created','1');
select pg_temp.expect('inquiry row on a ledger record: updated',
  pg_temp.imp('led','ceo',$j$[{"rec":900030,"buyer":"Other Buyer","received_on":"2025-01-01","description":"Inquiry desc","customer_ref":"REF9","lost_price":100,"currency":"EUR","phrase":"lost","in_charge":"Fixture viewer","inquiry_no":"I-30"}]$j$)->>'updated','1');
select pg_temp.expect('... fills empties only, no flow/stage/result change',
  (select pg_temp.flow_of(900030)||'/'||pg_temp.stage_of_no(900030)||'/'||bid_result||'/'||description||'/'||customer_ref||'/'||our_price||'/'||(select name from public.sales_customers where id=buyer_id)||'/'||received_on||'/'||cardinality(import_batches)||'/'||(custom->>'x_inq_no')
             from public.sales_rfps where id=pg_temp.rfp_id(900030)),
  'contract/current/won/Ledger desc/REF9/100.00/Ledger Buyer/2025-01-01/2/I-30');
-- Inquiry first, then the ledger: the record moves to the contract flow.
select pg_temp.expect('ledger import after an inquiry import: updated',
  pg_temp.as_json('ceo',$q$select public.app_sales_import('B1.xlsx','[{"rec":900003,"status":"finish","description":"Lost by price"}]')$q$)->>'updated','1');
select pg_temp.expect('... the record moved to the contract flow',
  (select pg_temp.flow_of(900003)||'/'||pg_temp.stage_of_no(900003)||'/'||cardinality(import_batches) from public.sales_rfps where id=pg_temp.rfp_id(900003)),'contract/finish/2');
select pg_temp.expect('a later inquiry import: updated',
  pg_temp.imp('led2','ceo',$j$[{"rec":900003,"description":"Changed","phrase":"cancelled"}]$j$)->>'updated','1');
select pg_temp.expect('... only fills the contract record',
  (select pg_temp.flow_of(900003)||'/'||pg_temp.stage_of_no(900003)||'/'||description from public.sales_rfps where id=pg_temp.rfp_id(900003)),'contract/finish/Lost by price');
-- Made in the app: never touched.
select pg_temp.expect('record made in the app',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,'{"title":"Made here","record_no":900040}')::text$q$)),'ok');
select pg_temp.expect('inquiry row with its number: skipped, exists_in_app',
  (select (j->>'skipped')||':'||(j->'skipped_rows'->0->>'reason') from (select pg_temp.imp('app','ceo',$j$[{"rec":900040,"description":"Overwrite?","phrase":"won"}]$j$) j) t),
  '1:exists_in_app');
select pg_temp.expect('... and the record is untouched',
  (select title||'/'||pg_temp.stage_of_no(900040) from public.sales_rfps where id=pg_temp.rfp_id(900040)),'Made here/received');
select pg_temp.expect('a repeated number in one file: the first imports, the rest are skipped',
  (select (j->>'created')||':'||(j->>'skipped')||':'||(j->'skipped_rows'->0->>'reason')
     from (select pg_temp.imp('dup','ceo',$j$[{"rec":900050,"description":"first","received_on":"2026-09-01"},{"rec":900050,"description":"second"}]$j$) j) t),
  '1:1:duplicate');
select pg_temp.expect('... and it is the first row that stays',
  (select description from public.sales_rfps where id=pg_temp.rfp_id(900050)),'first');
select pg_temp.expect('bad record numbers are skipped, the rest imports',
  (select (j->>'created')||':'||(j->>'skipped')||':'||(j->'skipped_rows'->0->>'reason')
     from (select pg_temp.imp('bad','ceo',$j$[{"rec":"abc"},{"rec":900051,"description":"ok","received_on":"2026-09-01"},{"rec":1.5}]$j$) j) t),'1:2:bad_rec');

-- ============================================================ chunks under one batch
select pg_temp.expect('chunk 1 makes two records',
  pg_temp.imp('k1','ceo','[{"rec":900060,"description":"k1","received_on":"2026-09-01"},{"rec":900061,"description":"k1b","received_on":"2026-09-01"}]',null,false)->>'created','2');
select pg_temp.expect('... under a batch of kind inquiry that stays open',
  (select kind||'/'||closed from public.sales_import_batches where id=(select (j->>'batch_id')::uuid from sl_imp where k='k1')),'inquiry/false');
select pg_temp.expect('chunk 2 continues the same batch',
  ((pg_temp.imp('k2','ceo','[{"rec":900062,"description":"k2","received_on":"2026-09-01"}]',(select j->>'batch_id' from sl_imp where k='k1'),true)->>'batch_id')=(select j->>'batch_id' from sl_imp where k='k1'))::text,'true');
select pg_temp.expect('p_last closes it; counts accumulate',
  (select created_count||'/'||closed from public.sales_import_batches where id=(select (j->>'batch_id')::uuid from sl_imp where k='k1')),'3/true');
select pg_temp.expect('a closed batch takes no more rows',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_import_inquiries(%L,'x','[]')::text$q$,(select j->>'batch_id' from sl_imp where k='k1')))),'sales: batch closed');
select pg_temp.expect('a ledger batch cannot be continued as an inquiry batch',
  (select pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_import_inquiries(%L,'x','[]')::text$q$,id))) from public.sales_import_batches
    where company_id=pg_temp.fx('company') and kind='ledger' limit 1),'sales: batch closed');
select pg_temp.expect('an unknown batch is not found',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_import_inquiries(gen_random_uuid(),'x','[]')::text$q$)),'sales: not found');
select pg_temp.expect('bootstrap lists the batch with its kind and state',
  (select (b->>'kind')||'/'||(b->>'closed')||'/'||(b->>'records') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_bootstrap()->'batches'$q$)) b
    where b->>'id'=(select j->>'batch_id' from sl_imp where k='k1')),'inquiry/true/3');

-- ============================================================ batch removal
select pg_temp.expect('removing c1: rows no other batch touched and nobody edited go; the rest stay',
  pg_temp.as_json('ceo',format('select public.app_sales_remove_batch(%L)',(select j->>'batch_id' from sl_imp where k='c1')))::text,
  '{"kept": 3, "deleted": 7}');
select pg_temp.expect('... 900007 (also in re1), 900004 (edited), 900003 (the ledger wrote it too) survive',
  (select string_agg(record_no::text,',' order by record_no) from public.sales_rfps where company_id=pg_temp.fx('company') and record_no between 900001 and 900010),'900003,900004,900007');
select pg_temp.expect('a survivor steps out of c1; its first batch moves to the last remaining',
  (select (not (select (j->>'batch_id')::uuid from sl_imp where k='c1')=any(import_batches)
     and import_batch_id<>(select (j->>'batch_id')::uuid from sl_imp where k='c1'))::text from public.sales_rfps where id=pg_temp.rfp_id(900007)),'true');
select pg_temp.expect('c1 is no longer referenced by any row, so the batch is gone',
  (select count(*)::text from public.sales_import_batches where id=(select (j->>'batch_id')::uuid from sl_imp where k='c1')),'0');
select pg_temp.expect('an edited record that only one batch wrote: batch e1 made it',
  pg_temp.imp('e1','ceo','[{"rec":900070,"description":"will be edited","received_on":"2026-09-01"},{"rec":900071,"description":"stays untouched","received_on":"2026-09-01"}]')->>'created','2');
select pg_temp.expect('... a colleague works on 900070','ok',
  pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_comment(%L,'hello')::text$q$,pg_temp.rfp_id(900070)))));
select pg_temp.expect('... removing e1 deletes only the untouched one',
  pg_temp.as_json('ceo',format('select public.app_sales_remove_batch(%L)',(select j->>'batch_id' from sl_imp where k='e1')))::text,'{"kept": 1, "deleted": 1}');
select pg_temp.expect('... and e1 stays listed for the edited record that still belongs to it',
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_bootstrap()->'batches'$q$)) b
    where b->>'id'=(select j->>'batch_id' from sl_imp where k='e1')),'1');
select pg_temp.expect('customers nothing uses any more are gone, the others stay',
  (select string_agg(name,',' order by name) from public.sales_customers where company_id=pg_temp.fx('company') and name in ('Karun Test Co','Beta Oil','Gamma Gas','Delta')),'Beta Oil,Delta,Gamma Gas');
select pg_temp.expect('removing the chunked batch deletes its three untouched rows',
  pg_temp.as_json('ceo',format('select public.app_sales_remove_batch(%L)',(select j->>'batch_id' from sl_imp where k='k1')))::text,'{"kept": 0, "deleted": 3}');
select pg_temp.expect('... and the batch itself',
  (select count(*)::text from public.sales_import_batches where id=(select (j->>'batch_id')::uuid from sl_imp where k='k1')),'0');

-- ============================================================ record numbers and the list page
select pg_temp.expect('record numbers by origin',
  (select (j->'app')::text||'/'||(j->'inquiry')::text||'/'||(j->'ledger')::text from (select pg_temp.as_json('ceo','select public.app_sales_record_numbers()') j) t),
  '[900040]/[900004, 900007, 900050, 900051, 900070]/[900003, 900020, 900030]');
select pg_temp.expect('list page: default is the open records, newest number first',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{}')->'rows'$q$)) x),
  '900070,900051,900050,900040,900030,900020');
select pg_temp.expect('list page: closed',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"closed"}')->'rows'$q$)) x),'900007,900004,900003');
select pg_temp.expect('list page: all + totals',
  (select (j->>'total')||'/'||(j->>'truncated') from (select pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all"}')$q$) j) t),'9/false');
select pg_temp.expect('list page: flow filter',
  (select (j->>'total') from (select pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all","flow":"contract"}')$q$) j) t),'3');
select pg_temp.expect('list page: stage filter',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',format($q$select public.app_sales_list_page(jsonb_build_object('state','all','stage',%L))->'rows'$q$,pg_temp.stage('bid','lost')))) x),'900007,900004');
select pg_temp.expect('list page: owner filter',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',format($q$select public.app_sales_list_page(jsonb_build_object('state','all','owner',%L))->'rows'$q$,pg_temp.fx('viewer')))) x),'900030,900003');
select pg_temp.expect('list page: buyer filter',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',format($q$select public.app_sales_list_page(jsonb_build_object('state','all','buyer',%L))->'rows'$q$,
     (select id from public.sales_customers where company_id=pg_temp.fx('company') and name='Gamma Gas')))) x),'900007');
select pg_temp.expect('list page: q by record number',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all","q":"900020"}')->'rows'$q$)) x),'900020');
select pg_temp.expect('list page: q by buyer name, case-insensitive',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all","q":"gAMMa"}')->'rows'$q$)) x),'900007');
select pg_temp.expect('list page: q by customer reference',
  (select string_agg(x->>'record_no',',') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all","q":"REQ-7"}')->'rows'$q$)) x),'900007');
select pg_temp.expect('list page: % in q is literal, not a wildcard',
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all","q":"%"}')->'rows'$q$)) x),'0');
select pg_temp.expect('list page: limit and truncated',
  (select (jsonb_array_length(j->'rows'))||'/'||(j->>'total')||'/'||(j->>'truncated') from (select pg_temp.as_json('ceo',$q$select public.app_sales_list_page('{"state":"all","limit":3}')$q$) j) t),'3/9/true');
select pg_temp.expect('list page: a bad state is refused',
  pg_temp.msg(pg_temp.as_scalar('ceo',$q$select public.app_sales_list_page('{"state":"nope"}')::text$q$)),'sales: invalid input');
select pg_temp.expect('list page: another company sees nothing',
  (select (j->>'total') from (select pg_temp.as_json('other_admin',$q$select public.app_sales_list_page('{"state":"all"}')$q$) j) t),'0');

-- ============================================================ customer lookup (16.7)
select pg_temp.expect('add customer: new',
  (select (j->>'existed')||'/'||(j->>'name')||'/'||(j->>'kind') from (select pg_temp.as_json('seller',$q$select public.app_sales_add_customer('{"name":"  Karun   Tejarat Co ","kind":"government"}')$q$) j) t),
  'false/Karun Tejarat Co/government');
select pg_temp.expect('add customer: the same name key returns the existing one',
  (select (j->>'existed')||'/'||(j->>'name') from (select pg_temp.as_json('seller',$q$select public.app_sales_add_customer('{"name":"KARUN TEJARAT CO"}')$q$) j) t),'true/Karun Tejarat Co');
select pg_temp.expect('... and there is still one',
  (select count(*)::text from public.sales_customers where company_id=pg_temp.fx('company') and name_key='karun tejarat co'),'1');
select pg_temp.expect('add customer: an empty name or a bad kind is refused',
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_add_customer('{"name":"  "}')::text$q$))||'|'||
  pg_temp.msg(pg_temp.as_scalar('seller',$q$select public.app_sales_add_customer('{"name":"X Co","kind":"alien"}')::text$q$)),
  'sales: invalid input|sales: invalid input');
select pg_temp.expect('add customer needs sales edit',
  pg_temp.msg(pg_temp.as_scalar('viewer',$q$select public.app_sales_add_customer('{"name":"Y Co"}')::text$q$)),'sales: not allowed');
select pg_temp.expect('similar: two letters off on a long name (Karoon / Karun) is found, with its distance',
  (select (j->0->>'name')||'/'||(j->0->>'distance') from (select pg_temp.as_json('viewer',$q$select public.app_sales_similar_customers('Karoon Tejarat Co')$q$) j) t),'Karun Tejarat Co/2');
select pg_temp.expect('similar: a 6-letter name allows one letter, not two',
  (select pg_temp.as_scalar('seller',$q$select public.app_sales_add_customer('{"name":"Alborz"}')::text$q$) is not null)::text||':'||
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('viewer',$q$select public.app_sales_similar_customers('Alburz')$q$)))||':'||
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('viewer',$q$select public.app_sales_similar_customers('Alburrx')$q$))),'true:1:0');
select pg_temp.expect('similar: spaces, case and punctuation do not matter',
  (select (j->0->>'distance') from (select pg_temp.as_json('viewer',$q$select public.app_sales_similar_customers('karun-tejarat  CO.')$q$) j) t),'0');
select pg_temp.expect('similar: an unrelated name finds nothing',
  pg_temp.as_scalar('viewer',$q$select public.app_sales_similar_customers('Completely Other Industries')::text$q$),'[]');
select pg_temp.expect('similar: short names match only when equal',
  (select pg_temp.as_scalar('seller',$q$select public.app_sales_add_customer('{"name":"ABCD"}')::text$q$) is not null)::text||':'||
  pg_temp.as_scalar('viewer',$q$select public.app_sales_similar_customers('ABCE')::text$q$),'true:[]');
select pg_temp.expect('similar: needs the module only',
  pg_temp.msg(pg_temp.as_scalar('nobody',$q$select public.app_sales_similar_customers('x')::text$q$)),'sales: not allowed');

-- ============================================================ read-only safe (View as)
set local transaction_read_only = on;
select pg_temp.assert('the read functions work in a read-only transaction',
  pg_temp.as_json('viewer',$q$select public.app_sales_list_page('{"state":"all"}')$q$) is not null
  and pg_temp.as_json('viewer',$q$select public.app_sales_similar_customers('Karun Tejarat Co')$q$) is not null
  and pg_temp.as_json('ceo','select public.app_sales_record_numbers()') is not null);

rollback;
