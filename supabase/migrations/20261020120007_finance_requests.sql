-- FR-62 / FR-70 (owner review, 2026-10-20): /finance lists every request in the
-- range, approved AND pending, leave and errands.
--
-- New function: public.finance_requests(from, to). finance_approved_requests stays
-- exactly as migration 20261020120005 left it, because the old app keeps calling
-- it until the release swaps the app (add first, drop later).
--
-- Rows, by status:
--   approved  — every approved request. A travel-booked trip shows as soon as it is
--               approved, whether or not procurement has finished; travel_state
--               tells the app (done = booking finished). Costs are whatever
--               procurement has recorded so far (null = not recorded).
--   cancelled — only a travel trip whose booking procurement settled (amount
--               lost), as before; per diem and costs are hidden.
--   pending   — every pending request, with waiting_step: the label of the first
--               step still open ('manager', 'departmentManager', 'hr', 'ceo', …),
--               null when no step can be named. No approver names, signatures or
--               reason, like the rest of this function.

create or replace function public.finance_requests(p_from date, p_to date)
  returns table(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text,
                personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text,
                leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit,
                start_time time without time zone, end_time time without time zone, requested_minutes integer,
                unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean,
                decided_at timestamp with time zone, status public.leave_status, travel_state text, transport text,
                flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, waiting_step text)
  language plpgsql stable security definer set search_path to '' as $$
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
           end
      from (
        select r.id, r.company_id, r.employee_id, r.serial_year, r.serial_seq, r.kind, p.full_name, p.personnel_no,
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
           and r.status in ('approved', 'pending', 'cancelled')
           and r.start_date <= p_to
           and r.end_date >= p_from) x
     where x.status in ('approved', 'pending')
        or (x.status = 'cancelled' and x.st = 'settled')
     order by x.start_date, x.serial_year, x.serial_seq;
end; $$;
revoke all on function public.finance_requests(date, date) from public, anon;
grant execute on function public.finance_requests(date, date) to authenticated;

notify pgrst, 'reload schema';
