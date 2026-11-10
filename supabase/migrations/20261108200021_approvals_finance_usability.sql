-- Approvals consolidation and scoped Finance form reads. Existing public RPCs remain compatible.


CREATE OR REPLACE FUNCTION private.permission_keys() RETURNS SETOF text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking']);
$$;

CREATE OR REPLACE FUNCTION private.permission_allows(p_key text, p_level text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate','travel_booking') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays') then p_level in ('read','edit')
    else false end;
$$;

CREATE OR REPLACE FUNCTION private.permission_deps() RETURNS TABLE(key text, key_level text, needs text)
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  values
    ('finance_forms','read','finance'),
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

CREATE FUNCTION private.can_print_finance_request(p_uid uuid, p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
select coalesce(private.is_active(p_uid)
  and private.has_perm(p_uid,'finance','read') and private.has_perm(p_uid,'finance_forms','read')
  and exists(select 1 from public.leave_requests r
    join public.profiles viewer on viewer.id=p_uid and viewer.company_id=r.company_id
    left join public.travel_bookings b on b.request_id=r.id
    where r.id=p_id and r.kind='errand' and (r.status in ('pending','approved')
      or (r.status='cancelled' and private.travel_booking_state(r.status,b)='settled'))),false);
$$;
REVOKE ALL ON FUNCTION private.can_print_finance_request(uuid,uuid) FROM PUBLIC, anon, authenticated;


CREATE FUNCTION private.request_data_app_request_approval_progress(p_id uuid, p_print boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
        'per_diem_allowed',v_allowed and s.role='hr' and r.kind='errand' and r.unit='day','is_mine',v_allowed);
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

REVOKE ALL ON FUNCTION private.request_data_app_request_approval_progress(uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_request_approval_progress(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 select private.request_data_app_request_approval_progress(p_id,false);
$$;

CREATE FUNCTION private.request_data_app_request_approval_context(p_id uuid, p_print boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; v_progress jsonb; v_result jsonb;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode='P0002'; end if;
  select * into r from public.leave_requests where id=p_id;
  v_progress:=private.request_data_app_request_approval_progress(p_id,p_print);
  select (to_jsonb(r)-'signature_data'-'approver_signature_data')||jsonb_build_object(
    'employee_name',p.full_name,'employee_code',p.employee_code,
    'personnel_no',p.personnel_no,
    'job_title',case when p_print or p.id=auth.uid() or private.reads_people(auth.uid())
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

REVOKE ALL ON FUNCTION private.request_data_app_request_approval_context(uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_request_approval_context(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 select private.request_data_app_request_approval_context(p_id,false);
$$;

CREATE FUNCTION private.request_data_get_leave_request_signatures(p_id uuid, p_print boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_result jsonb; v_progress jsonb;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode='P0002'; end if;
  v_progress:=private.request_data_app_request_approval_progress(p_id,p_print);
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

REVOKE ALL ON FUNCTION private.request_data_get_leave_request_signatures(uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_leave_request_signatures(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 select private.request_data_get_leave_request_signatures(p_id,false);
$$;

CREATE FUNCTION private.request_data_request_errand_extensions(p_id uuid, p_print boolean) RETURNS TABLE(old_end_date date, new_end_date date, reason text, status text, evidence text, requested_by_name text, decided_by_name text, decided_at timestamp with time zone, per_diem_before bigint, per_diem_after bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  return query
    select e.old_end_date, e.new_end_date, e.reason, e.status, e.evidence, q.full_name, d.full_name, e.decided_at,
           e.per_diem_before, e.per_diem_after
      from public.errand_extensions e
      join public.profiles q on q.id = e.requested_by
      left join public.profiles d on d.id = e.decided_by
     where e.request_id = p_id
     order by e.requested_at;
end; $$;

REVOKE ALL ON FUNCTION private.request_data_request_errand_extensions(uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_errand_extensions(p_id uuid) RETURNS TABLE(old_end_date date, new_end_date date, reason text, status text, evidence text, requested_by_name text, decided_by_name text, decided_at timestamp with time zone, per_diem_before bigint, per_diem_after bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 select * from private.request_data_request_errand_extensions(p_id,false);
$$;

CREATE FUNCTION private.request_data_request_trip_corrections(p_id uuid, p_print boolean) RETURNS TABLE(old_start_date date, new_start_date date, old_end_date date, new_end_date date, per_diem_before bigint, per_diem_after bigint, reason text, corrected_by_name text, corrected_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  return query
    select c.old_start_date, c.new_start_date, c.old_end_date, c.new_end_date,
           c.per_diem_before, c.per_diem_after, c.reason, p.full_name, c.corrected_at
      from public.request_corrections c
      left join public.profiles p on p.id = c.corrected_by
     where c.request_id = p_id
     order by c.corrected_at;
end $$;

REVOKE ALL ON FUNCTION private.request_data_request_trip_corrections(uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_trip_corrections(p_id uuid) RETURNS TABLE(old_start_date date, new_start_date date, old_end_date date, new_end_date date, per_diem_before bigint, per_diem_after bigint, reason text, corrected_by_name text, corrected_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 select * from private.request_data_request_trip_corrections(p_id,false);
$$;

CREATE FUNCTION public.app_request_print(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
select jsonb_build_object(
 'context',private.request_data_app_request_approval_context(p_id,true),
 'signatures',private.request_data_get_leave_request_signatures(p_id,true),
 'extensions',(select coalesce(jsonb_agg(e),'[]') from private.request_data_request_errand_extensions(p_id,true) e),
 'corrections',(select coalesce(jsonb_agg(c),'[]') from private.request_data_request_trip_corrections(p_id,true) c));
$$;
REVOKE ALL ON FUNCTION public.app_request_print(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_request_print(uuid) TO authenticated;


CREATE FUNCTION public.finance_requests_v2(p_from date, p_to date) RETURNS TABLE(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text, personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text, leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit, start_time time without time zone, end_time time without time zone, requested_minutes integer, unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean, decided_at timestamp with time zone, status public.leave_status, travel_state text, transport text, flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, waiting_step text, corrected_at timestamp with time zone, first_name text, last_name text, department_id uuid, can_print boolean)
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
  if not private.has_perm(v_uid, 'finance', 'read') then
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
    select x.id, x.serial_year, x.serial_seq, x.kind, x.full_name, x.personnel_no, x.dname_fa, x.dname_en,
           x.tname_fa, x.tname_en, x.is_paid, x.start_date, x.end_date, x.unit, x.start_time, x.end_time,
           x.requested_minutes, x.unpaid_minutes, x.errand_location,
           case when x.status = 'cancelled' then null else x.per_diem_rials end,
           x.per_diem_by_requester, x.decided_at, x.status, x.st, x.transport,
           case when x.status = 'cancelled' then null else x.flight_cost_rials end,
           case when x.status = 'cancelled' then null else x.hotel_cost_rials end,
           x.lost_rials,
           case when x.status = 'pending' then (
             -- Same open steps as app_request_approval_progress; label as progressLabel().
             select case when st.role = 'manager' and st.manager_scope = 'department' and st.approver_id is null
                         then 'departmentManager' else st.role::text end
               from public.approval_steps st
              where st.company_id = x.company_id and st.active and x.kind = any(st.applies_to)
                and private.step_applies(st.manager_scope, x.employee_id)
                and not private.request_step_decided(x.id, st.id)
                and not private.request_hr_exempt(x.id, st.id)
              order by st.step_order, st.id
              limit 1)
           end,
           (select max(c.corrected_at) from public.request_corrections c where c.request_id = x.id),
           x.first_name, x.last_name, x.department_id,
           private.can_read_approval_request(v_uid,x.id) or private.can_print_finance_request(v_uid,x.id)
      from (
        select r.id, r.company_id, r.employee_id, r.serial_year, r.serial_seq, r.kind, p.full_name, p.personnel_no, p.first_name, p.last_name, p.department_id,
               d.name_fa as dname_fa, d.name_en as dname_en, t.name_fa as tname_fa, t.name_en as tname_en, t.is_paid,
               r.start_date, r.end_date, r.unit, r.start_time, r.end_time, r.requested_minutes, r.unpaid_minutes,
               r.errand_location, r.per_diem_rials, r.per_diem_by_requester, r.decided_at, r.status,
               case when b.request_id is null then null else private.travel_booking_state(r.status, b) end as st,
               b.transport, b.flight_cost_rials, b.hotel_cost_rials, b.lost_rials
          from public.leave_requests r
          join public.profiles p on p.id = r.employee_id
          left join public.departments d on d.id = p.department_id
          left join public.leave_types t on t.id = r.leave_type_id
          left join public.travel_bookings b on b.request_id = r.id
         where r.company_id = v_company
           and r.kind = 'errand'
           and r.status in ('approved', 'pending', 'cancelled')
           and r.start_date <= p_to
           and r.end_date >= p_from) x
     where x.status in ('approved', 'pending')
        or (x.status = 'cancelled' and x.st = 'settled')
     order by x.start_date, x.serial_year, x.serial_seq;
end; $$;

REVOKE ALL ON FUNCTION public.finance_requests_v2(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_requests_v2(date,date) TO authenticated;

CREATE FUNCTION public.app_approval_history_v2(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_query text DEFAULT '', p_status text DEFAULT 'all', p_kind text DEFAULT 'all') RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with me as (
    select p.id, p.company_id, private.is_admin(p.id) as admin
      from public.profiles p
     where p.id = auth.uid() and private.is_active(p.id)
  ), hits as (
    select r.id, coalesce(r.decided_at, max(a.created_at), r.created_at) as decided_at
      from me
      join public.leave_requests r on r.company_id = me.company_id and r.status <> 'pending'
      left join public.leave_request_approvals a on a.request_id = r.id
     join public.profiles employee on employee.id=r.employee_id
     where (p_status='all' or r.status::text=p_status)
       and (p_kind='all' or r.kind::text=p_kind)
       and (coalesce(btrim(p_query),'')='' or position(lower(translate(btrim(p_query),'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789')) in lower(concat_ws(' ',employee.full_name,employee.personnel_no,r.serial_year::text||'-'||lpad(r.serial_seq::text,4,'0'))))>0)
       and (me.admin or private.has_perm(me.id,'leave_requests','read')
        or exists (select 1 from public.leave_request_approvals x
                    where x.request_id = r.id and x.approver_id = me.id))
     group by r.id
  ), page as (
    select * from hits order by decided_at desc, id
     limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'employee_id',r.employee_id, 'per_diem_rials',r.per_diem_rials,
        'day_part',r.day_part,'created_at',r.created_at,'signature_consent_at',r.signature_consent_at,
        'approver_signature_consent_at',r.approver_signature_consent_at,
        'kind', r.kind,
        'status', r.status,
        'serial_year', r.serial_year,
        'serial_seq', r.serial_seq,
        'employee_name', e.full_name,
        'personnel_no', e.personnel_no,
        'department_name_fa', d.name_fa,
        'department_name_en', d.name_en,
        'leave_type_name_fa', lt.name_fa,
        'leave_type_name_en', lt.name_en,
        'unit', r.unit,
        'start_date', r.start_date,
        'end_date', r.end_date,
        'start_time', r.start_time,
        'end_time', r.end_time,
        'requested_minutes', r.requested_minutes,
        'errand_location', r.errand_location,
        'decided_at', pg.decided_at,
        'my_decisions', coalesce((
          select jsonb_agg(jsonb_build_object('decision', a.decision, 'at', a.created_at, 'note', a.note)
                           order by a.created_at)
            from public.leave_request_approvals a
           where a.request_id = r.id and a.approver_id = auth.uid()), '[]'::jsonb)
      ) order by pg.decided_at desc, pg.id)
        from page pg
        join public.leave_requests r on r.id = pg.id
        join public.profiles e on e.id = r.employee_id
        left join public.departments d on d.id = e.department_id
        left join public.leave_types lt on lt.id = r.leave_type_id), '[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.app_approval_history_v2(integer,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_approval_history_v2(integer,integer,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.app_approval_queue(p_status public.leave_status DEFAULT 'pending'::public.leave_status) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_agg(public.app_request_approval_context(r.id) order by r.created_at),'[]')
    from public.leave_requests r where r.status=p_status and private.can_read_approval_request(auth.uid(),r.id)
      and (r.employee_id<>auth.uid() or private.is_admin(auth.uid()) or private.has_perm(auth.uid(),'leave_requests','read'));
$$;
