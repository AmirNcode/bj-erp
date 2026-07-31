-- =============================================================================
-- Migration: 20260729130003_leave_minutes_contract.sql
-- Purpose  : CONTRACT phase of the days -> minutes conversion (spec §5).
--            Rewrites every SECURITY DEFINER leave function to write integer
--            minutes natively, then drops the sync triggers and the day columns.
--            After this migration no fractional day survives in the schema.
--
-- Sources  : function bodies are ported from 20260702120001_hardening.sql and
--            20260702120003_company_tz_cancel.sql with the unit changed. The
--            advisory lock, overlap guard, 366-day bound, error strings, and
--            audit rows are preserved verbatim — they are the 2026-07-02
--            hardening and must not be simplified.
--
-- Breaking : allocate_leave(p_days numeric)      -> allocate_leave(p_minutes int)
--            set_leave_balance(p_target numeric) -> (p_target_minutes int)
--            compute_requested_days()            -> compute_requested_minutes()
--            current_leave_balance()             -> now returns int (minutes)
--
-- NOTE: current_leave_balance and compute_requested_* must be DROPPED before
-- recreation, not `create or replace`d: their return type changes from numeric to
-- int, and Postgres refuses to change the return type of an existing function.
--
-- Idempotent: safe to replay (deploy/update.sh replays every file).
-- Target is Postgres 15 (supabase/postgres:15.8.1.085) — no PG16+ syntax.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the expand-phase sync triggers — the functions write minutes now.
-- ---------------------------------------------------------------------------
drop trigger if exists leave_ledger_sync_minutes_trg      on public.leave_ledger;
drop trigger if exists leave_requests_sync_minutes_trg    on public.leave_requests;
drop trigger if exists leave_allocations_sync_minutes_trg on public.leave_allocations;
drop function if exists public.leave_ledger_sync_minutes();
drop function if exists public.leave_requests_sync_minutes();
drop function if exists public.leave_allocations_sync_minutes();

-- ---------------------------------------------------------------------------
-- 2. compute_requested_minutes — replaces compute_requested_days.
--    Reads hours_per_day from work_settings, so the same range yields different
--    minutes for a 7.5h company. Half-day = half of a workday.
-- ---------------------------------------------------------------------------
drop function if exists public.compute_requested_days(uuid, date, date, public.day_part);
drop function if exists public.compute_requested_minutes(uuid, date, date, public.day_part);

create function public.compute_requested_minutes(
  p_company_id uuid, p_start date, p_end date, p_day_part public.day_part
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

-- ---------------------------------------------------------------------------
-- 3. current_leave_balance — now minutes. Dropped first (return type change).
--    Other definer functions call it; Postgres does not track function-to-
--    function dependencies, so the drop is safe and callers bind at runtime.
-- ---------------------------------------------------------------------------
drop function if exists public.current_leave_balance(uuid, uuid);

create function public.current_leave_balance(p_employee_id uuid, p_leave_type_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((
    select balance_after_minutes from public.leave_ledger
    where employee_id = p_employee_id and leave_type_id = p_leave_type_id
    order by created_at desc, id desc limit 1
  ), 0);
$$;

-- ---------------------------------------------------------------------------
-- 4. allocate_leave — p_days numeric -> p_minutes int.
-- ---------------------------------------------------------------------------
drop function if exists public.allocate_leave(uuid, uuid, date, date, numeric);
drop function if exists public.allocate_leave(uuid, uuid, date, date, int);

create function public.allocate_leave(
  p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_minutes int
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev int; v_alloc uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can allocate leave' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'allocation days must be greater than 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  insert into public.leave_allocations(employee_id, leave_type_id, period_start, period_end, allocated_minutes, created_by)
  values (p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_minutes, auth.uid())
  returning id into v_alloc;

  v_prev := public.current_leave_balance(p_employee_id, p_leave_type_id);
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'allocation', p_minutes, v_prev + p_minutes, 'allocation');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'allocate_leave', 'leave_allocations', v_alloc,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id, 'minutes', p_minutes));
  return v_alloc;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. submit_leave_request — minutes; everything else preserved.
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_minutes int; v_affects boolean; v_balance int; v_req uuid;
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

  -- Serialize all leave writes for this employee (released at commit/rollback).
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  if exists (
    select 1 from public.leave_requests
    where employee_id = v_uid
      and status in ('pending', 'approved')
      and start_date <= p_end
      and end_date >= p_start
  ) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(v_company, p_start, p_end, p_day_part);
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = p_leave_type_id and company_id = v_company and active;
  if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    if v_minutes > v_balance then
      raise exception 'insufficient balance: % day(s) requested, % available', v_minutes, v_balance using errcode = '22023';
    end if;
  end if;

  insert into public.leave_requests(employee_id, leave_type_id, start_date, end_date, day_part, requested_minutes, status, reason)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part, v_minutes, 'pending', p_reason)
  returning id into v_req;
  return v_req;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. approve_leave_request — minutes.
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

  -- Serialize with other leave writes for this employee, THEN re-read the row
  -- so status/overlap/balance checks cannot race a concurrent writer.
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date
    into v_type, v_minutes, v_status, v_start, v_end
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
          jsonb_build_object('employee_id', v_emp, 'minutes', v_minutes, 'affects_balance', coalesce(v_affects, false)));
