-- FR-74: Manager is read-only on people (2026-11-02, docs/specs/2026-11-02-manager-read-only-design.md).
--
-- HR asked that managers stop adding employees; the owner widened it: only HR and Admin change
-- employees. Managers keep approving (is_manager_of, unchanged) and the company calendar
-- (reads_calendar, unchanged), and see only their direct reports.
--
-- 1. app_create_employee: the manager own-team branch is gone; non-admins need people_create.
-- 2. enforce_profile_update_scope + profiles_update: no manager write path (name, hire date).
-- 3. reads_people / reads_balances / can_read_all: no hard-wired manager clause.
-- 4. New private.is_direct_manager_of(uid, target): manager_id = uid, any role. Used for the
--    SELECT policies of profiles, user_roles, leave ledger/allocations/policies, the request
--    read (can_read_approval_request) and accrue_employee_leave. Reads only, never writes or
--    signatures: those keep is_manager_of (Manager role required).
-- 5. The department manager signs the department step for people who are not their direct
--    reports. Until now the Manager role read every balance and personnel number; keep what that
--    signer needs: leave_ledger rows of their department (the balance hint on Home, the print
--    view) and personnel_no / job_title in app_request_approval_context (the paper form).
-- Otherwise each function body is copied unchanged from supabase/schema.sql.

