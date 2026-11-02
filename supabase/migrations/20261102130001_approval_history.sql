-- Approvals history (owner, 2026-11-02; docs/plans/2026-11-02-manager-ux-batch.md §4).
--
-- app_approval_history: decided requests (approved, rejected, cancelled) the caller personally
-- approved or rejected a step of (leave_request_approvals.approver_id), newest decision first,
-- with the caller's own decisions. The admin sees every decided request of their company.
-- Paged: { total, rows }.

create function public.app_approval_history(p_limit integer default 20, p_offset integer default 0) returns jsonb
    language sql stable security definer
    set search_path to ''
    as $$
  with me as (
    select p.id, p.company_id, private.is_admin(p.id) as admin
      from public.profiles p
     where p.id = auth.uid() and private.is_active(p.id)
  ), hits as (
    select r.id, coalesce(r.decided_at, max(a.created_at), r.created_at) as decided_at
      from me
      join public.leave_requests r on r.company_id = me.company_id and r.status <> 'pending'
      left join public.leave_request_approvals a on a.request_id = r.id
     where me.admin
        or exists (select 1 from public.leave_request_approvals x
                    where x.request_id = r.id and x.approver_id = me.id)
     group by r.id
  ), page as (
    select * from hits order by decided_at desc, id
     limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
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

revoke all on function public.app_approval_history(integer, integer) from public, anon;
grant execute on function public.app_approval_history(integer, integer) to authenticated;
