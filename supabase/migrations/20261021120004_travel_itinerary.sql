-- FR-73 (2026-10-21): structured travel itinerary.
-- Spec: docs/specs/2026-10-21-travel-itinerary-design.md
--
-- Procurement records the flight legs (or the company car) and the hotel stays
-- in their own fields; the free-text note stays for anything else. Stored as
-- one jsonb column (Gregorian ISO dates, HH:MM times), checked here.
--
-- Release safety: the old app keeps calling app_save_travel_booking (which
-- leaves itinerary alone) and my_travel_bookings; app_travel_booking keeps its
-- signature and only gains a key. All new functions are add-only.

alter table public.travel_bookings add column itinerary jsonb;
comment on column public.travel_bookings.itinerary is
  'FR-73: flight legs or company car, hotel stays. NULL on bookings saved before FR-73. Checked by private.travel_itinerary_check.';

-- One object's text fields: known keys, strings, length, dates in the trip
-- window, HH:MM times. p_long names the one key allowed 200 characters.
create function private.travel_itinerary_fields(p_obj jsonb, p_keys text[], p_lo date, p_hi date, p_long text default null)
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  s text;
  d date;
begin
  if jsonb_typeof(p_obj) is distinct from 'object' then
    raise exception 'invalid itinerary' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_obj) loop
    if not (k = any(p_keys)) or jsonb_typeof(v) <> 'string' then
      raise exception 'invalid itinerary' using errcode = '22023';
    end if;
    s := v #>> '{}';
    if char_length(s) > (case when k = p_long then 200 else 100 end) then
      raise exception 'itinerary text is too long' using errcode = '22023';
    end if;
    if k in ('date', 'pickup_date', 'return_date', 'check_in', 'check_out') then
      if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid itinerary date' using errcode = '22023'; end if;
      begin
        d := s::date;
      exception when others then
        raise exception 'invalid itinerary date' using errcode = '22023';
      end;
      if to_char(d, 'YYYY-MM-DD') <> s then raise exception 'invalid itinerary date' using errcode = '22023'; end if;
      if d < p_lo or d > p_hi then raise exception 'itinerary date is outside the trip' using errcode = '22023'; end if;
    end if;
    if k in ('departs', 'arrives', 'pickup_time', 'return_time') and s !~ '^([01]\d|2[0-3]):[0-5]\d$' then
      raise exception 'invalid itinerary time' using errcode = '22023';
    end if;
  end loop;
end; $$;

-- The whole itinerary, plus what «رزرو شد» needs (mirrors lib/travel/itinerary.ts).
create function private.travel_itinerary_check(p_it jsonb, p_transport text, p_done boolean, p_start date, p_end date)
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  f jsonb;
  s jsonb;
  v_lo date := p_start - 7;
  v_hi date := p_end + 7;
  v_one_way boolean;
  v_no_hotel boolean;
  v_dir text;
