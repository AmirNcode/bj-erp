-- Admin can finish a stranded request (2026-10-31).
--
-- A request stays pending until every applicable approval step has approved it, and only a
-- decision (or submission) runs private.finalize_approval_request. When an administrator
-- deactivates a step, or a step stops applying to the employee, after the other steps already
-- signed, nothing is left to sign and nothing completes the request: Liara request 1405-0001
-- (direct manager + HR signed, then the security step was deactivated on 2026-10-12). The admin
-- override then found an empty step list and failed with 'you have already signed this
-- request', for approve and reject alike.
--
-- private.decide_approval_request: when the admin override has no outstanding step left, approve
-- completes the request through finalize_approval_request (ledger, overlap and replacement checks
-- unchanged) with the admin's signature, and reject marks it rejected. Both write an audit row
-- with "stranded": true. Non-admins still get the old error. Otherwise the definition is
-- unchanged from 20261019120000.

create or replace function private.decide_approval_request(p_id uuid, p_step_id uuid, p_actor uuid, p_decision public.leave_status, p_signature_data text, p_signature_authorized boolean, p_override boolean, p_per_diem_rials bigint, p_reason text, p_auto_authority uuid DEFAULT NULL::uuid) RETURNS void
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
  if cardinality(coalesce(v_steps,'{}'))=0 then
    -- Stranded request: every step that still applies is decided, yet the request is pending,
    -- because the step that would have completed it was deactivated or stopped applying after
    -- the others signed. Only the admin override arrives here with nothing left to sign.
    if not v_override then raise exception 'you have already signed this request' using errcode='22023'; end if;
    if p_per_diem_rials is not null then
      raise exception 'per diem can only be set on the hr step of an errand' using errcode='22023'; end if;
    if p_decision='rejected' then
      update public.leave_requests set status='rejected',decided_by=p_actor,decided_at=v_now,decision_note=v_note
        where id=p_id and status='pending';
    elsif not private.finalize_approval_request(p_id,p_actor,p_signature_data,v_now,'manual') then
      raise exception 'you have already signed this request' using errcode='22023';
    end if;
    insert into public.audit_log(actor_id,action,entity,entity_id,after) values
      (p_actor,case when p_decision='approved' then 'approve_leave_step' else 'reject_leave_request' end,
       'leave_requests',p_id,jsonb_build_object('step_ids','{}'::uuid[],'evidence_kind','manual',
         'admin_override',true,'stranded',true));
    return;
  end if;
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
