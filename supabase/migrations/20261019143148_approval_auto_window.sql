-- Admin-adjustable CEO automatic-approval review window (was a fixed 120 minutes).
-- Stored per company on approval_executive_settings (default 120, 1..1440 minutes) and set only by
-- the admin through app_set_auto_approval_window. Each enrolled timer snapshots its window, so a
-- later change never moves an existing deadline. Changing the window does not bump the settings
-- version (that would invalidate every pending timer); the preview token covers the window instead,
-- so a form previewed under the old value must be refreshed and consent given again.
-- Add-first: the old app keeps working (default 120 reproduces the previous behavior).

alter table public.approval_executive_settings
  add column auto_approval_minutes integer not null default 120
    constraint approval_executive_settings_auto_window_check check (auto_approval_minutes between 1 and 1440);

alter table public.approval_auto_requests
  add column window_minutes integer not null default 120
    constraint approval_auto_requests_window_check check (window_minutes between 1 and 1440);
alter table public.approval_auto_requests drop constraint approval_auto_requests_check;
alter table public.approval_auto_requests add constraint approval_auto_requests_due_check
  check (due_at = submitted_at + make_interval(mins => window_minutes));

CREATE FUNCTION public.app_set_auto_approval_window(p_minutes integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid; v_before integer;
begin
  if not private.is_admin(auth.uid()) then raise exception 'admin required' using errcode='42501'; end if;
  select company_id into v_company from public.profiles where id=auth.uid();
  perform private.approval_lock(v_company);
  if not private.is_admin(auth.uid()) or not exists (
      select 1 from public.profiles where id=auth.uid() and company_id=v_company) then
    raise exception 'admin required' using errcode='42501'; end if;
  if p_minutes is null or p_minutes not between 1 and 1440 then
    raise exception 'automatic approval window must be 1 to 1440 minutes' using errcode='22023'; end if;
  select auto_approval_minutes into v_before from public.approval_executive_settings where company_id=v_company;
  insert into public.approval_executive_settings(company_id,auto_approval_minutes,configured_by)
    values(v_company,p_minutes,auth.uid())
    on conflict(company_id) do update set auto_approval_minutes=excluded.auto_approval_minutes,
      configured_by=excluded.configured_by,configured_at=clock_timestamp();
  insert into public.audit_log(actor_id,action,entity,entity_id,before,after) values
    (auth.uid(),'set_auto_approval_window','approval_executive_settings',v_company,
      jsonb_build_object('minutes',coalesce(v_before,120)),jsonb_build_object('minutes',p_minutes));
end; $$;

REVOKE ALL ON FUNCTION public.app_set_auto_approval_window(p_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.app_set_auto_approval_window(p_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.app_set_auto_approval_window(p_minutes integer) TO service_role;

CREATE OR REPLACE FUNCTION private.enroll_request_delegation(p_request uuid, p_auto_consent boolean, p_preview jsonb, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; x public.approval_executive_settings%rowtype;
  d public.approval_delegations%rowtype; v_preview jsonb; v_bounds jsonb; v_steps uuid[];
  v_now timestamptz; v_temp uuid;
begin
  select * into r from public.leave_requests where id=p_request;
  perform private.approval_lock(r.company_id);
  select * into r from public.leave_requests where id=p_request;
  v_now:=clock_timestamp();
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
      principal_name,delegate_name,settings_version,step_ids,step_snapshot,consent_at,submitted_at,due_at,window_minutes)
    values(r.id,r.company_id,d.id,x.ceo_id,r.employee_id,d.principal_name,d.delegate_name,x.version,
      v_steps,private.approval_step_snapshot(r.id,v_steps),v_now,r.created_at,r.created_at+make_interval(mins=>x.auto_approval_minutes),x.auto_approval_minutes);
  elsif p_auto_consent then
    raise exception 'CEO automatic approval authority changed; refresh the request preview' using errcode='22023';
  end if;
end; $$;

CREATE OR REPLACE FUNCTION public.app_request_delegation_preview(p_start date, p_end date, p_unit public.leave_unit DEFAULT 'day'::public.leave_unit, p_day_part public.day_part DEFAULT 'full'::public.day_part, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_replacement_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid:=auth.uid(); v_company uuid; v_bounds jsonb; v_saved uuid; v_effective uuid;
  v_authority uuid; v_temporary boolean; v_auto boolean; v_result jsonb; v_window int;
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
  -- Admin-set review window; the token covers it, so a change forces a fresh preview + consent.
  v_window:=coalesce((select auto_approval_minutes from public.approval_executive_settings where company_id=v_company),120);
  v_result:=jsonb_build_object('principal_id',v_uid,'bounds',v_bounds,'saved',private.approval_grant_json(v_saved),
    'effective',private.approval_grant_json(v_effective),
    'temporary',case when v_temporary then jsonb_build_object('delegate_id',p_replacement_id,
      'delegate_name',(select full_name from public.profiles where id=p_replacement_id),
      'starts_at',v_bounds->'starts_at','ends_at',v_bounds->'ends_at') else null end,
    'can_approve',private.natural_approver(v_uid),'can_delegate',private.has_perm(v_uid,'approval_delegate','edit'),
    'auto_approval_eligible',v_auto,'auto_approval_minutes',v_window,'authority_id',v_authority,
    'is_ceo',exists(select 1 from public.approval_executive_settings where company_id=v_company and ceo_id=v_uid),
    'temporary_eligible',v_temporary,'temporary_delegate_name',case when v_temporary then (select full_name from public.profiles where id=p_replacement_id) end,
    'authority_ends_at',(select ends_at from public.approval_delegations where id=v_authority),
    'authority_expires_before_deadline',coalesce((select ends_at<clock_timestamp()+make_interval(mins=>v_window) from public.approval_delegations where id=v_authority),false),
    'replacement_id',p_replacement_id,'start',p_start,'end',p_end,'unit',p_unit,'day_part',p_day_part,
    'start_time',p_start_time,'end_time',p_end_time);
  return v_result||jsonb_build_object('preview_token',md5(v_result::text));
end; $$;

CREATE OR REPLACE FUNCTION public.app_delegation_context(p_principal_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    'version',x.version,'auto_approval_minutes',x.auto_approval_minutes) into v_settings from public.approval_executive_settings x where company_id=v_company;
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
