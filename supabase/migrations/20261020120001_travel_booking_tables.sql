-- =============================================================================
-- Migration: 20261020120001_travel_booking_tables.sql
-- Purpose  : Travel booking for out-of-town daily errands (FR-70) — tables, the
--            `travel_booking` permission catalog item and the Procurement preset.
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md
--
-- Booking is fulfilment after approval, not an approval step. Both tables have RLS
-- on and no client policies: every read and write goes through guarded SECURITY
-- DEFINER functions (later migrations of this feature).
-- =============================================================================

-- One booking per request; exists once HR has ticked «نیاز به رزرو سفر».
create table if not exists public.travel_bookings (
  request_id        uuid primary key references public.leave_requests(id) on delete cascade,
  company_id        uuid not null references public.companies(id),
  ticked_by         uuid references public.profiles(id),
  ticked_at         timestamptz not null default now(),
  -- Set when the request is (or becomes) approved: the booking reaches procurement.
  opened_at         timestamptz,
  transport         text check (transport in ('flight','company_car')),
  flight_cost_rials bigint check (flight_cost_rials >= 0),
  hotel_cost_rials  bigint check (hotel_cost_rials >= 0),
  traveller_note    text check (char_length(traveller_note) <= 500),
  first_saved_at    timestamptz,
  done_by           uuid references public.profiles(id),
  done_at           timestamptz,
  lost_rials        bigint check (lost_rials >= 0),
  lost_note         text check (char_length(lost_note) <= 500),
  settled_by        uuid references public.profiles(id),
  settled_at        timestamptz,
  updated_at        timestamptz not null default now()
);
comment on table public.travel_bookings is
  'FR-70: procurement''s booking of an approved daily errand (flight/company car, hotel, costs, '
  'note to the traveller; amount lost after a cancellation). No client policies: RPCs only.';

-- A manager-requested later end date for an approved, travel-booked trip; HR decides.
create table if not exists public.errand_extensions (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null references public.leave_requests(id) on delete cascade,
  company_id           uuid not null references public.companies(id),
  old_end_date         date not null,
  new_end_date         date not null,
  reason               text not null check (char_length(btrim(reason)) between 1 and 1000),
  requested_by         uuid not null references public.profiles(id),
  requested_at         timestamptz not null default now(),
  status               text not null default 'pending'
                         check (status in ('pending','approved','rejected','cancelled')),
  evidence             text check (evidence in ('manual','exempt')),
  decided_by           uuid references public.profiles(id),
  decided_at           timestamptz,
  signature_data       text,
  signature_consent_at timestamptz,
  decision_note        text check (char_length(decision_note) <= 1000),
  per_diem_before      bigint,
  per_diem_after       bigint,
  constraint errand_extensions_later check (new_end_date > old_end_date)
);
create unique index if not exists errand_extensions_one_pending
  on public.errand_extensions (request_id) where status = 'pending';
create index if not exists errand_extensions_request on public.errand_extensions (request_id);
comment on table public.errand_extensions is
  'FR-70: trip extensions. old_end_date keeps the originally signed end date. RPCs only.';

alter table public.travel_bookings enable row level security;
alter table public.errand_extensions enable row level security;
revoke all on public.travel_bookings from anon, authenticated;
revoke all on public.errand_extensions from anon, authenticated;

-- The traveller details procurement sees and HR is warned about. PLACEHOLDER until
-- procurement confirms; lib/travel/fields.ts mirrors it (a unit test compares them).
create or replace function private.travel_traveller_fields() returns text[]
  language sql immutable set search_path to '' as $$
  select '{full_name,national_id,birth_date,mobile,gender}'::text[];
$$;

-- Booking state, derived from the request status and the booking timestamps.
create or replace function private.travel_booking_state(p_status public.leave_status, b public.travel_bookings)
  returns text language sql stable security definer set search_path to '' as $$
  select case
    when p_status = 'pending' then 'awaiting_approval'
    when p_status = 'approved' and b.opened_at is null then 'awaiting_approval'
    when p_status = 'approved' and b.done_at is not null then 'done'
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

-- The booking reaches procurement when the whole approval chain finishes.
create or replace function private.travel_booking_open() returns trigger
  language plpgsql security definer set search_path to '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.travel_bookings
       set opened_at = coalesce(opened_at, clock_timestamp()), updated_at = now()
     where request_id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists travel_booking_open on public.leave_requests;
create trigger travel_booking_open after update of status on public.leave_requests
  for each row execute function private.travel_booking_open();

revoke all on function private.travel_booking_state(public.leave_status, public.travel_bookings) from public, anon, authenticated;
revoke all on function private.travel_booking_open() from public, anon, authenticated;

-- ---------------------------------------------------------------- catalog item
create or replace function private.permission_allows(p_key text, p_level text) returns boolean
  language sql immutable set search_path to '' as $$
  select case
    when p_key in ('people_create','role_manager','role_assign','leave_accrual',
      'personal_info_own','special_leave','approval_delegate','travel_booking') then p_level = 'edit'
    when p_key in ('calendar','reports','absences','finance') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays') then p_level in ('read','edit')
    else false end;
$$;

create or replace function private.permission_keys() returns setof text
  language sql immutable set search_path to '' as $$
  select unnest(array['people','people_create','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','absences','approval_steps','approval_delegate',
    'work_settings','holidays','finance','travel_booking']);
$$;

-- ---------------------------------------------------------------- Procurement preset
create or replace function private.seed_company_roles(p_company uuid) returns void
  language plpgsql security definer set search_path to '' as $$
begin
  insert into public.roles (company_id, system_key, kind, name) values
    (p_company, 'admin', 'system', 'Admin'), (p_company, 'manager', 'system', 'Manager'),
    (p_company, 'employee', 'system', 'Employee'), (p_company, 'hr', 'preset', 'HR'),
    (p_company, 'security', 'preset', 'Security'), (p_company, 'finance', 'preset', 'Finance'),
    (p_company, 'procurement', 'preset', 'Procurement')
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission, level)
  select r.id, v.permission, v.level
    from public.roles r
    join (values
      ('hr','people','edit'), ('hr','people_create','edit'), ('hr','role_manager','edit'),
      ('hr','personal_info','edit'), ('hr','clearance','edit'), ('hr','departments','edit'),
      ('hr','leave_balances','edit'), ('hr','leave_accrual','edit'), ('hr','leave_requests','read'),
      ('hr','calendar','read'), ('hr','reports','read'), ('hr','approval_steps','edit'),
      ('hr','work_settings','edit'), ('hr','holidays','edit'), ('hr','special_leave','edit'),
      ('hr','absences','read'), ('hr','finance','read'),
      ('security','people','read'), ('security','leave_balances','read'),
      ('security','leave_requests','read'), ('security','calendar','read'),
      ('security','absences','read'),
      ('finance','clearance','read'), ('finance','finance','read'),
      ('procurement','travel_booking','edit')
    ) as v(system_key, permission, level) on r.system_key = v.system_key::public.app_role
   where r.company_id = p_company
  on conflict do nothing;
end $$;

-- Backfill ONLY the new preset: re-running seed_company_roles would re-grant
-- permissions an admin has since removed from the other presets.
insert into public.roles (company_id, system_key, kind, name)
select c.id, 'procurement', 'preset', 'Procurement' from public.companies c
on conflict do nothing;
insert into public.role_permissions (role_id, permission, level)
select r.id, 'travel_booking', 'edit' from public.roles r
 where r.system_key = 'procurement'
on conflict do nothing;
