-- FR-57 (2026-10-12, spec docs/specs/2026-10-12-client-feedback-approvals-settings-design.md §2):
-- at most ONE hourly leave request per person per day, and the per-day hourly
-- cap may never exceed 4 hours.
--
-- submit_leave_impl is the shared body behind every submit_* RPC; the only
-- change is the new exists-check before the daily-sum check. Hourly errands
-- are not leave and stay unaffected.

update public.work_settings
   set max_hourly_minutes_per_day = 240
 where max_hourly_minutes_per_day > 240;

alter table public.work_settings
  drop constraint work_settings_hourly_cap_sane,
  add constraint work_settings_hourly_cap_sane
    check (max_hourly_minutes_per_day > 0 and max_hourly_minutes_per_day <= 240);

CREATE OR REPLACE FUNCTION private.submit_leave_impl(p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text, p_unit public.leave_unit, p_start_time time without time zone, p_end_time time without time zone, p_replacement_id uuid, p_kind public.request_kind, p_location text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_dept uuid;
  v_minutes int;
  v_affects boolean;
  v_is_paid boolean;
  v_allow_hourly boolean;
  v_balance int;
  v_unpaid int := 0;
  v_req uuid;
  v_win_start time;
  v_win_end time;
  v_cap int;
  v_day_used int;
  v_jyear int;
  v_seq int;
  v_location text := nullif(btrim(p_location), '');
  v_replacement uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id, department_id into v_company, v_dept
    from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;

  if p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'end date must not be before start date' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;

  if p_kind = 'errand' then
    if v_location is null then
      raise exception 'errand location is required' using errcode = '22023';
    end if;
    if length(v_location) > 200 then
      raise exception 'errand location is too long' using errcode = '22023';
    end if;
    if p_unit = 'hour' then
      if p_start <> p_end
         or p_start_time is null
         or p_end_time is null
         or p_end_time <= p_start_time
      then
        raise exception 'end time must be after start time' using errcode = '22023';
      end if;
    elsif p_unit = 'day' then
      if p_start_time is not null or p_end_time is not null or p_day_part <> 'full' then
        raise exception 'daily errands require full dates without times' using errcode = '22023';
      end if;
    end if;
    v_replacement := null;
  else
    if p_leave_type_id is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
    v_location := null;
    v_replacement := p_replacement_id;
  end if;

  if p_kind = 'leave' then
    select affects_balance, is_paid, allow_hourly
      into v_affects, v_is_paid, v_allow_hourly
      from public.leave_types
     where id = p_leave_type_id and company_id = v_company and active;
    if v_affects is null then
      raise exception 'invalid or inactive leave type' using errcode = '22023';
    end if;
  end if;

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
    v_win_end := coalesce(v_win_end, '15:00'::time);
    v_cap := coalesce(v_cap, 240);

    if p_start_time < v_win_start or p_end_time > v_win_end then
      raise exception 'times must fall within working hours' using errcode = '22023';
    end if;
    if (extract(epoch from (p_end_time - p_start_time)) / 60)::int > v_cap then
      raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
    end if;
  end if;

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
      raise exception 'replacement must be an active colleague in your department'
        using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_uid::text, 0));

  if p_kind = 'leave' and p_unit = 'hour' then
    -- FR-57: one hourly leave per person per day. Rejected and cancelled
    -- requests free the day again.
    if exists (
      select 1 from public.leave_requests r
       where r.employee_id = v_uid
         and r.kind = 'leave'
         and r.unit = 'hour'
         and r.start_date = p_start
         and r.status in ('pending', 'approved')
    ) then
      raise exception 'only one hourly leave per day' using errcode = '22023';
    end if;

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

  if v_replacement is not null
     and private.replacement_is_away(
       v_replacement, p_start, p_end, p_unit, p_start_time, p_end_time
     )
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  v_minutes := public.compute_requested_minutes(
    v_company, p_start, p_end, p_day_part, p_unit, p_start_time, p_end_time, p_kind
  );
  if v_minutes <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)'
      using errcode = '22023';
  end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    v_unpaid := greatest(v_minutes - greatest(v_balance, 0), 0);
  elsif p_kind = 'leave' and not coalesce(v_is_paid, false) then
    v_unpaid := v_minutes;
  end if;

  select jm.jalali_year into v_jyear
    from public.jalali_months jm
   where p_start between jm.gregorian_start and jm.gregorian_end;
  if v_jyear is null then
    raise exception 'date outside supported calendar range' using errcode = '22023';
  end if;

  insert into public.leave_request_serials(company_id, jalali_year, kind, last_seq)
  values (v_company, v_jyear, p_kind, 1)
  on conflict (company_id, jalali_year, kind) do update
     set last_seq = public.leave_request_serials.last_seq + 1
  returning last_seq into v_seq;

  insert into public.leave_requests(
    employee_id, leave_type_id, start_date, end_date, day_part,
    unit, start_time, end_time, requested_minutes, unpaid_minutes, status, reason,
    replacement_id, company_id, serial_year, serial_seq, kind, errand_location
  )
  values (
    v_uid, p_leave_type_id, p_start, p_end, p_day_part,
    p_unit, p_start_time, p_end_time, v_minutes, v_unpaid, 'pending', p_reason,
    v_replacement, v_company, v_jyear, v_seq, p_kind, v_location
  )
  returning id into v_req;

  return v_req;
end;
$$;
