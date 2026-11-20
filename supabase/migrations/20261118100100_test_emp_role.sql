-- =============================================================================
-- Migration: 20261118100100_test_emp_role.sql
-- Purpose  : FR-95 — the fixed built-in test-emp role, for outside reviewers (e.g. the
--            SMS provider checking the link in our templates). A holder sees the Employee
--            screens with their own data only:
--              * org chart: own management chain, self and direct reports, nothing else;
--              * no teammates (same_team is false: calendar, profiles, Team page), except
--                their own manager on the Team page;
--              * nobody in the replacement picker, and nobody picks them as a replacement;
--              * cannot file a request of any kind (trigger), so no approval step or SMS.
--            Profile, personal info, signature and photo saves stay as for Employee
--            (owner, 2026-11-18). The restriction wins over every other role the user holds.
--            Any role whose system_key starts with 'test-' counts (future test-mgr, …).
-- Depends  : 20261118100000_test_emp_role_enum.sql
-- =============================================================================

-- ── Helper ────────────────────────────────────────────────────────────────────
create or replace function private.is_test_account(uid uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.user_roles where user_id = uid and role::text like 'test-%');
$$;
revoke all on function private.is_test_account(uuid) from public, anon;
grant execute on function private.is_test_account(uuid) to authenticated;

-- ── The role row: every existing company, and every new one ───────────────────
-- No ON CONFLICT: a custom role already named 'test-emp' must stop the deploy, not
-- leave the company without the built-in role.
insert into public.roles (company_id, system_key, kind, name)
select c.id, 'test-emp', 'system', 'test-emp'
  from public.companies c
 where not exists (select 1 from public.roles r where r.company_id = c.id and r.system_key = 'test-emp');

create or replace function private.seed_company_roles(p_company uuid) returns void
  language plpgsql security definer set search_path to '' as $$
begin
  insert into public.roles (company_id, system_key, kind, name) values
    (p_company, 'admin', 'system', 'Admin'), (p_company, 'manager', 'system', 'Manager'),
    (p_company, 'employee', 'system', 'Employee'), (p_company, 'hr', 'preset', 'HR'),
    (p_company, 'security', 'preset', 'Security'), (p_company, 'finance', 'preset', 'Finance'),
    (p_company, 'procurement', 'preset', 'Procurement'), (p_company, 'test-emp', 'system', 'test-emp')
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
revoke all on function private.seed_company_roles(uuid) from public;

