-- =============================================================================
-- Migration: 20261020120006_travel_booking_review_fixes.sql
-- Purpose  : FR-70 review fixes.
--   1. An hr holder's effective approval delegate acts as HR (spec §3: "hr role
--      holders, their valid delegates") for ticking, cancelling and extensions.
--   2. The manager's extendable-trip list says when the trip's temporary approval
--      delegation does not cover the extra days (spec §6.5).
--   3. The traveller keeps procurement's note while an approved extension is being
--      re-booked: visibility keys on the first finish, not the current one.
--   4. Ask PostgREST to reload its schema cache (the release only recreates `app`).
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md
-- =============================================================================

-- True when p_uid may act as HR for travel booking in company p_company.
create or replace function private.acts_as_travel_hr(p_uid uuid, p_company uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select p_uid is not null and private.is_active(p_uid)
     and exists (select 1 from public.profiles c where c.id = p_uid and c.company_id = p_company)
     and (private.is_admin(p_uid) or private.has_role(p_uid, 'hr')
          or exists (
            select 1 from public.user_roles ur
              join public.profiles h on h.id = ur.user_id and h.company_id = p_company and h.active
             where ur.role = 'hr'
               and exists (select 1 from private.effective_approval_delegate(ur.user_id) d
                            where d.delegate_id = p_uid)));
$$;
revoke all on function private.acts_as_travel_hr(uuid, uuid) from public, anon;
grant execute on function private.acts_as_travel_hr(uuid, uuid) to authenticated;

create or replace function private.is_travel_hr(p_uid uuid, p_request uuid) returns boolean
  language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.leave_requests r
                  where r.id = p_request and r.employee_id <> p_uid
                    and private.acts_as_travel_hr(p_uid, r.company_id));
$$;

create or replace function public.app_travel_ticks() returns table(request_id uuid, started boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_company uuid;
begin
  select company_id into v_company from public.profiles where id = v_uid;
  if not coalesce(private.acts_as_travel_hr(v_uid, v_company), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select b.request_id, (b.first_saved_at is not null or b.done_at is not null)
      from public.travel_bookings b where b.company_id = v_company;
end; $$;

create or replace function public.app_pending_errand_extensions()
  returns table(extension_id uuid, request_id uuid, serial_year integer, serial_seq integer,
                employee_name text, errand_location text, start_date date, old_end_date date,
                new_end_date date, reason text, requested_by_name text, per_diem_rials bigint,
                delegation_uncovered boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_company uuid;
begin
  select company_id into v_company from public.profiles where id = v_uid;
  if not coalesce(private.acts_as_travel_hr(v_uid, v_company), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select e.id, r.id, r.serial_year, r.serial_seq, p.full_name, r.errand_location, r.start_date,
           e.old_end_date, e.new_end_date, e.reason, q.full_name, r.per_diem_rials,
           exists (select 1 from public.approval_delegations g
                    where g.source_request_id = r.id and g.revoked_at is null)
      from public.errand_extensions e
      join public.leave_requests r on r.id = e.request_id
      join public.profiles p on p.id = r.employee_id
      join public.profiles q on q.id = e.requested_by
     where e.company_id = v_company and e.status = 'pending' and r.employee_id <> v_uid
     order by e.requested_at;
end; $$;

-- Return type grows a column: drop first.
drop function if exists public.app_extendable_trips();
create function public.app_extendable_trips()
  returns table(request_id uuid, serial_year integer, serial_seq integer, employee_name text,
                errand_location text, start_date date, end_date date, pending_extension boolean,
                delegation_uncovered boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.serial_year, r.serial_seq, p.full_name, r.errand_location, r.start_date, r.end_date,
           exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'pending'),
           exists (select 1 from public.approval_delegations g where g.source_request_id = r.id and g.revoked_at is null)
      from public.travel_bookings b
      join public.leave_requests r on r.id = b.request_id
      join public.profiles p on p.id = r.employee_id
      join public.profiles c on c.id = v_uid and c.company_id = r.company_id
     where r.status = 'approved' and b.opened_at is not null and r.employee_id <> v_uid
       and r.end_date >= (now() at time zone 'Asia/Tehran')::date
       and (p.manager_id = v_uid or private.is_admin(v_uid))
     order by r.start_date, r.serial_year, r.serial_seq;
end; $$;
revoke all on function public.app_extendable_trips() from public, anon;
grant execute on function public.app_extendable_trips() to authenticated;

-- First finish: the traveller's note stays visible through later re-bookings.
alter table public.travel_bookings add column if not exists first_done_at timestamptz;
update public.travel_bookings set first_done_at = done_at where first_done_at is null and done_at is not null;

create or replace function private.travel_booking_first_done() returns trigger
  language plpgsql set search_path to '' as $$
begin
  if new.done_at is not null and new.first_done_at is null then new.first_done_at := new.done_at; end if;
  return new;
end; $$;
revoke all on function private.travel_booking_first_done() from public, anon, authenticated;
drop trigger if exists travel_booking_first_done on public.travel_bookings;
create trigger travel_booking_first_done before insert or update on public.travel_bookings
  for each row execute function private.travel_booking_first_done();

create or replace function public.my_travel_bookings()
  returns table(request_id uuid, transport text, traveller_note text)
  language sql stable security definer set search_path to '' as $$
  select b.request_id, b.transport, b.traveller_note
    from public.travel_bookings b
    join public.leave_requests r on r.id = b.request_id
   where r.employee_id = auth.uid() and r.status = 'approved' and b.first_done_at is not null;
$$;

notify pgrst, 'reload schema';
