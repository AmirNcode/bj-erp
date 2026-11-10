-- FR-91: edit approved requests of all four types (2026-11-10).
-- request_corrections grows before/after columns for unit, day part, times and minutes (still
-- append-only, RLS on, no client policies). One new RPC, app_edit_request, edits the duration of an
-- approved request and may switch its unit inside one family (daily <-> hourly leave, daily trip
-- <-> hourly errand). app_correct_trip keeps its signature for the running old app and becomes a
-- call into the same code, under the new per-type gate (private.can_edit_request, previous
-- migration). The FR-84 gate private.can_correct_trip goes.

alter table public.request_corrections
  add column old_unit public.leave_unit not null default 'day',
  add column new_unit public.leave_unit not null default 'day',
  add column old_day_part public.day_part not null default 'full',
  add column new_day_part public.day_part not null default 'full',
  add column old_start_time time,
  add column new_start_time time,
  add column old_end_time time,
  add column new_end_time time,
  add column minutes_before integer,
  add column minutes_after integer;

comment on table public.request_corrections is
  'FR-84/FR-91: one row per edit of an approved request (any of the four types). Append-only; RPCs only. Rows from before FR-91 are daily trips: unit day, day part full, minutes null.';

-- ---------------------------------------------------------------------------------------------
-- The edit. p_uid is passed in (the public wrappers pass auth.uid()); every shape argument is the
-- full target value; p_per_diem_rials null = keep the current per diem.
-- Order: read -> gate -> signature, per diem, reason -> company lock -> employee lock -> re-read
-- for update -> gate again -> status -> shape -> limits -> write.
-- ---------------------------------------------------------------------------------------------
create or replace function private.edit_request_impl(
  p_uid uuid, p_request uuid, p_unit public.leave_unit, p_start date, p_end date,
  p_day_part public.day_part, p_start_time time, p_end_time time, p_per_diem_rials bigint,
  p_reason text, p_signature_data text, p_signature_authorized boolean) returns uuid
    language plpgsql security definer
    set search_path to ''
    as $_$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_part public.day_part := coalesce(p_day_part, 'full');
  r public.leave_requests%rowtype;
  lt public.leave_types%rowtype;
  v_per_diem bigint;
  v_by_requester boolean;
  v_minutes integer;
  v_unpaid integer;
  v_shape_changed boolean;
  v_dates_changed boolean;
  v_balance integer;
  v_old_paid integer;
  v_new_paid integer;
  v_delta integer := 0;
  v_win_start time;
  v_win_end time;
  v_cap integer;
  v_day_used integer;
  v_now timestamptz;
  v_id uuid;
