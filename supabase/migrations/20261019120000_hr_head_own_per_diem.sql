-- The designated Head of HR enters their own per diem on the errand form (owner decision 2026-10-19).
-- Their HR step is exempt and the CEO step may approve at submission, so no approval dialog ever
-- offered the per diem field. Only the HR head recorded on the request's approval policy may set it,
-- only at submission, and the row remembers that the requester entered it.
-- Lock order unchanged: the submit functions take the company lock (enroll) before any write here.

alter table public.leave_requests add column per_diem_by_requester boolean not null default false;
alter table public.leave_requests add constraint leave_requests_per_diem_by_requester_shape
  check (not per_diem_by_requester or per_diem_rials is not null);
comment on column public.leave_requests.per_diem_by_requester is
  'True when the designated Head of HR entered per diem on their own errand at submission; false when an hr step signer entered it.';

create function private.set_requester_per_diem(p_request uuid, p_per_diem_rials bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests%rowtype;
begin
  if p_per_diem_rials is null then return; end if;
  if p_per_diem_rials<0 then raise exception 'per diem must be 0 or more' using errcode='22023'; end if;
  select * into r from public.leave_requests where id=p_request;
  if r.kind<>'errand' or not exists (select 1 from public.approval_request_policy x
      where x.request_id=r.id and x.hr_head_id=r.employee_id) then
    raise exception 'only the Head of HR can enter per diem on their own errand' using errcode='42501'; end if;
  update public.leave_requests set per_diem_rials=p_per_diem_rials,per_diem_by_requester=true where id=r.id;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (r.employee_id,'set_own_per_diem','leave_requests',r.id,jsonb_build_object('per_diem_rials',p_per_diem_rials));
end; $$;
revoke all on function private.set_requester_per_diem(uuid,bigint) from public,anon,authenticated;

-- Same bodies as before plus the optional per diem. Dropped and recreated (the parameter list
-- changes); the v1 wrappers call these positionally and keep working through the new default.
drop function public.submit_errand_request_v2(date,time,time,text,text,boolean,text,boolean,jsonb,boolean);
create function public.submit_errand_request_v2(p_date date, p_start_time time without time zone, p_end_time time without time zone, p_location text, p_signature_data text, p_signature_authorized boolean, p_description text DEFAULT NULL::text, p_auto_approval_consent boolean DEFAULT false, p_delegation_preview jsonb DEFAULT NULL::jsonb, p_temporary_ceo_authorized boolean DEFAULT false, p_per_diem_rials bigint DEFAULT NULL::bigint) RETURNS uuid
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
  perform private.set_requester_per_diem(v_request_id,p_per_diem_rials);
  -- A configured chain made entirely exempt for the HR head needs no fabricated human decision.
  if exists (select 1 from public.approval_request_policy x where x.request_id=v_request_id
      and cardinality(x.hr_exempt_step_ids)>0)
     and not exists (select 1 from public.approval_steps st where private.request_step_applies(v_request_id,st.id)) then
    perform private.finalize_approval_request(v_request_id,null,null,null,'hr_exempt');
  end if;
  return v_request_id;
end;
$$;

drop function public.submit_daily_errand_request_v2(date,date,text,text,boolean,text,boolean,jsonb,boolean);
create function public.submit_daily_errand_request_v2(p_start date, p_end date, p_location text, p_signature_data text, p_signature_authorized boolean, p_description text DEFAULT NULL::text, p_auto_approval_consent boolean DEFAULT false, p_delegation_preview jsonb DEFAULT NULL::jsonb, p_temporary_ceo_authorized boolean DEFAULT false, p_per_diem_rials bigint DEFAULT NULL::bigint) RETURNS uuid
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
  perform private.set_requester_per_diem(v_request_id,p_per_diem_rials);
  -- A configured chain made entirely exempt for the HR head needs no fabricated human decision.
  if exists (select 1 from public.approval_request_policy x where x.request_id=v_request_id
      and cardinality(x.hr_exempt_step_ids)>0)
     and not exists (select 1 from public.approval_steps st where private.request_step_applies(v_request_id,st.id)) then
    perform private.finalize_approval_request(v_request_id,null,null,null,'hr_exempt');
  end if;
  return v_request_id;
end;
$$;

do $$
declare p record;
begin
  for p in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname=any(array['submit_errand_request_v2','submit_daily_errand_request_v2']) loop
    execute format('revoke all on function %s from public,anon,authenticated',p.signature);
    execute format('grant execute on function %s to authenticated',p.signature);
  end loop;
end; $$;

-- An hr step signer who enters per diem replaces any earlier amount and its requester marker.
CREATE OR REPLACE FUNCTION private.decide_approval_request(p_id uuid, p_step_id uuid, p_actor uuid, p_decision public.leave_status, p_signature_data text, p_signature_authorized boolean, p_override boolean, p_per_diem_rials bigint, p_reason text, p_auto_authority uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; s public.approval_steps%rowtype;
  d public.approval_delegations%rowtype; v_auth public.approval_delegations%rowtype;
  v_steps uuid[]; v_step uuid; v_total integer; v_admin boolean:=false; v_override boolean:=false;
  v_kind text; v_principal uuid; v_principal_name text; v_actor_name text; v_evidence jsonb;
  v_now timestamptz; v_filled_hr boolean:=false; v_note text:=nullif(btrim(p_reason),'');
begin
  select * into r from public.leave_requests where id=p_id;
  if r.id is null then raise exception 'request not found' using errcode='P0002'; end if;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:'||r.employee_id::text,0));
  select * into r from public.leave_requests where id=p_id for update;
  v_now:=clock_timestamp();
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
    -- Automatic CEO-step approval at submission (only enroll_request_delegation calls this).
    select * into v_auth from public.approval_delegations where id=p_auto_authority;
    if p_actor is not null or p_decision<>'approved' or v_auth.id is null or not v_auth.ceo_authorized
      or v_auth.delegate_id is distinct from r.employee_id or r.signature_data is null or r.signature_consent_at is null
      or not exists (select 1 from public.approval_executive_settings x
        where x.company_id=r.company_id and x.ceo_id=v_auth.principal_id)
      or not exists (select 1 from private.effective_approval_delegate(v_auth.principal_id) e where e.id=v_auth.id)
      or not private.request_step_applies(p_id,p_step_id)
      or not private.natural_step_authority(v_auth.principal_id,p_id,p_step_id) then
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
      v_kind:='automatic'; v_principal:=v_auth.principal_id; v_principal_name:=v_auth.principal_name;
      v_evidence:=jsonb_build_object('authority_id',v_auth.id,'principal_name',v_auth.principal_name,
        'delegate_id',v_auth.delegate_id,'delegate_name',v_auth.delegate_name,'consent_at',r.signature_consent_at,
        'submitted_at',r.created_at,'processed_at',v_now,'statement',
        'Automatically approved at submission under delegated CEO authority. The appointed delegate accepted responsibility under the recorded authorization.');
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
      signature_data,signature_consent_at,note,evidence_kind,principal_id,principal_name,signer_name_snapshot,authority_id,evidence,created_at)
    values(p_id,v_step,coalesce(s.role,'manager'),p_actor,p_decision,
      case when p_decision='approved' then p_signature_data end,
      case when p_decision='approved' and p_signature_data is not null then v_now end,
      v_note,v_kind,v_principal,v_principal_name,v_actor_name,
      case when p_auto_authority is not null then p_auto_authority else d.id end,
      v_evidence||jsonb_build_object('step_id',v_step,'step_role',coalesce(s.role,'manager'),
        'step_order',coalesce(s.step_order,1),'manager_scope',coalesce(s.manager_scope,'direct'),
        'named',s.approver_id is not null,'approver_id',s.approver_id,
        'expected_name',case when s.approver_id is not null then
          (select full_name from public.profiles where id=s.approver_id) else v_principal_name end),v_now);
    if p_decision='rejected' then exit; end if;
  end loop;
  if p_decision='rejected' then
    update public.leave_requests set status='rejected',decided_by=p_actor,decided_at=v_now,decision_note=v_note where id=p_id and status='pending';
  else
    if p_per_diem_rials is not null then
      if r.kind<>'errand' or not v_filled_hr then
        raise exception 'per diem can only be set on the hr step of an errand' using errcode='22023'; end if;
      update public.leave_requests set per_diem_rials=p_per_diem_rials,per_diem_by_requester=false where id=p_id;
    end if;
    perform private.finalize_approval_request(p_id,p_actor,p_signature_data,v_now,
      case when p_auto_authority is not null then 'automatic' else v_kind end);
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (p_actor,case when p_decision='approved' then 'approve_leave_step' else 'reject_leave_request' end,
     'leave_requests',p_id,jsonb_build_object('step_ids',v_steps,'evidence_kind',v_kind,'admin_override',v_override,
       'authority_id',p_auto_authority,'per_diem_rials',p_per_diem_rials));
end; $$;


-- Finance sees who entered the amount. Return type changes, so drop and recreate.
drop function public.finance_approved_requests(date,date);
CREATE FUNCTION public.finance_approved_requests(p_from date, p_to date) RETURNS TABLE(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text, personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text, leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit, start_time time without time zone, end_time time without time zone, requested_minutes integer, unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean, decided_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(v_uid) or not private.has_permission(v_uid, 'finance.view') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'date range too long' using errcode = '22023';
  end if;
  select company_id into v_company from public.profiles where profiles.id = v_uid;

  return query
    select r.id, r.serial_year, r.serial_seq, r.kind,
           p.full_name, p.personnel_no,
           d.name_fa, d.name_en,
           t.name_fa, t.name_en, t.is_paid,
           r.start_date, r.end_date, r.unit, r.start_time, r.end_time,
           r.requested_minutes, r.unpaid_minutes,
           r.errand_location, r.per_diem_rials, r.per_diem_by_requester, r.decided_at
      from public.leave_requests r
      join public.profiles p on p.id = r.employee_id
      left join public.departments d on d.id = p.department_id
      left join public.leave_types t on t.id = r.leave_type_id
     where r.company_id = v_company
       and r.status = 'approved'
       and r.start_date <= p_to
       and r.end_date >= p_from
     order by r.start_date, r.serial_year, r.serial_seq;
end; $$;
revoke all on function public.finance_approved_requests(date,date) from public,anon;
grant execute on function public.finance_approved_requests(date,date) to authenticated;

notify pgrst,'reload schema';
