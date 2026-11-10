-- FR-91: who may edit approved requests (2026-11-10).
-- Five catalog items, each its own toggle in the role editor. Four are one per request type
-- (daily leave, hourly leave, daily work trip, hourly work errand); the fifth lifts the refusal to
-- edit one's own requests. All five are actions (edit only) and depend on leave_requests read.
-- The hr preset gets the four type keys, so HR loses nothing when the FR-84 gate is replaced
-- (20261110120000_request_edit.sql). No legacy private.has_permission mapping: the running old
-- app has no such key.

create or replace function private.permission_keys() returns setof text
    language sql immutable
    set search_path to ''
    as $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking',
    'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own']);
$$;

create or replace function private.permission_allows(p_key text, p_level text) returns boolean
    language sql immutable
    set search_path to ''
    as $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate','travel_booking',
      'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
      'edit_requests_own') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays') then p_level in ('read','edit')
    else false end;
$$;

create or replace function private.permission_deps() returns table(key text, key_level text, needs text)
    language sql immutable
    set search_path to ''
    as $$
  values
    ('finance_forms','read','finance'),
    ('people_create','read','people'),
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
    ('edit_requests_own','read','leave_requests');
$$;

-- New companies: the hr preset starts with the four type keys (never edit_requests_own).
create or replace function private.seed_company_roles(p_company uuid) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  insert into public.roles (company_id, system_key, kind, name) values
    (p_company, 'admin', 'system', 'Admin'), (p_company, 'manager', 'system', 'Manager'),
    (p_company, 'employee', 'system', 'Employee'), (p_company, 'hr', 'preset', 'HR'),
    (p_company, 'security', 'preset', 'Security'), (p_company, 'finance', 'preset', 'Finance'),
    (p_company, 'procurement', 'preset', 'Procurement')
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission, level)
  select r.id, v.permission, v.level
    from public.roles r
    join (values
      ('hr','people','edit'), ('hr','people_create','edit'), ('hr','role_manager','edit'),
      ('hr','personal_info','edit'), ('hr','clearance','edit'), ('hr','departments','edit'),
      ('hr','leave_balances','edit'), ('hr','leave_accrual','edit'), ('hr','leave_requests','read'),
      ('hr','calendar','read'), ('hr','reports','read'), ('hr','approval_steps','edit'),
      ('hr','work_settings','edit'), ('hr','holidays','edit'), ('hr','special_leave','edit'),
      ('hr','finance','read'),
      ('hr','edit_leave_daily','edit'), ('hr','edit_leave_hourly','edit'),
      ('hr','edit_errand_daily','edit'), ('hr','edit_errand_hourly','edit'),
      ('security','people','read'), ('security','leave_balances','read'),
      ('security','leave_requests','read'), ('security','calendar','read'),
      ('finance','clearance','read'), ('finance','finance','read'),
      ('procurement','travel_booking','edit')
    ) as v(system_key, permission, level) on r.system_key = v.system_key::public.app_role
   where r.company_id = p_company
  on conflict do nothing;
end $$;

-- Existing companies: every role that is the hr preset gets the four type keys. Custom roles and
-- the other presets get nothing; an admin switches the toggles on where wanted.
insert into public.role_permissions (role_id, permission, level)
select r.id, k, 'edit'
  from public.roles r
  cross join unnest(array['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly']) as k
 where r.system_key = 'hr'
on conflict do nothing;

-- The key that governs editing a request of this kind at this unit.
create or replace function private.request_edit_key(p_kind public.request_kind, p_unit public.leave_unit) returns text
    language sql immutable
    set search_path to ''
    as $$
  select 'edit_' || p_kind::text || '_' || case p_unit when 'day' then 'daily' else 'hourly' end;
$$;

-- May p_uid edit request p_request and save it as p_new_unit (null = keep the unit)? Same company,
-- active caller; the admin always; otherwise the key of the request's current type AND the key of
-- the target type (a daily/hourly switch needs both), and, on the caller's own request,
-- edit_requests_own. Status is not checked here: the caller reports it with its own message.
create or replace function private.can_edit_request(p_uid uuid, p_request uuid, p_new_unit public.leave_unit) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select coalesce((
    select private.is_active(p_uid)
       and exists (select 1 from public.profiles c where c.id = p_uid and c.company_id = r.company_id)
       and (private.is_admin(p_uid)
            or (private.has_perm(p_uid, private.request_edit_key(r.kind, r.unit), 'edit')
                and private.has_perm(p_uid, private.request_edit_key(r.kind, coalesce(p_new_unit, r.unit)), 'edit')
                and (r.employee_id <> p_uid or private.has_perm(p_uid, 'edit_requests_own', 'edit'))))
      from public.leave_requests r
     where r.id = p_request), false);
$$;

revoke all on function private.request_edit_key(public.request_kind, public.leave_unit) from public, anon, authenticated;
revoke all on function private.can_edit_request(uuid, uuid, public.leave_unit) from public, anon, authenticated;

-- The caller's edit keys, for the Manage > Requests screen (the Edit button). The admin holds all five.
create or replace function public.app_my_request_edit_types() returns text[]
    language sql stable security definer
    set search_path to ''
    as $$
  select coalesce(array_agg(k order by k), '{}'::text[])
    from unnest(array['edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
                      'edit_requests_own']) as k
   where private.has_perm(auth.uid(), k, 'edit');
$$;

revoke all on function public.app_my_request_edit_types() from public, anon;
grant execute on function public.app_my_request_edit_types() to authenticated;