create function private.is_direct_manager_of(uid uuid, target uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select private.is_active(uid)
     and exists (
       select 1
         from public.profiles caller
         join public.profiles employee
           on employee.id = target
          and employee.company_id = caller.company_id
        where caller.id = uid
          and employee.manager_id = uid
     );
$$;
comment on function private.is_direct_manager_of(uuid, uuid) is
  'FR-74: caller is active and target reports to them (profiles.manager_id), whatever the caller''s roles. Read access only; writes and approvals use is_manager_of.';
revoke all on function private.is_direct_manager_of(uuid, uuid) from public;
grant execute on function private.is_direct_manager_of(uuid, uuid) to authenticated;

create or replace function private.reads_people(uid uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select private.has_perm(uid, 'people', 'read');
$$;

create or replace function private.reads_balances(uid uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select private.has_perm(uid, 'leave_balances', 'read');
$$;

create or replace function private.can_read_all(uid uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select private.is_admin(uid)
      or private.has_role(uid, 'security')
      or private.has_role(uid, 'hr');
$$;
comment on function private.can_read_all(uid uuid) is
  'Broad-read predicate: admin, security, or hr (FR-74 removed manager). Write access is never implied. FR-17/FR-18/FR-35.';

CREATE OR REPLACE FUNCTION public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_manager_id uuid DEFAULT NULL::uuid, p_roles public.app_role[] DEFAULT ARRAY['employee'::public.app_role], p_hire_date date DEFAULT NULL::date, p_language_pref text DEFAULT 'fa'::text, p_calendar_pref text DEFAULT 'jalali'::text, p_job_title text DEFAULT NULL::text, p_role_ids uuid[] DEFAULT NULL::uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid := auth.uid();
  v_admin  boolean;
  v_hr     boolean;
  v_dept   uuid;
  v_mgr    uuid;
  v_roles  public.app_role[];
  v_company uuid;
  v_uid    uuid;
  v_emp_role uuid;
  lt       record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_admin := private.is_admin(v_caller);
  v_hr := private.has_perm(v_caller, 'people_create', 'edit');

  -- D1: no path adds admin, whichever branch below runs.
  if 'admin' = any (coalesce(p_roles, '{}')) then
    raise exception 'admin is moved only by Transfer admin' using errcode = '42501';
  end if;

  if v_admin then
    -- Tenant binding: an admin names the company, but only their own.
    if p_company_id is distinct from
       (select company_id from public.profiles where id = v_caller) then
      raise exception 'not allowed to create employees in another company'
        using errcode = '42501';
    end if;
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := p_roles;
    v_company := p_company_id;
  elsif v_hr then
    -- FR-35 / spec D4. HR onboards into ANY department and sets the reporting
    -- line, which is what makes them useful. But the enum role list is overwritten
    -- here regardless of what the client sent; extra roles come only through
    -- p_role_ids, which D5 checks.
    --
    -- The company comes from the caller's own profile rather than the argument:
    -- only an admin may name the company.
    select company_id into v_company from public.profiles where id = v_caller;
    v_dept := p_department_id;
    v_mgr := p_manager_id;
    v_roles := array['employee']::public.app_role[];
  else
    raise exception 'admin or hr required' using errcode = '42501';
  end if;

  -- With role ids, the enum list is just Employee; the ids decide the rest below.
  if p_role_ids is not null then
    v_roles := array['employee']::public.app_role[];
  end if;

  v_uid := private.create_employee_impl(
    v_caller, case when v_admin then 'admin' else 'hr' end,
    v_company, v_dept, v_mgr, p_personnel_no, p_full_name, p_password,
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title);

  -- D5 for non-admins (and D1 for everyone) through the assignment RPC. Skipped
  -- when the ids add nothing beyond Employee.
  select id into v_emp_role from public.roles where company_id = v_company and system_key = 'employee';
  if p_role_ids is not null
     and exists (select 1 from unnest(p_role_ids) x where x is distinct from v_emp_role) then
    perform public.app_set_user_role_ids(v_uid, p_role_ids || v_emp_role);
  end if;

  -- HR path: default quotas immediately, no admin round-trip.
  if not v_admin then
    for lt in
      select id, default_annual_quota_days
        from public.leave_types
       where company_id = v_company and active and affects_balance
         and coalesce(default_annual_quota_days, 0) > 0
    loop
      perform private.allocate_leave_impl(
        v_caller, v_uid, lt.id,
        date_trunc('year', current_date)::date,
        (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
        round(lt.default_annual_quota_days * private.company_minutes_per_day(v_company))::int);
    end loop;
  end if;

  return v_uid;
end; $$;


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

  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    v_allowed := array['full_name', 'language_pref', 'calendar_pref'];
  elsif private.has_perm(v_uid, 'people', 'edit')
        -- FR-55 D4: same company, never an admin (even a deactivated one, so an
        -- editor cannot reactivate one), and nothing the editor does not hold.
        and private.can_act_on(v_uid, old.id)
  then
    v_allowed := array['full_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
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


CREATE OR REPLACE FUNCTION public.accrue_employee_leave(p_employee_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := auth.uid(); v_type uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- FR-43: hr joins the direct manager and admin. FR-74: any role with the
  -- employee as a direct report (they may read the balances). This posts only months the policy has
  -- ALREADY earned — it credits nothing that was not due — and it runs lazily on
  -- every balance read. Without hr here, the balances HR now reads on the Edit
  -- Employee screen would silently lag behind the accrual policy HR just set.
  if not (private.is_direct_manager_of(v_uid, p_employee_id)
          or private.has_perm(v_uid, 'leave_balances', 'read')) then
    raise exception 'not allowed to accrue for this employee' using errcode = '42501';
  end if;

  for v_type in
    select leave_type_id from public.employee_leave_policies where employee_id = p_employee_id
  loop
    perform public.accrue_leave(p_employee_id, v_type);
  end loop;
end; $$;


CREATE OR REPLACE FUNCTION private.can_read_approval_request(p_uid uuid, p_request uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(private.is_active(p_uid) and exists (
    select 1 from public.leave_requests r join public.profiles p on p.id=p_uid and p.company_id=r.company_id
    where r.id=p_request and (r.employee_id=p_uid or private.is_direct_manager_of(p_uid,r.employee_id)
      or private.has_perm(p_uid,'leave_requests','read')
      -- Review fix: approval authority grants a full-row read only while the request is
      -- pending, or for a request on which the caller recorded a decision (print/history).
      or exists (select 1 from public.leave_request_approvals a
        where a.request_id=r.id and a.approver_id=p_uid)
      or (r.status='pending' and (exists (select 1 from public.approval_steps s
        where private.can_approve_step(p_uid,r.id,s.id))
      or (not exists(select 1 from public.approval_steps s where s.company_id=r.company_id
        and s.active and r.kind=any(s.applies_to) and private.step_applies(s.manager_scope,r.employee_id))
        and private.approval_fallback_allowed(p_uid,r.id)))))),false);
$$;


CREATE OR REPLACE FUNCTION public.app_request_approval_context(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; v_progress jsonb; v_result jsonb;
begin
  if not private.can_read_approval_request(auth.uid(),p_id) then
    raise exception 'request not found' using errcode='P0002'; end if;
  select * into r from public.leave_requests where id=p_id;
  v_progress:=public.app_request_approval_progress(p_id);
  select (to_jsonb(r)-'signature_data'-'approver_signature_data')||jsonb_build_object(
    'employee_name',p.full_name,'employee_code',p.employee_code,
    'personnel_no',case when p.id=auth.uid() or private.reads_people(auth.uid())
      or private.is_direct_manager_of(auth.uid(),p.id) or private.is_department_manager_of(auth.uid(),p.id) then p.personnel_no end,
    'job_title',case when p.id=auth.uid() or private.reads_people(auth.uid())
      or private.is_direct_manager_of(auth.uid(),p.id) or private.is_department_manager_of(auth.uid(),p.id) then p.job_title end,
    'employee_manager_id',p.manager_id,'department_id',p.department_id,
    'department_name',dep.name_fa,'department_name_fa',dep.name_fa,'department_name_en',dep.name_en,
    'employee_department_manager_id',private.department_manager_for(p.id),
    'leave_type_name_fa',lt.name_fa,'leave_type_name_en',lt.name_en,'affects_balance',lt.affects_balance,
    'leave_type_affects_balance',lt.affects_balance,'is_paid',lt.is_paid,
    'replacement_name',rp.full_name,'decided_by_name',dp.full_name,
    'replacement_conflict',case when r.replacement_id is null then false else
      private.replacement_is_away(r.replacement_id,r.start_date,r.end_date,r.unit,r.start_time,r.end_time) end,
    'can_override',r.status='pending' and private.is_admin(auth.uid()),
    'can_approve',r.status='pending' and (private.is_admin(auth.uid()) or exists
      (select 1 from jsonb_array_elements(v_progress) item where (item->>'can_approve')::boolean)),
    'can_reject',r.status='pending' and (private.is_admin(auth.uid()) or exists
      (select 1 from jsonb_array_elements(v_progress) item where (item->>'can_reject')::boolean)),
    'configuration_changed',coalesce(pol.configuration_changed,false),
    'legacy_reconciliation_required',private.ambiguous_legacy_approval(r.id),
    'progress',v_progress)
  into v_result from public.profiles p left join public.departments dep on dep.id=p.department_id
    left join public.leave_types lt on lt.id=r.leave_type_id
    left join public.profiles rp on rp.id=r.replacement_id left join public.profiles dp on dp.id=r.decided_by
    left join public.approval_request_policy pol on pol.request_id=r.id where p.id=r.employee_id;
  return v_result;
end; $$;


drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (private.is_active((select auth.uid())) and (
    private.is_admin((select auth.uid()))
    or private.has_perm((select auth.uid()), 'people', 'edit')
    or id = (select auth.uid())))
  with check (private.is_active((select auth.uid())) and (
    private.is_admin((select auth.uid()))
    or private.has_perm((select auth.uid()), 'people', 'edit')
    or id = (select auth.uid())));

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
    or (private.is_active((select auth.uid())) and (
      private.same_team((select auth.uid()), id)
      or private.is_direct_manager_of((select auth.uid()), id)
      or private.reads_people((select auth.uid())))));

drop policy user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (private.is_active((select auth.uid())) and (
    user_id = (select auth.uid())
    or private.is_direct_manager_of((select auth.uid()), user_id)
    or private.reads_people((select auth.uid()))));

drop policy employee_leave_policies_select on public.employee_leave_policies;
create policy employee_leave_policies_select on public.employee_leave_policies for select to authenticated
  using (private.is_active((select auth.uid())) and (
    employee_id = (select auth.uid())
    or private.is_direct_manager_of((select auth.uid()), employee_id)
    or private.reads_balances((select auth.uid()))));

drop policy leave_allocations_select on public.leave_allocations;
create policy leave_allocations_select on public.leave_allocations for select to authenticated
  using (private.is_active((select auth.uid())) and (
    employee_id = (select auth.uid())
    or private.is_direct_manager_of((select auth.uid()), employee_id)
    or private.reads_balances((select auth.uid()))));

drop policy leave_ledger_select on public.leave_ledger;
create policy leave_ledger_select on public.leave_ledger for select to authenticated
  using (private.is_active((select auth.uid())) and (
    employee_id = (select auth.uid())
    or private.is_direct_manager_of((select auth.uid()), employee_id)
    or private.is_department_manager_of((select auth.uid()), employee_id)
    or private.reads_balances((select auth.uid()))));

-- The ledger policy runs as the caller, so it needs execute (it was definer-internal).
grant execute on function private.is_department_manager_of(uuid, uuid) to authenticated;