begin
  if p_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not private.can_edit_request(p_uid, p_request, p_unit) then
    raise exception 'not allowed to edit this request' using errcode = '42501';
  end if;
  if not coalesce(p_signature_authorized, false) or p_signature_data is null
     or p_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if p_per_diem_rials < 0 then raise exception 'per diem must be 0 or more' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 1000 then raise exception 'reason is too long' using errcode = '22023'; end if;

  -- Lock order: the company's approval lock, then the employee's leave lock.
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  -- The gate again: roles, activity and the request itself may have changed while waiting.
  if not private.can_edit_request(p_uid, p_request, p_unit) then
    raise exception 'not allowed to edit this request' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'only an approved request can be edited' using errcode = '22023';
  end if;
  if r.kind = 'errand'
     and exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'pending') then
    raise exception 'an extension is waiting for HR' using errcode = '22023';
  end if;

  -- Shape of the target.
  if p_unit is null or p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'start date must not be after end date' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;
  if p_unit = 'hour' then
    if p_start <> p_end or p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'end time must be after start time' using errcode = '22023';
    end if;
    if v_part <> 'full' then raise exception 'invalid request shape' using errcode = '22023'; end if;
  else
    if p_start_time is not null or p_end_time is not null
       or (r.kind = 'errand' and v_part <> 'full') then
      raise exception 'invalid request shape' using errcode = '22023';
    end if;
  end if;

  -- Per diem: only on a daily errand. null keeps it; a trip turned hourly loses it (FR-61).
  if r.kind = 'errand' and p_unit = 'day' then
    v_per_diem := coalesce(p_per_diem_rials, r.per_diem_rials);
  else
    v_per_diem := null;
  end if;
  v_by_requester := case when v_per_diem is distinct from r.per_diem_rials then false
                         else r.per_diem_by_requester end;

  if (p_unit, p_start, p_end, v_part, p_start_time, p_end_time, v_per_diem)
     is not distinct from (r.unit, r.start_date, r.end_date, r.day_part, r.start_time, r.end_time, r.per_diem_rials) then
    raise exception 'nothing to edit' using errcode = '22023';
  end if;
  v_shape_changed := (p_unit, p_start, p_end, v_part, p_start_time, p_end_time)
    is distinct from (r.unit, r.start_date, r.end_date, r.day_part, r.start_time, r.end_time);
  v_dates_changed := (p_start, p_end) is distinct from (r.start_date, r.end_date);

  v_minutes := r.requested_minutes;
  v_unpaid := r.unpaid_minutes;

  if v_shape_changed then
    -- A trip becomes an hourly errand only while procurement has not started on it.
    if r.kind = 'errand' and r.unit = 'day' and p_unit = 'hour'
       and exists (select 1 from public.travel_bookings b
                    where b.request_id = r.id and (b.first_saved_at is not null or b.done_at is not null)) then
      raise exception 'procurement has started booking this trip' using errcode = '22023';
    end if;

    if r.kind = 'leave' then
      select * into lt from public.leave_types where id = r.leave_type_id;
    end if;

    -- Hourly leave: the rules of a new hourly request, the request itself excluded.
    if r.kind = 'leave' and p_unit = 'hour' then
      if r.unit = 'day' and not coalesce(lt.allow_hourly, false) then
        raise exception 'this leave type cannot be taken hourly' using errcode = '22023';
      end if;
      select work_start, work_end, max_hourly_minutes_per_day
        into v_win_start, v_win_end, v_cap
        from public.work_settings where company_id = r.company_id limit 1;
      v_win_start := coalesce(v_win_start, '07:00'::time);
      v_win_end := coalesce(v_win_end, '15:00'::time);
      v_cap := coalesce(v_cap, 240);
      if p_start_time < v_win_start or p_end_time > v_win_end then
        raise exception 'times must fall within working hours' using errcode = '22023';
      end if;
      if (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
        raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.leave_requests x
         where x.employee_id = r.employee_id and x.id <> r.id
           and x.kind = 'leave' and x.unit = 'hour' and x.start_date = p_start
           and x.status in ('pending', 'approved')
      ) then
        raise exception 'only one hourly leave per day' using errcode = '22023';
      end if;
      select coalesce(sum(x.requested_minutes), 0) into v_day_used
        from public.leave_requests x
       where x.employee_id = r.employee_id and x.id <> r.id
         and x.kind = 'leave' and x.unit = 'hour' and x.start_date = p_start
         and x.status in ('pending', 'approved');
      if v_day_used + (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
        raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
      end if;
    end if;

    -- No overlap with the person's other requests (the request's own old range does not count).
    if exists (
      select 1 from public.leave_requests x
       where x.employee_id = r.employee_id and x.id <> r.id
         and x.status in ('pending', 'approved')
         and x.start_date <= p_end and x.end_date >= p_start
         and (x.unit = 'day' or p_unit = 'day'
              or (x.start_time < p_end_time and x.end_time > p_start_time))
    ) or (r.kind = 'errand' and p_unit = 'day'
          and private.extension_overlaps(r.id, r.employee_id, p_start, p_end)) then
      raise exception 'overlapping leave request exists' using errcode = '22023';
    end if;

    v_minutes := public.compute_requested_minutes(
      r.company_id, p_start, p_end, v_part, p_unit, p_start_time, p_end_time, r.kind);
    if v_minutes <= 0 then
      raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)'
        using errcode = '22023';
    end if;

    -- Balance. A new request may run past the balance; an edit may not create or grow an unpaid part.
    if r.kind = 'leave' then
      if lt.affects_balance then
        v_old_paid := r.requested_minutes - r.unpaid_minutes;
        v_balance := public.current_leave_balance(r.employee_id, r.leave_type_id);
        v_new_paid := least(v_minutes, greatest(v_balance, 0) + v_old_paid);
        v_unpaid := v_minutes - v_new_paid;
        if v_unpaid > r.unpaid_minutes then
          raise exception 'an edit cannot make leave unpaid' using errcode = '22023';
        end if;
        v_delta := v_old_paid - v_new_paid;   -- > 0 returns time, < 0 takes it
      elsif not coalesce(lt.is_paid, false) then
        v_unpaid := v_minutes;
      else
        v_unpaid := 0;
      end if;
    else
      v_unpaid := 0;
    end if;
  end if;

  v_now := clock_timestamp();
  insert into public.request_corrections (
    request_id, company_id, old_start_date, new_start_date, old_end_date, new_end_date,
    per_diem_before, per_diem_after, reason, corrected_by, corrected_at,
    signature_data, signature_consent_at,
    old_unit, new_unit, old_day_part, new_day_part,
    old_start_time, new_start_time, old_end_time, new_end_time, minutes_before, minutes_after
  ) values (
    r.id, r.company_id, r.start_date, p_start, r.end_date, p_end,
    r.per_diem_rials, v_per_diem, v_reason, p_uid, v_now,
    p_signature_data, v_now,
    r.unit, p_unit, r.day_part, v_part,
    r.start_time, p_start_time, r.end_time, p_end_time, r.requested_minutes, v_minutes
  ) returning id into v_id;

  update public.leave_requests
     set start_date = p_start, end_date = p_end, unit = p_unit, day_part = v_part,
         start_time = p_start_time, end_time = p_end_time,
         requested_minutes = v_minutes, unpaid_minutes = v_unpaid,
         per_diem_rials = v_per_diem, per_diem_by_requester = v_by_requester
   where id = r.id;

  if v_delta <> 0 then
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type,
                                    delta_minutes, balance_after_minutes, note)
    values (r.employee_id, r.leave_type_id, r.id, 'adjustment', v_delta, v_balance + v_delta, 'request edited');
  end if;

  -- Procurement: a daily trip whose dates moved goes back to the booking list; a trip that became
  -- an hourly errand leaves it (its booking, if any, had not started).
  if r.kind = 'errand' and r.unit = 'day' and p_unit = 'day' and v_dates_changed then
    update public.travel_bookings set done_at = null, done_by = null, updated_at = now()
     where request_id = r.id and opened_at is not null;
  elsif r.kind = 'errand' and r.unit = 'day' and p_unit = 'hour' then
    delete from public.travel_bookings where request_id = r.id;
  end if;

  -- Values only; never the signature.
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (p_uid, 'request.edit', 'leave_requests', r.id,
          jsonb_build_object('unit', r.unit, 'start_date', r.start_date, 'end_date', r.end_date,
                             'day_part', r.day_part, 'start_time', r.start_time, 'end_time', r.end_time,
                             'requested_minutes', r.requested_minutes, 'unpaid_minutes', r.unpaid_minutes,
                             'per_diem_rials', r.per_diem_rials),
          jsonb_build_object('unit', p_unit, 'start_date', p_start, 'end_date', p_end,
                             'day_part', v_part, 'start_time', p_start_time, 'end_time', p_end_time,
                             'requested_minutes', v_minutes, 'unpaid_minutes', v_unpaid,
                             'per_diem_rials', v_per_diem, 'ledger_delta', v_delta,
                             'correction_id', v_id));
  return v_id;
