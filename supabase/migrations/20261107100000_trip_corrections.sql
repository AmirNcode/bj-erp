-- FR-84: HR corrects the dates and per diem of an approved daily work trip. The signed
-- request stays as it was signed: each correction is an append-only row with the old and
-- new values, and the print form shows the signed values first.

create table public.request_corrections (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.leave_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  old_start_date date not null,
  new_start_date date not null,
  old_end_date date not null,
  new_end_date date not null,
  per_diem_before bigint,
  per_diem_after bigint,
  reason text not null check (char_length(reason) between 1 and 1000),
  corrected_by uuid references public.profiles(id) on delete set null,
  corrected_at timestamptz not null default clock_timestamp(),
  signature_data text not null,
  signature_consent_at timestamptz not null,
  constraint request_corrections_dates check (new_start_date <= new_end_date)
);
create index request_corrections_request on public.request_corrections (request_id, corrected_at desc);
comment on table public.request_corrections is
  'FR-84: one row per correction of an approved daily trip. Append-only; RPCs only.';
alter table public.request_corrections enable row level security;
revoke all on public.request_corrections from anon, authenticated;

create or replace function private.travel_booking_state(p_status public.leave_status, b public.travel_bookings) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when p_status = 'pending' then 'awaiting_approval'
    when p_status = 'approved' and b.opened_at is null then 'awaiting_approval'
    when p_status = 'approved' and b.done_at is not null then 'done'
    when p_status = 'approved' and exists (
      select 1 from public.request_corrections c
       where c.request_id = b.request_id and c.corrected_at >= b.opened_at
         and (c.old_start_date, c.old_end_date) is distinct from (c.new_start_date, c.new_end_date)
         and c.corrected_at > coalesce((select max(e.decided_at) from public.errand_extensions e
                                         where e.request_id = b.request_id and e.status = 'approved'),
                                       '-infinity'::timestamptz))
      then 'corrected'
    when p_status = 'approved' and exists (
      select 1 from public.errand_extensions e
       where e.request_id = b.request_id and e.status = 'approved' and e.decided_at >= b.opened_at)
      then 'extension'
    when p_status = 'approved' then 'to_book'
    when p_status = 'cancelled' and b.opened_at is null then 'hidden'
    when p_status = 'cancelled' and b.settled_at is null then 'cancel_undo'
    when p_status = 'cancelled' then 'settled'
    else 'hidden' end;
$$;

create or replace function private.travel_booking_open_for_details(p_state text, p_end date) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select p_state in ('to_book', 'extension', 'corrected', 'cancel_undo')
      or (p_state = 'done' and p_end >= (now() at time zone 'Asia/Tehran')::date);
$$;

create or replace function public.my_travel_pending() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select r.id
    from public.travel_bookings b
    join public.leave_requests r on r.id = b.request_id
   where r.employee_id = auth.uid()
     and r.status = 'approved'
     and private.travel_booking_state(r.status, b) in ('to_book', 'extension', 'corrected');
$$;

