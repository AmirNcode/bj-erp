-- Absence watchers (owner, 2026-11-02; FR-75).
--
-- Who sees approved absences is no longer a role permission: the admin (or anyone with
-- approval_steps edit) names each person on Manage › Approval steps and switches on the request
-- types they follow (daily leave, hourly leave, daily work trip, hourly work errand) and the views
-- they get (the 30-day Home tile, the full Absences page). The point is the attendance
-- (fingerprint) system: the HR clerk who enters approved leave there must see it in time.
--
-- The `absences` catalog item goes away. Every active non-admin holder of it today becomes a
-- watcher of all four types with the Home tile (what they saw), so nothing disappears on deploy.
-- The legacy alias has_permission('absences.view') stays for the old app during the swap.

create table public.absence_watchers (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    leave_day boolean not null default true,
    leave_hour boolean not null default true,
    errand_day boolean not null default true,
    errand_hour boolean not null default true,
    home_tile boolean not null default true,
    full_page boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id) on delete set null,
    constraint absence_watchers_some_kind check (leave_day or leave_hour or errand_day or errand_hour),
    constraint absence_watchers_some_view check (home_tile or full_page)
);

comment on table public.absence_watchers is
  'FR-75: people who see approved absences (Home tile and/or Absences page), per request type. Edited with approval_steps edit.';

create index absence_watchers_company_idx on public.absence_watchers (company_id);

create trigger absence_watchers_set_updated_at before update on public.absence_watchers
  for each row execute function public.set_updated_at();

-- The watched person must belong to the row's company (policies only check the caller's).
create function private.absence_watcher_same_company() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and company_id = new.company_id) then
    raise exception 'person not found' using errcode = '23503';
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger absence_watchers_same_company before insert or update on public.absence_watchers
  for each row execute function private.absence_watcher_same_company();
revoke all on function private.absence_watcher_same_company() from public, anon;

alter table public.absence_watchers enable row level security;

create policy absence_watchers_select on public.absence_watchers for select to authenticated
  using (user_id = (select auth.uid())
         or (private.has_perm((select auth.uid()), 'approval_steps', 'read')
             and company_id = (select private.caller_company())));

create policy absence_watchers_insert on public.absence_watchers for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
              and company_id = (select private.caller_company()));

create policy absence_watchers_update on public.absence_watchers for update to authenticated
  using (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
         and company_id = (select private.caller_company()))
  with check (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
              and company_id = (select private.caller_company()));

create policy absence_watchers_delete on public.absence_watchers for delete to authenticated
  using (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
         and company_id = (select private.caller_company()));

grant select, insert, update, delete on table public.absence_watchers to authenticated;
grant all on table public.absence_watchers to service_role;

-- Approved requests overlapping [p_from, p_to], limited to the caller's watched types. The admin
-- sees every type; a caller with no row sees nothing. Only who and when: no reason, no location.
-- Definer, so a watcher needs no leave_requests or people read. The view is enforced here too: a
-- watcher without the full page (Home tile only) gets today (Tehran) through 30 days ahead, the
-- tile's window, whatever range they ask for.
create function public.watched_absences(p_from date, p_to date)
    returns table(id uuid, kind public.request_kind, unit public.leave_unit, start_date date,
                  end_date date, start_time time, end_time time, employee_name text,
                  personnel_no text, department_name_fa text, department_name_en text,
                  leave_type_name_fa text, leave_type_name_en text)
    language sql stable security definer
    set search_path to ''
    as $$
  with me as (
    select p.company_id,
           private.is_admin(p.id) as admin,
           coalesce(w.full_page, false) as full_page,
           (now() at time zone 'Asia/Tehran')::date as today,
           w.leave_day, w.leave_hour, w.errand_day, w.errand_hour
      from public.profiles p
      left join public.absence_watchers w on w.user_id = p.id
     where p.id = auth.uid() and p.active
  )
  select r.id, r.kind, r.unit, r.start_date, r.end_date, r.start_time, r.end_time,
         e.full_name, e.personnel_no, d.name_fa, d.name_en, t.name_fa, t.name_en
    from me
    join public.leave_requests r on r.company_id = me.company_id
    join public.profiles e on e.id = r.employee_id
    left join public.departments d on d.id = e.department_id
    left join public.leave_types t on t.id = r.leave_type_id
   where r.status = 'approved'
     and r.end_date >= p_from and r.start_date <= p_to
     and (me.admin or me.full_page
          or (r.end_date >= me.today and r.start_date <= me.today + 30))
     and (me.admin
          or (r.kind = 'leave'  and r.unit = 'day'  and coalesce(me.leave_day, false))
          or (r.kind = 'leave'  and r.unit = 'hour' and coalesce(me.leave_hour, false))
          or (r.kind = 'errand' and r.unit = 'day'  and coalesce(me.errand_day, false))
          or (r.kind = 'errand' and r.unit = 'hour' and coalesce(me.errand_hour, false)))
   order by r.start_date, r.start_time nulls first;
