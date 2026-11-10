-- FR-90: a replacement (جانشین) never gains approval authority (2026-11-10).
-- Saved delegates (approval_delegations with source_request_id null) are untouched.
-- Signatures of all three functions are unchanged; p_temporary_ceo_authorized is accepted and ignored,
-- and the preview JSON keeps every key (temporary = null, temporary_eligible = false).

CREATE OR REPLACE FUNCTION private.enroll_request_delegation(p_request uuid, p_auto_consent boolean, p_preview jsonb, p_temporary_ceo_authorized boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; x public.approval_executive_settings%rowtype;
  d public.approval_delegations%rowtype; v_preview jsonb; v_bounds jsonb; v_steps uuid[];
  v_step uuid;
begin
  select * into r from public.leave_requests where id=p_request;
  perform private.approval_lock(r.company_id);
  select * into r from public.leave_requests where id=p_request;
  v_preview:=public.app_request_delegation_preview(r.start_date,r.end_date,r.unit,r.day_part,
    r.start_time,r.end_time,r.replacement_id);
  if p_preview is not null and p_preview->>'preview_token' is distinct from v_preview->>'preview_token' then
    raise exception 'delegation preview changed; refresh the request preview' using errcode='22023'; end if;
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
  select g.* into d from private.effective_approval_delegate(x.ceo_id) g
    where g.delegate_id=r.employee_id and g.ceo_authorized;
  if d.id is not null then
    if p_auto_consent is not true or r.signature_data is null or r.signature_consent_at is null then
      raise exception 'CEO automatic approval responsibility consent required; refresh the request form' using errcode='22023'; end if;
    select array_agg(s.id order by s.step_order,s.id) into v_steps from public.approval_steps s
      where private.request_step_applies(r.id,s.id) and private.natural_step_authority(x.ceo_id,r.id,s.id);
    if cardinality(coalesce(v_steps,'{}'))=0 then
      raise exception 'CEO has no natural applicable approval step; correct executive approval configuration' using errcode='22023'; end if;
    -- Approved at once, before any earlier step (HR still signs separately). The last step to be
    -- approved finalizes the request, so stop once it is no longer pending.
    foreach v_step in array v_steps loop
      exit when (select status from public.leave_requests where id=r.id)<>'pending';
      if not private.request_step_decided(r.id,v_step) then
        perform private.decide_approval_request(r.id,v_step,null,'approved',null,false,false,null,null,d.id);
      end if;
    end loop;
  elsif p_auto_consent then
    raise exception 'CEO automatic approval authority changed; refresh the request preview' using errcode='22023';
  end if;
end; $$;

CREATE OR REPLACE FUNCTION public.app_change_replacement(p_request uuid, p_replacement_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid := auth.uid(); r public.leave_requests%rowtype;
  s public.leave_request_replacement_signoffs%rowtype; v_dept uuid;
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed to change this request' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null or r.employee_id <> v_uid then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  select * into s from public.leave_request_replacement_signoffs where request_id = p_request for update;
  if s.request_id is null or s.status <> 'declined' then
    raise exception 'only a declined replacement can be changed' using errcode = '22023';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'this request is no longer open for your signature' using errcode = '22023';
  end if;
  if p_replacement_id is not null then
    select department_id into v_dept from public.profiles where id = v_uid;
    if p_replacement_id = s.replacement_id then
      raise exception 'choose a different replacement' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.profiles p
       where p.id = p_replacement_id and p.active and p.company_id = r.company_id
         and ((v_dept is not null and p.department_id = v_dept)
              or private.delegate_eligible(v_uid, p.id))
         and p.id <> v_uid
    ) then
      raise exception 'replacement must be an active colleague in your department' using errcode = '22023';
    end if;
    if private.replacement_is_away(p_replacement_id, r.start_date, r.end_date, r.unit,
         r.start_time, r.end_time) then
      raise exception 'replacement is on leave during this period' using errcode = '22023';
    end if;
  end if;
  update public.leave_requests set replacement_id = p_replacement_id where id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'replacement_change', 'leave_requests', p_request,
          jsonb_build_object('replacement_id', s.replacement_id),
          jsonb_build_object('replacement_id', p_replacement_id));
end $$;

CREATE OR REPLACE FUNCTION public.app_request_delegation_preview(p_start date, p_end date, p_unit public.leave_unit DEFAULT 'day'::public.leave_unit, p_day_part public.day_part DEFAULT 'full'::public.day_part, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_replacement_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_uid uuid:=auth.uid(); v_company uuid; v_bounds jsonb; v_saved uuid; v_effective uuid;
  v_authority uuid; v_temporary boolean; v_auto boolean; v_result jsonb;
begin
  if not private.is_active(v_uid) then raise exception 'not authenticated' using errcode='42501'; end if;
  select company_id into v_company from public.profiles where id=v_uid;
  v_bounds:=private.approval_bounds(v_company,p_start,p_end,p_unit,p_day_part,p_start_time,p_end_time);
  select id into v_saved from public.approval_delegations where principal_id=v_uid
    and source_request_id is null and revoked_at is null and private.delegate_eligible(v_uid,delegate_id);
  select id into v_effective from private.effective_approval_delegate(v_uid);
  -- FR-90: a replacement is a name on the paper form and never receives approval authority.
  v_temporary:=false;
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
    'replacement_id',p_replacement_id,'start',p_start,'end',p_end,'unit',p_unit,'day_part',p_day_part,
    'start_time',p_start_time,'end_time',p_end_time);
  return v_result||jsonb_build_object('preview_token',md5(v_result::text));
end; $$;

-- Any temporary grant created from a replacement before this migration stops working.
update public.approval_delegations
   set revoked_at = now()
 where source_request_id is not null and revoked_at is null;
