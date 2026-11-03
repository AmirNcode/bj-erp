-- Absence watchers (FR-75, owner 2026-11-02): who sees approved absences is a per-person list
-- edited with approval_steps edit; watched_absences returns only the caller's watched types
-- (admin: all; no row: none). The absences catalog item is gone.
-- Run ONLY in a disposable synthetic test database, as the image superuser (supabase_admin).
-- Starts and rolls back its own transaction; fails on the first incorrect assertion.
\set ON_ERROR_STOP on
\o /dev/null
begin;
drop index public.user_roles_one_admin;
create temp table aw_fx(k text primary key,id uuid not null);
grant select on aw_fx to authenticated;
create function pg_temp.fx(p_key text) returns uuid language sql as $$
  select id from aw_fx where k=p_key;
$$;
create function pg_temp.login(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fx(p_key),'role','authenticated')::text,true);
end; $$;
create function pg_temp.as_scalar(p_key text,p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
  perform pg_temp.login(p_key);
  execute 'set local role authenticated';
  begin execute p_sql into v_result;
  exception when others then v_result:='ERROR '||sqlstate||' '||sqlerrm; end;
  execute 'reset role'; return v_result;
end; $$;
create function pg_temp.expect(p_label text,p_actual text,p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %',p_label,p_expected,p_actual; end if;
  raise notice 'PASS %',p_label;
end; $$;
create function pg_temp.err(p_result text) returns text language sql as $$
  select case when left(p_result,6)='ERROR ' then split_part(p_result,' ',2) else 'ok' end;
$$;
-- The fixture requests the caller sees, by label, in label order.
create function pg_temp.seen(p_key text) returns text language sql as $$
  select pg_temp.as_scalar(p_key,$q$select coalesce(string_agg(f.k,',' order by f.k),'-')
    from public.watched_absences(date '2027-05-01', date '2027-05-31') w
    join aw_fx f on f.id = w.id$q$);
$$;

do $$
declare v_company uuid:=gen_random_uuid(); v_a uuid:=gen_random_uuid(); v_type uuid; v_id uuid; who record; r record;
begin
  insert into public.companies(id,name) values(v_company,'Absence watchers synthetic fixture');
  insert into aw_fx values('company',v_company);
  insert into public.departments(id,company_id,name_fa,name_en,kind,code) values
    (v_a,v_company,'الف','Fixture A','office','AWA');
  for who in select * from (values
    ('admin','admin','9990077001'),('hrp','hr','9990077002'),('clerk','employee','9990077003'),
    ('guard','security','9990077004'),('rep','employee','9990077005'),('plain','employee','9990077006')) t(k,role,code) loop
    insert into aw_fx values(who.k,gen_random_uuid());
    insert into auth.users(id,email) values(pg_temp.fx(who.k),who.code||'@watchers-fixture.invalid');
    insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name,must_change_password)
      values(pg_temp.fx(who.k),v_company,v_a,who.code,who.code,'Fixture '||who.k,false);
    insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),who.role::public.app_role);
    if who.role<>'employee' then insert into public.user_roles(user_id,role) values(pg_temp.fx(who.k),'employee'); end if;
  end loop;
  perform pg_temp.login('admin');
  insert into public.leave_types(company_id,name_fa,name_en,is_paid,affects_balance,allow_half_day,allow_hourly)
    values(v_company,'استحقاقی','Annual',true,false,true,true) returning id into v_type;
  for r in select * from (values
    ('a_leave_day','leave','day',null::time,null::time,'approved',1),
    ('b_leave_hour','leave','hour','08:00'::time,'10:00'::time,'approved',2),
    ('c_errand_day','errand','day',null,null,'approved',3),
    ('d_errand_hour','errand','hour','13:00','15:00','approved',4),
    ('e_pending','leave','day',null,null,'pending',5)) t(k,kind,unit,st,et,status,n) loop
    insert into public.leave_requests(employee_id,company_id,kind,leave_type_id,errand_location,unit,
                                      start_date,end_date,start_time,end_time,requested_minutes,status,serial_year,serial_seq)
      values(pg_temp.fx('rep'),v_company,r.kind::public.request_kind,
             case when r.kind='leave' then v_type end,case when r.kind='errand' then 'Fixture site' end,
             r.unit::public.leave_unit,date '2027-05-10'+r.n,date '2027-05-10'+r.n,r.st,r.et,
             case when r.unit='hour' then 120 else 480 end,r.status::public.leave_status,1,978000+r.n)
      returning id into v_id;
    insert into aw_fx values(r.k,v_id);
  end loop;
