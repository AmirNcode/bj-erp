-- 2026-11-11 — two owner decisions (see docs/AGENT-LOG.md, 2026-11-11):
--
-- 1. Leave administration is not blocked by "access above yours" (D4). A leave_balances
--    edit holder changes balances, add-to-balance and accrual policy, and a special_leave
--    edit holder grants marriage / bereavement leave (FR-65), for anyone in their company
--    except themselves and the admin, whatever other roles the person holds. Changing a
--    balance gives no access, so the D4 identity clauses of private.can_act_on (which guard
--    password resets and sign-in as someone) do not apply. The rest of the record keeps D4.
--
-- 2. A named approval step whose person holds the HR role counts as the HR step for the
--    per diem (FR-61) and the travel-booking box (FR-70), like a role 'hr' step. The client
--    replaced the seeded HR role step with a named person, which hid both on the approve
--    dialog.

create or replace function private.can_manage_leave_of(p_caller uuid, p_target uuid)
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select p_caller is distinct from p_target
     and private.is_active(p_caller)
     and exists (select 1 from public.profiles t
                   join public.profiles c on c.id = p_caller and c.company_id = t.company_id
                  where t.id = p_target)
     and not exists (select 1 from public.user_roles where user_id = p_target and role = 'admin');
$$;
comment on function private.can_manage_leave_of(uuid, uuid) is
  'Leave administration target check (2026-11-11): same company, not self, not the admin. Unlike can_act_on, no D4 (access above yours) clauses.';
revoke all on function private.can_manage_leave_of(uuid, uuid) from public;
grant execute on function private.can_manage_leave_of(uuid, uuid) to authenticated;

create or replace function private.is_hr_step(p_step uuid)
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select coalesce((select s.role = 'hr'
                          or (s.approver_id is not null and private.has_role(s.approver_id, 'hr'))
                     from public.approval_steps s where s.id = p_step), false);
$$;
comment on function private.is_hr_step(uuid) is
  'FR-61/FR-70: the step that takes the per diem and the travel-booking box: role hr, or a named step whose person holds the hr role (2026-11-11).';
revoke all on function private.is_hr_step(uuid) from public;
grant execute on function private.is_hr_step(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.decide_approval_request(p_id uuid, p_step_id uuid, p_actor uuid, p_decision leave_status, p_signature_data text, p_signature_authorized boolean, p_override boolean, p_per_diem_rials bigint, p_reason text, p_auto_authority uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_filled_hr:=v_filled_hr or coalesce(private.is_hr_step(s.id),false);
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
end; $function$
;

CREATE OR REPLACE FUNCTION private.request_data_app_request_approval_progress(p_id uuid, p_print boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.leave_requests%rowtype; v_result jsonb:='[]'; v_item jsonb;
  v_policy public.approval_request_policy%rowtype; v_done record; s record; v_snapshot jsonb;
  d public.approval_delegations%rowtype; v_natural boolean; v_allowed boolean; v_can_approve boolean; v_expected text;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
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
        'per_diem_allowed',v_allowed and private.is_hr_step(s.id) and r.kind='errand' and r.unit='day','is_mine',v_allowed,
        'hr_step',private.is_hr_step(s.id));
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
end; $function$
;

CREATE OR REPLACE FUNCTION private.special_leave_target(p_actor uuid, p_employee uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid;
  v_target_company uuid;
begin
  if p_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- has_perm is false for an inactive caller.
  if not private.has_perm(p_actor, 'special_leave', 'edit') then
    raise exception 'not allowed to grant special leave' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = p_actor;
  select company_id into v_target_company from public.profiles where id = p_employee;
  if v_target_company is null or v_target_company <> v_company then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if not private.is_admin(p_actor) then
    if p_employee = p_actor then
      raise exception 'you cannot change your own leave balance' using errcode = '42501';
    end if;
    if exists (select 1 from public.user_roles where user_id = p_employee and role = 'admin') then
      raise exception 'not allowed to grant special leave to an admin' using errcode = '42501';
    end if;
    if not private.can_manage_leave_of(p_actor, p_employee) then
      raise exception 'not allowed to grant special leave to this employee' using errcode = '42501';
    end if;
  end if;
  return v_company;
end; $function$
;

CREATE OR REPLACE FUNCTION public.allocate_leave(p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can allocate leave' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_manage_leave_of(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;
  return private.allocate_leave_impl(auth.uid(), p_employee_id, p_leave_type_id,
                                     p_period_start, p_period_end, p_minutes);
end; $function$
;

CREATE OR REPLACE FUNCTION public.app_add_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_minutes integer, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_company uuid;
  v_current int;
  v_ledger uuid;
begin
  -- The same three gates as set_leave_balance, in the same order.
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  if not private.is_admin(v_uid) and p_employee_id = v_uid then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  if not private.is_admin(v_uid) and not private.can_manage_leave_of(v_uid, p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;

  select company_id into v_company from public.profiles where id = p_employee_id;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'amount must be more than 0' using errcode = '22023';
  end if;
  if p_minutes > 366 * private.company_minutes_per_day(v_company) then
    raise exception 'amount is too large' using errcode = '22023';
  end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'reason is too long' using errcode = '22023'; end if;
  if not exists (select 1 from public.leave_types
                  where id = p_leave_type_id and company_id = v_company and affects_balance) then
    raise exception 'this leave type has no balance' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));
  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes,
                                  balance_after_minutes, note, quick_add, created_by)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_minutes,
          v_current + p_minutes, v_reason, true, v_uid)
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'leave_balance.add', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'added_minutes', p_minutes));

  return v_current + p_minutes;
