-- Daily work errands plus paid/unpaid leave splitting (2026-08-05).
--
-- Existing rows and ledger history are preserved. A paid request may exceed the
-- current balance; the paid ledger stops at zero and the request records the
-- remainder as unpaid minutes. Daily errands reuse kind='errand', unit='day'.

alter table public.leave_requests
  add column if not exists unpaid_minutes int not null default 0;

alter table public.leave_requests
  drop constraint if exists leave_requests_unpaid_minutes_shape;

alter table public.leave_requests
  add constraint leave_requests_unpaid_minutes_shape check (
    unpaid_minutes >= 0 and unpaid_minutes <= requested_minutes
  );

comment on column public.leave_requests.unpaid_minutes is
  'Minutes of this request not covered by paid leave. Estimated at submission and finalized atomically on approval.';

-- An errand may be hourly (one date + times) or daily (date range + no times).
alter table public.leave_requests
  drop constraint if exists leave_requests_kind_shape;

alter table public.leave_requests
  add constraint leave_requests_kind_shape check (
    (kind = 'leave'
       and leave_type_id is not null
       and errand_location is null)
    or
    (kind = 'errand'
       and leave_type_id is null
       and replacement_id is null
       and errand_location is not null
       and btrim(errand_location) <> ''
       and length(errand_location) <= 200)
  );

-- Daily errands count every inclusive calendar day because they are company
-- work and may happen on weekends/holidays, matching the hourly errand rule.
create or replace function public.compute_requested_minutes(
  p_company_id uuid,
  p_start date,
  p_end date,
  p_day_part public.day_part,
  p_unit public.leave_unit default 'day',
  p_start_time time default null,
  p_end_time time default null,
  p_kind public.request_kind default 'leave'
) returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_weekend int[];
  v_per_day numeric;
  v_count numeric := 0;
  d date;
  v_working boolean;
