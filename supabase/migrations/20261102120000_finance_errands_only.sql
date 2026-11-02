-- Finance sees work errands only (owner request, 2026-11-02).
--
-- /finance listed every request, leave included (20261020120007). Finance only
-- pays for work errands — hourly and daily — so public.finance_requests and the
-- legacy public.finance_approved_requests now return kind = 'errand' rows only.
-- Leave requests (type, dates, unpaid time) no longer reach the finance role at
-- all. Signatures and return types are unchanged; only the WHERE clause gains
-- the kind filter, so the running app keeps working across the release.

CREATE OR REPLACE FUNCTION public.finance_approved_requests(p_from date, p_to date) RETURNS TABLE(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text, personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text, leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit, start_time time without time zone, end_time time without time zone, requested_minutes integer, unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean, decided_at timestamp with time zone, status public.leave_status, travel_state text, transport text, flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint)
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
    select x.id, x.serial_year, x.serial_seq, x.kind, x.full_name, x.personnel_no, x.dname_fa, x.dname_en,
           x.tname_fa, x.tname_en, x.is_paid, x.start_date, x.end_date, x.unit, x.start_time, x.end_time,
           x.requested_minutes, x.unpaid_minutes, x.errand_location,
           case when x.status = 'cancelled' then null else x.per_diem_rials end,
           x.per_diem_by_requester, x.decided_at, x.status, x.st, x.transport,
           case when x.status = 'cancelled' then null else x.flight_cost_rials end,
           case when x.status = 'cancelled' then null else x.hotel_cost_rials end,
           x.lost_rials
      from (
        select r.id, r.serial_year, r.serial_seq, r.kind, p.full_name, p.personnel_no,
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
           and r.status in ('approved', 'cancelled')
           and r.start_date <= p_to
           and r.end_date >= p_from) x
     where (x.status = 'approved' and (x.st is null or x.st = 'done'))
        or (x.status = 'cancelled' and x.st = 'settled')
     order by x.start_date, x.serial_year, x.serial_seq;
end; $$;

CREATE OR REPLACE FUNCTION public.finance_requests(p_from date, p_to date) RETURNS TABLE(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text, personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text, leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit, start_time time without time zone, end_time time without time zone, requested_minutes integer, unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean, decided_at timestamp with time zone, status public.leave_status, travel_state text, transport text, flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, waiting_step text)
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
           and r.kind = 'errand'
           and r.status in ('approved', 'pending', 'cancelled')
           and r.start_date <= p_to
           and r.end_date >= p_from) x
     where x.status in ('approved', 'pending')
        or (x.status = 'cancelled' and x.st = 'settled')
     order by x.start_date, x.serial_year, x.serial_seq;
end; $$;
