-- =============================================================================
-- Migration: 20261020120002_travel_booking_tick.sql
-- Purpose  : FR-70 — HR marks a daily errand «نیاز به رزرو سفر» (at its HR step or
--            after approval), unmarks it before procurement starts, and is told which
--            traveller details are missing.
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md §3–§4
-- =============================================================================

-- Who may tick, untick, cancel a travel trip and decide its extensions: the admin
-- or an hr role holder of the request's company, never on their own request.
create or replace function private.is_travel_hr(p_uid uuid, p_request uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select p_uid is not null and private.is_active(p_uid)
     and exists (
       select 1 from public.leave_requests r
         join public.profiles c on c.id = p_uid and c.company_id = r.company_id
        where r.id = p_request and r.employee_id <> p_uid)
     and (private.is_admin(p_uid) or private.has_role(p_uid, 'hr'));
$$;
revoke all on function private.is_travel_hr(uuid, uuid) from public, anon;
grant execute on function private.is_travel_hr(uuid, uuid) to authenticated;

create or replace function public.app_set_travel_booking(p_request uuid, p_on boolean) returns void
  language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
  b public.travel_bookings%rowtype;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not private.is_travel_hr(v_uid, p_request) then
    raise exception 'not allowed to mark travel booking' using errcode = '42501';
  end if;
  if r.kind <> 'errand' or r.unit <> 'day' then
    raise exception 'travel booking applies to daily work errands only' using errcode = '22023';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'request is not pending or approved' using errcode = '22023';
  end if;
  if r.end_date < v_today then
    raise exception 'trip has already ended' using errcode = '22023';
  end if;

  select * into b from public.travel_bookings where request_id = p_request for update;
  if p_on then
    if b.request_id is null then
      insert into public.travel_bookings (request_id, company_id, ticked_by, ticked_at, opened_at)
      values (p_request, r.company_id, v_uid, now(),
              case when r.status = 'approved' then clock_timestamp() end);
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_uid, 'travel_booking.tick', 'leave_requests', p_request, null);
    end if;
  elsif b.request_id is not null then
    if b.first_saved_at is not null or b.done_at is not null then
      raise exception 'booking already started' using errcode = '22023';
    end if;
    delete from public.travel_bookings where request_id = p_request;
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'travel_booking.untick', 'leave_requests', p_request, null);
  end if;
end; $$;
revoke all on function public.app_set_travel_booking(uuid, boolean) from public, anon;
grant execute on function public.app_set_travel_booking(uuid, boolean) to authenticated;

-- Names (never values) of the traveller details that are empty, in field order.
create or replace function public.app_travel_missing_fields(p_request uuid) returns text[]
  language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  v_missing text[] := '{}';
  p public.profiles%rowtype;
  i public.employee_personal_info%rowtype;
  f text;
  v_value text;
begin
  if v_uid is null or not private.is_travel_hr(v_uid, p_request) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select pr.* into p from public.profiles pr
    join public.leave_requests r on r.employee_id = pr.id where r.id = p_request;
  select * into i from public.employee_personal_info where employee_id = p.id;
  foreach f in array private.travel_traveller_fields() loop
    v_value := case f when 'full_name' then p.full_name
                      else to_jsonb(i) ->> f end;
    if nullif(btrim(coalesce(v_value, '')), '') is null then
      v_missing := v_missing || f;
    end if;
  end loop;
  return v_missing;
end; $$;
revoke all on function public.app_travel_missing_fields(uuid) from public, anon;
grant execute on function public.app_travel_missing_fields(uuid) to authenticated;

-- The Requests page's switch: which requests are ticked, and whether procurement has
-- started (then unticking is refused). hr role holders and the admin, own company.
create or replace function public.app_travel_ticks() returns table(request_id uuid, started boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid)
     or not (private.is_admin(v_uid) or private.has_role(v_uid, 'hr')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select b.request_id, (b.first_saved_at is not null or b.done_at is not null)
      from public.travel_bookings b
      join public.profiles c on c.id = v_uid and c.company_id = b.company_id;
end; $$;
revoke all on function public.app_travel_ticks() from public, anon;
grant execute on function public.app_travel_ticks() to authenticated;