begin
  if p_it is null then
    if p_done then raise exception 'itinerary is required' using errcode = '22023'; end if;
    return;
  end if;
  if jsonb_typeof(p_it) <> 'object' then raise exception 'invalid itinerary' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(p_it) loop
    if k not in ('one_way', 'booking_ref', 'flights', 'car', 'no_hotel', 'stays')
       or (k in ('one_way', 'no_hotel') and jsonb_typeof(v) <> 'boolean')
       or (k = 'booking_ref' and jsonb_typeof(v) <> 'string')
       or (k in ('flights', 'stays') and jsonb_typeof(v) <> 'array')
       or (k = 'car' and jsonb_typeof(v) <> 'object') then
      raise exception 'invalid itinerary' using errcode = '22023';
    end if;
  end loop;
  v_one_way := coalesce((p_it ->> 'one_way')::boolean, false);
  v_no_hotel := coalesce((p_it ->> 'no_hotel')::boolean, false);
  if char_length(p_it ->> 'booking_ref') > 100 then
    raise exception 'itinerary text is too long' using errcode = '22023';
  end if;
  if (p_it ? 'flights' and p_transport is distinct from 'flight')
     or (p_it ? 'car' and p_transport is distinct from 'company_car') then
    raise exception 'itinerary does not match the transport' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_it -> 'flights', '[]')) > 2
     or (select count(distinct x ->> 'leg') from jsonb_array_elements(coalesce(p_it -> 'flights', '[]')) x)
        <> jsonb_array_length(coalesce(p_it -> 'flights', '[]')) then
    raise exception 'invalid itinerary' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_it -> 'flights', '[]')) loop
    if jsonb_typeof(f) <> 'object' or coalesce(f ->> 'leg', '') not in ('outbound', 'return')
       or (v_one_way and f ->> 'leg' = 'return') then
      raise exception 'invalid itinerary' using errcode = '22023';
    end if;
    perform private.travel_itinerary_fields(f - 'leg',
      array['airline', 'flight_no', 'from', 'to', 'date', 'departs', 'arrives'], v_lo, v_hi);
  end loop;
  if p_it ? 'car' then
    perform private.travel_itinerary_fields(p_it -> 'car',
      array['vehicle', 'plate', 'driver_name', 'driver_mobile', 'pickup_place', 'pickup_date', 'pickup_time',
            'return_place', 'return_date', 'return_time'], v_lo, v_hi);
  end if;

  if v_no_hotel and p_it ? 'stays' then raise exception 'invalid itinerary' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_it -> 'stays', '[]')) > 10 then
    raise exception 'too many hotel stays' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_it -> 'stays', '[]')) loop
    perform private.travel_itinerary_fields(s,
      array['name', 'address', 'phone', 'check_in', 'check_out', 'confirmation'], v_lo, v_hi, 'address');
    if s ? 'check_in' and s ? 'check_out' and (s ->> 'check_out')::date <= (s ->> 'check_in')::date then
      raise exception 'check-out must be after check-in' using errcode = '22023';
    end if;
  end loop;

  if p_done then
    if p_transport = 'flight' then
      foreach v_dir in array (case when v_one_way then array['outbound'] else array['outbound', 'return'] end) loop
        if not exists (
          select 1 from jsonb_array_elements(coalesce(p_it -> 'flights', '[]')) x
           where x ->> 'leg' = v_dir and x ? 'flight_no' and x ? 'date' and x ? 'departs') then
          raise exception 'flight details are required' using errcode = '22023';
        end if;
      end loop;
    end if;
    if not v_no_hotel and (
         jsonb_array_length(coalesce(p_it -> 'stays', '[]')) = 0
         or exists (select 1 from jsonb_array_elements(p_it -> 'stays') x
                     where not (x ? 'name' and x ? 'check_in' and x ? 'check_out'))) then
      raise exception 'hotel details are required' using errcode = '22023';
    end if;
  end if;
end; $$;

revoke all on function private.travel_itinerary_fields(jsonb, text[], date, date, text) from public;
revoke all on function private.travel_itinerary_check(jsonb, text, boolean, date, date) from public;

-- app_save_travel_booking + the itinerary (same rules otherwise).
create function public.app_save_travel_booking_v2(
  p_request uuid, p_transport text, p_flight bigint, p_hotel bigint, p_itinerary jsonb, p_note text, p_done boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
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
  perform private.travel_itinerary_check(p_itinerary, p_transport, p_done, r.start_date, r.end_date);
  if coalesce((p_itinerary ->> 'no_hotel')::boolean, false) and coalesce(p_hotel, 0) <> 0 then
    raise exception 'no hotel means a hotel cost of 0' using errcode = '22023';
  end if;

  update public.travel_bookings
     set transport = p_transport, flight_cost_rials = p_flight, hotel_cost_rials = p_hotel,
         itinerary = p_itinerary,
         traveller_note = v_note, first_saved_at = coalesce(first_saved_at, now()),
         done_by = case when p_done then v_uid else done_by end,
         done_at = case when p_done then now() else done_at end,
         updated_at = now()
   where request_id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'travel_booking.save', 'leave_requests', p_request,
          jsonb_build_object('done', p_done, 'transport', p_transport,
                             'flight_cost_rials', p_flight, 'hotel_cost_rials', p_hotel,
                             'itinerary_keys', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                                                  from jsonb_object_keys(coalesce(p_itinerary, '{}')) k)));
end; $$;

revoke all on function public.app_save_travel_booking_v2(uuid, text, bigint, bigint, jsonb, text, boolean) from public, anon;
grant execute on function public.app_save_travel_booking_v2(uuid, text, bigint, bigint, jsonb, text, boolean) to authenticated;

-- Procurement's detail read gains the itinerary (same signature).
create or replace function public.app_travel_booking(p_request uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
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
    'itinerary', b.itinerary,
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

-- The traveller's view: same rows as my_travel_bookings(), with the itinerary.
create function public.my_travel_itineraries()
returns table (request_id uuid, transport text, itinerary jsonb, traveller_note text)
language sql stable security definer
set search_path = ''
as $$
  select b.request_id, b.transport, b.itinerary, b.traveller_note
    from public.travel_bookings b
    join public.leave_requests r on r.id = b.request_id
   where r.employee_id = auth.uid() and r.status = 'approved' and b.first_done_at is not null;
$$;

revoke all on function public.my_travel_itineraries() from public, anon;
grant execute on function public.my_travel_itineraries() to authenticated;