end; $$;

-- Catalog: absences is gone everywhere.
select pg_temp.expect('absences is no catalog key',
  (select count(*)::text from private.permission_keys() k where k='absences'),'0');
select pg_temp.expect('absences allows no level',
  (private.permission_allows('absences','read') or private.permission_allows('absences','edit'))::text,'false');
select pg_temp.expect('no role grants absences',
  (select count(*)::text from public.role_permissions where permission='absences'),'0');
select pg_temp.expect('app_my_permissions has no absences (hr)',
  pg_temp.as_scalar('hrp',$q$select coalesce(public.app_my_permissions()->>'absences','-')$q$),'-');

-- Reads: a caller with no row and no admin sees nothing; admin sees every approved one.
select pg_temp.expect('no row: nothing',pg_temp.seen('clerk'),'-');
select pg_temp.expect('admin: all four approved, never pending',pg_temp.seen('admin'),
  'a_leave_day,b_leave_hour,c_errand_day,d_errand_hour');

-- Writes: approval_steps edit (hr preset) adds; a plain employee may not.
select pg_temp.expect('plain employee may not add a watcher',
  pg_temp.err(pg_temp.as_scalar('plain',format($q$insert into public.absence_watchers(user_id,company_id)
    values(%L,%L) returning 'x'$q$,pg_temp.fx('plain'),pg_temp.fx('company')))),'42501');
select pg_temp.expect('hr adds the clerk: hourly leave only, full page',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$insert into public.absence_watchers
    (user_id,company_id,leave_day,leave_hour,errand_day,errand_hour,home_tile,full_page)
    values(%L,%L,false,true,false,false,false,true) returning 'x'$q$,pg_temp.fx('clerk'),pg_temp.fx('company')))),'ok');
select pg_temp.expect('updated_by is the caller',
  (select (updated_by = pg_temp.fx('hrp'))::text from public.absence_watchers where user_id=pg_temp.fx('clerk')),'true');
select pg_temp.expect('clerk sees hourly leave only',pg_temp.seen('clerk'),'b_leave_hour');
select pg_temp.expect('clerk reads own row',
  pg_temp.as_scalar('clerk','select count(*)::text from public.absence_watchers'),'1');
select pg_temp.expect('plain reads no row',
  pg_temp.as_scalar('plain','select count(*)::text from public.absence_watchers'),'0');
select pg_temp.expect('hr reads the list',
  pg_temp.as_scalar('hrp','select count(*)::text from public.absence_watchers'),'1');

select pg_temp.expect('all types off is refused',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$update public.absence_watchers
    set leave_hour=false where user_id=%L returning 'x'$q$,pg_temp.fx('clerk')))),'23514');
select pg_temp.expect('both views off is refused',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$update public.absence_watchers
    set home_tile=false,full_page=false where user_id=%L returning 'x'$q$,pg_temp.fx('clerk')))),'23514');
select pg_temp.expect('hr widens the clerk to errands',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$update public.absence_watchers
    set errand_day=true,errand_hour=true,home_tile=true where user_id=%L returning 'x'$q$,pg_temp.fx('clerk')))),'ok');
