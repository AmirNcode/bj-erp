-- =============================================================================
-- Migration: 20260729130009_leave_hourly_fns.sql
-- Purpose  : Duration, validation and the write path for hourly leave (spec §7.2–7.5).
--
-- MIRRORS lib/leave/hourly.ts for the time arithmetic. The database is
-- authoritative: a client must never be able to fabricate a duration.
--
-- Structure (§7.5): ONE internal writer, private.submit_leave_impl, behind two
-- thin public wrappers that mirror the client's two paper forms. The daily
-- wrapper keeps its exact existing signature so nothing already deployed breaks.
--
-- The body is the submit_leave_request from 20260729130003 generalised — the
-- advisory lock, the 366-day bound, the balance check and every error string are
-- preserved deliberately (docs/errors are matched on those strings).
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. compute_requested_minutes — now unit-aware.
--    Replaced outright rather than extended with defaults: two resolvable
--    overloads for the same call is a footgun.
-- ---------------------------------------------------------------------------
drop function if exists public.compute_requested_minutes(uuid, date, date, public.day_part);
drop function if exists public.compute_requested_minutes(uuid, date, date, public.day_part, public.leave_unit, time, time);

create function public.compute_requested_minutes(
  p_company_id uuid,
  p_start      date,
  p_end        date,
  p_day_part   public.day_part,
  p_unit       public.leave_unit default 'day',
  p_start_time time            default null,
  p_end_time   time            default null
) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  v_weekend  int[];
  v_per_day  numeric;
  v_count    numeric := 0;
  d          date;
  v_working  boolean;
begin
  if p_end < p_start then return 0; end if;

  select weekend_days, hours_per_day into v_weekend, v_per_day
    from public.work_settings where company_id = p_company_id limit 1;
  if v_weekend is null then v_weekend := '{5}'; end if;
  if v_per_day is null then v_per_day := 8; end if;

  -- Hourly: one date, and only if that date is actually a working day.
  if p_unit = 'hour' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      return 0;
    end if;
    v_working := (extract(isodow from p_start)::int <> all (v_weekend))
                 and not exists (select 1 from public.holidays h
                                 where h.company_id = p_company_id and h.holiday_date = p_start);
    if not v_working then return 0; end if;
    return (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
  end if;

  if p_day_part in ('am', 'pm') then
    if p_start <> p_end then return 0; end if;
    v_working := (extract(isodow from p_start)::int <> all (v_weekend))
                 and not exists (select 1 from public.holidays h
                                 where h.company_id = p_company_id and h.holiday_date = p_start);
    return case when v_working then round(v_per_day * 60 / 2) else 0 end;
  end if;

  d := p_start;
  while d <= p_end loop
    if (extract(isodow from d)::int <> all (v_weekend))
       and not exists (select 1 from public.holidays h
                       where h.company_id = p_company_id and h.holiday_date = d)
    then
      v_count := v_count + 1;
    end if;
    d := d + 1;
  end loop;

  return round(v_count * v_per_day * 60);
end; $$;

revoke execute on function public.compute_requested_minutes(uuid, date, date, public.day_part, public.leave_unit, time, time)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.submit_leave_impl — the single writer for both units.
--    No auth check beyond the caller's own identity: it writes only for
--    auth.uid(), exactly as submit_leave_request always did.
-- ---------------------------------------------------------------------------
create or replace function private.submit_leave_impl(
  p_leave_type_id uuid,
  p_start         date,
  p_end           date,
  p_day_part      public.day_part,
  p_reason        text,
  p_unit          public.leave_unit,
  p_start_time    time,
  p_end_time      time
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid          uuid := auth.uid();
  v_company      uuid;
  v_minutes      int;
  v_affects      boolean;
  v_allow_hourly boolean;
  v_balance      int;
  v_req          uuid;
  v_win_start    time;
  v_win_end      time;
  v_cap          int;
  v_day_used     int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id into v_company from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  select affects_balance, allow_hourly into v_affects, v_allow_hourly
    from public.leave_types
   where id = p_leave_type_id and company_id = v_company and active;
  if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;

  -- ── hourly-only validation (spec §7.3) ─────────────────────────────────────
  if p_unit = 'hour' then
    if not coalesce(v_allow_hourly, false) then
      raise exception 'this leave type cannot be taken hourly' using errcode = '22023';
    end if;
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'end time must be after start time' using errcode = '22023';
    end if;

    select work_start, work_end, max_hourly_minutes_per_day
      into v_win_start, v_win_end, v_cap
      from public.work_settings where company_id = v_company limit 1;
    v_win_start := coalesce(v_win_start, '07:00'::time);
    v_win_end   := coalesce(v_win_end,   '15:00'::time);
    v_cap       := coalesce(v_cap, 240);

    if p_start_time < v_win_start or p_end_time > v_win_end then
      raise exception 'times must fall within working hours' using errcode = '22023';
    end if;

    if (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  -- Serialize all leave writes for this employee (2026-07-02 hardening).
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  -- Day cap counts this day's own pending+approved hourly minutes (D7). Taken
  -- after the lock so two submissions cannot both pass it.
  if p_unit = 'hour' then
    select coalesce(sum(r.requested_minutes), 0) into v_day_used
      from public.leave_requests r
     where r.employee_id = v_uid
       and r.unit = 'hour'
       and r.start_date = p_start
       and r.status in ('pending', 'approved');

    if v_day_used + (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  -- ── overlap, now time-aware (spec §7.4) ───────────────────────────────────
  -- A whole-day request on either side always conflicts; two hourly requests
  -- conflict only when their times actually intersect (touching ends do not).
  if exists (
    select 1 from public.leave_requests r
     where r.employee_id = v_uid
       and r.status in ('pending', 'approved')
       and r.start_date <= p_end
       and r.end_date >= p_start
       and (
         r.unit = 'day' or p_unit = 'day'
         or (r.start_time < p_end_time and r.end_time > p_start_time)
       )
  ) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(
    v_company, p_start, p_end, p_day_part, p_unit, p_start_time, p_end_time
  );
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)' using errcode = '22023';
  end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    if v_minutes > v_balance then
      raise exception 'insufficient balance: % day(s) requested, % available', v_minutes, v_balance using errcode = '22023';
    end if;
  end if;

  insert into public.leave_requests(employee_id, leave_type_id, start_date, end_date, day_part,
                                    unit, start_time, end_time, requested_minutes, status, reason)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part,
          p_unit, p_start_time, p_end_time, v_minutes, 'pending', p_reason)
  returning id into v_req;
  return v_req;
end; $$;

revoke all on function private.submit_leave_impl(uuid, date, date, public.day_part, text, public.leave_unit, time, time)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Public wrappers — one per paper form.
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.submit_leave_impl(p_leave_type_id, p_start, p_end, p_day_part, p_reason,
                                   'day', null, null);
end; $$;

create or replace function public.submit_hourly_leave_request(
  p_leave_type_id uuid,
  p_date          date,
  p_start_time    time,
  p_end_time      time,
  p_reason        text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.submit_leave_impl(p_leave_type_id, p_date, p_date, 'full', p_reason,
                                   'hour', p_start_time, p_end_time);
end; $$;

revoke execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) from public, anon;
grant  execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) to authenticated;
revoke execute on function public.submit_hourly_leave_request(uuid, date, time, time, text) from public, anon;
grant  execute on function public.submit_hourly_leave_request(uuid, date, time, time, text) to authenticated;
