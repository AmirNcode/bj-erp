-- Approval-only delegation. No role identities or appointments are seeded. The job stays inactive.
-- Lock order for every authority mutation/decision: company approval lock, then employee leave lock.
-- Existing personnel-edit helpers (especially private.is_manager_of) are deliberately unchanged.

create or replace function private.permission_keys() returns setof text
language sql immutable set search_path = '' as $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','absences','approval_steps','approval_delegate',
    'work_settings','holidays','finance']);
$$;
create or replace function private.permission_allows(p_key text,p_level text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate') then p_level = 'edit'
    when p_key in ('calendar','reports','absences','finance') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays') then p_level in ('read','edit')
    else false end;
$$;

create table public.approval_executive_settings (
  company_id uuid primary key references public.companies(id),
  ceo_id uuid references public.profiles(id),
  hr_head_id uuid references public.profiles(id),
  hr_step_ids uuid[] not null default '{}',
  version bigint not null default 1,
  configured_by uuid references public.profiles(id),
  configured_at timestamptz not null default clock_timestamp()
);
create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  principal_id uuid not null references public.profiles(id),
  delegate_id uuid not null references public.profiles(id),
  principal_name text not null,
  delegate_name text not null,
  source_request_id uuid references public.leave_requests(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  activated_at timestamptz,
  ceo_authorized boolean not null default false,
  configured_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint approval_delegation_not_self check (principal_id <> delegate_id),
  constraint approval_delegation_window check (
    (source_request_id is null and starts_at is null and ends_at is null)
    or (source_request_id is not null and starts_at is not null and ends_at > starts_at))
);
create unique index approval_delegations_saved_current on public.approval_delegations(principal_id)
  where source_request_id is null and revoked_at is null;
create unique index approval_delegations_source on public.approval_delegations(source_request_id)
  where source_request_id is not null;
create index approval_delegations_resolve on public.approval_delegations(principal_id,starts_at,ends_at);

create table public.approval_request_policy (
  request_id uuid primary key references public.leave_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hr_head_id uuid,
  hr_exempt_step_ids uuid[] not null default '{}',
  step_snapshot jsonb not null default '[]',
  configuration_changed boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  check (ends_at > starts_at)
);
create table public.approval_auto_requests (
  request_id uuid primary key references public.leave_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  authority_id uuid not null references public.approval_delegations(id),
  principal_id uuid not null references public.profiles(id),
  delegate_id uuid not null references public.profiles(id),
  principal_name text not null,
  delegate_name text not null,
  settings_version bigint not null,
  step_ids uuid[] not null,
  step_snapshot jsonb not null,
  consent_at timestamptz not null,
  submitted_at timestamptz not null,
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','blocked','completed','invalidated')),
  reason text,
  attempted_at timestamptz,
  processed_at timestamptz,
  attempts integer not null default 0,
  check (cardinality(step_ids) > 0),
  check (due_at = submitted_at + interval '120 minutes')
);
create index approval_auto_requests_due on public.approval_auto_requests(due_at)
  where state in ('pending','blocked');
create table public.approval_worker_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  examined integer not null default 0,
  completed integer not null default 0,
  blocked integer not null default 0
);

alter table public.leave_request_approvals
  add column evidence_kind text not null default 'legacy',
  add column principal_id uuid,
  add column principal_name text,
  add column signer_name_snapshot text,
  add column authority_id uuid,
  add column evidence jsonb not null default '{}',
  add constraint leave_approval_evidence_kind check
    (evidence_kind in ('legacy','manual','delegated','automatic')),
  add constraint leave_approval_automatic_shape check
    (evidence_kind <> 'automatic' or
      (approver_id is null and signature_data is null and signature_consent_at is null
       and principal_id is not null and authority_id is not null and step_id is not null));

create function private.approval_lock(p_company uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('approval:' || p_company::text,0));
$$;

-- Natural eligibility never consults another delegation or arbitrary role names.
create function private.natural_approver(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_active(p_uid) and (
    private.has_role(p_uid,'manager') or private.is_admin(p_uid)
    or exists (select 1 from public.departments d where d.manager_id=p_uid)
    or exists (select 1 from public.approval_steps s
      join public.profiles p on p.id=p_uid and p.company_id=s.company_id
      where s.active and (s.approver_id=p_uid
        or (s.approver_id is null and s.role <> 'manager' and private.has_role(p_uid,s.role))))),false);
$$;
create function private.delegate_eligible(p_principal uuid,p_delegate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_principal <> p_delegate
    and private.has_perm(p_principal,'approval_delegate','edit')
    and private.natural_approver(p_principal) and private.natural_approver(p_delegate)
    and exists (select 1 from public.profiles p join public.profiles d on d.company_id=p.company_id
      where p.id=p_principal and d.id=p_delegate and p.active and d.active
      and (not exists (select 1 from public.approval_executive_settings x
                        where x.company_id=p.company_id and x.ceo_id=p_principal)
           or d.manager_id=p_principal)),false);
$$;
create function private.effective_approval_delegate(p_principal uuid,p_at timestamptz default clock_timestamp())
returns setof public.approval_delegations language plpgsql stable security definer set search_path = '' as $$
declare v_count integer;
begin
  select count(*) into v_count from public.approval_delegations d
    join public.leave_requests r on r.id=d.source_request_id
    where d.principal_id=p_principal and d.revoked_at is null and r.status='approved'
      and d.starts_at<=p_at and p_at<d.ends_at and private.delegate_eligible(p_principal,d.delegate_id);
  -- An ambiguous legacy overlap never silently picks a person or falls back to a saved grant.
  if v_count>1 then return; end if;
  if v_count=1 then
    return query select d.* from public.approval_delegations d
      join public.leave_requests r on r.id=d.source_request_id
      where d.principal_id=p_principal and d.revoked_at is null and r.status='approved'
        and d.starts_at<=p_at and p_at<d.ends_at and private.delegate_eligible(p_principal,d.delegate_id);
  else
    return query select d.* from public.approval_delegations d
      where d.principal_id=p_principal and d.source_request_id is null and d.revoked_at is null
        and private.delegate_eligible(p_principal,d.delegate_id);
  end if;
end; $$;

