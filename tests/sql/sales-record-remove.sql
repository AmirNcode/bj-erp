-- Sales record archive / soft-delete / restore (2026-11-23): admin-only removal, hidden readers, imports.
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

-- Extra fixtures: a second company's reader, and a test account that also holds a sales role.
do $$
declare v_role uuid; v_other uuid:=pg_temp.fx('other_company'); v_dept uuid;
begin
  select id into v_dept from public.departments where company_id=v_other;
  insert into sl_fx values('other_reader',gen_random_uuid()),('tester',gen_random_uuid()),('uploader2',gen_random_uuid());
  insert into auth.users(id,email) values(pg_temp.fx('other_reader'),'9990940011@sales-fixture.invalid');
  insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
    values(pg_temp.fx('other_reader'),v_other,v_dept,'9990940011','9990940011','Fixture other_reader',false);
  insert into public.user_roles(user_id,role) values(pg_temp.fx('other_reader'),'employee');
  insert into public.roles(company_id,kind,name) values(v_other,'custom','SlOtherReader') returning id into v_role;
  insert into public.role_permissions values(v_role,'sales','read');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('other_reader'),v_role);
  -- a second sales editor of company 1 (not the uploader)
  insert into auth.users(id,email) values(pg_temp.fx('uploader2'),'9990940013@sales-fixture.invalid');
  insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
    select pg_temp.fx('uploader2'),company_id,department_id,'9990940013','9990940013','Fixture uploader2',false from public.profiles where id=pg_temp.fx('seller');
  insert into public.user_roles(user_id,role) values(pg_temp.fx('uploader2'),'employee');
  select id into v_role from public.roles where company_id=pg_temp.fx('company') and name='SlSeller';
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('uploader2'),v_role);
  -- test-emp plus a sales role
  insert into auth.users(id,email) values(pg_temp.fx('tester'),'9990940012@sales-fixture.invalid');
  insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
    select pg_temp.fx('tester'),company_id,department_id,'9990940012','9990940012','Fixture tester',false from public.profiles where id=pg_temp.fx('seller');
  insert into public.user_roles(user_id,role) values(pg_temp.fx('tester'),'test-emp');
  insert into public.user_roles(user_id,role_id) values(pg_temp.fx('tester'),v_role);
end; $$;

-- helpers for this file
create temp table rm_cnt(k text primary key,n bigint);
-- Rows of a list_page state (as p_user) carrying record number p_no.
create function pg_temp.in_page(p_user text,p_state text,p_no integer) returns bigint language sql as $$
  select count(*) from jsonb_array_elements(pg_temp.as_json(p_user,
    format($q$select public.app_sales_list_page('{"state":"%s"}')->'rows'$q$,p_state))) x where (x->>'record_no')::integer=p_no;
$$;
create function pg_temp.rno(p_rec text) returns integer language sql as $$
  select record_no from public.sales_rfps where id=pg_temp.fx(p_rec);
$$;
create function pg_temp.ev(p_rec text,p_kind text) returns bigint language sql as $$
  select count(*) from public.sales_events where rfp_id=pg_temp.fx(p_rec) and kind=p_kind;
$$;

update public.sales_settings set next_record_no=9101 where company_id=pg_temp.fx('company');
insert into sl_fx select 'a',(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,
  '{"flow_kind":"bid","title":"Remove A","buyer":"Remove Buyer","currency":"EUR","proposal_due":"2026-12-01","needs_quote":true,"quote_due":"2026-12-01","our_price":1000}')::text$q$))::uuid;
insert into sl_fx select 'c',(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,
  '{"flow_kind":"contract","title":"Remove C","buyer":"Remove Buyer","delivery_date":"2027-01-01"}')::text$q$))::uuid;
insert into sl_fx select 'b',(pg_temp.as_scalar('ceo',$q$select public.app_sales_save_record(null,
  '{"flow_kind":"bid","title":"Remove B","buyer":"Remove Buyer","currency":"EUR","proposal_due":"2026-12-05","our_price":500}')::text$q$))::uuid;
