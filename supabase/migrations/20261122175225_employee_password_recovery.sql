-- Employee password recovery and optional delegated single-person resets.
CREATE OR REPLACE FUNCTION private.permission_keys() RETURNS SETOF text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select unnest(array['people','people_create','reset_employee_password','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking',
    'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own',
    'sales','sales_prices','sales_bonds','sales_decide','sales_reports','sales_settings','project_items']);
$$;

CREATE OR REPLACE FUNCTION private.permission_allows(p_key text, p_level text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_key in ('people_create','reset_employee_password','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate','travel_booking',
      'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
      'edit_requests_own','sales_decide','sales_settings') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms','sales_reports') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays',
      'sales','sales_prices','sales_bonds','project_items') then p_level in ('read','edit')
    else false end;
$$;

CREATE OR REPLACE FUNCTION private.permission_deps() RETURNS TABLE(key text, key_level text, needs text)
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  values
    ('finance_forms','read','finance'),
    ('people_create','read','people'), ('reset_employee_password','read','people'),
    ('role_manager','read','people'), ('role_manager','read','leave_balances'),
    ('role_manager','read','calendar'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('special_leave','read','people'), ('special_leave','read','leave_balances'),
    ('edit_leave_daily','read','leave_requests'), ('edit_leave_hourly','read','leave_requests'),
    ('edit_errand_daily','read','leave_requests'), ('edit_errand_hourly','read','leave_requests'),
    ('edit_requests_own','read','leave_requests'),
    ('sales_prices','read','sales'), ('sales_bonds','read','sales'), ('sales_decide','read','sales'),
    ('sales_reports','read','sales'), ('sales_settings','read','sales'), ('project_items','read','sales');
$$;

CREATE OR REPLACE FUNCTION private.enforce_profile_update_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if coalesce(current_setting('bj.separation_apply', true), '') = 'on'
     and old.active and not new.active
     and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active')
  then
    return new;
  end if;

  -- Credential writers may change this flag alone. Direct profile updates still pass the normal guard.
  if current_setting('bj.password_flag_write', true) = 'on' and new.must_change_password
     and (to_jsonb(new) - 'must_change_password') = (to_jsonb(old) - 'must_change_password') then
    return new;
  end if;
  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    -- FR-83: a name is no longer the person's own to change; only a people edit holder keeps it.
    v_allowed := array['language_pref', 'calendar_pref'];
    if private.has_perm(v_uid, 'people', 'edit') then
      v_allowed := v_allowed || array['full_name', 'first_name', 'last_name'];
    end if;
  elsif private.has_perm(v_uid, 'people', 'edit')
        -- FR-55 D4: same company, never an admin (even a deactivated one, so an
        -- editor cannot reactivate one), and nothing the editor does not hold.
        and private.can_act_on(v_uid, old.id)
  then
    v_allowed := array['full_name', 'first_name', 'last_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  else
    -- Password resets are the admin's alone (20261013200007).
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.personnel_no  is distinct from old.personnel_no)
     or (new.created_at    is distinct from old.created_at)
     or (new.must_change_password is distinct from old.must_change_password
         and coalesce(current_setting('bj.password_flag_write', true), '') <> 'on')
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.first_name    is distinct from old.first_name    and not ('first_name'    = any (v_allowed)))
     or (new.last_name     is distinct from old.last_name     and not ('last_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.department_id is distinct from old.department_id and not ('department_id' = any (v_allowed)))
     or (new.manager_id    is distinct from old.manager_id    and not ('manager_id'    = any (v_allowed)))
     or (new.job_title     is distinct from old.job_title     and not ('job_title'     = any (v_allowed)))
     or (new.active        is distinct from old.active        and not ('active'        = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;

CREATE OR REPLACE FUNCTION private.can_reset_password(p_caller uuid, p_target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_admin(p_caller) or (
    p_target <> p_caller and private.has_perm(p_caller, 'reset_employee_password')
    and exists (select 1 from public.profiles t join public.profiles c on t.company_id = c.company_id
                where t.id = p_target and t.active and c.id = p_caller)
    and not private.is_admin(p_target));
$$;

CREATE OR REPLACE FUNCTION public.app_set_employee_password(p_user_id uuid, p_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_rows int;
begin
  -- Serialize with admin transfer and role assignment, which lock profiles in ID order.
  perform 1 from public.profiles where id in (auth.uid(),p_user_id) order by id for no key update;
  if not private.can_reset_password(auth.uid(), p_user_id) then
    raise exception 'not allowed to reset this password' using errcode = '42501';
  end if;
  perform private.assert_password_ok(p_password);  -- FR-80

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;

  -- An admin resetting their own password chose it themselves.
  -- A non-admin caller passes the profile guard only with this flag (FR-55).
  perform set_config('bj.password_flag_write', 'on', true);
  update public.profiles
     set must_change_password = (p_user_id <> auth.uid())
   where id = p_user_id;
  perform set_config('bj.password_flag_write', '', true);

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'reset_password', 'auth.users', p_user_id);
  -- FR-79: a reset password signs the person out everywhere (never the caller).
  perform private.revoke_sessions(p_user_id, 'password_reset');
end;
$$;

-- A random salt keeps placeholder hints stable across lookups for the same code.
create table private.recovery_secret (salt bytea not null);
insert into private.recovery_secret values (extensions.gen_random_bytes(32));
create table private.recovery_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  source_key bytea not null,
  code_key bytea not null,
  employee_id uuid references public.profiles(id) on delete cascade,
  mobile text,
  attempts integer not null default 0,
  issued_at timestamptz
);
create index recovery_requests_source on private.recovery_requests(source_key, created_at);
create index recovery_requests_code on private.recovery_requests(code_key, created_at);
create index recovery_requests_employee on private.recovery_requests(employee_id, issued_at);
create index recovery_requests_created on private.recovery_requests(created_at);
-- Outlives the short-lived request so a later phone correction invalidates the issued credential.
create table private.recovery_credentials (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  password_fingerprint bytea not null,
  outbox_id uuid not null
);
revoke all on private.recovery_secret, private.recovery_requests, private.recovery_credentials from public, anon, authenticated;
alter table private.recovery_secret enable row level security;
alter table private.recovery_requests enable row level security;
alter table private.recovery_credentials enable row level security;

create function public.app_start_password_recovery(p_code text)
returns table(request_id uuid, hint text) language plpgsql security definer set search_path = '' as $$
<<lookup>>
declare
  code text := lower(btrim(left(p_code, 65)));
  ip text := coalesce(nullif(current_setting('request.headers', true),'')::jsonb->>'x-bj-client-ip','unknown');
  salt bytea;
  source_key bytea;
  code_key bytea;
  target uuid;
  mobile text;
begin
  select s.salt into strict salt from private.recovery_secret s;
  source_key := extensions.hmac(convert_to(ip,'UTF8'), salt, 'sha256');
  code_key := extensions.hmac(convert_to(coalesce(code,''),'UTF8'), salt, 'sha256');
  request_id := gen_random_uuid();
  hint := '09•••••••' || lpad((get_byte(code_key,0) % 100)::text, 2, '0');
  perform pg_advisory_xact_lock(hashtextextended(encode(source_key,'hex'), 0));
  perform pg_advisory_xact_lock(hashtextextended(encode(code_key,'hex'), 1));
  delete from private.recovery_requests where created_at < now() - interval '2 hours';
  if (select count(*) from private.recovery_requests r where r.source_key = lookup.source_key
        and r.created_at > now()-interval '10 minutes') >= 30
     or (select count(*) from private.recovery_requests r where r.code_key = lookup.code_key
        and r.created_at > now()-interval '10 minutes') >= 10 then
    return next; return;
  end if;
  select p.id, private.normalize_ir_mobile(i.mobile) into target, mobile
    from public.profiles p join public.employee_personal_info i on i.employee_id=p.id
    where lower(p.employee_code)=code and p.active and not private.is_admin(p.id);
  if mobile is not null then hint := left(mobile,2) || '•••••••' || right(mobile,2); end if;
  insert into private.recovery_requests(id,source_key,code_key,employee_id,mobile)
    values(request_id,source_key,code_key,target,mobile);
  return next;
end $$;

create function public.app_confirm_password_recovery(p_request uuid,p_mobile text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r private.recovery_requests%rowtype;
  p public.profiles%rowtype;
  s private.sms_settings%rowtype;
  mobile text;
  password text;
  hashed text;
  outbox uuid;
begin
  -- Lock mobile first, matching the phone-update trigger's lock order.
  select private.normalize_ir_mobile(i.mobile) into mobile from public.employee_personal_info i
    join private.recovery_requests q on q.employee_id=i.employee_id
    where q.id=p_request and q.created_at >= now()-interval '10 minutes' for update of i;
  select * into r from private.recovery_requests where id=p_request for update;
  if not found or r.created_at < now()-interval '10 minutes' or r.attempts >= 5 or r.issued_at is not null then return; end if;
  update private.recovery_requests set attempts=attempts+1 where id=r.id;
  if r.mobile is null or r.mobile is distinct from private.normalize_ir_mobile(left(p_mobile,64)) then return; end if;

  if mobile is distinct from r.mobile then return; end if;
  select * into p from public.profiles where id=r.employee_id for update;
  if not found or not p.active or private.is_admin(p.id) or
    r.code_key <> (select extensions.hmac(convert_to(lower(p.employee_code),'UTF8'), salt,'sha256') from private.recovery_secret) then return; end if;
  if exists(select 1 from private.recovery_requests where employee_id=p.id and issued_at>now()-interval '1 minute')
    or (select count(*) from private.recovery_requests where employee_id=p.id and issued_at>now()-interval '1 hour') >= 3 then return; end if;
  select * into s from private.sms_settings where company_id=p.company_id for share;
  if not found or s.mode <> 'live' or not s.notify_password_reset or
     (s.connection='webservice' and (s.username is null or s.auth_error is not null)) or
     (s.send_method='pattern' and s.body_password_reset is null) or
     (s.send_method='line' and s.sender_line is null) then return; end if;

  -- Generate inside the trusted transaction. The public endpoint never accepts or returns a password.
  password := encode(extensions.gen_random_bytes(9),'hex') || '!2';
  hashed := extensions.crypt(password,extensions.gen_salt('bf'));
  outbox := private.sms_queue(p.company_id,'password_reset',p.id,null,null,
    case when p.language_pref='en' then 'Your temporary password: ' else 'رمز موقت شما: ' end || password || chr(10) ||
    case when p.language_pref='en' then 'Login code: ' else 'کد ورود: ' end || p.employee_code || chr(10) || s.site_label,
    array[password,p.employee_code],mobile,null);
  if outbox is null then raise exception 'recovery unavailable'; end if;
  update auth.users set encrypted_password=hashed, updated_at=now() where id=p.id;
  if not found then raise exception 'recovery unavailable'; end if;
  perform set_config('bj.password_flag_write','on',true);
  update public.profiles set must_change_password=true where id=p.id;
  perform set_config('bj.password_flag_write','',true);
  perform private.revoke_sessions(p.id,'password_recovery');
  insert into private.recovery_credentials values(p.id,extensions.digest(hashed,'sha256'),outbox)
    on conflict(employee_id) do update set password_fingerprint=excluded.password_fingerprint,outbox_id=excluded.outbox_id;
  update private.recovery_requests set issued_at=clock_timestamp() where id=r.id;
  insert into public.audit_log(action,entity,entity_id) values('password_recovery','auth.users',p.id);
end $$;

revoke all on function public.app_start_password_recovery(text), public.app_confirm_password_recovery(uuid,text)
  from public,anon,authenticated;
grant execute on function public.app_start_password_recovery(text), public.app_confirm_password_recovery(uuid,text) to anon;

create function private.invalidate_mobile_recovery() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c private.recovery_credentials%rowtype;
begin
  if tg_op='UPDATE' and private.normalize_ir_mobile(old.mobile) is not distinct from private.normalize_ir_mobile(new.mobile) then return null; end if;
  -- Also invalidate challenges if the number changes away and subsequently changes back.
  update private.recovery_requests set mobile=null where employee_id=old.employee_id and mobile is not null;
  delete from private.recovery_credentials where employee_id=old.employee_id returning * into c;
  if found then
    update auth.users set encrypted_password=extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf')),updated_at=now()
      where id=c.employee_id and extensions.digest(encrypted_password,'sha256')=c.password_fingerprint;
    if found then perform private.revoke_sessions(c.employee_id,'recovery_mobile_changed'); end if;
    update public.sms_outbox set status='skipped', skip_reason='mobile_changed',
      body=private.sms_mask(event,body,args),args='{}' where id=c.outbox_id and status='queued';
  end if;
  return null;
end $$;
revoke all on function private.invalidate_mobile_recovery() from public,anon,authenticated;
create trigger mobile_invalidates_recovery after update of mobile or delete on public.employee_personal_info
  for each row execute function private.invalidate_mobile_recovery();

-- Dispatch erases a password payload on submission. A transport failure after that point
-- needs a fresh employee request; requeuing its scrubbed text would send an unusable SMS.
CREATE OR REPLACE FUNCTION private.sms_fail(p_id uuid, p_error text, p_retry boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.sms_outbox o
     set status = case when p_retry and o.attempts < 3 and (o.event <> 'password_reset' or cardinality(o.args) > 0) then 'queued' else 'failed' end,
         next_attempt_at = now() + case o.attempts when 1 then interval '1 minute' else interval '5 minutes' end,
         error = left(p_error, 500), net_request_id = null, sending_since = null
   where o.id = p_id;
end $$;

notify pgrst,'reload schema';
