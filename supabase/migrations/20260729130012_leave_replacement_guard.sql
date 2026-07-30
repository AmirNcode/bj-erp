-- =============================================================================
-- Migration: 20260729130012_leave_replacement_guard.sql
-- Purpose  : Accept and validate the replacement on the write path (spec §8).
--
-- The predicate below is TEXTUALLY IDENTICAL to the one in
-- get_replacement_candidates (…130011). If they drift, the UI offers a colleague
-- the server then rejects.
--
-- approve_leave_request re-checks availability, because the cover may have booked
-- leave between submission and approval — approving anyway would silently produce
-- an absent cover, which is the whole thing this feature exists to prevent.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. private.replacement_is_away — the one place the predicate lives.
-- ---------------------------------------------------------------------------
create or replace function private.replacement_is_away(
  p_replacement_id uuid,
  p_start          date,
  p_end            date,
  p_unit           public.leave_unit,
  p_start_time     time,
  p_end_time       time
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leave_requests r
     where r.employee_id = p_replacement_id
       and r.status in ('pending', 'approved')
       and r.start_date <= p_end
       and r.end_date >= p_start
       and (
         r.unit = 'day' or p_unit = 'day'
         or (r.start_time < p_end_time and r.end_time > p_start_time)
       )
  );
$$;

revoke all on function private.replacement_is_away(uuid, date, date, public.leave_unit, time, time)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. submit_leave_impl — gains p_replacement_id and validates it.
--    Body is …130009's with the replacement block added; everything else is
--    preserved deliberately.
-- ---------------------------------------------------------------------------
drop function if exists private.submit_leave_impl(uuid, date, date, public.day_part, text, public.leave_unit, time, time);

create function private.submit_leave_impl(
  p_leave_type_id  uuid,
  p_start          date,
  p_end            date,
  p_day_part       public.day_part,
  p_reason         text,
  p_unit           public.leave_unit,
  p_start_time     time,
  p_end_time       time,
  p_replacement_id uuid
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

  select affects_balance, allow_hourly into v_affects, v_allow_hourly
    from public.leave_types
   where id = p_leave_type_id and company_id = v_company and active;
  if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;

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

  -- ── replacement validation (spec §8, D14) ─────────────────────────────────
  -- Optional: null is perfectly valid, and was the only possibility before now.
  if p_replacement_id is not null then
    if not exists (
      select 1 from public.profiles p
       where p.id = p_replacement_id
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
  if p_replacement_id is not null
     and private.replacement_is_away(p_replacement_id, p_start, p_end, p_unit, p_start_time, p_end_time)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
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
                                    unit, start_time, end_time, requested_minutes, status, reason,
                                    replacement_id)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part,
          p_unit, p_start_time, p_end_time, v_minutes, 'pending', p_reason,
          p_replacement_id)
  returning id into v_req;
  return v_req;
end; $$;

revoke all on function private.submit_leave_impl(uuid, date, date, public.day_part, text, public.leave_unit, time, time, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Wrappers gain the optional replacement.
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid,
  p_start         date,
  p_end           date,
  p_day_part      public.day_part,
  p_reason        text default null,
  p_replacement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.submit_leave_impl(p_leave_type_id, p_start, p_end, p_day_part, p_reason,
                                   'day', null, null, p_replacement_id);
end; $$;

create or replace function public.submit_hourly_leave_request(
  p_leave_type_id  uuid,
  p_date           date,
  p_start_time     time,
  p_end_time       time,
  p_reason         text default null,
  p_replacement_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.submit_leave_impl(p_leave_type_id, p_date, p_date, 'full', p_reason,
                                   'hour', p_start_time, p_end_time, p_replacement_id);
end; $$;

-- The 5-arg variants would still resolve for a 5-arg call, leaving two candidate
-- functions; drop them so there is exactly one of each.
drop function if exists public.submit_leave_request(uuid, date, date, public.day_part, text);
drop function if exists public.submit_hourly_leave_request(uuid, date, time, time, text);

revoke execute on function public.submit_leave_request(uuid, date, date, public.day_part, text, uuid) from public, anon;
grant  execute on function public.submit_leave_request(uuid, date, date, public.day_part, text, uuid) to authenticated;
revoke execute on function public.submit_hourly_leave_request(uuid, date, time, time, text, uuid) from public, anon;
grant  execute on function public.submit_hourly_leave_request(uuid, date, time, time, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. approve_leave_request — re-check the cover at decision time.
--    Body is …130003's with the replacement re-check added after the lock.
-- ---------------------------------------------------------------------------
create or replace function public.approve_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_emp     uuid;
  v_type    uuid;
  v_minutes int;
  v_status  public.leave_status;
  v_start   date;
  v_end     date;
  v_unit    public.leave_unit;
  v_st      time;
  v_et      time;
  v_repl    uuid;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_emp from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date,
         unit, start_time, end_time, replacement_id
    into v_type, v_minutes, v_status, v_start, v_end, v_unit, v_st, v_et, v_repl
    from public.leave_requests where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.leave_requests
    where employee_id = v_emp and id <> p_id and status = 'approved'
      and start_date <= v_end and end_date >= v_start
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  -- The cover may have booked leave since this was submitted.
  if v_repl is not null
     and private.replacement_is_away(v_repl, v_start, v_end, v_unit, v_st, v_et)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    if v_minutes > v_prev then
      raise exception 'insufficient balance: % day(s) requested, % available', v_minutes, v_prev using errcode = '22023';
    end if;
  end if;

  update public.leave_requests
     set status = 'approved', decided_by = v_uid, decided_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  if v_affects then
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_minutes, balance_after_minutes, note)
    values (v_emp, v_type, p_id, 'consumption', -v_minutes, v_prev - v_minutes, 'consumption on approval');
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'approve_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'minutes', v_minutes,
                             'affects_balance', coalesce(v_affects, false),
                             'replacement_id', v_repl));
end; $$;

revoke execute on function public.approve_leave_request(uuid) from public, anon;
grant  execute on function public.approve_leave_request(uuid) to authenticated;
