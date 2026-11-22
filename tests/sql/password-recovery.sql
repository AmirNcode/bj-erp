-- Disposable database only. The transaction never commits or calls a provider.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check_that(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'Recovery check failed: %',label; end if;
end $$;
insert into public.companies(name) values ('Recovery fixture') returning id as company \gset
insert into public.departments(company_id,name_en,name_fa,code,kind)
 values (:'company','Recovery','تست','QAR','office') returning id as dept \gset
insert into auth.users(id,email) select gen_random_uuid(), code||'@bj-app.internal'
 from unnest(array['001rec','qahead','qahr','qaadmin']) code;
insert into public.profiles(id,company_id,department_id,employee_code,personnel_no,full_name)
 select id,:'company',:'dept',split_part(email,'@',1),split_part(email,'@',1),'Synthetic'
 from auth.users where email in ('001rec@bj-app.internal','qahead@bj-app.internal','qahr@bj-app.internal','qaadmin@bj-app.internal');
select id as emp from public.profiles where employee_code='001rec' \gset
select id as head from public.profiles where employee_code='qahead' \gset
select id as hr from public.profiles where employee_code='qahr' \gset
select id as admin from public.profiles where employee_code='qaadmin' \gset
drop index public.user_roles_one_admin;
insert into public.user_roles(user_id,role) values (:'head','hr'),(:'hr','hr'),(:'admin','admin'),(:'admin','employee');
insert into public.employee_personal_info(employee_id,company_id,mobile)
 values (:'emp',:'company','09121110042'),(:'admin',:'company','09121110041')
 on conflict(employee_id) do update set mobile=excluded.mobile;
insert into private.sms_settings(company_id,mode,api_key,username,sender_line)
 values (:'company','dry_run','synthetic-key','qa','50001');
select pg_temp.check_that(
  has_function_privilege('anon','public.app_start_password_recovery(text)','execute')
  and has_function_privilege('anon','public.app_confirm_password_recovery(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.app_start_password_recovery(text)','execute')
  and not has_function_privilege('authenticated','public.app_confirm_password_recovery(uuid,text)','execute')
  and not has_function_privilege('anon','public.app_set_employee_password(uuid,text)','execute'),
  'public function grants');
set local role anon;
select request_id as req,hint from public.app_start_password_recovery('001REC') \gset
select pg_temp.check_that(:'hint'='09•••••••42','hint');
select public.app_confirm_password_recovery(:'req','۰۹۱۲۱۱۱۰۰۴۲');
reset role;
select pg_temp.check_that(not exists(select from public.sms_outbox where recipient_id=:'emp'),'dry run');
update private.sms_settings set mode='live' where company_id=:'company';
set local role anon;
select public.app_confirm_password_recovery(:'req','09121110043');
reset role;
select pg_temp.check_that(not exists(select from public.sms_outbox where recipient_id=:'emp'),'wrong number');
set local role anon;
reset role;
-- A queue failure must roll back issuance and expose only a generic public error.
create function pg_temp.fail_queue() returns trigger language plpgsql as $$
begin raise exception 'queue rejected' using detail=new.body; end $$;
create trigger qa_queue_failure before insert on public.sms_outbox for each row execute function pg_temp.fail_queue();
create function pg_temp.confirm_failure(request uuid) returns boolean language plpgsql as $$
declare detail text;
begin
  perform public.app_confirm_password_recovery(request,'09121110042');
  return false;
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  return sqlerrm = 'recovery unavailable' and coalesce(detail,'') = '';
end $$;
set local role anon;
select pg_temp.check_that(pg_temp.confirm_failure(:'req'),'private queue error');
reset role;
select pg_temp.check_that((select encrypted_password is null from auth.users where id=:'emp')
  and not exists(select from private.recovery_credentials where employee_id=:'emp'),'queue failure preserved credential');
drop trigger qa_queue_failure on public.sms_outbox;
set local role anon;
select public.app_confirm_password_recovery(:'req','+98 9121110042');
select public.app_confirm_password_recovery(:'req','09121110042');
select request_id as cooldown_req from public.app_start_password_recovery('001rec') \gset
select public.app_confirm_password_recovery(:'cooldown_req','09121110042');
select request_id as admin_req from public.app_start_password_recovery('qaadmin') \gset
select public.app_confirm_password_recovery(:'admin_req','09121110041');
reset role;
select pg_temp.check_that(not exists(select from public.sms_outbox where recipient_id=:'admin'),'admin excluded');
select pg_temp.check_that((select count(*)=1 from public.sms_outbox where recipient_id=:'emp'),'one SMS');
select pg_temp.check_that((select p.must_change_password and u.encrypted_password=extensions.crypt(o.args[1],u.encrypted_password)
 from public.profiles p join auth.users u on u.id=p.id join public.sms_outbox o on o.recipient_id=p.id where p.id=:'emp'),'usable temporary password');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'admin','role','authenticated')::text,true);
