-- FR-71 (2026-10-21): sign once when one person holds several open steps.
--
-- 1. app_request_approval_progress: every row also carries is_mine — the caller
--    may sign this open step in their own right or as a delegate, ignoring the
--    approval-order rule (can_approve still applies it). per_diem_allowed on an
--    errand's HR step follows is_mine, so the per diem field shows when the HR
--    step is part of the caller's group even while an earlier step of theirs is
--    still open. Otherwise the definition is unchanged from 20261018011333.
-- 2. approve_leave_request_steps: one signature for a list of steps. Each step
--    goes through private.decide_approval_request in step order inside this one
--    transaction, so entitlement and the order rule are re-checked per step
--    (rows inserted for earlier steps are visible) and any failure saves nothing.
--    approve_leave_request_v2 stays for the previous app, the admin override and
--    the legacy no-chain path.

create or replace function public.app_request_approval_progress(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
      'is_delegated',v_done.evidence_kind='delegated','can_approve',false,'can_reject',false,'is_mine',false,
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
        'is_delegated',false,'per_diem_allowed',false,'is_mine',false,'statement','Not required — request submitted by the Head of HR');
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
        'per_diem_allowed',v_allowed and s.role='hr' and r.kind='errand','is_mine',v_allowed);
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
      'can_approve',false,'can_reject',false,'is_delegated',false,'per_diem_allowed',false,'is_mine',false,
      'signer_name',null,'signed_at',null,'decision',null,
      'statement','Not required — request submitted by the Head of HR'));
  end loop;
  if jsonb_array_length(v_result)=0 and r.status='pending' then
    v_allowed:=private.approval_fallback_allowed(auth.uid(),p_id);
    v_result:=jsonb_build_array(jsonb_build_object('step_id',null,'step_role','manager','step_order',1,
      'manager_scope','direct','named',false,
      'expected_name',(select p.full_name from public.profiles emp join public.profiles p on p.id=emp.manager_id where emp.id=r.employee_id),
      'evidence_kind','pending','decision',null,'signer_name',null,'signed_at',null,
      'can_approve',v_allowed,'can_reject',v_allowed,'per_diem_allowed',false,'is_mine',v_allowed,
      'is_delegated',v_allowed and not private.is_manager_of(auth.uid(),r.employee_id) and not private.is_admin(auth.uid())));
  end if;
  return (select coalesce(jsonb_agg(item order by coalesce((item->>'step_order')::integer,1),item->>'step_id'),'[]')
    from jsonb_array_elements(v_result) item);
end; $$;

create or replace function public.approve_leave_request_steps(p_id uuid, p_step_ids uuid[],
    p_signature_data text, p_signature_authorized boolean, p_per_diem_rials bigint default null)
  returns void language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_steps uuid[];
  v_hr uuid;
  v_step uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_step_ids is null or cardinality(p_step_ids) = 0 or array_position(p_step_ids, null) is not null then
    raise exception 'no approval steps given' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(p_step_ids) as v(x)) <> cardinality(p_step_ids) then
    raise exception 'duplicate approval steps' using errcode = '22023'; end if;
  select company_id into v_company from public.leave_requests where id = p_id;
  if v_company is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  select array_agg(st.id order by st.step_order, st.id),
         (array_agg(st.id order by st.step_order, st.id) filter (where st.role = 'hr'))[1]
    into v_steps, v_hr
    from public.approval_steps st
   where st.id = any(p_step_ids) and st.company_id = v_company;
  if coalesce(cardinality(v_steps), 0) <> cardinality(p_step_ids) then
    raise exception 'not allowed to decide this request' using errcode = '42501'; end if;
  if p_per_diem_rials is not null and v_hr is null then
    raise exception 'per diem can only be set on the hr step of an errand' using errcode = '22023'; end if;

  foreach v_step in array v_steps loop
    perform private.decide_approval_request(p_id, v_step, v_uid, 'approved', p_signature_data,
      p_signature_authorized, false, case when v_step = v_hr then p_per_diem_rials end, null);
  end loop;
end; $$;
revoke all on function public.approve_leave_request_steps(uuid, uuid[], text, boolean, bigint) from public, anon;
grant execute on function public.approve_leave_request_steps(uuid, uuid[], text, boolean, bigint) to authenticated;

notify pgrst, 'reload schema';