select pg_temp.expect('clerk now sees hourly leave and both errands',pg_temp.seen('clerk'),
  'b_leave_hour,c_errand_day,d_errand_hour');
-- The view is enforced in the database: with the tile only, the 30-day window from today.
do $$
declare v_id uuid;
begin
  insert into public.leave_requests(employee_id,company_id,kind,errand_location,unit,start_date,end_date,
                                    requested_minutes,status,serial_year,serial_seq)
    values(pg_temp.fx('rep'),pg_temp.fx('company'),'errand','Fixture site','day',
           (now() at time zone 'Asia/Tehran')::date+5,(now() at time zone 'Asia/Tehran')::date+5,480,'approved',1,978010)
    returning id into v_id;
  insert into aw_fx values('f_soon',v_id);
end $$;
create function pg_temp.seen_wide(p_key text) returns text language sql as $$
  select pg_temp.as_scalar(p_key,$q$select coalesce(string_agg(f.k,',' order by f.k),'-')
    from public.watched_absences(date '2000-01-01', date '2099-12-31') w
    join aw_fx f on f.id = w.id$q$);
$$;
select pg_temp.expect('full page: any range',pg_temp.seen_wide('clerk'),
  'b_leave_hour,c_errand_day,d_errand_hour,f_soon');
select pg_temp.expect('hr turns the clerk''s full page off',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$update public.absence_watchers
    set full_page=false where user_id=%L returning 'x'$q$,pg_temp.fx('clerk')))),'ok');
select pg_temp.expect('tile only: today through 30 days, whatever range is asked',pg_temp.seen_wide('clerk'),'f_soon');
select pg_temp.expect('admin: any range',pg_temp.seen_wide('admin'),
  'a_leave_day,b_leave_hour,c_errand_day,d_errand_hour,f_soon');
select pg_temp.expect('plain may not edit the clerk',
  pg_temp.as_scalar('plain',format($q$with u as (update public.absence_watchers set leave_day=true
    where user_id=%L returning 1) select count(*)::text from u$q$,pg_temp.fx('clerk'))),'0');

-- Another company's person cannot be added.
do $$
declare v_other uuid:=gen_random_uuid(); v_p uuid:=gen_random_uuid();
begin
  insert into public.companies(id,name) values(v_other,'Other synthetic fixture');
  insert into auth.users(id,email) values(v_p,'9990077099@watchers-fixture.invalid');
  insert into public.profiles(id,company_id,employee_code,personnel_no,full_name,must_change_password)
    values(v_p,v_other,'9990077099','9990077099','Fixture other',false);
  insert into aw_fx values('other',v_p);
end $$;
select pg_temp.expect('a person from another company is refused',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$insert into public.absence_watchers(user_id,company_id)
    values(%L,%L) returning 'x'$q$,pg_temp.fx('other'),pg_temp.fx('company')))),'23503');

-- Legacy alias for the old app.
select pg_temp.expect('absences.view: admin yes, clerk (watcher) yes, plain no',
  private.has_permission(pg_temp.fx('admin'),'absences.view')::text
  || private.has_permission(pg_temp.fx('clerk'),'absences.view')::text
  || private.has_permission(pg_temp.fx('plain'),'absences.view')::text,'truetruefalse');

-- Removing the row removes the access.
select pg_temp.expect('hr removes the clerk',
  pg_temp.err(pg_temp.as_scalar('hrp',format($q$delete from public.absence_watchers where user_id=%L returning 'x'$q$,
    pg_temp.fx('clerk')))),'ok');
select pg_temp.expect('clerk sees nothing again',pg_temp.seen('clerk'),'-');

-- New companies' presets carry no absences.
select pg_temp.expect('seeded presets: no absences',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id=rp.role_id
    where r.company_id=pg_temp.fx('company') and rp.permission='absences'),'0');
select pg_temp.expect('anon may not call watched_absences',
  has_function_privilege('anon','public.watched_absences(date,date)','execute')::text,'false');

rollback;