end $_$;

revoke all on function private.edit_request_impl(uuid, uuid, public.leave_unit, date, date, public.day_part, time, time, bigint, text, text, boolean)
  from public, anon, authenticated;

create or replace function public.app_edit_request(
  p_request uuid, p_unit public.leave_unit, p_start date, p_end date, p_day_part public.day_part,
  p_start_time time, p_end_time time, p_per_diem_rials bigint, p_reason text,
  p_signature_data text, p_signature_authorized boolean) returns uuid
    language sql security definer
    set search_path to ''
    as $$
  select private.edit_request_impl(auth.uid(), p_request, p_unit, p_start, p_end, p_day_part,
    p_start_time, p_end_time, p_per_diem_rials, p_reason, p_signature_data, p_signature_authorized);
$$;

revoke all on function public.app_edit_request(uuid, public.leave_unit, date, date, public.day_part, time, time, bigint, text, text, boolean)
  from public, anon;
grant execute on function public.app_edit_request(uuid, public.leave_unit, date, date, public.day_part, time, time, bigint, text, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The old app's trip correction: same signature, same arguments, the new gate and code.
-- ---------------------------------------------------------------------------------------------
create or replace function public.app_correct_trip(p_request uuid, p_new_start date, p_new_end date, p_per_diem_rials bigint, p_reason text, p_signature_data text, p_signature_authorized boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
begin
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not private.can_edit_request(v_uid, p_request, r.unit) then
    raise exception 'not allowed to edit this request' using errcode = '42501';
  end if;
  -- Same locks as the edit (re-entrant), taken before the dates are read for the coalesce below.
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request;
  if r.status <> 'approved' or r.kind <> 'errand' or r.unit <> 'day' then
    raise exception 'only an approved daily trip can be corrected' using errcode = '22023';
  end if;
  return private.edit_request_impl(v_uid, p_request, 'day',
    coalesce(p_new_start, r.start_date), coalesce(p_new_end, r.end_date), 'full', null, null,
    p_per_diem_rials, p_reason, p_signature_data, p_signature_authorized);
end $_$;

-- The old migrations never revoked anon here; the gate would refuse anon anyway (no auth.uid()).
revoke all on function public.app_correct_trip(uuid, date, date, bigint, text, text, boolean) from public, anon;

drop function private.can_correct_trip(uuid, uuid);

-- ---------------------------------------------------------------------------------------------
-- The history read: the ten new columns follow the existing ones. No signature, as before.
-- ---------------------------------------------------------------------------------------------
drop function public.request_trip_corrections(uuid);
drop function private.request_data_request_trip_corrections(uuid, boolean);

create function private.request_data_request_trip_corrections(p_id uuid, p_print boolean)
  returns table(old_start_date date, new_start_date date, old_end_date date, new_end_date date,
                per_diem_before bigint, per_diem_after bigint, reason text, corrected_by_name text,
                corrected_at timestamp with time zone,
                old_unit public.leave_unit, new_unit public.leave_unit,
                old_day_part public.day_part, new_day_part public.day_part,
                old_start_time time without time zone, new_start_time time without time zone,
                old_end_time time without time zone, new_end_time time without time zone,
                minutes_before integer, minutes_after integer)
    language plpgsql stable security definer
    set search_path to ''
    as $$
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  return query
    select c.old_start_date, c.new_start_date, c.old_end_date, c.new_end_date,
           c.per_diem_before, c.per_diem_after, c.reason, p.full_name, c.corrected_at,
           c.old_unit, c.new_unit, c.old_day_part, c.new_day_part,
           c.old_start_time, c.new_start_time, c.old_end_time, c.new_end_time,
           c.minutes_before, c.minutes_after
      from public.request_corrections c
      left join public.profiles p on p.id = c.corrected_by
     where c.request_id = p_id
     order by c.corrected_at;
end $$;

revoke all on function private.request_data_request_trip_corrections(uuid, boolean) from public, anon, authenticated;

create function public.request_trip_corrections(p_id uuid)
  returns table(old_start_date date, new_start_date date, old_end_date date, new_end_date date,
                per_diem_before bigint, per_diem_after bigint, reason text, corrected_by_name text,
                corrected_at timestamp with time zone,
                old_unit public.leave_unit, new_unit public.leave_unit,
                old_day_part public.day_part, new_day_part public.day_part,
                old_start_time time without time zone, new_start_time time without time zone,
                old_end_time time without time zone, new_end_time time without time zone,
                minutes_before integer, minutes_after integer)
    language sql stable security definer
    set search_path to ''
    as $$
 select * from private.request_data_request_trip_corrections(p_id,false);
$$;

revoke all on function public.request_trip_corrections(uuid) from public, anon;
grant execute on function public.request_trip_corrections(uuid) to authenticated;