$$;

revoke all on function public.watched_absences(date, date) from public, anon;
grant execute on function public.watched_absences(date, date) to authenticated;

-- Pre-fill: today's non-admin holders of absences read keep their Home tile.
insert into public.absence_watchers (user_id, company_id, home_tile, full_page)
select distinct p.id, p.company_id, true, false
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.role_permissions rp on rp.role_id = ur.role_id and rp.permission = 'absences'
 where p.active
   and not private.is_admin(p.id)
on conflict (user_id) do nothing;

-- Retire the catalog item. Rows first: role_permissions_catalog checks permission_allows.
delete from public.role_permissions where permission = 'absences';

create or replace function private.permission_keys() returns setof text
    language sql immutable
    set search_path to ''
    as $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','travel_booking']);
$$;

create or replace function private.permission_allows(p_key text, p_level text) returns boolean
    language sql immutable
    set search_path to ''
    as $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate','travel_booking') then p_level = 'edit'
    when p_key in ('calendar','reports','finance') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays') then p_level in ('read','edit')
    else false end;
$$;

create or replace function private.permission_deps() returns table(key text, key_level text, needs text)
    language sql immutable
    set search_path to ''
    as $$
  values
    ('people_create','read','people'),
    ('role_manager','read','people'), ('role_manager','read','leave_balances'),
    ('role_manager','read','calendar'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('special_leave','read','people'), ('special_leave','read','leave_balances');
$$;

create or replace function private.has_permission(uid uuid, p_permission text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select case p_permission
    when 'employees.edit'     then private.has_perm(uid, 'people', 'edit')
    when 'departments.edit'   then private.has_perm(uid, 'departments', 'edit')
    when 'accruals.run'       then private.has_perm(uid, 'leave_accrual', 'edit')
    when 'roles.manager'      then private.has_perm(uid, 'role_manager', 'edit')
    when 'personal_info.view' then private.has_perm(uid, 'personal_info', 'read')
    when 'personal_info.edit' then private.has_perm(uid, 'personal_info', 'edit')
    when 'personal_info.edit_own' then private.has_perm(uid, 'personal_info_own', 'edit')
    when 'special_leave.grant' then private.has_perm(uid, 'special_leave', 'edit')
    when 'separations.manage' then private.has_perm(uid, 'clearance', 'edit')
    when 'separations.view'   then private.has_perm(uid, 'clearance', 'read')
    when 'settings.edit'      then private.has_perm(uid, 'work_settings', 'edit')
                                   and private.has_perm(uid, 'holidays', 'edit')
    -- FR-75: absences are per person now (absence_watchers), not a catalog item.
    when 'absences.view'      then private.is_active(uid)
                                   and (private.is_admin(uid)
                                        or exists (select 1 from public.absence_watchers where user_id = uid))
    when 'finance.view'       then private.has_perm(uid, 'finance', 'read')
    else false
  end;
$$;

-- Presets for new companies: without absences read.
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
      ('security','people','read'), ('security','leave_balances','read'),
      ('security','leave_requests','read'), ('security','calendar','read'),
      ('finance','clearance','read'), ('finance','finance','read'),
      ('procurement','travel_booking','edit')
    ) as v(system_key, permission, level) on r.system_key = v.system_key::public.app_role
   where r.company_id = p_company
  on conflict do nothing;
end $$;
