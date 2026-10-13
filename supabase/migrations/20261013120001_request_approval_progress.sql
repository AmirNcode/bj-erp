-- FR-64 (2026-10-13): a requester follows their request through the approval
-- chain — every step in order, who signed it and when, and who it still waits on.
--
-- A requester cannot read most approvers' profiles (an employee reads only their
-- own team), so names come from this guarded SECURITY DEFINER function rather
-- than client joins. It answers only for a request the caller may already read
-- (mirrors leave_requests_select) and returns names and timestamps, never
-- signatures or notes.
--
-- Rows: every recorded decision (so a decided request shows exactly who signed,
-- even if the chain was reconfigured since), plus — while the request is still
-- pending — each active applicable step not yet decided, with the person it
-- waits on when that is one person (direct manager, department manager, named
-- approver). A role step (hr) has no single person: expected_name is null.

create or replace function public.request_approval_progress(p_id uuid)
returns table(
  step_order int,
  step_role public.app_role,
  manager_scope text,
  named boolean,
  expected_name text,
  decision public.leave_status,
  signer_name text,
  signed_at timestamptz
)
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_company uuid;
  v_kind    public.request_kind;
  v_status  public.leave_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select r.employee_id, r.company_id, r.kind, r.status
    into v_emp, v_company, v_kind, v_status
    from public.leave_requests r where r.id = p_id;
  if v_emp is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if not (private.is_active(v_uid)
          and (v_emp = v_uid
               or private.is_manager_of(v_uid, v_emp)
               or private.has_role(v_uid, 'security')
               or private.is_admin(v_uid)
               or private.has_role(v_uid, 'hr'))) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  return query
  with decided as (
    select coalesce(s.step_order, 1) as step_order,
           a.step_role,
           coalesce(s.manager_scope, 'direct') as manager_scope,
           s.approver_id,
           a.decision,
           sp.full_name as signer_name,
           a.created_at as signed_at,
           a.step_id
      from public.leave_request_approvals a
      left join public.approval_steps s on s.id = a.step_id
      left join public.profiles sp on sp.id = a.approver_id
     where a.request_id = p_id
  ),
  outstanding as (
    select s.step_order, s.role as step_role, s.manager_scope, s.approver_id
      from public.approval_steps s
     where v_status = 'pending'
       and s.company_id = v_company
       and s.active
       and v_kind = any(s.applies_to)
       and private.step_applies(s.manager_scope, v_emp)
       and not exists (
             select 1 from public.leave_request_approvals a
              where a.request_id = p_id
                and (a.step_id = s.id or (a.step_id is null and a.step_role = s.role)))
  ),
  -- No chain configured at all: a pending request waits on the direct manager
  -- (the FR-36 degrade branch of approve_leave_request).
  fallback as (
    select 1 as step_order, 'manager'::public.app_role as step_role,
           'direct'::text as manager_scope, null::uuid as approver_id
     where v_status = 'pending'
       and not exists (select 1 from outstanding)
       and not exists (select 1 from decided)
       and not exists (
             select 1 from public.approval_steps s
              where s.company_id = v_company and s.active
                and v_kind = any(s.applies_to)
                and private.step_applies(s.manager_scope, v_emp))
  ),
  waiting as (
    select * from outstanding
    union all
    select * from fallback
  )
  select d.step_order, d.step_role, d.manager_scope, d.approver_id is not null,
         -- A named step keeps its person's name even when an admin override signed it.
         (select np.full_name from public.profiles np where np.id = d.approver_id),
         d.decision, d.signer_name, d.signed_at
    from decided d
  union all
  select w.step_order, w.step_role, w.manager_scope, w.approver_id is not null,
         (select ep.full_name from public.profiles ep
           where ep.id = case
                           when w.approver_id is not null then w.approver_id
                           when w.step_role = 'manager' and w.manager_scope = 'department'
                             then private.department_manager_for(v_emp)
                           when w.step_role = 'manager'
                             then (select pm.manager_id from public.profiles pm where pm.id = v_emp)
                         end),
         null::public.leave_status, null::text, null::timestamptz
    from waiting w
  order by 1, 8 nulls last, 2;
end; $$;

revoke all on function public.request_approval_progress(uuid) from public;
grant execute on function public.request_approval_progress(uuid) to authenticated;
