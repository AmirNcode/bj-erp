-- =============================================================================
-- Migration: 20261020120005_travel_cancel_finance.sql
-- Purpose  : FR-70 — HR cancels travel-booked trips; a pending extension is
--            cancelled with its trip; procurement settles a cancelled booking with
--            the amount lost; /finance shows per diem, ticket, hotel and lost.
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md §7, §8
-- cancel_leave_request is recreated from the 20261019 schema.sql body with only
-- the marked FR-70 additions.
-- =============================================================================

create or replace function public.cancel_leave_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_company uuid;
  v_now timestamptz;
  v_status public.leave_status;
  v_start date;
  v_type uuid;
  v_kind public.request_kind;
  v_minutes int;
  v_unpaid int;
  v_paid int;
  v_affects boolean;
  v_prev int;
  v_rows int;
  v_today date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  select employee_id, company_id into v_owner, v_company from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (v_owner = v_uid
          or private.is_admin(v_uid)
          -- FR-55 D8: leave_requests at Allowed covers the company, apart from the admin.
          or (private.has_perm(v_uid, 'leave_requests', 'edit')
              and exists (select 1 from public.profiles o
                            join public.profiles c on c.company_id = o.company_id and c.id = v_uid
                           where o.id = v_owner)
              and not exists (select 1 from public.user_roles where user_id = v_owner and role = 'admin'))
          -- FR-70: HR cancels travel-booked trips (the manager tells HR; spec §7).
          or (private.is_travel_hr(v_uid, p_id)
              and exists (select 1 from public.travel_bookings b where b.request_id = p_id))) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform private.approval_lock(v_company);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes, unpaid_minutes, kind
    into v_status, v_start, v_type, v_minutes, v_unpaid, v_kind
    from public.leave_requests where id = p_id for update;
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Asia/Tehran')::date;
  if not private.is_active(v_uid) or not exists (
      select 1 from public.profiles where id=v_uid and company_id=v_company) then
    raise exception 'not allowed to cancel this request' using errcode='42501';
  end if;
  if not (v_owner = v_uid
          or private.is_admin(v_uid)
          or (private.has_perm(v_uid, 'leave_requests', 'edit')
              and exists (select 1 from public.profiles o
                            join public.profiles c on c.company_id=o.company_id and c.id=v_uid
                           where o.id=v_owner)
              and not exists (select 1 from public.user_roles where user_id=v_owner and role='admin'))
          or (private.is_travel_hr(v_uid, p_id)
              and exists (select 1 from public.travel_bookings b where b.request_id = p_id))) then
    raise exception 'not allowed to cancel this request' using errcode='42501';
  end if;
  v_paid := greatest(v_minutes - coalesce(v_unpaid, 0), 0);

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = v_now
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;
  elsif v_status = 'approved'
        and (v_start > v_today or (v_kind = 'errand' and v_start >= v_today))
  then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = v_now
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects and v_paid > 0 then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      ) values (
        v_owner, v_type, p_id, 'reversal',
        v_paid, v_prev + v_paid, 'paid portion reversed on cancel'
      );
    end if;
  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled'
      using errcode = '22023';
  end if;

  -- FR-70: an extension still waiting for HR goes with the trip.
  update public.errand_extensions
     set status = 'cancelled', decided_by = v_uid, decided_at = v_now
   where request_id = p_id and status = 'pending';

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'cancel_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'status_before', v_status,
      'requested_minutes', v_minutes,
      'paid_minutes_reversed', case when v_status = 'approved' then v_paid else 0 end,
      'unpaid_minutes', v_unpaid,
      'kind', v_kind,
      'reversed', (
        v_status = 'approved' and coalesce(v_affects, false) and v_paid > 0
      )
    )
  );
end;
$$;


create or replace function public.app_settle_travel_booking(p_request uuid, p_lost bigint, p_note text) returns void
  language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
  b public.travel_bookings%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_procurement(v_uid, p_request) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_request;
  select * into b from public.travel_bookings where request_id = p_request for update;
  if b.request_id is null or private.travel_booking_state(r.status, b) <> 'cancel_undo' then
    raise exception 'only a cancelled booking can be settled' using errcode = '22023';
  end if;
  if p_lost is null or p_lost < 0 then raise exception 'amount lost must be 0 or more' using errcode = '22023'; end if;
  if char_length(v_note) > 500 then raise exception 'note is too long' using errcode = '22023'; end if;
  update public.travel_bookings
     set lost_rials = p_lost, lost_note = v_note, settled_by = v_uid, settled_at = now(), updated_at = now()
   where request_id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'travel_booking.settle', 'leave_requests', p_request, jsonb_build_object('lost_rials', p_lost));
end; $$;
revoke all on function public.app_settle_travel_booking(uuid, bigint, text) from public, anon;
grant execute on function public.app_settle_travel_booking(uuid, bigint, text) to authenticated;

-- /finance: approved requests as before, except a travel-booked trip appears only
-- once procurement has booked it; plus cancelled travel trips with what was lost.
drop function if exists public.finance_approved_requests(date, date);
create function public.finance_approved_requests(p_from date, p_to date)
  returns table(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text,
                personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text,
                leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit,
                start_time time without time zone, end_time time without time zone, requested_minutes integer,
                unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean,
                decided_at timestamp with time zone, status public.leave_status, travel_state text, transport text,
                flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint)
  language plpgsql stable security definer set search_path to '' as $$
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
           and r.status in ('approved', 'cancelled')
           and r.start_date <= p_to
           and r.end_date >= p_from) x
     where (x.status = 'approved' and (x.st is null or x.st = 'done'))
        or (x.status = 'cancelled' and x.st = 'settled')
     order by x.start_date, x.serial_year, x.serial_seq;
end; $$;
revoke all on function public.finance_approved_requests(date, date) from public, anon;
grant execute on function public.finance_approved_requests(date, date) to authenticated;