create function private.natural_step_authority(p_uid uuid,p_request uuid,p_step uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(exists (select 1 from public.leave_requests r
    join public.profiles p on p.id=p_uid and p.company_id=r.company_id and p.active
    join public.approval_steps s on s.id=p_step and s.company_id=r.company_id and s.active
      and r.kind=any(s.applies_to) and private.step_applies(s.manager_scope,r.employee_id)
    where r.id=p_request and r.employee_id<>p_uid and
      case when s.approver_id is not null then s.approver_id=p_uid
      when s.role='manager' and s.manager_scope='department'
        then private.is_department_manager_of(p_uid,r.employee_id)
      when s.role='manager' then private.is_manager_of(p_uid,r.employee_id)
      else private.has_role(p_uid,s.role) end),false);
$$;
create function private.request_hr_exempt(p_request uuid,p_step uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.approval_request_policy x
    join public.approval_steps s on s.id=p_step
    cross join lateral jsonb_array_elements(x.step_snapshot) snapshot
    where x.request_id=p_request and s.id=any(x.hr_exempt_step_ids)
      and snapshot-'expected_name'=jsonb_build_object('step_id',s.id,'step_role',s.role,
        'step_order',s.step_order,'manager_scope',s.manager_scope,'approver_id',s.approver_id,'applies_to',s.applies_to));
$$;
create function private.request_step_applies(p_request uuid,p_step uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_requests r join public.approval_steps s
    on s.id=p_step and s.company_id=r.company_id and s.active and r.kind=any(s.applies_to)
    where r.id=p_request and private.step_applies(s.manager_scope,r.employee_id)
      and not private.request_hr_exempt(p_request,p_step));
$$;
-- A legacy role-only row can satisfy a current step only when that role maps unambiguously.
-- In particular one old manager signature never fills both direct and department manager steps.
create function private.request_step_decided(p_request uuid,p_step uuid,p_decision public.leave_status default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.leave_request_approvals a join public.approval_steps s on s.id=p_step
    where a.request_id=p_request and (p_decision is null or a.decision=p_decision)
      and (a.step_id=s.id or (a.step_id is null and a.step_role=s.role
        and (select count(*) from public.approval_steps candidate where candidate.role=s.role
          and private.request_step_applies(p_request,candidate.id))=1)));
$$;
create function private.ambiguous_legacy_approval(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.leave_request_approvals a join public.leave_requests r on r.id=a.request_id
    where a.request_id=p_request and r.status='pending' and a.step_id is null
    and (select count(*) from public.approval_steps candidate where candidate.role=a.step_role
      and private.request_step_applies(p_request,candidate.id))>1);
$$;
create function private.step_delegation(p_uid uuid,p_request uuid,p_step uuid)
returns setof public.approval_delegations language sql stable security definer set search_path = '' as $$
  select d.* from public.profiles p
    cross join lateral private.effective_approval_delegate(p.id) d
    join public.leave_requests r on r.id=p_request and r.company_id=p.company_id
  where d.delegate_id=p_uid and r.employee_id<>p_uid
    and d.source_request_id is distinct from p_request
    and private.natural_step_authority(p.id,p_request,p_step)
    and private.request_step_applies(p_request,p_step)
  order by d.created_at,d.id limit 1;
$$;
create function private.can_approve_step(p_uid uuid,p_request uuid,p_step uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.request_step_applies(p_request,p_step) and
    (private.natural_step_authority(p_uid,p_request,p_step)
     or exists (select 1 from private.step_delegation(p_uid,p_request,p_step)));
$$;
create function private.approval_fallback_allowed(p_uid uuid,p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(exists(select 1 from public.leave_requests r
    join public.profiles caller on caller.id=p_uid and caller.company_id=r.company_id and caller.active
    where r.id=p_request and (private.is_admin(p_uid)
      or (r.employee_id<>p_uid and (private.is_manager_of(p_uid,r.employee_id)
        or exists(select 1 from public.profiles emp
          cross join lateral private.effective_approval_delegate(emp.manager_id) d
          where emp.id=r.employee_id and d.delegate_id=p_uid
            and d.source_request_id is distinct from r.id
            and private.is_manager_of(d.principal_id,r.employee_id)))))),false);
$$;

create function private.can_read_approval_request(p_uid uuid,p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_active(p_uid) and exists (
    select 1 from public.leave_requests r join public.profiles p on p.id=p_uid and p.company_id=r.company_id
    where r.id=p_request and (r.employee_id=p_uid or private.is_manager_of(p_uid,r.employee_id)
      or private.has_perm(p_uid,'leave_requests','read')
      or exists (select 1 from public.approval_steps s
        where private.can_approve_step(p_uid,r.id,s.id))
      or (not exists(select 1 from public.approval_steps s where s.company_id=r.company_id
        and s.active and r.kind=any(s.applies_to) and private.step_applies(s.manager_scope,r.employee_id))
        and private.approval_fallback_allowed(p_uid,r.id)))),false);
$$;
-- Public RLS predicate binds the caller; all reusable authority helpers remain inaccessible.
create function public.app_can_read_approval_request(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_read_approval_request(auth.uid(),p_id);
$$;

create function private.approval_bounds(p_company uuid,p_start date,p_end date,p_unit public.leave_unit,
  p_day_part public.day_part,p_start_time time,p_end_time time) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ws time; v_we time; v_mid time; v_start timestamptz; v_end timestamptz;
begin
  if p_start is null or p_end is null or p_end<p_start then
    raise exception 'invalid delegation absence dates' using errcode='22023'; end if;
  select work_start,work_end into v_ws,v_we from public.work_settings where company_id=p_company limit 1;
  v_ws:=coalesce(v_ws,'07:00'::time); v_we:=coalesce(v_we,'15:00'::time);
  v_mid:=v_ws+(v_we-v_ws)/2;
  if p_unit='hour' then
    if p_start<>p_end or p_start_time is null or p_end_time is null or p_end_time<=p_start_time then
      raise exception 'invalid delegation absence times' using errcode='22023'; end if;
    v_start:=(p_start+p_start_time) at time zone 'Asia/Tehran';
    v_end:=(p_end+p_end_time) at time zone 'Asia/Tehran';
  elsif p_day_part='full' then
    v_start:=p_start::timestamp at time zone 'Asia/Tehran';
    v_end:=(p_end+1)::timestamp at time zone 'Asia/Tehran';
  else
    if p_start<>p_end then raise exception 'half-day delegation requires one date' using errcode='22023'; end if;
    v_start:=(p_start+case when p_day_part='am' then v_ws else v_mid end) at time zone 'Asia/Tehran';
    v_end:=(p_end+case when p_day_part='am' then v_mid else v_we end) at time zone 'Asia/Tehran';
  end if;
  return jsonb_build_object('starts_at',v_start,'ends_at',v_end,
    'work_start',v_ws,'work_end',v_we,'timezone','Asia/Tehran');
end; $$;

create function private.approval_grant_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('grant_id',d.id,'delegate_id',d.delegate_id,'delegate_name',p.full_name,
    'ceo_authorized',d.ceo_authorized,'source_request_id',d.source_request_id,
    'starts_at',d.starts_at,'ends_at',d.ends_at)
  from public.approval_delegations d join public.profiles p on p.id=d.delegate_id where d.id=p_id;
$$;

create function public.app_approval_capabilities() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('is_admin',private.is_admin(auth.uid()),
    'can_delegate',private.has_perm(auth.uid(),'approval_delegate','edit'),
    'can_approve',private.natural_approver(auth.uid()) or exists (
      select 1 from public.approval_delegations d
      cross join lateral private.effective_approval_delegate(d.principal_id) e
      where e.id=d.id and d.delegate_id=auth.uid()));
$$;
create function public.app_delegation_context(p_principal_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_principal uuid:=coalesce(p_principal_id,auth.uid());
  v_company uuid; v_name text; v_saved uuid; v_effective uuid; v_admin boolean; v_settings jsonb;
begin
  if not private.is_active(v_uid) then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.profiles where id=v_uid;
  v_admin:=private.is_admin(v_uid);
  if (v_principal<>v_uid and not v_admin) or not exists (select 1 from public.profiles
      where id=v_principal and company_id=v_company) then raise exception 'not permitted' using errcode='42501'; end if;
  select full_name into v_name from public.profiles where id=v_principal;
  select id into v_saved from public.approval_delegations where principal_id=v_principal
    and source_request_id is null and revoked_at is null;
  select id into v_effective from private.effective_approval_delegate(v_principal);
  select jsonb_build_object('ceo_id',x.ceo_id,'hr_head_id',x.hr_head_id,'hr_step_ids',x.hr_step_ids,
    'version',x.version) into v_settings from public.approval_executive_settings x where company_id=v_company;
  return jsonb_build_object('principal_id',v_principal,'principal_name',v_name,'is_admin',v_admin,
    'can_delegate',private.has_perm(v_principal,'approval_delegate','edit'),
    'can_approve',private.natural_approver(v_principal),
    'saved',private.approval_grant_json(v_saved),'effective',private.approval_grant_json(v_effective),
    'executive_settings',coalesce(v_settings,'{}'),
    'principals',case when v_admin then coalesce((select jsonb_agg(jsonb_build_object(
      'profile_id',p.id,'full_name',p.full_name,'employee_code',p.employee_code) order by p.full_name)
      from public.profiles p where p.company_id=v_company and p.active),'[]') else '[]'::jsonb end,
    'hr_steps',case when v_admin then coalesce((select jsonb_agg(jsonb_build_object(
      'step_id',s.id,'step_role',s.role,'step_order',s.step_order,'expected_name',p.full_name) order by s.step_order)
      from public.approval_steps s left join public.profiles p on p.id=s.approver_id
      where s.company_id=v_company and s.active),'[]') else '[]'::jsonb end);
end; $$;
create function public.app_search_delegates(p_principal_id uuid,p_search text default '')
returns table(profile_id uuid,full_name text,employee_code text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active(auth.uid()) or not (auth.uid()=p_principal_id or private.is_admin(auth.uid()))
     or not exists (select 1 from public.profiles p join public.profiles c on c.company_id=p.company_id
        where p.id=p_principal_id and c.id=auth.uid())
     or not private.has_perm(p_principal_id,'approval_delegate','edit') then
    raise exception 'not permitted to select a delegate' using errcode='42501'; end if;
  return query select p.id,p.full_name,p.employee_code from public.profiles p
    where private.delegate_eligible(p_principal_id,p.id)
      and (coalesce(btrim(p_search),'')='' or p.full_name ilike '%'||btrim(p_search)||'%'
        or p.employee_code ilike '%'||btrim(p_search)||'%')
    order by p.full_name,p.id limit 50;
end; $$;

create function private.approval_step_snapshot(p_request uuid,p_ids uuid[] default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('step_id',s.id,'step_role',s.role,
    'step_order',s.step_order,'manager_scope',s.manager_scope,'approver_id',s.approver_id,
    'expected_name',p.full_name,'applies_to',s.applies_to) order by s.step_order,s.id),'[]')
  from public.leave_requests r join public.approval_steps s on s.company_id=r.company_id
    and s.active and r.kind=any(s.applies_to) and private.step_applies(s.manager_scope,r.employee_id)
    left join public.profiles p on p.id=case when s.approver_id is not null then s.approver_id
      when s.role='manager' and s.manager_scope='department' then private.department_manager_for(r.employee_id)
      when s.role='manager' then (select e.manager_id from public.profiles e where e.id=r.employee_id) end
  where r.id=p_request and (p_ids is null or s.id=any(p_ids));
$$;
create function private.approval_timer_invalid_reason(p_request uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare a public.approval_auto_requests%rowtype; d public.approval_delegations%rowtype;
  v_effective uuid; x public.approval_executive_settings%rowtype;
begin
  select * into a from public.approval_auto_requests where request_id=p_request;
  if not found then return 'missing enrollment'; end if;
  if not exists (select 1 from public.leave_requests where id=p_request and status='pending') then
    return 'request no longer pending'; end if;
  select * into d from public.approval_delegations where id=a.authority_id;
  select * into x from public.approval_executive_settings where company_id=a.company_id;
  if x.ceo_id is distinct from a.principal_id or x.version is distinct from a.settings_version then
    return 'executive configuration changed'; end if;
  select id into v_effective from private.effective_approval_delegate(a.principal_id);
  if v_effective is distinct from a.authority_id or not d.ceo_authorized then
    return 'CEO authority revoked or superseded'; end if;
  if exists (select 1 from unnest(a.step_ids) id
      where not private.natural_step_authority(a.principal_id,p_request,id))
    or (select jsonb_agg(item-'expected_name') from jsonb_array_elements(private.approval_step_snapshot(p_request,a.step_ids)) item)
      is distinct from (select jsonb_agg(item-'expected_name') from jsonb_array_elements(a.step_snapshot) item) then
    return 'CEO step authority or configuration changed'; end if;
  -- Persisted activation/revocation intervals cover A -> temporary B -> A even with no worker run.
  if exists (select 1 from public.approval_delegations other
      where other.principal_id=a.principal_id and other.id<>a.authority_id
        and other.source_request_id is not null and other.activated_at is not null
        and greatest(other.starts_at,other.activated_at)<least(other.ends_at,
          coalesce(other.revoked_at,'infinity'::timestamptz),clock_timestamp())
        and greatest(other.starts_at,other.activated_at)<clock_timestamp()
        and least(other.ends_at,coalesce(other.revoked_at,'infinity'::timestamptz))>a.submitted_at) then
    return 'CEO authority was interrupted by temporary delegation'; end if;
  if d.source_request_id is not null and
      (d.starts_at>a.submitted_at or d.ends_at<=clock_timestamp() or d.activated_at>a.submitted_at) then
    return 'temporary CEO authority ended or changed'; end if;
  return null;
end; $$;
create function private.reconcile_approval_timers(p_company uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_reason text;
begin
  for r in select request_id from public.approval_auto_requests
    where company_id=p_company and state in ('pending','blocked') loop
    v_reason:=private.approval_timer_invalid_reason(r.request_id);
    if v_reason is not null then update public.approval_auto_requests
      set state='invalidated',reason=v_reason,processed_at=clock_timestamp() where request_id=r.request_id; end if;
  end loop;
end; $$;

create function private.ceo_delegate_configuration_ready(p_ceo uuid,p_delegate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.delegate_eligible(p_ceo,p_delegate) and not exists(
    select 1 from unnest(array['leave','errand']::public.request_kind[]) kind
    where not exists(select 1 from public.approval_steps s
      join public.profiles target on target.id=p_delegate and target.company_id=s.company_id
      where s.active and kind=any(s.applies_to) and private.step_applies(s.manager_scope,p_delegate)
        and not exists(select 1 from public.approval_executive_settings x where x.company_id=s.company_id
          and x.hr_head_id=p_delegate and s.id=any(x.hr_step_ids))
        and case when s.approver_id is not null then s.approver_id=p_ceo
          when s.role='manager' and s.manager_scope='department' then private.is_department_manager_of(p_ceo,p_delegate)
          when s.role='manager' then private.is_manager_of(p_ceo,p_delegate)
          else private.has_role(p_ceo,s.role) end));
$$;
create function public.app_set_approval_delegate(p_principal_id uuid,p_delegate_id uuid default null,
  p_ceo_authorized boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_ceo uuid; v_id uuid; v_old uuid;
begin
  select p.company_id into v_company from public.profiles p join public.profiles c
    on c.company_id=p.company_id and c.id=auth.uid() where p.id=p_principal_id;
  if v_company is null or not private.is_active(auth.uid()) or
      not (auth.uid()=p_principal_id or private.is_admin(auth.uid())) then
    raise exception 'not permitted to select a delegate' using errcode='42501'; end if;
  perform private.approval_lock(v_company);
  if not private.has_perm(p_principal_id,'approval_delegate','edit')
    or not private.natural_approver(p_principal_id) then
    raise exception 'principal needs approval delegation permission and natural approval duties' using errcode='42501'; end if;
  select ceo_id into v_ceo from public.approval_executive_settings where company_id=v_company;
  if p_delegate_id is not null and not private.delegate_eligible(p_principal_id,p_delegate_id) then
    raise exception 'delegate must be an active eligible approver; CEO delegates must be direct reports' using errcode='22023'; end if;
  if coalesce(p_ceo_authorized,false) and (v_ceo is distinct from p_principal_id or p_delegate_id is null) then
    raise exception 'automatic approval authorization requires the designated CEO appointment' using errcode='22023'; end if;
  if coalesce(p_ceo_authorized,false) and not private.ceo_delegate_configuration_ready(p_principal_id,p_delegate_id) then
    raise exception 'CEO must naturally own applicable approval steps for leave and errand before automatic authority is authorized' using errcode='22023'; end if;
  select id into v_old from public.approval_delegations where principal_id=p_principal_id
    and source_request_id is null and revoked_at is null;
  update public.approval_delegations set revoked_at=clock_timestamp() where id=v_old;
  if p_delegate_id is not null then
    insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,delegate_name,
      configured_by,ceo_authorized)
    select v_company,p_principal_id,p_delegate_id,p.full_name,d.full_name,auth.uid(),coalesce(p_ceo_authorized,false)
      from public.profiles p,public.profiles d where p.id=p_principal_id and d.id=p_delegate_id returning id into v_id;
  end if;
  perform private.reconcile_approval_timers(v_company);
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (auth.uid(),'set_approval_delegate','approval_delegations',v_id,
      jsonb_build_object('principal_id',p_principal_id,'delegate_id',p_delegate_id,
        'previous_grant_id',v_old,'ceo_authorized',coalesce(p_ceo_authorized,false)));
end; $$;
create function public.app_set_executive_settings(p_ceo_id uuid,p_hr_head_id uuid,p_hr_step_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  if not private.is_admin(auth.uid()) then raise exception 'admin required' using errcode='42501'; end if;
  select company_id into v_company from public.profiles where id=auth.uid();
  perform private.approval_lock(v_company);
  if exists (select 1 from unnest(array[p_ceo_id,p_hr_head_id]) id where id is not null
      and not exists (select 1 from public.profiles p where p.id=id and p.company_id=v_company and p.active)) then
    raise exception 'executive must be active in your company' using errcode='22023'; end if;
  if exists (select 1 from unnest(coalesce(p_hr_step_ids,'{}')) id where not exists
      (select 1 from public.approval_steps s where s.id=id and s.company_id=v_company and s.active)) then
    raise exception 'HR review step must be an active company approval step' using errcode='22023'; end if;
  insert into public.approval_executive_settings(company_id,ceo_id,hr_head_id,hr_step_ids,configured_by)
    values(v_company,p_ceo_id,p_hr_head_id,coalesce(p_hr_step_ids,'{}'),auth.uid())
    on conflict(company_id) do update set ceo_id=excluded.ceo_id,hr_head_id=excluded.hr_head_id,
      hr_step_ids=excluded.hr_step_ids,configured_by=excluded.configured_by,
      configured_at=clock_timestamp(),version=public.approval_executive_settings.version+1;
  perform private.reconcile_approval_timers(v_company);
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (auth.uid(),'set_approval_executives','approval_executive_settings',v_company,
      jsonb_build_object('ceo_id',p_ceo_id,'hr_head_id',p_hr_head_id,'hr_step_ids',p_hr_step_ids));
end; $$;

create function public.app_request_delegation_preview(p_start date,p_end date,
  p_unit public.leave_unit default 'day',p_day_part public.day_part default 'full',
  p_start_time time default null,p_end_time time default null,p_replacement_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_company uuid; v_bounds jsonb; v_saved uuid; v_effective uuid;
  v_authority uuid; v_temporary boolean; v_auto boolean; v_result jsonb;
begin
  if not private.is_active(v_uid) then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.profiles where id=v_uid;
  v_bounds:=private.approval_bounds(v_company,p_start,p_end,p_unit,p_day_part,p_start_time,p_end_time);
  select id into v_saved from public.approval_delegations where principal_id=v_uid
    and source_request_id is null and revoked_at is null and private.delegate_eligible(v_uid,delegate_id);
  select id into v_effective from private.effective_approval_delegate(v_uid);
  v_temporary:=p_replacement_id is not null and private.delegate_eligible(v_uid,p_replacement_id);
  select d.id into v_authority from public.approval_executive_settings x
    cross join lateral private.effective_approval_delegate(x.ceo_id) d
    where x.company_id=v_company and d.delegate_id=v_uid and d.ceo_authorized;
  v_auto:=v_authority is not null;
  v_result:=jsonb_build_object('principal_id',v_uid,'bounds',v_bounds,'saved',private.approval_grant_json(v_saved),
    'effective',private.approval_grant_json(v_effective),
    'temporary',case when v_temporary then jsonb_build_object('delegate_id',p_replacement_id,
      'delegate_name',(select full_name from public.profiles where id=p_replacement_id),
      'starts_at',v_bounds->'starts_at','ends_at',v_bounds->'ends_at') else null end,
    'can_approve',private.natural_approver(v_uid),'can_delegate',private.has_perm(v_uid,'approval_delegate','edit'),
    'auto_approval_eligible',v_auto,'authority_id',v_authority,
    'is_ceo',exists(select 1 from public.approval_executive_settings where company_id=v_company and ceo_id=v_uid),
    'temporary_eligible',v_temporary,'temporary_delegate_name',case when v_temporary then (select full_name from public.profiles where id=p_replacement_id) end,
    'authority_ends_at',(select ends_at from public.approval_delegations where id=v_authority),
    'authority_expires_before_deadline',coalesce((select ends_at<clock_timestamp()+interval '120 minutes' from public.approval_delegations where id=v_authority),false),
    'replacement_id',p_replacement_id,'start',p_start,'end',p_end,'unit',p_unit,'day_part',p_day_part,
    'start_time',p_start_time,'end_time',p_end_time);
  return v_result||jsonb_build_object('preview_token',md5(v_result::text));
end; $$;

-- Records immutable submission evidence, after the requester PNG has been validated/stored.
create function private.enroll_request_delegation(p_request uuid,p_auto_consent boolean,p_preview jsonb,p_temporary_ceo_authorized boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests%rowtype; x public.approval_executive_settings%rowtype;
  d public.approval_delegations%rowtype; v_preview jsonb; v_bounds jsonb; v_steps uuid[];
  v_now timestamptz:=clock_timestamp(); v_temp uuid;
begin
  select * into r from public.leave_requests where id=p_request;
  perform private.approval_lock(r.company_id);
  v_preview:=public.app_request_delegation_preview(r.start_date,r.end_date,r.unit,r.day_part,
    r.start_time,r.end_time,r.replacement_id);
  if p_preview is not null and p_preview->>'preview_token' is distinct from v_preview->>'preview_token' then
    raise exception 'delegation preview changed; refresh the request preview' using errcode='22023'; end if;
  if r.day_part<>'full' and private.has_perm(r.employee_id,'approval_delegate','edit')
      and r.replacement_id is not null and private.delegate_eligible(r.employee_id,r.replacement_id)
      and p_preview is null then
    raise exception 'delegation preview required; refresh the request preview' using errcode='22023'; end if;
  v_bounds:=v_preview->'bounds';
  select * into x from public.approval_executive_settings where company_id=r.company_id;
  insert into public.approval_request_policy(request_id,company_id,starts_at,ends_at,hr_head_id,
    hr_exempt_step_ids,step_snapshot)
  values(r.id,r.company_id,(v_bounds->>'starts_at')::timestamptz,(v_bounds->>'ends_at')::timestamptz,
    x.hr_head_id,case when r.employee_id=x.hr_head_id then coalesce((select array_agg(s.id)
      from public.approval_steps s where s.company_id=r.company_id and s.active
        and s.id=any(x.hr_step_ids) and r.kind=any(s.applies_to)
        and private.step_applies(s.manager_scope,r.employee_id)),'{}') else '{}'::uuid[] end,
    private.approval_step_snapshot(r.id));
  if r.replacement_id is not null and private.delegate_eligible(r.employee_id,r.replacement_id) then
    if r.employee_id=x.ceo_id and p_temporary_ceo_authorized is not true then
      raise exception 'temporary CEO delegation authorization required' using errcode='22023'; end if;
    if r.employee_id=x.ceo_id and not private.ceo_delegate_configuration_ready(r.employee_id,r.replacement_id) then
      raise exception 'CEO must naturally own applicable approval steps for leave and errand before automatic authority is authorized' using errcode='22023'; end if;
    if exists (select 1 from public.approval_delegations g join public.leave_requests lr on lr.id=g.source_request_id
      where g.principal_id=r.employee_id and g.revoked_at is null and lr.status in ('pending','approved')
        and g.starts_at<(v_bounds->>'ends_at')::timestamptz and g.ends_at>(v_bounds->>'starts_at')::timestamptz) then
      raise exception 'overlapping temporary approval delegation' using errcode='22023'; end if;
    insert into public.approval_delegations(company_id,principal_id,delegate_id,principal_name,
      delegate_name,source_request_id,starts_at,ends_at,ceo_authorized,configured_by)
    select r.company_id,r.employee_id,r.replacement_id,p.full_name,q.full_name,r.id,
      (v_bounds->>'starts_at')::timestamptz,(v_bounds->>'ends_at')::timestamptz,
      -- Separate explicit attestation; the generic requester PNG does not authorize this policy.
      r.employee_id=x.ceo_id and p_temporary_ceo_authorized is true,r.employee_id from public.profiles p,public.profiles q
      where p.id=r.employee_id and q.id=r.replacement_id returning id into v_temp;
  end if;
  select g.* into d from private.effective_approval_delegate(x.ceo_id) g
    where g.delegate_id=r.employee_id and g.ceo_authorized;
  if d.id is not null then
    if p_auto_consent is not true or r.signature_data is null or r.signature_consent_at is null then
      raise exception 'CEO automatic approval responsibility consent required; refresh the request form' using errcode='22023'; end if;
    select array_agg(s.id order by s.step_order,s.id) into v_steps from public.approval_steps s
      where private.request_step_applies(r.id,s.id) and private.natural_step_authority(x.ceo_id,r.id,s.id);
    if cardinality(coalesce(v_steps,'{}'))=0 then
      raise exception 'CEO has no natural applicable approval step; correct executive approval configuration' using errcode='22023'; end if;
    insert into public.approval_auto_requests(request_id,company_id,authority_id,principal_id,delegate_id,
      principal_name,delegate_name,settings_version,step_ids,step_snapshot,consent_at,submitted_at,due_at)
    values(r.id,r.company_id,d.id,x.ceo_id,r.employee_id,d.principal_name,d.delegate_name,x.version,
      v_steps,private.approval_step_snapshot(r.id,v_steps),v_now,r.created_at,r.created_at+interval '120 minutes');
  elsif p_auto_consent then
    raise exception 'CEO automatic approval authority changed; refresh the request preview' using errcode='22023';
  end if;
end; $$;

create function private.finalize_approval_request(p_id uuid,p_actor uuid,p_signature text,
  p_consent_at timestamptz,p_origin text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests%rowtype; v_affects boolean; v_is_paid boolean;
  v_prev integer:=0; v_paid integer:=0; v_unpaid integer:=0;
begin
  select * into r from public.leave_requests where id=p_id;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:'||r.employee_id::text,0));
  select * into r from public.leave_requests where id=p_id for update;
  if r.status<>'pending' then return false; end if;
  if exists (select 1 from public.approval_steps s where private.request_step_applies(p_id,s.id)
    and not private.request_step_decided(p_id,s.id,'approved')) then return false; end if;
  if exists (select 1 from public.leave_requests lr where lr.employee_id=r.employee_id and lr.id<>r.id
    and lr.status='approved' and lr.start_date<=r.end_date and lr.end_date>=r.start_date
    and (lr.unit='day' or r.unit='day' or (lr.start_time<r.end_time and lr.end_time>r.start_time))) then
    raise exception 'overlapping approved leave exists' using errcode='22023'; end if;
  if r.replacement_id is not null and private.replacement_is_away(r.replacement_id,r.start_date,r.end_date,
    r.unit,r.start_time,r.end_time) then raise exception 'replacement is on leave during this period' using errcode='22023'; end if;
  select affects_balance,is_paid into v_affects,v_is_paid from public.leave_types where id=r.leave_type_id;
  if v_affects then
    v_prev:=public.current_leave_balance(r.employee_id,r.leave_type_id);
    v_paid:=least(r.requested_minutes,greatest(v_prev,0)); v_unpaid:=r.requested_minutes-v_paid;
  elsif r.leave_type_id is not null and not coalesce(v_is_paid,false) then v_unpaid:=r.requested_minutes; end if;
  update public.leave_requests set status='approved',unpaid_minutes=v_unpaid,decided_by=p_actor,
    decided_at=clock_timestamp(),approver_signature_data=p_signature,
    approver_signature_consent_at=case when p_signature is null then null else p_consent_at end
    where id=p_id and status='pending';
  if not found then return false; end if;
  if v_affects and v_paid>0 then
    insert into public.leave_ledger(employee_id,leave_type_id,request_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(r.employee_id,r.leave_type_id,p_id,'consumption',-v_paid,v_prev-v_paid,'paid portion consumed on approval');
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (p_actor,'approve_leave_request','leave_requests',p_id,jsonb_build_object('employee_id',r.employee_id,
      'requested_minutes',r.requested_minutes,'paid_minutes',v_paid,'unpaid_minutes',v_unpaid,
      'replacement_id',r.replacement_id,'origin',p_origin));
  return true;
end; $$;

create function private.decide_approval_request(p_id uuid,p_step_id uuid,p_actor uuid,
  p_decision public.leave_status,p_signature_data text,p_signature_authorized boolean,
  p_override boolean,p_per_diem_rials bigint,p_reason text,p_auto_authority uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests%rowtype; s public.approval_steps%rowtype;
  d public.approval_delegations%rowtype; a public.approval_auto_requests%rowtype;
  v_steps uuid[]; v_step uuid; v_total integer; v_admin boolean:=false; v_override boolean:=false;
  v_kind text; v_principal uuid; v_principal_name text; v_actor_name text; v_evidence jsonb;
  v_now timestamptz:=clock_timestamp(); v_filled_hr boolean:=false; v_note text:=nullif(btrim(p_reason),'');
begin
  select * into r from public.leave_requests where id=p_id;
  if r.id is null then raise exception 'request not found' using errcode='P0002'; end if;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:'||r.employee_id::text,0));
  select * into r from public.leave_requests where id=p_id for update;
  if r.status<>'pending' then raise exception 'only pending requests can be decided' using errcode='22023'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
  if length(v_note)>500 then raise exception 'rejection note is too long (max 500 characters)' using errcode='22023'; end if;
  if p_auto_authority is null then
    if not private.is_active(p_actor) or not exists (select 1 from public.profiles where id=p_actor and company_id=r.company_id) then
      raise exception 'not allowed to decide this request' using errcode='42501'; end if;
    v_admin:=private.is_admin(p_actor);
    select full_name into v_actor_name from public.profiles where id=p_actor;
    if p_decision='approved' then perform private.separation_check_signature(p_signature_data,p_signature_authorized); end if;
  else
    select * into a from public.approval_auto_requests where request_id=p_id;
    if p_actor is not null or p_decision<>'approved' or a.authority_id is distinct from p_auto_authority
      or a.state not in ('pending','blocked') or a.due_at>v_now
      or private.approval_timer_invalid_reason(p_id) is not null
      or not (p_step_id=any(a.step_ids)) then
      raise exception 'automatic CEO authority is no longer valid' using errcode='42501'; end if;
    if p_signature_data is not null or p_per_diem_rials is not null then
      raise exception 'automatic decisions cannot carry human signatures or per diem' using errcode='22023'; end if;
  end if;
  if p_per_diem_rials<0 then raise exception 'per diem must be 0 or more' using errcode='22023'; end if;
  select count(*) into v_total from public.approval_steps st where private.request_step_applies(p_id,st.id);
  if p_auto_authority is not null then v_steps:=array[p_step_id];
  elsif v_total=0 and not exists (select 1 from public.approval_steps st
    where st.company_id=r.company_id and st.active and r.kind=any(st.applies_to)
      and private.step_applies(st.manager_scope,r.employee_id)) then
    -- Legacy no-chain fallback; delegation remains approval-only and cannot sign own requests.
    if not (v_admin or private.is_manager_of(p_actor,r.employee_id)) then
      select g.* into d from public.profiles emp
        cross join lateral private.effective_approval_delegate(emp.manager_id) g
        where emp.id=r.employee_id and g.delegate_id=p_actor and r.employee_id<>p_actor
          and g.source_request_id is distinct from p_id and private.is_manager_of(g.principal_id,r.employee_id);
      if d.id is null then raise exception 'not allowed to decide this request' using errcode='42501'; end if;
    end if;
    v_steps:=array[null::uuid];
  else
    if p_step_id is not null then
      if not private.request_step_applies(p_id,p_step_id) then
        raise exception 'approval step is no longer applicable' using errcode='22023'; end if;
      if not private.can_approve_step(p_actor,p_id,p_step_id) and not v_admin then
        raise exception 'not allowed to decide this request' using errcode='42501'; end if;
      v_step:=p_step_id;
    else
      select st.id into v_step from public.approval_steps st
      where private.can_approve_step(p_actor,p_id,st.id) and not private.request_step_decided(p_id,st.id)
        order by st.step_order,st.id limit 1;
    end if;
    v_override:=v_admin and (coalesce(p_override,false) or v_step is null
      or not private.can_approve_step(p_actor,p_id,v_step));
    if v_override then
      select array_agg(st.id order by st.step_order,st.id) into v_steps from public.approval_steps st
        where private.request_step_applies(p_id,st.id) and not private.request_step_decided(p_id,st.id);
    elsif v_step is not null then v_steps:=array[v_step];
    else raise exception 'not allowed to decide this request' using errcode='42501'; end if;
  end if;
  if cardinality(coalesce(v_steps,'{}'))=0 then raise exception 'you have already signed this request' using errcode='22023'; end if;
  foreach v_step in array v_steps loop
    s:=null;
    if v_step is not null then select * into s from public.approval_steps where id=v_step;
      if private.request_step_decided(p_id,s.id) then
        raise exception 'you have already signed this request' using errcode='22023'; end if;
      if p_auto_authority is null and not v_override and p_decision='approved'
        and exists (select 1 from public.work_settings w where w.company_id=r.company_id and w.approval_order_enforced)
        and exists (select 1 from public.approval_steps prev where private.request_step_applies(p_id,prev.id)
          and prev.step_order<s.step_order and not private.request_step_decided(p_id,prev.id,'approved')) then
        raise exception 'an earlier approval is still required' using errcode='22023'; end if;
    end if;
    v_evidence:='{}';
    if p_auto_authority is not null then
      v_kind:='automatic'; v_principal:=a.principal_id; v_principal_name:=a.principal_name;
      v_evidence:=jsonb_build_object('authority_id',a.authority_id,'principal_name',a.principal_name,
        'delegate_id',a.delegate_id,'delegate_name',a.delegate_name,'consent_at',a.consent_at,
        'submitted_at',a.submitted_at,'due_at',a.due_at,'processed_at',v_now,'statement',
        'Automatically approved under delegated CEO authority. The CEO review period elapsed without a CEO decision. The appointed delegate accepted responsibility under the recorded authorization.');
    else
      if v_step is not null then
        d:=null;
        if not v_override and not private.natural_step_authority(p_actor,p_id,v_step) then
          select g.* into d from private.step_delegation(p_actor,p_id,v_step) g;
        end if;
      end if;
      if d.id is not null then v_kind:='delegated';v_principal:=d.principal_id;v_principal_name:=d.principal_name;
      else v_kind:='manual';v_principal:=p_actor;v_principal_name:=v_actor_name; end if;
      v_evidence:=jsonb_build_object('admin_override',v_override,'actor_id',p_actor,
        'principal_id',v_principal,'principal_name',v_principal_name,'signer_name',v_actor_name);
    end if;
    v_filled_hr:=v_filled_hr or coalesce(s.role='hr',false);
    insert into public.leave_request_approvals(request_id,step_id,step_role,approver_id,decision,
      signature_data,signature_consent_at,note,evidence_kind,principal_id,principal_name,signer_name_snapshot,authority_id,evidence)
    values(p_id,v_step,coalesce(s.role,'manager'),p_actor,p_decision,
      case when p_decision='approved' then p_signature_data end,
      case when p_decision='approved' and p_signature_data is not null then v_now end,
      v_note,v_kind,v_principal,v_principal_name,v_actor_name,
      case when p_auto_authority is not null then p_auto_authority else d.id end,
      v_evidence||jsonb_build_object('step_id',v_step,'step_role',coalesce(s.role,'manager'),
        'step_order',coalesce(s.step_order,1),'manager_scope',coalesce(s.manager_scope,'direct'),
        'named',s.approver_id is not null,'approver_id',s.approver_id,
        'expected_name',case when s.approver_id is not null then
          (select full_name from public.profiles where id=s.approver_id) else v_principal_name end));
    if p_decision='rejected' then exit; end if;
  end loop;
  if p_decision='rejected' then
    update public.leave_requests set status='rejected',decided_by=p_actor,decided_at=v_now,decision_note=v_note where id=p_id and status='pending';
  else
    if p_per_diem_rials is not null then
      if r.kind<>'errand' or not v_filled_hr then
        raise exception 'per diem can only be set on the hr step of an errand' using errcode='22023'; end if;
      update public.leave_requests set per_diem_rials=p_per_diem_rials where id=p_id;
    end if;
    perform private.finalize_approval_request(p_id,p_actor,p_signature_data,v_now,
      case when p_auto_authority is not null then 'automatic' else v_kind end);
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (p_actor,case when p_decision='approved' then 'approve_leave_step' else 'reject_leave_request' end,
     'leave_requests',p_id,jsonb_build_object('step_ids',v_steps,'evidence_kind',v_kind,'admin_override',v_override,
       'authority_id',p_auto_authority,'per_diem_rials',p_per_diem_rials));
end; $$;
create function public.approve_leave_request_v2(p_id uuid,p_step_id uuid,p_signature_data text,
  p_signature_authorized boolean,p_override boolean default false,p_per_diem_rials bigint default null)
returns void language sql security definer set search_path = '' as $$
  select private.decide_approval_request(p_id,p_step_id,auth.uid(),'approved',p_signature_data,
    p_signature_authorized,p_override,p_per_diem_rials,null);
$$;
create or replace function public.approve_leave_request(p_id uuid,p_signature_data text,
  p_signature_authorized boolean,p_override boolean default false,p_per_diem_rials bigint default null)
returns void language sql security definer set search_path = '' as $$
  select public.approve_leave_request_v2(p_id,null,p_signature_data,p_signature_authorized,p_override,p_per_diem_rials);
$$;
create function public.reject_leave_request_v2(p_id uuid,p_step_id uuid,p_reason text default null)
returns void language sql security definer set search_path = '' as $$
  select private.decide_approval_request(p_id,p_step_id,auth.uid(),'rejected',null,false,false,null,p_reason);
$$;
create or replace function public.reject_leave_request(p_id uuid,p_reason text default null)
returns void language sql security definer set search_path = '' as $$
  select public.reject_leave_request_v2(p_id,null,p_reason);
$$;

-- Retained legacy validation and cancellation reversal logic.
CREATE OR REPLACE FUNCTION private.submit_leave_impl(p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text, p_unit public.leave_unit, p_start_time time without time zone, p_end_time time without time zone, p_replacement_id uuid, p_kind public.request_kind, p_location text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_dept uuid;
  v_minutes int;
  v_affects boolean;
  v_is_paid boolean;
  v_allow_hourly boolean;
  v_balance int;
  v_unpaid int := 0;
  v_req uuid;
  v_win_start time;
  v_win_end time;
  v_cap int;
  v_day_used int;
  v_jyear int;
  v_seq int;
  v_location text := nullif(btrim(p_location), '');
  v_replacement uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id, department_id into v_company, v_dept
    from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;
  perform private.approval_lock(v_company);

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'end date must not be before start date' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  if p_kind = 'errand' then
    if v_location is null then
      raise exception 'errand location is required' using errcode = '22023';
    end if;
    if length(v_location) > 200 then
      raise exception 'errand location is too long' using errcode = '22023';
    end if;
    if p_unit = 'hour' then
      if p_start <> p_end
         or p_start_time is null
         or p_end_time is null
         or p_end_time <= p_start_time
      then
        raise exception 'end time must be after start time' using errcode = '22023';
      end if;
    elsif p_unit = 'day' then
      if p_start_time is not null or p_end_time is not null or p_day_part <> 'full' then
        raise exception 'daily errands require full dates without times' using errcode = '22023';
      end if;
    end if;
    v_replacement := null;
  else
    if p_leave_type_id is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
    v_location := null;
    v_replacement := p_replacement_id;
  end if;

  if p_kind = 'leave' then
    select affects_balance, is_paid, allow_hourly
      into v_affects, v_is_paid, v_allow_hourly
      from public.leave_types
     where id = p_leave_type_id and company_id = v_company and active;
    if v_affects is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
  end if;

  if p_kind = 'leave' and p_unit = 'hour' then
    if not coalesce(v_allow_hourly, false) then
      raise exception 'this leave type cannot be taken hourly' using errcode = '22023';
    end if;
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'end time must be after start time' using errcode = '22023';
    end if;

    select work_start, work_end, max_hourly_minutes_per_day
      into v_win_start, v_win_end, v_cap
      from public.work_settings where company_id = v_company limit 1;
    v_win_start := coalesce(v_win_start, '07:00'::time);
    v_win_end := coalesce(v_win_end, '15:00'::time);
    v_cap := coalesce(v_cap, 240);

    if p_start_time < v_win_start or p_end_time > v_win_end then
      raise exception 'times must fall within working hours' using errcode = '22023';
    end if;
    if (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  if v_replacement is not null then
    if not exists (
      select 1 from public.profiles p
       where p.id = v_replacement
         and p.active
         and p.company_id = v_company
         and ((v_dept is not null and p.department_id = v_dept)
              or private.delegate_eligible(v_uid,p.id))
         and p.id <> v_uid
    ) then
      raise exception 'replacement must be an active colleague in your department'
        using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  if p_kind = 'leave' and p_unit = 'hour' then
    -- FR-57: one hourly leave per person per day. Rejected and cancelled
    -- requests free the day again.
    if exists (
      select 1 from public.leave_requests r
       where r.employee_id = v_uid
         and r.kind = 'leave'
         and r.unit = 'hour'
         and r.start_date = p_start
         and r.status in ('pending', 'approved')
    ) then
      raise exception 'only one hourly leave per day' using errcode = '22023';
    end if;

    select coalesce(sum(r.requested_minutes), 0) into v_day_used
      from public.leave_requests r
     where r.employee_id = v_uid
       and r.kind = 'leave'
       and r.unit = 'hour'
       and r.start_date = p_start
       and r.status in ('pending', 'approved');

    if v_day_used + (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.leave_requests r
     where r.employee_id = v_uid
       and r.status in ('pending', 'approved')
       and r.start_date <= p_end
       and r.end_date >= p_start
       and (
         r.unit = 'day' or p_unit = 'day'
         or (r.start_time < p_end_time and r.end_time > p_start_time)
       )
  ) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  if v_replacement is not null
     and private.replacement_is_away(
       v_replacement, p_start, p_end, p_unit, p_start_time, p_end_time
     )
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(
    v_company, p_start, p_end, p_day_part, p_unit, p_start_time, p_end_time, p_kind
  );
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)'
      using errcode = '22023';
  end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    v_unpaid := greatest(v_minutes - greatest(v_balance, 0), 0);
  elsif p_kind = 'leave' and not coalesce(v_is_paid, false) then
    v_unpaid := v_minutes;
  end if;

  select jm.jalali_year into v_jyear
    from public.jalali_months jm
   where p_start between jm.gregorian_start and jm.gregorian_end;
  if v_jyear is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  insert into public.leave_request_serials(company_id, jalali_year, kind, last_seq)
  values (v_company, v_jyear, p_kind, 1)
  on conflict (company_id, jalali_year, kind) do update
     set last_seq = public.leave_request_serials.last_seq + 1
  returning last_seq into v_seq;

  insert into public.leave_requests(
    employee_id, leave_type_id, start_date, end_date, day_part,
    unit, start_time, end_time, requested_minutes, unpaid_minutes, status, reason,
    replacement_id, company_id, serial_year, serial_seq, kind, errand_location
  )
  values (
    v_uid, p_leave_type_id, p_start, p_end, p_day_part,
    p_unit, p_start_time, p_end_time, v_minutes, v_unpaid, 'pending', p_reason,
    v_replacement, v_company, v_jyear, v_seq, p_kind, v_location
  )
  returning id into v_req;

  return v_req;
end;
$$;
CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status public.leave_status;
  v_start date;
  v_type uuid;
  v_kind public.request_kind;
  v_minutes int;
  v_unpaid int;
  v_paid int;
  v_affects boolean;
  v_prev int;
  v_rows int;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (v_owner = v_uid
          or private.is_admin(v_uid)
          -- FR-55 D8: leave_requests at Allowed covers the company, apart from the admin.
          or (private.has_perm(v_uid, 'leave_requests', 'edit')
              and exists (select 1 from public.profiles o
                            join public.profiles c on c.company_id = o.company_id and c.id = v_uid
                           where o.id = v_owner)
              and not exists (select 1 from public.user_roles where user_id = v_owner and role = 'admin'))) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform private.approval_lock((select company_id from public.leave_requests where id=p_id));
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes, unpaid_minutes, kind
    into v_status, v_start, v_type, v_minutes, v_unpaid, v_kind
    from public.leave_requests where id = p_id;
  v_paid := greatest(v_minutes - coalesce(v_unpaid, 0), 0);

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;
  elsif v_status = 'approved'
        and (v_start > v_today or (v_kind = 'errand' and v_start >= v_today))
  then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects and v_paid > 0 then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      ) values (
        v_owner, v_type, p_id, 'reversal',
        v_paid, v_prev + v_paid, 'paid portion reversed on cancel'
      );
    end if;
  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled'
      using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'cancel_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'status_before', v_status,
      'requested_minutes', v_minutes,
      'paid_minutes_reversed', case when v_status = 'approved' then v_paid else 0 end,
      'unpaid_minutes', v_unpaid,
      'kind', v_kind,
      'reversed', (
        v_status = 'approved' and coalesce(v_affects, false) and v_paid > 0
      )
    )
  );
end;
$$;
CREATE FUNCTION public.submit_leave_request_v2(p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_signature_data text, p_signature_authorized boolean, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid, p_auto_approval_consent boolean DEFAULT false, p_delegation_preview jsonb DEFAULT null, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    p_leave_type_id, p_start, p_end, p_day_part, p_reason,
    'day', null, null, p_replacement_id, 'leave', null
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  perform private.enroll_request_delegation(v_request_id,p_auto_approval_consent,p_delegation_preview,p_temporary_ceo_authorized);
  -- A configured chain made entirely exempt for the HR head needs no fabricated human decision.
  if exists (select 1 from public.approval_request_policy x where x.request_id=v_request_id
      and cardinality(x.hr_exempt_step_ids)>0)
     and not exists (select 1 from public.approval_steps st where private.request_step_applies(v_request_id,st.id)) then
    perform private.finalize_approval_request(v_request_id,null,null,null,'hr_exempt');
  end if;
  return v_request_id;
end;
$$;
CREATE OR REPLACE FUNCTION public.submit_leave_request(p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_signature_data text, p_signature_authorized boolean, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  select public.submit_leave_request_v2(p_leave_type_id,p_start,p_end,p_day_part,p_signature_data,p_signature_authorized,p_reason,p_replacement_id,false,null,false);
$$;
CREATE FUNCTION public.submit_hourly_leave_request_v2(p_leave_type_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_signature_data text, p_signature_authorized boolean, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid, p_auto_approval_consent boolean DEFAULT false, p_delegation_preview jsonb DEFAULT null, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    p_leave_type_id, p_date, p_date, 'full', p_reason,
    'hour', p_start_time, p_end_time, p_replacement_id, 'leave', null
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  perform private.enroll_request_delegation(v_request_id,p_auto_approval_consent,p_delegation_preview,p_temporary_ceo_authorized);
  -- A configured chain made entirely exempt for the HR head needs no fabricated human decision.
  if exists (select 1 from public.approval_request_policy x where x.request_id=v_request_id
      and cardinality(x.hr_exempt_step_ids)>0)
     and not exists (select 1 from public.approval_steps st where private.request_step_applies(v_request_id,st.id)) then
    perform private.finalize_approval_request(v_request_id,null,null,null,'hr_exempt');
  end if;
  return v_request_id;
end;
$$;
CREATE OR REPLACE FUNCTION public.submit_hourly_leave_request(p_leave_type_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_signature_data text, p_signature_authorized boolean, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  select public.submit_hourly_leave_request_v2(p_leave_type_id,p_date,p_start_time,p_end_time,p_signature_data,p_signature_authorized,p_reason,p_replacement_id,false,null,false);
$$;
CREATE FUNCTION public.submit_errand_request_v2(p_date date, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_signature_data text, p_signature_authorized boolean, p_description text DEFAULT NULL::text, p_auto_approval_consent boolean DEFAULT false, p_delegation_preview jsonb DEFAULT null, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    null::uuid, p_date, p_date, 'full', p_description,
    'hour', p_start_time, p_end_time, null::uuid, 'errand', p_location
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  perform private.enroll_request_delegation(v_request_id,p_auto_approval_consent,p_delegation_preview,p_temporary_ceo_authorized);
  -- A configured chain made entirely exempt for the HR head needs no fabricated human decision.
  if exists (select 1 from public.approval_request_policy x where x.request_id=v_request_id
      and cardinality(x.hr_exempt_step_ids)>0)
     and not exists (select 1 from public.approval_steps st where private.request_step_applies(v_request_id,st.id)) then
    perform private.finalize_approval_request(v_request_id,null,null,null,'hr_exempt');
  end if;
  return v_request_id;
end;
$$;
CREATE OR REPLACE FUNCTION public.submit_errand_request(p_date date, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_signature_data text, p_signature_authorized boolean, p_description text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  select public.submit_errand_request_v2(p_date,p_start_time,p_end_time,p_location,p_signature_data,p_signature_authorized,p_description,false,null,false);
$$;
CREATE FUNCTION public.submit_daily_errand_request_v2(p_start date, p_end date, p_location text, p_signature_data text, p_signature_authorized boolean, p_description text DEFAULT NULL::text, p_auto_approval_consent boolean DEFAULT false, p_delegation_preview jsonb DEFAULT null, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    null::uuid, p_start, p_end, 'full', p_description,
    'day', null::time, null::time, null::uuid, 'errand', p_location
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  perform private.enroll_request_delegation(v_request_id,p_auto_approval_consent,p_delegation_preview,p_temporary_ceo_authorized);
  -- A configured chain made entirely exempt for the HR head needs no fabricated human decision.
  if exists (select 1 from public.approval_request_policy x where x.request_id=v_request_id
      and cardinality(x.hr_exempt_step_ids)>0)
     and not exists (select 1 from public.approval_steps st where private.request_step_applies(v_request_id,st.id)) then
    perform private.finalize_approval_request(v_request_id,null,null,null,'hr_exempt');
  end if;
  return v_request_id;
end;
$$;
CREATE OR REPLACE FUNCTION public.submit_daily_errand_request(p_start date, p_end date, p_location text, p_signature_data text, p_signature_authorized boolean, p_description text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  select public.submit_daily_errand_request_v2(p_start,p_end,p_location,p_signature_data,p_signature_authorized,p_description,false,null,false);
$$;
CREATE OR REPLACE FUNCTION public.get_replacement_candidates(p_start date, p_end date, p_unit public.leave_unit DEFAULT 'day'::public.leave_unit, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone) RETURNS TABLE(profile_id uuid, full_name text, employee_code text, unavailable boolean, unavailable_reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with me as (
    select id, company_id, department_id
      from public.profiles
     where id = auth.uid()
       and active
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
   and ((me.department_id is not null and p.department_id = me.department_id)
        or private.delegate_eligible(me.id,p.id))
  order by p.full_name;
$$;


create function public.app_request_approval_progress(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.leave_requests%rowtype; v_result jsonb:='[]'; v_item jsonb;
  v_policy public.approval_request_policy%rowtype; v_done record; s record; v_snapshot jsonb;
  d public.approval_delegations%rowtype; v_natural boolean; v_allowed boolean; v_can_approve boolean; v_expected text;
begin
  if not private.can_read_approval_request(auth.uid(),p_id) then
    raise exception 'request not found' using errcode='P0002'; end if;
  select * into r from public.leave_requests where id=p_id;
  select * into v_policy from public.approval_request_policy where request_id=p_id;
  for v_done in select a.*,st.step_order,st.manager_scope,st.approver_id as expected_id,
      sp.full_name as live_signer,np.full_name as live_expected
    from public.leave_request_approvals a left join public.approval_steps st on st.id=a.step_id
      left join public.profiles sp on sp.id=a.approver_id left join public.profiles np on np.id=st.approver_id
    where a.request_id=p_id order by coalesce((a.evidence->>'step_order')::integer,st.step_order,1),a.created_at,a.id loop
    v_snapshot:=null;
    select item into v_snapshot from jsonb_array_elements(coalesce(v_policy.step_snapshot,'[]')) item
      where item->>'step_id'=v_done.step_id::text;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'step_id',v_done.step_id,'step_role',v_done.step_role,
      'step_order',coalesce((v_done.evidence->>'step_order')::integer,(v_snapshot->>'step_order')::integer,v_done.step_order,1),
      'manager_scope',coalesce(v_done.evidence->>'manager_scope',v_snapshot->>'manager_scope',v_done.manager_scope,'direct'),
      'named',coalesce((v_done.evidence->>'named')::boolean,case when v_snapshot is not null
        then (v_snapshot->>'approver_id') is not null else v_done.expected_id is not null end),
      'expected_name',coalesce(v_done.evidence->>'expected_name',v_snapshot->>'expected_name',v_done.live_expected,v_done.principal_name),
      'signer_name',case when v_done.evidence_kind='automatic' then null else coalesce(v_done.signer_name_snapshot,v_done.live_signer) end,
      'signed_at',v_done.created_at,'principal_name',v_done.principal_name,'principal_id',v_done.principal_id,
      'grant_id',v_done.authority_id,'authority_id',v_done.authority_id,'authority_ref',v_done.authority_id,
      'evidence_kind',v_done.evidence_kind,'decision',v_done.decision,
      'is_delegated',v_done.evidence_kind='delegated','can_approve',false,'can_reject',false,
      'per_diem_allowed',false,'statement',v_done.evidence->>'statement','evidence',v_done.evidence));
  end loop;
  for s in select st.* from public.approval_steps st
    where r.status='pending' and st.company_id=r.company_id and st.active and r.kind=any(st.applies_to)
      and private.step_applies(st.manager_scope,r.employee_id)
      and not private.request_step_decided(p_id,st.id)
    order by st.step_order,st.id loop
    v_snapshot:=null;
    select item into v_snapshot from jsonb_array_elements(coalesce(v_policy.step_snapshot,'[]')) item
      where item->>'step_id'=s.id::text;
    v_expected:=null;
    if s.approver_id is not null then select full_name into v_expected from public.profiles where id=s.approver_id;
    elsif s.role='manager' then select full_name into v_expected from public.profiles where id=
      case when s.manager_scope='department' then private.department_manager_for(r.employee_id)
      else (select manager_id from public.profiles where id=r.employee_id) end; end if;
    if private.request_hr_exempt(p_id,s.id) then
      v_expected:=v_snapshot->>'expected_name';
      v_item:=jsonb_build_object('evidence_kind','hr_exempt','can_approve',false,'can_reject',false,
        'is_delegated',false,'per_diem_allowed',false,'statement','Not required — request submitted by the Head of HR');
    else
      v_natural:=private.natural_step_authority(auth.uid(),p_id,s.id);
      d:=null;
      if not v_natural then select g.* into d from private.step_delegation(auth.uid(),p_id,s.id) g; end if;
      v_allowed:=r.status='pending' and (v_natural or d.id is not null);
      v_can_approve:=v_allowed and not (exists(select 1 from public.work_settings w
        where w.company_id=r.company_id and w.approval_order_enforced)
        and exists(select 1 from public.approval_steps earlier where private.request_step_applies(p_id,earlier.id)
          and earlier.step_order<s.step_order and not private.request_step_decided(p_id,earlier.id,'approved')));
      v_item:=jsonb_build_object('evidence_kind','pending','can_approve',v_can_approve,
        'can_reject',r.status='pending' and (v_allowed or private.is_admin(auth.uid())),
        'is_delegated',d.id is not null,'principal_id',d.principal_id,
        'principal_name',d.principal_name,'grant_id',d.id,'authority_id',d.id,
        'per_diem_allowed',v_can_approve and s.role='hr' and r.kind='errand');
    end if;
    v_result:=v_result||jsonb_build_array(v_item||jsonb_build_object('step_id',s.id,
      'step_role',s.role,'step_order',s.step_order,'manager_scope',s.manager_scope,
      'named',s.approver_id is not null,'expected_name',v_expected,'signer_name',null,
      'signed_at',null,'decision',null,
      'configuration_changed',coalesce(v_policy.configuration_changed,false),
      'historical_hr_exemption',case when s.id=any(coalesce(v_policy.hr_exempt_step_ids,'{}'))
        and not private.request_hr_exempt(p_id,s.id) then v_snapshot end));
  end loop;
  -- Preserve the exemption if the administrator later removes its configured step.
  for v_snapshot in select item from jsonb_array_elements(coalesce(v_policy.step_snapshot,'[]')) item
    where (item->>'step_id')::uuid=any(coalesce(v_policy.hr_exempt_step_ids,'{}'))
      and not exists(select 1 from jsonb_array_elements(v_result) shown where shown->>'step_id'=item->>'step_id') loop
    v_result:=v_result||jsonb_build_array(v_snapshot||jsonb_build_object('evidence_kind','hr_exempt',
      'named',(v_snapshot->>'approver_id') is not null,'principal_id',v_policy.hr_head_id,
      'can_approve',false,'can_reject',false,'is_delegated',false,'per_diem_allowed',false,
      'signer_name',null,'signed_at',null,'decision',null,
      'statement','Not required — request submitted by the Head of HR'));
  end loop;
  if jsonb_array_length(v_result)=0 and r.status='pending' then
    v_allowed:=private.approval_fallback_allowed(auth.uid(),p_id);
    v_result:=jsonb_build_array(jsonb_build_object('step_id',null,'step_role','manager','step_order',1,
      'manager_scope','direct','named',false,
      'expected_name',(select p.full_name from public.profiles emp join public.profiles p on p.id=emp.manager_id where emp.id=r.employee_id),
      'evidence_kind','pending','decision',null,'signer_name',null,'signed_at',null,
      'can_approve',v_allowed,'can_reject',v_allowed,'per_diem_allowed',false,
      'is_delegated',v_allowed and not private.is_manager_of(auth.uid(),r.employee_id) and not private.is_admin(auth.uid())));
  end if;
  return (select coalesce(jsonb_agg(item order by coalesce((item->>'step_order')::integer,1),item->>'step_id'),'[]')
    from jsonb_array_elements(v_result) item);
end; $$;

create function public.app_request_approval_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.leave_requests%rowtype; v_progress jsonb; v_result jsonb;
begin
  if not private.can_read_approval_request(auth.uid(),p_id) then
    raise exception 'request not found' using errcode='P0002'; end if;
  select * into r from public.leave_requests where id=p_id;
  v_progress:=public.app_request_approval_progress(p_id);
  select (to_jsonb(r)-'signature_data'-'approver_signature_data')||jsonb_build_object(
    'employee_name',p.full_name,'employee_code',p.employee_code,
    'personnel_no',case when p.id=auth.uid() or private.reads_people(auth.uid()) or private.is_manager_of(auth.uid(),p.id) then p.personnel_no end,
    'job_title',case when p.id=auth.uid() or private.reads_people(auth.uid()) or private.is_manager_of(auth.uid(),p.id) then p.job_title end,
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
    'automatic_approval',case when ar.request_id is not null then jsonb_build_object(
      'state',ar.state,'reason',ar.reason,'authority_id',ar.authority_id,'due_at',ar.due_at,
      'consent_at',ar.consent_at,'submitted_at',ar.submitted_at,'processed_at',ar.processed_at,
      'step_ids',ar.step_ids,'delegate_name',ar.delegate_name,'principal_name',ar.principal_name) end,
    'progress',v_progress)
  into v_result from public.profiles p left join public.departments dep on dep.id=p.department_id
    left join public.leave_types lt on lt.id=r.leave_type_id
    left join public.profiles rp on rp.id=r.replacement_id left join public.profiles dp on dp.id=r.decided_by
    left join public.approval_request_policy pol on pol.request_id=r.id
    left join public.approval_auto_requests ar on ar.request_id=r.id where p.id=r.employee_id;
  return v_result;
end; $$;
create function public.app_approval_queue(p_status public.leave_status default 'pending') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.app_request_approval_context(r.id) order by r.created_at),'[]')
    from public.leave_requests r where r.status=p_status and private.can_read_approval_request(auth.uid(),r.id)
      and (r.employee_id<>auth.uid() or private.is_admin(auth.uid()));
$$;
create function public.get_leave_request_signatures(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_progress jsonb;
begin
  if not private.can_read_approval_request(auth.uid(),p_id) then
    raise exception 'request not found' using errcode='P0002'; end if;
  v_progress:=public.app_request_approval_progress(p_id);
  select jsonb_build_object('requester_signature_data',r.signature_data,
    'requester_consent_at',r.signature_consent_at,'approver_signature_data',r.approver_signature_data,
    'approver_signature_consent_at',r.approver_signature_consent_at,
    'approvals',coalesce((select jsonb_agg(item||jsonb_build_object('signature_data',a.signature_data,
      'signature_consent_at',a.signature_consent_at) order by (item->>'step_order')::integer)
      from jsonb_array_elements(v_progress) item left join public.leave_request_approvals a
        on a.request_id=r.id and (a.step_id=(item->>'step_id')::uuid
          or (a.step_id is null and item->>'step_id' is null and a.step_role::text=item->>'step_role'))),'[]'))
    into v_result from public.leave_requests r where r.id=p_id;
  return v_result;
end; $$;
create or replace function public.request_approval_progress(p_id uuid)
returns table(step_order integer,step_role public.app_role,manager_scope text,named boolean,
  expected_name text,decision public.leave_status,signer_name text,signed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (item->>'step_order')::integer,(item->>'step_role')::public.app_role,
    item->>'manager_scope',coalesce((item->>'named')::boolean,false),item->>'expected_name',
    (item->>'decision')::public.leave_status,item->>'signer_name',(item->>'signed_at')::timestamptz
  from jsonb_array_elements(public.app_request_approval_progress(p_id)) item;
$$;

-- All eligibility changes serialize against decisions before the row is changed.
create function private.approval_mutation_company(p_table text,p_row jsonb) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid;
begin
  if p_row ? 'company_id' then return (p_row->>'company_id')::uuid; end if;
  if p_table='user_roles' then
    select company_id into v_company from public.profiles where id=(p_row->>'user_id')::uuid;
  elsif p_table='role_permissions' then
    select company_id into v_company from public.roles where id=(p_row->>'role_id')::uuid;
  end if;
  return v_company;
end; $$;
create function private.approval_before_authority_mutation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_old_company uuid; v_new_company uuid;
begin
  if tg_table_name='profiles' then
    if tg_op='UPDATE' then
      if new.active is not distinct from old.active and new.manager_id is not distinct from old.manager_id
        and new.department_id is not distinct from old.department_id and new.company_id is not distinct from old.company_id then
        return new;
      end if;
    end if;
  end if;
  if tg_op<>'INSERT' then v_old_company:=private.approval_mutation_company(tg_table_name,to_jsonb(old)); end if;
  if tg_op<>'DELETE' then v_new_company:=private.approval_mutation_company(tg_table_name,to_jsonb(new)); end if;
  for v_company in select distinct company from unnest(array[v_old_company,v_new_company]) company
    where company is not null order by company loop
    perform private.approval_lock(v_company);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create function private.approval_after_authority_mutation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_old_company uuid; v_new_company uuid;
begin
  if tg_table_name='profiles' then
    if tg_op='UPDATE' then
      if new.active is not distinct from old.active and new.manager_id is not distinct from old.manager_id
        and new.department_id is not distinct from old.department_id and new.company_id is not distinct from old.company_id then
        return new;
      end if;
    end if;
  end if;
  if tg_op<>'INSERT' then v_old_company:=private.approval_mutation_company(tg_table_name,to_jsonb(old)); end if;
  if tg_op<>'DELETE' then v_new_company:=private.approval_mutation_company(tg_table_name,to_jsonb(new)); end if;
  for v_company in select distinct company from unnest(array[v_old_company,v_new_company]) company
    where company is not null order by company loop
    if tg_table_name='approval_steps' then
      update public.approval_request_policy x set configuration_changed=true
        where x.company_id=v_company and exists(select 1 from public.leave_requests r where r.id=x.request_id and r.status='pending');
      -- Any chain edit terminates pending automatic entitlements; editing back cannot revive them.
      update public.approval_auto_requests set state='invalidated',reason='approval chain configuration changed',
        processed_at=clock_timestamp() where company_id=v_company and state in ('pending','blocked');
    end if;
    perform private.reconcile_approval_timers(v_company);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create function private.approval_source_lifecycle() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g public.approval_delegations%rowtype;
begin
  if tg_op='UPDATE' and new.status is distinct from old.status then
    select * into g from public.approval_delegations where source_request_id=new.id and revoked_at is null;
    if g.id is not null then
      if new.status='approved' then
        if exists(select 1 from public.approval_delegations other join public.leave_requests r on r.id=other.source_request_id
          where other.principal_id=g.principal_id and other.id<>g.id and other.revoked_at is null
            and r.status='approved' and other.starts_at<g.ends_at and other.ends_at>g.starts_at) then
          raise exception 'overlapping temporary approval delegation' using errcode='22023'; end if;
        update public.approval_delegations set activated_at=coalesce(activated_at,clock_timestamp()) where id=g.id;
      elsif new.status in ('cancelled','rejected') then
        update public.approval_delegations set revoked_at=clock_timestamp() where id=g.id;
      end if;
    end if;
    -- The request's own automatic policy also stops permanently on rejection/cancellation.
    if new.status in ('cancelled','rejected') then
      update public.approval_auto_requests set state='invalidated',reason='request '||new.status::text,
        processed_at=clock_timestamp() where request_id=new.id and state in ('pending','blocked');
    end if;
    perform private.reconcile_approval_timers(new.company_id);
  end if;
  return new;
end; $$;

do $$
declare v_table text;
begin
  foreach v_table in array array['profiles','departments','roles','role_permissions','user_roles',
    'approval_steps','approval_executive_settings','approval_delegations'] loop
    execute format('create trigger approval_authority_lock before insert or update or delete on public.%I for each row execute function private.approval_before_authority_mutation()',v_table);
    execute format('create trigger approval_authority_reconcile after insert or update or delete on public.%I for each row execute function private.approval_after_authority_mutation()',v_table);
  end loop;
end; $$;
create trigger approval_request_authority_lock before insert or update or delete on public.leave_requests
  for each row execute function private.approval_before_authority_mutation();
create trigger approval_request_source_lifecycle after update on public.leave_requests
  for each row execute function private.approval_source_lifecycle();

-- No browser/session, fabricated JWT or signature is used by the worker.
create function private.process_approval_auto_requests(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare candidate record; a public.approval_auto_requests%rowtype; v_reason text; v_step uuid;
  v_run bigint; v_examined integer:=0; v_completed integer:=0; v_blocked integer:=0;
begin
  insert into public.approval_worker_runs default values returning id into v_run;
  for candidate in select request_id,company_id from public.approval_auto_requests
    where state in ('pending','blocked') and due_at<=clock_timestamp() and attempts<60
      and (state='pending' or attempted_at is null or attempted_at<=clock_timestamp()-
        make_interval(mins=>least(60,greatest(1,power(2,least(attempts,6))::integer))))
    order by case when state='pending' then 0 else 1 end,due_at,request_id limit greatest(1,least(coalesce(p_limit,100),500)) loop
    perform private.approval_lock(candidate.company_id);
    select * into a from public.approval_auto_requests where request_id=candidate.request_id for update;
    if a.state not in ('pending','blocked') or a.due_at>clock_timestamp() then continue; end if;
    v_examined:=v_examined+1;
    v_reason:=private.approval_timer_invalid_reason(a.request_id);
    if v_reason is not null then
      update public.approval_auto_requests set state='invalidated',reason=v_reason,
        attempted_at=clock_timestamp(),processed_at=clock_timestamp(),attempts=attempts+1 where request_id=a.request_id;
      continue;
    end if;
    begin
      foreach v_step in array a.step_ids loop
        if not exists(select 1 from public.leave_request_approvals decision where decision.request_id=a.request_id
          and decision.step_id=v_step and decision.decision='approved') then
          perform private.decide_approval_request(a.request_id,v_step,null,'approved',null,false,false,null,null,a.authority_id);
        end if;
      end loop;
      update public.approval_auto_requests set state='completed',reason=null,attempted_at=clock_timestamp(),
        processed_at=clock_timestamp(),attempts=attempts+1 where request_id=a.request_id;
      v_completed:=v_completed+1;
    exception when others then
      -- Subtransaction rolls back all decision/accounting writes for this request, then records the failure.
      update public.approval_auto_requests set state='blocked',reason=left(sqlstate||': '||sqlerrm,1000),
        attempted_at=clock_timestamp(),attempts=attempts+1 where request_id=a.request_id;
      v_blocked:=v_blocked+1;
    end;
  end loop;
  update public.approval_worker_runs set finished_at=clock_timestamp(),examined=v_examined,
    completed=v_completed,blocked=v_blocked where id=v_run;
  return jsonb_build_object('examined',v_examined,'completed',v_completed,'blocked',v_blocked);
end; $$;
create function public.app_approval_worker_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_job jsonb; v_company uuid; v_admin boolean; v_ceo boolean; v_last_run jsonb;
begin
  select company_id into v_company from public.profiles where id=auth.uid() and active;
  v_admin:=private.is_admin(auth.uid());
  v_ceo:=exists(select 1 from public.approval_executive_settings where company_id=v_company and ceo_id=auth.uid());
  if v_company is null or not(v_admin or v_ceo) then
    raise exception 'admin or designated CEO required' using errcode='42501'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select jsonb_build_object(''job_id'',jobid,''schedule'',schedule,''active'',active)
      from cron.job where jobname=''bj-approval-delegation''' into v_job;
  end if;
  if not v_admin and v_job is not null then v_job:=jsonb_build_object('active',v_job->'active'); end if;
  select case when v_admin then jsonb_build_object('started_at',run.started_at,'finished_at',run.finished_at)
    else jsonb_build_object('finished_at',run.finished_at) end into v_last_run
    from public.approval_worker_runs run order by id desc limit 1;
  select jsonb_build_object('job',v_job,
    'overdue',(select count(*) from public.approval_auto_requests a where a.company_id=v_company
      and (v_admin or a.principal_id=auth.uid()) and a.state in ('pending','blocked') and a.due_at<=clock_timestamp()),
    'blocked',(select count(*) from public.approval_auto_requests a where a.company_id=v_company
      and (v_admin or a.principal_id=auth.uid()) and a.state='blocked'),
    'last_run',v_last_run) into v_result;
  return v_result;
end; $$;

-- All new tables enforce RLS and provide no direct mutation route to clients.
alter table public.approval_executive_settings enable row level security;
alter table public.approval_delegations enable row level security;
alter table public.approval_request_policy enable row level security;
alter table public.approval_auto_requests enable row level security;
alter table public.approval_worker_runs enable row level security;
create policy approval_executive_settings_select on public.approval_executive_settings for select to authenticated
  using(private.is_active(auth.uid()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=approval_executive_settings.company_id));
create policy approval_delegations_select on public.approval_delegations for select to authenticated
  using(private.is_active(auth.uid())
    and exists(select 1 from public.profiles me where me.id=auth.uid() and me.company_id=approval_delegations.company_id)
    and (principal_id=auth.uid() or delegate_id=auth.uid() or private.is_admin(auth.uid())));
create policy approval_request_policy_select on public.approval_request_policy for select to authenticated
  using(public.app_can_read_approval_request(request_id));
create policy approval_auto_requests_select on public.approval_auto_requests for select to authenticated
  using(public.app_can_read_approval_request(request_id));
create policy approval_worker_runs_select on public.approval_worker_runs for select to authenticated using(private.is_admin(auth.uid()));
revoke all on public.approval_executive_settings,public.approval_delegations,public.approval_request_policy,
  public.approval_auto_requests,public.approval_worker_runs from public,anon,authenticated;
grant select on public.approval_executive_settings,public.approval_delegations,public.approval_request_policy,
  public.approval_auto_requests,public.approval_worker_runs to authenticated;
drop policy leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using(public.app_can_read_approval_request(id));
drop policy leave_request_approvals_select on public.leave_request_approvals;
create policy leave_request_approvals_select on public.leave_request_approvals for select to authenticated
  using(public.app_can_read_approval_request(request_id));

-- Explicitly restrict every new helper, including trigger and worker entrypoints.
do $$
declare p record;
begin
  for p in select oid::regprocedure as signature from pg_proc where pronamespace='private'::regnamespace
    and proname=any(array['approval_lock','natural_approver','delegate_eligible','effective_approval_delegate',
      'natural_step_authority','request_step_applies','step_delegation','can_approve_step','can_read_approval_request',
      'approval_bounds','approval_grant_json','approval_step_snapshot','approval_timer_invalid_reason',
      'request_hr_exempt','ceo_delegate_configuration_ready','request_step_decided','ambiguous_legacy_approval',
      'reconcile_approval_timers','enroll_request_delegation','finalize_approval_request','decide_approval_request',
      'approval_fallback_allowed','approval_mutation_company','approval_before_authority_mutation',
      'approval_after_authority_mutation','approval_source_lifecycle','process_approval_auto_requests']) loop
    execute format('revoke all on function %s from public,anon,authenticated',p.signature);
  end loop;
  for p in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname=any(array['app_can_read_approval_request','app_approval_capabilities','app_delegation_context',
      'app_search_delegates','app_set_approval_delegate','app_set_executive_settings','app_request_delegation_preview',
      'submit_leave_request_v2','submit_hourly_leave_request_v2','submit_errand_request_v2','submit_daily_errand_request_v2',
      'approve_leave_request_v2','reject_leave_request_v2','app_request_approval_progress','app_request_approval_context',
      'app_approval_queue','get_leave_request_signatures','app_approval_worker_health']) loop
    execute format('revoke all on function %s from public,anon,authenticated',p.signature);
    execute format('grant execute on function %s to authenticated',p.signature);
  end loop;
end; $$;

-- Registration is transactional and inactive at commit. Activation is a separate release operation.
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable: approval delegation worker is not registered and must remain inactive';
    return;
  end if;
  if exists(select 1 from cron.job where jobname='bj-approval-delegation') then
    raise exception 'approval delegation cron job already exists; review before replacing it'; end if;
  select cron.schedule('bj-approval-delegation','* * * * *','select private.process_approval_auto_requests();') into v_job;
  perform cron.alter_job(v_job,active:=false);
end; $$;

notify pgrst,'reload schema';