begin
  if p_end < p_start then return 0; end if;

  select weekend_days, hours_per_day into v_weekend, v_per_day
    from public.work_settings where company_id = p_company_id limit 1;
  if v_weekend is null then v_weekend := '{5}'; end if;
  if v_per_day is null then v_per_day := 8; end if;

  if p_unit = 'hour' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      return 0;
    end if;
    if p_kind = 'errand' then
      return (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
    end if;

    v_working := (extract(isodow from p_start)::int <> all (v_weekend))
                 and not exists (
                   select 1 from public.holidays h
                    where h.company_id = p_company_id and h.holiday_date = p_start
                 );
    if not v_working then return 0; end if;
    return (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
  end if;

  if p_kind = 'errand' then
    return round(((p_end - p_start) + 1) * v_per_day * 60);
  end if;

  if p_day_part in ('am', 'pm') then
    if p_start <> p_end then return 0; end if;
    v_working := (extract(isodow from p_start)::int <> all (v_weekend))
                 and not exists (
                   select 1 from public.holidays h
                    where h.company_id = p_company_id and h.holiday_date = p_start
                 );
    return case when v_working then round(v_per_day * 60 / 2) else 0 end;
  end if;

  d := p_start;
  while d <= p_end loop
    if (extract(isodow from d)::int <> all (v_weekend))
       and not exists (
         select 1 from public.holidays h
          where h.company_id = p_company_id and h.holiday_date = d
       )
    then
      v_count := v_count + 1;
    end if;
    d := d + 1;
  end loop;

  return round(v_count * v_per_day * 60);
end;
$$;

revoke execute on function public.compute_requested_minutes(
  uuid, date, date, public.day_part, public.leave_unit, time, time, public.request_kind
) from public, anon, authenticated;

-- Single request writer: daily errands gain a valid shape and leave submissions
-- estimate unpaid overage instead of rejecting it.
create or replace function private.submit_leave_impl(
  p_leave_type_id uuid,
  p_start date,
  p_end date,
  p_day_part public.day_part,
  p_reason text,
  p_unit public.leave_unit,
  p_start_time time,
  p_end_time time,
  p_replacement_id uuid,
  p_kind public.request_kind,
  p_location text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function private.submit_leave_impl(
  uuid, date, date, public.day_part, text, public.leave_unit, time, time,
  uuid, public.request_kind, text
) from public, anon, authenticated;

-- Signed daily-errand wrapper. It uses the same immutable requester evidence as
-- the three existing submission paths.
create or replace function public.submit_daily_errand_request(
  p_start date,
  p_end date,
  p_location text,
  p_signature_data text,
  p_signature_authorized boolean,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    null::uuid, p_start, p_end, 'full', p_description,
    'day', null::time, null::time, null::uuid, 'errand', p_location
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  return v_request_id;
end;
$$;

revoke execute on function public.submit_daily_errand_request(
  date, date, text, text, boolean, text
) from public, anon;
grant execute on function public.submit_daily_errand_request(
  date, date, text, text, boolean, text
) to authenticated;

-- Approval finalizes the paid/unpaid split under the same per-employee lock as
-- the ledger debit. Only paid minutes are consumed; balances cannot cross zero.
create or replace function public.approve_leave_request(
  p_id uuid,
  p_signature_data text,
  p_signature_authorized boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_emp uuid;
  v_type uuid;
  v_minutes int;
  v_status public.leave_status;
  v_start date;
  v_end date;
  v_unit public.leave_unit;
  v_st time;
  v_et time;
  v_repl uuid;
  v_affects boolean;
  v_is_paid boolean;
  v_prev int := 0;
  v_paid int := 0;
  v_unpaid int := 0;
  v_rows int;
  v_consent_at timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_signature_authorized is not true then
    raise exception 'signature authorization is required' using errcode = '22023';
  end if;
  if p_signature_data is null or p_signature_data = '' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if length(p_signature_data) not between 100 and 350000
     or mod(length(p_signature_data), 4) <> 2
     or p_signature_data !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
  then
    raise exception 'signature data is invalid' using errcode = '22023';
  end if;

  select employee_id into v_emp
    from public.leave_requests where id = p_id;
  if v_emp is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date,
         unit, start_time, end_time, replacement_id
    into v_type, v_minutes, v_status, v_start, v_end,
         v_unit, v_st, v_et, v_repl
    from public.leave_requests
   where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.leave_requests r
     where r.employee_id = v_emp
       and r.id <> p_id
       and r.status = 'approved'
       and r.start_date <= v_end
       and r.end_date >= v_start
       and (
         r.unit = 'day' or v_unit = 'day'
         or (r.start_time < v_et and r.end_time > v_st)
       )
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  if v_repl is not null
     and private.replacement_is_away(v_repl, v_start, v_end, v_unit, v_st, v_et)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  select affects_balance, is_paid into v_affects, v_is_paid
    from public.leave_types where id = v_type;

  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    v_paid := least(v_minutes, greatest(v_prev, 0));
    v_unpaid := v_minutes - v_paid;
  elsif v_type is not null and not coalesce(v_is_paid, false) then
    v_unpaid := v_minutes;
  end if;

  update public.leave_requests
     set status = 'approved',
         unpaid_minutes = v_unpaid,
         decided_by = v_uid,
         decided_at = v_consent_at,
         approver_signature_data = p_signature_data,
         approver_signature_consent_at = v_consent_at
   where id = p_id
     and status = 'pending'
     and approver_signature_data is null
     and approver_signature_consent_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  if v_affects and v_paid > 0 then
    insert into public.leave_ledger(
      employee_id, leave_type_id, request_id, entry_type,
      delta_minutes, balance_after_minutes, note
    ) values (
      v_emp, v_type, p_id, 'consumption',
      -v_paid, v_prev - v_paid, 'paid portion consumed on approval'
    );
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'approve_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'employee_id', v_emp,
      'requested_minutes', v_minutes,
      'paid_minutes', v_paid,
      'unpaid_minutes', v_unpaid,
      'affects_balance', coalesce(v_affects, false),
      'replacement_id', v_repl,
      'digital_signature_authorized', true,
      'signature_consent_at', v_consent_at
    )
  );
end;
$$;

revoke execute on function public.approve_leave_request(uuid, text, boolean)
  from public, anon;
grant execute on function public.approve_leave_request(uuid, text, boolean)
  to authenticated;

-- Reversals restore only the portion actually consumed from the paid ledger.
create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status public.leave_status;
  v_start date;
  v_type uuid;
  v_kind public.request_kind;
  v_minutes int;
  v_unpaid int;
  v_paid int;
  v_affects boolean;
  v_prev int;
  v_rows int;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes, unpaid_minutes, kind
    into v_status, v_start, v_type, v_minutes, v_unpaid, v_kind
    from public.leave_requests where id = p_id;
  v_paid := greatest(v_minutes - coalesce(v_unpaid, 0), 0);

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;
  elsif v_status = 'approved'
        and (v_start > v_today or (v_kind = 'errand' and v_start >= v_today))
  then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'request was already decided' using errcode = '22023';
    end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects and v_paid > 0 then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      ) values (
        v_owner, v_type, p_id, 'reversal',
        v_paid, v_prev + v_paid, 'paid portion reversed on cancel'
      );
    end if;
  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled'
      using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'cancel_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'status_before', v_status,
      'requested_minutes', v_minutes,
      'paid_minutes_reversed', case when v_status = 'approved' then v_paid else 0 end,
      'unpaid_minutes', v_unpaid,
      'kind', v_kind,
      'reversed', (
        v_status = 'approved' and coalesce(v_affects, false) and v_paid > 0
      )
    )
  );
end;
$$;

revoke execute on function public.cancel_leave_request(uuid) from public, anon;
grant execute on function public.cancel_leave_request(uuid) to authenticated;

notify pgrst, 'reload schema';