create or replace function public.app_save_travel_booking(p_request uuid, p_transport text, p_flight bigint, p_hotel bigint, p_note text, p_done boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  if not (v_state in ('to_book', 'extension', 'corrected')
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

create or replace function public.app_save_travel_booking_v2(p_request uuid, p_transport text, p_flight bigint, p_hotel bigint, p_itinerary jsonb, p_note text, p_done boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
  if not (v_state in ('to_book', 'extension', 'corrected')
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
end; $_$;

create or replace function public.app_travel_booking(p_request uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    'last_correction', (
      select jsonb_build_object('old_start_date', c.old_start_date, 'old_end_date', c.old_end_date,
                                'new_start_date', c.new_start_date, 'new_end_date', c.new_end_date,
                                'reason', c.reason)
        from public.request_corrections c
       where c.request_id = r.id
         and (c.old_start_date, c.old_end_date) is distinct from (c.new_start_date, c.new_end_date)
       order by c.corrected_at desc limit 1),
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

drop function public.finance_requests(date, date);
create function public.finance_requests(p_from date, p_to date) RETURNS TABLE(id uuid, serial_year integer, serial_seq integer, kind public.request_kind, employee_name text, personnel_no text, department_name_fa text, department_name_en text, leave_type_name_fa text, leave_type_name_en text, is_paid boolean, start_date date, end_date date, unit public.leave_unit, start_time time without time zone, end_time time without time zone, requested_minutes integer, unpaid_minutes integer, errand_location text, per_diem_rials bigint, per_diem_by_requester boolean, decided_at timestamp with time zone, status public.leave_status, travel_state text, transport text, flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, waiting_step text, corrected_at timestamp with time zone)
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
           (select max(c.corrected_at) from public.request_corrections c where c.request_id = x.id)
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
revoke all on function public.finance_requests(date, date) from public, anon;
grant execute on function public.finance_requests(date, date) to authenticated, service_role;

create function public.app_correct_trip(
  p_request uuid, p_new_start date, p_new_end date, p_per_diem_rials bigint, p_reason text,
  p_signature_data text, p_signature_authorized boolean
) returns uuid
    language plpgsql security definer
    set search_path to ''
    as $_$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  r public.leave_requests%rowtype;
  v_start date;
  v_end date;
  v_per_diem bigint;
  v_dates_changed boolean;
  v_per_diem_changed boolean;
  v_now timestamptz;
  v_id uuid;
begin
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not private.is_travel_hr(v_uid, p_request) then
    raise exception 'not allowed to correct this trip' using errcode = '42501';
  end if;
  if not coalesce(p_signature_authorized, false) or p_signature_data is null
     or p_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if p_per_diem_rials < 0 then raise exception 'per diem must be 0 or more' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 1000 then raise exception 'reason is too long' using errcode = '22023'; end if;

  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  if not private.is_travel_hr(v_uid, p_request) then
    raise exception 'not allowed to correct this trip' using errcode = '42501';
  end if;

  if r.status <> 'approved' or r.kind <> 'errand' or r.unit <> 'day' then
    raise exception 'only an approved daily trip can be corrected' using errcode = '22023';
  end if;
  if exists (select 1 from public.errand_extensions where request_id = p_request and status = 'pending') then
    raise exception 'an extension is waiting for HR' using errcode = '22023';
  end if;

  v_start := coalesce(p_new_start, r.start_date);
  v_end := coalesce(p_new_end, r.end_date);
  v_per_diem := coalesce(p_per_diem_rials, r.per_diem_rials);
  v_dates_changed := (v_start, v_end) is distinct from (r.start_date, r.end_date);
  v_per_diem_changed := v_per_diem is distinct from r.per_diem_rials;

  if not v_dates_changed and not v_per_diem_changed then
    raise exception 'nothing to correct' using errcode = '22023';
  end if;
  if v_start > v_end then
    raise exception 'start date must not be after end date' using errcode = '22023';
  end if;
  if v_dates_changed and private.extension_overlaps(r.id, r.employee_id, v_start, v_end) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  insert into public.request_corrections (
    request_id, company_id, old_start_date, new_start_date, old_end_date, new_end_date,
    per_diem_before, per_diem_after, reason, corrected_by, corrected_at,
    signature_data, signature_consent_at
  ) values (
    r.id, r.company_id, r.start_date, v_start, r.end_date, v_end,
    r.per_diem_rials, v_per_diem, v_reason, v_uid, v_now, p_signature_data, v_now
  ) returning id into v_id;

  update public.leave_requests
     set start_date = v_start,
         end_date = v_end,
         requested_minutes = case when v_dates_changed
           then public.compute_requested_minutes(r.company_id, v_start, v_end, 'full', 'day', null, null, 'errand')
           else requested_minutes end,
         per_diem_rials = v_per_diem,
         per_diem_by_requester = case when v_per_diem_changed then false else per_diem_by_requester end
   where id = r.id;

  if v_dates_changed then
    update public.travel_bookings set done_at = null, done_by = null, updated_at = now()
     where request_id = r.id and opened_at is not null;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'trip.correct', 'leave_requests', r.id,
          jsonb_build_object('start_date', r.start_date, 'end_date', r.end_date, 'per_diem_rials', r.per_diem_rials),
          jsonb_build_object('start_date', v_start, 'end_date', v_end, 'per_diem_rials', v_per_diem,
                             'correction_id', v_id));
  return v_id;
end $_$;

revoke all on function public.app_correct_trip(uuid, date, date, bigint, text, text, boolean) from public, anon;
grant execute on function public.app_correct_trip(uuid, date, date, bigint, text, text, boolean) to authenticated, service_role;

create function public.request_trip_corrections(p_id uuid)
returns table(old_start_date date, new_start_date date, old_end_date date, new_end_date date,
              per_diem_before bigint, per_diem_after bigint, reason text,
              corrected_by_name text, corrected_at timestamptz)
    language plpgsql stable security definer
    set search_path to ''
    as $$
begin
  if not private.can_read_approval_request(auth.uid(), p_id) then
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

revoke all on function public.request_trip_corrections(uuid) from public, anon;
grant execute on function public.request_trip_corrections(uuid) to authenticated, service_role;