end; $$;

-- ---------------------------------------------------------------------------
-- 7. cancel_leave_request — minutes. Company-timezone "today" preserved.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_minutes int;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
  v_today   date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes
    into v_status, v_start, v_type, v_minutes
    from public.leave_requests where id = p_id;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > v_today then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_minutes, balance_after_minutes, note)
      values (v_owner, v_type, p_id, 'reversal', v_minutes, v_prev + v_minutes, 'reversal on cancel');
    end if;

  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled' using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'cancel_leave_request', 'leave_requests', p_id,
          jsonb_build_object('status_before', v_status, 'minutes', v_minutes,
                             'reversed', (v_status = 'approved')));
end; $$;

-- ---------------------------------------------------------------------------
-- 8. set_leave_balance — p_target numeric -> p_target_minutes int.
-- ---------------------------------------------------------------------------
drop function if exists public.set_leave_balance(uuid, uuid, numeric);
drop function if exists public.set_leave_balance(uuid, uuid, int);

create function public.set_leave_balance(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_target_minutes int
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
  v_ledger uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can set leave balance' using errcode = '42501';
  end if;

  if p_target_minutes is null or p_target_minutes < 0 then
    raise exception 'target balance must be >= 0' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target_minutes then
    return p_target_minutes;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set')
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $$;

-- ---------------------------------------------------------------------------
-- 9. Grants — unchanged intent: internal helpers revoked from clients, write
--    fns callable by authenticated (self-guarded), anon always revoked.
-- ---------------------------------------------------------------------------
revoke execute on function public.compute_requested_minutes(uuid, date, date, public.day_part) from public, anon, authenticated;
revoke execute on function public.current_leave_balance(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.allocate_leave(uuid, uuid, date, date, int) from public, anon;
grant  execute on function public.allocate_leave(uuid, uuid, date, date, int) to authenticated;
revoke execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) from public, anon;
grant  execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) to authenticated;
revoke execute on function public.approve_leave_request(uuid) from public, anon;
grant  execute on function public.approve_leave_request(uuid) to authenticated;
revoke execute on function public.cancel_leave_request(uuid) from public, anon;
grant  execute on function public.cancel_leave_request(uuid) to authenticated;
revoke execute on function public.set_leave_balance(uuid, uuid, int) from public, anon;
grant  execute on function public.set_leave_balance(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Drop the day columns. team_leave_calendar selects requested_days, so it
--     is recreated first — same shape, minutes instead of days.
--
--     Intentionally recreated WITHOUT security_invoker, so it keeps running as
--     owner and bypassing the strict base-table RLS — the FR-25 design from
--     20260624090002. `reason` and `decision_note` stay unselected. Do not add
--     them.
-- ---------------------------------------------------------------------------
drop view if exists public.team_leave_calendar;

create view public.team_leave_calendar as
  select
    lr.id,
    lr.employee_id,
    p.full_name      as employee_name,
    p.department_id,
    lr.leave_type_id,
    lt.name_fa       as leave_type_name_fa,
    lt.name_en       as leave_type_name_en,
    lt.color         as leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.requested_minutes,
    lr.status
  from public.leave_requests lr
  join public.profiles    p  on p.id  = lr.employee_id
  join public.leave_types lt on lt.id = lr.leave_type_id
  where lr.status in ('pending', 'approved')
    and (
      lr.employee_id = auth.uid()
      or private.same_team(auth.uid(), lr.employee_id)
      or private.can_read_all(auth.uid())
    );

revoke all    on public.team_leave_calendar from public, anon;
grant  select on public.team_leave_calendar to authenticated;

alter table public.leave_ledger      drop column if exists delta_days,
                                     drop column if exists balance_after;
alter table public.leave_requests    drop column if exists requested_days;
alter table public.leave_allocations drop column if exists allocated_days;