insert into sl_fx select 'bnode',(pg_temp.as_json('ceo',format($q$select public.app_project_save_node(%L,null,null,'{"description":"Zzwell item","qty":2}')$q$,pg_temp.fx('b')))->>'id')::uuid;
select pg_temp.expect('payment on B','ok',pg_temp.msg(pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_payment(%L,null,'{"amount":10}')::text$q$,pg_temp.fx('b')))));
insert into public.sales_quote_lines(company_id,rfp_id,revision,code,description,qty,unit_price,quoted_on)
  select pg_temp.fx('company'),pg_temp.fx('b'),1,'ZZWELL-1','Zzwell body',1,400,'2026-11-20';
insert into public.sales_files(id,company_id,rfp_id,stage_id,name,size_bytes,status,uploaded_by)
  select gen_random_uuid(),pg_temp.fx('company'),pg_temp.fx('b'),pg_temp.stage('bid','received'),'b.pdf',5,'ready',pg_temp.fx('seller');
insert into sl_fx select 'bfile',id from public.sales_files where rfp_id=pg_temp.fx('b');
select pg_temp.expect('fixture: A has an open auto deadline',(select (count(*)>0)::text from public.sales_deadlines where rfp_id=pg_temp.fx('a') and done_at is null),'true');
select pg_temp.expect('fixture: C has an open delivery deadline',(select (count(*)>0)::text from public.sales_deadlines where rfp_id=pg_temp.fx('c') and kind='delivery_due' and done_at is null),'true');
select pg_temp.expect('the contract flow now has an Archived stage (kind archived, last)',
  (select s.kind||':'||(s.position=(select max(position) from public.sales_stages where flow_id=s.flow_id))::text
     from public.sales_stages s join public.sales_flows f on f.id=s.flow_id
    where f.company_id=pg_temp.fx('company') and f.kind='contract' and s.code='archived'),'archived:true');
select pg_temp.expect('caps: admin has remove_records',pg_temp.as_json('admin',$q$select public.app_sales_bootstrap()->'caps'->'remove_records'$q$)::text,'true');
select pg_temp.expect('caps: a sales editor with every sales slice has not',pg_temp.as_json('ceo',$q$select public.app_sales_bootstrap()->'caps'->'remove_records'$q$)::text,'false');

