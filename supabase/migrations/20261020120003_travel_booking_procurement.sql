-- =============================================================================
-- Migration: 20261020120003_travel_booking_procurement.sql
-- Purpose  : FR-70 — procurement's list and booking detail (with the traveller's
--            details read live), saving transport/costs/note, and the traveller's
--            own view of the note.
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md §3, §5
-- =============================================================================

-- travel_booking holders (or the admin) of the request's company, never on their own
-- trip. Deliberately no private.can_act_on: booking records costs on a request, and
-- procurement must be able to book for the CEO, the Head of HR or the admin (spec §3).
create or replace function private.is_procurement(p_uid uuid, p_request uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select p_uid is not null and private.is_active(p_uid)
     and exists (
       select 1 from public.leave_requests r
         join public.profiles c on c.id = p_uid and c.company_id = r.company_id
        where r.id = p_request and r.employee_id <> p_uid)
     and (private.is_admin(p_uid) or private.has_perm(p_uid, 'travel_booking', 'edit'));
$$;
revoke all on function private.is_procurement(uuid, uuid) from public, anon;
grant execute on function private.is_procurement(uuid, uuid) to authenticated;

-- Open = procurement still needs the traveller's details for this booking.
create or replace function private.travel_booking_open_for_details(p_state text, p_end date) returns boolean
  language sql stable set search_path to '' as $$
  select p_state in ('to_book', 'extension', 'cancel_undo')
      or (p_state = 'done' and p_end >= (now() at time zone 'Asia/Tehran')::date);
$$;

create or replace function public.app_travel_bookings()
  returns table(request_id uuid, serial_year integer, serial_seq integer, employee_name text,
                personnel_no text, department_name_fa text, department_name_en text,
                errand_location text, start_date date, end_date date, state text, transport text,
                flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, done_at timestamptz)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid)
     or not (private.is_admin(v_uid) or private.has_perm(v_uid, 'travel_booking', 'edit')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select * from (
      select r.id, r.serial_year, r.serial_seq, p.full_name, p.personnel_no, d.name_fa, d.name_en,
             r.errand_location, r.start_date, r.end_date, private.travel_booking_state(r.status, b) as st,
             b.transport, b.flight_cost_rials, b.hotel_cost_rials, b.lost_rials, b.done_at
        from public.travel_bookings b
        join public.leave_requests r on r.id = b.request_id
        join public.profiles c on c.id = v_uid and c.company_id = b.company_id
        join public.profiles p on p.id = r.employee_id
        left join public.departments d on d.id = p.department_id
       where r.employee_id <> v_uid) x
     where x.st not in ('awaiting_approval', 'hidden')
     order by x.start_date, x.serial_year, x.serial_seq;
end; $$;
revoke all on function public.app_travel_bookings() from public, anon;
grant execute on function public.app_travel_bookings() to authenticated;

create or replace function public.app_travel_booking(p_request uuid) returns jsonb
  language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
  b public.travel_bookings%rowtype;
  p public.profiles%rowtype;
  i public.employee_personal_info%rowtype;
  v_state text;
  v_out jsonb;
  v_traveller jsonb := '{}';
  f text;
begin
  if not private.is_procurement(v_uid, p_request) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into b from public.travel_bookings where request_id = p_request;
  select * into r from public.leave_requests where id = p_request;
  v_state := case when b.request_id is null then 'hidden' else private.travel_booking_state(r.status, b) end;
  if v_state in ('awaiting_approval', 'hidden') then
    raise exception 'no booking for this request' using errcode = '22023';
  end if;
  select * into p from public.profiles where id = r.employee_id;

  v_out := jsonb_build_object(
    'request_id', r.id, 'serial_year', r.serial_year, 'serial_seq', r.serial_seq,
    'employee_name', p.full_name, 'personnel_no', p.personnel_no,
    'department_name_fa', (select name_fa from public.departments where id = p.department_id),
    'department_name_en', (select name_en from public.departments where id = p.department_id),
    'errand_location', r.errand_location, 'description', r.reason,
    'start_date', r.start_date, 'end_date', r.end_date, 'status', r.status, 'state', v_state,
    'transport', b.transport, 'flight_cost_rials', b.flight_cost_rials,
    'hotel_cost_rials', b.hotel_cost_rials, 'traveller_note', b.traveller_note,
    'lost_rials', b.lost_rials, 'lost_note', b.lost_note, 'done_at', b.done_at,
    'extensions', coalesce((
      select jsonb_agg(jsonb_build_object('old_end_date', e.old_end_date, 'new_end_date', e.new_end_date,
               'reason', e.reason, 'status', e.status, 'decided_at', e.decided_at) order by e.requested_at)
        from public.errand_extensions e where e.request_id = r.id and e.status = 'approved'), '[]'::jsonb));

  if private.travel_booking_open_for_details(v_state, r.end_date) then
    select * into i from public.employee_personal_info where employee_id = p.id;
    foreach f in array private.travel_traveller_fields() loop
      v_traveller := v_traveller || jsonb_build_object(f,
        case f when 'full_name' then to_jsonb(p.full_name) else to_jsonb(i) -> f end);
    end loop;
    v_out := v_out || jsonb_build_object('traveller', v_traveller);
  end if;
  return v_out;
end; $$;
revoke all on function public.app_travel_booking(uuid) from public, anon;
grant execute on function public.app_travel_booking(uuid) to authenticated;

create or replace function public.app_save_travel_booking(p_request uuid, p_transport text, p_flight bigint,
    p_hotel bigint, p_note text, p_done boolean) returns void
  language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
  b public.travel_bookings%rowtype;
  v_state text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_procurement(v_uid, p_request) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_request;
  select * into b from public.travel_bookings where request_id = p_request for update;
  if b.request_id is null then raise exception 'no booking for this request' using errcode = '22023'; end if;
  v_state := private.travel_booking_state(r.status, b);
  if not (v_state in ('to_book', 'extension')
          or (v_state = 'done' and r.end_date >= (now() at time zone 'Asia/Tehran')::date)) then
    raise exception 'booking cannot be changed now' using errcode = '22023';
  end if;
  if p_transport is not null and p_transport not in ('flight', 'company_car') then
    raise exception 'invalid transport' using errcode = '22023';
  end if;
  if p_flight < 0 or p_hotel < 0 then raise exception 'costs must be 0 or more' using errcode = '22023'; end if;
  if char_length(v_note) > 500 then raise exception 'note is too long' using errcode = '22023'; end if;
  if p_done and (p_transport is null or p_flight is null or p_hotel is null) then
    raise exception 'transport and both costs are required' using errcode = '22023';
  end if;
  if v_state = 'done' and not p_done then
    raise exception 'a finished booking stays finished' using errcode = '22023';
  end if;

  update public.travel_bookings
     set transport = p_transport, flight_cost_rials = p_flight, hotel_cost_rials = p_hotel,
         traveller_note = v_note, first_saved_at = coalesce(first_saved_at, now()),
         done_by = case when p_done then v_uid else done_by end,
         done_at = case when p_done then now() else done_at end,
         updated_at = now()
   where request_id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'travel_booking.save', 'leave_requests', p_request,
          jsonb_build_object('done', p_done, 'transport', p_transport,
                             'flight_cost_rials', p_flight, 'hotel_cost_rials', p_hotel));
end; $$;
revoke all on function public.app_save_travel_booking(uuid, text, bigint, bigint, text, boolean) from public, anon;
grant execute on function public.app_save_travel_booking(uuid, text, bigint, bigint, text, boolean) to authenticated;

-- The traveller's own finished bookings: transport and note, never costs.
create or replace function public.my_travel_bookings()
  returns table(request_id uuid, transport text, traveller_note text)
  language sql stable security definer set search_path to '' as $$
  select b.request_id, b.transport, b.traveller_note
    from public.travel_bookings b
    join public.leave_requests r on r.id = b.request_id
   where r.employee_id = auth.uid() and r.status = 'approved' and b.done_at is not null;
$$;
revoke all on function public.my_travel_bookings() from public, anon;
grant execute on function public.my_travel_bookings() to authenticated;
