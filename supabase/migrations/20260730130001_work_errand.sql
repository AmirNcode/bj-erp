-- =============================================================================
-- Migration: 20260730130001_work_errand.sql
-- Purpose  : Hourly work errand / ماموریت ساعتی — the client's BJ-F 50207 form
--            (spec docs/specs/2026-07-30-work-errand-and-login-codes-design.md
--            §3–§5).
--
-- An errand is WORK, not leave: it deducts no balance and earns no entitlement.
-- It is modelled as a discriminated row on leave_requests (D1) rather than as a
-- second table, so the approval queue, the calendar, the overlap rule and the
-- serial machinery keep working unchanged.
--
-- The mechanism that makes an errand structurally unable to touch a balance is
-- `leave_type_id` becoming NULLABLE. approve_leave_request and
-- cancel_leave_request both gate their ledger writes on `affects_balance` read
-- from the type; with a NULL type that read returns no row, v_affects stays
-- NULL, and the write is skipped. NEITHER FUNCTION NEEDS CHANGING — verified
-- against the live bodies in 20260730120001 §7 and 20260729130012.
--
-- ON SPEC §4.1 (the "pre-existing bug this work forces us to fix"):
-- approve_leave_request's overlap re-check was date-only while submit's is
-- time-aware. That fix ALREADY LANDED, in 20260730120001 §7 ("Hourly-aware
-- approval overlap"), whose body carries
--   r.unit = 'day' or v_unit = 'day' or (r.start_time < v_et and r.end_time > v_st)
-- — the same rule submit uses, modulo the deliberate status difference (approve
-- conflicts only with already-approved rows). Re-emitting the function here
-- would add drift risk and change nothing, so it is left alone. Recorded so the
-- spec item is not read as still outstanding.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The discriminator.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'request_kind') then
    create type public.request_kind as enum ('leave', 'errand');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Columns + shape constraint.
--
--    `unit = 'hour'` in the errand branch chains into the existing
--    leave_requests_unit_shape, which already forces ONE date, both times,
--    end_time > start_time and day_part = 'full'. The two constraints compose;
--    neither is relaxed.
--
--    شرح ماموریت deliberately reuses `reason` — same author, same FR-25 privacy,
--    and already absent from team_leave_calendar's explicit column list.
-- ---------------------------------------------------------------------------
alter table public.leave_requests
  add column if not exists kind            public.request_kind not null default 'leave',
  add column if not exists errand_location text;

