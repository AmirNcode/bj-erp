-- Sales stage pages (2026-11-17): app_sales_save_record takes the stage page and logs old -> new.
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

-- ============================================================ stage-aware save
create function pg_temp.last_edit(p_rec text) returns jsonb language sql as $$
  select body from public.sales_events where rfp_id=pg_temp.fx(p_rec) and kind='edit' order by at desc, id desc limit 1;
$$;
insert into sl_fx select 'rec',(pg_temp.as_scalar('seller',$q$select public.app_sales_save_record(null,'{"flow_kind":"bid","title":"Stage pages","proposal_due":"2026-11-15"}')::text$q$))::uuid;
select pg_temp.expect('save with stage: ok',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"proposal_due":"2026-11-20"}',%L)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','received')))),'ok');
select pg_temp.expect('edit event carries stage',pg_temp.last_edit('rec')->>'stage',pg_temp.stage('bid','received')::text);
select pg_temp.expect('edit event carries old -> new',(pg_temp.last_edit('rec')->'changes')::text,
  '[{"to": "2026-11-20", "from": "2026-11-15", "field": "proposal_due"}]');
select pg_temp.expect('fields kept for old readers',(pg_temp.last_edit('rec')->'fields')::text,'["proposal_due"]');

select pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_record(%L,'{"description":"by ceo"}')::text$q$,pg_temp.fx('rec')));
select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"customer_ref":"R1"}')::text$q$,pg_temp.fx('rec')));
select pg_temp.expect('patch leaves other fields',(select description from public.sales_rfps where id=pg_temp.fx('rec')),'by ceo');

select pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_record(%L,'{"our_price":987654}',%L)::text$q$,pg_temp.fx('rec'),pg_temp.stage('bid','pricing')));
select pg_temp.expect('price change hidden',(pg_temp.last_edit('rec')->'changes')::text,'[{"field": "our_price", "hidden": true}]');
select pg_temp.assert('price value not in the log',position('987654' in pg_temp.last_edit('rec')::text)=0);

select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"custom":{"x_a":"x"}}')::text$q$,pg_temp.fx('rec')));
select pg_temp.expect('custom per key',(pg_temp.last_edit('rec')->'changes')::text,'[{"to": "x", "from": null, "field": "custom.x_a"}]');

select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"needs_bond":true}')::text$q$,pg_temp.fx('rec')));
select pg_temp.expect('bond side effect',(pg_temp.last_edit('rec')->'side')::text,'["bid_bond_opened"]');
select pg_temp.expect('needs_bond logged with values',(pg_temp.last_edit('rec')->'changes')::text,'[{"to": true, "from": false, "field": "needs_bond"}]');

select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"buyer":"Ahwaz Kala"}')::text$q$,pg_temp.fx('rec')));
select pg_temp.expect('buyer logged by name',(pg_temp.last_edit('rec')->'changes')::text,'[{"to": "Ahwaz Kala", "from": null, "field": "buyer"}]');

select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"decision_reason":"seller says"}')::text$q$,pg_temp.fx('rec')));
select pg_temp.assert('reason needs decide: seller ignored',(select decision_reason from public.sales_rfps where id=pg_temp.fx('rec')) is null);
select pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_record(%L,'{"decision_reason":"ceo says","result_reason":"r"}')::text$q$,pg_temp.fx('rec')));
select pg_temp.expect('reason needs decide: decider stored',(select decision_reason||'|'||result_reason from public.sales_rfps where id=pg_temp.fx('rec')),'ceo says|r');

select pg_temp.expect('foreign stage refused',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"title":"x"}',%L)::text$q$,pg_temp.fx('rec'),pg_temp.stage('contract','new')))),'sales: invalid input');
select pg_temp.expect('old 2-arg call works',pg_temp.msg(pg_temp.as_scalar('seller',
  format($q$select public.app_sales_save_record(%L,'{"title":"t2"}')::text$q$,pg_temp.fx('rec')))),'ok');
select pg_temp.assert('old call: stage null',(pg_temp.last_edit('rec')->>'stage') is null);
-- Custom values merge per key (review 2026-11-17): a page sends only the keys it changed.
select pg_temp.as_scalar('ceo',format($q$select public.app_sales_save_record(%L,'{"custom":{"x_b":"colleague"}}')::text$q$,pg_temp.fx('rec')));
select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"custom":{"x_c":"mine"}}')::text$q$,pg_temp.fx('rec')));
select pg_temp.expect('custom merge keeps a colleague''s key',(select custom->>'x_b' from public.sales_rfps where id=pg_temp.fx('rec')),'colleague');
select pg_temp.expect('custom merge adds mine',(select custom->>'x_c' from public.sales_rfps where id=pg_temp.fx('rec')),'mine');
select pg_temp.as_scalar('seller',format($q$select public.app_sales_save_record(%L,'{"custom":{"x_c":null}}')::text$q$,pg_temp.fx('rec')));
select pg_temp.assert('custom null removes the key',not (select custom ? 'x_c' from public.sales_rfps where id=pg_temp.fx('rec')));
select pg_temp.expect('custom removal logged',(pg_temp.last_edit('rec')->'changes')::text,'[{"to": null, "from": "mine", "field": "custom.x_c"}]');
select pg_temp.expect('only one function signature',(select count(*)::text from pg_proc where proname='app_sales_save_record'),'1');

rollback;