end $function$
;

CREATE OR REPLACE FUNCTION public.approve_leave_request_steps(p_id uuid, p_step_ids uuid[], p_signature_data text, p_signature_authorized boolean, p_per_diem_rials bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         (array_agg(st.id order by st.step_order, st.id) filter (where private.is_hr_step(st.id)))[1]
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.set_employee_leave_policy(p_employee_id uuid, p_leave_type_id uuid, p_accrual_minutes_per_month integer, p_annual_cap_minutes integer, p_carryover_cap_minutes integer, p_accrual_start_month date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set a leave policy' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_manage_leave_of(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;
  if p_accrual_minutes_per_month is null or p_accrual_minutes_per_month < 0 then
    raise exception 'accrual per month must be 0 or more' using errcode = '22023';
  end if;
  if p_carryover_cap_minutes is null or p_carryover_cap_minutes < 0 then
    raise exception 'carryover cap must be 0 or more' using errcode = '22023';
  end if;
  if p_annual_cap_minutes is not null and p_annual_cap_minutes < 0 then
    raise exception 'annual cap must be 0 or more' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jalali_months where gregorian_start = p_accrual_start_month) then
    raise exception 'accrual start month must be a jalali month start' using errcode = '22023';
  end if;

  insert into public.employee_leave_policies as elp (
    employee_id, leave_type_id, accrual_minutes_per_month,
    annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
  ) values (
    p_employee_id, p_leave_type_id, p_accrual_minutes_per_month,
    p_annual_cap_minutes, p_carryover_cap_minutes, p_accrual_start_month, auth.uid()
  )
  on conflict (employee_id, leave_type_id) do update
     set accrual_minutes_per_month = excluded.accrual_minutes_per_month,
         annual_cap_minutes        = excluded.annual_cap_minutes,
         carryover_cap_minutes     = excluded.carryover_cap_minutes,
         accrual_start_month       = excluded.accrual_start_month
  returning elp.id into v_id;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_employee_leave_policy', 'employee_leave_policies', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'accrual_minutes_per_month', p_accrual_minutes_per_month,
                             'annual_cap_minutes', p_annual_cap_minutes,
                             'carryover_cap_minutes', p_carryover_cap_minutes,
                             'accrual_start_month', p_accrual_start_month));
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target_minutes integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current int;
  v_ledger uuid;
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_manage_leave_of(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;

  -- FR-48: a balance may be negative (leave taken in advance). Bounded at one
  -- year of workdays below zero so a typo cannot post an absurd debit.
  if p_target_minutes is null
     or p_target_minutes < -366 * private.company_minutes_per_day(
          (select company_id from public.profiles where id = p_employee_id)) then
    raise exception 'target balance is out of range' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target_minutes then
    return p_target_minutes;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note, created_by)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set', auth.uid())
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $function$
;