alter table public.leave_requests alter column leave_type_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_kind_shape') then
    alter table public.leave_requests
      add constraint leave_requests_kind_shape check (
        (kind = 'leave'
           and leave_type_id is not null
           and errand_location is null)
        or
        (kind = 'errand'
           and leave_type_id is null
           and errand_location is not null
           and btrim(errand_location) <> ''
           and length(errand_location) <= 200
           and unit = 'hour')
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Errands get their own serial sequence (D5): BJ-F 50207 and BJ-F 50208 are
--    separate paper form books, so 1404-0001 exists once per kind.
--
--    The new column defaults to 'leave', which is exactly what every existing
--    counter row is, so the re-key migrates the backfilled numbers untouched.
-- ---------------------------------------------------------------------------
alter table public.leave_request_serials
  add column if not exists kind public.request_kind not null default 'leave';

do $$
declare v_pk_cols int;
begin
  select coalesce(array_length(c.conkey, 1), 0) into v_pk_cols
    from pg_constraint c
   where c.conrelid = 'public.leave_request_serials'::regclass
     and c.contype = 'p';

  if v_pk_cols = 2 then
    alter table public.leave_request_serials drop constraint leave_request_serials_pkey;
    alter table public.leave_request_serials
      add constraint leave_request_serials_pkey primary key (company_id, jalali_year, kind);
  end if;
end $$;

--    The counter is per-kind, so the UNIQUE INDEX ON leave_requests must be too.
--    Without this the first errand of a year draws seq=1 from its own counter and
--    collides with the leave request that already holds seq=1 — every first errand
--    per Jalali year fails on leave_requests_serial_uniq. Caught by e2e; it is
--    invisible to any test whose schema lacks this index.
drop index if exists public.leave_requests_serial_uniq;
create unique index if not exists leave_requests_serial_uniq
  on public.leave_requests (company_id, kind, serial_year, serial_seq);

-- ---------------------------------------------------------------------------
-- 4. compute_requested_minutes — now kind-aware.
--
--    Replaced outright rather than extended in place: a 7-arg and an 8-arg
--    overload both resolvable from the same call is the footgun 20260729130009
--    already avoided once.
-- ---------------------------------------------------------------------------
drop function if exists public.compute_requested_minutes(uuid, date, date, public.day_part, public.leave_unit, time, time);
drop function if exists public.compute_requested_minutes(uuid, date, date, public.day_part, public.leave_unit, time, time, public.request_kind);

create function public.compute_requested_minutes(
  p_company_id uuid,
  p_start      date,
  p_end        date,
  p_day_part   public.day_part,
  p_unit       public.leave_unit       default 'day',
  p_start_time time                    default null,
  p_end_time   time                    default null,
  p_kind       public.request_kind     default 'leave'
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

    -- An errand MAY fall on a Friday or a public holiday (spec §4): urgent
    -- company business does not respect the holiday calendar, and an errand
    -- earns no entitlement, so there is nothing for the gate to protect. This
    -- is a deliberate divergence from hourly leave, where the gate is correct.
    if p_kind = 'errand' then
      return (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
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

revoke execute on function public.compute_requested_minutes(uuid, date, date, public.day_part, public.leave_unit, time, time, public.request_kind)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. private.submit_leave_impl — the single writer, now for both kinds.
--
--    Patched from the 20260729130014 body (verified unchanged by
--    20260730120001, which only touched the public wrappers above it). Every
--    existing error string is preserved verbatim: lib/errors/db-error.ts and
--    messages/*.json match on those strings.
--
--    Errand SKIPS  : the leave-type lookup and allow_hourly, the work-hours
--                    window, the 4h/day cap, the balance check, the replacement
--                    guard.
--    Errand KEEPS  : auth + company resolution, the per-employee advisory lock,
--                    the time-aware overlap check (unchanged — an errand is
--                    unit='hour', so the existing rule already conflicts it with
--                    overlapping leave, D2), the jalali_year lookup, and serial
--                    allocation, now keyed on kind.
--
--    The old 9-argument signature is dropped rather than left beside the new
--    one: two resolvable overloads of the single writer is not a state worth
--    being in.
-- ---------------------------------------------------------------------------
drop function if exists private.submit_leave_impl(uuid, date, date, public.day_part, text, public.leave_unit, time, time, uuid);

create or replace function private.submit_leave_impl(
  p_leave_type_id  uuid,
  p_start          date,
  p_end            date,
  p_day_part       public.day_part,
  p_reason         text,
  p_unit           public.leave_unit,
  p_start_time     time,
  p_end_time       time,
  p_replacement_id uuid,
  p_kind           public.request_kind,
  p_location       text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid          uuid := auth.uid();
  v_company      uuid;
  v_dept         uuid;
  v_minutes      int;
  v_affects      boolean;
  v_allow_hourly boolean;
  v_balance      int;
  v_req          uuid;
  v_win_start    time;
  v_win_end      time;
  v_cap          int;
  v_day_used     int;
  v_jyear        int;
  v_seq          int;
  v_location     text := nullif(btrim(p_location), '');
  v_replacement  uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id, department_id into v_company, v_dept from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  -- ── kind-shaped input guards (spec §3) ────────────────────────────────────
  -- Cheap, clear failures ahead of leave_requests_kind_shape, which would
  -- otherwise surface as a raw constraint violation.
  if p_kind = 'errand' then
    if v_location is null then
      raise exception 'errand location is required' using errcode = '22023';
    end if;
    if length(v_location) > 200 then
      raise exception 'errand location is too long' using errcode = '22023';
    end if;
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'end time must be after start time' using errcode = '22023';
    end if;
    -- An errand names no cover (D3). Nulled here rather than trusted from the
    -- caller, so nothing unvalidated can be stored by passing one in.
    v_replacement := null;
  else
    if p_leave_type_id is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
    -- A leave row carries no location; the CHECK enforces it either way.
    v_location    := null;
    v_replacement := p_replacement_id;
  end if;

  -- ── leave-only: the type drives allow_hourly, affects_balance and the
  --    balance check. An errand has no type at all, which is precisely what
  --    makes it structurally unable to consume leave.
  if p_kind = 'leave' then
    select affects_balance, allow_hourly into v_affects, v_allow_hourly
      from public.leave_types
     where id = p_leave_type_id and company_id = v_company and active;
    if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;
  end if;

  -- ── hourly LEAVE validation. Errands skip all of it (D3). ─────────────────
  if p_kind = 'leave' and p_unit = 'hour' then
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

  -- ── replacement validation (spec §8, D14) ─────────────────────────────────
  -- Optional: null is perfectly valid, and was the only possibility before now.
  if v_replacement is not null then
    if not exists (
      select 1 from public.profiles p
       where p.id = v_replacement
         and p.active
         and p.company_id = v_company
         and v_dept is not null
         and p.department_id = v_dept
         and p.id <> v_uid
    ) then
      raise exception 'replacement must be an active colleague in your department' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  -- Day cap counts this day's own pending+approved hourly LEAVE only: errand
  -- minutes are not counted against max_hourly_minutes_per_day (D3).
  if p_kind = 'leave' and p_unit = 'hour' then
    select coalesce(sum(r.requested_minutes), 0) into v_day_used
      from public.leave_requests r
     where r.employee_id = v_uid
       and r.kind = 'leave'
       and r.unit = 'hour'
       and r.start_date = p_start
       and r.status in ('pending', 'approved');

    if v_day_used + (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

  -- Kind-blind on purpose (D2): an errand conflicts with overlapping leave and
  -- vice versa. Errands are unit='hour', so the existing time-aware rule already
  -- says exactly that, and leaves adjacent slots free.
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

  -- Checked after the lock so a cover cannot slip away mid-submission.
  if v_replacement is not null
     and private.replacement_is_away(v_replacement, p_start, p_end, p_unit, p_start_time, p_end_time)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(
    v_company, p_start, p_end, p_day_part, p_unit, p_start_time, p_end_time, p_kind
  );
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)' using errcode = '22023';
  end if;

  -- v_affects is NULL for an errand (no type was ever read), so this is skipped
  -- without needing to name the kind.
  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    if v_minutes > v_balance then
      raise exception 'insufficient balance: % day(s) requested, % available', v_minutes, v_balance using errcode = '22023';
    end if;
  end if;

  -- Serial number (spec §7.6 of leave v2, re-keyed by §5 of the errand spec):
  -- per company + Jalali year + KIND, gapless. The advisory lock above is per
  -- EMPLOYEE, so it does not serialise two different employees submitting at
  -- once — the on-conflict-do-update below does, by taking a row lock on the
  -- counter for the rest of the transaction.
  select jm.jalali_year into v_jyear
    from public.jalali_months jm
   where p_start between jm.gregorian_start and jm.gregorian_end;
  if v_jyear is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  insert into public.leave_request_serials (company_id, jalali_year, kind, last_seq)
  values (v_company, v_jyear, p_kind, 1)
  on conflict (company_id, jalali_year, kind) do update
     set last_seq = public.leave_request_serials.last_seq + 1
  returning last_seq into v_seq;

  insert into public.leave_requests(employee_id, leave_type_id, start_date, end_date, day_part,
                                    unit, start_time, end_time, requested_minutes, status, reason,
                                    replacement_id, company_id, serial_year, serial_seq,
                                    kind, errand_location)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part,
          p_unit, p_start_time, p_end_time, v_minutes, 'pending', p_reason,
          v_replacement, v_company, v_jyear, v_seq,
          p_kind, v_location)
  returning id into v_req;
  return v_req;
end; $$;

revoke all on function private.submit_leave_impl(uuid, date, date, public.day_part, text, public.leave_unit, time, time, uuid, public.request_kind, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Public wrappers — one per paper form. The two leave wrappers keep their
--    exact existing signatures, so nothing already deployed breaks; they gain
--    only the two new pass-through arguments.
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid,
  p_start date,
  p_end date,
  p_day_part public.day_part,
  p_reason text default null,
  p_replacement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  return private.submit_leave_impl(
    p_leave_type_id, p_start, p_end, p_day_part, p_reason,
    'day', null, null, p_replacement_id, 'leave', null
  );
end;
$$;

create or replace function public.submit_hourly_leave_request(
  p_leave_type_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_reason text default null,
  p_replacement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  return private.submit_leave_impl(
    p_leave_type_id, p_date, p_date, 'full', p_reason,
    'hour', p_start_time, p_end_time, p_replacement_id, 'leave', null
  );
end;
$$;

-- BJ-F 50207 — فرم درخواست ماموریت ساعتی. One date, a departure time, a return
-- time, محل ماموریت, and شرح ماموریت (which lands in `reason`). No leave type,
-- no balance, no cover.
create or replace function public.submit_errand_request(
  p_date        date,
  p_start_time  time,
  p_end_time    time,
  p_location    text,
  p_description text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  return private.submit_leave_impl(
    null::uuid, p_date, p_date, 'full', p_description,
    'hour', p_start_time, p_end_time, null::uuid, 'errand', p_location
  );
end;
$$;

-- Re-assert exposed-function grants after CREATE OR REPLACE.
revoke execute on function public.submit_leave_request(
  uuid, date, date, public.day_part, text, uuid
) from public, anon;
grant execute on function public.submit_leave_request(
  uuid, date, date, public.day_part, text, uuid
) to authenticated;
revoke execute on function public.submit_hourly_leave_request(
  uuid, date, time, time, text, uuid
) from public, anon;
grant execute on function public.submit_hourly_leave_request(
  uuid, date, time, time, text, uuid
) to authenticated;
revoke execute on function public.submit_errand_request(
  date, time, time, text, text
) from public, anon;
grant execute on function public.submit_errand_request(
  date, time, time, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. team_leave_calendar — errands must appear on it (D6).
--
--    The join to leave_types becomes a LEFT JOIN: an errand has no type, and an
--    inner join would silently drop every errand from the calendar.
--
--    `kind` is added so the UI can label an errand. `reason`, `decision_note`
--    and `errand_location` are STILL NOT HERE, and must never be: this view's
--    FR-25 guarantee is that teammates see that someone is out, not why or
--    where. Recreated WITHOUT security_invoker, with the same scoping and the
--    same grants as 20260730120001 §8.
-- ---------------------------------------------------------------------------
drop view if exists public.team_leave_calendar;

create view public.team_leave_calendar as
  select
    lr.id,
    lr.employee_id,
    p.full_name as employee_name,
    p.department_id,
    lr.kind,
    lr.leave_type_id,
    lt.name_fa as leave_type_name_fa,
    lt.name_en as leave_type_name_en,
    lt.color as leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.unit,
    lr.start_time,
    lr.end_time,
    lr.requested_minutes,
    lr.status
  from public.leave_requests lr
  join public.profiles p on p.id = lr.employee_id
  left join public.leave_types lt on lt.id = lr.leave_type_id
  where private.is_active(auth.uid())
    and lr.status in ('pending', 'approved')
    and (
      lr.employee_id = auth.uid()
      or private.same_team(auth.uid(), lr.employee_id)
      or private.can_read_all(auth.uid())
    );

revoke all on public.team_leave_calendar from public, anon, authenticated;
grant select on public.team_leave_calendar to authenticated;
