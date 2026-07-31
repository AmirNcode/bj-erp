-- =============================================================================
-- Migration: 20260729130008_leave_hourly.sql
-- Purpose  : Schema for hourly leave / مرخصی ساعتی (spec §7.1), mirroring the
--            client's BJ-F 50208 form: one date, a from-time and a to-time.
--
-- Times are `time`, company-local, matching the dates-are-Gregorian-DATE rule:
-- there is no timezone question inside a single workday, and a timestamptz would
-- invite one.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'leave_unit') then
    create type public.leave_unit as enum ('day', 'hour');
  end if;
end $$;

alter table public.leave_requests
  add column if not exists unit       public.leave_unit not null default 'day',
  add column if not exists start_time time,
  add column if not exists end_time   time;

-- The company work-hours window (D8) and the per-day hourly cap (D7).
alter table public.work_settings
  add column if not exists work_start time not null default '07:00',
  add column if not exists work_end   time not null default '15:00',
  add column if not exists max_hourly_minutes_per_day int not null default 240;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_settings_window_sane') then
    alter table public.work_settings
      add constraint work_settings_window_sane check (work_end > work_start);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_settings_hourly_cap_sane') then
    alter table public.work_settings
      add constraint work_settings_hourly_cap_sane
      check (max_hourly_minutes_per_day > 0 and max_hourly_minutes_per_day <= 1440);
  end if;
end $$;

-- A malformed row must be impossible even if a function is wrong:
--   day  -> no times, a date range, any day_part
--   hour -> both times, ONE date, end after start, day_part must be 'full'
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_unit_shape') then
    alter table public.leave_requests
      add constraint leave_requests_unit_shape check (
        (unit = 'day'  and start_time is null and end_time is null and start_date <= end_date)
        or
        (unit = 'hour' and start_time is not null and end_time is not null
                       and start_date = end_date and end_time > start_time
                       and day_part = 'full')
      );
  end if;
end $$;

create index if not exists leave_requests_hourly_day_idx
  on public.leave_requests (employee_id, start_date)
  where unit = 'hour';

-- Switch on the flag reserved since 20260623120005. Sick leave stays daily-only:
-- the client's hourly form offers only استحقاقی and بدون حقوق.
update public.leave_types set allow_hourly = true
 where name_en in ('Annual Leave', 'Unpaid Leave') and allow_hourly = false;
update public.leave_types set allow_hourly = false
 where name_en = 'Sick Leave' and allow_hourly = true;
