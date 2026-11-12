-- FR-92: managers may overdraw an overdraft-enabled leave type (annual); employees may not.
-- Redefines four functions from their current bodies (see supabase/schema.sql); only the marked lines change.
alter table public.leave_types add column manager_overdraft boolean not null default false;
update public.leave_types set manager_overdraft = true where name_en = 'Annual Leave' and affects_balance;

-- 'overdraft' = type allows it and the requester is a Manager now; 'strict' = same type, not a Manager;
-- 'split' = any other balance type (paid up to the balance, rest unpaid); 'none' = no balance.
create function private.balance_rule(p_employee uuid, p_leave_type uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when lt.id is null or not lt.affects_balance then 'none'
    when lt.manager_overdraft and private.has_role(p_employee, 'manager') then 'overdraft'
    when lt.manager_overdraft then 'strict'
    else 'split'
  end
  from (select 1) one left join public.leave_types lt on lt.id = p_leave_type;
$$;
revoke all on function private.balance_rule(uuid, uuid) from public, anon, authenticated;

create function private.pending_leave_minutes(p_employee uuid, p_leave_type uuid, p_exclude uuid default null)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(r.requested_minutes), 0)::integer
    from public.leave_requests r
   where r.employee_id = p_employee and r.leave_type_id = p_leave_type
     and r.status = 'pending' and r.kind = 'leave'
     and (p_exclude is null or r.id <> p_exclude);
$$;
revoke all on function private.pending_leave_minutes(uuid, uuid, uuid) from public, anon, authenticated;

