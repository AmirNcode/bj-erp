-- FR-73 amendment (2026-10-21): a hotel cost per stay, and their total.
--
-- Owner: each hotel stay gets its own cost; the total at the bottom is what
-- finance gets. Stays carry `cost_rials` (whole Rials, jsonb number) inside the
-- itinerary; `hotel_cost_rials` stays the column finance reads and must equal
-- the stays' sum. «رزرو شد» needs a cost on every stay. The traveller never sees
-- costs: my_travel_itineraries() strips them.
--
-- travel_itinerary_check is unchanged (it rejects unknown keys); v2 checks the
-- costs itself and hands the check a copy without them.

create function private.travel_itinerary_without_costs(p_it jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_it) = 'object' and jsonb_typeof(p_it -> 'stays') = 'array' then
      jsonb_set(p_it, '{stays}', coalesce((
        select jsonb_agg(case when jsonb_typeof(x) = 'object' then x - 'cost_rials' else x end order by n)
          from jsonb_array_elements(p_it -> 'stays') with ordinality as t(x, n)), '[]'::jsonb))
    else p_it
  end;
$$;

revoke all on function private.travel_itinerary_without_costs(jsonb) from public;

create or replace function public.app_save_travel_booking_v2(
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
  v_costed int;
  v_bad int;
  v_stays int;
  v_sum bigint;
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
  perform private.travel_itinerary_check(private.travel_itinerary_without_costs(p_itinerary),
                                         p_transport, p_done, r.start_date, r.end_date);
  if coalesce((p_itinerary ->> 'no_hotel')::boolean, false) and coalesce(p_hotel, 0) <> 0 then
    raise exception 'no hotel means a hotel cost of 0' using errcode = '22023';
  end if;
  -- Each stay's cost: a whole number of Rials; booked = every stay has one; the
  -- hotel cost finance reads is their total.
  select count(*) filter (where x ? 'cost_rials'),
         count(*) filter (where x ? 'cost_rials' and (jsonb_typeof(x -> 'cost_rials') <> 'number'
                            or (x ->> 'cost_rials') !~ '^[0-9]{1,15}$')),
         count(*),
         sum(case when (x ->> 'cost_rials') ~ '^[0-9]{1,15}$' then (x ->> 'cost_rials')::bigint end)
    into v_costed, v_bad, v_stays, v_sum
    from jsonb_array_elements(case when jsonb_typeof(p_itinerary -> 'stays') = 'array'
                                   then p_itinerary -> 'stays' else '[]'::jsonb end) x;
  if v_bad > 0 then raise exception 'invalid hotel cost' using errcode = '22023'; end if;
  if p_done and v_costed < v_stays then
    raise exception 'each hotel stay needs a cost' using errcode = '22023';
  end if;
  if v_costed > 0 and p_hotel is distinct from v_sum then
    raise exception 'hotel cost must be the total of the stays' using errcode = '22023';
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


create or replace function public.my_travel_itineraries()
returns table (request_id uuid, transport text, itinerary jsonb, traveller_note text)
language sql stable security definer
set search_path = ''
as $$
  select b.request_id, b.transport, private.travel_itinerary_without_costs(b.itinerary), b.traveller_note
    from public.travel_bookings b
    join public.leave_requests r on r.id = b.request_id
   where r.employee_id = auth.uid() and r.status = 'approved' and b.first_done_at is not null;
$$;