-- ============================================================ archive
select pg_temp.expect('ceo (sales_decide) cannot archive',pg_temp.as_scalar('ceo',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('a'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('seller cannot archive',pg_temp.as_scalar('seller',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('a'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('a test-emp user cannot archive',pg_temp.as_scalar('tester',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('a'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('nothing changed by the refusals',pg_temp.stage_of('a'),'received');
select pg_temp.expect('admin of another company: not found',pg_temp.as_scalar('other_admin',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('a'))),'ERROR P0002 sales: not found');
select pg_temp.expect('admin archives the RFP','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('a')))));
select pg_temp.expect('RFP is in the Archived stage',pg_temp.stage_of('a'),'archived');
select pg_temp.expect('stage kind is archived',(select s.kind from public.sales_rfps r join public.sales_stages s on s.id=r.stage_id where r.id=pg_temp.fx('a')),'archived');
select pg_temp.expect('one archived event',pg_temp.ev('a','archived')::text,'1');
select pg_temp.expect('the event body holds only the previous stage',(select (body-'from_stage')::text from public.sales_events where rfp_id=pg_temp.fx('a') and kind='archived'),'{}');
select pg_temp.expect('result date set',(select (result_at is not null)::text from public.sales_rfps where id=pg_temp.fx('a')),'true');
select pg_temp.expect('no open auto deadline left on the RFP',(select count(*)::text from public.sales_deadlines where rfp_id=pg_temp.fx('a') and done_at is null),'0');
select pg_temp.expect('archive again: stage not available',pg_temp.as_scalar('admin',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('a'))),'ERROR 22023 sales: stage not available');
select pg_temp.expect('an archived record reads as closed in the list',pg_temp.in_page('ceo','closed',pg_temp.rno('a'))::text,'1');
select pg_temp.expect('admin archives the contract','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('c')))));
select pg_temp.expect('contract is in the Archived stage',pg_temp.stage_of('c'),'archived');
select pg_temp.expect('contract stays in the contract flow',(select f.kind from public.sales_rfps r join public.sales_flows f on f.id=r.flow_id where r.id=pg_temp.fx('c')),'contract');
select pg_temp.expect('contract delivery deadline closed',(select count(*)::text from public.sales_deadlines where rfp_id=pg_temp.fx('c') and done_at is null),'0');

-- ============================================================ delete: before-counts
insert into rm_cnt select 'cust_records',((pg_temp.as_json('ceo',format($q$select public.app_sales_customer(%L)->'customer'$q$,(select id from public.sales_customers where name='Remove Buyer')))->>'records')::bigint);
insert into rm_cnt select 'metrics_projects',((pg_temp.as_json('ceo',format($q$select public.app_sales_metrics(%L,'2026-01-01','2025-01-01')$q$,(select id from public.sales_customers where name='Remove Buyer')))->>'projects')::bigint);
insert into rm_cnt select 'pipeline',(select coalesce(sum((x->>'count')::bigint),0) from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_report()->'pipeline'$q$)) x);
select pg_temp.expect('before: B in the open list',pg_temp.in_page('ceo','open',pg_temp.rno('b'))::text,'1');
select pg_temp.expect('before: B in app_sales_list',(select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list()$q$)) x where (x->>'record_no')::integer=pg_temp.rno('b')),'1');
select pg_temp.expect('before: B has deadlines on the board',(select (count(*)>0)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_deadlines(true)$q$)) x where (x->>'record_no')::integer=pg_temp.rno('b')),'true');
select pg_temp.expect('before: B number is listed',(select (pg_temp.as_json('ceo',$q$select public.app_sales_record_numbers()->'app'$q$)::jsonb @> to_jsonb(pg_temp.rno('b')))::text),'true');
select pg_temp.expect('before: find by number',(pg_temp.as_json('ceo',format($q$select public.app_sales_find_node(%L)$q$,pg_temp.rno('b')::text))->>'rfp_id'),pg_temp.fx('b')::text);
select pg_temp.expect('before: find by item code',(pg_temp.as_json('ceo',format($q$select public.app_sales_find_node(%L)$q$,(select code from public.project_nodes where id=pg_temp.fx('bnode'))))->>'node_id'),pg_temp.fx('bnode')::text);
select pg_temp.expect('before: price history finds the quote line',jsonb_array_length(pg_temp.as_json('ceo',$q$select public.app_sales_price_history('zzwell')$q$)::jsonb)::text,'1');
select pg_temp.expect('before: the buyer has 3 records',(select n::text from rm_cnt where k='cust_records'),'3');

-- ============================================================ delete
select pg_temp.expect('ceo cannot delete',pg_temp.as_scalar('ceo',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('seller cannot delete',pg_temp.as_scalar('seller',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('a test-emp user cannot delete',pg_temp.as_scalar('tester',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('admin of another company: not found',pg_temp.as_scalar('other_admin',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('the refusals changed nothing',(select (deleted_at is null)::text from public.sales_rfps where id=pg_temp.fx('b')),'true');
select pg_temp.expect('admin deletes B','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b')))));
select pg_temp.expect('deleted_at / deleted_by are set',(select (deleted_at is not null and deleted_by=pg_temp.fx('admin'))::text from public.sales_rfps where id=pg_temp.fx('b')),'true');
select pg_temp.expect('one deleted event, empty body',(select pg_temp.ev('b','deleted')||':'||(select body::text from public.sales_events where rfp_id=pg_temp.fx('b') and kind='deleted')),'1:{}');
select pg_temp.expect('the stage did not change',pg_temp.stage_of('b'),'received');
select pg_temp.expect('delete again: not found',pg_temp.as_scalar('admin',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('archive of a deleted record: not found',pg_temp.as_scalar('admin',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('list_page open: B gone',pg_temp.in_page('ceo','open',pg_temp.rno('b'))::text,'0');
select pg_temp.expect('list_page closed: B gone',pg_temp.in_page('ceo','closed',pg_temp.rno('b'))::text,'0');
select pg_temp.expect('list_page all: B gone',pg_temp.in_page('ceo','all',pg_temp.rno('b'))::text,'0');
select pg_temp.expect('list_page all for the admin: B gone',pg_temp.in_page('admin','all',pg_temp.rno('b'))::text,'0');
select pg_temp.expect('app_sales_list: B gone',(select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_list()$q$)) x where (x->>'record_no')::integer=pg_temp.rno('b')),'0');
select pg_temp.expect('the report pipeline counts one record less',
  (select ((select n from rm_cnt where k='pipeline')-coalesce(sum((x->>'count')::bigint),0))::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_report()->'pipeline'$q$)) x),'1');
select pg_temp.expect('metrics count one project less',
  ((select n from rm_cnt where k='metrics_projects')-(pg_temp.as_json('ceo',format($q$select public.app_sales_metrics(%L,'2026-01-01','2025-01-01')$q$,(select id from public.sales_customers where name='Remove Buyer')))->>'projects')::bigint)::text,'1');
select pg_temp.expect('the customer page counts one record less',
  ((select n from rm_cnt where k='cust_records')-(pg_temp.as_json('ceo',format($q$select public.app_sales_customer(%L)->'customer'$q$,(select id from public.sales_customers where name='Remove Buyer')))->>'records')::bigint)::text,'1');
select pg_temp.expect('the customer list counts it too',
  (select (x->>'records') from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_customers()$q$)) x where x->>'name'='Remove Buyer'),'2');
select pg_temp.expect('deadlines: none of B on the board',(select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_deadlines(true)$q$)) x where (x->>'record_no')::integer=pg_temp.rno('b')),'0');
select pg_temp.expect('record numbers: B gone',(select (pg_temp.as_json('ceo',$q$select public.app_sales_record_numbers()->'app'$q$)::jsonb @> to_jsonb(pg_temp.rno('b')))::text),'false');
select pg_temp.expect('find by number: nothing',coalesce(pg_temp.as_json('ceo',format($q$select public.app_sales_find_node(%L)$q$,pg_temp.rno('b')::text))::text,'null'),'null');
select pg_temp.expect('find by item code: nothing',coalesce(pg_temp.as_json('ceo',format($q$select public.app_sales_find_node(%L)$q$,(select code from public.project_nodes where id=pg_temp.fx('bnode'))))::text,'null'),'null');
select pg_temp.expect('price history: nothing',jsonb_array_length(pg_temp.as_json('ceo',$q$select public.app_sales_price_history('zzwell')$q$)::jsonb)::text,'0');
select pg_temp.expect('people to match: B in-charge text not listed',
  (select count(*)::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_people_to_match()$q$)) x),'0');

-- deleted list: admin only
select pg_temp.expect('admin sees B under Deleted',pg_temp.in_page('admin','deleted',pg_temp.rno('b'))::text,'1');
select pg_temp.expect('...with who and when',(select (x->>'deleted_by_name')||':'||((x->>'deleted_at') is not null)::text
    from jsonb_array_elements(pg_temp.as_json('admin',$q$select public.app_sales_list_page('{"state":"deleted"}')->'rows'$q$)) x where (x->>'record_no')::integer=pg_temp.rno('b')),'Fixture admin:true');
select pg_temp.expect('Deleted holds only deleted rows',(select count(*)::text from jsonb_array_elements(pg_temp.as_json('admin',$q$select public.app_sales_list_page('{"state":"deleted"}')->'rows'$q$)) x),'1');
select pg_temp.expect('state deleted for a non-admin: invalid input',pg_temp.as_scalar('ceo',$q$select public.app_sales_list_page('{"state":"deleted"}')::text$q$),'ERROR 22023 sales: invalid input');
select pg_temp.expect('state deleted for a seller: invalid input',pg_temp.as_scalar('seller',$q$select public.app_sales_list_page('{"state":"deleted"}')::text$q$),'ERROR 22023 sales: invalid input');

-- per-record calls on a deleted record
select pg_temp.expect('save_record: not found',pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_record(%L,'{"title":"zz"}')::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('comment: not found',pg_temp.as_scalar('ceo',format($q$select public.app_sales_comment(%L,'hi')::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('save_payment: not found',pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_payment(%L,null,'{"amount":1}')::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('save_node: not found',pg_temp.as_scalar('ceo',format($q$select public.app_project_save_node(%L,null,null,'{"description":"x"}')::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('file begin: not found',pg_temp.as_scalar('ceo',format($q$select public.app_sales_file_begin(%L,%L,'x.pdf',5,null)::text$q$,pg_temp.fx('b'),pg_temp.stage('bid','received'))),'ERROR P0002 sales: not found');
select pg_temp.expect('record for a sales editor: not found',pg_temp.as_scalar('ceo',format($q$select public.app_sales_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('record for a reader: not found',pg_temp.as_scalar('viewer',format($q$select public.app_sales_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR P0002 sales: not found');
select pg_temp.expect('the admin can still open it, with deleted_at',((pg_temp.as_json('admin',format($q$select public.app_sales_record(%L)->'record'$q$,pg_temp.fx('b')))->>'deleted_at') is not null)::text,'true');
select pg_temp.expect('...and who deleted it',(pg_temp.as_json('admin',format($q$select public.app_sales_record(%L)->'record'$q$,pg_temp.fx('b')))->>'deleted_by_name'),'Fixture admin');
select pg_temp.expect('a file of a deleted record: not found for a reader',pg_temp.as_scalar('viewer',format($q$select public.app_sales_file_get(%L)::text$q$,pg_temp.fx('bfile'))),'ERROR P0002 sales: not found');
select pg_temp.expect('...but the admin can read it',(pg_temp.as_json('admin',format($q$select public.app_sales_file_get(%L)$q$,pg_temp.fx('bfile')))->>'name'),'b.pdf');

-- ============================================================ restore
select pg_temp.expect('ceo cannot restore',pg_temp.as_scalar('ceo',format($q$select public.app_sales_restore_record(%L)::text$q$,pg_temp.fx('b'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('restore of a live record: not found',pg_temp.as_scalar('admin',format($q$select public.app_sales_restore_record(%L)::text$q$,pg_temp.fx('c'))),'ERROR P0002 sales: not found');
select pg_temp.expect('admin restores B','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_restore_record(%L)::text$q$,pg_temp.fx('b')))));
select pg_temp.expect('deleted columns cleared',(select (deleted_at is null and deleted_by is null)::text from public.sales_rfps where id=pg_temp.fx('b')),'true');
select pg_temp.expect('restored event logged',pg_temp.ev('b','restored')::text,'1');
select pg_temp.expect('same stage after restore',pg_temp.stage_of('b'),'received');
select pg_temp.expect('back in the open list',pg_temp.in_page('ceo','open',pg_temp.rno('b'))::text,'1');
select pg_temp.expect('gone from Deleted',pg_temp.in_page('admin','deleted',pg_temp.rno('b'))::text,'0');
select pg_temp.expect('back in the report pipeline',
  (select ((select n from rm_cnt where k='pipeline')-coalesce(sum((x->>'count')::bigint),0))::text from jsonb_array_elements(pg_temp.as_json('ceo',$q$select public.app_sales_report()->'pipeline'$q$)) x),'0');
select pg_temp.expect('back in the price history',jsonb_array_length(pg_temp.as_json('ceo',$q$select public.app_sales_price_history('zzwell')$q$)::jsonb)::text,'1');
select pg_temp.expect('the record opens for a reader again',pg_temp.msg(pg_temp.as_scalar('viewer',format($q$select public.app_sales_record(%L)::text$q$,pg_temp.fx('b')))),'ok');
select pg_temp.expect('its items and payment came back',(select count(*)::text from public.project_nodes where rfp_id=pg_temp.fx('b'))||':'||(select count(*)::text from public.sales_payments where rfp_id=pg_temp.fx('b')),'1:1');

-- ============================================================ imports skip deleted records
insert into sl_fx select 'impbatch',gen_random_uuid();
create temp table rm_imp(k text primary key,j jsonb);
insert into rm_imp select 'led',pg_temp.as_json('ceo',$q$select public.app_sales_import('l.csv','[{"rec":900901,"buyer":"Remove Ledger","description":"Ledger row","status":"current"}]')$q$);
select pg_temp.expect('ledger import created the row',(select j->>'created' from rm_imp where k='led'),'1');
select pg_temp.expect('admin deletes the imported record','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_delete_record(%L)::text$q$,
  (select id from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900901)))));
insert into rm_imp select 'led2',pg_temp.as_json('ceo',$q$select public.app_sales_import('l2.csv','[{"rec":900901,"buyer":"Remove Ledger","description":"Changed","status":"finish"}]')$q$);
select pg_temp.expect('ledger import: the deleted match is counted',(select j->>'deleted' from rm_imp where k='led2'),'1');
select pg_temp.expect('ledger import: ...skipped, nothing created or updated',(select (j->>'skipped')||(j->>'created')||(j->>'updated') from rm_imp where k='led2'),'100');
select pg_temp.expect('ledger import: the record is untouched and still deleted',
  (select (deleted_at is not null)::text||':'||title from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900901),'true:Ledger row');
-- an app-made deleted record is reported as deleted too
select pg_temp.expect('admin deletes C','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('c')))));
insert into rm_imp select 'led3',pg_temp.as_json('ceo',format($q$select public.app_sales_import('l3.csv',%L)$q$,jsonb_build_array(jsonb_build_object('rec',pg_temp.rno('c'),'description','x'))::text));
select pg_temp.expect('ledger import: an app-made deleted record counts as deleted',(select (j->>'deleted')||(j->>'skipped') from rm_imp where k='led3'),'11');
-- inquiry import
insert into rm_imp select 'inq1',pg_temp.as_json('ceo',$q$select public.app_sales_import_inquiries(null,'i.csv','[{"rec":900902,"buyer":"Remove Inq","description":"Inquiry row"}]','{}','2026-06-01',true)$q$);
select pg_temp.expect('inquiry import created the row',(select j->>'created' from rm_imp where k='inq1'),'1');
select pg_temp.expect('admin deletes the inquiry record','ok',pg_temp.msg(pg_temp.as_scalar('admin',format($q$select public.app_sales_delete_record(%L)::text$q$,
  (select id from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900902)))));
insert into rm_imp select 'inq2',pg_temp.as_json('ceo',$q$select public.app_sales_import_inquiries(null,'i2.csv','[{"rec":900902,"buyer":"Remove Inq","description":"Inquiry row 2"}]','{}','2026-06-01',true)$q$);
select pg_temp.expect('inquiry import: the deleted match is counted',(select (j->>'deleted')||(j->>'skipped')||(j->>'created')||(j->>'updated') from rm_imp where k='inq2'),'1100');
select pg_temp.expect('inquiry import: still deleted, title unchanged',
  (select (deleted_at is not null)::text||':'||title from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900902),'true:Inquiry row');
-- remove batch hard-removes a deleted record of its batch
select pg_temp.expect('remove batch takes its deleted untouched record with it',
  pg_temp.as_json('ceo',format('select public.app_sales_remove_batch(%L)',(select j->>'batch_id' from rm_imp where k='inq1')))::text,'{"kept": 0, "deleted": 1}');
select pg_temp.expect('...and it is gone for good',(select count(*)::text from public.sales_rfps where company_id=pg_temp.fx('company') and record_no=900902),'0');

-- ============================================================ FR-95 / read-only
select pg_temp.expect('a test-emp user with a sales role cannot open the deleted list',pg_temp.as_scalar('tester',$q$select public.app_sales_list_page('{"state":"deleted"}')::text$q$),'ERROR 42501 sales: not allowed');

-- ============================================================ read-only (View as) — keep LAST
set local transaction_read_only = on;
select pg_temp.expect('View as: archive refused with 25006',left(pg_temp.as_scalar('admin',format($q$select public.app_sales_archive(%L)::text$q$,pg_temp.fx('b'))),11),'ERROR 25006');
select pg_temp.expect('View as: delete refused with 25006',left(pg_temp.as_scalar('admin',format($q$select public.app_sales_delete_record(%L)::text$q$,pg_temp.fx('b'))),11),'ERROR 25006');
select pg_temp.expect('View as: restore refused with 25006',left(pg_temp.as_scalar('admin',format($q$select public.app_sales_restore_record(%L)::text$q$,pg_temp.fx('c'))),11),'ERROR 25006');
select pg_temp.expect('View as: the deleted list still reads',pg_temp.in_page('admin','deleted',pg_temp.rno('c'))::text,'1');
select pg_temp.expect('View as: the record still loads for the admin',(pg_temp.as_json('admin',format($q$select public.app_sales_record(%L)->'record'$q$,pg_temp.fx('c')))->>'title'),'Remove C');

rollback;
