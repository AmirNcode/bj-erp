-- =============================================================================
-- Migration: 20260729130013_leave_serials.sql
-- Purpose  : Human-readable request numbers (spec §7.6) — the شماره the client's
--            paper forms carry. Counter + columns + backfill; allocation on submit
--            is …130014.
--
-- Per (company, Jalali year), so 1404-0042 becomes 1405-0001 at Nowruz, matching
-- how HR files paper. The Jalali year comes from jalali_months, never from
-- arithmetic.
--
-- company_id is denormalised onto leave_requests deliberately: it makes the
-- serial's unique index possible without a join, and shortens the company-wide
-- manager queries FR-17 already needs.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The counter. Written only by the definer writer; nothing else may read or
--    bump it, so no RLS policy is needed — just no grants.
-- ---------------------------------------------------------------------------
create table if not exists public.leave_request_serials (
  company_id  uuid not null references public.companies(id) on delete cascade,
  jalali_year int  not null,
  last_seq    int  not null default 0,
  primary key (company_id, jalali_year)
);

alter table public.leave_request_serials enable row level security;
revoke all on table public.leave_request_serials from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Columns
-- ---------------------------------------------------------------------------
alter table public.leave_requests
  add column if not exists company_id  uuid references public.companies(id) on delete cascade,
  add column if not exists serial_year int,
  add column if not exists serial_seq  int;

-- ---------------------------------------------------------------------------
-- 3. Backfill. company_id from the employee's profile; serials in created_at
--    order within each (company, Jalali year of start_date), so existing requests
--    are numbered in the order they were actually filed.
-- ---------------------------------------------------------------------------
update public.leave_requests r
   set company_id = p.company_id
  from public.profiles p
 where p.id = r.employee_id and r.company_id is null;

with numbered as (
  select r.id,
         jm.jalali_year,
         row_number() over (
           partition by r.company_id, jm.jalali_year
           order by r.created_at, r.id
         ) as seq
    from public.leave_requests r
    join public.jalali_months jm
      on r.start_date between jm.gregorian_start and jm.gregorian_end
   where r.serial_seq is null
)
update public.leave_requests r
   set serial_year = n.jalali_year,
       serial_seq  = n.seq
  from numbered n
 where n.id = r.id;

-- Fail loudly rather than leaving a null: a request outside the seeded calendar
-- range is a calendar-range problem to fix, not something to paper over.
do $$
declare v_missing int;
begin
  select count(*) into v_missing from public.leave_requests where serial_seq is null;
  if v_missing > 0 then
    raise exception 'cannot backfill serials: % request(s) have a start_date outside jalali_months', v_missing
      using errcode = '22023';
  end if;
end $$;

alter table public.leave_requests alter column company_id  set not null;
alter table public.leave_requests alter column serial_year set not null;
alter table public.leave_requests alter column serial_seq  set not null;

create unique index if not exists leave_requests_serial_uniq
  on public.leave_requests (company_id, serial_year, serial_seq);

-- ---------------------------------------------------------------------------
-- 4. Seed the counter past the backfill so new requests continue the sequence
--    instead of colliding with it.
-- ---------------------------------------------------------------------------
insert into public.leave_request_serials (company_id, jalali_year, last_seq)
select company_id, serial_year, max(serial_seq)
  from public.leave_requests
 group by company_id, serial_year
on conflict (company_id, jalali_year) do update
   set last_seq = greatest(public.leave_request_serials.last_seq, excluded.last_seq);