-- ── No teammates ──────────────────────────────────────────────────────────────
-- Drives the calendar view, profiles_select and nothing else.
create or replace function private.same_team(uid uuid, target uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select private.is_active(uid)
     and not private.is_test_account(uid)
     and exists (
       select 1
         from public.profiles caller
         join public.profiles teammate
           on teammate.id = target
          and teammate.company_id = caller.company_id
          and teammate.department_id = caller.department_id
        where caller.id = uid
          and caller.department_id is not null
     );
$$;

-- Team page: a test account sees only its own manager.
create or replace function public.get_my_team_directory()
  returns table(profile_id uuid, full_name text, employee_code text, relation text, roles public.app_role[],
                department_name_fa text, department_name_en text, manager_name text)
  language sql stable security definer set search_path to '' as $$
  with me as (
    select id, company_id, department_id, manager_id, private.is_test_account(id) as limited
      from public.profiles
     where id = auth.uid()
       and active
  )
  select
    p.id,
    p.full_name,
    p.employee_code,
    case when p.id = me.manager_id then 'manager' else 'teammate' end,
    coalesce(
      array_agg(ur.role order by ur.role) filter (where ur.role is not null),
      array[]::public.app_role[]
    ),
    d.name_fa,
    d.name_en,
    mgr.full_name
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
   and p.id <> me.id
   and (
     p.id = me.manager_id
     or (not me.limited and me.department_id is not null and p.department_id = me.department_id)
   )
  left join public.user_roles ur on ur.user_id = p.id
  left join public.departments d on d.id = p.department_id
  left join public.profiles mgr on mgr.id = p.manager_id
  group by p.id, p.full_name, p.employee_code, me.manager_id,
           d.name_fa, d.name_en, mgr.full_name
  order by case when p.id = me.manager_id then 0 else 1 end, p.full_name;
$$;

-- ── Org chart: chain above, self, direct reports ──────────────────────────────
create or replace function public.get_org_chart()
  returns table(profile_id uuid, full_name text, job_title text, department_id uuid, department_name_fa text,
                department_name_en text, manager_id uuid, is_department_manager boolean, personnel_no text)
  language sql stable security definer set search_path to '' as $$
  with recursive me as (
    select id, company_id, private.is_test_account(id) as limited
      from public.profiles
     where id = auth.uid()
       and active
  ),
  -- Walks up active managers only (the chart drops an inactive manager's link too).
  -- The depth cap stops a manager_id cycle.
  up(id, depth) as (
    select me.id, 0 from me where me.limited
    union
    select m.id, up.depth + 1
      from up
      join public.profiles p on p.id = up.id
      join public.profiles m on m.id = p.manager_id and m.active
     where up.depth < 64
  ),
  visible as (
    select up.id from up
    union
    select r.id from me join public.profiles r on r.manager_id = me.id where me.limited
  )
  select
    p.id,
    p.full_name,
    p.job_title,
    p.department_id,
    d.name_fa,
    d.name_en,
    case when m.active then p.manager_id end,
    exists (
      select 1 from public.departments dm
       where dm.manager_id = p.id and dm.company_id = p.company_id
    ),
    p.personnel_no
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
  left join public.departments d on d.id = p.department_id
  left join public.profiles m on m.id = p.manager_id
  where not me.limited or p.id in (select visible.id from visible)
  order by p.full_name;
$$;

-- ── Replacement picker: nobody for a test account, and never a test account ───
create or replace function public.get_replacement_candidates(
  p_start date, p_end date, p_unit public.leave_unit default 'day'::public.leave_unit,
  p_start_time time without time zone default null::time without time zone,
  p_end_time time without time zone default null::time without time zone)
  returns table(profile_id uuid, full_name text, employee_code text, unavailable boolean, unavailable_reason text)
  language sql stable security definer set search_path to '' as $$
  with me as (
    select id, company_id, department_id
      from public.profiles
     where id = auth.uid()
       and active
       and not private.is_test_account(id)
  )
  select
    p.id,
    p.full_name,
    p.employee_code,
    private.replacement_is_away(
      p.id, p_start, p_end, p_unit, p_start_time, p_end_time
    ) as unavailable,
    case
      when private.replacement_is_away(
        p.id, p_start, p_end, p_unit, p_start_time, p_end_time
      ) then 'on leave'
      else null
    end as unavailable_reason
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
   and p.id <> me.id
   and not private.is_test_account(p.id)
   and ((me.department_id is not null and p.department_id = me.department_id)
        or private.delegate_eligible(me.id,p.id))
  order by p.full_name;
$$;

-- ── No requests (any kind, any path) ──────────────────────────────────────────
create or replace function private.leave_request_requester_has_time_off() returns trigger
  language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' and private.is_test_account(new.employee_id) then
    raise exception 'test accounts cannot send requests' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or (new.status = 'approved' and old.status <> 'approved'))
     and private.is_security_only(new.employee_id) then
    raise exception 'no time off for this account' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.errand_extension_requester_has_time_off() returns trigger
  language plpgsql security definer set search_path to '' as $$
declare v_employee uuid := (select employee_id from public.leave_requests where id = new.request_id);
begin
  if tg_op = 'INSERT' and private.is_test_account(v_employee) then
    raise exception 'test accounts cannot send requests' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or (new.status = 'approved' and old.status <> 'approved'))
     and private.is_security_only(v_employee) then
    raise exception 'no time off for this account' using errcode = '42501';
  end if;
  return new;
end $$;