create function public.app_my_leave_availability(p_leave_type_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return jsonb_build_object(
    'balance_minutes', (select l.balance_after_minutes from public.leave_ledger l
                         where l.employee_id = v_uid and l.leave_type_id = p_leave_type_id
                         order by l.seq desc limit 1),
    'pending_minutes', private.pending_leave_minutes(v_uid, p_leave_type_id),
    'rule', private.balance_rule(v_uid, p_leave_type_id));
end; $$;
revoke all on function public.app_my_leave_availability(uuid) from public, anon;
grant execute on function public.app_my_leave_availability(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION private.submit_leave_impl(p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text, p_unit public.leave_unit, p_start_time time without time zone, p_end_time time without time zone, p_replacement_id uuid, p_kind public.request_kind, p_location text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_rule text;
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
  perform private.approval_lock(v_company);
  -- Authentication in the public wrapper happened before this possible wait.
  -- Refresh both caller activity/company and the department used for cover rules.
  select department_id into v_dept from public.profiles
    where id=v_uid and company_id=v_company and active;
  if not found then
    raise exception 'not allowed to submit this request' using errcode='42501';
  end if;

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
         and ((v_dept is not null and p.department_id = v_dept)
              or private.delegate_eligible(v_uid,p.id))
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
    v_rule := private.balance_rule(v_uid, p_leave_type_id);
    if v_rule = 'overdraft' then
      v_unpaid := 0;
    elsif v_rule = 'strict' then
      if v_minutes > coalesce(v_balance, 0) - private.pending_leave_minutes(v_uid, p_leave_type_id) then
        raise exception 'request exceeds available balance' using errcode = '22023';
      end if;
      v_unpaid := 0;
    else
      v_unpaid := greatest(v_minutes - greatest(v_balance, 0), 0);
    end if;
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
    replacement_id, company_id, serial_year, serial_seq, kind, errand_location, created_at
  )
  values (
    v_uid, p_leave_type_id, p_start, p_end, p_day_part,
    p_unit, p_start_time, p_end_time, v_minutes, v_unpaid, 'pending', p_reason,
    v_replacement, v_company, v_jyear, v_seq, p_kind, v_location, clock_timestamp()
  )
  returning id into v_req;

  return v_req;
end;
$function$;

CREATE OR REPLACE FUNCTION private.finalize_approval_request(p_id uuid, p_actor uuid, p_signature text, p_consent_at timestamp with time zone, p_origin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.leave_requests%rowtype; v_affects boolean; v_is_paid boolean;
  v_prev integer:=0; v_paid integer:=0; v_unpaid integer:=0;
begin
  select * into r from public.leave_requests where id=p_id;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:'||r.employee_id::text,0));
  select * into r from public.leave_requests where id=p_id for update;
  if r.status<>'pending' then return false; end if;
  if exists (select 1 from public.approval_steps s where private.request_step_applies(p_id,s.id)
    and not private.request_step_decided(p_id,s.id,'approved')) then return false; end if;
  if exists (select 1 from public.leave_requests lr where lr.employee_id=r.employee_id and lr.id<>r.id
    and lr.status='approved' and lr.start_date<=r.end_date and lr.end_date>=r.start_date
    and (lr.unit='day' or r.unit='day' or (lr.start_time<r.end_time and lr.end_time>r.start_time))) then
    raise exception 'overlapping approved leave exists' using errcode='22023'; end if;
  if r.replacement_id is not null and private.replacement_is_away(r.replacement_id,r.start_date,r.end_date,
    r.unit,r.start_time,r.end_time) then raise exception 'replacement is on leave during this period' using errcode='22023'; end if;
  select affects_balance,is_paid into v_affects,v_is_paid from public.leave_types where id=r.leave_type_id;
  if v_affects then
    v_prev:=public.current_leave_balance(r.employee_id,r.leave_type_id);
    if private.balance_rule(r.employee_id,r.leave_type_id)='overdraft' then
      v_paid:=r.requested_minutes; v_unpaid:=0;
    else
      v_paid:=least(r.requested_minutes,greatest(v_prev,0)); v_unpaid:=r.requested_minutes-v_paid;
    end if;
  elsif r.leave_type_id is not null and not coalesce(v_is_paid,false) then v_unpaid:=r.requested_minutes; end if;
  update public.leave_requests set status='approved',unpaid_minutes=v_unpaid,decided_by=p_actor,
    decided_at=clock_timestamp(),approver_signature_data=p_signature,
    approver_signature_consent_at=case when p_signature is null then null else p_consent_at end
    where id=p_id and status='pending';
  if not found then return false; end if;
  if v_affects and v_paid>0 then
    insert into public.leave_ledger(employee_id,leave_type_id,request_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(r.employee_id,r.leave_type_id,p_id,'consumption',-v_paid,v_prev-v_paid,case when private.balance_rule(r.employee_id,r.leave_type_id)='overdraft' then 'consumed on approval (manager overdraft)' else 'paid portion consumed on approval' end);
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (p_actor,'approve_leave_request','leave_requests',p_id,jsonb_build_object('employee_id',r.employee_id,
      'requested_minutes',r.requested_minutes,'paid_minutes',v_paid,'unpaid_minutes',v_unpaid,
      'replacement_id',r.replacement_id,'origin',p_origin));
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION private.edit_request_impl(p_uid uuid, p_request uuid, p_unit public.leave_unit, p_start date, p_end date, p_day_part public.day_part, p_start_time time without time zone, p_end_time time without time zone, p_per_diem_rials bigint, p_reason text, p_signature_data text, p_signature_authorized boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if r.kind = 'errand' and r.unit = 'day' and p_unit = 'hour'
       and exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'approved') then
      raise exception 'an extended trip cannot become an hourly errand' using errcode = '22023';
    end if;

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
        if private.balance_rule(r.employee_id, r.leave_type_id) = 'overdraft' then
          v_new_paid := v_minutes;
          v_unpaid := 0;
        else
          v_new_paid := least(v_minutes, greatest(v_balance, 0) + v_old_paid);
          v_unpaid := v_minutes - v_new_paid;
          if v_unpaid > r.unpaid_minutes then
            raise exception 'an edit cannot make leave unpaid' using errcode = '22023';
          end if;
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
    values (r.employee_id, r.leave_type_id, r.id,
            (case when v_delta < 0 then 'consumption' else 'reversal' end)::public.ledger_entry,
            v_delta, v_balance + v_delta, 'request edited');
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
end $function$;

CREATE OR REPLACE FUNCTION private.request_data_app_request_approval_context(p_id uuid, p_print boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.leave_requests%rowtype; v_progress jsonb; v_result jsonb;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode='P0002'; end if;
  select * into r from public.leave_requests where id=p_id;
  v_progress:=private.request_data_app_request_approval_progress(p_id,p_print);
  select (to_jsonb(r)-'signature_data'-'approver_signature_data')||jsonb_build_object(
    'employee_name',p.full_name,'employee_code',p.employee_code,
    'personnel_no',p.personnel_no,
    'job_title',case when p_print or p.id=auth.uid() or private.reads_people(auth.uid())
      or private.is_direct_manager_of(auth.uid(),p.id) or private.is_department_manager_of(auth.uid(),p.id) then p.job_title end,
    'employee_manager_id',p.manager_id,'department_id',p.department_id,
    'department_name',dep.name_fa,'department_name_fa',dep.name_fa,'department_name_en',dep.name_en,
    'employee_department_manager_id',private.department_manager_for(p.id),
    'leave_type_name_fa',lt.name_fa,'leave_type_name_en',lt.name_en,'affects_balance',lt.affects_balance,
    'leave_type_affects_balance',lt.affects_balance,'is_paid',lt.is_paid,
    'replacement_name',rp.full_name,'decided_by_name',dp.full_name,
    'replacement_conflict',case when r.replacement_id is null then false else
      private.replacement_is_away(r.replacement_id,r.start_date,r.end_date,r.unit,r.start_time,r.end_time) end,
    'replacement_signoff_status',rs.status,'replacement_signed_at',rs.signature_consent_at,
    'can_override',r.status='pending' and private.is_admin(auth.uid()),
    'can_approve',r.status='pending' and (private.is_admin(auth.uid()) or exists
      (select 1 from jsonb_array_elements(v_progress) item where (item->>'can_approve')::boolean)),
    'can_reject',r.status='pending' and (private.is_admin(auth.uid()) or exists
      (select 1 from jsonb_array_elements(v_progress) item where (item->>'can_reject')::boolean)),
    'balance_minutes',case when not p_print and (r.status='pending' or r.employee_id=auth.uid() or private.is_admin(auth.uid()) or private.has_perm(auth.uid(),'leave_balances','read')) and lt.affects_balance then public.current_leave_balance(r.employee_id,r.leave_type_id) end,
    'pending_other_minutes',case when not p_print and (r.status='pending' or r.employee_id=auth.uid() or private.is_admin(auth.uid()) or private.has_perm(auth.uid(),'leave_balances','read')) then private.pending_leave_minutes(r.employee_id,r.leave_type_id,r.id) end,
    'balance_rule',case when not p_print and (r.status='pending' or r.employee_id=auth.uid() or private.is_admin(auth.uid()) or private.has_perm(auth.uid(),'leave_balances','read')) then private.balance_rule(r.employee_id,r.leave_type_id) end,
    'configuration_changed',coalesce(pol.configuration_changed,false),
    'legacy_reconciliation_required',private.ambiguous_legacy_approval(r.id),
    'progress',v_progress)
  into v_result from public.profiles p left join public.departments dep on dep.id=p.department_id
    left join public.leave_types lt on lt.id=r.leave_type_id
    left join public.profiles rp on rp.id=r.replacement_id left join public.profiles dp on dp.id=r.decided_by
    left join public.leave_request_replacement_signoffs rs on rs.request_id=r.id
    left join public.approval_request_policy pol on pol.request_id=r.id where p.id=r.employee_id;
  return v_result;
end; $function$;
