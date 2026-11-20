-- Sales files (2026-11-20, CEO feedback task 5): record files metadata and permissions.
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

insert into sl_fx select 'rec',(pg_temp.as_scalar('seller',$q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"Files record"}')::text$q$))::uuid;
insert into sl_fx select 'rec2',(pg_temp.as_scalar('seller',$q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"Files record 2"}')::text$q$))::uuid;

-- ============================================================ begin / commit
select pg_temp.expect('reader without edit cannot begin',pg_temp.as_scalar('viewer',
  format($q$select public.app_sales_file_begin(%L,%L,'a.pdf',1000,'application/pdf')::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('size over the cap refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'big.bin',52428801,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('size 0 refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'zero.bin',0,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('control characters in the name refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,E'a\nb.pdf',10,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('empty name refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'   ',10,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('name over 255 refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,repeat('x',256),10,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('unknown stage refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'a.pdf',10,null)::text$q$,pg_temp.fx('rec'),gen_random_uuid())),'ERROR 22023 sales: invalid input');
select pg_temp.expect('nothing stored by the refusals',(select count(*)::text from public.sales_files),'0');

insert into sl_fx select 'f1',((pg_temp.as_json('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'قرارداد "نهایی".pdf',52428800,'application/pdf')$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))))->>'id')::uuid;
select pg_temp.expect('a 50 MB file is accepted as pending',(select status from public.sales_files where id=pg_temp.fx('f1')),'pending');
select pg_temp.expect('begin returns the company',(select (company_id=pg_temp.fx('company'))::text from public.sales_files where id=pg_temp.fx('f1')),'true');
select pg_temp.expect('pending file is not listed',jsonb_array_length(pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'$q$,pg_temp.fx('rec')))::jsonb)::text,'0');
select pg_temp.expect('commit by a different user refused',pg_temp.as_scalar('uploader2',
  format($q$select public.app_sales_file_commit(%L,52428800,null)::text$q$,pg_temp.fx('f1'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('commit with another size refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_commit(%L,1,null)::text$q$,pg_temp.fx('f1'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('commit with a bad hash refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_commit(%L,52428800,'xyz')::text$q$,pg_temp.fx('f1'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('get of a pending file is not found',pg_temp.as_scalar('viewer',
  format($q$select public.app_sales_file_get(%L)::text$q$,pg_temp.fx('f1'))),'ERROR P0002 sales: not found');
select pg_temp.expect('uploader commits',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_commit(%L,52428800,%L)::text$q$,pg_temp.fx('f1'),repeat('a',64)))),'ok');
select pg_temp.expect('now ready',(select status from public.sales_files where id=pg_temp.fx('f1')),'ready');
select pg_temp.expect('a second commit refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_commit(%L,52428800,null)::text$q$,pg_temp.fx('f1'))),'ERROR 22023 sales: invalid input');
select pg_temp.expect('a reader sees the file in the record',
  (pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))->>'name'),'قرارداد "نهایی".pdf');
select pg_temp.expect('uploader name is joined',
  (pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))->>'uploader_name'),'Fixture seller');
select pg_temp.expect('reader cannot delete (can_delete false)',
  (pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))->>'can_delete'),'false');
select pg_temp.expect('uploader can delete (can_delete true)',
  (pg_temp.as_json('seller',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))->>'can_delete'),'true');
select pg_temp.expect('another editor cannot delete (can_delete false)',
  (pg_temp.as_json('uploader2',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))->>'can_delete'),'false');
select pg_temp.expect('settings holder can delete (can_delete true)',
  (pg_temp.as_json('ceo',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))->>'can_delete'),'true');
select pg_temp.expect('the record json has no file internals',
  (pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec')))::jsonb ? 'company_id')::text,'false');
select pg_temp.expect('an add event is logged',(select count(*)::text from public.sales_events where rfp_id=pg_temp.fx('rec') and kind='file' and body->>'action'='add'),'1');

-- ------------------------------------------------------------ get: no existence leak
select pg_temp.expect('a sales reader gets the file',(pg_temp.as_json('viewer',format($q$select public.app_sales_file_get(%L)$q$,pg_temp.fx('f1')))->>'size_bytes'),'52428800');
select pg_temp.expect('another company reader: not found',pg_temp.as_scalar('other_reader',
  format($q$select public.app_sales_file_get(%L)::text$q$,pg_temp.fx('f1'))),'ERROR P0002 sales: not found');
select pg_temp.expect('a random id gives the identical error',pg_temp.as_scalar('other_reader',
  format($q$select public.app_sales_file_get(%L)::text$q$,gen_random_uuid())),'ERROR P0002 sales: not found');
select pg_temp.expect('no sales role: not allowed',pg_temp.as_scalar('nobody',
  format($q$select public.app_sales_file_get(%L)::text$q$,pg_temp.fx('f1'))),'ERROR 42501 sales: not allowed');

-- ------------------------------------------------------------ abort
insert into sl_fx select 'f2',((pg_temp.as_json('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'tmp.bin',5,null)$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))))->>'id')::uuid;
select pg_temp.expect('abort by another user refused',pg_temp.as_scalar('uploader2',
  format($q$select public.app_sales_file_abort(%L)::text$q$,pg_temp.fx('f2'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('uploader aborts',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_abort(%L)::text$q$,pg_temp.fx('f2')))),'ok');
select pg_temp.expect('aborted row gone, no event',(select count(*)::text from public.sales_files where id=pg_temp.fx('f2')),'0');
select pg_temp.expect('abort of a ready file refused',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_abort(%L)::text$q$,pg_temp.fx('f1'))),'ERROR 22023 sales: invalid input');

-- ------------------------------------------------------------ delete
select pg_temp.expect('non-uploader editor cannot delete',pg_temp.as_scalar('uploader2',
  format($q$select public.app_sales_file_delete(%L)::text$q$,pg_temp.fx('f1'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('another company cannot delete',pg_temp.as_scalar('other_reader',
  format($q$select public.app_sales_file_delete(%L)::text$q$,pg_temp.fx('f1'))),'ERROR 42501 sales: not allowed');
insert into sl_fx select 'f3',((pg_temp.as_json('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'spec.docx',2000,null)$q$,pg_temp.fx('rec'),pg_temp.stage('bid','technical'))))->>'id')::uuid;
select pg_temp.as_scalar('seller',format($q$select public.app_sales_file_commit(%L,2000,null)::text$q$,pg_temp.fx('f3')));
select pg_temp.expect('the settings holder deletes it',(pg_temp.as_json('ceo',format($q$select public.app_sales_file_delete(%L)$q$,pg_temp.fx('f3')))->>'rfp_id'),pg_temp.fx('rec')::text);
insert into sl_fx select 'f4',((pg_temp.as_json('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'own.txt',20,null)$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))))->>'id')::uuid;
select pg_temp.as_scalar('seller',format($q$select public.app_sales_file_commit(%L,20,null)::text$q$,pg_temp.fx('f4')));
select pg_temp.expect('the uploader deletes their own',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_delete(%L)::text$q$,pg_temp.fx('f4')))),'ok');
select pg_temp.expect('delete of a gone file is not found',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_delete(%L)::text$q$,pg_temp.fx('f4'))),'ERROR P0002 sales: not found');
select pg_temp.expect('file events: 3 adds, 2 deletes',(select count(*) filter (where body->>'action'='add')||'/'||count(*) filter (where body->>'action'='delete')
  from public.sales_events where rfp_id=pg_temp.fx('rec') and kind='file'),'3/2');

-- ------------------------------------------------------------ closed record
insert into sl_fx select 'f5',((pg_temp.as_json('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'closed.txt',20,null)$q$,pg_temp.fx('rec2'),pg_temp.stage('bid','received'))))->>'id')::uuid;
select pg_temp.as_scalar('seller',format($q$select public.app_sales_file_commit(%L,20,null)::text$q$,pg_temp.fx('f5')));
update public.sales_rfps set stage_id=pg_temp.stage('bid','lost') where id=pg_temp.fx('rec2');
select pg_temp.expect('closed record: begin refused for an editor',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'late.txt',20,null)::text$q$,pg_temp.fx('rec2'),pg_temp.stage('bid','received'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('closed record: delete refused for the uploader',pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_delete(%L)::text$q$,pg_temp.fx('f5'))),'ERROR 42501 sales: not allowed');
select pg_temp.expect('closed record: can_delete false for the uploader',
  (pg_temp.as_json('seller',format($q$select public.app_sales_record(%L)->'files'->0$q$,pg_temp.fx('rec2')))->>'can_delete'),'false');
select pg_temp.expect('closed record: the decider can still delete',pg_temp.msg(pg_temp.as_scalar('ceo',
  format($q$select public.app_sales_file_delete(%L)::text$q$,pg_temp.fx('f5')))),'ok');

-- ------------------------------------------------------------ moved to the contract flow
insert into sl_fx select 'f6',((pg_temp.as_json('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'rfp-pack.zip',99,null)$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received'))))->>'id')::uuid;
select pg_temp.as_scalar('seller',format($q$select public.app_sales_file_commit(%L,99,null)::text$q$,pg_temp.fx('f6')));
update public.sales_rfps set flow_id=(select id from public.sales_flows where company_id=pg_temp.fx('company') and kind='contract'),
  stage_id=pg_temp.stage('contract','new') where id=pg_temp.fx('rec');
select pg_temp.expect('contract flow: a bid-flow stage id is still accepted',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'after-win.txt',5,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received')))),'ok');
select pg_temp.expect('contract flow: earlier files still listed',
  (select string_agg(x->>'name',',') from jsonb_array_elements(pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'$q$,pg_temp.fx('rec')))) x),
  'rfp-pack.zip,قرارداد "نهایی".pdf');  -- same transaction time, so ordered by name

-- ------------------------------------------------------------ stage with files cannot be deleted
do $$
begin
  begin
    delete from public.sales_stages where id=pg_temp.stage('bid','received');
    raise exception 'FAIL stage delete should have been refused';
  exception when foreign_key_violation then raise notice 'PASS stage with files is protected (23503)';
  end;
end; $$;

-- ------------------------------------------------------------ gc
insert into sl_fx select 'old',gen_random_uuid();
insert into sl_fx select 'fresh',gen_random_uuid();
insert into public.sales_files(id,company_id,rfp_id,stage_id,name,size_bytes,status,uploaded_by,uploaded_at)
  select pg_temp.fx('old'),pg_temp.fx('company'),pg_temp.fx('rec'),pg_temp.stage('bid','received'),'old.tmp',5,'pending',pg_temp.fx('seller'),now()-interval '2 days';
insert into public.sales_files(id,company_id,rfp_id,stage_id,name,size_bytes,status,uploaded_by)
  select pg_temp.fx('fresh'),pg_temp.fx('company'),pg_temp.fx('rec'),pg_temp.stage('bid','received'),'fresh.tmp',5,'pending',pg_temp.fx('seller');
select pg_temp.expect('gc reports the one stale pending row',(select (x->>'id') from private.sales_files_gc() x),pg_temp.fx('old')::text);
select pg_temp.expect('stale row gone, fresh kept',(select count(*)::text from public.sales_files where id in (pg_temp.fx('old'),pg_temp.fx('fresh'))),'1');
select pg_temp.expect('sales_file_ids lists every status',(select count(*)::text from private.sales_file_ids() i where i=pg_temp.fx('fresh')),'1');
select pg_temp.expect('gc is not callable by clients',pg_temp.as_scalar('ceo',$q$select count(*)::text from private.sales_files_gc()$q$),'ERROR 42501 permission denied for function sales_files_gc');
select pg_temp.expect('the table carries no client grants',(select count(*)::text from information_schema.role_table_grants where table_name='sales_files' and grantee in ('anon','authenticated')),'0');

-- ------------------------------------------------------------ FR-95: test accounts
select pg_temp.expect('a test-emp user with a sales role is refused',pg_temp.as_scalar('tester',
  $q$select public.app_sales_bootstrap()::text$q$),'ERROR 42501 sales: not allowed');
select pg_temp.expect('...and cannot fetch a file either',pg_temp.as_scalar('tester',
  format($q$select public.app_sales_file_get(%L)::text$q$,pg_temp.fx('f1'))),'ERROR 42501 sales: not allowed');

-- ============================================================ read-only (View as) — keep LAST
set local transaction_read_only = on;
select pg_temp.expect('View as: begin refused with 25006',left(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_file_begin(%L,%L,'v.txt',5,null)::text$q$,pg_temp.fx('rec'),pg_temp.stage('contract','new'))),11),'ERROR 25006');
select pg_temp.expect('View as: get still works',(pg_temp.as_json('viewer',format($q$select public.app_sales_file_get(%L)$q$,pg_temp.fx('f1')))->>'name'),'قرارداد "نهایی".pdf');
select pg_temp.expect('View as: the record still loads',jsonb_array_length(pg_temp.as_json('viewer',format($q$select public.app_sales_record(%L)->'files'$q$,pg_temp.fx('rec')))::jsonb)::text,'2');

rollback;