set local role authenticated;
select pg_temp.check_that(not exists(select from public.sms_outbox where recipient_id=:'emp'),'raw password SMS hidden even from admin');
reset role;
select encrypted_password as old_hash from auth.users where id=:'emp' \gset
update public.employee_personal_info set mobile='09121110043' where employee_id=:'emp';
select pg_temp.check_that((select encrypted_password<>:'old_hash' from auth.users where id=:'emp'),'phone correction invalidates credential');
select pg_temp.check_that((select status='skipped' and cardinality(args)=0 from public.sms_outbox where recipient_id=:'emp'),'old SMS cancelled');
-- An earlier challenge stays invalid even if HR restores the original mobile.
update public.employee_personal_info set mobile='09121110042' where employee_id=:'emp';
update private.recovery_requests set issued_at=now()-interval '5 minutes' where issued_at is not null and employee_id=:'emp';
set local role anon;
select public.app_confirm_password_recovery(:'cooldown_req','09121110042');
select request_id as exp_req from public.app_start_password_recovery('001rec') \gset
reset role;
update private.recovery_requests set created_at=now()-interval '11 minutes' where id=:'exp_req';
set local role anon;
select public.app_confirm_password_recovery(:'exp_req','09121110042');
select request_id as wrong_req from public.app_start_password_recovery('001rec') \gset
select public.app_confirm_password_recovery(:'wrong_req','wrong') from generate_series(1,5);
select public.app_confirm_password_recovery(:'wrong_req','09121110042');
reset role;
select pg_temp.check_that((select count(*)=1 from public.sms_outbox where recipient_id=:'emp'),'stale, expired and exhausted challenges');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'admin','role','authenticated')::text,true);
select public.app_save_role(null,'Recovery Head','{"people":"read","reset_employee_password":"edit"}') as role_id \gset
insert into public.user_roles(user_id,role_id) values(:'head',:'role_id');
select public.app_save_role(:'role_id','Renamed Head','{"people":"read","reset_employee_password":"edit"}');
select pg_temp.check_that(not private.role_within(:'role_id',:'head'),'only admin may delegate reset role');
insert into public.user_roles(user_id,role) values(:'hr','manager');
select pg_temp.check_that(not private.can_reset_password(:'head',(select id from public.profiles
 where company_id<>:'company' limit 1)),'cross-company target');
update public.profiles set active=false where id=:'hr';
select pg_temp.check_that(not private.can_reset_password(:'head',:'hr'),'inactive target');
update public.profiles set active=true where id=:'hr';
select pg_temp.check_that(private.can_reset_password(:'head',:'hr') and not private.can_reset_password(:'hr',:'head')
 and not private.can_reset_password(:'head',:'admin') and not private.can_reset_password(:'head',:'head'),'delegated eligibility');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'head','role','authenticated')::text,true);
set local role authenticated;
create function pg_temp.denied(command text) returns boolean language plpgsql as $$
begin execute command; return false;
exception when insufficient_privilege then return true; end $$;
select pg_temp.check_that(pg_temp.denied(format('select public.app_revoke_sessions(%L)',:'hr'))
  and pg_temp.denied('select public.app_bulk_set_employee_passwords(''[]'')'),'manual sign-out and bulk restricted');
select public.app_set_employee_password(:'hr','Synthetic-9!');
reset role;
select pg_temp.check_that((select must_change_password from public.profiles where id=:'hr'),'assisted reset without mobile');
delete from public.user_roles where role_id=:'role_id' and user_id=:'head';
set local role authenticated;
select pg_temp.check_that(pg_temp.denied(format('select public.app_set_employee_password(%L,%L)',:'hr','Synthetic-9!')),
  'role removal enforced by credential writer');
reset role;
insert into public.user_roles(user_id,role_id) values(:'head',:'role_id');
delete from public.role_permissions where role_id=:'role_id' and permission='reset_employee_password';
select pg_temp.check_that(not private.can_reset_password(:'head',:'hr'),'immediate revocation');
-- An unknown identifier gets a stable, plausible hint, and rejected lookups leave no request.
select set_config('request.headers','{"x-bj-client-ip":"192.0.2.99"}',true);
select hint as decoy from public.app_start_password_recovery('absent') \gset
select pg_temp.check_that(hint=:'decoy' and hint ~ '^09•{7}[0-9]{2}$','stable placeholder') from public.app_start_password_recovery('absent');
select count(q.request_id) from generate_series(1,28) n cross join lateral public.app_start_password_recovery('missing-'||n) q;
select request_id as limited from public.app_start_password_recovery('001rec') \gset
select pg_temp.check_that(not exists(select from private.recovery_requests where id=:'limited'),'source limit');
rollback;
